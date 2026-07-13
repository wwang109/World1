import { weightOf, type SkillBook, type SkillDef } from '../types';
import { aurasOn, type AuraMods } from './auras';
import { totalShield, type CombatantState, type PieceState } from './state';

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
 *
 * `allies` are the LIVING same-side units this cast could target (self
 * included). Ally-targeted support (heal/cleanse) is useful when ANY ally would
 * benefit, so a healthy healer still fires on a hurt ally. In SOLO/1v1
 * `allies === [c]`, so this is byte-identical to the old self-only check.
 */
function isUseful(c: CombatantState, skill: SkillDef, allies: CombatantState[]): boolean {
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
      case 'stagger':
      case 'shieldBreak':
      case 'guard':
      case 'negate':
      case 'taunt':
        return true;
      case 'shield':
        // Shields still self-protect (ally-shield is a future option).
        if (totalShield(c) < c.stats.maxHp) return true;
        break;
      case 'heal':
        if (allies.some((a) => a.stats.hp < a.stats.maxHp)) return true;
        break;
      case 'cleanse':
        if (allies.some((a) => a.statuses.some((s) => s.kind !== 'buff'))) return true;
        break;
      case 'lifesteal':
      case 'comboBonus':
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
 *
 * `allies` (default `[c]`) are the living same-side units this unit's support
 * casts could target; passing the whole living team lets a healer/cleanser fire
 * for an ally. Defaulting to `[c]` keeps 1v1/solo byte-identical.
 */
export function selectCast(c: CombatantState, skillBook: SkillBook, allies: CombatantState[] = [c]): CastChoice | null {
  const n = c.pieces.length;
  if (n === 0) return null;

  let start = c.pieces.findIndex((p) => p.slot >= c.castCursor);
  if (start < 0) start = 0; // cursor past the last card -> wrap

  for (let i = 0; i < n; i++) {
    const piece = c.pieces[(start + i) % n]!;
    const skill = piece.skill;
    if (skill.effects.length === 0 && skill.special === undefined) continue;
    if (!isUseful(c, skill, allies)) continue;
    const mods = aurasOn(c, piece, skillBook);
    const weight = Math.max(1, weightOf(skill) + mods.weightDelta + c.nextWeightPenalty);
    return { piece, skill, mods, weight };
  }
  return null;
}
