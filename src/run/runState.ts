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
import {
  buildEnemyEncounter,
  capPackTitle,
  ENEMY_MODIFIER_IDS,
  MIN_PACK_FIGHT_NUMBER,
  PACK_SIZE,
  PACK_VARIANT_WEIGHTS,
  resolvePackMemberLevel,
  TITLE_PRESETS,
  type EncounterPack,
  type EncounterUnit,
  type EnemyTitle,
  type PackVariant,
} from './encounter';
import { canAfford, spentPL, type Allocation, type LevelStat } from './leveling';
import type { EventTheme } from '../data/events';
import {
  BOSS_EVERY,
  ensureDepthThrough,
  generateRunMap,
  WAVE_COUNT,
  type RunMap,
  type RunNode,
  type RunNodeKind,
} from './runMap';
import { Rng } from '../engine/rng';
import {
  findMergeTarget,
  rollShopStock,
  sellPriceOfCard,
  sellPriceOfGem,
  type CardOffer,
  type GemOffer,
  type MergeTarget,
} from './shop';
import { bagAsBoardPieces, canPlace } from './loadout';

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

/**
 * `'victory'` is a LEGACY member — USER-LOCKED (2026-07-30): the run is
 * endless now, so nothing ever sets `'victory'` any more (a run only ends via
 * `'defeat'` at 0 lives, or `'retired'` when the player voluntarily stops).
 * Kept in the union purely so `src/game`'s existing `status === 'victory'`
 * branches keep compiling; do not remove it, and do not make anything set it.
 */
export type RunStatus = 'drafting' | 'active' | 'victory' | 'defeat' | 'retired';

/**
 * Per-run stats ledger — additive counters NOT already tracked elsewhere on
 * `RunState` (wins/losses/bossesCleared/lives/heroLevel stay the single
 * source of truth for those; a stats-screen selector merges them in, see
 * `runStatsSummary`). Every field is a non-negative integer, updated by the
 * SAME transitions that already mutate the counterpart field they ride
 * along with (chooseNode/recordBattleResult/shop buys/event resolution) —
 * no separate "stats pass". Pure data: no functions, no class instances.
 */
export interface RunStats {
  /** Gross HP the hero's cards removed from foes, across all fights (from `BattleLog` damage events, side `'enemy'`). */
  damageDealt: number;
  /** Gross HP the hero's side lost, across all fights (side `'player'` damage events). */
  damageTaken: number;
  /** Effective (post-overheal) HP the hero's side restored, across all fights. */
  healingDone: number;
  /** Total gold credited (daily income + fight payouts + event grants). */
  goldEarned: number;
  /** Total gold deducted (card/gem buys, shop rerolls, event costs/losses). */
  goldSpent: number;
  /** Card offers bought from a shop shelf. */
  cardsBought: number;
  /** Gem offers bought from a shop shelf. */
  gemsBought: number;
  /** Event choices resolved (`resolveEventChoice` calls), one per event visited. */
  eventsResolved: number;
  /** Highest wave number (`RunNode.wave`) the run has committed to via `chooseNode`. */
  deepestWave: number;
  /** Lives lost to fight/boss losses (mirrors `LIVES_PER_RUN - lives`, tracked directly so it survives even if `lives` regains a future refill mechanic). */
  livesLost: number;
}

/** A fresh run's all-zero stats ledger. */
export function emptyRunStats(): RunStats {
  return {
    damageDealt: 0,
    damageTaken: 0,
    healingDone: 0,
    goldEarned: 0,
    goldSpent: 0,
    cardsBought: 0,
    gemsBought: 0,
    eventsResolved: 0,
    deepestWave: 0,
    livesLost: 0,
  };
}

export interface RunState {
  seed: number;
  map: RunMap;
  status: RunStatus;
  /** Deepest depth the player has fully resolved into (0 = pre-draft, at the map root). */
  depth: number;
  /** Lives remaining — USER-LOCKED (2026-07-30): the run never ends at a
   * boss; it's endless, ending only at 0 lives (`'defeat'`) or a voluntary
   * `retireRun` (`'retired'`). EVERY fight loss (including a boss loss) costs
   * exactly one life; wins never cost a life. Starts at `LIVES_PER_RUN`. */
  lives: number;
  /** How many milestone boss fights (every `BOSS_EVERY`th fight) this run has
   * WON — the run's score/bragging number ("I beat 3 bosses"). Never
   * decreases; increments only on a boss win (see `recordBattleResult`). */
  bossesCleared: number;
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
  /** Additive stats ledger — see `RunStats`. */
  stats: RunStats;
}

/** Board width for the run's deck rail — same as the sandbox hero board. */
const RUN_BOARD_SLOTS = HERO_BOARD_SLOTS;

