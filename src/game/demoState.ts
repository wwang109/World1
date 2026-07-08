import type { BoardPiece } from '../engine/types';

/** Mutable demo session state shared between Prep and Battle scenes. */
export const demoState = {
  pieces: [
    { skillId: 'war_banner', slot: 0 },
    { skillId: 'sword_slash', slot: 1 },
    { skillId: 'crippling_strike', slot: 2 },
    { skillId: 'iron_bulwark', slot: 4 },
    { skillId: 'second_wind', slot: 6 },
    { skillId: 'arcane_bolt', slot: 7 },
  ] as BoardPiece[],
  enemyId: 'bandit_duelist',
  seed: 1,
};
