/**
 * Band banner view model — the run map's READ of the band it is standing in,
 * derived from `src/run/biomeForecast.ts`'s `BandForecast` and nothing else.
 *
 * WHY THIS MODULE EXISTS. Biomes shipped with a full forecast model and a
 * production text renderer, and NOTHING in `src/game` read either of them: the
 * player was dealt a band, met its mobs and its boss, and was never told which
 * band it was. Telegraphing is the whole premise ("if the player cannot read
 * the branch ahead of committing, the feature does not exist",
 * docs/biome-paths-proposal.md §0) — so this is the mapping the Phaser scenes
 * draw, kept pure and unit-tested (`tests/game/bandBannerViewModel.test.ts`)
 * exactly like `runRewardViewModel.ts`/`auraPresentation.ts` before it. The
 * scenes own pixels; every WORD the banner says is decided here.
 *
 * TWO CLAIMS, EACH NAMING ITS OWN SUBJECT — the rule this file exists to keep.
 * Commit 3881717 fixed a counter line that named no subject: it sat under the
 * boss block while describing the MOBS, so readers brought a mob counter to a
 * boss that took nothing from it. Every claim built here therefore carries its
 * SUBJECT inside the sentence ("... THIS BOSS ...", "... THESE MOBS ..."), so
 * no line can be inherited by the block above or below it, and the boss claim
 * is built from `bossCounter` (the boss's OWN counters) while the mob claim is
 * built from `counterType` (the biome's lean) — never one standing in for the
 * other.
 *
 * THREE OUTCOMES, NEVER TWO. A claim is `'definite'`, `'unsure'` or `'none'`:
 *
 *   definite  a type is promised, and it is as certain as the name above it.
 *   unsure    `bossCounter.basis === 'split'` — the shortlist's faces disagree,
 *             so NO type may be printed as a promise. The union is carried in
 *             `types` for tests but is deliberately NOT rendered as a sentence;
 *             the fork is shown instead, face by face, as `boss.entries`.
 *   none      nothing counters this subject. THIS IS INFORMATION, NOT AN EMPTY
 *             STATE — the Arrowfell leans bow, `WEAPON_BEATS` maps nothing TO
 *             bow, and "nothing counters these mobs" is the one thing a player
 *             routing around the type wheel most needs to know. A renderer that
 *             drops the line (or draws an empty chip) reintroduces exactly the
 *             bug 3881717 closed, so `lines` is never empty for any kind.
 *
 * `card` is the player-facing Explore read: region identity, boss and mob
 * names, shops, and events. Counter facts remain in the forecast and banner
 * claims for other consumers, but Explore deliberately omits those rows.
 */

import { biomeCatalog } from '../../data/biomes';
import { shopCatalog } from '../../data/shopTypes';
import { enemies } from '../../data/enemies';
import { enemyDerivedAffinity } from '../../data/enemyAffinity';
import { ELEMENT_BEATS, WEAPON_BEATS } from '../../engine/elements';
import { forecastWave, type BandForecast } from '../../run/biomeForecast';
import {
  BAND_FORECAST_LINE_WIDTH, BAND_FORECAST_ROW_INDENT, bandForecastRows,
  type BandForecastRow,
} from '../../run/bandForecastRows';
import type { RunState } from '../../run/runState';
import { ELEMENT_COLOR, UI, WEAPON_COLOR } from '../theme';
import { biomeArtKey } from './runArtKeys';
import { BRIGHT_ART_TREATMENT } from './brightArtTreatment';
import { expeditionDay } from './travelDay';

/** Longest line the phone format allows (CLAUDE.md, USER-LOCKED 2026-08-25) —
 * the same 28 the forecast card is composed at, so a banner line and a card
 * line wrap at the same place. */
export const BAND_LINE_WIDTH = BAND_FORECAST_LINE_WIDTH;

/** How certain the claim is. See the module doc. */
export type BandClaimKind = 'definite' | 'unsure' | 'none';

/** What a claim is ABOUT. Always rendered inside the sentence — never implied
 * by which block the line happens to sit under (3881717). */
export type BandClaimSubject = 'THIS BOSS' | 'THESE MOBS';

export interface BandCounterClaim {
  subject: BandClaimSubject;
  kind: BandClaimKind;
  /** The types the claim names. Empty for `'none'`; for `'unsure'` it is the
   * UNION over the shortlist (true of SOME face, not of the boss) and is not
   * rendered as a sentence. */
  types: readonly string[];
  /** The claim as stacked lines, one fact per line, each <= BAND_LINE_WIDTH.
   * NEVER empty — "nothing counters X" is a line, not an absence. */
  lines: readonly string[];
}

