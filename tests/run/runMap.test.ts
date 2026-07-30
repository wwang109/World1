import { describe, expect, it } from 'vitest';
import { generateRunMap, totalColumns, WAVE_COUNT } from '../../src/run/runMap';

const EVENT_THEMES = ['training', 'cache', 'recruit', 'forge', 'market', 'omen'];

const SEEDS = Array.from({ length: 20 }, (_, i) => i * 101 + 7);

describe('run/runMap: determinism', () => {
  it('same seed -> deep-equal map', () => {
    for (const seed of SEEDS) {
      const a = generateRunMap(seed);
      const b = generateRunMap(seed);
      expect(a).toEqual(b);
    }
  });

  it('different seeds produce a different map somewhere', () => {
    const maps = SEEDS.map((seed) => JSON.stringify(generateRunMap(seed)));
    const distinct = new Set(maps);
    expect(distinct.size).toBeGreaterThan(1);
  });
});

describe('run/runMap: wave structure', () => {
  for (const seed of SEEDS) {
    it(`seed ${seed}: exactly WAVE_COUNT (${WAVE_COUNT}) fight/boss columns, one per wave, boss last`, () => {
      const map = generateRunMap(seed);
      const columns = totalColumns(map);
      const fightColumns: { depth: number; wave: number; kind: string; nodeCount: number }[] = [];
      for (let d = 1; d <= columns; d++) {
        const column = map.depths[d]!;
        const isFightOrBoss = column.every((n) => n.kind === 'fight' || n.kind === 'boss');
        if (isFightOrBoss) {
          fightColumns.push({ depth: d, wave: column[0]!.wave, kind: column[0]!.kind, nodeCount: column.length });
        }
      }
      expect(fightColumns).toHaveLength(WAVE_COUNT);
      fightColumns.forEach((f, i) => {
        expect(f.wave).toBe(i + 1);
        for (const node of map.depths[f.depth]!) expect(node.fightNumber).toBe(i + 1);
      });
      expect(fightColumns[WAVE_COUNT - 1]!.kind).toBe('boss');
      for (let i = 0; i < WAVE_COUNT - 1; i++) expect(fightColumns[i]!.kind).toBe('fight');
      // The boss column is the very last column of the run.
      expect(fightColumns[WAVE_COUNT - 1]!.depth).toBe(columns);
    });

    it(`seed ${seed}: waves 1-4's fight column offers exactly 2 fight options (same fightNumber); wave 5's boss column is a single node`, () => {
      const map = generateRunMap(seed);
      const columns = totalColumns(map);
      for (let d = 1; d <= columns; d++) {
        const column = map.depths[d]!;
        if (!column.every((n) => n.kind === 'fight' || n.kind === 'boss')) continue;
        if (column[0]!.kind === 'boss') {
          expect(column).toHaveLength(1);
          expect(column[0]!.wave).toBe(WAVE_COUNT);
          expect(column[0]!.fightOption).toBeUndefined();
        } else {
          expect(column).toHaveLength(2);
          const [a, b] = column;
          expect(a!.fightNumber).toBe(b!.fightNumber);
          expect(a!.wave).toBe(b!.wave);
          expect(a!.id).not.toBe(b!.id);
          expect(a!.encounterSeed).not.toBe(b!.encounterSeed);
          const options = [a!.fightOption, b!.fightOption].sort();
          expect(options).toEqual(['hard', 'standard']);
        }
      }
    });

    it(`seed ${seed}: every stop column offers 2-3 event/shop choices, all same wave`, () => {
      const map = generateRunMap(seed);
      const columns = totalColumns(map);
      for (let d = 1; d <= columns; d++) {
        const column = map.depths[d]!;
        const isFightColumn = column.every((n) => n.kind === 'fight' || n.kind === 'boss');
        if (isFightColumn) continue;
        expect(column.length).toBeGreaterThanOrEqual(2);
        expect(column.length).toBeLessThanOrEqual(3);
        const wave = column[0]!.wave;
        for (const node of column) {
          expect(node.wave).toBe(wave);
          expect(node.kind === 'event' || node.kind === 'shop').toBe(true);
        }
      }
    });

    it(`seed ${seed}: no stop column is shop-only (a player avoiding shops always has an event)`, () => {
      const map = generateRunMap(seed);
      const columns = totalColumns(map);
      for (let d = 1; d <= columns; d++) {
        const column = map.depths[d]!;
        const isFightColumn = column.every((n) => n.kind === 'fight' || n.kind === 'boss');
        if (isFightColumn) continue;
        expect(column.every((n) => n.kind === 'shop')).toBe(false);
      }
    });

    it(`seed ${seed}: at most ONE shop choice per stop column`, () => {
      const map = generateRunMap(seed);
      const columns = totalColumns(map);
      for (let d = 1; d <= columns; d++) {
        const column = map.depths[d]!;
        const shopCount = column.filter((n) => n.kind === 'shop').length;
        expect(shopCount).toBeLessThanOrEqual(1);
      }
    });

    it(`seed ${seed}: 2-4 shop choices across the whole run`, () => {
      const map = generateRunMap(seed);
      const columns = totalColumns(map);
      let shopCount = 0;
      for (let d = 1; d <= columns; d++) {
        shopCount += map.depths[d]!.filter((n) => n.kind === 'shop').length;
      }
      expect(shopCount).toBeGreaterThanOrEqual(2);
      expect(shopCount).toBeLessThanOrEqual(4);
    });

    it(`seed ${seed}: shop theme bag never repeats a theme within one run (<= 4 shop nodes/run)`, () => {
      const map = generateRunMap(seed);
      const columns = totalColumns(map);
      const shopIds: string[] = [];
      for (let d = 1; d <= columns; d++) {
        for (const node of map.depths[d]!) {
          if (node.kind === 'shop') shopIds.push(node.shopId!);
        }
      }
      expect(new Set(shopIds).size).toBe(shopIds.length);
    });

    it(`seed ${seed}: every node id is unique and every node's kind-specific seed is present`, () => {
      const map = generateRunMap(seed);
      const columns = totalColumns(map);
      const ids = new Set<string>();
      for (let d = 1; d <= columns; d++) {
        for (const node of map.depths[d]!) {
          expect(ids.has(node.id)).toBe(false);
          ids.add(node.id);
          if (node.kind === 'shop') {
            expect(typeof node.shopId).toBe('string');
            expect(Number.isInteger(node.shopSeed)).toBe(true);
            expect(node.eventSeed).toBeUndefined();
            expect(node.encounterSeed).toBeUndefined();
          } else if (node.kind === 'event') {
            expect(Number.isInteger(node.eventSeed)).toBe(true);
            expect(node.shopId).toBeUndefined();
            expect(node.encounterSeed).toBeUndefined();
            expect(EVENT_THEMES).toContain(node.eventTheme);
          } else {
            // fight or boss
            expect(Number.isInteger(node.encounterSeed)).toBe(true);
            expect(node.fightNumber).toBeGreaterThanOrEqual(1);
            expect(node.fightNumber).toBeLessThanOrEqual(WAVE_COUNT);
            expect(node.shopId).toBeUndefined();
            expect(node.eventSeed).toBeUndefined();
          }
        }
      }
    });
  }
});

