import { describe, expect, it } from 'vitest';
import { generateRunMap, totalColumns, type RunNode } from '../../src/run/runMap';
import { shopStockDepthForWave } from '../../src/run/runState';
import { rollShopStock, cardPoolForShop } from '../../src/run/shop';
import { skillBook } from '../../src/data/skills';
import { shopCatalog, shopTypeIds } from '../../src/data/shopTypes';
import { biomeCatalog, biomeIds } from '../../src/data/biomes';
import { bandIndexOf, biomeForBand, firstWaveOfBand, bossWaveOfBand } from '../../src/run/biome';
import { cardType, IDENTITY_THRESHOLD } from '../../src/engine/combat/typeIdentity';
import type { SkillDef } from '../../src/engine/types';

/**
 * DOES THE BAND ACTUALLY SUPPLY WHAT ITS BANNER SAYS?
 *
 * THE MEASURED PROBLEM (docs/biome-paths-proposal.md §1.5, re-measured here
 * against the real generator: 400 seeds, waves 1-10, every shelf OFFERED rolled
 * through the real `rollShopStock`): a player who decided at wave 1 to build one
 * type was offered `IDENTITY_THRESHOLD` (3) cards of it 27-51% of the time
 * depending on the type, and offered NONE 25-44% of the time. Adding stalls
 * cannot fix that — ~5 draws from a 21-theme bag is the bottleneck, and a 22nd
 * theme makes it worse. Biasing WHICH stalls the existing bag hands over is the
 * only lever that moves it without new content.
 *
 * THE MEASURED RESULT (same harness, after this change): for the lean the band's
 * banner NAMES, inside that band's own five waves, offers went 1.36 -> 6.84 and
 * P(>=3) went 19% -> 98%, with P(zero) 56% -> 3%. Pooled over bands 0-3 of a
 * 20-wave run it is 21% -> 84% (deeper bands lose a little because the 21-theme
 * no-repeat bag has been partly consumed by then).
 *
 * The floors below are set well under those measurements so ordinary content
 * drift does not fail them, but a REGRESSION of the mechanism does: dropping the
 * preference pass, losing the priority ordering of `BiomeDef.shops`, or mixing
 * the biome into the wave seed all take the lean number back to the control.
 *
 * THE CONTROL IS IN THE TEST, not in a comment: every measurement of the
 * announced lean is compared against the SAME window's supply of the types the
 * band did NOT name. If the preference stopped working, the two collapse
 * together and the assertion fails — no frozen "before" number to rot.
 */

const SEEDS = Array.from({ length: 120 }, (_, i) => i + 1);

const typeKeyOf = (s: SkillDef): string => {
  const t = cardType(s);
  return t ? `${t.kind}:${t.type}` : 'none';
};
const ALL_TYPES = [...new Set(Object.values(skillBook).map(typeKeyOf))].filter((t) => t !== 'none').sort();

/** Card-type offer counts over every shelf OFFERED in waves [from..through] of
 * `seed`, rolled through the real `rollShopStock` at the real depth band. */
function offersInWindow(seed: number, from: number, through: number): Record<string, number> {
  const map = generateRunMap(seed, through);
  const counts: Record<string, number> = {};
  for (let d = 1; d <= totalColumns(map); d++) {
    for (const node of map.depths[d]!) {
      if (node.kind !== 'shop' || node.wave < from || node.wave > through) continue;
      const stock = rollShopStock(node.shopId!, node.shopSeed!, shopStockDepthForWave(node.wave));
      for (const offer of stock.cards) {
        const k = typeKeyOf(skillBook[offer.skillId]!);
        counts[k] = (counts[k] ?? 0) + 1;
      }
    }
  }
  return counts;
}

const leanKeyOf = (seed: number, band: number): string => {
  const lean = biomeForBand(seed, band).lean;
  return `${lean.kind}:${lean.type}`;
};

interface Supply { avg: number; pAtLeast3: number; pZero: number; n: number }
function summarize(samples: readonly number[]): Supply {
  const n = samples.length;
  return {
    n,
    avg: samples.reduce((a, b) => a + b, 0) / n,
    pAtLeast3: samples.filter((x) => x >= IDENTITY_THRESHOLD).length / n,
    pZero: samples.filter((x) => x === 0).length / n,
  };
}

