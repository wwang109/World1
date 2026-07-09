// Power Level (PL) balance system.
//
// Every card belongs to a tier with a fixed PL budget, and every modifier on
// the card has a PL price; a card's whole kit must sum to its tier's budget.
// Prices are computed in deci-PL (PL × 10) so all math stays in integers.
//
//   Bronze 10 · Silver 15 · Gold 20 · Diamond 25
//
// Price list (deci-PL):
// - scaling magnitude (damage/heal/shield %): power / 2      (20% = 1 PL)
// - flat TRUE magnitude:                       amount * 2    (5 flat = 1 PL)
// - TRUE property premium (casting cards):     +20           (+2 PL)
// - poison/burn:                    (amount * turns) * 2     (5 total = 1 PL)
// - stun:                                      40 / turn     (4 PL)
// - buff/debuff:                    pct * turns               (10%-turn = 1 PL)
// - cleanse:                                   80            (8 PL)
// - weight: (baseline − weight) * 5 — every 2 lighter costs 1 PL, every 2
//   heavier REFUNDS 1 PL (more weight = slower attacks), baseline = size × 10
// - size grant: size 2 → −30, size 3 → −60 (big cards pay in board space and
//   span turns, so they get a bigger kit)
// - auras (per point): damage% ×4 · heal% ×4 · crit% ×5 · |weightDelta| ×20;
//   allBoard reach doubles the aura price
//
// Future enchantment/buff-effect layers must price their additions with this
// same table. Tier upgrades are predictable: an authored +5 PL path per card.

import { weightOf, type SkillDef, type SkillTier } from './types';

export const TIER_BUDGET_DECI: Record<SkillTier, number> = {
  bronze: 100,
  silver: 150,
  gold: 200,
  diamond: 250,
};

/** Audit tolerance: half a power level. */
export const BUDGET_TOLERANCE_DECI = 5;

const SIZE_GRANT_DECI = [0, 0, 30, 60] as const;

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
        deci += Math.floor(action.power / 2);
        break;
      case 'heal':
      case 'shield':
        // True heals/shields are FLAT amounts.
        deci += skill.property === 'true' ? action.power * 2 : Math.floor(action.power / 2);
        break;
      case 'poison':
      case 'burn':
        deci += action.amount * action.turns * 2;
        break;
      case 'stun':
        deci += action.turns * 40;
        break;
      case 'buffStat':
      case 'debuffStat':
        deci += action.pct * action.turns;
        break;
      case 'cleanse':
        deci += 80;
        break;
      // Special ability riders — every magnitude properly weighted per unit.
      case 'slowNext':
        deci += Math.floor((action.weight * 5) / 2); // 1 PL per +4 weight
        break;
      case 'stagger':
        deci += Math.floor((action.amount * 5) / 4); // 1 PL per 8 drained
        break;
      case 'lifesteal':
        deci += Math.floor((action.pct * 2) / 3); // 1 PL per 15%
        break;
      case 'shieldBreak':
        deci += Math.floor((action.amount * 5) / 4); // 1 PL per 8 shattered
        break;
      case 'comboBonus':
        deci += Math.floor((action.pct * 2) / 3); // 1 PL per 15%
        break;
      case 'execute':
        // Conditional damage, scaled by how often the window is live.
        deci += Math.floor((action.pct * action.belowPct) / 75); // 1 PL per 15% at the 50%-HP window
        break;
      case 'quicken':
        deci += Math.floor((action.weight * 5) / 2); // mirror of slowNext: 1 PL per 4 weight
        break;
      case 'thorns':
        deci += action.pct * action.turns; // 10%-turn = 1 PL, like buffs
        break;
      case 'multiHit':
        // Total magnitude plus a per-hit premium (per-hit crits chew shields).
        deci += Math.floor((action.power * action.hits) / 2) + action.hits * 5;
        break;
      case 'purge':
        deci += 60; // narrower than cleanse's four status families
        break;
      case 'regen':
        deci += action.amount * action.turns * 2; // HoT mirror of poison/burn
        break;
    }
  }

  if (skill.aura) {
    const reach = skill.aura.affects === 'allBoard' ? 2 : 1;
    const mods = skill.aura.mods;
    deci += ((mods.damagePct ?? 0) * 4 + (mods.healPct ?? 0) * 4 + (mods.critPctDelta ?? 0) * 5 + Math.abs(mods.weightDelta ?? 0) * 20) * reach;
  }

  // TRUE premium only for cards that actually cast (passives use property
  // purely as a synergy hook).
  if (hasCast && skill.property === 'true') deci += 20;

  // Weight: lighter than baseline costs, heavier refunds (slower attacks).
  const baseline = skill.size * 10;
  deci += (baseline - weightOf(skill)) * 5;

  // Size grant.
  deci -= SIZE_GRANT_DECI[skill.size];

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
