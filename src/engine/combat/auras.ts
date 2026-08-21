import type { AuraDef, SkillBook } from '../types';
import type { CombatantState, PieceState } from './state';

/** A board footprint: a card's leftmost slot and how many slots it spans. */
export interface Footprint {
  slot: number;
  size: number;
}

/** Accumulated aura modifiers affecting one board card. */
export interface AuraMods {
  /** FLAT damage added to the cast (not a percentage). */
  damageFlat: number;
  /** FLAT healing added to the heal. */
  healFlat: number;
  weightDelta: number;
}

export const NO_MODS: AuraMods = {
  damageFlat: 0,
  healFlat: 0,
  weightDelta: 0,
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
  damageFlat?: number;
  healFlat?: number;
  weightDelta?: number;
}

/** Both the summed mods a cast receives and the per-source breakdown behind them. */
export interface ResolvedAuras {
  /** Summed board-aura mods folded together with the piece's card-scope gem mods. */
  mods: AuraMods;
  /** Board-aura contributors only (no gems), ascending board-slot order. */
  sources: AuraSource[];
}

/**
 * THE board's edge-to-edge distance rule, in one place: the empty-slot GAP
 * between two footprints on each side.
 *
 *   source occupies [source.slot, source.slot + source.size)
 *   target occupies [target.slot, target.slot + target.size)
 *   rightGap = target.slot - (source.slot + source.size)  // >= 0 iff target is right of source
 *   leftGap  = source.slot - (target.slot + target.size)  // >= 0 iff target is left of source
 *
 * Exactly one of the two is >= 0 for any pair of non-overlapping footprints
 * (0 = physically touching, 1 = one empty slot between them, ...); the other is
 * negative and means "not on that side". Multi-slot cards are measured as WHOLE
 * pieces, which is what makes adjacency piece-to-piece rather than slot-to-slot.
 *
 * Extracted so the two consumers of board adjacency — aura coverage
 * ({@link auraCovers}) and the `splash` band ({@link splashBand}, combat/splash.ts)
 * — measure with the SAME arithmetic instead of each re-deriving it.
 */
