import { beforeEach, describe, expect, it } from 'vitest';
import { demoState, resetDemoState, type ShopShelfState } from '../../src/game/demoState';
import { buyCard, buyCardTo, mergeCard, mergeTargetFor, sellCard, sellGem } from '../../src/game/shopActions';
import { sellPriceOfCard, sellPriceOfGem } from '../../src/run/shop';

/**
 * Duplicate merging over the SANDBOX `demoState` (src/game/shopActions.ts) —
 * the mutable mirror of `mergeRunCard`/`runMergeTargetFor` (src/run/runState.ts),
 * sharing the same pure `findMergeTarget` targeting rule (src/run/shop.ts).
 * Full targeting-rule edge cases (lowest-tier-first, board-over-bag ties,
 * diamond ceiling, null-slot skipping) are already covered against the
 * generic helper in tests/run/shop.test.ts — these tests only need to prove
 * `mergeCard`/`mergeTargetFor` wire that helper into `demoState` correctly.
 */

function shelfWith(skillId: string, price: number): Record<string, ShopShelfState> {
  return { armory: { cards: [{ skillId, tier: 'bronze', price }], gems: [], rerollCount: 0 } };
}

describe('game/shopActions: duplicate merging (sandbox demoState)', () => {
  beforeEach(() => {
    resetDemoState({ gold: 20, pieces: [], bagSlots: [], shopShelves: shelfWith('sword_slash', 2) });
  });

  it('mergeTargetFor is null when the player owns no copy of the offered skill', () => {
    expect(mergeTargetFor('sword_slash')).toBeNull();
  });

  it('mergeCard upgrades the owned board copy IN PLACE (no new copy added), consumes the offer, never charges (sandbox wallet is unlimited)', () => {
    resetDemoState({
      gold: 20,
      pieces: [{ instanceId: 'card_900', skillId: 'sword_slash', tier: 'bronze', slot: 0 }],
      bagSlots: [],
      shopShelves: shelfWith('sword_slash', 2),
    });
    const result = mergeCard('armory', 0);
    expect(result).toEqual({ ok: true });
    expect(demoState.pieces).toHaveLength(1);
    expect(demoState.pieces[0]).toEqual({ instanceId: 'card_900', skillId: 'sword_slash', tier: 'silver', slot: 0 });
    expect(demoState.gold).toBe(20);
    expect(demoState.shopShelves.armory!.cards).toHaveLength(0);
  });

  it('a socketed gem on the merged piece survives (tier change never touches the socket)', () => {
    const gem = { id: 'swift_charm', kind: 'stat', rarity: 'common', name: 'x', text: 'x', mods: {} } as unknown as NonNullable<(typeof demoState.pieces)[number]['gem']>;
    resetDemoState({
      gold: 20,
      pieces: [{ instanceId: 'card_900', skillId: 'sword_slash', tier: 'bronze', slot: 0, gem }],
      bagSlots: [],
      shopShelves: shelfWith('sword_slash', 2),
    });
    mergeCard('armory', 0);
    expect(demoState.pieces[0]!.gem).toEqual(gem);
    expect(demoState.pieces[0]!.tier).toBe('silver');
  });

  it('mergeCard fails with reason "no-target" (no charge) when every owned copy is already diamond', () => {
    resetDemoState({
      gold: 20,
      pieces: [{ instanceId: 'card_900', skillId: 'sword_slash', tier: 'diamond', slot: 0 }],
      bagSlots: [],
      shopShelves: shelfWith('sword_slash', 2),
    });
    const result = mergeCard('armory', 0);
    expect(result).toEqual({ ok: false, reason: 'no-target' });
    expect(demoState.gold).toBe(20);
    expect(demoState.pieces[0]!.tier).toBe('diamond');
  });

  it('mergeCard succeeds regardless of the wallet — the sandbox never gates on gold (user-locked 2026-08-04)', () => {
    resetDemoState({
      gold: 0,
      pieces: [{ instanceId: 'card_900', skillId: 'sword_slash', tier: 'bronze', slot: 0 }],
      bagSlots: [],
      shopShelves: shelfWith('sword_slash', 2),
    });
    const result = mergeCard('armory', 0);
    expect(result).toEqual({ ok: true });
    expect(demoState.gold).toBe(0);
    expect(demoState.pieces[0]!.tier).toBe('silver');
  });

  it('buyCard (plain purchase) is unaffected by the merge feature — still adds a new copy, free in the sandbox', () => {
    resetDemoState({ gold: 20, pieces: [], bagSlots: [], shopShelves: shelfWith('sword_slash', 2) });
    const result = buyCard('armory', 0);
    expect(result).toEqual({ ok: true });
    expect(demoState.bagSlots.some((s) => s?.skillId === 'sword_slash')).toBe(true);
    expect(demoState.gold).toBe(20);
  });
});

