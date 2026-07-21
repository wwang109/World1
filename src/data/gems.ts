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
    // poison 4 stacks = 4×5 = 20 deci = Common exactly (ticks 4,3,2,1 = 10 total).
    actions: [{ kind: 'poison', stacks: 4 }],
    text: 'Also apply {{Poison}} 4 (poison bypasses shields).',
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
  quickening_sliver: {
    // slow +8 weight: floor(8 * 5/2) = 20 deci = Common exactly. (Was a
    // -1 cooldown gem; cooldownPerTurn is now 100 deci, unaffordable at any
    // gem rarity, so the tempo theme lives on as an enemy slow instead.)
    id: 'quickening_sliver',
    name: 'Quickening Sliver',
    kind: 'effect',
    rarity: 'common',
    actions: [{ kind: 'slow', weight: 8 }],
    text: 'Casts also slow the enemy’s next action by +8 weight.',
  },

  // ---- Echo gems (one per skill, weaker versions of the skill's signature
  // effect) — Common band, 20 deci each. Grouped in skillBook order. ----
  sword_slash_echo: {
    // echo of sword_slash
    id: 'sword_slash_echo',
    name: 'Slashing Sliver',
    kind: 'effect',
    rarity: 'common',
    actions: [{ kind: 'damage', power: 4 }],
    text: 'Also deal 4 (+the host card\'s power stat) bonus damage.',
  },
  savage_bite_echo: {
    // echo of savage_bite
    id: 'savage_bite_echo',
    name: 'Feral Echo',
    kind: 'effect',
    rarity: 'common',
    actions: [{ kind: 'damage', power: 4 }],
    text: 'Also deal 4 (+the host card\'s power stat) bonus damage — a fading echo of fang and claw.',
  },
  hunter_shot_echo: {
    // echo of hunter_shot
    id: 'hunter_shot_echo',
    name: "Hunter's Echo",
    kind: 'effect',
    rarity: 'common',
    actions: [{ kind: 'damage', power: 4 }],
    text: 'Also deal 4 (+the host card\'s power stat) bonus damage.',
  },
  arcane_bolt_echo: {
    // echo of arcane_bolt
    id: 'arcane_bolt_echo',
    name: 'Arcane Spark',
    kind: 'effect',
    rarity: 'common',
    actions: [{ kind: 'damage', power: 4 }],
    text: 'Also deal 4 (+the host card\'s power stat) bonus damage.',
  },
  fireball_echo: {
    // echo of fireball
    id: 'fireball_echo',
    name: 'Ember of Fireball',
    kind: 'effect',
    rarity: 'common',
    // burn 4 stacks = 4×5 = 20 deci = Common exactly (ticks 4,3,2,1 = 10 total).
    actions: [{ kind: 'burn', stacks: 4 }],
    text: 'Also apply {{Burn}} 4.',
  },
  venom_fang_echo: {
    // echo of venom_fang
    id: 'venom_fang_echo',
    name: 'Venom Whisper',
    kind: 'effect',
    rarity: 'common',
    // poison 4 stacks = 4×5 = 20 deci = Common exactly (ticks 4,3,2,1 = 10 total).
    actions: [{ kind: 'poison', stacks: 4 }],
    text: 'Also apply {{Poison}} 4 (poison bypasses shields).',
  },
  iron_bulwark_echo: {
    // echo of iron_bulwark
    id: 'iron_bulwark_echo',
    name: 'Iron Sliver',
    kind: 'effect',
    rarity: 'common',
    actions: [{ kind: 'shield', power: 4 }],
    text: 'Also grant a shield worth 4 (+the host card\'s power stat).',
  },
  mana_ward_echo: {
    // echo of mana_ward
    id: 'mana_ward_echo',
    name: 'Mana Sliver',
    kind: 'effect',
    rarity: 'common',
    actions: [{ kind: 'shield', power: 4 }],
    text: 'Also grant a shield worth 4 (+the host card\'s power stat).',
  },
  mending_light_echo: {
    // echo of mending_light
    id: 'mending_light_echo',
    name: 'Mending Spark',
    kind: 'effect',
    rarity: 'common',
    actions: [{ kind: 'heal', power: 4 }],
    text: 'Also restore 4 (+the host card\'s power stat) bonus health.',
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
    actions: [{ kind: 'slow', weight: 8 }],
    text: "Also {{Slow}} the enemy's next action by +8 weight.",
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
    // echo of concussive_shot. disrupt re-priced to 1 PL per 4 drained:
    // floor(8 * 5/2) = 20 deci = Common exactly (was amount 16 at 1-per-8).
    id: 'concussive_shot_echo',
    name: 'Concussive Whisper',
    kind: 'effect',
    rarity: 'common',
    actions: [{ kind: 'disrupt', amount: 8 }],
    text: "Also {{Disrupt}} 8 banked readiness from the enemy.",
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
    actions: [{ kind: 'damage', power: 4 }],
    text: 'Also deal 4 (+the host card\'s power stat) bonus damage.',
  },
  purify_echo: {
    // echo of purify
    id: 'purify_echo',
    name: 'Purifying Ward',
    kind: 'effect',
    rarity: 'common',
    actions: [{ kind: 'guard', property: 'true', pct: 20, turns: 1 }],
    text: 'Also reduce incoming damage of all types by 20% for 1 turn.',
  },

  // ---- Rare (4 PL / 40 deci) ----
  stunning_shard: {
    // Re-themed from stun -> slow: at the re-priced stunPerTurn (100 deci)
    // a 1-turn stun is 10 PL, above every gem rarity band, so no stun gem can
    // exist. slow 16 (floor(16*5/2) = 40) = Rare exactly keeps a tempo-denial
    // theme. (id kept — referenced by src/game/demoState.ts.)
    id: 'stunning_shard',
    name: 'Hobbling Shard',
    kind: 'effect',
    rarity: 'rare',
    actions: [{ kind: 'slow', weight: 16 }],
    text: "Also {{Slow}} the enemy's next action by +16 weight.",
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
  quickening_core: {
    // slow +16 weight: floor(16 * 5/2) = 40 deci = Rare exactly.
    id: 'quickening_core',
    name: 'Quickening Core',
    kind: 'effect',
    rarity: 'rare',
    actions: [{ kind: 'slow', weight: 16 }],
    text: 'Casts also slow the enemy’s next action by +16 weight.',
  },

  // ---- Rare echo gems (40 deci each) ----
  rending_claws_echo: {
    // echo of rending_claws
    id: 'rending_claws_echo',
    name: 'Rending Sliver',
    kind: 'effect',
    rarity: 'rare',
    actions: [{ kind: 'damage', power: 8 }],
    text: 'Also deal 8 (+the host card\'s power stat) bonus damage.',
  },
  crushing_blow_echo: {
    // echo of crushing_blow
    id: 'crushing_blow_echo',
    name: 'Crushing Sliver',
    kind: 'effect',
    rarity: 'rare',
    actions: [{ kind: 'damage', power: 8 }],
    text: 'Also deal 8 (+the host card\'s power stat) bonus damage.',
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
    // guard re-priced to parity (1x): 20*2*1 = 40 deci = Rare exactly (was pct 16).
    actions: [{ kind: 'guard', property: 'magical', pct: 20, turns: 2 }],
    text: 'Also reduce incoming magical damage by 20% for 2 turns.',
  },
  ward_of_silence_echo: {
    // echo of ward_of_silence
    id: 'ward_of_silence_echo',
    name: "Silencer's Echo",
    kind: 'effect',
    rarity: 'rare',
    // guard re-priced to parity (1x): 40*1*1 = 40 deci = Rare exactly (was pct 32).
    actions: [{ kind: 'guard', property: 'magical', pct: 40, turns: 1 }],
    text: 'Also reduce incoming magical damage by 40% for 1 turn.',
  },
  second_wind_echo: {
    // echo of second_wind
    id: 'second_wind_echo',
    name: 'Second Breath',
    kind: 'effect',
    rarity: 'rare',
    actions: [{ kind: 'heal', power: 8 }],
    text: 'Also restore 8 (+the host card\'s power stat) bonus health.',
  },
  war_banner_echo: {
    // echo of war_banner
    id: 'war_banner_echo',
    name: 'Banner Fragment',
    kind: 'stat',
    rarity: 'rare',
    scope: 'card',
    mods: { card: { damageFlat: 2 } },
    text: '+2 damage on this card.',
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
    actions: [{ kind: 'comboBonus', amount: 8 }],
    text: 'Also +8 damage if your previous cast shared an archetype with this card.',
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
    // echo of stunning_smash. Re-themed stun -> slow for the same reason as
    // stunning_shard (a 1-turn stun is 10 PL now, above every gem band).
    // slow 16 (floor(16*5/2) = 40) = Rare exactly.
    id: 'stunning_smash_echo',
    name: 'Sundering Echo',
    kind: 'effect',
    rarity: 'rare',
    actions: [{ kind: 'slow', weight: 16 }],
    text: "Also {{Slow}} the enemy's next action by +16 weight.",
  },
  purging_strike_echo: {
    // echo of purging_strike
    id: 'purging_strike_echo',
    name: 'Purging Sliver',
    kind: 'effect',
    rarity: 'rare',
    actions: [{ kind: 'damage', power: 8 }],
    text: 'Also deal 8 (+the host card\'s power stat) bonus damage.',
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
    mods: { card: { damageFlat: 3 } },
    text: '+3 damage on this card.',
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
    actions: [{ kind: 'shield', power: 12 }],
    text: 'Also grant a shield worth 12 (+the host card\'s power stat).',
  },

  // ---- Legendary (8 PL / 80 deci) ----
  concussive_shard: {
    // Re-themed stun -> slow (a 2-turn stun is 20 PL now, far above every
    // gem band). slow 32 (floor(32*5/2) = 80) = Legendary exactly.
    // (id kept — referenced by src/game/demoState.ts.)
    id: 'concussive_shard',
    name: 'Concussive Shard',
    kind: 'effect',
    rarity: 'legendary',
    actions: [{ kind: 'slow', weight: 32 }],
    text: "Also {{Slow}} the enemy's next action by +32 weight.",
  },
  restorative_core: {
    id: 'restorative_core',
    name: 'Restorative Core',
    kind: 'stat',
    rarity: 'legendary',
    scope: 'card',
    mods: { card: { healFlat: 4 } },
    text: '+4 healing on this card.',
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
    actions: [{ kind: 'damage', power: 16 }],
    text: 'Also deal 16 (+the host card\'s power stat) bonus damage.',
  },
};
