import { describe, expect, it } from 'vitest';
import {
  BAND_BANNER_METRICS,
  BAND_LINE_WIDTH,
  bandBannerForWave,
  bandBannerHeight,
  bandBannerLayout,
  bandBannerViewModel,
  claimBarColor,
  claimTextColor,
  leanColor,
  type BandBannerMode,
  type BandBannerViewModel,
} from '../../src/game/ui/bandBannerViewModel';
import { UI } from '../../src/game/theme';
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
    expect(vm.leanType).toBe('nature');
    expect(vm.waveRange).toBe('WAVES 1-5');
    expect(vm.boss.resolved).toBe(true);
    expect(vm.boss.headline).toBe('THE BRAMBLE MATRIARCH');
    expect(vm.boss.sub).toBe('LV 5 · BOSS');
  });

  it('the wave range is the band the wave falls in, not the wave itself', () => {
    const run = createRun(1);
    expect(bandBannerForWave(run, 5).waveRange).toBe('WAVES 1-5');
    expect(bandBannerForWave(run, 6).waveRange).toBe('WAVES 6-10');
    expect(bandBannerForWave(run, 11).waveRange).toBe('WAVES 11-15');
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

  it('says nothing about MOBS that it does not show', () => {
    // DECIDED (2026-08-28): the banner used to print a MOBS heading over a
    // block holding no mob names — the names live only in the forecast card
    // behind `READ THE BAND ›`. The mob claim already NAMES ITS OWN SUBJECT
    // ("... THESE MOBS ..."), which is the whole point of 3881717, so the
    // heading carried no information and promised a list that was not under
    // it. Listing the names instead would cost four to six lines of the mobile
    // map lane the trail is fighting for. The heading goes; `vm.mobs` with it.
    // The BOSS heading stays — it labels the boss NAME on the very next row.
    const vm = bandBannerForWave(createRun(1), 1);
    for (const mode of MODES) {
      const rows = bandBannerLayout(vm, mode).rows;
      const headings = rows.filter((r) => r.style === 'heading').map((r) => r.text);
      expect(headings).toEqual(['BOSS']);
      expect(rows.some((r) => r.style === 'bossName')).toBe(true);
    }
    // ...and the mobs are still one tap away, in the card the overlay prints.
    expect(vm.card.join('\n')).toContain('MOBS');
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
      }
    }
    expect(seen.size).toBe(biomeIds.length);
  });
});

/**
 * The banner's VERTICAL LAYOUT.
 *
 * WHY THIS EXISTS. `bandBannerHeight` used to live in `RunRouteBoard.ts`, which
 * imports Phaser, so nothing here could reach it — and it is the number the
 * MOBILE run map divides its lane by: banner first, trail gets the remainder.
 * It was a hand-kept second copy of the renderer's own cursor arithmetic, and
 * the only thing checking the two agreed was somebody's eye. They did not: the
 * banner shipped claiming to reclaim 28px of a 310px lane and took 155 of it,
 * which cut the wave-10 trail cell from 8.2px to 3.9px.
 *
 * There is now ONE walk. `bandBannerLayout` emits the rows; the renderer draws
 * them and keeps no cursor; `bandBannerHeight` is that walk's total. These
 * tests pin the properties the renderer depends on.
 */
const MODES: readonly BandBannerMode[] = ['desktop', 'mobile'];

/** Real models, including the shapes that change the row count: a resolved
 * boss, a two-line claim, and a shortlist. */
function layoutSamples(): BandBannerViewModel[] {
  const out: BandBannerViewModel[] = [];
  for (const seed of [1, 2, 14, 20, 36, 55]) {
    const run = createRun(seed);
    for (let band = 0; band < 3; band++) out.push(bandBannerViewModel(forecastBand(run, band)));
  }
  const split = (() => {
    for (let seed = 1; seed < 400; seed++) {
      const f = forecastBand(createRun(seed), 0);
      if (f.biomeId !== 'arrowfell') continue;
      return bandBannerViewModel({ ...f, boss: null, bossCounter: bossCounterFor(null, f.bossCandidates) });
    }
    throw new Error('no arrowfell band 0 in 1..399');
  })();
  out.push(split);
  return out;
}

