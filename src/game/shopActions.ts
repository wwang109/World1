import { skillBook } from '../data/skills';
import { bagAsBoardPieces, canPlace } from '../run/loadout';
import {
  findMergeTarget,
  goldPriceOfCard,
  goldPriceOfGem,
  rollShopStock,
  sellPriceOfCard,
  sellPriceOfGem,
  type MergeTarget,
} from '../run/shop';
import { createOwnedCard, demoState, MAX_GOLD, type ShopShelfState } from './demoState';

/**
 * Shop actions — pure state transitions over `demoState` (no Phaser). Both
 * DesktopShopScene and MobileShopScene call these so the buy/reroll rules
 * live in exactly one place. No combat/simulate import here — this is the
 * gold economy, not battle resolution.
 */

const SLOTS = 10;

/** Returns this shop's persisted shelf, rolling a fresh one (seed = demoState.seed,
 * offset 0) the first time it's ever browsed this session. */
export function ensureShelf(shopId: string): ShopShelfState {
  const existing = demoState.shopShelves[shopId];
  if (existing) return existing;
  const rolled = rollShopStock(shopId, demoState.seed);
  const shelf: ShopShelfState = { cards: [...rolled.cards], gems: [...rolled.gems], rerollCount: 0 };
  demoState.shopShelves[shopId] = shelf;
  return shelf;
}

// SANDBOX WALLET IS UNLIMITED (user-locked 2026-08-04): the sandbox is the
// balance/deck-idea playground, so nothing here gates on or deducts gold.
// Run Mode's real economy lives in src/run — untouched by this rule.

/** REROLL: deals a brand-new shelf from the next seed offset. Free in the
 * sandbox (unlimited wallet). */
export function rerollShelf(shopId: string): boolean {
  const nextCount = (demoState.shopShelves[shopId]?.rerollCount ?? 0) + 1;
  const rolled = rollShopStock(shopId, demoState.seed + nextCount);
  demoState.shopShelves[shopId] = { cards: [...rolled.cards], gems: [...rolled.gems], rerollCount: nextCount };
  return true;
}

function bagOccupied(): boolean[] {
  const occ = Array<boolean>(SLOTS).fill(false);
  demoState.bagSlots.forEach((card, index) => {
    if (!card) return;
    const size = Math.max(1, skillBook[card.skillId]?.size ?? 1);
    for (let i = index; i < index + size && i < SLOTS; i++) occ[i] = true;
  });
  return occ;
}

function nearestFit(occ: boolean[], size: number, prefer: number): number {
  const fits: number[] = [];
  for (let i = 0; i + size <= SLOTS; i++) {
    let ok = true;
    for (let j = i; j < i + size; j++) if (occ[j]) { ok = false; break; }
    if (ok) fits.push(i);
  }
  if (fits.length === 0) return -1;
  return fits.reduce((best, s) => (Math.abs(s - prefer) < Math.abs(best - prefer) ? s : best), fits[0]!);
}

/** Whether the bag currently has room for a card of this skill (used to
 * disable/dim a BUY button before the player even opens the confirm dialog). */
export function bagHasRoomFor(skillId: string): boolean {
  const size = Math.max(1, skillBook[skillId]?.size ?? 1);
  return nearestFit(bagOccupied(), size, 0) >= 0;
}

export type BuyResult = { ok: true } | { ok: false; reason: 'gold' | 'bag' | 'gone' };

/** Buys the card offer at `index` on `shopId`'s current shelf: deducts gold,
 * inserts a fresh owned card into the nearest-fit open bag slot, and removes
 * the offer from the shelf (finite stock). Fails cleanly (no charge) if the
 * wallet can't afford it or the bag has no room. */
export function buyCard(shopId: string, index: number): BuyResult {
  const shelf = demoState.shopShelves[shopId];
  const offer = shelf?.cards[index];
  if (!shelf || !offer) return { ok: false, reason: 'gone' };
  const size = Math.max(1, skillBook[offer.skillId]?.size ?? 1);
  const fit = nearestFit(bagOccupied(), size, 0);
  if (fit < 0) return { ok: false, reason: 'bag' };
  const owned = createOwnedCard(offer.skillId, offer.tier);
  demoState.bagSlots[fit] = { instanceId: owned.instanceId, skillId: owned.skillId, tier: owned.tier };
  shelf.cards = shelf.cards.filter((_, i) => i !== index);
  return { ok: true };
}

/** Merge target preview for a shop card offer's `skillId` — null if the
 * player owns no mergeable (non-diamond) instance of it. The BUY confirm
 * dialog calls this to decide whether to surface the MERGE choice. */
export function mergeTargetFor(skillId: string): MergeTarget | null {
  return findMergeTarget(skillId, demoState.pieces, demoState.bagSlots);
}

export type MergeResult = { ok: true } | { ok: false; reason: 'gold' | 'no-target' | 'gone' };

/** MERGE: buys the card offer at `index` on `shopId`'s current shelf,
 * upgrading the player's existing lowest-tier owned instance of that skill
 * one tier instead of adding a copy — same price/shelf-consumption as
 * `buyCard`. Fails cleanly (no charge) if the wallet can't afford it or the
 * player owns no mergeable copy of the offered skill. */
export function mergeCard(shopId: string, index: number): MergeResult {
  const shelf = demoState.shopShelves[shopId];
  const offer = shelf?.cards[index];
  if (!shelf || !offer) return { ok: false, reason: 'gone' };
  const target = findMergeTarget(offer.skillId, demoState.pieces, demoState.bagSlots);
  if (!target) return { ok: false, reason: 'no-target' };
  if (target.location === 'board') {
    demoState.pieces = demoState.pieces.map((p, i) => (i === target.index ? { ...p, tier: target.toTier } : p));
  } else {
    demoState.bagSlots = demoState.bagSlots.map((c, i) => (i === target.index && c ? { ...c, tier: target.toTier } : c));
  }
  shelf.cards = shelf.cards.filter((_, i) => i !== index);
  return { ok: true };
}

