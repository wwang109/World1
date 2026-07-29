import { describe, expect, it } from 'vitest';
import {
  battleGoldReward,
  cardMatchesFilter,
  cardPoolForShop,
  gemMatchesFilter,
  gemPoolForShop,
  GOLD_PRICE_BY_TIER,
  goldPriceOfCard,
  goldPriceOfGem,
  rollShopStock,
} from '../../src/run/shop';
import { shopCatalog, shopTypeIds } from '../../src/data/shopTypes';
import { skillBook } from '../../src/data/skills';
import { gemBook } from '../../src/data/gems';
import { gemPowerLevelDeci } from '../../src/engine/balance';
import type { SkillTier } from '../../src/engine/types';

describe('run/shop: pool sanity', () => {
  it('every shop card pool is at least as large as its shelf size', () => {
    for (const id of shopTypeIds) {
      const shop = shopCatalog[id]!;
      const pool = cardPoolForShop(id);
      expect(pool.length).toBeGreaterThanOrEqual(shop.shelf.cards);
    }
  });

  it('every shop gem pool has at least 3 matching gems', () => {
    for (const id of shopTypeIds) {
      const pool = gemPoolForShop(id);
      expect(pool.length).toBeGreaterThanOrEqual(3);
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
  it('card prices exactly match the tier table', () => {
    for (const id of shopTypeIds) {
      for (const seed of [1, 2, 3]) {
        const stock = rollShopStock(id, seed);
        for (const offer of stock.cards) {
          expect(offer.price).toBe(GOLD_PRICE_BY_TIER[offer.tier]);
          expect(offer.price).toBe(goldPriceOfCard(offer.tier));
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
