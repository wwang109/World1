import { beforeEach, describe, expect, it } from 'vitest';
import { demoState, resetDemoState, type ShopShelfState } from '../../src/game/demoState';
import { buyCard, mergeCard, mergeTargetFor } from '../../src/game/shopActions';

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
