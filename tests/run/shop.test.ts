import { describe, expect, it } from 'vitest';
import {
  battleGoldReward,
  cardMatchesFilter,
  cardPoolForShop,
  findMergeTarget,
  gemMatchesFilter,
  gemPoolForShop,
  GOLD_PRICE_BY_TIER,
  goldPriceOfCard,
  goldPriceOfGem,
  nextSkillTier,
  rollShopStock,
  sellPriceOfCard,
  sellPriceOfGem,
  shopPoolInfo,
  SKILL_TIER_ORDER,
  type MergeableCard,
} from '../../src/run/shop';
import { shopCatalog, shopTypeIds } from '../../src/data/shopTypes';
import { skillBook } from '../../src/data/skills';
import { gemBook } from '../../src/data/gems';
import { gemPowerLevelDeci } from '../../src/engine/balance';
import type { Rarity, SkillTier } from '../../src/engine/types';
import { generateRunMap, totalColumns } from '../../src/run/runMap';

describe('run/shop: pool sanity', () => {
  // Thin pools are FINE (docs/run-shops-design.md §2b, USER-LOCKED): the
  // element specialist stalls sell as few as 1 card by design, and
  // Gemcutter deliberately sells 0 cards. The floor is 1 for a shop that
  // actually sells that item at all (`shelf.cards`/`shelf.gems` > 0), not the
  // declared shelf size — an EMPTY pool for something the shop claims to
  // sell is the only real bug.
  it('every card-selling shop has a non-empty card pool', () => {
    for (const id of shopTypeIds) {
      const shop = shopCatalog[id]!;
      if (shop.shelf.cards === 0) continue;
      const pool = cardPoolForShop(id);
      expect(pool.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('every gem-selling shop has a non-empty gem pool', () => {
    for (const id of shopTypeIds) {
      const shop = shopCatalog[id]!;
      if (shop.shelf.gems === 0) continue;
      const pool = gemPoolForShop(id);
      expect(pool.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('the original 5 v1 themes still meet the old >= shelf-size / >= 3-gem bar (no regression)', () => {
    const v1Ids = ['armory', 'wildworks', 'arcanum', 'sanctum', 'alchemist'];
    for (const id of v1Ids) {
      const shop = shopCatalog[id]!;
      expect(cardPoolForShop(id).length).toBeGreaterThanOrEqual(shop.shelf.cards);
      expect(gemPoolForShop(id).length).toBeGreaterThanOrEqual(3);
    }
  });
});

describe('run/shop: rollShopStock determinism', () => {
  it('same (shopId, seed) -> identical shelf', () => {
    for (const id of shopTypeIds) {
      const a = rollShopStock(id, 12345);
      const b = rollShopStock(id, 12345);
      expect(a).toEqual(b);
    }
  });

  it('different seeds produce a different shelf somewhere', () => {
    let anyDifferent = false;
    for (const id of shopTypeIds) {
      const a = rollShopStock(id, 1);
      const b = rollShopStock(id, 2);
      if (JSON.stringify(a) !== JSON.stringify(b)) anyDifferent = true;
    }
    expect(anyDifferent).toBe(true);
  });

  it('shelves never exceed the declared shelf size and cards/gems are distinct', () => {
    for (const id of shopTypeIds) {
      const shop = shopCatalog[id]!;
      for (const seed of [1, 2, 3, 100, 999]) {
        const stock = rollShopStock(id, seed);
        expect(stock.cards.length).toBeLessThanOrEqual(shop.shelf.cards);
        expect(stock.gems.length).toBeLessThanOrEqual(shop.shelf.gems);
        expect(new Set(stock.cards.map((c) => c.skillId)).size).toBe(stock.cards.length);
        expect(new Set(stock.gems.map((g) => g.gemId)).size).toBe(stock.gems.length);
      }
    }
  });

  it('small pools (wildworks) still fill their shelf', () => {
    const stock = rollShopStock('wildworks', 42);
    expect(stock.cards.length).toBe(shopCatalog.wildworks!.shelf.cards);
    expect(stock.gems.length).toBe(shopCatalog.wildworks!.shelf.gems);
  });
});

describe('run/shop: filter integrity', () => {
  it('every offered card in every shop x several seeds matches that shop cardFilter', () => {
    for (const id of shopTypeIds) {
      const shop = shopCatalog[id]!;
      for (const seed of [1, 7, 55, 1234]) {
        const stock = rollShopStock(id, seed);
        for (const offer of stock.cards) {
          const skill = skillBook[offer.skillId]!;
          expect(cardMatchesFilter(skill, shop.cardFilter)).toBe(true);
        }
      }
    }
  });

  it('every offered gem in every shop x several seeds matches that shop gemFilter', () => {
    for (const id of shopTypeIds) {
      const shop = shopCatalog[id]!;
      for (const seed of [1, 7, 55, 1234]) {
        const stock = rollShopStock(id, seed);
        for (const offer of stock.gems) {
          const gem = gemBook[offer.gemId]!;
          expect(gemMatchesFilter(gem, shop.gemFilter)).toBe(true);
        }
      }
    }
  });
});

describe('run/shop: price audit', () => {
  it('card prices match the tier table, plus the shop\'s priceDelta markup (0 for most shops)', () => {
    for (const id of shopTypeIds) {
      const shop = shopCatalog[id]!;
      const delta = shop.priceDelta ?? 0;
      for (const seed of [1, 2, 3]) {
        const stock = rollShopStock(id, seed);
        for (const offer of stock.cards) {
          expect(offer.price).toBe(GOLD_PRICE_BY_TIER[offer.tier] + delta);
          expect(offer.price).toBe(goldPriceOfCard(offer.tier) + delta);
        }
      }
    }
  });

  it('bronze/silver/gold/diamond prices are 2/3/4/5', () => {
    const tiers: SkillTier[] = ['bronze', 'silver', 'gold', 'diamond'];
    expect(tiers.map((t) => goldPriceOfCard(t))).toEqual([2, 3, 4, 5]);
  });

  it('gem prices are in 1..4 (Legendary bumped to 4, 2026-08-09) and monotonic in gemPowerLevelDeci', () => {
    const priced = Object.values(gemBook).map((g) => ({
      id: g.id,
      deci: gemPowerLevelDeci(g),
      price: goldPriceOfGem(g.id),
    }));
    for (const { price } of priced) {
      expect(price).toBeGreaterThanOrEqual(1);
      expect(price).toBeLessThanOrEqual(4);
    }
    const sorted = [...priced].sort((a, b) => a.deci - b.deci);
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i]!.price).toBeGreaterThanOrEqual(sorted[i - 1]!.price);
    }
  });

  it('gem gold price maps 1:1 to rarity band — Common 1, Rare 2, Epic 3, Legendary 4 (2026-08-18: Epic split out of the old shared Rare/Epic rung so every rarity is a flat 20 deci-PL/gold, matching Common/Rare/Legendary and every card tier)', () => {
    const EXPECTED: Record<string, 1 | 2 | 3 | 4> = { common: 1, rare: 2, epic: 3, legendary: 4 };
    for (const gem of Object.values(gemBook)) {
      expect(goldPriceOfGem(gem.id)).toBe(EXPECTED[gem.rarity]);
    }
  });
});

describe('run/shop: depth-shifted tier split', () => {
  it('depth 1 (or omitted) matches the sandbox 70/25/5 split byte-identically', () => {
    for (const seed of [1, 2, 3, 42]) {
      const a = rollShopStock('armory', seed);
      const b = rollShopStock('armory', seed, 1);
      expect(a).toEqual(b);
    }
  });

  it('depths 1-3 / 4-6 / 7-9 skew progressively away from bronze', () => {
    const shopId = 'armory';
    const tally = (depth: number): Record<SkillTier, number> => {
      const counts: Record<SkillTier, number> = { bronze: 0, silver: 0, gold: 0, diamond: 0 };
      for (let seed = 1; seed <= 300; seed++) {
        for (const offer of rollShopStock(shopId, seed, depth).cards) counts[offer.tier] += 1;
      }
      return counts;
    };
    const early = tally(2);
    const mid = tally(5);
    const late = tally(8);
    const bronzeShare = (c: Record<SkillTier, number>): number => c.bronze / (c.bronze + c.silver + c.gold);
    expect(bronzeShare(early)).toBeGreaterThan(bronzeShare(mid));
    expect(bronzeShare(mid)).toBeGreaterThan(bronzeShare(late));
    // Diamond never appears in shops regardless of depth.
    expect(early.diamond).toBe(0);
    expect(mid.diamond).toBe(0);
    expect(late.diamond).toBe(0);
  });
});

describe('run/shop: gem rarity weighting + depth gate (2026-08-09, gem ruleset v1 §9.6 + fork 5)', () => {
  const LEGENDARY_IDS = new Set(Object.values(gemBook).filter((g) => g.rarity === 'legendary').map((g) => g.id));
  const hasLegendary = (stock: ReturnType<typeof rollShopStock>): boolean =>
    stock.gems.some((g) => LEGENDARY_IDS.has(g.gemId));

  it('same (shopId, seed, depth, rarityGated) -> identical WEIGHTED shelf, every time', () => {
    for (const [id, depth] of [['gemcutter', 8], ['relic_vault', 5], ['arcanum', 5]] as const) {
      const a = rollShopStock(id, 999, depth);
      const b = rollShopStock(id, 999, depth);
      expect(a).toEqual(b);
    }
  });

  it('DEPTH GATE: a wave-1 shop (depth 2) never offers a Legendary gem, across every shop that curates one', () => {
    const shopsWithLegendary = shopTypeIds.filter((id) => gemPoolForShop(id).some((g) => g.rarity === 'legendary'));
    expect(shopsWithLegendary.length).toBeGreaterThan(0); // sanity: the fixture below isn't vacuous
    for (const id of shopsWithLegendary) {
      for (let seed = 1; seed <= 100; seed++) {
        expect(hasLegendary(rollShopStock(id, seed, 2))).toBe(false);
      }
    }
  });

  it('DEPTH GATE: Legendary becomes reachable from depth 5 (wave 2+) onward, for a shop whose pool has one', () => {
    let sawLegendaryAt5 = false;
    let sawLegendaryAt8 = false;
    for (let seed = 1; seed <= 200; seed++) {
      if (hasLegendary(rollShopStock('gemcutter', seed, 5))) sawLegendaryAt5 = true;
      if (hasLegendary(rollShopStock('gemcutter', seed, 8))) sawLegendaryAt8 = true;
    }
    expect(sawLegendaryAt5).toBe(true);
    expect(sawLegendaryAt8).toBe(true);
  });

  it('DEPTH GATE: Epic is left ungated — reachable even at depth 2 (wave 1)', () => {
    let sawEpic = false;
    for (let seed = 1; seed <= 100; seed++) {
      const stock = rollShopStock('gemcutter', seed, 2);
      if (stock.gems.some((g) => gemBook[g.gemId]!.rarity === 'epic')) sawEpic = true;
    }
    expect(sawEpic).toBe(true);
  });

  it('SANDBOX UNGATED: rarityGated=false shows Legendary gems even at depth 1 (the sandbox default)', () => {
    let sawLegendary = false;
    for (let seed = 1; seed <= 200; seed++) {
      if (hasLegendary(rollShopStock('gemcutter', seed, 1, false))) sawLegendary = true;
    }
    expect(sawLegendary).toBe(true);
  });

  it('GATED (the default) shows no Legendary at depth 1, contrasting directly with the ungated case above', () => {
    for (let seed = 1; seed <= 200; seed++) {
      expect(hasLegendary(rollShopStock('gemcutter', seed, 1))).toBe(false);
      expect(hasLegendary(rollShopStock('gemcutter', seed, 1, true))).toBe(false);
    }
  });

  it('ONE-LEGENDARY-PER-SHELF CAP: no shelf, gated or not, ever offers more than one Legendary gem', () => {
    for (const id of shopTypeIds) {
      for (const [depth, rarityGated] of [[8, true], [1, false]] as const) {
        for (let seed = 1; seed <= 60; seed++) {
          const stock = rollShopStock(id, seed, depth, rarityGated);
          const legendaryCount = stock.gems.filter((g) => LEGENDARY_IDS.has(g.gemId)).length;
          expect(legendaryCount).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it('WEIGHT DISTRIBUTION SANITY: Common >> Rare >> Epic/Legendary over many Gemcutter shelves (statistical bounds, not exact counts)', () => {
    const counts: Record<Rarity, number> = { common: 0, rare: 0, epic: 0, legendary: 0 };
    let totalOffers = 0;
    const N = 1000;
    for (let seed = 1; seed <= N; seed++) {
      // depth 8 (wave 4+, fully unlocked) — the full 35-gem book is in play.
      const stock = rollShopStock('gemcutter', seed, 8);
      for (const offer of stock.gems) {
        counts[gemBook[offer.gemId]!.rarity] += 1;
        totalOffers += 1;
      }
    }
    const frac = (r: Rarity): number => counts[r] / totalOffers;
    // Loose bounds around the measured ~67/28/3.5/1.5% split — wide enough to
    // absorb a future weight retune without becoming a change-detector test,
    // tight enough to catch a broken/inverted weighting outright.
    expect(frac('common')).toBeGreaterThan(0.5);
    expect(frac('rare')).toBeGreaterThan(0.15);
    expect(frac('rare')).toBeLessThan(0.45);
    expect(frac('epic')).toBeLessThan(0.1);
    expect(frac('legendary')).toBeLessThan(0.05);
    expect(counts.legendary).toBeGreaterThan(0); // reachable, not just rare
    // The ordering the weight table (60/25/10/5) was chosen to produce.
    expect(counts.common).toBeGreaterThan(counts.rare);
    expect(counts.rare).toBeGreaterThan(counts.epic);
    expect(counts.epic).toBeGreaterThanOrEqual(counts.legendary);
  });

  it('GOLD PRICE: Legendary gems cost 4 gold; every other rarity is unaffected by the bump', () => {
    for (const gem of Object.values(gemBook)) {
      if (gem.rarity === 'legendary') expect(goldPriceOfGem(gem.id)).toBe(4);
    }
  });
});

describe('run/shop: shopPoolInfo (thin-pool arithmetic, docs/run-shops-design.md §2b)', () => {
  it('every theme reports slot-count arithmetic consistent with its pool/shelf (thin themes allowed)', () => {
    for (const id of shopTypeIds) {
      const info = shopPoolInfo(id);
      const shop = shopCatalog[id]!;
      // Gemcutter is a deliberate 0-card shop; every other theme sells >= 1 card.
      if (shop.shelf.cards > 0) expect(info.cardSlots).toBeGreaterThan(0);
      expect(info.cardSlots).toBeLessThanOrEqual(shop.shelf.cards);
      expect(info.gemSlots).toBeGreaterThan(0);
      expect(info.gemSlots).toBeLessThanOrEqual(shop.shelf.gems);
      expect(info.cardsFull).toBe(info.cardPoolSize <= shop.shelf.cards);
      expect(info.gemsFull).toBe(info.gemPoolSize <= shop.shelf.gems);
      expect(info.fullStock).toBe(info.cardsFull && info.gemsFull);
    }
  });

  it('the 5 v1 themes are never full stock (their pools exceed their shelves)', () => {
    for (const id of ['armory', 'wildworks', 'arcanum', 'sanctum', 'alchemist']) {
      const info = shopPoolInfo(id);
      expect(info.fullStock).toBe(false);
    }
  });

  it("Gemcutter's 0-card shelf reports cardsFull (0 <= 0) and 0 card slots, but is NOT full-stock overall (its 6-gem shelf undersells the whole book)", () => {
    const info = shopPoolInfo('gemcutter');
    expect(info.cardSlots).toBe(0);
    expect(info.cardsFull).toBe(true);
    expect(info.gemsFull).toBe(false);
    expect(info.fullStock).toBe(false);
  });

  it('cardSlots/gemSlots exactly match what rollShopStock actually offers (rarityGated: false — shopPoolInfo describes the FULL pool, not a depth-gated slice)', () => {
    for (const id of shopTypeIds) {
      const info = shopPoolInfo(id);
      const stock = rollShopStock(id, 777, 1, false);
      expect(stock.cards.length).toBe(info.cardSlots);
      expect(stock.gems.length).toBe(info.gemSlots);
    }
  });

  it('throws on an unknown shop id', () => {
    expect(() => shopPoolInfo('not-a-real-shop')).toThrow();
  });
});

describe('run/shop: 16-theme catalog (docs/run-shops-design.md §3)', () => {
  it('the catalog has exactly 16 themes', () => {
    expect(shopTypeIds.length).toBe(16);
    expect(new Set(shopTypeIds).size).toBe(16);
  });

  it('Gemcutter sells the FULL gem book via an unfiltered `all` clause', () => {
    const pool = gemPoolForShop('gemcutter');
    expect(pool.length).toBe(Object.keys(gemBook).length);
  });

  it('Caravan and Relic Vault sell from the whole card book (empty-clause wildcard)', () => {
    for (const id of ['caravan', 'relic_vault']) {
      const pool = cardPoolForShop(id);
      expect(pool.length).toBe(Object.keys(skillBook).length);
    }
  });

  it('every element stall\'s card pool matches its declared element exactly', () => {
    const byElement: Record<string, string> = {
      emberworks: 'fire',
      frosthold: 'frost',
      stormspire: 'lightning',
      grovekeep: 'nature',
      reliquary: 'holy',
      umbral_stall: 'dark',
    };
    for (const [shopId, element] of Object.entries(byElement)) {
      const pool = cardPoolForShop(shopId);
      expect(pool.length).toBeGreaterThan(0);
      for (const skill of pool) expect(skill.element).toBe(element);
    }
  });

  it('Relic Vault\'s tierBias skews heavily toward silver regardless of depth', () => {
    const tally = (depth: number): Record<SkillTier, number> => {
      const counts: Record<SkillTier, number> = { bronze: 0, silver: 0, gold: 0, diamond: 0 };
      for (let seed = 1; seed <= 300; seed++) {
        for (const offer of rollShopStock('relic_vault', seed, depth).cards) counts[offer.tier] += 1;
      }
      return counts;
    };
    for (const depth of [1, 5, 8]) {
      const counts = tally(depth);
      const total = counts.bronze + counts.silver + counts.gold + counts.diamond;
      expect(counts.silver / total).toBeGreaterThan(0.5);
      expect(counts.diamond).toBe(0);
    }
  });

  it('minWave-gated shops (Gemcutter wave 2+, Relic Vault wave 3+) never appear on an earlier wave in a generated run', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const map = generateRunMap(seed * 13 + 3);
      for (let d = 1; d <= totalColumns(map); d++) {
        for (const node of map.depths[d]!) {
          if (node.kind !== 'shop') continue;
          const minWave = shopCatalog[node.shopId!]?.minWave;
          if (minWave !== undefined) expect(node.wave).toBeGreaterThanOrEqual(minWave);
        }
      }
    }
  });
});

describe('run/shop: bigger shelves (2026-08-04 "shops sell more" pass)', () => {
  it('every non-Gemcutter shop declares the 6-card/5-gem target shelf', () => {
    for (const id of shopTypeIds) {
      if (id === 'gemcutter') continue;
      const shop = shopCatalog[id]!;
      expect(shop.shelf.gems).toBe(5);
      // Gemcutter aside, every OTHER shop sells cards too (0-card shops don't exist any more).
      expect(shop.shelf.cards).toBe(6);
    }
  });

  it("Gemcutter keeps its bigger 6-gem shelf and 0-card identity", () => {
    const shop = shopCatalog.gemcutter!;
    expect(shop.shelf).toEqual({ cards: 0, gems: 6 });
  });

  it('a thin element stall whose pool is smaller than the shelf still caps gracefully (no throw, no dead slots beyond the pool) — rarityGated: false, this is pool arithmetic, not the rarity-gate feature', () => {
    for (const id of ['emberworks', 'frosthold', 'stormspire', 'grovekeep', 'reliquary', 'umbral_stall']) {
      const info = shopPoolInfo(id);
      const stock = rollShopStock(id, 42, 1, false);
      expect(stock.cards.length).toBe(info.cardSlots);
      expect(stock.gems.length).toBe(info.gemSlots);
      expect(info.cardSlots).toBeLessThanOrEqual(cardPoolForShop(id).length);
      expect(info.gemSlots).toBeLessThanOrEqual(gemPoolForShop(id).length);
    }
  });

  it('every card-selling shop with a large enough pool now actually fills 6 card slots (not artificially truncated)', () => {
    for (const id of ['armory', 'wildworks', 'arcanum', 'sanctum', 'alchemist', 'bulwark', 'assassins_den', 'caravan', 'relic_vault']) {
      const stock = rollShopStock(id, 7);
      expect(stock.cards.length).toBe(6);
    }
  });

  it('every gem-selling shop with a large enough pool now actually fills 5 gem slots (rarityGated: false — pool-fill arithmetic, independent of the rarity gate)', () => {
    for (const id of ['armory', 'wildworks', 'bulwark', 'assassins_den', 'caravan', 'relic_vault']) {
      const stock = rollShopStock(id, 7, 1, false);
      expect(stock.gems.length).toBe(5);
    }
  });
});

describe('run/shop: sell-back pricing (2026-08-04)', () => {
  it('card sell price is half of goldPriceOfCard, floored, min 1', () => {
    expect(sellPriceOfCard('bronze')).toBe(1); // floor(2/2) = 1
    expect(sellPriceOfCard('silver')).toBe(1); // floor(3/2) = 1
    expect(sellPriceOfCard('gold')).toBe(2); // floor(4/2) = 2
    expect(sellPriceOfCard('diamond')).toBe(2); // floor(5/2) = 2
  });

  it('card sell price is always strictly less than (or, at bronze, half of) the buy price — never a free flip', () => {
    for (const tier of SKILL_TIER_ORDER) {
      expect(sellPriceOfCard(tier)).toBeLessThan(goldPriceOfCard(tier));
    }
  });

  it('gem sell price is half of goldPriceOfGem, floored, min 1 (Common/Rare/Epic sell for 1; Legendary sells for 2 since the 2026-08-09 4-gold bump)', () => {
    for (const gem of Object.values(gemBook)) {
      const buy = goldPriceOfGem(gem.id);
      const sell = sellPriceOfGem(gem.id);
      expect(sell).toBe(Math.max(1, Math.floor(buy / 2)));
      expect(sell).toBeGreaterThanOrEqual(1);
    }
  });

  it('throws on an unknown gem id (mirrors goldPriceOfGem)', () => {
    expect(() => sellPriceOfGem('not-a-real-gem')).toThrow();
  });
});

describe('run/shop: duplicate merging (nextSkillTier + findMergeTarget)', () => {
  function card(instanceId: string, skillId: string, tier: MergeableCard['tier']): MergeableCard {
    return { instanceId, skillId, tier };
  }

  it('SKILL_TIER_ORDER is the 4 tiers low -> high', () => {
    expect(SKILL_TIER_ORDER).toEqual(['bronze', 'silver', 'gold', 'diamond']);
  });

  it('nextSkillTier climbs one rung, and is null at the diamond ceiling', () => {
    expect(nextSkillTier('bronze')).toBe('silver');
    expect(nextSkillTier('silver')).toBe('gold');
    expect(nextSkillTier('gold')).toBe('diamond');
    expect(nextSkillTier('diamond')).toBeNull();
  });

  it('returns null when the player owns no copy of the skill at all', () => {
    const board = [card('c1', 'sword_slash', 'bronze')];
    const bag = [card('c2', 'fireball', 'bronze')];
    expect(findMergeTarget('war_banner', board, bag)).toBeNull();
  });

  it('returns null when EVERY owned copy is already diamond', () => {
    const board = [card('c1', 'sword_slash', 'diamond')];
    const bag = [card('c2', 'sword_slash', 'diamond'), null];
    expect(findMergeTarget('sword_slash', board, bag)).toBeNull();
  });

  it('targets the LOWEST-tier owned instance, regardless of board/bag location', () => {
    const board = [card('c1', 'sword_slash', 'gold')];
    const bag = [card('c2', 'sword_slash', 'bronze')];
    const target = findMergeTarget('sword_slash', board, bag);
    expect(target).toEqual({ location: 'bag', index: 0, instanceId: 'c2', fromTier: 'bronze', toTier: 'silver' });
  });

  it('on a tier TIE, the board copy wins over the bag copy', () => {
    const board = [card('c1', 'sword_slash', 'bronze')];
    const bag = [card('c2', 'sword_slash', 'bronze')];
    const target = findMergeTarget('sword_slash', board, bag);
    expect(target).toEqual({ location: 'board', index: 0, instanceId: 'c1', fromTier: 'bronze', toTier: 'silver' });
  });

  it('a diamond copy is skipped in favor of a lower-tier copy elsewhere', () => {
    const board = [card('c1', 'sword_slash', 'diamond')];
    const bag = [card('c2', 'sword_slash', 'silver')];
    const target = findMergeTarget('sword_slash', board, bag);
    expect(target).toEqual({ location: 'bag', index: 0, instanceId: 'c2', fromTier: 'silver', toTier: 'gold' });
  });

  it('null bag slots are skipped without throwing', () => {
    const board: MergeableCard[] = [];
    const bag = [null, card('c1', 'sword_slash', 'bronze'), null];
    const target = findMergeTarget('sword_slash', board, bag);
    expect(target).toEqual({ location: 'bag', index: 1, instanceId: 'c1', fromTier: 'bronze', toTier: 'silver' });
  });

  it('is generic over any {instanceId, skillId, tier}-shaped piece (structural, not a src/run-only type)', () => {
    interface FancyPiece extends MergeableCard { slot: number; gem?: null }
    const board: FancyPiece[] = [{ instanceId: 'p1', skillId: 'sword_slash', tier: 'bronze', slot: 0, gem: null }];
    const target = findMergeTarget<FancyPiece>('sword_slash', board, []);
    expect(target?.location).toBe('board');
  });
});

describe('run/shop: battleGoldReward', () => {
  it('winBonus is always 1..3', () => {
    const cases: { level: number; title: 'mob' | 'normal' | 'elite' | 'boss'; rank: number; modifiers?: string[] }[][] = [
      [{ level: 1, title: 'mob', rank: 0 }],
      [{ level: 20, title: 'boss', rank: 12, modifiers: ['diamond', 'swift'] }],
      [
        { level: 5, title: 'elite', rank: 3 },
        { level: 5, title: 'elite', rank: 3 },
        { level: 5, title: 'normal', rank: 0 },
      ],
    ];
    for (const foes of cases) {
      const { winBonus } = battleGoldReward(foes, 5);
      expect(winBonus).toBeGreaterThanOrEqual(1);
      expect(winBonus).toBeLessThanOrEqual(3);
    }
  });

  it('base is always 1', () => {
    expect(battleGoldReward([{ level: 1, title: 'mob', rank: 0 }], 1).base).toBe(1);
    expect(battleGoldReward([{ level: 50, title: 'boss', rank: 20 }], 1).base).toBe(1);
  });

  it('a boss team beats a mob team at equal level', () => {
    const mob = battleGoldReward([{ level: 5, title: 'mob', rank: 0 }], 5);
    const boss = battleGoldReward([{ level: 5, title: 'boss', rank: 12 }], 5);
    expect(boss.winBonus).toBeGreaterThan(mob.winBonus);
  });

  it('a higher foe level scores >= a lower foe level, all else equal', () => {
    const low = battleGoldReward([{ level: 5, title: 'normal', rank: 0 }], 5);
    const high = battleGoldReward([{ level: 15, title: 'normal', rank: 0 }], 5);
    expect(high.winBonus).toBeGreaterThanOrEqual(low.winBonus);
  });
});
