import { describe, expect, it } from 'vitest';
import {
  applyDraftResult,
  availableChoices,
  buyHeroStatAllocation,
  buyRunCard,
  buyRunGem,
  chooseNode,
  createRun,
  currentEventNode,
  currentShopNode,
  ensureRunShopShelf,
  FIGHT_TABLE,
  heroAllocationCost,
  leaveEvent,
  leaveShop,
  recordBattleResult,
  rerollRunShop,
  rollEncounter,
  runBagHasRoomFor,
  setHeroAllocation,
  type RunState,
} from '../../src/run/runState';
import { rollStartDraft, DRAFT_SET_KEYS, type DraftSetKey } from '../../src/run/draft';
import { rollShopStock } from '../../src/run/shop';
import { totalColumns, WAVE_COUNT } from '../../src/run/runMap';
import { bankedPL, LEVEL_STAT_COST } from '../../src/run/leveling';

function draftPicksFor(seed: number): Partial<Record<DraftSetKey, string>> {
  const draft = rollStartDraft(seed);
  const picks: Partial<Record<DraftSetKey, string>> = {};
  for (const key of DRAFT_SET_KEYS) {
    picks[key] = draft[key][0]!.skillId;
  }
  return picks;
}

function startedRun(seed: number): RunState {
  return applyDraftResult(createRun(seed), draftPicksFor(seed));
}

/** Drive a run all the way to the boss node, always picking the first
 * available choice, always winning fights, browsing (not buying) shops,
 * and leaving events unresolved (no event UI phase yet). */
function driveToBoss(seed: number): RunState {
  let state = startedRun(seed);
  for (;;) {
    const choices = availableChoices(state);
    if (choices.length === 0) break;
    const node = choices[0]!;
    state = chooseNode(state, node.id);
    if (node.kind === 'shop') {
      // Exercise the shop accessor + roll before leaving.
      const shopNode = currentShopNode(state);
      expect(shopNode?.id).toBe(node.id);
      if (shopNode) rollShopStock(shopNode.shopId!, shopNode.shopSeed!);
      state = leaveShop(state);
    } else if (node.kind === 'event') {
      const eventNode = currentEventNode(state);
      expect(eventNode?.id).toBe(node.id);
      state = leaveEvent(state);
    } else if (node.kind === 'boss') {
      // Stop with the boss node still "current" so the caller can resolve it.
      break;
    } else {
      rollEncounter(state);
      state = recordBattleResult(state, { won: true, goldEarned: 5 });
    }
  }
  return state;
}

/** Walk stop columns (browsing shops, leaving events unresolved) until the
 * first fight/boss node is reached; returns with that node still `current`
 * (uncommitted result) so the caller can resolve it. */
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

describe('run/runState: determinism', () => {
  it('same seed -> identical map + encounter rolls', () => {
    for (const seed of [1, 2, 3, 42, 999]) {
      const a = createRun(seed);
      const b = createRun(seed);
      expect(a.map).toEqual(b.map);

      const firstNodeId = a.map.depths[1]![0]!.id;
      const withA = chooseNode(applyDraftResult(a, draftPicksFor(seed)), firstNodeId);
      const withB = chooseNode(applyDraftResult(b, draftPicksFor(seed)), firstNodeId);
      const kind = withA.map.depths[1]![0]!.kind;
      if (kind === 'fight' || kind === 'boss') {
        expect(rollEncounter(withA)).toEqual(rollEncounter(withB));
        // Repeated calls for the same node are stable too.
        expect(rollEncounter(withA)).toEqual(rollEncounter(withA));
      }
    }
  });
});

