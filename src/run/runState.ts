// Run State — the single source of truth for one active Run Mode session
// (see docs/release-game-plan.md). Pure state-in/state-out transitions: every
// exported function returns a NEW `RunState`, never mutates its input. All
// fields are integers/plain-serializable (no class instances, no functions),
// ready for a future `src/meta` save/load layer. No Phaser, no Date.now/
// Math.random — the map, encounters, and shop rolls all derive from the run
// seed via the engine's seeded `Rng`.

import type { Gem, SkillTier } from '../engine/types';
import { enemies } from '../data/enemies';
import { skillBook } from '../data/skills';
import { HERO_BOARD_SLOTS } from '../data/heroes';
import { DRAFT_SET_KEYS, type DraftSetKey } from './draft';
import { buildEnemyEncounter, type EncounterUnit, type EnemyTitle } from './encounter';
import { canAfford, spentPL, type Allocation, type LevelStat } from './leveling';
import type { EventTheme } from '../data/events';
import { generateRunMap, WAVE_COUNT, type RunMap, type RunNode, type RunNodeKind } from './runMap';
import { Rng } from '../engine/rng';
import { rollShopStock, type CardOffer, type GemOffer } from './shop';

// ---------------------------------------------------------------------------
// Board / bag shapes — mirrors the OwnedBoardPiece / InventorySlot model in
// src/game/demoState.ts, kept here so src/run never depends on src/game.
// ---------------------------------------------------------------------------

export interface RunCard {
  instanceId: string;
  skillId: string;
  tier: SkillTier;
}

export type RunBoardPiece = RunCard & { slot: number; gem?: Gem | null };
export type RunBagSlot = RunCard | null;

/** One shop NODE's persisted-for-the-run shelf — structural twin of
 * `ShopShelfState` in `src/game/demoState.ts`, kept here so `src/run` never
 * depends on `src/game`. Keyed by node id (not shopId): every shop node gets
 * its own shelf/reroll history even if two nodes happen to share a theme. */
export interface RunShopShelf {
  cards: CardOffer[];
  gems: GemOffer[];
  rerollCount: number;
}

export type RunStatus = 'drafting' | 'active' | 'victory' | 'defeat';

export interface RunState {
  seed: number;
  map: RunMap;
  status: RunStatus;
  /** Deepest depth the player has fully resolved into (0 = pre-draft, at the map root). */
  depth: number;
  /** The node the player is currently resolving (fight/elite/boss in progress), or null when idle between choices. */
  currentNodeId: string | null;
  pieces: RunBoardPiece[];
  bagSlots: RunBagSlot[];
  gemInventory: string[];
  nextCardInstanceId: number;
  /** Per-shop-NODE persisted shelf (bought offers stay gone; REROLL replaces
   * the whole shelf, costs 1 gold). Empty until a shop node is first browsed. */
  shopShelves: Record<string, RunShopShelf>;
  /** Per-run event no-repeat bag: remaining shuffled catalog ids for the
   * current cycle (popped from the front as events are actually rolled — NOT
   * pre-rolled at map-gen time, since which event nodes get visited is
   * path-dependent). Refills (reshuffles) once exhausted. */
  eventBag: string[];
  /** How many times `eventBag` has been refilled — feeds the reshuffle seed
   * (`hashSeed('eventBag', seed, eventBagRefills)`) so a refill is
   * deterministic and reload-safe without needing a live `Rng` in state. */
  eventBagRefills: number;
  /** Per-theme no-repeat bags (mirrors `eventBag`, but scoped to a node's
   * `eventTheme` — see `rollEventForNode` in run/events.ts): remaining
   * shuffled ids from that theme's slice of the catalog, refilled once THAT
   * theme is exhausted. Optional/absent means "no theme drawn from yet"
   * (an inert default) — `createRun` sets both to
   * `{}` for new runs; older/defensive state without these keys just treats
   * every theme as fresh. */
  eventThemeBags?: Partial<Record<EventTheme, string[]>>;
  /** How many times each theme's bag has been refilled — feeds that theme's
   * reshuffle seed (`hashSeed('eventBag', seed, theme, refills)`). */
  eventThemeBagRefills?: Partial<Record<EventTheme, number>>;
  /** Node id -> drawn event id, filled the first time `rollEventForNode` is
   * called for that node (idempotent thereafter — a reload never re-draws). */
  eventInstances: Record<string, string>;
  gold: number;
  heroLevel: number;
  heroAllocation: Allocation;
  wins: number;
  losses: number;
}

