import { BASELINE_COOLDOWN, weightOf, type SkillBook, type SkillDef } from '../types';
import { resolveAuras, type AuraMods, type AuraSource } from './auras';
import type { CombatantState, PieceState } from './state';

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
export function cooldownRemaining(piece: PieceState, currentTurn: number): number {
  if (piece.lastCastTurn === undefined) return 0;
  return Math.max(0, piece.lastCastTurn + effectiveCooldown(piece.skill) + 1 - currentTurn);
}

export interface CastChoice {
  piece: PieceState;
  skill: SkillDef;
  mods: AuraMods;
  /**
   * Per-source breakdown behind `mods` (board auras only, ascending slot).
   * Threaded onto the `skillCast` event for playback; empty when no aura hit.
   */
  auraSources: AuraSource[];
  /** Effective initiative weight after auras, never below 1. */
  weight: number;
}

/** Optional gating for card scans. */
export interface SelectOpts {
  /** Current global turn (needed to evaluate cooldowns). */
  currentTurn: number;
  /** When true, cards still within their reuse cooldown are skipped. */
  cooldownsEnabled: boolean;
  /** Pieces already played this gameplay turn cannot loop after cursor wrap. */
  excludedThisTurn?: ReadonlySet<PieceState>;
}

export type CastScan =
  | { kind: 'choice'; choice: CastChoice }
  | { kind: 'cooling'; piece: PieceState; turnsLeft: number }
  | { kind: 'none' };

/** Scan forward once from the cursor, skipping empty and cooling card starts. */
export function scanCast(c: CombatantState, skillBook: SkillBook, opts: SelectOpts): CastScan {
  if (c.pieces.length === 0) return { kind: 'none' };

  let firstCooling: { piece: PieceState; turnsLeft: number } | null = null;
  for (let offset = 0; offset < c.boardSize; offset += 1) {
    const slot = (c.castCursor + offset) % c.boardSize;
    const piece = c.pieces.find((candidate) => candidate.slot === slot);
    if (!piece) continue;
    if (opts.excludedThisTurn?.has(piece)) continue;
    const turnsLeft = opts.cooldownsEnabled ? cooldownRemaining(piece, opts.currentTurn) : 0;
    if (turnsLeft > 0) {
      firstCooling ??= { piece, turnsLeft };
      continue;
    }
    const skill = piece.skill;
    if (skill.effects.length === 0 && skill.special === undefined && skill.aura === undefined) continue;
    const { mods, sources } = resolveAuras(c, piece, skillBook);
    // THE single place a cast's weight is summed: card base + auras/gems +
    // the UNIT-scope pending tax (`slow`) + the CARD-scope pending tax on this
    // very piece (`splash`). Never below 1.
    //
    // READ-ONLY, DELIBERATELY: `scanCast` also runs SPECULATIVELY — the
    // performer search and the `wait`/`cantAfford` explanation pass in
    // simulate.ts both scan units that will not end up casting at all — so
    // neither penalty may be consumed here. Both are cleared where a cast
    // actually resolves and pays its weight (simulate.ts, beside
    // `c.nextWeightPenalty = 0`). A penalty consumed by a speculative scan is a
    // silent bug: the tax would vanish without ever being paid.
    const weight = Math.max(1, weightOf(skill) + mods.weightDelta + c.nextWeightPenalty + (piece.nextWeightPenalty ?? 0));
    return { kind: 'choice', choice: { piece, skill, mods, auraSources: sources, weight } };
  }
  return firstCooling ? { kind: 'cooling', ...firstCooling } : { kind: 'none' };
}

/**
 * Strict left-to-right rotation: scan slots from the cast cursor (wrapping),
 * skip cooling cards, and return the first playable card. Aura cards are valid
 * plays and still consume readiness.
 * null = this side has nothing to perform this turn.
 *
 * `allies` (default `[c]`) are the living same-side units this unit's support
 * casts could target; passing the whole living team lets a healer/cleanser fire
 * for an ally. Defaulting to `[c]` keeps 1v1/solo byte-identical.
 */
export function selectCast(
  c: CombatantState,
  skillBook: SkillBook,
  _allies: CombatantState[] = [c],
  opts?: SelectOpts,
): CastChoice | null {
  const scan = scanCast(c, skillBook, opts ?? { currentTurn: 0, cooldownsEnabled: false });
  return scan.kind === 'choice' ? scan.choice : null;
}
