import { describe, expect, it } from 'vitest';
import { createRun } from '../../src/run/runState';
import {
  bossCounterFor, forecastBand, renderBandForecast, type BandForecast,
} from '../../src/run/biomeForecast';
import { counterTypeFor } from '../../src/run/biome';
import { biomeCatalog, biomeIds } from '../../src/data/biomes';
import { enemies } from '../../src/data/enemies';
import {
  ELEMENT_BEATS, WEAPON_BEATS, elementMatchup, matchupPct, weaponMatchup,
} from '../../src/engine/elements';
import type { Element, EnemyDef, WeaponType } from '../../src/engine/types';

/**
 * THE FORECAST MAY NOT PRINT A COUNTER CLAIM THAT IS FALSE OF THE THING IT
 * DESCRIBES.
 *
 * THE BUG THIS SUITE CLOSES (found and left unfixed by `532b6ac`): the band card
 * carried exactly ONE counter line — the MOB one, derived from the biome's
 * declared lean — as a footer for the whole card. Five of the six biomes field
 * an OFF-TYPE boss, so that single line was read as a promise about the boss and
 * was false about it:
 *
 *   [HOLY] w21-25
 *   BOSS
 *     The Hollow Crown        <- dark; countered by HOLY
 *   ...
 *   dark hits these
 *   mobs for +50%.            <- true of the mobs, wrong for the boss
 *
 * A player brought dark, got +50% on the mobs and NOTHING on the boss. That is
 * worse than an incomplete forecast: the premise of the whole biome feature is
 * that the banner can be trusted.
 *
 * WHAT IS ASSERTED, and why it is not a tautology: "counters" is resolved
 * through the ENGINE'S OWN matchup functions (`elementMatchup` /
 * `weaponMatchup` / `matchupPct` in `src/engine/elements.ts`) — the same math
 * that applies the damage — rather than through `counterTypesFor`, the
 * production helper under test. If the helper and the engine ever disagree,
 * these tests fail; they do not re-run the implementation and agree with it.
 *
 * MUTATION-CHECKED (2026-08-26) against three injected bugs:
 *   1. drop the boss counter emission from the renderer (i.e. HEAD's renderer) —
 *      "the BOSS block states no counter" fires for every band;
 *   2. derive the boss counter from the biome's LEAN instead of the boss (the
 *      original bug, now stated as code) — the truth test fires and names the
 *      off-type band;
 *   3. key the boss counter off the shortlist's FIRST face instead of the
 *      resolved boss — fires on every band whose column rolled the other face.
 */

/** Every type name a counter claim could legitimately print — the full value
 * range of `counterTypeFor`: an element that beats an element, or a weapon that
 * beats a weapon. Used to scan rendered text for type words. */
const COUNTER_VOCABULARY: readonly string[] = [
  ...Object.keys(ELEMENT_BEATS), ...Object.keys(WEAPON_BEATS),
].sort();

/**
 * The types that ACTUALLY get +50% on `def`, straight out of the engine's
 * matchup math. Both affinities are asked independently, because
 * `src/engine/elements.ts` resolves them independently — `greenwood_sovereign`
 * is nature AND bow, and the fire advantage off its nature half stands whatever
 * the weapon half says.
 */
function realCountersOf(def: EnemyDef): readonly string[] {
  const out: string[] = [];
  for (const t of COUNTER_VOCABULARY) {
    const byElement = elementMatchup(t as Element, def.elementAffinity) === 'advantage';
    const byWeapon = weaponMatchup(t as WeaponType, def.weaponAffinity) === 'advantage';
    if (byElement || byWeapon) out.push(t);
  }
  return out.sort();
}

interface RenderedBlock {
  header: string;
  /** Indented entries (mob names, boss name, LV line, ...). */
  items: string[];
  /** The flush-left prose that follows the entries — the block's counter claim. */
  claim: string;
}

/**
 * Parse the rendered card into blocks. The renderer's grammar makes this
 * unambiguous ON PURPOSE: an ALL-CAPS flush-left line opens a block, indented
 * lines are its entries, and any flush-left prose after those entries is that
 * block's claim. That grammar IS the fix — a claim can no longer float free of
 * a subject the way the old card-footer one did.
 */
function parseBlocks(text: string): RenderedBlock[] {
  const blocks: RenderedBlock[] = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.length === 0) continue;
    const isHeader = line === line.toUpperCase() && /^[A-Z]+$/.test(line);
    if (isHeader) {
      blocks.push({ header: line, items: [], claim: '' });
      continue;
    }
    const current = blocks[blocks.length - 1];
    if (current === undefined) continue; // the title/lean/tagline preamble
    if (line.startsWith('  ')) current.items.push(line.trim());
    else current.claim = current.claim.length === 0 ? line : `${current.claim} ${line}`;
  }
  return blocks;
}

