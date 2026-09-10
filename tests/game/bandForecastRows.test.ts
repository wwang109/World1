import { describe, expect, it } from 'vitest';
import { createRun } from '../../src/run/runState';
import { forecastBand, renderBandForecast, rowToAsciiLines, type BandForecast } from '../../src/run/biomeForecast';
import {
  BAND_FORECAST_LINE_WIDTH, bandForecastRows, type BandForecastRowStyle,
} from '../../src/run/bandForecastRows';
import { bandBannerViewModel, rowToCardLines } from '../../src/game/ui/bandBannerViewModel';
import { enemies } from '../../src/data/enemies';
import { enemyDerivedAffinity } from '../../src/data/enemyAffinity';
import { biomeIds } from '../../src/data/biomes';
import {
  ELEMENT_BEATS, WEAPON_BEATS, elementMatchup, weaponMatchup,
} from '../../src/engine/elements';
import type { Element, EnemyDef, WeaponType } from '../../src/engine/types';
import { EXPECTED_ON_LEAN, onLeanCount } from '../fixtures/bandLeanCounts';

/**
 * The band forecast's ROW LIST (`src/run/bandForecastRows.ts`) — the one
 * ordered walk both `biomeForecast.ts#renderBandForecast` (the terminal
 * serializer) and `bandBannerViewModel.ts` (the Phaser card) now consume,
 * replacing the pre-refactor shape where the Phaser side read the ASCII
 * renderer's OWN OUTPUT (`renderBandForecast(f).split('\n')`) — a string
 * pre-wrapped and pre-indented for a monospaced terminal.
 *
 * STRUCTURAL REFACTOR ONLY: this suite does not re-litigate whether a claim
 * is TRUE the way `tests/run/biomeForecastCounter.test.ts` does at length —
 * it holds three NEW properties the row list introduces:
 *
 *   1. TRUTH AT THE ROW LEVEL — a claim row's `types` is checked against the
 *      engine's OWN matchup math (`elementMatchup`/`weaponMatchup`), and its
 *      `block` is read directly off the row rather than inferred from
 *      indentation the way `biomeForecastCounter.test.ts#parseBlocks` has to.
 *   2. TOTALITY — every row, of every style, yields at least one line on
 *      BOTH sides. A `continue` or a filter that silently drops a style
 *      would fail this even if a byte-identical-output test stayed green.
 *   3. NO ORPHAN FACTS — each renderer's full output is EXACTLY the
 *      concatenation of its own per-row composer over `bandForecastRows`, in
 *      order — nothing hand-appended outside the fold.
 *
 * `tests/run/biomeForecastCounter.test.ts` (untouched by this refactor) still
 * pins `renderBandForecast`'s exact bytes; `tests/game/bandBannerViewModel.test.ts`
 * still pins that the banner agrees with the card. This file is the one that
 * would fail if the shared row list itself dropped or mis-attributed a fact.
 */

/** Every type name a counter claim could legitimately print. */
const COUNTER_VOCABULARY: readonly string[] = [
  ...Object.keys(ELEMENT_BEATS), ...Object.keys(WEAPON_BEATS),
].sort();

/** The types that ACTUALLY get +50% on `def`, straight out of the engine's own
 * matchup math — not `counterTypesFor`, the production helper under test.
 *
 * Reads the DERIVED affinity (`enemyDerivedAffinity`, `src/data/enemyAffinity.ts`),
 * not `def.elementAffinity`/`.weaponAffinity` directly — those fields are no
 * longer authored on any entry (2026-09-06 ruling: "affinity are just passive
 * buffs based on the board … there should be no hardcoded enemy that break
 * the rule") and read `undefined` for every enemy today, which would silently
 * derive `[]` here for everyone. This is the SAME helper
 * `tests/run/biomeForecastCounter.test.ts`'s own `realCountersOf` uses — one
 * derivation, not a second copy that could drift from it.
 */
function realCountersOf(def: EnemyDef): readonly string[] {
  const affinity = enemyDerivedAffinity(def);
  const out: string[] = [];
  for (const t of COUNTER_VOCABULARY) {
    const byElement = elementMatchup(t as Element, affinity.elementAffinity) === 'advantage';
    const byWeapon = weaponMatchup(t as WeaponType, affinity.weaponAffinity) === 'advantage';
    if (byElement || byWeapon) out.push(t);
  }
  return out.sort();
}

/** Every band of a few real runs — the models both renderers actually draw. */
function sampleForecasts(): BandForecast[] {
  const out: BandForecast[] = [];
  for (const seed of [1, 2, 7, 13, 23, 36, 55, 99]) {
    const run = createRun(seed);
    for (let band = 0; band < 4; band++) out.push(forecastBand(run, band));
  }
  return [...out, ...syntheticForecasts()];
}

