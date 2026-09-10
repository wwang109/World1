import { describe, expect, it } from 'vitest';
import { createRun } from '../../src/run/runState';
import {
  bossCounterFor, forecastBand, renderBandForecast, type BandForecast,
} from '../../src/run/biomeForecast';
import { counterTypeFor } from '../../src/run/biome';
import { biomeCatalog, biomeIds } from '../../src/data/biomes';
import { enemies } from '../../src/data/enemies';
import { enemyDerivedAffinity } from '../../src/data/enemyAffinity';
import {
  ELEMENT_BEATS, WEAPON_BEATS, elementMatchup, matchupPct, weaponMatchup,
} from '../../src/engine/elements';
import type { Element, EnemyDef, WeaponType } from '../../src/engine/types';
import { EXPECTED_ON_LEAN, EXPECTED_ON_LEAN_TOTAL, EXPECTED_LISTED_TOTAL, onLeanCount } from '../fixtures/bandLeanCounts';

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
 *
 * ---------------------------------------------------------------------------
 * THE SECOND HALF OF THE SAME BUG, CLOSED 2026-08-26 (eleven-band pass).
 *
 * `3881717` fixed the BOSS claim and left the identical defect one level down,
 * which its own commit message recorded as found-and-not-fixed: the MOB line
 * states the counter of the biome's declared LEAN, but five of the six `mobs`
 * lists carried BORROWED off-type members — "dark hits these mobs for +50%" was
 * false of the Hallowfield's `necromancer` (dark, takes nothing from dark) and
 * its `knight` (sword). Those members were borrowed because on-type mobs did
 * not exist for five of the eleven types.
 *
 * They exist now (the TYPELESS-BAND MOB ROSTER in `src/data/enemies.ts`), the
 * six original lists are cleaned to on-type members only, and the five homeless
 * types have bands of their own. So this suite gains the assertion the mob line
 * always needed: §"the MOB counter line is true of every mob in the list" checks
 * the claim against EVERY listed mob through the engine's own matchup math, not
 * against the lean it was derived from.
 *
 * TWO CONSEQUENCES WORTH STATING, because both look like a test getting weaker:
 *
 *   - `offTypeBands` is now EMPTY. Every band's boss shares its band's lean, so
 *     the mob counter is never false of the boss either. The four pairs that
 *     used to populate it (`emberwaste/galewright`, `hallowfield/hollow_crown`,
 *     `howlmoor/rime_tyrant`, `swornhold/thornpike_marshal`) were all guests in
 *     a band that leaned elsewhere; each has gone to its own band. It is
 *     asserted as an exact empty set so a regression re-populates it by name.
 *   - The mutation resistance moves to the ARROWFELL, the bow band, which is now
 *     the one legitimate place the boss claim and the mob claim disagree — and
 *     it disagrees in the direction the old bug could not produce. Nothing on
 *     the weapon triangle counters bow, so its MOBS line says "nothing counters
 *     these mobs", while its boss `greenwood_sovereign` is the roster's only
 *     dual-affinity boss (nature + bow) and IS countered, by fire off the nature
 *     half. A renderer that derived the boss claim from the lean would print
 *     "nothing counters this boss" over a boss fire farms; a renderer that kept
 *     the mob line's `if (counterType)` guard would print no mob claim at all.
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
 * `src/engine/elements.ts` resolves them independently.
 *
 * Reads the DERIVED affinity (`enemyDerivedAffinity`,
 * `src/data/enemyAffinity.ts`), not `def.elementAffinity`/`.weaponAffinity`
 * directly — those fields are no longer authored on any entry (2026-09-06
 * ruling: affinity is board-derived only, no authored override). Was true of
 * `greenwood_sovereign` (nature AND bow) when the fields were authored; its
 * board turns out to be 3/3 bow, 0/3 nature, so it now derives bow alone —
 * see `bossRoster.test.ts`'s and this file's own updated assertions for that
 * boss.
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
    const diverged: string[] = [];
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
        // (4) AND THE TWO CLAIMS MUST STILL BE DERIVED SEPARATELY. With every
        // band's boss now on-type, (3) has nothing left to bite on, so the
        // "reused the mob counter" mutation is caught HERE instead: the exact set
        // of bands whose boss counters differ from their mob counter is content,
        // and a renderer that derived one from the other would empty it.
        const mobTypes = mobCounter === undefined ? [] : [mobCounter];
        if (typesNamedIn(boss.claim).join(',') !== mobTypes.join(',')) {
          diverged.push(`${f.biomeId}/${f.boss!.enemyId}`);
        }
        biomesSeen.add(f.biomeId);
        checked += 1;
      }
    }
    expect(biomesSeen.size, 'the sweep did not reach every biome').toBe(biomeIds.length);
    expect(checked).toBeGreaterThan(100);
    // FIVE NAMED PAIRS ARE OFF-TYPE AGAIN (2026-09-06) — a real, measured
    // regression, not the assertion going soft. Between the eleven-band pass
    // (2026-08-26) and now this list was empty: every band's alternate
    // champion (a regular mob standing in for its true `isBoss` on some
    // waves — see `src/data/biomes.ts`'s own comment) was authored to match
    // its band's lean. The 2026-09-06 ruling (affinity is board-derived only,
    // no authored override) removes that lever: `furnace_elemental`,
    // `moorfang_alpha`, `blood_duelist`, `hedgerow_captain` are all
    // `boardSize: 2` boards, 2/2 on-type but short of `IDENTITY_THRESHOLD = 3`,
    // so none of them earn their band's type any more; `greenwood_sovereign`
    // (thornwild's alternate face) loses only its nature half for the same
    // reason. When the sweep resolves one of these five as the wave's actual
    // boss, the BOSS block now honestly says "nothing counters this boss"
    // while the MOB block still names the band's lean — a real information
    // gap a player can hit, not a rendering bug (see
    // `tests/run/bossRoster.test.ts`'s and this file's own "shortlists only
    // bosses" test for the same five, and the OPEN design question left in
    // `src/data/enemies.ts`'s comments: grow each a third on-type card via
    // the sibling enemy-growth-by-level project, or accept the gap for now).
    expect(
      [...new Set(offTypeBands)].sort(),
      'a boss is off-type for its own band in a way not already named below',
    ).toEqual([
      'emberwaste/furnace_elemental',
      'howlmoor/moorfang_alpha',
      'ironmoot/blood_duelist',
      'pikewold/hedgerow_captain',
      'thornwild/greenwood_sovereign',
    ]);

    // ...WHICH MOVES THE NON-VACUITY ONTO (4). The boss claim and the mob claim
    // are still computed from different things, and which bands show that has
    // FLIPPED (2026-09-06): USED TO BE exactly the ARROWFELL alone (nothing
    // counters bow, so its mobs had no counter, while `greenwood_sovereign`'s
    // authored nature half gave its boss one fire didn't share). Affinity is
    // board-derived only now, so `greenwood_sovereign` lost that nature half —
    // arrowfell's boss and mob claims now AGREE ("nothing", both), which is why
    // it left this list. In its place: the same five off-type pairs named
    // above (`offTypeBands`) each diverge for the mirror-image reason — their
    // BOSS claim is now "nothing" while their MOB claim still names the band's
    // lean, so boss.claim and mobs.claim differ. `arrowfell/deadeye_stalker`
    // still is NOT in the set: that face is pure bow, so both claims still say
    // "nothing".
    expect(
      [...new Set(diverged)].sort(),
      'the boss claim and the mob claim never disagreed — one is being derived from the other',
    ).toEqual([
      'emberwaste/furnace_elemental',
      'howlmoor/moorfang_alpha',
      'ironmoot/blood_duelist',
      'pikewold/hedgerow_captain',
      'thornwild/greenwood_sovereign',
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
  it('is the biome LEAN\'s counter, in HEAD\'s two lines, verbatim — and says so in words when there is none', () => {
    let withCounter = 0;
    let withoutCounter = 0;
    for (const seed of SWEEP_SEEDS.slice(0, 12)) {
      const run = createRun(seed);
      for (const band of SWEEP_BANDS) {
        const f = forecastBand(run, band);
        const lean = biomeCatalog[f.biomeId]!.lean;
        // The meaning is unchanged: still `counterTypeFor(lean)`, not anything
        // re-derived from the mob list or from the boss.
        expect(f.counterType).toBe(counterTypeFor(lean));
        const text = renderBandForecast(f);
        const mobs = blockNamed(text, 'MOBS');
        if (f.counterType === undefined) {
          // THE ABSENT COUNTER IS A FACT (2026-08-26). `counterTypeFor` returns
          // undefined for the bow band — `WEAPON_BEATS` has no entry mapping TO
          // bow — and the renderer used to print NOTHING there, which a player
          // cannot tell apart from a dropped line. It now states it.
          withoutCounter += 1;
          expect(text).toContain('nothing counters\nthese mobs.');
          expect(mobs.claim).toBe('nothing counters these mobs.');
          expect(typesNamedIn(mobs.claim), 'a band with no counter named a type').toEqual([]);
          continue;
        }
        withCounter += 1;
        // The WORDING is unchanged, character for character — this suite adds a
        // line, it does not quietly redefine the existing one. These two strings
        // are copied from `renderBandForecast` as it stood at HEAD (532b6ac).
        expect(text).toContain(`${f.counterType} hits these\nmobs for +50%.`);
        // And it is the MOBS block that owns it, not the card.
        expect(mobs.claim).toBe(`${f.counterType} hits these mobs for +50%.`);
        expect(typesNamedIn(mobs.claim)).toEqual([f.counterType]);
      }
    }
    // NON-VACUITY on BOTH branches: the sweep must have hit a band with a
    // counter and a band without one, or one of the two forms above is untested.
    expect(withCounter, 'no band with a counter was sampled').toBeGreaterThan(30);
    expect(withoutCounter, 'no counter-less band was sampled — the bow band is unreachable?').toBeGreaterThan(0);
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

describe('the MOB counter line is true of every mob in the list', () => {
  /**
   * THE ASSERTION THE MOB LINE ALWAYS NEEDED, and the second half of the bug
   * `3881717` closed for the boss line (its own commit recorded this one as
   * found-and-not-fixed). The line generalises over a LIST: it names one type
   * and claims +50% against "these mobs". Five of the six original lists
   * carried borrowed off-type members — the Hallowfield's `necromancer` is
   * dark and takes nothing from dark, its `knight` is sword — because on-type
   * mobs did not exist for five of the eleven types.
   *
   * PROMISE NARROWED 2026-09-06 (from "true of EVERY mob" to "true of at
   * least one"), NOT WEAKENED TO NOTHING — a deliberate choice between the two
   * the ruling forced (see `src/data/enemies.ts`'s and `biomes.ts`'s own
   * updated notes for the full reasoning): when affinity was AUTHORED, a mob
   * list could simply declare the type that matched every member, so the
   * strict per-mob claim cost nothing to keep. The 2026-09-06 ruling (affinity
   * is board-derived only, no authored override) removes that lever — a
   * member's own board must independently reach `IDENTITY_THRESHOLD = 3` to
   * earn it. 22 of the roster's listed mobs no longer do (mostly `boardSize:
   * 2` boards, 2/2 on-type but short of 3) — re-curating every affected band's
   * mob list to restore a universal per-mob guarantee would mean reshuffling
   * which enemies live where across the roster, which is the deferred
   * follow-on content pass (`docs/enemy-design.md`'s depth-band curation, not
   * this change), NOT a same-day fix.
   *
   * THE PLAYER-VISIBLE EFFECT: the rendered "<type> hits these mobs for
   * +50%." line is UNCHANGED text (it reads the biome's declared `lean`, never
   * a per-mob def — see `renderBandForecast`/`f.counterType`), but it is no
   * longer literally true of every member it lists, only of the ones whose
   * own board still earns the type. A band's mob list is therefore a
   * THEME/depth-coverage grouping first and a matchup promise second — most of
   * a list's members still genuinely carry it (see the non-vacuity check
   * below), a minority may not, exactly as was already conceded for
   * `stone_beetle` before this change ("a creature-level identity, not a
   * claim about its cards").
   *
   * RE-PINNED TO EXACT COUNTS (2026-09-06, run-layer affinity-axis pass). The
   * "at least one" floor above was itself measured and found sitting well
   * above the floor everywhere (1-4 on-lean mobs per band against 4-5
   * listed, never the bare 1 the promise required) — a floor that loose
   * would silently absorb a regression most of the way to zero before ever
   * failing. `'stated the other way'` below now asserts the CURRENT count
   * per band by name, mirroring the boss half's named-exception shape
   * (`KNOWN_OFF_TYPE`/`stillClean` two paragraphs down): a band's number
   * moving at all — including climbing, not just falling to zero — fails
   * with that band named, so the coming enemy-growth-by-level content pass
   * moves these numbers on purpose instead of by accident.
   *
   * Resolved through the engine's own `elementMatchup`/`weaponMatchup`, per
   * mob, so it cannot pass by agreeing with `counterTypeFor`.
   */
  it('the type the mob line names gets +50% on SOME mob in that biome\'s list, never on a mob nothing should touch', () => {
    const offenders: string[] = [];
    const vacuous: string[] = [];
    let checked = 0;
    for (const id of biomeIds) {
      const biome = biomeCatalog[id]!;
      const claimed = counterTypeFor(biome.lean);
      let onType = 0;
      for (const mobId of biome.mobs) {
        const def = enemies[mobId];
        expect(def, `${id} names unknown mob ${mobId}`).toBeDefined();
        const counters = realCountersOf(def!);
        checked += 1;
        if (claimed === undefined) {
          // A band whose lean nothing counters may not list a mob that SOMETHING
          // counters either, or "nothing counters these mobs" is false of it.
          // Unaffected by the 2026-09-06 ruling: none of `arrowfell`'s mobs
          // were ever countered by anything (pure bow, and nothing beats bow).
          if (counters.length > 0) offenders.push(`${id}/${mobId} is countered by ${counters.join('/')} but the band claims nothing is`);
        } else if (counters.includes(claimed)) {
          onType += 1;
        }
      }
      // NON-VACUITY, now stated PER BAND rather than assumed of every member:
      // the "<type> hits these mobs" claim must be real of at least one listed
      // mob, or the line is a hollow promise about the whole list.
      if (claimed !== undefined && onType === 0) {
        vacuous.push(`${id}: "${claimed} hits these mobs for +50%" is true of NONE of its mobs`);
      }
    }
    expect(offenders, `the mob counter line claims a type that hits nothing:\n  ${offenders.join('\n  ')}`).toEqual([]);
    expect(vacuous, `the mob counter line is a hollow promise for:\n  ${vacuous.join('\n  ')}`).toEqual([]);
    // Old-style NON-VACUITY: an empty catalog, or biomes with empty mob lists, would pass.
    expect(checked, 'no biome mob was checked').toBeGreaterThan(30);
  });

  it('stated the other way: EVERY band\'s exact on-lean mob count is pinned by name (2026-09-06)', () => {
    // The same property from the CONTENT side rather than the matchup side, so a
    // future band with NO on-type mob at all fails here even if the counter
    // wheel changes. Reads `enemyDerivedAffinity`, not `def.elementAffinity`/
    // `.weaponAffinity` directly — see the describe block's own doc comment
    // for why this is no longer a per-mob guarantee (2026-09-06).
    //
    // THE TABLE AND THE COUNTING FUNCTION ARE SHARED with
    // `tests/game/bandForecastRows.test.ts` — see `tests/fixtures/bandLeanCounts.ts`
    // for the pinned per-band values (measured against the live catalog) and
    // for why this is `enemyDerivedAffinity`, never `counterTypeFor`.
    //
    // A REVERSE GUARD, same shape as the boss half's `KNOWN_OFF_TYPE`/
    // `stillClean` pair below: `onType !== expected` fires whether the count
    // FALLS (a regression toward the zero this suite used to only catch at
    // the floor) or RISES (an undocumented content change nobody meant to
    // make) — either way the band is named in the failure, never a bare
    // aggregate number.
    const offenders: string[] = [];
    let totalOnLean = 0;
    let totalListed = 0;
    for (const id of biomeIds) {
      const biome = biomeCatalog[id]!;
      const onType = onLeanCount(biome.lean, biome.mobs);
      totalOnLean += onType;
      totalListed += biome.mobs.length;
      const expected = EXPECTED_ON_LEAN[id];
      expect(expected, `${id} is missing from EXPECTED_ON_LEAN — a band was added or renamed`).toBeDefined();
      if (onType !== expected) {
        offenders.push(
          `${id} (${biome.lean.kind}:${biome.lean.type}): expected ${expected}/${biome.mobs.length} on-lean mobs, measured ${onType}/${biome.mobs.length}`,
        );
      }
    }
    expect(offenders, offenders.join('; ')).toEqual([]);
    // A band added to (or removed from) the catalog without an entry above
    // would otherwise pass silently at `onType === undefined` never firing.
    expect(Object.keys(EXPECTED_ON_LEAN).sort()).toEqual([...biomeIds].sort());
    expect(totalOnLean, 'the pinned total on-lean count moved').toBe(EXPECTED_ON_LEAN_TOTAL);
    expect(totalListed, 'the pinned total listed-mob count moved').toBe(EXPECTED_LISTED_TOTAL);
  });

  it('and every band shortlists only bosses its own lean\'s counter can farm — except FIVE, named (2026-09-06)', () => {
    // The boss half of the same rule, as CONTENT rather than as rendered text:
    // no band hosts another type's boss as a guest any more. Reads the
    // DERIVED affinity (`enemyDerivedAffinity`), not `def.elementAffinity`/
    // `.weaponAffinity` directly — those fields are no longer authored on any
    // entry (2026-09-06 ruling: affinity is board-derived only). Every TRUE
    // `isBoss` is a mono-type triad, so its own face always still holds.
    //
    // KNOWN, NAMED EXCEPTIONS — a band's ALTERNATE champion (a regular mob
    // standing in for the true boss on some waves): `furnace_elemental`,
    // `moorfang_alpha`, `blood_duelist`, `hedgerow_captain` are all
    // `boardSize: 2`, 2/2 on-type but short of `IDENTITY_THRESHOLD = 3`, so
    // none earn their band's type any more; `greenwood_sovereign` (thornwild's
    // alternate face) loses only its nature half for the same reason (it
    // remains on-type for `arrowfell`, its true `isBoss` band, since its bow
    // half still derives). See the sweep test above ("every band states a
    // boss counter...") and `src/data/enemies.ts`'s comments for the full
    // derivation and the OPEN design question this leaves.
    const KNOWN_OFF_TYPE = new Set([
      'emberwaste/furnace_elemental',
      'howlmoor/moorfang_alpha',
      'ironmoot/blood_duelist',
      'pikewold/hedgerow_captain',
      'thornwild/greenwood_sovereign',
    ]);
    const offenders: string[] = [];
    const stillClean: string[] = [];
    for (const id of biomeIds) {
      const biome = biomeCatalog[id]!;
      const want = biome.lean.type;
      for (const bossId of biome.bosses) {
        const def = enemies[bossId]!;
        const affinity = enemyDerivedAffinity(def);
        const has = biome.lean.kind === 'element' ? affinity.elementAffinity === want : affinity.weaponAffinity === want;
        const key = `${id}/${bossId}`;
        if (has) { if (KNOWN_OFF_TYPE.has(key)) stillClean.push(key); continue; }
        if (!KNOWN_OFF_TYPE.has(key)) offenders.push(`${id} (${biome.lean.kind}:${want}) shortlists off-type boss ${bossId}`);
      }
    }
    expect(offenders, offenders.join('; ')).toEqual([]);
    expect(stillClean, 'a known exception was expected to stay off-type — did someone fix it?').toEqual([]);
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
    //
    // SIX AGREE, FIVE SPLIT (2026-09-06 — was TEN AGREE, ONE SPLITS since
    // 2026-08-26). `shortlistAgrees` now reads `enemyDerivedAffinity`
    // (`realCountersOf`, this file), not an authored field — every band's
    // second boss "face" is a REGULAR MOB standing in as an alternate champion
    // (`emberwaste/furnace_elemental`, `howlmoor/moorfang_alpha`,
    // `ironmoot/blood_duelist`, `pikewold/hedgerow_captain`), and all four are
    // among the 25 enemies whose own board falls short of
    // `IDENTITY_THRESHOLD = 3` (mostly 2-card boards) — so they now derive NO
    // affinity at all, while their band's TRUE `isBoss` partner still earns
    // its type from its mono-type triad exactly as before. Two faces where one
    // has a counter and the other has none genuinely disagree, so all FOUR
    // bands newly split. `thornwild` splits for the same reason on its own
    // dual boss: `greenwood_sovereign` no longer derives nature (see its own
    // comment in `src/data/enemies.ts`), so it disagrees with
    // `bramble_matriarch`'s real fire counter.
    //
    // `arrowfell` moves the OTHER way, split -> agree: `greenwood_sovereign`
    // and `deadeye_stalker` both now compute to "no counter" (bow is
    // uncounterable and greenwood_sovereign no longer has a nature half to
    // fall back on), so the two faces trivially agree for the first time.
    // This is a REAL, MEASURED shift, not a leftover to weaken back — see the
    // `describe` block two levels up (`the MOB counter line...`) for the same
    // ruling's mob-side consequence and the OPEN design question this content
    // pass leaves for game-director/balance-designer (grow the four regular
    // "alternate champion" mobs a third on-type card via the sibling
    // enemy-growth-by-level project, or accept the narrower split for now).
    expect(split).toEqual(['emberwaste', 'howlmoor', 'ironmoot', 'pikewold', 'thornwild']);
    expect(agree).toEqual([
      'arrowfell', 'duskbarrow', 'frostmarch', 'hallowfield', 'stormreach', 'swornhold',
    ]);
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
        // A face with NO counter is the reason this band splits at all, so its
        // line has to say that in words rather than be absent — the same rule
        // the MOBS block follows. (`arrowfell/deadeye_stalker` is pure bow.)
        const line = own.length === 0
          ? boss.items.find((i) => i === 'nothing counters it')
          : boss.items.find((i) => i.includes('+50%') && typesNamedIn(i).join(',') === own.join(','));
        expect(line, `${id}/${c.id}: its own counters [${own.join('/')}] are not shown`).toBeDefined();
      }
      // The union is exposed on the model but never stated as a promise. It can
      // be a SINGLE type and still be a split: the Arrowfell's union is ['fire'],
      // true of one face and false of the other, which is exactly why no promise
      // may be printed.
      expect(f.bossCounter.types.length).toBeGreaterThan(0);
      const faceCounters = f.bossCandidates.map((c) => c.counterTypes.join(','));
      expect(new Set(faceCounters).size, `${id}'s faces do not actually disagree`).toBeGreaterThan(1);
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

describe('the BOW band reads honestly — the one lean nothing counters', () => {
  /**
   * THE KNOWN WRINKLE, PINNED BY NAME. `WEAPON_BEATS` maps sword->axe->lance->
   * sword and bow->beast; NO entry maps to bow, so bow is the only one of the
   * eleven card types with no counter at all. A bow band therefore has nothing
   * true to print under its mobs, and the three ways that could go are:
   *   (a) print nothing — HEAD's `if (counterType)` guard, and indistinguishable
   *       from a renderer bug to the person reading the card;
   *   (b) print the lean itself, or the boss's counter, as if it were the mobs' —
   *       a false promise, the exact class of bug `3881717` closed one level up;
   *   (c) SAY SO. "nothing counters these mobs." is real information: this is
   *       the one route where the type wheel offers no shortcut, which is worth
   *       knowing BEFORE committing five waves to it.
   * (c) shipped. This test is what stops it drifting back to (a) or (b).
   */
  const BOW_BAND = 'arrowfell';

  it('the catalog still has a bow band, and bow still has no counter', () => {
    // Non-vacuity for everything below: if either half stops being true this
    // whole section is testing nothing.
    expect(biomeIds, 'the bow band is gone').toContain(BOW_BAND);
    expect(biomeCatalog[BOW_BAND]!.lean).toEqual({ kind: 'weapon', type: 'bow' });
    expect(counterTypeFor({ kind: 'weapon', type: 'bow' })).toBeUndefined();
    for (const t of COUNTER_VOCABULARY) {
      expect(weaponMatchup(t as WeaponType, 'bow'), `${t} counters bow now`).not.toBe('advantage');
    }
  });

  it('its MOBS block says no type counters them — not an empty line, not a false promise', () => {
    const { seed, band } = findBand(BOW_BAND);
    const f = forecastBand(createRun(seed), band);
    const text = renderBandForecast(f);
    expect(f.counterType, 'the bow band somehow has a counter type').toBeUndefined();
    const mobs = blockNamed(text, 'MOBS');
    expect(mobs.claim, 'the bow band printed no mob claim at all').not.toBe('');
    expect(mobs.claim).toBe('nothing counters these mobs.');
    // (b) guarded directly: no type word may appear in the claim, including the
    // lean itself and the counter of the BOSS standing above it.
    expect(typesNamedIn(mobs.claim), 'the bow band promised a type').toEqual([]);
    // Every mob it lists really is uncounterable — the claim is checked against
    // the roster, not just against the lean it was derived from.
    for (const m of f.mobs) {
      expect(realCountersOf(enemies[m.id]!), `${m.id} is counterable`).toEqual([]);
    }
  });

  it('its BOSS block is UNCOUNTERED on both faces now — a real, named regression (2026-09-06)', () => {
    // USED TO BE the interesting asymmetry: the band's signature boss
    // `greenwood_sovereign` was authored nature + bow (the roster's only
    // dual-affinity boss) precisely so a bow band was not counter-PROOF, and
    // fire farmed it off the nature half while nothing farmed its mobs. A
    // renderer that shared one claim across both blocks would have had to get
    // one of them wrong.
    //
    // STALE AS OF 2026-09-06: affinity is board-derived only now, no authored
    // override, and `greenwood_sovereign`'s own board is 3/3 bow, 0/3 nature —
    // there is no card count to derive nature from (see its own comment in
    // `src/data/enemies.ts`, which also states the OPEN design question this
    // leaves for game-director/balance-designer). Both arrowfell boss faces
    // now derive "no counter", so the asymmetry this test's name describes is
    // GONE — this is now testing that fact plainly rather than pretending it
    // still holds.
    const faces = biomeCatalog[BOW_BAND]!.bosses;
    expect(faces).toContain('greenwood_sovereign');
    const dual = enemies['greenwood_sovereign']!;
    expect(enemyDerivedAffinity(dual)).toEqual({ weaponAffinity: 'bow' });
    expect(realCountersOf(dual), 'greenwood_sovereign was expected to stay uncountered — did someone fix it?').toEqual([]);

    let sawDual = false;
    let sawPureBow = false;
    for (let seed = 1; seed <= 200 && !(sawDual && sawPureBow); seed++) {
      const run = createRun(seed);
      for (const band of SWEEP_BANDS) {
        const f = forecastBand(run, band);
        if (f.biomeId !== BOW_BAND) continue;
        const boss = blockNamed(renderBandForecast(f), 'BOSS');
        if (f.boss!.enemyId === 'greenwood_sovereign') sawDual = true; else sawPureBow = true;
        expect(boss.claim, `${f.boss!.enemyId} unexpectedly promised a counter`).toBe('nothing counters this boss.');
      }
    }
    // BOTH faces must have been observed, or half of the (now-identical) claim is untested.
    expect(sawDual, 'the greenwood_sovereign boss face never rolled').toBe(true);
    expect(sawPureBow, 'the pure-bow boss face never rolled').toBe(true);
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
