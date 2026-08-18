import {
  emptyLifetimeStats,
  loadLifetimeStats,
  recordRunEnd,
  recordRunStart,
  saveLifetimeStats,
  type LifetimeStats,
  type StorageDriver,
} from '../meta/lifetimeStats';
import type { RunState } from '../run/runState';

/**
 * The account's lifetime stats — the `src/meta` counterpart of `runStore.ts`'s
 * `activeRun`. ALL aggregation logic lives in `src/meta/lifetimeStats.ts`
 * (pure, DOM-free); this module is only the `window.localStorage` adapter
 * (the one DOM dependency `src/meta` itself must never take) plus the two
 * call sites `runStore.ts` hits at a run's start and end.
 */

/** `StorageDriver` backed by the real browser `localStorage`. Catches quota/
 * private-mode/`localStorage`-unavailable errors (SSR, disabled storage) so a
 * stats write never THROWS and breaks gameplay — but unlike a plain swallow,
 * `set` reports `false` on failure so `saveLifetimeStats` can tell the
 * caller the write didn't happen (see `persist` below) instead of the game
 * silently believing progress was saved when it wasn't. */
const localStorageDriver: StorageDriver = {
  get(key) {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key, value) {
    try {
      window.localStorage.setItem(key, value);
      return true;
    } catch {
      return false; // quota exceeded / private mode / no localStorage
    }
  },
};

let cached: LifetimeStats | null = null;

function current(): LifetimeStats {
  if (!cached) cached = loadLifetimeStats(localStorageDriver);
  return cached;
}

/** Updates the in-memory cache unconditionally (so this session's UI keeps
 * reflecting progress even if the write below is refused/fails), then asks
 * `saveLifetimeStats` to persist it. A refusal is never silent: it means
 * either a newer-schema blob is on disk (this session must not downgrade
 * it — see `src/meta/lifetimeStats.ts`) or the browser's storage write
 * itself failed (quota exceeded, private mode). Either way nothing on disk
 * was destroyed; only this session's update to it did not land. */
function persist(next: LifetimeStats): void {
  cached = next;
  const outcome = saveLifetimeStats(localStorageDriver, next);
  if (!outcome.ok) {
    // eslint-disable-next-line no-console -- best-effort dev/user visibility; non-fatal by design.
    console.warn(`lifetime stats not saved (${outcome.reason}) — this session's progress will not persist`);
  }
}

/** The account's lifetime stats (loaded lazily, cached for the session) —
 * read-only selector for a future stats screen. */
export function getLifetimeStats(): LifetimeStats {
  return current();
}

/** Reset the account's lifetime stats to zero (not wired to any UI yet;
 * exposed for tests/tools). */
export function resetLifetimeStats(): void {
  persist(emptyLifetimeStats());
}

/** Call once per `createRun` (`runStore.ts#startRun`) — bumps `runsStarted`. */
export function noteRunStarted(): void {
  persist(recordRunStart(current()));
}

/** Call once when a run reaches a terminal status (`'retired'` or `'defeat'`)
 * — folds its `RunStats` ledger into the lifetime totals. A no-op (per
 * `recordRunEnd`) for any other status, so calling this defensively (e.g. on
 * a run that turns out not to be over) never double-counts. */
export function noteRunEnded(run: RunState): void {
  persist(recordRunEnd(current(), run));
}