describe('run/runState: draft + choices', () => {
  it('createRun starts in drafting status with no board', () => {
    const state = createRun(7);
    expect(state.status).toBe('drafting');
    expect(state.pieces).toHaveLength(0);
    expect(state.depth).toBe(0);
    expect(availableChoices(state)).toHaveLength(0);
  });

  it('applyDraftResult installs 4 cards and goes active', () => {
    const state = startedRun(7);
    expect(state.status).toBe('active');
    expect(state.pieces).toHaveLength(4);
    expect(state.gold).toBe(0);
  });

  it('applyDraftResult throws once already active', () => {
    const state = startedRun(7);
    expect(() => applyDraftResult(state, draftPicksFor(7))).toThrow();
  });

  it('availableChoices surfaces the depth-1 column (2-3 nodes) right after draft', () => {
    const state = startedRun(7);
    const choices = availableChoices(state);
    expect(choices.length).toBeGreaterThanOrEqual(2);
    expect(choices.length).toBeLessThanOrEqual(3);
    expect(choices.every((n) => n.depth === 1)).toBe(true);
  });

  it('chooseNode rejects a node that is not an available choice', () => {
    const state = startedRun(7);
    expect(() => chooseNode(state, 'not-a-real-node')).toThrow();
    // A real node id, but from a much later column (never currently available).
    const lastColumn = state.map.depths[totalColumns(state.map)]!;
    expect(() => chooseNode(state, lastColumn[0]!.id)).toThrow();
  });

  it('while a node is occupied, availableChoices is empty', () => {
    const state = startedRun(7);
    const first = availableChoices(state)[0]!;
    const occupied = chooseNode(state, first.id);
    expect(availableChoices(occupied)).toHaveLength(0);
  });
});

describe('run/runState: fight table + hero lockstep', () => {
  it('FIGHT_TABLE has one entry per wave: fights 1-2 normal, 3-4 elite, 5 boss', () => {
    expect(FIGHT_TABLE).toHaveLength(WAVE_COUNT);
    expect(FIGHT_TABLE.map((e) => e.title)).toEqual(['normal', 'normal', 'elite', 'elite', 'boss']);
    expect(FIGHT_TABLE.map((e) => e.level)).toEqual([1, 2, 3, 4, 5]);
  });

  it('the hero is always exactly LV n entering fight n, across a full run, win or lose', () => {
    for (const seed of [1, 2, 3, 11, 42, 100]) {
      let state = startedRun(seed);
      expect(state.heroLevel).toBe(1);
      let fightsSeen = 0;
      for (;;) {
        const choices = availableChoices(state);
        if (choices.length === 0) break;
        const node = choices[0]!;
        state = chooseNode(state, node.id);
        if (node.kind === 'shop') {
          state = leaveShop(state);
          continue;
        }
        if (node.kind === 'event') {
          state = leaveEvent(state);
          continue;
        }
        // fight or boss: hero LV must equal the fight number BEFORE resolving.
        fightsSeen += 1;
        expect(state.heroLevel).toBe(node.fightNumber);
        expect(node.fightNumber).toBe(fightsSeen);
        const won = fightsSeen % 2 === 0; // alternate win/lose to prove BOTH bump the level
        state = recordBattleResult(state, { won, goldEarned: 5 });
        if (node.kind === 'boss') break;
      }
      expect(fightsSeen).toBe(WAVE_COUNT);
    }
  });
});

