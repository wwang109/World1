import { describe, expect, it } from 'vitest';
import { eventCatalog, eventCatalogIds, type EventChoiceOutcome, type EventOutcomeSpec } from '../../src/data/events';
import { skillBook } from '../../src/data/skills';
import { gemBook } from '../../src/data/gems';
import {
  applyBonusDraftPick,
  applyUpgradeCardPick,
  isEventChoiceAffordable,
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

/** Every non-gamble outcome kind in the vocabulary, for the catalog lint. */
const OUTCOME_KINDS = new Set(['grantCard', 'grantGem', 'grantGold', 'loseGold', 'grantLevel', 'bonusDraft', 'upgradeCard', 'nothing']);

function isSafe(choice: { cost?: number; outcome: EventChoiceOutcome }): boolean {
  if ((choice.cost ?? 0) > 0) return false;
  if (choice.outcome.kind !== 'gamble') return true;
  return choice.outcome.table.some((row) => row.outcome.kind === 'nothing');
}

describe('data/events: catalog lint', () => {
  it('has exactly 28 events, each with a unique id', () => {
    expect(eventCatalogIds.length).toBe(28);
    expect(new Set(eventCatalogIds).size).toBe(28);
  });

  it('every event has a theme', () => {
    for (const id of eventCatalogIds) {
      const event = eventCatalog[id]!;
      expect(['training', 'cache', 'recruit', 'forge', 'market', 'omen']).toContain(event.theme);
    }
  });

  it('every theme has at least 2 events', () => {
    const counts: Record<string, number> = {};
    for (const id of eventCatalogIds) {
      const theme = eventCatalog[id]!.theme;
      counts[theme] = (counts[theme] ?? 0) + 1;
    }
    for (const theme of ['training', 'cache', 'recruit', 'forge', 'market', 'omen']) {
      expect(counts[theme] ?? 0).toBeGreaterThanOrEqual(2);
    }
  });

  it('every event has 2-3 choices', () => {
    for (const id of eventCatalogIds) {
      const event = eventCatalog[id]!;
      expect(event.choices.length).toBeGreaterThanOrEqual(2);
      expect(event.choices.length).toBeLessThanOrEqual(3);
    }
  });

  it('every event has a genuinely safe exit (cost 0, worst gamble branch is nothing)', () => {
    for (const id of eventCatalogIds) {
      const event = eventCatalog[id]!;
      expect(event.choices.some(isSafe)).toBe(true);
    }
  });

  it('at most one gamble choice per event', () => {
    for (const id of eventCatalogIds) {
      const event = eventCatalog[id]!;
      const gambles = event.choices.filter((c) => c.outcome.kind === 'gamble');
      expect(gambles.length).toBeLessThanOrEqual(1);
    }
  });

  it('every outcome (and every gamble row) uses only vocabulary kinds, and gambles never nest', () => {
    for (const id of eventCatalogIds) {
      const event = eventCatalog[id]!;
      for (const choice of event.choices) {
        if (choice.outcome.kind === 'gamble') {
          for (const row of choice.outcome.table) {
            expect(OUTCOME_KINDS.has(row.outcome.kind)).toBe(true);
          }
        } else {
          expect(OUTCOME_KINDS.has(choice.outcome.kind)).toBe(true);
        }
      }
    }
  });

  it('every gamble table sums to exactly 100', () => {
    for (const id of eventCatalogIds) {
      const event = eventCatalog[id]!;
      for (const choice of event.choices) {
        if (choice.outcome.kind !== 'gamble') continue;
        const total = choice.outcome.table.reduce((sum, row) => sum + row.weight, 0);
        expect(total).toBe(100);
      }
    }
  });

  it('every fixed grantCard/grantGem id and filter resolves to a real, non-empty pool', () => {
    for (const id of eventCatalogIds) {
      const event = eventCatalog[id]!;
      const specs: EventOutcomeSpec[] = event.choices.flatMap((c) =>
        c.outcome.kind === 'gamble' ? c.outcome.table.map((r) => r.outcome) : [c.outcome],
      );
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
      const specs: EventOutcomeSpec[] = event.choices.flatMap((c) =>
        c.outcome.kind === 'gamble' ? c.outcome.table.map((r) => r.outcome) : [c.outcome],
      );
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

  // A stake belongs in `cost`, never in a `loseGold` branch: loseGold floors at
  // 0, so a table pairing grantGold with loseGold is a free coin-flip that mints
  // gold for a broke player (the bug this test locks out).
  it('never models a wager as grantGold-vs-loseGold in one gamble table', () => {
    for (const event of Object.values(eventCatalog)) {
      for (const choice of event.choices) {
        if (choice.outcome.kind !== 'gamble') continue;
        const kinds = choice.outcome.table.map((r) => r.outcome.kind);
        const wagered = kinds.includes('grantGold') && kinds.includes('loseGold');
        expect(wagered, `${event.id}/${choice.id} should use \`cost\` for its stake`).toBe(false);
      }
    }
  });

  it('gates every gold-costing choice behind an affordable wallet', () => {
    for (const event of Object.values(eventCatalog)) {
      for (const choice of event.choices) {
        // A choice that can PAY OUT gold must charge for the privilege, else it
        // is free money; flat small grants (<= one fight's income) are fine.
        if (choice.outcome.kind !== 'gamble') continue;
        const payout = choice.outcome.table
          .map((r) => (r.outcome.kind === 'grantGold' ? r.outcome.amount : 0))
          .reduce((a, b) => Math.max(a, b), 0);
        if (payout > 2) expect(choice.cost ?? 0).toBeGreaterThan(0);
      }
    }
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

  it('the event bag never repeats a catalog id within one cycle', () => {
    // Drive a synthetic sequence of distinct event nodes through the SAME
    // state, forcing bag draws in order, and check no id repeats until the
    // bag would need to refill.
    let state = startedRun(9);
    const drawn: string[] = [];
    for (let i = 0; i < eventCatalogIds.length; i++) {
      const fakeNode = { id: `fake-${i}`, depth: 1, wave: 1, kind: 'event' as const, eventSeed: i };
      const result = rollEventForNode(state, fakeNode);
      drawn.push(result.event.id);
      state = result.state;
    }
    expect(new Set(drawn).size).toBe(eventCatalogIds.length);
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

  it('falls back to the untyped all-catalog bag when eventTheme is absent (defensive path)', () => {
    let state = startedRun(14);
    const fakeNode = { id: 'no-theme', depth: 1, wave: 1, kind: 'event' as const, eventSeed: 1 };
    const result = rollEventForNode(state, fakeNode);
    expect(eventCatalogIds).toContain(result.event.id);
    expect(result.state.eventBag.length).toBe(eventCatalogIds.length - 1);
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
    expect(outcome).toEqual({ kind: 'grantGold', amount: 1, gambled: false });
    expect(next.gold).toBe(6);
  });

  it('cost is deducted before the outcome resolves', () => {
    const { state } = stateAtFirstEvent(4);
    const withGold = { ...state, gold: 10 };
    const { state: next } = resolveEventChoice(withGold, 'wandering_tutor', 'pay');
    expect(next.gold).toBe(7);
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
  // callers post-fix — same "kept, not deleted" status as the rest of the
  // gamble machinery). This test now proves the fix directly instead of
  // sweeping for a dead outcome kind.
  it("beast_nest's FREE choice (raid_it, cost 0) can no longer take gold — always grants +1 gold now, never loseGold", () => {
    const { state } = stateAtFirstEvent(4);
    for (let i = 0; i < 20; i++) {
      const node = { ...currentEventNodeOrThrow(state), eventSeed: i };
      const withNode: RunState = { ...state, map: replaceNode(state.map, node) };
      const withGold = { ...withNode, gold: 1 };
      const { outcome, state: next } = resolveEventChoice(withGold, 'beast_nest', 'raid_it');
      expect(outcome).toEqual({ kind: 'grantGold', amount: 1, gambled: false });
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
    expect(outcome).toEqual({ kind: 'grantGold', amount: 2, fellBack: true, gambled: false });
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

  // DELETED: "a gamble outcome is flagged gambled:true" (used to resolve
  // abandoned_cache/open, previously a 60/40 gamble). The no-RNG-on-rewards
  // ruling converted all 11 former gamble choices in the catalog to
  // deterministic outcomes, so the catalog now contains ZERO live `gamble`
  // choices — there is no real event left through the public API that can
  // exercise `gambled: true`. The `gambled` flag/plumbing itself is
  // untouched (kept per the ruling, a verified-in-a-running-game follow-up
  // removes the machinery); only the test asserting a currently-impossible
  // outcome is gone. The sibling `gambled:false` case below still covers the
  // flag's OTHER value.
  it('a non-gamble outcome is flagged gambled:false', () => {
    const { state } = stateAtFirstEvent(4);
    const { outcome } = resolveEventChoice({ ...state, gold: 5 }, 'crossroads_shrine', 'deface');
    expect(outcome.gambled).toBe(false);
  });

  it('throws when no event node is currently active', () => {
    const state = startedRun(4);
    expect(() => resolveEventChoice(state, 'wandering_tutor', 'pay')).toThrow();
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
      gambled: false,
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
      gambled: false,
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
      expect(pick).toEqual({ kind: 'upgradeCardPick', gambled: false, options: [{ instanceId: 'p', skillId: 'sword_slash', from, to }] });
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
    expect(outcome).toEqual({ kind: 'upgradeCard', fellBack: true, gambled: false });
    expect(next.gold).toBe(10 - 5 + 2); // cost paid, then fallback gold credited
    expect(next.pieces[0]!.tier).toBe('diamond');
    expect(next.bagSlots[0]!.tier).toBe('diamond');
  });

  it('fellBack path also covers owning no cards at all', () => {
    const { state } = stateAtFirstEvent(4);
    const rigged: RunState = { ...state, gold: 10, pieces: [], bagSlots: [] };
    const { state: next, outcome } = resolveEventChoice(rigged, 'cinderworks_regrind', 'regrind');
    expect(outcome).toEqual({ kind: 'upgradeCard', fellBack: true, gambled: false });
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
      expect(outcome).toEqual({ kind: 'grantGold', amount: 1, gambled: false });
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

describe('run/events: catalog invariants still hold with the expanded (28-event) catalog', () => {
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
