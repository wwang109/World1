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
    // poison priced LINEARLY per stack (2026-07-23): 2 stacks × 10 deci = 20
    // deci = Common exactly (ticks 2,1 = 3 total).
    actions: [{ kind: 'poison', stacks: 2 }],
    text: 'Also apply {{Poison}} 2 (poison bypasses shields).',
  },
  swift_charm: {
    id: 'swift_charm',
    name: 'Swift Charm',
    kind: 'stat',
    rarity: 'common',
    scope: 'hero',
    mods: { hero: { speed: 4 } },
    text: 'Passive: hero +4 SPD.',
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
    text: "Also {{Slow}} the enemy's next action by +8 weight.",
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
    text: 'Also +4 damage (+ATK/MATK).',
  },
  savage_bite_echo: {
    // echo of savage_bite
    id: 'savage_bite_echo',
    name: 'Feral Echo',
    kind: 'effect',
    rarity: 'common',
    actions: [{ kind: 'damage', power: 4 }],
    text: 'Also +4 damage (+ATK/MATK).',
  },
  hunter_shot_echo: {
    // echo of hunter_shot
    id: 'hunter_shot_echo',
    name: "Hunter's Echo",
    kind: 'effect',
    rarity: 'common',
    actions: [{ kind: 'damage', power: 4 }],
    text: 'Also +4 damage (+ATK/MATK).',
  },
  arcane_bolt_echo: {
    // echo of arcane_bolt
    id: 'arcane_bolt_echo',
    name: 'Arcane Spark',
    kind: 'effect',
    rarity: 'common',
    actions: [{ kind: 'damage', power: 4 }],
    text: 'Also +4 damage (+ATK/MATK).',
  },
  fireball_echo: {
    // echo of fireball
    id: 'fireball_echo',
    name: 'Ember of Fireball',
    kind: 'effect',
    rarity: 'common',
    // burn priced LINEARLY per stack (2026-07-23): 2 stacks × 10 deci = 20
    // deci = Common exactly (ticks 4,2 = 6 total).
    actions: [{ kind: 'burn', stacks: 2 }],
    text: 'Also apply {{Burn}} 2.',
  },
  venom_fang_echo: {
    // echo of venom_fang
    id: 'venom_fang_echo',
    name: 'Venom Whisper',
    kind: 'effect',
    rarity: 'common',
    // poison priced LINEARLY per stack (2026-07-23): 2 stacks × 10 deci = 20
    // deci = Common exactly (ticks 2,1 = 3 total).
    actions: [{ kind: 'poison', stacks: 2 }],
    text: 'Also apply {{Poison}} 2 (poison bypasses shields).',
  },
  iron_bulwark_echo: {
    // echo of iron_bulwark
    id: 'iron_bulwark_echo',
    name: 'Iron Sliver',
    kind: 'effect',
    rarity: 'common',
    actions: [{ kind: 'shield', power: 4 }],
    text: 'Also +4 shield (+DEF/MDEF).',
  },
  mana_ward_echo: {
    // echo of mana_ward
    id: 'mana_ward_echo',
    name: 'Mana Sliver',
    kind: 'effect',
    rarity: 'common',
    actions: [{ kind: 'shield', power: 4 }],
    text: 'Also +4 shield (+DEF/MDEF).',
  },
  mending_light_echo: {
    // echo of mending_light
    id: 'mending_light_echo',
    name: 'Mending Spark',
    kind: 'effect',
    rarity: 'common',
    actions: [{ kind: 'heal', power: 4 }],
    text: 'Also +4 HP (+DEF/MDEF).',
  },
  time_crystal_echo: {
    // echo of time_crystal
    id: 'time_crystal_echo',
    name: 'Time Sliver',
    kind: 'stat',
    rarity: 'common',
    scope: 'card',
    mods: { card: { weightDelta: -1 } },
    text: 'Passive: this card -1 weight (casts sooner).',
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
    text: 'Also {{Lifesteal}} 30% of damage dealt.',
  },
  shield_splitter_echo: {
    // echo of shield_splitter
    id: 'shield_splitter_echo',
    name: "Splitter's Echo",
    kind: 'effect',
    rarity: 'common',
    actions: [{ kind: 'shieldBreak', amount: 16 }],
    text: 'Also {{Shatter}} 16 enemy shield.',
  },
  concussive_shot_echo: {
    // echo of concussive_shot. disrupt re-priced to the escalating bracket
    // schedule (user-locked 2026-07-25, PRICE.disruptBrackets): the Common
    // band (20 deci) only affords 4 points at the entry 5-deci/point rate
    // (4*5 = 20 = Common exactly) — was amount 8 at the old flat rate.
    id: 'concussive_shot_echo',
    name: 'Concussive Whisper',
    kind: 'effect',
    rarity: 'common',
    actions: [{ kind: 'disrupt', amount: 4 }],
    text: 'Also {{Disrupt}} 4 banked readiness.',
  },
  armor_break_echo: {
    // echo of armor_break
    id: 'armor_break_echo',
    name: 'Armor Chip',
    kind: 'effect',
    rarity: 'common',
    actions: [{ kind: 'debuffStat', stat: 'armor', pct: 10, turns: 2 }],
    text: 'Also -10% enemy DEF (2 turns).',
  },
  slow_hex_echo: {
    // echo of slow_hex
    id: 'slow_hex_echo',
    name: 'Slowing Whisper',
    kind: 'effect',
    rarity: 'common',
    actions: [{ kind: 'debuffStat', stat: 'speed', pct: 10, turns: 2 }],
    text: 'Also -10% enemy SPD (2 turns).',
  },
  judgment_light_echo: {
    // echo of judgment_light
    id: 'judgment_light_echo',
    name: 'Judgment Spark',
    kind: 'effect',
    rarity: 'common',
    actions: [{ kind: 'debuffStat', stat: 'magicResist', pct: 10, turns: 2 }],
    text: 'Also -10% enemy MDEF (2 turns).',
  },
  shadow_bolt_echo: {
    // echo of shadow_bolt
    id: 'shadow_bolt_echo',
    name: 'Shadow Spark',
    kind: 'effect',
    rarity: 'common',
    actions: [{ kind: 'damage', power: 4 }],
    text: 'Also +4 damage (+ATK/MATK).',
  },
  purify_echo: {
    // echo of purify
    id: 'purify_echo',
    name: 'Purifying Ward',
    kind: 'effect',
    rarity: 'common',
    actions: [{ kind: 'guard', property: 'true', pct: 20, turns: 1 }],
    text: 'Also -20% incoming TRUE damage (1 turn).',
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
    text: 'Passive: this card -2 weight (casts sooner).',
  },
  brawlers_core: {
    // Re-fit for the 2026-07-25 heroStatPerPoint.attack repricing (8 -> 10
    // deci/pt, see PRICE.heroStatPerPoint): 4 * 10 = 40 deci = Rare exactly
    // (was attack 5 at the old 8/pt rate).
    id: 'brawlers_core',
    name: "Brawler's Core",
    kind: 'stat',
    rarity: 'rare',
    scope: 'hero',
    mods: { hero: { attack: 4 } },
    text: 'Passive: hero +4 ATK.',
  },
  quickening_core: {
    // slow +16 weight: floor(16 * 5/2) = 40 deci = Rare exactly.
    id: 'quickening_core',
    name: 'Quickening Core',
    kind: 'effect',
    rarity: 'rare',
    actions: [{ kind: 'slow', weight: 16 }],
    text: "Also {{Slow}} the enemy's next action by +16 weight.",
  },

  // ---- Rare echo gems (40 deci each) ----
  rending_claws_echo: {
    // echo of rending_claws
    id: 'rending_claws_echo',
    name: 'Rending Sliver',
    kind: 'effect',
    rarity: 'rare',
    actions: [{ kind: 'damage', power: 8 }],
    text: 'Also +8 damage (+ATK/MATK).',
  },
  crushing_blow_echo: {
    // echo of crushing_blow
    id: 'crushing_blow_echo',
    name: 'Crushing Sliver',
    kind: 'effect',
    rarity: 'rare',
    actions: [{ kind: 'damage', power: 8 }],
    text: 'Also +8 damage (+ATK/MATK).',
  },
  crippling_strike_echo: {
    // echo of crippling_strike
    id: 'crippling_strike_echo',
    name: 'Crippling Whisper',
    kind: 'effect',
    rarity: 'rare',
    actions: [{ kind: 'debuffStat', stat: 'attack', pct: 20, turns: 2 }],
    text: 'Also -20% enemy ATK (2 turns).',
  },
  frost_ward_echo: {
    // echo of frost_ward
    id: 'frost_ward_echo',
    name: 'Frosty Echo',
    kind: 'effect',
    rarity: 'rare',
    // guard re-priced to parity (1x): 20*2*1 = 40 deci = Rare exactly (was pct 16).
    actions: [{ kind: 'guard', property: 'magical', pct: 20, turns: 2 }],
    text: 'Also -20% incoming magical damage (2 turns).',
  },
  ward_of_silence_echo: {
    // echo of ward_of_silence
    id: 'ward_of_silence_echo',
    name: "Silencer's Echo",
    kind: 'effect',
    rarity: 'rare',
    // guard re-priced to parity (1x): 40*1*1 = 40 deci = Rare exactly (was pct 32).
    actions: [{ kind: 'guard', property: 'magical', pct: 40, turns: 1 }],
    text: 'Also -40% incoming magical damage (1 turn).',
  },
  second_wind_echo: {
    // echo of second_wind
    id: 'second_wind_echo',
    name: 'Second Breath',
    kind: 'effect',
    rarity: 'rare',
    actions: [{ kind: 'heal', power: 8 }],
    text: 'Also +8 HP (+DEF/MDEF).',
  },
  war_banner_echo: {
    // echo of war_banner
    id: 'war_banner_echo',
    name: 'Banner Fragment',
    kind: 'stat',
    rarity: 'rare',
    scope: 'card',
    mods: { card: { damageFlat: 4 } },
    text: 'Passive: this card +4 damage.',
  },
  battle_howl_echo: {
    // echo of battle_howl
    id: 'battle_howl_echo',
    name: 'Battle Whisper',
    kind: 'effect',
    rarity: 'rare',
    actions: [{ kind: 'buffStat', stat: 'attack', pct: 20, turns: 2 }],
    text: 'Also +20% ATK (2 turns).',
  },
  follow_through_echo: {
    // echo of follow_through. Re-fit for the 2026-07-23 comboPerPoint cut
    // (2.5/pt): floor(16*5/2) = 40 = Rare exactly (was amount 8 at the old 5/pt rate).
    id: 'follow_through_echo',
    name: 'Follow-Through Echo',
    kind: 'effect',
    rarity: 'rare',
    actions: [{ kind: 'comboBonus', amount: 16 }],
    text: 'Also {{Combo}} +16 damage (previous cast shared an archetype).',
  },
  hex_of_frailty_echo: {
    // echo of hex_of_frailty
    id: 'hex_of_frailty_echo',
    name: 'Frailty Whisper',
    kind: 'effect',
    rarity: 'rare',
    actions: [{ kind: 'debuffStat', stat: 'magicResist', pct: 20, turns: 2 }],
    text: 'Also -20% enemy MDEF (2 turns).',
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
    text: 'Also +8 damage (+ATK/MATK).',
  },

  // ---- Epic (6 PL / 60 deci) ----
  enfeebling_shard: {
    id: 'enfeebling_shard',
    name: 'Enfeebling Shard',
    kind: 'effect',
    rarity: 'epic',
    actions: [{ kind: 'debuffStat', stat: 'armor', pct: 30, turns: 2 }],
    text: 'Also -30% enemy DEF (2 turns).',
  },
  empowering_core: {
    id: 'empowering_core',
    name: 'Empowering Core',
    kind: 'stat',
    rarity: 'epic',
    scope: 'card',
    mods: { card: { damageFlat: 6 } },
    text: 'Passive: this card +6 damage.',
  },
  bulwark_core: {
    id: 'bulwark_core',
    name: 'Bulwark Core',
    kind: 'stat',
    rarity: 'epic',
    scope: 'hero',
    mods: { hero: { armor: 6 } },
    text: 'Passive: hero +6 DEF.',
  },

  // ---- Epic echo gem (60 deci) ----
  prism_barrier_echo: {
    // echo of prism_barrier
    id: 'prism_barrier_echo',
    name: 'Prism Shard',
    kind: 'effect',
    rarity: 'epic',
    actions: [{ kind: 'shield', power: 12 }],
    text: 'Also +12 shield (+DEF/MDEF).',
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
    mods: { card: { healFlat: 8 } },
    text: 'Passive: this card +8 HP.',
  },
  archmages_core: {
    // Re-fit for the 2026-07-25 heroStatPerPoint.magicPower repricing (8 -> 10
    // deci/pt, see PRICE.heroStatPerPoint): 8 * 10 = 80 deci = Legendary
    // exactly (was magicPower 10 at the old 8/pt rate).
    id: 'archmages_core',
    name: "Archmage's Core",
    kind: 'stat',
    rarity: 'legendary',
    scope: 'hero',
    mods: { hero: { magicPower: 8 } },
    text: 'Passive: hero +8 MATK.',
  },

  // ---- Legendary echo gem (80 deci) ----
  soul_rend_echo: {
    // echo of soul_rend
    id: 'soul_rend_echo',
    name: 'Soul Echo',
    kind: 'effect',
    rarity: 'legendary',
    actions: [{ kind: 'damage', power: 16 }],
    text: 'Also +16 damage (+ATK/MATK).',
  },
};

