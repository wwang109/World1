import type { EnemyDef } from '../engine/types';

// Demo enemy presets (depth-1 stats; the run layer will scale by depth later).
// HP pools sized for the PL-balanced Bronze card set.
export const enemies: Record<string, EnemyDef> = {
  giant_rat: {
    id: 'giant_rat',
    name: 'Giant Rat',
    baseDepth: 1,
    stats: { maxHp: 90, hp: 90, attack: 9, magicPower: 0, armor: 0, magicResist: 0, speed: 13, critPct: 5 },
    weaponAffinity: 'beast',
    boardSize: 6,
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
    stats: { maxHp: 150, hp: 150, attack: 8, magicPower: 0, armor: 5, magicResist: 1, speed: 7, critPct: 0, resolve: 25 },
    elementAffinity: 'nature',
    weaponAffinity: 'beast',
    boardSize: 6,
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
    stats: { maxHp: 140, hp: 140, attack: 13, magicPower: 0, armor: 2, magicResist: 1, speed: 12, critPct: 20 },
    weaponAffinity: 'sword',
    boardSize: 7,
    pieces: [
      { skillId: 'war_banner', slot: 0 },
      { skillId: 'sword_slash', slot: 1 },
      { skillId: 'crippling_strike', slot: 2 },
    ],
    goldReward: 30,
    xpReward: 20,
  },
  // ---- Tactic checks: elites whose KITS demand an answer (no new rules) ----
  runewall_sentinel: {
    id: 'runewall_sentinel',
    name: 'Runewall Sentinel',
    baseDepth: 1,
    isElite: true,
    // The turtle check: cycles typed shields behind high armor and resolve.
    // Answer: poison (bypasses shields), Shield Splitter, or true damage.
    stats: { maxHp: 180, hp: 180, attack: 12, magicPower: 8, armor: 6, magicResist: 4, speed: 10, critPct: 0, resolve: 25 },
    boardSize: 7,
    pieces: [
      { skillId: 'iron_bulwark', slot: 0 },
      { skillId: 'sword_slash', slot: 2 },
      { skillId: 'mana_ward', slot: 3 },
    ],
    weaponAffinity: 'sword',
    goldReward: 35,
    xpReward: 22,
  },
  feral_alpha: {
    id: 'feral_alpha',
    name: 'Feral Alpha',
    baseDepth: 1,
    isElite: true,
    // The buff-stacker check: howls then hits hard with varied fangs.
    // Answer: purge (Dispelling Arrow) or the bow matchup vs beast.
    stats: { maxHp: 150, hp: 150, attack: 13, magicPower: 0, armor: 1, magicResist: 1, speed: 14, critPct: 10 },
    boardSize: 7,
    pieces: [
      { skillId: 'battle_howl', slot: 0 },
      { skillId: 'savage_bite', slot: 1 },
      { skillId: 'venom_fang', slot: 2 },
      { skillId: 'leeching_fang', slot: 3 },
    ],
    weaponAffinity: 'beast',
    goldReward: 35,
    xpReward: 22,
  },
  grave_chanter: {
    id: 'grave_chanter',
    name: 'Grave Chanter',
    baseDepth: 1,
    isElite: true,
    // The healer check: out-heals slow chip damage behind hexes.
    // Answer: burst windows (execute), stuns to eat the heal, or heavy alpha.
    stats: { maxHp: 170, hp: 170, attack: 4, magicPower: 15, armor: 4, magicResist: 6, speed: 12, critPct: 0 },
    boardSize: 7,
    pieces: [
      { skillId: 'hex_of_frailty', slot: 0 },
      { skillId: 'mending_light', slot: 1 },
      { skillId: 'arcane_bolt', slot: 3 },
      { skillId: 'slow_hex', slot: 4 },
    ],
    elementAffinity: 'dark',
    goldReward: 35,
    xpReward: 22,
  },
  spellward_wraith: {
    id: 'spellward_wraith',
    name: 'Spellward Wraith',
    baseDepth: 1,
    isElite: true,
    // The anti-magic check: massive Magic Resist, no armor, and it fights
    // back with magic. Answer: physical decks (or true damage); mage boards
    // bounce off. Dark affinity — a future holy damage card will feast.
    stats: { maxHp: 150, hp: 150, attack: 0, magicPower: 13, armor: 0, magicResist: 9, speed: 12, critPct: 0 },
    boardSize: 7,
    pieces: [
      { skillId: 'numbing_chill', slot: 0 },
      { skillId: 'arcane_bolt', slot: 1 },
      { skillId: 'hex_of_frailty', slot: 2 },
      { skillId: 'mana_ward', slot: 3 },
    ],
    elementAffinity: 'dark',
    goldReward: 35,
    xpReward: 22,
  },
  twinblade_marauder: {
    id: 'twinblade_marauder',
    name: 'Twinblade Marauder',
    baseDepth: 1,
    isElite: true,
    // The mixed-damage check: swings steel AND slings fire, so one typed
    // shield or one defense stat never walls it. Answer: layered defenses,
    // true shields, or out-racing it.
    stats: { maxHp: 140, hp: 140, attack: 10, magicPower: 10, armor: 3, magicResist: 3, speed: 12, critPct: 10 },
    boardSize: 7,
    pieces: [
      { skillId: 'sword_slash', slot: 0 },
      { skillId: 'fireball', slot: 1 },
      { skillId: 'hunter_shot', slot: 3 },
      { skillId: 'arcane_bolt', slot: 4 },
    ],
    weaponAffinity: 'sword',
    elementAffinity: 'fire',
    goldReward: 35,
    xpReward: 22,
  },
  wolf_king: {
    id: 'wolf_king',
    name: 'The Wolf King',
    baseDepth: 1,
    isBoss: true,
    stats: { maxHp: 280, hp: 280, attack: 15, magicPower: 0, armor: 3, magicResist: 2, speed: 13, critPct: 10, resolve: 15 },
    weaponAffinity: 'beast',
    boardSize: 8,
    pieces: [
      { skillId: 'battle_howl', slot: 0 },
      { skillId: 'rending_claws', slot: 1 },
      { skillId: 'venom_fang', slot: 4 },
      { skillId: 'savage_bite', slot: 5 },
    ],
    goldReward: 60,
    xpReward: 40,
  },
};
