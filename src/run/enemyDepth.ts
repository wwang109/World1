// Enemy depth gating (2026-08-19) — the run layer previously drew every
// fight/boss node's enemy id UNIFORMLY from the whole roster
// (`FIGHT_POOL`/`BOSS_POOL` in runState.ts), with no regard for how far into
// the ladder the node sits: a depth-1 node could field the roster's toughest
// kit (`bandit_duelist`) exactly as often as a depth-60 node could field its
// weakest (`giant_rat`). The intended "weak early, tougher late" roster read
// (docs/enemy-design.md) was never actually enforced anywhere — this module
// is that enforcement.
//
// DERIVED, NOT AUTHORED: rather than hand-typing a 13th field onto every
// `EnemyDef` (content-designer's `src/data/enemies.ts`/`enemies.v1.json`, out
// of this module's scope), a roster-wide difficulty ORDER is derived from
// `goldReward` — a field EVERY enemy already carries, hand-tuned per-monster
// by content-designer specifically to reflect its intended relative threat
// (12 for the roster's lightest kit, `giant_rat`, up through 30 for its
// hardest fight-pool kit, `bandit_duelist`). Ties break on `id` (alphabetical)
// so the ordering is total and stable regardless of the book's own insertion
// order. This keeps the whole feature a RUN-LAYER rule over EXISTING data,
// with zero new content fields and zero risk of enemies.v1.json drifting out
// of parity with its TS source (`tests/data/enemiesJsonParity.test.ts`).
//
// TIER MODEL: the sorted roster is split into `TIER_COUNT` equal-ish
// difficulty tiers (rank-based, `Math.floor(rank * tierCount / total)`, so it
// re-balances automatically if the roster's size ever changes). Each tier
// gets a DEPTH BAND — `[min, max]`, `max` on the strongest tier is open-ended
// (`Infinity`, since the ladder itself is endless, see runMap.ts) — with
// consecutive tiers' bands overlapping by `BAND_STEP` so there is NEVER a
// depth with zero eligible anchors (every integer depth >= 1 has at least one
// tier whose band covers it; see the "no orphaned enemy" test in
// tests/run/enemyDepth.test.ts, which also proves every enemy's OWN band is
// non-empty, i.e. reachable at some depth).
//
// ANCHOR vs FILLER (the PACK FIGHTS integration, see runState.ts#rollEncounter):
// a fight node's FIRST rolled member (its "anchor" — the only member on a
// solo roll) must come from the pool of enemies whose band covers this node's
// depth; every ADDITIONAL pack member ("filler") may be drawn from any enemy
// whose band has already OPENED by this depth (`band.min <= depth`), which
// naturally includes weaker, earlier-tier enemies — "the pack's anchor
// matches depth, filler may dip below" (the user ruling this module exists to
// satisfy), with zero new RNG draws: `anchorPoolFor`/`fillerPoolFor` only
// change WHICH pool a slot's existing `rng.int(pool.length)` draw indexes
// into, never how many draws a node spends.
import type { EnemyDef } from '../engine/types';

/** A depth INCLUSIVE-inclusive band `[min, max]` an enemy's tier is eligible
 * for; `max` is `Infinity` on the roster's strongest tier (the ladder never
 * ends, so its top tier never "expires"). */
export interface DepthBand {
  min: number;
  max: number;
}

/** How many difficulty tiers the roster is split into. Four mirrors the
 * existing mob/normal/elite/boss TITLE cadence (`TITLE_PRESETS` in
 * encounter.ts) without being coupled to it — this is an ENEMY-IDENTITY axis,
 * title is a per-fight SCALING axis; the two are orthogonal by design (see
 * enemies.ts's "enemies are PL budgets, not identities" doctrine). */
export const ENEMY_DEPTH_TIER_COUNT = 4;

/** Depth distance between consecutive tiers' band starts. */
export const ENEMY_DEPTH_BAND_STEP = 4;

