import { afterEach, describe, expect, it } from 'vitest';
import { eventCatalog, eventCatalogIds, type EventDef, type EventOutcomeSpec } from '../../src/data/events';
import { skillBook } from '../../src/data/skills';
import { gemBook } from '../../src/data/gems';
import {
  applyBonusDraftPick,
  applyGemChoicePick,
  applySellGemPick,
  applyUpgradeCardPick,
  EVENT_CHOICE_SIZE,
  isEventChoiceAffordable,
  isEventChoiceUsable,
  resolveEventChoice,
  rollEventForNode,
} from '../../src/run/events';
import {
  applyDraftResult,
  availableChoices,
  chooseNode,
  createRun,
  currentEventNode,
  leaveEvent,
  leaveShop,
  recordBattleResult,
  type RunNode,
  type RunState,
} from '../../src/run/runState';
import { rollStartDraft, DRAFT_SET_KEYS, type DraftSetKey } from '../../src/run/draft';
import { gemMatchesFilter, sellPriceOfGem } from '../../src/run/shop';

function draftPicksFor(seed: number): Partial<Record<DraftSetKey, string>> {
  const draft = rollStartDraft(seed);
  const picks: Partial<Record<DraftSetKey, string>> = {};
  for (const key of DRAFT_SET_KEYS) picks[key] = draft[key][0]!.skillId;
  return picks;
}

function startedRun(seed: number): RunState {
  return applyDraftResult(createRun(seed), draftPicksFor(seed));
}

/** Walk to the first event node reachable from a fresh run, leaving any
 * shop/fight nodes encountered along the way (fights always won). Returns
 * the state with that event node `current` (uncommitted). */
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

/** Every outcome kind in the vocabulary, for the catalog lint. */
const OUTCOME_KINDS = new Set([
  'grantCard',
  'grantGem',
  'grantGold',
  'loseGold',
  'grantLevel',
  'bonusDraft',
  'cardChoice',
  'gemChoice',
  'upgradeCard',
  'sellGem',
  // `mergeCards` (2026-08-26) — three owned same-tier cards in, a choice of
  // three at tier+1 out. Its own suite is `tests/run/cardMerge.test.ts`.
  'mergeCards',
  'nothing',
]);

function isSafe(choice: { cost?: number; outcome: EventOutcomeSpec }): boolean {
  return (choice.cost ?? 0) === 0;
}

/** A GATED (chained) event — never enters a theme bag; drawn by
 * `rollEventForNode`'s priority scan once its gate opens (2026-09-02 chain
 * batch). Local predicate, same convention as this file's other lint logic. */
function isGatedEventId(id: string): boolean {
  const event = eventCatalog[id]!;
  return event.requires !== undefined || event.requiresTally !== undefined;
}

/** The bag pools' actual membership — what `idsForTheme` (run/events.ts) and
 * the defensive all-catalog bag draw from. */
const UNGATED_IDS: readonly string[] = eventCatalogIds.filter((id) => !isGatedEventId(id));

