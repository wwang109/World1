import type { BiomeLean } from '../../src/data/biomes';
import { enemies } from '../../src/data/enemies';
import { enemyDerivedAffinity } from '../../src/data/enemyAffinity';

/**
 * SHARED FIXTURE for one fact pinned twice (found by two independent audits
 * on 2026-09-06): how many of a band's LISTED mobs actually carry that band's
 * own lean, board-derived. `tests/run/biomeForecastCounter.test.ts` ("stated
 * the other way: EVERY band's exact on-lean mob count is pinned by name")
 * and `tests/game/bandForecastRows.test.ts` (previously only "at least one
 * mob per band carries the lean" — a floor of 1 against real values of 1-4,
 * which would not notice any movement except a fall all the way to zero) now
 * both import THIS table and THIS counting function, so a content change
 * that moves a band's count (the coming enemy-growth-by-level pass is
 * expected to do exactly that) has one place to update, and the two tests
 * cannot silently drift apart the way they already had.
 *
 * MEASURED against the live roster on 2026-09-06 (`enemyDerivedAffinity`,
 * every biome, every listed mob) — verify again against the live catalog
 * before editing this table, do not hand-edit it to make a test pass:
 *
 *   band        lean       on-lean/listed
 *   arrowfell   bow        2/4
 *   duskbarrow  dark       2/4
 *   emberwaste  fire       2/4
 *   frostmarch  frost      2/4
 *   hallowfield holy       4/4
 *   howlmoor    beast      1/5
 *   ironmoot    axe        2/5
 *   pikewold    lance      2/4
 *   stormreach  lightning  1/4
 *   swornhold   sword      3/5
 *   thornwild   nature     3/5
 *   total                  24/48
 */
export const EXPECTED_ON_LEAN: Record<string, number> = {
  arrowfell: 2,
  duskbarrow: 2,
  emberwaste: 2,
  frostmarch: 2,
  hallowfield: 4,
  howlmoor: 1,
  ironmoot: 2,
  pikewold: 2,
  stormreach: 1,
  swornhold: 3,
  thornwild: 3,
};

/** `EXPECTED_ON_LEAN`'s own total — pinned separately so a table edit that
 * keeps the same sum but moves counts between bands still gets caught by
 * whichever assertion checks per-band names, while this catches the sum
 * moving at all. */
export const EXPECTED_ON_LEAN_TOTAL = 24;

/** The total number of mobs listed across every band, independent of lean —
 * moves only if a band's mob ROSTER changes size, not if affinity does. */
export const EXPECTED_LISTED_TOTAL = 48;

/**
 * THE ONE COUNTING FUNCTION both suites call — never a second derivation.
 * Counts how many of `mobIds` derive an affinity (`enemyDerivedAffinity`,
 * `src/data/enemyAffinity.ts`, which itself wraps the engine's
 * `boardAffinities`) matching `lean`. Never reads a mob's own
 * `elementAffinity`/`weaponAffinity` field directly (those are no longer
 * authored on any entry — 2026-09-06 ruling, affinity is board-derived only)
 * and never asks `counterTypeFor` — that answers a different question ("what
 * type COUNTERS this lean", which for the bow lean is `undefined` since
 * nothing beats bow) than this one ("does this mob's own board carry this
 * lean's type"), which is why the bow band still has a real, nonzero on-lean
 * count (2/4) despite having no counter at all.
 */
export function onLeanCount(lean: BiomeLean, mobIds: readonly string[]): number {
  let onType = 0;
  for (const mobId of mobIds) {
    const def = enemies[mobId];
    if (!def) throw new Error(`onLeanCount: unknown mob id "${mobId}"`);
    const affinity = enemyDerivedAffinity(def);
    const has = lean.kind === 'element' ? affinity.elementAffinity === lean.type : affinity.weaponAffinity === lean.type;
    if (has) onType += 1;
  }
  return onType;
}
