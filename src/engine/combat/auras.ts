import type { SkillBook } from '../types';
import type { CombatantState, PieceState } from './state';

/** Accumulated aura modifiers affecting one board card. */
export interface AuraMods {
  damagePct: number;
  healPct: number;
  weightDelta: number;
  critPctDelta: number;
}

export const NO_MODS: AuraMods = {
  damagePct: 0,
  healPct: 0,
  weightDelta: 0,
  critPctDelta: 0,
};

/**
 * One board card whose aura reached and matched a cast, with the per-mod
 * magnitudes it contributed. Additive/deterministic playback data: only the
 * nonzero mods are set, and the log lists sources in ascending board-slot
 * order (`c.pieces` is slot-sorted, so index order == slot order).
 *
 * Board auras ONLY — the piece's own card-scope stat gems are intentionally
 * excluded here (gems are a separate, already-visible feature).
 */
export interface AuraSource {
  slot: number;
  skillId: string;
  damagePct?: number;
  healPct?: number;
  weightDelta?: number;
  critPctDelta?: number;
}

/** Both the summed mods a cast receives and the per-source breakdown behind them. */
export interface ResolvedAuras {
  /** Summed board-aura mods folded together with the piece's card-scope gem mods. */
  mods: AuraMods;
  /** Board-aura contributors only (no gems), ascending board-slot order. */
  sources: AuraSource[];
}

/**
 * Does `source`'s aura reach `target`?
 *
 * Coverage is the empty-slot GAP between their nearest edges being `< reach`,
 * measured in pure integer slot arithmetic:
 *   source occupies [source.slot, source.slot + source.size)
 *   target occupies [target.slot, target.slot + target.size)
 *   rightGap = target.slot - (source.slot + source.size)  // >= 0 iff target is right of source
 *   leftGap  = source.slot - (target.slot + target.size)  // >= 0 iff target is left of source
 *
 * A source ending EXACTLY at the target's start touches it: gap 0. So `reach: 1`
 * (gap < 1 → gap === 0) reproduces the old `touches` behavior byte-for-byte
 * (adjacent/left/right = physically touching). gap 1 = one empty slot between
 * them, reached only at `reach >= 2`; each +1 reach extends coverage one further
 * slot. A `reach` of 0 or negative reaches nothing on that side (gap is always
 * >= 0 for the side the target lies on, and >= 0 is never < 0).
 *
 * `affects` is the DIRECTION selector: 'adjacent' = both sides up to `reach`;
 * 'left'/'right' = that one direction up to `reach`; 'allBoard' = whole board
 * (reach ignored).
 */
function covers(
  source: PieceState,
  target: PieceState,
  affects: 'adjacent' | 'left' | 'right' | 'allBoard',
  reach: number,
): boolean {
  if (affects === 'allBoard') return source !== target;
  const rightGap = target.slot - (source.slot + source.size);
  const leftGap = source.slot - (target.slot + target.size);
  const reachesRight = rightGap >= 0 && rightGap < reach;
  const reachesLeft = leftGap >= 0 && leftGap < reach;
  switch (affects) {
    case 'adjacent':
      return reachesRight || reachesLeft;
    case 'left':
      return reachesLeft;
    case 'right':
      return reachesRight;
  }
}

/**
 * Single-pass resolution of the auras affecting `piece`: sum every aura on this
 * combatant's board that reaches it and whose filters match, then fold in the
 * piece's own card-scope stat-gem mods. Emits both the summed `mods` (the value
 * the core loop consumes) and the per-source `sources` breakdown (board auras
 * only) so the log never drifts from the applied mods. Recomputed at cast time
 * so board state changes are reflected.
 */
export function resolveAuras(c: CombatantState, piece: PieceState, skillBook: SkillBook): ResolvedAuras {
  const targetDef = skillBook[piece.skillId];
  if (!targetDef) return { mods: { ...NO_MODS }, sources: [] };

  const mods: AuraMods = { ...NO_MODS };
  const sources: AuraSource[] = [];
  // `c.pieces` is slot-sorted (see makeCombatant), so this index walk yields
  // sources in ascending board-slot order without a separate sort.
  for (const source of c.pieces) {
    if (source === piece) continue;
    const def = skillBook[source.skillId];
    const aura = def?.aura;
    if (!aura) continue;
    if (!covers(source, piece, aura.affects, aura.reach ?? 1)) continue;
    if (aura.archetypeFilter && !targetDef.archetypes.includes(aura.archetypeFilter)) continue;
    if (aura.propertyFilter && targetDef.property !== aura.propertyFilter) continue;
    const dmg = aura.mods.damagePct ?? 0;
    const heal = aura.mods.healPct ?? 0;
    const weight = aura.mods.weightDelta ?? 0;
    const crit = aura.mods.critPctDelta ?? 0;
    mods.damagePct += dmg;
    mods.healPct += heal;
    mods.weightDelta += weight;
    mods.critPctDelta += crit;
    // Record only the nonzero mods this source contributed.
    const entry: AuraSource = { slot: source.slot, skillId: source.skillId };
    if (dmg) entry.damagePct = dmg;
    if (heal) entry.healPct = heal;
    if (weight) entry.weightDelta = weight;
    if (crit) entry.critPctDelta = crit;
    sources.push(entry);
  }
  // Card-scope stat gem rides the same summed bundle but is intentionally NOT
  // recorded in `sources`: gems are a separate, already-visible feature.
  const g = piece.gemMods;
  mods.damagePct += g.damagePct ?? 0;
  mods.healPct += g.healPct ?? 0;
  mods.weightDelta += g.weightDelta ?? 0;
  mods.critPctDelta += g.critPctDelta ?? 0;
  return { mods, sources };
}

/**
 * Summed aura + card-scope-gem mods affecting `piece`. Thin wrapper over
 * {@link resolveAuras}; the signature the core loop already calls is unchanged.
 */
export function aurasOn(c: CombatantState, piece: PieceState, skillBook: SkillBook): AuraMods {
  return resolveAuras(c, piece, skillBook).mods;
}
