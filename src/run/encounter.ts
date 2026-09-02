// Encounter resolver — the run-layer bridge between "what level is this fight"
// and the fully-scaled CombatantSetup that feeds `simulate()`.
//
// This is the module the UI (Codex) should call to build a fight with TRUE
// resolved levels, instead of displaying placeholders like `enemy.baseDepth`
// or a hardcoded hero level. It is thin on purpose: level -> points curve and
// stat scaling already live in `leveling.ts`; this module just wires ids/
// board pieces to that curve and echoes back the resolved level for display.
//
// Enemy power resolves along three additive dials over the Bronze floor:
//   • LEVEL  — flat stat scaling (leveling.ts).
//   • RANK   — how many of the deck's cards are tier-upgraded, counted in
//              tier-steps summed across the deck (rank 3 on a 2-card deck =
//              one Gold card + one Silver card; max = deckSize × 3). The
//              per-card tier is stamped on `BoardPiece.tier` and the engine's
//              resolveEffectiveSkill scales that card to the tier's PL budget.
//   • CARDS  — titles/modifiers add extra cards to the base deck.
// Titles (Mob/Normal/Elite/Boss) are just named presets over (level + rank +
// extra cards). Modifiers (rogue-like affixes) are a FOURTH additive dial —
// see `MODIFIER_PRESETS` below.
//
// ELITE AFFIXES (2026-08-26) are a FIFTH dial that deliberately costs ZERO —
// see `eliteAffixIdFor` and the block above it.
// The resolver-seam pattern — no combat-loop involvement. No RNG, no Phaser.

import type { BoardPiece, CombatantSetup, EnemyDef, SkillTier } from '../engine/types';
import { enemies } from '../data/enemies';
import { skillBook } from '../data/skills';
import { BASE_HERO_STATS, HERO_BOARD_SLOTS } from '../data/heroes';
import { ELITE_AFFIX_IDS, ENEMY_MODIFIER_IDS, MODIFIER_PRESETS, type EnemyModifierPreset } from '../data/modifiers';
import { hashSeed } from '../engine/rng';
import { TIER_BUDGET_DECI } from '../engine/balance';
import {
  allocateMonsterPL,
  applyLevelAllocation,
  applyPlayerLevelAllocation,
  DEFAULT_PROFILE,
  monsterLevelPL,
  PL_PER_LEVEL,
  scaleMonsterToLevel,
  totalLevelPL,
  type Allocation,
  type StatProfile,
} from './leveling';

/** Low → high tier order; a rank tier-step moves a card one entry up this list. */
const TIER_ORDER: readonly SkillTier[] = ['bronze', 'silver', 'gold', 'diamond'];
/** Max tier-steps a single card can take (Bronze → Diamond). */
export const MAX_TIER_STEPS = TIER_ORDER.length - 1;

/** The rank ceiling for a deck of `deckSize` cards (every card at Diamond). */
export function maxRankFor(deckSize: number): number {
  return deckSize * MAX_TIER_STEPS;
}

/** Encounter-difficulty title: an additive preset on top of the base monster + level. */
export type EnemyTitle = 'mob' | 'normal' | 'elite' | 'boss';

export interface TitlePreset {
  /** Added to the requested level before scaling (effective level floors at 1). */
  levelDelta: number;
  /** Total tier-steps distributed across the deck (round-robin). */
  rank: number;
  /** Extra cards pulled from the enemy's role pool onto the base deck. */
  extraCards: number;
}

/**
 * User-locked title design (2026-07-24): titles are ± LEVELS of stat PL, one
 * rule for the whole ladder — Mob -4 levels (-12 PL, can drive the monster's
 * PL spend negative — see `scaleMonsterToLevel`/`allocateMonsterPL` in
 * leveling.ts for the "un-buy" + clamp mechanics), Normal +0, Elite +2 levels
 * (+1 card, a couple tier-up ranks), Boss +4 levels (+2 cards, more ranks).
 * `levelDelta` feeds `effectiveLevel` below, which is intentionally NOT
 * floored at 1 any more — Mob's demotion needs to be able to go negative to
 * reach `scaleMonsterToLevel`'s negative-PL un-buy path.
 *
 * These are the FULL packages. The run ladder consumes them through
 * `titlePresetFor(title, fightNumber)` (the TITLE DEPTH RAMP below), which
 * ramps elite/boss up to these values by fight `TITLE_RAMP_FULL_FIGHT` —
 * measured early-game fix, zero change at or past that fight.
 */
export const TITLE_PRESETS: Record<EnemyTitle, TitlePreset> = {
  mob: { levelDelta: -4, rank: 0, extraCards: 0 },
  normal: { levelDelta: 0, rank: 0, extraCards: 0 },
  elite: { levelDelta: 2, rank: 2, extraCards: 1 },
  boss: { levelDelta: 4, rank: 4, extraCards: 2 },
};

export const ENEMY_TITLES: EnemyTitle[] = ['mob', 'normal', 'elite', 'boss'];

// ---------------------------------------------------------------------------
// TITLE DEPTH RAMP (2026-09-02) — the run ladder consumes elite/boss packages
// through `titlePresetFor(title, fightNumber)`, which ramps UP TO the full
// `TITLE_PRESETS` package by fight 10 and NEVER past it. This is an
// EARLY-GAME fix, measured, not a global retune:
//
// The flat packages made the early curve INVERTED (probe: 40 run seeds x 3
// fight seeds per cell, real `rollEncounter` + real `simulate`, on-curve
// boards, auto stat spend, no gems):
//   • wave-5 boss #1 (full {+4,+4,+2} on a 4-5 fight-old hero): 0% win —
//     while the SAME kit at the plain normal title measured 47.5%. The
//     PACKAGE was the wall: decomposition held it at 0% under every single
//     levelDelta 0-4 and rank 0-4 while the full package SHAPE remained.
//   • waves 3-4 elites (full {+2,+2,+1}): 10% win.
//   • the SAME packages at waves 13-15: 35-50% — and the w15 boss (35%) was
//     WEAKER than its own band's optional hard rung (12.5%). The flat preset
//     is a wall at fight 5 and a speed bump at fight 15.
// So the package a title pays out now scales with the fight number: small
// where the hero owns 4-7 bronze cards, full where the package was already
// fair. Fights >= TITLE_RAMP_FULL_FIGHT are BYTE-IDENTICAL to the flat
// presets (pinned in tests/run/encounter.test.ts) — zero late-game change.
//
// ELITE `extraCards` NEVER RAMPS BELOW 1: the elite affix system installs its
// card IN PLACE of the title's generic filler (see the ELITE AFFIXES block
// below), and that zero-PL substitution needs a filler slot to consume at
// EVERY fight an elite can occur (hard options make elites from fight 1).
//
// PURE DATA, PURE FUNCTION: the ramp is a lookup on (title, fightNumber) —
// no RNG, no state — so it cannot disturb any Rng call order, map/biome
// fingerprint, or preview/committed agreement.
// ---------------------------------------------------------------------------

