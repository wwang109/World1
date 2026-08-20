// Run save — cross-refresh persistence for the ONE active run (the `src/meta`
// counterpart of `runStore.ts`'s in-memory `activeRun`). Pure TS: no Phaser,
// no DOM — persistence flows through the SAME injected `StorageDriver` seam
// `src/meta/lifetimeStats.ts` established (see that module's doc comment for
// the full rationale); the real localStorage-backed driver lives in
// `src/game` (DOM is a game-layer concern), this module only knows the
// string get/set shape.
//
// `RunState` (src/run/runState.ts) is already documented as "ready for a
// future src/meta save/load layer" — every field is plain data (integers,
// strings, plain objects/arrays), no class instances, no live `Rng`, no
// functions — so it round-trips through `JSON.stringify`/`JSON.parse` with no
// field-by-field reconstruction needed. That is DELIBERATELY different from
// `lifetimeStats.ts`'s `normalize()`: a lifetime ledger is a small flat
// counter bag that must tolerate hand-edited/partial/ancient blobs forever,
// so it defaults every field individually. A run save is the ENTIRE state of
// an in-progress run written by THIS SAME BUILD moments ago (the common case
// is "the same tab reloaded") — the only real failure modes are (a) the bytes
// are truncated/corrupt (a write got interrupted) or (b) a NEWER build's
// schema is sitting in storage (a stale tab, or a rollback). Both cases fail
// to `null` (no run to resume this session) rather than attempting a
// best-effort partial reconstruction of a complex nested map/board/shop
// state that could easily produce an internally-inconsistent `RunState` (a
// worse outcome than just starting fresh).
//
// CORRUPTION SEMANTICS (mirrors `lifetimeStats.ts`'s precedent exactly):
//   - No blob stored at all -> `loadRun` returns `null` (nothing to resume).
//   - An EXPLICIT "no run" marker (JSON `null`, written by `clearRun` below)
//     -> `loadRun` returns `null`. This is NOT corruption — it's what a
//     deliberately-cleared save looks like on disk.
//   - Unparseable JSON, or JSON that parses to something structurally wrong
//     (not an object, a missing/non-numeric `schemaVersion`, or a `run` field
//     that isn't itself a plain object) -> `loadRun` returns `null` AND first
//     copies the raw bytes to `RUN_SAVE_BACKUP_KEY` — same "never silently
//     destroy, back up for a future repair tool" idiom as the lifetime-stats
//     fix (see that module's doc comment for why this rule exists at all: a
//     silently-destroyed-on-corrupt path shipped once already).
//   - A NEWER `schemaVersion` than this build's `SCHEMA_VERSION` -> `loadRun`
//     returns `null` WITHOUT backing up: the bytes are perfectly valid JSON,
//     just from a format this build doesn't understand yet — nothing is
//     touched, so the newer build's save is left exactly as it was for
//     forward-compat. `saveRun` enforces the write-side half of this: it
//     REFUSES to overwrite a strictly-newer stored blob (same guard
//     `saveLifetimeStats` uses), so an older build can never downgrade it.
//
// MIGRATIONS: v1 is the only schema that has ever shipped; there is no
// `MIGRATIONS` table yet (unlike `lifetimeStats.ts`, which already has the
// empty slot wired up). The day `SCHEMA_VERSION` becomes 2, add the same
// migration-table idiom here rather than teaching `loadRun` a growing pile of
// ad hoc "if version is X do Y" branches.

import type { RunState } from '../run/runState';
import type { StorageDriver } from './lifetimeStats';

export type { StorageDriver };

/** The storage key `src/game`'s localStorage driver should save/load the
 * active run under. Versioned in the key's OWN name is fine here (unlike
 * `LIFETIME_STATS_STORAGE_KEY`, which deliberately stays stable forever) —
 * a run save is disposable session state, not an ever-growing account
 * ledger: there is nothing lost by starting a v2 build at a fresh key while
 * a v1 run save sits inert (that run simply can't be resumed by the newer
 * build, same as it already couldn't be resumed by an older one without this
 * feature at all). Revisit if/when real migrations make a stable key +
 * `MIGRATIONS` table the better trade, as `lifetimeStats.ts` already does. */
export const RUN_SAVE_STORAGE_KEY = 'world1:runSave:v1';

/** Side key a corrupt/unparseable primary blob is copied to before `loadRun`
 * gives up and returns `null` — see the module doc comment. Best-effort
 * only: holds the most recent corrupt blob seen, not a full history. */
export const RUN_SAVE_BACKUP_KEY = `${RUN_SAVE_STORAGE_KEY}:corrupt-backup`;

export const SCHEMA_VERSION = 1;

/** The on-disk shape: the run itself plus the schema stamp that lets
 * `loadRun`/`saveRun` tell an old/current/future blob apart without needing
 * to inspect `run`'s own fields. */
export interface RunSaveEnvelope {
  schemaVersion: number;
  run: RunState;
}

