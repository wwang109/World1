// Run Map — seeded node-graph generator for Run Mode's "wave rhythm" shape
// (see docs/release-game-plan.md: "Run shape v1 (rev. 2026-07-29)" and
// docs/run-events-design.md). A run is WAVE_COUNT (5) waves; wave w (1..4) is
// 2-3 "stop" columns (each a 2-3 choice of `event`/`shop` nodes) followed by
// ONE mandatory `fight` column (a single node, no choice); wave 5 is 2-3 stop
// columns followed by the single `boss` column. Pure TS, fully deterministic —
// no Date.now/Math.random, all randomness flows through the engine's seeded
// `Rng` in a fixed call order (same seed -> identical map, forever).

import { hashSeed, Rng } from '../engine/rng';
import { shopCatalog, shopTypeIds } from '../data/shopTypes';
import type { EventTheme } from '../data/events';

/** `'event'`/`'shop'` are the two stop-column choice kinds; `'fight'` is the
 * mandatory single-node column ending waves 1-4; `'boss'` ends wave 5. There
 * is no separate `'elite'` map choice any more — a fight column's TITLE
 * (normal/elite) is derived from its wave via `FIGHT_TABLE` (see runState.ts),
 * not chosen on the map. */
export type RunNodeKind = 'event' | 'shop' | 'fight' | 'boss';

export interface RunNode {
  /** Stable id, e.g. "d3-1" (column 3, choice index 1). Also seeds derived rolls. */
  id: string;
  /** 1-indexed overall column position (traversal order) — used for map rendering. */
  depth: number;
  /** 1-indexed wave this node belongs to (1..WAVE_COUNT). */
  wave: number;
  kind: RunNodeKind;
  /** 1..WAVE_COUNT — set on fight/boss nodes only (one fight per wave, lockstep with hero level). */
  fightNumber?: number;
  /**
   * Fight nodes only (waves 1-4; the wave-5 boss column has no option — it's
   * a single mandatory node): which of the mandatory fight column's TWO risk
   * options this node is. `'standard'` is exactly `FIGHT_TABLE[fightNumber]`
   * (today's byte-identical encounter); `'hard'` is one title rung up + 1
   * level (see `fightTableEntryForNode` in runState.ts) and therefore pays
   * more via `battleGoldReward`'s difficulty score — USER-LOCKED
   * (2026-07-30): "the mandatory fight column now presents 2 fight options —
   * a safer one and a harder one that pays more". Undefined on boss nodes.
   */
  fightOption?: 'standard' | 'hard';
  /** Seed for `rollEncounter` — fight/boss nodes only. Each of a fight
   * column's two options gets its OWN distinct seed (derived from that
   * option's own node id), so the two previews differ and are reproducible. */
  encounterSeed?: number;
  /** Seed for `rollEventForNode` — event nodes only. */
  eventSeed?: number;
  /** Which event theme this node previews ("EVENT · CACHE" etc.) — event
   * nodes only. Assigned here, at generation, from a no-repeat theme bag
   * (mirrors `shopId`) so the map can label a node's theme before the event
   * itself is drawn (drawing would consume `RunState`'s per-run event bag —
   * see `rollEventForNode` in run/events.ts). */
  eventTheme?: EventTheme;
  /** Which shop theme this node offers — shop nodes only. */
  shopId?: string;
  /** Seed for `rollShopStock(shopId, shopSeed, depth)` — shop nodes only. */
  shopSeed?: number;
}

export interface RunMap {
  seed: number;
  /** `depths[0]` is always empty (unused placeholder); `depths[1..totalColumns]`
   * are the columns in traversal order — a stop column has 2-3 event/shop
   * choices, a fight/boss column always has exactly 1 node. */
  depths: RunNode[][];
}

/** Number of columns in a `RunMap` (excludes the unused `depths[0]` slot). */
export function totalColumns(map: RunMap): number {
  return map.depths.length - 1;
}

/** Fixed run length: 5 waves, each ending in one mandatory fight (wave 5 -> boss). */
export const WAVE_COUNT = 5;

const MIN_STOPS_PER_WAVE = 2;
const MAX_STOPS_PER_WAVE = 3;
const MIN_CHOICES = 2;
const MAX_CHOICES = 3;
/** Whole-run band for how many stop CHOICES across the entire map are shops
 * (at most one shop choice per stop column — see the placement loop below). */
const MIN_SHOPS_PER_RUN = 2;
const MAX_SHOPS_PER_RUN = 4;

/** The 6-theme event catalog grouping (`EventTheme` in data/events.ts) — kept
 * as a local literal list rather than importing the catalog's ids, since
 * this module only needs the theme labels for map-gen (not the events
 * themselves — see the "additive features" resolver-seam note in CLAUDE.md,
 * this stays declarative-shape-only, no content). */
