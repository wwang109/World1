import { describe, expect, it } from 'vitest';
import { eventCatalog, eventCatalogIds } from '../../src/data/events';
import {
  applyDraftResult,
  availableChoices,
  buyRunCard,
  buyRunGem,
  chooseNode,
  createRun,
  DAILY_INCOME,
  emptyRunStats,
  ensureRunShopShelf,
  leaveEvent,
  leaveShop,
  recordBattleResult,
  rerollRunShop,
  type RunNode,
  type RunState,
} from '../../src/run/runState';
import { resolveEventChoice, rollEventForNode } from '../../src/run/events';
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

/** Walk forward, always taking the first available choice, browsing (not
 * buying) shops, leaving events unresolved, and winning every fight/boss —
 * for `steps` node commits. Mirrors the walker idiom in `runState.test.ts`. */
function walkNodes(seed: number, steps: number): RunState {
  let state = startedRun(seed);
  for (let i = 0; i < steps; i++) {
    const choices = availableChoices(state);
    if (choices.length === 0) throw new Error(`run ended before ${steps} steps`);
    const node = choices[0]!;
    state = chooseNode(state, node.id);
    if (node.kind === 'shop') state = leaveShop(state);
    else if (node.kind === 'event') state = leaveEvent(state);
    else state = recordBattleResult(state, { won: true, goldEarned: 1 });
  }
  return state;
}

function stateAtFirstShop(seed: number): { state: RunState; nodeId: string } {
  let state = startedRun(seed);
  for (let guard = 0; guard < 200; guard++) {
    const choices = availableChoices(state);
    if (choices.length === 0) throw new Error('no shop node reachable for this seed');
    const shop = choices.find((n) => n.kind === 'shop');
    if (shop) {
      state = chooseNode(state, shop.id);
      return { state, nodeId: shop.id };
    }
    const node = choices[0]!;
    state = chooseNode(state, node.id);
    if (node.kind === 'event') state = leaveEvent(state);
    else if (node.kind === 'boss' || node.kind === 'fight') state = recordBattleResult(state, { won: true, goldEarned: 1 });
  }
  throw new Error('guard exceeded while looking for a shop node');
}

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

/** First catalog choice (any event) matching `pred`, paired with its event id. */
function findChoice(
  pred: (choice: (typeof eventCatalog)[string]['choices'][number]) => boolean,
): { eventId: string; choiceId: string } | undefined {
  for (const id of eventCatalogIds) {
    const choice = eventCatalog[id]!.choices.find(pred);
    if (choice) return { eventId: id, choiceId: choice.id };
  }
  return undefined;
}

describe('run/runState: RunStats — shape + initial value', () => {
  it('emptyRunStats is all zero', () => {
    expect(emptyRunStats()).toEqual({
      damageDealt: 0,
      damageTaken: 0,
      healingDone: 0,
      goldEarned: 0,
      goldSpent: 0,
      cardsBought: 0,
      gemsBought: 0,
      eventsResolved: 0,
      deepestWave: 0,
      livesLost: 0,
    });
  });

  it('createRun starts with an all-zero stats ledger', () => {
    expect(createRun(1).stats).toEqual(emptyRunStats());
  });
});

describe('run/runState: RunStats — chooseNode (deepestWave/goldEarned)', () => {
  it('tracks deepest wave and daily-income goldEarned across several node commits', () => {
    const state = walkNodes(11, 4);
    expect(state.stats.deepestWave).toBeGreaterThanOrEqual(1);
    // 4 node commits -> at least 4 * DAILY_INCOME earned (fight wins add more on top).
    expect(state.stats.goldEarned).toBeGreaterThanOrEqual(4 * DAILY_INCOME);
  });

  it('never regresses deepestWave (monotonic)', () => {
    let state = startedRun(3);
    let prevWave = 0;
    for (let i = 0; i < 6; i++) {
      const choices = availableChoices(state);
      if (choices.length === 0) break;
      const node = choices[0]!;
      state = chooseNode(state, node.id);
      expect(state.stats.deepestWave).toBeGreaterThanOrEqual(prevWave);
      prevWave = state.stats.deepestWave;
      if (node.kind === 'shop') state = leaveShop(state);
      else if (node.kind === 'event') state = leaveEvent(state);
      else state = recordBattleResult(state, { won: true, goldEarned: 1 });
    }
  });

  it('chooseNode returns a NEW state object (immutability)', () => {
    const state = startedRun(1);
    const node = availableChoices(state)[0]!;
    const before = state.stats;
    const after = chooseNode(state, node.id);
    expect(after).not.toBe(state);
    expect(after.stats).not.toBe(before);
    expect(state.stats).toEqual(emptyRunStats()); // original untouched
  });
});

