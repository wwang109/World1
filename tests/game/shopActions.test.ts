import { beforeEach, describe, expect, it } from 'vitest';
import { skillBook } from '../../src/data/skills';
import type { Gem } from '../../src/engine/types';
import { demoState, resetDemoState, type ShopShelfState } from '../../src/game/demoState';
import {
  buyCard, buyCardTo, mergeCard, mergeTargetFor, moveToBag, moveToBoard, sellCard, sellGem,
  type ShopBagSlot, type ShopBoardPiece,
} from '../../src/game/shopActions';
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

/**
 * REARRANGE (2026-08-06) — dragging an OWNED board/bag card to a new board/
 * bag slot (task #32: this move never existed in the shop at all — only
 * BUY-to-slot and SELL did). `moveToBoard`/`moveToBag` are pure — no
 * `demoState` mutation, no `resetDemoState` needed — so these tests build
 * plain pieces/bagSlots arrays and check the returned outcome directly, the
 * same way `tests/run/loadout.test.ts` exercises the `moveWithinStrip`/
 * `shiftInsert` primitives these two functions are built from.
 */
describe('game/shopActions: REARRANGE (owned board/bag drag)', () => {
  const swiftCharm = { id: 'swift_charm', kind: 'stat', rarity: 'common', name: 'x', text: 'x', mods: {} } as unknown as Gem;
  const empty10: ShopBagSlot[] = Array(10).fill(null);

  it('moveToBoard: a board-origin drag to an empty slot simply relocates it', () => {
    const pieces: ShopBoardPiece[] = [{ instanceId: 'a', skillId: 'sword_slash', tier: 'bronze', slot: 0 }];
    const outcome = moveToBoard(pieces, empty10, skillBook, { location: 'board', index: 0 }, 5, 10);
    expect(outcome).not.toBeNull();
    expect(outcome!.pieces).toEqual([{ instanceId: 'a', skillId: 'sword_slash', tier: 'bronze', slot: 5 }]);
    expect(outcome!.bagSlots).toEqual(empty10);
    expect(outcome!.displacedGemId).toBeNull();
  });

  it('moveToBoard: dropping a board card ONTO another board card swaps them (reorder, not a rejection)', () => {
    const pieces: ShopBoardPiece[] = [
      { instanceId: 'a', skillId: 'sword_slash', tier: 'bronze', slot: 0 },
      { instanceId: 'b', skillId: 'war_banner', tier: 'bronze', slot: 1 },
    ];
    const outcome = moveToBoard(pieces, empty10, skillBook, { location: 'board', index: 0 }, 1, 10);
    expect(outcome).not.toBeNull();
    const bySlot = new Map(outcome!.pieces.map((p) => [p.instanceId, p.slot]));
    expect(bySlot.get('a')).toBe(1);
    expect(bySlot.get('b')).toBe(0);
  });

  it('moveToBoard: a bag-origin drag INSERTS into the board, pushing the occupant at the target slot rather than refusing the drop', () => {
    const pieces: ShopBoardPiece[] = [{ instanceId: 'x', skillId: 'sword_slash', tier: 'bronze', slot: 2 }];
    const bagSlots: ShopBagSlot[] = [{ instanceId: 'y', skillId: 'war_banner', tier: 'bronze' }, ...Array(9).fill(null)];
    const outcome = moveToBoard(pieces, bagSlots, skillBook, { location: 'bag', index: 0 }, 2, 10);
    expect(outcome).not.toBeNull();
    const bySlot = new Map(outcome!.pieces.map((p) => [p.instanceId, p.slot]));
    expect(bySlot.get('y')).toBe(2); // the dragged card lands where it was dropped
    expect(bySlot.get('x')).toBe(3); // the occupant slides out of the way, not destroyed
    expect(outcome!.bagSlots[0]).toBeNull(); // vacated its bag slot
  });

  it('moveToBoard: a size-2 card spans correctly when crossing over from the bag', () => {
    const bagSlots: ShopBagSlot[] = [{ instanceId: 'f', skillId: 'fireball', tier: 'bronze' }, null, ...Array(8).fill(null)];
    const outcome = moveToBoard([], bagSlots, skillBook, { location: 'bag', index: 0 }, 3, 10);
    expect(outcome).not.toBeNull();
    expect(outcome!.pieces).toEqual([{ instanceId: 'f', skillId: 'fireball', tier: 'bronze', slot: 3 }]);
  });

  it('moveToBoard: refuses the drop (null) when the board genuinely has no room anywhere', () => {
    const pieces: ShopBoardPiece[] = Array.from({ length: 10 }, (_, i) => ({ instanceId: `c${i}`, skillId: 'sword_slash', tier: 'bronze', slot: i }));
    const bagSlots: ShopBagSlot[] = [{ instanceId: 'z', skillId: 'war_banner', tier: 'bronze' }, ...Array(9).fill(null)];
    const outcome = moveToBoard(pieces, bagSlots, skillBook, { location: 'bag', index: 0 }, 0, 10);
    expect(outcome).toBeNull();
  });

  it('moveToBag: a bag-origin drag to an empty slot simply relocates it', () => {
    const bagSlots: ShopBagSlot[] = [{ instanceId: 'a', skillId: 'sword_slash', tier: 'bronze' }, ...Array(9).fill(null)];
    const outcome = moveToBag([], bagSlots, skillBook, { location: 'bag', index: 0 }, 5, 10);
    expect(outcome).not.toBeNull();
    expect(outcome!.bagSlots[5]).toEqual({ instanceId: 'a', skillId: 'sword_slash', tier: 'bronze' });
    expect(outcome!.bagSlots[0]).toBeNull();
  });

  it('moveToBag: a board-origin drag INSERTS into the bag, pushing the occupant at the target slot', () => {
    const pieces: ShopBoardPiece[] = [{ instanceId: 'p', skillId: 'sword_slash', tier: 'bronze', slot: 0 }];
    const bagSlots: ShopBagSlot[] = [{ instanceId: 'y', skillId: 'war_banner', tier: 'bronze' }, ...Array(9).fill(null)];
    const outcome = moveToBag(pieces, bagSlots, skillBook, { location: 'board', index: 0 }, 0, 10);
    expect(outcome).not.toBeNull();
    expect(outcome!.pieces).toEqual([]); // removed from the board
    expect(outcome!.bagSlots[0]).toEqual({ instanceId: 'p', skillId: 'sword_slash', tier: 'bronze' });
    expect(outcome!.bagSlots[1]).toEqual({ instanceId: 'y', skillId: 'war_banner', tier: 'bronze' }); // pushed, not destroyed
  });

  it('moveToBag: a socketed gem on the moved board card bounces back to the pouch (bag cards cannot hold one), mirroring sellCard', () => {
    const pieces: ShopBoardPiece[] = [{ instanceId: 'a', skillId: 'sword_slash', tier: 'bronze', slot: 0, gem: swiftCharm }];
    const outcome = moveToBag(pieces, empty10, skillBook, { location: 'board', index: 0 }, 4, 10);
    expect(outcome).not.toBeNull();
    expect(outcome!.displacedGemId).toBe('swift_charm');
    expect(outcome!.bagSlots[4]).toEqual({ instanceId: 'a', skillId: 'sword_slash', tier: 'bronze' });
  });

  it('moveToBag: a card with no gem never fabricates a displacedGemId', () => {
    const pieces: ShopBoardPiece[] = [{ instanceId: 'a', skillId: 'sword_slash', tier: 'bronze', slot: 0 }];
    const outcome = moveToBag(pieces, empty10, skillBook, { location: 'board', index: 0 }, 4, 10);
    expect(outcome!.displacedGemId).toBeNull();
  });

  it('moveToBag: refuses the drop (null) when the bag genuinely has no room anywhere', () => {
    const bagSlots: ShopBagSlot[] = Array.from({ length: 10 }, (_, i) => ({ instanceId: `c${i}`, skillId: 'sword_slash', tier: 'bronze' }));
    const pieces: ShopBoardPiece[] = [{ instanceId: 'z', skillId: 'war_banner', tier: 'bronze', slot: 0 }];
    const outcome = moveToBag(pieces, bagSlots, skillBook, { location: 'board', index: 0 }, 0, 10);
    expect(outcome).toBeNull();
  });

  it('moveToBoard/moveToBag both return null for an out-of-range source index (defensive)', () => {
    expect(moveToBoard([], empty10, skillBook, { location: 'board', index: 0 }, 0, 10)).toBeNull();
    expect(moveToBoard([], empty10, skillBook, { location: 'bag', index: 0 }, 0, 10)).toBeNull();
    expect(moveToBag([], empty10, skillBook, { location: 'board', index: 0 }, 0, 10)).toBeNull();
    expect(moveToBag([], empty10, skillBook, { location: 'bag', index: 0 }, 0, 10)).toBeNull();
  });
});
