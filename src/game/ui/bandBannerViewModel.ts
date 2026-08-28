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
 * `card` is the FULL read, and it is `renderBandForecast` itself — the pinned
 * production renderer (`tests/run/biomeForecastCounter.test.ts` holds it
 * character-for-character over 12 seeds x 6 bands), not a second copy of it.
 * The banner is a SUMMARY of that card, so the two cannot drift about what is
 * true; the test asserts the summary agrees with the card line by line.
 */

import { forecastWave, renderBandForecast, type BandForecast } from '../../run/biomeForecast';
import type { RunState } from '../../run/runState';
import { ELEMENT_COLOR, UI, WEAPON_COLOR } from '../theme';

/** Longest line the phone format allows (CLAUDE.md, USER-LOCKED 2026-08-25) —
 * the same 28 the forecast card is composed at, so a banner line and a card
 * line wrap at the same place. */
export const BAND_LINE_WIDTH = 28;

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
  /** 'THE ARROWFELL'. */
  name: string;
  /** 'bow' — the raw type. The ONLY input to the band's hairline and its lean
   * pill, i.e. the one field here that becomes a COLOUR instead of a word;
   * `leanColor` below turns it into one and the suite pins the pairing per
   * band, because a broken `leanType` fails silently (all 11 bands bronze). */
  leanType: string;
  /** 'BOW' — the chip. */
  leanChip: string;
  /** 'WAVES 1-5'. */
  waveRange: string;
  boss: BandBannerBoss;
  bossClaim: BandCounterClaim;
  mobsClaim: BandCounterClaim;
  /** The whole forecast card — `renderBandForecast`, split to lines. It is the
   * card, not the banner, that NAMES THE MOBS: see `bandBannerBlocks`. */
  card: readonly string[];
}

/**
 * One claim, as words. `types` is ignored for `'none'` and never turned into a
 * sentence for `'unsure'`.
 *
 * Grammar is derived, not hard-coded (one type "HITS", two or more "HIT"), and
 * when the type list makes the sentence too wide for a phone it flips to a
 * colon form that puts the types on their own line rather than wrapping —
 * the same two shapes `biomeForecast.ts#counterSentence` uses, so the banner
 * and the card break in the same places.
 */
function claim(subject: BandClaimSubject, kind: BandClaimKind, types: readonly string[]): BandCounterClaim {
  if (kind === 'none') {
    return { subject, kind, types: [], lines: [`NOTHING COUNTERS ${subject}`] };
  }
  if (kind === 'unsure') {
    // No type is true of BOTH faces, so no type may be printed as a promise.
    return { subject, kind, types, lines: ['NO COUNTER IS SURE FOR', `${subject}.`] };
  }
  const list = types.map((t) => t.toUpperCase()).join('/');
  const sentence = `${list} ${types.length === 1 ? 'HITS' : 'HIT'} ${subject} +50%`;
  return {
    subject,
    kind,
    types,
    lines: sentence.length <= BAND_LINE_WIDTH ? [sentence] : [`+50% ON ${subject}:`, list],
  };
}

/** What counters THIS BOSS, at the certainty the forecast actually has. */
function bossClaimOf(f: BandForecast): BandCounterClaim {
  if (f.bossCounter.basis === 'split') return claim('THIS BOSS', 'unsure', f.bossCounter.types);
  return claim('THIS BOSS', f.bossCounter.types.length === 0 ? 'none' : 'definite', f.bossCounter.types);
}

/** What counters THESE MOBS — the biome's declared lean, which for four of the
 * catalog's (biome, boss face) pairs is a DIFFERENT answer from the boss's. */
function mobsClaimOf(f: BandForecast): BandCounterClaim {
  const type = f.counterType;
  return type === undefined
    ? claim('THESE MOBS', 'none', [])
    : claim('THESE MOBS', 'definite', [type]);
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
  const split = f.bossCounter.basis === 'split';
  const entries: string[] = [];
  for (const c of f.bossCandidates) {
    entries.push(c.name.toUpperCase());
    // Only a SPLIT shortlist needs the per-face answer: when the faces agree,
    // the single claim below the block is already true of whichever one comes.
    if (split) entries.push(`  ${c.counterTypes.length === 0 ? 'NOTHING COUNTERS IT' : `${c.counterTypes.map((t) => t.toUpperCase()).join('/')} +50%`}`);
  }
  return { resolved: false, headline: 'ONE OF THESE:', sub: '', entries };
}

/** The banner model for one forecast. Pure. */
export function bandBannerViewModel(f: BandForecast): BandBannerViewModel {
  return {
    name: f.name.toUpperCase(),
    leanType: f.lean.type,
    leanChip: f.leanLabel,
    waveRange: `WAVES ${f.fromWave}-${f.throughWave}`,
    boss: bossOf(f),
    bossClaim: bossClaimOf(f),
    mobsClaim: mobsClaimOf(f),
    card: renderBandForecast(f).split('\n'),
  };
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
// `READ THE BAND ›`. The mob claim NAMES ITS OWN SUBJECT ("... THESE MOBS ..."),
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
  desktop: { pad: 14, name: 18, lean: 11, wave: 11, heading: 10, bossName: 15, sub: 10, claim: 12, button: 26, lineGap: 4, blockGap: 8 },
  mobile: { pad: 8, name: 13, lean: 9, wave: 9, heading: 8, bossName: 12, sub: 9, claim: 10, button: 24, lineGap: 3, blockGap: 7 },
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
  if (kind === 'none') return '#e0654a';
  if (kind === 'unsure') return UI.textAccent;
  return UI.text;
}

/** The bar beside a claim. Decoration — the SENTENCE carries the subject, so
 * the block reads with the colour ignored entirely. */
export function claimBarColor(claim: BandCounterClaim): number {
  if (claim.kind === 'none') return UI.bad;
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

  push('button', 'READ THE BAND ›', m.button, UI.textAccent, 0);
  return { metrics: m, rows, height: cursor + m.pad };
}

/** Exact height `renderRunBandBanner` will occupy for THIS model — claim lines
 * vary (a long type list flips to two lines) and an unresolved boss lists its
 * shortlist, so callers reserve the real number instead of guessing one. */
export function bandBannerHeight(vm: BandBannerViewModel, mode: BandBannerMode): number {
  return bandBannerLayout(vm, mode).height;
}
