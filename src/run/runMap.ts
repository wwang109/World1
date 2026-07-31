// Run Map — seeded node-graph generator for Run Mode's ENDLESS "wave rhythm"
// shape (see docs/release-game-plan.md and the 2026-07-30 endless-run redesign
// in CLAUDE.md/tests). A run no longer has a fixed wave count: waves keep
// coming forever, each wave w = 2-3 "stop" columns (each a 2-3 choice of
// `event`/`shop` nodes) followed by ONE mandatory fight/boss column (`fight`
// for w % BOSS_EVERY !== 0, `boss` for w % BOSS_EVERY === 0 — see
// `isBossWave`). Pure TS, fully deterministic — no Date.now/Math.random, all
// randomness flows through the engine's seeded `Rng` in a fixed call order.
//
// LAZY GENERATION: the map can't be pre-built to infinity. `ensureWavesThrough`
// (and the depth-oriented `ensureDepthThrough`) extend a map to cover however
// far the player can currently reach, generating wave-by-wave. Each wave's OWN
// structural rolls (stop count, per-column choice count, which column(s) get
// a shop) come from a Rng seeded fresh from `hashSeed('wave', seed, w)` — NOT
// a single Rng threaded across the whole map — so wave w's own rolls never
// depend on how many EARLIER waves were generated first. The shop/event THEME
// no-repeat bags are the one piece of state that legitimately carries across
// waves (a bag shouldn't reset every wave); they thread forward as plain
// arrays (not Rng state) through the wave-by-wave build loop, and — because
// each wave's own draws are themselves pure functions of that wave's Rng —
// replaying waves 1..w-1 to reconstruct the bag state ahead of wave w always
// produces the SAME bags whether done eagerly or lazily. `ensureWavesThrough`
// exploits this directly: it just rebuilds the whole map from wave 1 through
// the target wave every time (cheap — a few hundred nodes at most for any
// depth a player will ever reach) rather than trying to persist/patch partial
// generator state, which keeps the "same seed -> same wave N, eager or lazy"
// invariant trivially true by construction.

import { hashSeed, Rng } from '../engine/rng';
import { shopCatalog, shopTypeIds } from '../data/shopTypes';
import type { EventTheme } from '../data/events';

/** `'event'`/`'shop'` are the two stop-column choice kinds; `'fight'` is the
 * mandatory single-node-or-2-option column ending every non-boss wave;
 * `'boss'` ends every `BOSS_EVERY`th wave (a milestone boss, not a run-ending
 * one — see `recordBattleResult` in runState.ts, which now costs a LIFE on a
 * boss loss instead of ending the run). There is no separate `'elite'` map
 * choice — a fight column's TITLE (normal/elite/boss) is derived from its
 * wave via the fight-spec resolver in runState.ts, not chosen on the map. */
export type RunNodeKind = 'event' | 'shop' | 'fight' | 'boss';

export interface RunNode {
  /** Stable id, e.g. "d3-1" (column 3, choice index 1). Also seeds derived rolls. */
  id: string;
  /** 1-indexed overall column position (traversal order) — used for map rendering. */
  depth: number;
  /** 1-indexed wave this node belongs to (endless — no upper bound). */
  wave: number;
  kind: RunNodeKind;
  /** Set on fight/boss nodes only — the run's overall fight number (== wave,
   * since every wave ends in exactly one fight/boss column). Feeds the
   * fight-spec resolver (`fightTableEntryForNode` in runState.ts) for
   * level/title/rank/modifier escalation. */
  fightNumber?: number;
  /**
   * Fight nodes only (non-boss waves; a boss wave's column has no option —
   * it's a single mandatory node): which of the mandatory fight column's TWO
   * risk options this node is. `'standard'` is exactly this fight number's
   * base spec; `'hard'` is one title rung up + 1 level (the ENEMY level is
   * uncapped — see `fightTableEntryForNode` in runState.ts) and therefore
   * pays more via `battleGoldReward`'s difficulty score. Undefined on boss nodes.
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
   * are the columns generated SO FAR, in traversal order — a stop column has
   * 2-3 event/shop choices, a fight/boss column always has 1-2 nodes. An
   * endless run's map only ever holds as many columns as have been generated
   * (see `ensureWavesThrough`/`ensureDepthThrough`) — NOT the whole run. */
  depths: RunNode[][];
}