/** First fight number at which `titlePresetFor` pays the FULL `TITLE_PRESETS`
 * package (and forever after). */
export const TITLE_RAMP_FULL_FIGHT = 10;

/**
 * Fights 1..9 (index = fightNumber - 1) of the elite/boss package ramp.
 * `mob`/`normal` never ramp (their presets are the zero/negative floor).
 *
 * EVERY CELL BELOW WAS MEASURED, not derived (same 40x3-seed probe as the
 * block comment above; per-axis sweeps on the real rolled encounters):
 *   • The extra CARD is the heaviest axis on a boss kit early — at fight 5,
 *     triad {1,1,0} won 30% and {1,1,1} only 7.5%; the RANK step is the
 *     heaviest on early elites — {1,0,1} won 50%, {1,1,1} only 17.5%.
 *   • Boss cells serve TWO different rungs. Fights 3-4/8-9 are the OPTIONAL
 *     hard-option boss (an elite pushed one rung — it keeps the elite's
 *     filler card); fight 5 is the MILESTONE boss #1, which fields its
 *     authored signature triad un-padded (a generic filler card only dilutes
 *     the one kit the player was told to prepare for). That is why rank/
 *     extraCards dip at fight 5: milestone vs hard-rung, not one curve.
 *   • Measured at the shipped cells (on-curve boards): f3 elite 50%,
 *     f4 elite 45%, f5 boss 37.5% (was 0%), f3/f4 hard boss 5%/17.5%
 *     (was 0%), f9 hard boss ~7% (was 0%) — the hard rung stays the brutal
 *     opt-in it is deep (w14 hard: 12.5%).
 */
export const TITLE_RAMP: Record<'elite' | 'boss', readonly TitlePreset[]> = {
  elite: [
    { levelDelta: 0, rank: 0, extraCards: 1 }, // fight 1 (hard option only)
    { levelDelta: 0, rank: 0, extraCards: 1 }, // fight 2 (hard option only)
    { levelDelta: 1, rank: 0, extraCards: 1 }, // fight 3 — 10% -> 50% win
    { levelDelta: 1, rank: 0, extraCards: 1 }, // fight 4 — 10% -> 45% win
    { levelDelta: 1, rank: 1, extraCards: 1 }, // fight 5 (defensive: boss wave)
    { levelDelta: 2, rank: 2, extraCards: 1 }, // fight 6 = full package
    { levelDelta: 2, rank: 2, extraCards: 1 }, // fight 7
    { levelDelta: 2, rank: 2, extraCards: 1 }, // fight 8 — mid band already fair
    { levelDelta: 2, rank: 2, extraCards: 1 }, // fight 9
  ],
  boss: [
    { levelDelta: 1, rank: 1, extraCards: 1 }, // fight 1 (unreachable, defensive)
    { levelDelta: 1, rank: 1, extraCards: 1 }, // fight 2 (unreachable, defensive)
    { levelDelta: 1, rank: 1, extraCards: 1 }, // fight 3 (hard rung: 0% -> 5%)
    { levelDelta: 1, rank: 1, extraCards: 1 }, // fight 4 (hard rung: 0% -> 17.5%)
    { levelDelta: 1, rank: 0, extraCards: 0 }, // fight 5 — MILESTONE boss #1: 0% -> 37.5%
    { levelDelta: 2, rank: 2, extraCards: 1 }, // fight 6 (unreachable, defensive)
    { levelDelta: 2, rank: 2, extraCards: 1 }, // fight 7 (unreachable, defensive)
    { levelDelta: 3, rank: 3, extraCards: 2 }, // fight 8 (hard rung)
    { levelDelta: 3, rank: 3, extraCards: 2 }, // fight 9 (hard rung: 0% -> ~7%)
  ],
};

/**
 * The title package the run ladder pays at `fightNumber` — the ONE consumer-
 * facing ramp resolver. `fightNumber` omitted (dev tools, prep scenes, tests
 * exploring a title directly) or >= `TITLE_RAMP_FULL_FIGHT` returns the flat
 * `TITLE_PRESETS` package unchanged; `mob`/`normal` are never ramped.
 * Sub-1 fight numbers clamp to the ramp's first row (defensive only —
 * `fightSpecFor` floors at 1).
 */
export function titlePresetFor(title: EnemyTitle, fightNumber?: number): TitlePreset {
  if (fightNumber === undefined || title === 'mob' || title === 'normal') return TITLE_PRESETS[title];
  const idx = Math.floor(fightNumber) - 1;
  const ramp = TITLE_RAMP[title];
  if (idx >= ramp.length) return TITLE_PRESETS[title];
  return ramp[Math.max(0, idx)]!;
}

/**
 * Enemy MODIFIERS — the fourth additive dial (rogue-like affixes), stacked on
 * top of (level + rank + extra cards). The presets themselves (names, blurbs,
 * tuning values) are CONTENT and live in `src/data/modifiers.ts` — imported
 * above and re-exported here so every existing consumer (both prep scenes,
 * `battleTimeline.ts`, `runState.ts`, `devLaunch.ts`) keeps importing them
 * from `./encounter` unchanged. This module keeps the MECHANISM: each preset
 * is either a bonus PL auto-spend (`bonusPL` + `bonusProfile`, applied below
 * in `buildEnemyEncounter` through the SAME `LEVEL_STAT_COST` economy as
 * every other stat point in the game), a deck-wide tier override
 * (`forceTier`, applied AFTER rank assignment), or a BEHAVIOURAL AFFIX
 * (`affix: true` + `cards`, installed onto the deck in place of the title's
 * generic filler — see `eliteAffixIdFor`). Add a new affix = add a row
 * to `MODIFIER_PRESETS` in the data module; the resolver below needs no
 * changes.
 *
 * TWO POOLS: `ENEMY_MODIFIER_IDS` is the deep-run escalation ramp
 * (`fightSpecFor` slices it past `MAX_LEVEL`); `ELITE_AFFIX_IDS` is the elite
 * affix pool (`eliteAffixIdFor` deals one per elite fight). A preset is in
 * exactly one, decided by its own `affix` flag.
 */
export { ELITE_AFFIX_IDS, ENEMY_MODIFIER_IDS, MODIFIER_PRESETS, type EnemyModifierPreset };

/**
 * Shared extra-card pool keyed by the enemy's damage flavour — the GENERIC
 * FILLER a title's `extraCards` allowance draws from. All size-1 so placement
 * is trivial; deterministic (no RNG).
 *
 * Exported so `tests/run/eliteAffix.test.ts` can hold the one invariant that
 * keeps an affix legible: NO affix card may also be generic filler. Filler is
 * drawn first-unseen, so a filler card that doubles as an affix card would make
 * an affixed elite byte-identical to a plain one on every enemy whose kit
 * already contains the earlier pool entry.
 */