/** Why `saveRun` did or didn't write — same shape/meaning as
 * `lifetimeStats.ts#SaveOutcome`. `'newer-version-on-disk'`: refused — the
 * stored blob's `schemaVersion` is greater than this build's
 * `SCHEMA_VERSION`, so writing would downgrade-and-destroy it.
 * `'write-failed'`: the `StorageDriver` itself reported the write didn't
 * happen (quota exceeded, private mode, storage unavailable) — nothing was
 * destroyed, but this call's run state was NOT persisted. */
export type RunSaveOutcome =
  | { ok: true }
  | { ok: false; reason: 'newer-version-on-disk' | 'write-failed' };

/** Best-effort peek at the CURRENTLY STORED blob's `schemaVersion`, without
 * going through the full tolerant `loadRun` path (which would itself trigger
 * the corrupt-blob backup — this is only a version check). Returns `null` if
 * there's nothing stored, the stored bytes don't parse, the parsed value is
 * the explicit "cleared" `null` marker, or the parsed value has no numeric
 * `schemaVersion` field. */
function peekStoredSchemaVersion(storage: StorageDriver): number | null {
  const raw = storage.get(RUN_SAVE_STORAGE_KEY);
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
 * Persist `run` via `storage` as `{schemaVersion: SCHEMA_VERSION, run}` —
 * plain `JSON.stringify` (every `RunState` field is already an
 * integer/string/plain object/array) — UNLESS the blob currently on disk is
 * from a newer schema than this build understands, in which case the write
 * is refused entirely (see `RunSaveOutcome` and the module doc comment): this
 * build never overwrites a newer blob with its own downgraded
 * re-serialization. Also reports (rather than swallowing) a
 * `StorageDriver`-level write failure (e.g. quota exceeded).
 */
export function saveRun(storage: StorageDriver, run: RunState): RunSaveOutcome {
  const storedVersion = peekStoredSchemaVersion(storage);
  if (storedVersion !== null && storedVersion > SCHEMA_VERSION) {
    return { ok: false, reason: 'newer-version-on-disk' };
  }
  const envelope: RunSaveEnvelope = { schemaVersion: SCHEMA_VERSION, run };
  const wrote = storage.set(RUN_SAVE_STORAGE_KEY, JSON.stringify(envelope));
  return wrote ? { ok: true } : { ok: false, reason: 'write-failed' };
}

/**
 * Load the persisted active run via `storage`. NEVER throws. Returns `null`
 * for every one of: nothing ever stored, the explicit "cleared" marker (see
 * `clearRun`), unparseable/malformed bytes (also backs those up first — see
 * the module doc comment), or a `schemaVersion` newer than this build's
 * `SCHEMA_VERSION` (left completely untouched on disk). Anything that parses
 * as a well-formed CURRENT-version envelope is returned byte-for-byte as the
 * `RunState` it was saved as (no field-by-field reconstruction — see the
 * module doc comment for why that's the right call here, unlike
 * `lifetimeStats.ts`).
 */
export function loadRun(storage: StorageDriver): RunState | null {
  const raw = storage.get(RUN_SAVE_STORAGE_KEY);
  if (raw === null) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    storage.set(RUN_SAVE_BACKUP_KEY, raw);
    return null;
  }

  // The explicit "cleared" sentinel `clearRun` writes — a deliberate empty
  // state, not corruption, so no backup is warranted.
  if (parsed === null) return null;

  if (typeof parsed !== 'object' || Array.isArray(parsed)) {
    storage.set(RUN_SAVE_BACKUP_KEY, raw);
    return null;
  }

  const envelope = parsed as Record<string, unknown>;
  const schemaVersion = envelope.schemaVersion;
  if (typeof schemaVersion !== 'number' || !Number.isFinite(schemaVersion)) {
    storage.set(RUN_SAVE_BACKUP_KEY, raw);
    return null;
  }

  // Newer than this build knows how to read — leave it alone entirely
  // (no backup: these are legitimate, readable bytes, just from a format
  // this build doesn't understand yet).
  if (schemaVersion > SCHEMA_VERSION) return null;

  // Older than SCHEMA_VERSION can't happen yet (v1 is the only schema that
  // has ever shipped) — guarded defensively rather than assumed impossible.
  // The day a v2 ships, replace this branch with a real `MIGRATIONS` table
  // (mirroring `lifetimeStats.ts`) instead of treating every older blob as
  // corrupt.
  if (schemaVersion < SCHEMA_VERSION) {
    storage.set(RUN_SAVE_BACKUP_KEY, raw);
    return null;
  }

  const run = envelope.run;
  if (run === null || typeof run !== 'object' || Array.isArray(run)) {
    storage.set(RUN_SAVE_BACKUP_KEY, raw);
    return null;
  }
  return run as RunState;
}

/**
 * Clear the persisted run — writes the explicit "no run" marker (JSON
 * `null`) rather than leaving stale bytes that `loadRun` would otherwise try
 * to interpret. A no-op if a NEWER-schema blob is currently stored (same
 * newer-version guard as `saveRun`: an old build must never destroy a
 * future build's save just because THIS session's run ended).
 */
export function clearRun(storage: StorageDriver): void {
  const storedVersion = peekStoredSchemaVersion(storage);
  if (storedVersion !== null && storedVersion > SCHEMA_VERSION) return;
  storage.set(RUN_SAVE_STORAGE_KEY, JSON.stringify(null));
}
