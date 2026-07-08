import type { CombatantStats } from '../engine/types';

/**
 * There are no classes: every hero starts from the same base. Identity comes
 * from the drafted board, gear, and where stat points go on level-up.
 */
export const BASE_HERO_STATS: CombatantStats = {
  maxHp: 100,
  hp: 100,
  attack: 12,
  magicPower: 12,
  armor: 2,
  magicResist: 2,
  speed: 12,
  critPct: 10,
};

export const HERO_BOARD_SLOTS = 10;