export const EXTRA_CARD_POOL: Record<'physical' | 'magical', readonly string[]> = {
  physical: ['sword_slash', 'venom_fang', 'crippling_strike'],
  magical: ['arcane_bolt', 'shadow_bolt', 'hex_of_frailty'],
};

/** Pick the pool matching the enemy's own deck (majority card property). */
function poolFor(enemy: EnemyDef): readonly string[] {
  let magical = 0;
  let physical = 0;
  for (const piece of enemy.pieces) {
    const skill = skillBook[piece.skillId];
    if (!skill) continue;
    if (skill.property === 'magical') magical += 1;
    else physical += 1;
  }
  return magical > physical ? EXTRA_CARD_POOL.magical : EXTRA_CARD_POOL.physical;
}

/** The next free slot after the current pieces (size-aware). */
function nextFreeSlot(pieces: BoardPiece[]): number {
  return pieces.reduce((max, p) => Math.max(max, p.slot + (skillBook[p.skillId]?.size ?? 1)), 0);
}

/**
 * Append `count` extra cards from `pool` onto a CLONE of `pieces` (never
 * mutates the shared enemy data). Prefers cards not already in the deck for
 * variety, then allows duplicates if the pool is exhausted.
 */
function addExtraCards(pieces: BoardPiece[], pool: readonly string[], count: number): BoardPiece[] {
  const result = pieces.map((p) => ({ ...p }));
  if (count <= 0 || pool.length === 0) return result;

  let slot = nextFreeSlot(result);
  const seen = new Set(result.map((p) => p.skillId));
  let added = 0;
  // First pass: fresh ids for variety.
  for (const id of pool) {
    if (added >= count) break;
    if (seen.has(id)) continue;
    result.push({ skillId: id, slot });
    slot += skillBook[id]?.size ?? 1;
    seen.add(id);
    added += 1;
  }
  // Second pass: allow duplicates to reach the requested count.
  while (added < count) {
    const id = pool[added % pool.length]!;
    result.push({ skillId: id, slot });
    slot += skillBook[id]?.size ?? 1;
    added += 1;
  }
  return result;
}

// ---------------------------------------------------------------------------
// ELITE AFFIXES (2026-08-26) — what makes an `elite` a DIFFERENT problem
// instead of a bigger one.
//
// THE PROBLEM THIS FIXES. `elite` was a pure STAT RUNG: +2 levels, +2 rank,
// +1 generic filler card off `EXTRA_CARD_POOL` (a plain `sword_slash` or
// `arcane_bolt`). Combat here is fully automatic, so a fight that is only
// numerically bigger asks the player NOTHING — there is no decision attached
// to it, and nothing about their deck matters differently. The only place a
// title can create interest is by changing WHAT THE PLAYER'S DECK HAS TO
// ANSWER.
//
// THE SHAPE. Every elite fight carries EXACTLY ONE affix, dealt from
// `ELITE_AFFIX_IDS`. An affix installs an authored card onto the elite's deck
// IN PLACE OF the title's generic filler (see `buildEnemyEncounter`), so the
// elite fields a readable behaviour — a physical-only shield wall, thorns that
// sting per hit, a magical negate, a lifesteal drain — instead of a slightly
// larger number.
//
// PL-HONEST BY CONSTRUCTION, NOT BY TUNING. Every bronze card in this game
// audits to exactly ONE bronze tier budget (`TIER_BUDGET_DECI.bronze` = 100
// deci — that is what `powerLevelDeci`'s tier-budget audit enforces across the
// whole book). An affix swaps one bronze filler card for one bronze affix
// card, at the same slot, so:
//   • the deck's CARD COUNT is unchanged,
//   • `assignRankTiers` distributes the SAME rank over the SAME slots,
//   • `soloThreatDeci` / `memberDeckDeci` price the deck identically,
//   • and no affix STRENGTH was ever chosen, so none can be mis-tuned.
// This is the locked balance philosophy taken literally: the affix's cost is
// honest (zero, because it is a substitution) and every outcome is emergent.
// `memberDeckDeci` still PRICES any overflow past the title's own filler
// allowance, so a future multi-card affix cannot slip in free.
//
// NO Rng DRAW, EVER. Choosing an affix with the node's `Rng` would shift every
// downstream roll in `rollEncounter` (enemy ids, pack variants) and move the
// frozen map/encounter fingerprints. So the deal follows `biome.ts`'s
// precedent exactly: its OWN `hashSeed` domain keyed on (seed, fight number),
// no `Rng` instance at all, independent of when it is asked.
//
// BOSSES DO NOT GET AFFIXES (the design fork, decided here). A boss is already
// telegraphed BY NAME — the band biome's boss shortlist names it a whole band
// ahead, and `TITLE_PRESETS.boss` (+4 levels / +4 rank / +2 cards) scales that
// authored kit up; its own card list IS its behavioural signature, and a
// rolled affix layered on top would blur the one fight the player can prepare
// for specifically. Affixes are therefore what DISTINGUISHES elite from boss:
// the ladder alternates a rolled-shape problem (elite) with a known-shape one
// (boss), instead of stacking both onto the same rung.
// ---------------------------------------------------------------------------

/**
 * The affix id dealt to the elite fight at `fightNumber` of run `seed` — pure,
 * integer-only, and independent of every other draw in the run (its own
 * `hashSeed` domain, no `Rng` instance at all, so it cannot perturb
 * `rollEncounter`'s call order no matter when it is asked). Same idiom, and
 * the same reason, as `biomeIdForBand` in `biome.ts`.
 *
 * Keyed on the FIGHT NUMBER, not the node id, so all three of a fight
 * column's risk options (easy/medium/hard) agree about which affix that rung
 * of the ladder carries — the player reads one affix per fight, whichever
 * option they take, and the map preview cannot disagree with the fight.
 */
export function eliteAffixIdFor(seed: number, fightNumber: number): string {
  const n = ELITE_AFFIX_IDS.length;
  if (n === 0) throw new Error('eliteAffixIdFor: the elite affix pool is empty');
  const h = hashSeed('eliteAffix', seed, Math.max(1, Math.floor(fightNumber)));
  return ELITE_AFFIX_IDS[h % n]!;
}

/** Validate an affix id and hand back its preset. Throws on an unknown id, or
 * on a modifier that is not flagged `affix: true` — a typo'd or mis-flagged
 * affix must scream, not silently produce a plain elite. */