describe('data/events: catalog lint', () => {
  it('has exactly 39 events (32 + the 2026-09-02 chain batch of 7), each with a unique id', () => {
    expect(eventCatalogIds.length).toBe(39);
    expect(new Set(eventCatalogIds).size).toBe(39);
  });

  it('every event has a theme', () => {
    for (const id of eventCatalogIds) {
      const event = eventCatalog[id]!;
      expect(['training', 'cache', 'recruit', 'forge', 'market', 'omen']).toContain(event.theme);
    }
  });

  // Upgraded from "at least 2 events" (2026-09-02, chain batch): gated events
  // never enter a bag, so what keeps a theme's rotation alive is its UNGATED
  // population — the bag pool must never be thin enough for one exhausted
  // cycle to strand the theme on the widen-fallback path (lint L3 of the
  // chain design).
  it('every theme has at least 2 UNGATED events (the bag pool, which excludes chained events)', () => {
    const counts: Record<string, number> = {};
    for (const id of UNGATED_IDS) {
      const theme = eventCatalog[id]!.theme;
      counts[theme] = (counts[theme] ?? 0) + 1;
    }
    for (const theme of ['training', 'cache', 'recruit', 'forge', 'market', 'omen']) {
      expect(counts[theme] ?? 0).toBeGreaterThanOrEqual(2);
    }
  });

  // Upper bound of 3 is not arbitrary: it is the largest choice count
  // `src/game/ui/runEventStoryLayout.ts`'s reservation math can guarantee
  // fits on BOTH platforms (see `EventDef.choices`'s doc comment in
  // `src/data/events.ts` for the full arithmetic, and
  // `tests/game/runEventStoryLayout.test.ts`'s "bound derivation" describe
  // block for the synthetic proof at 3 vs. the documented failure at 4).
  // Mobile is the binding platform (desktop alone would tolerate 4).
  it('every event has 2-3 choices', () => {
    for (const id of eventCatalogIds) {
      const event = eventCatalog[id]!;
      expect(event.choices.length).toBeGreaterThanOrEqual(2);
      expect(event.choices.length).toBeLessThanOrEqual(3);
    }
  });

  it('every event has a genuinely safe exit (a cost-0 choice)', () => {
    for (const id of eventCatalogIds) {
      const event = eventCatalog[id]!;
      expect(event.choices.some(isSafe)).toBe(true);
    }
  });

  it('every outcome uses only vocabulary kinds', () => {
    for (const id of eventCatalogIds) {
      const event = eventCatalog[id]!;
      for (const choice of event.choices) {
        expect(OUTCOME_KINDS.has(choice.outcome.kind)).toBe(true);
      }
    }
  });

  it('every fixed grantCard/grantGem id and filter resolves to a real, non-empty pool', () => {
    for (const id of eventCatalogIds) {
      const event = eventCatalog[id]!;
      const specs: EventOutcomeSpec[] = event.choices.map((c) => c.outcome);
      for (const spec of specs) {
        if (spec.kind === 'grantCard') {
          if (spec.cardId) expect(skillBook[spec.cardId]).toBeDefined();
          if (spec.filter) {
            const pool = Object.values(skillBook).filter((s) =>
              spec.filter!.some((clause) => {
                if (clause.properties && !clause.properties.includes(s.property)) return false;
                if (clause.weapons && (!s.weapon || !clause.weapons.includes(s.weapon))) return false;
                if (clause.elements && (!s.element || !clause.elements.includes(s.element))) return false;
                if (clause.archetypes && !s.archetypes.some((a) => clause.archetypes!.includes(a))) return false;
                return true;
              }),
            );
            expect(pool.length).toBeGreaterThan(0);
          }
        }
        if (spec.kind === 'grantGem' && spec.gemId) {
          expect(gemBook[spec.gemId]).toBeDefined();
        }
      }
    }
  });

  it('every bonusDraft filter resolves to a real, non-empty pool (thin filters allowed, empty is a bug)', () => {
    for (const id of eventCatalogIds) {
      const event = eventCatalog[id]!;
      const specs: EventOutcomeSpec[] = event.choices.map((c) => c.outcome);
      for (const spec of specs) {
        if (spec.kind !== 'bonusDraft' || !spec.filter) continue;
        const pool = Object.values(skillBook).filter((s) =>
          spec.filter!.some((clause) => {
            if (clause.properties && !clause.properties.includes(s.property)) return false;
            if (clause.weapons && (!s.weapon || !clause.weapons.includes(s.weapon))) return false;
            if (clause.elements && (!s.element || !clause.elements.includes(s.element))) return false;
            if (clause.archetypes && !s.archetypes.some((a) => clause.archetypes!.includes(a))) return false;
            return true;
          }),
        );
        expect(pool.length).toBeGreaterThan(0);
      }
    }
  });

  // Tightened from a bare non-empty check (2026-08-18 QA pass): a `cardChoice`
  // deals a 1-of-`EVENT_CHOICE_SIZE` pick, not a 1-of-N-for-whatever-N-the-
  // filter-happens-to-match — a pool narrower than that silently ships a
  // 1-of-1 or 1-of-2 "pick" with no error (see `sampleDistinct`'s doc comment
  // in `src/run/events.ts`). `cardChoiceOutcome` itself now throws on this at
  // resolve time (see the "too-small pool" describe block below), so this
  // lint test is a build-time-loud second guard against the same defect,
  // catching it at catalog-authoring time instead of at whatever seed first
  // resolves the choice.
  it('every cardChoice filter resolves to a pool of at least EVENT_CHOICE_SIZE cards (never a 1-of-1/1-of-2 pick)', () => {
    for (const id of eventCatalogIds) {
      const event = eventCatalog[id]!;
      const specs: EventOutcomeSpec[] = event.choices.map((c) => c.outcome);
      for (const spec of specs) {
        if (spec.kind !== 'cardChoice') continue;
        const all = Object.values(skillBook);
        const pool = spec.filter
          ? all.filter((s) =>
              spec.filter!.some((clause) => {
                if (clause.properties && !clause.properties.includes(s.property)) return false;
                if (clause.weapons && (!s.weapon || !clause.weapons.includes(s.weapon))) return false;
                if (clause.elements && (!s.element || !clause.elements.includes(s.element))) return false;
                if (clause.archetypes && !s.archetypes.some((a) => clause.archetypes!.includes(a))) return false;
                return true;
              }),
            )
          : all;
        const drawPool = pool.length > 0 ? pool : all;
        expect(drawPool.length).toBeGreaterThanOrEqual(EVENT_CHOICE_SIZE);
      }
    }
  });

  // Same tightening as the cardChoice lint above, for gemChoice's pool.
  it('every gemChoice filter resolves to a pool of at least EVENT_CHOICE_SIZE gems (none in the catalog carry a filter today, but the guard stays live)', () => {
    for (const id of eventCatalogIds) {
      const event = eventCatalog[id]!;
      const specs: EventOutcomeSpec[] = event.choices.map((c) => c.outcome);
      for (const spec of specs) {
        if (spec.kind !== 'gemChoice') continue;
        const pool = Object.values(gemBook).filter((g) => (spec.filter ? gemMatchesFilter(g, spec.filter) : true));
        expect(pool.length).toBeGreaterThanOrEqual(EVENT_CHOICE_SIZE);
      }
    }
  });

  // Pinned margin (content-designer, 2026-08-19 defect fix): `the_lapidary`'s
  // `warding_cut` choice used to filter to EXACTLY 3 gems (sanctuary_sliver,
  // renewal_sliver, provoker_sliver) — matching `EVENT_CHOICE_SIZE` with zero
  // slack, one gem retirement/reclassification away from tripping
  // `gemChoiceOutcome`'s narrower-than-`EVENT_CHOICE_SIZE` throw for every
  // player who picks that choice. `taunting_sliver` (provoker_sliver's Rare
  // taunt-ladder sibling) was added to widen the pool to 4; this pins the
  // margin at a stricter bound than the generic `>= EVENT_CHOICE_SIZE` lint
  // above so a future edit that erodes the slack back to exactly 3 fails
  // here specifically, with the filter named in the assertion.
  it("the_lapidary's warding_cut gemChoice pool has slack above EVENT_CHOICE_SIZE (>= 4, not exactly 3)", () => {
    const event = eventCatalog.the_lapidary!;
    const choice = event.choices.find((c) => c.id === 'warding_cut')!;
    const spec = choice.outcome as Extract<EventOutcomeSpec, { kind: 'gemChoice' }>;
    const pool = Object.values(gemBook).filter((g) => gemMatchesFilter(g, spec.filter!));
    expect(pool.length).toBeGreaterThanOrEqual(4);
  });

  // Census moved by the 2026-09-02 chain batch (+7 events): cardChoice
  // 8 -> 13 (the_lands_measure x2, factors_ledger, pyre_watch, banner_scribe),
  // gemChoice 10 -> 12 (factors_ledger, flaw_finder), sellGem 1 -> 2
  // (flaw_finder — the second surface the merge-door reach measurement calls
  // for: one door is a coin flip). Named-card grants unchanged at 5.
  it('exactly 13 cardChoice, 12 gemChoice, and 2 sellGem outcomes in the catalog (2026-08-18 widening + 2026-08-19/20 batches + 2026-09-02 chain batch), and the 5 named-card grants are accounted for', () => {
    let cardChoiceCount = 0;
    let gemChoiceCount = 0;
    let sellGemCount = 0;
    let namedGrantCardCount = 0;
    for (const id of eventCatalogIds) {
      for (const choice of eventCatalog[id]!.choices) {
        if (choice.outcome.kind === 'cardChoice') cardChoiceCount++;
        if (choice.outcome.kind === 'gemChoice') gemChoiceCount++;
        if (choice.outcome.kind === 'sellGem') sellGemCount++;
        if (choice.outcome.kind === 'grantCard' && choice.outcome.cardId) namedGrantCardCount++;
      }
    }
    expect(cardChoiceCount).toBe(13);
    expect(gemChoiceCount).toBe(12);
    expect(sellGemCount).toBe(2);
    expect(namedGrantCardCount).toBe(5);
  });

  // DELIBERATE LINT ADDITION (2026-08-26, the card-merge pass). The four counts
  // above are UNCHANGED by that pass — it added no card/gem choice and no named
  // grant, only two new `mergeCards` rungs — so this is a new pin beside them
  // rather than an edit to them. Both rungs sit on events that already had a
  // cost-0, non-`nothing` choice, which is why the event DRAW (and every seeded
  // event sequence in this suite) is byte-identical to before it.
  it('exactly 2 mergeCards outcomes, both on forge events that were already eligible at gold 0', () => {
    let mergeCount = 0;
    const events: string[] = [];
    for (const id of eventCatalogIds) {
      for (const choice of eventCatalog[id]!.choices) {
        if (choice.outcome.kind !== 'mergeCards') continue;
        mergeCount++;
        events.push(id);
        expect(choice.cost ?? 0, `${id}/${choice.id} charges gold on top of the three cards`).toBe(0);
      }
    }
    expect(mergeCount).toBe(2);
    expect(events.sort()).toEqual(['ember_pit', 'ruined_anvil']);
    for (const id of events) {
      const event = eventCatalog[id]!;
      expect(event.theme).toBe('forge');
      const alreadyLive = event.choices.some(
        (c) => (c.cost ?? 0) === 0 && c.outcome.kind !== 'nothing' && c.outcome.kind !== 'mergeCards',
      );
      expect(alreadyLive, `${id}'s eligibility now depends on the merge rung`).toBe(true);
    }
  });

  it('reprices only the 2 currently-free widened choices whose sibling stays a genuinely safe cost-0 exit, leaving the other 2 free', () => {
    const quartermastersError = eventCatalog.quartermasters_error!;
    const takeArmor = quartermastersError.choices.find((c) => c.id === 'take_armor')!;
    const takeGem = quartermastersError.choices.find((c) => c.id === 'take_gem')!;
    expect(takeArmor.cost ?? 0).toBe(0); // stays free — the event's remaining safe exit
    expect(takeGem.cost).toBe(1); // +1 gold reprice

    const fencesOffer = eventCatalog.fences_offer!;
    const takeCoin = fencesOffer.choices.find((c) => c.id === 'take_coin')!;
    const takeStone = fencesOffer.choices.find((c) => c.id === 'take_stone')!;
    expect(takeCoin.cost ?? 0).toBe(0); // untouched, stays the event's free exit
    expect(takeStone.cost).toBe(1); // +1 gold reprice

    const sparringCircle = eventCatalog.sparring_circle!;
    const spareBlade = sparringCircle.choices.find((c) => c.id === 'spare_blade')!;
    expect(spareBlade.cost ?? 0).toBe(0); // stays free — sparring_circle's ONLY cost-0 choice
  });

});

