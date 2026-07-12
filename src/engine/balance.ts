// Power Level (PL) balance system.
//
// Every card belongs to a tier with a fixed PL budget, and every modifier on
// the card has a PL price; a card's whole kit must sum to its tier's budget.
// Prices are computed in deci-PL (PL × 10) so all math stays in integers.
//
//   Bronze 10 · Silver 15 · Gold 20 · Diamond 25
//
// PRICE below is the single source of truth for every per-unit rate; the
// full documented table (with worked examples) lives in
// docs/power-level-reference.md, sourced from these exact constants. Do not
// hand-copy numbers elsewhere — read PRICE.

import { weightOf, type SkillDef, type SkillTier } from './types';

export const TIER_BUDGET_DECI: Record<SkillTier, number> = {
  bronze: 100,
  silver: 150,
  gold: 200,
  diamond: 250,
};

/** Audit tolerance: half a power level. */
export const BUDGET_TOLERANCE_DECI = 5;

/**
 * Named, documented price table (deci-PL per unit). Every case in
 * `powerLevelDeci` below reads from here — this is the single source of
 * truth for pricing; `docs/power-level-reference.md` cites these constants
 * by name.
 */
export const PRICE = {
  /** damage %: power * (damagePerPctNum/damagePerPctDen) — 20% = 1 PL. */
  damagePerPctNum: 1,
  damagePerPctDen: 2,

  /** flat TRUE heal/shield/damage amount: deci per point — 5 flat = 1 PL. */
  flatTruePerPoint: 2,

  /**
   * TRUE property premium on casting cards (property === 'true' AND the card
   * actually casts). Cut from 20 -> 10 deci (+1 PL, was +2 PL): TRUE's edge
   * (bypasses all defenses) is real but was overpriced relative to its
   * in-practice swing; approved reduction.
   */
  truePremium: 10,

  /** poison/burn: (amount * turns) * dotPerPoint — 5 total = 1 PL. */
  dotPerPoint: 2,

  /** stun: turns * stunPerTurn — 4 PL/turn. Re-tune deferred (no sim data). */
  stunPerTurn: 40,

  /** buff/debuff stat: pct * turns * statPctTurn — 10%-turn = 1 PL. */
  statPctTurn: 1,

  /**
   * cleanse (remove poisons/burns/stuns/debuffs): flat deci. Bumped 80 -> 90
   * to keep `purify` (the only cleanse-using card) on budget under the new
   * (lower) TRUE premium: 90 + truePremium(10) = 100 = Bronze exactly.
   */
  cleanse: 90,

  /** weight: (baseline − weight) * weightPer — every 2 lighter costs 1 PL,
   * every 2 heavier REFUNDS 1 PL (more weight = slower attacks). Baseline =
   * size * 10. */
  weightPer: 5,

  /** size grant: size 2 -> +sizeGrant2, size 3 -> +sizeGrant3 deci of extra
   * budget (big cards pay in board space and span turns). */
  sizeGrant2: 30,
  sizeGrant3: 60,

  /** slowNext: weight * (slowNextPerWeightNum/Den) — 1 PL per +4 weight. */
  slowNextPerWeightNum: 5,
  slowNextPerWeightDen: 2,

  /** stagger: amount * (staggerPerPointNum/Den) — 1 PL per 8 drained. */
  staggerPerPointNum: 5,
  staggerPerPointDen: 4,

  /** lifesteal: pct * (lifestealPerPctNum/Den) — 1 PL per 15%. */
  lifestealPerPctNum: 2,
  lifestealPerPctDen: 3,

  /** shieldBreak: amount * (shieldBreakPerPointNum/Den) — 1 PL per 8 shattered. */
  shieldBreakPerPointNum: 5,
  shieldBreakPerPointDen: 4,

  /**
   * comboBonus: pct * (comboPerPctNum/Den). Cut from 1 PL/15% to 1 PL/30%
   * (approved): conditional (previous-cast-archetype-gated) bonus damage was
   * overpriced relative to its unreliable uptime.
   */
  comboPerPctNum: 1,
  comboPerPctDen: 3,

  /**
   * guard: pct * turns * (guardPerPctTurnNum/Den) deci. Priced at a 1.25x
   * PREMIUM over the plain stat-buff rate (statPctTurn = 1x): unconditional
   * %-damage-reduction is stronger than a stat nudge of the same nominal
   * pct*turns, because it applies straight to the final hit with no
   * diminishing-returns math in between.
   *   Showcase: Guard 40% for 2 turns, magical, size 1, no weight override ->
   *   40*2*5/4 = 100 deci = Bronze exactly.
   */
  guardPerPctTurnNum: 5,
  guardPerPctTurnDen: 4,

  /**
   * negate: charges * negatePerCharge deci. A charge cancels a FULL direct
   * hit of the matching property (high expected value vs. a partial
   * mitigation), so it's priced as a flat per-charge chunk rather than a
   * scaling rate.
   *   1 charge = 50 deci (half of Bronze — a reasonable chunk paired with
   *     another small effect).
   *   2 charges = 100 deci (= Bronze exactly).
   *   3 charges (the apply-time clamp max) = 150 deci (= Silver exactly).
   */
  negatePerCharge: 50,

  /** aura (per point, on the projecting card): damagePct * auraDamagePct,
   * healPct * auraHealPct, critPctDelta * auraCritPct,
   * |weightDelta| * auraWeightDelta. allBoard reach doubles the total. */
  auraDamagePct: 4,
  auraHealPct: 4,
  auraCritPct: 5,
  auraWeightDelta: 20,
} as const;

