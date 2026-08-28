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
  /** The short HUD chip: 'FIRE +50%' / 'NO SURE COUNTER' / 'NO COUNTER'. */
  chip: string;
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
  band: number;
  /** 'THE ARROWFELL'. */
  name: string;
  leanKind: 'element' | 'weapon';
  /** 'bow' — the raw type, for the renderer's colour/icon lookup. */
  leanType: string;
  /** 'BOW' — the chip. */
  leanChip: string;
  /** 'WAVES 1-5'. */
  waveRange: string;
  tagline: string;
  boss: BandBannerBoss;
  bossClaim: BandCounterClaim;
  /** The band's mobs, named, catalog order. */
  mobs: readonly string[];
  mobsClaim: BandCounterClaim;
  /** The whole forecast card — `renderBandForecast`, split to lines. */
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
    return { subject, kind, types: [], chip: 'NO COUNTER', lines: [`NOTHING COUNTERS ${subject}`] };
  }
  if (kind === 'unsure') {
    // No type is true of BOTH faces, so no type may be printed as a promise.
    return { subject, kind, types, chip: 'NO SURE COUNTER', lines: ['NO COUNTER IS SURE FOR', `${subject}.`] };
  }
  const list = types.map((t) => t.toUpperCase()).join('/');
  const sentence = `${list} ${types.length === 1 ? 'HITS' : 'HIT'} ${subject} +50%`;
  return {
    subject,
    kind,
    types,
    chip: `${list} +50%`,
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
    band: f.band,
    name: f.name.toUpperCase(),
    leanKind: f.lean.kind,
    leanType: f.lean.type,
    leanChip: f.leanLabel,
    waveRange: `WAVES ${f.fromWave}-${f.throughWave}`,
    tagline: f.tagline,
    boss: bossOf(f),
    bossClaim: bossClaimOf(f),
    mobs: f.mobs.map((m) => m.name),
    mobsClaim: mobsClaimOf(f),
    card: renderBandForecast(f).split('\n'),
  };
}

/** The banner model for the band `wave` falls in. Reads the run, never
 * advances it (`forecastWave` previews on a COPY of the map). */
export function bandBannerForWave(run: RunState, wave: number): BandBannerViewModel {
  return bandBannerViewModel(forecastWave(run, wave));
}
