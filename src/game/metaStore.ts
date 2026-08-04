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

/** `StorageDriver` backed by the real browser `localStorage`. Swallows quota/
 * private-mode/`localStorage`-unavailable errors (SSR, disabled storage) so a
 * stats-write failure never breaks gameplay — worst case, lifetime stats just
 * don't persist that session. */
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
    } catch {
      /* quota exceeded / private mode / no localStorage — non-fatal */
    }
  },
};

let cached: LifetimeStats | null = null;

function current(): LifetimeStats {
  if (!cached) cached = loadLifetimeStats(localStorageDriver);
  return cached;
}

function persist(next: LifetimeStats): void {
  cached = next;
  saveLifetimeStats(localStorageDriver, next);
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
