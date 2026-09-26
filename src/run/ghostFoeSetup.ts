import type { CombatantSetup } from '../engine/types';
import { enemies } from '../data/enemies';
import { buildAutoHeroSetup, resolveFoeDeck, type FoeDeckCard } from './encounter';
import type { Allocation } from './leveling';
import { MAX_LEVEL } from './runState';
import { GHOST_NAME_MAX } from './ghost';
import { requestAllocation, requestLevel, requestPieces } from './battleRequestValidation';

export interface BattleGhostConfig {
  pieces: readonly FoeDeckCard[];
  level: number;
  allocation: Allocation;
  displayName: string;
}

function ghostName(displayName: string): string {
  if (typeof displayName !== 'string' || displayName.trim() === '') {
    throw new Error('ghost foe: displayName must be a non-empty string');
  }
  return displayName.trim().slice(0, GHOST_NAME_MAX);
}

export function buildGhostFoeSetup(ghost: BattleGhostConfig): CombatantSetup {
  if (typeof ghost !== 'object' || ghost === null || !Array.isArray(ghost.pieces)) {
    throw new Error('ghost foe: pieces must be an array');
  }
  const pieces = requestPieces('ghost foe', 'ghost board', ghost.pieces, resolveFoeDeck);
  const level = requestLevel('ghost foe', ghost.level, MAX_LEVEL);
  const allocation = requestAllocation('ghost foe', ghost.allocation, level);
  const name = ghostName(ghost.displayName);
  return { ...buildAutoHeroSetup(level, pieces, allocation).setup, name };
}

export function assertKnownGhostEnemyId(enemyId: string): void {
  if (!enemies[enemyId]) throw new Error(`ghost foe: unknown enemy id "${enemyId}"`);
}
