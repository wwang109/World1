import type { Gem } from '../engine/types';
import { gemBookFromJson } from './gemsContent';

// Gem catalog, priced with the Power Level system's SOCKET/GEM rules
// (src/engine/balance.ts, docs/power-level-reference.md "Socket / Gem PL
// accounting"). Each gem's OWN PL must land EXACTLY on its rarity's band
// (BUDGET_TOLERANCE_DECI = 0, same zero tolerance as the card audit — user-
// locked 2026-07-19): Common 2 · Rare 4 · Epic 6 · Legendary 8 — checked by
// `isGemOnBudget` (see tests/engine/gemAudit.test.ts). Gem PL is uncapped
// bonus power stacked on top of a card's authored (tier-budgeted) kit; it is
// NEVER folded into the base-card audit.
//
// `GemDef` is display data layered on the engine's structural `Gem` type —
// `name`/`text` aren't consumed by the engine, only by content/UI.
export type GemDef = Gem & { name: string; text: string };

/**
 * FOUR CATEGORIES (gem ruleset v1 §1/§10, 2026-08-09 migration — 46 -> 35
 * gems). Every gem's `name` ends in its category suffix and its `text` opens
 * with the category's mandatory word (see docs/card-text-style-guide.md,
 * "Gem text categories" — the canonical rules and templates live there, not
 * here):
 *   - Sliver (rider):  `kind: 'effect'`, no `damage`/`statStrike` action.
 *   - Echo:            `kind: 'effect'`, `statStrike` + `echoHostPower`. The
 *                       migration reclaimed "Echo" for this shape ONLY — of
 *                       the old catalog's 33 `*_echo` ids, 10 were retired
 *                       outright (8 flat-damage duplicates plus
 *                       `stunning_smash_echo` and `hamstring_echo`, both
 *                       slow duplicates), 1 (`soul_rend_echo`) became THE
 *                       Echo (`resonant_echo`), and 22 were renamed out of
 *                       the family into Sliver/Core/Charm while KEEPING
 *                       their id (only `resonant_echo` is a new id — every
 *                       other `_echo`/`_shard`/`_core` id below is
 *                       unchanged, so run saves and shop-theme references
 *                       never drifted).
 *   - Core (amp):      `kind: 'stat'`, `scope: 'card'`.
 *   - Charm (hero amp): `kind: 'stat'`, `scope: 'hero'`.
 */
