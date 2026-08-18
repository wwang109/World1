// Lifetime stats — cross-RUN aggregation (the account-progression counterpart
// of `src/run/runState.ts#RunStats`). Pure TS: no Phaser, no DOM, no
// `src/game` import — persistence flows through an INJECTED `StorageDriver`
// (see below) so this module never touches `window.localStorage` directly;
// the real localStorage-backed driver lives in `src/game` (DOM is a game-
// layer concern), this module only knows the string get/set shape.
//
// Versioned + tolerant, in two DIFFERENT senses depending on direction:
//
// READING an older/partial blob is tolerant: `loadLifetimeStats` NEVER
// throws — missing/malformed fields default to zero/empty via `normalize`'s
// field-by-field defaulting, and that alone makes an OLDER saved blob
// forward-compatible for free.
//
// WRITING is NOT tolerant of downgrading a NEWER blob. A blob whose stored
// `schemaVersion` is greater than this build's `SCHEMA_VERSION` (a stale
// tab still open after an update, or a rollback to an older build running
// against a browser that already saved a newer one) must never be
// silently overwritten with a re-serialized, field-dropped v(this build)
// copy — that is a real, unrecoverable data-loss path, and it shipped once
// already. `saveLifetimeStats` therefore PEEKS the currently-stored blob
// before writing and refuses (returns `{ ok: false, reason:
// 'newer-version-on-disk' }`) rather than commit a downgrade. The caller's
// session keeps working off its in-memory `LifetimeStats` (a "read-only"
// session, in effect) — that is a deliberately worse experience than a
// silently wiped ledger, not a bug.
//
// A CORRUPT blob (unparseable JSON, or JSON that isn't an object at all)
// also must not simply vanish: before `loadLifetimeStats` falls back to an
// empty ledger, it copies the raw, un-parseable bytes to a side "backup"
// key (`LIFETIME_STATS_BACKUP_KEY`) so the original is still on disk for
// manual recovery or a future repair tool, even though gameplay proceeds
// on a zeroed ledger this session (booting the game must never crash or
// block on bad storage).
//
// There is only one real schema today (`SCHEMA_VERSION = 1`); `MIGRATIONS`
// below is the (currently empty) slot for the day a v2 ships — see its own
// doc comment for why the storage key stays fixed rather than versioned.

/** The minimal storage seam this module needs — implemented by a real
 * `window.localStorage` adapter in `src/game`, and trivially by an in-memory
 * fake in tests. Both methods are synchronous (matches `localStorage`'s API).
 * `set` returns whether the write actually happened: a real driver must
 * catch and report `false` on quota-exceeded / private-mode / unavailable
 * storage rather than letting the exception propagate (`localStorage.setItem`
 * can throw) — `saveLifetimeStats` surfaces that as `{ ok: false, reason:
 * 'write-failed' }` instead of silently pretending the save succeeded. */
export interface StorageDriver {
  get(key: string): string | null;
  set(key: string, value: string): boolean;
}

/** The storage key `src/game`'s localStorage driver should save/load under.
 *
 * Deliberately NOT derived from `SCHEMA_VERSION` (i.e. NOT
 * `world1:lifetimeStats:v${SCHEMA_VERSION}`). A per-version key would mean
 * every schema bump starts a brand-new empty ledger at a fresh key while the
 * old one sits inert forever — fine for disposable session state, wrong for
 * something explicitly named "lifetime": the whole point is that it survives
 * every future app update. A stable key paired with real migrations (see
 * `MIGRATIONS` below) is the right shape for an ever-growing account ledger;
 * the newer-version write guard in `saveLifetimeStats` is what makes a
 * stable key safe in the meantime (before a migration for some future
 * version exists, an older build simply refuses to touch a newer blob
 * instead of stamping its own version over it). */
export const LIFETIME_STATS_STORAGE_KEY = 'world1:lifetimeStats:v1';

/** Side key a corrupt/unparseable primary blob is copied to before
 * `loadLifetimeStats` resets the in-memory ledger to empty — see the module
 * doc comment. Best-effort only: holds the most recent corrupt blob seen,
 * not a full history. */
export const LIFETIME_STATS_BACKUP_KEY = `${LIFETIME_STATS_STORAGE_KEY}:corrupt-backup`;

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

/** One migration step, keyed by the STORED version it upgrades FROM — e.g.
 * `MIGRATIONS[1]` turns a v1-shaped record into v2's shape. Run in order
 * starting at the blob's own `schemaVersion` (defaulting to 1 for blobs that
 * predate the field existing), stopping the moment a step is missing.
 *
 * Empty today: only v1 has ever shipped. Add the `1: (v1) => ({ ...v2 })`
 * step here the day `SCHEMA_VERSION` becomes 2, rather than letting
 * `normalize`'s blanket defaulting silently drop the new fields of a
 * same-or-older blob (that already works fine) — the case this exists for
 * is an OLDER build reading a slightly-newer-but-still-migratable blob.
 * A blob newer than anything a migration step here can reach is instead
 * caught by the write-time guard in `saveLifetimeStats` — it is read
 * best-effort (whatever fields this build recognizes) but never saved back
 * down. */