function syntheticForecasts(): BandForecast[] {
  const base = forecastBand(createRun(1), 0);
  const common: BandForecast = {
    ...base,
    band: 0,
    fromWave: 1,
    throughWave: 5,
    name: 'Test Reach',
    tagline: 'Read every path.',
    leanLabel: 'NATURE',
    mobs: [{ id: 'test_mob', name: 'Test Mob' }],
    shops: [{ id: 'test_shop', name: 'Test Shop' }],
    eventThemes: ['omen'],
    counterType: 'fire',
  };
  return [
    {
      ...common,
      boss: null,
      bossCandidates: [
        { id: 'ash_face', name: 'Ash Face', counterTypes: [] },
        { id: 'storm_face', name: 'Storm Face', counterTypes: ['lightning'] },
      ],
      bossCounter: { basis: 'split', types: ['lightning'] },
    },
    {
      ...common,
      boss: null,
      bossCandidates: [],
      bossCounter: { basis: 'shortlist', types: [] },
    },
    {
      ...common,
      boss: { enemyId: 'test_boss', name: 'Test Boss', level: 5, title: 'boss' },
      bossCandidates: [],
      bossCounter: { basis: 'named', types: ['lightning', 'nature'] },
    },
  ];
}

const ALL_ROW_STYLES: readonly BandForecastRowStyle[] = [
  'name', 'meta', 'tagline', 'blank', 'heading', 'bossName', 'bossSub',
  'bossIntro', 'bossUnresolved', 'bossEntry', 'bossEntryCounter', 'entry', 'claim',
];

describe('bandForecastRows: block membership and claim truth', () => {
  it("a claim row's block is the block it describes, not the block above or below it", () => {
    for (const f of sampleForecasts()) {
      for (const row of bandForecastRows(f)) {
        if (row.style !== 'claim') continue;
        if (row.claim.subject === 'this boss') expect(row.block).toBe('boss');
        if (row.claim.subject === 'these mobs') expect(row.block).toBe('mobs');
      }
    }
  });

  it("the BOSS claim row's types are the resolved boss's REAL engine counters, when the face and the answer are both definite", () => {
    let checked = 0;
    for (const f of sampleForecasts()) {
      if (f.boss === null || f.bossCounter.basis === 'split') continue;
      const def = enemies[f.boss.enemyId];
      if (!def) continue;
      const bossRow = bandForecastRows(f).find((r) => r.style === 'claim' && r.claim.subject === 'this boss');
      expect(bossRow).toBeDefined();
      if (bossRow?.style !== 'claim') continue;
      expect([...bossRow.claim.types]).toEqual([...realCountersOf(def)]);
      checked++;
    }
    expect(checked).toBeGreaterThan(0);
  });

  it("every biome's exact on-lean mob count is pinned by name — shared fixture with biomeForecastCounter.test.ts (2026-09-06)", () => {
    // RE-PINNED TO EXACT COUNTS (2026-09-06), replacing a floor that could not
    // notice movement. This used to assert only `onType > 0` per sampled
    // forecast — a floor of 1 against real values of 1-4 that would not
    // notice ANY change short of a fall all the way to zero — and it SKIPPED
    // the bow band (`arrowfell`) entirely, because its MOBS claim carries no
    // type at all (`claim.kind === 'none'`: nothing counters bow), even
    // though arrowfell's own on-lean count is a real, nonzero 2/4.
    //
    // `tests/fixtures/bandLeanCounts.ts` is the SAME table and the SAME
    // `onLeanCount` function `tests/run/biomeForecastCounter.test.ts` pins
    // ("stated the other way: EVERY band's exact on-lean mob count is pinned
    // by name") — one source of truth, so a content pass that moves these
    // numbers (the coming enemy-growth-by-level project is expected to)
    // cannot update one suite and silently miss the other. See that fixture's
    // own doc comment for the measured per-band values and for why
    // `onLeanCount` reads `enemyDerivedAffinity` directly rather than a row's
    // rendered claim type — the claim type answers "what counters this
    // lean" (undefined for bow), a different question from "does this mob's
    // own board carry this lean's type" (real and nonzero for bow's mobs).
    //
    // Reverse-guarded exactly like the boss-half checks in
    // `biomeForecastCounter.test.ts`: a count that FALLS (a regression) or
    // RISES (an unrecorded content change) both fail, with the band named.
    const forecasts = sampleForecasts();
    const offenders: string[] = [];
    let checked = 0;
    for (const id of biomeIds) {
      const f = forecasts.find((x) => x.biomeId === id);
      expect(f, `${id} was never produced by sampleForecasts() — widen its seed/band sweep`).toBeDefined();
      const onType = onLeanCount(f!.lean, f!.mobs.map((m) => m.id));
      const expected = EXPECTED_ON_LEAN[id];
      expect(expected, `${id} is missing from EXPECTED_ON_LEAN`).toBeDefined();
      if (onType !== expected) {
        offenders.push(`${id}: expected ${expected}/${f!.mobs.length} on-lean mobs, measured ${onType}/${f!.mobs.length}`);
      }
      checked++;
    }
    expect(offenders, offenders.join('; ')).toEqual([]);
    expect(checked, 'not every biome was checked').toBe(biomeIds.length);
  });

  it("a SPLIT boss claim never turns its union `types` into a promise on either side", () => {
    for (const f of sampleForecasts()) {
      if (f.bossCounter.basis !== 'split') continue;
      const bossRow = bandForecastRows(f).find((r) => r.style === 'claim' && r.claim.subject === 'this boss');
      expect(bossRow?.style === 'claim' && bossRow.claim.kind).toBe('unsure');
      if (bossRow?.style !== 'claim') continue;
      expect(rowToAsciiLines(bossRow).join(' ')).toBe('no counter is sure.');
      expect(rowToCardLines(bossRow).join(' ')).toBe('no counter is sure.');
    }
  });
});

