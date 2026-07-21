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
// extra cards). Modifiers (rogue-like affixes) remain a reserved future axis.
// The resolver-seam pattern — no combat-loop involvement. No RNG, no Phaser.

import type { BoardPiece, CombatantSetup, EnemyDef, SkillTier } from '../engine/types';
import { enemies } from '../data/enemies';
import { skillBook } from '../data/skills';
import { BASE_HERO_STATS, HERO_BOARD_SLOTS } from '../data/heroes';
import {
  allocateByProfile,
  applyPlayerAllocation,
  availablePoints,
  DEFAULT_PROFILE,
  scaleMonsterToLevel,
  type Allocation,
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
 * User-locked title design: Mob is WEAKER than baseline; Normal is the floor;
 * Elite is +2 levels, +1 card, and a couple of tier-up ranks; Boss is +4
 * levels, +2 cards, and more ranks.
 */
export const TITLE_PRESETS: Record<EnemyTitle, TitlePreset> = {
  mob: { levelDelta: -1, rank: 0, extraCards: 0 },
  normal: { levelDelta: 0, rank: 0, extraCards: 0 },
  elite: { levelDelta: 2, rank: 2, extraCards: 1 },
  boss: { levelDelta: 4, rank: 4, extraCards: 2 },
};

export const ENEMY_TITLES: EnemyTitle[] = ['mob', 'normal', 'elite', 'boss'];

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
  /** The level actually scaled to: requested + title delta, floored at 1. */
  effectiveLevel: number;
  title: EnemyTitle;
  /** Tier-steps applied across the deck (after clamping to the ceiling). */
  rank: number;
  enemyId: string;
}

/** Clamp any requested level to the valid floor (level 1 = no points spent). */
function clampLevel(level: number): number {
  return Math.max(1, Math.floor(level));
}

/**
 * Resolve an enemy encounter along the three dials. `title` picks a preset;
 * `rankOverride` (if given) replaces the title's rank so the prep UI can tune
 * it directly. Order: scale stats to the effective level → add the title's
 * extra cards → distribute rank as per-card tiers. Throws on unknown id.
 */
export function buildEnemyEncounter(
  enemyId: string,
  level: number,
  title: EnemyTitle = 'normal',
  rankOverride?: number,
): EncounterUnit {
  const enemy = enemies[enemyId];
  if (!enemy) {
    throw new Error(`buildEnemyEncounter: unknown enemy id "${enemyId}"`);
  }
  const preset = TITLE_PRESETS[title];
  const resolvedLevel = clampLevel(level);
  const effectiveLevel = Math.max(1, resolvedLevel + preset.levelDelta);
  const scaled = scaleMonsterToLevel(enemy, effectiveLevel);

  const withCards = addExtraCards(scaled.pieces, poolFor(enemy), preset.extraCards);
  const rank = Math.max(0, Math.min(rankOverride ?? preset.rank, maxRankFor(withCards.length)));
  const pieces = assignRankTiers(withCards, rank);
  const boardSize = Math.max(enemy.boardSize, nextFreeSlot(pieces));

  return {
    setup: { ...scaled, pieces, boardSize },
    level: resolvedLevel,
    effectiveLevel,
    title,
    rank,
    enemyId,
  };
}

/** Inputs needed to resolve a hero's combat setup: level, chosen allocation, and board. */
export interface HeroBuild {
  level: number;
  allocation: Allocation;
  pieces: BoardPiece[];
}

/**
 * Resolve the hero's combat setup: BASE_HERO_STATS + the player's chosen
 * allocation, validated against the points available at `build.level`.
 * Throws (propagated from `applyPlayerAllocation`) if the allocation
 * over-spends its budget.
 */
export function buildHeroSetup(build: HeroBuild): { setup: CombatantSetup; level: number } {
  const resolvedLevel = clampLevel(build.level);
  const available = availablePoints(resolvedLevel);
  const stats = applyPlayerAllocation(BASE_HERO_STATS, build.allocation, available);
  const setup: CombatantSetup = {
    name: 'Hero',
    stats,
    boardSize: HERO_BOARD_SLOTS,
    pieces: build.pieces,
  };
  return { setup, level: resolvedLevel };
}

/**
 * Hero setup at `level` with an AUTO-balanced point spend (the flat
 * DEFAULT_PROFILE spread). This is the stand-in until the player stat-sheet
 * UI exists — the demo hero-level selector calls this so a chosen level is
 * honestly reflected in stats without hand-picking an allocation.
 */
export function buildAutoHeroSetup(level: number, pieces: BoardPiece[]): { setup: CombatantSetup; level: number } {
  const resolvedLevel = clampLevel(level);
  const allocation = allocateByProfile(availablePoints(resolvedLevel), DEFAULT_PROFILE);
  return buildHeroSetup({ level: resolvedLevel, allocation, pieces });
}
