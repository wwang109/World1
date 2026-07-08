import type { EnemyDef } from '../engine/types';

// Demo enemy presets (depth-1 stats; the run layer will scale by depth later).
export const enemies: Record<string, EnemyDef> = {
  giant_rat: {
    id: 'giant_rat',
    name: 'Giant Rat',
    baseDepth: 1,
    stats: { maxHp: 60, hp: 60, attack: 9, magicPower: 0, armor: 0, magicResist: 0, speed: 13, critPct: 5 },
    boardSize: 6,
    pieces: [
      { skillId: 'sword_slash', slot: 0 },
      { skillId: 'venom_fang', slot: 1 },
    ],
    goldReward: 12,
    xpReward: 8,
  },
  stone_beetle: {
    id: 'stone_beetle',
    name: 'Stone Beetle',
    baseDepth: 1,
    stats: { maxHp: 95, hp: 95, attack: 8, magicPower: 0, armor: 5, magicResist: 1, speed: 7, critPct: 0 },
    boardSize: 6,
    pieces: [
      { skillId: 'iron_bulwark', slot: 0 },
      { skillId: 'sword_slash', slot: 2 },
    ],
    goldReward: 15,
    xpReward: 10,
  },
  ember_imp: {
    id: 'ember_imp',
    name: 'Ember Imp',
    baseDepth: 1,
    stats: { maxHp: 55, hp: 55, attack: 4, magicPower: 13, armor: 0, magicResist: 3, speed: 11, critPct: 10 },
    boardSize: 6,
    pieces: [
      { skillId: 'fireball', slot: 0 },
      { skillId: 'arcane_bolt', slot: 2 },
    ],
    goldReward: 18,
    xpReward: 12,
  },
  bandit_duelist: {
    id: 'bandit_duelist',
    name: 'Bandit Duelist',
    baseDepth: 1,
    isElite: true,
    stats: { maxHp: 90, hp: 90, attack: 13, magicPower: 0, armor: 2, magicResist: 1, speed: 12, critPct: 20 },
    boardSize: 7,
    pieces: [
      { skillId: 'war_banner', slot: 0 },
      { skillId: 'sword_slash', slot: 2 },
      { skillId: 'crippling_strike', slot: 3 },
    ],
    goldReward: 30,
    xpReward: 20,
  },
  wolf_king: {
    id: 'wolf_king',
    name: 'The Wolf King',
    baseDepth: 1,
    isBoss: true,
    stats: { maxHp: 180, hp: 180, attack: 15, magicPower: 0, armor: 3, magicResist: 2, speed: 13, critPct: 10 },
    boardSize: 8,
    pieces: [
      { skillId: 'battle_howl', slot: 0 },
      { skillId: 'crushing_blow', slot: 2 },
      { skillId: 'venom_fang', slot: 5 },
      { skillId: 'sword_slash', slot: 6 },
    ],
    goldReward: 60,
    xpReward: 40,
  },
};
