// Band forecast — the READ. A band the player cannot read before entering it is
// not a path, it is a label; the whole biome feature is the sentence "I can see
// what the next five waves supply and which boss ends them" (see
// docs/biome-paths-proposal.md §2.4, and §0: "if the player cannot read the
// branch ahead of committing, the feature does not exist").
//
// This module is the ONE place that sentence is composed, so every surface that
// shows it — the band banner, the boss-countdown panel, the route board, and
// later the fork panel — reads the same model and cannot disagree. The boss line
// comes from the REAL `rollEncounter` on the future boss node (the same call the
// map's own fight previews make), never from a re-derivation: a forecast that
// computed the boss a second way would eventually name a different one.
//
// PURE + LOOKAHEAD-SAFE: `forecastBand` extends a COPY of the map with
// `ensureWavesThrough` and composes a throwaway `currentNodeId` (the idiom
// `runStore.ts#previewEncounter` already uses). It never mutates the run and
// never advances it, so previewing band 4 from band 0 is free and repeatable.
//
// PREDICTABLE IN KIND, SURPRISING IN DETAIL: the band's character — its lean,
// its mob family, its boss, its stalls, its event themes — is fully readable
// here. WHICH specific event, WHICH shelf roll, and which of three risk tiers
// stay hidden until the column. Do not extend this to reveal individual future
// nodes; that removes the reason to walk the map.

import type { EnemyTitle } from './encounter';
import type { EventTheme } from '../data/events';
import { enemies } from '../data/enemies';
import { shopCatalog } from '../data/shopTypes';
import {
  bandIndexOf, biomeForBand, bossWaveOfBand, counterTypeFor, counterTypesFor, firstWaveOfBand,
  leanLabel, type BiomeDef, type BiomeLean,
} from './biome';
import { ensureWavesThrough } from './runMap';
import { rollEncounter, type RunState } from './runState';

export interface BandForecastEntry {
  id: string;
  name: string;
}

/** One face the band's boss column could wear, and what counters THAT face. */
export interface BossCandidate extends BandForecastEntry {
  /** Types that get +50% on this candidate (`counterTypesFor`). Sorted; empty
   * means nothing does. */
  counterTypes: readonly string[];
}

/**
 * What is TRUE, at forecast time, about countering this band's BOSS — kept
 * separate from `counterType` (which is about the MOBS) because for FOUR of the
 * six biomes they are DIFFERENT ANSWERS, and printing the mob one under the boss
 * block was the forecast's one outright lie: a player reading the Hallowfield's
 * "dark hits these mobs for +50%" and bringing dark met The Hollow Crown, which
 * is dark itself and takes nothing extra from it.
 *
 * `basis` is the CERTAINTY, derived rather than assumed:
 *
 *  - `'named'` — the boss column resolved to one enemy (the normal case: a boss
 *    column is a single mandatory node whose `encounterSeed` is a pure
 *    `hashSeed(seed, id)`, and `tests/run/biomeMobs.test.ts` proves the boss the
 *    forecast names is the boss that rolls). `types` are ITS counters, and the
 *    line may be definite — exactly as definite as the NAME printed above it.
 *  - `'shortlist'` — the boss did not resolve, but every candidate on the
 *    biome's shortlist shares the same counters, so the answer is still definite
 *    without knowing which face comes (the Ironmoot: both faces are axe, so
 *    "sword" is safe to promise).
 *  - `'split'` — the boss did not resolve AND the candidates disagree (the
 *    Howlmoor: frost vs beast, so lightning vs bow). NO type is guaranteed;
 *    `types` is the UNION, true of SOME face rather than of the boss, and the
 *    renderer must not state it as a promise.
 */
export interface BossCounterRead {
  basis: 'named' | 'shortlist' | 'split';
  /** Sorted. Definite when `basis !== 'split'`; a union of possibilities when it is. */
  types: readonly string[];
}

/** The shortlist, named, with each face's own counters — catalog order, and
 * existence-filtered exactly as `rollEncounter` filters it, so a candidate the
 * roll could never produce is never advertised. */
function bossCandidatesFor(biome: BiomeDef): readonly BossCandidate[] {
  const out: BossCandidate[] = [];
  for (let i = 0; i < biome.bosses.length; i++) {
    const id = biome.bosses[i]!;
    const def = enemies[id];
    if (def === undefined) continue;
    out.push({ id, name: def.name, counterTypes: counterTypesFor(def.elementAffinity, def.weaponAffinity) });
  }
  return out;
}

/**
 * The boss counter read. Derived from the RESOLVED boss when there is one —
 * never from the biome's declared lean (which describes the mobs) and never
 * from the shortlist when the specific enemy is known, since re-deriving what
 * the model already holds is how two answers start disagreeing.
 *
 * EXPORTED because `bossCounter` is DERIVED state: a caller that changes which
 * boss it knows about (the phase-3 fork panel, showing a band whose column has
 * not been generated; a test exercising the unresolved branch) must recompose
 * the read through THIS function rather than spread a stale one or hand-derive a
 * second answer. `{ ...forecast, boss: null }` alone is a lie — it keeps the
 * named boss's counter under a boss that is no longer named. (Found exactly that
 * way while rendering the split branch for review.)
 */