export function eliteAffixPreset(affixId: string): EnemyModifierPreset {
  const preset = MODIFIER_PRESETS[affixId];
  if (!preset) throw new Error(`eliteAffixPreset: unknown affix id "${affixId}"`);
  if (preset.affix !== true) {
    throw new Error(`eliteAffixPreset: modifier "${affixId}" is not an affix (it belongs to the deep-run escalation pool)`);
  }
  return preset;
}

/** The card ids an affix installs (empty for no affix). */
function affixCardsFor(affixId: string | null | undefined): readonly string[] {
  if (!affixId) return [];
  return eliteAffixPreset(affixId).cards ?? [];
}

/**
 * Append NAMED cards onto a CLONE of `pieces`, in list order, at the next free
 * slots. Unlike `addExtraCards` there is no dedupe pass: an affix names the
 * exact card it installs, so if the enemy already runs one it gets a second
 * copy rather than the affix silently doing nothing.
 */
function addNamedCards(pieces: BoardPiece[], ids: readonly string[]): BoardPiece[] {
  const result = pieces.map((p) => ({ ...p }));
  let slot = nextFreeSlot(result);
  for (const id of ids) {
    result.push({ skillId: id, slot });
    slot += skillBook[id]?.size ?? 1;
  }
  return result;
}

/**
 * Stamp per-card tiers from a deck-wide `rank`, distributing tier-steps
 * round-robin across the deck in slot order: step 1 upgrades the first card to
 * Silver, step 2 the second, step 3 the first to Gold, etc. So rank 3 on a
 * 2-card deck yields one Gold + one Silver card. Returns a CLONE. Rank is
 * clamped to the deck's ceiling (deckSize × 3).
 */
export function assignRankTiers(pieces: BoardPiece[], rank: number): BoardPiece[] {
  const clone = pieces.map((p) => ({ ...p }));
  const n = clone.length;
  if (n === 0 || rank <= 0) return clone;

  const total = Math.min(Math.floor(rank), maxRankFor(n));
  const bySlot = [...clone].sort((a, b) => a.slot - b.slot);
  const base = Math.floor(total / n);
  const remainder = total % n;
  bySlot.forEach((piece, i) => {
    const steps = Math.min(MAX_TIER_STEPS, base + (i < remainder ? 1 : 0));
    const baseIdx = TIER_ORDER.indexOf(skillBook[piece.skillId]?.tier ?? 'bronze');
    piece.tier = TIER_ORDER[Math.min(MAX_TIER_STEPS, baseIdx + steps)]!;
  });
  return clone;
}

/** The natural title for an enemy's authored encounter role (`isElite`/`isBoss` tags). */
export function defaultTitleFor(enemy: EnemyDef): EnemyTitle {
  return enemy.isBoss ? 'boss' : enemy.isElite ? 'elite' : 'normal';
}

/** A resolved combatant ready for `simulate()`, plus the inputs that produced it. */
export interface EncounterUnit {
  setup: CombatantSetup;
  /** The requested (display) level, clamped to >= 1. */
  level: number;
  /**
   * The level actually scaled to: requested + title delta. UNCLAMPED — a
   * demoted title (Mob, -4) can drive this below 1 (even negative), which is
   * intentional: it feeds directly into `scaleMonsterToLevel`'s signed PL
   * spend, letting Mob "un-buy" stats below the universal floor.
   */
  effectiveLevel: number;
  title: EnemyTitle;
  /** Tier-steps applied across the deck (after clamping to the ceiling). */
  rank: number;
  enemyId: string;
  /** Modifier ids applied (validated against MODIFIER_PRESETS). The DEEP-RUN
   * escalation stack only — an elite affix is NOT in here, it has its own
   * field below, so `modifiers.length` (which `battleGoldReward` reads as a
   * difficulty term) keeps meaning exactly what it meant before affixes. */
  modifiers: string[];
  /**
   * The ELITE AFFIX this unit carries, or `null`. Exactly one or none, by
   * shape rather than by convention — this is the field the map preview and
   * the prep screen read to name the affix BEFORE the fight
   * (`previewEncounter` in `src/game/runStore.ts` returns these units
   * verbatim, and it is the SAME `rollEncounter` call the FIGHT button makes,
   * so preview and fight can never disagree). Look the id up in
   * `MODIFIER_PRESETS` for its `name`/`blurb`.
   */
  affix: string | null;
}

// ---------------------------------------------------------------------------
// PACK FIGHTS (2026-08-04) — a fight-column node can roll as a PACK (2-3
// LOWER-LEVEL foes) instead of one foe at the node's full track level, so
// packs feel "fair but different" (action economy vs. individual strength)
// rather than just "more HP to chew through". Every dial below is a NAMED,
// exported constant so a later balance pass can retune the mix/discount
// without touching the roll flow itself — the one place that actually spends
// a node's `encounterSeed` on these rolls is `rollEncounter` in runState.ts
// (it owns the Rng + node lookup; this module stays the pure per-unit
// resolver, same split as everywhere else in this file).
// ---------------------------------------------------------------------------

/** How many enemies a fight node's PACK roll can produce. `'solo'` is the
 * pre-pack behavior (and the large majority of rolls — see
 * `PACK_VARIANT_WEIGHTS`). */
export type PackVariant = 'solo' | 'pair' | 'trio';

/** Unit count per variant. */
export const PACK_SIZE: Record<PackVariant, number> = { solo: 1, pair: 2, trio: 3 };

/**
 * VARIANT MIX — rolled via a single `rng.int(100)` compared against these
 * weights in fixed (solo, pair, trio) order (must sum to 100). v1 mix: mostly
 * solo, packs as a minority flavor so "one strong foe" stays the default read
 * of a fight node. BOSS nodes never roll a variant at all (always `'solo'`,
 * see `rollEncounter`) — packs are a non-boss fight-column texture only.
 */
export const PACK_VARIANT_WEIGHTS: Record<PackVariant, number> = {
  solo: 70,
  pair: 20,
  trio: 10,
};

/**
 * TITLE CAP — pack members are `mob`/`normal` titles only in v1 (no elite or
 * boss packs): stacking a scarier per-unit RANK on top of the extra
 * casts-per-round pack members already bring would double-count the same
 * difficulty axis twice. A pack node's base title/level still comes from the
 * SAME `fightTableEntryForNode` spec a solo node on that column would use —
 * so a `'hard'` fight-option's +1 level still lands on every member, and its
 * title bump (normal -> elite) is simply capped back down to `'normal'` here
 * rather than skipped outright. No second budget path: this is a pure clamp
 * over the existing title dial.
 */
export function capPackTitle(title: EnemyTitle): EnemyTitle {
  return title === 'elite' || title === 'boss' ? 'normal' : title;
}

