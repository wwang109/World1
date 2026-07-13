import type { EnemyDef } from '../engine/types';

// Demo enemy presets, authored at a Bronze / lowest-level FLOOR: every card
// here is Bronze, every board is small (2-3 cards, no gems, no tier
// overrides), and every statline is each monster's own modest default — not
// an inflated "elite" or "boss" version. Tier/board/HP difficulty (bigger
// boards, tier-ups, HP/stat multipliers) is a run-layer SCALING concern,
// applied later by depth/level — it is deliberately NOT baked into these
// depth-1 definitions. See docs/enemy-design.md for the full rule. Do NOT
// retune these numbers against simulated fight outcomes — the fight result
// is emergent and depends on the player's own build; that's intended.
//
// `isElite`/`isBoss` are identity/encounter-role tags (used by the run layer
// to place the monster), not stat multipliers — an elite or boss at the
// floor still has a small 2-3 card board and a modest statline; its
// intended extra difficulty comes from future depth-scaling, not from
// hand-inflated numbers here.
export const enemies: Record<string, EnemyDef> = {
  // --- Basic floor: 2-3 Bronze cards, one mechanic each. ---
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

  // --- Elite floor: a balanced human sword-duelist, hero-baseline statline,
  // 2-card basic board (its "elite" encounter role is a run-layer concern). ---
  bandit_duelist: {
    id: 'bandit_duelist',
    name: 'Bandit Duelist',
    baseDepth: 1,
    isElite: true,
    stats: { maxHp: 120, hp: 120, attack: 12, magicPower: 0, armor: 2, magicResist: 1, speed: 12, critPct: 8 },
    weaponAffinity: 'sword',
    boardSize: 2,
    pieces: [
      { skillId: 'sword_slash', slot: 0 },
      { skillId: 'follow_through', slot: 1 },
    ],
    goldReward: 30,
    xpReward: 20,
  },

  // --- Boss floor: a beast, modestly tougher than the basics but not a
  // wall — a bow counter-pick is the intended way in via the weapon
  // triangle. Its "boss" difficulty is future depth-scaling, not baked in
  // here. ---
  wolf_king: {
    id: 'wolf_king',
    name: 'The Wolf King',
    baseDepth: 1,
    isBoss: true,
    stats: { maxHp: 160, hp: 160, attack: 13, magicPower: 0, armor: 2, magicResist: 1, speed: 13, critPct: 8 },
    weaponAffinity: 'beast',
    boardSize: 3,
    pieces: [
      { skillId: 'savage_bite', slot: 0 },
      { skillId: 'venom_fang', slot: 1 },
      { skillId: 'leeching_fang', slot: 2 },
    ],
    goldReward: 60,
    xpReward: 40,
  },

  // --- Signature monster roster: fixed decks, no theme/faction system, each
  // its own recognizable combat identity at the Bronze floor (small 2-3 card
  // board, all Bronze cards, modest default statline). ---
  seraph: {
    id: 'seraph',
    name: 'Seraph',
    baseDepth: 1,
    stats: { maxHp: 110, hp: 110, attack: 0, magicPower: 12, armor: 1, magicResist: 4, speed: 11, critPct: 5 },
    elementAffinity: 'holy',
    boardSize: 3,
    pieces: [
      { skillId: 'mending_light', slot: 0 },
      { skillId: 'judgment_light', slot: 2 },
    ],
    goldReward: 20,
    xpReward: 13,
  },
  knight: {
    id: 'knight',
    name: 'Knight',
    baseDepth: 1,
    stats: { maxHp: 170, hp: 170, attack: 10, magicPower: 0, armor: 6, magicResist: 2, speed: 9, critPct: 5 },
    weaponAffinity: 'sword',
    boardSize: 3,
    pieces: [
      { skillId: 'sword_slash', slot: 0 },
      { skillId: 'iron_bulwark', slot: 1 },
    ],
    goldReward: 22,
    xpReward: 15,
  },
  mage: {
    id: 'mage',
    name: 'Mage',
    baseDepth: 1,
    stats: { maxHp: 80, hp: 80, attack: 0, magicPower: 14, armor: 0, magicResist: 2, speed: 12, critPct: 12 },
    elementAffinity: 'fire',
    boardSize: 3,
    pieces: [
      { skillId: 'fireball', slot: 0 },
      { skillId: 'arcane_bolt', slot: 2 },
    ],
    goldReward: 19,
    xpReward: 13,
  },
  hunter: {
    id: 'hunter',
    name: 'Hunter',
    baseDepth: 1,
    stats: { maxHp: 95, hp: 95, attack: 11, magicPower: 0, armor: 1, magicResist: 1, speed: 15, critPct: 10 },
    weaponAffinity: 'bow',
    boardSize: 2,
    pieces: [
      { skillId: 'hunter_shot', slot: 0 },
      { skillId: 'concussive_shot', slot: 1 },
    ],
    goldReward: 17,
    xpReward: 11,
  },
  rogue: {
    id: 'rogue',
    name: 'Rogue',
    baseDepth: 1,
    stats: { maxHp: 90, hp: 90, attack: 10, magicPower: 0, armor: 0, magicResist: 1, speed: 14, critPct: 18 },
    weaponAffinity: 'beast',
    boardSize: 3,
    pieces: [
      { skillId: 'venom_fang', slot: 0 },
      { skillId: 'crippling_strike', slot: 1 },
    ],
    goldReward: 20,
    xpReward: 13,
  },
  berserker: {
    id: 'berserker',
    name: 'Berserker',
    baseDepth: 1,
    stats: { maxHp: 140, hp: 140, attack: 14, magicPower: 0, armor: 1, magicResist: 0, speed: 10, critPct: 8 },
    weaponAffinity: 'axe',
    boardSize: 4,
    pieces: [
      { skillId: 'crushing_blow', slot: 0 },
      { skillId: 'battle_howl', slot: 3 },
    ],
    goldReward: 24,
    xpReward: 16,
  },
  necromancer: {
    id: 'necromancer',
    name: 'Necromancer',
    baseDepth: 1,
    stats: { maxHp: 90, hp: 90, attack: 0, magicPower: 12, armor: 0, magicResist: 3, speed: 11, critPct: 6 },
    elementAffinity: 'dark',
    boardSize: 2,
    pieces: [
      { skillId: 'hex_of_frailty', slot: 0 },
      { skillId: 'shadow_bolt', slot: 1 },
    ],
    goldReward: 20,
    xpReward: 13,
  },
  cleric: {
    id: 'cleric',
    name: 'Cleric',
    baseDepth: 1,
    stats: { maxHp: 130, hp: 130, attack: 6, magicPower: 9, armor: 2, magicResist: 3, speed: 10, critPct: 5 },
    elementAffinity: 'holy',
    boardSize: 4,
    pieces: [
      { skillId: 'mending_light', slot: 0 },
      { skillId: 'second_wind', slot: 2 },
      { skillId: 'purging_strike', slot: 3 },
    ],
    goldReward: 18,
    xpReward: 12,
  },
};
