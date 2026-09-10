import { describe, expect, it } from 'vitest';
import { eventCatalog, eventCatalogIds, type EventChoiceDef, type EventDef } from '../../src/data/events';
import { skillBook } from '../../src/data/skills';
import {
  choiceLockReason, eventSelectionIdsForCatalog, isEventChoiceUsable, rollEventForNode,
  type EventSelectionContent,
} from '../../src/run/events';
import {
  applyDraftResult, availableChoices, chooseNode, createRun, leaveShop,
  recordBattleResult, runBagHasRoomFor, type RunBagSlot, type RunNode, type RunState,
} from '../../src/run/runState';
import { DRAFT_SET_KEYS, rollStartDraft } from '../../src/run/draft';
import { cardOfferableAtTier } from '../../src/engine/types';
import { resolveExactEventChoice } from '../fixtures/eventResolution';

/**
 * CRITICAL fix (2026-09-06): a paid card rung used to deduct its cost, THEN
 * discover the bag had no room and swap the whole outcome for
 * `CARD_FALLBACK_GOLD` (2 gold) — a rung the player could never benefit from,
 * offered at full price with no warning. `choiceLockReason`/
 * `isEventChoiceUsable` now gate `grantCard`/`cardChoice`/`bonusDraft` on bag
 * room and `upgradeCard` on "is anything owned eligible", BEFORE the cost is
 * ever charged (`src/run/events.ts`'s `cardOutcomeCanDeliver`).
 *
 * `wandering_smith` is the exact event named in the bug report: `commission`
 * is a 4-gold NAMED `grantCard` (`cardId: 'armor_break'`, no `Rng` draw at
 * all — the worst-case pool is a single known card), `pike_blanks` is a
 * 2-gold FILTERED `bonusDraft` (lance weapons only, `Rng`-drawn) — the two
 * different shapes `cardOutcomeCanDeliver` has to cover.
 */

const ALL = Object.values(skillBook);
const BAG_SLOTS = 10; // RUN_BOARD_SLOTS
const SIZE1_BRONZE = ALL.filter((s) => s.size === 1 && cardOfferableAtTier(s, 'bronze')).map((s) => s.id);
if (SIZE1_BRONZE.length < BAG_SLOTS) throw new Error('fixture needs at least 10 distinct size-1 Bronze-offerable skills');

const WANDERING_SMITH = eventCatalog.wandering_smith!;
const commission = WANDERING_SMITH.choices.find((c) => c.id === 'commission')!;
const pikeBlanks = WANDERING_SMITH.choices.find((c) => c.id === 'pike_blanks')!;
const decline = WANDERING_SMITH.choices.find((c) => c.id === 'decline')!;

const frozenLookup = (eventId: string, contentVersion: number): EventDef | undefined => (
  contentVersion === 1 ? eventCatalog[eventId] : undefined
);
const frozenContent: EventSelectionContent<EventDef> = {
  catalog: eventCatalog,
  orderedIds: eventSelectionIdsForCatalog(eventCatalogIds),
  currentVersionOf: () => 1,
};

function startedRun(seed: number): RunState {
  const draft = rollStartDraft(seed);
  const picks: Record<string, string> = {};
  for (let i = 0; i < DRAFT_SET_KEYS.length; i += 1) {
    const key = DRAFT_SET_KEYS[i]!;
    picks[key] = draft[key][0]!.skillId;
  }
  return applyDraftResult(createRun(seed), picks as never);
}

/** A real run walked onto a real event node — `resolveExactEventChoice`'s
 * precondition — same idiom `cardMerge.test.ts` uses. Which event the node
 * actually DREW is irrelevant: the fixture force-resolves whatever catalog
 * event/choice the test asks for. */
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

/** Every bag slot occupied by a distinct size-1 Bronze card — a genuinely
 * full bag, not a partially-empty one. `pieces` is cleared so nothing on the
 * board can be mistaken for spare room (bag room is what `runBagHasRoomFor`
 * reads; the board never enters that check, see its doc comment). */
function fullBagState(state: RunState): RunState {
  const bagSlots: RunBagSlot[] = SIZE1_BRONZE.slice(0, BAG_SLOTS).map((skillId, i) => (
    { instanceId: `full_${String(i)}`, skillId, tier: 'bronze' as const }
  ));
  return { ...state, pieces: [], bagSlots, gold: 20 };
}

/** The exact same full bag, minus one slot — proves the gate reads ROOM, not
 * some other property of the state (the mirror of `cardMerge.test.ts`'s own
 * "one free slot is all it takes" check for the merge gate). */
function oneFreeSlotState(state: RunState): RunState {
  const full = fullBagState(state);
  return { ...full, bagSlots: full.bagSlots.map((c, i) => (i === BAG_SLOTS - 1 ? null : c)) };
}