/** Number of columns in a `RunMap` (excludes the unused `depths[0]` slot). */
export function totalColumns(map: RunMap): number {
  return map.depths.length - 1;
}

/** How many waves' worth of columns a `RunMap` currently holds (0 if none
 * generated yet beyond the placeholder). */
export function generatedWaveCount(map: RunMap): number {
  if (map.depths.length <= 1) return 0;
  return map.depths[map.depths.length - 1]![0]!.wave;
}

/** Milestone boss cadence — USER-LOCKED (2026-07-30): "every 5th fight is a
 * boss (fights 5, 10, 15, …)". Kept under the historical `WAVE_COUNT` name
 * too (see the re-export at the bottom) purely so `src/game/runStore.ts`'s
 * existing pass-through import/re-export keeps compiling — nothing there
 * actually reads its VALUE, so repurposing it as "boss cadence period"
 * instead of "fixed run length" is safe. */
export const BOSS_EVERY = 5;
/** @deprecated legacy name for `BOSS_EVERY` — the run is endless now, this is
 * no longer "the number of waves in a run", just the boss-milestone period. */
export const WAVE_COUNT = BOSS_EVERY;

/** How many waves `createRun`/bare `generateRunMap(seed)` eagerly generate up
 * front (a small head start so the very first `availableChoices` never has to
 * lazily extend anything) — USER-LOCKED (2026-07-30): "createRun seeds the
 * first couple of waves". */
export const INITIAL_WAVES = 2;

const MIN_STOPS_PER_WAVE = 2;
const MAX_STOPS_PER_WAVE = 3;
const MIN_CHOICES = 2;
const MAX_CHOICES = 3;
/**
 * Per-wave shop rate — USER-LOCKED (2026-07-30): the old "2-4 shops per whole
 * run" cap was a WHOLE-RUN number and makes no sense once a run is endless;
 * converted to a per-wave ROLLING rate instead. Chosen rate: each wave rolls
 * 0 or 1 shop-column (uniform, `rng.int(2)`), capped by that wave's actual
 * stop-column count (so it can never ask for more shop columns than the wave
 * has stop columns) — average 0.5 shop column/wave, i.e. ~2.5 shops per 5
 * waves, matching the old 2-4/run band's density almost exactly while
 * staying well-defined forever.
 */
const MAX_SHOP_COLUMNS_PER_WAVE = 1;

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

/** Cross-wave bag state threaded through the wave-by-wave build loop — plain
 * data (never Rng state), so replaying waves 1..w-1 to reconstruct it ahead
 * of wave w is always reproducible regardless of batching. */
interface MapGenBags {
  shopThemeBag: string[];
  eventThemeBag: EventTheme[];
}

const EMPTY_BAGS: MapGenBags = { shopThemeBag: [], eventThemeBag: [] };

interface WaveResult {
  columns: RunNode[][];
  bags: MapGenBags;
}

/**
 * Generate ONE wave's columns (stop columns + its trailing fight/boss
 * column), starting at overall column position `startDepth + 1`. Own Rng
 * seeded fresh from `hashSeed('wave', seed, wave)` drives every structural
 * roll for THIS wave only (stop count, per-column choice count, which
 * column(s) get a shop slot, which slot within a shop column, and any
 * mid-wave bag reshuffles) — see the module doc comment for why this makes
 * wave `wave` independent of how many earlier waves were generated first.
 * RNG call order within a wave:
 *   1. stop-column count (2-3),
 *   2. per-stop-column choice count (2-3), in column order,
 *   3. this wave's shop-column count (0-1, capped by stop count),
 *   4. which stop column(s) (by in-wave index) host that shop,
 *   5. per shop column: which slot is the shop, then its theme (bag draw,
 *      reshuffling via THIS wave's rng if exhausted),
 *   6. per stop column: its event-node themes, drawn together (bag draw,
 *      reshuffling via THIS wave's rng if exhausted).
 */
