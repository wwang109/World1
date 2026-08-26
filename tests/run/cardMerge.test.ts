import { describe, expect, it } from 'vitest';
import { eventCatalog, eventCatalogIds, type EventChoiceDef, type EventDef } from '../../src/data/events';
import { skillBook } from '../../src/data/skills';
import { gemBook } from '../../src/data/gems';
import {
  applyBonusDraftPick, applyGemChoicePick, applyMergeCardsPick, applyUpgradeCardPick,
  EVENT_CHOICE_SIZE, isEventChoiceUsable, MERGE_INPUT_COUNT, resolveEventChoice, rollEventForNode,
} from '../../src/run/events';
import {
  applyDraftResult, availableChoices, chooseNode, createRun, leaveEvent, leaveShop,
  recordBattleResult, rollEncounter, type RunBagSlot, type RunBoardPiece, type RunNode, type RunState,
} from '../../src/run/runState';
import { DRAFT_SET_KEYS, rollStartDraft } from '../../src/run/draft';
import { battleGoldReward } from '../../src/run/shop';
import { cardOfferableAtTier, type SkillTier } from '../../src/engine/types';

/**
 * THE CARD MERGE — three owned cards of ONE tier in, a CHOICE of three cards at
 * tier+1 out (`mergeCards`, `src/data/events.ts` + `src/run/events.ts`).
 *
 * It is the only DESTRUCTIVE card outcome in the event vocabulary, so this file
 * is built around proving a negative: no path consumes the inputs without
 * delivering an output, and no output is a husk or a card stamped at a tier it
 * has no copy at (the `d1ac673` trap). Everything below runs over the REAL
 * resolver and the REAL run layer (map gen, node commit, `rollEventForNode`,
 * `resolveEventChoice`, `applyMergeCardsPick`) — never a reimplementation of the
 * plan — and the last block walks 120 seeds to wave 10, because a suite that
 * never actually FIRED the event would be the failure mode here.
 */

const ALL = Object.values(skillBook);
const BOARD_SLOTS = 10; // HERO_BOARD_SLOTS, via `RUN_BOARD_SLOTS` (runState.ts)
const SIZE1 = ALL.filter((s) => s.size === 1 && cardOfferableAtTier(s, 'bronze')).map((s) => s.id);
const SIZE3 = ALL.filter((s) => s.size === 3 && cardOfferableAtTier(s, 'bronze')).map((s) => s.id);

// ---------------------------------------------------------------------------
// The catalog's merge doors, and a real run parked on a real event node.
// ---------------------------------------------------------------------------

interface Door { eventId: string; choice: EventChoiceDef; event: EventDef }

const DOORS: readonly Door[] = (() => {
  const out: Door[] = [];
  for (let i = 0; i < eventCatalogIds.length; i += 1) {
    const event = eventCatalog[eventCatalogIds[i]!]!;
    for (let j = 0; j < event.choices.length; j += 1) {
      const choice = event.choices[j]!;
      if (choice.outcome.kind === 'mergeCards') out.push({ eventId: event.id, choice, event });
    }
  }
  return out;
})();

function startedRun(seed: number): RunState {
  const draft = rollStartDraft(seed);
  const picks: Record<string, string> = {};
  for (let i = 0; i < DRAFT_SET_KEYS.length; i += 1) {
    const key = DRAFT_SET_KEYS[i]!;
    picks[key] = draft[key][0]!.skillId;
  }
  return applyDraftResult(createRun(seed), picks as never);
}

/** A real run committed to a real event node — what `resolveEventChoice` needs
 * (`currentEventNode`). Which event the node DREW is irrelevant: the resolver
 * takes the event id as an argument, the same way the reward-doors suite pins a
 * specific catalog choice at whatever event node a seed happens to reach. */
function stateAtEventNode(seed: number): RunState {
  let state = startedRun(seed);
  for (let guard = 0; guard < 200; guard += 1) {
    const choices = availableChoices(state);
    if (choices.length === 0) break;
    const eventNode = choices.find((n) => n.kind === 'event');
    if (eventNode) return chooseNode(state, eventNode.id);
    const node = choices[0]!;
    state = chooseNode(state, node.id);
    if (node.kind === 'shop') state = leaveShop(state);
    else state = recordBattleResult(state, { won: true, goldEarned: 1 });
  }
  throw new Error(`no event node reachable for seed ${seed}`);
}

/** `state` with a hand-built board and bag — the only way to reach the Diamond
 * and no-room corners, which no fresh run can be walked into. `instanceId`s
 * follow the run's own `card_NNN` counter so uniqueness assertions stay real. */
