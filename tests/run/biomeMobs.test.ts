import { describe, expect, it } from 'vitest';
import {
  applyDraftResult, createRun, fightTableEntryForNode, rollEncounter, type RunState,
} from '../../src/run/runState';
import { rollStartDraft, DRAFT_SET_KEYS, type DraftSetKey } from '../../src/run/draft';
import { ensureWavesThrough, totalColumns, type RunNode } from '../../src/run/runMap';
import { anchorPoolFor, computeEnemyDepthBands, inDepthBand } from '../../src/run/enemyDepth';
import { biomeFor, bandIndexOf, biomeForBand, BIOME_MOB_WEIGHT } from '../../src/run/biome';
import { biomeCatalog, biomeIds } from '../../src/data/biomes';
import { enemies } from '../../src/data/enemies';
import { TITLE_PRESETS } from '../../src/run/encounter';
import { forecastBand, forecastNextBand, renderBandForecast } from '../../src/run/biomeForecast';

/**
 * THE BAND'S MONSTERS, AND THE BOSS IT PROMISES.
 *
 * THE CORRECTED PREMISE (measured 2026-08-26, and the reason the proposal's §1.6
 * headline was rewritten): `'boss'` is a TITLE assigned by POSITION, not an
 * enemy. `fightSpecFor` gives fight `n` the title `boss` when `n % 5 === 0`, and
 * a fight column's `'hard'` option bumps `elite -> boss` as well — so over fights
 * 1-40 all 22 of the then-roster's enemies wore the boss title somewhere.
 * `isBoss` on `wolf_king` only decided which pool the BOSS COLUMN drew from.
 *
 * So the problem the boss shortlist solves is NOT "there is only one boss". It is
 * TELEGRAPHING: any mob could turn up wearing +4 levels / +4 rank / +2 cards and
 * the player had no way to see which. This suite asserts both halves of the fix —
 * the boss COLUMN fields its band's shortlist, and every other fight is drawn
 * from a mob list the band banner has already shown.
 */

const SEEDS = Array.from({ length: 24 }, (_, i) => i + 1);
const FIGHT_POOL = Object.values(enemies).filter((e) => !e.isBoss);
const FIGHT_BANDS = computeEnemyDepthBands(FIGHT_POOL);
const FIGHT_POOL_IDS = FIGHT_POOL.map((e) => e.id);

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

describe('biome mobs: PREFERRED, never siloed', () => {
  it('a band\'s fight anchors skew hard to its biome\'s mobs — but every depth-eligible enemy is still reachable inside it', () => {
    let onBiome = 0;
    let anchors = 0;
    let unweightedExpectation = 0;
    const seenAnchors = new Set<string>();
    for (const seed of SEEDS) {
      const state = startedRun(seed, 20);
      for (const node of combatNodes(state)) {
        if (node.kind !== 'fight') continue;
        const biome = biomeFor(state.map.seed, node.wave, node.biomeId);
        const depthPool = anchorPoolFor(FIGHT_POOL_IDS, FIGHT_BANDS, node.fightNumber!);
        // What an UNWEIGHTED draw would have produced — the control, computed
        // from the real depth pool rather than pinned as a magic number.
        unweightedExpectation += depthPool.filter((id) => biome.mobs.includes(id)).length / depthPool.length;
        const anchorId = rollEncounter({ ...state, currentNodeId: node.id }).units[0]!.enemyId;
        anchors += 1;
        seenAnchors.add(anchorId);
        if (biome.mobs.includes(anchorId)) onBiome += 1;
        // The anchor is STILL depth-gated: biome weighting narrows within the
        // depth pool, it never reaches outside it.
        expect(inDepthBand(FIGHT_BANDS[anchorId], node.fightNumber!), `${anchorId} @fight ${node.fightNumber}`).toBe(true);
      }
    }
    expect(anchors, 'no fight anchors were rolled').toBeGreaterThan(500);
    const share = onBiome / anchors;
    const control = unweightedExpectation / anchors;
    expect(share, `biome-mob share ${(100 * share).toFixed(0)}% vs unweighted ${(100 * control).toFixed(0)}%`)
      .toBeGreaterThan(control * 1.8);
    // ANTI-SILO, the half the proposal insists on (§6.2): a weighted preference
    // must leave the off-biome enemies genuinely reachable, not merely legal.
    expect(share, 'the mob binding has become a silo').toBeLessThan(0.9);
    expect(seenAnchors.size, 'not every fight-pool enemy anchored somewhere').toBe(FIGHT_POOL_IDS.length);
  });

  it('BIOME_MOB_WEIGHT is the only dial, and it is a weighting — 0 would restore today\'s uniform draw', () => {
    expect(BIOME_MOB_WEIGHT).toBeGreaterThan(0);
    expect(Number.isInteger(BIOME_MOB_WEIGHT)).toBe(true);
  });

  it('every fight-pool enemy is named by at least one biome (no enemy the biome layer can never introduce)', () => {
    const named = new Set<string>();
    for (const id of biomeIds) for (const mob of biomeCatalog[id]!.mobs) named.add(mob);
    const orphans = FIGHT_POOL_IDS.filter((id) => !named.has(id));
    expect(orphans, `no biome lists: ${orphans.join(', ')}`).toEqual([]);
    expect(named.size, 'the biome catalog names no mobs at all').toBeGreaterThan(0);
  });
});