/**
 * Basic daily income — USER-LOCKED (2026-07-30): "there should be a basic
 * income +1 so everyday you earn 1 gold unless its a fight which nets you 2
 * total on that day." A "day" is every node the player commits to
 * (`chooseNode`) — event, shop, fight, or boss all count. Exported as a knob
 * so balance-designer can retune the run's pacing without touching the
 * award site. Awarded exactly once per node (see `chooseNode`): a node can
 * only ever be the argument to `chooseNode` once per run (it must first be
 * in `availableChoices`, which goes empty the instant `currentNodeId` is set
 * and only advances past that node once it's resolved), so there is no
 * separate "already granted" bookkeeping to maintain. A fight day therefore
 * pays this +1 PLUS the fight's own `battleGoldReward.base` (1) on a win —
 * 2 gold minimum — with the difficulty-scaled win bonus stacking on top; a
 * loss still earns this day's +1 even though `recordBattleResult` credits 0
 * fight gold on a loss (no longer literally zero income on a loss).
 */
export const DAILY_INCOME = 1;

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
 * HERO level cap — USER-LOCKED (2026-07-30): "Uncap the ENEMY level; keep the
 * HERO capped at 30." `MAX_LEVEL` now governs ONLY the hero (`recordBattleResult`'s
 * +1-per-fight level-up, and the `grantLevel` event outcome) — the hero's RPG
 * level ceiling the user asked for. The enemy's level (`FightSpec.level`,
 * below) is NOT clamped to this any more: it tracks the fight number 1:1,
 * forever, so the hero-vs-enemy gap widens by design past fight `MAX_LEVEL`
 * — `bossesCleared` becomes the run's real high-score axis. Exported so
 * balance-designer can retune it.
 */
export const MAX_LEVEL = 30;

/**
 * fightNumber -> {level, title, modifiers} for `rollEncounter` — the run's
 * ENDLESS fight-spec resolver (USER-LOCKED 2026-07-30, replaces the old fixed
 * 5-entry `FIGHT_TABLE`). Every dial is a PURE function of the 1-indexed
 * fight number, no RNG:
 *   - `title` repeats the original 5-fight cadence forever: within each block
 *     of `BOSS_EVERY` (5) fights, positions 1-2 are `'normal'`, 3-4 `'elite'`,
 *     5 `'boss'` (so fights 6,7 normal · 8,9 elite · 10 boss, etc.).
 *   - `level` matches `fightNumber` 1:1 with NO upper bound — this is the
 *     "uncap the enemy" fix (2026-07-30): the OLD resolver capped `level` at
 *     `MAX_LEVEL` and tried to keep difficulty growing via a `rankBonus` ramp
 *     stacked on top of the title's own `TITLE_PRESETS` rank, but a `diamond`
 *     modifier (see below) FORCES every card's tier (and therefore the
 *     resolved rank) to the deck's ceiling regardless of `rankBonus`
 *     (`buildEnemyEncounter`'s `forceTier` branch), so the rank axis went
 *     dead the moment `diamond` first appeared (~fight 35) — everything past
 *     that point silently plateaued except duplicate `swift` stacking. There
 *     is no rank dial here any more: the title alone supplies rank
 *     (`TITLE_PRESETS[title].rank`), and `level` — now genuinely unbounded —
 *     does all the escalation work via the existing priced stat economy
 *     (`scaleMonsterToLevel`/`allocateMonsterPL`).
 *   - `modifiers`: a deep-run flavour axis layered on top of level/title,
 *     each DISTINCT `MODIFIER_PRESETS` id applied AT MOST ONCE per encounter
 *     (no more duplicate entries — `battleGoldReward` counts
 *     `modifiers.length`, so a repeat used to silently inflate the difficulty
 *     score/gold for free). One additional distinct modifier id unlocks every
 *     `MODIFIER_PER_OVERFLOW_FIGHTS` fights past `MAX_LEVEL`, capped at
 *     `ENEMY_MODIFIER_IDS.length` (once every preset is active, this axis
 *     plateaus by design — `level` keeps climbing forever regardless).
 */
export interface FightSpec {
  level: number;
  title: EnemyTitle;
  /** Distinct modifier ids layered on top of the encounter (never repeats — see above). */
  modifiers: string[];
}

/** Legacy alias — some call sites/tests still spell this `FightTableEntry`;
 * it is exactly `FightSpec` (the type was renamed when the fixed 5-entry
 * table became an endless resolver, but the shape/fields are unchanged for
 * `level`/`title` callers). */
export type FightTableEntry = FightSpec;

/** How many extra fights past `MAX_LEVEL` it takes to unlock one more DISTINCT
 * modifier (see `FightSpec.modifiers`); capped at `ENEMY_MODIFIER_IDS.length`
 * so this axis never repeats an id. */
const MODIFIER_PER_OVERFLOW_FIGHTS = 5;

/** The full fight-spec for a 1-indexed fight number (>= 1; endless — no upper bound). */
export function fightSpecFor(fightNumber: number): FightSpec {
  const n = Math.max(1, Math.floor(fightNumber));
  const pos = ((n - 1) % BOSS_EVERY) + 1; // 1..BOSS_EVERY position within the repeating cadence block
  const title: EnemyTitle = pos <= 2 ? 'normal' : pos <= 4 ? 'elite' : 'boss';
  const level = n; // uncapped — the fix: enemy level tracks the fight number forever.
  const overflow = Math.max(0, n - MAX_LEVEL);
  const modifierCount = Math.min(ENEMY_MODIFIER_IDS.length, Math.floor(overflow / MODIFIER_PER_OVERFLOW_FIGHTS));
  const modifiers: string[] = ENEMY_MODIFIER_IDS.slice(0, modifierCount);
  return { level, title, modifiers };
}

