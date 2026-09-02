// The event-chain UI pass's run-layer presenters (2026-09-02) — the WORDED
// twins of the gate predicates, exported from `src/run/events.ts` for the two
// event scenes (interactivity rungs 1-3, scratchpad events-design.md §4):
//
//   - `choiceLockReason`   rung 1: WHY a dark rung is dark. `null` ⇔ usable —
//                          `isEventChoiceUsable` is now literally
//                          `choiceLockReason(...) === null`, so the boolean
//                          and the wording share ONE body and cannot drift.
//   - `eventRecapLine`     rung 2: the one-line "your past choice" recap a
//                          chain payoff opens its body with.
//   - `derivedChoiceFamily` rung 3: the resolved family a `filterFrom` door
//                          names on its label ("— FROST"), wrapping the
//                          exported `derivedChoiceFilter` so no scene ever
//                          re-derives the pool a second way.
//
// All three are pure reads (no Rng, no save fields) — asserted here against
// hand-built states, the same local-helper convention as events.chains.test.ts.

import { describe, expect, it } from 'vitest';
import { eventCatalog, eventCatalogIds, type EventChoiceDef } from '../../src/data/events';
import {
  choiceLockReason,
  derivedChoiceFamily,
  eventRecapLine,
  isEventChoiceUsable,
} from '../../src/run/events';
import {
  applyDraftResult,
  availableChoices,
  chooseNode,
  createRun,
  currentEventNode,
  leaveShop,
  recordBattleResult,
  type RunBagSlot,
  type RunNode,
  type RunState,
} from '../../src/run/runState';
import { rollStartDraft, DRAFT_SET_KEYS, type DraftSetKey } from '../../src/run/draft';
import { skillBook } from '../../src/data/skills';
import { biomeCatalog, biomeIds } from '../../src/data/biomes';
import { biomeFor, counterTypeFor, leanLabel } from '../../src/run/biome';
import { cardOfferableAtTier } from '../../src/engine/types';

// ---------------------------------------------------------------------------
// Shared helpers (same local-helper convention as events.chains.test.ts).
// ---------------------------------------------------------------------------

function draftPicksFor(seed: number): Partial<Record<DraftSetKey, string>> {
  const draft = rollStartDraft(seed);
  const picks: Partial<Record<DraftSetKey, string>> = {};
  for (const key of DRAFT_SET_KEYS) picks[key] = draft[key][0]!.skillId;
  return picks;
}

function startedRun(seed: number): RunState {
  return applyDraftResult(createRun(seed), draftPicksFor(seed));
}

/** Inject a synthetic past resolution — the exact record shape
 * `recordEventResolution` writes (gates scan the ledger's VALUES). */
function withResolution(state: RunState, eventId: string, choiceId: string, pending?: boolean): RunState {
  return {
    ...state,
    eventResolutions: {
      ...(state.eventResolutions ?? {}),
      [`synthetic-${eventId}-${choiceId}`]: { eventId, choiceId, ...(pending ? { pending: true } : {}) },
    },
  };
}

/** Walk to the first event node reachable from a fresh run — twin of the
 * helper in events.chains.test.ts. */
function stateAtFirstEvent(seed: number): { state: RunState; node: RunNode } {
  let state = startedRun(seed);
  for (let guard = 0; guard < 200; guard++) {
    const choices = availableChoices(state);
    if (choices.length === 0) throw new Error('no event node reachable for this seed');
    const eventChoice = choices.find((n) => n.kind === 'event');
    if (eventChoice) {
      state = chooseNode(state, eventChoice.id);
      return { state, node: eventChoice };
    }
    const node = choices[0]!;
    state = chooseNode(state, node.id);
    if (node.kind === 'shop') state = leaveShop(state);
    else state = recordBattleResult(state, { won: true, goldEarned: 1 });
  }
  throw new Error('guard exceeded while looking for an event node');
}

