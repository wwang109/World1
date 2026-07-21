// Gem/socket resolution: pure, integer-only, no RNG.
//
// A gem is either an EFFECT gem (extra cast Actions appended to a card) or a
// STAT gem (flat modifiers, card- or hero-scoped). Resolution here produces the
// effective skill and modifier bundles the combat engine consumes; an un-gemmed
// piece resolves to the exact same reference/values it had before gems existed,
// so behavior and the event log are byte-identical.

import type { AuraMods } from './combat/auras';
import { TIER_BUDGET_DECI } from './balance';
import { BASELINE_COOLDOWN, type Action, type BoardPiece, type BuffableStat, type CombatantStats, type Gem, type SkillDef, type SkillTier } from './types';

/** Fixed order for deterministic hero-stat folding (sums are commutative regardless). */
const HERO_STATS: readonly BuffableStat[] = ['attack', 'magicPower', 'armor', 'magicResist', 'speed', 'critPct'];

/** Low → high tier order (index = tier-steps above bronze). */
const TIER_ORDER: readonly SkillTier[] = ['bronze', 'silver', 'gold', 'diamond'];

/**
 * Rank/tier-up: scale a card's linear effect magnitudes (damage/heal/shield
 * `power`, poison/burn `amount`) up from its base tier to `targetTier` so the
 * card's PL lands on the target tier's budget (Silver 15 / Gold 20 / Diamond 25,
 * i.e. ×1.5 / ×2.0 / ×2.5 of the Bronze 10 base). Integer-floored. Non-magnitude
 * fields (turns, riders, weight, size) are left alone — enemy cards are not
 * audited, so hitting the budget approximately via magnitude scaling is fine.
 * A target at or below the base tier returns `def` unchanged.
 */
export function applyTier(def: SkillDef, targetTier: SkillTier): SkillDef {
  if (TIER_ORDER.indexOf(targetTier) <= TIER_ORDER.indexOf(def.tier)) return def;
  const num = TIER_BUDGET_DECI[targetTier];
  const den = TIER_BUDGET_DECI[def.tier];
  const scale = (n: number): number => Math.floor((n * num) / den);
  const effects = def.effects.map((a): Action => {
    switch (a.kind) {
      case 'damage':
      case 'heal':
      case 'shield':
        return { ...a, power: scale(a.power) };
      case 'poison':
      case 'burn':
      case 'bleed':
        // Stacking DoT: scale the STACK count with the tier (per-stack damage
        // scales with the caster's stat for free). Tier-ups aren't budget-audited.
        return { ...a, stacks: scale(a.stacks) };
      default:
        return a;
    }
  });
  return { ...def, tier: targetTier, effects };
}

/**
 * The skill actually cast from this piece. An effect gem appends its actions
 * AFTER the base effects (fixed order: base first, gem after), and — if it
 * carries `cooldownReduction` — shortens the card's effective cooldown by
 * that many turns (floored at 0). Any other case (no gem / stat gem / an
 * effect gem with neither actions nor a cooldown reduction) returns the
 * original def unchanged (same reference).
 */
export function resolveEffectiveSkill(def: SkillDef, piece: BoardPiece): SkillDef {
  // Rank/tier-up first (scales the base card), THEN fold the gem on top — a
  // gem's own actions are never tier-scaled.
  const tiered = piece.tier ? applyTier(def, piece.tier) : def;
  const gem = piece.gem;
  if (!gem || gem.kind !== 'effect') return tiered;
  const cooldownReduction = gem.cooldownReduction ?? 0;
  if (gem.actions.length === 0 && cooldownReduction === 0) return tiered;

  const effects = gem.actions.length > 0 ? [...tiered.effects, ...gem.actions] : tiered.effects;
  if (cooldownReduction === 0) return { ...tiered, effects };

  const baseCooldown = tiered.cooldownTurns ?? BASELINE_COOLDOWN;
  return { ...tiered, effects, cooldownTurns: Math.max(0, baseCooldown - cooldownReduction) };
}

/** A card-scope stat gem's card mods as an AuraMods-shaped bundle; `{}` otherwise. */
export function gemCardMods(gem: Gem | null | undefined): Partial<AuraMods> {
  if (!gem || gem.kind !== 'stat' || gem.scope !== 'card' || !gem.mods.card) return {};
  const card = gem.mods.card;
  const out: Partial<AuraMods> = {};
  if (card.damageFlat !== undefined) out.damageFlat = card.damageFlat;
  if (card.healFlat !== undefined) out.healFlat = card.healFlat;
  if (card.weightDelta !== undefined) out.weightDelta = card.weightDelta;
  if (card.critPctDelta !== undefined) out.critPctDelta = card.critPctDelta;
  return out;
}

/** Sum every hero-scope stat gem's `mods.hero` across the board. */
export function gemHeroStats(pieces: BoardPiece[]): Partial<CombatantStats> {
  const out: Partial<CombatantStats> = {};
  for (const piece of pieces) {
    const gem = piece.gem;
    if (!gem || gem.kind !== 'stat' || gem.scope !== 'hero' || !gem.mods.hero) continue;
    const hero = gem.mods.hero;
    for (const key of HERO_STATS) {
      const v = hero[key];
      if (v === undefined) continue;
      out[key] = (out[key] ?? 0) + v;
    }
  }
  return out;
}

/** Integer-add hero-scope contributions into a copy of `stats`. */
export function applyHeroGems(stats: CombatantStats, heroAdds: Partial<CombatantStats>): CombatantStats {
  const out = { ...stats };
  for (const key of HERO_STATS) {
    const v = heroAdds[key];
    if (v === undefined) continue;
    out[key] = out[key] + v;
  }
  return out;
}
