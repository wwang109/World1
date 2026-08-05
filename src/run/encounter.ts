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
// The resolver-seam pattern — no combat-loop involvement. No RNG, no Phaser.

import type { BoardPiece, CombatantSetup, EnemyDef, SkillTier } from '../engine/types';
import { enemies } from '../data/enemies';
import { skillBook } from '../data/skills';
import { BASE_HERO_STATS, HERO_BOARD_SLOTS } from '../data/heroes';
import {
  allocateMonsterPL,
  applyLevelAllocation,
  applyPlayerLevelAllocation,
  DEFAULT_PROFILE,
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
 */
export const TITLE_PRESETS: Record<EnemyTitle, TitlePreset> = {
  mob: { levelDelta: -4, rank: 0, extraCards: 0 },
  normal: { levelDelta: 0, rank: 0, extraCards: 0 },
  elite: { levelDelta: 2, rank: 2, extraCards: 1 },
  boss: { levelDelta: 4, rank: 4, extraCards: 2 },
};

export const ENEMY_TITLES: EnemyTitle[] = ['mob', 'normal', 'elite', 'boss'];

/**
 * Enemy MODIFIERS — the fourth additive dial (rogue-like affixes), stacked on
 * top of (level + rank + extra cards). Each preset is either:
 *   • a bonus PL auto-spend (`bonusPL` + `bonusProfile`), priced through the
 *     SAME `LEVEL_STAT_COST` economy as every other stat point in the game
 *     (so a Swift enemy's speed is exactly as "expensive" as anyone else's), or
 *   • a deck-wide tier override (`forceTier`) applied AFTER rank assignment.
 * Add a new affix = add a row here; the resolver below needs no changes.
 */
export interface EnemyModifierPreset {
  /** Display name, e.g. chip label. */
  name: string;
  /** One-line effect description for UI. */
  blurb: string;
  /** Extra PL auto-spent (allocateMonsterPL) against `bonusProfile` after level scaling. */
  bonusPL?: number;
  bonusProfile?: Partial<StatProfile>;
  /** Force EVERY deck card to this tier after rank assignment (rank reads as the ceiling). */
  forceTier?: SkillTier;
}

export const MODIFIER_PRESETS: Record<string, EnemyModifierPreset> = {
  diamond: {
    name: 'DIAMOND-POWERED',
    blurb: 'Every card upgraded to Diamond tier',
    forceTier: 'diamond',
  },
  swift: {
    name: 'SWIFT',
    blurb: '+8 PL of pure Speed (+4 SPD)',
    bonusPL: 8,
    bonusProfile: { speed: 1 },
  },
};

export const ENEMY_MODIFIER_IDS: readonly string[] = Object.keys(MODIFIER_PRESETS);

/**
 * Shared extra-card pool keyed by the enemy's damage flavour. All size-1 so
 * placement is trivial; deterministic (no RNG).
 */
const EXTRA_CARD_POOL: Record<'physical' | 'magical', readonly string[]> = {
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
  /** Modifier ids applied (validated against MODIFIER_PRESETS). */
  modifiers: string[];
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
 * LEVEL DISCOUNT (the fairness lever) — pack members roll at
 * `max(1, trackLevel - PACK_LEVEL_DISCOUNT[variant])`, mirroring solo's
 * `clampLevel` floor. Sized deliberately more aggressive than a naive "split
 * the stat budget N ways" would suggest: the readiness engine's initiative
 * comparison runs once per ALIVE unit every turn, so each extra pack member
 * is an extra FULL turn of casts per round, not just extra stats — a pair at
 * only "half a level" cheaper would out-damage a same-level solo foe on
 * action economy alone, before its stats even mattered. -3 (pair) / -5 (trio)
 * is the v1 balance-pass guess against that action-economy premium; retune
 * THESE numbers, not the roll flow, when balance-designer runs the numbers.
 */
export const PACK_LEVEL_DISCOUNT: Record<'pair' | 'trio', number> = {
  pair: 3,
  trio: 5,
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
 * Resolve an enemy encounter along the four dials. `title` picks a preset;
 * `rankOverride` (if given) replaces the title's rank so the prep UI can tune
 * it directly; `modifiers` stacks affixes from `MODIFIER_PRESETS`. Order:
 * scale stats to the effective level → apply modifier stat bonuses → add the
 * title's extra cards → distribute rank as per-card tiers → apply modifier
 * tier overrides. Throws on an unknown enemy OR modifier id (a typo'd affix
 * must scream, not silently produce an easier fight).
 */
export function buildEnemyEncounter(
  enemyId: string,
  level: number,
  title: EnemyTitle = 'normal',
  rankOverride?: number,
  modifiers: readonly string[] = [],
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
  const preset = TITLE_PRESETS[title];
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

  const withCards = addExtraCards(scaled.pieces, poolFor(enemy), preset.extraCards);
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
