import { describe, expect, it } from 'vitest';
import { enemies } from '../../src/data/enemies';
import {
  anchorPoolFor,
  computeEnemyDepthBands,
  ENEMY_DEPTH_BAND_STEP,
  ENEMY_DEPTH_BAND_WIDTH,
  ENEMY_DEPTH_TIER_COUNT,
  fillerPoolFor,
  inDepthBand,
  introducedByDepth,
} from '../../src/run/enemyDepth';

/**
 * ENEMY DEPTH GATING — pure band-model tests (see `src/run/enemyDepth.ts` for
 * the derivation rationale: bands are computed from the roster's existing
 * `goldReward` field, not a new authored field). The `rollEncounter`
 * integration (anchor vs filler draws, the fallback-to-solo rule, boss nodes)
 * is covered separately in `tests/run/enemyDepthGating.test.ts`.
 */

const FIGHT_POOL_ENEMIES = Object.values(enemies).filter((e) => !e.isBoss);
const BOSS_POOL_ENEMIES = Object.values(enemies).filter((e) => e.isBoss);

describe('run/enemyDepth: computeEnemyDepthBands', () => {
  const bands = computeEnemyDepthBands(FIGHT_POOL_ENEMIES);

  it('gives every fight-pool enemy id its own band', () => {
    for (const enemy of FIGHT_POOL_ENEMIES) {
      expect(bands[enemy.id], enemy.id).toBeDefined();
      expect(bands[enemy.id]!.min).toBeGreaterThanOrEqual(1);
    }
  });

  it('the weakest enemy (lowest goldReward) anchors depth 1; the strongest never does', () => {
    const sorted = [...FIGHT_POOL_ENEMIES].sort(
      (a, b) => a.goldReward - b.goldReward || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    );
    const weakest = sorted[0]!;
    const strongest = sorted[sorted.length - 1]!;
    expect(inDepthBand(bands[weakest.id], 1)).toBe(true);
    expect(inDepthBand(bands[strongest.id], 1)).toBe(false);
  });

  it('bands never gap: every depth 1..200 has at least one covering tier', () => {
    for (let depth = 1; depth <= 200; depth++) {
      const covering = FIGHT_POOL_ENEMIES.filter((e) => inDepthBand(bands[e.id], depth));
      expect(covering.length, `depth ${depth}`).toBeGreaterThan(0);
    }
  });

  it('the roster is fully reachable as an anchor across the ladder (no enemy orphaned)', () => {
    for (const enemy of FIGHT_POOL_ENEMIES) {
      const band = bands[enemy.id]!;
      // Every enemy's own band is non-empty (min <= max) and starts at a
      // finite, reachable depth.
      expect(band.min).toBeLessThanOrEqual(Number.isFinite(band.max) ? band.max : band.min + 1);
      expect(Number.isFinite(band.min)).toBe(true);
      // Sample the band's own min depth: the enemy must anchor-qualify there.
      expect(inDepthBand(band, band.min)).toBe(true);
    }
  });

  it('a depth-1 anchor pool never includes the strongest tier', () => {
    const anchors = FIGHT_POOL_ENEMIES.map((e) => e.id).filter((id) => inDepthBand(bands[id], 1));
    const sorted = [...FIGHT_POOL_ENEMIES].sort((a, b) => a.goldReward - b.goldReward);
    const strongestId = sorted[sorted.length - 1]!.id;
    expect(anchors).not.toContain(strongestId);
    expect(anchors.length).toBeGreaterThan(0);
  });

  it('a deep node anchors only the strongest tier (open-ended top band)', () => {
    const deepDepth = 500;
    const anchors = FIGHT_POOL_ENEMIES.map((e) => e.id).filter((id) => inDepthBand(bands[id], deepDepth));
    const sorted = [...FIGHT_POOL_ENEMIES].sort(
      (a, b) => a.goldReward - b.goldReward || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    );
    const topTierSize = Math.ceil(sorted.length / ENEMY_DEPTH_TIER_COUNT);
    const expectedTopIds = sorted.slice(sorted.length - topTierSize).map((e) => e.id);
    // Every deep-depth anchor must be drawn from the roster's strongest end
    // (the weakest enemy must NOT still qualify as an anchor this deep).
    const weakestId = sorted[0]!.id;
    expect(anchors).not.toContain(weakestId);
    expect(anchors.length).toBeGreaterThan(0);
    for (const id of anchors) expect(expectedTopIds).toContain(id);
  });

  it('filler eligibility only grows with depth (monotonic — once opened, always available)', () => {
    for (const enemy of FIGHT_POOL_ENEMIES) {
      const band = bands[enemy.id]!;
      expect(introducedByDepth(band, band.min - 1)).toBe(false);
      expect(introducedByDepth(band, band.min)).toBe(true);
      expect(introducedByDepth(band, band.min + 1000)).toBe(true);
    }
  });

  it('degenerates gracefully for a 1-enemy pool (boss pool) — single open-ended tier', () => {
    const bossBands = computeEnemyDepthBands(BOSS_POOL_ENEMIES);
    for (const enemy of BOSS_POOL_ENEMIES) {
      const band = bossBands[enemy.id]!;
      expect(band.min).toBe(1);
      expect(band.max).toBe(Infinity);
    }
  });

  it('degenerates gracefully for an empty pool (never throws)', () => {
    expect(() => computeEnemyDepthBands([])).not.toThrow();
    expect(computeEnemyDepthBands([])).toEqual({});
  });

  it('ENEMY_DEPTH_BAND_WIDTH exceeds ENEMY_DEPTH_BAND_STEP (the no-gap invariant\'s precondition)', () => {
    expect(ENEMY_DEPTH_BAND_WIDTH).toBeGreaterThan(ENEMY_DEPTH_BAND_STEP);
  });
});

describe('run/enemyDepth: anchorPoolFor / fillerPoolFor', () => {
  const bands = computeEnemyDepthBands(FIGHT_POOL_ENEMIES);
  const pool = FIGHT_POOL_ENEMIES.map((e) => e.id);

  it('anchorPoolFor is always a subset of fillerPoolFor at the same depth', () => {
    for (let depth = 1; depth <= 60; depth++) {
      const anchors = new Set(anchorPoolFor(pool, bands, depth));
      const filler = new Set(fillerPoolFor(pool, bands, depth));
      for (const id of anchors) expect(filler.has(id), `depth ${depth}, id ${id}`).toBe(true);
    }
  });

  it('fillerPoolFor never shrinks as depth increases (monotonic growth)', () => {
    let prevSize = 0;
    for (let depth = 1; depth <= 60; depth++) {
      const size = fillerPoolFor(pool, bands, depth).length;
      expect(size).toBeGreaterThanOrEqual(prevSize);
      prevSize = size;
    }
  });

  it('never returns an empty pool for a non-empty input pool', () => {
    for (let depth = -5; depth <= 60; depth++) {
      expect(anchorPoolFor(pool, bands, depth).length).toBeGreaterThan(0);
      expect(fillerPoolFor(pool, bands, depth).length).toBeGreaterThan(0);
    }
  });
});
