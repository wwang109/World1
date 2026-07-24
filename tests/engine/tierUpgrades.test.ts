import { describe, expect, it } from 'vitest';
import { applyTier, autoScaleTier } from '../../src/engine/cards';
import { capViolations, powerLevelDeci, TIER_BUDGET_DECI } from '../../src/engine/balance';
import { skillBook } from '../../src/data/skills';
import type { SkillTier } from '../../src/engine/types';

/**
 * Cards the budget-honest auto-scaler CANNOT lift to a higher tier's budget:
 * pure control / empower / aura kits with no damage/heal/shield sink (and no
 * DoT line) to absorb the extra PL. They rank up with only their `tier` bumped
 * (base kit unchanged → under budget). Shrink this set to empty once each has
 * an authored `tierUpgrades` path.
 */
const CAP_HITTERS_PENDING = new Set<string>([
  'war_banner',
  'time_crystal',
  'battle_howl',
  'hex_of_frailty',
  'armor_break',
  'stunning_smash',
  'purify',
  'frost_ward',
  'ward_of_silence',
  'ruinous_hex',
]);

const ABOVE: Record<SkillTier, SkillTier[]> = {
  bronze: ['silver', 'gold', 'diamond'],
  silver: ['gold', 'diamond'],
  gold: ['diamond'],
  diamond: [],
};

describe('tier-up audit: budget-honest auto-scaler', () => {
  it('every auto-scaled card lands EXACTLY on the target tier budget and stays cap-compliant', () => {
    const offenders: string[] = [];
    for (const skill of Object.values(skillBook)) {
      if (CAP_HITTERS_PENDING.has(skill.id)) continue;
      for (const tier of ABOVE[skill.tier]) {
        const scaled = applyTier(skill, tier);
        const deci = powerLevelDeci(scaled);
        if (deci !== TIER_BUDGET_DECI[tier]) {
          offenders.push(`${skill.id}@${tier}: PL ${deci / 10} (budget ${TIER_BUDGET_DECI[tier] / 10})`);
        }
        for (const v of capViolations(scaled)) offenders.push(`${skill.id}@${tier}: ${v}`);
      }
    }
    expect(offenders, offenders.join('\n')).toEqual([]);
  });

  it('CAP-HIT cards rank up with tier bumped but base kit unchanged (under budget)', () => {
    for (const id of CAP_HITTERS_PENDING) {
      const skill = skillBook[id]!;
      for (const tier of ABOVE[skill.tier]) {
        const scaled = applyTier(skill, tier);
        expect(scaled.tier).toBe(tier);
        expect(scaled.effects).toEqual(skill.effects);
        // still compliant with the (flat) effect caps at the new tier
        expect(capViolations(scaled)).toEqual([]);
      }
    }
  });

  it('the scaler never changes a card weight, size, or property', () => {
    for (const skill of Object.values(skillBook)) {
      for (const tier of ABOVE[skill.tier]) {
        const scaled = applyTier(skill, tier);
        expect(scaled.size).toBe(skill.size);
        expect(scaled.speedWeight).toBe(skill.speedWeight);
        expect(scaled.property).toBe(skill.property);
      }
    }
  });

  it('a target at or below the base tier is a no-op (same reference)', () => {
    const sword = skillBook.sword_slash!;
    expect(applyTier(sword, 'bronze')).toBe(sword);
  });

  it('an authored tierUpgrades entry overrides the auto-scaler verbatim', () => {
    const base = skillBook.sword_slash!;
    const authored = {
      ...base,
      tierUpgrades: {
        silver: { effects: [{ kind: 'damage' as const, power: 99 }], text: 'authored' },
      },
    };
    const scaled = applyTier(authored, 'silver');
    expect(scaled.tier).toBe('silver');
    expect(scaled.effects).toEqual([{ kind: 'damage', power: 99 }]);
    expect(scaled.text).toBe('authored');
  });

  it('DoT sink cards grow their stacks toward the cap (venom_fang / fireball / rupturing_strike)', () => {
    const stacksAt = (id: string, tier: SkillTier, kind: string): number => {
      const scaled = autoScaleTier(skillBook[id]!, tier);
      const dot = scaled.effects.find((a) => a.kind === kind) as { stacks: number };
      return dot.stacks;
    };
    // venom_fang (poison, size 1): grows to fill remaining budget, capped at 20.
    expect(stacksAt('venom_fang', 'silver', 'poison')).toBe(16);
    expect(stacksAt('venom_fang', 'gold', 'poison')).toBe(20);
    expect(stacksAt('venom_fang', 'diamond', 'poison')).toBe(20);
    // fireball (burn, size 2): cap 300 deci = 30 stacks binds from Silver up.
    expect(stacksAt('fireball', 'silver', 'burn')).toBe(30);
    expect(stacksAt('fireball', 'gold', 'burn')).toBe(30);
    expect(stacksAt('fireball', 'diamond', 'burn')).toBe(30);
    // rupturing_strike (bleed, size 1): 15 → 20 → 20 (cap binds at Gold).
    expect(stacksAt('rupturing_strike', 'silver', 'bleed')).toBe(15);
    expect(stacksAt('rupturing_strike', 'gold', 'bleed')).toBe(20);
    expect(stacksAt('rupturing_strike', 'diamond', 'bleed')).toBe(20);
  });

  it('prism_barrier ranks to exactly its tier budget (was 51 PL at Diamond under the naive scaler)', () => {
    expect(powerLevelDeci(applyTier(skillBook.prism_barrier!, 'diamond'))).toBe(TIER_BUDGET_DECI.diamond);
  });
});