const EVENT_THEMES: readonly EventTheme[] = ['training', 'cache', 'recruit', 'forge', 'market', 'omen'];

/** Draw `count` DISTINCT items from `pool` via `rng.int`, fixed call order. */
function sampleDistinct<T>(rng: Rng, pool: readonly T[], count: number): T[] {
  const remaining = [...pool];
  const result: T[] = [];
  const n = Math.min(count, remaining.length);
  for (let i = 0; i < n; i++) {
    const idx = rng.int(remaining.length);
    result.push(remaining[idx]!);
    remaining.splice(idx, 1);
  }
  return result;
}

/**
 * Roll a wave-rhythm run map from `seed`. Deterministic: same seed -> deep-
 * equal map, forever. RNG call order is fixed:
 *   1. per-wave stop-column count (wave 1..WAVE_COUNT),
 *   2. per-stop-column choice count (traversal order across the whole run),
 *   3. whole-run shop-choice count (one roll, 2-4),
 *   4. which stop columns (by traversal index) host that run's shop choices
 *      (distinct sample over column indices),
 *   5. per shop column: which slot in that column is the shop (one roll),
 *      plus the shop's theme (drawn from a no-repeat bag, reshuffled only if
 *      exhausted — a whole run only ever offers <= MAX_SHOPS_PER_RUN (4)
 *      shops, so the bag never exhausts against the 5-theme catalog),
 *   6. per stop column: that column's event NODES' themes, drawn together
 *      (one column, one pass) from a no-repeat EVENT_THEMES bag — this keeps
 *      themes distinct WITHIN a column whenever enough remain in the bag
 *      (a column never has more than 3 event slots, well under the 6-theme
 *      catalog), reshuffling only if the bag runs dry mid-column.
 * Event nodes fill every non-shop stop slot; they carry no RNG draw of their
 * own here beyond the theme (their `eventSeed` is a pure hash of the run seed
 * + node id) — the event ITSELF is drawn later, at play time, by
 * `rollEventForNode`, which now also respects the node's `eventTheme`.
 */
