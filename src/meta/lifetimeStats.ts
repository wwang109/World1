// Lifetime stats — cross-RUN aggregation (the account-progression counterpart
// of `src/run/runState.ts#RunStats`). Pure TS: no Phaser, no DOM, no
// `src/game` import — persistence flows through an INJECTED `StorageDriver`
// (see below) so this module never touches `window.localStorage` directly;
// the real localStorage-backed driver lives in `src/game` (DOM is a game-
// layer concern), this module only knows the string get/set shape.
//
// Versioned + tolerant: `schemaVersion` is stamped on every saved blob;
// `loadLifetimeStats` NEVER throws — missing/malformed fields default to
// zero/empty, and unparseable JSON resets to a fresh ledger, rather than
// crashing the game's boot. There is only one schema version today
// (`SCHEMA_VERSION = 1`); when a second one ships, add a numbered migration
// step ahead of the field-by-field defaulting below (the defaulting itself
// already makes an OLDER saved blob forward-compatible for free — it's a
// NEWER blob written by a future version, or a blob with an unrecognized
// shape, that needs an explicit migration or a documented "best effort" read).

/** The minimal storage seam this module needs — implemented by a real
 * `window.localStorage` adapter in `src/game`, and trivially by an in-memory
 * fake in tests. Both methods are synchronous (matches `localStorage`'s API). */
export interface StorageDriver {
  get(key: string): string | null;
  set(key: string, value: string): void;
}

/** The storage key `src/game`'s localStorage driver should save/load under. */
export const LIFETIME_STATS_STORAGE_KEY = 'world1:lifetimeStats:v1';

export const SCHEMA_VERSION = 1;

/** The run's score-axis high-water marks, kept forever (never decreases). */
export interface BestRun {
  bossesCleared: number;
  deepestWave: number;
}

/** Sums of every `RunStats` counter (see `runState.ts`) across every run that
 * has ever ended (retired or dead) — the account's lifetime totals. */
export interface LifetimeTotals {
  damageDealt: number;
  damageTaken: number;
  healingDone: number;
  goldEarned: number;
  goldSpent: number;
  cardsBought: number;
  gemsBought: number;
  eventsResolved: number;
  livesLost: number;
}

export interface LifetimeStats {
  schemaVersion: number;
  /** Runs started this account (`createRun` calls the game layer has told us about). */
  runsStarted: number;
  /** Runs that ended via voluntary retire (`status === 'retired'`). */
  runsRetired: number;
  /** Runs that ended at 0 lives (`status === 'defeat'`). */
  runsDead: number;
  /** `wins + losses` summed across every ended run. */
  totalFights: number;
  totalWins: number;
  totalLosses: number;
  /** Sum of every ended run's `bossesCleared` (NOT a high-water mark — see `bestRun` for that). */
  totalBossesCleared: number;
  bestRun: BestRun;
  totals: LifetimeTotals;
}

function emptyTotals(): LifetimeTotals {
  return {
    damageDealt: 0,
    damageTaken: 0,
    healingDone: 0,
    goldEarned: 0,
    goldSpent: 0,
    cardsBought: 0,
    gemsBought: 0,
    eventsResolved: 0,
    livesLost: 0,
  };
}

/** A brand-new account's all-zero ledger. */
export function emptyLifetimeStats(): LifetimeStats {
  return {
    schemaVersion: SCHEMA_VERSION,
    runsStarted: 0,
    runsRetired: 0,
    runsDead: 0,
    totalFights: 0,
    totalWins: 0,
    totalLosses: 0,
    totalBossesCleared: 0,
    bestRun: { bossesCleared: 0, deepestWave: 0 },
    totals: emptyTotals(),
  };
}

/** A non-negative finite integer, or `fallback` for anything else (wrong
 * type, `NaN`, `Infinity`, negative — all defensive against hand-edited or
 * truncated storage). Floors fractional numbers rather than rejecting them. */
function safeInt(value: unknown, fallback = 0): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.max(0, Math.floor(value));
}

/** Field-by-field defaulting over an arbitrary unknown value — the single
 * place a loaded (or future-version) blob's shape gets reconciled against
 * today's `LifetimeStats`. Every field is read defensively; anything missing
 * or malformed becomes 0/empty rather than propagating `undefined` or a bad
 * type into the rest of the app. Always stamps `schemaVersion: SCHEMA_VERSION`
 * on the result — there are no older/newer shapes to preserve yet (only v1
 * exists), so "tolerate" here means "read what you can, zero the rest",
 * not "carry an unknown version's extra fields forward". */