const MIGRATIONS: Record<number, (raw: Record<string, unknown>) => Record<string, unknown>> = {};

/** Apply every migration step in order, starting at `raw.schemaVersion` (or 1
 * if absent), until either `SCHEMA_VERSION` is reached or a step is missing. */
function migrate(raw: Record<string, unknown>): Record<string, unknown> {
  let version = safeInt(raw.schemaVersion, 1);
  let cur = raw;
  while (version < SCHEMA_VERSION) {
    const step = MIGRATIONS[version];
    if (!step) break;
    cur = step(cur);
    version += 1;
  }
  return cur;
}

/** Field-by-field defaulting over an arbitrary unknown value — the single
 * place a loaded (post-migration) blob's shape gets reconciled against
 * today's `LifetimeStats`. Every field is read defensively; anything missing
 * or malformed becomes 0/empty rather than propagating `undefined` or a bad
 * type into the rest of the app. Always stamps `schemaVersion: SCHEMA_VERSION`
 * on the RETURNED (in-memory, read) value — this is a read-side best-effort
 * view, not a promise that the value is safe to write back verbatim (see
 * `saveLifetimeStats`'s newer-version guard for that). */
function normalize(raw: Record<string, unknown>): LifetimeStats {
  const r = raw;
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
 *
 * If the stored bytes are JSON-unparseable, or parse to something that
 * isn't a plain object (a bare number/string/array/null/boolean), they are
 * copied to `LIFETIME_STATS_BACKUP_KEY` FIRST — the in-memory result this
 * call returns is still a zeroed ledger (booting the game can't wait on
 * manual recovery), but the original bytes are not destroyed by the write
 * that inevitably follows (see the module doc comment).
 */
export function loadLifetimeStats(storage: StorageDriver): LifetimeStats {
  const raw = storage.get(LIFETIME_STATS_STORAGE_KEY);
  if (raw === null) return emptyLifetimeStats();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    storage.set(LIFETIME_STATS_BACKUP_KEY, raw);
    return emptyLifetimeStats();
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    storage.set(LIFETIME_STATS_BACKUP_KEY, raw);
    return emptyLifetimeStats();
  }
  return normalize(migrate(parsed as Record<string, unknown>));
}

/** Why `saveLifetimeStats` did or didn't write. `'newer-version-on-disk'`:
 * refused — the stored blob's `schemaVersion` is greater than this build's
 * `SCHEMA_VERSION`, so writing would downgrade-and-destroy it (see the
 * module doc comment). `'write-failed'`: the `StorageDriver` itself
 * reported the write didn't happen (quota exceeded, private mode, storage
 * unavailable) — nothing was destroyed (the previous stored value, if any,
 * is untouched), but this call's data was NOT persisted. */
export type SaveOutcome =
  | { ok: true }
  | { ok: false; reason: 'newer-version-on-disk' | 'write-failed' };

/** Best-effort peek at the CURRENTLY STORED blob's `schemaVersion`, without
 * going through the full tolerant `loadLifetimeStats` path (which would
 * itself trigger the corrupt-blob backup — this is only a version check).
 * Returns `null` if there's nothing stored, the stored bytes don't parse, or
 * the parsed value has no numeric `schemaVersion` field. */
function peekStoredSchemaVersion(storage: StorageDriver): number | null {
  const raw = storage.get(LIFETIME_STATS_STORAGE_KEY);
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const v = (parsed as Record<string, unknown>).schemaVersion;
      if (typeof v === 'number' && Number.isFinite(v)) return v;
    }
  } catch {
    /* unparseable — not a version signal either way, treat as "no version". */
  }
  return null;
}

/**
 * Persist `stats` via `storage` (plain `JSON.stringify` — every field is
 * already an integer/plain object) — UNLESS the blob currently on disk is
 * from a newer schema than this build understands, in which case the write
 * is refused entirely (see `SaveOutcome` and the module doc comment): this
 * build never overwrites a newer blob with its own downgraded, field-
 * dropping re-serialization. Also reports (rather than swallowing) a
 * `StorageDriver`-level write failure (e.g. quota exceeded).
 */
export function saveLifetimeStats(storage: StorageDriver, stats: LifetimeStats): SaveOutcome {
  const storedVersion = peekStoredSchemaVersion(storage);
  if (storedVersion !== null && storedVersion > SCHEMA_VERSION) {
    return { ok: false, reason: 'newer-version-on-disk' };
  }
  const wrote = storage.set(LIFETIME_STATS_STORAGE_KEY, JSON.stringify(stats));
  return wrote ? { ok: true } : { ok: false, reason: 'write-failed' };
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