function generateWave(seed: number, wave: number, startDepth: number, bagsIn: MapGenBags): WaveResult {
  const rng = new Rng(hashSeed('wave', seed, wave));

  // 1) Stop-column count (2 or 3).
  const stopCount = MIN_STOPS_PER_WAVE + rng.int(MAX_STOPS_PER_WAVE - MIN_STOPS_PER_WAVE + 1);

  // 2) Per-stop-column choice count (2 or 3), in column order.
  const choiceCounts: number[] = [];
  for (let i = 0; i < stopCount; i++) {
    choiceCounts.push(MIN_CHOICES + rng.int(MAX_CHOICES - MIN_CHOICES + 1));
  }

  // 3) This wave's shop-column count (0 or 1, capped by stop count).
  const shopColumnCount = Math.min(stopCount, rng.int(MAX_SHOP_COLUMNS_PER_WAVE + 1));

  // 4) Which stop column(s) (in-wave index) host a shop.
  const columnIndices: number[] = [];
  for (let i = 0; i < stopCount; i++) columnIndices.push(i);
  const shopColumnIdx = new Set(sampleDistinct(rng, columnIndices, shopColumnCount));

  let shopThemeBag = bagsIn.shopThemeBag;
  const nextShopTheme = (waveNum: number): string => {
    for (let attempt = 0; attempt < 2; attempt++) {
      if (shopThemeBag.length === 0) shopThemeBag = sampleDistinct(rng, shopTypeIds, shopTypeIds.length);
      const idx = shopThemeBag.findIndex((id) => {
        const minWave = shopCatalog[id]?.minWave;
        return minWave === undefined || waveNum >= minWave;
      });
      if (idx !== -1) {
        const [id] = shopThemeBag.splice(idx, 1);
        return id!;
      }
      // No theme in the current bag is eligible for this wave — force a reshuffle and retry once.
      shopThemeBag = [];
    }
    throw new Error(`generateWave: no shop theme eligible for wave ${waveNum}`);
  };

  let eventThemeBag = bagsIn.eventThemeBag;
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
        eventThemeBag = [];
        continue;
      }
      const [theme] = eventThemeBag.splice(idx, 1);
      drawn.push(theme!);
    }
    return drawn;
  };

  const columns: RunNode[][] = [];
  let depth = startDepth;

  for (let i = 0; i < stopCount; i++) {
    depth += 1;
    const count = choiceCounts[i]!;
    const hasShop = shopColumnIdx.has(i);
    const shopSlot = hasShop ? rng.int(count) : -1;
    const eventSlotCount = hasShop ? count - 1 : count;
    const eventThemes = nextEventThemes(eventSlotCount);
    let eventThemeCursor = 0;

    const nodes: RunNode[] = [];
    for (let slot = 0; slot < count; slot++) {
      const id = `d${depth}-${slot}`;
      if (slot === shopSlot) {
        nodes.push({
          id, depth, wave, kind: 'shop',
          shopId: nextShopTheme(wave),
          shopSeed: hashSeed('shop', seed, id),
        });
      } else {
        nodes.push({
          id, depth, wave, kind: 'event',
          eventSeed: hashSeed('event', seed, id),
          eventTheme: eventThemes[eventThemeCursor++]!,
        });
      }
    }
    columns.push(nodes);
  }

  // Mandatory fight (non-boss wave) or boss (every BOSS_EVERYth wave) column
  // — fightNumber == wave (every wave ends in exactly one fight/boss). A boss
  // wave's column stays a single mandatory node (no choice); non-boss waves
  // offer TWO fight options (standard + hard) so the player picks their risk.
  depth += 1;
  const isBossWave = wave % BOSS_EVERY === 0;
  if (isBossWave) {
    const id = `d${depth}-0`;
    columns.push([{
      id, depth, wave, kind: 'boss',
      fightNumber: wave,
      encounterSeed: hashSeed('encounter', seed, id),
    }]);
  } else {
    const idStandard = `d${depth}-0`;
    const idHard = `d${depth}-1`;
    columns.push([
      {
        id: idStandard, depth, wave, kind: 'fight',
        fightNumber: wave,
        fightOption: 'standard',
        encounterSeed: hashSeed('encounter', seed, idStandard),
      },
      {
        id: idHard, depth, wave, kind: 'fight',
        fightNumber: wave,
        fightOption: 'hard',
        encounterSeed: hashSeed('encounter', seed, idHard),
      },
    ]);
  }

  return { columns, bags: { shopThemeBag, eventThemeBag } };
}