describe('run/events: rollEventForNode', () => {
  it('is idempotent for the same node (a reload never re-draws)', () => {
    const { state, node } = stateAtFirstEvent(3);
    const a = rollEventForNode(state, node);
    const b = rollEventForNode(a.state, node);
    expect(b.event.id).toBe(a.event.id);
    expect(b.state.eventBag).toEqual(a.state.eventBag);
    expect(b.state.eventBagRefills).toBe(a.state.eventBagRefills);
  });

  it('throws on a non-event node', () => {
    const state = startedRun(1);
    const nonEvent = availableChoices(state).find((n) => n.kind !== 'event');
    if (!nonEvent) return;
    expect(() => rollEventForNode(state, nonEvent)).toThrow();
  });

  it('determinism: same run seed -> same event drawn at the same node, across ~20 seeds', () => {
    for (let i = 0; i < 20; i++) {
      const seed = i * 37 + 5;
      const { state: stateA, node: nodeA } = stateAtFirstEvent(seed);
      const { state: stateB, node: nodeB } = stateAtFirstEvent(seed);
      expect(nodeB.id).toBe(nodeA.id);
      const a = rollEventForNode(stateA, nodeA);
      const b = rollEventForNode(stateB, nodeB);
      expect(b.event.id).toBe(a.event.id);
    }
  });

  it('the event bag never repeats a catalog id within one cycle (the UNGATED pool — chained events are never bagged)', () => {
    // Drive a synthetic sequence of distinct event nodes through the SAME
    // state, forcing bag draws in order, and check no id repeats until the
    // bag would need to refill. The cycle length is the UNGATED catalog: a
    // gated event only ever arrives via the priority scan, so it can neither
    // appear here (no gate is met on a fresh run) nor shorten the cycle.
    let state = startedRun(9);
    const drawn: string[] = [];
    for (let i = 0; i < UNGATED_IDS.length; i++) {
      const fakeNode = { id: `fake-${i}`, depth: 1, wave: 1, kind: 'event' as const, eventSeed: i };
      const result = rollEventForNode(state, fakeNode);
      drawn.push(result.event.id);
      state = result.state;
    }
    expect(new Set(drawn).size).toBe(UNGATED_IDS.length);
  });

  it('respects the node theme: the resolved event always matches node.eventTheme', () => {
    // Flush with gold so affordability-based widening (see the "affordability"
    // describe block below) never kicks in here — this test is purely about
    // the theme-bag mechanic, not the gold-gating rule.
    let state = { ...startedRun(11), gold: 999 };
    const themes = ['training', 'cache', 'recruit', 'forge', 'market', 'omen'] as const;
    for (let i = 0; i < 12; i++) {
      const theme = themes[i % themes.length]!;
      const fakeNode = { id: `themed-${i}`, depth: 1, wave: 1, kind: 'event' as const, eventSeed: i, eventTheme: theme };
      const result = rollEventForNode(state, fakeNode);
      expect(result.event.theme).toBe(theme);
      state = result.state;
    }
  });

  it('no-repeat holds WITHIN a theme across a run (refills only that theme once exhausted)', () => {
    let state = startedRun(12);
    const themePool = eventCatalogIds.filter((id) => eventCatalog[id]!.theme === 'cache');
    const drawnFirstCycle: string[] = [];
    for (let i = 0; i < themePool.length; i++) {
      const fakeNode = { id: `cache-${i}`, depth: 1, wave: 1, kind: 'event' as const, eventSeed: i, eventTheme: 'cache' as const };
      const result = rollEventForNode(state, fakeNode);
      drawnFirstCycle.push(result.event.id);
      state = result.state;
    }
    expect(new Set(drawnFirstCycle).size).toBe(themePool.length);
    // Other themes' bags are untouched by cache draws.
    expect(state.eventThemeBags?.training ?? []).toEqual([]);
  });

  it('idempotent per node with a theme set', () => {
    let state = startedRun(13);
    const fakeNode = { id: 'themed-idem', depth: 1, wave: 1, kind: 'event' as const, eventSeed: 1, eventTheme: 'forge' as const };
    const a = rollEventForNode(state, fakeNode);
    const b = rollEventForNode(a.state, fakeNode);
    expect(b.event.id).toBe(a.event.id);
    expect(b.state.eventThemeBags).toEqual(a.state.eventThemeBags);
    expect(b.state.eventThemeBagRefills).toEqual(a.state.eventThemeBagRefills);
  });

  it('falls back to the untyped all-catalog bag when eventTheme is absent (defensive path; pool = ungated ids)', () => {
    let state = startedRun(14);
    const fakeNode = { id: 'no-theme', depth: 1, wave: 1, kind: 'event' as const, eventSeed: 1 };
    const result = rollEventForNode(state, fakeNode);
    expect(UNGATED_IDS).toContain(result.event.id);
    expect(result.state.eventBag.length).toBe(UNGATED_IDS.length - 1);
  });

  it('map-generated event nodes resolve to an event matching their eventTheme', () => {
    for (let i = 0; i < 20; i++) {
      const seed = i * 37 + 5;
      let state = startedRun(seed);
      for (let guard = 0; guard < 200; guard++) {
        const choices = availableChoices(state);
        if (choices.length === 0) break;
        const eventNode = choices.find((n) => n.kind === 'event');
        if (eventNode) {
          const { event } = rollEventForNode(state, eventNode);
          expect(event.theme).toBe(eventNode.eventTheme);
          state = chooseNode(state, eventNode.id);
          state = leaveEvent(state);
          continue;
        }
        const node = choices[0]!;
        state = chooseNode(state, node.id);
        if (node.kind === 'shop') state = leaveShop(state);
        else state = recordBattleResult(state, { won: true, goldEarned: 1 });
      }
    }
  });
});

describe('run/events: affordability-aware draw', () => {
  it('isEventChoiceAffordable agrees with the resolver\'s own deduction (cost <= gold)', () => {
    const { state } = stateAtFirstEvent(4);
    const broke = { ...state, gold: 0 };
    const flush = { ...state, gold: 10 };
    const free = { id: 'free', label: '', outcome: { kind: 'nothing' } as const };
    const costs3 = { id: 'costs3', label: '', cost: 3, outcome: { kind: 'nothing' } as const };
    expect(isEventChoiceAffordable(broke, free)).toBe(true);
    expect(isEventChoiceAffordable(broke, costs3)).toBe(false);
    expect(isEventChoiceAffordable(flush, costs3)).toBe(true);
  });

  it('an event rolled at gold 0 always has an affordable, non-nothing choice (many seeds/nodes)', () => {
    for (let i = 0; i < 20; i++) {
      const seed = i * 41 + 3;
      let state = startedRun(seed);
      expect(state.gold).toBe(0);
      for (let guard = 0; guard < 200; guard++) {
        const choices = availableChoices(state);
        if (choices.length === 0) break;
        const eventNode = choices.find((n) => n.kind === 'event');
        if (eventNode) {
          const { event } = rollEventForNode(state, eventNode);
          const hasPlayableChoice = event.choices.some(
            (c) => isEventChoiceAffordable(state, c) && c.outcome.kind !== 'nothing',
          );
          expect(hasPlayableChoice).toBe(true);
          state = chooseNode(state, eventNode.id);
          state = leaveEvent(state);
          continue;
        }
        const node = choices[0]!;
        state = chooseNode(state, node.id);
        if (node.kind === 'shop') state = leaveShop(state);
        else state = recordBattleResult(state, { won: true, goldEarned: 0 });
      }
    }
  });

  it('never offers a gold-costing choice as the only interesting option at gold 0 (direct catalog check)', () => {
    // Sanity-check the catalog-level guarantee `rollEventForNode` relies on:
    // scanning ALL events at gold 0, every one has SOME affordable, non-nothing
    // choice OR the widen-fallback is expected to kick in — either way the
    // draw-level test above proves the resolver honors it end-to-end.
    const broke = { gold: 0 } as RunState;
    let anyEligible = false;
    for (const id of eventCatalogIds) {
      const event = eventCatalog[id]!;
      if (event.choices.some((c) => isEventChoiceAffordable(broke, c) && c.outcome.kind !== 'nothing')) {
        anyEligible = true;
        break;
      }
    }
    expect(anyEligible).toBe(true);
  });

  it('per-node idempotency holds even when the first roll had to widen past the theme', () => {
    // Force forge's only free event (ruined_anvil) to be already exhausted so
    // the SECOND forge node this cycle is forced into the widen-fallback path,
    // then verify a repeat roll for that same node is still memo-stable.
    let state = startedRun(30);
    const forgeA = { id: 'forge-a', depth: 1, wave: 1, kind: 'event' as const, eventSeed: 0, eventTheme: 'forge' as const };
    const forgeB = { id: 'forge-b', depth: 1, wave: 1, kind: 'event' as const, eventSeed: 1, eventTheme: 'forge' as const };
    const first = rollEventForNode(state, forgeA);
    state = first.state;
    const second = rollEventForNode(state, forgeB);
    state = second.state;
    // Whichever event `second` resolved to (in-theme or widened), a repeat
    // roll for the SAME node must return the identical, memoized event.
    const repeat = rollEventForNode(state, forgeB);
    expect(repeat.event.id).toBe(second.event.id);
    expect(repeat.state).toEqual(state);
  });

  it('determinism holds for affordability-aware draws across ~20 seeds', () => {
    for (let i = 0; i < 20; i++) {
      const seed = i * 37 + 5;
      const { state: stateA, node: nodeA } = stateAtFirstEvent(seed);
      const { state: stateB, node: nodeB } = stateAtFirstEvent(seed);
      expect(nodeB.id).toBe(nodeA.id);
      const a = rollEventForNode(stateA, nodeA);
      const b = rollEventForNode(stateB, nodeB);
      expect(b.event.id).toBe(a.event.id);
    }
  });
});

