import { describe, expect, it } from 'vitest';
import { isGemOnBudget } from '../../src/engine/balance';
import { gemBook } from '../../src/data/gems';
import type { Rarity } from '../../src/engine/types';

describe('Gem catalog audit', () => {
  it('GEM BALANCE AUDIT: every gem in the catalog sits inside its rarity band (±0.5 PL)', () => {
    const offenders: string[] = [];
    for (const gem of Object.values(gemBook)) {
      if (!isGemOnBudget(gem)) {
        offenders.push(`${gem.id} (${gem.name})`);
      }
    }
    expect(offenders, offenders.join('\n')).toEqual([]);
  });

  it('all 4 rarities are represented in the catalog', () => {
    const rarities = new Set(Object.values(gemBook).map((g) => g.rarity));
    const expected: Rarity[] = ['common', 'rare', 'epic', 'legendary'];
    for (const rarity of expected) {
      expect(rarities.has(rarity), `missing rarity: ${rarity}`).toBe(true);
    }
  });

  it('all 3 gem flavors are represented: effect, card-scope stat, hero-scope stat', () => {
    const gems = Object.values(gemBook);
    const hasEffect = gems.some((g) => g.kind === 'effect');
    const hasCardStat = gems.some((g) => g.kind === 'stat' && g.scope === 'card');
    const hasHeroStat = gems.some((g) => g.kind === 'stat' && g.scope === 'hero');
    expect(hasEffect, 'no effect gem found').toBe(true);
    expect(hasCardStat, 'no card-scope stat gem found').toBe(true);
    expect(hasHeroStat, 'no hero-scope stat gem found').toBe(true);
  });
});
