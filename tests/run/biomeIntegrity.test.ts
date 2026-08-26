import { describe, expect, it } from 'vitest';
import { applyDraftResult, createRun, rollEncounter, type RunState } from '../../src/run/runState';
import { rollStartDraft, DRAFT_SET_KEYS, type DraftSetKey } from '../../src/run/draft';
import { ensureWavesThrough, totalColumns, type RunNode } from '../../src/run/runMap';
import { biomeCatalog, biomeIds } from '../../src/data/biomes';
import { bandIndexOf, biomeFor } from '../../src/run/biome';
import { enemies } from '../../src/data/enemies';

/**
 * ROT THAT STAYS GREEN — a biome list entry that can never fire.
 *
 * A biome is ID LISTS (`src/data/biomes.ts`) resolved against pools built
 * elsewhere (`FIGHT_POOL` / `BOSS_POOL` in `runState.ts`). Both bindings are
 * DELIBERATELY forgiving — `weightIds` silently ignores a mob id that is not in
 * the depth pool, and the boss shortlist is filtered to ids that exist — so a
 * typo, a renamed enemy, or an id that lives in the wrong pool does not throw,
 * does not fail a reachability audit, and does not change a fingerprint. It just
 * quietly stops being content while the banner keeps promising it.
 *
 * Two things happened on the way here that this file exists to make impossible,
 * and BOTH were wrong claims about the code that no test could contradict:
 *
 *   1. `ironmoot` was reported as carrying a DEAD shortlist entry
 *      (`blood_duelist`, which is not `isBoss`), on the reasoning that the boss
 *      column draws from `BOSS_POOL = filter(isBoss)`. It does not: a boss node
 *      REPLACES its anchor pool with the shortlist (`rollEncounter`), so a
 *      non-`isBoss` id in a shortlist fires exactly as authored — measured here
 *      as ~half of `ironmoot`'s boss columns. The entry is live and intended
 *      (the boss TITLE is what makes a boss; `blood_duelist` carries the same
 *      `weaponAffinity: 'axe'` as `ruin_warlord`, so the band's "AXE, countered
 *      by SWORD" telegraph is true for both of its faces).
 *   2. `dawn_arbiter` and `hollow_crown` were reported as UNREACHABLE through
 *      any band. They are not: `hallowfield` shortlists both, and both appear
 *      across the sweep below. But nothing asserted it either way — which is the
 *      actual defect, and §BOSS REACHABILITY closes it.
 *
 * So this suite deliberately does NOT assert `isBoss` on shortlist entries —
 * that would enforce a rule the design does not have and would fail a working
 * entry. It asserts the property that actually matters: EVERY AUTHORED ID
 * ACTUALLY FIRES, and every `isBoss` enemy has a band that can field it.
 */

const SEEDS = Array.from({ length: 32 }, (_, i) => i + 1);
/** Through wave 25 = the first 5 bands, so a sweep covers every depth tier. */
const THROUGH_WAVE = 25;
const BANDS_SWEPT = THROUGH_WAVE / 5;

const ALL = Object.values(enemies);
/** The two pools `rollEncounter` draws from — rebuilt here from the same
 * `isBoss` split rather than imported, so a change to the split shows up here. */
const FIGHT_POOL_IDS = ALL.filter((e) => !e.isBoss).map((e) => e.id);
const BOSS_POOL_IDS = ALL.filter((e) => e.isBoss).map((e) => e.id);

function startedRun(seed: number, throughWave: number): RunState {
  const draft = rollStartDraft(seed);
  const picks: Partial<Record<DraftSetKey, string>> = {};
  for (const key of DRAFT_SET_KEYS) picks[key] = draft[key][0]!.skillId;
  const base = applyDraftResult(createRun(seed), picks);
  return { ...base, map: ensureWavesThrough(base.map, throughWave) };
}

function combatNodes(state: RunState): RunNode[] {
  const out: RunNode[] = [];
  for (let d = 1; d <= totalColumns(state.map); d++) {
    for (const node of state.map.depths[d]!) {
      if (node.kind === 'fight' || node.kind === 'boss') out.push(node);
    }
  }
  return out;
}

interface Sweep {
  /** biome id -> enemy ids that actually anchored a BOSS column of that biome. */
  bossPicks: Map<string, Set<string>>;
  /** biome id -> enemy ids that actually rolled in a FIGHT node of that biome. */
  fightPicks: Map<string, Set<string>>;
  bossNodes: number;
  fightUnits: number;
}

/** One shared pass over the real generator + the real `rollEncounter`. Rolled
 * once (~100ms) and read by every assertion below, so the suite measures ONE
 * sample rather than several that could disagree. */
const sweep: Sweep = (() => {
  const bossPicks = new Map<string, Set<string>>();
  const fightPicks = new Map<string, Set<string>>();
  let bossNodes = 0;
  let fightUnits = 0;
  for (const seed of SEEDS) {
    const state = startedRun(seed, THROUGH_WAVE);
    for (const node of combatNodes(state)) {
      const biomeId = biomeFor(state.map.seed, node.wave, node.biomeId).id;
      expect(bandIndexOf(node.wave)).toBeLessThan(BANDS_SWEPT);
      const pack = rollEncounter({ ...state, currentNodeId: node.id });
      const target = node.kind === 'boss' ? bossPicks : fightPicks;
      const set = target.get(biomeId) ?? new Set<string>();
      for (const unit of pack.units) set.add(unit.enemyId);
      target.set(biomeId, set);
      if (node.kind === 'boss') bossNodes += 1;
      else fightUnits += pack.units.length;
    }
  }
  return { bossPicks, fightPicks, bossNodes, fightUnits };
})();

