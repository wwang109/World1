// Leveling / stat-scaling — the run-layer scaling resolver.
//
// ONE point economy scales BOTH the player and monsters (locked design):
// every level grants POINTS_PER_LEVEL points; each point buys a fixed
// STAT_INCREMENT bump to one stat. Monsters spend their points by an
// identity-shaped weight profile (MONSTER_PROFILES); the player will spend
// theirs via a future stat-sheet UI (Codex/phaser-ui-programmer), through
// `applyPlayerAllocation` below.
//
// Pure TS, integer-only, deterministic — no RNG here. The XP->level curve
// (how much XP a level costs) and the player stat-sheet UI are OUT of scope
// for this module (run loop / Codex); this module only knows "given a level,
// how many points, and how do they turn into stats."
//
// Titles (e.g. "Elite" = +2 levels) are NOT built here — a future caller
// just passes a higher effective `level` into `scaleMonsterToLevel`.

import type { BuffableStat, CombatantSetup, CombatantStats, EnemyDef } from '../engine/types';

/** Points granted per level (level 1 = floor, 0 points spent). */
export const POINTS_PER_LEVEL = 5;

/** All stats a level-up point can be spent on (maxHp + the 6 BuffableStats). */
export type LevelStat = 'maxHp' | BuffableStat;

/** Flat integer bump per point spent on each stat. */
export const STAT_INCREMENT: Record<LevelStat, number> = {
  maxHp: 10,
  attack: 2,
  magicPower: 2,
  armor: 1,
  magicResist: 1,
  speed: 1,
  critPct: 2,
};

/** Fixed order used to hand out allocation remainders — deterministic, no RNG. */
const STAT_ORDER: LevelStat[] = ['maxHp', 'attack', 'magicPower', 'armor', 'magicResist', 'speed', 'critPct'];

/** Points available at `level` (level 1 == floor stats, no points spent). */
export function pointsForLevel(level: number): number {
  return Math.max(0, level - 1) * POINTS_PER_LEVEL;
}

export type Allocation = Partial<Record<LevelStat, number>>;

/**
 * Apply an integer point allocation to base stats, returning a NEW stats
 * object. Applying points to maxHp also raises current hp by the same amount
 * (keeps hp == maxHp for a freshly-scaled combatant; the engine's own
 * hp-vs-maxHp handling during a fight is untouched).
 */
export function applyAllocation(base: CombatantStats, alloc: Allocation): CombatantStats {
  const next: CombatantStats = { ...base };
  let hpAdded = 0;
  for (const stat of STAT_ORDER) {
    const points = alloc[stat] ?? 0;
    if (points <= 0) continue;
    const add = points * STAT_INCREMENT[stat];
    if (stat === 'maxHp') {
      next.maxHp += add;
      hpAdded += add;
    } else {
      next[stat] += add;
    }
  }
  next.hp += hpAdded;
  return next;
}

/**
 * Distribute `points` across stats proportional to integer `profile`
 * weights, deterministically: floor each stat's share by weight ratio, then
 * hand out the leftover remainder one-by-one in `STAT_ORDER` (fixed order —
 * no RNG, no floats persisted). Sum of the returned allocation always equals
 * `points` exactly (given points >= 0 and at least one positive weight).
 */
export function allocateByProfile(points: number, profile: Record<LevelStat, number>): Allocation {
  const alloc: Allocation = {};
  if (points <= 0) return alloc;

  const totalWeight = STAT_ORDER.reduce((sum, stat) => sum + (profile[stat] ?? 0), 0);
  if (totalWeight <= 0) {
    // No weights at all: dump everything into the first stat in fixed order.
    alloc[STAT_ORDER[0]!] = points;
    return alloc;
  }

  let distributed = 0;
  for (const stat of STAT_ORDER) {
    const weight = profile[stat] ?? 0;
    if (weight <= 0) continue;
    const share = Math.floor((points * weight) / totalWeight);
    if (share > 0) {
      alloc[stat] = share;
      distributed += share;
    }
  }

  let remainder = points - distributed;
  // Hand out the remainder in fixed STAT_ORDER, only to stats the profile
  // actually weights (so it never spends on a stat this identity ignores).
  for (const stat of STAT_ORDER) {
    if (remainder <= 0) break;
    const weight = profile[stat] ?? 0;
    if (weight <= 0) continue;
    alloc[stat] = (alloc[stat] ?? 0) + 1;
    distributed += 1;
    remainder -= 1;
  }

  return alloc;
}