/** Board width for the run's deck rail — same as the sandbox hero board. */
const RUN_BOARD_SLOTS = HERO_BOARD_SLOTS;

/**
 * Deterministic enemy pools for `rollEncounter`: every non-boss-tagged enemy
 * id (used for BOTH fight and elite nodes — the elite TITLE, not the enemy's
 * own `isElite` tag, is what makes a node harder) and every boss-tagged id
 * (`wolf_king` today). Fixed book order — no RNG in the pool construction
 * itself, only in which pool entry a node's `encounterSeed` selects.
 */
const FIGHT_POOL: readonly string[] = Object.values(enemies)
  .filter((e) => !e.isBoss)
  .map((e) => e.id);
const BOSS_POOL: readonly string[] = Object.values(enemies)
  .filter((e) => e.isBoss)
  .map((e) => e.id);

/**
 * fightNumber (1..WAVE_COUNT) -> {level, title} for `rollEncounter` — the
 * hero-parity level BEFORE the node's title delta (see `TITLE_PRESETS` in
 * encounter.ts) is added on top. Exported so balance-designer can retune the
 * ladder without touching the resolver machinery. Index 0 is fightNumber 1.
 * Default ladder (locked design, 2026-07-29): fights 1-2 normal, 3-4 elite,
 * 5 boss — `level` intentionally matches `fightNumber` 1:1 so the hero (who
 * gains +1 level after EVERY fight, win or lose — see `recordBattleResult`)
 * is always exactly LV n entering fight n: perfect lockstep with the enemy.
 */
export interface FightTableEntry {
  level: number;
  title: EnemyTitle;
}

export const FIGHT_TABLE: readonly FightTableEntry[] = [
  { level: 1, title: 'normal' },
  { level: 2, title: 'normal' },
  { level: 3, title: 'elite' },
  { level: 4, title: 'elite' },
  { level: 5, title: 'boss' },
];

/** `FIGHT_TABLE` entry for a 1-indexed fight number (1..WAVE_COUNT). */
export function fightTableEntry(fightNumber: number): FightTableEntry {
  const idx = Math.max(1, Math.min(WAVE_COUNT, Math.floor(fightNumber))) - 1;
  return FIGHT_TABLE[idx]!;
}

/**
 * Wave -> representative shop-stock depth band, feeding `rollShopStock`'s
 * bronze/silver/gold split (`tierThresholds` in shop.ts): wave 1's stops use
 * depth 2 (the 1-3 "early" band), waves 2-3 use depth 5 (the 4-6 "mid" band),
 * waves 4-5 use depth 8 (the 7-9 "deep" band) — a run's shop shelves get
 * progressively less bronze-heavy as its fights get harder.
 */
function shopStockDepthForWave(wave: number): number {
  if (wave <= 1) return 2;
  if (wave <= 3) return 5;
  return 8;
}

function findNode(map: RunMap, nodeId: string): RunNode | undefined {
  for (const column of map.depths) {
    for (const node of column) {
      if (node.id === nodeId) return node;
    }
  }
  return undefined;
}

function columnAt(map: RunMap, depth: number): readonly RunNode[] {
  return map.depths[depth] ?? [];
}

// ---------------------------------------------------------------------------
// Run lifecycle.
// ---------------------------------------------------------------------------