/**
 * Build a map from scratch through wave `throughWave` (inclusive), waves
 * 1..throughWave in order. Deterministic: same (seed, throughWave) -> deep-
 * equal map, forever — and, because each wave's OWN Rng only depends on that
 * wave's index (see `generateWave`), wave w's nodes are byte-identical
 * whether this is a fresh build to exactly w, or a build that continues past
 * it — the "eager vs. lazy" equality invariant.
 */
function buildMapThroughWave(seed: number, throughWave: number): RunMap {
  const depths: RunNode[][] = [[]];
  let depth = 0;
  let bags: MapGenBags = EMPTY_BAGS;
  const target = Math.max(1, Math.floor(throughWave));
  for (let w = 1; w <= target; w++) {
    const result = generateWave(seed, w, depth, bags);
    for (const column of result.columns) {
      depth += 1;
      depths.push(column);
    }
    bags = result.bags;
  }
  return { seed, depths };
}

/**
 * Roll a fresh run map from `seed`, eagerly generating `throughWave` waves
 * (default `INITIAL_WAVES`) — USER-LOCKED (2026-07-30): "createRun seeds the
 * first couple of waves". Callers needing MORE than that (walking deeper into
 * an active run) use `ensureWavesThrough`/`ensureDepthThrough` below, never
 * this function again (re-calling this would re-seed a NEW map from wave 1,
 * discarding nothing that matters since it's deterministic, but callers
 * should prefer extending their existing `RunMap` value).
 */
export function generateRunMap(seed: number, throughWave: number = INITIAL_WAVES): RunMap {
  return buildMapThroughWave(seed, throughWave);
}

/**
 * Extend (never mutate) `map` so it covers waves 1..`waveIndex`. A no-op
 * (returns the SAME `map` reference) if it already covers that far. Otherwise
 * rebuilds the whole map from wave 1 through `waveIndex` — cheap for any
 * depth a real run ever reaches, and the only way to guarantee the "same
 * seed -> same wave N, eager or lazy" invariant without threading live Rng
 * state across calls (see the module doc comment).
 */
export function ensureWavesThrough(map: RunMap, waveIndex: number): RunMap {
  if (generatedWaveCount(map) >= waveIndex) return map;
  return buildMapThroughWave(map.seed, waveIndex);
}

/**
 * Extend (never mutate) `map` so `totalColumns(map) >= minDepth` — the
 * depth-oriented counterpart of `ensureWavesThrough` for callers (like
 * `runState.ts#chooseNode`/`availableChoices`) that only know the overall
 * column depth they need reachable, not which wave that falls in (a wave's
 * column count varies 3-4, so the mapping isn't known in advance). Grows one
 * wave at a time until satisfied; a no-op (same reference) if already deep enough.
 */
export function ensureDepthThrough(map: RunMap, minDepth: number): RunMap {
  let next = map;
  let waveIndex = generatedWaveCount(next);
  while (totalColumns(next) < minDepth) {
    waveIndex += 1;
    next = ensureWavesThrough(next, waveIndex);
  }
  return next;
}