function withOwned(
  state: RunState,
  board: readonly { skillId: string; tier: SkillTier; slot: number; gemId?: string }[],
  bag: readonly (null | { skillId: string; tier: SkillTier; at: number })[],
): RunState {
  let n = 100;
  const pieces: RunBoardPiece[] = board.map((b) => ({
    instanceId: `card_${n++}`,
    skillId: b.skillId,
    tier: b.tier,
    slot: b.slot,
    gem: b.gemId ? gemBook[b.gemId]! : null,
  }));
  const bagSlots: RunBagSlot[] = new Array<RunBagSlot>(BOARD_SLOTS).fill(null);
  for (let i = 0; i < bag.length; i += 1) {
    const entry = bag[i];
    if (!entry) continue;
    bagSlots[entry.at] = { instanceId: `card_${n++}`, skillId: entry.skillId, tier: entry.tier };
  }
  return { ...state, pieces, bagSlots, nextCardInstanceId: n };
}

const MERGE_DOOR = { eventId: 'ruined_anvil', choiceId: 'beat_together' } as const;
const mergeChoiceDef = (): EventChoiceDef =>
  eventCatalog[MERGE_DOOR.eventId]!.choices.find((c) => c.id === MERGE_DOOR.choiceId)!;

interface Owned { instanceId: string; skillId: string; tier: SkillTier }
function owned(state: RunState): Owned[] {
  const out: Owned[] = [];
  for (let i = 0; i < state.pieces.length; i += 1) {
    const p = state.pieces[i]!;
    out.push({ instanceId: p.instanceId, skillId: p.skillId, tier: p.tier });
  }
  for (let i = 0; i < state.bagSlots.length; i += 1) {
    const c = state.bagSlots[i];
    if (c) out.push({ instanceId: c.instanceId, skillId: c.skillId, tier: c.tier });
  }
  return out;
}

/** Everything that must still be true of a run's owned collection after ANY
 * merge: unique instances, no card stamped where it has no copy, and both
 * 10-wide strips free of overlaps and overruns (a multi-slot card straddling a
 * gap, or a bag entry orphaned by a partial removal, shows up here). */
function coherenceViolations(state: RunState, label: string): string[] {
  const bad: string[] = [];
  const ids = owned(state).map((o) => o.instanceId);
  if (new Set(ids).size !== ids.length) bad.push(`${label}: duplicate instanceId`);
  for (const card of owned(state)) {
    const def = skillBook[card.skillId];
    if (!def) { bad.push(`${label}: unknown skill "${card.skillId}"`); continue; }
    if (!cardOfferableAtTier(def, card.tier)) bad.push(`${label}: ${card.skillId} stamped ${card.tier}, no copy there`);
  }
  const bagOcc: (string | null)[] = new Array<string | null>(BOARD_SLOTS).fill(null);
  for (let i = 0; i < state.bagSlots.length; i += 1) {
    const card = state.bagSlots[i];
    if (!card) continue;
    const size = Math.max(1, skillBook[card.skillId]?.size ?? 1);
    if (i + size > BOARD_SLOTS) bad.push(`${label}: bag ${card.skillId}@${i} size ${size} overruns the strip`);
    for (let j = i; j < i + size && j < BOARD_SLOTS; j += 1) {
      if (bagOcc[j]) bad.push(`${label}: bag overlap at ${j} (${bagOcc[j]} vs ${card.skillId})`);
      bagOcc[j] = card.skillId;
    }
  }
  const boardOcc: (string | null)[] = new Array<string | null>(BOARD_SLOTS).fill(null);
  for (let i = 0; i < state.pieces.length; i += 1) {
    const p = state.pieces[i]!;
    const size = Math.max(1, skillBook[p.skillId]?.size ?? 1);
    if (p.slot + size > BOARD_SLOTS) bad.push(`${label}: board ${p.skillId}@${p.slot} size ${size} overruns`);
    for (let j = p.slot; j < p.slot + size && j < BOARD_SLOTS; j += 1) {
      if (boardOcc[j]) bad.push(`${label}: board overlap at ${j}`);
      boardOcc[j] = p.skillId;
    }
  }
  return bad;
}