/**
 * Start a brand-new run: rolls the seeded map, empties the deck/bag/gems,
 * zeroes gold/wins/losses, hero level 1, status `'drafting'` (call
 * `applyDraftResult` to install the starting board and move to `'active'`).
 * Position sits at depth 0 (the map root) — `availableChoices` will surface
 * the depth-1 column once drafting is done.
 */
export function createRun(seed: number): RunState {
  return {
    seed,
    map: generateRunMap(seed),
    status: 'drafting',
    depth: 0,
    currentNodeId: null,
    pieces: [],
    bagSlots: [],
    gemInventory: [],
    nextCardInstanceId: 1,
    shopShelves: {},
    eventBag: [],
    eventBagRefills: 0,
    eventThemeBags: {},
    eventThemeBagRefills: {},
    eventInstances: {},
    gold: 0,
    heroLevel: 1,
    heroAllocation: {},
    wins: 0,
    losses: 0,
  };
}

/**
 * Install the 4 drafted cards (one pick per `DRAFT_SET_KEYS` set) as the
 * starting board, packed left-to-right in `DRAFT_SET_KEYS` order (same
 * placement idiom as `src/game/draftActions.ts#applyDraftPicks`, kept
 * independently here so `src/run` never imports from `src/game`). Only valid
 * while `status === 'drafting'`; transitions to `'active'` on success. A pick
 * that would overflow the board is silently dropped (shouldn't happen with
 * four bronze cards on a 10-slot board).
 */
export function applyDraftResult(state: RunState, picks: Partial<Record<DraftSetKey, string>>): RunState {
  if (state.status !== 'drafting') {
    throw new Error(`applyDraftResult: run is not drafting (status "${state.status}")`);
  }
  const pieces: RunBoardPiece[] = [];
  let cursor = 0;
  let nextId = state.nextCardInstanceId;
  for (const key of DRAFT_SET_KEYS) {
    const skillId = picks[key];
    if (!skillId) continue;
    const size = Math.max(1, skillBook[skillId]?.size ?? 1);
    if (cursor + size > RUN_BOARD_SLOTS) continue;
    const instanceId = `card_${String(nextId).padStart(3, '0')}`;
    nextId += 1;
    pieces.push({ instanceId, skillId, tier: 'bronze', slot: cursor });
    cursor += size;
  }
  return {
    ...state,
    status: 'active',
    pieces,
    bagSlots: [],
    gold: 0,
    nextCardInstanceId: nextId,
  };
}

/**
 * The 2-3 nodes the player may pick next: the column at `state.depth + 1`.
 * Empty once the run has ended (`'victory'`/`'defeat'`), while a node is
 * still being resolved (`currentNodeId` set), or before the draft is applied.
 */
export function availableChoices(state: RunState): readonly RunNode[] {
  if (state.status !== 'active') return [];
  if (state.currentNodeId !== null) return [];
  return columnAt(state.map, state.depth + 1);
}

/**
 * Commit to one of `availableChoices(state)`. Moves the run's position to
 * that node's depth and marks it `currentNodeId` — "occupied", so
 * `availableChoices` returns none until the node is left: fight/elite/boss
 * nodes resolve via `recordBattleResult`, shop nodes via `leaveShop`. Throws
 * if `nodeId` isn't one of the currently available choices.
 */
export function chooseNode(state: RunState, nodeId: string): RunState {
  const choices = availableChoices(state);
  const node = choices.find((n) => n.id === nodeId);
  if (!node) {
    throw new Error(`chooseNode: "${nodeId}" is not an available choice`);
  }
  return {
    ...state,
    depth: node.depth,
    currentNodeId: node.id,
  };
}

