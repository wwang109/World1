import { describe, expect, it } from 'vitest';
import {
  clearRun,
  loadRun,
  RUN_SAVE_BACKUP_KEY,
  RUN_SAVE_STORAGE_KEY,
  saveRun,
  SCHEMA_VERSION,
  type StorageDriver,
} from '../../src/meta/runSave';
import {
  applyDraftResult,
  availableChoices,
  chooseNode,
  createRun,
  ensureRunShopShelf,
  rerollRunShop,
  type RunState,
} from '../../src/run/runState';
import { rollStartDraft, DRAFT_SET_KEYS, type DraftSetKey } from '../../src/run/draft';

/** In-memory fake `StorageDriver` — same seam/idiom as
 * `tests/meta/lifetimeStats.test.ts`'s fake: `src/meta` never touches
 * `localStorage` itself, so this fake exercises the exact same get/set
 * contract a real browser driver would. */
function fakeStorage(initial: Record<string, string> = {}): StorageDriver {
  const map = new Map(Object.entries(initial));
  return {
    get: (key) => map.get(key) ?? null,
    set: (key, value) => { map.set(key, value); return true; },
  };
}

function fakeQuotaExceededStorage(): StorageDriver {
  return {
    get: () => null,
    set: () => false,
  };
}

function draftPicksFor(seed: number): Partial<Record<DraftSetKey, string>> {
  const draft = rollStartDraft(seed);
  const picks: Partial<Record<DraftSetKey, string>> = {};
  for (const key of DRAFT_SET_KEYS) {
    picks[key] = draft[key][0]!.skillId;
  }
  return picks;
}

/** Builds a real, mid-run `RunState` — drafted, has walked into a shop node,
 * rolled its shelf, and rerolled it once (so `rerollCount` is nonzero — the
 * escalating-price field the run-save feature spec calls out by name).
 * Falls back to just walking further node choices if the first available
 * column has no shop (deterministic per seed, but shop placement is
 * map-dependent). */
function midRunState(seed: number): RunState {
  let state = applyDraftResult(createRun(seed), draftPicksFor(seed));
  // Walk up to a few nodes deep looking for a shop node to exercise the
  // shelf/reroll fields; if none appears, the state is still a perfectly
  // valid "mid run" fixture (fight/event nodes round-trip identically).
  for (let i = 0; i < 6; i++) {
    const choices = availableChoices(state);
    const shop = choices.find((n) => n.kind === 'shop');
    const pick = shop ?? choices[0];
    if (!pick) break;
    state = chooseNode(state, pick.id);
    if (pick.kind === 'shop') {
      state = ensureRunShopShelf(state, pick.id);
      state = rerollRunShop(state, pick.id);
      break;
    }
    // Not a combat/shop node this iteration resolved into "current" — bail to
    // keep the fixture simple; the node stays occupied (currentNodeId set),
    // which is itself a legitimate mid-run snapshot to round-trip.
    break;
  }
  return state;
}

describe('meta/runSave: load with nothing stored', () => {
  it('returns null', () => {
    expect(loadRun(fakeStorage())).toBeNull();
  });
});

describe('meta/runSave: save/load round-trip', () => {
  it('round-trips a real mid-run state byte-exactly', () => {
    const storage = fakeStorage();
    const run = midRunState(12345);
    const outcome = saveRun(storage, run);
    expect(outcome).toEqual({ ok: true });
    const loaded = loadRun(storage);
    expect(loaded).toEqual(run);
    expect(storage.get(RUN_SAVE_STORAGE_KEY)).not.toBeNull();
  });

  it('round-trips the shop shelf/reroll-count fields specifically — the escalating price must survive', () => {
    const storage = fakeStorage();
    const run = midRunState(777);
    const shopNodeId = Object.keys(run.shopShelves)[0];
    // This seed's walk should have found and rerolled a shop; if map layout
    // ever changes such that it doesn't, fail loudly rather than silently
    // passing a fixture that isn't exercising the field under test.
    expect(shopNodeId).toBeDefined();
    const shelfBefore = run.shopShelves[shopNodeId!]!;
    expect(shelfBefore.rerollCount).toBeGreaterThan(0);

    saveRun(storage, run);
    const loaded = loadRun(storage)!;
    expect(loaded.shopShelves[shopNodeId!]).toEqual(shelfBefore);
    expect(loaded.shopShelves[shopNodeId!]!.rerollCount).toBe(shelfBefore.rerollCount);
  });

  it('round-trips a freshly-created (pre-draft) run too', () => {
    const storage = fakeStorage();
    const run = createRun(42);
    saveRun(storage, run);
    expect(loadRun(storage)).toEqual(run);
  });
});

