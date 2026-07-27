import { describe, expect, it } from 'vitest';
import {
  BUDGET_TOLERANCE_DECI,
  capViolations,
  disruptCostDeci,
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

// USER-LOCKED 2026-07-23 — no drift. The entire price table is frozen here:
// changing any rate in balance.ts MUST also edit this literal, so every pricing
// change is a deliberate, reviewed decision — never a silent refactor. Same
// drift-guard philosophy as the card balance audit below.
//
// 2026-07-23: DoT pricing switched from the quadratic decaying-TOTAL model
// (dotPerTotalDamage / burnPlDeciBySize) to a single LINEAR PER-STACK rate
// (dotPerStack) shared by poison/bleed/burn — see balance.ts for the full
// rationale. Tick gameplay is unchanged; only the price formula moved.
//
// 2026-07-23: comboBonus cut from a flat 5/pt (no discount) to 2.5/pt
// (comboPerPointNum/Den = 5/2) — CONDITIONAL-TRIGGER DISCOUNT: a bonus gated
// on "previous cast shared an archetype" doesn't always fire, so it must cost
// less per point than guaranteed flat damage. See balance.ts for the derivation.
//
// 2026-07-25: disrupt re-priced from a flat per-point rate to an ESCALATING
// bracket schedule (PRICE.disruptBrackets, read by disruptCostDeci) —
// user-locked: draining banked readiness has no counterplay window, so large
// amounts must cost disproportionately more than small ones. See balance.ts
// for the full bracket table and rationale.
describe('PRICE structure lock', () => {
  it('every PRICE rate matches its locked value', () => {
    expect(PRICE).toEqual({
      flatPowerPerPoint: 5,
      flatTrueHealPerPoint: 2,
      flatTrueShieldPerPoint: 5,
      truePremiumPerPoint: 5,
      dotPerStack: 10,
      stunPerTurn: 100,
      statPctTurn: 1,
      cleansePerCharge: 25,
      weightPer: 5,
      sizeGrant2Bronze: 140,
      sizeGrant3Bronze: 380,
      cooldownPerTurn: 100,
      slowPerWeightNum: 5,
      slowPerWeightDen: 2,
      disruptBrackets: [
        { upTo: 5, rateDeci: 5 },
        { upTo: 10, rateDeci: 15 },
        { upTo: 15, rateDeci: 30 },
        { upTo: Infinity, rateDeci: 60 },
      ],
      lifestealPerPctNum: 2,
      lifestealPerPctDen: 3,
      shieldBreakPerPointNum: 5,
      shieldBreakPerPointDen: 4,
      comboPerPointNum: 5,
      comboPerPointDen: 2,
      guardPerPctTurnNum: 1,
      guardPerPctTurnDen: 1,
      exposePerPctTurnNum: 1,
      exposePerPctTurnDen: 1,
      negatePerCharge: 100,
      auraDamageFlat: 10,
      auraHealFlat: 10,
      auraWeightDelta: 20,
      extraHitPremium: 30,
      heroStatPerPoint: { attack: 10, magicPower: 10, armor: 10, magicResist: 10, speed: 5 },
    });
  });
});

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
      damage: { 1: 300, 2: 700, 3: 1250 },
      shield: { 1: 300, 2: 700, 3: 1250 },
      heal: { 1: 300, 2: 700, 3: 1250 },
    });
    expect(MAX_STUN_PER_CARD).toBe(1);
    // USER-LOCKED 2026-07-23: one flat Diamond-tier ceiling for every tier (no scaling).
    expect(effectCapDeci('damage', 1, 'diamond')).toBe(300);
    expect(effectCapDeci('damage', 1, 'bronze')).toBe(300);
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
      aura: { affects: 'adjacent', mods: { damageFlat: 20 } },
    };
    expect(powerLevelDeci(casting)).toBe(40 * PRICE.flatTrueHealPerPoint); // flat heal; the TRUE premium scales with damage only
    expect(powerLevelDeci(passive)).toBe(20 * PRICE.auraDamageFlat); // aura only, no premium
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

  it('poison/bleed/burn are priced LINEARLY per stack (10 deci/stack) — every stack count is a whole PL', () => {
    const mk = (kind: 'poison' | 'bleed' | 'burn', stacks: number): SkillDef => ({
      id: 'x',
      name: 'x',
      archetypes: ['debuff'],
      property: 'physical',
      size: 1,
      weapon: 'axe',
      rarity: 'common',
      tier: 'bronze',
      effects: [{ kind, stacks } as SkillDef['effects'][number]],
      text: '',
    });
    expect(PRICE.dotPerStack).toBe(10);
    // The tick model (decaying for poison/bleed, halving for burn) still
    // determines gameplay totals, but pricing reads only the stack count —
    // so 7 and 8 stacks (previously unreachable at a whole PL under the old
    // quadratic total-damage formula) now price cleanly, same as any N.
    expect(powerLevelDeci(mk('bleed', 9))).toBe(90);
    expect(powerLevelDeci(mk('poison', 7))).toBe(70);
    expect(powerLevelDeci(mk('poison', 8))).toBe(80);
    expect(powerLevelDeci(mk('burn', 7))).toBe(70);
    expect(powerLevelDeci(mk('burn', 8))).toBe(80);
    // All three DoT kinds share the one rate.
    expect(powerLevelDeci(mk('poison', 5))).toBe(powerLevelDeci(mk('bleed', 5)));
    expect(powerLevelDeci(mk('poison', 5))).toBe(powerLevelDeci(mk('burn', 5)));
  });

  it('disrupt is priced on an ESCALATING bracket schedule (marginal, not linear)', () => {
    const mk = (amount: number): SkillDef => ({
      id: 'x',
      name: 'x',
      archetypes: ['debuff'],
      property: 'physical',
      size: 1,
      weapon: 'bow',
      rarity: 'common',
      tier: 'bronze',
      effects: [{ kind: 'disrupt', amount }],
      text: '',
    });
    // Entry bracket (1-5 @ 5 deci/pt).
    expect(disruptCostDeci(5)).toBe(25);
    expect(powerLevelDeci(mk(5))).toBe(25);
    // 6-10 bracket (15 deci/pt) — only the points ABOVE 5 pay the higher rate.
    expect(disruptCostDeci(6)).toBe(40);
    expect(disruptCostDeci(10)).toBe(100); // all of Bronze, alone
    // 11-15 bracket (30 deci/pt).
    expect(disruptCostDeci(15)).toBe(250); // all of Diamond, alone
    // 16+ bracket (60 deci/pt) — unaffordable at any tier.
    expect(disruptCostDeci(16)).toBe(310);
    expect(disruptCostDeci(16)).toBeGreaterThan(TIER_BUDGET_DECI.diamond);
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
    // disrupt 4 -> all 4 points fall in the entry bracket (5 deci/pt) = 20
    // deci; lands on the Common band.
    const gem: Gem = { kind: 'effect', id: 'g1', rarity: 'common', actions: [{ kind: 'disrupt', amount: 4 }] };
    expect(gemPowerLevelDeci(gem)).toBe(disruptCostDeci(4));
    expect(gemPowerLevelDeci(gem)).toBe(20);
    expect(isGemOnBudget(gem)).toBe(true);
  });

  it('card-scope stat gem: reuses the aura per-point rates, no reach multiplier', () => {
    const gem: Gem = {
      kind: 'stat',
      id: 'g2',
      rarity: 'rare',
      scope: 'card',
      mods: { card: { damageFlat: 4 } }, // 4 * auraDamageFlat(10) = 40 deci
    };
    expect(gemPowerLevelDeci(gem)).toBe(4 * PRICE.auraDamageFlat);
    expect(gemPowerLevelDeci(gem)).toBe(40);
    expect(isGemOnBudget(gem)).toBe(true);
  });

  it('hero-scope stat gem: flat points priced via PRICE.heroStatPerPoint', () => {
    const gem: Gem = {
      kind: 'stat',
      id: 'g3',
      rarity: 'epic',
      scope: 'hero',
      mods: { hero: { attack: 4, speed: 4 } }, // 4*10 + 4*5 = 60 deci
    };
    expect(gemPowerLevelDeci(gem)).toBe(4 * PRICE.heroStatPerPoint.attack + 4 * PRICE.heroStatPerPoint.speed);
    expect(gemPowerLevelDeci(gem)).toBe(60);
    expect(isGemOnBudget(gem)).toBe(true);
  });

  it('isGemOnBudget flags a gem outside its rarity band', () => {
    const cheapCommon: Gem = { kind: 'effect', id: 'g4', rarity: 'common', actions: [{ kind: 'disrupt', amount: 2 }] };
    expect(isGemOnBudget(cheapCommon)).toBe(false);
  });
});
