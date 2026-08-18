import type { SkillBook, SkillDef } from '../engine/types';
import { skillBookFromJson } from './skillsContent';

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
    text: 'Deal 20 (+ATK) Sword damage.',
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
    text: 'Deal 6 (+ATK) Sword damage, twice.',
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
    text: 'Deal 20 (+ATK) Beast damage.',
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
    text: 'Deal 96 (+ATK) Beast damage.',
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
    text: 'Deal 20 (+ATK) Bow damage. Strong vs Beasts.',
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
    text: 'Deal 18 (+MATK) Lightning damage.',
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
    text: 'Deal 96 (+ATK) Axe damage.',
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
    text: 'Deal 38 (+MATK) Fire damage · {{Burn}} 5.',
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
        text: 'Deal 50 (+MATK) Fire damage · {{Burn}} 7.',
      },
      gold: {
        effects: [
          { kind: 'damage', power: 66 },
          { kind: 'burn', stacks: 8 },
        ],
        text: 'Deal 66 (+MATK) Fire damage · {{Burn}} 8.',
      },
      diamond: {
        effects: [
          { kind: 'damage', power: 78 },
          { kind: 'burn', stacks: 10 },
        ],
        text: 'Deal 78 (+MATK) Fire damage · {{Burn}} 10.',
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
    text: 'Deal 27 (+best stat) TRUE damage — ignores DEF/MDEF.',
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
    text: 'Deal 38 (+ATK) Lance damage · -25% enemy ATK (2 turns).',
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
    text: 'Deal 12 (+ATK) Beast damage · {{Poison}} 5 (poison bypasses shields).',
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
        text: 'Deal 18 (+ATK) Beast damage · {{Poison}} 7 (poison bypasses shields).',
      },
      gold: {
        effects: [
          { kind: 'damage', power: 26 },
          { kind: 'poison', stacks: 8 },
        ],
        text: 'Deal 26 (+ATK) Beast damage · {{Poison}} 8 (poison bypasses shields).',
      },
      diamond: {
        effects: [
          { kind: 'damage', power: 34 },
          { kind: 'poison', stacks: 9 },
        ],
        text: 'Deal 34 (+ATK) Beast damage · {{Poison}} 9 (poison bypasses shields).',
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
    text: 'Gain 48 (+DEF) physical shield.',
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
    text: 'Gain 20 (+MDEF) magical shield.',
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
    text: 'Gain 92 TRUE shield — blocks TRUE damage fully; physical/magical drain it 2:1.',
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
        text: '-50% incoming magical damage (2 turns) · Gain 10 (+MDEF) magical shield.',
      },
      gold: {
        effects: [
          { kind: 'guard', property: 'magical', pct: 50, turns: 2 },
          { kind: 'shield', power: 20 },
        ],
        text: '-50% incoming magical damage (2 turns) · Gain 20 (+MDEF) magical shield.',
      },
      diamond: {
        effects: [
          { kind: 'guard', property: 'magical', pct: 50, turns: 2 },
          { kind: 'shield', power: 30 },
        ],
        text: '-50% incoming magical damage (2 turns) · Gain 30 (+MDEF) magical shield.',
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
        text: '{{Negate}} the next magical attack · Gain 10 (+MDEF) magical shield.',
      },
      gold: {
        effects: [
          { kind: 'negate', property: 'magical', charges: 1 },
          { kind: 'shield', power: 20 },
        ],
        text: '{{Negate}} the next magical attack · Gain 20 (+MDEF) magical shield.',
      },
      diamond: {
        effects: [
          { kind: 'negate', property: 'magical', charges: 1 },
          { kind: 'shield', power: 30 },
        ],
        text: '{{Negate}} the next magical attack · Gain 30 (+MDEF) magical shield.',
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
    text: 'Restore 48 (+MDEF) HP.',
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
    // TRUE heal re-priced 2 -> 4 deci/pt (2026-08-01): 25 × 4 = 100 = Bronze.
    effects: [{ kind: 'heal', power: 25 }],
    text: 'Restore 25 HP.',
    // Silver/Diamond sink the rest into weight (lighter costs, so speedWeight
    // rises to buy back budget): silver 40×4=160 − 10 (weight 12) = 150.
    // Gold returns to baseline weight: 50×4=200 = Gold exactly.
    // Diamond: 65×4=260 − 10 (weight 12) = 250.
    tierUpgrades: {
      silver: {
        effects: [{ kind: 'heal', power: 40 }],
        speedWeight: 12,
        text: 'Restore 40 HP.',
      },
      gold: {
        effects: [{ kind: 'heal', power: 50 }],
        text: 'Restore 50 HP.',
      },
      diamond: {
        effects: [{ kind: 'heal', power: 65 }],
        speedWeight: 12,
        text: 'Restore 65 HP.',
      },
    },
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
        text: 'Passive: adjacent Magical cards -6 weight (cast sooner). Self: +15% SPD (2 turns).',
      },
      gold: {
        aura: { affects: 'adjacent', propertyFilter: 'magical', mods: { weightDelta: -8 } },
        effects: [{ kind: 'buffStat', stat: 'speed', pct: 20, turns: 2 }],
        text: 'Passive: adjacent Magical cards -8 weight (cast sooner). Self: +20% SPD (2 turns).',
      },
      diamond: {
        aura: { affects: 'adjacent', propertyFilter: 'magical', mods: { weightDelta: -10 } },
        effects: [{ kind: 'buffStat', stat: 'speed', pct: 25, turns: 2 }],
        text: 'Passive: adjacent Magical cards -10 weight (cast sooner). Self: +25% SPD (2 turns).',
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
    text: '+50% ATK (2 turns).',
    // War-cry theme: the +50%/2t buff is frozen (already at the size-1 empower
    // cap, 100 deci); a Beast damage roar sinks the rest. Silver 10 (50) + 100
    // = 150. Gold 20 (100) + 100 = 200. Diamond 30 (150) + 100 = 250.
    tierUpgrades: {
      silver: {
        effects: [
          { kind: 'buffStat', stat: 'attack', pct: 50, turns: 2 },
          { kind: 'damage', power: 10 },
        ],
        text: '+50% ATK (2 turns) · Deal 10 (+ATK) Beast damage.',
      },
      gold: {
        effects: [
          { kind: 'buffStat', stat: 'attack', pct: 50, turns: 2 },
          { kind: 'damage', power: 20 },
        ],
        text: '+50% ATK (2 turns) · Deal 20 (+ATK) Beast damage.',
      },
      diamond: {
        effects: [
          { kind: 'buffStat', stat: 'attack', pct: 50, turns: 2 },
          { kind: 'damage', power: 30 },
        ],
        text: '+50% ATK (2 turns) · Deal 30 (+ATK) Beast damage.',
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
    text: "Deal 12 (+ATK) Lance damage · {{Slow}} the enemy's next action by +16 weight."
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
    text: 'Deal 16 (+ATK) Beast damage · heal 45% of damage dealt.',
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
    text: '{{Shatter}} 24 enemy shield, then deal 42 (+ATK) Axe damage.',
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
    text: 'Deal 10 (+ATK) Sword damage · +20 if previous cast was Offense.',
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
    text: 'Deal 12 (+ATK) Bow damage · {{Disrupt}} 6 banked readiness.',
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
    text: '-50% enemy MDEF (2 turns).',
    // Curse theme: the debuff is frozen (already at the size-1 control cap,
    // 100 deci); a Dark damage tick sinks the rest. Silver 10 (50) + 100 = 150.
    // Gold 20 (100) + 100 = 200. Diamond 30 (150) + 100 = 250.
    tierUpgrades: {
      silver: {
        effects: [
          { kind: 'debuffStat', stat: 'magicResist', pct: 50, turns: 2 },
          { kind: 'damage', power: 10 },
        ],
        text: '-50% enemy MDEF (2 turns) · Deal 10 (+MATK) Dark damage.',
      },
      gold: {
        effects: [
          { kind: 'debuffStat', stat: 'magicResist', pct: 50, turns: 2 },
          { kind: 'damage', power: 20 },
        ],
        text: '-50% enemy MDEF (2 turns) · Deal 20 (+MATK) Dark damage.',
      },
      diamond: {
        effects: [
          { kind: 'debuffStat', stat: 'magicResist', pct: 50, turns: 2 },
          { kind: 'damage', power: 30 },
        ],
        text: '-50% enemy MDEF (2 turns) · Deal 30 (+MATK) Dark damage.',
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
    text: '-50% enemy DEF (2 turns).',
    // Frozen debuff (already at the size-1 control cap, 100 deci); a physical
    // Axe chop sinks the rest. Silver 10 (50) + 100 = 150. Gold 20 (100) + 100
    // = 200. Diamond 30 (150) + 100 = 250.
    tierUpgrades: {
      silver: {
        effects: [
          { kind: 'debuffStat', stat: 'armor', pct: 50, turns: 2 },
          { kind: 'damage', power: 10 },
        ],
        text: '-50% enemy DEF (2 turns) · Deal 10 (+ATK) Axe damage.',
      },
      gold: {
        effects: [
          { kind: 'debuffStat', stat: 'armor', pct: 50, turns: 2 },
          { kind: 'damage', power: 20 },
        ],
        text: '-50% enemy DEF (2 turns) · Deal 20 (+ATK) Axe damage.',
      },
      diamond: {
        effects: [
          { kind: 'debuffStat', stat: 'armor', pct: 50, turns: 2 },
          { kind: 'damage', power: 30 },
        ],
        text: '-50% enemy DEF (2 turns) · Deal 30 (+ATK) Axe damage.',
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
    text: 'Deal 8 (+MATK) Frost damage · -30% enemy SPD (2 turns).',
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
        text: "{{Stun}} — the enemy's next performance is consumed. Deal 10 (+ATK) Axe damage.",
      },
      gold: {
        effects: [
          { kind: 'stun', turns: 1 },
          { kind: 'damage', power: 20 },
        ],
        text: "{{Stun}} — the enemy's next performance is consumed. Deal 20 (+ATK) Axe damage.",
      },
      diamond: {
        effects: [
          { kind: 'stun', turns: 1 },
          { kind: 'damage', power: 30 },
        ],
        text: "{{Stun}} — the enemy's next performance is consumed. Deal 30 (+ATK) Axe damage.",
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
    text: 'Deal 12 (+MATK) Holy damage · -20% enemy MDEF (2 turns).',
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
    text: 'Deal 20 (+MATK) Dark damage.',
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
    text: 'Deal 9 (+best stat) TRUE damage — ignores DEF/MDEF. Light and quick (weight 8).',
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
    // cleanse SCALES with tier (user-locked 2026-08-17): no authored
    // `tierUpgrades` needed any more. `autoScaleTier` derives the ladder on
    // its own — cleanse joined the sink kinds, so each tier's full budget
    // buys more charges instead of a bolted-on TRUE heal: Silver 6 charges
    // (150 = 15 PL), Gold 8 (200 = 20 PL), Diamond 10 (250 = 25 PL) — each
    // exact and cap-compliant (tests/engine/tierUpgrades.test.ts).
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
    text: 'Deal 10 (+ATK) Axe damage · {{Bleed}} 5 — ticks when the enemy performs; blocked by shields.',
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
        text: 'Deal 16 (+ATK) Axe damage · {{Bleed}} 7 — ticks when the enemy performs; blocked by shields.',
      },
      gold: {
        effects: [
          { kind: 'damage', power: 24 },
          { kind: 'bleed', stacks: 8 },
        ],
        text: 'Deal 24 (+ATK) Axe damage · {{Bleed}} 8 — ticks when the enemy performs; blocked by shields.',
      },
      diamond: {
        effects: [
          { kind: 'damage', power: 32 },
          { kind: 'bleed', stacks: 9 },
        ],
        text: 'Deal 32 (+ATK) Axe damage · {{Bleed}} 9 — ticks when the enemy performs; blocked by shields.',
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
        text: '{{Expose}} the enemy — +50% damage from all direct hits (2 turns) · Deal 10 (+MATK) Dark damage.',
      },
      gold: {
        effects: [
          { kind: 'expose', pct: 50, turns: 2 },
          { kind: 'damage', power: 20 },
        ],
        text: '{{Expose}} the enemy — +50% damage from all direct hits (2 turns) · Deal 20 (+MATK) Dark damage.',
      },
      diamond: {
        effects: [
          { kind: 'expose', pct: 50, turns: 2 },
          { kind: 'damage', power: 30 },
        ],
        text: '{{Expose}} the enemy — +50% damage from all direct hits (2 turns) · Deal 30 (+MATK) Dark damage.',
      },
    },
  },
  // ==========================================================================
  // Card-book expansion (2026-07-29, +36 bronze) — see docs/card-book-expansion.md.
  // Slices: wheel elements (fire/lightning/nature/frost), weapons (lance/bow),
  // archetypes (defensive/support/healing/true). Each element/weapon gets a
  // distinct play identity per the doc: fire=burn/DoT, lightning=speed/stagger,
  // nature=poison/regen, frost=slow/control, lance=reach/guard, bow=multi-hit/
  // precision. All authored at Bronze; tierUpgrades added only where the
  // auto-scaler can't express a sane curve (DoT-sink cards and pure-aura cards).
  // ==========================================================================

  // ---- Fire (burn/DoT identity) ----
  {
    id: 'ember_lash',
    name: 'Ember Lash',
    archetypes: ['offense'],
    property: 'magical',
    size: 1,
    rarity: 'rare',
    tier: 'bronze',
    element: 'fire',
    effects: [
      { kind: 'damage', power: 10 },
      { kind: 'burn', stacks: 5 },
    ],
    text: 'Deal 10 (+MATK) Fire damage · {{Burn}} 5.',
    // Moderate burn growth, rest into damage (same house style as fireball).
    tierUpgrades: {
      silver: {
        effects: [
          { kind: 'damage', power: 16 },
          { kind: 'burn', stacks: 7 },
        ],
        text: 'Deal 16 (+MATK) Fire damage · {{Burn}} 7.',
      },
      gold: {
        effects: [
          { kind: 'damage', power: 24 },
          { kind: 'burn', stacks: 8 },
        ],
        text: 'Deal 24 (+MATK) Fire damage · {{Burn}} 8.',
      },
      diamond: {
        effects: [
          { kind: 'damage', power: 32 },
          { kind: 'burn', stacks: 9 },
        ],
        text: 'Deal 32 (+MATK) Fire damage · {{Burn}} 9.',
      },
    },
  },
  {
    id: 'cinder_dart',
    name: 'Cinder Dart',
    archetypes: ['offense'],
    property: 'magical',
    size: 1,
    speedWeight: 8,
    rarity: 'rare',
    tier: 'bronze',
    element: 'fire',
    effects: [
      { kind: 'damage', power: 12 },
      { kind: 'burn', stacks: 3 },
    ],
    text: 'Deal 12 (+MATK) Fire damage · {{Burn}} 3. Light and quick (weight 8).',
    tierUpgrades: {
      silver: {
        effects: [
          { kind: 'damage', power: 18 },
          { kind: 'burn', stacks: 5 },
        ],
        text: 'Deal 18 (+MATK) Fire damage · {{Burn}} 5. Light and quick (weight 8).',
      },
      gold: {
        effects: [
          { kind: 'damage', power: 26 },
          { kind: 'burn', stacks: 6 },
        ],
        text: 'Deal 26 (+MATK) Fire damage · {{Burn}} 6. Light and quick (weight 8).',
      },
      diamond: {
        effects: [
          { kind: 'damage', power: 34 },
          { kind: 'burn', stacks: 7 },
        ],
        text: 'Deal 34 (+MATK) Fire damage · {{Burn}} 7. Light and quick (weight 8).',
      },
    },
  },
  {
    id: 'scorching_brand',
    name: 'Scorching Brand',
    archetypes: ['offense', 'debuff'],
    property: 'magical',
    size: 1,
    rarity: 'rare',
    tier: 'bronze',
    element: 'fire',
    effects: [
      { kind: 'damage', power: 8 },
      { kind: 'burn', stacks: 3 },
      { kind: 'debuffStat', stat: 'armor', pct: 15, turns: 2 },
    ],
    text: 'Deal 8 (+MATK) Fire damage · {{Burn}} 3 · -15% enemy DEF (2 turns).',
    // The armor debuff is frozen (control); burn grows moderately, damage sinks the rest.
    tierUpgrades: {
      silver: {
        effects: [
          { kind: 'damage', power: 14 },
          { kind: 'burn', stacks: 5 },
          { kind: 'debuffStat', stat: 'armor', pct: 15, turns: 2 },
        ],
        text: 'Deal 14 (+MATK) Fire damage · {{Burn}} 5 · -15% enemy DEF (2 turns).',
      },
      gold: {
        effects: [
          { kind: 'damage', power: 22 },
          { kind: 'burn', stacks: 6 },
          { kind: 'debuffStat', stat: 'armor', pct: 15, turns: 2 },
        ],
        text: 'Deal 22 (+MATK) Fire damage · {{Burn}} 6 · -15% enemy DEF (2 turns).',
      },
      diamond: {
        effects: [
          { kind: 'damage', power: 30 },
          { kind: 'burn', stacks: 7 },
          { kind: 'debuffStat', stat: 'armor', pct: 15, turns: 2 },
        ],
        text: 'Deal 30 (+MATK) Fire damage · {{Burn}} 7 · -15% enemy DEF (2 turns).',
      },
    },
  },
  {
    id: 'wildfire_surge',
    name: 'Wildfire Surge',
    archetypes: ['offense'],
    property: 'magical',
    size: 2,
    rarity: 'rare',
    tier: 'bronze',
    element: 'fire',
    effects: [
      { kind: 'damage', power: 24 },
      { kind: 'burn', stacks: 12 },
    ],
    text: 'Deal 24 (+MATK) Fire damage · {{Burn}} 12.',
    tierUpgrades: {
      silver: {
        effects: [
          { kind: 'damage', power: 36 },
          { kind: 'burn', stacks: 14 },
        ],
        text: 'Deal 36 (+MATK) Fire damage · {{Burn}} 14.',
      },
      gold: {
        effects: [
          { kind: 'damage', power: 52 },
          { kind: 'burn', stacks: 15 },
        ],
        text: 'Deal 52 (+MATK) Fire damage · {{Burn}} 15.',
      },
      diamond: {
        effects: [
          { kind: 'damage', power: 64 },
          { kind: 'burn', stacks: 17 },
        ],
        text: 'Deal 64 (+MATK) Fire damage · {{Burn}} 17.',
      },
    },
  },
  {
    id: 'inferno_eruption',
    name: 'Inferno Eruption',
    archetypes: ['offense'],
    property: 'magical',
    size: 3,
    rarity: 'epic',
    tier: 'bronze',
    element: 'fire',
    effects: [
      { kind: 'damage', power: 56 },
      { kind: 'burn', stacks: 20 },
    ],
    text: 'Deal 56 (+MATK) Fire damage · {{Burn}} 20.',
    tierUpgrades: {
      silver: {
        effects: [
          { kind: 'damage', power: 74 },
          { kind: 'burn', stacks: 25 },
        ],
        text: 'Deal 74 (+MATK) Fire damage · {{Burn}} 25.',
      },
      gold: {
        effects: [
          { kind: 'damage', power: 98 },
          { kind: 'burn', stacks: 28 },
        ],
        text: 'Deal 98 (+MATK) Fire damage · {{Burn}} 28.',
      },
      diamond: {
        effects: [
          { kind: 'damage', power: 118 },
          { kind: 'burn', stacks: 32 },
        ],
        text: 'Deal 118 (+MATK) Fire damage · {{Burn}} 32.',
      },
    },
  },

  // ---- Lightning (speed/stagger identity) ----
  {
    id: 'static_jolt',
    name: 'Static Jolt',
    archetypes: ['offense'],
    property: 'magical',
    size: 1,
    speedWeight: 6,
    rarity: 'common',
    tier: 'bronze',
    element: 'lightning',
    effects: [{ kind: 'damage', power: 16 }],
    text: 'Deal 16 (+MATK) Lightning damage. Very quick (weight 6).',
  },
  {
    id: 'thunder_step',
    name: 'Thunder Step',
    archetypes: ['offense', 'support'],
    property: 'magical',
    size: 1,
    rarity: 'rare',
    tier: 'bronze',
    element: 'lightning',
    effects: [
      { kind: 'buffStat', stat: 'speed', pct: 20, turns: 2 },
      { kind: 'damage', power: 12 },
    ],
    text: 'Deal 12 (+MATK) Lightning damage · +20% SPD (2 turns).',
  },
  {
    id: 'chain_spark',
    name: 'Chain Spark',
    archetypes: ['offense', 'debuff'],
    property: 'magical',
    size: 1,
    rarity: 'rare',
    tier: 'bronze',
    element: 'lightning',
    effects: [
      { kind: 'damage', power: 16 },
      { kind: 'slow', weight: 8 },
    ],
    text: "Deal 16 (+MATK) Lightning damage · {{Slow}} the enemy's next action by +8 weight.",
  },
  {
    id: 'overcharge',
    name: 'Overcharge',
    archetypes: ['offense', 'debuff'],
    property: 'magical',
    size: 1,
    rarity: 'rare',
    tier: 'bronze',
    element: 'lightning',
    effects: [
      { kind: 'damage', power: 16 },
      { kind: 'disrupt', amount: 4 },
    ],
    text: 'Deal 16 (+MATK) Lightning damage · {{Disrupt}} 4 banked readiness.',
  },
  {
    id: 'storm_surge',
    name: 'Storm Surge',
    archetypes: ['offense', 'support'],
    property: 'magical',
    size: 2,
    rarity: 'rare',
    tier: 'bronze',
    element: 'lightning',
    effects: [
      { kind: 'buffStat', stat: 'speed', pct: 30, turns: 2 },
      { kind: 'damage', power: 36 },
    ],
    text: 'Deal 36 (+MATK) Lightning damage · +30% SPD (2 turns).',
  },

  // ---- Nature (poison/regen identity) ----
  {
    id: 'thorn_bite',
    name: 'Thorn Bite',
    archetypes: ['offense', 'debuff'],
    property: 'magical',
    size: 1,
    rarity: 'rare',
    tier: 'bronze',
    element: 'nature',
    effects: [
      { kind: 'damage', power: 10 },
      { kind: 'poison', stacks: 5 },
    ],
    text: 'Deal 10 (+MATK) Nature damage · {{Poison}} 5 (poison bypasses shields).',
    tierUpgrades: {
      silver: {
        effects: [
          { kind: 'damage', power: 16 },
          { kind: 'poison', stacks: 7 },
        ],
        text: 'Deal 16 (+MATK) Nature damage · {{Poison}} 7 (poison bypasses shields).',
      },
      gold: {
        effects: [
          { kind: 'damage', power: 24 },
          { kind: 'poison', stacks: 8 },
        ],
        text: 'Deal 24 (+MATK) Nature damage · {{Poison}} 8 (poison bypasses shields).',
      },
      diamond: {
        effects: [
          { kind: 'damage', power: 32 },
          { kind: 'poison', stacks: 9 },
        ],
        text: 'Deal 32 (+MATK) Nature damage · {{Poison}} 9 (poison bypasses shields).',
      },
    },
  },
  {
    id: 'verdant_touch',
    name: 'Verdant Touch',
    archetypes: ['healing'],
    property: 'magical',
    size: 1,
    rarity: 'common',
    tier: 'bronze',
    element: 'nature',
    effects: [{ kind: 'heal', power: 20 }],
    text: 'Restore 20 (+MDEF) HP.',
  },
  {
    id: 'blooming_vine',
    name: 'Blooming Vine',
    archetypes: ['offense', 'debuff'],
    property: 'magical',
    size: 1,
    speedWeight: 12,
    rarity: 'rare',
    tier: 'bronze',
    element: 'nature',
    effects: [
      { kind: 'damage', power: 14 },
      { kind: 'poison', stacks: 4 },
    ],
    text: 'Deal 14 (+MATK) Nature damage · {{Poison}} 4 (poison bypasses shields). Heavier and slower (weight 12).',
    tierUpgrades: {
      silver: {
        effects: [
          { kind: 'damage', power: 20 },
          { kind: 'poison', stacks: 6 },
        ],
        text: 'Deal 20 (+MATK) Nature damage · {{Poison}} 6 (poison bypasses shields). Heavier and slower (weight 12).',
      },
      gold: {
        effects: [
          { kind: 'damage', power: 28 },
          { kind: 'poison', stacks: 7 },
        ],
        text: 'Deal 28 (+MATK) Nature damage · {{Poison}} 7 (poison bypasses shields). Heavier and slower (weight 12).',
      },
      diamond: {
        effects: [
          { kind: 'damage', power: 36 },
          { kind: 'poison', stacks: 8 },
        ],
        text: 'Deal 36 (+MATK) Nature damage · {{Poison}} 8 (poison bypasses shields). Heavier and slower (weight 12).',
      },
    },
  },
  {
    id: 'overgrowth',
    name: 'Overgrowth',
    archetypes: ['healing', 'defensive'],
    property: 'magical',
    size: 2,
    rarity: 'rare',
    tier: 'bronze',
    element: 'nature',
    effects: [
      { kind: 'heal', power: 30 },
      { kind: 'shield', power: 18 },
    ],
    text: 'Restore 30 (+MDEF) HP · Gain 18 (+MDEF) magical shield — a thorned bark ward.',
  },

  // ---- Frost (slow/control identity) ----
  {
    id: 'glacial_spike',
    name: 'Glacial Spike',
    archetypes: ['offense', 'debuff'],
    property: 'magical',
    size: 1,
    rarity: 'rare',
    tier: 'bronze',
    element: 'frost',
    effects: [
      { kind: 'damage', power: 12 },
      { kind: 'debuffStat', stat: 'speed', pct: 20, turns: 2 },
    ],
    text: 'Deal 12 (+MATK) Frost damage · -20% enemy SPD (2 turns).',
  },
  {
    id: 'frost_shackle',
    name: 'Frost Shackle',
    archetypes: ['offense', 'debuff'],
    property: 'magical',
    size: 1,
    rarity: 'rare',
    tier: 'bronze',
    element: 'frost',
    effects: [
      { kind: 'damage', power: 14 },
      { kind: 'slow', weight: 12 },
    ],
    text: "Deal 14 (+MATK) Frost damage · {{Slow}} the enemy's next action by +12 weight.",
  },
  {
    id: 'deep_freeze',
    name: 'Deep Freeze',
    archetypes: ['offense', 'debuff'],
    property: 'magical',
    size: 2,
    rarity: 'rare',
    tier: 'bronze',
    element: 'frost',
    effects: [
      { kind: 'damage', power: 24 },
      { kind: 'debuffStat', stat: 'speed', pct: 40, turns: 3 },
    ],
    text: 'Deal 24 (+MATK) Frost damage · -40% enemy SPD (3 turns).',
  },

  // ---- Lance (reach/guard identity) ----
  {
    id: 'lance_thrust',
    name: 'Lance Thrust',
    archetypes: ['offense'],
    property: 'physical',
    weapon: 'lance',
    size: 1,
    rarity: 'common',
    tier: 'bronze',
    effects: [{ kind: 'damage', power: 20 }],
    text: 'Deal 20 (+ATK) Lance damage.',
  },
  {
    id: 'braced_pike',
    name: 'Braced Pike',
    archetypes: ['offense', 'defensive'],
    property: 'physical',
    weapon: 'lance',
    size: 1,
    rarity: 'rare',
    tier: 'bronze',
    effects: [
      { kind: 'guard', property: 'physical', pct: 20, turns: 2 },
      { kind: 'damage', power: 12 },
    ],
    text: 'Deal 12 (+ATK) Lance damage · -20% incoming physical damage (2 turns).',
  },
  {
    id: 'piercing_reach',
    name: 'Piercing Reach',
    archetypes: ['offense', 'debuff'],
    property: 'physical',
    weapon: 'lance',
    size: 1,
    rarity: 'rare',
    tier: 'bronze',
    effects: [
      { kind: 'shieldBreak', amount: 16 },
      { kind: 'damage', power: 16 },
    ],
    text: '{{Shatter}} 16 enemy shield, then deal 16 (+ATK) Lance damage.',
  },
  {
    id: 'impaling_charge',
    name: 'Impaling Charge',
    archetypes: ['offense', 'defensive'],
    property: 'physical',
    weapon: 'lance',
    size: 2,
    rarity: 'rare',
    tier: 'bronze',
    effects: [
      { kind: 'guard', property: 'physical', pct: 30, turns: 2 },
      { kind: 'damage', power: 36 },
    ],
    text: 'Deal 36 (+ATK) Lance damage · -30% incoming physical damage (2 turns).',
  },

  // ---- Bow (multi-hit/precision identity) ----
  {
    id: 'rapid_volley',
    name: 'Rapid Volley',
    archetypes: ['offense'],
    property: 'physical',
    weapon: 'bow',
    size: 1,
    speedWeight: 16,
    rarity: 'rare',
    tier: 'bronze',
    // Each hit priced alone must be a whole PL (10*5=50 deci = 5 PL): 2 hits
    // (100) + extraHit premium (30) + weight16 heavier refund (-30) = 100.
    effects: [
      { kind: 'damage', power: 10 },
      { kind: 'damage', power: 10 },
    ],
    text: 'Deal 10 (+ATK) Bow damage, twice. Heavier and slower (weight 16).',
  },
  {
    id: 'piercing_arrow',
    name: 'Piercing Arrow',
    archetypes: ['offense', 'debuff'],
    property: 'physical',
    weapon: 'bow',
    size: 1,
    rarity: 'rare',
    tier: 'bronze',
    effects: [
      { kind: 'damage', power: 8 },
      { kind: 'expose', pct: 30, turns: 2 },
    ],
    text: 'Deal 8 (+ATK) Bow damage · {{Expose}} the enemy — +30% damage from all direct hits (2 turns).',
  },
  {
    id: 'marksman_shot',
    name: 'Marksman Shot',
    archetypes: ['offense'],
    property: 'physical',
    weapon: 'bow',
    size: 2,
    rarity: 'common',
    tier: 'bronze',
    effects: [{ kind: 'damage', power: 48 }],
    text: 'Deal 48 (+ATK) Bow damage.',
  },
  {
    id: 'barrage',
    name: 'Barrage',
    archetypes: ['offense'],
    property: 'physical',
    weapon: 'bow',
    size: 2,
    speedWeight: 26,
    rarity: 'rare',
    tier: 'bronze',
    // Each hit priced alone must be a whole PL (24*5=120 deci = 12 PL): 2 hits
    // (240) + extraHit premium (30) + weight26 heavier refund (-30) + size2
    // grant (-140) = 100.
    effects: [
      { kind: 'damage', power: 24 },
      { kind: 'damage', power: 24 },
    ],
    text: 'Deal 24 (+ATK) Bow damage, twice. Heavier and slower (weight 26).',
  },

  // ---- Defensive (armor-stack identity) ----
  {
    id: 'bastion_stance',
    name: 'Bastion Stance',
    archetypes: ['defensive'],
    property: 'physical',
    weapon: 'sword',
    size: 1,
    rarity: 'common',
    tier: 'bronze',
    effects: [{ kind: 'shield', power: 20 }],
    text: 'Gain 20 (+DEF) physical shield.',
  },
  {
    id: 'aegis_wall',
    name: 'Aegis Wall',
    archetypes: ['defensive'],
    property: 'physical',
    weapon: 'axe',
    size: 2,
    speedWeight: 16,
    rarity: 'rare',
    tier: 'bronze',
    effects: [{ kind: 'shield', power: 44 }],
    text: 'Gain 44 (+DEF) physical shield. Lighter stance (weight 16).',
  },
  {
    id: 'sanctified_bulwark',
    name: 'Sanctified Bulwark',
    archetypes: ['defensive'],
    property: 'magical',
    element: 'holy',
    size: 1,
    rarity: 'rare',
    tier: 'bronze',
    effects: [
      { kind: 'guard', property: 'magical', pct: 20, turns: 2 },
      { kind: 'shield', power: 12 },
    ],
    text: 'Gain 12 (+MDEF) magical shield · -20% incoming magical damage (2 turns).',
  },
  {
    id: 'fortress_bastion',
    name: 'Fortress Bastion',
    archetypes: ['defensive'],
    property: 'physical',
    weapon: 'sword',
    size: 3,
    rarity: 'epic',
    tier: 'bronze',
    effects: [{ kind: 'shield', power: 96 }],
    text: 'Gain 96 (+DEF) physical shield.',
  },

  // ---- Support (buff-aura identity) ----
  {
    id: 'mending_aura',
    name: 'Mending Aura',
    archetypes: ['support'],
    property: 'magical',
    element: 'holy',
    size: 1,
    rarity: 'rare',
    tier: 'bronze',
    effects: [],
    aura: { affects: 'adjacent', archetypeFilter: 'healing', mods: { healFlat: 10 } },
    text: 'Passive: adjacent Healing cards heal +10.',
    // Pure aura (no scalable sink) — grows exactly like war_banner's damageFlat curve.
    tierUpgrades: {
      silver: {
        aura: { affects: 'adjacent', archetypeFilter: 'healing', mods: { healFlat: 15 } },
        text: 'Passive: adjacent Healing cards heal +15.',
      },
      gold: {
        aura: { affects: 'adjacent', archetypeFilter: 'healing', mods: { healFlat: 20 } },
        text: 'Passive: adjacent Healing cards heal +20.',
      },
      diamond: {
        aura: { affects: 'adjacent', archetypeFilter: 'healing', mods: { healFlat: 25 } },
        text: 'Passive: adjacent Healing cards heal +25.',
      },
    },
  },
  {
    id: 'swift_march',
    name: 'Swift March',
    archetypes: ['support'],
    property: 'magical',
    element: 'dark',
    size: 1,
    rarity: 'rare',
    tier: 'bronze',
    effects: [],
    aura: { affects: 'adjacent', mods: { weightDelta: -5 } },
    text: 'Passive: adjacent cards -5 weight (cast sooner).',
    // Pure aura — weightDelta deepens and a self Speed buff sinks the rest
    // (same shape as time_crystal, but untargeted and quicker-firing).
    tierUpgrades: {
      silver: {
        aura: { affects: 'adjacent', mods: { weightDelta: -6 } },
        effects: [{ kind: 'buffStat', stat: 'speed', pct: 15, turns: 2 }],
        text: 'Passive: adjacent cards -6 weight (cast sooner). Self: +15% SPD (2 turns).',
      },
      gold: {
        aura: { affects: 'adjacent', mods: { weightDelta: -8 } },
        effects: [{ kind: 'buffStat', stat: 'speed', pct: 20, turns: 2 }],
        text: 'Passive: adjacent cards -8 weight (cast sooner). Self: +20% SPD (2 turns).',
      },
      diamond: {
        aura: { affects: 'adjacent', mods: { weightDelta: -10 } },
        effects: [{ kind: 'buffStat', stat: 'speed', pct: 25, turns: 2 }],
        text: 'Passive: adjacent cards -10 weight (cast sooner). Self: +25% SPD (2 turns).',
      },
    },
  },
  {
    id: 'warlord_banner',
    name: "Warlord's Banner",
    archetypes: ['support'],
    property: 'physical',
    weapon: 'axe',
    size: 1,
    rarity: 'rare',
    tier: 'bronze',
    effects: [],
    aura: { affects: 'allBoard', mods: { damageFlat: 5 } },
    text: 'Passive: ALL board cards deal +5 damage.',
    // Pure aura at allBoard reach (2x cost); damageFlat grows and a self
    // Attack buff sinks the rest.
    tierUpgrades: {
      silver: {
        aura: { affects: 'allBoard', mods: { damageFlat: 6 } },
        effects: [{ kind: 'buffStat', stat: 'attack', pct: 15, turns: 2 }],
        text: 'Passive: ALL board cards deal +6 damage. Self: +15% ATK (2 turns).',
      },
      gold: {
        aura: { affects: 'allBoard', mods: { damageFlat: 8 } },
        effects: [{ kind: 'buffStat', stat: 'attack', pct: 20, turns: 2 }],
        text: 'Passive: ALL board cards deal +8 damage. Self: +20% ATK (2 turns).',
      },
      diamond: {
        aura: { affects: 'allBoard', mods: { damageFlat: 10 } },
        effects: [{ kind: 'buffStat', stat: 'attack', pct: 25, turns: 2 }],
        text: 'Passive: ALL board cards deal +10 damage. Self: +25% ATK (2 turns).',
      },
    },
  },

  // ---- Healing (sustain identity) ----
  {
    id: 'renewing_wave',
    name: 'Renewing Wave',
    archetypes: ['healing'],
    property: 'true',
    element: 'holy',
    size: 1,
    speedWeight: 14,
    rarity: 'rare',
    tier: 'bronze',
    // TRUE heal re-priced 2 -> 4 deci/pt (2026-08-01): 30 × 4 = 120 − 20
    // (weight 14, 4 under baseline 10) = 100 = Bronze.
    effects: [{ kind: 'heal', power: 30 }],
    text: 'Restore 30 TRUE HP. Heavier cast (weight 14).',
    // Silver/Diamond sink extra weight: 45×4=180 − 30 (weight 16) = 150.
    // Gold returns to the bronze weight (14): 55×4=220 − 20 = 200.
    // Diamond: 70×4=280 − 30 (weight 16) = 250.
    tierUpgrades: {
      silver: {
        effects: [{ kind: 'heal', power: 45 }],
        speedWeight: 16,
        text: 'Restore 45 TRUE HP. Heavier cast (weight 16).',
      },
      gold: {
        effects: [{ kind: 'heal', power: 55 }],
        speedWeight: 14,
        text: 'Restore 55 TRUE HP. Heavier cast (weight 14).',
      },
      diamond: {
        effects: [{ kind: 'heal', power: 70 }],
        speedWeight: 16,
        text: 'Restore 70 TRUE HP. Heavier cast (weight 16).',
      },
    },
  },
  {
    id: 'vital_surge',
    name: 'Vital Surge',
    archetypes: ['healing'],
    property: 'physical',
    weapon: 'beast',
    size: 2,
    rarity: 'rare',
    tier: 'bronze',
    effects: [{ kind: 'heal', power: 48 }],
    text: 'Restore 48 (+DEF) HP.',
  },

  // ---- True (ignores-defense identity) ----
  {
    id: 'void_pierce',
    name: 'Void Pierce',
    archetypes: ['offense'],
    property: 'true',
    weapon: 'sword',
    size: 1,
    rarity: 'epic',
    tier: 'bronze',
    effects: [{ kind: 'damage', power: 10 }],
    text: 'Deal 10 (+best stat) TRUE damage — ignores DEF/MDEF.',
  },
  {
    id: 'annihilation_strike',
    name: 'Annihilation Strike',
    archetypes: ['offense'],
    property: 'true',
    element: 'dark',
    size: 3,
    rarity: 'epic',
    tier: 'bronze',
    effects: [{ kind: 'damage', power: 48 }],
    text: 'Deal 48 (+best stat) TRUE damage — ignores DEF/MDEF.',
  },
  {
    id: 'bramble_ward',
    name: 'Bramble Ward',
    archetypes: ["defensive"],
    property: 'physical',
    size: 1,
    rarity: 'common',
    tier: 'bronze',
    weapon: 'sword',
    effects: [{ kind: 'thorns', stacks: 5 }, { kind: 'shield', power: 10 }],
    text: '{{Thorns}} 5 \u2014 attackers take the stack count as TRUE damage per hit \u00b7 Gain 10 (+DEF) physical shield.',
  },
  {
    id: 'nettle_lash',
    name: 'Nettle Lash',
    archetypes: ["offense", "defensive"],
    property: 'physical',
    size: 1,
    rarity: 'common',
    tier: 'bronze',
    weapon: 'beast',
    effects: [{ kind: 'damage', power: 10 }, { kind: 'thorns', stacks: 5 }],
    text: 'Deal 10 (+ATK) Beast damage \u00b7 {{Thorns}} 5 \u2014 attackers take the stack count as TRUE damage per hit.',
  },

  // ==========================================================================
  // Vocabulary-fill pass (2026-08-18) \u2014 three synergy themes plus three empty
  // archetype x type cells. `ward` shipped on zero cards before this pass; it
  // is the only PREVENTIVE answer to anti-heal (heal/lifesteal cut 20% per
  // affliction category, floor -60%) \u2014 cleanse and TRUE heals only clean up
  // after the fact. `MAX_WARD_CHARGES` (3) clamps a holder's TOTAL ward
  // charges across every source, so a kit's own charge count is never additive
  // with another ward card's \u2014 see the per-card notes below for how that
  // shaped Aegis of the Unbroken.
  // ==========================================================================

  // ---- The Unbroken (ward, attrition-proof) ----
  {
    // ward (frozen empower, 50 deci/charge) 1 charge (50) + cleanse (the one
    // TIER-SCALING sink, 25 deci/charge) 2 charges (50) = 100 = Bronze
    // exactly. No tierUpgrades authored: cleanse alone absorbs every higher
    // budget on its own (silver 4 charges/150, gold 6/200, diamond 8/250 \u2014
    // `autoScaleTier` derives the whole ladder, verified against the real
    // pricer). Warding Prayer is the keystone of the theme \u2014 the one card
    // that teaches "prevent, don't just clean up".
    id: 'warding_prayer',
    name: 'Warding Prayer',
    archetypes: ['healing', 'support'],
    property: 'magical',
    element: 'holy',
    size: 1,
    rarity: 'rare',
    tier: 'bronze',
    effects: [
      { kind: 'ward', charges: 1 },
      { kind: 'cleanse', charges: 2 },
    ],
    text: '{{Ward}} 1 \u2014 prevent the next ailment outright \u00b7 Remove up to 2 of your ailments.',
  },
  {
    // ward 2 charges (100) \u2014 NOT 3: `ward 3` would hit the size-2 empower cap
    // (150 deci) AND `MAX_WARD_CHARGES` (3) at once, so this card alone would
    // fill a holder's entire ward pool and waste every OTHER ward source
    // (including a second cast of itself). `ward 2` leaves exactly one
    // charge of headroom \u2014 pairing this with Warding Prayer's `ward 1` fills
    // the holder's pool to precisely 3 with nothing wasted, which is the
    // stronger table-feel: two different ward cards actually stacking,
    // instead of one card maxing the pool and every recast/second source
    // being dead on arrival. heal (the sink) 28 fills the rest: 100 + 140
    // (size-2 grant) = 240 raw; ward 2 = 100 raw, heal 28*5 = 140 raw,
    // total 240 -> 100 deci = Bronze exactly. No tierUpgrades: heal alone
    // absorbs every higher budget (silver 44, gold 62, diamond 78 \u2014 verified
    // against `autoScaleTier`).
    id: 'aegis_of_the_unbroken',
    name: 'Aegis of the Unbroken',
    archetypes: ['defensive'],
    property: 'magical',
    element: 'holy',
    size: 2,
    rarity: 'rare',
    tier: 'bronze',
    effects: [
      { kind: 'ward', charges: 2 },
      { kind: 'heal', power: 28 },
    ],
    text: '{{Ward}} 2 \u2014 prevent the next 2 ailments outright \u00b7 Restore 28 (+MDEF) HP.',
  },
  {
    // ward 1 (50, frozen) + damage sink (50) = 100 = Bronze exactly. No
    // tierUpgrades: damage alone absorbs every higher budget (silver 20,
    // gold 30, diamond 40 \u2014 verified against `autoScaleTier`).
    id: 'verdant_rebuke',
    name: 'Verdant Rebuke',
    archetypes: ['offense', 'defensive'],
    property: 'magical',
    element: 'nature',
    size: 1,
    rarity: 'rare',
    tier: 'bronze',
    effects: [
      { kind: 'ward', charges: 1 },
      { kind: 'damage', power: 10 },
    ],
    text: '{{Ward}} 1 \u2014 prevent the next ailment outright \u00b7 Deal 10 (+MATK) Nature damage.',
  },
  {
    // Two DIFFERENT-RATE sinks (cleanse 25 deci/charge, heal 5 deci/point) \u2014
    // `autoScaleTier`'s sink solve requires every sink action to share one
    // rate, so a mixed pair like this is left at its Bronze numbers by the
    // auto-scaler and needs a hand-authored ladder (same shape as every
    // multi-rate DoT card below). Bronze: cleanse 4 (100) + heal 28 (140
    // raw = 28*5) = 240 raw - 140 (size-2 grant) = 100 exactly. Curve keeps
    // cleanse FROZEN at 4 (matching Purify's own charge count) and grows
    // heal alone: silver 44, gold 62, diamond 78 \u2014 the identical heal
    // ladder Aegis of the Unbroken uses, since both are size-2/100-deci-
    // frozen-partner kits.
    id: 'purge_the_rot',
    name: 'Purge the Rot',
    archetypes: ['healing'],
    property: 'magical',
    element: 'nature',
    size: 2,
    rarity: 'rare',
    tier: 'bronze',
    effects: [
      { kind: 'cleanse', charges: 4 },
      { kind: 'heal', power: 28 },
    ],
    text: 'Remove up to 4 of your ailments \u00b7 Restore 28 (+MDEF) HP.',
    tierUpgrades: {
      silver: {
        effects: [
          { kind: 'cleanse', charges: 4 },
          { kind: 'heal', power: 44 },
        ],
        text: 'Remove up to 4 of your ailments \u00b7 Restore 44 (+MDEF) HP.',
      },
      gold: {
        effects: [
          { kind: 'cleanse', charges: 4 },
          { kind: 'heal', power: 62 },
        ],
        text: 'Remove up to 4 of your ailments \u00b7 Restore 62 (+MDEF) HP.',
      },
      diamond: {
        effects: [
          { kind: 'cleanse', charges: 4 },
          { kind: 'heal', power: 78 },
        ],
        text: 'Remove up to 4 of your ailments \u00b7 Restore 78 (+MDEF) HP.',
      },
    },
  },

  // ---- The Thorn Garden (thorns, punish the attacker) ----
  {
    // thorns AT the size-2 empower cap (150 deci = 15 stacks, 10 deci/stack)
    // + shield sink 18 (90 raw = 18*5): 150 + 90 = 240 raw - 140 (size-2
    // grant) = 100 = Bronze exactly. No tierUpgrades: shield alone absorbs
    // every higher budget (silver 34, gold 52, diamond 68 \u2014 verified against
    // `autoScaleTier`). Thorns fires on every hit the holder takes, so
    // against a 3-enemy pack this triggers up to 3x/turn \u2014 the counter-
    // pressure the "gain N shield" majority of `defensive` never applies.
    id: 'iron_maiden',
    name: 'Iron Maiden',
    archetypes: ['defensive'],
    property: 'physical',
    weapon: 'axe',
    size: 2,
    rarity: 'rare',
    tier: 'bronze',
    effects: [
      { kind: 'thorns', stacks: 15 },
      { kind: 'shield', power: 18 },
    ],
    text: '{{Thorns}} 15 \u2014 attackers take the stack count as TRUE damage per hit \u00b7 Gain 18 (+DEF) physical shield.',
  },
  {
    // thorns AT the size-3 empower cap (200 deci = 20 stacks) + damage sink
    // 56 (280 raw = 56*5): 200 + 280 = 480 raw - 380 (size-3 grant) = 100 =
    // Bronze exactly. No tierUpgrades: damage alone absorbs every higher
    // budget (silver 84, gold 114, diamond 142 \u2014 verified against
    // `autoScaleTier`). Size-3 is the argument for this card, not a bigger
    // number: it busies its caster two turns after firing, exactly the
    // window a large thorn pile wants to sit up and punish incoming hits \u2014
    // the first size-3 in the book whose case for its size is tempo, not a
    // single inflated line.
    id: 'bramblewrath',
    name: 'Bramblewrath',
    archetypes: ['defensive', 'offense'],
    property: 'physical',
    weapon: 'lance',
    size: 3,
    rarity: 'epic',
    tier: 'bronze',
    effects: [
      { kind: 'thorns', stacks: 20 },
      { kind: 'damage', power: 56 },
    ],
    text: '{{Thorns}} 20 \u2014 attackers take the stack count as TRUE damage per hit \u00b7 Deal 56 (+ATK) Lance damage.',
  },
  {
    // thorns + guard are BOTH frozen empower members with no scalable sink
    // between them \u2014 combined they exactly fill the size-1 empower cap (60 +
    // 40 = 100 deci = Bronze), so `autoScaleTier` has nothing to grow at
    // higher tiers (a CAP-HIT kit). Hand-authored ladder adds a physical
    // shield at Silver/Gold/Diamond ONLY (never at Bronze), matching the
    // frost_ward/ward_of_silence/battle_howl precedent for a frozen-kit-plus-
    // higher-tier-sink card: +10/20/30 shield = +50/100/150 deci exactly.
    id: 'retaliation_stance',
    name: 'Retaliation Stance',
    archetypes: ['defensive'],
    property: 'physical',
    weapon: 'lance',
    size: 1,
    rarity: 'rare',
    tier: 'bronze',
    effects: [
      { kind: 'thorns', stacks: 6 },
      { kind: 'guard', property: 'physical', pct: 20, turns: 2 },
    ],
    text: '{{Thorns}} 6 \u2014 attackers take the stack count as TRUE damage per hit \u00b7 -20% incoming physical damage (2 turns).',
    tierUpgrades: {
      silver: {
        effects: [
          { kind: 'thorns', stacks: 6 },
          { kind: 'guard', property: 'physical', pct: 20, turns: 2 },
          { kind: 'shield', power: 10 },
        ],
        text: '{{Thorns}} 6 \u2014 attackers take the stack count as TRUE damage per hit \u00b7 -20% incoming physical damage (2 turns) \u00b7 Gain 10 (+DEF) physical shield.',
      },
      gold: {
        effects: [
          { kind: 'thorns', stacks: 6 },
          { kind: 'guard', property: 'physical', pct: 20, turns: 2 },
          { kind: 'shield', power: 20 },
        ],
        text: '{{Thorns}} 6 \u2014 attackers take the stack count as TRUE damage per hit \u00b7 -20% incoming physical damage (2 turns) \u00b7 Gain 20 (+DEF) physical shield.',
      },
      diamond: {
        effects: [
          { kind: 'thorns', stacks: 6 },
          { kind: 'guard', property: 'physical', pct: 20, turns: 2 },
          { kind: 'shield', power: 30 },
        ],
        text: '{{Thorns}} 6 \u2014 attackers take the stack count as TRUE damage per hit \u00b7 -20% incoming physical damage (2 turns) \u00b7 Gain 30 (+DEF) physical shield.',
      },
    },
  },
  {
    // Same CAP-HIT shape as Retaliation Stance (thorns + guard, both frozen
    // empower, 60 + 40 = 100 = Bronze exactly) \u2014 magical/Fire twin, magical
    // shield sink added only at Silver+.
    id: 'cinder_skin',
    name: 'Cinder Skin',
    archetypes: ['defensive'],
    property: 'magical',
    element: 'fire',
    size: 1,
    rarity: 'rare',
    tier: 'bronze',
    effects: [
      { kind: 'thorns', stacks: 6 },
      { kind: 'guard', property: 'magical', pct: 20, turns: 2 },
    ],
    text: '{{Thorns}} 6 \u2014 attackers take the stack count as TRUE damage per hit \u00b7 -20% incoming magical damage (2 turns).',
    tierUpgrades: {
      silver: {
        effects: [
          { kind: 'thorns', stacks: 6 },
          { kind: 'guard', property: 'magical', pct: 20, turns: 2 },
          { kind: 'shield', power: 10 },
        ],
        text: '{{Thorns}} 6 \u2014 attackers take the stack count as TRUE damage per hit \u00b7 -20% incoming magical damage (2 turns) \u00b7 Gain 10 (+MDEF) magical shield.',
      },
      gold: {
        effects: [
          { kind: 'thorns', stacks: 6 },
          { kind: 'guard', property: 'magical', pct: 20, turns: 2 },
          { kind: 'shield', power: 20 },
        ],
        text: '{{Thorns}} 6 \u2014 attackers take the stack count as TRUE damage per hit \u00b7 -20% incoming magical damage (2 turns) \u00b7 Gain 20 (+MDEF) magical shield.',
      },
      diamond: {
        effects: [
          { kind: 'thorns', stacks: 6 },
          { kind: 'guard', property: 'magical', pct: 20, turns: 2 },
          { kind: 'shield', power: 30 },
        ],
        text: '{{Thorns}} 6 \u2014 attackers take the stack count as TRUE damage per hit \u00b7 -20% incoming magical damage (2 turns) \u00b7 Gain 30 (+MDEF) magical shield.',
      },
    },
  },

  // ---- The Opened Wound (axe, break the guard then bleed it out) ----
  {
    // TEACHING CARD: `shieldBreak` is authored BEFORE `bleed` in `effects` \u2014
    // bleed cannot land on a shielded target, so opening the guard first is
    // what lets this card's own bleed land in the SAME cast. Bronze: shieldBreak
    // 40 (control, 50 raw = 40*1.25) + bleed 6 (dot, 60 raw) + damage 26 (sink,
    // 130 raw = 26*5) = 240 raw - 140 (size-2 grant) = 100 exactly.
    // HAND-AUTHORED ladder (the DoT-sink authoring trap): `autoScaleTier`
    // grows bleed toward its dot-family cap FIRST, then sinks whatever is
    // left into damage \u2014 for this kit that produces bleed 8 -> 24 -> 30 -> 30
    // and damage lurching 16 -> 0 -> 6 -> 22 (non-monotonic, briefly zero).
    // Authored instead: shieldBreak stays frozen at 40, bleed grows MODERATELY
    // (6/8/9/10, the same shape rupturing_strike uses), and damage \u2014 the real
    // growing sink \u2014 climbs cleanly: silver 38, gold 54, diamond 68.
    id: 'gutting_cleave',
    name: 'Gutting Cleave',
    archetypes: ['offense', 'debuff'],
    property: 'physical',
    weapon: 'axe',
    size: 2,
    rarity: 'epic',
    tier: 'bronze',
    effects: [
      { kind: 'shieldBreak', amount: 40 },
      { kind: 'bleed', stacks: 6 },
      { kind: 'damage', power: 26 },
    ],
    text: '{{Shatter}} 40 enemy shield \u2014 opening the guard so the bleed below can land \u00b7 {{Bleed}} 6 \u2014 ticks when the enemy performs; blocked by shields \u00b7 Deal 26 (+ATK) Axe damage.',
    tierUpgrades: {
      silver: {
        effects: [
          { kind: 'shieldBreak', amount: 40 },
          { kind: 'bleed', stacks: 8 },
          { kind: 'damage', power: 38 },
        ],
        text: '{{Shatter}} 40 enemy shield \u2014 opening the guard so the bleed below can land \u00b7 {{Bleed}} 8 \u2014 ticks when the enemy performs; blocked by shields \u00b7 Deal 38 (+ATK) Axe damage.',
      },
      gold: {
        effects: [
          { kind: 'shieldBreak', amount: 40 },
          { kind: 'bleed', stacks: 9 },
          { kind: 'damage', power: 54 },
        ],
        text: '{{Shatter}} 40 enemy shield \u2014 opening the guard so the bleed below can land \u00b7 {{Bleed}} 9 \u2014 ticks when the enemy performs; blocked by shields \u00b7 Deal 54 (+ATK) Axe damage.',
      },
      diamond: {
        effects: [
          { kind: 'shieldBreak', amount: 40 },
          { kind: 'bleed', stacks: 10 },
          { kind: 'damage', power: 68 },
        ],
        text: '{{Shatter}} 40 enemy shield \u2014 opening the guard so the bleed below can land \u00b7 {{Bleed}} 10 \u2014 ticks when the enemy performs; blocked by shields \u00b7 Deal 68 (+ATK) Axe damage.',
      },
    },
  },
  {
    // "Bought with extra weight": speedWeight 16 (baseline 10, 6 heavier) is a
    // -30 deci refund, buying more bleed+damage than the Bronze budget alone
    // would afford. Bronze: bleed 6 (60) + damage 14 (70) = 130 - (-30 weight
    // refund, i.e. +30 spent) ... concretely: 130 raw + (10-16)*5 = 130 - 30 =
    // 100 = Bronze exactly. Same DoT-sink authoring trap as Gutting Cleave \u2014
    // hand-authored: bleed 6/8/9/10, damage climbing 14/20/28/36.
    id: 'hemorrhage',
    name: 'Hemorrhage',
    archetypes: ['debuff'],
    property: 'physical',
    weapon: 'axe',
    size: 1,
    speedWeight: 16,
    rarity: 'rare',
    tier: 'bronze',
    effects: [
      { kind: 'bleed', stacks: 6 },
      { kind: 'damage', power: 14 },
    ],
    text: '{{Bleed}} 6 \u2014 ticks when the enemy performs; blocked by shields \u00b7 Deal 14 (+ATK) Axe damage.',
    tierUpgrades: {
      silver: {
        effects: [
          { kind: 'bleed', stacks: 8 },
          { kind: 'damage', power: 20 },
        ],
        text: '{{Bleed}} 8 \u2014 ticks when the enemy performs; blocked by shields \u00b7 Deal 20 (+ATK) Axe damage.',
      },
      gold: {
        effects: [
          { kind: 'bleed', stacks: 9 },
          { kind: 'damage', power: 28 },
        ],
        text: '{{Bleed}} 9 \u2014 ticks when the enemy performs; blocked by shields \u00b7 Deal 28 (+ATK) Axe damage.',
      },
      diamond: {
        effects: [
          { kind: 'bleed', stacks: 10 },
          { kind: 'damage', power: 36 },
        ],
        text: '{{Bleed}} 10 \u2014 ticks when the enemy performs; blocked by shields \u00b7 Deal 36 (+ATK) Axe damage.',
      },
    },
  },
  {
    // Same teaching order as Gutting Cleave (shieldBreak before bleed), plus
    // expose. shieldBreak (80 raw = 64*1.25) + expose 20%x2t (40 raw) = 120,
    // both control-family and well under the size-3 control cap (200). Bronze:
    // 120 + bleed 8 (80) + damage 56 (280) = 480 raw - 380 (size-3 grant) =
    // 100 exactly. Hand-authored ladder, same trap/fix as the other two bleed
    // cards: shieldBreak+expose frozen, bleed 8/10/11/12, damage climbing
    // 56/80/108/134.
    id: 'sundering_roar',
    name: 'Sundering Roar',
    archetypes: ['offense', 'debuff'],
    property: 'physical',
    weapon: 'axe',
    size: 3,
    rarity: 'epic',
    tier: 'bronze',
    effects: [
      { kind: 'shieldBreak', amount: 64 },
      { kind: 'expose', pct: 20, turns: 2 },
      { kind: 'bleed', stacks: 8 },
      { kind: 'damage', power: 56 },
    ],
    text: '{{Shatter}} 64 enemy shield \u00b7 {{Expose}} the enemy \u2014 +20% damage from all direct hits (2 turns) \u00b7 {{Bleed}} 8 \u2014 ticks when the enemy performs; blocked by shields \u00b7 Deal 56 (+ATK) Axe damage.',
    tierUpgrades: {
      silver: {
        effects: [
          { kind: 'shieldBreak', amount: 64 },
          { kind: 'expose', pct: 20, turns: 2 },
          { kind: 'bleed', stacks: 10 },
          { kind: 'damage', power: 80 },
        ],
        text: '{{Shatter}} 64 enemy shield \u00b7 {{Expose}} the enemy \u2014 +20% damage from all direct hits (2 turns) \u00b7 {{Bleed}} 10 \u2014 ticks when the enemy performs; blocked by shields \u00b7 Deal 80 (+ATK) Axe damage.',
      },
      gold: {
        effects: [
          { kind: 'shieldBreak', amount: 64 },
          { kind: 'expose', pct: 20, turns: 2 },
          { kind: 'bleed', stacks: 11 },
          { kind: 'damage', power: 108 },
        ],
        text: '{{Shatter}} 64 enemy shield \u00b7 {{Expose}} the enemy \u2014 +20% damage from all direct hits (2 turns) \u00b7 {{Bleed}} 11 \u2014 ticks when the enemy performs; blocked by shields \u00b7 Deal 108 (+ATK) Axe damage.',
      },
      diamond: {
        effects: [
          { kind: 'shieldBreak', amount: 64 },
          { kind: 'expose', pct: 20, turns: 2 },
          { kind: 'bleed', stacks: 12 },
          { kind: 'damage', power: 134 },
        ],
        text: '{{Shatter}} 64 enemy shield \u00b7 {{Expose}} the enemy \u2014 +20% damage from all direct hits (2 turns) \u00b7 {{Bleed}} 12 \u2014 ticks when the enemy performs; blocked by shields \u00b7 Deal 134 (+ATK) Axe damage.',
      },
    },
  },

  // ---- Filler: empty archetype x type cells ----
  {
    // Bow's 6/6 cards are all `offense` \u2014 this is bow's first non-attack card,
    // so a bow board can finally hold a support piece of its own type. Pure
    // aura (no scalable sink), identical shape/price to `war_banner` (its
    // sword analog): damageFlat 10 * auraDamageFlat 10 * adjacent reach x1 =
    // 100 = Bronze exactly. CAP-HIT (no sink): hand-authored ladder grows the
    // aura itself, same as war_banner \u2014 15/20/25 damageFlat = 150/200/250.
    id: 'spotters_mark',
    name: "Spotter's Mark",
    archetypes: ['support'],
    property: 'physical',
    weapon: 'bow',
    size: 1,
    rarity: 'rare',
    tier: 'bronze',
    effects: [],
    aura: { affects: 'adjacent', archetypeFilter: 'offense', mods: { damageFlat: 10 } },
    text: 'Passive: adjacent Offense cards deal +10 damage.',
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
    // Dark x healing was empty, and lifesteal (anti-heal-reduced, so it wants
    // a ward beside it \u2014 see Theme 1) had only one card in the whole book.
    // Same shape as leeching_fang (its Beast/physical twin): damage 16 (80) +
    // lifesteal 45% (30, 45*2/3) - weight-12-heavier refund (-10, (10-12)*5)
    // = 100 = Bronze exactly. No tierUpgrades: damage alone absorbs every
    // higher budget (silver 26, gold 36, diamond 46 \u2014 verified against
    // `autoScaleTier`).
    id: 'siphon_life',
    name: 'Siphon Life',
    archetypes: ['offense', 'healing'],
    property: 'magical',
    element: 'dark',
    size: 1,
    speedWeight: 12,
    rarity: 'rare',
    tier: 'bronze',
    effects: [
      { kind: 'damage', power: 16 },
      { kind: 'lifesteal', pct: 45 },
    ],
    text: 'Deal 16 (+MATK) Dark damage \u00b7 heal 45% of damage dealt.',
  },
  {
    // Lightning x defensive was empty. guard (magical, 30%x2t = 60 deci) +
    // buffStat (speed, 20%x2t = 40 deci) = 100 = Bronze exactly \u2014 both frozen
    // empower members, CAP-HIT (no sink). Hand-authored ladder adds a magical
    // shield at Silver+ only, same precedent as Retaliation Stance/Cinder
    // Skin: +10/20/30 shield = +50/100/150 deci.
    id: 'storm_guard',
    name: 'Storm Guard',
    archetypes: ['defensive'],
    property: 'magical',
    element: 'lightning',
    size: 1,
    rarity: 'rare',
    tier: 'bronze',
    effects: [
      { kind: 'guard', property: 'magical', pct: 30, turns: 2 },
      { kind: 'buffStat', stat: 'speed', pct: 20, turns: 2 },
    ],
    text: '-30% incoming magical damage (2 turns) \u00b7 +20% SPD (2 turns).',
    tierUpgrades: {
      silver: {
        effects: [
          { kind: 'guard', property: 'magical', pct: 30, turns: 2 },
          { kind: 'buffStat', stat: 'speed', pct: 20, turns: 2 },
          { kind: 'shield', power: 10 },
        ],
        text: '-30% incoming magical damage (2 turns) \u00b7 +20% SPD (2 turns) \u00b7 Gain 10 (+MDEF) magical shield.',
      },
      gold: {
        effects: [
          { kind: 'guard', property: 'magical', pct: 30, turns: 2 },
          { kind: 'buffStat', stat: 'speed', pct: 20, turns: 2 },
          { kind: 'shield', power: 20 },
        ],
        text: '-30% incoming magical damage (2 turns) \u00b7 +20% SPD (2 turns) \u00b7 Gain 20 (+MDEF) magical shield.',
      },
      diamond: {
        effects: [
          { kind: 'guard', property: 'magical', pct: 30, turns: 2 },
          { kind: 'buffStat', stat: 'speed', pct: 20, turns: 2 },
          { kind: 'shield', power: 30 },
        ],
        text: '-30% incoming magical damage (2 turns) \u00b7 +20% SPD (2 turns) \u00b7 Gain 30 (+MDEF) magical shield.',
      },
    },
  },
];

/**
 * THE DEFS-BUILT BOOK — TEMPORARY, and the ONLY consumer is the migration proof.
 *
 * `skillBook` below no longer comes from these literals: it is loaded from
 * `content/skills.v1.json`. This export exists purely so
 * `tests/data/skillsJsonParity.test.ts` can prove the JSON book is byte-identical
 * to the hand-written one. DELETE THIS FILE (and that test) once the JSON is
 * accepted as the source of truth — see the migration notes on `skillsContent.ts`.
 *
 * Sorted by id for the same reason the loader sorts: `Object.values(skillBook)`
 * feeds seeded-Rng pools in src/run, so file order must never be load-bearing.
 * `tests/run/contentPoolOrder.test.ts` asserts it.
 */
export const skillBookFromDefs: SkillBook = Object.fromEntries(
  [...defs]
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((s) => [s.id, s]),
);

/**
 * THE skill book — now loaded from `content/skills.v1.json`.
 *
 * Re-exported from here so that the 60+ modules already importing `skillBook`
 * from `src/data/skills` switch to the JSON source atomically, with zero import
 * churn and therefore zero chance of half the app reading one book and half the
 * other. When the literals above are deleted this file becomes a one-line
 * re-export and can be collapsed into the loader.
 */
export const skillBook: SkillBook = skillBookFromJson;