const gemDefs: Record<string, GemDef> = {
  // ---- Common (2 PL / 20 deci) ----
  venom_sliver: {
    id: 'venom_sliver',
    name: 'Venom Sliver',
    kind: 'effect',
    rarity: 'common',
    // poison priced LINEARLY per stack (2026-07-23): 2 stacks × 10 deci = 20
    // deci = Common exactly (ticks 2,1 = 3 total).
    actions: [{ kind: 'poison', stacks: 2 }],
    text: 'Apply {{Poison}} 2 (poison bypasses shields).',
  },
  swift_charm: {
    id: 'swift_charm',
    name: 'Swift Charm',
    kind: 'stat',
    rarity: 'common',
    scope: 'hero',
    mods: { hero: { speed: 4 } },
    text: 'Hero: +4 SPD.',
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
    text: "{{Slow}} the enemy's next action by +8 weight.",
  },
  fireball_echo: {
    // echo of fireball. RETEXT/RENAME (gem ruleset v1 §10, 2026-08-09): a
    // burn-applying Sliver, not a repeated hit — "Echo" is reserved for
    // `resonant_echo` now. Id kept (shop-theme/demo references).
    id: 'fireball_echo',
    name: 'Ember Sliver',
    kind: 'effect',
    rarity: 'common',
    // burn priced LINEARLY per stack (2026-07-23): 2 stacks × 10 deci = 20
    // deci = Common exactly (ticks 4,2 = 6 total).
    actions: [{ kind: 'burn', stacks: 2 }],
    text: 'Apply {{Burn}} 2.',
  },
  iron_bulwark_echo: {
    // echo of iron_bulwark. A shield Sliver — flat payload (2026-08-09 engine
    // fix, gem ruleset v1 §0.B/§7.6/§9.4): no caster stat is added, so the
    // text drops the old "(+DEF/MDEF)" claim, which is false for a gem now.
    id: 'iron_bulwark_echo',
    name: 'Iron Sliver',
    kind: 'effect',
    rarity: 'common',
    actions: [{ kind: 'shield', power: 4 }],
    text: '+4 shield.',
  },
  mending_light_echo: {
    // echo of mending_light. RETEXT/RENAME + flat-payload fix (see
    // iron_bulwark_echo above): a heal Sliver, no stat add, no "(+DEF/MDEF)".
    id: 'mending_light_echo',
    name: 'Mending Sliver',
    kind: 'effect',
    rarity: 'common',
    actions: [{ kind: 'heal', power: 4 }],
    text: '+4 HP.',
  },
  time_crystal_echo: {
    // echo of time_crystal. RETEXT/RENAME: this is a Core (card-scope stat),
    // not a rider — "Sliver" was the wrong category name from the start.
    id: 'time_crystal_echo',
    name: 'Time Core',
    kind: 'stat',
    rarity: 'common',
    scope: 'card',
    mods: { card: { weightDelta: -1 } },
    text: 'This card: -1 weight (casts sooner).',
  },
  leeching_fang_echo: {
    // echo of leeching_fang
    id: 'leeching_fang_echo',
    name: 'Leeching Sliver',
    kind: 'effect',
    rarity: 'common',
    actions: [{ kind: 'lifesteal', pct: 30 }],
    text: '{{Lifesteal}} 30% of damage dealt.',
  },
  shield_splitter_echo: {
    // echo of shield_splitter. RETEXT/RENAME out of the Echo family.
    id: 'shield_splitter_echo',
    name: "Splitter's Sliver",
    kind: 'effect',
    rarity: 'common',
    actions: [{ kind: 'shieldBreak', amount: 16 }],
    text: '{{Shatter}} 16 enemy shield.',
  },
  concussive_shot_echo: {
    // echo of concussive_shot. disrupt re-priced to the escalating bracket
    // schedule (user-locked 2026-07-25, PRICE.disruptBrackets): the Common
    // band (20 deci) only affords 4 points at the entry 5-deci/point rate
    // (4*5 = 20 = Common exactly) — was amount 8 at the old flat rate.
    // RETEXT/RENAME out of the Echo family.
    id: 'concussive_shot_echo',
    name: 'Concussive Sliver',
    kind: 'effect',
    rarity: 'common',
    actions: [{ kind: 'disrupt', amount: 4 }],
    text: '{{Disrupt}} 4 banked readiness.',
  },
  armor_break_echo: {
    // echo of armor_break. RETEXT/RENAME: "Chip" carried no category suffix.
    id: 'armor_break_echo',
    name: 'Armor Sliver',
    kind: 'effect',
    rarity: 'common',
    actions: [{ kind: 'debuffStat', stat: 'armor', pct: 10, turns: 2 }],
    text: '-10% enemy DEF (2 turns).',
  },
  slow_hex_echo: {
    // echo of slow_hex. RETEXT/RENAME out of the "Whisper" naming, which
    // carried no category suffix.
    id: 'slow_hex_echo',
    name: 'Slowing Sliver',
    kind: 'effect',
    rarity: 'common',
    actions: [{ kind: 'debuffStat', stat: 'speed', pct: 10, turns: 2 }],
    text: '-10% enemy SPD (2 turns).',
  },
  judgment_light_echo: {
    // echo of judgment_light. RETEXT/RENAME: "Spark" carried no category suffix.
    id: 'judgment_light_echo',
    name: 'Judgment Sliver',
    kind: 'effect',
    rarity: 'common',
    actions: [{ kind: 'debuffStat', stat: 'magicResist', pct: 10, turns: 2 }],
    text: '-10% enemy MDEF (2 turns).',
  },
  purify_echo: {
    // Fork §12.3 DEFAULT (gem ruleset v1, 2026-08-09): stays a Common magical
    // guard rather than becoming a real cleanse gem — cleanse can't land on
    // any gem band today (PRICE.cleansePerCharge is 25 deci/charge, not a
    // multiple of 20; see the ruleset's §9.1 pricing hole). RETEXT/RENAME out
    // of the Echo family — it is a rider (Sliver), no HIT_KINDS action.
    // Retargeted OFF `true` (2026-08-06 honesty fix, see the `guard` row in
    // docs/card-text-style-guide.md) onto `magical`, a property that actually
    // triggers regularly, at the identical magnitude/price
    // (20*1*1 = 20 deci = Common exactly, unchanged).
    id: 'purify_echo',
    name: 'Warding Sliver',
    kind: 'effect',
    rarity: 'common',
    actions: [{ kind: 'guard', property: 'magical', pct: 20, turns: 1 }],
    text: '-20% incoming magical damage (1 turn).',
  },

  // ---- Rare (4 PL / 40 deci) ----
  stunning_shard: {
    // Re-themed from stun -> slow: at the re-priced stunPerTurn (100 deci)
    // a 1-turn stun is 10 PL, above every gem rarity band, so no stun gem can
    // exist. slow 16 (floor(16*5/2) = 40) = Rare exactly keeps a tempo-denial
    // theme. RETEXT/RENAME: "Shard" carried no category suffix; this is a
    // rider (Sliver). Id kept — referenced by src/game/demoState.ts.
    id: 'stunning_shard',
    name: 'Shackling Sliver',
    kind: 'effect',
    rarity: 'rare',
    actions: [{ kind: 'slow', weight: 16 }],
    text: "{{Slow}} the enemy's next action by +16 weight.",
  },
  lightweight_core: {
    id: 'lightweight_core',
    name: 'Lightweight Core',
    kind: 'stat',
    rarity: 'rare',
    scope: 'card',
    mods: { card: { weightDelta: -2 } },
    text: 'This card: -2 weight (casts sooner).',
  },
  brawlers_core: {
    // Re-fit for the 2026-07-25 heroStatPerPoint.attack repricing (8 -> 10
    // deci/pt, see PRICE.heroStatPerPoint): 4 * 10 = 40 deci = Rare exactly
    // (was attack 5 at the old 8/pt rate). RETEXT/RENAME: this is a Charm
    // (hero-scope stat), not a Core — "Core" was the wrong category name.
    id: 'brawlers_core',
    name: "Brawler's Charm",
    kind: 'stat',
    rarity: 'rare',
    scope: 'hero',
    mods: { hero: { attack: 4 } },
    text: 'Hero: +4 ATK.',
  },
  crippling_strike_echo: {
    // echo of crippling_strike. RETEXT/RENAME out of the "Whisper" naming.
    id: 'crippling_strike_echo',
    name: 'Crippling Sliver',
    kind: 'effect',
    rarity: 'rare',
    actions: [{ kind: 'debuffStat', stat: 'attack', pct: 20, turns: 2 }],
    text: '-20% enemy ATK (2 turns).',
  },
  frost_ward_echo: {
    // echo of frost_ward. RETEXT/RENAME out of the Echo family.
    id: 'frost_ward_echo',
    name: 'Frost Sliver',
    kind: 'effect',
    rarity: 'rare',
    // guard re-priced to parity (1x): 20*2*1 = 40 deci = Rare exactly (was pct 16).
    actions: [{ kind: 'guard', property: 'magical', pct: 20, turns: 2 }],
    text: '-20% incoming magical damage (2 turns).',
  },
  ward_of_silence_echo: {
    // REPLACE (gem ruleset v1 §10, 2026-08-09): was a 40%x1t magical guard
    // ("Silencer's Echo"); the catalog had no PHYSICAL guard gem at all, so
    // this slot became one instead of a second magical rung. Same band, same
    // magnitude formula, different property: 20*2*1 = 40 deci = Rare exactly.
    // Renamed out of the Echo family — it is a rider (Sliver), not a repeated
    // hit. Id kept — referenced by shop themes.
    id: 'ward_of_silence_echo',
    name: 'Aegis Sliver',
    kind: 'effect',
    rarity: 'rare',
    actions: [{ kind: 'guard', property: 'physical', pct: 20, turns: 2 }],
    text: '-20% incoming physical damage (2 turns).',
  },
  second_wind_echo: {
    // echo of second_wind. RETEXT/RENAME + flat-payload fix (see
    // iron_bulwark_echo above): a heal Sliver, no stat add, no "(+DEF/MDEF)".
    id: 'second_wind_echo',
    name: 'Renewing Sliver',
    kind: 'effect',
    rarity: 'rare',
    actions: [{ kind: 'heal', power: 8 }],
    text: '+8 HP.',
  },
  war_banner_echo: {
    // echo of war_banner. RETEXT/RENAME: this is a Core (card-scope stat).
    // Core damage text says "each hit" (gem ruleset v1 §1 R1.3) — `damageFlat`
    // is added PER damage instance, so a multi-hit host doubles it.
    id: 'war_banner_echo',
    name: 'Banner Core',
    kind: 'stat',
    rarity: 'rare',
    scope: 'card',
    mods: { card: { damageFlat: 4 } },
    text: 'This card: each hit +4 damage.',
  },
  battle_howl_echo: {
    // echo of battle_howl. RETEXT/RENAME out of the "Whisper" naming.
    id: 'battle_howl_echo',
    name: 'Battle Sliver',
    kind: 'effect',
    rarity: 'rare',
    actions: [{ kind: 'buffStat', stat: 'attack', pct: 20, turns: 2 }],
    text: '+20% ATK (2 turns).',
  },
  follow_through_echo: {
    // echo of follow_through. Re-fit for the 2026-07-23 comboPerPoint cut
    // (2.5/pt): floor(16*5/2) = 40 = Rare exactly (was amount 8 at the old
    // 5/pt rate). RETEXT/RENAME out of the Echo family — "Echo" is reserved
    // for `resonant_echo` (the only echoHostPower strike) now.
    id: 'follow_through_echo',
    name: 'Follow-Through Sliver',
    kind: 'effect',
    rarity: 'rare',
    actions: [{ kind: 'comboBonus', amount: 16 }],
    text: '{{Combo}} +16 damage (previous cast shared an archetype).',
  },
  hex_of_frailty_echo: {
    // echo of hex_of_frailty. RETEXT/RENAME out of the "Whisper" naming.
    id: 'hex_of_frailty_echo',
    name: 'Frailty Sliver',
    kind: 'effect',
    rarity: 'rare',
    actions: [{ kind: 'debuffStat', stat: 'magicResist', pct: 20, turns: 2 }],
    text: '-20% enemy MDEF (2 turns).',
  },
  venom_fang_echo: {
    // REPRICE (gem ruleset v1 §10, 2026-08-09): was poison 2 at Common (a
    // duplicate of venom_sliver's exact payload, §8 collision). 4 stacks *
    // 10 deci = 40 deci = Rare exactly, and a distinct name keeps it clear of
    // the Common rung on the same poison ladder (R8.3: same shape, different
    // band, is a legal ladder).
    id: 'venom_fang_echo',
    name: 'Venomous Sliver',
    kind: 'effect',
    rarity: 'rare',
    actions: [{ kind: 'poison', stacks: 4 }],
    text: 'Apply {{Poison}} 4 (poison bypasses shields).',
  },
  mana_ward_echo: {
    // REPRICE (gem ruleset v1 §10, 2026-08-09): was shield 4 at Common (a
    // duplicate of iron_bulwark_echo's exact payload, §8 collision). 8 * 5
    // deci = 40 deci = Rare exactly. Flat-payload fix (see iron_bulwark_echo
    // above): no stat add, no "(+DEF/MDEF)" claim.
    id: 'mana_ward_echo',
    name: 'Mana Sliver',
    kind: 'effect',
    rarity: 'rare',
    actions: [{ kind: 'shield', power: 8 }],
    text: '+8 shield.',
  },

  // ---- Epic (6 PL / 60 deci) ----
  enfeebling_shard: {
    // RETEXT/RENAME: "Shard" carried no category suffix; this is a rider (Sliver).
    id: 'enfeebling_shard',
    name: 'Enfeebling Sliver',
    kind: 'effect',
    rarity: 'epic',
    actions: [{ kind: 'debuffStat', stat: 'armor', pct: 30, turns: 2 }],
    text: '-30% enemy DEF (2 turns).',
  },
  empowering_core: {
    // Core damage text says "each hit" (gem ruleset v1 §1 R1.3) — see war_banner_echo.
    id: 'empowering_core',
    name: 'Empowering Core',
    kind: 'stat',
    rarity: 'epic',
    scope: 'card',
    mods: { card: { damageFlat: 6 } },
    text: 'This card: each hit +6 damage.',
  },
  bulwark_core: {
    // RETEXT/RENAME: this is a Charm (hero-scope stat), not a Core.
    id: 'bulwark_core',
    name: 'Bulwark Charm',
    kind: 'stat',
    rarity: 'epic',
    scope: 'hero',
    mods: { hero: { armor: 6 } },
    text: 'Hero: +6 DEF.',
  },

  // ---- Epic echo gem (60 deci) ----
  prism_barrier_echo: {
    // echo of prism_barrier. RETEXT/RENAME out of the Echo family + flat-
    // payload fix (see iron_bulwark_echo above): no stat add, no "(+DEF/MDEF)".
    id: 'prism_barrier_echo',
    name: 'Prism Sliver',
    kind: 'effect',
    rarity: 'epic',
    actions: [{ kind: 'shield', power: 12 }],
    text: '+12 shield.',
  },

  // ---- Legendary (8 PL / 80 deci) ----
  concussive_shard: {
    // Re-themed stun -> slow (a 2-turn stun is 20 PL now, far above every
    // gem band). slow 32 (floor(32*5/2) = 80) = Legendary exactly.
    // RETEXT/RENAME: "Shard" carried no category suffix; this is a rider
    // (Sliver). Id kept — referenced by src/game/demoState.ts.
    id: 'concussive_shard',
    name: 'Glacial Sliver',
    kind: 'effect',
    rarity: 'legendary',
    actions: [{ kind: 'slow', weight: 32 }],
    text: "{{Slow}} the enemy's next action by +32 weight.",
  },
  restorative_core: {
    // Core heal text: healFlat is a per-cast bonus (not per-hit like damageFlat
    // — see war_banner_echo/empowering_core), so no "each hit" qualifier.
    id: 'restorative_core',
    name: 'Restorative Core',
    kind: 'stat',
    rarity: 'legendary',
    scope: 'card',
    mods: { card: { healFlat: 8 } },
    text: 'This card: +8 HP.',
  },
  archmages_core: {
    // Re-fit for the 2026-07-25 heroStatPerPoint.magicPower repricing (8 -> 10
    // deci/pt, see PRICE.heroStatPerPoint): 8 * 10 = 80 deci = Legendary
    // exactly (was magicPower 10 at the old 8/pt rate). RETEXT/RENAME: this is
    // a Charm (hero-scope stat), not a Core.
    id: 'archmages_core',
    name: "Archmage's Charm",
    kind: 'stat',
    rarity: 'legendary',
    scope: 'hero',
    mods: { hero: { magicPower: 8 } },
    text: 'Hero: +8 MATK.',
  },

  // ---- THE Echo (80 deci) ----
  resonant_echo: {
    // REPLACE (gem ruleset v1 §6/§10, 2026-08-09): was soul_rend_echo, a flat
    // "+16 damage" chip (retired — one of the 9 flat-damage duplicates the
    // migration removed). This NEW id is THE Echo: the one gem in the catalog
    // whose hit is `statStrike` + `echoHostPower` — proportional to whichever
    // card it is socketed into (half the host's own flat base + half the
    // caster's scaling stat), so it never needs a per-skill reskin the way the
    // old flat "echo" chips did (§6.1, "one per skill" is obsolete).
    //
    // PRICE (host-blind, `isGemOnBudget`/the shop): actionsPriceDeci charges
    // an uncapped statStrike 0 (unbounded value, no honest flat rate) + the
    // extraHitPremium (30, one appended hit) + the echoRepeatDeci stand-in
    // (floor(100/2) = 50) = 80 deci = Legendary EXACTLY — the only shareOf
    // that lands on a band (see PRICE.echoRepeatDeci in balance.ts).
    //
    // weightIncreasePct 25 is the shipped default tempo cost (§6.2's one
    // PL-free tuning dial): the socketed card hits harder AND comes out later.
    id: 'resonant_echo',
    name: 'Resonant Echo',
    kind: 'effect',
    rarity: 'legendary',
    actions: [{ kind: 'statStrike', shareOf: 2, echoHostPower: true }],
    weightIncreasePct: 25,
    text: "Echo: this card's attack repeats at half strength as a separate hit, and the card is 25% heavier.",
  },
};