describe('meta/runSave: tolerant loader — never crashes boot', () => {
  it('corrupt (unparseable) JSON loads as null', () => {
    const storage = fakeStorage({ [RUN_SAVE_STORAGE_KEY]: '{not json at all' });
    expect(loadRun(storage)).toBeNull();
  });

  it('a JSON value that is not an object (bare number/string/array/boolean) loads as null', () => {
    for (const raw of ['42', '"a string"', '[1,2,3]', 'true']) {
      const storage = fakeStorage({ [RUN_SAVE_STORAGE_KEY]: raw });
      expect(loadRun(storage)).toBeNull();
    }
  });

  it('an envelope missing/malformed schemaVersion loads as null', () => {
    const storage = fakeStorage({ [RUN_SAVE_STORAGE_KEY]: JSON.stringify({ run: { seed: 1 } }) });
    expect(loadRun(storage)).toBeNull();
  });

  it('an envelope whose run field is missing/wrong-shaped loads as null', () => {
    const storage = fakeStorage({
      [RUN_SAVE_STORAGE_KEY]: JSON.stringify({ schemaVersion: SCHEMA_VERSION, run: 'oops' }),
    });
    expect(loadRun(storage)).toBeNull();
  });

  it('never throws regardless of what garbage is stored', () => {
    for (const raw of ['{not json', '[1,2,3]', 'null', '{}', '{"schemaVersion":"x"}']) {
      const storage = fakeStorage({ [RUN_SAVE_STORAGE_KEY]: raw });
      expect(() => loadRun(storage)).not.toThrow();
    }
  });
});

describe('meta/runSave: a corrupt blob is backed up, not destroyed', () => {
  it('unparseable JSON is copied to the backup key, and the primary key is left untouched', () => {
    const truncated = '{"schemaVersion":1,"run":{"seed":1,"gold":';
    const storage = fakeStorage({ [RUN_SAVE_STORAGE_KEY]: truncated });
    const loaded = loadRun(storage);
    expect(loaded).toBeNull();
    expect(storage.get(RUN_SAVE_BACKUP_KEY)).toBe(truncated);
    // The corrupt bytes are still there — load did not delete/overwrite them.
    expect(storage.get(RUN_SAVE_STORAGE_KEY)).toBe(truncated);
  });

  it('a non-object JSON value (array) is also backed up before returning null', () => {
    const storage = fakeStorage({ [RUN_SAVE_STORAGE_KEY]: '[1,2,3]' });
    loadRun(storage);
    expect(storage.get(RUN_SAVE_BACKUP_KEY)).toBe('[1,2,3]');
  });

  it('the explicit "cleared" null marker is NOT treated as corrupt — no backup', () => {
    const storage = fakeStorage({ [RUN_SAVE_STORAGE_KEY]: JSON.stringify(null) });
    expect(loadRun(storage)).toBeNull();
    expect(storage.get(RUN_SAVE_BACKUP_KEY)).toBeNull(); // never set — this is not corruption
  });
});

