import { weightOf, type SkillBook, type SkillDef } from '../types';

/** Freshness window: how many recent casts a card must clear to be light again. */
export const REPLAY_WINDOW = 3;
/** Extra weight per appearance of the queued card within the window. */
export const REPLAY_WEIGHT = 4;
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
  // A blood price the caster cannot survive makes the card uncastable.
  for (const action of skill.effects) {
    if (action.kind === 'bloodCost' && c.stats.hp <= action.amount) return false;
  }
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
      case 'thorns':
      case 'purge':
      case 'guard':
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
      case 'dodge':
        // Re-casting while charges remain would waste them (they expire on
        // this very performance) — skip until the guard is spent.
        if (!c.statuses.some((s) => s.kind === 'dodge')) return true;
        break;
      case 'empower':
        // Re-casting while charged would waste it (non-stacking max).
        if (c.nextCastEmpowerPct <= 0) return true;
        break;

      case 'lifesteal':
      case 'comboBonus':
      case 'execute':
      case 'quicken':
      case 'bloodCost':
        // Pure riders — they don't make a card worth casting on their own
        // (quicken here keeps Sidestep gated by its dodge charges).
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
    // FRESHNESS: a card replayed while still in the recent-cast window is
    // +REPLAY_WEIGHT heavier per appearance. Boards rotating 4+ cards never
    // pay it; thin fast-rotation boards trade tempo for their focus.
    let replay = 0;
    for (const id of c.recentCasts) if (id === skill.id) replay += REPLAY_WEIGHT;
    const weight = Math.max(1, weightOf(skill) + mods.weightDelta + c.nextWeightPenalty - c.nextWeightBonus + replay);
    return { piece, skill, mods, weight };
  }
  return null;
}