/** Width of every non-terminal tier's band (the terminal tier's `max` is
 * `Infinity` instead of `min + BAND_WIDTH - 1`). Must be > `BAND_STEP` so
 * consecutive bands overlap and no depth is ever left with zero eligible
 * tiers — enforced by the "no gaps" test in enemyDepth.test.ts. */
export const ENEMY_DEPTH_BAND_WIDTH = 8;

/** Which of `tierCount` equal-ish tiers rank `rank` (0-indexed, out of
 * `total`) falls into — re-balances automatically for any roster size. */
function tierIndexForRank(rank: number, total: number, tierCount: number): number {
  if (total <= 0) return 0;
  return Math.min(tierCount - 1, Math.floor((rank * tierCount) / total));
}

/** The depth band for tier `tier` (0-indexed) of `tierCount` total tiers. */
function bandForTier(tier: number, tierCount: number): DepthBand {
  const min = 1 + tier * ENEMY_DEPTH_BAND_STEP;
  if (tier >= tierCount - 1) return { min, max: Infinity };
  return { min, max: min + ENEMY_DEPTH_BAND_WIDTH - 1 };
}

/**
 * Compute every enemy in `pool`'s depth band, keyed by id. Pure function of
 * `pool` (no RNG, no ambient state) — deterministic and reload-safe by
 * construction, same as every other run-layer table. Safe to call with any
 * roster size (including 0 or 1, e.g. the boss pool) — degenerates to a
 * single open-ended tier rather than throwing or dividing by zero.
 */
export function computeEnemyDepthBands(pool: readonly EnemyDef[]): Record<string, DepthBand> {
  const sorted = [...pool].sort((a, b) => {
    if (a.goldReward !== b.goldReward) return a.goldReward - b.goldReward;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  const total = sorted.length;
  const tierCount = Math.max(1, Math.min(ENEMY_DEPTH_TIER_COUNT, total));
  const bands: Record<string, DepthBand> = {};
  sorted.forEach((enemy, rank) => {
    const tier = tierIndexForRank(rank, total, tierCount);
    bands[enemy.id] = bandForTier(tier, tierCount);
  });
  return bands;
}

/** True iff `depth` falls inside `band` (inclusive both ends). */
export function inDepthBand(band: DepthBand | undefined, depth: number): boolean {
  if (!band) return true; // defensive: an unbanded id (shouldn't happen) is never gated out.
  return depth >= band.min && depth <= band.max;
}

/** True iff this enemy's tier has "opened" by `depth` (its band has started,
 * regardless of whether it has also closed) — the filler eligibility rule:
 * once introduced, an enemy stays available as PACK FILLER forever after,
 * even past its own tier's anchor window. */
export function introducedByDepth(band: DepthBand | undefined, depth: number): boolean {
  if (!band) return true;
  return depth >= band.min;
}

/**
 * The eligible ANCHOR draw pool at `depth`: every id in `pool` whose band
 * covers `depth` exactly, preserving `pool`'s own order (array-filtered, no
 * Map/Set — keeps iteration order stable for the determinism invariant).
 * Falls back to the FULL `pool` if the filter would otherwise leave nothing
 * eligible (defensive only — by construction every depth >= 1 has a covering
 * tier for a non-empty pool; see the "no gaps" test).
 */
export function anchorPoolFor(pool: readonly string[], bands: Readonly<Record<string, DepthBand>>, depth: number): readonly string[] {
  const eligible = pool.filter((id) => inDepthBand(bands[id], depth));
  return eligible.length > 0 ? eligible : pool;
}

/**
 * The eligible PACK FILLER draw pool at `depth`: every id in `pool` whose
 * tier has opened by `depth` (may be weaker than the anchor's own tier, never
 * stronger than what's been introduced so far). Same fallback-to-full-pool
 * defensive behavior as `anchorPoolFor`.
 */
export function fillerPoolFor(pool: readonly string[], bands: Readonly<Record<string, DepthBand>>, depth: number): readonly string[] {
  const eligible = pool.filter((id) => introducedByDepth(bands[id], depth));
  return eligible.length > 0 ? eligible : pool;
}