export interface BandBannerBoss {
  /** False only when the boss column could not be resolved (no map). */
  resolved: boolean;
  /** 'THE BRAMBLE MATRIARCH', or 'ONE OF THESE:' when unresolved. */
  headline: string;
  /** 'LV 5 · BOSS' when resolved, '' otherwise. */
  sub: string;
  /** The shortlist when the face is unresolved — each candidate named, and
   * (only when the shortlist is SPLIT) what counters that face, mirroring the
   * forecast card. Empty when the boss resolved. */
  entries: readonly string[];
}

export interface BandBannerViewModel {
  /** Stable catalog identity used for exact biome artwork and audits. */
  biomeId: string;
  /** Exact texture key; unknown biome IDs fail in `biomeArtKey`, never fall back. */
  artKey: string;
  /** 'THE ARROWFELL'. */
  name: string;
  /** 'bow' — the raw type. The ONLY input to the band's hairline and its lean
   * pill, i.e. the one field here that becomes a COLOUR instead of a word;
   * `leanColor` below turns it into one and the suite pins the pairing per
   * band, because a broken `leanType` fails silently (all 11 bands bronze). */
  leanType: string;
  /** 'BOW' — the chip. */
  leanChip: string;
  /** 'REGION DAYS 1–5'; the field name stays compatible with existing renderers. */
  waveRange: string;
  boss: BandBannerBoss;
  bossClaim: BandCounterClaim;
  mobsClaim: BandCounterClaim;
  /** The whole forecast card, as lines — see `bandForecastCardLines` below. It
   * is the card, not the banner, that NAMES THE MOBS: see `bandBannerBlocks`. */
  card: readonly string[];
  guideSections: readonly {
    title: string;
    body: string;
    /** The one section-scoped fact that gets the band's own colour instead of
     * plain body text — currently only PREFERRED SHOPS' exclusive stall,
     * which `f.shops` never lists (it is drawn from `biomeCatalog`, not the
     * persisted forecast). Same swatch-plus-safe-ink treatment as the travel
     * card's BIOME EXCLUSIVE tag: `swatchColor` is a fill patch, never the
     * text colour, so it carries no legibility obligation of its own. */
    accent?: { text: string; swatchColor: number };
  }[];
  guideNote: string;
}

function enemyAffinityTypes(enemyId: string): readonly string[] {
  const def = enemies[enemyId];
  if (def === undefined) return [];
  const affinity = enemyDerivedAffinity(def);
  return [affinity.elementAffinity, affinity.weaponAffinity].filter((t): t is NonNullable<typeof t> => t !== undefined);
}

function affinityWords(types: readonly string[]): string {
  return types.map((t) => t.toUpperCase()).join(' / ');
}

function claim(subject: BandClaimSubject, kind: BandClaimKind, types: readonly string[]): BandCounterClaim {
  const who = subject === 'THIS BOSS' ? 'BOSS' : 'MOBS';
  if (kind === 'none') return { subject, kind, types: [], lines: [`${who} · NO AFFINITY`] };
  const list = affinityWords(types);
  const line = `${who} AFFINITY · ${kind === 'unsure' ? list.split(' / ').join(' OR ') : list}`;
  return { subject, kind, types, lines: line.length <= BAND_LINE_WIDTH ? [line] : [`${who} AFFINITY:`, list] };
}

function bossClaimOf(f: BandForecast): BandCounterClaim {
  if (f.boss !== null) {
    const types = enemyAffinityTypes(f.boss.enemyId);
    return claim('THIS BOSS', types.length === 0 ? 'none' : 'definite', types);
  }
  const faces = f.bossCandidates.map((c) => enemyAffinityTypes(c.id).join(','));
  const union: string[] = [];
  for (const c of f.bossCandidates) for (const t of enemyAffinityTypes(c.id)) if (!union.includes(t)) union.push(t);
  if (union.length === 0) return claim('THIS BOSS', 'none', []);
  const agreed = faces.every((face) => face === faces[0]);
  return claim('THIS BOSS', agreed ? 'definite' : 'unsure', agreed ? enemyAffinityTypes(f.bossCandidates[0]!.id) : union);
}

function mobsClaimOf(f: BandForecast): BandCounterClaim {
  return claim('THESE MOBS', 'definite', [f.lean.type]);
}