function blockNamed(text: string, header: string): RenderedBlock {
  const found = parseBlocks(text).find((b) => b.header === header);
  expect(found, `the render has no ${header} block:\n${text}`).toBeDefined();
  return found!;
}

/** Every type word named anywhere in `claim`, sorted. */
function typesNamedIn(claim: string): readonly string[] {
  return COUNTER_VOCABULARY.filter((t) => new RegExp(`\\b${t}\\b`).test(claim)).sort();
}

/** One (seed, band) per biome, so every biome is exercised, plus a broad sweep. */
const SWEEP_SEEDS = Array.from({ length: 24 }, (_, i) => i + 1);
const SWEEP_BANDS = [0, 1, 2, 3, 4, 5];

describe('the BOSS counter claim is true of the boss', () => {
  it('+50% is what "advantage" means, so the wording is grounded in the engine', () => {
    expect(matchupPct('advantage')).toBe(150);
  });

  it('every band states a boss counter, and it is the RESOLVED boss\'s own — never the mobs\'', () => {
    const biomesSeen = new Set<string>();
    const offTypeBands: string[] = [];
    let checked = 0;
    for (const seed of SWEEP_SEEDS) {
      const run = createRun(seed);
      for (const band of SWEEP_BANDS) {
        const f = forecastBand(run, band);
        expect(f.boss, `seed ${seed} band ${band} resolved no boss`).not.toBeNull();
        const def = enemies[f.boss!.enemyId];
        expect(def, `unknown boss id ${f.boss!.enemyId}`).toBeDefined();
        const expected = realCountersOf(def!);
        const text = renderBandForecast(f);
        const boss = blockNamed(text, 'BOSS');

        // (1) THE BLOCK MUST CARRY ITS OWN CLAIM. This is the assertion HEAD's
        // renderer fails: it printed no counter line inside the boss block at
        // all, leaving the card's single mob-derived footer to be read as one.
        expect(
          boss.claim.length,
          `seed ${seed} band ${band} (${f.biomeId}): the BOSS block states no counter:\n${text}`,
        ).toBeGreaterThan(0);

        // (2) AND IT MUST NAME EXACTLY THE BOSS'S COUNTERS — no type that is
        // false of it, and none of its real counters omitted.
        expect(
          typesNamedIn(boss.claim),
          `seed ${seed} band ${band}: "${boss.claim}" is not true of ${f.boss!.enemyId}`,
        ).toEqual(expected);
        if (expected.length === 0) expect(boss.claim).toContain('nothing counters');

        // (3) THE BUG, STATED DIRECTLY: on an off-type band the boss claim must
        // NOT be the mob claim. Both renderers pass (2) on `ironmoot`, where the
        // two answers coincide; only this catches "reused the mob counter".
        const mobCounter = f.counterType;
        if (mobCounter !== undefined && !expected.includes(mobCounter)) {
          offTypeBands.push(`${f.biomeId}/${f.boss!.enemyId}`);
          expect(
            typesNamedIn(boss.claim),
            `seed ${seed} band ${band}: the boss claim reuses the MOB counter "${mobCounter}"`,
          ).not.toContain(mobCounter);
        }
        biomesSeen.add(f.biomeId);
        checked += 1;
      }
    }
    expect(biomesSeen.size, 'the sweep did not reach every biome').toBe(biomeIds.length);
    expect(checked).toBeGreaterThan(100);
    // NON-VACUITY, AND A CORRECTION. Assertion (3) must actually have had
    // off-type bands to bite on — and the exact set is recorded because it is
    // SMALLER than the five pairings the bug report listed. `greenwood_sovereign`
    // is named there as off-type, but it carries `elementAffinity: 'nature'` —
    // the Thornwild's own lean — alongside `weaponAffinity: 'bow'`, and nothing
    // in `WEAPON_BEATS` counters bow. So the mob line's "fire" was already true
    // of it and the Thornwild never lied. FOUR faces did.
    expect([...new Set(offTypeBands)].sort()).toEqual([
      'emberwaste/galewright',
      'hallowfield/hollow_crown',
      'howlmoor/rime_tyrant',
      'swornhold/thornpike_marshal',
    ]);
  });

  it('covers all 12 (biome, boss face) pairs the catalog can field, not just the ones a short sweep hits', () => {
    const pairsSeen = new Set<string>();
    const pairsPossible = new Set<string>();
    for (const id of biomeIds) {
      for (const bossId of biomeCatalog[id]!.bosses) pairsPossible.add(`${id}/${bossId}`);
    }
    for (let seed = 1; seed <= 120; seed++) {
      const run = createRun(seed);
      for (const band of SWEEP_BANDS) {
        const f = forecastBand(run, band);
        const pair = `${f.biomeId}/${f.boss!.enemyId}`;
        if (pairsSeen.has(pair)) continue;
        pairsSeen.add(pair);
        const claim = blockNamed(renderBandForecast(f), 'BOSS').claim;
        expect(
          typesNamedIn(claim),
          `${pair}: "${claim}" is not true of that boss`,
        ).toEqual(realCountersOf(enemies[f.boss!.enemyId]!));
      }
    }
    expect(pairsSeen, 'a (biome, boss) pair the catalog can field was never sampled').toEqual(pairsPossible);
  });
});

