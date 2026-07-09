import { describe, expect, it } from 'vitest';
import { isOnBudget, powerLevel } from '../../src/engine/balance';
import { buildTierVariant, baseIdOf, TIER_NUMERAL } from '../../src/engine/tierUp';
import { skillBook } from '../../src/data/skills';
import { cardAtTier, fullBook, tiersOf } from '../../src/data/library';

describe('generated tier variants', () => {
  it('AUDIT: every card in the full library sits on its tier budget', () => {
    const offenders = Object.values(fullBook)
      .filter((s) => !isOnBudget(s))
      .map((s) => `${s.id}: PL ${powerLevel(s)} (${s.tier})`);
    expect(offenders, offenders.join('\n')).toEqual([]);
  });

  it('variants keep the base identity: id/name suffix, same shape, bigger kit', () => {
    for (const base of Object.values(skillBook)) {
      for (const tier of ['silver', 'gold', 'diamond'] as const) {
        const v = cardAtTier(base.id, tier);
        if (!v) continue;
        expect(baseIdOf(v.id)).toBe(base.id);
        expect(v.name).toBe(`${base.name} ${TIER_NUMERAL[tier]}`);
        expect(v.size).toBe(base.size);
        expect(v.archetypes).toEqual(base.archetypes);
        expect(v.property).toBe(base.property);
        expect(v.element).toBe(base.element);
        expect(v.weapon).toBe(base.weapon);
        expect(powerLevel(v)).toBeGreaterThan(powerLevel(base));
      }
    }
  });

  it('most cards reach diamond; knobless cards stay bronze-only', () => {
    expect(tiersOf('fireball')).toEqual(['bronze', 'silver', 'gold', 'diamond']);
    expect(tiersOf('flurry_of_knives')).toEqual(['bronze', 'silver', 'gold', 'diamond']);
    expect(tiersOf('war_banner')).toEqual(['bronze', 'silver', 'gold', 'diamond']);
    // Purify is cleanse-only, Time Crystal's weight aura is too coarsely priced.
    expect(tiersOf('purify')).toEqual(['bronze']);
    expect(tiersOf('time_crystal')).toEqual(['bronze']);
  });

  it('generation is deterministic', () => {
    const a = buildTierVariant(skillBook['fireball']!, 'gold');
    const b = buildTierVariant(skillBook['fireball']!, 'gold');
    expect(a).toEqual(b);
  });
});
