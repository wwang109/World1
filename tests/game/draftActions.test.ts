import { describe, expect, it } from 'vitest';
import { applyDraftPicks } from '../../src/game/draftActions';
import { demoState } from '../../src/game/demoState';
import { DRAFT_SET_KEYS, rollStartDraft, type DraftSetKey } from '../../src/run/draft';
import { skillBook } from '../../src/data/skills';

/** Always picks candidate [0] in each of the 4 sets — the historical "small
 * pick" path that already fit the board before this bug existed. */
function draftPicksFor(seed: number): Partial<Record<DraftSetKey, string>> {
  const draft = rollStartDraft(seed);
  const picks: Partial<Record<DraftSetKey, string>> = {};
  for (const key of DRAFT_SET_KEYS) {
    picks[key] = draft[key][0]!.skillId;
  }
  return picks;
}

/** Picks the LARGEST-size candidate in each of the 4 sets — the policy that
 * actually exercises the overflow path (offense(3) + defense(3) + support(2)
 * + wildcard(3) = 11 > SLOTS(10) for several seeds), mirroring
 * `largestDraftPicksFor` in tests/run/runState.test.ts. */
function largestDraftPicksFor(seed: number): Partial<Record<DraftSetKey, string>> {
  const draft = rollStartDraft(seed);
  const picks: Partial<Record<DraftSetKey, string>> = {};
  for (const key of DRAFT_SET_KEYS) {
    const set = draft[key];
    let best = set[0]!;
    for (const card of set) {
      const bestSize = skillBook[best.skillId]?.size ?? 1;
      const cardSize = skillBook[card.skillId]?.size ?? 1;
      if (cardSize > bestSize) best = card;
    }
    picks[key] = best.skillId;
  }
  return picks;
}

/**
 * Seeds whose largest-card draft genuinely overflows the 10-slot board.
 *
 * SEARCHED, NEVER PINNED. An earlier version hardcoded [25, 45, 158, ...],
 * which broke the moment content was added: `rollStartDraft` draws from the
 * live `skillBook`, so growing the book reshuffles which seeds overflow. The
 * assertion those seeds existed to support — that an overflowing pick is not
 * dropped — is about the BEHAVIOUR, not about any particular seed, so the test
 * finds its own fixtures instead of asserting the book never changes.
 */
function overflowingSeeds(count: number): number[] {
  const found: number[] = [];
  for (let seed = 0; seed < 5000 && found.length < count; seed += 1) {
    const picks = largestDraftPicksFor(seed);
    const total = DRAFT_SET_KEYS.map((k) => picks[k])
      .filter((id): id is string => id != null)
      .reduce((sum, id) => sum + (skillBook[id]?.size ?? 1), 0);
    if (total > 10) found.push(seed);
  }
  if (found.length < count) {
    throw new Error(`only ${found.length} overflowing seeds found; the card book may no longer contain enough large cards`);
  }
  return found;
}

/** Every owned skillId across both the board and the bag, after
 * `applyDraftPicks` — the invariant helper: this must always equal the set of
 * picks the player actually made (board OR bag, never neither). */
function ownedSkillIds(): string[] {
  return [
    ...demoState.pieces.map((p) => p.skillId),
    ...demoState.bagSlots.filter((c): c is NonNullable<typeof c> => c != null).map((c) => c.skillId),
  ];
}

describe('game/draftActions: applyDraftPicks', () => {
  it('the historical bug: a pick that overflows the board lands in the bag, not dropped', () => {
    // Reproduces the proven failure: offense(3) + defense(3) + support(2) +
    // wildcard(3) = 11 > SLOTS(10). Cursor reaches 8 after the first three
    // picks; the wildcard needs 3 more — before the fix, the `continue`
    // silently dropped it (board ends with 3 cards, bag all null, no error).
    const picks = largestDraftPicksFor(overflowingSeeds(1)[0]!);
    const pickedIds = DRAFT_SET_KEYS.map((key) => picks[key]).filter((id): id is string => id != null);
    const totalSize = pickedIds.reduce((sum, id) => sum + (skillBook[id]?.size ?? 1), 0);
    expect(totalSize).toBeGreaterThan(10); // the searched seed genuinely overflows

    applyDraftPicks(picks);

    // Every picked card is owned somewhere — board or bag — none dropped.
    expect(ownedSkillIds().sort()).toEqual([...pickedIds].sort());
    // The overflowing card specifically landed in the bag, not nowhere.
    expect(demoState.bagSlots.some((c) => c != null)).toBe(true);
    expect(demoState.pieces.length).toBeLessThan(pickedIds.length);
  });

  it('a pick that overflows the board (largest-card policy) lands in the bag instead of being dropped, across several seeds', () => {
    for (const seed of overflowingSeeds(5)) {
      const picks = largestDraftPicksFor(seed);
      const pickedIds = DRAFT_SET_KEYS.map((key) => picks[key]).filter((id): id is string => id != null);
      const totalSize = pickedIds.reduce((sum, id) => sum + (skillBook[id]?.size ?? 1), 0);
      expect(totalSize).toBeGreaterThan(10); // the searched seed genuinely overflows

      applyDraftPicks(picks);

      expect(ownedSkillIds().sort()).toEqual([...pickedIds].sort());
      expect(demoState.bagSlots.some((c) => c != null)).toBe(true);
      // Nothing on the board overflows past SLOTS.
      for (const piece of demoState.pieces) {
        const size = skillBook[piece.skillId]?.size ?? 1;
        expect(piece.slot + size).toBeLessThanOrEqual(10);
      }
    }
  });

  it('the small-pick path (draftPicksFor: always candidate [0]) is unchanged — all 4 land on the board, none in the bag', () => {
    for (const seed of [1, 2, 3, 7, 42, 999]) {
      const picks = draftPicksFor(seed);
      applyDraftPicks(picks);
      expect(demoState.pieces).toHaveLength(4);
      expect(demoState.bagSlots.every((c) => c == null)).toBe(true);
      const pickedIds = DRAFT_SET_KEYS.map((key) => picks[key]).filter((id): id is string => id != null);
      expect(ownedSkillIds().sort()).toEqual([...pickedIds].sort());
    }
  });

  it('invariant: owned-card count after applyDraftPicks always equals picks made, across many seeds and both pick policies (largest never drops, and never throws)', () => {
    for (let seed = 0; seed < 300; seed++) {
      for (const picksFor of [draftPicksFor, largestDraftPicksFor]) {
        const picks = picksFor(seed);
        const pickedIds = DRAFT_SET_KEYS.map((key) => picks[key]).filter((id): id is string => id != null);
        applyDraftPicks(picks);
        expect(ownedSkillIds()).toHaveLength(pickedIds.length);
        expect(ownedSkillIds().sort()).toEqual([...pickedIds].sort());
      }
    }
  });

  it('zeroes gold and clears any previous bag contents', () => {
    demoState.gold = 42;
    applyDraftPicks(draftPicksFor(7));
    expect(demoState.gold).toBe(0);
  });
});
