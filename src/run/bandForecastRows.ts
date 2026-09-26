// The band forecast's ROW LIST — the single ordered walk over a `BandForecast`
// that both the ASCII serializer (`biomeForecast.ts#renderBandForecast`) and the
// Phaser band-read overlay (`src/game/ui/bandBannerViewModel.ts`, the `card`
// field) consume.
//
// WHY THIS FILE EXISTS. Before it, the Phaser overlay read the ASCII
// serializer's OWN OUTPUT — a string pre-wrapped and pre-indented for a
// monospaced terminal — and split it back into lines
// (`renderBandForecast(f).split('\n')`). A proportional-font Phaser `Text`
// then word-wrapped an already-wrapped sentence a SECOND time and rendered
// literal leading-space indentation, which does not align in a proportional
// font. A row here carries WHAT a line says (a style, the BLOCK it belongs to,
// and — for a counter claim — the STRUCTURED claim: subject/kind/types, never
// a pre-rendered sentence) so each renderer composes its OWN words at its OWN
// width, and the two cannot disagree about which FACTS exist, only about how
// each says them.
//
// PURE, AND TAKES `BandForecast` ONLY — never `RunState`, never an `Rng` bag.
// A wider signature is how a later caller ends up reaching through this
// builder into live map state; `forecastBand`/`forecastWave` already do the
// only stateful read this feature needs, on a COPY of the map, and this
// builder has no reason to repeat that.
//
// NO NEW FIELD ON `BandForecast`. That type is persisted VERBATIM inside
// `MapIntelRecord.snapshot` (`src/run/runState.ts`) and validated by nothing
// stronger than `isRecord` (`src/meta/runSave.ts`) — a presentational field
// added there would land in every save with no migration. Rows are a VIEW,
// derived fresh on every read, never stored.
//
// TOTAL BY CONSTRUCTION. `BandForecastRowStyle` is a closed union and
// `BAND_FORECAST_ROW_INDENT` is a `Record` over the FULL union, so a new style
// is a compile error here until it is given an indent level; each renderer
// additionally keeps its own exhaustive `switch` ending in a `never` check, so
// the same new style is a compile error THERE too, in both files, until both
// are taught to draw it. That closes the one new bug class a row list
// introduces: a `continue` or a filter quietly dropping a fact while a parity
// test stays green.

import { biomeCatalog } from '../data/biomes';
import { shopCatalog } from '../data/shopTypes';
import type { BandForecast, BossCandidate } from './biomeForecast';

/** Longest non-prose forecast-card line allowed by the mobile contract. Both
 * the terminal serializer and Phaser card composer consume this value. */
export const BAND_FORECAST_LINE_WIDTH = 28;

/** Which section of the card a row belongs to — independent of `style`, since
 * e.g. `'entry'` rows exist under `'mobs'`, `'shops'` AND `'events'`. A test
 * asking "does this claim describe the block it sits under" reads THIS field
 * directly, rather than inferring block membership from indentation the way
 * `tests/run/biomeForecastCounter.test.ts#parseBlocks` has to for the rendered
 * ASCII text. */
export type BandForecastBlock = 'header' | 'boss' | 'mobs' | 'shops' | 'events';

/** What a counter claim is about — the two subjects the forecast ever states a
 * claim for. Mirrors `src/game/ui/bandBannerViewModel.ts`'s `BandClaimSubject`
 * in SHAPE (a subject/kind/types claim); kept as its own type here, worded in
 * lower case, because a pure `src/run` module may not import from `src/game`
 * (`scripts/check-boundaries.mjs`) and because case is typography — the
 * banner wants `'THIS BOSS'`, the card wants `'this boss'` — a job for each
 * renderer, not this model. */
export type BandForecastClaimSubject = 'this boss' | 'these mobs';

/** How certain the claim is. `'unsure'` is `bossCounter.basis === 'split'` (see
 * `bossCounterFor` in `biomeForecast.ts`): the shortlist's faces disagree, so
 * no type may be printed as a promise, and a renderer may not turn `types`
 * into a sentence for this kind. */
export type BandForecastClaimKind = 'definite' | 'unsure' | 'none';

export interface BandForecastClaim {
  subject: BandForecastClaimSubject;
  kind: BandForecastClaimKind;
  /** Sorted; empty for `'none'`. For `'unsure'` this is the UNION over the
   * shortlist (true of SOME face, not of the boss) — carried for callers that
   * need it, never rendered as a promise. */
  types: readonly string[];
}

export type BandForecastRowStyle =
  | 'name'
  | 'meta'
  | 'tagline'
  | 'blank'
  | 'heading'
  | 'bossName'
  | 'bossSub'
  | 'bossIntro'
  | 'bossUnresolved'
  | 'bossEntry'
  | 'bossEntryCounter'
  | 'entry'
  | 'claim';

export type BandForecastRow =
  | { style: 'name'; block: 'header'; text: string }
  | { style: 'meta'; block: 'header'; text: string }
  | { style: 'tagline'; block: 'header'; text: string }
  | { style: 'blank'; block: BandForecastBlock }
  | { style: 'heading'; block: BandForecastBlock; text: string }
  | { style: 'bossName'; block: 'boss'; text: string }
  | { style: 'bossSub'; block: 'boss'; text: string }
  | { style: 'bossIntro'; block: 'boss'; text: string }
  | { style: 'bossUnresolved'; block: 'boss'; text: string }
  | { style: 'bossEntry'; block: 'boss'; text: string }
  /** Only emitted for a SPLIT shortlist — see `bandForecastRows`. Carries the
   * candidate's own counter TYPES, not a rendered string, for the same reason
   * `claim` does: the ASCII card lower-cases and slashes them, the banner
   * upper-cases them — a wording job, not a model fact. */
  | { style: 'bossEntryCounter'; block: 'boss'; types: readonly string[] }
  | { style: 'entry'; block: 'mobs' | 'shops' | 'events'; text: string }
  | { style: 'claim'; block: 'boss' | 'mobs'; claim: BandForecastClaim };

