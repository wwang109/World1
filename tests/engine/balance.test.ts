import { describe, expect, it } from 'vitest';
import {
  actionsPriceDeci,
  auraModsDeci,
  BUDGET_TOLERANCE_DECI,
  capViolations,
  cooldownDeviationDeci,
  disruptCostDeci,
  EFFECT_CAPS_DECI,
  effectCapDeci,
  gemPowerLevelDeci,
  isGemOnBudget,
  isOnBudget,
  MAX_COOLDOWN_TURNS,
  MAX_EXPOSE_PCT,
  MAX_GUARD_PCT,
  MAX_STUN_PER_CARD,
  OFFENSIVE_KINDS,
  PRICE,
  powerLevel,
  powerLevelBreakdown,
  powerLevelDeci,
  RARITY_PL_DECI,
  TIER_BUDGET_DECI,
} from '../../src/engine/balance';
import { skillBook } from '../../src/data/skills';
import { BASELINE_COOLDOWN, type Gem, type SkillDef } from '../../src/engine/types';
import { BOSS_EVERY } from '../../src/run/runMap';
import { PACK_VARIANT_WEIGHTS } from '../../src/run/encounter';

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
//
// 2026-08-01: flatTrueHealPerPoint raised 2 -> 4 — flat TRUE heals were
// empirically dominant over MATK-scaling heals far too early; doubling the
// rate pulls the heal-type crossover point down from ~MATK 30-40 to ~MATK
// 5-10. See balance.ts for the full rationale.
//
// 2026-08-17: wardPerCharge 50 ADDED — the affliction mirror of negate, at HALF
// its rate: a negate charge cancels a whole direct hit (a card's damage line),
// a ward charge cancels one whole affliction APPLICATION, and afflictions are
// authored as riders (~half a card). Lands strictly between the two existing
// removal keywords by construction: cleanse 25 < ward 50 < negate 100. NO
// existing rate moved.
//
// 2026-08-09: echoRepeatDeci 100 ADDED (gem ruleset v1 §6) — the host-blind
// rate for a FULL repeat of the host's attack, divided by `shareOf`. Not a new
// anchor: it is the same "one whole cast's worth of output" 100 that
// negatePerCharge and stunPerTurn already use. NO existing rate moved.
//
// 2026-08-17: aoeTargetsNum/Den (33/25 = 1.32x) ADDED — closes the verified
// silent zero where `scope: 'all'` priced identically to a single-target card
// despite hitting every living foe. Derived from the game's own pack-frequency
// constants (`BOSS_EVERY`, `PACK_VARIANT_WEIGHTS` — see balance.ts for the full
// arithmetic), not `MAX_FOES`. NO existing rate moved.
//
// 2026-08-21: conditionalBonusDen 2 ADDED — the CONDITIONAL-TRIGGER DISCOUNT of
// the two new bonus-damage riders (`exploit`, `stackBonus`), expressed as a
// denominator on the card's own flat-damage rate rather than a second copy of
// comboBonus's 2.5/pt. On a typed card `strikeRate/2` IS 2.5/pt (the locked
// comboBonus number); a TRUE card pays 5/pt, because a flat bonus bypasses
// defense on a TRUE card exactly as its flat base does. A rider whose own kit
// supplies the status it reads forfeits the discount and pays the full rate
// (`selfSynergyPremiumDeci`). NO existing rate moved.
//
// 2026-08-18: tauntPerPoint 10 ADDED — closes the last KNOWN SILENT ZERO
// (`taunt` had `price: []`, no rate at all). Priced at PARITY with
// `dotPerStack` — the nearest structural comparable (self-only, permanent,
// one-numeric-field, empower-family) — see balance.ts for the full
// "nearest priced comparable" derivation. NO existing rate moved.
//
// 2026-08-19: cooldownRefundStepDeci [50, 30, 20] ADDED — the LONG (refund)
// side of cooldown deviation moved off the flat `cooldownPerTurn` rate onto a
// diminishing per-extra-turn walk (issue #22: a flat rate let a Bronze card
// recoup up to 300 deci/30 PL by cooldownTurns 6, when the marginal turns are
// NOT equally weakening — see balance.ts for the fight-length-derived 5:3:2
// ratio and the 100-deci total-refund anchor). `cooldownPerTurn` itself is
// UNCHANGED and now prices the SHORT (cost) side only. NO shipped card moved
// (0/74 override `cooldownTurns`).
// 2026-08-21: THE SPLASH SPLIT. `splashPerWeightNum/Den` (5/1) REMOVED and
// replaced by two honest halves, with NO shipped price moving a deci:
// `burdenPerWeightNum/Den` (5/2 — slow's own per-point rate, for the weight tax
// on ONE card) and `splashBandFloorNum/Den` (x2 — the COVERAGE MULTIPLIER the
// payload-less spreader puts on its card-targeting siblings, the band's
// guaranteed 2-piece floor). The old rate WAS those two multiplied together, so
// `burden N + splash` prices exactly what `splash weight N` used to for every
// even N (the three shipped cards and both gems all re-derive to the deci — see
// their own notes). `cursePerAmountNum/Den` (5/2) and `cursePerAmountTurnNum/Den`
// (5/(BASELINE_COOLDOWN+1)) ADDED for the second card-targeting keyword: the
// flat-damage rate at the conditional-trigger discount for the near-certain
// first denial, plus one further firing per cooldown stride for the window.
describe('PRICE structure lock', () => {
  it('every PRICE rate matches its locked value', () => {
    expect(PRICE).toEqual({
      flatPowerPerPoint: 5,
      flatTrueHealPerPoint: 4,
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
      cooldownRefundStepDeci: [50, 30, 20],
      slowPerWeightNum: 5,
      slowPerWeightDen: 2,
      burdenPerWeightNum: 5,
      burdenPerWeightDen: 2,
      splashBandFloorNum: 2,
      splashBandFloorDen: 1,
      cursePerAmountNum: 5,
      cursePerAmountDen: 2,
      cursePerAmountTurnNum: 5,
      cursePerAmountTurnDen: 4,
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
      conditionalBonusDen: 2,
      guardPerPctTurnNum: 1,
      guardPerPctTurnDen: 1,
      exposePerPctTurnNum: 1,
      exposePerPctTurnDen: 1,
      tauntPerPoint: 10,
      negatePerCharge: 100,
      wardPerCharge: 50,
      auraDamageFlat: 10,
      auraHealFlat: 10,
      auraWeightDelta: 20,
      extraHitPremium: 30,
      aoeTargetsNum: 33,
      aoeTargetsDen: 25,
      echoRepeatDeci: 100,
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
      cleanse: { 1: 100, 2: 150, 3: 200 },
      damage: { 1: 300, 2: 700, 3: 1250 },
      shield: { 1: 300, 2: 700, 3: 1250 },
      heal: { 1: 300, 2: 700, 3: 1250 },
    });
    expect(MAX_STUN_PER_CARD).toBe(1);
    // USER-LOCKED 2026-07-23: one flat Diamond-tier ceiling for every tier (no scaling).
    expect(effectCapDeci('damage', 1, 'diamond')).toBe(300);
    expect(effectCapDeci('damage', 1, 'bronze')).toBe(300);
    expect(effectCapDeci('control', 1, 'diamond')).toBe(100);
    // USER-LOCKED 2026-08-17: `cleanse` is the one family that DOES tier-scale
    // (split out of `empower` so negate/ward/etc. stay frozen) — its cap
    // matches the tier budget ladder exactly: 100/150/200/250.
    expect(effectCapDeci('cleanse', 1, 'bronze')).toBe(100);
    expect(effectCapDeci('cleanse', 1, 'silver')).toBe(150);
    expect(effectCapDeci('cleanse', 1, 'gold')).toBe(200);
    expect(effectCapDeci('cleanse', 1, 'diamond')).toBe(250);
    expect(effectCapDeci('empower', 1, 'diamond')).toBe(100); // empower itself stays FROZEN
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

  it('ward is priced per charge (50 deci) and sits between cleanse and negate', () => {
    const mk = (charges: number): SkillDef => ({
      id: 'x',
      name: 'x',
      archetypes: ['defensive'],
      property: 'magical',
      size: 1,
      element: 'holy',
      rarity: 'common',
      tier: 'bronze',
      effects: [{ kind: 'ward', charges }],
      text: '',
    });
    expect(PRICE.wardPerCharge).toBe(50);
    // Whole-PL step of EXACTLY one charge — every charge count is authorable.
    expect(powerLevelDeci(mk(1))).toBe(50);
    expect(powerLevelDeci(mk(2))).toBe(TIER_BUDGET_DECI.bronze);
    expect(powerLevelDeci(mk(3))).toBe(150);
    // The ladder that justifies the number: a ward charge denies one EFFECT of a
    // card, a negate charge denies the whole hit, and cleanse only strips what an
    // affliction has left after it already ticked.
    expect(PRICE.cleansePerCharge).toBeLessThan(PRICE.wardPerCharge);
    expect(PRICE.wardPerCharge).toBeLessThan(PRICE.negatePerCharge);
  });
});

// FAIL-OPEN CLOSE (2026-08-17): `(BASELINE_COOLDOWN - cooldownTurns) *
// cooldownPerTurn` used to grow WITHOUT BOUND as cooldownTurns grew, so an
// absurd cooldown bought a refund with no honest ceiling — verified directly
// on sword_slash before this fix: cd 8 -> PL -400, cd 16 -> PL -1200, cd 99
// -> PL -9500, all with capViolations() === []. See MAX_COOLDOWN_TURNS's doc
// comment in balance.ts for the fight-length arithmetic the clamp is derived
// from.
//
// FOLLOW-UP (2026-08-19, issue #22): clamping the TOTAL wasn't enough — a flat
// per-turn rate WITHIN the clamped range still overpaid the far turns (5->6
// refunded the same as 3->4, when the marginal cast-count drop is much
// smaller by then). `cooldownDeviationDeci`'s long side now walks
// `PRICE.cooldownRefundStepDeci` (50/30/20, diminishing), replacing the flat
// `(BASELINE_COOLDOWN - cooldown) * cooldownPerTurn` on that side only — see
// balance.ts for the fight-length-derived ratio and the 100-deci anchor.
describe('cooldown deviation is CLAMPED (fail-open close)', () => {
  const mk = (cooldownTurns: number): SkillDef => ({
    id: 'x', name: 'x', archetypes: ['offense'], property: 'physical', weapon: 'sword',
    size: 1, rarity: 'common', tier: 'bronze', cooldownTurns,
    effects: [{ kind: 'damage', power: 20 }],
    text: '',
  });

  it('MAX_COOLDOWN_TURNS is 6 turns beyond baseline (BASELINE_COOLDOWN 3)', () => {
    expect(BASELINE_COOLDOWN).toBe(3);
    expect(MAX_COOLDOWN_TURNS).toBe(6);
  });

  it('cooldownDeviationDeci stops growing past MAX_COOLDOWN_TURNS — every value beyond it prices IDENTICALLY', () => {
    const atCap = cooldownDeviationDeci(MAX_COOLDOWN_TURNS);
    const totalStepRefund = PRICE.cooldownRefundStepDeci.reduce((a, b) => a + b, 0);
    expect(atCap).toBe(-totalStepRefund);
    expect(atCap).toBe(-100); // 50 + 30 + 20 — was the flat -300 ((3-6)*100)
    for (const cd of [7, 8, 16, 50, 99]) {
      expect(cooldownDeviationDeci(cd)).toBe(atCap);
    }
    // Below the cap, every turn still moves the price, and — the point of
    // issue #22's fix — each successive turn refunds STRICTLY LESS than the
    // one before it, not the same flat amount.
    expect(cooldownDeviationDeci(5)).toBeLessThan(cooldownDeviationDeci(4));
    expect(cooldownDeviationDeci(4)).toBeLessThan(cooldownDeviationDeci(3));
    const step1 = cooldownDeviationDeci(3) - cooldownDeviationDeci(4); // 50
    const step2 = cooldownDeviationDeci(4) - cooldownDeviationDeci(5); // 30
    const step3 = cooldownDeviationDeci(5) - cooldownDeviationDeci(6); // 20
    expect([step1, step2, step3]).toEqual([50, 30, 20]);
    expect(step1).toBeGreaterThan(step2);
    expect(step2).toBeGreaterThan(step3);
  });

  it('an omitted cooldownTurns prices at exactly +0 (baseline is free, unaffected by the clamp)', () => {
    expect(cooldownDeviationDeci(undefined)).toBe(0);
  });

  it('powerLevelDeci on sword_slash: the refund is bounded AND diminishing — cd 8/16/99 all price IDENTICALLY, not −400/−1200/−9500 (nor the old flat-rate −300 clamp)', () => {
    const sword = skillBook.sword_slash!;
    const at = (cd: number): number => powerLevelDeci({ ...sword, cooldownTurns: cd });
    const baseline = at(BASELINE_COOLDOWN);
    expect(at(0)).toBe(baseline + 300); // (3-0)*100, unaffected: short side is unclamped
    expect(at(4)).toBe(baseline - 50); // 1st extra turn: was the old flat −100
    expect(at(5)).toBe(baseline - 80); // +30 more (cumulative 80): was the old flat −200
    const clamped = at(MAX_COOLDOWN_TURNS);
    expect(clamped).toBe(baseline - 100); // +20 more (cumulative 100): was the old flat −300
    expect(at(8)).toBe(clamped);
    expect(at(16)).toBe(clamped);
    expect(at(99)).toBe(clamped);
    expect(at(8)).not.toBe(baseline - 300); // the OLD (flat-rate) clamped figure
    expect(at(8)).not.toBe(baseline - 500); // the pre-clamp unclamped figure
    expect(at(16)).not.toBe(baseline - 1300);
    expect(at(99)).not.toBe(baseline - 9600);
  });

  it('capViolations NAMES a cooldownTurns past the max, at authoring time (mirrors WEIGHT_MAX_BY_SIZE)', () => {
    expect(capViolations(mk(6))).toEqual([]);
    expect(capViolations(mk(7))).toEqual([`cooldownTurns 7 exceeds the max of ${MAX_COOLDOWN_TURNS}`]);
    expect(capViolations(mk(99))).toEqual([`cooldownTurns 99 exceeds the max of ${MAX_COOLDOWN_TURNS}`]);
  });
});

// FAIL-OPEN CLOSE (2026-08-17): the aura/card-scope-gem stat-mod expression
// used to price `damageFlat`/`healFlat` SIGNED while wrapping only
// `weightDelta` in `Math.abs`, in the same expression. An aura never affects
// its own host (`resolveAuras`'s `if (source === piece) continue`), so a
// negative mod on a card's OWN aura is never a cost that card's own kit pays
// — pricing it signed let a card buy down its own budget with a "downside"
// its own numbers never realize.
describe('aura mods are priced by MAGNITUDE, not sign (fail-open close)', () => {
  it('auraModsDeci prices a negative mod IDENTICALLY to its positive magnitude, for all three mods', () => {
    expect(auraModsDeci({ damageFlat: -20 })).toBe(auraModsDeci({ damageFlat: 20 }));
    expect(auraModsDeci({ healFlat: -15 })).toBe(auraModsDeci({ healFlat: 15 }));
    expect(auraModsDeci({ weightDelta: -6 })).toBe(auraModsDeci({ weightDelta: 6 }));
    expect(auraModsDeci({ damageFlat: -20 })).toBe(20 * PRICE.auraDamageFlat);
  });

  it('a card can no longer buy down its own budget with a self-hosted negative aura (verified exploit, now closed)', () => {
    const withNegativeAura: SkillDef = {
      id: 'x', name: 'x', archetypes: ['offense'], property: 'physical', weapon: 'sword',
      size: 1, rarity: 'common', tier: 'bronze',
      effects: [{ kind: 'damage', power: 60 }],
      aura: { affects: 'adjacent', reach: 0, mods: { damageFlat: -20 } },
      text: '',
    };
    const noAura: SkillDef = { ...withNegativeAura, aura: undefined };
    // Before this fix: powerLevelDeci(withNegativeAura) was 100 (onBudget at
    // Bronze) — a 300-deci hit "discounted" by an aura that can never touch
    // its own host. Now the aura only ever ADDS cost, never subtracts it.
    expect(powerLevelDeci(noAura)).toBe(300);
    expect(powerLevelDeci(withNegativeAura)).toBe(500); // 300 + abs(-20)*10
    expect(powerLevelDeci(withNegativeAura)).toBeGreaterThan(powerLevelDeci(noAura));
    expect(isOnBudget(withNegativeAura)).toBe(false);
  });

  it('card-scope stat gem: a negative mod prices the same as its positive magnitude', () => {
    const negative: Gem = { kind: 'stat', id: 'g', rarity: 'rare', scope: 'card', mods: { card: { damageFlat: -4 } } };
    const positive: Gem = { kind: 'stat', id: 'g', rarity: 'rare', scope: 'card', mods: { card: { damageFlat: 4 } } };
    expect(gemPowerLevelDeci(negative)).toBe(gemPowerLevelDeci(positive));
    expect(gemPowerLevelDeci(negative)).toBe(4 * PRICE.auraDamageFlat);
  });
});

// Ceilings the CONTENT SCHEMA (`validateSkillContent.ts`) imports rather than
// hardcoding — see that file's `clampedPct` for the exploit this closes
// (expose/guard pricing past what the engine's own apply-time clamp ever
// delivers). Pinned here so a drift between the two clamps and these
// constants is a red test, not a silent mismatch.
describe('MAX_EXPOSE_PCT / MAX_GUARD_PCT mirror interpreter.ts\'s apply-time clamps', () => {
  it('50 / 60 — matches Math.min(50, ...) / Math.min(60, ...) in combat/interpreter.ts', () => {
    expect(MAX_EXPOSE_PCT).toBe(50);
    expect(MAX_GUARD_PCT).toBe(60);
  });
});

// `scope: 'all'` (AoE reach) — CLOSES A VERIFIED SILENT ZERO (2026-08-17):
// `powerLevelDeci` never read `skill.scope` before this pass, so an AoE card
// priced identically to a single-target one despite hitting every living foe
// (`combat/interpreter.ts`'s `resolveTargets`). See `PRICE.aoeTargetsNum/Den`
// in balance.ts for the full derivation.
describe('AoE reach pricing (scope: all)', () => {
  const mkDamage = (power: number, scope?: 'one' | 'all'): SkillDef => ({
    id: 'x',
    name: 'x',
    archetypes: ['offense'],
    property: 'physical',
    weapon: 'sword',
    size: 1,
    rarity: 'common',
    tier: 'bronze',
    ...(scope === undefined ? {} : { scope }),
    effects: [{ kind: 'damage', power }],
    text: '',
  });

  it('aoeTargetsNum/Den (1.32x) is EXACTLY the steady-state expected-foe-count derived from the game\'s own pack constants, not MAX_FOES', () => {
    // Every BOSS_EVERY-fight cadence block is 1 boss (always solo) + the rest
    // non-boss, and PACK_VARIANT_WEIGHTS rolls solo/pair/trio on those — see
    // `src/run/runMap.ts#BOSS_EVERY` and `src/run/encounter.ts#PACK_VARIANT_WEIGHTS`.
    // This re-derives PRICE.aoeTargetsNum/Den from THOSE constants directly, so
    // it fails loudly if the pack-frequency dials move without a matching
    // pricing pass, instead of silently going stale.
    const weightTotal = PACK_VARIANT_WEIGHTS.solo + PACK_VARIANT_WEIGHTS.pair + PACK_VARIANT_WEIGHTS.trio;
    expect(weightTotal).toBe(100);
    const nonBossFights = BOSS_EVERY - 1;
    const mixNumerator = PACK_VARIANT_WEIGHTS.solo * 1 + PACK_VARIANT_WEIGHTS.pair * 2 + PACK_VARIANT_WEIGHTS.trio * 3;
    // E = [1 boss * 1 foe * weightTotal + nonBossFights * mixNumerator] / (BOSS_EVERY * weightTotal)
    const num = weightTotal + nonBossFights * mixNumerator;
    const den = BOSS_EVERY * weightTotal;
    const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
    const g = gcd(num, den);
    expect(num / g).toBe(PRICE.aoeTargetsNum);
    expect(den / g).toBe(PRICE.aoeTargetsDen);
    expect(PRICE.aoeTargetsNum / PRICE.aoeTargetsDen).toBeCloseTo(1.32, 10);
    // Sanity: MAX_FOES (5) is a sandbox ceiling, not the derived rate.
    expect(PRICE.aoeTargetsNum / PRICE.aoeTargetsDen).toBeLessThan(5);
  });

  it('an AoE card prices ABOVE the identical single-target kit — the silent zero is closed', () => {
    const single = mkDamage(40, 'one');
    const aoe = mkDamage(40, 'all');
    expect(powerLevelDeci(aoe)).toBeGreaterThan(powerLevelDeci(single));
    // 40 power * flatPowerPerPoint(5) = 200 deci offensive share; scoped:
    // floor(200 * 33/25) = 264 deci. Then − size1 grant (0) and weight (0
    // deviation from baseline) leave both terms unchanged relative to a
    // no-scope card of the same kit.
    expect(powerLevelDeci(single)).toBe(200);
    expect(powerLevelDeci(aoe)).toBe(264);
  });

  it('omitted scope (undefined) is byte-identical to explicit scope: "one" — un-flagged cards stay unaffected', () => {
    const omitted = mkDamage(40);
    const explicit = mkDamage(40, 'one');
    expect(powerLevelDeci(omitted)).toBe(powerLevelDeci(explicit));
    expect(actionsPriceDeci([{ kind: 'damage', power: 40 }], 'physical')).toBe(powerLevelDeci(omitted));
  });

  it('AoE reach applies ONLY to the OFFENSIVE share of a kit — a self-targeted rider on the same card is untouched', () => {
    const mixed: SkillDef = {
      id: 'x', name: 'x', archetypes: ['offense'], property: 'physical', weapon: 'sword',
      size: 1, rarity: 'common', tier: 'bronze', scope: 'all',
      effects: [
        { kind: 'damage', power: 40 }, // offensive: pays the multiplier
        { kind: 'buffStat', stat: 'attack', pct: 10, turns: 2 }, // self: does not
      ],
      text: '',
    };
    const offensiveShare = 40 * PRICE.flatPowerPerPoint; // 200
    const selfShare = 10 * 2 * PRICE.statPctTurn; // 20
    expect(powerLevelDeci(mixed)).toBe(Math.floor((offensiveShare * PRICE.aoeTargetsNum) / PRICE.aoeTargetsDen) + selfShare);
    expect(powerLevelDeci(mixed)).toBe(264 + 20);
  });

  it('AoE reach also grows the multi-hit premium (an offensive cost), and floors ONCE over the whole offensive share — NOT once per action', () => {
    // Deliberately small per-action values (power 1 -> 5 deci each) so a
    // per-action floor would round away MORE than a single floor over the
    // combined total does, making this test actually discriminate the two
    // (at power 10 both approaches coincidentally agree — see history).
    const effects: SkillDef['effects'] = [
      { kind: 'damage', power: 1 },
      { kind: 'damage', power: 1 },
    ];
    // Raw offensive share (scope 'one'): 2*(1*5) + 1*extraHitPremium(30) = 40.
    const raw = actionsPriceDeci(effects, 'physical', 'one');
    expect(raw).toBe(40);
    const scoped = actionsPriceDeci(effects, 'physical', 'all');
    // ONE floor over the combined 40: floor(40*33/25) = floor(52.8) = 52.
    expect(scoped).toBe(Math.floor((raw * PRICE.aoeTargetsNum) / PRICE.aoeTargetsDen));
    expect(scoped).toBe(52);
    // A per-action floor (5+5+30 flooring each SEPARATELY: 6+6+39=51) would be
    // a DIFFERENT, lower number — proving the implementation floors once, not
    // per line item.
    const perActionFloored =
      Math.floor((5 * PRICE.aoeTargetsNum) / PRICE.aoeTargetsDen) * 2 +
      Math.floor((30 * PRICE.aoeTargetsNum) / PRICE.aoeTargetsDen);
    expect(scoped).not.toBe(perActionFloored);
  });

  it('the cap-family audit (capViolations) grows in lockstep — an AoE cannot use scope to sneak effective PL past its family cap', () => {
    // A size-1 bronze `control` cap is 100 deci (EFFECT_CAPS_DECI.control[1]).
    // debuffStat 50% for 2 turns = 50*2*statPctTurn(1) = 100 deci at scope 'one'
    // — sits EXACTLY on the cap, no violation.
    const mk = (scope: 'one' | 'all'): SkillDef => ({
      id: 'x', name: 'x', archetypes: ['debuff'], property: 'physical', weapon: 'axe',
      size: 1, rarity: 'common', tier: 'bronze', scope,
      effects: [{ kind: 'debuffStat', stat: 'attack', pct: 50, turns: 2 }],
      text: '',
    });
    expect(capViolations(mk('one'))).toEqual([]);
    // At scope 'all' the SAME authored magnitude now spends floor(100*33/25) =
    // 132 deci against the identical 100-deci cap — a real violation, so an
    // AoE debuff can no longer buy more effective control than a single-target
    // one of the same authored numbers.
    expect(capViolations(mk('all'))).toEqual(['control 13.2 PL exceeds the size-1 bronze cap (10 PL)']);
  });

  it('powerLevelBreakdown reports the AoE delta as its own exact part, and parts still sum exactly', () => {
    const aoe = mkDamage(40, 'all');
    const parts = powerLevelBreakdown(aoe);
    const aoePart = parts.find((p) => p.label === 'aoe reach');
    expect(aoePart).toBeDefined();
    // raw damage part (200) + aoe-reach delta (264-200=64) + weight(0) + size(0) = 264.
    expect(aoePart!.deci).toBe(64);
    expect(parts.reduce((sum, p) => sum + p.deci, 0)).toBe(powerLevelDeci(aoe));
  });

  it('OFFENSIVE_KINDS is pinned exactly — mirrors isOffensiveAction in combat/interpreter.ts', () => {
    // If `combat/interpreter.ts`'s `isOffensiveAction` switch ever changes,
    // this must be updated in lockstep (see the `offensive` field's doc
    // comment in `src/engine/keywords/pricing.ts`) — this test is the
    // regression guard for that drift, since balance.ts cannot import the
    // interpreter's private classification directly (layering cycle).
    expect(OFFENSIVE_KINDS).toEqual(new Set([
      'damage', 'statStrike', 'poison', 'burn', 'bleed', 'stun',
      'debuffStat', 'expose', 'slow', 'disrupt', 'shieldBreak',
      // 2026-08-21 (the splash split): the two CARD-TARGETING keywords and their
      // SPREADER. `burden`/`curse` land on one of the victim's board cards, so
      // they plainly resolve against a foe. `splash` applies nothing itself, but
      // it is classified with them anyway — `isOffensiveAction` answers by KIND
      // and this pin is kind-for-kind, so the spreader must appear here or the
      // mirror is broken. Its own price is 0 (it is a multiplier, see
      // `PRICE.splashBandFloorNum`), so membership costs nothing at any scope —
      // and an AoE spreader is refused by `validateSkillContent` regardless.
      'burden', 'curse', 'splash',
      // 2026-08-21: the two conditional bonus-damage riders. They only ARM a
      // bonus, but they resolve against the VICTIM (exploit reads its
      // afflictions; stackBonus reads a pile) and the bonus they arm is
      // delivered once per foe under `scope: 'all'`, so both fan out and both
      // pay the AoE reach multiplier. `isOffensiveAction` classifies them by
      // KIND — including `stackBonus` with `of: 'caster'` — for exactly that
      // reason, so this pin stays kind-for-kind.
      'exploit', 'stackBonus',
      // 2026-08-21 (second rider pass): `taxBonus` reads the VICTIM's board (how
      // many of its cards carry a weight tax) and arms per victim, so it joins
      // them. `shieldBurst` deliberately does NOT: the resource it reads and
      // SPENDS is the caster's own plating, so it resolves on the caster and runs
      // once — `isOffensiveAction` returns false for it, and an authored AoE +
      // shieldBurst card is refused by `validateSkillContent` rather than priced
      // at a reach multiplier it would not pay.
      'taxBonus',
      // 2026-08-21 (THIRD rider pass): `desperation` is the only one of the four
      // new riders that joins. Its GATE is caster-side (own HP at or below half),
      // but the bonus it arms is per victim, so under `scope: 'all'` it is
      // delivered once per foe and must pay reach — the same call `stackBonus`
      // with `of: 'caster'` already gets. The other three stay OUT, each for its
      // own stated reason: `wardRelease` reads and SPENDS the caster's own charges
      // (the `shieldBurst` case verbatim, AoE refused rather than priced), while
      // `overhealShield`/`cleanseConvert` feed a `heal`, which is a support action
      // that resolves once whatever the scope — there is no fan-out to price.
      'desperation',
    ]));
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