/**
 * Resolve a fight/boss node's enemy encounter via the EXISTING dial resolver
 * (`buildEnemyEncounter` in encounter.ts): level + title both come from
 * `FIGHT_TABLE[node.fightNumber]` (fights 1-2 normal, 3-4 elite, 5 boss).
 * Deterministic from the node's `encounterSeed` (repeated calls for the same
 * node return the identical encounter). Throws if the current node isn't a
 * combat node (e.g. mid-shop, mid-event, or idle).
 */
export function rollEncounter(state: RunState): EncounterUnit {
  const node = state.currentNodeId ? findNode(state.map, state.currentNodeId) : undefined;
  if (!node) {
    throw new Error('rollEncounter: no combat node is currently active');
  }
  if (node.kind !== 'fight' && node.kind !== 'boss') {
    throw new Error(`rollEncounter: node "${node.id}" (kind "${node.kind}") is not a combat node`);
  }
  const rng = new Rng(node.encounterSeed!);
  const pool = node.kind === 'boss' ? BOSS_POOL : FIGHT_POOL;
  if (pool.length === 0) {
    throw new Error(`rollEncounter: no enemies available for node kind "${node.kind}"`);
  }
  const enemyId = pool[rng.int(pool.length)]!;
  const entry = fightTableEntry(node.fightNumber!);
  return buildEnemyEncounter(enemyId, entry.level, entry.title);
}

export interface BattleOutcome {
  won: boolean;
  goldEarned: number;
}

/**
 * Settle a resolved fight/boss node: on a win, credits `goldEarned` and
 * increments `wins`; on a loss, increments `losses` and credits NO gold
 * (Bazaar rule: losing pays nothing, but the run continues). Either way the
 * hero gains **+1 heroLevel** (locked design, 2026-07-29: the hero levels
 * after EVERY fight, win or lose — losses sting through gold only, keeping
 * the hero in lockstep with `FIGHT_TABLE`'s enemy level for the next fight).
 * A boss node resolves the whole run: win -> `'victory'`, loss -> `'defeat'`.
 * Any other node loss leaves `status: 'active'` — the run continues. Clears
 * `currentNodeId` either way. Throws if the current node isn't a combat node.
 */
export function recordBattleResult(state: RunState, outcome: BattleOutcome): RunState {
  const node = state.currentNodeId ? findNode(state.map, state.currentNodeId) : undefined;
  if (!node) {
    throw new Error('recordBattleResult: no combat node is currently active');
  }
  if (node.kind !== 'fight' && node.kind !== 'boss') {
    throw new Error(`recordBattleResult: node "${node.id}" (kind "${node.kind}") is not a combat node`);
  }
  const isBoss = node.kind === 'boss';
  const status: RunStatus = isBoss ? (outcome.won ? 'victory' : 'defeat') : 'active';
  return {
    ...state,
    status,
    currentNodeId: null,
    gold: state.gold + (outcome.won ? Math.max(0, Math.floor(outcome.goldEarned)) : 0),
    wins: state.wins + (outcome.won ? 1 : 0),
    losses: state.losses + (outcome.won ? 0 : 1),
    heroLevel: state.heroLevel + 1,
  };
}

/**
 * The shop node currently occupied, or undefined if the current node isn't a
 * shop. Read `node.shopId` / `node.shopSeed` off the result to call
 * `rollShopStock(shopId, shopSeed)` (src/run/shop.ts) — shop stocking/
 * purchasing logic lives there and is not duplicated here.
 */
export function currentShopNode(state: RunState): RunNode | undefined {
  const node = state.currentNodeId ? findNode(state.map, state.currentNodeId) : undefined;
  return node?.kind === 'shop' ? node : undefined;
}

/**
 * Leave a shop node with no win/loss to resolve — just clears `currentNodeId`
 * so the next `availableChoices` surfaces the following depth's column.
 * Throws if the current node isn't a shop (fight/elite/boss resolve via
 * `recordBattleResult` instead).
 */
export function leaveShop(state: RunState): RunState {
  const node = state.currentNodeId ? findNode(state.map, state.currentNodeId) : undefined;
  if (!node || node.kind !== 'shop') {
    throw new Error('leaveShop: no shop node is currently active');
  }
  return { ...state, currentNodeId: null };
}

