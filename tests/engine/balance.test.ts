import { describe, expect, it } from 'vitest';
import { BUDGET_TOLERANCE_DECI, isOnBudget, PRICE, powerLevel, powerLevelDeci, TIER_BUDGET_DECI } from '../../src/engine/balance';
import { skillBook } from '../../src/data/skills';
import type { SkillDef } from '../../src/engine/types';

describe('Power Level budgets', () => {
  it('tier budgets are Bronze 10 / Silver 15 / Gold 20 / Diamond 25', () => {
    expect(TIER_BUDGET_DECI).toEqual({ bronze: 100, silver: 150, gold: 200, diamond: 250 });
  });

  it('BALANCE AUDIT: every card in the data matches its tier budget (±0.5 PL)', () => {
    const offenders: string[] = [];
    for (const skill of Object.values(skillBook)) {
      const deci = powerLevelDeci(skill);
      const budget = TIER_BUDGET_DECI[skill.tier];
      if (Math.abs(deci - budget) > BUDGET_TOLERANCE_DECI) {
        offenders.push(`${skill.id}: PL ${deci / 10} (budget ${budget / 10}, ${skill.tier})`);
      }
    }
    expect(offenders, offenders.join('\n')).toEqual([]);
  });

  it('every 2 weight = 1 PL: heavier refunds, lighter costs', () => {
    const base: SkillDef = {
      id: 'x',
      name: 'x',
      archetypes: ['offense'],
      property: 'physical',
      size: 1,
      rarity: 'common',
      tier: 'bronze',
      effects: [{ kind: 'damage', power: 200 }],
      text: '',
    };
    const baseline = powerLevelDeci(base);
    expect(powerLevelDeci({ ...base, speedWeight: 12 })).toBe(baseline - 10); // +2 heavier -> −1 PL
    expect(powerLevelDeci({ ...base, speedWeight: 8 })).toBe(baseline + 10); // −2 lighter -> +1 PL
  });

  it('bigger sizes grant extra budget (space + span costs)', () => {
    const mk = (size: 1 | 2 | 3): SkillDef => ({
      id: 'x',
      name: 'x',
      archetypes: ['offense'],
      property: 'physical',
      size,
      rarity: 'common',
      tier: 'bronze',
      effects: [{ kind: 'damage', power: 200 }],
      text: '',
    });
    expect(powerLevelDeci(mk(2))).toBe(powerLevelDeci(mk(1)) - 30);
    expect(powerLevelDeci(mk(3))).toBe(powerLevelDeci(mk(1)) - 60);
  });

  it('the true-property premium applies to casting cards only', () => {
    const casting: SkillDef = {
      id: 'x',
      name: 'x',
      archetypes: ['healing'],
      property: 'true',
      size: 1,
      rarity: 'common',
      tier: 'bronze',
      effects: [{ kind: 'heal', power: 40 }],
      text: '',
    };
    const passive: SkillDef = {
      ...casting,
      effects: [],
      aura: { affects: 'adjacent', mods: { critPctDelta: 20 } },
    };
    expect(powerLevelDeci(casting)).toBe(40 * PRICE.flatTruePerPoint + PRICE.truePremium); // flat heal + premium
    expect(powerLevelDeci(passive)).toBe(20 * PRICE.auraCritPct); // aura only, no premium
  });

  it('powerLevel() reports decimal-precise PL and all demo cards sit on budget', () => {
    for (const skill of Object.values(skillBook)) {
      // All demo cards are Bronze (budget 10, tolerance ±0.5 PL).
      expect(Math.abs(powerLevel(skill) - 10), skill.id).toBeLessThanOrEqual(0.5);
      expect(isOnBudget(skill)).toBe(true);
    }
  });

  it('guard is priced at a premium over the plain stat-buff rate (pct * turns)', () => {
    const guardCard: SkillDef = {
      id: 'x',
      name: 'x',
      archetypes: ['defensive'],
      property: 'magical',
      size: 1,
      rarity: 'common',
      tier: 'bronze',
      effects: [{ kind: 'guard', property: 'magical', pct: 40, turns: 2 }],
      text: '',
    };
    // 40 * 2 * (5/4) = 100 deci = Bronze exactly, and strictly pricier per
    // pct-turn than a plain buffStat of the same magnitude (statPctTurn = 1x).
    expect(powerLevelDeci(guardCard)).toBe(100);
    expect(PRICE.guardPerPctTurnNum / PRICE.guardPerPctTurnDen).toBeGreaterThan(PRICE.statPctTurn);
  });

  it('negate is priced per charge; the apply-time max (3) lands on Silver', () => {
    const mk = (charges: number): SkillDef => ({
      id: 'x',
      name: 'x',
      archetypes: ['defensive'],
      property: 'magical',
      size: 1,
      rarity: 'common',
      tier: 'bronze',
      effects: [{ kind: 'negate', property: 'magical', charges }],
      text: '',
    });
    expect(powerLevelDeci(mk(1))).toBe(PRICE.negatePerCharge);
    expect(powerLevelDeci(mk(2))).toBe(TIER_BUDGET_DECI.bronze);
    expect(powerLevelDeci(mk(3))).toBe(TIER_BUDGET_DECI.silver);
  });
});
