import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { BOSS_EVERY, generateRunMap, ensureWavesThrough, totalColumns } from '../../src/run/runMap';
import {
  BAND_WAVES, bandIndexOf, biomeForBand, biomeForWave, biomeFor, biomeIdForBand,
  bossWaveOfBand, counterTypeFor, firstWaveOfBand, preferIds, weightIds,
} from '../../src/run/biome';
import { biomeCatalog, biomeIds } from '../../src/data/biomes';
import { shopTypeIds } from '../../src/data/shopTypes';
import { enemies } from '../../src/data/enemies';

/**
 * BIOMES ARE DEALT, AND THE DEAL COSTS THE MAP NOTHING.
 *
 * The one implementation rule the whole feature rests on
 * (docs/biome-paths-proposal.md §2.3): every biome binding is a PREFERENCE over
 * a pool that was already being drawn from, and NO binding spends a new `Rng`
 * call. If that holds, the map's STRUCTURE — stop counts, choice counts, shop
 * placement, node ids, every per-node seed — is byte-identical per seed to what
 * it was before biomes existed, and the only thing a reviewer has to hold in
 * their head is "which array did this draw index into".
 *
 * The structural fingerprint below is the test of that claim, and it is a real
 * one: it was computed by generating the sample with the biome code in place and
 * again with `src/run/runMap.ts` + `src/run/runState.ts` stashed back to their
 * pre-biome state, and it came out identical both ways. Mixing the biome into
 * `hashSeed('wave', seed, wave)`, or spending one extra `rng.int` anywhere
 * inside `generateWave`, moves it immediately.
 *
 * IF THIS HASH FAILS: a change to the WAVE GENERATOR'S OWN ROLLS is the only
 * legitimate reason to re-bake it (and then the biome work is not what broke
 * it). A biome change that moves it is a bug — go find the extra Rng call.
 */

const SEEDS = Array.from({ length: 50 }, (_, i) => i + 1);
const STRUCTURE_WAVES = 12;

/** Every structural field of every node — deliberately NOT `shopId`,
 * `eventTheme` or `biomeId`, which are exactly the fields a biome is allowed to
 * move (and stamp). */
function structureFingerprint(): { hash: string; nodes: number } {
  const parts: string[] = [];
  for (const seed of SEEDS) {
    const map = generateRunMap(seed, STRUCTURE_WAVES);
    for (let d = 1; d <= totalColumns(map); d++) {
      for (const n of map.depths[d]!) {
        parts.push([
          n.id, n.depth, n.wave, n.kind, n.fightNumber ?? '', n.fightOption ?? '',
          n.encounterSeed ?? '', n.eventSeed ?? '', n.shopSeed ?? '',
        ].join('|'));
      }
    }
  }
  return { hash: createHash('sha256').update(parts.join('\n')).digest('hex'), nodes: parts.length };
}

const FROZEN_STRUCTURE = {
  nodes: 6097,
  hash: '2ae0ecdbc647b00883aba45995b0ae676a87eef9573a2c2068409ba700d10441',
};