describe('biome bosses: the band\'s boss is a promise, and the same one every time', () => {
  it('a boss column fields ONLY its band biome\'s shortlist, solo, at the fight-spec boss title', () => {
    let bossNodes = 0;
    const perBiome = new Map<string, Set<string>>();
    for (const seed of SEEDS) {
      const state = startedRun(seed, 25);
      for (const node of combatNodes(state)) {
        if (node.kind !== 'boss') continue;
        const biome = biomeFor(state.map.seed, node.wave, node.biomeId);
        const pack = rollEncounter({ ...state, currentNodeId: node.id });
        bossNodes += 1;
        expect(pack.variant, 'a boss column rolled a pack').toBe('solo');
        expect(pack.units).toHaveLength(1);
        const unit = pack.units[0]!;
        expect(biome.bosses, `${biome.id} fielded off-shortlist boss ${unit.enemyId}`).toContain(unit.enemyId);
        expect(unit.title, 'a boss column did not field the boss title').toBe('boss');
        expect(unit.rank).toBe(TITLE_PRESETS.boss.rank);
        const set = perBiome.get(biome.id) ?? new Set<string>();
        set.add(unit.enemyId);
        perBiome.set(biome.id, set);
      }
    }
    expect(bossNodes, 'no boss columns were rolled').toBeGreaterThan(80);
    // NON-VACUITY, both directions. Every biome must have been observed, and the
    // shortlists must not all collapse to one shared enemy (which would make the
    // "contain" assertion above pass while the feature did nothing).
    expect(perBiome.size, 'not every biome was observed at a boss column').toBe(biomeIds.length);
    const allBosses = new Set<string>();
    for (const [, set] of perBiome) for (const id of set) allBosses.add(id);
    expect(allBosses.size, 'every biome fielded the same boss').toBeGreaterThan(biomeIds.length);
  });

  it('the SAME node always rolls the SAME boss — the forecast cannot be a lie', () => {
    for (const seed of SEEDS.slice(0, 8)) {
      const state = startedRun(seed, 15);
      for (const node of combatNodes(state)) {
        if (node.kind !== 'boss') continue;
        const a = rollEncounter({ ...state, currentNodeId: node.id }).units[0]!.enemyId;
        const b = rollEncounter({ ...state, currentNodeId: node.id }).units[0]!.enemyId;
        expect(b).toBe(a);
      }
    }
  });

  it('a boss shortlist may name ANY roster id — the boss TITLE, not the isBoss tag, is what makes it a boss', () => {
    // The corrected premise in one assertion. `TITLE_PRESETS.boss` is what turns
    // a kit into a boss; a shortlisted mob without `isBoss` is legal on purpose,
    // and is how a biome gets a second face without a hand-written statline.
    const shortlisted = new Set<string>();
    for (const id of biomeIds) for (const b of biomeCatalog[id]!.bosses) shortlisted.add(b);
    for (const id of shortlisted) expect(enemies[id], `shortlisted unknown id ${id}`).toBeDefined();
    expect(TITLE_PRESETS.boss.levelDelta).toBeGreaterThan(TITLE_PRESETS.elite.levelDelta);
    expect(TITLE_PRESETS.boss.rank).toBeGreaterThan(TITLE_PRESETS.elite.rank);
    expect(TITLE_PRESETS.boss.extraCards).toBeGreaterThan(TITLE_PRESETS.elite.extraCards);
    expect(shortlisted.size, 'no bosses shortlisted').toBeGreaterThan(biomeIds.length);
  });
});