describe('run/events: resolveEventChoice', () => {
  it('grantGold adds to the wallet', () => {
    const { state } = stateAtFirstEvent(4);
    const event = eventCatalog.overloaded_caravan!;
    const withGold = { ...state, gold: 5 };
    const { state: next, outcome } = resolveEventChoice(withGold, event.id, 'push');
    expect(outcome).toEqual({ kind: 'grantGold', amount: 1 });
    expect(next.gold).toBe(6);
  });

  it('cost is deducted before the outcome resolves', () => {
    const { state } = stateAtFirstEvent(4);
    const withGold = { ...state, gold: 10 };
    const { state: next } = resolveEventChoice(withGold, 'wandering_tutor', 'pay');
    expect(next.gold).toBe(8);
    expect(next.heroLevel).toBe(state.heroLevel + 1);
  });

  // Replaces the old "loseGold floors at 0" sweep (which forced Beast Nest's
  // `raid_it` failure branch to observe a `loseGold` outcome): the no-RNG-on-
  // rewards ruling converted `raid_it` from a gamble (60% card / 40%
  // loseGold(1)) into a guaranteed grantGold(1), which was ALSO the fix for a
  // proven defect — `raid_it` had `cost: 0` (the button read FREE) but could
  // still take a gold from the player on its losing branch. `loseGold` is no
  // longer produced by ANY catalog event (the floor-at-0 arithmetic itself
  // still lives in `applySpec`'s `loseGold` case, just with zero live
  // callers post-fix). This test now proves the fix directly instead of
  // sweeping for a dead outcome kind.
  it("beast_nest's FREE choice (raid_it, cost 0) can no longer take gold — always grants +1 gold now, never loseGold", () => {
    const { state } = stateAtFirstEvent(4);
    for (let i = 0; i < 20; i++) {
      const node = { ...currentEventNodeOrThrow(state), eventSeed: i };
      const withNode: RunState = { ...state, map: replaceNode(state.map, node) };
      const withGold = { ...withNode, gold: 1 };
      const { outcome, state: next } = resolveEventChoice(withGold, 'beast_nest', 'raid_it');
      expect(outcome).toEqual({ kind: 'grantGold', amount: 1 });
      expect(next.gold).toBe(2);
    }
  });

  it('grantLevel matches the win-leveling path (+1 heroLevel)', () => {
    const { state } = stateAtFirstEvent(4);
    const { state: next } = resolveEventChoice(state, 'veterans_last_lesson', 'take_years');
    expect(next.heroLevel).toBe(state.heroLevel + 1);
  });

  it('grantCard falls back to grantGold(2) with fellBack:true when the bag is full', () => {
    const { state } = stateAtFirstEvent(4);
    // Fill the bag completely with 1-slot bronze cards so no insert can fit.
    const bagSlots = Array.from({ length: 10 }, (_, i) => ({
      instanceId: `filler_${i}`,
      skillId: 'sword_slash',
      tier: 'bronze' as const,
    }));
    const fullBag: RunState = { ...state, bagSlots, gold: 0 };
    const { state: next, outcome } = resolveEventChoice(fullBag, 'veterans_last_lesson', 'take_blade');
    expect(outcome).toEqual({ kind: 'grantGold', amount: 2, fellBack: true });
    expect(next.gold).toBe(2);
  });

  it('bonusDraft returns 5 rolled cards and applyBonusDraftPick installs the pick', () => {
    const { state } = stateAtFirstEvent(4);
    const { state: afterChoice, outcome } = resolveEventChoice({ ...state, gold: 5 }, 'overloaded_caravan', 'rummage');
    expect(outcome.kind).toBe('bonusDraft');
    if (outcome.kind !== 'bonusDraft') return;
    expect(outcome.cards).toHaveLength(5);
    expect(new Set(outcome.cards.map((c) => c.skillId)).size).toBe(5);
    const { state: final, outcome: pickOutcome } = applyBonusDraftPick(afterChoice, outcome.cards[0]!);
    expect(pickOutcome.kind).toBe('grantCard');
    if (pickOutcome.kind !== 'grantCard') return;
    expect(final.bagSlots.some((s) => s?.skillId === pickOutcome.skillId)).toBe(true);
  });

  it('throws when no event node is currently active', () => {
    const state = startedRun(4);
    expect(() => resolveEventChoice(state, 'wandering_tutor', 'pay')).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Cost deduction for the priced `cardChoice`/`gemChoice` vocabulary
// (2026-08-18 QA pass) — the pre-existing "cost is deducted before the
// outcome resolves" test (above) only exercised `wandering_tutor`/
// `grantLevel`, an unrelated outcome kind. This closes that gap for the
// vocabulary the 2026-08-18 widening actually touched, modeled on
// `tests/run/runState.test.ts`'s `gold - state.gold === expectedCost` idiom
// for `rerollRunShop`'s escalating cost.
// ---------------------------------------------------------------------------
describe('run/events: resolveEventChoice deducts gold for priced cardChoice/gemChoice choices', () => {
  it('a priced cardChoice (abandoned_cache/search_thoroughly, 2 gold) deducts exactly its cost', () => {
    const { state } = stateAtFirstEvent(4);
    const withGold = { ...state, gold: 10 };
    const { state: next } = resolveEventChoice(withGold, 'abandoned_cache', 'search_thoroughly');
    expect(withGold.gold - next.gold).toBe(2);
    expect(next.gold).toBe(8);
  });

  it('a priced gemChoice (gemsellers_mishap/rifle, 2 gold) deducts exactly its cost', () => {
    const { state } = stateAtFirstEvent(4);
    const withGold = { ...state, gold: 10 };
    const { state: next } = resolveEventChoice(withGold, 'gemsellers_mishap', 'rifle');
    expect(withGold.gold - next.gold).toBe(2);
    expect(next.gold).toBe(8);
  });

  // The two choices this change moved from free to 1g — called out by name
  // in the audit as newly deducting gold where they didn't before.
  it('quartermasters_error/take_gem — newly-priced (0g -> 1g) gemChoice deducts exactly 1 gold', () => {
    const { state } = stateAtFirstEvent(4);
    const withGold = { ...state, gold: 5 };
    const { state: next } = resolveEventChoice(withGold, 'quartermasters_error', 'take_gem');
    expect(withGold.gold - next.gold).toBe(1);
    expect(next.gold).toBe(4);
  });

  it('fences_offer/take_stone — newly-priced (0g -> 1g) gemChoice deducts exactly 1 gold', () => {
    const { state } = stateAtFirstEvent(4);
    const withGold = { ...state, gold: 5 };
    const { state: next } = resolveEventChoice(withGold, 'fences_offer', 'take_stone');
    expect(withGold.gold - next.gold).toBe(1);
    expect(next.gold).toBe(4);
  });

  it('goldSpent stat tracks the same amount deducted for a priced cardChoice/gemChoice', () => {
    const { state } = stateAtFirstEvent(4);
    const withGold = { ...state, gold: 10 };
    const { state: next } = resolveEventChoice(withGold, 'abandoned_cache', 'search_thoroughly');
    expect(next.stats.goldSpent - withGold.stats.goldSpent).toBe(2);
  });

  // KNOWN GAP (found by this QA pass, routed rather than fixed here — see the
  // task summary): `resolveEventChoice`'s cost deduction floors at 0
  // (`Math.max(0, working.gold - choice.cost)`) and does NOT check
  // `isEventChoiceAffordable` before applying the outcome, despite the doc
  // comment above `isEventChoiceAffordable` in `src/run/events.ts` describing
  // it as "the single predicate authority both this resolver and the UI use".
  // In practice a broke player who somehow calls `resolveEventChoice` on an
  // unaffordable priced choice still receives the FULL outcome (a 1-of-3
  // pick, here) for whatever partial gold they had, not a refusal — the
  // client only avoids this by dimming the button first via
  // `isEventChoiceAffordable`, a UI-layer gate this pure resolver doesn't
  // itself enforce. This test PINS today's actual behavior (so a future
  // change to it is a deliberate, visible diff, not a silent one) rather than
  // asserting the refusal the audit assumed exists.
  it('KNOWN GAP: an unaffordable priced cardChoice is NOT refused — it still resolves, gold floored at 0', () => {
    const { state } = stateAtFirstEvent(4);
    const broke = { ...state, gold: 0 };
    const { state: next, outcome } = resolveEventChoice(broke, 'abandoned_cache', 'search_thoroughly'); // costs 2
    expect(next.gold).toBe(0); // floored, not refused
    expect(outcome.kind).toBe('bonusDraft'); // the outcome still resolved despite being unaffordable
  });
});

describe('run/events: upgradeCard', () => {
  it('offers every eligible owned card as options — board first (ascending slot), then bag (array order) — and pays cost without mutating anything yet', () => {
    const { state } = stateAtFirstEvent(4);
    const rigged: RunState = {
      ...state,
      gold: 10,
      pieces: [
        { instanceId: 'p_silver', skillId: 'sword_slash', tier: 'silver', slot: 0 },
        { instanceId: 'p_bronze_late', skillId: 'sword_slash', tier: 'bronze', slot: 3 },
        { instanceId: 'p_bronze_early', skillId: 'sword_slash', tier: 'bronze', slot: 1 },
      ],
      bagSlots: [{ instanceId: 'b_bronze', skillId: 'sword_slash', tier: 'bronze' }],
    };
    const { state: next, outcome } = resolveEventChoice(rigged, 'cinderworks_regrind', 'regrind');
    expect(outcome).toEqual({
      kind: 'upgradeCardPick',
      options: [
        { instanceId: 'p_silver', skillId: 'sword_slash', from: 'silver', to: 'gold' },
        { instanceId: 'p_bronze_early', skillId: 'sword_slash', from: 'bronze', to: 'silver' },
        { instanceId: 'p_bronze_late', skillId: 'sword_slash', from: 'bronze', to: 'silver' },
        { instanceId: 'b_bronze', skillId: 'sword_slash', from: 'bronze', to: 'silver' },
      ],
    });
    // Cost is paid up front, but nothing is upgraded yet — the pick is deferred.
    expect(next.gold).toBe(5); // 10 - the 5-gold cost, no fallback gold added
    expect(next.pieces).toEqual(rigged.pieces);
    expect(next.bagSlots).toEqual(rigged.bagSlots);
  });

  it('applyUpgradeCardPick bumps exactly the tapped BOARD instance, leaving every other owned card untouched', () => {
    const { state } = stateAtFirstEvent(4);
    const rigged: RunState = {
      ...state,
      gold: 10,
      pieces: [
        { instanceId: 'p_silver', skillId: 'sword_slash', tier: 'silver', slot: 0 },
        { instanceId: 'p_bronze_late', skillId: 'sword_slash', tier: 'bronze', slot: 3 },
        { instanceId: 'p_bronze_early', skillId: 'sword_slash', tier: 'bronze', slot: 1 },
      ],
      bagSlots: [{ instanceId: 'b_bronze', skillId: 'sword_slash', tier: 'bronze' }],
    };
    const { state: afterChoice } = resolveEventChoice(rigged, 'cinderworks_regrind', 'regrind');
    const { state: next, outcome } = applyUpgradeCardPick(afterChoice, 'p_bronze_early');
    expect(outcome).toEqual({ kind: 'upgradeCard', skillId: 'sword_slash', from: 'bronze', to: 'silver' });
    // The TAPPED bronze board piece upgraded, not the other bronze copies.
    expect(next.pieces.find((p) => p.instanceId === 'p_bronze_early')!.tier).toBe('silver');
    expect(next.pieces.find((p) => p.instanceId === 'p_bronze_late')!.tier).toBe('bronze');
    expect(next.pieces.find((p) => p.instanceId === 'p_silver')!.tier).toBe('silver');
    expect(next.bagSlots[0]!.tier).toBe('bronze');
  });

  it('applyUpgradeCardPick bumps exactly the tapped BAG instance when that is what the player chose', () => {
    const { state } = stateAtFirstEvent(4);
    const rigged: RunState = {
      ...state,
      gold: 10,
      pieces: [{ instanceId: 'p_gold', skillId: 'sword_slash', tier: 'gold', slot: 0 }],
      bagSlots: [
        { instanceId: 'b_gold', skillId: 'sword_slash', tier: 'gold' },
        { instanceId: 'b_bronze', skillId: 'sword_slash', tier: 'bronze' },
      ],
    };
    const { state: afterChoice, outcome: pick } = resolveEventChoice(rigged, 'cinderworks_regrind', 'regrind');
    // Board options precede bag options; within the bag, array order is preserved.
    expect(pick).toEqual({
      kind: 'upgradeCardPick',
      options: [
        { instanceId: 'p_gold', skillId: 'sword_slash', from: 'gold', to: 'diamond' },
        { instanceId: 'b_gold', skillId: 'sword_slash', from: 'gold', to: 'diamond' },
        { instanceId: 'b_bronze', skillId: 'sword_slash', from: 'bronze', to: 'silver' },
      ],
    });
    const { state: next, outcome } = applyUpgradeCardPick(afterChoice, 'b_bronze');
    expect(outcome).toEqual({ kind: 'upgradeCard', skillId: 'sword_slash', from: 'bronze', to: 'silver' });
    expect(next.bagSlots[1]!.tier).toBe('silver');
    expect(next.bagSlots[0]!.tier).toBe('gold');
    expect(next.pieces[0]!.tier).toBe('gold');
  });

  it('every tier bumps exactly one rung (bronze->silver, silver->gold, gold->diamond)', () => {
    const { state } = stateAtFirstEvent(4);
    for (const [from, to] of [
      ['bronze', 'silver'],
      ['silver', 'gold'],
      ['gold', 'diamond'],
    ] as const) {
      const rigged: RunState = {
        ...state,
        gold: 10,
        pieces: [{ instanceId: 'p', skillId: 'sword_slash', tier: from, slot: 0 }],
        bagSlots: [],
      };
      const { state: afterChoice, outcome: pick } = resolveEventChoice(rigged, 'cinderworks_regrind', 'regrind');
      expect(pick).toEqual({ kind: 'upgradeCardPick', options: [{ instanceId: 'p', skillId: 'sword_slash', from, to }] });
      const { outcome } = applyUpgradeCardPick(afterChoice, 'p');
      expect(outcome).toEqual({ kind: 'upgradeCard', skillId: 'sword_slash', from, to });
    }
  });

  it('applyUpgradeCardPick falls back gracefully (fellBack:true, CARD_FALLBACK_GOLD credited) if the picked instanceId no longer resolves to an eligible owned card', () => {
    const { state } = stateAtFirstEvent(4);
    const rigged: RunState = {
      ...state,
      gold: 5,
      pieces: [{ instanceId: 'p', skillId: 'sword_slash', tier: 'bronze', slot: 0 }],
      bagSlots: [],
    };
    const { state: next, outcome } = applyUpgradeCardPick(rigged, 'no_such_instance');
    expect(outcome).toEqual({ kind: 'upgradeCard', fellBack: true });
    expect(next.gold).toBe(5 + 2); // fallback gold credited, the untouched bronze piece is left alone
    expect(next.pieces[0]!.tier).toBe('bronze');
  });

  it('diamond-guard: falls back gracefully (fellBack:true, CARD_FALLBACK_GOLD credited) when every owned card is already diamond', () => {
    const { state } = stateAtFirstEvent(4);
    const rigged: RunState = {
      ...state,
      gold: 10,
      pieces: [{ instanceId: 'p_diamond', skillId: 'sword_slash', tier: 'diamond', slot: 0 }],
      bagSlots: [{ instanceId: 'b_diamond', skillId: 'sword_slash', tier: 'diamond' }],
    };
    const { state: next, outcome } = resolveEventChoice(rigged, 'cinderworks_regrind', 'regrind');
    expect(outcome).toEqual({ kind: 'upgradeCard', fellBack: true });
    expect(next.gold).toBe(10 - 5 + 2); // cost paid, then fallback gold credited
    expect(next.pieces[0]!.tier).toBe('diamond');
    expect(next.bagSlots[0]!.tier).toBe('diamond');
  });

  it('fellBack path also covers owning no cards at all', () => {
    const { state } = stateAtFirstEvent(4);
    const rigged: RunState = { ...state, gold: 10, pieces: [], bagSlots: [] };
    const { state: next, outcome } = resolveEventChoice(rigged, 'cinderworks_regrind', 'regrind');
    expect(outcome).toEqual({ kind: 'upgradeCard', fellBack: true });
    expect(next.gold).toBe(10 - 5 + 2);
  });

  it('is deterministic (pure, no Rng): identical input state -> identical outcome and next state, repeatedly', () => {
    const { state } = stateAtFirstEvent(4);
    const rigged: RunState = {
      ...state,
      gold: 10,
      pieces: [{ instanceId: 'p', skillId: 'sword_slash', tier: 'bronze', slot: 0 }],
      bagSlots: [],
    };
    const a = resolveEventChoice(rigged, 'cinderworks_regrind', 'regrind');
    const b = resolveEventChoice(rigged, 'cinderworks_regrind', 'regrind');
    expect(b.outcome).toEqual(a.outcome);
    expect(b.state.pieces).toEqual(a.state.pieces);
  });

  // DELETED: "ember_pit's free gamble can resolve to an upgradeCard pick
  // (sweeping eventSeed for a hit)". The no-RNG-on-rewards ruling converted
  // ember_pit's free `reach_in` choice from a 50/50 gamble (upgradeCard /
  // nothing) to a guaranteed `grantGold(1)` — its paid `pay_tender` choice
  // was ALREADY a guaranteed grantGem, independent of the old gamble's
  // winning branch, so `upgradeCard` is no longer reachable through
  // `ember_pit` at all (only through cinderworks_regrind/retiring_smith's
  // paid, deterministic choices, already covered above in this describe
  // block). Replaced with a determinism check on `reach_in` itself.
  it("ember_pit's free choice (reach_in) always grants exactly 1 gold — no chance of upgradeCard or nothing", () => {
    const { state } = stateAtFirstEvent(4);
    for (let i = 0; i < 10; i++) {
      const node = { ...currentEventNodeOrThrow(state), eventSeed: i };
      const rigged: RunState = { ...state, map: replaceNode(state.map, node), gold: 0 };
      const { outcome } = resolveEventChoice(rigged, 'ember_pit', 'reach_in');
      expect(outcome).toEqual({ kind: 'grantGold', amount: 1 });
    }
  });

  it('never changes RunStats.eventsResolved beyond the standard +1', () => {
    const { state } = stateAtFirstEvent(4);
    const rigged: RunState = {
      ...state,
      gold: 10,
      pieces: [{ instanceId: 'p', skillId: 'sword_slash', tier: 'bronze', slot: 0 }],
      bagSlots: [],
    };
    const { state: next } = resolveEventChoice(rigged, 'cinderworks_regrind', 'regrind');
    expect(next.stats.eventsResolved).toBe(rigged.stats.eventsResolved + 1);
  });
});

describe('run/events: cardChoice/gemChoice (the 2026-08-18 agency widening)', () => {
  it('BEFORE/AFTER — search_thoroughly (abandoned_cache) was a 1-of-1 grantCard, is now a 1-of-3 pick', () => {
    // BEFORE (documented for the record, not executable): outcome was
    // `{ kind: 'grantCard', tier: 'bronze' }` — a single blind `rng.pick`,
    // no deferred choice, no way for the UI to show anything but the
    // already-resolved card.
    const before = eventCatalog.abandoned_cache!.choices.find((c) => c.id === 'search_thoroughly')!.outcome;
    expect(before).toEqual({ kind: 'cardChoice', tier: 'bronze' });

    // AFTER: resolving the choice returns a deferred pick of 3 DISTINCT
    // bronze cards (the `bonusDraft`-shaped `EventOutcome`, reused verbatim)
    // instead of a single resolved card.
    const { state } = stateAtFirstEvent(4);
    const { outcome } = resolveEventChoice({ ...state, gold: 5 }, 'abandoned_cache', 'search_thoroughly');
    expect(outcome.kind).toBe('bonusDraft');
    if (outcome.kind !== 'bonusDraft') return;
    expect(outcome.cards).toHaveLength(3);
    expect(new Set(outcome.cards.map((c) => c.skillId)).size).toBe(3);
    for (const card of outcome.cards) expect(card.tier).toBe('bronze');
  });

  it('BEFORE/AFTER — rifle (gemsellers_mishap) was a 1-of-1 grantGem, is now a 1-of-3 pick', () => {
    const before = eventCatalog.gemsellers_mishap!.choices.find((c) => c.id === 'rifle')!.outcome;
    expect(before).toEqual({ kind: 'gemChoice' });

    const { state } = stateAtFirstEvent(4);
    const { state: afterChoice, outcome } = resolveEventChoice({ ...state, gold: 5 }, 'gemsellers_mishap', 'rifle');
    expect(outcome.kind).toBe('gemChoicePick');
    if (outcome.kind !== 'gemChoicePick') return;
    expect(outcome.options).toHaveLength(3);
    expect(new Set(outcome.options).size).toBe(3);
    for (const gemId of outcome.options) expect(gemBook[gemId]).toBeDefined();
    // Nothing granted yet — same "roll now, pick later, mutate nothing until
    // the tap" contract as bonusDraft/upgradeCard.
    expect(afterChoice.gemInventory).toEqual(state.gemInventory);
  });

  it('applyGemChoicePick installs exactly the tapped gem id and nothing else', () => {
    const { state } = stateAtFirstEvent(4);
    const { state: afterChoice, outcome } = resolveEventChoice({ ...state, gold: 5 }, 'gemsellers_mishap', 'rifle');
    if (outcome.kind !== 'gemChoicePick') throw new Error('expected gemChoicePick');
    const picked = outcome.options[1]!;
    const { state: final, outcome: finalOutcome } = applyGemChoicePick(afterChoice, picked);
    expect(finalOutcome).toEqual({ kind: 'grantGem', gemId: picked });
    expect(final.gemInventory).toEqual([...afterChoice.gemInventory, picked]);
  });

  it('applyGemChoicePick throws on an unknown gem id (defensive — the picker only ever passes back an offered option)', () => {
    const { state } = stateAtFirstEvent(4);
    expect(() => applyGemChoicePick(state, 'not_a_real_gem_id')).toThrow();
  });

  it('cardChoice respects its filter — tithe (crossroads_shrine) only offers holy/dark cards', () => {
    const { state } = stateAtFirstEvent(4);
    const { outcome } = resolveEventChoice({ ...state, gold: 5 }, 'crossroads_shrine', 'tithe');
    expect(outcome.kind).toBe('bonusDraft');
    if (outcome.kind !== 'bonusDraft') return;
    expect(outcome.cards).toHaveLength(3);
    for (const card of outcome.cards) {
      const skill = skillBook[card.skillId]!;
      expect(['holy', 'dark']).toContain(skill.element);
    }
  });

  it('is deterministic: identical (state, choiceId) resolves to the identical 1-of-3 offer, repeatedly', () => {
    const { state } = stateAtFirstEvent(4);
    const withGold = { ...state, gold: 5 };
    const a = resolveEventChoice(withGold, 'gemsellers_mishap', 'rifle');
    const b = resolveEventChoice(withGold, 'gemsellers_mishap', 'rifle');
    expect(b.outcome).toEqual(a.outcome);
    const c = resolveEventChoice(withGold, 'abandoned_cache', 'search_thoroughly');
    const d = resolveEventChoice(withGold, 'abandoned_cache', 'search_thoroughly');
    expect(d.outcome).toEqual(c.outcome);
  });

  it("widening one choice's own draw does not perturb ANY other (node, choice) pair's roll — each choice's Rng is seeded independently", () => {
    const { state } = stateAtFirstEvent(4);
    const withGold = { ...state, gold: 5 };
    // A sibling choice's outcome (deface, an unrelated grantGold) on the SAME
    // event must be byte-identical whether or not `tithe` (the widened
    // choice sharing this event) has ever been resolved — proving the two
    // choices' `Rng` instances (each seeded off `hashSeed('event', eventSeed,
    // choiceId)`) never share state.
    const before = resolveEventChoice(withGold, 'crossroads_shrine', 'deface');
    resolveEventChoice(withGold, 'crossroads_shrine', 'tithe'); // widened draw, discarded
    const after = resolveEventChoice(withGold, 'crossroads_shrine', 'deface');
    expect(after.outcome).toEqual(before.outcome);
  });

  // Comprehensive sibling of the two BEFORE/AFTER spot checks above: instead
  // of hand-picking one cardChoice and one gemChoice event, this resolves
  // EVERY cardChoice/gemChoice choice in the live catalog and proves each one
  // actually deals EVENT_CHOICE_SIZE DISTINCT options to the player — the
  // audit's specific ask ("a direct unit test that a player actually
  // receives 3 distinct options from a real resolved choice", not just a
  // pool-size lint) — across the whole vocabulary, not two examples of it.
  it('every cardChoice/gemChoice choice in the catalog resolves to EVENT_CHOICE_SIZE distinct options', () => {
    let cardChoiceChecked = 0;
    let gemChoiceChecked = 0;
    for (const id of eventCatalogIds) {
      const event = eventCatalog[id]!;
      for (const choice of event.choices) {
        if (choice.outcome.kind !== 'cardChoice' && choice.outcome.kind !== 'gemChoice') continue;
        const { state } = stateAtFirstEvent(4);
        const { outcome } = resolveEventChoice({ ...state, gold: choice.cost ?? 0 }, id, choice.id);
        if (choice.outcome.kind === 'cardChoice') {
          cardChoiceChecked++;
          expect(outcome.kind).toBe('bonusDraft');
          if (outcome.kind !== 'bonusDraft') continue;
          expect(outcome.cards).toHaveLength(EVENT_CHOICE_SIZE);
          expect(new Set(outcome.cards.map((c) => c.skillId)).size).toBe(EVENT_CHOICE_SIZE);
        } else {
          gemChoiceChecked++;
          expect(outcome.kind).toBe('gemChoicePick');
          if (outcome.kind !== 'gemChoicePick') continue;
          expect(outcome.options).toHaveLength(EVENT_CHOICE_SIZE);
          expect(new Set(outcome.options).size).toBe(EVENT_CHOICE_SIZE);
        }
      }
    }
    // Sanity on the sweep itself — matches the catalog-lint count test above
    // (13 cardChoice, 12 gemChoice after the 2026-09-02 chain batch; the
    // sweep deliberately includes the GATED events' rungs, since
    // `resolveEventChoice` takes the same known-gap posture for gates as for
    // affordability — the usability predicate is the guard, not the resolver)
    // so a future content edit that silently drops one of these choices out
    // of the vocabulary is also caught here.
    expect(cardChoiceChecked).toBe(13);
    expect(gemChoiceChecked).toBe(12);
  });
});

describe('run/events: sellGem (2026-08-20 — the lapidary event\'s originally-wanted "sell a gem" outcome)', () => {
  // Three real, distinct gem ids (deterministic book order) — used as a
  // synthetic pouch, never the live-catalog roll (this outcome has no `Rng`
  // draw of its own to seed; see `sellGemOutcome`'s doc comment).
  const GEM_IDS = Object.keys(gemBook);
  const gemA = GEM_IDS[0]!;
  const gemB = GEM_IDS[1]!;
  const gemC = GEM_IDS[2]!;

  it('sellGemOutcome offers every pouch gem, in inventory order, priced at sellPriceOfGem', () => {
    const { state } = stateAtFirstEvent(4);
    const withPouch = { ...state, gold: 0, gemInventory: [gemA, gemB, gemC] };
    const { outcome } = resolveEventChoice(withPouch, 'the_lapidary', 'sell_facet');
    expect(outcome.kind).toBe('sellGemPick');
    if (outcome.kind !== 'sellGemPick') return;
    expect(outcome.options).toEqual([
      { pouchIndex: 0, gemId: gemA, price: sellPriceOfGem(gemA) },
      { pouchIndex: 1, gemId: gemB, price: sellPriceOfGem(gemB) },
      { pouchIndex: 2, gemId: gemC, price: sellPriceOfGem(gemC) },
    ]);
  });

  it('resolving sellGem does not itself mutate the pouch or wallet — nothing happens until the pick is finalized', () => {
    const { state } = stateAtFirstEvent(4);
    const withPouch = { ...state, gold: 0, gemInventory: [gemA, gemB] };
    const { state: afterChoice } = resolveEventChoice(withPouch, 'the_lapidary', 'sell_facet');
    expect(afterChoice.gemInventory).toEqual(withPouch.gemInventory);
    expect(afterChoice.gold).toBe(withPouch.gold);
  });

  it('applySellGemPick removes exactly the picked pouch gem and credits exactly its sellPriceOfGem gold', () => {
    const { state } = stateAtFirstEvent(4);
    const withPouch = { ...state, gold: 3, gemInventory: [gemA, gemB, gemC] };
    const price = sellPriceOfGem(gemB);
    const { state: final, outcome } = applySellGemPick(withPouch, 1);
    expect(outcome).toEqual({ kind: 'sellGem', gemId: gemB, price });
    expect(final.gold).toBe(withPouch.gold + price);
    // Exactly gemB's slot is gone — gemA/gemC (and their relative order)
    // survive untouched, not just "the count went down by one".
    expect(final.gemInventory).toEqual([gemA, gemC]);
    expect(final.stats.goldEarned).toBe(withPouch.stats.goldEarned + price);
  });

  it('applySellGemPick throws on an out-of-range/empty pouch index (defensive — the picker only ever passes back an offered index)', () => {
    const { state } = stateAtFirstEvent(4);
    const withPouch = { ...state, gemInventory: [gemA] };
    expect(() => applySellGemPick(withPouch, 5)).toThrow();
    expect(() => applySellGemPick(withPouch, -1)).toThrow();
  });

  it('round-trips through resolveEventChoice -> applySellGemPick exactly like the live picker flow', () => {
    const { state } = stateAtFirstEvent(4);
    const withPouch = { ...state, gold: 0, gemInventory: [gemA, gemB] };
    const { state: afterChoice, outcome: pick } = resolveEventChoice(withPouch, 'the_lapidary', 'sell_facet');
    if (pick.kind !== 'sellGemPick') throw new Error('expected sellGemPick');
    const picked = pick.options[0]!;
    const { state: final, outcome: finalOutcome } = applySellGemPick(afterChoice, picked.pouchIndex);
    expect(finalOutcome).toEqual({ kind: 'sellGem', gemId: picked.gemId, price: picked.price });
    expect(final.gold).toBe(afterChoice.gold + picked.price);
    expect(final.gemInventory).toEqual([gemB]);
  });

  it('sellGemOutcome throws on an empty pouch (defensive — should be gated unusable before resolve, never reached in the live UI)', () => {
    const { state } = stateAtFirstEvent(4);
    const empty = { ...state, gold: 0, gemInventory: [] };
    expect(() => resolveEventChoice(empty, 'the_lapidary', 'sell_facet')).toThrow();
  });

  it('is deterministic: identical (state, choiceId) resolves to the identical option list, repeatedly', () => {
    const { state } = stateAtFirstEvent(4);
    const withPouch = { ...state, gold: 0, gemInventory: [gemA, gemB, gemC] };
    const a = resolveEventChoice(withPouch, 'the_lapidary', 'sell_facet');
    const b = resolveEventChoice(withPouch, 'the_lapidary', 'sell_facet');
    expect(b.outcome).toEqual(a.outcome);
  });

  describe('gating — isEventChoiceUsable', () => {
    const sellChoice = eventCatalog.the_lapidary!.choices.find((c) => c.id === 'sell_facet')!;

    it('a sellGem choice is NOT usable with an empty pouch, even though it is cost-0 (always "affordable")', () => {
      const { state } = stateAtFirstEvent(4);
      const empty = { ...state, gemInventory: [] };
      expect(isEventChoiceAffordable(empty, sellChoice)).toBe(true);
      expect(isEventChoiceUsable(empty, sellChoice)).toBe(false);
    });

    it('a sellGem choice IS usable once the pouch has at least one gem', () => {
      const { state } = stateAtFirstEvent(4);
      const withPouch = { ...state, gemInventory: [gemA] };
      expect(isEventChoiceUsable(withPouch, sellChoice)).toBe(true);
    });

    it('non-sellGem choices are unaffected by the pouch gate — isEventChoiceUsable matches isEventChoiceAffordable for them', () => {
      const { state } = stateAtFirstEvent(4);
      const empty = { ...state, gold: 0, gemInventory: [] };
      const wardingCut = eventCatalog.the_lapidary!.choices.find((c) => c.id === 'warding_cut')!;
      const rejectBin = eventCatalog.the_lapidary!.choices.find((c) => c.id === 'reject_bin')!;
      expect(isEventChoiceUsable(empty, wardingCut)).toBe(isEventChoiceAffordable(empty, wardingCut));
      expect(isEventChoiceUsable(empty, rejectBin)).toBe(isEventChoiceAffordable(empty, rejectBin));
      expect(isEventChoiceUsable(empty, rejectBin)).toBe(true);
    });

    it("the_lapidary is never drawn as an offered event when broke AND pouch-empty is not a real risk — reject_bin (free, non-sellGem) keeps it eligible", () => {
      // Belt-and-suspenders on the catalog invariant: even a player with 0
      // gold AND 0 gems still has a usable, non-nothing choice on this event
      // (`reject_bin`), so `sellGem`'s pouch gate can never soft-lock it.
      const broke = { gold: 0, gemInventory: [] as string[] } as unknown as RunState;
      const usable = eventCatalog.the_lapidary!.choices.some(
        (c) => isEventChoiceUsable(broke, c) && c.outcome.kind !== 'nothing',
      );
      expect(usable).toBe(true);
    });
  });
});

describe('run/events: cardChoice/gemChoice throw on a too-small filtered pool (2026-08-18 QA pass)', () => {
  // A synthetic catalog entry, injected into the (plain, mutable)
  // `eventCatalog` record for the duration of one test and removed
  // immediately after — `resolveEventChoice` looks up `eventId` directly
  // from `eventCatalog`, independent of which event a run node actually
  // drew, so this exercises the REAL resolver/throw path without needing a
  // live catalog entry narrow enough to trip it (none exist today — see the
  // lint test above).
  const RIGGED_ID = '__qa_rigged_narrow_pool__';

  afterEach(() => {
    delete (eventCatalog as Record<string, EventDef>)[RIGGED_ID];
  });

  it('cardChoiceOutcome throws rather than silently dealing fewer than EVENT_CHOICE_SIZE cards', () => {
    // THE FIXTURE POOL: beast + healing. Non-empty (so this is NOT the
    // pre-existing "no skill matches" throw) but narrower than
    // EVENT_CHOICE_SIZE, which is the whole shape being demonstrated.
    //
    // WAS bow + debuff, a 2-card pool until the Q3 affinity-density pass
    // (2026-08-26) added `marksmans_creed` and took it to 3 — bow shipped ONE
    // affinity payoff against 10 on-type cards, so widening it was the point of
    // that pass, and this fixture was collateral. The replacement is chosen to be
    // STRUCTURALLY narrow rather than incidentally narrow: a WEAPON type crossed
    // with `healing` is the thinnest cell in the book by construction (weapons are
    // the physical damage classes, healing is the archetype least of them carry —
    // sword/axe/lance sit at 1 each and bow at 0), so it is the cell a content pass
    // is least likely to widen, and if one does it will widen it by one, not to five.
    //
    // ASSERTED AS THE BOUND, NOT AS A LITERAL. What this test needs is
    // `0 < pool < EVENT_CHOICE_SIZE`; pinning the exact count made a fixture fail
    // for a content change that did not affect what it was proving. This form still
    // fails loudly the moment the pool stops being short — which is the only
    // failure that matters — and names the pool so the fix is obvious.
    const narrowPool = Object.values(skillBook).filter(
      (s) => s.weapon === 'beast' && s.archetypes.includes('healing'),
    );
    const named = narrowPool.map((s) => s.id).join(', ');
    expect(narrowPool.length, `beast+healing is empty — this would test the wrong throw`).toBeGreaterThan(0);
    expect(
      narrowPool.length,
      `beast+healing is no longer shorter than EVENT_CHOICE_SIZE (${named}) — pick another structurally narrow filter, do NOT raise the number`,
    ).toBeLessThan(EVENT_CHOICE_SIZE);
    (eventCatalog as Record<string, EventDef>)[RIGGED_ID] = {
      id: RIGGED_ID,
      title: 'QA rig',
      body: '',
      theme: 'training',
      choices: [
        {
          id: 'narrow',
          label: '',
          outcome: { kind: 'cardChoice', filter: [{ weapons: ['beast'], archetypes: ['healing'] }] },
        },
      ],
    };
    const { state } = stateAtFirstEvent(4);
    expect(() => resolveEventChoice({ ...state, gold: 5 }, RIGGED_ID, 'narrow')).toThrow(/cardChoice/);
  });

  it('gemChoiceOutcome throws rather than silently dealing fewer than EVENT_CHOICE_SIZE gems', () => {
    const twoGemIds = Object.keys(gemBook).slice(0, 2);
    expect(twoGemIds).toHaveLength(2);
    (eventCatalog as Record<string, EventDef>)[RIGGED_ID] = {
      id: RIGGED_ID,
      title: 'QA rig',
      body: '',
      theme: 'training',
      choices: [{ id: 'narrow', label: '', outcome: { kind: 'gemChoice', filter: [{ ids: twoGemIds }] } }],
    };
    const { state } = stateAtFirstEvent(4);
    expect(() => resolveEventChoice({ ...state, gold: 5 }, RIGGED_ID, 'narrow')).toThrow(/gemChoice/);
  });
});

describe('run/events: catalog invariants still hold with the expanded (39-event) catalog', () => {
  it('an event rolled at gold 0 always has an affordable, non-nothing choice (many seeds/nodes)', () => {
    for (let i = 0; i < 20; i++) {
      const seed = i * 41 + 7;
      let state = startedRun(seed);
      expect(state.gold).toBe(0);
      for (let guard = 0; guard < 200; guard++) {
        const choices = availableChoices(state);
        if (choices.length === 0) break;
        const eventNode = choices.find((n) => n.kind === 'event');
        if (eventNode) {
          const { event } = rollEventForNode(state, eventNode);
          const hasPlayableChoice = event.choices.some(
            (c) => isEventChoiceAffordable(state, c) && c.outcome.kind !== 'nothing',
          );
          expect(hasPlayableChoice).toBe(true);
          state = chooseNode(state, eventNode.id);
          state = leaveEvent(state);
          continue;
        }
        const node = choices[0]!;
        state = chooseNode(state, node.id);
        if (node.kind === 'shop') state = leaveShop(state);
        else state = recordBattleResult(state, { won: true, goldEarned: 0 });
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Small helpers for the loseGold-floor test (needs an active event node with
// a specific, swept `eventSeed`).
// ---------------------------------------------------------------------------

function currentEventNodeOrThrow(state: RunState): RunNode {
  const node = currentEventNode(state);
  if (!node) throw new Error('no active event node');
  return node;
}

function replaceNode(map: RunState['map'], replacement: RunNode): RunState['map'] {
  return {
    ...map,
    depths: map.depths.map((column) => column.map((n) => (n.id === replacement.id ? replacement : n))),
  };
}