// ===========================================================================
describe('data/events: the merge door says what it costs, and costs nothing else', () => {
  it('the catalog carries exactly 2 mergeCards choices (pinned count — see the events.test.ts lint note)', () => {
    expect(DOORS.length).toBe(2);
    expect(DOORS.map((d) => `${d.eventId}/${d.choice.id}`).sort()).toEqual(
      ['ember_pit/feed_the_coals', 'ruined_anvil/beat_together'],
    );
  });

  it('a merge costs no gold — the three cards ARE the price', () => {
    for (let i = 0; i < DOORS.length; i += 1) expect(DOORS[i]!.choice.cost ?? 0).toBe(0);
  });

  it('and no event became eligible BECAUSE of it — the event draw is untouched by this pass', () => {
    // `hasAffordableChoice` (run/events.ts) offers an event only if some choice
    // is usable AND not `nothing`. Both doors were added to events that ALREADY
    // had a cost-0, non-`nothing`, non-merge choice, so no event's eligibility
    // at any wallet can now depend on whether the player happens to hold a
    // mergeable trio — which is exactly why no seeded event sequence in the
    // suite moved when this pass landed. Delete that sibling and this fails.
    for (let i = 0; i < DOORS.length; i += 1) {
      const door = DOORS[i]!;
      const others = door.event.choices.filter(
        (c) => c.id !== door.choice.id && (c.cost ?? 0) === 0 && c.outcome.kind !== 'nothing' && c.outcome.kind !== 'mergeCards',
      );
      expect(others.length, `${door.eventId} has no gold-free non-merge choice left`).toBeGreaterThan(0);
    }
  });

  it('every merge door still fits the 2-3 choice bound and keeps a cost-0 exit', () => {
    for (let i = 0; i < DOORS.length; i += 1) {
      const event = DOORS[i]!.event;
      expect(event.choices.length).toBeGreaterThanOrEqual(2);
      expect(event.choices.length).toBeLessThanOrEqual(3);
      expect(event.choices.some((c) => (c.cost ?? 0) === 0)).toBe(true);
    }
  });

  it("and the event's body says the trade out loud — three of one grade for one of the next", () => {
    // The honesty rule (src/data/events.ts header): a choice may not imply what
    // its outcome does not do, and the label is 5 words wide. `choiceOutcomeHint`
    // renders nothing for this kind yet (src/game is a later phase), so the BODY
    // is the only place the player can read the ratio.
    for (let i = 0; i < DOORS.length; i += 1) {
      const door = DOORS[i]!;
      expect(door.choice.label.toLowerCase()).toContain('three');
      expect(door.event.body.toLowerCase()).toMatch(/three pieces|three of one grade/);
      expect(door.event.body.toLowerCase()).toContain('grade');
    }
  });
});

