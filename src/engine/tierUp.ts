// Generated tier variants: the same card at Rare/Epic/Legendary.
//
// A variant is ordinary data — the combat interpreter never knows about
// tiers. We take the card's PRIMARY magnitude knob (its first scalable
// effect, or an aura mod for pure passives) and raise it in its smallest
// pricing step until the kit sums to the higher tier's PL budget, so every
// variant passes the same balance audit as authored cards. Cards with no
// finely-priced knob (e.g. cleanse-only Purify, weight-aura Time Crystal)
// simply have no higher-tier variant.
//
// Hand-authored upgrade paths (branching identities per the card-tier plan)
// can later replace any generated variant by shipping a def under the same
// id — this generator is the demo-content baseline, not the final word.

import { BUDGET_TOLERANCE_DECI, powerLevelDeci, TIER_BUDGET_DECI } from './balance';
import type { SkillDef, SkillTier } from './types';

export const TIER_ORDER: SkillTier[] = ['common', 'rare', 'epic', 'legendary'];

/** Rank numeral suffixed to a variant's name (base tier shows none). */
export const TIER_NUMERAL: Record<SkillTier, string> = {
  common: '',
  rare: 'II',
  epic: 'III',
  legendary: 'IV',
  unique: '★',
};

/** Id of `baseId` at `tier` — the base id itself for the card's own tier. */
export function variantId(baseId: string, tier: SkillTier, baseTier: SkillTier = 'common'): string {
  return tier === baseTier ? baseId : `${baseId}__${tier}`;
}

/** Base id of any card id, variant or not. */
export function baseIdOf(id: string): string {
  return id.split('__')[0]!;
}

function cloneDef(s: SkillDef): SkillDef {
  return {
    ...s,
    effects: s.effects.map((e) => ({ ...e })),
    aura: s.aura ? { ...s.aura, mods: { ...s.aura.mods } } : undefined,
  };
}

/** A magnitude the generator may raise, with its smallest pricing step. */
interface Knob {
  label: string;
  unit: string;
  step: number;
  get(): number;
  bump(): void;
}

/** First scalable magnitude on the card, in effect order; aura as fallback. */
function findKnob(def: SkillDef): Knob | null {
  for (const e of def.effects) {
    switch (e.kind) {
      case 'damage':
        return { label: 'damage', unit: '%', step: 2, get: () => e.power, bump: () => (e.power += 2) };
      case 'multiHit':
        return { label: 'per-hit damage', unit: '%', step: 2, get: () => e.power, bump: () => (e.power += 2) };
      case 'heal':
      case 'shield': {
        const flat = def.property === 'true';
        const label = e.kind;
        return flat
          ? { label, unit: ' flat', step: 1, get: () => e.power, bump: () => (e.power += 1) }
          : { label, unit: '%', step: 2, get: () => e.power, bump: () => (e.power += 2) };
      }
      case 'poison':
      case 'burn':
      case 'regen':
        return { label: `${e.kind}/turn`, unit: '', step: 1, get: () => e.amount, bump: () => (e.amount += 1) };
      case 'thorns':
        return { label: 'thorns', unit: '%', step: 1, get: () => e.pct, bump: () => (e.pct += 1) };
      case 'buffStat':
        return { label: `${e.stat} buff`, unit: '%', step: 1, get: () => e.pct, bump: () => (e.pct += 1) };
      case 'debuffStat':
        return { label: `${e.stat} debuff`, unit: '%', step: 1, get: () => e.pct, bump: () => (e.pct += 1) };
      default:
        continue;
    }
  }
  const mods = def.aura?.mods;
  if (mods?.damagePct !== undefined) {
    return { label: 'aura damage', unit: '%', step: 1, get: () => mods.damagePct!, bump: () => (mods.damagePct! += 1) };
  }
  if (mods?.healPct !== undefined) {
    return { label: 'aura healing', unit: '%', step: 1, get: () => mods.healPct!, bump: () => (mods.healPct! += 1) };
  }
  if (mods?.critPctDelta !== undefined) {
    return { label: 'aura crit', unit: '%', step: 1, get: () => mods.critPctDelta!, bump: () => (mods.critPctDelta! += 1) };
  }
  return null;
}

/**
 * The card at a higher tier, or null when no knob can land on the budget
 * within audit tolerance. Same card for the card's own tier.
 */
export function buildTierVariant(base: SkillDef, tier: SkillTier): SkillDef | null {
  if (tier === base.tier) return base;
  // UNIQUE cards are fixed-rank (Bazaar-style): one-of-a-kind, never
  // upgraded — their printed form is their final form.
  if (base.tier === 'unique') return null;
  if (TIER_ORDER.indexOf(tier) < TIER_ORDER.indexOf(base.tier)) return null;

  const def = cloneDef(base);
  const knob = findKnob(def);
  if (!knob) return null;

  const before = knob.get();
  const target = TIER_BUDGET_DECI[tier];
  // Monotonic small steps; the guard is far above any real climb.
  for (let i = 0; i < 1000 && powerLevelDeci(def) < target - BUDGET_TOLERANCE_DECI; i++) {
    knob.bump();
  }
  if (Math.abs(powerLevelDeci(def) - target) > BUDGET_TOLERANCE_DECI) return null;

  const tierName = tier.charAt(0).toUpperCase() + tier.slice(1);
  def.id = variantId(base.id, tier, base.tier);
  def.name = `${base.name} ${TIER_NUMERAL[tier]}`;
  def.tier = tier;
  def.text = `${base.text} ◆ ${tierName}: ${knob.label} ${before}${knob.unit} → ${knob.get()}${knob.unit}.`;
  return def;
}
