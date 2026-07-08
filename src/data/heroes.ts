import type { CombatantStats } from '../engine/types';

/**
 * There are no classes: every hero starts from the same base. Identity comes
 * from the run-start draft and what the player finds along the route.
 */
export const BASE_HERO_STATS: CombatantStats = {
  maxHp: 100,
  hp: 100,
  atk: 12,
  def: 2,
  speed: 10,
  critPct: 10,
};

export const HERO_BOARD_SLOTS = 10;