describe('run/runState: battle outcomes', () => {
  it('a win credits gold, increments wins, and levels the hero up', () => {
    const state0 = stateAtFirstFight(11);
    const before = { gold: state0.gold, wins: state0.wins, level: state0.heroLevel };
    const state = recordBattleResult(state0, { won: true, goldEarned: 3 });
    expect(state.gold).toBe(before.gold + 3);
    expect(state.wins).toBe(before.wins + 1);
    expect(state.heroLevel).toBe(before.level + 1);
    expect(state.losses).toBe(0);
    expect(state.status).toBe('active');
  });

  it('a loss on a non-boss node credits no gold, but still levels the hero, and the run continues', () => {
    // stateAtFirstFight always lands on wave 1's mandatory fight (never the
    // boss, which only ends wave 5), so the run is guaranteed to continue.
    const state0 = stateAtFirstFight(11);
    const before = { gold: state0.gold, losses: state0.losses, level: state0.heroLevel };
    let state = state0;
    state = recordBattleResult(state, { won: false, goldEarned: 3 });
    expect(state.gold).toBe(before.gold);
    expect(state.losses).toBe(before.losses + 1);
    expect(state.heroLevel).toBe(before.level + 1);
    expect(state.status).toBe('active');
    // The run continues: the next column's choices are available again.
    expect(availableChoices(state).length).toBeGreaterThan(0);
  });

  it('winning the boss node ends the run in victory', () => {
    const state = driveToBoss(21);
    expect(state.currentNodeId).not.toBeNull();
    const withResult = recordBattleResult(state, { won: true, goldEarned: 10 });
    expect(withResult.status).toBe('victory');
    expect(withResult.currentNodeId).toBeNull();
  });

  it('losing the boss node ends the run in defeat (no gold, but still levels up)', () => {
    const state = driveToBoss(21);
    const goldBefore = state.gold;
    const levelBefore = state.heroLevel;
    const withResult = recordBattleResult(state, { won: false, goldEarned: 10 });
    expect(withResult.status).toBe('defeat');
    expect(withResult.gold).toBe(goldBefore);
    expect(withResult.heroLevel).toBe(levelBefore + 1);
  });

  it('recordBattleResult throws when no combat node is active', () => {
    const state = startedRun(11);
    expect(() => recordBattleResult(state, { won: true, goldEarned: 1 })).toThrow();
  });

  it('rollEncounter throws on a shop or event node', () => {
    let state = startedRun(11);
    const nonCombat = availableChoices(state).find((n) => n.kind === 'shop' || n.kind === 'event');
    if (nonCombat) {
      state = chooseNode(state, nonCombat.id);
      expect(() => rollEncounter(state)).toThrow();
    }
  });
});

describe('run/runState: shop-node purchases', () => {
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
      if (node.kind === 'event') {
        state = leaveEvent(state);
      } else if (node.kind === 'boss') {
        throw new Error('reached boss before any shop node');
      } else {
        state = recordBattleResult(state, { won: true, goldEarned: 1 });
      }
    }
    throw new Error('guard exceeded while looking for a shop node');
  }

  it('ensureRunShopShelf rolls a shelf once and is idempotent after', () => {
    const { state, nodeId } = stateAtFirstShop(1);
    const withShelf = ensureRunShopShelf(state, nodeId);
    expect(withShelf.shopShelves[nodeId]).toBeDefined();
    const again = ensureRunShopShelf(withShelf, nodeId);
    expect(again.shopShelves[nodeId]).toEqual(withShelf.shopShelves[nodeId]);
  });

  it('buyRunCard deducts gold, lands the card in the bag, and removes the offer', () => {
    let { state, nodeId } = stateAtFirstShop(3);
    state = { ...ensureRunShopShelf(state, nodeId), gold: 20 };
    const before = state.shopShelves[nodeId]!.cards.length;
    const offer = state.shopShelves[nodeId]!.cards[0];
    if (!offer) return; // shelf had no cards this seed — nothing to assert
    const result = buyRunCard(state, nodeId, 0);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.gold).toBe(20 - offer.price);
    expect(result.state.shopShelves[nodeId]!.cards.length).toBe(before - 1);
    expect(result.state.bagSlots.some((s) => s?.skillId === offer.skillId)).toBe(true);
    expect(result.state.nextCardInstanceId).toBe(state.nextCardInstanceId + 1);
  });

  it('buyRunCard fails cleanly (no charge) when gold is short', () => {
    let { state, nodeId } = stateAtFirstShop(3);
    state = { ...ensureRunShopShelf(state, nodeId), gold: 0 };
    if (!state.shopShelves[nodeId]!.cards[0]) return;
    const result = buyRunCard(state, nodeId, 0);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('gold');
    expect(result.state).toBe(state);
  });

  it('buyRunGem deducts gold, adds the gem, and removes the offer', () => {
    let { state, nodeId } = stateAtFirstShop(5);
    state = { ...ensureRunShopShelf(state, nodeId), gold: 20 };
    const offer = state.shopShelves[nodeId]!.gems[0];
    if (!offer) return;
    const before = state.shopShelves[nodeId]!.gems.length;
    const result = buyRunGem(state, nodeId, 0);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.gold).toBe(20 - offer.price);
    expect(result.state.gemInventory).toContain(offer.gemId);
    expect(result.state.shopShelves[nodeId]!.gems.length).toBe(before - 1);
  });

  it('rerollRunShop costs 1 gold and deals a different (deterministic) shelf', () => {
    let { state, nodeId } = stateAtFirstShop(1);
    state = { ...ensureRunShopShelf(state, nodeId), gold: 5 };
    const rerolled = rerollRunShop(state, nodeId);
    expect(rerolled.gold).toBe(4);
    expect(rerolled.shopShelves[nodeId]!.rerollCount).toBe(1);
    // Re-running the exact same reroll from the same starting state is stable.
    const rerolledAgain = rerollRunShop(state, nodeId);
    expect(rerolledAgain.shopShelves[nodeId]).toEqual(rerolled.shopShelves[nodeId]);
  });

  it('rerollRunShop no-ops when the wallet cannot afford it', () => {
    let { state, nodeId } = stateAtFirstShop(1);
    state = { ...ensureRunShopShelf(state, nodeId), gold: 0 };
    const rerolled = rerollRunShop(state, nodeId);
    expect(rerolled).toBe(state);
  });

  it('runBagHasRoomFor reflects the run bag, not the sandbox demoState bag', () => {
    const { state } = stateAtFirstShop(7);
    expect(runBagHasRoomFor(state, 'sword_slash')).toBe(true);
  });
});