describe('the MOB counter line still says exactly what it always said', () => {
  it('is the biome LEAN\'s counter, in HEAD\'s two lines, verbatim', () => {
    for (const seed of SWEEP_SEEDS.slice(0, 12)) {
      const run = createRun(seed);
      for (const band of SWEEP_BANDS) {
        const f = forecastBand(run, band);
        const lean = biomeCatalog[f.biomeId]!.lean;
        // The meaning is unchanged: still `counterTypeFor(lean)`, not anything
        // re-derived from the mob list or from the boss.
        expect(f.counterType).toBe(counterTypeFor(lean));
        const text = renderBandForecast(f);
        // The WORDING is unchanged, character for character — this suite adds a
        // line, it does not quietly redefine the existing one. These two strings
        // are copied from `renderBandForecast` as it stood at HEAD (532b6ac).
        expect(text).toContain(`${f.counterType} hits these\nmobs for +50%.`);
        // And it is the MOBS block that owns it, not the card.
        const mobs = blockNamed(text, 'MOBS');
        expect(mobs.claim).toBe(`${f.counterType} hits these mobs for +50%.`);
        expect(typesNamedIn(mobs.claim)).toEqual([f.counterType!]);
      }
    }
  });

  it('the two claims are DIFFERENT sentences with different subjects — neither can be read as the other', () => {
    const differed: string[] = [];
    for (const seed of SWEEP_SEEDS) {
      const run = createRun(seed);
      for (const band of SWEEP_BANDS) {
        const f = forecastBand(run, band);
        const text = renderBandForecast(f);
        const boss = blockNamed(text, 'BOSS');
        const mobs = blockNamed(text, 'MOBS');
        expect(boss.claim, 'the boss claim does not name its subject').toContain('boss');
        expect(mobs.claim, 'the mob claim does not name its subject').toContain('mobs');
        if (boss.claim !== mobs.claim) differed.push(f.biomeId);
      }
    }
    expect(new Set(differed).size, 'no band produced two different claims').toBeGreaterThanOrEqual(4);
  });
});