// ===========================================================================
describe('run/events: the offer is legible before it is taken', () => {
  it('names the three instances going in, the tier coming back, and three candidates', () => {
    const state = withOwned(stateAtEventNode(3),
      [{ skillId: SIZE1[0]!, tier: 'bronze', slot: 0 }],
      [{ skillId: SIZE1[1]!, tier: 'bronze', at: 1 }, { skillId: SIZE1[2]!, tier: 'bronze', at: 2 }],
    );
    const { merge, outcome, state: after } = resolveEventChoice(state, MERGE_DOOR.eventId, MERGE_DOOR.choiceId);
    expect(merge, 'no merge offer came back').toBeDefined();
    expect(merge!.from).toBe('bronze');
    expect(merge!.to).toBe('silver');
    expect(merge!.consumed).toHaveLength(MERGE_INPUT_COUNT);
    expect(merge!.candidates).toHaveLength(EVENT_CHOICE_SIZE);
    // The three named instances are really owned, really that tier, really
    // addressable — a display that shows them cannot be showing phantoms.
    const ownedIds = owned(state).map((o) => o.instanceId);
    for (let i = 0; i < merge!.consumed.length; i += 1) {
      const input = merge!.consumed[i]!;
      expect(ownedIds).toContain(input.instanceId);
      expect(input.tier).toBe('bronze');
      const at = input.location === 'board' ? state.pieces[input.index] : state.bagSlots[input.index];
      expect(at?.instanceId, 'consumed card is not at the index the offer gives').toBe(input.instanceId);
    }
    expect(new Set(merge!.consumed.map((c) => c.instanceId)).size).toBe(MERGE_INPUT_COUNT);
    // AND NOTHING HAS HAPPENED YET: the offer is a question, not a change.
    expect(outcome.kind).toBe('nothing');
    expect(owned(after)).toEqual(owned(state));
    expect(after.gold).toBe(state.gold);
  });

  it('the bag pays before the board — an equipped card is consumed only when the spares run out', () => {
    // The inverse of `upgradeCardOptions`'s board-first order, deliberately:
    // that outcome IMPROVES what it touches, this one DESTROYS it.
    const base = stateAtEventNode(3);
    const bagHeavy = withOwned(base,
      [{ skillId: SIZE1[0]!, tier: 'bronze', slot: 0 }],
      [
        { skillId: SIZE1[1]!, tier: 'bronze', at: 0 },
        { skillId: SIZE1[2]!, tier: 'bronze', at: 1 },
        { skillId: SIZE1[3]!, tier: 'bronze', at: 2 },
      ],
    );
    const offer = resolveEventChoice(bagHeavy, MERGE_DOOR.eventId, MERGE_DOOR.choiceId).merge!;
    expect(offer.consumed.every((c) => c.location === 'bag')).toBe(true);
    const spared = bagHeavy.pieces[0]!.instanceId;
    expect(offer.consumed.map((c) => c.instanceId), 'the equipped board piece was taken anyway').not.toContain(spared);
    // ...and it survives the merge itself, not just the offer.
    const kept = applyMergeCardsPick(bagHeavy, offer.candidates[0]!.skillId).state;
    expect(owned(kept).map((o) => o.instanceId)).toContain(spared);

    // Only one spare in the bag: the board has to cover the other two, and it
    // does so in ascending `slot` order (what the player sees), not array order.
    const boardHeavy = withOwned(base,
      [
        { skillId: SIZE1[0]!, tier: 'bronze', slot: 5 },
        { skillId: SIZE1[1]!, tier: 'bronze', slot: 1 },
        { skillId: SIZE1[2]!, tier: 'bronze', slot: 3 },
      ],
      [{ skillId: SIZE1[3]!, tier: 'bronze', at: 7 }],
    );
    const mixed = resolveEventChoice(boardHeavy, MERGE_DOOR.eventId, MERGE_DOOR.choiceId).merge!;
    expect(mixed.consumed[0]!.location).toBe('bag');
    expect(mixed.consumed[1]!.location).toBe('board');
    expect(boardHeavy.pieces[mixed.consumed[1]!.index]!.slot).toBe(1);
    expect(boardHeavy.pieces[mixed.consumed[2]!.index]!.slot).toBe(3);
  });

  it('every candidate is a card that really exists at tier+1 — no husk, no phantom tier', () => {
    // The `d1ac673` trap, closed by construction: the pool is
    // `cardOfferableAtTier` (engine/types.ts) at the OUTPUT tier, not a fourth
    // predicate written here.
    let checked = 0;
    for (const seed of [1, 3, 7, 12, 21]) {
      const state = withOwned(stateAtEventNode(seed),
        [], [
          { skillId: SIZE1[0]!, tier: 'silver', at: 0 },
          { skillId: SIZE1[1]!, tier: 'silver', at: 1 },
          { skillId: SIZE1[2]!, tier: 'silver', at: 2 },
        ]);
      const offer = resolveEventChoice(state, MERGE_DOOR.eventId, MERGE_DOOR.choiceId).merge!;
      expect(offer.from).toBe('silver');
      expect(offer.to).toBe('gold');
      for (let i = 0; i < offer.candidates.length; i += 1) {
        const cand = offer.candidates[i]!;
        expect(cand.tier).toBe('gold');
        expect(cardOfferableAtTier(skillBook[cand.skillId]!, 'gold'), `${cand.skillId} not offerable at gold`).toBe(true);
        checked += 1;
      }
      expect(new Set(offer.candidates.map((c) => c.skillId)).size).toBe(offer.candidates.length);
    }
    expect(checked, 'no candidate was inspected').toBeGreaterThanOrEqual(5 * EVENT_CHOICE_SIZE);
  });

  it('the same seed twice is the same offer, down to the candidate order', () => {
    for (const seed of [2, 9, 40]) {
      const a = stateAtEventNode(seed);
      const b = stateAtEventNode(seed);
      const mkA = withOwned(a, [], [
        { skillId: SIZE1[0]!, tier: 'bronze', at: 0 },
        { skillId: SIZE1[1]!, tier: 'bronze', at: 1 },
        { skillId: SIZE1[2]!, tier: 'bronze', at: 2 },
      ]);
      const mkB = withOwned(b, [], [
        { skillId: SIZE1[0]!, tier: 'bronze', at: 0 },
        { skillId: SIZE1[1]!, tier: 'bronze', at: 1 },
        { skillId: SIZE1[2]!, tier: 'bronze', at: 2 },
      ]);
      const one = resolveEventChoice(mkA, MERGE_DOOR.eventId, MERGE_DOOR.choiceId);
      const two = resolveEventChoice(mkB, MERGE_DOOR.eventId, MERGE_DOOR.choiceId);
      expect(two.merge).toEqual(one.merge);
      // and the SECOND door draws its own candidates (own choice id -> own Rng),
      // so the two rungs are not the same three cards under different labels.
      const other = resolveEventChoice(mkA, 'ember_pit', 'feed_the_coals');
      expect(other.merge!.consumed).toEqual(one.merge!.consumed);
      expect(other.merge!.candidates).not.toEqual(one.merge!.candidates);
    }
  });
});

