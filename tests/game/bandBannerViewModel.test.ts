import { describe, expect, it } from 'vitest';
import {
  BAND_LINE_WIDTH,
  bandBannerForWave,
  bandBannerViewModel,
} from '../../src/game/ui/bandBannerViewModel';
import { bossCounterFor, forecastBand, renderBandForecast, type BandForecast } from '../../src/run/biomeForecast';
import { biomeIds } from '../../src/data/biomes';
import { createRun } from '../../src/run/runState';

/**
 * The run map's band banner is the FIRST surface in `src/game` to read
 * `biomeForecast.ts` at all — before it, `biomeForecast`/`BandForecast` had
 * zero hits under `src/game` and a band was dealt, staffed every fight and
 * ended in its boss without one pixel ever naming it.
 *
 * What this suite holds:
 *   1. Every claim NAMES ITS SUBJECT (the 3881717 bug: a counter line with no
 *      subject was read as a promise about the block above it).
 *   2. The BOSS claim comes from `bossCounter`, the MOB claim from the biome's
 *      lean, and they are allowed to DISAGREE — for four (biome, boss face)
 *      pairs in the catalog they do.
 *   3. `basis: 'split'` is never flattened into a promise.
 *   4. "nothing counters ..." is a LINE, not an absence — for every band, on
 *      both claims, `lines` is non-empty.
 *   5. The banner agrees with the forecast CARD (`renderBandForecast`, pinned
 *      character-for-character by tests/run/biomeForecastCounter.test.ts), so
 *      the summary and the full read cannot drift apart.
 */

/** Every band of a few real runs — the models the banner actually draws. */
function sampleForecasts(): BandForecast[] {
  const out: BandForecast[] = [];
  for (const seed of [1, 2, 7, 13, 23, 36, 55, 99]) {
    const run = createRun(seed);
    for (let band = 0; band < 4; band++) out.push(forecastBand(run, band));
  }
  return out;
}

