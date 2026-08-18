import { shopPoolInfo } from '../../run/shop';

/**
 * The "N CARDS · N GEMS" footer text a shop map node advertises — this is
 * the number of SLOTS that shop can ever fill (`shopPoolInfo(...).cardSlots`
 * / `gemSlots`, already capped by the real curated pool), never the theme's
 * raw declared `shelf` size. A handful of themed stalls (Stormspire,
 * Emberworks, Frosthold, Grovekeep, Umbral Stall) declare a shelf larger
 * than their curated pool, so advertising the shelf directly overpromises
 * at exactly the moment a player spends one of a column's choices on this
 * node. Both `DesktopRunMapScene` and `MobileRunMapScene` call this so the
 * rule lives in one place. No Phaser here — pure string formatting over the
 * pure run-layer helper.
 */
export function shopMapFooter(shopId: string): string {
  const info = shopPoolInfo(shopId);
  return `${info.cardSlots} CARDS · ${info.gemSlots} GEMS`;
}
