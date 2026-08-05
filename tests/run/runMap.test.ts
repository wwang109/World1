import { describe, expect, it } from 'vitest';
import {
  BOSS_EVERY,
  ensureDepthThrough,
  ensureWavesThrough,
  generatedWaveCount,
  generateRunMap,
  INITIAL_WAVES,
  totalColumns,
  WAVE_COUNT,
} from '../../src/run/runMap';

const EVENT_THEMES = ['training', 'cache', 'recruit', 'forge', 'market', 'omen'];

const SEEDS = Array.from({ length: 20 }, (_, i) => i * 101 + 7);

/** Deep-walk a map's every generated column, asserting the shared per-column
 * invariants (2-3 stop choices OR a fight/boss column, at most one shop per
 * stop column, never a shop-only column, every node id unique). */
function assertColumnInvariants(map: ReturnType<typeof generateRunMap>): void {
  const columns = totalColumns(map);
  const ids = new Set<string>();
  for (let d = 1; d <= columns; d++) {
    const column = map.depths[d]!;
    expect(column.length).toBeGreaterThan(0);
    for (const node of column) {
      expect(ids.has(node.id)).toBe(false);
      ids.add(node.id);
    }
    const isCombat = column.every((n) => n.kind === 'fight' || n.kind === 'boss');
    if (isCombat) continue;
    // Exactly three — user-locked 2026-07-31 (was a seeded 2-3).
    expect(column.length).toBe(3);
    expect(column.every((n) => n.kind === 'shop')).toBe(false);
    const shopCount = column.filter((n) => n.kind === 'shop').length;
    expect(shopCount).toBeLessThanOrEqual(1);
  }
}

describe('run/runMap: WAVE_COUNT legacy alias', () => {
  it('WAVE_COUNT === BOSS_EVERY (repurposed as the boss cadence period, not a run length)', () => {
    expect(WAVE_COUNT).toBe(BOSS_EVERY);
    expect(BOSS_EVERY).toBe(5);
  });
});

describe('run/runMap: determinism', () => {
  it('same seed -> deep-equal map at the same wave depth', () => {
    for (const seed of SEEDS) {
      const a = ensureWavesThrough(generateRunMap(seed), 6);
      const b = ensureWavesThrough(generateRunMap(seed), 6);
      expect(a).toEqual(b);
    }
  });

  it('different seeds produce a different map somewhere', () => {
    const maps = SEEDS.map((seed) => JSON.stringify(ensureWavesThrough(generateRunMap(seed), 6)));
    const distinct = new Set(maps);
    expect(distinct.size).toBeGreaterThan(1);
  });

  it('generateRunMap(seed) eagerly seeds exactly INITIAL_WAVES waves', () => {
    for (const seed of SEEDS.slice(0, 5)) {
      const map = generateRunMap(seed);
      expect(generatedWaveCount(map)).toBe(INITIAL_WAVES);
    }
  });
});

describe('run/runMap: lazy generation is eager/lazy-equivalent (the core endless invariant)', () => {
  it('generating waves 1-3 then extending to 6 equals generating 1-6 in one go, for every wave 1-6', () => {
    for (const seed of SEEDS) {
      const lazy3 = generateRunMap(seed, 3);
      const lazyExtended = ensureWavesThrough(lazy3, 6);
      const eager6 = generateRunMap(seed, 6);
      expect(lazyExtended).toEqual(eager6);
    }
  });

  it('extending step-by-step (1, then 2, ... up to 10) matches a single jump to 10', () => {
    for (const seed of SEEDS.slice(0, 8)) {
      let stepwise = generateRunMap(seed, 1);
      for (let w = 2; w <= 10; w++) stepwise = ensureWavesThrough(stepwise, w);
      const jump = generateRunMap(seed, 10);
      expect(stepwise).toEqual(jump);
    }
  });

  it('ensureWavesThrough is a no-op (same reference) once the map already covers that far', () => {
    const map = generateRunMap(1, 5);
    const again = ensureWavesThrough(map, 3);
    expect(again).toBe(map);
    const sameDepth = ensureWavesThrough(map, 5);
    expect(sameDepth).toBe(map);
  });

  it('ensureDepthThrough never returns fewer columns than requested, walking 40+ fights deep', () => {
    for (const seed of SEEDS.slice(0, 6)) {
      let map = generateRunMap(seed);
      // Walk forward column-by-column well past 40 fights' worth of columns.
      for (let depth = 1; depth <= 400; depth++) {
        map = ensureDepthThrough(map, depth);
        expect(totalColumns(map)).toBeGreaterThanOrEqual(depth);
        expect(map.depths[depth]).toBeDefined();
        expect(map.depths[depth]!.length).toBeGreaterThan(0);
      }
    }
  });

  it('ensureDepthThrough never mutates its input map', () => {
    const original = generateRunMap(1, 2);
    const originalColumns = totalColumns(original);
    const snapshot = JSON.parse(JSON.stringify(original));
    ensureDepthThrough(original, 40);
    expect(original).toEqual(snapshot);
    expect(totalColumns(original)).toBe(originalColumns);
  });
});