describe('bandBannerLayout: the height and the renderer agree by construction', () => {
  it('the LAST row ends exactly one pad above the reported height', () => {
    // This is the assertion the regression needed. The renderer bottom-anchors
    // nothing and measures nothing: it draws row.y for every row and stops. If
    // a row were ever added without the height following it, this fails.
    for (const vm of layoutSamples()) {
      for (const mode of MODES) {
        const layout = bandBannerLayout(vm, mode);
        const last = layout.rows[layout.rows.length - 1];
        expect(last).toBeDefined();
        expect(last?.style).toBe('button');
        expect((last?.y ?? 0) + (last?.height ?? 0) + layout.metrics.pad).toBe(layout.height);
        expect(bandBannerHeight(vm, mode)).toBe(layout.height);
      }
    }
  });

  it('every row is inside the banner, in order, and never overlaps the next', () => {
    for (const vm of layoutSamples()) {
      for (const mode of MODES) {
        const { rows, height, metrics } = bandBannerLayout(vm, mode);
        expect(rows[0]?.y).toBe(metrics.pad);
        for (let i = 0; i < rows.length; i++) {
          const row = rows[i]!;
          expect(row.y).toBeGreaterThanOrEqual(metrics.pad);
          expect(row.y + row.height).toBeLessThanOrEqual(height - metrics.pad);
          const next = rows[i + 1];
          if (next) expect(next.y).toBeGreaterThanOrEqual(row.y + row.height);
        }
      }
    }
  });

  it('draws every WORD the model carries, and invents none', () => {
    // The renderer has no text of its own except the button label, so the row
    // list is the whole banner. A word that stops being emitted here stops
    // being drawn — and a row emitted here is a row the height paid for.
    for (const vm of layoutSamples()) {
      for (const mode of MODES) {
        const rows = bandBannerLayout(vm, mode).rows;
        const texts = rows.filter((r) => r.style !== 'rule').map((r) => r.text);
        const expected = [
          vm.name,
          vm.waveRange,
          'BOSS',
          vm.boss.headline,
          ...(vm.boss.resolved ? [vm.boss.sub] : vm.boss.entries),
          ...vm.bossClaim.lines,
          ...vm.mobsClaim.lines,
          'READ THE BAND ›',
        ];
        expect(texts).toEqual(expected);
      }
    }
  });

  it('a claim that wraps to two lines makes the banner taller, on both platforms', () => {
    // The Frostmarch's mob counter is `lightning`, which does not fit the 28
    // and flips to the two-line colon form — the case a fixed height would get
    // wrong and the reason `bandBannerHeight` takes the model at all.
    const one = bandBannerForWave(createRun(1), 1);
    const two = bandBannerForWave(createRun(20), 1);
    expect(two.mobsClaim.lines).toHaveLength(2);
    expect(one.mobsClaim.lines).toHaveLength(1);
    const claimLines = (vm: BandBannerViewModel): number => vm.bossClaim.lines.length + vm.mobsClaim.lines.length;
    for (const mode of MODES) {
      const m = BAND_BANNER_METRICS[mode];
      const extraLines = claimLines(two) - claimLines(one);
      expect(extraLines).toBeGreaterThan(0);
      expect(bandBannerHeight(two, mode) - bandBannerHeight(one, mode)).toBe(extraLines * (m.claim + m.lineGap));
    }
  });

  it('an unresolved boss pays for every candidate line it lists', () => {
    const resolved = bandBannerForWave(createRun(2), 1);
    const forked = layoutSamples()[layoutSamples().length - 1]!;
    expect(forked.boss.resolved).toBe(false);
    expect(forked.boss.entries.length).toBeGreaterThan(1);
    for (const mode of MODES) {
      const m = BAND_BANNER_METRICS[mode];
      const rows = bandBannerLayout(forked, mode).rows;
      expect(rows.filter((r) => r.style === 'bossEntry')).toHaveLength(forked.boss.entries.length);
      expect(rows.filter((r) => r.style === 'bossSub')).toHaveLength(0);
      // entries instead of the one `sub` line, plus the extra claim line the
      // 'unsure' shape needs.
      const delta = (forked.boss.entries.length - 1) * (m.sub + m.lineGap) + (m.claim + m.lineGap);
      expect(bandBannerHeight(forked, mode) - bandBannerHeight(resolved, mode)).toBe(delta);
    }
  });
});

/**
 * FIELDS THAT BECOME A COLOUR.
 *
 * The rest of this suite constrains every field that becomes TEXT — so an audit
 * that mutated `leanType` to garbage left all 12 tests green while turning all
 * 11 bands the same fallback bronze, because `leanType` is never printed. It is
 * the sole input to the band's hairline and its lean pill. Same for the claim
 * `kind` (text colour) and the claim's first `type` (bar colour): wrong colour,
 * right words, silent.
 */