function bossOf(f: BandForecast): BandBannerBoss {
  if (f.boss !== null) {
    return {
      resolved: true,
      headline: f.boss.name.toUpperCase(),
      sub: `LV ${f.boss.level} · ${f.boss.title.toUpperCase()}`,
      entries: [],
    };
  }
  const entries: string[] = [];
  for (const c of f.bossCandidates) {
    const types = enemyAffinityTypes(c.id);
    entries.push(c.name.toUpperCase());
    entries.push(`  ${types.length === 0 ? 'NO AFFINITY' : `AFFINITY · ${affinityWords(types)}`}`);
  }
  return { resolved: false, headline: 'ONE OF THESE:', sub: '', entries };
}

export function typeCounterGuide(): string {
  const chains: string[] = [];
  const seen: string[] = [];
  for (const beats of [ELEMENT_BEATS as Record<string, string>, WEAPON_BEATS as Record<string, string>]) {
    for (const start of Object.keys(beats)) {
      if (seen.includes(start)) continue;
      const chain = [start];
      let next = beats[start];
      while (next !== undefined && !chain.includes(next)) { chain.push(next); next = beats[next]; }
      if (next !== undefined) chain.push(next);
      chain.forEach((t) => { if (!seen.includes(t)) seen.push(t); });
      chains.push(chain.map((t) => t.toUpperCase()).join(' > '));
    }
  }
  return `${chains.join(' · ')} (+50%)`;
}

// ---------------------------------------------------------------------------
// THE EXPLORE CARD — presentation over the unchanged internal forecast rows.
// Counter claims and per-boss counter details are omitted only here.
// ---------------------------------------------------------------------------

/** ONE row -> its card line(s). Exhaustive over `BandForecastRowStyle`: the
 * `never` check in `default` makes an unhandled new style a COMPILE ERROR,
 * the Phaser twin of `biomeForecast.ts#rowToAsciiLines`'s own exhaustive
 * switch. Exported so `tests/game/bandForecastRows.test.ts` can assert
 * totality directly, the same way it does for the ASCII side. */
export function rowToCardLines(row: BandForecastRow): string[] {
  const prefix = '  '.repeat(BAND_FORECAST_ROW_INDENT[row.style]);
  switch (row.style) {
    case 'name':
    case 'meta':
    case 'tagline':
    case 'heading':
    case 'bossName':
    case 'bossSub':
    case 'bossIntro':
    case 'bossUnresolved':
    case 'bossEntry':
    case 'entry':
      return [`${prefix}${row.text}`];
    case 'blank':
      return [''];
    case 'bossEntryCounter':
    case 'claim':
      return [];
    default: {
      const exhaustive: never = row;
      return exhaustive;
    }
  }
}

/** The band's exclusive stall, if the biome names one — derived from
 * `f.biomeId` (already part of the persisted `BandForecast`) rather than a
 * new field on it, the same derivation `bandForecastRows.ts` uses. `f.shops`
 * never lists it: it is a distinct, always-present-per-biome catalog fact,
 * not one of the biome's ordinary preferred stalls. */
function exclusiveShopName(f: Pick<BandForecast, 'biomeId'>): string | undefined {
  const exclusiveShopId = biomeCatalog[f.biomeId]?.exclusiveShop;
  if (exclusiveShopId === undefined) return undefined;
  return shopCatalog[exclusiveShopId]?.name ?? exclusiveShopId;
}

/** Compose the player-facing Explore read from the shared forecast rows. */
function bandForecastCardLines(f: BandForecast): readonly string[] {
  const lines: string[] = [];
  for (const row of bandForecastRows(f)) lines.push(...rowToCardLines(row));
  return lines;
}

/** The banner model for one forecast. Pure. */
export function bandBannerViewModel(f: BandForecast): BandBannerViewModel {
  const exclusiveShop = exclusiveShopName(f);
  return {
    biomeId: f.biomeId,
    artKey: biomeArtKey(f.biomeId),
    name: f.name.toUpperCase(),
    leanType: f.lean.type,
    leanChip: f.leanLabel,
    waveRange: `REGION DAYS ${expeditionDay(f.fromWave)}–${expeditionDay(f.throughWave)}`,
    boss: bossOf(f),
    bossClaim: bossClaimOf(f),
    mobsClaim: mobsClaimOf(f),
    card: bandForecastCardLines(f),
    guideSections: [
      { title: f.boss ? 'REGION BOSS' : 'POSSIBLE BOSSES', body: f.boss
        ? `${f.boss.name} · LV ${f.boss.level}`
        : f.bossCandidates.map((boss) => boss.name).join(' · ') || 'Not revealed' },
      { title: 'REGIONAL ENEMIES', body: f.mobs.map((mob) => mob.name).join(' · ') },
      {
        title: 'PREFERRED SHOPS',
        body: f.shops.map((shop) => shop.name).join(' · '),
        ...(exclusiveShop ? { accent: { text: `EXCLUSIVE · ${exclusiveShop}`, swatchColor: counterTypeColor(f.lean.type) } } : {}),
      },
      { title: 'TYPE COUNTERS', body: typeCounterGuide() },
      { title: 'COMMON EVENT THEMES', body: f.eventThemes.map((theme) => theme.charAt(0).toUpperCase() + theme.slice(1)).join(' · ') },
    ],
    guideNote: 'Listed shops and themes are not exclusive or guaranteed. Other stops can appear. Individual events may have region requirements.',
  };
}