describe('run/runMap: event themes', () => {
  it('same seed -> same event themes on every event node (determinism)', () => {
    for (const seed of SEEDS) {
      const a = generateRunMap(seed);
      const b = generateRunMap(seed);
      const columns = totalColumns(a);
      for (let d = 1; d <= columns; d++) {
        const nodesA = a.depths[d]!;
        const nodesB = b.depths[d]!;
        for (let i = 0; i < nodesA.length; i++) {
          expect(nodesB[i]!.eventTheme).toBe(nodesA[i]!.eventTheme);
        }
      }
    }
  });

  for (const seed of SEEDS) {
    it(`seed ${seed}: within a stop column, event choices have distinct themes when >= 2 remain available`, () => {
      const map = generateRunMap(seed);
      const columns = totalColumns(map);
      for (let d = 1; d <= columns; d++) {
        const column = map.depths[d]!;
        const isFightColumn = column.every((n) => n.kind === 'fight' || n.kind === 'boss');
        if (isFightColumn) continue;
        const themes = column.filter((n) => n.kind === 'event').map((n) => n.eventTheme!);
        // A column never has more than 3 event slots (well under the
        // 6-theme catalog), so distinctness should always hold in practice.
        expect(new Set(themes).size).toBe(themes.length);
      }
    });
  }
});