/**
 * The event node currently occupied, or undefined if the current node isn't
 * an event. Read `node.eventSeed` off the result to call
 * `rollEventForNode`/`resolveEventChoice` (src/run/events.ts) — event
 * drawing/resolution logic lives there and is not duplicated here.
 */
export function currentEventNode(state: RunState): RunNode | undefined {
  const node = state.currentNodeId ? findNode(state.map, state.currentNodeId) : undefined;
  return node?.kind === 'event' ? node : undefined;
}

/**
 * Leave an event node with its choice already resolved — just clears
 * `currentNodeId` so the next `availableChoices` surfaces the following
 * column. Throws if the current node isn't an event (UI-phase replaceable:
 * today's map scenes call this immediately after `rollEventForNode` with no
 * choice UI yet — see `src/game/runStore.ts`).
 */
export function leaveEvent(state: RunState): RunState {
  const node = state.currentNodeId ? findNode(state.map, state.currentNodeId) : undefined;
  if (!node || node.kind !== 'event') {
    throw new Error('leaveEvent: no event node is currently active');
  }
  return { ...state, currentNodeId: null };
}

// ---------------------------------------------------------------------------
// Shop-node purchases — pure state transitions mirroring what
// `src/game/shopActions.ts` does to `demoState`, kept here so `src/run` never
// depends on `src/game`. Keyed by node id (not shopId) via `state.shopShelves`.
// ---------------------------------------------------------------------------

/** Roll a shop node's shelf into `state.shopShelves` the first time it's
 * browsed this run (idempotent — a no-op if it already has a shelf). Throws
 * if `nodeId` isn't a shop node. */
export function ensureRunShopShelf(state: RunState, nodeId: string): RunState {
  if (state.shopShelves[nodeId]) return state;
  const node = findNode(state.map, nodeId);
  if (!node || node.kind !== 'shop' || !node.shopId || node.shopSeed === undefined) {
    throw new Error(`ensureRunShopShelf: "${nodeId}" is not a shop node`);
  }
  const rolled = rollShopStock(node.shopId, node.shopSeed, shopStockDepthForWave(node.wave));
  const shelf: RunShopShelf = { cards: [...rolled.cards], gems: [...rolled.gems], rerollCount: 0 };
  return { ...state, shopShelves: { ...state.shopShelves, [nodeId]: shelf } };
}

/** REROLL: costs 1 gold, deals a brand-new shelf from the next seed offset
 * (same `shopSeed + rerollCount` sequence `rollShopStock` uses everywhere).
 * No-op if the wallet can't afford it. Throws if `nodeId` isn't a shop node. */
export function rerollRunShop(state: RunState, nodeId: string): RunState {
  const node = findNode(state.map, nodeId);
  if (!node || node.kind !== 'shop' || !node.shopId || node.shopSeed === undefined) {
    throw new Error(`rerollRunShop: "${nodeId}" is not a shop node`);
  }
  if (state.gold < 1) return state;
  const nextCount = (state.shopShelves[nodeId]?.rerollCount ?? 0) + 1;
  const rolled = rollShopStock(node.shopId, node.shopSeed + nextCount, shopStockDepthForWave(node.wave));
  const shelf: RunShopShelf = { cards: [...rolled.cards], gems: [...rolled.gems], rerollCount: nextCount };
  return { ...state, gold: state.gold - 1, shopShelves: { ...state.shopShelves, [nodeId]: shelf } };
}

function runBagOccupied(state: RunState): boolean[] {
  const occ = Array<boolean>(RUN_BOARD_SLOTS).fill(false);
  state.bagSlots.forEach((card, index) => {
    if (!card) return;
    const size = Math.max(1, skillBook[card.skillId]?.size ?? 1);
    for (let i = index; i < index + size && i < RUN_BOARD_SLOTS; i++) occ[i] = true;
  });
  return occ;
}