/** `fightSpecFor` for a 1-indexed fight number — kept as a same-named alias of
 * `fightSpecFor` (thin `FIGHT_TABLE`-shaped call site) so existing callers
 * reading "the table entry for fight n" don't need to rename. */
export function fightTableEntry(fightNumber: number): FightSpec {
  return fightSpecFor(fightNumber);
}

/** One-rung title bump for a fight column's `'hard'` option (normal -> elite,
 * elite -> boss) — USER-LOCKED (2026-07-30): "Bump the title one rung...
 * reuse the existing title presets/level dials." `mob` input is a defensive
 * fallback only; the fight-spec resolver never assigns it to a fight node.
 * `boss -> boss` is also defensive: boss WAVES are single-node (no
 * `fightOption`), so `fightTableEntryForNode` never bumps a `'boss'` base
 * title in practice — this only matters if a future caller ever did. */
const TITLE_BUMP: Record<EnemyTitle, EnemyTitle> = {
  mob: 'normal',
  normal: 'elite',
  elite: 'boss',
  boss: 'boss',
};

/** Title rank order for `EASY_TITLE_CAP` (mob < normal < elite < boss) —
 * mirrors `TITLE_WEIGHT` in `shop.ts` but kept local since this module only
 * needs it for the one comparison below. */
const TITLE_RANK: Record<EnemyTitle, number> = { mob: 0, normal: 1, elite: 2, boss: 3 };

/** Caps a fight column's `'easy'` option at `'normal'` — USER-DIRECTED
 * (2026-08-04): "title capped at normal (never elite)". A fight node's base
 * title is always `'normal'` or `'elite'` (see `fightSpecFor`'s cadence —
 * `'mob'`/`'boss'` never reach a fight column), so in practice this only ever
 * downgrades `'elite'` to `'normal'`; the general (rank-based) form is kept
 * so a future caller passing a `'boss'`-titled base (shouldn't happen for a
 * fight node) still caps sanely instead of silently no-op'ing. */
function capTitleAtNormal(title: EnemyTitle): EnemyTitle {
  return TITLE_RANK[title] > TITLE_RANK.normal ? 'normal' : title;
}

/**
 * Fight-spec for a fight/boss NODE, honoring its `fightOption` (see
 * `RunNode.fightOption` in runMap.ts) — THREE risk options on every non-boss
 * fight column (USER-DIRECTED 2026-08-04, supersedes the 2026-07-30
 * two-option "standard/hard" rule):
 *   - `'hard'` bumps the title one rung via `TITLE_BUMP` and adds **+1
 *     level** (uncapped — the enemy level no longer has a ceiling, see
 *     `fightSpecFor`) over the node's base spec.
 *   - `'easy'` is the MIRROR of `'hard'`: **−1 level** (floored at 1 via
 *     `fightSpecFor`'s own `clampLevel`-equivalent `Math.max(1, ...)`) and
 *     the title capped at `'normal'` via `capTitleAtNormal` (never
 *     `'elite'`) — strictly less threat than `'standard'`.
 *   - `'standard'`/undefined (boss nodes) returns `fightSpecFor(node.fightNumber)`
 *     byte-identically — UNCHANGED from before three-tier existed.
 * Every branch carries `modifiers` through UNCHANGED (those come from the
 * fight number alone, not the risk option). The one place `rollEncounter`
 * reads a node's level/title/modifiers from, so every caller (preview +
 * committed) stays in lockstep automatically — including the PL-budgeted
 * pack solve (`resolvePackMemberLevel` in `encounter.ts`), which reads
 * `entry.level`/`entry.title` off THIS function's output and therefore
 * automatically solves an easy pack from the easy solo cost, a hard pack
 * from the hard solo cost, with no per-tier branch of its own.
 */
export function fightTableEntryForNode(node: Pick<RunNode, 'fightNumber' | 'fightOption'>): FightSpec {
  const base = fightSpecFor(node.fightNumber!);
  if (node.fightOption === 'hard') {
    return { ...base, level: base.level + 1, title: TITLE_BUMP[base.title] };
  }
  if (node.fightOption === 'easy') {
    return { ...base, level: Math.max(1, base.level - 1), title: capTitleAtNormal(base.title) };
  }
  return base;
}

