// Power Level (PL) balance system.
//
// Every card belongs to a tier with a fixed PL budget, and every modifier on
// the card has a PL price; a card's whole kit must sum to its tier's budget.
// Prices are computed in deci-PL (PL × 10) so all math stays in integers.
//
//   Common 10 · Rare 15 · Epic 20 · Legendary 25
//
// Price list (deci-PL):
// - scaling magnitude (damage/heal/shield %): power / 2      (20% = 1 PL)
// - flat TRUE magnitude:                       amount * 2    (5 flat = 1 PL)
// - TRUE property premium (casting cards):     +20           (+2 PL)
// UTILITY PREMIUM: lingering effects price 25% above magnitude parity —
// sims showed effect kits outperform raw damage at equal PL:
// - poison/burn/regen:            (amount * turns) * 5/2     (4 total = 1 PL)
// - stun:                                      40 / turn     (4 PL)
// - buff/debuff:                  (pct * turns) * 5/4        (8%-turn = 1 PL)
// - cleanse:                                   80            (8 PL)
// - weight: (baseline − weight) * 5 — every 2 lighter costs 1 PL, every 2
//   heavier REFUNDS 1 PL (more weight = slower attacks), baseline = size × 10
// - size grant: size 2 → −50, size 3 → −100 (5 PL per extra slot: big cards
//   pay in board space and span turns, so they get a much bigger kit)
// - auras (per point): damage% ×4 · heal% ×4 · crit% ×5 · |weightDelta| ×20;
//   allBoard reach doubles the aura price
//
// Future enchantment/buff-effect layers must price their additions with this
// same table. Tier upgrades are predictable: an authored +5 PL path per card.

import { weightOf, type SkillDef, type SkillTier } from './types';

export const TIER_BUDGET_DECI: Record<SkillTier, number> = {
  common: 100,
  rare: 150,
  epic: 200,
  legendary: 250,
  // Fixed-rank one-of-a-kinds audit at the Common budget: their edge is the
  // effect design, never raw PL.
  unique: 100,
};

/** Audit tolerance: half a power level. */
export const BUDGET_TOLERANCE_DECI = 5;

const SIZE_GRANT_DECI = [0, 0, 50, 100] as const;

/** Total deci-PL of a card's kit. */
export function powerLevelDeci(skill: SkillDef): number {
  let deci = 0;
  let hasCast = false;

  for (const action of skill.effects) {
    hasCast = true;
    let add = 0;
    switch (action.kind) {
      case 'damage':
        // True damage still scales (off the higher stat); its edge is priced
        // by the TRUE premium below.
        add += Math.floor(action.power / 2);
        break;
      case 'heal':
      case 'shield':
        // True heals/shields are FLAT amounts.
        add += skill.property === 'true' ? action.power * 2 : Math.floor(action.power / 2);
        break;
      case 'poison':
      case 'burn':
        add += Math.floor((action.amount * action.turns * 5) / 2);
        break;
      case 'stun':
        add += action.turns * 40;
        break;
      case 'buffStat':
      case 'debuffStat':
        add += Math.floor((action.pct * action.turns * 5) / 4);
        break;
      case 'cleanse':
        add += 80;
        break;
      // Special ability riders — every magnitude properly weighted per unit.
      case 'slowNext':
        add += Math.floor((action.weight * 5) / 2); // 1 PL per +4 weight
        break;
      case 'weakenNext':
        add += action.pct; // 1 PL per 10% jammed off their next cast
        break;
      case 'curseCard':
        add += Math.floor((action.power * 2) / 5); // delayed damage: 1 PL per 25%
        break;
      case 'stagger':
        add += Math.floor((action.amount * 5) / 4); // 1 PL per 8 drained
        break;
      case 'lifesteal':
        add += Math.floor((action.pct * 2) / 3); // 1 PL per 15%
        break;
      case 'shieldBreak':
        add += Math.floor((action.amount * 5) / 4); // 1 PL per 8 shattered
        break;
      case 'comboBonus':
        add += Math.floor((action.pct * 2) / 3); // 1 PL per 15%
        break;
      case 'execute':
        // Conditional damage, scaled by how often the window is live.
        add += Math.floor((action.pct * action.belowPct) / 75); // 1 PL per 15% at the 50%-HP window
        break;
      case 'quicken':
        add += Math.floor((action.weight * 5) / 2); // mirror of slowNext: 1 PL per 4 weight
        break;
      case 'thorns':
        add += Math.floor((action.amount * action.turns * 5) / 2); // flat TRUE reflect per hit taken — DoT-rate pricing (mirror of poison/burn)
        break;
      case 'multiHit':
        // Total magnitude plus a per-hit premium (per-hit crits chew shields).
        add += Math.floor((action.power * action.hits) / 2) + action.hits * 5;
        break;
      case 'purge':
        add += 60; // narrower than cleanse's four status families
        break;
      case 'regen':
        add += Math.floor((action.amount * action.turns * 5) / 2); // HoT mirror of poison/burn
        break;
      case 'dodge':
        // Evades one whole single-target physical CARD per charge (damage,
        // multi-hits and riders alike) — stun-parity action denial (40),
        // narrowed by the physical/non-AoE condition but sharpened by
        // choosing WHAT it denies; unspent charges vanish when you act.
        add += action.hits * 40;
        break;
      case 'guard':
        // Physical strike damage taken −pct% while up: multiplicative
        // reduction beats flat armor vs big hits, so it prices above the
        // buff rate (2 deci per %-turn vs 5/4).
        add += action.pct * action.turns * 2;
        break;
      case 'empower':
        // Charges the NEXT cast +pct% damage: priced like weakenNext (its
        // self-side mirror) — the payoff needs a setup turn and telegraphs.
        add += action.pct;
        break;
      case 'bloodCost':
        // An HP price REFUNDS budget at the flat-true rate (5 HP = 1 PL).
        add -= action.amount * 2;
        break;
    }
    // Speed-conditional effects (onlyIf faster/slower) price at 4/5 — the
    // condition is build-selected, so the discount stays conservative.
    deci += action.onlyIf !== undefined ? Math.floor((add * 4) / 5) : add;
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

  // Exhaust grant: limited casts per battle refund budget (1 use -> +4 PL of
  // kit, 2 uses -> +2 PL).
  if (skill.uses === 1) deci -= 40;
  else if (skill.uses === 2) deci -= 20;

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