// ===========================================================================
describe('run/events: applying it is destructive, atomic, and leaves the strips coherent', () => {
  it('three go, one arrives, board and bag stay intact', () => {
    const before = withOwned(stateAtEventNode(5),
      [
        { skillId: SIZE3[0]!, tier: 'bronze', slot: 0 },
        { skillId: SIZE1[0]!, tier: 'bronze', slot: 3 },
      ],
      [
        { skillId: SIZE1[1]!, tier: 'bronze', at: 0 },
        { skillId: SIZE3[1]!, tier: 'silver', at: 4 },
      ],
    );
    const offer = resolveEventChoice(before, MERGE_DOOR.eventId, MERGE_DOOR.choiceId).merge!;
    const pick = offer.candidates[1]!;
    const { state: after, outcome, merged } = applyMergeCardsPick(before, pick.skillId);

    expect(outcome.kind).toBe('grantCard');
    expect(outcome.kind === 'grantCard' && outcome.tier).toBe('silver');
    expect(outcome.kind === 'grantCard' && outcome.skillId).toBe(pick.skillId);
    expect(merged!.consumed).toEqual(offer.consumed);
    expect(merged!.from).toBe('bronze');
    expect(merged!.to).toBe('silver');
    // The receipt names the ONE card that arrived, not the set it came from.
    expect(merged!.taken).toEqual({ skillId: pick.skillId, tier: 'silver' });

    // The count moved by exactly -3 +1, and the three named instances are gone.
    expect(owned(after)).toHaveLength(owned(before).length - MERGE_INPUT_COUNT + 1);
    const afterIds = owned(after).map((o) => o.instanceId);
    for (let i = 0; i < offer.consumed.length; i += 1) expect(afterIds).not.toContain(offer.consumed[i]!.instanceId);
    // The untouched silver spare is still exactly where it was.
    expect(after.bagSlots[4]?.instanceId).toBe(before.bagSlots[4]!.instanceId);
    // The output really is owned, really at tier+1.
    const arrival = owned(after).filter((o) => !owned(before).some((b) => b.instanceId === o.instanceId));
    expect(arrival).toHaveLength(1);
    expect(arrival[0]!.skillId).toBe(pick.skillId);
    expect(arrival[0]!.tier).toBe('silver');
    expect(coherenceViolations(after, 'post-merge')).toEqual([]);
  });

  it('a socketed gem comes back to the pouch instead of dying with its card', () => {
    // The same rule `sellRunCard` (runState.ts) applies to a sold board piece: a
    // merge must not be a quieter way to lose a gem than selling one.
    const gemId = Object.keys(gemBook)[0]!;
    const before = withOwned(stateAtEventNode(5),
      [
        { skillId: SIZE1[0]!, tier: 'gold', slot: 0, gemId },
        { skillId: SIZE1[1]!, tier: 'gold', slot: 1 },
        { skillId: SIZE1[2]!, tier: 'gold', slot: 2 },
      ], []);
    const pouchBefore = before.gemInventory.length;
    const offer = resolveEventChoice(before, MERGE_DOOR.eventId, MERGE_DOOR.choiceId).merge!;
    expect(offer.to).toBe('diamond');
    const { state: after } = applyMergeCardsPick(before, offer.candidates[0]!.skillId);
    expect(after.gemInventory).toHaveLength(pouchBefore + 1);
    expect(after.gemInventory[after.gemInventory.length - 1]).toBe(gemId);
    expect(coherenceViolations(after, 'gem return')).toEqual([]);
  });

  it('the output can take the exact slots the inputs vacated — a size-3 card lands in a bag that was full', () => {
    // Removal happens BEFORE the insert, which is what makes "3 in, 1 out" true
    // of the strip and not just of the count.
    const before = withOwned(stateAtEventNode(8), [], [
      { skillId: SIZE1[0]!, tier: 'bronze', at: 0 },
      { skillId: SIZE1[1]!, tier: 'bronze', at: 1 },
      { skillId: SIZE1[2]!, tier: 'bronze', at: 2 },
      { skillId: SIZE3[0]!, tier: 'diamond', at: 3 },
      { skillId: SIZE3[1]!, tier: 'diamond', at: 6 },
      { skillId: SIZE1[3]!, tier: 'diamond', at: 9 },
    ]);
    // The bag is FULL (3 + 3 + 3 + 1 = 10) and the only trio is the bronze one.
    const offer = resolveEventChoice(before, MERGE_DOOR.eventId, MERGE_DOOR.choiceId).merge!;
    const big = offer.candidates.find((c) => skillBook[c.skillId]!.size === 3);
    const pick = big ?? offer.candidates[0]!;
    const { state: after, outcome } = applyMergeCardsPick(before, pick.skillId);
    expect(outcome.kind).toBe('grantCard');
    expect(coherenceViolations(after, 'reuse of vacated slots')).toEqual([]);
    expect(owned(after)).toHaveLength(owned(before).length - MERGE_INPUT_COUNT + 1);
  });
});