describe('run/runState: event-node accessor', () => {
  it('currentEventNode/leaveEvent mirror currentShopNode/leaveShop', () => {
    let state = startedRun(2);
    for (let guard = 0; guard < 200; guard++) {
      const choices = availableChoices(state);
      if (choices.length === 0) throw new Error('no event node reachable for this seed');
      const eventChoice = choices.find((n) => n.kind === 'event');
      if (eventChoice) {
        state = chooseNode(state, eventChoice.id);
        const node = currentEventNode(state);
        expect(node?.id).toBe(eventChoice.id);
        expect(currentShopNode(state)).toBeUndefined();
        const left = leaveEvent(state);
        expect(left.currentNodeId).toBeNull();
        return;
      }
      const node = choices[0]!;
      state = chooseNode(state, node.id);
      if (node.kind === 'shop') state = leaveShop(state);
      else if (node.kind === 'event') state = leaveEvent(state);
      else if (node.kind === 'boss') throw new Error('reached boss before any event node');
      else state = recordBattleResult(state, { won: true, goldEarned: 1 });
    }
    throw new Error('guard exceeded while looking for an event node');
  });

  it('leaveEvent throws off an event node', () => {
    const state = startedRun(2);
    expect(() => leaveEvent(state)).toThrow();
  });

  it('currentEventNode is undefined off an event node', () => {
    const state = startedRun(2);
    expect(currentEventNode(state)).toBeUndefined();
  });
});

describe('run/runState: buyHeroStatAllocation', () => {
  it('spends one buy of a stat and is additive across repeated calls', () => {
    const state = { ...startedRun(1), heroLevel: 2 }; // 3 PL banked; attack costs 1 PL/buy.
    const once = buyHeroStatAllocation(state, 'attack');
    expect(once.heroAllocation.attack).toBe(1);
    const twice = buyHeroStatAllocation(once, 'attack');
    expect(twice.heroAllocation.attack).toBe(2);
    expect(twice).not.toBe(once);
  });

  it('is a no-op (same reference) when the buy is unaffordable', () => {
    const state = startedRun(1); // heroLevel 1 -> 0 PL banked
    const result = buyHeroStatAllocation(state, 'attack');
    expect(result).toBe(state);
    expect(result.heroAllocation.attack ?? 0).toBe(0);
  });

  it('never lets spentPL exceed totalLevelPL across repeated buys of the pricier speed stat', () => {
    let state = startedRun(3);
    state = { ...state, heroLevel: 4 }; // 9 PL banked; speed costs 2 PL/buy
    for (let i = 0; i < 10; i++) state = buyHeroStatAllocation(state, 'speed');
    expect(bankedPL(state.heroLevel, state.heroAllocation)).toBeGreaterThanOrEqual(0);
    expect(state.heroAllocation.speed).toBe(4); // floor(9/2)
  });
});