// ---------------------------------------------------------------------------
// BUDGET-DERIVED PACK MEMBERS (balance-designer pass 2026-08-04, RE-SHAPED
// 2026-08-30) — every pack is pinned to an honest PL budget instead of a
// hand-picked level offset. The CURRENCY is deci-PL, the same one the card
// and gem audits use; the three terms are:
//
//   • STAT PL   — `levelStatDeci`: the monster stat scaling a level buys
//                 (`monsterLevelPL`, 3 PL/level, the exact constant the
//                 player and every monster level up through) plus any
//                 `bonusPL` modifier auto-spend, which is per-BODY.
//   • BOARD PL  — `memberDeckDeci`: the tier budget of the board a body
//                 ships (`TIER_BUDGET_DECI` per card, the exact currency
//                 `powerLevelDeci`'s tier-budget audit prices every kit
//                 against).
//   • THE NODE  — `soloThreatDeci(level, title)`: what a SOLO foe at this
//                 node costs, stat + board. The hero levels once per fight,
//                 so the solo threat at a node IS the fair reference.
//
// THE 2026-08-30 BUG, AND WHAT IT TAUGHT. The first cut of this model taxed
// the node's solo threat by a flat `PACK_ACTION_ECONOMY_TAX_PCT` (30%) per
// extra member, split the taxed remainder K ways, and made each member buy a
// FULL board out of its share:
//
//     stat = soloThreat / (K * (1 + tax*(K-1)))  -  board  -  bonus
//
// The two subtracted terms are FIXED — a body's board is not negotiable —
// while the share they come out of shrank by a factor of K AND by the tax.
// At K=2 that leaves the board term with a coefficient of −(1 − 1/2.6) =
// −0.615: a member paid 100% of a board out of 38.5% of a solo. Level, the
// only dial that flexes, absorbed the whole shortfall and floored out, so a
// pack member's level stopped tracking the wave at all — seed 4242 solved
// LV1 at wave 47 and LV14 at wave 34. Worse, the DIAMOND deep-run escalation
// modifier (`forceTier`) triples every board's price past fight 40, so the
// fixed term GREW with depth while the share grew only linearly. A pack was
// spending its whole budget on card tiers riding bodies with 135 HP.
//
// The root cause is a DOUBLE CHARGE. The action-economy tax exists to price
// "K-1 extra full turns of casts per round" — and those extra casts ARE the
// extra boards. The model charged for them twice: once as a percentage off
// the top, and again as K boards billed at list price out of the taxed
// shares. A multiplicative tax also cannot price a fixed cost: it over-grants
// where the board is most of the node's worth (early) and under-grants where
// stats are (deep), so the bias is wave-dependent by construction.
//
// THE SHAPE (2026-08-30): PAY FOR THE EXTRA BOARDS ONCE, AT LIST PRICE.
// A pack's action-economy premium is exactly its K-1 EXTRA BOARDS, and this
// currency can already name their price. So the ledger is a plain identity —
// no percentage anywhere:
//
//     K * (stat + board + bonus)  =  soloThreatDeci(node)
//
// The node's solo threat is the whole budget; the roster's boards are bought
// out of it at list price (`packRosterCostDeci`); whatever is left is the
// pack's stat pool, split evenly across a homogeneous roster and solved into
// ONE member level. A pack is therefore worth exactly what the solo it
// replaces is worth, at every depth, with no tuning constant in the loop —
// which is the locked balance philosophy taken literally (`docs/design-locked.md`:
// PL is the balance unit, prices are honest, outcomes are emergent).
//
// WHAT THIS BUYS. The board term's coefficient drops from −0.615 to −1/K of
// a budget that no longer shrank, so member level tracks the node's level
// again (seed 4242: wave 21 LV2 -> LV6, wave 47 LV1 -> LV10, wave 61 LV11 ->
// LV22), and `packThreatDeci` lands on `soloThreatDeci` to within one member
// level of integer rounding — the tight invariant `tests/run/packFights.test.ts`
// now pins, and the reason a HARD column option can no longer be materially
// weaker than its own EASY one.
//
// IF THE POOL CANNOT AFFORD LEVEL 1 for every member, the caller MUST fall
// back to a solo encounter — a pack is never shipped over the node's budget
// (see `rollEncounter` in runState.ts). That floor is what keeps early packs
// out on its own: two Bronze boards already out-cost a low node's whole
// threat, so pairs only become affordable around node level 11 and trios
// around 21, with `MIN_PACK_FIGHT_NUMBER` as the explicit backstop for
// fight 1.
//
// TWO SOLVES, AND WHY. `REFERENCE_ENEMY_DECK_SIZE` prices a board generically
// — without knowing which enemy id a member will roll — as the WORST CASE
// (largest) base card count across the roster, derived live from `enemies`
// rather than hand-typed. `resolvePackMemberLevel` uses it, so it stays a pure
// function of (level, title, size, modifiers) that a preview or a test can ask
// without a roll, and because it prices the LARGEST possible board it can only
// ever UNDER-state a member's level, never ship a pack over budget.
//
// That conservatism has a cost, and it was measured: the roster runs 23
// two-card enemies against 36 three-card ones, and the DIAMOND escalation
// modifier multiplies every card by 2.5, so the worst-case hedge burned up to
// 250 deci per member — a fifth of a deep node's whole budget, spent on cards
// that were never fielded. `resolvePackRosterLevel` therefore re-solves the
// SAME identity against the boards the drawn roster actually ships, and
// `rollEncounter` uses that. This does NOT entangle the roll order, which was
// the original reason for the hedge: the VIABILITY decision (pack or fall back
// to solo — the only thing that can change how many enemy-id draws a node
// spends) is still made from the generic solve BEFORE any id is drawn, and the
// exact solve only ever refines the level UPWARD from there. Same draws, same
// order, same count.
// ---------------------------------------------------------------------------

/** See the rationale block above — the largest base deck size in the roster. */
export const REFERENCE_ENEMY_DECK_SIZE = Math.max(2, ...Object.values(enemies).map((e) => e.pieces.length));

/**
 * The tier-budget PL (deci) of a round-robin `rank`-tiered deck of
 * `deckSize` ALL-BRONZE base cards — the exact distribution
 * `assignRankTiers` performs, but summed to a PL total instead of stamped
 * onto pieces (every authored enemy card ships Bronze at the floor; see
 * `REFERENCE_ENEMY_DECK_SIZE`). Mirrors `maxRankFor`'s ceiling clamp.
 */
function deckThreatDeci(deckSize: number, rank: number): number {
  if (deckSize <= 0) return 0;
  const total = Math.min(Math.max(0, Math.floor(rank)), maxRankFor(deckSize));
  const base = Math.floor(total / deckSize);
  const remainder = total % deckSize;
  let deci = 0;
  for (let i = 0; i < deckSize; i++) {
    const steps = Math.min(MAX_TIER_STEPS, base + (i < remainder ? 1 : 0));
    deci += TIER_BUDGET_DECI[TIER_ORDER[steps]!];
  }
  return deci;
}

