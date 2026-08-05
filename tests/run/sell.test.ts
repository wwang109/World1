import { describe, expect, it } from 'vitest';
import {
  applyDraftResult,
  availableChoices,
  buyRunCardTo,
  chooseNode,
  createRun,
  ensureRunShopShelf,
  leaveEvent,
  leaveShop,
  recordBattleResult,
  sellRunCard,
  sellRunGem,
  type RunBagSlot,
  type RunBoardPiece,
  type RunState,
} from '../../src/run/runState';
import { rollStartDraft, DRAFT_SET_KEYS, type DraftSetKey } from '../../src/run/draft';
import { sellPriceOfCard, sellPriceOfGem } from '../../src/run/shop';
import { gemBook } from '../../src/data/gems';
import type { SkillTier } from '../../src/engine/types';

/**
 * SELLING + BUY-TO-SLOT — the reverse-of-buy pure state transitions
 * (`sellRunCard`/`sellRunGem`/`buyRunCardTo` in `src/run/runState.ts`).
 * Mirrors the fixture idioms already used for shop purchases/merging in
 * `tests/run/runState.test.ts` (kept as its own file per the task brief).
 */

function draftPicksFor(seed: number): Partial<Record<DraftSetKey, string>> {
  const draft = rollStartDraft(seed);
  const picks: Partial<Record<DraftSetKey, string>> = {};
  for (const key of DRAFT_SET_KEYS) picks[key] = draft[key][0]!.skillId;
  return picks;
}

function startedRun(seed: number): RunState {
  return applyDraftResult(createRun(seed), draftPicksFor(seed));
}

/** Walk an active run forward until the FIRST shop node is reached, returned
 * with that node still `current` (uncommitted) — same idiom as
 * `runState.test.ts#stateAtFirstShop`. */
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

/** A shop node with gold=20 and its shelf's FIRST card offer forced to a
 * known `skillId`/`price` (bronze tier) — mirrors `runState.test.ts`'s
 * `stateWithForcedOffer`. */
function stateWithForcedOffer(seed: number, skillId: string, price: number): { state: RunState; nodeId: string } {
  const { state, nodeId } = stateAtFirstShop(seed);
  const withShelf = ensureRunShopShelf(state, nodeId);
  const shelf = withShelf.shopShelves[nodeId]!;
  return {
    nodeId,
    state: {
      ...withShelf,
      gold: 20,
      shopShelves: {
        ...withShelf.shopShelves,
        [nodeId]: { ...shelf, cards: [{ skillId, tier: 'bronze', price }, ...shelf.cards.slice(1)] },
      },
    },
  };
}

const boardPiece = (tier: SkillTier, skillId = 'sword_slash', slot = 0): RunBoardPiece => (
  { instanceId: 'card_900', skillId, tier, slot }
);
const bagCard = (tier: SkillTier, skillId = 'sword_slash'): NonNullable<RunBagSlot> => (
  { instanceId: 'card_901', skillId, tier }
);