// ===========================================================================
describe('run/events: the trade is never offered when it cannot be honoured', () => {
  const choice = mergeChoiceDef();

  it('fewer than three of a tier: the rung is dark and the resolver refuses', () => {
    const twoOnly = withOwned(stateAtEventNode(3), [{ skillId: SIZE1[0]!, tier: 'bronze', slot: 0 }],
      [{ skillId: SIZE1[1]!, tier: 'silver', at: 1 }, { skillId: SIZE1[2]!, tier: 'gold', at: 2 }]);
    expect(isEventChoiceUsable(twoOnly, choice)).toBe(false);
    expect(() => resolveEventChoice(twoOnly, MERGE_DOOR.eventId, MERGE_DOOR.choiceId)).toThrow(/mergeCards/);
    // And the event itself is still offered — the merge is never an event's only
    // reason to exist, so a dark rung does not delete a stop from the map.
    const others = eventCatalog[MERGE_DOOR.eventId]!.choices.filter(
      (c) => isEventChoiceUsable(twoOnly, c) && c.outcome.kind !== 'nothing',
    );
    expect(others.length).toBeGreaterThan(0);
  });

  it('an empty collection is dark too (nothing owned at all)', () => {
    const bare = withOwned(stateAtEventNode(3), [], []);
    expect(isEventChoiceUsable(bare, choice)).toBe(false);
  });

  it('THREE DIAMONDS ARE NOT AN INPUT — the top of the ladder has no tier+1', () => {
    const diamonds = withOwned(stateAtEventNode(3), [], [
      { skillId: SIZE1[0]!, tier: 'diamond', at: 0 },
      { skillId: SIZE1[1]!, tier: 'diamond', at: 1 },
      { skillId: SIZE1[2]!, tier: 'diamond', at: 2 },
    ]);
    expect(isEventChoiceUsable(diamonds, choice)).toBe(false);
    expect(() => resolveEventChoice(diamonds, MERGE_DOOR.eventId, MERGE_DOOR.choiceId)).toThrow(/mergeCards/);
    // The Diamonds are not "spent for nothing" by some fallback either.
    expect(owned(applyMergeCardsPick(diamonds, SIZE1[4]!).state)).toEqual(owned(diamonds));
  });

  it('and a Diamond trio never masks a lower trio — the merge takes the bronze and leaves the diamonds alone', () => {
    const mixed = withOwned(stateAtEventNode(3), [], [
      { skillId: SIZE1[0]!, tier: 'diamond', at: 0 },
      { skillId: SIZE1[1]!, tier: 'diamond', at: 1 },
      { skillId: SIZE1[2]!, tier: 'diamond', at: 2 },
      { skillId: SIZE1[3]!, tier: 'bronze', at: 3 },
      { skillId: SIZE1[4]!, tier: 'bronze', at: 4 },
      { skillId: SIZE1[5]!, tier: 'bronze', at: 5 },
    ]);
    expect(isEventChoiceUsable(mixed, choice)).toBe(true);
    const offer = resolveEventChoice(mixed, MERGE_DOOR.eventId, MERGE_DOOR.choiceId).merge!;
    expect(offer.from).toBe('bronze');
    expect(offer.consumed.every((c) => c.tier === 'bronze')).toBe(true);
    const after = applyMergeCardsPick(mixed, offer.candidates[0]!.skillId).state;
    const diamondsLeft = owned(after).filter((o) => o.tier === 'diamond');
    expect(diamondsLeft).toHaveLength(3);
  });

  it('NO ROOM FOR THE OUTPUT: the rung is dark, and not one input is consumed', () => {
    // Bag full to all ten slots with cards no tier of which forms a trio, and
    // the only trio is on the BOARD — so the removal frees board slots the bag
    // insert cannot use, and nothing at tier+1 fits. The honest answer is to
    // never make the offer.
    const noRoom = withOwned(stateAtEventNode(3),
      [
        { skillId: SIZE1[0]!, tier: 'bronze', slot: 0 },
        { skillId: SIZE1[1]!, tier: 'bronze', slot: 1 },
        { skillId: SIZE1[2]!, tier: 'bronze', slot: 2 },
      ],
      [
        { skillId: SIZE3[0]!, tier: 'silver', at: 0 },
        { skillId: SIZE3[1]!, tier: 'gold', at: 3 },
        { skillId: SIZE3[2]!, tier: 'diamond', at: 6 },
        { skillId: SIZE1[3]!, tier: 'diamond', at: 9 },
      ]);
    expect(isEventChoiceUsable(noRoom, choice)).toBe(false);
    expect(() => resolveEventChoice(noRoom, MERGE_DOOR.eventId, MERGE_DOOR.choiceId)).toThrow(/mergeCards/);
    const attempted = applyMergeCardsPick(noRoom, SIZE1[4]!);
    expect(owned(attempted.state), 'inputs were consumed with no output to show').toEqual(owned(noRoom));
    expect(attempted.outcome.kind).toBe('grantGold');
    expect(attempted.outcome.kind === 'grantGold' && attempted.outcome.fellBack).toBe(true);

    // One free slot is all it takes for the same collection to be mergeable —
    // proof the gate is reading ROOM, not something else about this state.
    const oneFree: RunState = { ...noRoom, bagSlots: noRoom.bagSlots.map((c, i) => (i === 9 ? null : c)) };
    expect(isEventChoiceUsable(oneFree, choice)).toBe(true);
  });

  it('a pick that was never deliverable consumes nothing and pays the fallback coin', () => {
    const state = withOwned(stateAtEventNode(3), [], [
      { skillId: SIZE1[0]!, tier: 'bronze', at: 0 },
      { skillId: SIZE1[1]!, tier: 'bronze', at: 1 },
      { skillId: SIZE1[2]!, tier: 'bronze', at: 2 },
    ]);
    const bogus = applyMergeCardsPick(state, '__not_a_card__');
    expect(owned(bogus.state)).toEqual(owned(state));
    expect(bogus.outcome.kind).toBe('grantGold');
    expect(bogus.state.gold).toBe(state.gold + 2);
    expect(bogus.merged).toBeUndefined();
  });
});