describe('game/shopActions: selling (sandbox demoState)', () => {
  beforeEach(() => {
    resetDemoState({ gold: 5, pieces: [], bagSlots: [], gemInventory: [] });
  });

  it('sellCard removes a board piece and credits half-price gold (credited even though the sandbox ignores it)', () => {
    resetDemoState({ gold: 5, pieces: [{ instanceId: 'card_900', skillId: 'sword_slash', tier: 'gold', slot: 0 }], bagSlots: [] });
    const result = sellCard('board', 0);
    expect(result).toEqual({ ok: true, goldReceived: sellPriceOfCard('gold') });
    expect(demoState.pieces).toHaveLength(0);
    expect(demoState.gold).toBe(5 + sellPriceOfCard('gold'));
  });

  it('sellCard removes a bag card (nulls only its own slot) and credits half-price gold', () => {
    resetDemoState({
      gold: 0,
      pieces: [],
      bagSlots: [{ instanceId: 'card_901', skillId: 'sword_slash', tier: 'bronze' }, null, { instanceId: 'card_902', skillId: 'fireball', tier: 'silver' }],
    });
    const result = sellCard('bag', 0);
    expect(result).toEqual({ ok: true, goldReceived: sellPriceOfCard('bronze') });
    expect(demoState.bagSlots[0]).toBeNull();
    expect(demoState.bagSlots[2]).toEqual({ instanceId: 'card_902', skillId: 'fireball', tier: 'silver' });
  });

  it("a socketed gem on a sold board piece returns to the gem pouch — never destroyed", () => {
    const gem = { id: 'swift_charm', kind: 'stat', rarity: 'common', name: 'x', text: 'x', mods: {} } as unknown as NonNullable<(typeof demoState.pieces)[number]['gem']>;
    resetDemoState({ gold: 0, pieces: [{ instanceId: 'card_900', skillId: 'sword_slash', tier: 'bronze', slot: 0, gem }], bagSlots: [], gemInventory: ['bulwark_core'] });
    sellCard('board', 0);
    expect(demoState.gemInventory).toEqual(['bulwark_core', 'swift_charm']);
  });

  it('sellCard fails cleanly with reason "empty" for an out-of-range/already-empty index', () => {
    resetDemoState({ gold: 5, pieces: [], bagSlots: [null] });
    expect(sellCard('board', 0)).toEqual({ ok: false, reason: 'empty' });
    expect(sellCard('bag', 0)).toEqual({ ok: false, reason: 'empty' });
    expect(demoState.gold).toBe(5);
  });

  it('sellGem removes a pouch gem and credits half-price gold', () => {
    resetDemoState({ gold: 0, gemInventory: ['swift_charm', 'bulwark_core'] });
    const result = sellGem(0);
    expect(result).toEqual({ ok: true, goldReceived: sellPriceOfGem('swift_charm') });
    expect(demoState.gemInventory).toEqual(['bulwark_core']);
    expect(demoState.gold).toBe(sellPriceOfGem('swift_charm'));
  });

  it('sellGem fails cleanly with reason "empty" for an out-of-range index', () => {
    resetDemoState({ gold: 0, gemInventory: [] });
    expect(sellGem(0)).toEqual({ ok: false, reason: 'empty' });
  });
});

describe('game/shopActions: buyCardTo (buy-to-slot, sandbox mirror)', () => {
  beforeEach(() => {
    resetDemoState({ gold: 20, pieces: [], bagSlots: [], shopShelves: shelfWith('sword_slash', 2) });
  });

  it('buys into an explicit EMPTY board slot at the exact requested position', () => {
    const result = buyCardTo('armory', 0, { where: 'board', slot: 4 });
    expect(result).toEqual({ ok: true });
    expect(demoState.pieces).toHaveLength(1);
    expect(demoState.pieces[0]).toMatchObject({ skillId: 'sword_slash', slot: 4 });
    expect(demoState.shopShelves.armory!.cards).toHaveLength(0);
  });

  it('buys into an explicit EMPTY bag slot', () => {
    const result = buyCardTo('armory', 0, { where: 'bag', slot: 3 });
    expect(result).toEqual({ ok: true });
    expect(demoState.bagSlots[3]).toMatchObject({ skillId: 'sword_slash' });
  });

  it('rejects (reason "slot") a board slot already occupied by another piece', () => {
    resetDemoState({
      gold: 20,
      pieces: [{ instanceId: 'card_900', skillId: 'war_banner', tier: 'bronze', slot: 4 }],
      bagSlots: [],
      shopShelves: shelfWith('sword_slash', 2),
    });
    const result = buyCardTo('armory', 0, { where: 'board', slot: 4 });
    expect(result).toEqual({ ok: false, reason: 'slot' });
    expect(demoState.pieces).toHaveLength(1); // unchanged
    expect(demoState.shopShelves.armory!.cards).toHaveLength(1); // shelf untouched
  });

  it('rejects (reason "slot") a bag slot already occupied', () => {
    resetDemoState({
      gold: 20,
      pieces: [],
      bagSlots: [null, null, null, { instanceId: 'card_901', skillId: 'war_banner', tier: 'bronze' }],
      shopShelves: shelfWith('sword_slash', 2),
    });
    const result = buyCardTo('armory', 0, { where: 'bag', slot: 3 });
    expect(result).toEqual({ ok: false, reason: 'slot' });
  });

  it('does not offer a merge — a duplicate purchase through buy-to-slot always adds a new copy', () => {
    resetDemoState({
      gold: 20,
      pieces: [{ instanceId: 'card_900', skillId: 'sword_slash', tier: 'bronze', slot: 0 }],
      bagSlots: [],
      shopShelves: shelfWith('sword_slash', 2),
    });
    const result = buyCardTo('armory', 0, { where: 'board', slot: 2 });
    expect(result).toEqual({ ok: true });
    expect(demoState.pieces).toHaveLength(2); // both copies present, no merge
  });

  it('fails cleanly with reason "gone" for an out-of-range offer index', () => {
    const result = buyCardTo('armory', 99, { where: 'board', slot: 0 });
    expect(result).toEqual({ ok: false, reason: 'gone' });
  });
});