describe('a biome has NO combat effect — PL is the balance unit', () => {
  it('every rolled unit\'s level/title/rank/modifiers come from the fight spec alone, in every biome', () => {
    // The guard on proposal §6.5. A biome may only change WHICH enemy id is
    // drawn; the moment one changes a level, a rank, a modifier list or a stat,
    // it is a balance number outside the PL economy and this fails.
    let checked = 0;
    const biomesSeen = new Set<string>();
    for (const seed of SEEDS) {
      const state = startedRun(seed, 22);
      for (const node of combatNodes(state)) {
        const spec = fightTableEntryForNode(node);
        const pack = rollEncounter({ ...state, currentNodeId: node.id });
        biomesSeen.add(biomeFor(state.map.seed, node.wave, node.biomeId).id);
        for (const unit of pack.units) {
          expect(unit.modifiers, `${node.id} modifiers drifted`).toEqual(spec.modifiers);
          expect(unit.rank, `${node.id} rank drifted`).toBe(TITLE_PRESETS[unit.title].rank);
          expect(unit.effectiveLevel).toBe(unit.level + TITLE_PRESETS[unit.title].levelDelta);
          if (pack.variant === 'solo') {
            expect(unit.level, `${node.id} level drifted from the fight spec`).toBe(spec.level);
            expect(unit.title, `${node.id} title drifted from the fight spec`).toBe(spec.title);
          }
          checked += 1;
        }
      }
    }
    expect(checked, 'no units were audited').toBeGreaterThan(1000);
    expect(biomesSeen.size, 'the audit only ever saw one biome').toBe(biomeIds.length);
  });
});

describe('the band is READABLE BEFORE it is entered', () => {
  it('forecastBand names the biome and the boss of a band the player has not reached, and the boss it names is the one that rolls', () => {
    for (const seed of SEEDS.slice(0, 12)) {
      const fresh = createRun(seed); // only INITIAL_WAVES generated — band 2 does not exist yet
      for (const band of [0, 1, 2, 3]) {
        const f = forecastBand(fresh, band);
        expect(f.biomeId).toBe(biomeForBand(seed, band).id);
        expect(f.fromWave).toBe(band * 5 + 1);
        expect(f.throughWave).toBe(band * 5 + 5);
        expect(f.boss, `band ${band} of seed ${seed} forecast no boss`).not.toBeNull();
        expect(f.boss!.level).toBe(f.throughWave);
        expect(f.boss!.title).toBe('boss');
        expect(biomeCatalog[f.biomeId]!.bosses).toContain(f.boss!.enemyId);
        expect(f.mobs.length).toBeGreaterThan(0);
        expect(f.shops.length).toBeGreaterThan(0);

        // THE POINT: what the forecast says is what actually happens when the
        // player walks in. Rolled from a run that has now been extended there.
        const walked = startedRun(seed, f.throughWave);
        const bossNode = combatNodes(walked).find((n) => n.kind === 'boss' && n.wave === f.throughWave)!;
        const actual = rollEncounter({ ...walked, currentNodeId: bossNode.id }).units[0]!;
        expect(actual.enemyId, `forecast lied about band ${band} of seed ${seed}`).toBe(f.boss!.enemyId);
        expect(bandIndexOf(bossNode.wave)).toBe(band);
      }
    }
  });

  it('forecasting a future band does not advance or mutate the run', () => {
    const before = createRun(4242);
    const snapshot = JSON.stringify(before);
    forecastBand(before, 6);
    forecastNextBand(before, 1);
    expect(JSON.stringify(before), 'forecastBand mutated the run state').toBe(snapshot);
  });

  it('renderBandForecast prints the band, its lean, its boss and its counter — mobile width, one fact per line', () => {
    const f = forecastBand(createRun(7), 0);
    const text = renderBandForecast(f);
    expect(text).toContain(f.name.toUpperCase());
    expect(text).toContain(`[${f.leanLabel}]`);
    expect(text).toContain('BOSS');
    expect(text).toContain(f.boss!.name);
    expect(text).toContain(`LV ${f.boss!.level}`);
    for (const m of f.mobs) expect(text).toContain(m.name);
    for (const s of f.shops) expect(text).toContain(s.name);
    if (f.counterType) expect(text).toContain(f.counterType);
    // MOBILE-FIRST (CLAUDE.md, USER-LOCKED 2026-08-25): one fact per line,
    // nothing past ~28 characters — a line that wraps is a line not read.
    for (const line of text.split('\n')) {
      if (line === f.tagline) continue; // the tagline is prose and wraps by design
      expect(line.length, `too wide for a phone: "${line}"`).toBeLessThanOrEqual(28);
    }
    // NON-VACUITY: the render must actually be substantial, not an empty shell.
    expect(text.split('\n').length).toBeGreaterThan(10);
  });
});
