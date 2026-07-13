import type { Gem } from '../engine/types';

// Gem catalog, priced with the Power Level system's SOCKET/GEM rules
// (src/engine/balance.ts, docs/power-level-reference.md "Socket / Gem PL
// accounting"). Each gem's OWN PL must land inside its rarity's band
// (±0.5 PL): Common 2 · Rare 4 · Epic 6 · Legendary 8 — checked by
// `isGemOnBudget` (see tests/engine/gemAudit.test.ts). Gem PL is uncapped
// bonus power stacked on top of a card's authored (tier-budgeted) kit; it is
// NEVER folded into the base-card audit.
//
// `GemDef` is display data layered on the engine's structural `Gem` type —
// `name`/`text` aren't consumed by the engine, only by content/UI.
export type GemDef = Gem & { name: string; text: string };

export const gemBook: Record<string, GemDef> = {
  // ---- Common (2 PL / 20 deci) ----
  venom_sliver: {
    id: 'venom_sliver',
    name: 'Venom Sliver',
    kind: 'effect',
    rarity: 'common',
    actions: [{ kind: 'poison', amount: 5, turns: 2 }],
    text: 'Also poison for 5 for 2 turns (poison bypasses shields).',
  },
  keen_edge: {
    id: 'keen_edge',
    name: 'Keen Edge',
    kind: 'stat',
    rarity: 'common',
    scope: 'card',
    mods: { card: { critPctDelta: 4 } },
    text: '+4% Crit Chance on this card.',
  },
  swift_charm: {
    id: 'swift_charm',
    name: 'Swift Charm',
    kind: 'stat',
    rarity: 'common',
    scope: 'hero',
    mods: { hero: { speed: 4 } },
    text: '+4 Speed, permanent.',
  },

  // ---- Echo gems (one per skill, weaker versions of the skill's signature
  // effect) — Common band, 20 deci each. Grouped in skillBook order. ----
  sword_slash_echo: {
    // echo of sword_slash
    id: 'sword_slash_echo',
    name: 'Slashing Sliver',
    kind: 'effect',
    rarity: 'common',
    actions: [{ kind: 'damage', power: 40 }],
    text: 'Also deal 40% bonus damage (scales like the host card).',
  },
  savage_bite_echo: {
    // echo of savage_bite
    id: 'savage_bite_echo',
    name: 'Feral Echo',
    kind: 'effect',
    rarity: 'common',
    actions: [{ kind: 'damage', power: 40 }],
    text: 'Also deal 40% bonus damage — a fading echo of fang and claw (scales like the host card).',
  },
  hunter_shot_echo: {
    // echo of hunter_shot
    id: 'hunter_shot_echo',
    name: "Hunter's Echo",
    kind: 'effect',
    rarity: 'common',
    actions: [{ kind: 'damage', power: 40 }],
    text: 'Also deal 40% bonus damage (scales like the host card).',
  },
  arcane_bolt_echo: {
    // echo of arcane_bolt
    id: 'arcane_bolt_echo',
    name: 'Arcane Spark',
    kind: 'effect',
    rarity: 'common',
    actions: [{ kind: 'damage', power: 40 }],
    text: 'Also deal 40% bonus damage (scales like the host card).',
  },
  fireball_echo: {
    // echo of fireball
    id: 'fireball_echo',
    name: 'Ember of Fireball',
    kind: 'effect',
    rarity: 'common',
    actions: [{ kind: 'burn', amount: 5, turns: 2 }],
    text: 'Also burn for 5 for 2 turns.',
  },
  venom_fang_echo: {
    // echo of venom_fang
    id: 'venom_fang_echo',
    name: 'Venom Whisper',
    kind: 'effect',
    rarity: 'common',
    actions: [{ kind: 'poison', amount: 5, turns: 2 }],
    text: 'Also poison for 5 for 2 turns (poison bypasses shields).',
  },
  iron_bulwark_echo: {
    // echo of iron_bulwark
    id: 'iron_bulwark_echo',
    name: 'Iron Sliver',
    kind: 'effect',
    rarity: 'common',
    actions: [{ kind: 'shield', power: 40 }],
    text: 'Also grant a shield worth 40% bonus (scales like the host card).',
  },
  mana_ward_echo: {
    // echo of mana_ward
    id: 'mana_ward_echo',
    name: 'Mana Sliver',
    kind: 'effect',
    rarity: 'common',
    actions: [{ kind: 'shield', power: 40 }],
    text: 'Also grant a shield worth 40% bonus (scales like the host card).',
  },
  mending_light_echo: {
    // echo of mending_light
    id: 'mending_light_echo',
    name: 'Mending Spark',
    kind: 'effect',
    rarity: 'common',
    actions: [{ kind: 'heal', power: 40 }],
    text: 'Also restore 40% bonus health (scales like the host card).',
  },
  time_crystal_echo: {
    // echo of time_crystal
    id: 'time_crystal_echo',
    name: 'Time Sliver',
    kind: 'stat',
    rarity: 'common',
    scope: 'card',
    mods: { card: { weightDelta: -1 } },
    text: '−1 weight on this card (comes out faster).',
  },
  hamstring_echo: {
    // echo of hamstring
    id: 'hamstring_echo',
    name: 'Hamstring Echo',
    kind: 'effect',
    rarity: 'common',
    actions: [{ kind: 'slowNext', weight: 8 }],
    text: "Also the enemy's next action is +8 weight slower.",
  },
  leeching_fang_echo: {
    // echo of leeching_fang
    id: 'leeching_fang_echo',
    name: 'Leeching Sliver',
    kind: 'effect',
    rarity: 'common',
    actions: [{ kind: 'lifesteal', pct: 30 }],
    text: 'Also heal for 30% of the damage dealt.',
  },
  shield_splitter_echo: {
    // echo of shield_splitter
    id: 'shield_splitter_echo',
    name: "Splitter's Echo",
    kind: 'effect',
    rarity: 'common',
    actions: [{ kind: 'shieldBreak', amount: 16 }],
    text: 'Also shatter up to 16 enemy shield before the hit.',
  },
  concussive_shot_echo: {
    // echo of concussive_shot
    id: 'concussive_shot_echo',
    name: 'Concussive Whisper',
    kind: 'effect',
    rarity: 'common',
    actions: [{ kind: 'stagger', amount: 16 }],
    text: "Also drain 16 from the enemy's banked readiness.",
  },
  armor_break_echo: {
    // echo of armor_break
    id: 'armor_break_echo',
    name: 'Armor Chip',
    kind: 'effect',
    rarity: 'common',
    actions: [{ kind: 'debuffStat', stat: 'armor', pct: 10, turns: 2 }],
    text: "Also reduce the enemy's Armor by 10% for 2 turns.",
  },
  slow_hex_echo: {
    // echo of slow_hex
    id: 'slow_hex_echo',
    name: 'Slowing Whisper',
    kind: 'effect',
    rarity: 'common',
    actions: [{ kind: 'debuffStat', stat: 'speed', pct: 10, turns: 2 }],
    text: "Also reduce the enemy's Speed by 10% for 2 turns.",
  },
  judgment_light_echo: {
    // echo of judgment_light
    id: 'judgment_light_echo',
    name: 'Judgment Spark',
    kind: 'effect',
    rarity: 'common',
    actions: [{ kind: 'debuffStat', stat: 'magicResist', pct: 10, turns: 2 }],
    text: "Also reduce the enemy's Magic Resist by 10% for 2 turns.",
  },
  shadow_bolt_echo: {
    // echo of shadow_bolt
    id: 'shadow_bolt_echo',
    name: 'Shadow Spark',
    kind: 'effect',
    rarity: 'common',
    actions: [{ kind: 'damage', power: 40 }],
    text: 'Also deal 40% bonus damage (scales like the host card).',
  },
  purify_echo: {
    // echo of purify
    id: 'purify_echo',
    name: 'Purifying Ward',
    kind: 'effect',
    rarity: 'common',
    actions: [{ kind: 'guard', property: 'true', pct: 16, turns: 1 }],
    text: 'Also reduce incoming damage of all types by 16% for 1 turn.',
  },

  // ---- Rare (4 PL / 40 deci) ----
  stunning_shard: {
    id: 'stunning_shard',
    name: 'Stunning Shard',
    kind: 'effect',
    rarity: 'rare',
    actions: [{ kind: 'stun', turns: 1 }],
    text: 'Also stun — the enemy\'s next performance is consumed.',
  },
  lightweight_core: {
    id: 'lightweight_core',
    name: 'Lightweight Core',
    kind: 'stat',
    rarity: 'rare',
    scope: 'card',
    mods: { card: { weightDelta: -2 } },
    text: '−2 weight on this card (comes out faster).',
  },
  brawlers_core: {
    id: 'brawlers_core',
    name: "Brawler's Core",
    kind: 'stat',
    rarity: 'rare',
    scope: 'hero',
    mods: { hero: { attack: 5 } },
    text: '+5 Attack, permanent.',
  },

  // ---- Rare echo gems (40 deci each) ----
  rending_claws_echo: {
    // echo of rending_claws
    id: 'rending_claws_echo',
    name: 'Rending Sliver',
    kind: 'effect',
    rarity: 'rare',
    actions: [{ kind: 'damage', power: 80 }],
    text: 'Also deal 80% bonus damage (scales like the host card).',
  },
  crushing_blow_echo: {
    // echo of crushing_blow
    id: 'crushing_blow_echo',
    name: 'Crushing Sliver',
    kind: 'effect',
    rarity: 'rare',
    actions: [{ kind: 'damage', power: 80 }],
    text: 'Also deal 80% bonus damage (scales like the host card).',
  },
  crippling_strike_echo: {
    // echo of crippling_strike
    id: 'crippling_strike_echo',
    name: 'Crippling Whisper',
    kind: 'effect',
    rarity: 'rare',
    actions: [{ kind: 'debuffStat', stat: 'attack', pct: 20, turns: 2 }],
    text: "Also reduce the enemy's Attack by 20% for 2 turns.",
  },
  frost_ward_echo: {
    // echo of frost_ward
    id: 'frost_ward_echo',
    name: 'Frosty Echo',
    kind: 'effect',
    rarity: 'rare',
    actions: [{ kind: 'guard', property: 'magical', pct: 16, turns: 2 }],
    text: 'Also reduce incoming magical damage by 16% for 2 turns.',
  },
  ward_of_silence_echo: {
    // echo of ward_of_silence
    id: 'ward_of_silence_echo',
    name: "Silencer's Echo",
    kind: 'effect',
    rarity: 'rare',
    actions: [{ kind: 'guard', property: 'magical', pct: 32, turns: 1 }],
    text: 'Also reduce incoming magical damage by 32% for 1 turn.',
  },
  second_wind_echo: {
    // echo of second_wind
    id: 'second_wind_echo',
    name: 'Second Breath',
    kind: 'effect',
    rarity: 'rare',
    actions: [{ kind: 'heal', power: 80 }],
    text: 'Also restore 80% bonus health (scales like the host card).',
  },
  war_banner_echo: {
    // echo of war_banner
    id: 'war_banner_echo',
    name: 'Banner Fragment',
    kind: 'stat',
    rarity: 'rare',
    scope: 'card',
    mods: { card: { damagePct: 10 } },
    text: '+10% damage on this card.',
  },
  lucky_charm_echo: {
    // echo of lucky_charm
    id: 'lucky_charm_echo',
    name: 'Lucky Sliver',
    kind: 'stat',
    rarity: 'rare',
    scope: 'card',
    mods: { card: { critPctDelta: 8 } },
    text: '+8% Crit Chance on this card.',
  },
  battle_howl_echo: {
    // echo of battle_howl
    id: 'battle_howl_echo',
    name: 'Battle Whisper',
    kind: 'effect',
    rarity: 'rare',
    actions: [{ kind: 'buffStat', stat: 'attack', pct: 20, turns: 2 }],
    text: 'Also gain +20% Attack for 2 turns.',
  },
  follow_through_echo: {
    // echo of follow_through
    id: 'follow_through_echo',
    name: 'Follow-Through Echo',
    kind: 'effect',
    rarity: 'rare',
    actions: [{ kind: 'comboBonus', pct: 120 }],
    text: 'Also +120% damage if your previous cast shared an archetype with this card.',
  },
  hex_of_frailty_echo: {
    // echo of hex_of_frailty
    id: 'hex_of_frailty_echo',
    name: 'Frailty Whisper',
    kind: 'effect',
    rarity: 'rare',
    actions: [{ kind: 'debuffStat', stat: 'magicResist', pct: 20, turns: 2 }],
    text: "Also reduce the enemy's Magic Resist by 20% for 2 turns.",
  },
  stunning_smash_echo: {
    // echo of stunning_smash
    id: 'stunning_smash_echo',
    name: 'Smash Echo',
    kind: 'effect',
    rarity: 'rare',
    actions: [{ kind: 'stun', turns: 1 }],
    text: "Also stun — the enemy's next performance is consumed.",
  },
  purging_strike_echo: {
    // echo of purging_strike
    id: 'purging_strike_echo',
    name: 'Purging Sliver',
    kind: 'effect',
    rarity: 'rare',
    actions: [{ kind: 'damage', power: 80 }],
    text: 'Also deal 80% bonus damage (scales like the host card).',
  },

  // ---- Epic (6 PL / 60 deci) ----
  enfeebling_shard: {
    id: 'enfeebling_shard',
    name: 'Enfeebling Shard',
    kind: 'effect',
    rarity: 'epic',
    actions: [{ kind: 'debuffStat', stat: 'armor', pct: 30, turns: 2 }],
    text: "Also reduce the enemy's Armor by 30% for 2 turns.",
  },
  empowering_core: {
    id: 'empowering_core',
    name: 'Empowering Core',
    kind: 'stat',
    rarity: 'epic',
    scope: 'card',
    mods: { card: { damagePct: 15 } },
    text: '+15% damage on this card.',
  },
  bulwark_core: {
    id: 'bulwark_core',
    name: 'Bulwark Core',
    kind: 'stat',
    rarity: 'epic',
    scope: 'hero',
    mods: { hero: { armor: 6 } },
    text: '+6 Armor, permanent.',
  },

  // ---- Epic echo gem (60 deci) ----
  prism_barrier_echo: {
    // echo of prism_barrier
    id: 'prism_barrier_echo',
    name: 'Prism Shard',
    kind: 'effect',
    rarity: 'epic',
    actions: [{ kind: 'shield', power: 120 }],
    text: 'Also grant a shield worth 120% bonus (scales like the host card).',
  },

  // ---- Legendary (8 PL / 80 deci) ----
  concussive_shard: {
    id: 'concussive_shard',
    name: 'Concussive Shard',
    kind: 'effect',
    rarity: 'legendary',
    actions: [{ kind: 'stun', turns: 2 }],
    text: "Also stun — the enemy's next 2 performances are consumed.",
  },
  restorative_core: {
    id: 'restorative_core',
    name: 'Restorative Core',
    kind: 'stat',
    rarity: 'legendary',
    scope: 'card',
    mods: { card: { healPct: 20 } },
    text: '+20% healing on this card.',
  },
  archmages_core: {
    id: 'archmages_core',
    name: "Archmage's Core",
    kind: 'stat',
    rarity: 'legendary',
    scope: 'hero',
    mods: { hero: { magicPower: 10 } },
    text: '+10 Magic Power, permanent.',
  },

  // ---- Legendary echo gem (80 deci) ----
  soul_rend_echo: {
    // echo of soul_rend
    id: 'soul_rend_echo',
    name: 'Soul Echo',
    kind: 'effect',
    rarity: 'legendary',
    actions: [{ kind: 'damage', power: 160 }],
    text: 'Also deal 160% bonus damage (scales like the host card).',
  },
};