describe('bandForecastRows: totality — no style is silently dropped', () => {
  it('every row yields at least one ASCII line and one card line', () => {
    let rowsSeen = 0;
    for (const f of sampleForecasts()) {
      for (const row of bandForecastRows(f)) {
        expect(rowToAsciiLines(row).length).toBeGreaterThanOrEqual(1);
        expect(rowToCardLines(row).length).toBeGreaterThanOrEqual(1);
        rowsSeen++;
      }
    }
    // A future compile-time-total-but-runtime-empty regression (e.g. a style
    // arm returning `[]`) needs real rows flowing through this loop to catch.
    expect(rowsSeen).toBeGreaterThan(0);
  });

  it('every row style the catalog can field is exercised at least once', () => {
    const seen = new Set<string>();
    for (const f of sampleForecasts()) {
      for (const row of bandForecastRows(f)) seen.add(row.style);
    }
    // bossIntro/bossEntry/bossEntryCounter/bossUnresolved only fire for an
    // UNRESOLVED boss column, which `forecastBand` on a live run never
    // produces (the boss always resolves) — see `bandBannerViewModel.test.ts`'s
    // "an unresolved boss column" describe block for how that shape is
    // reached in tests. Assert the shapes a live run DOES produce.
    expect([...seen].sort()).toEqual([...ALL_ROW_STYLES].sort());
  });

  it('pins every line and indent of the unresolved split shortlist', () => {
    const split = syntheticForecasts()[0]!;
    const expected = [
      'TEST REACH',
      '[NATURE] w1-5',
      'Read every path.',
      '',
      'BOSS',
      '  one of these:',
      '  Ash Face',
      '    nothing counters it',
      '  Storm Face',
      '    lightning +50%',
      'no counter is sure.',
      '',
      'MOBS',
      '  Test Mob',
      'fire hits these',
      'mobs for +50%.',
      '',
      'SHOPS',
      '  Test Shop',
      '',
      'EVENTS',
      '  omen',
    ];
    expect(bandForecastRows(split).flatMap((row) => rowToAsciiLines(row))).toEqual(expected);
    expect(bandForecastRows(split).flatMap((row) => rowToCardLines(row))).toEqual(expected);
  });

  it('pins the unresolved-empty and long definite claim branches', () => {
    const [, empty, colonFlip] = syntheticForecasts();
    const emptyLines = bandForecastRows(empty!).flatMap((row) => rowToCardLines(row));
    expect(emptyLines).toContain('  (unresolved)');
    expect(emptyLines).not.toContain('  one of these:');
    const colonLines = bandForecastRows(colonFlip!).flatMap((row) => rowToCardLines(row));
    expect(colonLines).toEqual(renderBandForecast(colonFlip!).split('\n'));
    expect(colonLines).toContain('+50% on this boss:');
    expect(colonLines).toContain('lightning and nature.');
  });
});

describe('bandForecastRows: no orphan facts', () => {
  it("the ASCII card is EXACTLY the rows' own lines, in order — nothing hand-appended", () => {
    for (const f of sampleForecasts()) {
      const expected = bandForecastRows(f).flatMap((row) => rowToAsciiLines(row));
      expect(renderBandForecast(f).split('\n')).toEqual(expected);
    }
  });

  it("the Phaser card is EXACTLY the rows' own lines, in order — nothing hand-appended", () => {
    for (const f of sampleForecasts()) {
      const expected = bandForecastRows(f).flatMap((row) => rowToCardLines(row));
      expect(bandBannerViewModel(f).card).toEqual(expected);
    }
  });

  it('the invariant this refactor must not break: the two renderers stay byte-identical', () => {
    for (const f of sampleForecasts()) {
      expect(bandBannerViewModel(f).card.join('\n')).toBe(renderBandForecast(f));
    }
  });

  it('the shared run-layer width contract bounds every non-tagline Phaser card line', () => {
    expect(BAND_FORECAST_LINE_WIDTH).toBe(28);
    for (const f of sampleForecasts()) {
      for (const line of bandBannerViewModel(f).card) {
        if (line === f.tagline) continue;
        expect(line.length, `too wide for a phone: "${line}"`).toBeLessThanOrEqual(BAND_FORECAST_LINE_WIDTH);
      }
    }
  });
});