/**
 * Wave -> representative shop-stock depth band, feeding `rollShopStock`'s
 * bronze/silver/gold split (`tierThresholds` in shop.ts): wave 1's stops use
 * depth 2 (the 1-3 "early" band), waves 2-3 use depth 5 (the 4-6 "mid" band),
 * wave 4+ uses depth 8 (the 7-9 "deep" band, and stays there forever — the
 * run is endless, so there is no longer a fixed "last" band to reserve) — a
 * run's shop shelves get progressively less bronze-heavy as its fights get
 * harder, then plateau at the deepest band once the run runs long enough.
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

/** Starting/only lives for a run — USER-LOCKED (2026-07-30): "Lives: 3 per
 * run... EVERY fight loss costs one life — including a boss loss." At 0
 * lives the run's status becomes `'defeat'` (see `recordBattleResult`). */
export const LIVES_PER_RUN = 3;

/**
 * Start a brand-new run: rolls the seeded map (eagerly through
 * `INITIAL_WAVES` waves), empties the deck/bag/gems, zeroes gold/wins/
 * losses/bossesCleared, `LIVES_PER_RUN` lives, hero level 1, status
 * `'drafting'` (call `applyDraftResult` to install the starting board and
 * move to `'active'`). Position sits at depth 0 (the map root) —
 * `availableChoices` will surface the depth-1 column once drafting is done.
 */
export function createRun(seed: number): RunState {
  return {
    seed,
    map: generateRunMap(seed),
    status: 'drafting',
    depth: 0,
    lives: LIVES_PER_RUN,
    bossesCleared: 0,
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
    stats: emptyRunStats(),
  };
}

/**
 * Install the 4 drafted cards (one pick per `DRAFT_SET_KEYS` set) as the
 * starting board, packed left-to-right in `DRAFT_SET_KEYS` order (same
 * placement idiom as `src/game/draftActions.ts#applyDraftPicks`, kept
 * independently here so `src/run` never imports from `src/game`). Only valid
 * while `status === 'drafting'`; transitions to `'active'` on success.
 *
 * The board is only guaranteed to fit the SMALLEST four picks — the catalog
 * has size-3 bronze skills in offense/defense/wildcard, so a pick set can sum
 * past `RUN_BOARD_SLOTS` (e.g. 3+3+2+3 = 11 > 10) and no packing order fits
 * all four on the board. The player never loses a picked card for that: a
 * pick that would overflow the board is instead placed in the bag (nearest
 * fit from slot 0, the same idiom `tryInsertRunCard` uses for shop buys/event
 * grants) — still owned, just not pre-equipped. Board packing for picks that
 * DO fit is unchanged (left-to-right, `DRAFT_SET_KEYS` order), so any draft
 * that already fit today produces a byte-identical board.
 */
export function applyDraftResult(state: RunState, picks: Partial<Record<DraftSetKey, string>>): RunState {
  if (state.status !== 'drafting') {
    throw new Error(`applyDraftResult: run is not drafting (status "${state.status}")`);
  }
  const pieces: RunBoardPiece[] = [];
  const bagSlots: RunBagSlot[] = [];
  let cursor = 0;
  let nextId = state.nextCardInstanceId;
  for (const key of DRAFT_SET_KEYS) {
    const skillId = picks[key];
    if (!skillId) continue;
    const size = Math.max(1, skillBook[skillId]?.size ?? 1);
    const instanceId = `card_${String(nextId).padStart(3, '0')}`;
    nextId += 1;
    if (cursor + size <= RUN_BOARD_SLOTS) {
      pieces.push({ instanceId, skillId, tier: 'bronze', slot: cursor });
      cursor += size;
      continue;
    }
    const fit = runNearestFit(bagOccupiedFrom(bagSlots), size, 0);
    if (fit < 0) {
      // Unreachable for the current catalog (4 picks, largest bronze size 3,
      // bag width == board width == RUN_BOARD_SLOTS, bag starts empty), but
      // guarded rather than silently dropping the pick.
      throw new Error(`applyDraftResult: no room on board or in bag for drafted pick "${skillId}"`);
    }
    bagSlots[fit] = { instanceId, skillId, tier: 'bronze' };
  }
  return {
    ...state,
    status: 'active',
    pieces,
    bagSlots,
    gold: 0,
    nextCardInstanceId: nextId,
  };
}

/**
 * The 2-3 nodes the player may pick next: the column at `state.depth + 1`.
 * Empty once the run has ended (`'defeat'`/`'retired'`), while a node is
 * still being resolved (`currentNodeId` set), or before the draft is applied.
 * Lazily extends a (throwaway, unpersisted) copy of the map far enough to
 * cover `state.depth + 1` if it isn't already generated that far — see
 * `ensureDepthThrough` in runMap.ts — so this never returns an empty column
 * just because generation hasn't caught up yet. The persisted `state.map`
 * itself only grows via `chooseNode` (see below), which is fine: this
 * extension is a pure, cheap, fully-reproducible recompute either way.
 */
export function availableChoices(state: RunState): readonly RunNode[] {
  if (state.status !== 'active') return [];
  if (state.currentNodeId !== null) return [];
  const map = ensureDepthThrough(state.map, state.depth + 1);
  return columnAt(map, state.depth + 1);
}