/** The `forceTier` modifier in `modifierIds` (if any) — `buildEnemyEncounter`
 * applies AT MOST one (`.find`, first match wins); mirrored here so the
 * budget model prices the SAME override it actually ships. */
function forceTierFor(modifierIds: readonly string[]): SkillTier | undefined {
  for (const id of modifierIds) {
    const forceTier = MODIFIER_PRESETS[id]?.forceTier;
    if (forceTier) return forceTier;
  }
  return undefined;
}

/** Sum of every `bonusPL` modifier in `modifierIds` (deci) — the SAME PL
 * `buildEnemyEncounter` auto-spends via `allocateMonsterPL(mod.bonusPL, ...)`
 * for EVERY member (pack members and solo alike each roll the encounter's
 * full modifier list independently — see `rollEncounter`), so it must be
 * priced into both `soloThreatDeci` and each member's own share. */
function modifierBonusDeci(modifierIds: readonly string[]): number {
  let deci = 0;
  for (const id of modifierIds) {
    const preset = MODIFIER_PRESETS[id];
    if (preset?.bonusPL) deci += preset.bonusPL * 10;
  }
  return deci;
}

/** The fixed board-threat PL (deci) every member at `title` ships — its
 * rank/extraCards come straight from the title package (`titlePresetFor`:
 * the depth-ramped package when `fightNumber` is given, the flat
 * `TITLE_PRESETS` otherwise), never a second dial.
 * A `forceTier` modifier (e.g. DIAMOND-POWERED) overrides the rank-tiered
 * deck entirely, matching `buildEnemyEncounter`'s post-rank tier override.
 *
 * An `affixId`'s cards CONSUME the title's own `extraCards` allowance first
 * (exactly as `buildEnemyEncounter` installs them), so today's one-card
 * affixes against Elite's one filler slot add ZERO here — the substitution is
 * free by construction, not by an assumption. Anything an affix names PAST
 * that allowance grows the deck and is priced as the extra cards it is. */
function memberDeckDeci(
  title: EnemyTitle,
  modifierIds: readonly string[] = [],
  affixId: string | null = null,
  fightNumber?: number,
): number {
  const preset = titlePresetFor(title, fightNumber);
  const affixCards = affixCardsFor(affixId).length;
  const deckSize = REFERENCE_ENEMY_DECK_SIZE + Math.max(preset.extraCards, affixCards);
  const forceTier = forceTierFor(modifierIds);
  if (forceTier) return deckSize * TIER_BUDGET_DECI[forceTier];
  return deckThreatDeci(deckSize, preset.rank);
}

/**
 * Total threat PL (deci) of the SOLO encounter this node would build at
 * `level`/`title`/`modifierIds` — the depth-derived "vs player" reference
 * (see the rationale block above). `level` is the node's requested (track)
 * level, NOT yet title-shifted; `effectiveLevel` (title-shifted) is what
 * actually feeds the stat-PL term, matching `buildEnemyEncounter`'s own
 * scaling order. `modifierIds` prices the SAME modifier stack every member
 * (pack or solo) independently rolls — see `modifierBonusDeci`/`memberDeckDeci`.
 * `affixId` prices the elite affix this node would deal (`eliteAffixIdFor`);
 * it is free today (a one-for-one card substitution) and priced if a future
 * affix ever grows the deck past the title's own filler allowance.
 * `fightNumber` selects the depth-ramped title package (`titlePresetFor`) —
 * pass the node's fight number to price what the ladder actually ships at
 * that rung; omit it for the flat reference package.
 */
export function soloThreatDeci(
  level: number,
  title: EnemyTitle,
  modifierIds: readonly string[] = [],
  affixId: string | null = null,
  fightNumber?: number,
): number {
  return levelStatDeci(level, title, fightNumber)
    + modifierBonusDeci(modifierIds)
    + memberDeckDeci(title, modifierIds, affixId, fightNumber);
}

/**
 * The STAT-PL (deci) a body at `level`/`title` carries — `monsterLevelPL` over
 * the title-shifted level, floored at 0 (a demoted title can drive the
 * effective level below 1; that un-buy is real in `scaleMonsterToLevel` but it
 * is not NEGATIVE threat). Modifier `bonusPL` is deliberately NOT here: it is
 * a per-BODY auto-spend, so a K-member roster pays it K times and it belongs
 * with the roster cost (`packRosterCostDeci`), not with the node's one level.
 */
function levelStatDeci(level: number, title: EnemyTitle, fightNumber?: number): number {
  return Math.max(0, monsterLevelPL(clampLevel(level) + titlePresetFor(title, fightNumber).levelDelta)) * 10;
}

/**
 * THE ACTION-ECONOMY PREMIUM, ITEMISED. What a `size`-member roster costs
 * before a single point of stats is bought: `size` boards at list price plus
 * `size` copies of the modifier stat bonus every member independently
 * auto-spends (`rollEncounter` hands the SAME `entry.modifiers` to every
 * member, exactly like the solo path). The K-1 boards past the first ARE the
 * "K-1 extra full turns of casts per round" a pack brings — this function is
 * the whole price of that, in the same currency as everything else, replacing
 * the 2026-08-04 percentage tax that charged for them a second time (see the
 * rationale block above).
 */
export function packRosterCostDeci(
  size: number,
  memberTitle: EnemyTitle,
  modifierIds: readonly string[] = [],
): number {
  const k = Math.max(1, Math.floor(size));
  return k * (memberDeckDeci(memberTitle, modifierIds, null) + modifierBonusDeci(modifierIds));
}

/**
 * The threat PL (deci) a `size`-member roster of `memberLevel`/`memberTitle`
 * bodies actually SHIPS — the left-hand side of the ledger identity
 * `packThreatDeci(...) === soloThreatDeci(node)`. Exported because it is the
 * only honest way to check the solve: it re-prices the resolved roster from
 * its own resolved level rather than re-running the solver's arithmetic.
 */
export function packThreatDeci(
  memberLevel: number,
  size: number,
  memberTitle: EnemyTitle,
  modifierIds: readonly string[] = [],
): number {
  const k = Math.max(1, Math.floor(size));
  return k * levelStatDeci(memberLevel, memberTitle) + packRosterCostDeci(k, memberTitle, modifierIds);
}

