import { describe, expect, it } from 'vitest';
import {
  BUDGET_TOLERANCE_DECI,
  capViolations,
  EFFECT_CAPS_DECI,
  effectCapDeci,
  gemPowerLevelDeci,
  isGemOnBudget,
  isOnBudget,
  MAX_STUN_PER_CARD,
  PRICE,
  powerLevel,
  powerLevelBreakdown,
  powerLevelDeci,
  RARITY_PL_DECI,
  TIER_BUDGET_DECI,
} from '../../src/engine/balance';
import { skillBook } from '../../src/data/skills';
import type { Gem, SkillDef } from '../../src/engine/types';

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

  it('EFFECT-CAP AUDIT: no card over-invests in control / DoT / empower for its size', () => {
    // The design contract (user-locked 2026-07-20): per-size ceilings on the
    // PL a single card may invest per effect family, plus stun ≤ 1. When
    // designing a card, this test names any rule it breaks.
    expect(EFFECT_CAPS_DECI).toEqual({
      control: { 1: 100, 2: 150, 3: 200 },
      dot: { 1: 200, 2: 300, 3: 400 },
      empower: { 1: 100, 2: 150, 3: 200 },
      damage: { 1: 120, 2: 280, 3: 500 },
      shield: { 1: 120, 2: 280, 3: 500 },
      heal: { 1: 120, 2: 280, 3: 500 },
    });
    expect(MAX_STUN_PER_CARD).toBe(1);
    // Flat families scale with tier (×1.5/×2/×2.5); the others never do.
    expect(effectCapDeci('damage', 1, 'diamond')).toBe(300);
    expect(effectCapDeci('control', 1, 'diamond')).toBe(100);
    const offenders: string[] = [];
    for (const skill of Object.values(skillBook)) {
      for (const violation of capViolations(skill)) offenders.push(`${skill.id}: ${violation}`);
    }
    expect(offenders, offenders.join('\n')).toEqual([]);
  });

  it('capViolations names over-invested families and multi-stun', () => {
    const overControl: SkillDef = {
      id: 'x', name: 'x', archetypes: ['debuff'], property: 'physical', weapon: 'axe',
      size: 1, rarity: 'common', tier: 'bronze', text: '',
      // stun (10 PL) + 50%×2t stat-down (10 PL) = 20 PL control on a size-1 card (cap 10).
      effects: [
        { kind: 'stun', turns: 1 },
        { kind: 'debuffStat', stat: 'attack', pct: 50, turns: 2 },
      ],
    };
    expect(capViolations(overControl)).toEqual(['control 20 PL exceeds the size-1 bronze cap (10 PL)']);

    const doubleStun: SkillDef = {
      ...overControl,
      size: 3, // size-3 control cap is 20 PL, so ONLY the stun rule should fire
      effects: [{ kind: 'stun', turns: 2 }],
    };
    expect(capViolations(doubleStun)).toEqual(['stun 2 exceeds the 1-performance cap']);
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
    expect(powerLevelDeci(mk(2))).toBe(powerLevelDeci(mk(1)) - 140);
    expect(powerLevelDeci(mk(3))).toBe(powerLevelDeci(mk(1)) - 380);
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
    expect(powerLevelDeci(casting)).toBe(40 * PRICE.flatTrueHealPerPoint); // flat heal; the TRUE premium scales with damage only
    expect(powerLevelDeci(passive)).toBe(20 * PRICE.auraCritPct); // aura only, no premium
  });

  it('powerLevel() reports decimal-precise PL and all demo cards sit on budget', () => {
    for (const skill of Object.values(skillBook)) {
      // All demo cards are Bronze (budget 10, tolerance ±0.5 PL).
      expect(Math.abs(powerLevel(skill) - 10), skill.id).toBeLessThanOrEqual(0.5);
      expect(isOnBudget(skill)).toBe(true);
    }
  });

  it('guard is priced at parity with the plain stat-buff rate (pct * turns)', () => {
    const guardCard: SkillDef = {
      id: 'x',
      name: 'x',
      archetypes: ['defensive'],
      property: 'magical',
      size: 1,
      rarity: 'common',
      tier: 'bronze',
      effects: [{ kind: 'guard', property: 'magical', pct: 50, turns: 2 }],
      text: '',
    };
    // 50 * 2 * (1/1) = 100 deci = Bronze exactly; the 1.25x premium was removed
    // (user-locked 2026-07-19) so guard now prices identically per pct-turn to a
    // plain buffStat of the same magnitude (statPctTurn = 1x).
    expect(powerLevelDeci(guardCard)).toBe(100);
    expect(PRICE.guardPerPctTurnNum / PRICE.guardPerPctTurnDen).toBe(PRICE.statPctTurn);
  });

  it('expose is priced at guard-parity (pct * turns)', () => {
    const exposeCard: SkillDef = {
      id: 'x',
      name: 'x',
      archetypes: ['debuff'],
      property: 'magical',
      size: 1,
      rarity: 'common',
      tier: 'bronze',
      effects: [{ kind: 'expose', pct: 50, turns: 2 }],
      text: '',
    };
    // 50 * 2 * (1/1) = 100 deci = Bronze exactly; amplify and reduce cost the same.
    expect(powerLevelDeci(exposeCard)).toBe(100);
    expect(PRICE.exposePerPctTurnNum / PRICE.exposePerPctTurnDen).toBe(
      PRICE.guardPerPctTurnNum / PRICE.guardPerPctTurnDen,
    );
  });

  it('negate is priced per charge (100 deci); 1 charge lands on Bronze', () => {
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
    expect(PRICE.negatePerCharge).toBe(100);
    expect(powerLevelDeci(mk(1))).toBe(TIER_BUDGET_DECI.bronze);
    expect(powerLevelDeci(mk(2))).toBe(200);
    expect(powerLevelDeci(mk(3))).toBe(300);
  });

  it('bleed is priced at the decaying-DoT rate (N×(N+1)/2 total × 2 deci), same as poison/burn', () => {
    const bleedCard: SkillDef = {
      id: 'x',
      name: 'x',
      archetypes: ['debuff'],
      property: 'physical',
      size: 1,
      weapon: 'axe',
      rarity: 'common',
      tier: 'bronze',
      effects: [{ kind: 'bleed', stacks: 9 }],
      text: '',
    };
    // 9 stacks tick 9+8+…+1 = 45 total damage × dotPerTotalDamage(2) =
    // 90 deci. Whole PL ⇔ N ≡ 0 or 4 (mod 5).
    expect(PRICE.dotPerTotalDamage).toBe(2);
    expect(powerLevelDeci(bleedCard)).toBe(((9 * 10) / 2) * PRICE.dotPerTotalDamage);
    expect(powerLevelDeci(bleedCard)).toBe(90);
  });

  it('cleanse is priced per charge (25 deci); 4 charges lands on Bronze', () => {
    const mk = (charges: number): SkillDef => ({
      id: 'x',
      name: 'x',
      archetypes: ['healing'],
      property: 'true',
      size: 1,
      element: 'holy',
      rarity: 'common',
      tier: 'bronze',
      effects: [{ kind: 'cleanse', charges }],
      text: '',
    });
    expect(PRICE.cleansePerCharge).toBe(25);
    expect(powerLevelDeci(mk(4))).toBe(TIER_BUDGET_DECI.bronze);
    expect(powerLevelDeci(mk(1))).toBe(25);
  });
});