describe('run/runState: sellRunCard', () => {
  it('sells a board piece: removes it, credits sellPriceOfCard(tier), folds into stats.goldEarned', () => {
    const state = { ...startedRun(1), gold: 5, pieces: [boardPiece('gold')] };
    const before = state.stats.goldEarned;
    const result = sellRunCard(state, 'board', 0);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.goldReceived).toBe(sellPriceOfCard('gold'));
    expect(result.state.pieces).toHaveLength(0);
    expect(result.state.gold).toBe(5 + sellPriceOfCard('gold'));
    expect(result.state.stats.goldEarned).toBe(before + sellPriceOfCard('gold'));
  });

  it('sells a bag card: nulls only its own slot, credits sellPriceOfCard(tier)', () => {
    const state = { ...startedRun(1), gold: 0, bagSlots: [bagCard('bronze'), null, bagCard('silver')] };
    const result = sellRunCard(state, 'bag', 0);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.goldReceived).toBe(sellPriceOfCard('bronze'));
    expect(result.state.bagSlots).toEqual([null, null, bagCard('silver')]);
    expect(result.state.gold).toBe(sellPriceOfCard('bronze'));
  });

  it('a socketed gem on a sold board piece returns to gemInventory — never destroyed', () => {
    const gem = gemBook.swift_charm!;
    const state = { ...startedRun(1), pieces: [{ ...boardPiece('bronze'), gem }], gemInventory: ['bulwark_core'] };
    const result = sellRunCard(state, 'board', 0);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.gemInventory).toEqual(['bulwark_core', gem.id]);
  });

  it('selling an UNSOCKETED board piece leaves gemInventory untouched', () => {
    const state = { ...startedRun(1), pieces: [boardPiece('bronze')], gemInventory: ['bulwark_core'] };
    const result = sellRunCard(state, 'board', 0);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.gemInventory).toEqual(['bulwark_core']);
  });

  it('fails cleanly with reason "empty" (no state change) for an out-of-range board index', () => {
    const state = { ...startedRun(1), pieces: [] };
    const result = sellRunCard(state, 'board', 0);
    expect(result).toEqual({ ok: false, reason: 'empty', state });
  });

  it('fails cleanly with reason "empty" for an already-empty bag slot', () => {
    const state = { ...startedRun(1), bagSlots: [null, null] };
    const result = sellRunCard(state, 'bag', 0);
    expect(result).toEqual({ ok: false, reason: 'empty', state });
  });

  it('does not mutate the input state (immutability contract)', () => {
    const state = { ...startedRun(1), pieces: [boardPiece('bronze')], bagSlots: [bagCard('silver')] };
    const piecesSnapshot = JSON.parse(JSON.stringify(state.pieces));
    const bagSnapshot = JSON.parse(JSON.stringify(state.bagSlots));
    sellRunCard(state, 'board', 0);
    sellRunCard(state, 'bag', 0);
    expect(state.pieces).toEqual(piecesSnapshot);
    expect(state.bagSlots).toEqual(bagSnapshot);
  });

  it('sell price table: bronze/silver/gold/diamond -> 1/1/2/2 gold', () => {
    const tiers: SkillTier[] = ['bronze', 'silver', 'gold', 'diamond'];
    const state0 = startedRun(1);
    for (const tier of tiers) {
      const state = { ...state0, gold: 0, pieces: [boardPiece(tier)] };
      const result = sellRunCard(state, 'board', 0);
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      expect(result.goldReceived).toBe(sellPriceOfCard(tier));
    }
  });

  it('sold cards do NOT return to any shop shelf', () => {
    const { state, nodeId } = stateWithForcedOffer(3, 'sword_slash', 2);
    const owned = { ...state, pieces: [boardPiece('bronze')] };
    const shelfBefore = owned.shopShelves[nodeId]!.cards.length;
    const result = sellRunCard(owned, 'board', 0);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.shopShelves[nodeId]!.cards.length).toBe(shelfBefore);
  });
});

describe('run/runState: sellRunGem', () => {
  it('sells a pouch gem: removes it, credits sellPriceOfGem(gemId), folds into stats.goldEarned', () => {
    const state = { ...startedRun(1), gold: 0, gemInventory: ['swift_charm', 'bulwark_core'] };
    const before = state.stats.goldEarned;
    const result = sellRunGem(state, 0);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.goldReceived).toBe(sellPriceOfGem('swift_charm'));
    expect(result.state.gemInventory).toEqual(['bulwark_core']);
    expect(result.state.gold).toBe(sellPriceOfGem('swift_charm'));
    expect(result.state.stats.goldEarned).toBe(before + sellPriceOfGem('swift_charm'));
  });

  it('fails cleanly with reason "empty" for an out-of-range pouch index', () => {
    const state = { ...startedRun(1), gemInventory: [] };
    const result = sellRunGem(state, 0);
    expect(result).toEqual({ ok: false, reason: 'empty', state });
  });

  it('does not mutate the input state (immutability contract)', () => {
    const state = { ...startedRun(1), gemInventory: ['swift_charm'] };
    sellRunGem(state, 0);
    expect(state.gemInventory).toEqual(['swift_charm']);
  });
});