/**
 * Solve the ONE level every member of a `size`-member pack rolls at, so the
 * roster's TOTAL threat lands on (never over) the node's own solo budget:
 *
 *     size * (stat + board + bonus)  =  soloThreatDeci(level, title, ...)
 *
 * Every member is capped to `capPackTitle(title)` (mob/normal — see
 * `capPackTitle`) and ships that title's board plus the FULL modifier stack;
 * those are the roster's FIXED cost (`packRosterCostDeci`), bought out of the
 * node's budget at list price, and the K-1 boards past the first are exactly
 * what a pack's action economy is. Whatever the budget has left is the stat
 * pool, split evenly (packs stay a single homogeneous roster) and solved into
 * a level. There is no percentage anywhere in this: see the rationale block
 * above for why a multiplicative tax could not price a fixed per-body cost.
 *
 * Returns `null` when the roster's fixed cost alone would exceed the node's
 * budget — i.e. not even LEVEL 1 (0 PL of stats) fits. The caller
 * (`rollEncounter`) MUST fall back to a solo encounter in that case; a pack is
 * never shipped over budget. That floor is also what keeps early packs out
 * without a hand-picked wave: two Bronze boards already out-cost a low node's
 * whole threat.
 *
 * `affixId` prices the elite affix this NODE would deal into the budget it
 * hands the pack. The MEMBERS never carry it — `capPackTitle` drops elite to
 * normal and an affix belongs to the elite title — so any PL an affix costs
 * past the title's own filler allowance is handed to the pack as LEVEL
 * instead. It is free today (a one-for-one card substitution), and this term
 * is what keeps that true by construction rather than by assumption.
 *
 * `fightNumber` ramps the NODE's budget only (`titlePresetFor` on the node's
 * elite/boss title). The members' own cost is untouched by it: they are
 * mob/normal (`capPackTitle`), which never ramp.
 */
export function resolvePackMemberLevel(
  level: number,
  title: EnemyTitle,
  size: number,
  modifierIds: readonly string[] = [],
  affixId: string | null = null,
  fightNumber?: number,
): number | null {
  const k = Math.max(1, Math.floor(size));
  if (k <= 1) return clampLevel(level);
  const memberTitle = capPackTitle(title);
  // The BUDGET is what a SOLO foe at this node would cost, affix included.
  const budgetDeci = soloThreatDeci(level, title, modifierIds, affixId, fightNumber);
  // The ROSTER's fixed cost: k boards + k modifier auto-spends, list price.
  const statPoolDeci = budgetDeci - packRosterCostDeci(k, memberTitle, modifierIds);
  if (statPoolDeci < 0) return null;
  const memberStatDeci = Math.floor(statPoolDeci / k);
  const memberLevel = 1 + Math.floor(memberStatDeci / (PL_PER_LEVEL * 10));
  return memberLevel >= 1 ? memberLevel : null;
}

/**
 * The board-threat PL (deci) the enemies in `enemyIds` ACTUALLY ship at
 * `title` — the same sum `memberDeckDeci` estimates, but over each enemy's own
 * authored deck size instead of `REFERENCE_ENEMY_DECK_SIZE`. Every authored
 * enemy card is Bronze at the floor (`tests/data` holds that), so the rank
 * distribution and any `forceTier` override price exactly as
 * `buildEnemyEncounter` stamps them. An unknown id falls back to the generic
 * worst case, so a bad id can never under-price a roster.
 */
export function rosterDeckDeci(
  enemyIds: readonly string[],
  title: EnemyTitle,
  modifierIds: readonly string[] = [],
): number {
  const preset = TITLE_PRESETS[title];
  const forceTier = forceTierFor(modifierIds);
  let deci = 0;
  for (let i = 0; i < enemyIds.length; i++) {
    const enemy = enemies[enemyIds[i]!];
    const deckSize = (enemy?.pieces.length ?? REFERENCE_ENEMY_DECK_SIZE) + preset.extraCards;
    deci += forceTier ? deckSize * TIER_BUDGET_DECI[forceTier] : deckThreatDeci(deckSize, preset.rank);
  }
  return deci;
}

/**
 * The EXACT counterpart of `resolvePackMemberLevel`: the same ledger identity
 *
 *     rosterStat + rosterBoards + rosterBonus  =  soloThreatDeci(node)
 *
 * solved against the boards `enemyIds` actually ships (`rosterDeckDeci`)
 * rather than the generic worst case. `rollEncounter` calls this AFTER the
 * per-member enemy-id draws, which is safe precisely because the pack/solo
 * decision — the only thing that changes how many draws a node spends — was
 * already made from the generic solve. Since the actual boards can only be
 * SMALLER than the worst case, this can only raise the level, never lower it,
 * and never returns `null` where `resolvePackMemberLevel` did not.
 */
export function resolvePackRosterLevel(
  enemyIds: readonly string[],
  level: number,
  title: EnemyTitle,
  modifierIds: readonly string[] = [],
  affixId: string | null = null,
  fightNumber?: number,
): number | null {
  const k = enemyIds.length;
  if (k <= 1) return clampLevel(level);
  const memberTitle = capPackTitle(title);
  const budgetDeci = soloThreatDeci(level, title, modifierIds, affixId, fightNumber);
  const statPoolDeci = budgetDeci
    - rosterDeckDeci(enemyIds, memberTitle, modifierIds)
    - k * modifierBonusDeci(modifierIds);
  if (statPoolDeci < 0) return null;
  const memberStatDeci = Math.floor(statPoolDeci / k);
  const memberLevel = 1 + Math.floor(memberStatDeci / (PL_PER_LEVEL * 10));
  return memberLevel >= 1 ? memberLevel : null;
}

/**
 * EARLY-GAME GATE (2026-08-04) — no pack rolls before fight number
 * `MIN_PACK_FIGHT_NUMBER`: the very first fight (fight 1 / wave 1) always
 * builds a solo encounter, full stop, regardless of what the budget solve
 * above would otherwise allow. Gating on the fight NUMBER (the track
 * identity), not the resolved level, matters because a `'hard'` fight-option
 * bumps level +1 on TOP of the base fight-1 spec — gating on level alone
 * would let fight 1's hard option roll a pack the instant its level ticked
 * up, defeating "the very first fight is always solo."
 *
 * THIS CONSTANT NOW CARRIES THE EARLY GAME ON ITS OWN (2026-08-30). Before
 * the pack re-shape the ledger ALSO happened to floor out for most of the
 * early ladder — but only because it was double-charging the roster's boards,
 * which is the bug that was fixed, not a design. On the honest ledger two
 * Bronze boards still out-cost a low node's whole threat, so a normal-titled
 * pair is unaffordable below node level 11 and a trio below 21. Wave 1
 * is 0% packs, by this constant and nothing else. If the early game should
 * stay solo for longer, THIS is the dial to move — not the ledger, which is
 * now the same at every depth.
 *
 * (2026-09-02, title depth ramp) An elite-titled node used to be worth enough
 * for a pair from level 3, so packs began at fight 2 (8% of wave-2 nodes).
 * The ramped early elite/boss packages are worth less, so the budget floor
 * pushes the first packs back on its own: re-measured over the same 40 seeds,
 * the first pack rolls now land at wave 4's hard option (12.5% of those
 * nodes; 0% anywhere on waves 1-3). No change to this constant — the ramp
 * moved the ledger's own floor.
 */