function replaceNode(map: RunState['map'], replacement: RunNode): RunState['map'] {
  return {
    ...map,
    depths: map.depths.map((column) => column.map((n) => (n.id === replacement.id ? replacement : n))),
  };
}

function choiceOf(eventId: string, choiceId: string): EventChoiceDef {
  const choice = eventCatalog[eventId]?.choices.find((c) => c.id === choiceId);
  if (!choice) throw new Error(`no catalog choice ${eventId}/${choiceId}`);
  return choice;
}

/** An empty 10-slot bag plus `n` distinct BRONZE size-1 cards at its head —
 * the merge-plan fixture runEventSeams.test.ts uses through the store. */
function bagWithBronze(n: number): RunBagSlot[] {
  const bronzeSize1 = Object.values(skillBook)
    .filter((s) => s.size === 1 && cardOfferableAtTier(s, 'bronze'))
    .map((s) => s.id);
  const bag: RunBagSlot[] = new Array<RunBagSlot>(10).fill(null);
  for (let i = 0; i < n; i += 1) {
    bag[i] = { instanceId: `card_90${i}`, skillId: bronzeSize1[i]!, tier: 'bronze' };
  }
  return bag;
}

// ---------------------------------------------------------------------------
// choiceLockReason — rung 1.
// ---------------------------------------------------------------------------

