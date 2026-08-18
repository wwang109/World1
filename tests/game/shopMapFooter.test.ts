import { describe, expect, it } from 'vitest';
import { shopMapFooter } from '../../src/game/ui/shopMapFooter';
import { shopCatalog } from '../../src/data/shopTypes';
import { cardPoolForShop, gemPoolForShop, shopPoolInfo } from '../../src/run/shop';

// The map panel used to render `${shop.shelf.cards} CARDS · ${shop.shelf.gems}
// GEMS` directly — the DECLARED shelf, not the real curated pool a thin
// theme can actually fill. Several themes declare a shelf bigger than their
// pool (docs/run-shops-design.md §2b, "thin shops are fine"), so that line
// lied to the player at the exact moment they spend a column choice on the
// stall. `shopMapFooter` must report `shopPoolInfo(...).cardSlots/gemSlots`
// (pool-capped) instead. Every id below is a themed stall this project ships
// with a real pool smaller than its shelf on at least one axis — if the
// footer ever regresses to the raw shelf size, these fail immediately.
describe('shopMapFooter', () => {
  const THIN_SHOPS = ['stormspire', 'emberworks', 'frosthold', 'grovekeep', 'umbral_stall'];

  it('every thin themed stall in the catalog has a real pool smaller than its declared shelf on at least one axis (sanity check that this test still exercises something)', () => {
    for (const shopId of THIN_SHOPS) {
      const shop = shopCatalog[shopId];
      expect(shop).toBeDefined();
      const cardPoolSize = cardPoolForShop(shopId).length;
      const gemPoolSize = gemPoolForShop(shopId).length;
      const thin = cardPoolSize < shop!.shelf.cards || gemPoolSize < shop!.shelf.gems;
      expect(thin).toBe(true);
    }
  });

  it('reports the pool-capped slot counts, not the declared shelf size', () => {
    for (const shopId of THIN_SHOPS) {
      const shop = shopCatalog[shopId]!;
      const info = shopPoolInfo(shopId);
      const footer = shopMapFooter(shopId);

      expect(footer).toBe(`${info.cardSlots} CARDS · ${info.gemSlots} GEMS`);

      // The regression this guards against: naively formatting the raw
      // declared shelf would produce a DIFFERENT, larger string for every
      // one of these thin stalls. Fails against the pre-fix implementation
      // (`${shop.shelf.cards} CARDS · ${shop.shelf.gems} GEMS`).
      const declaredShelfFooter = `${shop.shelf.cards} CARDS · ${shop.shelf.gems} GEMS`;
      expect(footer).not.toBe(declaredShelfFooter);
    }
  });

  it('Stormspire and Emberworks advertise 1 GEM (not the declared 5-gem shelf)', () => {
    expect(shopMapFooter('stormspire')).toBe('6 CARDS · 1 GEMS');
    expect(shopMapFooter('emberworks')).toBe('6 CARDS · 1 GEMS');
  });

  it('Frosthold, Grovekeep, and Umbral Stall advertise 2 GEMS (not the declared 5-gem shelf)', () => {
    expect(shopMapFooter('frosthold')).toBe('6 CARDS · 2 GEMS');
    expect(shopMapFooter('grovekeep')).toBe('6 CARDS · 2 GEMS');
    expect(shopMapFooter('umbral_stall')).toBe('6 CARDS · 2 GEMS');
  });

  it('a full-pool shop (e.g. gemcutter, cards-free) still reports its true (capped) slots', () => {
    // gemcutter declares { cards: 0, gems: 6 } — 0 card slots regardless of
    // pool, and its gem pool is the whole gem book filtered by rarity/tags,
    // which is >= 6, so gemSlots stays at the declared 6.
    const info = shopPoolInfo('gemcutter');
    expect(shopMapFooter('gemcutter')).toBe(`${info.cardSlots} CARDS · ${info.gemSlots} GEMS`);
    expect(info.cardSlots).toBe(0);
  });
});