/** The announced lean vs the same window's un-announced types — the control. */
function leanVsControl(band: number): { lean: Supply; control: Supply } {
  const leanSamples: number[] = [];
  const controlSamples: number[] = [];
  for (const seed of SEEDS) {
    const counts = offersInWindow(seed, firstWaveOfBand(band), bossWaveOfBand(band));
    const key = leanKeyOf(seed, band);
    leanSamples.push(counts[key] ?? 0);
    for (const t of ALL_TYPES) if (t !== key) controlSamples.push(counts[t] ?? 0);
  }
  return { lean: summarize(leanSamples), control: summarize(controlSamples) };
}

describe('biome shop preference: the band supplies the type its banner names', () => {
  it('band 0 (waves 1-5): the announced lean clears IDENTITY_THRESHOLD far more often than the types it did not name', () => {
    const { lean, control } = leanVsControl(0);
    // Non-vacuity FIRST: if no shelf was ever offered every number here is 0 and
    // the comparison below would be 0 > 0 * 2.
    expect(lean.n, 'no seeds measured').toBe(SEEDS.length);
    expect(control.avg, 'no cards were offered at all in waves 1-5').toBeGreaterThan(0);

    expect(lean.pAtLeast3, `announced lean P(>=3) was ${(100 * lean.pAtLeast3).toFixed(0)}%`).toBeGreaterThan(0.9);
    expect(lean.pZero, `announced lean P(zero) was ${(100 * lean.pZero).toFixed(0)}%`).toBeLessThan(0.1);
    // The mechanism, not the absolute number: the named type must be supplied
    // several times over what an unnamed type gets in the SAME five waves.
    expect(lean.avg).toBeGreaterThan(control.avg * 3);
    expect(lean.pAtLeast3).toBeGreaterThan(control.pAtLeast3 * 3);
  });

  it('band 1 (waves 6-10): a NEW band deals a NEW lean and supplies that one instead — the band is the unit of the promise', () => {
    const { lean, control } = leanVsControl(1);
    expect(control.avg).toBeGreaterThan(0);
    expect(lean.pAtLeast3).toBeGreaterThan(0.9);
    expect(lean.avg).toBeGreaterThan(control.avg * 3);
    // NON-VACUITY on the "new band, new lean" half: bands 0 and 1 must actually
    // differ, or this is just a re-run of the test above.
    let changed = 0;
    for (const seed of SEEDS) if (leanKeyOf(seed, 0) !== leanKeyOf(seed, 1)) changed += 1;
    expect(changed, 'band 1 never dealt a different lean than band 0').toBe(SEEDS.length);
  });

  it('every band 0-3 of a 20-wave run keeps the promise, not just the first', () => {
    // MEASURED AND EXPECTED TO DECAY: bands 0 and 1 sit at 98%, band 3 at ~61%.
    // The 21-theme bag is a NO-REPEAT bag and does not refill until it empties
    // (~20 shop draws), so by band 3 a biome that was already dealt at band 0 or
    // 1 may find its own priority-0 stall already spent. That is the honest
    // ceiling of a preference-over-an-existing-bag mechanism, and it is still
    // three times the pre-biome baseline (21%) at its worst.
    const perBand: number[] = [];
    for (let band = 0; band < 4; band += 1) perBand.push(leanVsControl(band).lean.pAtLeast3);
    for (const [i, p] of perBand.entries()) {
      expect(p, `band ${i} announced-lean P(>=3) was only ${(100 * p).toFixed(0)}%`).toBeGreaterThan(0.5);
    }
    // ...and it must still DECAY rather than collapse: the early bands, which is
    // where a player commits to a build, stay near the measured 98%.
    expect(perBand[0]!).toBeGreaterThan(0.9);
    expect(perBand[1]!).toBeGreaterThan(0.9);
    expect(perBand.length).toBe(4);
  });

  it('PREFER, NOT SILO: every shop theme still reaches the run, and the un-named types are not starved', () => {
    // The regression this catches is real and was measured mid-build: with the
    // biome shop lists holding only their own lean's stall, the three types no
    // biome leaned on at the time (frost, lightning, dark — the roster fielded
    // no mob for any of them, so there was no honest band to build around them)
    // fell from 2.1-2.5 offers per 10 waves to 0.96-1.19, P(>=3) from 29-34% to
    // 10-16%. Preference crowds out whatever it does not name, and
    // `affinityReachability.test.ts` measures per-SHELF density so it never saw
    // it. Phase 1 fixed it by giving each homeless stall a priority-1 home in the
    // biome it read beside; the ELEVEN-BAND pass (2026-08-26) retired that patch
    // by giving every type a band, so each single-type stall now sits at priority
    // 0 of its own. Re-measured over the same 400-seed harness after that pass:
    // mean fixed-type supply 2.73 -> 2.72 offers and P(>=3) 37% -> 36% (i.e.
    // unchanged), with P(zero) IMPROVING for all eleven types. The floor below is
    // what keeps the give-up honest either way.
    const seen = new Set<string>();
    const totals: Record<string, number> = {};
    for (const seed of SEEDS) {
      const map = generateRunMap(seed, 20);
      for (let d = 1; d <= totalColumns(map); d++) {
        for (const node of map.depths[d]!) if (node.kind === 'shop') seen.add(node.shopId!);
      }
      const counts = offersInWindow(seed, 1, 10);
      for (const t of ALL_TYPES) totals[t] = (totals[t] ?? 0) + (counts[t] ?? 0);
    }
    for (const shopId of shopTypeIds) {
      expect(seen.has(shopId), `${shopId} was never offered in ${SEEDS.length} runs — a biome siloed it out`).toBe(true);
    }
    // No type may fall below a floor a shop-preference regression would breach.
    // (Pre-biome baseline over the same window was 2.1-3.2 offers/run per type.)
    for (const t of ALL_TYPES) {
      const perRun = (totals[t] ?? 0) / SEEDS.length;
      expect(perRun, `${t} is down to ${perRun.toFixed(2)} offers per 10 waves`).toBeGreaterThan(1.4);
    }
  });

  it('every card type\'s single-type stall is carried at priority 0 or 1 by SOME biome (the coverage invariant)', () => {
    // The rule that stops the crowd-out above from returning by accident when a
    // biome is added or its shop list is re-ordered.
    const singleTypeStalls = new Map<string, string>();
    for (const shopId of shopTypeIds) {
      const pool = cardPoolForShop(shopId);
      if (pool.length === 0) continue;
      const types = new Set(pool.map(typeKeyOf));
      if (types.size === 1) singleTypeStalls.set([...types][0]!, shopId);
    }
    // NON-VACUITY: this audit only means something if the single-type stalls
    // exist at all, for every type.
    expect(singleTypeStalls.size, 'no single-type stalls found').toBe(ALL_TYPES.length);

    const uncovered: string[] = [];
    for (const [type, shopId] of singleTypeStalls) {
      const carrier = biomeIds.find((id) => biomeCatalog[id]!.shops.indexOf(shopId) >= 0
        && biomeCatalog[id]!.shops.indexOf(shopId) <= 1);
      if (!carrier) uncovered.push(`${type} (${shopId})`);
    }
    expect(uncovered, `no biome carries the stall for: ${uncovered.join(', ')}`).toEqual([]);
  });

  it('EVERY card type is DECLARABLE: it is the lean of some band', () => {
    // The Q12 invariant (docs/run-structure-patterns.md): a band's identity is
    // the mechanism by which a player declares a build, so an archetype with no
    // band cannot be declared — only stumbled into. Coverage of the DECLARATION
    // surface is therefore a design requirement, not a content nicety, and it is
    // a different claim from the shop-coverage invariant below: a type whose
    // stall is merely carried at priority 1 of someone else's band is SUPPLIED
    // but not DECLARABLE. Five types (frost, lightning, dark, bow, lance) were
    // in exactly that state until the mob roster that staffs them landed.
    const leans = biomeIds.map((id) => {
      const lean = biomeCatalog[id]!.lean;
      return `${lean.kind}:${lean.type}`;
    }).sort();
    expect([...new Set(leans)], 'two bands lean the same type — some other type is now undeclarable')
      .toEqual(leans);
    expect(leans, 'a card type has no band of its own').toEqual(ALL_TYPES);
  });

  it('a biome never breaks a stall\'s own minWave gate (the preference is filtered, not forced)', () => {
    const gated = shopTypeIds.filter((id) => (shopCatalog[id]!.minWave ?? 0) > 1);
    expect(gated.length, 'no minWave-gated shop to audit').toBeGreaterThan(0);
    for (const seed of SEEDS) {
      const map = generateRunMap(seed, 12);
      for (let d = 1; d <= totalColumns(map); d++) {
        for (const node of map.depths[d]!) {
          if (node.kind !== 'shop') continue;
          const minWave = shopCatalog[node.shopId!]!.minWave;
          if (minWave !== undefined) expect(node.wave, `${node.shopId} at wave ${node.wave}`).toBeGreaterThanOrEqual(minWave);
        }
      }
    }
  });
});