export function bossCounterFor(
  boss: BandForecast['boss'],
  candidates: readonly BossCandidate[],
): BossCounterRead {
  if (boss !== null) {
    const def = enemies[boss.enemyId];
    return { basis: 'named', types: counterTypesFor(def?.elementAffinity, def?.weaponAffinity) };
  }
  if (candidates.length === 0) return { basis: 'shortlist', types: [] };
  const first = candidates[0]!;
  let agreed = true;
  for (let i = 1; i < candidates.length; i++) {
    if (candidates[i]!.counterTypes.join(',') !== first.counterTypes.join(',')) agreed = false;
  }
  if (agreed) return { basis: 'shortlist', types: first.counterTypes };
  const union: string[] = [];
  for (let i = 0; i < candidates.length; i++) {
    const types = candidates[i]!.counterTypes;
    for (let j = 0; j < types.length; j++) {
      const t = types[j]!;
      if (!union.includes(t)) union.push(t);
    }
  }
  return { basis: 'split', types: union.sort() };
}

export interface BandForecast {
  /** 0-indexed band. */
  band: number;
  /** Inclusive wave range this band covers. */
  fromWave: number;
  throughWave: number;
  biomeId: string;
  name: string;
  tagline: string;
  lean: BiomeLean;
  /** "FIRE" / "AXE" — the chip. */
  leanLabel: string;
  /** The biome's preferred mobs, in catalog order, named. */
  mobs: readonly BandForecastEntry[];
  /** The boss that actually rolls at `throughWave`, or null if it cannot be
   * resolved (a run with no map, e.g.). Level/title are the resolved fight spec. */
  boss: { enemyId: string; name: string; level: number; title: EnemyTitle } | null;
  /** Every face the boss column could wear — the biome's shortlist, named, with
   * each face's own counters. Always at least one entry
   * (`tests/run/biomeIntegrity.test.ts` forbids an empty shortlist). */
  bossCandidates: readonly BossCandidate[];
  /** What is true about countering the BOSS. Distinct from `counterType`, which
   * is about the MOBS — see `BossCounterRead`. */
  bossCounter: BossCounterRead;
  /** The stalls this band prefers, named. */
  shops: readonly BandForecastEntry[];
  eventThemes: readonly EventTheme[];
  /** The type that hits this band's mobs for +50%, if any. */
  counterType?: string;
}

/** The forecast for the band `wave` falls in. */
export function forecastWave(state: RunState, wave: number): BandForecast {
  return forecastBand(state, bandIndexOf(wave));
}

/** The forecast for the band AFTER the one `state` is currently in — "what am I
 * walking into", the read the fork panel will eventually be built on. */
export function forecastNextBand(state: RunState, currentWave: number): BandForecast {
  return forecastBand(state, bandIndexOf(currentWave) + 1);
}

/**
 * Everything a player may know about band `band` of this run before entering it.
 * Reads `state` but never returns a modified one.
 */
export function forecastBand(state: RunState, band: number): BandForecast {
  const b = Math.max(0, Math.floor(band));
  const seed = state.map.seed;
  const biome = biomeForBand(seed, b);
  const bossWave = bossWaveOfBand(b);

  let boss: BandForecast['boss'] = null;
  const map = ensureWavesThrough(state.map, bossWave);
  for (const column of map.depths) {
    for (const node of column) {
      if (node.kind !== 'boss' || node.wave !== bossWave) continue;
      const pack = rollEncounter({ ...state, map, currentNodeId: node.id });
      const unit = pack.units[0];
      if (unit) {
        boss = {
          enemyId: unit.enemyId,
          name: enemies[unit.enemyId]?.name ?? unit.enemyId,
          level: unit.level,
          title: unit.title,
        };
      }
      break;
    }
    if (boss) break;
  }

  const candidates = bossCandidatesFor(biome);
  return {
    band: b,
    fromWave: firstWaveOfBand(b),
    throughWave: bossWave,
    biomeId: biome.id,
    name: biome.name,
    tagline: biome.tagline,
    lean: biome.lean,
    leanLabel: leanLabel(biome.lean),
    mobs: biome.mobs.map((id) => ({ id, name: enemies[id]?.name ?? id })),
    boss,
    bossCandidates: candidates,
    bossCounter: bossCounterFor(boss, candidates),
    shops: biome.shops.map((id) => ({ id, name: shopCatalog[id]?.name ?? id })),
    eventThemes: biome.eventThemes,
    counterType: counterTypeFor(biome.lean),
  };
}

/** Longest line the phone format allows (CLAUDE.md, USER-LOCKED 2026-08-25). */
const FORECAST_WIDTH = 28;