describe('Power Level breakdown', () => {
  it('parts sum exactly to powerLevelDeci for every card', () => {
    for (const skill of Object.values(skillBook)) {
      const sum = powerLevelBreakdown(skill).reduce((total, part) => total + part.deci, 0);
      expect(sum, `${skill.id} breakdown must sum to its audited deci-PL`).toBe(powerLevelDeci(skill));
    }
  });

  // User-locked 2026-07-19: rules are whole-PL per clean unit and cards must
  // CONFORM — every priced part of every card lands on a whole PL. If this
  // fails, fix the card's effect magnitudes, never the rates.
  it('every priced part of every card is a WHOLE power level', () => {
    for (const skill of Object.values(skillBook)) {
      for (const part of powerLevelBreakdown(skill)) {
        expect(Math.abs(part.deci % 10), `${skill.id}: ${part.label} = ${part.deci / 10} PL must be whole`).toBe(0);
      }
    }
  });
});

describe('Gem Power Level', () => {
  it('rarity bands: Common 20 / Rare 40 / Epic 60 / Legendary 80 deci-PL', () => {
    expect(RARITY_PL_DECI).toEqual({ common: 20, rare: 40, epic: 60, legendary: 80 });
  });

  it('effect gem: priced via actionsPriceDeci over the canonical (physical) property', () => {
    // disrupt 8 -> floor(8 * 5/2) = 20 deci; lands on the Common band.
    const gem: Gem = { kind: 'effect', id: 'g1', rarity: 'common', actions: [{ kind: 'disrupt', amount: 8 }] };
    expect(gemPowerLevelDeci(gem)).toBe(Math.floor((8 * PRICE.disruptPerPointNum) / PRICE.disruptPerPointDen));
    expect(gemPowerLevelDeci(gem)).toBe(20);
    expect(isGemOnBudget(gem)).toBe(true);
  });

  it('card-scope stat gem: reuses the aura per-point rates, no reach multiplier', () => {
    const gem: Gem = {
      kind: 'stat',
      id: 'g2',
      rarity: 'rare',
      scope: 'card',
      mods: { card: { damageFlat: 2 } }, // 2 * auraDamageFlat(20) = 40 deci
    };
    expect(gemPowerLevelDeci(gem)).toBe(2 * PRICE.auraDamageFlat);
    expect(gemPowerLevelDeci(gem)).toBe(40);
    expect(isGemOnBudget(gem)).toBe(true);
  });

  it('hero-scope stat gem: flat points priced via PRICE.heroStatPerPoint', () => {
    const gem: Gem = {
      kind: 'stat',
      id: 'g3',
      rarity: 'epic',
      scope: 'hero',
      mods: { hero: { attack: 5, speed: 4 } }, // 5*8 + 4*5 = 60 deci
    };
    expect(gemPowerLevelDeci(gem)).toBe(5 * PRICE.heroStatPerPoint.attack + 4 * PRICE.heroStatPerPoint.speed);
    expect(gemPowerLevelDeci(gem)).toBe(60);
    expect(isGemOnBudget(gem)).toBe(true);
  });

  it('isGemOnBudget flags a gem outside its rarity band', () => {
    const cheapCommon: Gem = { kind: 'effect', id: 'g4', rarity: 'common', actions: [{ kind: 'disrupt', amount: 4 }] };
    expect(isGemOnBudget(cheapCommon)).toBe(false);
  });
});