describe('bandBannerViewModel', () => {
  it('names the band, its lean, its wave range and the boss it promises', () => {
    const run = createRun(1);
    const vm = bandBannerForWave(run, 1);
    expect(vm.name).toBe('THE THORNWILD');
    expect(vm.leanChip).toBe('NATURE');
    expect(vm.leanKind).toBe('element');
    expect(vm.waveRange).toBe('WAVES 1-5');
    expect(vm.boss.resolved).toBe(true);
    expect(vm.boss.headline).toBe('THE BRAMBLE MATRIARCH');
    expect(vm.boss.sub).toBe('LV 5 · BOSS');
  });

  it('the wave range is the band the wave falls in, not the wave itself', () => {
    const run = createRun(1);
    expect(bandBannerForWave(run, 5).waveRange).toBe('WAVES 1-5');
    expect(bandBannerForWave(run, 6).waveRange).toBe('WAVES 6-10');
    expect(bandBannerForWave(run, 6).band).toBe(1);
  });

  it('EVERY claim names its own subject inside the sentence (3881717)', () => {
    for (const f of sampleForecasts()) {
      const vm = bandBannerViewModel(f);
      for (const claim of [vm.bossClaim, vm.mobsClaim]) {
        expect(claim.lines.length).toBeGreaterThan(0);
        expect(claim.lines.join(' ')).toContain(claim.subject);
      }
      expect(vm.bossClaim.subject).toBe('THIS BOSS');
      expect(vm.mobsClaim.subject).toBe('THESE MOBS');
    }
  });

  it('every claim line fits the phone width', () => {
    for (const f of sampleForecasts()) {
      const vm = bandBannerViewModel(f);
      for (const line of [...vm.bossClaim.lines, ...vm.mobsClaim.lines]) {
        expect(line.length).toBeLessThanOrEqual(BAND_LINE_WIDTH);
      }
    }
  });

  it('the boss claim is the BOSS’s counters and the mob claim is the LEAN’s — never one standing in for the other', () => {
    for (const f of sampleForecasts()) {
      const vm = bandBannerViewModel(f);
      if (f.bossCounter.basis !== 'split') {
        expect(vm.bossClaim.types).toEqual(f.bossCounter.types);
      }
      expect(vm.mobsClaim.types).toEqual(f.counterType === undefined ? [] : [f.counterType]);
    }
  });

  it('renders the two claims DIFFERENTLY when the boss and the mobs disagree', () => {
    // The Arrowfell at seed 2: nothing counters bow mobs, but the boss face
    // that rolls is the Greenwood Sovereign, which is nature+bow — so fire
    // farms its nature half. One panel, two different true answers.
    const vm = bandBannerForWave(createRun(2), 1);
    expect(vm.name).toBe('THE ARROWFELL');
    expect(vm.boss.headline).toBe('THE GREENWOOD SOVEREIGN');
    expect(vm.bossClaim.kind).toBe('definite');
    expect(vm.bossClaim.lines).toEqual(['FIRE HITS THIS BOSS +50%']);
    expect(vm.mobsClaim.kind).toBe('none');
    expect(vm.mobsClaim.lines).toEqual(['NOTHING COUNTERS THESE MOBS']);
  });

  it('a no-counter answer is a LINE, never an empty chip (the Arrowfell, both claims)', () => {
    // Seed 36 rolls the pure-bow champion as the boss face, so nothing
    // counters the boss EITHER — the band where the type wheel offers nothing.
    const vm = bandBannerForWave(createRun(36), 1);
    expect(vm.boss.headline).toBe('DEADEYE STALKER');
    expect(vm.bossClaim.kind).toBe('none');
    expect(vm.bossClaim.chip).toBe('NO COUNTER');
    expect(vm.bossClaim.lines).toEqual(['NOTHING COUNTERS THIS BOSS']);
    expect(vm.mobsClaim.lines).toEqual(['NOTHING COUNTERS THESE MOBS']);
  });

  it('a long type list flips to the colon form instead of wrapping', () => {
    const run = createRun(14); // band 0 = the Stormreach, mob counter `nature`
    const stormreach = bandBannerForWave(run, 1);
    expect(stormreach.leanChip).toBe('LIGHTNING');
    // "NATURE HITS THESE MOBS +50%" fits; the reverse case (a lightning
    // counter) does not, so drive it through a band whose counter IS lightning.
    const frost = bandBannerForWave(createRun(20), 1);
    expect(frost.name).toBe('THE FROSTMARCH');
    expect(frost.mobsClaim.lines).toEqual(['+50% ON THESE MOBS:', 'LIGHTNING']);
    expect(frost.mobsClaim.chip).toBe('LIGHTNING +50%');
  });

  describe('an unresolved boss column', () => {
    /** The forecast the phase-3 fork panel will hand this model: a band whose
     * boss column has not been generated, so the SHORTLIST is the honest read.
     * Recomposed through `bossCounterFor` exactly as `biomeForecast.ts`
     * requires — spreading `{ boss: null }` alone would keep the named boss's
     * counter under a boss that is no longer named. Unreachable by PLAYING
     * (every in-run forecast extends the map and resolves the face), which is
     * why it is proved here rather than in a screenshot. */
    const unresolved = (biomeId: string): BandForecast => {
      for (let seed = 1; seed < 400; seed++) {
        const f = forecastBand(createRun(seed), 0);
        if (f.biomeId !== biomeId) continue;
        return { ...f, boss: null, bossCounter: bossCounterFor(null, f.bossCandidates) };
      }
      throw new Error(`no seed in 1..399 deals band 0 the biome "${biomeId}"`);
    };

    it("a SPLIT shortlist promises no type and says so — and shows the fork face by face", () => {
      const f = unresolved('arrowfell');
      expect(f.bossCounter.basis).toBe('split');
      const vm = bandBannerViewModel(f);
      expect(vm.bossClaim.kind).toBe('unsure');
      expect(vm.bossClaim.chip).toBe('NO SURE COUNTER');
      expect(vm.bossClaim.lines).toEqual(['NO COUNTER IS SURE FOR', 'THIS BOSS.']);
      // The union is carried for callers that need it, but NEVER stated as a
      // sentence: no line names a type.
      expect(vm.bossClaim.types).toEqual(['fire']);
      expect(vm.bossClaim.lines.join(' ')).not.toContain('FIRE');
      expect(vm.boss.resolved).toBe(false);
      expect(vm.boss.headline).toBe('ONE OF THESE:');
      expect(vm.boss.entries).toEqual([
        'DEADEYE STALKER',
        '  NOTHING COUNTERS IT',
        'THE GREENWOOD SOVEREIGN',
        '  FIRE +50%',
      ]);
    });

    it('an AGREEING shortlist still promises its one type, with the faces named plainly', () => {
      const f = unresolved('ironmoot');
      expect(f.bossCounter.basis).toBe('shortlist');
      const vm = bandBannerViewModel(f);
      expect(vm.bossClaim.kind).toBe('definite');
      expect(vm.bossClaim.lines).toEqual(['SWORD HITS THIS BOSS +50%']);
      // Both faces are axe, so no per-face counter is printed — the one claim
      // below the block is already true of whichever face comes.
      expect(vm.boss.entries.every((e) => !e.startsWith('  '))).toBe(true);
    });
  });

  it('the banner agrees with the pinned forecast CARD, band for band', () => {
    for (const f of sampleForecasts()) {
      const vm = bandBannerViewModel(f);
      const card = renderBandForecast(f);
      expect(vm.card.join('\n')).toBe(card);
      // The card's own mob sentence and the banner's mob claim must be the
      // same ANSWER: either both say nothing counters, or both name the type.
      const cardSaysNone = card.includes('nothing counters\nthese mobs.');
      expect(vm.mobsClaim.kind === 'none').toBe(cardSaysNone);
      const bossSaysNone = card.includes('nothing counters\nthis boss.');
      expect(vm.bossClaim.kind === 'none').toBe(bossSaysNone);
      for (const type of vm.mobsClaim.types) expect(card).toContain(type);
      if (vm.bossClaim.kind === 'definite') {
        for (const type of vm.bossClaim.types) expect(card).toContain(type);
      }
    }
  });

  it('covers every biome in the catalog with a non-empty claim on both blocks', () => {
    const seen = new Set<string>();
    for (let seed = 1; seed < 400 && seen.size < biomeIds.length; seed++) {
      const run = createRun(seed);
      for (let band = 0; band < 3; band++) {
        const vm = bandBannerViewModel(forecastBand(run, band));
        const f = forecastBand(run, band);
        seen.add(f.biomeId);
        expect(vm.bossClaim.lines.length).toBeGreaterThan(0);
        expect(vm.mobsClaim.lines.length).toBeGreaterThan(0);
        expect(vm.mobs.length).toBeGreaterThan(0);
      }
    }
    expect(seen.size).toBe(biomeIds.length);
  });
});
