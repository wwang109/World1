import type { SkillBook, SkillDef } from '../types';
import { aurasOn, type AuraMods } from './auras';
import type { CombatantState, PieceState } from './state';

export interface CastChoice {
  piece: PieceState;
  skill: SkillDef;
  mods: AuraMods;
}

/**
 * Whether casting this skill right now would do anything useful — stops the
 * cursor from wasting turns (e.g. healing at full HP).
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
      case 'shield':
      case 'buffStat':
        return true;
      case 'heal':
        if (c.stats.hp < c.stats.maxHp) return true;
        break;
      case 'cleanse':
        if (c.statuses.some((s) => s.kind !== 'buff')) return true;
        break;
    }
  }
  return false;
}

/**
 * Board order = cast order: scan pieces left to right starting from the cast
 * cursor (wrapping) and return the first skill that is castable (not a pure
 * passive, off cooldown) and useful. null = the turn is skipped.
 */
export function selectCast(c: CombatantState, skillBook: SkillBook): CastChoice | null {
  const n = c.pieces.length;
  if (n === 0) return null;

  // First piece at or after the cursor slot; pieces are sorted by slot.
  let start = c.pieces.findIndex((p) => p.slot >= c.castCursor);
  if (start < 0) start = 0; // cursor past the last piece -> wrap

  for (let i = 0; i < n; i++) {
    const piece = c.pieces[(start + i) % n]!;
    const skill = skillBook[piece.skillId];
    if (!skill) continue;
    if (skill.effects.length === 0 && skill.special === undefined) continue;
    if (piece.cooldown > 0) continue;
    if (!isUseful(c, skill)) continue;
    const mods = aurasOn(c, piece, skillBook);
    return { piece, skill, mods };
  }
  return null;
}