export const MIN_PACK_FIGHT_NUMBER = 2;

/**
 * A resolved fight-node encounter: `variant` says how many foes, `units` is
 * that many independently-rolled `EncounterUnit`s in roster order (`'solo'`
 * is always exactly `units.length === 1`, byte-identical to calling
 * `buildEnemyEncounter` once directly — the pre-pack shape). Every consumer
 * that used to read a single `EncounterUnit` off `rollEncounter` now reads
 * `units[0]` for "the primary foe" (name/LV/title previews, etc.) and the
 * full `units` array when it needs the whole pack (battle team, gold reward).
 */
export interface EncounterPack {
  variant: PackVariant;
  units: EncounterUnit[];
}

/** Clamp any requested level to the valid floor (level 1 = no points spent). */
function clampLevel(level: number): number {
  return Math.max(1, Math.floor(level));
}

/**
 * Resolve an enemy encounter along the dials. `title` picks a preset;
 * `rankOverride` (if given) replaces the title's rank so the prep UI can tune
 * it directly; `modifiers` stacks deep-run modifiers from `MODIFIER_PRESETS`;
 * `affix` installs ONE behavioural affix (see the ELITE AFFIXES block above).
 * Order: scale stats to the effective level → apply modifier stat bonuses →
 * install the affix's cards → backfill the title's remaining generic filler
 * cards → distribute rank as per-card tiers → apply modifier tier overrides.
 * Throws on an unknown enemy, modifier OR affix id (a typo'd affix must
 * scream, not silently produce an easier fight).
 *
 * THE AFFIX CARDS GO IN FIRST, AND THEY EAT THE FILLER ALLOWANCE. The title's
 * `extraCards` count is spent on the affix's cards before any generic filler
 * is drawn, so an elite (1 extra card) fielding a 1-card affix has the SAME
 * card count at the SAME slots as a plain elite — identical rank distribution,
 * identical tier budget, zero PL added. That substitution is the whole reason
 * an affix reads as a different problem rather than a bigger one.
 *
 * `fightNumber` (the run ladder's rung, from `rollEncounter`) selects the
 * DEPTH-RAMPED title package via `titlePresetFor` — see the TITLE DEPTH RAMP
 * block above. Omitted (dev tools, prep scenes, direct callers) = the flat
 * `TITLE_PRESETS` package, byte-identical to the pre-ramp behavior.
 */
export function buildEnemyEncounter(
  enemyId: string,
  level: number,
  title: EnemyTitle = 'normal',
  rankOverride?: number,
  modifiers: readonly string[] = [],
  affix: string | null = null,
  fightNumber?: number,
): EncounterUnit {
  const enemy = enemies[enemyId];
  if (!enemy) {
    throw new Error(`buildEnemyEncounter: unknown enemy id "${enemyId}"`);
  }
  const presets = modifiers.map((id) => {
    const preset = MODIFIER_PRESETS[id];
    if (!preset) throw new Error(`buildEnemyEncounter: unknown modifier id "${id}"`);
    return preset;
  });
  const preset = titlePresetFor(title, fightNumber);
  const resolvedLevel = clampLevel(level);
  const effectiveLevel = resolvedLevel + preset.levelDelta;
  const scaled = scaleMonsterToLevel(enemy, effectiveLevel);

  // Modifier stat bonuses — positive PL auto-spends through the same priced
  // economy as level scaling (never need the negative-spend clamp).
  let stats = scaled.stats;
  for (const mod of presets) {
    if (!mod.bonusPL || !mod.bonusProfile) continue;
    const profile: StatProfile = { maxHp: 0, attack: 0, magicPower: 0, armor: 0, magicResist: 0, speed: 0, ...mod.bonusProfile };
    stats = applyLevelAllocation(stats, allocateMonsterPL(mod.bonusPL, profile));
  }

  // AFFIX CARDS FIRST — they consume the title's filler allowance (see the
  // doc comment above); `addExtraCards` then backfills whatever is left, and
  // its own dedupe pass already sees the affix card because it reads the
  // pieces it is handed.
  const affixCards = affixCardsFor(affix);
  const withAffix = addNamedCards(scaled.pieces, affixCards);
  const fillerCount = Math.max(0, preset.extraCards - affixCards.length);
  const withCards = addExtraCards(withAffix, poolFor(enemy), fillerCount);
  let rank = Math.max(0, Math.min(rankOverride ?? preset.rank, maxRankFor(withCards.length)));
  let pieces = assignRankTiers(withCards, rank);

  // Modifier tier overrides (e.g. DIAMOND-POWERED) trump rank assignment.
  const forceTier = presets.map((m) => m.forceTier).find((t) => t !== undefined);
  if (forceTier) {
    pieces = pieces.map((p) => ({ ...p, tier: forceTier }));
    if (forceTier === 'diamond') rank = maxRankFor(pieces.length);
  }
  const boardSize = Math.max(enemy.boardSize, nextFreeSlot(pieces));

  return {
    setup: { ...scaled, stats, pieces, boardSize },
    level: resolvedLevel,
    effectiveLevel,
    title,
    rank,
    enemyId,
    modifiers: [...modifiers],
    affix: affix ?? null,
  };
}

/**
 * Hero setup at `level`, either:
 *   - `playerLevelAllocation` given: the player's PL-budget stat-sheet spend
 *     (buy counts per stat, priced via `LEVEL_STAT_COST` — the unified
 *     PL-budget leveling economy; see leveling.ts). This is the real path
 *     once the stat-sheet UI is wired (`demoState.heroAllocation`).
 *   - omitted: falls back to an AUTO-balanced spend of the SAME PL budget
 *     (`allocateMonsterPL` against `DEFAULT_PROFILE`, exactly like a monster
 *     with no bespoke identity would auto-spend) for legacy callers that
 *     haven't been wired to an allocation yet.
 *
 * Both branches spend from the SAME `totalLevelPL(level)` budget the player
 * and every monster share — the only difference is WHO decides the spend
 * (player picks by hand vs. the auto-balanced fallback here).
 */
export function buildAutoHeroSetup(
  level: number,
  pieces: BoardPiece[],
  playerLevelAllocation?: Allocation,
): { setup: CombatantSetup; level: number } {
  const resolvedLevel = clampLevel(level);
  const allocation = playerLevelAllocation ?? allocateMonsterPL(totalLevelPL(resolvedLevel), DEFAULT_PROFILE);
  const stats = applyPlayerLevelAllocation(BASE_HERO_STATS, resolvedLevel, allocation);
  const setup: CombatantSetup = { name: 'Hero', stats, boardSize: HERO_BOARD_SLOTS, pieces };
  return { setup, level: resolvedLevel };
}