/**
 * THE gem book, keyed by id and built in CANONICAL (id-sorted) order.
 *
 * WHY SORTED (2026-08-09): `Object.values(gemBook)` feeds seeded-Rng pools in
 * `src/run/shop.ts`, `src/run/draft.ts` and `src/run/events.ts`, so the PHYSICAL
 * ORDER OF THIS FILE silently decided what a given run seed offered — reordering
 * or inserting a gem changed players' shops with no test going red. Canonical
 * order makes the draw a function of the CONTENT, not the file layout, which is
 * also the property a content-format migration needs (an array or a document
 * store must be free to hand rows over in any order).
 *
 * `tests/run/contentPoolOrder.test.ts` asserts this ordering.
 */
/**
 * THE DEFS-BUILT BOOK — TEMPORARY, and its ONLY consumer is the migration proof.
 *
 * `gemBook` below no longer comes from these literals: it is loaded from
 * `content/gems.v1.json`. This export exists purely so
 * `tests/data/gemsJsonParity.test.ts` can prove the JSON book is byte-identical
 * to the hand-written one. DELETE the literals (and that test) once the JSON is
 * accepted as the source of truth.
 */
export const gemBookFromDefs: Record<string, GemDef> = Object.fromEntries(
  Object.values(gemDefs)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((gem) => [gem.id, gem]),
);

/**
 * THE gem book — now loaded from `content/gems.v1.json`.
 *
 * Re-exported from here so every module already importing `gemBook` from
 * `src/data/gems` switches to the JSON source atomically, with zero import churn
 * and therefore no chance of half the app reading one book and half the other.
 */
export const gemBook: Record<string, GemDef> = gemBookFromJson;
