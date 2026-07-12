import type { EnemyDef } from '../engine/types';

// Demo enemy presets (depth-1 stats; the run layer will scale by depth later).
//
// Design-by-principle, not by winrate: board PL (10 PL × Bronze card count)
// is set as a multiple of the hero's starter board PL (50 PL = 5 cards), per
// tier. See docs/enemy-design.md for the full rule. Do NOT retune these
// numbers against simulated fight outcomes — the fight result is emergent
// and depends on the player's own build; that's intended.
//
//   Basic  (~0.4x hero board = 20 PL) -> 2 cards, stats at/below hero baseline.
//   Elite  (~1.0x hero board = 50 PL) -> 5 cards, HP ~175, trimmed crit variance.
//   Boss   (~1.4x hero board = 70 PL) -> 7 cards, HP ~250 (partial wall), stats
//          modestly above hero baseline.
export const enemies: Record<string, EnemyDef> = {
  // --- Basic: 2 cards = 20 PL (~0.4x hero board). One mechanic each. ---
  giant_rat: {
    id: 'giant_rat',
    name: 'Giant Rat',
    baseDepth: 1,
    stats: { maxHp: 90, hp: 90, attack: 9, magicPower: 0, armor: 0, magicResist: 0, speed: 13, critPct: 5 },
    weaponAffinity: 'beast',
    boardSize: 2,
    pieces: [
      { skillId: 'savage_bite', slot: 0 },
      { skillId: 'venom_fang', slot: 1 },
    ],
    goldReward: 12,
    xpReward: 8,
  },
  stone_beetle: {
    id: 'stone_beetle',
    name: 'Stone Beetle',
    baseDepth: 1,
    stats: { maxHp: 150, hp: 150, attack: 8, magicPower: 0, armor: 5, magicResist: 1, speed: 7, critPct: 0 },
    elementAffinity: 'nature',
    weaponAffinity: 'beast',
    boardSize: 3,
    pieces: [
      { skillId: 'iron_bulwark', slot: 0 },
      { skillId: 'savage_bite', slot: 2 },
    ],
    goldReward: 15,
    xpReward: 10,
  },
  ember_imp: {
    id: 'ember_imp',
    name: 'Ember Imp',
    baseDepth: 1,
    stats: { maxHp: 85, hp: 85, attack: 4, magicPower: 13, armor: 0, magicResist: 3, speed: 11, critPct: 10 },
    elementAffinity: 'fire',
    boardSize: 3,
    pieces: [
      { skillId: 'fireball', slot: 0 },
      { skillId: 'arcane_bolt', slot: 2 },
    ],
    goldReward: 18,
    xpReward: 12,
  },

  // --- Elite: 5 cards = 50 PL (~1.0x hero board). A scoutable sword-duelist. ---
  bandit_duelist: {
    id: 'bandit_duelist',
    name: 'Bandit Duelist',
    baseDepth: 1,
    isElite: true,
    stats: { maxHp: 175, hp: 175, attack: 14, magicPower: 0, armor: 2, magicResist: 1, speed: 12, critPct: 12 },
    weaponAffinity: 'sword',
    boardSize: 6,
    pieces: [
      { skillId: 'war_banner', slot: 0 },
      { skillId: 'sword_slash', slot: 1 },
      { skillId: 'crippling_strike', slot: 2 },
      { skillId: 'follow_through', slot: 4 },
      { skillId: 'hamstring', slot: 5 },
    ],
    goldReward: 30,
    xpReward: 20,
  },

  // --- Boss: 7 cards = 70 PL (~1.4x hero board). A rich beast board — a
  // fire/bow counter-pick is the intended way in via the weapon/element
  // triangle. ---
  wolf_king: {
    id: 'wolf_king',
    name: 'The Wolf King',
    baseDepth: 1,
    isBoss: true,
    stats: { maxHp: 250, hp: 250, attack: 17, magicPower: 0, armor: 4, magicResist: 3, speed: 14, critPct: 12 },
    weaponAffinity: 'beast',
    boardSize: 9,
    pieces: [
      { skillId: 'battle_howl', slot: 0 },
      { skillId: 'rending_claws', slot: 1 },
      { skillId: 'savage_bite', slot: 4 },
      { skillId: 'venom_fang', slot: 5 },
      { skillId: 'leeching_fang', slot: 6 },
      { skillId: 'lucky_charm', slot: 7 },
      { skillId: 'armor_break', slot: 8 },
    ],
    goldReward: 60,
    xpReward: 40,
  },
};
