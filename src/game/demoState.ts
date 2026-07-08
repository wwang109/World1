import type { BoardPiece } from '../engine/types';

/** Mutable demo session state shared between Prep and Battle scenes. */
export const demoState = {
  pieces: [
    { skillId: 'war_banner', slot: 0 },
    { skillId: 'sword_slash', slot: 1 },
    { skillId: 'crushing_blow', slot: 2 },
    { skillId: 'iron_bulwark', slot: 5 },
    { skillId: 'second_wind', slot: 7 },
  ] as BoardPiece[],
  enemyId: 'giant_rat',
  seed: 1,
};