describe('meta/runSave: a newer schemaVersion is never downgraded', () => {
  function futureBlob(): Record<string, unknown> {
    return {
      schemaVersion: SCHEMA_VERSION + 1,
      run: { seed: 99, someV2OnlyField: 'kept-as-is' },
      // A v2-only envelope field this v1 build has no idea how to interpret.
      migrationHint: 'v1-to-v2',
    };
  }

  it('loadRun returns null for a newer blob WITHOUT touching the stored bytes', () => {
    const raw = JSON.stringify(futureBlob());
    const storage = fakeStorage({ [RUN_SAVE_STORAGE_KEY]: raw });
    expect(loadRun(storage)).toBeNull();
    expect(storage.get(RUN_SAVE_STORAGE_KEY)).toBe(raw); // byte-for-byte untouched
    expect(storage.get(RUN_SAVE_BACKUP_KEY)).toBeNull(); // not corruption — no backup
  });

  it('saveRun refuses to overwrite a newer-versioned stored blob', () => {
    const raw = JSON.stringify(futureBlob());
    const storage = fakeStorage({ [RUN_SAVE_STORAGE_KEY]: raw });
    const outcome = saveRun(storage, createRun(1));
    expect(outcome).toEqual({ ok: false, reason: 'newer-version-on-disk' });
    expect(storage.get(RUN_SAVE_STORAGE_KEY)).toBe(raw); // untouched
  });

  it('clearRun refuses to clobber a newer-versioned stored blob', () => {
    const raw = JSON.stringify(futureBlob());
    const storage = fakeStorage({ [RUN_SAVE_STORAGE_KEY]: raw });
    clearRun(storage);
    expect(storage.get(RUN_SAVE_STORAGE_KEY)).toBe(raw); // untouched — no downgrade-clear either
  });

  it('a same-version stored blob saves/clears normally — the guard only blocks strictly-newer', () => {
    const storage = fakeStorage();
    expect(saveRun(storage, createRun(1))).toEqual({ ok: true });
    expect(saveRun(storage, createRun(2))).toEqual({ ok: true });
    clearRun(storage);
    expect(loadRun(storage)).toBeNull();
  });
});

describe('meta/runSave: clearRun', () => {
  it('clears a previously-saved run — loadRun returns null afterward', () => {
    const storage = fakeStorage();
    saveRun(storage, midRunState(5));
    expect(loadRun(storage)).not.toBeNull();
    clearRun(storage);
    expect(loadRun(storage)).toBeNull();
  });

  it('is a no-op (never throws) when nothing was ever saved', () => {
    const storage = fakeStorage();
    expect(() => clearRun(storage)).not.toThrow();
    expect(loadRun(storage)).toBeNull();
  });

  it('after clearing, a fresh save works normally again', () => {
    const storage = fakeStorage();
    saveRun(storage, midRunState(6));
    clearRun(storage);
    const run = createRun(9);
    expect(saveRun(storage, run)).toEqual({ ok: true });
    expect(loadRun(storage)).toEqual(run);
  });
});

describe('meta/runSave: a StorageDriver write failure (e.g. quota exceeded) is surfaced, not swallowed', () => {
  it('saveRun reports { ok: false, reason: "write-failed" } and never throws', () => {
    const storage = fakeQuotaExceededStorage();
    expect(() => saveRun(storage, createRun(1))).not.toThrow();
    expect(saveRun(storage, createRun(1))).toEqual({ ok: false, reason: 'write-failed' });
  });

  it('a failed write does not silently look like a successful one on the next load', () => {
    const storage = fakeQuotaExceededStorage();
    saveRun(storage, createRun(1));
    expect(loadRun(storage)).toBeNull();
  });
});

describe('meta/runSave: StorageDriver seam stays DOM-free', () => {
  it('never calls anything beyond the injected get/set contract', () => {
    let gets = 0;
    let sets = 0;
    const spy: StorageDriver = {
      get: () => { gets += 1; return null; },
      set: () => { sets += 1; return true; },
    };
    loadRun(spy);
    saveRun(spy, createRun(1));
    expect(gets).toBeGreaterThan(0);
    expect(sets).toBeGreaterThan(0);
  });
});
