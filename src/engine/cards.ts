// Gem/socket resolution: pure, integer-only, no RNG.
//
// A gem is either an EFFECT gem (extra cast Actions appended to a card) or a
// STAT gem (flat modifiers, card- or hero-scoped). Resolution here produces the
// effective skill and modifier bundles the combat engine consumes; an un-gemmed
// piece resolves to the exact same reference/values it had before gems existed,
// so behavior and the event log are byte-identical.

import type { AuraMods } from './combat/auras';
import { BASELINE_COOLDOWN, type BoardPiece, type BuffableStat, type CombatantStats, type Gem, type SkillDef } from './types';

/** Fixed order for deterministic hero-stat folding (sums are commutative regardless). */
const HERO_STATS: readonly BuffableStat[] = ['attack', 'magicPower', 'armor', 'magicResist', 'speed', 'critPct'];

/**
 * The skill actually cast from this piece. An effect gem appends its actions
 * AFTER the base effects (fixed order: base first, gem after), and — if it
 * carries `cooldownReduction` — shortens the card's effective cooldown by
 * that many turns (floored at 0). Any other case (no gem / stat gem / an
 * effect gem with neither actions nor a cooldown reduction) returns the
 * original def unchanged (same reference).
 */
export function resolveEffectiveSkill(def: SkillDef, piece: BoardPiece): SkillDef {
  const gem = piece.gem;
  if (!gem || gem.kind !== 'effect') return def;
  const cooldownReduction = gem.cooldownReduction ?? 0;
  if (gem.actions.length === 0 && cooldownReduction === 0) return def;

  const effects = gem.actions.length > 0 ? [...def.effects, ...gem.actions] : def.effects;
  if (cooldownReduction === 0) return { ...def, effects };

  const baseCooldown = def.cooldownTurns ?? BASELINE_COOLDOWN;
  return { ...def, effects, cooldownTurns: Math.max(0, baseCooldown - cooldownReduction) };
}

/** A card-scope stat gem's card mods as an AuraMods-shaped bundle; `{}` otherwise. */
export function gemCardMods(gem: Gem | null | undefined): Partial<AuraMods> {
  if (!gem || gem.kind !== 'stat' || gem.scope !== 'card' || !gem.mods.card) return {};
  const card = gem.mods.card;
  const out: Partial<AuraMods> = {};
  if (card.damagePct !== undefined) out.damagePct = card.damagePct;
  if (card.healPct !== undefined) out.healPct = card.healPct;
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