export function footprintGaps(source: Footprint, target: Footprint): { leftGap: number; rightGap: number } {
  return {
    leftGap: source.slot - (target.slot + target.size),
    rightGap: target.slot - (source.slot + source.size),
  };
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
export function auraCovers(
  source: Footprint,
  target: Footprint,
  affects: 'adjacent' | 'left' | 'right' | 'allBoard',
  reach: number,
): boolean {
  // 'allBoard' reaches everyone but itself (identity by footprint position).
  if (affects === 'allBoard') return !(source.slot === target.slot && source.size === target.size);
  const { leftGap, rightGap } = footprintGaps(source, target);
  const reachesRight = rightGap >= 0 && rightGap < reach;
  const reachesLeft = leftGap >= 0 && leftGap < reach;
  switch (affects) {
    case 'adjacent':
      return reachesRight || reachesLeft;
    case 'left':
      return reachesLeft;
    case 'right':
      return reachesRight;
    default:
      // COMPILE-TIME EXHAUSTIVENESS, not a runtime branch: `affects` is `never`
      // here, so adding a direction to `AuraDef['affects']` in types.ts fails tsc
      // RIGHT HERE instead of silently falling through to `undefined` (which
      // reads as "reaches nothing" and would quietly disable an aura). Content is
      // authored as data now, so an unhandled direction is reachable from a JSON
      // edit rather than only from a code change.
      return assertNeverAffects(affects);
  }
}

function assertNeverAffects(value: never): never {
  throw new Error(`unhandled aura affects: ${JSON.stringify(value)}`);
}

function covers(
  source: PieceState,
  target: PieceState,
  affects: 'adjacent' | 'left' | 'right' | 'allBoard',
  reach: number,
): boolean {
  // 'allBoard' identity must stay reference-based here (two distinct pieces can
  // share a slot/size in principle); slot/size identity is only for the pure
  // footprint API used by the UI.
  if (affects === 'allBoard') return source !== target;
  return auraCovers(source, target, affects, reach);
}

/**
 * Which of `targets` an aura projected from `source` reaches AND matches — the
 * SAME coverage + filter rule the combat loop applies (see {@link resolveAuras}),
 * exposed for the UI to draw an aura's affected area on the board. Pure and
 * board-state-based (slot + skillId), independent of combat state. Returns the
 * covered target slots (source excluded), ascending.
 */
export function auraAffectedTargetSlots(
  source: { slot: number; skillId: string },
  targets: readonly { slot: number; skillId: string }[],
  skillBook: SkillBook,
): number[] {
  const def = skillBook[source.skillId];
  const aura: AuraDef | undefined = def?.aura;
  if (!def || !aura) return [];
  const reach = aura.reach ?? 1;
  const out: number[] = [];
  for (const target of targets) {
    if (target.slot === source.slot) continue;
    const tdef = skillBook[target.skillId];
    if (!tdef) continue;
    if (!auraCovers({ slot: source.slot, size: def.size }, { slot: target.slot, size: tdef.size }, aura.affects, reach)) continue;
    if (aura.archetypeFilter && !tdef.archetypes.includes(aura.archetypeFilter)) continue;
    if (aura.propertyFilter && tdef.property !== aura.propertyFilter) continue;
    out.push(target.slot);
  }
  return out.sort((a, b) => a - b);
}

/**
 * Single-pass resolution of everything that modifies `piece`'s cast: sum every
 * aura on this combatant's board that reaches it and whose filters match, then
 * fold in the piece's own card-scope stat-gem mods and any `curse` standing on
 * it. Emits both the summed `mods` (the value the core loop consumes) and the
 * per-source `sources` breakdown (board auras only) so the log never drifts from
 * the applied mods. Recomputed at cast time so board state changes are
 * reflected.
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
    const dmg = aura.mods.damageFlat ?? 0;
    const heal = aura.mods.healFlat ?? 0;
    const weight = aura.mods.weightDelta ?? 0;
    mods.damageFlat += dmg;
    mods.healFlat += heal;
    mods.weightDelta += weight;
    // Record only the nonzero mods this source contributed.
    const entry: AuraSource = { slot: source.slot, skillId: source.skillId };
    if (dmg) entry.damageFlat = dmg;
    if (heal) entry.healFlat = heal;
    if (weight) entry.weightDelta = weight;
    sources.push(entry);
  }
  // Card-scope stat gem rides the same summed bundle but is intentionally NOT
  // recorded in `sources`: gems are a separate, already-visible feature.
  const g = piece.gemMods;
  mods.damageFlat += g.damageFlat ?? 0;
  mods.healFlat += g.healFlat ?? 0;
  mods.weightDelta += g.weightDelta ?? 0;
  // A `curse` standing on THIS piece (PieceState.curse, combat/state.ts) is the
  // NEGATIVE half of the same flat-damage channel, folded in at the same seam
  // and for the same reason the gem mod above is: the core loop consumes only
  // the resolved bundle, so a per-instance modifier is added HERE rather than
  // as a branch in the damage arm. Everything downstream — mitigation order,
  // the min-1 floor in `applyStrike`, the per-hit application on a multi-hit
  // card — then applies to it unchanged, with no arithmetic duplicated.
  //
  // NOT RECORDED IN `sources` either, and for a sharper reason than gems: this
  // is not a board aura at all. It is an effect the OPPONENT applied, already
  // announced by its own `cursed` event and already visible in the resulting
  // hit's `calculation.effectBonusDamage` (which simply goes negative).
  //
  // NO TURN CHECK HERE, deliberately: an expired curse does not exist. The
  // end-of-turn pass (`expireCurses`, simulate.ts) deletes the field on the turn
  // it lapses, so any curse this function can see is live — which is what keeps
  // `resolveAuras` a pure function of board state, callable from the
  // speculative `scanCast` with no turn number threaded through it.
  if (piece.curse) mods.damageFlat -= piece.curse.amount;
  return { mods, sources };
}

/**
 * Summed aura + card-scope-gem mods affecting `piece`. Thin wrapper over
 * {@link resolveAuras}; the signature the core loop already calls is unchanged.
 */
export function aurasOn(c: CombatantState, piece: PieceState, skillBook: SkillBook): AuraMods {
  return resolveAuras(c, piece, skillBook).mods;
}