/** Buys the gem offer at `index` on `shopId`'s current shelf: deducts gold,
 * adds it to the (uncapped) gem pouch, and removes the offer from the shelf. */
export function buyGem(shopId: string, index: number): BuyResult {
  const shelf = demoState.shopShelves[shopId];
  const offer = shelf?.gems[index];
  if (!shelf || !offer) return { ok: false, reason: 'gone' };
  demoState.gemInventory = [...demoState.gemInventory, offer.gemId];
  shelf.gems = shelf.gems.filter((_, i) => i !== index);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Selling (2026-08-04) — sandbox mirror of `sellRunCard`/`sellRunGem`
// (src/run/runState.ts): removes an owned board piece/bag card/pouch gem and
// credits half-price gold (`sellPriceOfCard`/`sellPriceOfGem`,
// src/run/shop.ts). The sandbox wallet is unlimited (nothing here ever GATES
// on gold), but selling still credits the gold anyway — for consistency with
// Run Mode's real economy, even though the sandbox itself ignores the number.
// ---------------------------------------------------------------------------

export type SellResult = { ok: true; goldReceived: number } | { ok: false; reason: 'empty' };

/** SELL the board piece (`location: 'board'`) or bag card (`'bag'`) at
 * `index`: removes it, credits half-price gold, and — board pieces ONLY —
 * returns any socketed gem to the gem pouch instead of destroying it
 * silently. Fails cleanly with reason `'empty'` if `index` is already empty. */
export function sellCard(location: 'board' | 'bag', index: number): SellResult {
  if (location === 'board') {
    const piece = demoState.pieces[index];
    if (!piece) return { ok: false, reason: 'empty' };
    const price = sellPriceOfCard(piece.tier);
    if (piece.gem) demoState.gemInventory = [...demoState.gemInventory, piece.gem.id];
    demoState.pieces = demoState.pieces.filter((_, i) => i !== index);
    demoState.gold = Math.max(0, Math.min(MAX_GOLD, demoState.gold + price));
    return { ok: true, goldReceived: price };
  }
  const card = demoState.bagSlots[index];
  if (!card) return { ok: false, reason: 'empty' };
  const price = sellPriceOfCard(card.tier);
  demoState.bagSlots = demoState.bagSlots.map((c, i) => (i === index ? null : c));
  demoState.gold = Math.max(0, Math.min(MAX_GOLD, demoState.gold + price));
  return { ok: true, goldReceived: price };
}

/** SELL the pouch gem at `pouchIndex` (same gold-credited-but-ignored idiom
 * as `sellCard`). */
export function sellGem(pouchIndex: number): SellResult {
  const gemId = demoState.gemInventory[pouchIndex];
  if (!gemId) return { ok: false, reason: 'empty' };
  const price = sellPriceOfGem(gemId);
  demoState.gemInventory = demoState.gemInventory.filter((_, i) => i !== pouchIndex);
  demoState.gold = Math.max(0, Math.min(MAX_GOLD, demoState.gold + price));
  return { ok: true, goldReceived: price };
}

// ---------------------------------------------------------------------------
// BUY-TO-SLOT (2026-08-04) — sandbox mirror of `buyRunCardTo`: buys straight
// into an explicit board/bag destination slot instead of `buyCard`'s
// nearest-fit auto-placement. `buyCard`/`mergeCard` remain the plain-tap path.
// ---------------------------------------------------------------------------

export type BuyDestination = { where: 'board'; slot: number } | { where: 'bag'; slot: number };
export type BuyToSlotResult = { ok: true } | { ok: false; reason: 'gold' | 'slot' | 'gone' };

/** Buys the card offer at `index` on `shopId`'s current shelf straight into
 * `dest` (an explicit board or bag leftmost slot). Footprint/occupancy is
 * validated by the SAME `canPlace` overlap check the board editor uses — the
 * bag axis reuses it too via `bagAsBoardPieces`, so there is exactly ONE
 * overlap-check implementation for both. Free in the sandbox (unlimited
 * wallet, same as `buyCard`); fails cleanly (`reason: 'slot'`) if the
 * destination doesn't fit (out of bounds or overlapping an existing
 * piece/card). */
export function buyCardTo(shopId: string, index: number, dest: BuyDestination): BuyToSlotResult {
  const shelf = demoState.shopShelves[shopId];
  const offer = shelf?.cards[index];
  if (!shelf || !offer) return { ok: false, reason: 'gone' };
  if (dest.where === 'board') {
    if (!canPlace(demoState.pieces, skillBook, offer.skillId, dest.slot, SLOTS)) return { ok: false, reason: 'slot' };
    const owned = createOwnedCard(offer.skillId, offer.tier);
    demoState.pieces = [...demoState.pieces, { instanceId: owned.instanceId, skillId: owned.skillId, tier: owned.tier, slot: dest.slot }];
  } else {
    if (!canPlace(bagAsBoardPieces(demoState.bagSlots), skillBook, offer.skillId, dest.slot, SLOTS)) return { ok: false, reason: 'slot' };
    const owned = createOwnedCard(offer.skillId, offer.tier);
    demoState.bagSlots[dest.slot] = { instanceId: owned.instanceId, skillId: owned.skillId, tier: owned.tier };
  }
  shelf.cards = shelf.cards.filter((_, i) => i !== index);
  return { ok: true };
}

export { goldPriceOfCard, goldPriceOfGem, MAX_GOLD };