export type BandBannerBackdropLayer =
  | {
    kind: 'image';
    textureKey: string;
    bounds: { x: number; y: number; width: number; height: number };
    alpha: number;
  }
  | {
    kind: 'scrim';
    bounds: { x: number; y: number; width: number; height: number };
    color: number;
    alpha: number;
  };

/** Ordered background layers for the Phaser renderer. The art fills the
 * existing banner rect; a light navy veil keeps color visible while the
 * renderer outlines the text locally to retain contrast on bright landmarks. */
export function bandBannerBackdropLayers(
  vm: Pick<BandBannerViewModel, 'artKey'>,
  rect: { x: number; y: number; w: number; h: number },
): readonly BandBannerBackdropLayer[] {
  const bounds = { x: rect.x, y: rect.y, width: rect.w, height: rect.h };
  return [
    { kind: 'image', textureKey: vm.artKey, bounds, alpha: 1 },
    { kind: 'scrim', bounds, color: UI.panelMuted, alpha: BRIGHT_ART_TREATMENT.biome.scrimAlpha },
  ];
}

/** The banner model for the band `wave` falls in. Reads the run, never
 * advances it (`forecastWave` previews on a COPY of the map). */
export function bandBannerForWave(run: RunState, wave: number): BandBannerViewModel {
  return bandBannerViewModel(forecastWave(run, wave));
}

// ---------------------------------------------------------------------------
// The banner's VERTICAL LAYOUT — pure, and the reason this section is here
// rather than next to the Phaser code that draws it.
//
// `bandBannerHeight` used to live in `RunRouteBoard.ts`, which imports Phaser,
// so no unit test could reach it — and it is load-bearing: on mobile the banner
// is drawn at the top of the map lane and the TRAIL gets whatever is left, so
// this number decides how legible the route board is. It was a second copy of
// the renderer's own cursor arithmetic, and the two were only ever checked by
// eye. That is exactly the disagreement that produced the wave-10 regression.
//
// So the arithmetic is here, once, as a list of ROWS, and the renderer walks
// that list instead of keeping a cursor of its own. `bandBannerHeight` is the
// same walk's total. They cannot drift because there is nothing to drift from,
// and `tests/game/bandBannerViewModel.test.ts` pins the property the renderer
// depends on: the button row ends exactly one pad above the reported height,
// and no row is drawn outside it.
//
// NO "MOBS" HEADING. The banner used to print a MOBS heading over a block that
// contained no mob names — they are only in the forecast card, behind
// `EXPLORE REGION ›`. The mob claim NAMES ITS OWN SUBJECT ("... THESE MOBS ..."),
// which is the whole point of 3881717, so the heading added no information and
// promised a list that was not under it; listing the names instead would cost
// four to six lines of the same mobile map lane this layout exists to protect.
// The heading goes; `vm.mobs` went with it. The BOSS heading stays because it
// labels a thing that IS there — the boss's name, on the next line.
// ---------------------------------------------------------------------------

export type BandBannerMode = 'desktop' | 'mobile';

export interface BandBannerMetrics {
  pad: number;
  name: number;
  lean: number;
  wave: number;
  heading: number;
  bossName: number;
  sub: number;
  claim: number;
  button: number;
  lineGap: number;
  blockGap: number;
}

export const BAND_BANNER_METRICS: Record<BandBannerMode, BandBannerMetrics> = {
  desktop: { pad: 14, name: 18, lean: 11, wave: 11, heading: 10, bossName: 15, sub: 10, claim: 12, button: 26, lineGap: 9, blockGap: 8 },
  mobile: { pad: 8, name: 13, lean: 9, wave: 9, heading: 8, bossName: 12, sub: 9, claim: 10, button: 24, lineGap: 7, blockGap: 7 },
};

/** Colour of a COUNTER type — element first, then weapon (the two key spaces
 * never collide), falling back to the generic chip bronze. */