describe('the colour a band is drawn in', () => {
  it('every biome in the catalog has its OWN lean colour — none falls back to chip bronze', () => {
    const byBiome = new Map<string, number>();
    for (let seed = 1; seed < 400 && byBiome.size < biomeIds.length; seed++) {
      const run = createRun(seed);
      for (let band = 0; band < 3; band++) {
        const f = forecastBand(run, band);
        const vm = bandBannerViewModel(f);
        // The lean type is a REAL type key, so it resolves in the element or
        // weapon table. `UI.chip` is what `counterTypeColor` returns when it
        // resolves in NEITHER — i.e. the silent failure.
        expect(vm.leanType).toBe(f.lean.type);
        expect(leanColor(vm)).not.toBe(UI.chip);
        byBiome.set(f.biomeId, leanColor(vm));
      }
    }
    expect(byBiome.size).toBe(biomeIds.length);
    // Eleven bands, and the colour actually distinguishes them: the lean types
    // are distinct across the catalog, so the colours are too.
    expect(new Set(byBiome.values()).size).toBe(new Set(biomeIds).size);
  });

  it('a garbage leanType is exactly what this catches', () => {
    const vm = bandBannerForWave(createRun(1), 1);
    expect(leanColor(vm)).not.toBe(UI.chip);
    expect(leanColor({ ...vm, leanType: 'not-a-type' })).toBe(UI.chip);
  });

  it('the three claim certainties are three different colours, and none is the body text colour twice', () => {
    // Was a pinned literal `'#e0654a'`; that hex is now `UI.textAlarm` (the
    // ONE danger-text tone, nudged to clear WCAG AA on `panelAlt` — see
    // theme.ts and tests/game/textRoleAudit.test.ts). Naming the token instead
    // of the hex is the point: this test asserts "none is the ALARM colour",
    // not "none is this particular orange".
    expect(claimTextColor('none')).toBe(UI.textAlarm);
    expect(claimTextColor('unsure')).toBe(UI.textAccent);
    expect(claimTextColor('definite')).toBe(UI.text);
    expect(new Set([claimTextColor('none'), claimTextColor('unsure'), claimTextColor('definite')]).size).toBe(3);
  });

  it('a claim bar is red for none, amber for unsure, and the TYPE’s own colour for a promise', () => {
    const arrowfell = bandBannerForWave(createRun(36), 1);
    expect(arrowfell.bossClaim.kind).toBe('none');
    expect(claimBarColor(arrowfell.bossClaim)).toBe(UI.bad);

    const thornwild = bandBannerForWave(createRun(1), 1);
    expect(thornwild.mobsClaim.kind).toBe('definite');
    expect(claimBarColor(thornwild.mobsClaim)).not.toBe(UI.bad);
    expect(claimBarColor(thornwild.mobsClaim)).not.toBe(UI.waiting);
    expect(claimBarColor(thornwild.mobsClaim)).not.toBe(UI.chip);

    for (const vm of layoutSamples()) {
      for (const claim of [vm.bossClaim, vm.mobsClaim]) {
        if (claim.kind === 'unsure') expect(claimBarColor(claim)).toBe(UI.waiting);
        // A DEFINITE claim always names a real type, so its bar is never the
        // "unknown type" bronze.
        if (claim.kind === 'definite') expect(claimBarColor(claim)).not.toBe(UI.chip);
      }
    }
  });

  it('the layout carries the colour so the renderer never re-derives it', () => {
    for (const vm of layoutSamples()) {
      for (const mode of MODES) {
        const rows = bandBannerLayout(vm, mode).rows;
        const claims = rows.filter((r) => r.style === 'claim');
        expect(claims).toHaveLength(vm.bossClaim.lines.length + vm.mobsClaim.lines.length);
        expect(claims[0]?.color).toBe(claimTextColor(vm.bossClaim.kind));
        expect(claims[0]?.bar?.color).toBe(claimBarColor(vm.bossClaim));
        const firstMob = claims[vm.bossClaim.lines.length];
        expect(firstMob?.color).toBe(claimTextColor(vm.mobsClaim.kind));
        expect(firstMob?.bar?.color).toBe(claimBarColor(vm.mobsClaim));
        // Only the FIRST line of each claim carries the bar — the bar spans the
        // whole block, so a second one would double-draw it.
        expect(claims.filter((r) => r.bar !== undefined)).toHaveLength(2);
      }
    }
  });
});