describe('run/runState: RunStats — recordBattleResult (damage/heal/gold/livesLost)', () => {
  function stateAtFirstFight(seed: number): RunState {
    let state = startedRun(seed);
    for (let guard = 0; guard < 200; guard++) {
      const choices = availableChoices(state);
      if (choices.length === 0) throw new Error('no fight node reachable for this seed');
      const node = choices[0]!;
      state = chooseNode(state, node.id);
      if (node.kind === 'fight' || node.kind === 'boss') return state;
      if (node.kind === 'shop') state = leaveShop(state);
      else state = leaveEvent(state);
    }
    throw new Error('guard exceeded while looking for a fight node');
  }

  it('a win folds damageDealt/damageTaken/healingDone/goldEarned into stats', () => {
    const state = stateAtFirstFight(1);
    const before = state.stats;
    const after = recordBattleResult(state, {
      won: true,
      goldEarned: 7,
      damageDealt: 40,
      damageTaken: 12,
      healingDone: 5,
    });
    expect(after).not.toBe(state);
    expect(after.stats).not.toBe(before);
    expect(after.stats.damageDealt).toBe(before.damageDealt + 40);
    expect(after.stats.damageTaken).toBe(before.damageTaken + 12);
    expect(after.stats.healingDone).toBe(before.healingDone + 5);
    expect(after.stats.goldEarned).toBe(before.goldEarned + 7);
    expect(after.stats.livesLost).toBe(before.livesLost);
    // original state's stats are untouched.
    expect(state.stats).toEqual(before);
  });

  it('a loss still folds damage/heal deltas but NOT gold, and increments livesLost', () => {
    const state = stateAtFirstFight(2);
    const before = state.stats;
    const livesBefore = state.lives;
    const after = recordBattleResult(state, {
      won: false,
      goldEarned: 99, // ignored on a loss, same as `gold` itself
      damageDealt: 8,
      damageTaken: 30,
      healingDone: 2,
    });
    expect(after.lives).toBe(livesBefore - 1);
    expect(after.stats.goldEarned).toBe(before.goldEarned); // no gold on a loss
    expect(after.stats.damageDealt).toBe(before.damageDealt + 8);
    expect(after.stats.damageTaken).toBe(before.damageTaken + 30);
    expect(after.stats.healingDone).toBe(before.healingDone + 2);
    expect(after.stats.livesLost).toBe(before.livesLost + 1);
  });

  it('omitted battle-stats fields default to +0 (byte-identical to existing {won, goldEarned} call sites)', () => {
    const state = stateAtFirstFight(3);
    const before = state.stats;
    const after = recordBattleResult(state, { won: true, goldEarned: 3 });
    expect(after.stats.damageDealt).toBe(before.damageDealt);
    expect(after.stats.damageTaken).toBe(before.damageTaken);
    expect(after.stats.healingDone).toBe(before.healingDone);
  });
});