describe('run/biome: the band model', () => {
  it('BAND_WAVES equals runMap BOSS_EVERY — asserted, not assumed', () => {
    // `biome.ts` deliberately keeps its own copy of the cadence rather than
    // importing `BOSS_EVERY` (runMap imports biome, and a value-level cycle read
    // during module evaluation is the one import shape ESM does not make safe).
    // This is the assertion that keeps the copy honest.
    expect(BAND_WAVES).toBe(BOSS_EVERY);
  });

  it('a band is exactly one boss block: its last wave is a boss wave, its first is not (unless BAND_WAVES is 1)', () => {
    for (let band = 0; band < 12; band++) {
      const boss = bossWaveOfBand(band);
      const first = firstWaveOfBand(band);
      expect(boss % BOSS_EVERY).toBe(0);
      expect(boss - first).toBe(BAND_WAVES - 1);
      expect(bandIndexOf(first)).toBe(band);
      expect(bandIndexOf(boss)).toBe(band);
      // and the wave after the band belongs to the NEXT band
      expect(bandIndexOf(boss + 1)).toBe(band + 1);
    }
  });

  it('the deal is a pure function of (seed, band) and never repeats back-to-back', () => {
    let distinctSeen = 0;
    for (const seed of SEEDS) {
      const walk: string[] = [];
      for (let band = 0; band < 20; band++) {
        const id = biomeIdForBand(seed, band);
        expect(biomeIdForBand(seed, band), 'the deal is not pure').toBe(id);
        expect(biomeIds, `dealt an unknown biome id "${id}"`).toContain(id);
        if (band > 0) expect(id, `band ${band} repeated band ${band - 1} on seed ${seed}`).not.toBe(walk[band - 1]);
        walk.push(id);
      }
      distinctSeen = Math.max(distinctSeen, new Set(walk).size);
    }
    // NON-VACUITY: if the deal always handed back the same biome the no-repeat
    // assertion above would be the only thing this test could ever catch.
    expect(distinctSeen, 'the deal never produced more than one biome').toBe(biomeIds.length);
  });

  it('every biome in the catalog is actually dealt somewhere in the sample (no dead catalog entry)', () => {
    const seen = new Set<string>();
    for (const seed of SEEDS) for (let band = 0; band < 8; band++) seen.add(biomeIdForBand(seed, band));
    for (const id of biomeIds) expect(seen.has(id), `${id} was never dealt`).toBe(true);
  });

  it('biomeForWave/biomeFor agree with the band deal, and a missing stamp falls back instead of throwing', () => {
    for (const seed of SEEDS.slice(0, 10)) {
      for (let wave = 1; wave <= 20; wave++) {
        const dealt = biomeForBand(seed, bandIndexOf(wave));
        expect(biomeForWave(seed, wave).id).toBe(dealt.id);
        expect(biomeFor(seed, wave, undefined).id).toBe(dealt.id);
        expect(biomeFor(seed, wave, 'not_a_biome').id).toBe(dealt.id);
        expect(biomeFor(seed, wave, dealt.id).id).toBe(dealt.id);
      }
    }
  });
});

describe('run/biome: biomes cost the map NOTHING structurally', () => {
  it('the map structure fingerprint is unchanged from before biomes existed', () => {
    const fp = structureFingerprint();
    expect(fp.nodes).toBe(FROZEN_STRUCTURE.nodes);
    expect(fp.hash, 'map STRUCTURE moved — a biome binding spent an Rng call or reached the wave seed').toBe(FROZEN_STRUCTURE.hash);
  });

  it('the sample the fingerprint covers is real: every node kind is present, and the bands it spans are NOT all one biome', () => {
    // NON-VACUITY, both halves. A fingerprint over an empty/uniform sample would
    // pass forever; and a fingerprint that is stable because the biome layer does
    // nothing at all proves nothing either.
    const kinds = new Set<string>();
    const biomesSeen = new Set<string>();
    let stamped = 0;
    let total = 0;
    for (const seed of SEEDS) {
      const map = generateRunMap(seed, STRUCTURE_WAVES);
      for (let d = 1; d <= totalColumns(map); d++) {
        for (const n of map.depths[d]!) {
          kinds.add(n.kind);
          total += 1;
          if (n.biomeId !== undefined) { stamped += 1; biomesSeen.add(n.biomeId); }
        }
      }
    }
    expect([...kinds].sort()).toEqual(['boss', 'event', 'fight', 'shop']);
    expect(stamped, 'no node carried a biome stamp').toBe(total);
    expect(biomesSeen.size, 'the whole fingerprint sample sat in one biome').toBeGreaterThan(1);
  });

  it('every node of every column in a wave carries the SAME biome id as its band (a band is one promise, §6.8)', () => {
    for (const seed of SEEDS) {
      const map = ensureWavesThrough(generateRunMap(seed), 16);
      for (let d = 1; d <= totalColumns(map); d++) {
        for (const n of map.depths[d]!) {
          expect(n.biomeId, `node ${n.id} carries no biome`).toBe(biomeForWave(seed, n.wave).id);
        }
      }
    }
  });

  it('lazily extending a map yields the same biome stamps as generating it in one go', () => {
    for (const seed of SEEDS.slice(0, 12)) {
      const eager = generateRunMap(seed, 15);
      let lazy = generateRunMap(seed);
      for (let w = 3; w <= 15; w++) lazy = ensureWavesThrough(lazy, w);
      expect(lazy.depths.map((c) => c.map((n) => `${n.id}:${n.biomeId}`))).toEqual(
        eager.depths.map((c) => c.map((n) => `${n.id}:${n.biomeId}`)),
      );
    }
  });
});