/** Total deci-PL of a card's kit. */
export function powerLevelDeci(skill: SkillDef): number {
  let deci = 0;
  let hasCast = false;

  for (const action of skill.effects) {
    hasCast = true;
    switch (action.kind) {
      case 'damage':
        // True damage still scales (off the higher stat); its edge is priced
        // by the TRUE premium below.
        deci += Math.floor((action.power * PRICE.damagePerPctNum) / PRICE.damagePerPctDen);
        break;
      case 'heal':
      case 'shield':
        // True heals/shields are FLAT amounts.
        deci +=
          skill.property === 'true'
            ? action.power * PRICE.flatTruePerPoint
            : Math.floor((action.power * PRICE.damagePerPctNum) / PRICE.damagePerPctDen);
        break;
      case 'poison':
      case 'burn':
        deci += action.amount * action.turns * PRICE.dotPerPoint;
        break;
      case 'stun':
        deci += action.turns * PRICE.stunPerTurn;
        break;
      case 'buffStat':
      case 'debuffStat':
        deci += action.pct * action.turns * PRICE.statPctTurn;
        break;
      case 'cleanse':
        deci += PRICE.cleanse;
        break;
      // Special ability riders — every magnitude properly weighted per unit.
      case 'slowNext':
        deci += Math.floor((action.weight * PRICE.slowNextPerWeightNum) / PRICE.slowNextPerWeightDen);
        break;
      case 'stagger':
        deci += Math.floor((action.amount * PRICE.staggerPerPointNum) / PRICE.staggerPerPointDen);
        break;
      case 'lifesteal':
        deci += Math.floor((action.pct * PRICE.lifestealPerPctNum) / PRICE.lifestealPerPctDen);
        break;
      case 'shieldBreak':
        deci += Math.floor((action.amount * PRICE.shieldBreakPerPointNum) / PRICE.shieldBreakPerPointDen);
        break;
      case 'comboBonus':
        deci += Math.floor((action.pct * PRICE.comboPerPctNum) / PRICE.comboPerPctDen);
        break;
      // ---- Property-generic defensive keywords ----
      case 'guard':
        deci += Math.floor((action.pct * action.turns * PRICE.guardPerPctTurnNum) / PRICE.guardPerPctTurnDen);
        break;
      case 'negate':
        deci += action.charges * PRICE.negatePerCharge;
        break;
    }
  }

  if (skill.aura) {
    const reach = skill.aura.affects === 'allBoard' ? 2 : 1;
    const mods = skill.aura.mods;
    deci +=
      ((mods.damagePct ?? 0) * PRICE.auraDamagePct +
        (mods.healPct ?? 0) * PRICE.auraHealPct +
        (mods.critPctDelta ?? 0) * PRICE.auraCritPct +
        Math.abs(mods.weightDelta ?? 0) * PRICE.auraWeightDelta) *
      reach;
  }

  // TRUE premium only for cards that actually cast (passives use property
  // purely as a synergy hook).
  if (hasCast && skill.property === 'true') deci += PRICE.truePremium;

  // Weight: lighter than baseline costs, heavier refunds (slower attacks).
  const baseline = skill.size * 10;
  deci += (baseline - weightOf(skill)) * PRICE.weightPer;

  // Size grant.
  deci -= skill.size === 2 ? PRICE.sizeGrant2 : skill.size === 3 ? PRICE.sizeGrant3 : 0;

  return deci;
}

/** Display power level with one-decimal precision (e.g. 10 or 9.5). */
export function powerLevel(skill: SkillDef): number {
  return powerLevelDeci(skill) / 10;
}

/** Whether the card's kit matches its tier budget within tolerance. */
export function isOnBudget(skill: SkillDef): boolean {
  return Math.abs(powerLevelDeci(skill) - TIER_BUDGET_DECI[skill.tier]) <= BUDGET_TOLERANCE_DECI;
}