/** Indent LEVEL per style — 0, 1 or 2 — never literal spaces: how many spaces
 * (or pixels, once the redesign that CONSUMES this list lands) a level costs
 * is a renderer's own call. A `Record` over the FULL style union, so a new
 * style is a compile error here until it is given a level. */
export const BAND_FORECAST_ROW_INDENT: Record<BandForecastRowStyle, 0 | 1 | 2> = {
  name: 0,
  meta: 0,
  tagline: 0,
  blank: 0,
  heading: 0,
  bossName: 1,
  bossSub: 1,
  bossIntro: 1,
  bossUnresolved: 1,
  bossEntry: 1,
  bossEntryCounter: 2,
  entry: 1,
  claim: 0,
};

function bossEntryCounterRow(c: BossCandidate): BandForecastRow {
  return { style: 'bossEntryCounter', block: 'boss', types: c.counterTypes };
}

/** The claim ABOUT THE BOSS — always `f.bossCounter` (the boss's OWN
 * counters), matching `bossClaimOf` in `bandBannerViewModel.ts`; never
 * re-derived from the biome's lean, which is what the mob claim reads. */
function bossClaimOf(f: BandForecast): BandForecastClaim {
  if (f.bossCounter.basis === 'split') return { subject: 'this boss', kind: 'unsure', types: f.bossCounter.types };
  return {
    subject: 'this boss',
    kind: f.bossCounter.types.length === 0 ? 'none' : 'definite',
    types: f.bossCounter.types,
  };
}

/** The claim ABOUT THE MOBS — the biome's declared lean, matching `mobsClaimOf`
 * in `bandBannerViewModel.ts`; the dated live-catalog count is recorded below. */
// Measured 2026-09-07: this differs from the boss answer for 5 of 22 catalog
// faces, one each in Emberwaste, Howlmoor, Ironmoot, Pikewold and Thornwild.
function mobsClaimOf(f: BandForecast): BandForecastClaim {
  const type = f.counterType;
  return { subject: 'these mobs', kind: type === undefined ? 'none' : 'definite', types: type === undefined ? [] : [type] };
}

/**
 * Every row the forecast card is made of, in order — the ONE walk both
 * renderers consume (see the module doc). Line-for-line the same shape
 * `biomeForecast.ts`'s `renderBandForecast` used to compose directly; that
 * function is now a thin fold over THESE rows, so the ASCII card and the
 * Phaser one read the same facts and can only ever disagree about wording,
 * never about which facts exist.
 */
export function bandForecastRows(f: BandForecast): readonly BandForecastRow[] {
  const rows: BandForecastRow[] = [];
  rows.push({ style: 'name', block: 'header', text: f.name.toUpperCase() });
  rows.push({ style: 'meta', block: 'header', text: `[${f.leanLabel}] w${f.fromWave}-${f.throughWave}` });
  rows.push({ style: 'tagline', block: 'header', text: f.tagline });

  rows.push({ style: 'blank', block: 'boss' });
  rows.push({ style: 'heading', block: 'boss', text: 'BOSS' });
  const split = f.bossCounter.basis === 'split';
  if (f.boss) {
    rows.push({ style: 'bossName', block: 'boss', text: f.boss.name });
    rows.push({ style: 'bossSub', block: 'boss', text: `LV ${f.boss.level} · ${f.boss.title.toUpperCase()}` });
  } else if (f.bossCandidates.length > 0) {
    // The specific face did not resolve, so the honest read is the SHORTLIST —
    // every name it could be, and (only when they disagree) what each one
    // gives way to.
    rows.push({ style: 'bossIntro', block: 'boss', text: 'one of these:' });
    for (const c of f.bossCandidates) {
      rows.push({ style: 'bossEntry', block: 'boss', text: c.name });
      if (split) rows.push(bossEntryCounterRow(c));
    }
  } else {
    rows.push({ style: 'bossUnresolved', block: 'boss', text: '(unresolved)' });
  }
  rows.push({ style: 'claim', block: 'boss', claim: bossClaimOf(f) });

  rows.push({ style: 'blank', block: 'mobs' });
  rows.push({ style: 'heading', block: 'mobs', text: 'MOBS' });
  for (const m of f.mobs) rows.push({ style: 'entry', block: 'mobs', text: m.name });
  rows.push({ style: 'claim', block: 'mobs', claim: mobsClaimOf(f) });

  rows.push({ style: 'blank', block: 'shops' });
  rows.push({ style: 'heading', block: 'shops', text: 'SHOPS' });
  for (const s of f.shops) rows.push({ style: 'entry', block: 'shops', text: s.name });
  // Derived from `f.biomeId` (already part of the persisted `BandForecast`
  // shape) rather than a new field on it — see the module doc comment on why
  // `BandForecast` itself never grows a presentational field.
  const exclusiveShopId = biomeCatalog[f.biomeId]?.exclusiveShop;
  if (exclusiveShopId !== undefined) {
    rows.push({ style: 'entry', block: 'shops', text: shopCatalog[exclusiveShopId]?.name ?? exclusiveShopId });
  }

  rows.push({ style: 'blank', block: 'events' });
  rows.push({ style: 'heading', block: 'events', text: 'EVENTS' });
  for (const t of f.eventThemes) rows.push({ style: 'entry', block: 'events', text: t });

  return rows;
}
