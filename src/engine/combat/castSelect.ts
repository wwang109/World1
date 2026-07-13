import { BASELINE_COOLDOWN, weightOf, type SkillBook, type SkillDef } from '../types';
import { aurasOn, type AuraMods } from './auras';
import { totalShield, type CombatantState, type PieceState } from './state';

// Re-exported for existing callers (e.g. tests) that import it from here;
// the canonical definition now lives in `../types` (see its doc comment) so
// `cards.ts`/`balance.ts` can read it without an import cycle through `state.ts`.
export { BASELINE_COOLDOWN };

/** Effective reuse cooldown for a card: its own `cooldownTurns`, else the baseline. */
export function effectiveCooldown(skill: SkillDef): number {
  return skill.cooldownTurns ?? BASELINE_COOLDOWN;
}

/**
 * A piece is ON COOLDOWN (not eligible to be queued) when it cast recently:
 * `currentTurn - lastCastTurn <= effectiveCooldown`. Never-cast pieces
 * (`lastCastTurn === undefined`) are always available. Cast on turn T →
 * unavailable T+1..T+cooldown → eligible at T+cooldown+1.
 */
function onCooldown(piece: PieceState, currentTurn: number): boolean {
  if (piece.lastCastTurn === undefined) return false;
  return currentTurn - piece.lastCastTurn <= effectiveCooldown(piece.skill);
}

export interface CastChoice {
  piece: PieceState;
  skill: SkillDef;
  mods: AuraMods;
  /** Effective initiative weight after auras, never below 1. */
  weight: number;
}

/** Optional gating for `selectCast`. Cooldowns are OFF unless a caller opts in. */
export interface SelectOpts {
  /** Current global turn (needed to evaluate cooldowns). */
  currentTurn: number;
  /** When true, cards still within their reuse cooldown are skipped. */
  cooldownsEnabled: boolean;
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
export function selectCast(
  c: CombatantState,
  skillBook: SkillBook,
  allies: CombatantState[] = [c],
  opts?: SelectOpts,
): CastChoice | null {
  const n = c.pieces.length;
  if (n === 0) return null;

  let start = c.pieces.findIndex((p) => p.slot >= c.castCursor);
  if (start < 0) start = 0; // cursor past the last card -> wrap

  for (let i = 0; i < n; i++) {
    const piece = c.pieces[(start + i) % n]!;
    const skill = piece.skill;
    if (skill.effects.length === 0 && skill.special === undefined) continue;
    // Cooldown gate: a card still cooling from a recent cast is not eligible.
    // Orthogonal to weight — weight only orders whatever IS eligible.
    if (opts?.cooldownsEnabled && onCooldown(piece, opts.currentTurn)) continue;
    if (!isUseful(c, skill, allies)) continue;
    const mods = aurasOn(c, piece, skillBook);
    const weight = Math.max(1, weightOf(skill) + mods.weightDelta + c.nextWeightPenalty);
    return { piece, skill, mods, weight };
  }
  return null;
}