function normalize(raw: unknown): LifetimeStats {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const bestRunRaw = (r.bestRun && typeof r.bestRun === 'object' ? r.bestRun : {}) as Record<string, unknown>;
  const totalsRaw = (r.totals && typeof r.totals === 'object' ? r.totals : {}) as Record<string, unknown>;
  return {
    schemaVersion: SCHEMA_VERSION,
    runsStarted: safeInt(r.runsStarted),
    runsRetired: safeInt(r.runsRetired),
    runsDead: safeInt(r.runsDead),
    totalFights: safeInt(r.totalFights),
    totalWins: safeInt(r.totalWins),
    totalLosses: safeInt(r.totalLosses),
    totalBossesCleared: safeInt(r.totalBossesCleared),
    bestRun: {
      bossesCleared: safeInt(bestRunRaw.bossesCleared),
      deepestWave: safeInt(bestRunRaw.deepestWave),
    },
    totals: {
      damageDealt: safeInt(totalsRaw.damageDealt),
      damageTaken: safeInt(totalsRaw.damageTaken),
      healingDone: safeInt(totalsRaw.healingDone),
      goldEarned: safeInt(totalsRaw.goldEarned),
      goldSpent: safeInt(totalsRaw.goldSpent),
      cardsBought: safeInt(totalsRaw.cardsBought),
      gemsBought: safeInt(totalsRaw.gemsBought),
      eventsResolved: safeInt(totalsRaw.eventsResolved),
      livesLost: safeInt(totalsRaw.livesLost),
    },
  };
}

/**
 * Load the account's lifetime stats via `storage`. NEVER throws: no saved
 * blob yet (`storage.get` returns null), unparseable JSON, or a malformed/
 * partial shape all fall back to `normalize`'s field-by-field defaulting
 * (a totally empty/garbage blob normalizes to `emptyLifetimeStats()`).
 */
export function loadLifetimeStats(storage: StorageDriver): LifetimeStats {
  const raw = storage.get(LIFETIME_STATS_STORAGE_KEY);
  if (raw === null) return emptyLifetimeStats();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return emptyLifetimeStats();
  }
  return normalize(parsed);
}

/** Persist `stats` via `storage` (plain `JSON.stringify` — every field is
 * already an integer/plain object). */
export function saveLifetimeStats(storage: StorageDriver, stats: LifetimeStats): void {
  storage.set(LIFETIME_STATS_STORAGE_KEY, JSON.stringify(stats));
}

/** Bump `runsStarted` — call once per `createRun`. */
export function recordRunStart(stats: LifetimeStats): LifetimeStats {
  return { ...stats, runsStarted: stats.runsStarted + 1 };
}

/** The minimal shape `recordRunEnd` needs off a finished `RunState` — a
 * structural subset (not importing `RunState` itself) so `src/meta` never
 * needs to know `src/run`'s full shape, only the fields it aggregates. Any
 * object with this shape (a real `RunState`, or a test fixture) works. */
export interface EndedRunSummary {
  status: 'retired' | 'defeat' | 'active' | 'drafting' | 'victory';
  wins: number;
  losses: number;
  bossesCleared: number;
  stats: {
    damageDealt: number;
    damageTaken: number;
    healingDone: number;
    goldEarned: number;
    goldSpent: number;
    cardsBought: number;
    gemsBought: number;
    eventsResolved: number;
    livesLost: number;
    deepestWave: number;
  };
}

/**
 * Fold one finished run into the lifetime ledger — call exactly once per run
 * that ends (`status === 'retired'` or `'defeat'`; any other status is a
 * no-op, returning `stats` unchanged, so a defensive/premature call never
 * double-counts an unfinished run). Bumps `runsRetired`/`runsDead`,
 * accumulates `totalFights`/`totalWins`/`totalLosses`/`totalBossesCleared`
 * and every `totals` counter from the run's own `RunStats` ledger, and
 * raises `bestRun`'s high-water marks (never lowers them).
 */
export function recordRunEnd(stats: LifetimeStats, run: EndedRunSummary): LifetimeStats {
  if (run.status !== 'retired' && run.status !== 'defeat') return stats;
  const s = run.stats;
  return {
    ...stats,
    runsRetired: stats.runsRetired + (run.status === 'retired' ? 1 : 0),
    runsDead: stats.runsDead + (run.status === 'defeat' ? 1 : 0),
    totalFights: stats.totalFights + run.wins + run.losses,
    totalWins: stats.totalWins + run.wins,
    totalLosses: stats.totalLosses + run.losses,
    totalBossesCleared: stats.totalBossesCleared + run.bossesCleared,
    bestRun: {
      bossesCleared: Math.max(stats.bestRun.bossesCleared, run.bossesCleared),
      deepestWave: Math.max(stats.bestRun.deepestWave, s.deepestWave),
    },
    totals: {
      damageDealt: stats.totals.damageDealt + s.damageDealt,
      damageTaken: stats.totals.damageTaken + s.damageTaken,
      healingDone: stats.totals.healingDone + s.healingDone,
      goldEarned: stats.totals.goldEarned + s.goldEarned,
      goldSpent: stats.totals.goldSpent + s.goldSpent,
      cardsBought: stats.totals.cardsBought + s.cardsBought,
      gemsBought: stats.totals.gemsBought + s.gemsBought,
      eventsResolved: stats.totals.eventsResolved + s.eventsResolved,
      livesLost: stats.totals.livesLost + s.livesLost,
    },
  };
}