describe('biome list integrity: every authored id is a REAL id in the RIGHT pool', () => {
  it('every mob id exists AND sits in the fight pool — an isBoss id in a `mobs` list is silent dead weight', () => {
    // `weightIds` intersects the mob list with the DEPTH-GATED FIGHT POOL, and
    // returns the pool untouched when the intersection is empty. So an `isBoss`
    // id (or a typo) in `mobs` costs nothing, throws nothing, and does nothing —
    // while the band banner keeps naming it as one of the band's monsters.
    for (const id of biomeIds) {
      for (const mob of biomeCatalog[id]!.mobs) {
        expect(enemies[mob], `${id} names unknown mob "${mob}"`).toBeDefined();
        expect(FIGHT_POOL_IDS, `${id} names "${mob}" as a mob, but it is isBoss — the fight pool can never draw it`)
          .toContain(mob);
      }
    }
  });

  it('every boss shortlist id exists, and no shortlist is empty (an empty one falls silently back to BOSS_POOL)', () => {
    // `rollEncounter` falls back to the depth-gated `BOSS_POOL` when the
    // shortlist is empty after the existence filter — i.e. a catalog full of
    // typos degrades to pre-biome behaviour with no error anywhere.
    for (const id of biomeIds) {
      const bosses = biomeCatalog[id]!.bosses;
      expect(bosses.length, `${id} shortlists no boss`).toBeGreaterThan(0);
      for (const boss of bosses) {
        expect(enemies[boss], `${id} shortlists unknown boss "${boss}"`).toBeDefined();
      }
    }
  });

  it('BOSS REACHABILITY, statically: every isBoss enemy is shortlisted by some biome', () => {
    // THE CHEAP HALF of the gap that shipped. Bands are the only way a boss
    // column is reached, so an `isBoss` enemy no biome names is a monster the
    // player can never meet — content authored into a void. This is the
    // assertion whose absence let two bosses be REPORTED unreachable with
    // nothing able to confirm or deny it.
    const shortlisted = new Set<string>();
    for (const id of biomeIds) for (const boss of biomeCatalog[id]!.bosses) shortlisted.add(boss);
    const homeless = BOSS_POOL_IDS.filter((id) => !shortlisted.has(id));
    expect(homeless, `no biome can field: ${homeless.join(', ')}`).toEqual([]);
    // NON-VACUITY: a single-member boss pool would make the above trivially true.
    expect(BOSS_POOL_IDS.length, 'the boss pool is not a roster').toBeGreaterThan(1);
  });
});

describe('biome list integrity: every authored id actually FIRES', () => {
  it('the sweep is a real sample — every biome was observed at both a boss column and a fight', () => {
    // Guards every assertion below from passing on an empty sample.
    expect(sweep.bossNodes, 'no boss columns were rolled').toBeGreaterThan(100);
    expect(sweep.fightUnits, 'no fight units were rolled').toBeGreaterThan(1000);
    expect([...sweep.bossPicks.keys()].sort()).toEqual([...biomeIds]);
    expect([...sweep.fightPicks.keys()].sort()).toEqual([...biomeIds]);
  });

  it('BOSS REACHABILITY, operationally: every isBoss enemy anchors a boss column somewhere in the first bands', () => {
    // The test that would have caught the shipped gap. Static shortlisting is
    // necessary but not sufficient: a boss can also be unreachable because its
    // biome is never dealt, or because its depth band excludes every boss wave.
    // This asks the real generator + the real `rollEncounter` instead.
    const seen = new Set<string>();
    for (const [, ids] of sweep.bossPicks) for (const id of ids) seen.add(id);
    const unreachable = BOSS_POOL_IDS.filter((id) => !seen.has(id));
    expect(
      unreachable,
      `never met across ${SEEDS.length} seeds x ${BANDS_SWEPT} bands: ${unreachable.join(', ')}`,
    ).toEqual([]);
  });

  it('no shortlist entry is a no-op: every id in every biome\'s `bosses` really anchors that biome\'s boss column', () => {
    // The per-biome form, and the one that answers the `ironmoot` question with
    // a measurement instead of an inference about which pool is consulted. It is
    // agnostic about `isBoss` on purpose — what it demands is that the entry FIRE.
    const dead: string[] = [];
    for (const id of biomeIds) {
      const fired = sweep.bossPicks.get(id) ?? new Set<string>();
      for (const boss of biomeCatalog[id]!.bosses) if (!fired.has(boss)) dead.push(`${id}/${boss}`);
    }
    expect(dead, `shortlisted but never fired: ${dead.join(', ')}`).toEqual([]);
  });

  it('no mob entry is a no-op: every id in every biome\'s `mobs` really rolls inside that biome\'s own bands', () => {
    // The mob half. A mob list entry outside the biome's reachable depth tiers,
    // or in the wrong pool, is a name on the banner and nothing else.
    const dead: string[] = [];
    for (const id of biomeIds) {
      const fired = sweep.fightPicks.get(id) ?? new Set<string>();
      for (const mob of biomeCatalog[id]!.mobs) if (!fired.has(mob)) dead.push(`${id}/${mob}`);
    }
    expect(dead, `listed as a biome mob but never rolled there: ${dead.join(', ')}`).toEqual([]);
  });
});