/**
 * Commit to one of `availableChoices(state)`. Moves the run's position to
 * that node's depth and marks it `currentNodeId` — "occupied", so
 * `availableChoices` returns none until the node is left: fight/elite/boss
 * nodes resolve via `recordBattleResult`, shop nodes via `leaveShop`. Throws
 * if `nodeId` isn't one of the currently available choices. Persists the
 * map's growth (via `ensureDepthThrough`) onto the returned state, so the
 * run's map only ever grows as the player actually walks into it — never
 * mutates the PREVIOUS `state.map` value, just returns a state pointing at a
 * (possibly larger) one.
 */
export function chooseNode(state: RunState, nodeId: string): RunState {
  const choices = availableChoices(state);
  const node = choices.find((n) => n.id === nodeId);
  if (!node) {
    throw new Error(`chooseNode: "${nodeId}" is not an available choice`);
  }
  const map = ensureDepthThrough(state.map, node.depth);
  return {
    ...state,
    map,
    depth: node.depth,
    currentNodeId: node.id,
    gold: state.gold + DAILY_INCOME,
    stats: {
      ...state.stats,
      goldEarned: state.stats.goldEarned + DAILY_INCOME,
      deepestWave: Math.max(state.stats.deepestWave, node.wave),
    },
  };
}

/**
 * PACK FIGHTS' variant roll — a single `rng.int(100)` compared against
 * `PACK_VARIANT_WEIGHTS` in fixed (solo, pair, trio) order. Only ever called
 * for non-boss fight nodes (see `rollEncounter`) — this is the ONE Rng draw
 * `rollEncounter` spends on "how many foes", ahead of the per-member enemy-id
 * draws so both stay reproducible from the node's `encounterSeed`.
 */
function rollPackVariant(rng: Rng): PackVariant {
  const roll = rng.int(100);
  if (roll < PACK_VARIANT_WEIGHTS.solo) return 'solo';
  if (roll < PACK_VARIANT_WEIGHTS.solo + PACK_VARIANT_WEIGHTS.pair) return 'pair';
  return 'trio';
}

/**
 * Resolve a fight/boss node's enemy encounter via the EXISTING dial resolver
 * (`buildEnemyEncounter` in encounter.ts): level/title/rank/modifiers all
 * come from `fightTableEntryForNode` (the endless fight-spec resolver — see
 * `fightSpecFor` above). Deterministic from the node's `encounterSeed`
 * (repeated calls for the same node return the identical encounter). Throws
 * if the current node isn't a combat node (e.g. mid-shop, mid-event, or idle).
 *
 * PACK FIGHTS (2026-08-04, re-priced onto PL budgets 2026-08-04): non-boss
 * fight nodes first roll a `PackVariant` (`rollPackVariant`) — BOSS nodes,
 * and any fight node before `MIN_PACK_FIGHT_NUMBER` (the very first fight is
 * ALWAYS solo — see `encounter.ts`'s early-gate doc comment), skip that roll
 * entirely and are always `'solo'`, so those enemy picks stay byte-identical
 * to before packs existed. For a pack roll, `resolvePackMemberLevel`
 * (`encounter.ts`) solves the ONE shared member level whose total pack threat
 * (stat PL + board PL, taxed by `PACK_ACTION_ECONOMY_TAX_PCT` per extra
 * member) lands on the node's solo-equivalent PL budget — see the "BUDGET-
 * DERIVED PACK MEMBERS" block in `encounter.ts` for the full model and
 * worked rationale. If that solve can't even afford level 1 within its
 * share, the roll FALLS BACK TO SOLO (never ships an over-budget pack). Each
 * pack member then rolls its OWN enemy id independently (can repeat) from the
 * SAME node Rng, at the solved level and `capPackTitle(entry.title)`
 * (mob/normal only — no elite/boss packs in v1); a `'hard'` fight-option's +1
 * level still lands on every member via `entry.level` feeding the solve (the
 * title bump is simply capped back down). Rank stays the SAME per-title
 * budget every solo foe uses (`TITLE_PRESETS[title].rank`) — no new budget
 * path, per member.
 */
export function rollEncounter(state: RunState): EncounterPack {
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
  const entry = fightTableEntryForNode(node);
  const gateOpen = node.kind !== 'boss' && (node.fightNumber ?? 0) >= MIN_PACK_FIGHT_NUMBER;
  let variant: PackVariant = gateOpen ? rollPackVariant(rng) : 'solo';

  let memberLevel = entry.level;
  let memberTitle: EnemyTitle = entry.title;
  if (variant !== 'solo') {
    const solvedLevel = resolvePackMemberLevel(entry.level, entry.title, PACK_SIZE[variant], entry.modifiers);
    if (solvedLevel === null) {
      // Budget floor-fallback (encounter.ts#resolvePackMemberLevel): even
      // level 1 would exceed this member's taxed share — ship solo instead.
      variant = 'solo';
    } else {
      memberLevel = solvedLevel;
      memberTitle = capPackTitle(entry.title);
    }
  }
  const size = PACK_SIZE[variant];
  const rank = TITLE_PRESETS[memberTitle].rank;

  const units: EncounterUnit[] = [];
  for (let i = 0; i < size; i++) {
    const enemyId = pool[rng.int(pool.length)]!;
    units.push(buildEnemyEncounter(enemyId, memberLevel, memberTitle, rank, entry.modifiers));
  }
  return { variant, units };
}