describe('run/events: choiceLockReason is the worded twin of isEventChoiceUsable', () => {
  const base = startedRun(5);

  it('agrees with the predicate on EVERY catalog choice across a matrix of states — null ⇔ usable', () => {
    const swords = Object.values(skillBook).filter((s) => s.weapon === 'sword' && s.element === undefined).slice(0, 3);
    const states: RunState[] = [
      { ...base, gold: 0 },
      { ...base, gold: 5 },
      withResolution(withResolution({ ...base, gold: 5 }, 'crossroads_shrine', 'tithe'), 'wandering_tutor', 'pay'),
      { ...base, gold: 5, stats: { ...base.stats, goldSpent: 20, livesLost: 1 }, losses: 1 },
      {
        ...base,
        gold: 5,
        gemInventory: ['bramble_sliver'],
        pieces: swords.map((s, i) => ({ instanceId: `sw_${i}`, skillId: s.id, tier: 'bronze' as const, slot: i })),
        bagSlots: bagWithBronze(0),
      },
      { ...stateAtFirstEvent(4).state, gold: 5 }, // ON an event node: biome sources resolvable
    ];
    for (const state of states) {
      for (const id of eventCatalogIds) {
        for (const choice of eventCatalog[id]!.choices) {
          const reason = choiceLockReason(state, choice);
          expect(reason === null, `${id}/${choice.id}: reason "${reason}" disagrees with the predicate`)
            .toBe(isEventChoiceUsable(state, choice));
        }
      }
    }
  });

  it('every reason it words is ONE short line — sized for the choice panel detail row', () => {
    // The mobile detail row is a single audited line; a reason that wraps gets
    // shrunk toward the 8px floor. 48 chars covers the longest catalog label
    // quote today with slack, and a longer one is a wording bug, not a layout
    // problem to absorb.
    const states: RunState[] = [{ ...base, gold: 0 }, { ...base, gold: 5 }];
    for (const state of states) {
      for (const id of eventCatalogIds) {
        for (const choice of eventCatalog[id]!.choices) {
          const reason = choiceLockReason(state, choice);
          if (reason === null) continue;
          expect(reason.length, `${id}/${choice.id}: "${reason}"`).toBeLessThanOrEqual(48);
          expect(reason, `${id}/${choice.id} reason must not wrap by construction`).not.toContain('\n');
        }
      }
    }
  });

  it('gold shortfall: names the price, and clears the moment the price is payable', () => {
    const pay = choiceOf('wandering_tutor', 'pay');
    expect(choiceLockReason({ ...base, gold: 0 }, pay)).toBe('needs 2 gold');
    expect(choiceLockReason({ ...base, gold: 2 }, pay)).toBeNull();
  });

  it('an unmet single-choice gate names the exact past door, price tag stripped', () => {
    const sunRoad = choiceOf('the_reckoning', 'sun_road');
    const moonRoad = choiceOf('the_reckoning', 'moon_road');
    // Labels: 'Leave a holy tithe (2 gold)' / 'Scratch the moon-mark for dark work (2 gold)'.
    expect(choiceLockReason(base, sunRoad)).toBe('needs "Leave a holy tithe"');
    const tithed = withResolution(base, 'crossroads_shrine', 'tithe');
    expect(choiceLockReason(tithed, sunRoad)).toBeNull();
    expect(choiceLockReason(tithed, moonRoad)).toBe('needs "Scratch the moon-mark for dark work"');
  });

  it('a gate over ANY choice (or several) names the past event instead; a dangling gate still words safely', () => {
    const anyDeed: EventChoiceDef = {
      id: 'synth_any', label: 'synth', outcome: { kind: 'nothing' },
      requires: { eventId: 'wandering_tutor' },
    };
    expect(choiceLockReason(base, anyDeed)).toBe('needs a deed at The Wandering Tutor');
    const twoDoors: EventChoiceDef = {
      id: 'synth_two', label: 'synth', outcome: { kind: 'nothing' },
      requires: { eventId: 'crossroads_shrine', choiceIds: ['tithe', 'moon_rite'] },
    };
    expect(choiceLockReason(base, twoDoors)).toBe('needs a deed at Crossroads Shrine');
    const dangling: EventChoiceDef = {
      id: 'synth_dangling', label: 'synth', outcome: { kind: 'nothing' },
      requires: { eventId: 'no_such_event' },
    };
    expect(choiceLockReason(base, dangling)).toBe('needs a past deed');
  });

  it('an unmet tally reads as live progress against the bar, through the same counter read as the predicate', () => {
    const lossesBar: EventChoiceDef = {
      id: 'synth_losses', label: 'synth', outcome: { kind: 'nothing' },
      requiresTally: { stat: 'losses', atLeast: 2 },
    };
    expect(choiceLockReason(base, lossesBar)).toBe('0/2 fights lost');
    expect(choiceLockReason({ ...base, losses: 1 }, lossesBar)).toBe('1/2 fights lost');
    expect(choiceLockReason({ ...base, losses: 2 }, lossesBar)).toBeNull();
    const spendBar: EventChoiceDef = {
      id: 'synth_spend', label: 'synth', outcome: { kind: 'nothing' },
      requiresTally: { stat: 'goldSpent', atLeast: 12 },
    };
    expect(choiceLockReason({ ...base, stats: { ...base.stats, goldSpent: 8 } }, spendBar)).toBe('8/12 gold spent');
  });

  it("boardIdentity dark rung teaches the threshold; the biome doors' no-node fallback stays worded", () => {
    const blazon = choiceOf('banner_scribe', 'blazon');
    const bare: RunState = { ...base, gold: 5, pieces: [], bagSlots: bagWithBronze(0) };
    expect(choiceLockReason(bare, blazon)).toBe('no 3-of-a-kind on your board');
    // Off an event node a biome-sourced door cannot read the land at all.
    const localMake = choiceOf('the_lands_measure', 'local_make');
    expect(currentEventNode(bare)).toBeUndefined();
    expect(choiceLockReason(bare, localMake)).toBe('the land cannot be read');
  });

  it('on the counterless (bow-lean) band the dark hunter door names what nothing counters', () => {
    const bowBiome = biomeIds.find((id) => counterTypeFor(biomeCatalog[id]!.lean) === undefined);
    expect(bowBiome, 'no counterless biome left — rewire this case to whatever teaches it now').toBeDefined();
    const { state } = stateAtFirstEvent(4);
    const node = currentEventNode(state)!;
    const rigged: RunState = { ...state, gold: 5, map: replaceNode(state.map, { ...node, biomeId: bowBiome }) };
    const lean = biomeFor(rigged.seed, node.wave, bowBiome).lean;
    expect(choiceLockReason(rigged, choiceOf('the_lands_measure', 'hunters_edge')))
      .toBe(`nothing counters ${leanLabel(lean)}`);
    // The lean door on the same band stays lit — no reason at all.
    expect(choiceLockReason(rigged, choiceOf('the_lands_measure', 'local_make'))).toBeNull();
  });

  it('the outcome-specific preconditions word their own locks: empty pouch, no mergeable trio', () => {
    const sell = choiceOf('flaw_finder', 'sell_flawed');
    expect(choiceLockReason({ ...base, gemInventory: [] }, sell)).toBe('nothing in your pouch');
    expect(choiceLockReason({ ...base, gemInventory: ['bramble_sliver'] }, sell)).toBeNull();
    const merge = choiceOf('ruined_anvil', 'beat_together');
    const cardless: RunState = { ...base, gold: 5, pieces: [], bagSlots: bagWithBronze(0) };
    expect(choiceLockReason(cardless, merge)).toBe('no mergeable trio');
    expect(choiceLockReason({ ...cardless, bagSlots: bagWithBronze(3) }, merge)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// eventRecapLine — rung 2.
// ---------------------------------------------------------------------------

describe('run/events: eventRecapLine words the past a chain payoff is paying off', () => {
  const base = startedRun(5);

  it('an EVENT-gated payoff names the deed that opened it (price tag stripped); pending counts', () => {
    const tutorsReturn = eventCatalog.tutors_return!;
    expect(eventRecapLine(withResolution(base, 'wandering_tutor', 'pay'), tutorsReturn))
      .toBe('You chose "Pay 2 gold for the lesson" at The Wandering Tutor.');
    expect(eventRecapLine(withResolution(base, 'wandering_tutor', 'pay', true), tutorsReturn))
      .toBe('You chose "Pay 2 gold for the lesson" at The Wandering Tutor.');
  });

  it('a two-faced gate names the face actually honored — and the first AUTHORED face when both were', () => {
    const reckoning = eventCatalog.the_reckoning!;
    const mooned = withResolution(base, 'crossroads_shrine', 'moon_rite');
    expect(eventRecapLine(mooned, reckoning))
      .toBe('You chose "Scratch the moon-mark for dark work" at Crossroads Shrine.');
    // Both faces: authored catalog order decides (tithe precedes moon_rite),
    // never ledger key order — deterministic across reloads by construction.
    const both = withResolution(mooned, 'crossroads_shrine', 'tithe');
    expect(eventRecapLine(both, reckoning))
      .toBe('You chose "Leave a holy tithe" at Crossroads Shrine.');
  });

  it('a TALLY-gated payoff quotes the live counter', () => {
    const ledger = eventCatalog.factors_ledger!;
    expect(eventRecapLine({ ...base, stats: { ...base.stats, goldSpent: 14 } }, ledger))
      .toBe('You have spent 14 gold on this road.');
    const pyre = eventCatalog.pyre_watch!;
    expect(eventRecapLine({ ...base, stats: { ...base.stats, livesLost: 1 } }, pyre))
      .toBe('The road has taken 1 of your lives.');
  });

  it('null everywhere else: ungated events, and a gated event whose gate is (somehow) unmet', () => {
    expect(eventRecapLine(base, eventCatalog.wandering_tutor!)).toBeNull();
    expect(eventRecapLine(base, eventCatalog.the_lands_measure!)).toBeNull();
    expect(eventRecapLine(base, eventCatalog.tutors_return!)).toBeNull(); // gate unmet
    expect(eventRecapLine(base, eventCatalog.factors_ledger!)).toBeNull(); // bar unmet
  });

  it('every gated catalog event HAS a recap the moment its gate is met — no silent payoff', () => {
    // The rung-2 promise for future content: a chain whose payoff cannot name
    // its past fails here, not in a playtest.
    const opened: Record<string, RunState> = {
      tutors_return: withResolution(base, 'wandering_tutor', 'pay'),
      the_reckoning: withResolution(base, 'crossroads_shrine', 'tithe'),
      factors_ledger: { ...base, stats: { ...base.stats, goldSpent: 12 } },
      pyre_watch: { ...base, stats: { ...base.stats, livesLost: 1 } },
    };
    const gatedIds = eventCatalogIds.filter((id) => {
      const ev = eventCatalog[id]!;
      return ev.requires !== undefined || ev.requiresTally !== undefined;
    });
    for (const id of gatedIds) {
      const state = opened[id];
      expect(state, `gated event ${id} has no opened-state fixture — add one`).toBeDefined();
      const recap = eventRecapLine(state!, eventCatalog[id]!);
      expect(recap, `${id} pays off with no recap line`).not.toBeNull();
      expect(recap!.length).toBeGreaterThan(0);
      expect(recap).not.toContain('\n');
    }
  });
});

// ---------------------------------------------------------------------------
// derivedChoiceFamily — rung 3.
// ---------------------------------------------------------------------------

describe("run/events: derivedChoiceFamily names a derived door's resolved family", () => {
  const base = startedRun(5);
  const blazon = choiceOf('banner_scribe', 'blazon');

  it('a committed board names its identity — weapon and element alike, in the lean-chip uppercase', () => {
    const bare: RunState = { ...base, pieces: [], bagSlots: bagWithBronze(0) };
    const swords = Object.values(skillBook).filter((s) => s.weapon === 'sword' && s.element === undefined).slice(0, 3);
    const swordBoard: RunState = {
      ...bare,
      pieces: swords.map((s, i) => ({ instanceId: `sw_${i}`, skillId: s.id, tier: 'bronze' as const, slot: i })),
    };
    expect(derivedChoiceFamily(swordBoard, blazon)).toBe('SWORD');
    const fires = Object.values(skillBook).filter((s) => s.element === 'fire').slice(0, 3);
    const fireBoard: RunState = {
      ...bare,
      pieces: fires.map((s, i) => ({ instanceId: `fi_${i}`, skillId: s.id, tier: 'bronze' as const, slot: i })),
    };
    expect(derivedChoiceFamily(fireBoard, blazon)).toBe('FIRE');
  });

  it("the biome doors name the standing band's lean on a REAL event node — the same read the resolver deals from", () => {
    const { state, node } = stateAtFirstEvent(4);
    const lean = biomeFor(state.seed, node.wave, node.biomeId).lean;
    expect(derivedChoiceFamily(state, choiceOf('the_lands_measure', 'local_make'))).toBe(leanLabel(lean));
    const counter = counterTypeFor(lean);
    const hunters = derivedChoiceFamily(state, choiceOf('the_lands_measure', 'hunters_edge'));
    if (counter === undefined) expect(hunters).toBeUndefined();
    else expect(hunters).toBe(counter.toUpperCase());
  });

  it('undefined exactly where rung 1 takes over: unresolvable sources and plain static choices', () => {
    const bare: RunState = { ...base, gold: 5, pieces: [], bagSlots: bagWithBronze(0) };
    expect(derivedChoiceFamily(bare, blazon)).toBeUndefined(); // uncommitted board
    expect(choiceLockReason(bare, blazon)).not.toBeNull(); // ...and rung 1 words it
    expect(derivedChoiceFamily(base, choiceOf('wandering_tutor', 'pay'))).toBeUndefined(); // no filterFrom
    expect(derivedChoiceFamily(base, choiceOf('the_reckoning', 'sun_road'))).toBeUndefined(); // static filter, not derived
  });
});