export function generateRunMap(seed: number): RunMap {
  const rng = new Rng(hashSeed('runMap', seed));

  // 1) Per-wave stop-column count (2 or 3), wave 1..WAVE_COUNT in order.
  const stopCounts: number[] = [0]; // index 0 unused (waves are 1-indexed)
  for (let w = 1; w <= WAVE_COUNT; w++) {
    stopCounts[w] = MIN_STOPS_PER_WAVE + rng.int(MAX_STOPS_PER_WAVE - MIN_STOPS_PER_WAVE + 1);
  }

  // Flatten the run's stop columns into traversal order (wave 1's stops, then
  // wave 2's, ...) so choice-count / shop-placement rolls have one fixed
  // sequence regardless of wave boundaries.
  const stopColumnWaves: number[] = [];
  for (let w = 1; w <= WAVE_COUNT; w++) {
    for (let i = 0; i < stopCounts[w]!; i++) stopColumnWaves.push(w);
  }
  const totalStopColumns = stopColumnWaves.length;

  // 2) Per-stop-column choice count (2 or 3), traversal order.
  const choiceCounts = stopColumnWaves.map(() => MIN_CHOICES + rng.int(MAX_CHOICES - MIN_CHOICES + 1));

  // 3) Whole-run shop-choice count (2-4), one roll.
  const shopChoiceCount = Math.min(
    totalStopColumns,
    MIN_SHOPS_PER_RUN + rng.int(MAX_SHOPS_PER_RUN - MIN_SHOPS_PER_RUN + 1),
  );

  // 4) Which stop columns (by traversal index) host a shop choice. At most
  // ONE shop slot per column (enforced below), so a stop column is NEVER
  // shop-only (every column has >= MIN_CHOICES(2) slots, >= 1 stays 'event').
  const columnIndices: number[] = [];
  for (let i = 0; i < totalStopColumns; i++) columnIndices.push(i);
  const shopColumnIdx = new Set(sampleDistinct(rng, columnIndices, shopChoiceCount));

  // Shop theme draw-without-replacement bag: a run never repeats a theme
  // until all `shopTypeIds.length` have appeared (reshuffled once exhausted).
  // `minWave`-gated themes (Gemcutter wave 2+, Relic Vault wave 3+) are
  // skipped over in the CURRENT bag draw (not removed from the bag — they
  // stay available for a later, eligible column) rather than rolled fresh,
  // so the bag's no-repeat guarantee and RNG call order stay intact; only
  // if every remaining theme is ineligible for this wave (never happens in
  // practice — at most 2 of 16 themes are wave-gated) does it reshuffle.
  let shopThemeBag: string[] = [];
  const nextShopTheme = (wave: number): string => {
    for (let attempt = 0; attempt < 2; attempt++) {
      if (shopThemeBag.length === 0) shopThemeBag = sampleDistinct(rng, shopTypeIds, shopTypeIds.length);
      const idx = shopThemeBag.findIndex((id) => {
        const minWave = shopCatalog[id]?.minWave;
        return minWave === undefined || wave >= minWave;
      });
      if (idx !== -1) {
        const [id] = shopThemeBag.splice(idx, 1);
        return id!;
      }
      // No theme in the current bag is eligible for this wave — force a reshuffle and retry once.
      shopThemeBag = [];
    }
    throw new Error(`generateRunMap: no shop theme eligible for wave ${wave}`);
  };

  // Event theme draw-without-replacement bag: mirrors the shop theme bag,
  // but drawn a whole STOP COLUMN at a time (see `nextEventThemes` below) so
  // a column's event choices come out of the bag together and are therefore
  // distinct from one another whenever enough themes remain unclaimed.
  let eventThemeBag: EventTheme[] = [];
  const nextEventThemes = (count: number): EventTheme[] => {
    const drawn: EventTheme[] = [];
    while (drawn.length < count) {
      if (eventThemeBag.length === 0) {
        eventThemeBag = sampleDistinct(rng, EVENT_THEMES, EVENT_THEMES.length);
      }
      const idx = eventThemeBag.findIndex((t) => !drawn.includes(t));
      if (idx === -1) {
        // Every theme left in the current bag was already drawn earlier in
        // THIS column (only possible if a column ever asked for more themes
        // than exist in the catalog — never true today, count <= 3 < 6).
        // Force a reshuffle and keep going rather than repeat within-column.
        eventThemeBag = [];
        continue;
      }
      const [theme] = eventThemeBag.splice(idx, 1);
      drawn.push(theme!);
    }
    return drawn;
  };

  const depths: RunNode[][] = [[]]; // depths[0] unused placeholder
  let depth = 0; // 1-indexed overall column position
  let stopColIdx = 0; // index into stopColumnWaves / choiceCounts

  for (let w = 1; w <= WAVE_COUNT; w++) {
    for (let i = 0; i < stopCounts[w]!; i++) {
      depth += 1;
      const count = choiceCounts[stopColIdx]!;
      const hasShop = shopColumnIdx.has(stopColIdx);
      // 5) Which slot in THIS column is the shop (only rolled if this column got one).
      const shopSlot = hasShop ? rng.int(count) : -1;
      // 6) This column's event-node themes, drawn together (one pass) so
      // they come out distinct within the column whenever possible.
      const eventSlotCount = hasShop ? count - 1 : count;
      const eventThemes = nextEventThemes(eventSlotCount);
      let eventThemeCursor = 0;

      const nodes: RunNode[] = [];
      for (let slot = 0; slot < count; slot++) {
        const id = `d${depth}-${slot}`;
        if (slot === shopSlot) {
          nodes.push({
            id, depth, wave: w, kind: 'shop',
            shopId: nextShopTheme(w),
            shopSeed: hashSeed('shop', seed, id),
          });
        } else {
          nodes.push({
            id, depth, wave: w, kind: 'event',
            eventSeed: hashSeed('event', seed, id),
            eventTheme: eventThemes[eventThemeCursor++]!,
          });
        }
      }
      depths.push(nodes);
      stopColIdx += 1;
    }

    // Mandatory fight (waves 1-4) or boss (wave 5) column — fightNumber ==
    // wave (hero LV is lockstep: entering fight n, hero is LV n). Wave 5's
    // boss column stays a single mandatory node (no choice); waves 1-4 now
    // offer TWO fight options (standard + hard, USER-LOCKED 2026-07-30) so
    // the player picks their risk — run length/ladder/boss are unchanged.
    depth += 1;
    const isBossWave = w === WAVE_COUNT;
    if (isBossWave) {
      const id = `d${depth}-0`;
      depths.push([{
        id, depth, wave: w, kind: 'boss',
        fightNumber: w,
        encounterSeed: hashSeed('encounter', seed, id),
      }]);
    } else {
      const idStandard = `d${depth}-0`;
      const idHard = `d${depth}-1`;
      depths.push([
        {
          id: idStandard, depth, wave: w, kind: 'fight',
          fightNumber: w,
          fightOption: 'standard',
          encounterSeed: hashSeed('encounter', seed, idStandard),
        },
        {
          id: idHard, depth, wave: w, kind: 'fight',
          fightNumber: w,
          fightOption: 'hard',
          encounterSeed: hashSeed('encounter', seed, idHard),
        },
      ]);
    }
  }

  return { seed, depths };
}
