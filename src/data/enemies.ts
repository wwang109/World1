import type { EnemyDef } from '../engine/types';

// Base (depth-1) enemy definitions. The run layer scales stats and rewards
// with zone depth at combat setup time.
export const enemies: Record<string, EnemyDef> = {
  giant_rat: {
    id: 'giant_rat',
    name: 'Giant Rat',
    baseDepth: 1,
    stats: { maxHp: 55, hp: 55, atk: 8, def: 0, speed: 12, critPct: 5 },
    boardSize: 6,
    pieces: [
      { skillId: 'strike', slot: 0 },
      { skillId: 'venom_strike', slot: 1 },
    ],
    goldReward: 12,
    xpReward: 8,
  },
  goblin_thug: {
    id: 'goblin_thug',
    name: 'Goblin Thug',
    baseDepth: 1,
    stats: { maxHp: 70, hp: 70, atk: 10, def: 1, speed: 9, critPct: 5 },
    boardSize: 6,
    pieces: [
      { skillId: 'heavy_blow', slot: 0 },
      { skillId: 'strike', slot: 2 },
    ],
    goldReward: 15,
    xpReward: 10,
  },
  stone_beetle: {
    id: 'stone_beetle',
    name: 'Stone Beetle',
    baseDepth: 1,
    stats: { maxHp: 90, hp: 90, atk: 7, def: 4, speed: 6, critPct: 0 },
    boardSize: 6,
    pieces: [
      { skillId: 'guard', slot: 0 },
      { skillId: 'strike', slot: 1 },
    ],
    goldReward: 15,
    xpReward: 10,
  },
  swamp_shaman: {
    id: 'swamp_shaman',
    name: 'Swamp Shaman',
    baseDepth: 1,
    stats: { maxHp: 60, hp: 60, atk: 11, def: 0, speed: 8, critPct: 5 },
    boardSize: 6,
    pieces: [
      { skillId: 'frost_bolt', slot: 0 },
      { skillId: 'mend', slot: 1 },
      { skillId: 'strike', slot: 3 },
    ],
    goldReward: 18,
    xpReward: 12,
  },
  ember_imp: {
    id: 'ember_imp',
    name: 'Ember Imp',
    baseDepth: 1,
    stats: { maxHp: 50, hp: 50, atk: 12, def: 0, speed: 11, critPct: 10 },
    boardSize: 6,
    pieces: [
      { skillId: 'fireball', slot: 0 },
      { skillId: 'strike', slot: 2 },
    ],
    goldReward: 18,
    xpReward: 12,
  },
  bandit_duelist: {
    id: 'bandit_duelist',
    name: 'Bandit Duelist',
    baseDepth: 1,
    isElite: true,
    stats: { maxHp: 85, hp: 85, atk: 12, def: 1, speed: 11, critPct: 20 },
    boardSize: 6,
    pieces: [
      { skillId: 'whetstone', slot: 0 },
      { skillId: 'heavy_blow', slot: 1 },
      { skillId: 'strike', slot: 3 },
    ],
    goldReward: 30,
    xpReward: 20,
  },
  wolf_king: {
    id: 'wolf_king',
    name: 'The Wolf King',
    baseDepth: 1,
    isBoss: true,
    stats: { maxHp: 170, hp: 170, atk: 14, def: 2, speed: 12, critPct: 10 },
    boardSize: 8,
    pieces: [
      { skillId: 'war_cry', slot: 0 },
      { skillId: 'heavy_blow', slot: 2 },
      { skillId: 'venom_strike', slot: 4 },
      { skillId: 'strike', slot: 5 },
    ],
    goldReward: 60,
    xpReward: 40,
  },
};
