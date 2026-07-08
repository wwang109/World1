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

/** Two cards are adjacent when their occupied ranges touch edge to edge. */
function touches(a: PieceState, b: PieceState): boolean {
  return a.slot + a.size === b.slot || b.slot + b.size === a.slot;
}

function covers(source: PieceState, target: PieceState, affects: 'adjacent' | 'left' | 'right' | 'allBoard'): boolean {
  switch (affects) {
    case 'adjacent':
      return touches(source, target);
    case 'left':
      return target.slot + target.size === source.slot;
    case 'right':
      return source.slot + source.size === target.slot;
    case 'allBoard':
      return source !== target;
  }
}

/**
 * Sum every aura on this combatant's board that reaches `piece` and whose
 * filters match the card sitting there. Recomputed at cast time so board
 * state changes are always reflected.
 */
export function aurasOn(c: CombatantState, piece: PieceState, skillBook: SkillBook): AuraMods {
  const targetDef = skillBook[piece.skillId];
  if (!targetDef) return NO_MODS;

  const mods: AuraMods = { ...NO_MODS };
  for (const source of c.pieces) {
    if (source === piece) continue;
    const def = skillBook[source.skillId];
    const aura = def?.aura;
    if (!aura) continue;
    if (!covers(source, piece, aura.affects)) continue;
    if (aura.archetypeFilter && !targetDef.archetypes.includes(aura.archetypeFilter)) continue;
    if (aura.propertyFilter && targetDef.property !== aura.propertyFilter) continue;
    mods.damagePct += aura.mods.damagePct ?? 0;
    mods.healPct += aura.mods.healPct ?? 0;
    mods.weightDelta += aura.mods.weightDelta ?? 0;
    mods.critPctDelta += aura.mods.critPctDelta ?? 0;
  }
  return mods;
}
