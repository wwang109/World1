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
};