function runNearestFit(occ: boolean[], size: number, prefer: number): number {
  const fits: number[] = [];
  for (let i = 0; i + size <= RUN_BOARD_SLOTS; i++) {
    let ok = true;
    for (let j = i; j < i + size; j++) if (occ[j]) { ok = false; break; }
    if (ok) fits.push(i);
  }
  if (fits.length === 0) return -1;
  return fits.reduce((best, s) => (Math.abs(s - prefer) < Math.abs(best - prefer) ? s : best), fits[0]!);
}

/** Whether the run's bag currently has room for a card of this skill. */
export function runBagHasRoomFor(state: RunState, skillId: string): boolean {
  const size = Math.max(1, skillBook[skillId]?.size ?? 1);
  return runNearestFit(runBagOccupied(state), size, 0) >= 0;
}

/**
 * Inserts a fresh owned card into the run bag's nearest-fit open slot (the
 * SAME placement idiom `buyRunCard` uses). Shared by shop purchases AND
 * event `grantCard`/`bonusDraft` grants (src/run/events.ts) so there is only
 * ONE nearest-fit bag-insert implementation. Returns `null` (no state change)
 * if the bag has no room for a card of this size — callers decide the
 * fallback (shop purchases fail cleanly; events fall back to gold).
 */
export function tryInsertRunCard(
  state: RunState,
  skillId: string,
  tier: SkillTier,
): { state: RunState; instanceId: string } | null {
  const size = Math.max(1, skillBook[skillId]?.size ?? 1);
  const fit = runNearestFit(runBagOccupied(state), size, 0);
  if (fit < 0) return null;
  const instanceId = `card_${String(state.nextCardInstanceId).padStart(3, '0')}`;
  const bagSlots = [...state.bagSlots];
  bagSlots[fit] = { instanceId, skillId, tier };
  const nextState: RunState = { ...state, bagSlots, nextCardInstanceId: state.nextCardInstanceId + 1 };
  return { state: nextState, instanceId };
}

export type RunBuyResult =
  | { ok: true; state: RunState }
  | { ok: false; reason: 'gold' | 'bag' | 'gone'; state: RunState };

/** Buys the card offer at `index` on `nodeId`'s current shelf: deducts gold,
 * inserts a fresh owned card into the nearest-fit open bag slot, and removes
 * the offer from the shelf. Fails cleanly (no charge) if the wallet can't
 * afford it or the bag has no room. */
export function buyRunCard(state: RunState, nodeId: string, index: number): RunBuyResult {
  const shelf = state.shopShelves[nodeId];
  const offer = shelf?.cards[index];
  if (!shelf || !offer) return { ok: false, reason: 'gone', state };
  if (state.gold < offer.price) return { ok: false, reason: 'gold', state };
  const inserted = tryInsertRunCard(state, offer.skillId, offer.tier);
  if (!inserted) return { ok: false, reason: 'bag', state };
  const nextShelf: RunShopShelf = { ...shelf, cards: shelf.cards.filter((_, i) => i !== index) };
  const nextState: RunState = {
    ...inserted.state,
    gold: inserted.state.gold - offer.price,
    shopShelves: { ...inserted.state.shopShelves, [nodeId]: nextShelf },
  };
  return { ok: true, state: nextState };
}

/** Buys the gem offer at `index` on `nodeId`'s current shelf: deducts gold,
 * adds it to the (uncapped) gem pouch, and removes the offer from the shelf. */