describe('run/runState: RunStats — shop purchases (goldSpent/cardsBought/gemsBought)', () => {
  it('buyRunCard adds to goldSpent and cardsBought (not gemsBought)', () => {
    let { state, nodeId } = stateAtFirstShop(3);
    state = { ...ensureRunShopShelf(state, nodeId), gold: 20 };
    const offer = state.shopShelves[nodeId]!.cards[0];
    if (!offer) return; // this seed's shelf had no cards this run
    const before = state.stats;
    const result = buyRunCard(state, nodeId, 0);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.stats.goldSpent).toBe(before.goldSpent + offer.price);
    expect(result.state.stats.cardsBought).toBe(before.cardsBought + 1);
    expect(result.state.stats.gemsBought).toBe(before.gemsBought);
    expect(state.stats).toBe(before); // original untouched
  });

  it('a failed buyRunCard (insufficient gold) does not touch stats', () => {
    let { state, nodeId } = stateAtFirstShop(3);
    state = { ...ensureRunShopShelf(state, nodeId), gold: 0 };
    if (!state.shopShelves[nodeId]!.cards[0]) return;
    const result = buyRunCard(state, nodeId, 0);
    expect(result.ok).toBe(false);
    expect(result.state.stats).toEqual(state.stats);
  });

  it('buyRunGem adds to goldSpent and gemsBought (not cardsBought)', () => {
    let { state, nodeId } = stateAtFirstShop(5);
    state = { ...ensureRunShopShelf(state, nodeId), gold: 20 };
    const offer = state.shopShelves[nodeId]!.gems[0];
    if (!offer) return;
    const before = state.stats;
    const result = buyRunGem(state, nodeId, 0);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.stats.goldSpent).toBe(before.goldSpent + offer.price);
    expect(result.state.stats.gemsBought).toBe(before.gemsBought + 1);
    expect(result.state.stats.cardsBought).toBe(before.cardsBought);
  });

  it('rerollRunShop spends 1 gold into stats.goldSpent', () => {
    let { state, nodeId } = stateAtFirstShop(1);
    state = { ...ensureRunShopShelf(state, nodeId), gold: 5 };
    const before = state.stats.goldSpent;
    const rerolled = rerollRunShop(state, nodeId);
    expect(rerolled.stats.goldSpent).toBe(before + 1);
  });

  it('rerollRunShop no-op (unaffordable) leaves stats untouched', () => {
    let { state, nodeId } = stateAtFirstShop(1);
    state = { ...ensureRunShopShelf(state, nodeId), gold: 0 };
    const rerolled = rerollRunShop(state, nodeId);
    expect(rerolled).toBe(state);
    expect(rerolled.stats).toBe(state.stats);
  });
});

describe('run/runState: RunStats — event resolution (eventsResolved/goldEarned/goldSpent)', () => {
  it('resolveEventChoice increments eventsResolved by exactly 1, for whichever event actually drew on this node', () => {
    const { state: atNode, node } = stateAtFirstEvent(2);
    const { state, event } = rollEventForNode(atNode, node);
    // Pick the event's own genuinely-safe choice (cost 0) — every catalog
    // event guarantees at least one (see the events catalog lint).
    const safeChoice = event.choices.find((c) => (c.cost ?? 0) === 0) ?? event.choices[0]!;
    const before = state.stats.eventsResolved;
    const { state: after } = resolveEventChoice(state, event.id, safeChoice.id);
    expect(after.stats.eventsResolved).toBe(before + 1);
  });

  it('a cost > 0 choice adds to goldSpent, and its non-gold outcome does not touch cardsBought/gemsBought', () => {
    const costly = findChoice((c) => (c.cost ?? 0) > 0);
    expect(costly).toBeDefined();
    if (!costly) return;
    let { state } = stateAtFirstEvent(2);
    state = { ...state, gold: 50 };
    const before = state.stats;
    const cost = eventCatalog[costly.eventId]!.choices.find((c) => c.id === costly.choiceId)!.cost!;
    const { state: after } = resolveEventChoice(state, costly.eventId, costly.choiceId);
    expect(after.stats.goldSpent).toBe(before.goldSpent + cost);
    expect(after.stats.eventsResolved).toBe(before.eventsResolved + 1);
    expect(after.stats.cardsBought).toBe(before.cardsBought);
    expect(after.stats.gemsBought).toBe(before.gemsBought);
    // original untouched
    expect(state.stats).toBe(before);
  });

  it('a free grantGold choice adds the full amount to goldEarned', () => {
    const grant = findChoice((c) => (c.cost ?? 0) === 0 && c.outcome.kind === 'grantGold');
    expect(grant).toBeDefined();
    if (!grant) return;
    const { state } = stateAtFirstEvent(2);
    const before = state.stats.goldEarned;
    const amount = (eventCatalog[grant.eventId]!.choices.find((c) => c.id === grant.choiceId)!.outcome as { kind: 'grantGold'; amount: number }).amount;
    const { state: after } = resolveEventChoice(state, grant.eventId, grant.choiceId);
    expect(after.stats.goldEarned).toBe(before + amount);
    expect(after.stats.eventsResolved).toBe(state.stats.eventsResolved + 1);
  });
});
