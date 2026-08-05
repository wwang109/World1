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
  shopPoolInfo,
  SKILL_TIER_ORDER,
  type MergeableCard,
} from '../../src/run/shop';
import { shopCatalog, shopTypeIds } from '../../src/data/shopTypes';
import { skillBook } from '../../src/data/skills';
import { gemBook } from '../../src/data/gems';
import { gemPowerLevelDeci } from '../../src/engine/balance';
import type { SkillTier } from '../../src/engine/types';
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

  it('gem prices are in 1..3 and monotonic in gemPowerLevelDeci', () => {
    const priced = Object.values(gemBook).map((g) => ({
      id: g.id,
      deci: gemPowerLevelDeci(g),
      price: goldPriceOfGem(g.id),
    }));
    for (const { price } of priced) {
      expect(price).toBeGreaterThanOrEqual(1);
      expect(price).toBeLessThanOrEqual(3);
    }
    const sorted = [...priced].sort((a, b) => a.deci - b.deci);
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i]!.price).toBeGreaterThanOrEqual(sorted[i - 1]!.price);
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

  it('cardSlots/gemSlots exactly match what rollShopStock actually offers', () => {
    for (const id of shopTypeIds) {
      const info = shopPoolInfo(id);
      const stock = rollShopStock(id, 777);
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