export function buyRunGem(state: RunState, nodeId: string, index: number): RunBuyResult {
  const shelf = state.shopShelves[nodeId];
  const offer = shelf?.gems[index];
  if (!shelf || !offer) return { ok: false, reason: 'gone', state };
  if (state.gold < offer.price) return { ok: false, reason: 'gold', state };
  const nextShelf: RunShopShelf = { ...shelf, gems: shelf.gems.filter((_, i) => i !== index) };
  const nextState: RunState = {
    ...state,
    gold: state.gold - offer.price,
    gemInventory: [...state.gemInventory, offer.gemId],
    shopShelves: { ...state.shopShelves, [nodeId]: nextShelf },
  };
  return { ok: true, state: nextState };
}

// ---------------------------------------------------------------------------
// Hero PL-budget stat allocation — the run never auto-spends a level's 3 PL;
// the player buys stat points by hand, ANY time between fights (locked
// design, see docs/release-game-plan.md "Hero leveling & stat allocation").
//
// `setHeroAllocation` is the confirm-time entry point: the UI drives a SCRATCH
// `Allocation` locally (add AND subtract buys via +/- however it likes,
// pricing it live with `heroAllocationCost`) and calls this ONCE to commit.
// A confirm may lower a stat back toward zero relative to the run's LAST
// CONFIRMED allocation — there is no "can't un-spend below a previous
// confirm" floor (locked design, 2026-07-29: free add/subtract until confirm,
// any time between fights — this supersedes the older "additive-only, no
// respec in v1" line in docs/release-game-plan.md, updated to match).
// `buyHeroStatAllocation` (the old additive-only "+1 buy" entry point some
// callers still use) is now implemented in terms of `setHeroAllocation`, so
// there is exactly one validation path for the whole economy.
// ---------------------------------------------------------------------------

/** PL a (possibly scratch, uncommitted) allocation would spend — the pure
 * pricing function the stat panel calls on every +/- click to show PL SPENT
 * live, without touching `RunState`. Thin wrapper over `leveling.ts#spentPL`
 * so `src/run/runState.ts` stays the one place callers import the run's
 * allocation API from. */
export function heroAllocationCost(alloc: Allocation): number {
  return spentPL(alloc);
}

/**
 * Commit a whole SCRATCH `Allocation` (replaces `state.heroAllocation`
 * entirely — not a delta/buy like `buyHeroStatAllocation`). Validates `next`
 * against the run's total earned PL (`totalLevelPL(heroLevel)`, via
 * `leveling.ts#canAfford`) and rejects — returning the SAME `state` reference,
 * a no-op, NOT a throw (mirrors `buyHeroStatAllocation`'s existing idiom, so
 * the UI never needs a pre-check either) — if:
 *   - `next` spends more PL than the run has banked at `state.heroLevel`, or
 *   - any stat's buy count in `next` is negative (a scratch edit may go DOWN
 *     to 0, but a stat can never bank negative buys).
 * Otherwise returns a new `RunState` with `heroAllocation` replaced by `next`
 * wholesale (stats not present in `next` are treated as 0, same as
 * `Allocation`'s existing `Partial<Record<...>>` semantics elsewhere).
 */
export function setHeroAllocation(state: RunState, next: Allocation): RunState {
  for (const stat of Object.keys(next) as LevelStat[]) {
    if ((next[stat] ?? 0) < 0) return state;
  }
  if (!canAfford(state.heroLevel, next)) return state;
  return { ...state, heroAllocation: { ...next } };
}

/** Spend one buy of `stat` from the run's banked PL (see `LEVEL_STAT_COST`).
 * Pure — returns a NEW `RunState`, or the SAME `state` reference if the run
 * can't afford it (a no-op, not a throw — the UI just leaves the `+` button
 * looking unaffordable rather than needing a pre-check). Implemented as a
 * `+1` scratch edit through `setHeroAllocation`. */
export function buyHeroStatAllocation(state: RunState, stat: LevelStat): RunState {
  const next: Allocation = { ...state.heroAllocation, [stat]: (state.heroAllocation[stat] ?? 0) + 1 };
  return setHeroAllocation(state, next);
}

export { WAVE_COUNT };
export type { RunMap, RunNode, RunNodeKind };