describe('run/runState: buyRunCardTo (buy-to-slot)', () => {
  it('buys into an explicit EMPTY board slot: deducts gold, lands the piece at that exact slot, removes the offer', () => {
    const forced = stateWithForcedOffer(3, 'sword_slash', 2);
    const nodeId = forced.nodeId;
    const state = { ...forced.state, pieces: [] };
    const before = state.stats;
    const result = buyRunCardTo(state, nodeId, 0, { where: 'board', slot: 4 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.pieces).toHaveLength(1);
    expect(result.state.pieces[0]!.slot).toBe(4);
    expect(result.state.pieces[0]!.skillId).toBe('sword_slash');
    expect(result.state.gold).toBe(state.gold - 2);
    expect(result.state.shopShelves[nodeId]!.cards.length).toBe(state.shopShelves[nodeId]!.cards.length - 1);
    expect(result.state.stats.goldSpent).toBe(before.goldSpent + 2);
    expect(result.state.stats.cardsBought).toBe(before.cardsBought + 1);
  });

  it('buys into an explicit EMPTY bag slot', () => {
    const { state, nodeId } = stateWithForcedOffer(3, 'sword_slash', 2);
    const result = buyRunCardTo(state, nodeId, 0, { where: 'bag', slot: 3 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.bagSlots[3]).toMatchObject({ skillId: 'sword_slash', tier: 'bronze' });
  });

  it('rejects (reason "slot") a board slot already occupied by another piece — no charge, shelf untouched', () => {
    const { state, nodeId } = stateWithForcedOffer(3, 'sword_slash', 2);
    const owned = { ...state, pieces: [boardPiece('bronze', 'war_banner', 4)] };
    const shelfBefore = owned.shopShelves[nodeId]!.cards.length;
    const result = buyRunCardTo(owned, nodeId, 0, { where: 'board', slot: 4 });
    expect(result).toEqual({ ok: false, reason: 'slot', state: owned });
    expect(owned.gold).toBe(20);
    expect(owned.shopShelves[nodeId]!.cards.length).toBe(shelfBefore);
  });

  it('rejects (reason "slot") a bag slot already occupied', () => {
    const { state, nodeId } = stateWithForcedOffer(3, 'sword_slash', 2);
    const owned = { ...state, bagSlots: [null, null, null, bagCard('bronze', 'war_banner')] };
    const result = buyRunCardTo(owned, nodeId, 0, { where: 'bag', slot: 3 });
    expect(result).toEqual({ ok: false, reason: 'slot', state: owned });
  });

  it('respects a size-N footprint: a size-2 card straddling an occupied slot is rejected', () => {
    const { state, nodeId } = stateWithForcedOffer(3, 'fireball', 2); // fireball is size 2
    const owned = { ...state, pieces: [boardPiece('bronze', 'war_banner', 3)] }; // occupies slot 3
    // Placing a size-2 card leftmost at slot 2 would cover slots {2,3} — slot 3 is taken.
    const result = buyRunCardTo(owned, nodeId, 0, { where: 'board', slot: 2 });
    expect(result).toEqual({ ok: false, reason: 'slot', state: owned });
  });

  it('a size-2 card fits cleanly when its whole footprint is free', () => {
    const forced = stateWithForcedOffer(3, 'fireball', 2);
    const nodeId = forced.nodeId;
    const state = { ...forced.state, pieces: [] };
    const result = buyRunCardTo(state, nodeId, 0, { where: 'board', slot: 6 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.pieces[0]).toMatchObject({ skillId: 'fireball', slot: 6 });
  });

  it('rejects (reason "slot") an out-of-bounds destination', () => {
    const { state, nodeId } = stateWithForcedOffer(3, 'sword_slash', 2);
    const result = buyRunCardTo(state, nodeId, 0, { where: 'board', slot: 99 });
    expect(result).toEqual({ ok: false, reason: 'slot', state });
  });

  it('fails cleanly with reason "gold" when the wallet is short — no shelf change', () => {
    const { state, nodeId } = stateWithForcedOffer(3, 'sword_slash', 2);
    const owned = { ...state, gold: 1 };
    const result = buyRunCardTo(owned, nodeId, 0, { where: 'board', slot: 0 });
    expect(result).toEqual({ ok: false, reason: 'gold', state: owned });
  });

  it('fails cleanly with reason "gone" for an out-of-range offer index', () => {
    const { state, nodeId } = stateWithForcedOffer(3, 'sword_slash', 2);
    const result = buyRunCardTo(state, nodeId, 99, { where: 'board', slot: 0 });
    expect(result).toEqual({ ok: false, reason: 'gone', state });
  });

  it('does not offer a merge — a duplicate purchase through buy-to-slot always adds a new copy', () => {
    const { state, nodeId } = stateWithForcedOffer(3, 'sword_slash', 2);
    const owned = { ...state, pieces: [boardPiece('bronze', 'sword_slash', 0)] };
    const result = buyRunCardTo(owned, nodeId, 0, { where: 'board', slot: 2 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.pieces).toHaveLength(2); // both copies present, no merge
  });

  it('does not mutate the input state (immutability contract)', () => {
    const { state, nodeId } = stateWithForcedOffer(3, 'sword_slash', 2);
    const piecesSnapshot = JSON.parse(JSON.stringify(state.pieces));
    const shelfSnapshot = JSON.parse(JSON.stringify(state.shopShelves[nodeId]));
    buyRunCardTo(state, nodeId, 0, { where: 'board', slot: 5 });
    expect(state.pieces).toEqual(piecesSnapshot);
    expect(state.shopShelves[nodeId]).toEqual(shelfSnapshot);
  });

  it('is deterministic: identical input -> identical output, every time', () => {
    const { state, nodeId } = stateWithForcedOffer(3, 'sword_slash', 2);
    const a = buyRunCardTo(state, nodeId, 0, { where: 'board', slot: 5 });
    const b = buyRunCardTo(state, nodeId, 0, { where: 'board', slot: 5 });
    expect(a).toEqual(b);
  });
});