describe('two shortlisted bosses of different types cannot be promised as one', () => {
  /** Which biomes' shortlists agree on a counter, straight from the catalog. */
  function shortlistAgrees(biomeId: string): boolean {
    const faces = biomeCatalog[biomeId]!.bosses
      .map((id) => enemies[id])
      .filter((d): d is EnemyDef => d !== undefined)
      .map((d) => realCountersOf(d).join(','));
    return faces.every((f) => f === faces[0]);
  }

  /** The forecast with its boss deliberately unknown — the read a surface has
   * when it holds the shortlist but not the resolved column (the phase-3 fork
   * panel). Recomposed through `bossCounterFor`, never spread stale. */
  function unresolved(f: BandForecast): BandForecast {
    return { ...f, boss: null, bossCounter: bossCounterFor(null, f.bossCandidates) };
  }

  it('the catalog really does contain both cases — otherwise the split branch is untested', () => {
    const agree = biomeIds.filter((id) => shortlistAgrees(id));
    const split = biomeIds.filter((id) => !shortlistAgrees(id));
    expect(agree.length, 'no biome shortlist agrees on a counter').toBeGreaterThan(0);
    expect(split.length, 'no biome shortlist disagrees on a counter').toBeGreaterThan(0);
    // Recorded so a content change that flips a band shows up here by name.
    expect(agree).toEqual(['ironmoot', 'thornwild']);
    expect(split).toEqual(['emberwaste', 'hallowfield', 'howlmoor', 'swornhold']);
  });

  it('a SPLIT shortlist promises no type, and shows the fork instead', () => {
    for (const id of biomeIds) {
      if (shortlistAgrees(id)) continue;
      const seedBand = findBand(id);
      const f = unresolved(forecastBand(createRun(seedBand.seed), seedBand.band));
      expect(f.bossCounter.basis, `${id} should be split`).toBe('split');
      const text = renderBandForecast(f);
      const boss = blockNamed(text, 'BOSS');
      // NO PROMISE: the claim states there isn't one, and names no type at all.
      expect(boss.claim).toBe('no counter is sure.');
      expect(typesNamedIn(boss.claim), `${id} promised a type it cannot`).toEqual([]);
      // BUT NOT USELESS: every face it could be is listed, with its own counter,
      // so the player can hedge on purpose.
      for (const c of f.bossCandidates) {
        expect(boss.items, `${id} hid the face ${c.id}`).toContain(c.name);
        const own = realCountersOf(enemies[c.id]!);
        const line = boss.items.find((i) => typesNamedIn(i).length > 0 && i.includes('+50%')
          && typesNamedIn(i).join(',') === own.join(','));
        expect(line, `${id}/${c.id}: its own counters ${own.join('/')} are not shown`).toBeDefined();
      }
      // The union is exposed on the model but never stated as a promise.
      expect(f.bossCounter.types.length).toBeGreaterThan(1);
    }
  });

  it('an AGREED shortlist is still definite — not knowing the face costs nothing', () => {
    for (const id of biomeIds) {
      if (!shortlistAgrees(id)) continue;
      const seedBand = findBand(id);
      const f = unresolved(forecastBand(createRun(seedBand.seed), seedBand.band));
      expect(f.bossCounter.basis, `${id} should be a definite shortlist`).toBe('shortlist');
      const expected = realCountersOf(enemies[f.bossCandidates[0]!.id]!);
      const boss = blockNamed(renderBandForecast(f), 'BOSS');
      expect(typesNamedIn(boss.claim)).toEqual(expected);
      expect(boss.claim).toContain('boss');
      for (const c of f.bossCandidates) expect(boss.items).toContain(c.name);
    }
  });

  it('a RESOLVED boss stays definite even when its shortlist is split — the name above it already is', () => {
    for (const seed of SWEEP_SEEDS.slice(0, 8)) {
      const run = createRun(seed);
      for (const band of SWEEP_BANDS) {
        const f = forecastBand(run, band);
        expect(f.bossCounter.basis).toBe('named');
        expect(f.bossCounter.types).toEqual(realCountersOf(enemies[f.boss!.enemyId]!));
      }
    }
  });

  it('bossCandidates mirrors the biome shortlist, in catalog order', () => {
    for (const seed of SWEEP_SEEDS.slice(0, 8)) {
      const run = createRun(seed);
      for (const band of SWEEP_BANDS) {
        const f = forecastBand(run, band);
        expect(f.bossCandidates.map((c) => c.id)).toEqual([...biomeCatalog[f.biomeId]!.bosses]);
        expect(f.bossCandidates.map((c) => c.id)).toContain(f.boss!.enemyId);
        for (const c of f.bossCandidates) {
          expect(c.counterTypes).toEqual(realCountersOf(enemies[c.id]!));
          expect([...c.counterTypes].sort()).toEqual([...c.counterTypes]);
        }
      }
    }
  });
});

describe('both counter lines stay phone-shaped', () => {
  it('no line past 28 characters, in either the resolved or the unresolved render', () => {
    for (const id of biomeIds) {
      const seedBand = findBand(id);
      const f = forecastBand(createRun(seedBand.seed), seedBand.band);
      const renders = [
        renderBandForecast(f),
        renderBandForecast({ ...f, boss: null, bossCounter: bossCounterFor(null, f.bossCandidates) }),
      ];
      for (const text of renders) {
        for (const line of text.split('\n')) {
          if (line === f.tagline) continue; // prose, wraps by design
          expect(line.length, `too wide for a phone: "${line}"`).toBeLessThanOrEqual(28);
        }
      }
    }
  });
});

/** First (seed, band) that deals `biomeId` — the biome deal is a pure function
 * of `(seed, band)`, so this is stable, and it spends no `Rng` draw. */
function findBand(biomeId: string): { seed: number; band: number } {
  for (let seed = 1; seed <= 200; seed++) {
    const run = createRun(seed);
    for (const band of SWEEP_BANDS) {
      if (forecastBand(run, band).biomeId === biomeId) return { seed, band };
    }
  }
  throw new Error(`no seed/band deals ${biomeId}`);
}