/** Integer weight profile per stat, used by `allocateByProfile` for monster identities. */
export type StatProfile = Record<LevelStat, number>;

const ZERO_PROFILE: StatProfile = {
  maxHp: 0,
  attack: 0,
  magicPower: 0,
  armor: 0,
  magicResist: 0,
  speed: 0,
  critPct: 0,
};

function profile(weights: Partial<StatProfile>): StatProfile {
  return { ...ZERO_PROFILE, ...weights };
}

/** Fallback profile for any monster id not explicitly listed below: a flat, balanced spend. */
export const DEFAULT_PROFILE: StatProfile = profile({
  maxHp: 2,
  attack: 1,
  magicPower: 1,
  armor: 1,
  magicResist: 1,
  speed: 1,
  critPct: 1,
});

/**
 * Per-monster identity weight profiles, one per current roster id. Weights
 * are relative (integers); only their ratio matters. Add an entry here for
 * every new monster id content-designer ships — unlisted ids fall back to
 * DEFAULT_PROFILE.
 */
export const MONSTER_PROFILES: Record<string, StatProfile> = {
  // --- Basic floor ---
  giant_rat: profile({ maxHp: 2, attack: 2, speed: 2, critPct: 1 }),
  stone_beetle: profile({ maxHp: 3, armor: 3, attack: 1 }),
  ember_imp: profile({ magicPower: 3, critPct: 2, speed: 1 }),

  // --- Elite / boss floor ---
  bandit_duelist: profile({ attack: 2, speed: 2, critPct: 1, maxHp: 1 }),
  wolf_king: profile({ attack: 2, maxHp: 2, speed: 1, critPct: 1 }),

  // --- Signature roster ---
  seraph: profile({ magicPower: 3, magicResist: 3, maxHp: 1 }),
  knight: profile({ maxHp: 3, armor: 3, attack: 1 }),
  mage: profile({ magicPower: 3, critPct: 3 }),
  hunter: profile({ speed: 3, attack: 3, critPct: 1 }),
  rogue: profile({ critPct: 3, speed: 2, attack: 2 }),
  berserker: profile({ attack: 3, maxHp: 3 }),
  necromancer: profile({ magicPower: 3, magicResist: 3 }),
  cleric: profile({ magicPower: 2, magicResist: 2, maxHp: 2 }),
};

/** Profile lookup for an enemy id, falling back to DEFAULT_PROFILE. */
export function profileFor(enemyId: string): StatProfile {
  return MONSTER_PROFILES[enemyId] ?? DEFAULT_PROFILE;
}

/**
 * Scale an enemy's floor definition up to `level`. Level 1 returns the floor
 * (base stats, 0 points spent). Board/pieces/affinities carry over unchanged
 * — only stats scale.
 *
 * Hook for titles: a caller wanting an "Elite" (or any title) version of a
 * monster just passes a higher effective `level` here (e.g. baseLevel + 2);
 * no separate title system lives in this module.
 */
export function scaleMonsterToLevel(enemy: EnemyDef, level: number): CombatantSetup {
  const points = pointsForLevel(level);
  const alloc = allocateByProfile(points, profileFor(enemy.id));
  const stats = applyAllocation(enemy.stats, alloc);
  return {
    name: enemy.name,
    stats,
    boardSize: enemy.boardSize,
    pieces: enemy.pieces,
    elementAffinity: enemy.elementAffinity,
    weaponAffinity: enemy.weaponAffinity,
  };
}

// ---------------------------------------------------------------------------
// Player helpers (for the future stat-sheet UI; XP curve lives in the run
// loop, not here).
// ---------------------------------------------------------------------------

/** Total points available to the player at `level` (same curve as monsters — locked). */
export function availablePoints(level: number): number {
  return pointsForLevel(level);
}

/**
 * Apply a player-chosen allocation to base stats, validating the alloc's
 * total spend does not exceed `available` points. Throws on over-spend
 * (reject rather than silently clamp — the UI should never let this happen,
 * but a rejected over-spend must be loud, not silently wrong).
 */
export function applyPlayerAllocation(base: CombatantStats, alloc: Allocation, available: number): CombatantStats {
  const spent = STAT_ORDER.reduce((sum, stat) => sum + (alloc[stat] ?? 0), 0);
  if (spent > available) {
    throw new Error(`applyPlayerAllocation: over-spend (${spent} points spent, ${available} available)`);
  }
  return applyAllocation(base, alloc);
}