export function counterTypeColor(type: string | undefined): number {
  if (type === undefined) return UI.chip;
  return ELEMENT_COLOR[type] ?? WEAPON_COLOR[type] ?? UI.chip;
}

/** The band's own colour: its hairline and its lean pill. `vm.leanType` is the
 * ONLY input, which is why the suite pins it per band — a `leanType` mutated to
 * garbage still renders every word correctly and turns all 11 bands bronze. */
export function leanColor(vm: Pick<BandBannerViewModel, 'leanType'>): number {
  return counterTypeColor(vm.leanType);
}

/** Text colour per certainty. `'none'` deliberately gets the SAME danger red
 * the boss-countdown headline uses — "no type helps you here" is a loud fact,
 * not a greyed-out blank. */
export function claimTextColor(kind: BandClaimKind): string {
  if (kind === 'none') return UI.textDim;
  if (kind === 'unsure') return UI.textAccent;
  return UI.text;
}

/** The bar beside a claim. Decoration — the SENTENCE carries the subject, so
 * the block reads with the colour ignored entirely. */
export function claimBarColor(claim: BandCounterClaim): number {
  if (claim.kind === 'none') return UI.chip;
  if (claim.kind === 'unsure') return UI.waiting;
  return counterTypeColor(claim.types[0]);
}

export type BandBannerRowStyle =
  | 'name' | 'wave' | 'rule' | 'heading' | 'bossName' | 'bossSub' | 'bossEntry' | 'claim' | 'button';

export interface BandBannerRow {
  style: BandBannerRowStyle;
  text: string;
  /** Top of the row, offset from the banner rect's own top edge. */
  y: number;
  /** The row's own height (the font size for text rows). */
  height: number;
  /** Offset from the banner's INNER left edge. */
  indent: number;
  /** Text colour (ignored for `'rule'`). */
  color: string;
  /** Present on the FIRST line of a claim: the colour bar beside the whole
   * claim block, so the renderer never measures the block itself. */
  bar?: { color: number; height: number };
}

export interface BandBannerLayout {
  metrics: BandBannerMetrics;
  rows: readonly BandBannerRow[];
  /** Exactly the height the rows need — what a caller must reserve. */
  height: number;
}

/** Every row the banner draws, in order, with the height they add up to. */
export function bandBannerLayout(vm: BandBannerViewModel, mode: BandBannerMode): BandBannerLayout {
  const m = BAND_BANNER_METRICS[mode];
  const rows: BandBannerRow[] = [];
  let cursor = m.pad;
  const push = (style: BandBannerRowStyle, text: string, height: number, color: string, gap: number, extra?: Partial<BandBannerRow>): void => {
    rows.push({ style, text, y: cursor, height, indent: 0, color, ...extra });
    cursor += height + gap;
  };

  push('name', vm.name, m.name, UI.text, m.lineGap);
  push('wave', vm.waveRange, m.wave, UI.textDim, m.blockGap);

  // A rule is a hairline, not text — its colour is the renderer's `UI.border`.
  const rule = (): void => { push('rule', '', 1, '', m.blockGap); };
  const claimBlock = (c: BandCounterClaim): void => {
    const color = claimTextColor(c.kind);
    const barHeight = c.lines.length * (m.claim + m.lineGap) - m.lineGap;
    c.lines.forEach((line, index) => {
      push('claim', line, m.claim, color, m.lineGap, {
        indent: 6,
        ...(index === 0 ? { bar: { color: claimBarColor(c), height: barHeight } } : {}),
      });
    });
  };

  rule();
  push('heading', 'BOSS', m.heading, UI.textSoft, m.lineGap);
  push('bossName', vm.boss.headline, m.bossName, UI.text, m.lineGap);
  if (vm.boss.resolved) push('bossSub', vm.boss.sub, m.sub, UI.textDim, m.lineGap);
  else for (const entry of vm.boss.entries) push('bossEntry', entry, m.sub, UI.textDim, m.lineGap);
  claimBlock(vm.bossClaim);

  // No MOBS heading — see the section comment above.
  rule();
  claimBlock(vm.mobsClaim);

  push('button', 'EXPLORE REGION ›', m.button, UI.textAccent, 0);
  return { metrics: m, rows, height: cursor + m.pad };
}

/** Exact height `renderRunBandBanner` will occupy for THIS model — claim lines
 * vary (a long type list flips to two lines) and an unresolved boss lists its
 * shortlist, so callers reserve the real number instead of guessing one. */
export function bandBannerHeight(vm: BandBannerViewModel, mode: BandBannerMode): number {
  return bandBannerLayout(vm, mode).height;
}