export interface BattleOutcome {
  won: boolean;
  goldEarned: number;
  /**
   * Optional stats-ledger deltas folded from the resolved `BattleLog`
   * (see `battleStatsFromEvents` in `logAnalysis.ts`) — the caller (the
   * battle-service client) computes these from the SAME log it already has;
   * `recordBattleResult` never re-derives them. Omitted/defaulted to 0 keeps
   * every existing `{won, goldEarned}` call site (tests, sandbox-shaped
   * callers) byte-identical.
   */
  damageDealt?: number;
  damageTaken?: number;
  healingDone?: number;
}

/**
 * Settle a resolved fight/boss node: on a win, credits `goldEarned` and
 * increments `wins`; on a loss, increments `losses` and credits NO gold
 * (Bazaar rule: losing pays nothing, but the run continues). Either way the
 * hero gains **+1 heroLevel** (win or lose), capped at `MAX_LEVEL` (locked
 * design: the hero levels after EVERY fight, keeping it in lockstep with the
 * fight-spec resolver's enemy level up to the cap).
 *
 * LIVES (USER-LOCKED 2026-07-30): the run is endless — it never ends at a
 * boss any more. EVERY fight loss (including a boss loss) costs exactly one
 * life; wins never cost a life. At 0 lives, `status` becomes `'defeat'`;
 * otherwise the run stays `'active'` regardless of node kind. A boss WIN
 * increments `bossesCleared` (the run's score) and the run simply continues.
 * Clears `currentNodeId` either way. Throws if the current node isn't a
 * combat node.
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
  const won = outcome.won;
  const lives = won ? state.lives : Math.max(0, state.lives - 1);
  const status: RunStatus = lives <= 0 ? 'defeat' : 'active';
  const goldEarned = won ? Math.max(0, Math.floor(outcome.goldEarned)) : 0;
  return {
    ...state,
    status,
    currentNodeId: null,
    lives,
    bossesCleared: state.bossesCleared + (isBoss && won ? 1 : 0),
    gold: state.gold + goldEarned,
    wins: state.wins + (won ? 1 : 0),
    losses: state.losses + (won ? 0 : 1),
    heroLevel: Math.min(MAX_LEVEL, state.heroLevel + 1),
    stats: {
      ...state.stats,
      goldEarned: state.stats.goldEarned + goldEarned,
      damageDealt: state.stats.damageDealt + Math.max(0, Math.floor(outcome.damageDealt ?? 0)),
      damageTaken: state.stats.damageTaken + Math.max(0, Math.floor(outcome.damageTaken ?? 0)),
      healingDone: state.stats.healingDone + Math.max(0, Math.floor(outcome.healingDone ?? 0)),
      livesLost: state.stats.livesLost + (state.lives - lives),
    },
  };
}

/**
 * Voluntarily stop an active run — USER-LOCKED (2026-07-30): "Retire: a pure
 * `retireRun(state)` sets status 'retired' — available any time the run is
 * active." A no-op (returns the SAME `state` reference) if the run isn't
 * `'active'` (e.g. already over, still drafting, or mid-node) — retiring is
 * only meaningful for a run the player is actually in the middle of, and this
 * mirrors the no-op-not-throw idiom the rest of this module uses for
 * "can't do that right now" (`setHeroAllocation`, `rerollRunShop`, etc.).
 * Clears `currentNodeId` so a retired run never looks like it's still
 * mid-node if a caller checks that instead of `status`.
 */
export function retireRun(state: RunState): RunState {
  if (state.status !== 'active') return state;
  return { ...state, status: 'retired', currentNodeId: null };
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
  return {
    ...state,
    gold: state.gold - 1,
    shopShelves: { ...state.shopShelves, [nodeId]: shelf },
    stats: { ...state.stats, goldSpent: state.stats.goldSpent + 1 },
  };
}

function bagOccupiedFrom(bagSlots: readonly RunBagSlot[]): boolean[] {
  const occ = Array<boolean>(RUN_BOARD_SLOTS).fill(false);
  bagSlots.forEach((card, index) => {
    if (!card) return;
    const size = Math.max(1, skillBook[card.skillId]?.size ?? 1);
    for (let i = index; i < index + size && i < RUN_BOARD_SLOTS; i++) occ[i] = true;
  });
  return occ;
}

function runBagOccupied(state: RunState): boolean[] {
  return bagOccupiedFrom(state.bagSlots);
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
    stats: {
      ...inserted.state.stats,
      goldSpent: inserted.state.stats.goldSpent + offer.price,
      cardsBought: inserted.state.stats.cardsBought + 1,
    },
  };
  return { ok: true, state: nextState };
}

/** The merge target a shop offer of `skillId` would upgrade, or `null` if the
 * player owns no mergeable (non-diamond) instance — the pure query the UI
 * calls to decide whether a card's BUY confirm should offer a MERGE choice,
 * and what tier it would produce. Spends no gold, touches no shelf. */