/**
 * The counter sentence for ONE block, as its own stacked lines.
 *
 * `subject` is what the claim is about ("this boss" / "these mobs") and it is
 * REQUIRED, not optional: an unqualified "+50%" line was the bug — it read as
 * true of whichever block it happened to sit under. Every counter line this
 * renderer emits names its own subject.
 *
 * Grammar is derived, not hard-coded, so a future dual-affinity boss reads
 * correctly: one type "hits", two or more "hit". If the type list makes the
 * first line too wide for a phone, the sentence flips to a colon form that puts
 * the types on a line of their own rather than wrapping.
 */
function counterSentence(subject: string, types: readonly string[]): string[] {
  if (types.length === 0) return ['nothing counters', `${subject}.`];
  const list = types.join(' and ');
  const head = `${list} ${types.length === 1 ? 'hits' : 'hit'} ${subject.split(' ')[0]!}`;
  const tail = `${subject.split(' ').slice(1).join(' ')} for +50%.`;
  if (head.length <= FORECAST_WIDTH && tail.length <= FORECAST_WIDTH) return [head, tail];
  return [`+50% on ${subject}:`, `${list}.`];
}

/** What a single candidate's counters look like beside its name, when the band
 * cannot promise one answer and has to show the fork instead. */
function candidateCounter(types: readonly string[]): string {
  return types.length === 0 ? 'nothing counters it' : `${types.join('/')} +50%`;
}

/**
 * The forecast as text — MOBILE-FIRST (CLAUDE.md, USER-LOCKED 2026-08-25): one
 * fact per line, nothing past ~28 characters, never two facts packed onto a row.
 * This is the production renderer, not a demo one: the Phaser band banner and
 * the boss-countdown panel are to render THIS model (a second renderer would
 * drift, exactly as the hand-written combat-log demo did).
 *
 * TWO COUNTER LINES, EACH INSIDE THE BLOCK IT DESCRIBES (fixed 2026-08-26). The
 * renderer used to print exactly ONE counter line — the MOB one, derived from
 * the biome's declared lean — as a FOOTER for the whole card, after EVENTS and
 * with no subject named. Nothing tied it to the mobs, so it read as a promise
 * about the whole band, boss included, and for FOUR of the twelve (biome, boss
 * face) pairs the catalog can field it was false about the boss:
 *
 *   emberwaste/galewright        card said frost, boss wants nature
 *   hallowfield/hollow_crown     card said dark,  boss wants holy
 *   howlmoor/rime_tyrant         card said bow,   boss wants lightning
 *   swornhold/thornpike_marshal  card said lance, boss wants axe
 *
 * (`thornwild`/`greenwood_sovereign` is named as off-type in the bug report but
 * is NOT one of them: it carries `elementAffinity: 'nature'` — the Thornwild's
 * own lean — plus `weaponAffinity: 'bow'`, and nothing counters bow, so "fire"
 * was already true of it. Measured, not assumed; see the counter suite.)
 *
 * The fix is positional as well as textual. Each counter sentence now sits
 * immediately under the block it is about and names its subject, so proximity
 * and wording agree; a claim can no longer be inherited by the block above it.
 * The mob sentence's own wording is unchanged, deliberately — this adds a line,
 * it does not quietly redefine the existing one.
 */
export function renderBandForecast(f: BandForecast): string {
  const lines: string[] = [];
  lines.push(`${f.name.toUpperCase()}`);
  lines.push(`[${f.leanLabel}] w${f.fromWave}-${f.throughWave}`);
  lines.push(f.tagline);
  lines.push('');
  lines.push('BOSS');
  const split = f.bossCounter.basis === 'split';
  if (f.boss) {
    lines.push(`  ${f.boss.name}`);
    lines.push(`  LV ${f.boss.level} · ${f.boss.title.toUpperCase()}`);
  } else if (f.bossCandidates.length > 0) {
    // The specific face did not resolve, so the honest read is the SHORTLIST —
    // every name it could be, and (only when they disagree) what each one gives
    // way to. Naming the fork beats the old bare "(unresolved)".
    lines.push('  one of these:');
    for (const c of f.bossCandidates) {
      lines.push(`  ${c.name}`);
      if (split) lines.push(`    ${candidateCounter(c.counterTypes)}`);
    }
  } else {
    lines.push('  (unresolved)');
  }
  if (split) {
    // No type is true of BOTH faces, so no type may be printed as a promise.
    lines.push('no counter is sure.');
  } else {
    for (const line of counterSentence('this boss', f.bossCounter.types)) lines.push(line);
  }
  lines.push('');
  lines.push('MOBS');
  for (const m of f.mobs) lines.push(`  ${m.name}`);
  if (f.counterType) {
    lines.push(`${f.counterType} hits these`);
    lines.push('mobs for +50%.');
  }
  lines.push('');
  lines.push('SHOPS');
  for (const s of f.shops) lines.push(`  ${s.name}`);
  lines.push('');
  lines.push('EVENTS');
  for (const t of f.eventThemes) lines.push(`  ${t}`);
  return lines.join('\n');
}