describe('run/runMap: column invariants hold arbitrarily deep', () => {
  for (const seed of SEEDS) {
    it(`seed ${seed}: column invariants hold through wave 12`, () => {
      const map = generateRunMap(seed, 12);
      assertColumnInvariants(map);
    });
  }
});

describe('run/runMap: boss cadence', () => {
  for (const seed of SEEDS) {
    it(`seed ${seed}: every BOSS_EVERYth wave is a single-node boss column; others are 3-option fight columns (easy/standard/hard, USER-DIRECTED 2026-08-04)`, () => {
      const map = generateRunMap(seed, 12);
      const columns = totalColumns(map);
      const fightColumns: { depth: number; wave: number; kind: string; nodeCount: number }[] = [];
      for (let d = 1; d <= columns; d++) {
        const column = map.depths[d]!;
        if (column.every((n) => n.kind === 'fight' || n.kind === 'boss')) {
          fightColumns.push({ depth: d, wave: column[0]!.wave, kind: column[0]!.kind, nodeCount: column.length });
        }
      }
      expect(fightColumns).toHaveLength(12);
      fightColumns.forEach((f, i) => {
        const wave = i + 1;
        expect(f.wave).toBe(wave);
        for (const node of map.depths[f.depth]!) expect(node.fightNumber).toBe(wave);
        if (wave % BOSS_EVERY === 0) {
          expect(f.kind).toBe('boss');
          expect(f.nodeCount).toBe(1);
        } else {
          expect(f.kind).toBe('fight');
          expect(f.nodeCount).toBe(3);
          const [a, b, c] = map.depths[f.depth]!;
          const ids = new Set([a!.id, b!.id, c!.id]);
          expect(ids.size).toBe(3);
          const seeds = new Set([a!.encounterSeed, b!.encounterSeed, c!.encounterSeed]);
          expect(seeds.size).toBe(3);
          expect(a!.fightNumber).toBe(wave);
          expect(b!.fightNumber).toBe(wave);
          expect(c!.fightNumber).toBe(wave);
          const options = [a!.fightOption, b!.fightOption, c!.fightOption].sort();
          expect(options).toEqual(['easy', 'hard', 'standard']);
        }
      });
    });
  }

  it('boss cadence keeps repeating well past the first cycle (fights 25 and 50 are both boss)', () => {
    const map = generateRunMap(1, 50);
    const bossWaves: number[] = [];
    for (let d = 1; d <= totalColumns(map); d++) {
      const column = map.depths[d]!;
      if (column[0]!.kind === 'boss') bossWaves.push(column[0]!.wave);
    }
    expect(bossWaves).toEqual([5, 10, 15, 20, 25, 30, 35, 40, 45, 50]);
  });
});

describe('run/runMap: node id/seed shape (unique ids, kind-specific seeds present)', () => {
  for (const seed of SEEDS) {
    it(`seed ${seed}: every node id is unique through wave 12 and every kind's seed is present`, () => {
      const map = generateRunMap(seed, 12);
      const columns = totalColumns(map);
      const ids = new Set<string>();
      for (let d = 1; d <= columns; d++) {
        for (const node of map.depths[d]!) {
          expect(ids.has(node.id)).toBe(false);
          ids.add(node.id);
          if (node.kind === 'shop') {
            expect(typeof node.shopId).toBe('string');
            expect(Number.isInteger(node.shopSeed)).toBe(true);
          } else if (node.kind === 'event') {
            expect(Number.isInteger(node.eventSeed)).toBe(true);
            expect(EVENT_THEMES).toContain(node.eventTheme);
          } else {
            expect(Number.isInteger(node.encounterSeed)).toBe(true);
            expect(node.fightNumber).toBeGreaterThanOrEqual(1);
          }
        }
      }
    });
  }
});