export function runMergeTargetFor(state: RunState, skillId: string): MergeTarget | null {
  return findMergeTarget(skillId, state.pieces, state.bagSlots);
}

export type RunMergeResult =
  | { ok: true; state: RunState; target: MergeTarget }
  | { ok: false; reason: 'gold' | 'no-target' | 'gone'; state: RunState };

/**
 * MERGE: buy the card offer at `index` on `nodeId`'s shelf, but instead of
 * adding a new copy, upgrade the player's existing LOWEST-tier owned instance
 * of that skill one tier (`runMergeTargetFor` — board preferred over bag on a
 * tier tie). Same price as a normal buy, same shelf consumption, same
 * `cardsBought`/`goldSpent` stats bump — a merge IS a purchase (locked
 * design). Only `tier` changes on the merged instance: its `instanceId` and
 * (board pieces only) socketed `gem` are untouched. Fails cleanly (no charge,
 * shelf untouched) if the wallet can't afford it or the player owns no
 * mergeable copy of the offered skill (e.g. every owned copy is already
 * diamond, or the player owns none at all).
 */
export function mergeRunCard(state: RunState, nodeId: string, index: number): RunMergeResult {
  const shelf = state.shopShelves[nodeId];
  const offer = shelf?.cards[index];
  if (!shelf || !offer) return { ok: false, reason: 'gone', state };
  if (state.gold < offer.price) return { ok: false, reason: 'gold', state };
  const target = runMergeTargetFor(state, offer.skillId);
  if (!target) return { ok: false, reason: 'no-target', state };

  const pieces = target.location === 'board'
    ? state.pieces.map((piece, i) => (i === target.index ? { ...piece, tier: target.toTier } : piece))
    : state.pieces;
  const bagSlots = target.location === 'bag'
    ? state.bagSlots.map((card, i) => (i === target.index && card ? { ...card, tier: target.toTier } : card))
    : state.bagSlots;

  const nextShelf: RunShopShelf = { ...shelf, cards: shelf.cards.filter((_, i) => i !== index) };
  return {
    ok: true,
    target,
    state: {
      ...state,
      gold: state.gold - offer.price,
      pieces,
      bagSlots,
      shopShelves: { ...state.shopShelves, [nodeId]: nextShelf },
      stats: {
        ...state.stats,
        goldSpent: state.stats.goldSpent + offer.price,
        cardsBought: state.stats.cardsBought + 1,
      },
    },
  };
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
    stats: {
      ...state.stats,
      goldSpent: state.stats.goldSpent + offer.price,
      gemsBought: state.stats.gemsBought + 1,
    },
  };
  return { ok: true, state: nextState };
}

// ---------------------------------------------------------------------------
// SELLING (2026-08-04) — the reverse of a shop purchase: removes an owned
// board piece / bag card / pouch gem and credits half-price gold
// (`sellPriceOfCard`/`sellPriceOfGem`, src/run/shop.ts). Sold items do NOT
// return to any shop shelf (a shelf's stock and the player's owned
// collection are independent — REROLL pricing/behavior is untouched by
// selling). Purely additive alongside the existing buy/merge functions above
// — no existing function in this file is modified.
// ---------------------------------------------------------------------------

export type RunSellResult =
  | { ok: true; state: RunState; goldReceived: number }
  | { ok: false; reason: 'empty'; state: RunState };

/**
 * SELL the board piece (`location: 'board'`) or bag card (`'bag'`) at
 * `index`: removes it, credits `sellPriceOfCard(tier)` gold (folded into
 * `stats.goldEarned`, the same counter a fight/event gold grant uses), and —
 * board pieces ONLY — returns any socketed gem to `gemInventory` rather than
 * destroying it silently (a bag card can never carry a gem in the current
 * model, so the bag branch never touches `gemInventory`). Fails cleanly with
 * reason `'empty'` (no state change) if `index` is out of range or already
 * empty (a bag `null` slot, or a board index past the end).
 */
export function sellRunCard(state: RunState, location: 'board' | 'bag', index: number): RunSellResult {
  if (location === 'board') {
    const piece = state.pieces[index];
    if (!piece) return { ok: false, reason: 'empty', state };
    const price = sellPriceOfCard(piece.tier);
    const gemInventory = piece.gem ? [...state.gemInventory, piece.gem.id] : state.gemInventory;
    return {
      ok: true,
      goldReceived: price,
      state: {
        ...state,
        pieces: state.pieces.filter((_, i) => i !== index),
        gemInventory,
        gold: state.gold + price,
        stats: { ...state.stats, goldEarned: state.stats.goldEarned + price },
      },
    };
  }
  const card = state.bagSlots[index];
  if (!card) return { ok: false, reason: 'empty', state };
  const price = sellPriceOfCard(card.tier);
  return {
    ok: true,
    goldReceived: price,
    state: {
      ...state,
      // Null out only the card's OWN (leftmost) slot — a size-N card's
      // trailing `null` placeholder(s) already read as free the instant this
      // head slot clears (occupancy is derived by scanning for non-null
      // cards and their skill size, see `runBagOccupied` above), so there is
      // nothing else to clear.
      bagSlots: state.bagSlots.map((c, i) => (i === index ? null : c)),
      gold: state.gold + price,
      stats: { ...state.stats, goldEarned: state.stats.goldEarned + price },
    },
  };
}

