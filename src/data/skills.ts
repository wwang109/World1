import type { SkillBook, SkillDef } from '../engine/types';

// Demo card set, balanced with the Power Level system: every card's kit sums
// to its tier budget (Bronze 10 · Silver 15 · Gold 20 · Diamond 25 PL) using
// the price table in src/engine/balance.ts — enforced by the balance audit
// test. All demo cards ship at Bronze; tier-ups add player-chosen +5 PL paths.
//
// power semantics: a FLAT base amount. At cast time the caster's scaling stat
// (physical→Attack, magical→Magic Power, true damage→higher of the two) is
// ADDED flat on top — damage/heal/shield scale linearly, never multiplicatively.
// TRUE heals/shields are pure flat (no stat added).
const defs: SkillDef[] = [
  // ---- Offense ----
  {
    id: 'sword_slash',
    name: 'Sword Slash',
    archetypes: ['offense'],
    property: 'physical',
    size: 1,
    rarity: 'common',
    tier: 'bronze',
    weapon: 'sword',
    effects: [{ kind: 'damage', power: 20 }],
    text: 'Deal Sword damage +20 (+Attack).',
  },
  {
    // Twin-hit showcase: 2 × 6 base (60 deci) + 1 extra-hit premium (30 deci)
    // + weight 8 (light, +10 deci) = exactly Bronze. Each hit adds full
    // Attack; armor mitigates each hit separately.
    id: 'twin_slash',
    name: 'Twin Slash',
    archetypes: ['offense'],
    property: 'physical',
    size: 1,
    rarity: 'common',
    tier: 'bronze',
    weapon: 'sword',
    speedWeight: 8,
    effects: [
      { kind: 'damage', power: 6 },
      { kind: 'damage', power: 6 },
    ],
    text: 'Deal Sword damage +6 (+Attack), twice.',
  },
  {
    id: 'savage_bite',
    name: 'Savage Bite',
    archetypes: ['offense'],
    property: 'physical',
    size: 1,
    rarity: 'common',
    tier: 'bronze',
    weapon: 'beast',
    effects: [{ kind: 'damage', power: 20 }],
    text: 'Deal Beast damage +20 (+Attack).',
  },
  {
    id: 'rending_claws',
    name: 'Rending Claws',
    archetypes: ['offense'],
    property: 'physical',
    size: 3,
    rarity: 'rare',
    tier: 'bronze',
    weapon: 'beast',
    effects: [{ kind: 'damage', power: 96 }],
    text: 'Deal Beast damage +96 (+Attack).',
  },
  {
    id: 'hunter_shot',
    name: "Hunter's Shot",
    archetypes: ['offense'],
    property: 'physical',
    size: 1,
    rarity: 'common',
    tier: 'bronze',
    weapon: 'bow',
    effects: [{ kind: 'damage', power: 20 }],
    text: 'Deal Bow damage +20 (+Attack). Strong vs Beasts.',
  },
  {
    id: 'arcane_bolt',
    name: 'Arcane Bolt',
    archetypes: ['offense'],
    property: 'magical',
    size: 1,
    speedWeight: 8,
    rarity: 'common',
    tier: 'bronze',
    element: 'lightning',
    effects: [{ kind: 'damage', power: 18 }],
    text: 'Deal Lightning damage +18 (+Magic Power).',
  },
  {
    id: 'crushing_blow',
    name: 'Crushing Blow',
    archetypes: ['offense'],
    property: 'physical',
    size: 3,
    rarity: 'rare',
    tier: 'bronze',
    weapon: 'axe',
    effects: [{ kind: 'damage', power: 96 }],
    text: 'Deal Axe damage +96 (+Attack).',
  },
  {
    id: 'fireball',
    name: 'Fireball',
    archetypes: ['offense'],
    property: 'magical',
    size: 2,
    rarity: 'common',
    tier: 'bronze',
    element: 'fire',
    // burn priced LINEARLY per stack (2026-07-23): 5 stacks × 10 deci = 50
    // deci = 5 PL. Tick gameplay unchanged (halves each turn: 10,4,2 = 16
    // total). damage 38 (190) + burn (50) − size2 grant (140) = 100 = Bronze.
    effects: [
      { kind: 'damage', power: 38 },
      { kind: 'burn', stacks: 5 },
    ],
    text: 'Deal Fire damage +38 (+Magic Power) · {{Burn}} 5.',
    // Hand-tuned curve (user-locked 2026-07-24): MODERATE burn growth, rest
    // into damage. Size-2 grants (170/210/240 deci) fold into each tier's
    // effective budget. Silver: burn 7 (70) + damage 50 (250) = 320 = 150 +
    // grant 170. Gold: burn 8 (80) + damage 66 (330) = 410 = 200 + grant 210.
    // Diamond: burn 10 (100) + damage 78 (390) = 490 = 250 + grant 240.
    tierUpgrades: {
      silver: {
        effects: [
          { kind: 'damage', power: 50 },
          { kind: 'burn', stacks: 7 },
        ],
        text: 'Deal Fire damage +50 (+Magic Power) · {{Burn}} 7.',
      },
      gold: {
        effects: [
          { kind: 'damage', power: 66 },
          { kind: 'burn', stacks: 8 },
        ],
        text: 'Deal Fire damage +66 (+Magic Power) · {{Burn}} 8.',
      },
      diamond: {
        effects: [
          { kind: 'damage', power: 78 },
          { kind: 'burn', stacks: 10 },
        ],
        text: 'Deal Fire damage +78 (+Magic Power) · {{Burn}} 10.',
      },
    },
  },
  {
    id: 'soul_rend',
    name: 'Soul Rend',
    archetypes: ['offense'],
    property: 'true',
    element: 'dark',
    size: 2,
    speedWeight: 26,
    rarity: 'epic',
    tier: 'bronze',
    // TRUE damage at 10 deci/pt (half-effect rule): 27 × 10 = 270 =
    // 100 budget + 140 size-2 grant + 30 weight-26 refund.
    effects: [{ kind: 'damage', power: 27 }],
    text: 'Deal TRUE damage +27 (+best stat) — the +27 ignores DEF/MDEF.',
  },

  // ---- Offense + Debuff (multi-archetype) ----
  {
    id: 'crippling_strike',
    name: 'Crippling Strike',
    archetypes: ['offense', 'debuff'],
    property: 'physical',
    size: 2,
    rarity: 'rare',
    tier: 'bronze',
    weapon: 'lance',
    effects: [
      { kind: 'damage', power: 38 },
      { kind: 'debuffStat', stat: 'attack', pct: 25, turns: 2 },
    ],
    text: 'Deal Lance damage +38 (+Attack) · -25% enemy Attack (2 turns).',
  },
  {
    id: 'venom_fang',
    name: 'Venom Fang',
    archetypes: ['offense', 'debuff'],
    property: 'physical',
    size: 1,
    speedWeight: 12,
    rarity: 'common',
    tier: 'bronze',
    weapon: 'beast',
    // poison priced LINEARLY per stack (2026-07-23): 5 stacks × 10 deci = 50
    // deci = 5 PL. Tick gameplay unchanged (decays 5,4,3,2,1 = 15 total).
    // damage 12 (60) + poison (50) + weight +2 refund (−10) = 100 = Bronze.
    effects: [
      { kind: 'damage', power: 12 },
      { kind: 'poison', stacks: 5 },
    ],
    text: 'Deal Beast damage +12 (+Attack) · {{Poison}} 5 (poison bypasses shields).',
    // Hand-tuned curve (user-locked 2026-07-24): MODERATE stack growth, rest
    // into damage; weight stays 12 (−10 deci refund) at every tier.
    // Silver: poison 7 (70) + damage 18 (90) + weight (−10) = 150.
    // Gold:   poison 8 (80) + damage 26 (130) + weight (−10) = 200.
    // Diamond: poison 9 (90) + damage 34 (170) + weight (−10) = 250.
    tierUpgrades: {
      silver: {
        effects: [
          { kind: 'damage', power: 18 },
          { kind: 'poison', stacks: 7 },
        ],
        text: 'Deal Beast damage +18 (+Attack) · {{Poison}} 7 (poison bypasses shields).',
      },
      gold: {
        effects: [
          { kind: 'damage', power: 26 },
          { kind: 'poison', stacks: 8 },
        ],
        text: 'Deal Beast damage +26 (+Attack) · {{Poison}} 8 (poison bypasses shields).',
      },
      diamond: {
        effects: [
          { kind: 'damage', power: 34 },
          { kind: 'poison', stacks: 9 },
        ],
        text: 'Deal Beast damage +34 (+Attack) · {{Poison}} 9 (poison bypasses shields).',
      },
    },
  },

  // ---- Defensive (typed shields) ----
  {
    id: 'iron_bulwark',
    name: 'Iron Bulwark',
    archetypes: ['defensive'],
    property: 'physical',
    weapon: 'sword',
    size: 2,
    rarity: 'common',
    tier: 'bronze',
    effects: [{ kind: 'shield', power: 48 }],
    text: '+48 DEF (+Attack).',
  },
  {
    id: 'mana_ward',
    name: 'Mana Ward',
    archetypes: ['defensive'],
    property: 'magical',
    size: 1,
    rarity: 'common',
    tier: 'bronze',
    element: 'frost',
    effects: [{ kind: 'shield', power: 20 }],
    text: '+20 MDEF (+Magic Power).',
  },
  {
    id: 'prism_barrier',
    name: 'Prism Barrier',
    archetypes: ['defensive'],
    property: 'true',
    element: 'holy',
    size: 3,
    speedWeight: 26,
    rarity: 'epic',
    tier: 'bronze',
    // TRUE shield at 5 deci/pt (typed parity — the premium is the 2:1 drain
    // vs typed damage, not the price): 92 × 5 = 460 =
    // 100 budget + 380 size-3 grant − 20 for weight 26 (4 under baseline).
    effects: [{ kind: 'shield', power: 92 }],
    text: '+92 TRUE shield — blocks TRUE damage fully; physical/magical drain it 2:1.',
  },
  {
    id: 'frost_ward',
    name: 'Frost Ward',
    archetypes: ['defensive'],
    property: 'magical',
    size: 1,
    rarity: 'rare',
    tier: 'bronze',
    element: 'frost',
    // guard re-priced to statPctTurn parity (1x): 50*2*1 = 100 = Bronze exactly
    // (was 40% at the old 1.25x premium). Apply-time clamp is 60%, so 50 is legal.
    effects: [{ kind: 'guard', property: 'magical', pct: 50, turns: 2 }],
    text: '-50% incoming magical damage (2 turns).',
    // Guard is frozen (already at the size-1 empower cap, 100 deci, and near
    // the 60%-apply-time clamp); a magical shield sinks the rest. Silver
    // 10 (50) + 100 = 150. Gold 20 (100) + 100 = 200. Diamond 30 (150) + 100
    // = 250.
    tierUpgrades: {
      silver: {
        effects: [
          { kind: 'guard', property: 'magical', pct: 50, turns: 2 },
          { kind: 'shield', power: 10 },
        ],
        text: '-50% incoming magical damage (2 turns) · +10 MDEF (+Magic Power).',
      },
      gold: {
        effects: [
          { kind: 'guard', property: 'magical', pct: 50, turns: 2 },
          { kind: 'shield', power: 20 },
        ],
        text: '-50% incoming magical damage (2 turns) · +20 MDEF (+Magic Power).',
      },
      diamond: {
        effects: [
          { kind: 'guard', property: 'magical', pct: 50, turns: 2 },
          { kind: 'shield', power: 30 },
        ],
        text: '-50% incoming magical damage (2 turns) · +30 MDEF (+Magic Power).',
      },
    },
  },
  {
    id: 'ward_of_silence',
    name: 'Ward of Silence',
    archetypes: ['defensive'],
    property: 'magical',
    size: 1,
    rarity: 'rare',
    tier: 'bronze',
    element: 'holy',
    // negate re-priced to 100 deci/charge: 1 charge = Bronze exactly (was 2).
    effects: [{ kind: 'negate', property: 'magical', charges: 1 }],
    text: '{{Negate}} the next magical attack.',
    // Negate can't grow to 2 charges (200 deci would blow the size-1 empower
    // cap of 100 alone) — frozen at 1 charge; a magical shield sinks the
    // rest. Silver 10 (50) + 100 = 150. Gold 20 (100) + 100 = 200. Diamond
    // 30 (150) + 100 = 250.
    tierUpgrades: {
      silver: {
        effects: [
          { kind: 'negate', property: 'magical', charges: 1 },
          { kind: 'shield', power: 10 },
        ],
        text: '{{Negate}} the next magical attack · +10 MDEF (+Magic Power).',
      },
      gold: {
        effects: [
          { kind: 'negate', property: 'magical', charges: 1 },
          { kind: 'shield', power: 20 },
        ],
        text: '{{Negate}} the next magical attack · +20 MDEF (+Magic Power).',
      },
      diamond: {
        effects: [
          { kind: 'negate', property: 'magical', charges: 1 },
          { kind: 'shield', power: 30 },
        ],
        text: '{{Negate}} the next magical attack · +30 MDEF (+Magic Power).',
      },
    },
  },

  // ---- Healing ----
  {
    id: 'mending_light',
    name: 'Mending Light',
    archetypes: ['healing'],
    property: 'magical',
    size: 2,
    rarity: 'common',
    tier: 'bronze',
    element: 'holy',
    effects: [{ kind: 'heal', power: 48 }],
    text: '+48 HP (+Magic Power).',
  },
  {
    id: 'second_wind',
    name: 'Second Wind',
    archetypes: ['healing'],
    property: 'true',
    element: 'nature',
    size: 1,
    rarity: 'rare',
    tier: 'bronze',
    effects: [{ kind: 'heal', power: 50 }],
    text: '+50 HP.',
  },

  // ---- Support (passive auras + active buffs) ----
  {
    id: 'war_banner',
    name: 'War Banner',
    archetypes: ['support'],
    property: 'physical',
    weapon: 'sword',
    size: 1,
    rarity: 'rare',
    tier: 'bronze',
    effects: [],
    aura: { affects: 'adjacent', archetypeFilter: 'offense', mods: { damageFlat: 10 } },
    text: 'Passive: adjacent Offense cards deal +10 damage.',
    // Pure aura (no scalable sink) — the aura itself grows: 15/20/25 damageFlat
    // × auraDamageFlat 10 (adjacent reach ×1) = 150/200/250 exactly.
    tierUpgrades: {
      silver: {
        aura: { affects: 'adjacent', archetypeFilter: 'offense', mods: { damageFlat: 15 } },
        text: 'Passive: adjacent Offense cards deal +15 damage.',
      },
      gold: {
        aura: { affects: 'adjacent', archetypeFilter: 'offense', mods: { damageFlat: 20 } },
        text: 'Passive: adjacent Offense cards deal +20 damage.',
      },
      diamond: {
        aura: { affects: 'adjacent', archetypeFilter: 'offense', mods: { damageFlat: 25 } },
        text: 'Passive: adjacent Offense cards deal +25 damage.',
      },
    },
  },
  {
    id: 'time_crystal',
    name: 'Time Crystal',
    archetypes: ['support'],
    property: 'magical',
    size: 1,
    rarity: 'rare',
    tier: 'bronze',
    element: 'nature',
    effects: [],
    aura: { affects: 'adjacent', propertyFilter: 'magical', mods: { weightDelta: -5 } },
    text: 'Passive: adjacent Magical cards -5 weight (cast sooner).',
    // Time theme: the aura's own weight-shave deepens, and a self Speed buff
    // (empower, well under the size-1 100-deci cap) rounds each tier out exact.
    // Silver: |6|*20=120 + 15*2*1=30 = 150. Gold: |8|*20=160 + 20*2*1=40 = 200.
    // Diamond: |10|*20=200 + 25*2*1=50 = 250.
    tierUpgrades: {
      silver: {
        aura: { affects: 'adjacent', propertyFilter: 'magical', mods: { weightDelta: -6 } },
        effects: [{ kind: 'buffStat', stat: 'speed', pct: 15, turns: 2 }],
        text: 'Passive: adjacent Magical cards -6 weight (cast sooner). Self: +15% Speed (2 turns).',
      },
      gold: {
        aura: { affects: 'adjacent', propertyFilter: 'magical', mods: { weightDelta: -8 } },
        effects: [{ kind: 'buffStat', stat: 'speed', pct: 20, turns: 2 }],
        text: 'Passive: adjacent Magical cards -8 weight (cast sooner). Self: +20% Speed (2 turns).',
      },
      diamond: {
        aura: { affects: 'adjacent', propertyFilter: 'magical', mods: { weightDelta: -10 } },
        effects: [{ kind: 'buffStat', stat: 'speed', pct: 25, turns: 2 }],
        text: 'Passive: adjacent Magical cards -10 weight (cast sooner). Self: +25% Speed (2 turns).',
      },
    },
  },
  // NOTE (2026-07-23): 'lucky_charm' was removed here. Its sole effect was an
  // adjacent +Crit aura and crit was excised from the game, leaving it inert /
  // off-budget. Rather than silently rebudget it, the defunct card is dropped;
  // content-designer can ship a fresh, priced support aura in its place.
  {
    id: 'battle_howl',
    name: 'Battle Howl',
    archetypes: ['support'],
    property: 'physical',
    weapon: 'beast',
    size: 1,
    rarity: 'rare',
    tier: 'bronze',
    effects: [{ kind: 'buffStat', stat: 'attack', pct: 50, turns: 2 }],
    text: '+50% Attack (2 turns).',
    // War-cry theme: the +50%/2t buff is frozen (already at the size-1 empower
    // cap, 100 deci); a Beast damage roar sinks the rest. Silver 10 (50) + 100
    // = 150. Gold 20 (100) + 100 = 200. Diamond 30 (150) + 100 = 250.
    tierUpgrades: {
      silver: {
        effects: [
          { kind: 'buffStat', stat: 'attack', pct: 50, turns: 2 },
          { kind: 'damage', power: 10 },
        ],
        text: '+50% Attack (2 turns) · Deal Beast damage +10 (+Attack).',
      },
      gold: {
        effects: [
          { kind: 'buffStat', stat: 'attack', pct: 50, turns: 2 },
          { kind: 'damage', power: 20 },
        ],
        text: '+50% Attack (2 turns) · Deal Beast damage +20 (+Attack).',
      },
      diamond: {
        effects: [
          { kind: 'buffStat', stat: 'attack', pct: 50, turns: 2 },
          { kind: 'damage', power: 30 },
        ],
        text: '+50% Attack (2 turns) · Deal Beast damage +30 (+Attack).',
      },
    },
  },

  // ---- Special-ability showcase (combined archetypes, priced riders) ----
  {
    id: 'hamstring',
    name: 'Hamstring',
    archetypes: ['offense', 'debuff'],
    property: 'physical',
    size: 1,
    rarity: 'rare',
    tier: 'bronze',
    weapon: 'lance',
    effects: [
      { kind: 'damage', power: 12 },
      { kind: 'slow', weight: 16 },
    ],
    text: "Deal Lance damage +12 (+Attack) · {{Slow}} the enemy's next action by +16 weight."
  },
  {
    id: 'leeching_fang',
    name: 'Leeching Fang',
    archetypes: ['offense', 'healing'],
    property: 'physical',
    size: 1,
    speedWeight: 12,
    rarity: 'rare',
    tier: 'bronze',
    weapon: 'beast',
    effects: [
      { kind: 'damage', power: 16 },
      { kind: 'lifesteal', pct: 45 },
    ],
    text: 'Deal Beast damage +16 (+Attack) · heal 45% of damage dealt.',
  },
  {
    id: 'shield_splitter',
    name: 'Shield Splitter',
    archetypes: ['offense', 'debuff'],
    property: 'physical',
    size: 2,
    rarity: 'rare',
    tier: 'bronze',
    weapon: 'axe',
    effects: [
      { kind: 'shieldBreak', amount: 24 },
      { kind: 'damage', power: 42 },
    ],
    text: '{{Shatter}} 24 enemy shield, then deal Axe damage +42 (+Attack).',
  },
  {
    id: 'follow_through',
    name: 'Follow-Through',
    archetypes: ['offense'],
    property: 'physical',
    size: 1,
    rarity: 'rare',
    tier: 'bronze',
    weapon: 'sword',
    // comboPerPoint discount (2.5/pt, user-locked 2026-07-23): damage 10 (50)
    // + comboBonus 20 (floor(20*5/2)=50) = 100 = Bronze exactly. Un-comboed
    // 10 is half a Sword Slash's 20; comboed 30 (10+20) beats it by 50%.
    effects: [
      { kind: 'comboBonus', amount: 20 },
      { kind: 'damage', power: 10 },
    ],
    text: 'Deal Sword damage +10 (+Attack) · +20 if previous cast was Offense.',
  },
  {
    id: 'concussive_shot',
    name: 'Concussive Shot',
    archetypes: ['offense', 'debuff'],
    property: 'physical',
    size: 1,
    rarity: 'rare',
    tier: 'bronze',
    weapon: 'bow',
    // disrupt re-priced to an ESCALATING bracket schedule (user-locked
    // 2026-07-25 — see PRICE.disruptBrackets): disrupt 6 costs 5*5 + 1*15 =
    // 40 deci (the first 5 points at 5/pt, the 6th at the 6-10 bracket's
    // 15/pt). damage 12 (60) + disrupt 6 (40) = 100 = Bronze exactly (was
    // disrupt 16 at the old flat 1-per-4 rate; 16 is now unaffordable at any
    // tier — 310 deci = 31 PL).
    effects: [
      { kind: 'damage', power: 12 },
      { kind: 'disrupt', amount: 6 },
    ],
    text: 'Deal Bow damage +12 (+Attack) · {{Disrupt}} 6 banked readiness.',
  },

  // ---- Debuff ----
  {
    id: 'hex_of_frailty',
    name: 'Hex of Frailty',
    archetypes: ['debuff'],
    property: 'magical',
    size: 1,
    rarity: 'rare',
    tier: 'bronze',
    element: 'dark',
    // Refit for the size-1 control cap (10 PL): 50%×2t = 100 deci exactly
    // (was 40%×3t = 12 PL funded by extra weight).
    effects: [{ kind: 'debuffStat', stat: 'magicResist', pct: 50, turns: 2 }],
    text: '-50% enemy Magic Resist (2 turns).',
    // Curse theme: the debuff is frozen (already at the size-1 control cap,
    // 100 deci); a Dark damage tick sinks the rest. Silver 10 (50) + 100 = 150.
    // Gold 20 (100) + 100 = 200. Diamond 30 (150) + 100 = 250.
    tierUpgrades: {
      silver: {
        effects: [
          { kind: 'debuffStat', stat: 'magicResist', pct: 50, turns: 2 },
          { kind: 'damage', power: 10 },
        ],
        text: '-50% enemy Magic Resist (2 turns) · Deal Dark damage +10 (+Magic Power).',
      },
      gold: {
        effects: [
          { kind: 'debuffStat', stat: 'magicResist', pct: 50, turns: 2 },
          { kind: 'damage', power: 20 },
        ],
        text: '-50% enemy Magic Resist (2 turns) · Deal Dark damage +20 (+Magic Power).',
      },
      diamond: {
        effects: [
          { kind: 'debuffStat', stat: 'magicResist', pct: 50, turns: 2 },
          { kind: 'damage', power: 30 },
        ],
        text: '-50% enemy Magic Resist (2 turns) · Deal Dark damage +30 (+Magic Power).',
      },
    },
  },
  {
    id: 'armor_break',
    name: 'Armor Break',
    archetypes: ['debuff'],
    property: 'physical',
    weapon: 'axe',
    size: 1,
    rarity: 'rare',
    tier: 'bronze',
    effects: [{ kind: 'debuffStat', stat: 'armor', pct: 50, turns: 2 }],
    text: '-50% enemy Armor (2 turns).',
    // Frozen debuff (already at the size-1 control cap, 100 deci); a physical
    // Axe chop sinks the rest. Silver 10 (50) + 100 = 150. Gold 20 (100) + 100
    // = 200. Diamond 30 (150) + 100 = 250.
    tierUpgrades: {
      silver: {
        effects: [
          { kind: 'debuffStat', stat: 'armor', pct: 50, turns: 2 },
          { kind: 'damage', power: 10 },
        ],
        text: '-50% enemy Armor (2 turns) · Deal Axe damage +10 (+Attack).',
      },
      gold: {
        effects: [
          { kind: 'debuffStat', stat: 'armor', pct: 50, turns: 2 },
          { kind: 'damage', power: 20 },
        ],
        text: '-50% enemy Armor (2 turns) · Deal Axe damage +20 (+Attack).',
      },
      diamond: {
        effects: [
          { kind: 'debuffStat', stat: 'armor', pct: 50, turns: 2 },
          { kind: 'damage', power: 30 },
        ],
        text: '-50% enemy Armor (2 turns) · Deal Axe damage +30 (+Attack).',
      },
    },
  },
  {
    id: 'slow_hex',
    name: 'Slowing Hex',
    archetypes: ['debuff'],
    property: 'magical',
    size: 1,
    rarity: 'common',
    tier: 'bronze',
    element: 'frost',
    effects: [
      { kind: 'damage', power: 8 },
      { kind: 'debuffStat', stat: 'speed', pct: 30, turns: 2 },
    ],
    text: 'Deal Frost damage +8 (+Magic Power) · -30% enemy Speed (2 turns).',
  },
  {
    // Pure control: at the re-priced stunPerTurn (100 deci) a single stun turn
    // IS the whole Bronze budget, so the card is stun-only. Size 1 / default
    // weight keeps the total at exactly 100 (stun 100 + weight 0 + size 0).
    id: 'stunning_smash',
    name: 'Stunning Smash',
    archetypes: ['debuff'],
    property: 'physical',
    size: 1,
    rarity: 'epic',
    tier: 'bronze',
    weapon: 'axe',
    effects: [{ kind: 'stun', turns: 1 }],
    text: "{{Stun}} — the enemy's next performance is consumed.",
    // Stun cannot grow (hard-capped at 1 performance/card, and already the
    // full size-1 control cap at 100 deci); a physical Axe smash sinks the
    // rest. Silver 10 (50) + 100 = 150. Gold 20 (100) + 100 = 200. Diamond 30
    // (150) + 100 = 250.
    tierUpgrades: {
      silver: {
        effects: [
          { kind: 'stun', turns: 1 },
          { kind: 'damage', power: 10 },
        ],
        text: "{{Stun}} — the enemy's next performance is consumed. Deal Axe damage +10 (+Attack).",
      },
      gold: {
        effects: [
          { kind: 'stun', turns: 1 },
          { kind: 'damage', power: 20 },
        ],
        text: "{{Stun}} — the enemy's next performance is consumed. Deal Axe damage +20 (+Attack).",
      },
      diamond: {
        effects: [
          { kind: 'stun', turns: 1 },
          { kind: 'damage', power: 30 },
        ],
        text: "{{Stun}} — the enemy's next performance is consumed. Deal Axe damage +30 (+Attack).",
      },
    },
  },
  {
    id: 'judgment_light',
    name: 'Judgment Light',
    archetypes: ['offense', 'debuff'],
    property: 'magical',
    size: 1,
    rarity: 'rare',
    tier: 'bronze',
    element: 'holy',
    effects: [
      { kind: 'damage', power: 12 },
      { kind: 'debuffStat', stat: 'magicResist', pct: 20, turns: 2 },
    ],
    text: 'Deal Holy damage +12 (+Magic Power) · -20% enemy Magic Resist (2 turns).',
  },
  {
    id: 'shadow_bolt',
    name: 'Shadow Bolt',
    archetypes: ['offense'],
    property: 'magical',
    size: 1,
    rarity: 'common',
    tier: 'bronze',
    element: 'dark',
    effects: [{ kind: 'damage', power: 20 }],
    text: 'Deal Dark damage +20 (+Magic Power).',
  },
  {
    id: 'purging_strike',
    name: 'Purging Strike',
    archetypes: ['offense'],
    property: 'true',
    element: 'holy',
    size: 1,
    speedWeight: 8,
    rarity: 'rare',
    tier: 'bronze',
    // TRUE damage at 10 deci/pt (half-effect rule): 9 × 10 = 90 =
    // 100 budget − 10 for weight 8 (2 under baseline).
    effects: [{ kind: 'damage', power: 9 }],
    text: 'Deal TRUE damage +9 (+best stat) — the +9 ignores DEF/MDEF. Light and quick (weight 8).',
  },
  {
    id: 'purify',
    name: 'Purify',
    archetypes: ['healing', 'support'],
    property: 'true',
    element: 'holy',
    size: 1,
    rarity: 'rare',
    tier: 'bronze',
    // cleanse re-priced per charge (25 deci): 4 charges = 100 = Bronze exactly.
    effects: [{ kind: 'cleanse', charges: 4 }],
    text: 'Remove up to 4 of your ailments.',
    // Cleanse is frozen (already at the size-1 empower cap, 100 deci); a TRUE
    // heal (2 deci/pt, the cheap TRUE-heal rate) sinks the rest. Silver
    // 25pts (50) + 100 = 150. Gold 50pts (100) + 100 = 200. Diamond 75pts
    // (150) + 100 = 250.
    tierUpgrades: {
      silver: {
        effects: [
          { kind: 'cleanse', charges: 4 },
          { kind: 'heal', power: 25 },
        ],
        text: 'Remove up to 4 of your ailments. +25 TRUE HP.',
      },
      gold: {
        effects: [
          { kind: 'cleanse', charges: 4 },
          { kind: 'heal', power: 50 },
        ],
        text: 'Remove up to 4 of your ailments. +50 TRUE HP.',
      },
      diamond: {
        effects: [
          { kind: 'cleanse', charges: 4 },
          { kind: 'heal', power: 75 },
        ],
        text: 'Remove up to 4 of your ailments. +75 TRUE HP.',
      },
    },
  },

  // ---- Bleed showcase (per-performance DoT) ----
  {
    // bleed priced LINEARLY per stack (2026-07-23): 5 stacks × 10 deci = 50
    // deci = 5 PL. Tick gameplay unchanged (decays 5,4,3,2,1 = 15 total).
    // damage 10 (50) + bleed (50) = 100 = Bronze.
    id: 'rupturing_strike',
    name: 'Rupturing Strike',
    archetypes: ['offense', 'debuff'],
    property: 'physical',
    size: 1,
    rarity: 'rare',
    tier: 'bronze',
    weapon: 'axe',
    effects: [
      { kind: 'damage', power: 10 },
      { kind: 'bleed', stacks: 5 },
    ],
    text: 'Deal Axe damage +10 (+Attack) · {{Bleed}} 5 — ticks when the enemy performs; blocked by shields.',
    // Hand-tuned curve (user-locked 2026-07-24): MODERATE bleed growth, rest
    // into damage. Silver: bleed 7 (70) + damage 16 (80) = 150. Gold: bleed 8
    // (80) + damage 24 (120) = 200. Diamond: bleed 9 (90) + damage 32 (160)
    // = 250.
    tierUpgrades: {
      silver: {
        effects: [
          { kind: 'damage', power: 16 },
          { kind: 'bleed', stacks: 7 },
        ],
        text: 'Deal Axe damage +16 (+Attack) · {{Bleed}} 7 — ticks when the enemy performs; blocked by shields.',
      },
      gold: {
        effects: [
          { kind: 'damage', power: 24 },
          { kind: 'bleed', stacks: 8 },
        ],
        text: 'Deal Axe damage +24 (+Attack) · {{Bleed}} 8 — ticks when the enemy performs; blocked by shields.',
      },
      diamond: {
        effects: [
          { kind: 'damage', power: 32 },
          { kind: 'bleed', stacks: 9 },
        ],
        text: 'Deal Axe damage +32 (+Attack) · {{Bleed}} 9 — ticks when the enemy performs; blocked by shields.',
      },
    },
  },

  // ---- Expose showcase (incoming-damage amplifier) ----
  {
    // expose 50%×2 (50*2*1 = 100) = Bronze exactly. pct clamped to <=50 at apply.
    id: 'ruinous_hex',
    name: 'Ruinous Hex',
    archetypes: ['debuff'],
    property: 'magical',
    size: 1,
    rarity: 'rare',
    tier: 'bronze',
    element: 'dark',
    effects: [{ kind: 'expose', pct: 50, turns: 2 }],
    text: '{{Expose}} the enemy — +50% damage from all direct hits (2 turns).',
    // Expose is frozen (already at the size-1 control cap, 100 deci, and the
    // 50%-apply-time clamp); a Dark damage tick sinks the rest. Silver 10
    // (50) + 100 = 150. Gold 20 (100) + 100 = 200. Diamond 30 (150) + 100
    // = 250.
    tierUpgrades: {
      silver: {
        effects: [
          { kind: 'expose', pct: 50, turns: 2 },
          { kind: 'damage', power: 10 },
        ],
        text: '{{Expose}} the enemy — +50% damage from all direct hits (2 turns) · Deal Dark damage +10 (+Magic Power).',
      },
      gold: {
        effects: [
          { kind: 'expose', pct: 50, turns: 2 },
          { kind: 'damage', power: 20 },
        ],
        text: '{{Expose}} the enemy — +50% damage from all direct hits (2 turns) · Deal Dark damage +20 (+Magic Power).',
      },
      diamond: {
        effects: [
          { kind: 'expose', pct: 50, turns: 2 },
          { kind: 'damage', power: 30 },
        ],
        text: '{{Expose}} the enemy — +50% damage from all direct hits (2 turns) · Deal Dark damage +30 (+Magic Power).',
      },
    },
  },
];

export const skillBook: SkillBook = Object.fromEntries(defs.map((s) => [s.id, s]));
