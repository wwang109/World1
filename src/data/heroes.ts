import type { CombatantStats } from '../engine/types';

/**
 * There are no classes: every hero starts from the same base. Identity comes
 * from the drafted board, gear, and where stat points go on level-up.
 *
 * UNIFIED STAT SYSTEM (locked 2026-07-24): the hero and every monster share
 * the SAME universal Level-1 floor statline — no bespoke starting bonus for
 * either side. All identity now comes from the board/cards and from how
 * level-up PL gets spent (see `src/run/leveling.ts`), not from the floor.
 */
export const BASE_HERO_STATS: CombatantStats = {
  maxHp: 100,
  hp: 100,
  attack: 1,
  magicPower: 1,
  armor: 1,
  magicResist: 1,
  speed: 10,
};

export const HERO_BOARD_SLOTS = 10;