describe('run/events: a paid card rung cannot charge for a card the bag cannot hold (2026-09-06)', () => {
  it('LOCKS the named-card grantCard rung ("commission") when the bag is genuinely full', () => {
    const state = fullBagState(stateAtEventNode(3));
    expect(runBagHasRoomFor(state, 'armor_break'), 'fixture sanity: the bag really is full').toBe(false);
    expect(choiceLockReason(state, commission)).toBe('no room in your bag');
    expect(isEventChoiceUsable(state, commission)).toBe(false);
  });

  it('does NOT lock the same rung the moment there is room — the gate is not over-broad', () => {
    const state = oneFreeSlotState(stateAtEventNode(3));
    expect(runBagHasRoomFor(state, 'armor_break'), 'fixture sanity: one slot is free').toBe(true);
    expect(choiceLockReason(state, commission)).toBeNull();
    expect(isEventChoiceUsable(state, commission)).toBe(true);
  });

  it('a FILTERED bonusDraft rung ("pike_blanks") is locked the same way — worst-case over the whole pool, not one skillId', () => {
    const full = fullBagState(stateAtEventNode(5));
    expect(choiceLockReason(full, pikeBlanks)).toBe('no room in your bag');
    expect(isEventChoiceUsable(full, pikeBlanks)).toBe(false);
    const roomy = oneFreeSlotState(stateAtEventNode(5));
    expect(choiceLockReason(roomy, pikeBlanks)).toBeNull();
    expect(isEventChoiceUsable(roomy, pikeBlanks)).toBe(true);
  });

  it('a full bag leaves only the safe cost-0 exit usable — the event itself still appears (both paid rungs go dark together)', () => {
    const state = fullBagState(stateAtEventNode(7));
    const usableNonNothing = WANDERING_SMITH.choices.filter((c) => (
      isEventChoiceUsable(state, c) && c.outcome.kind !== 'nothing'
    ));
    expect(usableNonNothing).toEqual([]);
    expect(isEventChoiceUsable(state, decline)).toBe(true);
  });

  it('never actually reaches the fallback in a real walk: rollEventForNode never offers a full-bag player a rung it cannot pay off', () => {
    // A broader, real-catalog proof (not just the one hand-picked event):
    // every event `rollEventForNode` can hand a full-bag, well-funded player
    // still carries a genuinely usable, non-`nothing` choice.
    let hit = 0;
    for (let seed = 1; seed <= 60; seed += 1) {
      const state = fullBagState({ ...stateAtEventNode(seed), gold: 999 });
      const node: RunNode | undefined = state.currentNodeId
        ? (function find(): RunNode | undefined {
          for (const column of state.map.depths) {
            const found = column.find((n) => n.id === state.currentNodeId);
            if (found) return found;
          }
          return undefined;
        })()
        : undefined;
      if (!node) continue;
      const { event } = rollEventForNode(state, node, frozenLookup, frozenContent);
      hit += 1;
      const usable = event.choices.filter((c) => isEventChoiceUsable(state, c) && c.outcome.kind !== 'nothing');
      expect(usable.length, `${event.id} left nothing usable for a full-bag, well-funded player`).toBeGreaterThan(0);
    }
    expect(hit, 'no event was actually rolled — the sweep measured nothing').toBeGreaterThan(30);
  });

  it("upgradeCard's OTHER precondition (nothing owned is eligible) locks the same way, without touching bag room at all", () => {
    const retiringSmith = eventCatalog.retiring_smith!;
    const upgradeChoice = retiringSmith.choices.find((c) => c.id === 'commission')!;
    expect(upgradeChoice.outcome.kind).toBe('upgradeCard');
    // Every owned card already Diamond (an empty bag would ALSO have nothing
    // eligible, but Diamond-only proves this is an ELIGIBILITY read, not a
    // room read masquerading as one).
    const allDiamond: RunState = {
      ...stateAtEventNode(9),
      gold: 20,
      pieces: [{ instanceId: 'd0', skillId: SIZE1_BRONZE[0]!, tier: 'diamond', slot: 0 }],
      bagSlots: [],
    };
    expect(choiceLockReason(allDiamond, upgradeChoice)).toBe('nothing left to upgrade');
    const oneUpgradeable: RunState = {
      ...allDiamond,
      pieces: [...allDiamond.pieces, { instanceId: 'b0', skillId: SIZE1_BRONZE[1]!, tier: 'bronze', slot: 1 }],
    };
    expect(choiceLockReason(oneUpgradeable, upgradeChoice)).toBeNull();
  });
});

describe('run/events: the new gate spends no Rng (2026-09-06)', () => {
  it('querying choiceLockReason/isEventChoiceUsable any number of times never shifts a later seeded draw', () => {
    for (const seed of [3, 11, 20]) {
      const untouched = fullBagState(stateAtEventNode(seed));
      const queried = fullBagState(stateAtEventNode(seed));
      expect(queried).toEqual(untouched); // same seed, same fixture, before any query

      // Simulate dozens of UI re-renders dimming every rung on this event —
      // pure reads, called far more times than any real screen would.
      for (let i = 0; i < 40; i += 1) {
        for (let c = 0; c < WANDERING_SMITH.choices.length; c += 1) {
          const choice: EventChoiceDef = WANDERING_SMITH.choices[c]!;
          choiceLockReason(queried, choice);
          isEventChoiceUsable(queried, choice);
        }
      }
      // `queried` itself is unmutated (pure reads) ...
      expect(queried).toEqual(untouched);
      // ... and the SAME choice's own seeded draw (`pike_blanks`, a `bonusDraft`
      // that spends `Rng` via `sampleDistinct`) resolves byte-identically
      // whether or not the gate was ever asked about it first.
      const resolvedUntouched = resolveExactEventChoice(untouched, 'wandering_smith', 'pike_blanks');
      const resolvedQueried = resolveExactEventChoice(queried, 'wandering_smith', 'pike_blanks');
      expect(resolvedQueried.outcome).toEqual(resolvedUntouched.outcome);
      expect(resolvedQueried.state).toEqual(resolvedUntouched.state);
    }
  });
});
