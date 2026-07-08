import type { SkillBook } from '../types';
import type { CombatantState, PieceState } from './state';

/** Accumulated aura modifiers affecting one board piece. */
export interface AuraMods {
  damagePct: number;
  healPct: number;
  cooldownDelta: number;
  critPctDelta: number;
}

export const NO_MODS: AuraMods = {
  damagePct: 0,
  healPct: 0,
  cooldownDelta: 0,
  critPctDelta: 0,
};

/** Two pieces are adjacent when their occupied ranges touch edge to edge. */
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
 * Sum every aura on this combatant's board that reaches `piece` and whose tag
 * filter matches the skill sitting there. Recomputed at cast time so board
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
    if (aura.tagFilter && !targetDef.tags.includes(aura.tagFilter)) continue;
    mods.damagePct += aura.mods.damagePct ?? 0;
    mods.healPct += aura.mods.healPct ?? 0;
    mods.cooldownDelta += aura.mods.cooldownDelta ?? 0;
    mods.critPctDelta += aura.mods.critPctDelta ?? 0;
  }
  return mods;
}

/** Effective cooldown set after casting, never below 0. */
export function effCooldown(cooldownTurns: number | undefined, mods: AuraMods): number {
  return Math.max(0, (cooldownTurns ?? 0) + mods.cooldownDelta);
}