describe('biome event preference: a band OPENS on its own themes (and that is all it can do)', () => {
  /**
   * MEASURED LIMIT, stated rather than papered over. The event theme bag holds
   * all six themes with NO REPEAT until it empties, and a biome prefers two of
   * them. Preferring an entry inside a no-repeat bag changes the ORDER the bag
   * is spent in, never the FREQUENCY over a whole cycle — over 400 seeds x 20
   * waves the aggregate on-theme share is 33.4% against an unbiased expectation
   * of 33.3%. That is not a bug in the binding; it is arithmetic, and the only
   * ways around it (reshuffling at a band boundary, a weighted bag) all spend
   * extra `Rng` calls inside `generateWave` and would move the map's structural
   * fingerprint — which `biomeDeal.test.ts` forbids.
   *
   * WHAT IT DOES BUY, measured on the same sweep: the FIRST event column of a
   * band is 63.2% on-theme against 33.3% by chance, so a band OPENS in its own
   * flavour. The rest of the value the proposal wants from events (§1.7: a theme
   * predicts a reward's FLAVOUR, never its TYPE) is a CONTENT pass — type-filtered
   * `cardChoice` outcomes in `src/data/events.ts` — not a mapgen one, and it is
   * left to phase 2.
   */
  it('the first event column of a band skews hard to its biome themes; later columns fall back to chance', () => {
    let firstOn = 0; let firstTotal = 0;
    let laterOn = 0; let laterTotal = 0;
    let unbiasedWeight = 0;
    for (const seed of SEEDS) {
      const map = generateRunMap(seed, 20);
      const bandSeen = new Set<number>();
      for (let d = 1; d <= totalColumns(map); d++) {
        const column = map.depths[d]!;
        const events = column.filter((n: RunNode) => n.kind === 'event');
        if (events.length === 0) continue;
        const themes = events.map((n) => n.eventTheme!);
        expect(new Set(themes).size, `column ${d} repeated an event theme`).toBe(themes.length);
        const band = bandIndexOf(column[0]!.wave);
        const biome = biomeForBand(seed, band);
        const isFirst = !bandSeen.has(band);
        bandSeen.add(band);
        for (const t of themes) {
          const on = biome.eventThemes.includes(t);
          unbiasedWeight += biome.eventThemes.length / 6;
          if (isFirst) { firstTotal += 1; if (on) firstOn += 1; } else { laterTotal += 1; if (on) laterOn += 1; }
        }
      }
    }
    // NON-VACUITY: both populations must be large, or the comparison is noise.
    expect(firstTotal, 'no band-opening event columns were examined').toBeGreaterThan(500);
    expect(laterTotal, 'no later event columns were examined').toBeGreaterThan(500);

    const unbiased = unbiasedWeight / (firstTotal + laterTotal);
    const firstShare = firstOn / firstTotal;
    expect(firstShare, `band-opening on-theme share ${(100 * firstShare).toFixed(0)}% vs unbiased ${(100 * unbiased).toFixed(0)}%`)
      .toBeGreaterThan(unbiased * 1.5);
    // And the documented limit is asserted too, so the day someone makes the bag
    // genuinely biased this test tells them the doc comment above is now stale.
    expect(Math.abs(laterOn / laterTotal - unbiased), 'later columns are no longer at chance — re-read this suite\'s doc comment')
      .toBeLessThan(0.05);
  });
});