// ===========================================================================
// THE PAYOFF. Everything above is a property of one hand-built state; this is
// the mechanic walked over the real run layer, and the block that fails if the
// event never actually fires.
// ===========================================================================
describe('the merge event fires in real runs, and concentrates a collection when it does', () => {
  const SEEDS = 120;
  const THROUGH_WAVE = 10;

  interface Walk {
    merges: number; fallbacks: number; sawDoor: boolean; usable: boolean; dark: boolean;
    events: number; fights: number; wave: number;
    tiers: Record<string, number>; cards: number; violations: string[];
  }

  /** One run walked to wave `THROUGH_WAVE`, preferring event nodes (this
   * measures event SUPPLY, the same posture `eventRewardDoors.test.ts` takes).
   * `takeMerge` picks the merge rung wherever it is usable; the control policy
   * refuses it and takes the event's other rung instead, so the two differ ONLY
   * in whether merges happen. */
  function walk(seed: number, takeMerge: boolean): Walk {
    const out: Walk = {
      merges: 0, fallbacks: 0, sawDoor: false, usable: false, dark: false,
      events: 0, fights: 0, wave: 0, tiers: {}, cards: 0, violations: [],
    };
    let state = startedRun(seed);
    for (let step = 0; step < 400; step += 1) {
      const choices = availableChoices(state);
      if (choices.length === 0) break;
      out.wave = choices[0]!.wave;
      if (out.wave > THROUGH_WAVE) break;
      const node: RunNode = choices.find((n) => n.kind === 'event')
        ?? choices.find((n) => n.fightOption === 'standard') ?? choices[0]!;
      state = chooseNode(state, node.id);
      if (node.kind === 'shop') { state = leaveShop(state); continue; }
      if (node.kind === 'event') {
        const rolled = rollEventForNode(state, node);
        state = rolled.state;
        const merge = rolled.event.choices.find((c) => c.outcome.kind === 'mergeCards');
        if (merge) {
          out.sawDoor = true;
          if (isEventChoiceUsable(state, merge)) out.usable = true;
          else out.dark = true;
        }
        const pick = (takeMerge && merge && isEventChoiceUsable(state, merge))
          ? merge
          : rolled.event.choices.find((c) => isEventChoiceUsable(state, c)
            && c.outcome.kind !== 'nothing' && c.outcome.kind !== 'mergeCards');
        if (pick) {
          out.events += 1;
          const beforeCount = owned(state).length;
          const res = resolveEventChoice(state, rolled.event.id, pick.id);
          state = res.state;
          if (res.merge) {
            const applied = applyMergeCardsPick(state, res.merge.candidates[0]!.skillId);
            state = applied.state;
            if (applied.outcome.kind === 'grantGold' && applied.outcome.fellBack) out.fallbacks += 1;
            else {
              out.merges += 1;
              if (owned(state).length !== beforeCount - MERGE_INPUT_COUNT + 1) {
                out.violations.push(`seed ${seed}: owned ${beforeCount} -> ${owned(state).length}`);
              }
            }
            for (const v of coherenceViolations(state, `seed ${seed} post-merge`)) out.violations.push(v);
          } else if (res.outcome.kind === 'bonusDraft') {
            state = applyBonusDraftPick(state, res.outcome.cards[0]!).state;
          } else if (res.outcome.kind === 'gemChoicePick') {
            state = applyGemChoicePick(state, res.outcome.options[0]!).state;
          } else if (res.outcome.kind === 'upgradeCardPick') {
            state = applyUpgradeCardPick(state, res.outcome.options[0]!.instanceId).state;
          }
        }
        state = leaveEvent(state);
        continue;
      }
      const pack = rollEncounter(state);
      const reward = battleGoldReward(
        pack.units.map((u) => ({ level: u.level, title: u.title, rank: u.rank, modifiers: u.modifiers })),
        state.heroLevel,
      );
      state = recordBattleResult(state, { won: true, goldEarned: reward.base + reward.winBonus });
      out.fights += 1;
      if (state.status !== 'active') break;
    }
    for (const card of owned(state)) {
      out.tiers[card.tier] = (out.tiers[card.tier] ?? 0) + 1;
      out.cards += 1;
    }
    for (const v of coherenceViolations(state, `seed ${seed} final`)) out.violations.push(v);
    return out;
  }

  function sweep(takeMerge: boolean) {
    const rows: Walk[] = [];
    for (let seed = 1; seed <= SEEDS; seed += 1) rows.push(walk(seed, takeMerge));
    const sum = (f: (w: Walk) => number): number => {
      let n = 0;
      for (let i = 0; i < rows.length; i += 1) n += f(rows[i]!);
      return n;
    };
    const violations: string[] = [];
    for (let i = 0; i < rows.length; i += 1) for (const v of rows[i]!.violations) violations.push(v);
    return {
      merges: sum((w) => w.merges),
      fallbacks: sum((w) => w.fallbacks),
      sawDoor: sum((w) => (w.sawDoor ? 1 : 0)),
      usable: sum((w) => (w.usable ? 1 : 0)),
      dark: sum((w) => (w.dark ? 1 : 0)),
      events: sum((w) => w.events),
      fights: sum((w) => w.fights),
      deepest: Math.max(...rows.map((w) => w.wave)),
      cards: sum((w) => w.cards),
      bronze: sum((w) => w.tiers.bronze ?? 0),
      silver: sum((w) => w.tiers.silver ?? 0),
      gold: sum((w) => w.tiers.gold ?? 0),
      violations,
    };
  }

  const MERGING = sweep(true);
  const CONTROL = sweep(false);

  it('the walk actually walked, and the event actually fired', () => {
    // NON-VACUITY, first: a green suite that never resolved a merge is the
    // failure mode this whole file exists to rule out.
    expect(MERGING.deepest, 'never reached the wave the measurement is about').toBeGreaterThanOrEqual(THROUGH_WAVE);
    expect(MERGING.fights, 'no fight resolved, so no run economy was exercised').toBeGreaterThan(SEEDS);
    expect(MERGING.events, 'no event choice was resolved').toBeGreaterThan(2 * SEEDS);
    expect(MERGING.merges, 'THE EVENT NEVER FIRED — nothing below measures anything').toBeGreaterThan(SEEDS);
    expect(CONTROL.merges, 'the control policy merged anyway').toBe(0);
  });

  it('a run can actually USE it: most runs meet a usable merge door by wave 10', () => {
    // Measured at 120 seeds when this landed: 83.3% of runs met a merge door and
    // ALL of those could use it (100/120), against 64.2% with a single door —
    // which is why there are two (see `ember_pit`'s comment in data/events.ts).
    // A mechanic a third of runs never see is a mechanic that was not built.
    expect(MERGING.sawDoor * 2, `${MERGING.sawDoor}/${SEEDS} runs met a merge door`).toBeGreaterThan(SEEDS);
    expect(MERGING.usable * 2, `${MERGING.usable}/${SEEDS} runs could use one`).toBeGreaterThan(SEEDS);
    // ...and it is not free money either: the gate really does go dark in real
    // runs once a run has spent its spares.
    expect(MERGING.dark, 'the eligibility gate never fired in a real run').toBeGreaterThan(0);
  });

  it('and it is not so common that every run drowns in it', () => {
    // The other side of tuning: at 1.32 merges/run a run does not turn into a
    // merge conveyor. Ceiling of 4 per run on average is enormous slack — this
    // is a regression bound on the door COUNT, not a tight target.
    expect(MERGING.merges).toBeLessThan(4 * SEEDS);
  });

  it('taking merges CONCENTRATES the collection: fewer cards, more of them above Bronze', () => {
    // The tier distribution at wave 10 is the whole economic point. Measured at
    // 120 seeds when this landed:
    //   merging   8.72 cards/run — 5.49 bronze, 2.66 silver, 0.53 gold
    //   control  11.11 cards/run — 9.21 bronze, 1.38 silver, 0.48 gold
    // i.e. ~2.4 cards of raw count traded for ~1.3 extra Silvers. If this
    // inverts, the merge has stopped being a trade and become a tax.
    expect(MERGING.cards, 'merging did not reduce the card count').toBeLessThan(CONTROL.cards);
    expect(MERGING.silver, 'merging produced no more Silver than not merging').toBeGreaterThan(CONTROL.silver);
    expect(MERGING.bronze, 'merging did not consume Bronze').toBeLessThan(CONTROL.bronze);
    // The output tier is never below the input tier, so no run can end up with
    // FEWER above-bronze cards for having merged.
    expect(MERGING.silver + MERGING.gold).toBeGreaterThan(CONTROL.silver + CONTROL.gold);
  });

  it('and no value leaked anywhere along the way', () => {
    // Every merge in both sweeps: -3 +1 exactly, strips coherent, and never a
    // fallback (the pool is pre-filtered by fit, so a delivered offer cannot
    // fail to deliver).
    expect(MERGING.violations, MERGING.violations.slice(0, 5).join('; ')).toEqual([]);
    expect(CONTROL.violations, CONTROL.violations.slice(0, 5).join('; ')).toEqual([]);
    expect(MERGING.fallbacks, 'an offered merge failed to deliver its output').toBe(0);
  });
});
