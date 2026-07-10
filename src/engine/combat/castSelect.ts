import { weightOf, type SkillBook, type SkillDef } from '../types';
import { aurasOn, type AuraMods } from './auras';
import { isPositiveStatus, totalShield, type CombatantState, type PieceState } from './state';

export interface CastChoice {
  piece: PieceState;
  skill: SkillDef;
  mods: AuraMods;
  /** Effective initiative weight after auras, never below 1. */
  weight: number;
}

/**
 * Whether casting this card right now would do anything useful — stops the
 * rotation from wasting turns (e.g. healing at full HP).
 */
function isUseful(c: CombatantState, skill: SkillDef): boolean {
  if (skill.special !== undefined) return true;
  for (const action of skill.effects) {
    switch (action.kind) {
      case 'damage':
      case 'poison':
      case 'burn':
      case 'stun':
      case 'debuffStat':
      case 'buffStat':
      case 'slowNext':
      case 'weakenNext':
      case 'curseCard':
      case 'stagger':
      case 'shieldBreak':
      case 'multiHit':
      case 'quicken':
      case 'thorns':
      case 'purge':
        return true;
      case 'shield':
        if (totalShield(c) < c.stats.maxHp) return true;
        break;
      case 'heal':
      case 'regen':
        if (c.stats.hp < c.stats.maxHp) return true;
        break;
      case 'cleanse':
        if (c.statuses.some((s) => !isPositiveStatus(s))) return true;
        break;
      case 'lifesteal':
      case 'comboBonus':
      case 'execute':
        // Pure riders — they don't make a card worth casting on their own.
        break;
    }
  }
  return false;
}

/**
 * Strict left→right rotation: scan cards from the cast cursor (wrapping) and
 * return the first that is castable (not a pure passive) and useful.
 * null = this side has nothing to perform this turn.
 */
export function selectCast(c: CombatantState, skillBook: SkillBook): CastChoice | null {
  const n = c.pieces.length;
  if (n === 0) return null;

  let start = c.pieces.findIndex((p) => p.slot >= c.castCursor);
  if (start < 0) start = 0; // cursor past the last card -> wrap

  for (let i = 0; i < n; i++) {
    const piece = c.pieces[(start + i) % n]!;
    const skill = skillBook[piece.skillId];
    if (!skill) continue;
    if (skill.effects.length === 0 && skill.special === undefined) continue;
    if (piece.castsLeft !== undefined && piece.castsLeft <= 0) continue; // exhausted
    if (!isUseful(c, skill)) continue;
    const mods = aurasOn(c, piece, skillBook);
    const weight = Math.max(1, weightOf(skill) + mods.weightDelta + c.nextWeightPenalty - c.nextWeightBonus);
    return { piece, skill, mods, weight };
  }
  return null;
}