describe('run/biome: the two binding primitives', () => {
  it('preferIds narrows to the preferred entries, keeping pool order, and falls back to the WHOLE pool', () => {
    const pool = ['a', 'b', 'c', 'd'];
    expect(preferIds(pool, ['d', 'b'])).toEqual(['b', 'd']); // pool order, not preference order
    expect(preferIds(pool, ['zz'])).toEqual(pool);            // empty intersection -> full pool
    expect(preferIds(pool, [])).toEqual(pool);
    expect(preferIds([], ['a'])).toEqual([]);
  });

  it('weightIds PREFERS without siloing: the biome mobs get more of the pool, the rest stay reachable', () => {
    const pool = ['a', 'b', 'c', 'd'];
    const w = weightIds(pool, ['a'], 3);
    expect(w).toEqual(['a', 'a', 'a', 'a', 'b', 'c', 'd']);
    // Every original entry survives — this is the anti-silo guarantee in one line.
    for (const id of pool) expect(w).toContain(id);
    expect(weightIds(pool, ['zz'], 3)).toEqual(pool);
    expect(weightIds(pool, pool, 3)).toEqual(pool); // nothing to prefer over
    expect(weightIds(pool, ['a'], 0)).toEqual(pool);
  });

  it('every biome declares only real ids: existing shop themes, existing enemies, and a lean with a counter or a documented absence', () => {
    expect(biomeIds.length, 'the biome catalog is empty').toBeGreaterThan(1);
    expect([...biomeIds]).toEqual([...biomeIds].sort());
    for (const id of biomeIds) {
      const b = biomeCatalog[id]!;
      expect(b.id).toBe(id);
      expect(b.name.length).toBeGreaterThan(0);
      expect(b.tagline.length).toBeGreaterThan(0);
      for (const shop of b.shops) expect(shopTypeIds, `${id} prefers unknown shop "${shop}"`).toContain(shop);
      for (const mob of b.mobs) expect(enemies[mob], `${id} prefers unknown mob "${mob}"`).toBeDefined();
      for (const boss of b.bosses) expect(enemies[boss], `${id} shortlists unknown boss "${boss}"`).toBeDefined();
      expect(b.mobs.length, `${id} has no mobs`).toBeGreaterThan(0);
      expect(b.bosses.length, `${id} has no boss`).toBeGreaterThan(0);
      expect(b.eventThemes.length, `${id} prefers no event theme`).toBeGreaterThan(0);
      // mobs/bosses/eventThemes are id-sorted (order fixes the boss draw);
      // `shops` is authored PRIORITY order and deliberately is not.
      expect([...b.mobs], `${id}.mobs must be sorted`).toEqual([...b.mobs].sort());
      expect([...b.bosses], `${id}.bosses must be sorted`).toEqual([...b.bosses].sort());
      expect([...b.eventThemes], `${id}.eventThemes must be sorted`).toEqual([...b.eventThemes].sort());
    }
  });

  it('counterTypeFor names the type that farms each lean (the line that makes the lean fair, not a gotcha)', () => {
    expect(counterTypeFor({ kind: 'element', type: 'fire' })).toBe('frost');
    expect(counterTypeFor({ kind: 'element', type: 'holy' })).toBe('dark');
    expect(counterTypeFor({ kind: 'weapon', type: 'axe' })).toBe('sword');
    expect(counterTypeFor({ kind: 'weapon', type: 'beast' })).toBe('bow');
    // Nothing beats Sword's counter-less partner outside the triangle.
    expect(counterTypeFor({ kind: 'weapon', type: 'bow' })).toBeUndefined();
    // NON-VACUITY: at least one shipped biome's lean actually HAS a counter, so
    // the forecast's counter line is reachable content and not dead code.
    const withCounter = biomeIds.filter((id) => counterTypeFor(biomeCatalog[id]!.lean) !== undefined);
    expect(withCounter.length, 'no shipped biome has a counter type').toBeGreaterThan(3);
  });
});
