// Encounter resolver — the run-layer bridge between "what level is this fight"
// and the fully-scaled CombatantSetup that feeds `simulate()`.
//
// This is the module the UI (Codex) should call to build a fight with TRUE
// resolved levels, instead of displaying placeholders like `enemy.baseDepth`
// or a hardcoded hero level. It is thin on purpose: level -> points curve and
// stat scaling already live in `leveling.ts`; this module just wires ids/
// board pieces to that curve and echoes back the resolved level for display.
//
// Hook for later: titles/modifiers (e.g. "Elite" = +2 effective levels) are
// NOT applied here yet — a future caller passes an adjusted effective level
// into `buildEnemyEncounter`/`buildHeroSetup` (see `scaleMonsterToLevel`'s own
// title hook comment). No RNG, no Phaser, fully deterministic.

import type { BoardPiece, CombatantSetup } from '../engine/types';
import { enemies } from '../data/enemies';
import { BASE_HERO_STATS, HERO_BOARD_SLOTS } from '../data/heroes';
import { applyPlayerAllocation, availablePoints, scaleMonsterToLevel, type Allocation } from './leveling';

/** A resolved combatant ready for `simulate()`, plus the level that produced it. */
export interface EncounterUnit {
  setup: CombatantSetup;
  level: number;
  enemyId: string;
}

/** Clamp any requested level to the valid floor (level 1 = no points spent). */
function clampLevel(level: number): number {
  return Math.max(1, Math.floor(level));
}

/**
 * Resolve an enemy encounter: looks up `enemyId` in the data registry, scales
 * it to `level` via `scaleMonsterToLevel`, and returns the scaled setup plus
 * the resolved (clamped) level. Throws on an unknown enemy id.
 */
export function buildEnemyEncounter(enemyId: string, level: number): EncounterUnit {
  const enemy = enemies[enemyId];
  if (!enemy) {
    throw new Error(`buildEnemyEncounter: unknown enemy id "${enemyId}"`);
  }
  const resolvedLevel = clampLevel(level);
  const setup = scaleMonsterToLevel(enemy, resolvedLevel);
  return { setup, level: resolvedLevel, enemyId };
}

/** Inputs needed to resolve a hero's combat setup: level, chosen allocation, and board. */
export interface HeroBuild {
  level: number;
  allocation: Allocation;
  pieces: BoardPiece[];
}

/**
 * Resolve the hero's combat setup: BASE_HERO_STATS + the player's chosen
 * allocation, validated against the points available at `build.level`.
 * Throws (propagated from `applyPlayerAllocation`) if the allocation
 * over-spends its budget.
 */
export function buildHeroSetup(build: HeroBuild): { setup: CombatantSetup; level: number } {
  const resolvedLevel = clampLevel(build.level);
  const available = availablePoints(resolvedLevel);
  const stats = applyPlayerAllocation(BASE_HERO_STATS, build.allocation, available);
  const setup: CombatantSetup = {
    name: 'Hero',
    stats,
    boardSize: HERO_BOARD_SLOTS,
    pieces: build.pieces,
  };
  return { setup, level: resolvedLevel };
}