describe('run/runMap: shop placement + no-repeat theme bags keep working past exhaustion', () => {
  it('at most ONE shop choice per stop column, through a long walk', () => {
    for (const seed of SEEDS) {
      const map = generateRunMap(seed, 20);
      for (let d = 1; d <= totalColumns(map); d++) {
        const column = map.depths[d]!;
        expect(column.filter((n) => n.kind === 'shop').length).toBeLessThanOrEqual(1);
      }
    }
  });

  it('shop theme bag refills (reshuffles) rather than crashing once the 16-theme catalog is exhausted', () => {
    // 40 waves comfortably exceeds the whole shop-theme catalog's size even
    // at the lowest per-wave shop rate, forcing at least one bag refill.
    const map = generateRunMap(1, 40);
    const shopIds: string[] = [];
    for (let d = 1; d <= totalColumns(map); d++) {
      for (const node of map.depths[d]!) {
        if (node.kind === 'shop') shopIds.push(node.shopId!);
      }
    }
    expect(shopIds.length).toBeGreaterThan(0);
    // No crash occurred (generation completed); themes repeat across the
    // whole run once the bag refills (not a same-run-forever no-repeat rule
    // any more — the run is endless).
  });

  it('event theme bag refills past exhaustion too (event nodes always get a valid theme)', () => {
    const map = generateRunMap(1, 40);
    for (let d = 1; d <= totalColumns(map); d++) {
      for (const node of map.depths[d]!) {
        if (node.kind === 'event') expect(EVENT_THEMES).toContain(node.eventTheme);
      }
    }
  });

  it('within a stop column, event choices have distinct themes when >= 2 remain available', () => {
    for (const seed of SEEDS) {
      const map = generateRunMap(seed, 8);
      for (let d = 1; d <= totalColumns(map); d++) {
        const column = map.depths[d]!;
        if (column.every((n) => n.kind === 'fight' || n.kind === 'boss')) continue;
        const themes = column.filter((n) => n.kind === 'event').map((n) => n.eventTheme!);
        expect(new Set(themes).size).toBe(themes.length);
      }
    }
  });

  it('gemcutter (minWave 2) / relic_vault (minWave 3) never appear before their minWave', () => {
    for (const seed of SEEDS) {
      const map = generateRunMap(seed, 15);
      for (let d = 1; d <= totalColumns(map); d++) {
        for (const node of map.depths[d]!) {
          if (node.shopId === 'gemcutter') expect(node.wave).toBeGreaterThanOrEqual(2);
          if (node.shopId === 'relic_vault') expect(node.wave).toBeGreaterThanOrEqual(3);
        }
      }
    }
  });
});

describe('run/runMap: per-wave shop rate (replaces the old whole-run 2-4 cap)', () => {
  it('each wave offers at most 1 shop column (MAX_SHOP_COLUMNS_PER_WAVE), never more', () => {
    for (const seed of SEEDS) {
      const map = generateRunMap(seed, 10);
      const shopColumnsByWave = new Map<number, number>();
      for (let d = 1; d <= totalColumns(map); d++) {
        const column = map.depths[d]!;
        if (column.some((n) => n.kind === 'shop')) {
          const wave = column[0]!.wave;
          shopColumnsByWave.set(wave, (shopColumnsByWave.get(wave) ?? 0) + 1);
        }
      }
      for (const count of shopColumnsByWave.values()) expect(count).toBeLessThanOrEqual(1);
    }
  });

  it('averages roughly one shop column every two waves over a long run (sanity, not exact)', () => {
    let totalShopColumns = 0;
    let totalWaves = 0;
    for (const seed of SEEDS) {
      const map = generateRunMap(seed, 20);
      totalWaves += 20;
      for (let d = 1; d <= totalColumns(map); d++) {
        if (map.depths[d]!.some((n) => n.kind === 'shop')) totalShopColumns += 1;
      }
    }
    const rate = totalShopColumns / totalWaves;
    expect(rate).toBeGreaterThan(0.2);
    expect(rate).toBeLessThan(0.8);
  });
});
