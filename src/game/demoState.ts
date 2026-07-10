import type { BoardPiece } from '../engine/types';

/** Mutable demo session state shared between the Prep/Cards/Battle scenes. */
export const demoState = {
  pieces: [
    { skillId: 'war_banner', slot: 0 },
    { skillId: 'sword_slash', slot: 1 },
    { skillId: 'crippling_strike', slot: 2 },
    { skillId: 'iron_bulwark', slot: 4 },
    { skillId: 'second_wind', slot: 6 },
    { skillId: 'arcane_bolt', slot: 7 },
  ] as BoardPiece[],
  /** Backpack (fullBook ids): 10 size-weighted slots; board 10 + backpack 10 = 20 held. */
  inventory: [] as string[],
  /** Enemy party (1-5, formation order = kill order under front-line aggro). */
  enemyIds: ['bandit_duelist'] as string[],
  seed: 1,
};