export type RunSellGemResult =
  | { ok: true; state: RunState; goldReceived: number }
  | { ok: false; reason: 'empty'; state: RunState };

/** SELL the pouch gem at `pouchIndex`: removes it and credits
 * `sellPriceOfGem` gold (folded into `stats.goldEarned`). Fails cleanly with
 * reason `'empty'` (no state change) if `pouchIndex` is out of range. */
export function sellRunGem(state: RunState, pouchIndex: number): RunSellGemResult {
  const gemId = state.gemInventory[pouchIndex];
  if (!gemId) return { ok: false, reason: 'empty', state };
  const price = sellPriceOfGem(gemId);
  return {
    ok: true,
    goldReceived: price,
    state: {
      ...state,
      gemInventory: state.gemInventory.filter((_, i) => i !== pouchIndex),
      gold: state.gold + price,
      stats: { ...state.stats, goldEarned: state.stats.goldEarned + price },
    },
  };
}

// ---------------------------------------------------------------------------
// BUY-TO-SLOT (2026-08-04) — a variant of `buyRunCard` for the upcoming
// drag-to-deck UI: buys straight into an explicit destination slot instead
// of nearest-fit auto-placement. `buyRunCard`/`mergeRunCard` above are
// UNCHANGED and remain the plain-tap path.
// ---------------------------------------------------------------------------

export type BuyDestination =
  | { where: 'board'; slot: number }
  | { where: 'bag'; slot: number };

export type RunBuyToSlotResult =
  | { ok: true; state: RunState }
  | { ok: false; reason: 'gold' | 'slot' | 'gone'; state: RunState };

/**
 * Buys the card offer at `index` on `nodeId`'s shelf straight into `dest`
 * (an explicit board or bag leftmost slot) instead of `buyRunCard`'s
 * nearest-fit auto-placement. Footprint/occupancy is validated by the SAME
 * `canPlace` overlap check `src/run/loadout.ts` already uses for manual
 * board placement — the bag axis reuses it too via `bagAsBoardPieces` (a
 * throwaway `BoardPiece[]` view of the bag's non-null entries), so there is
 * exactly ONE overlap-check implementation for both axes, never a
 * bag-specific duplicate. Fails cleanly (no charge, shelf untouched) if the
 * wallet can't afford it, the offer is already gone, or the destination slot
 * doesn't fit — out of bounds and "overlaps an existing piece/card" both
 * collapse to `reason: 'slot'` (same as `canPlace` itself: it doesn't
 * distinguish them, and neither does a caller need to). Does NOT offer a
 * MERGE path (mirrors `buyRunCard`, not `mergeRunCard`) — a duplicate
 * purchase through this entry point always adds a new copy.
 */
export function buyRunCardTo(
  state: RunState,
  nodeId: string,
  index: number,
  dest: BuyDestination,
): RunBuyToSlotResult {
  const shelf = state.shopShelves[nodeId];
  const offer = shelf?.cards[index];
  if (!shelf || !offer) return { ok: false, reason: 'gone', state };
  if (state.gold < offer.price) return { ok: false, reason: 'gold', state };

  const instanceId = `card_${String(state.nextCardInstanceId).padStart(3, '0')}`;
  const nextShelf: RunShopShelf = { ...shelf, cards: shelf.cards.filter((_, i) => i !== index) };
  const settle = {
    nextCardInstanceId: state.nextCardInstanceId + 1,
    gold: state.gold - offer.price,
    shopShelves: { ...state.shopShelves, [nodeId]: nextShelf },
    stats: { ...state.stats, goldSpent: state.stats.goldSpent + offer.price, cardsBought: state.stats.cardsBought + 1 },
  };

  if (dest.where === 'board') {
    if (!canPlace(state.pieces, skillBook, offer.skillId, dest.slot, RUN_BOARD_SLOTS)) {
      return { ok: false, reason: 'slot', state };
    }
    const pieces: RunBoardPiece[] = [
      ...state.pieces,
      { instanceId, skillId: offer.skillId, tier: offer.tier, slot: dest.slot },
    ];
    return { ok: true, state: { ...state, ...settle, pieces } };
  }

  if (!canPlace(bagAsBoardPieces(state.bagSlots), skillBook, offer.skillId, dest.slot, RUN_BOARD_SLOTS)) {
    return { ok: false, reason: 'slot', state };
  }
  const bagSlots = [...state.bagSlots];
  bagSlots[dest.slot] = { instanceId, skillId: offer.skillId, tier: offer.tier };
  return { ok: true, state: { ...state, ...settle, bagSlots } };
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
export type { RunMap, RunNode, RunNodeKind, MergeTarget };