describe('run/runState: heroAllocationCost + setHeroAllocation (confirmable scratch edit)', () => {
  it('heroAllocationCost prices an allocation against LEVEL_STAT_COST', () => {
    expect(heroAllocationCost({})).toBe(0);
    expect(heroAllocationCost({ attack: 2 })).toBe(2 * LEVEL_STAT_COST.attack.pl);
    expect(heroAllocationCost({ attack: 2, speed: 1 })).toBe(
      2 * LEVEL_STAT_COST.attack.pl + 1 * LEVEL_STAT_COST.speed.pl,
    );
  });

  it('accepts an in-budget scratch allocation', () => {
    const state = { ...startedRun(1), heroLevel: 2 }; // 3 PL banked
    const next = setHeroAllocation(state, { attack: 3 }); // 3 PL spent
    expect(next.heroAllocation).toEqual({ attack: 3 });
    expect(next).not.toBe(state);
  });

  it('rejects (no-op, same reference) an over-budget allocation', () => {
    const state = { ...startedRun(1), heroLevel: 2 }; // 3 PL banked
    const result = setHeroAllocation(state, { attack: 4 }); // 4 PL > 3 banked
    expect(result).toBe(state);
  });

  it('rejects (no-op, same reference) an allocation with a negative buy count', () => {
    const state = { ...startedRun(1), heroLevel: 3 }; // 6 PL banked
    const result = setHeroAllocation(state, { attack: -1 });
    expect(result).toBe(state);
  });

  it('allows a confirm that LOWERS a stat back toward zero relative to the last confirmed allocation', () => {
    const state = { ...startedRun(1), heroLevel: 3, heroAllocation: { attack: 6 } }; // fully spent
    const lowered = setHeroAllocation(state, { attack: 2, armor: 4 }); // same total PL, different split
    expect(lowered.heroAllocation).toEqual({ attack: 2, armor: 4 });
    const toZero = setHeroAllocation(lowered, {});
    expect(toZero.heroAllocation).toEqual({});
  });

  it('buyHeroStatAllocation still behaves exactly as before (implemented via setHeroAllocation)', () => {
    const state = { ...startedRun(1), heroLevel: 2 }; // 3 PL banked
    const once = buyHeroStatAllocation(state, 'attack');
    expect(once.heroAllocation.attack).toBe(1);
    const twice = buyHeroStatAllocation(once, 'attack');
    expect(twice.heroAllocation.attack).toBe(2);
    expect(twice).not.toBe(once);
    const unaffordable = startedRun(1); // heroLevel 1 -> 0 PL banked
    const noop = buyHeroStatAllocation(unaffordable, 'attack');
    expect(noop).toBe(unaffordable);
  });

  it('a committed allocation still reaches the battle request unchanged', () => {
    const state = { ...startedRun(1), heroLevel: 3 };
    const next = setHeroAllocation(state, { attack: 2, maxHp: 4 });
    // heroAllocation is the single source of truth read by anything building
    // the player's combat stats (see leveling.ts#applyPlayerLevelAllocation) —
    // confirming just replaces it wholesale, nothing else in state changes.
    expect(next.heroAllocation).toEqual({ attack: 2, maxHp: 4 });
    expect(next.pieces).toEqual(state.pieces);
    expect(next.gold).toBe(state.gold);
  });
});
