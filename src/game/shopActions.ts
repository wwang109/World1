import { skillBook } from '../data/skills';
import { goldPriceOfCard, goldPriceOfGem, rollShopStock } from '../run/shop';
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

/** REROLL: costs 1 gold, deals a brand-new shelf from the next seed offset.
 * No-op (returns false) if the wallet can't afford it. */
export function rerollShelf(shopId: string): boolean {
  if (demoState.gold < 1) return false;
  const nextCount = (demoState.shopShelves[shopId]?.rerollCount ?? 0) + 1;
  demoState.gold -= 1;
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
  if (demoState.gold < offer.price) return { ok: false, reason: 'gold' };
  const size = Math.max(1, skillBook[offer.skillId]?.size ?? 1);
  const fit = nearestFit(bagOccupied(), size, 0);
  if (fit < 0) return { ok: false, reason: 'bag' };
  demoState.gold -= offer.price;
  const owned = createOwnedCard(offer.skillId, offer.tier);
  demoState.bagSlots[fit] = { instanceId: owned.instanceId, skillId: owned.skillId, tier: owned.tier };
  shelf.cards = shelf.cards.filter((_, i) => i !== index);
  return { ok: true };
}

/** Buys the gem offer at `index` on `shopId`'s current shelf: deducts gold,
 * adds it to the (uncapped) gem pouch, and removes the offer from the shelf. */
export function buyGem(shopId: string, index: number): BuyResult {
  const shelf = demoState.shopShelves[shopId];
  const offer = shelf?.gems[index];
  if (!shelf || !offer) return { ok: false, reason: 'gone' };
  if (demoState.gold < offer.price) return { ok: false, reason: 'gold' };
  demoState.gold -= offer.price;
  demoState.gemInventory = [...demoState.gemInventory, offer.gemId];
  shelf.gems = shelf.gems.filter((_, i) => i !== index);
  return { ok: true };
}

export { goldPriceOfCard, goldPriceOfGem, MAX_GOLD };
