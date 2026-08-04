import { describe, expect, it } from 'vitest';
import {
  emptyLifetimeStats,
  LIFETIME_STATS_STORAGE_KEY,
  loadLifetimeStats,
  recordRunEnd,
  recordRunStart,
  saveLifetimeStats,
  SCHEMA_VERSION,
  type EndedRunSummary,
  type LifetimeStats,
  type StorageDriver,
} from '../../src/meta/lifetimeStats';

/** In-memory fake `StorageDriver` — the seam `src/meta` is built around never
 * touches `localStorage` itself; this fake exercises the exact same contract
 * a real browser driver would. */
function fakeStorage(initial: Record<string, string> = {}): StorageDriver {
  const map = new Map(Object.entries(initial));
  return {
    get: (key) => map.get(key) ?? null,
    set: (key, value) => void map.set(key, value),
  };
}

function endedRun(overrides: Partial<EndedRunSummary> = {}): EndedRunSummary {
  return {
    status: 'retired',
    wins: 3,
    losses: 1,
    bossesCleared: 1,
    stats: {
      damageDealt: 100,
      damageTaken: 40,
      healingDone: 10,
      goldEarned: 20,
      goldSpent: 12,
      cardsBought: 2,
      gemsBought: 1,
      eventsResolved: 4,
      livesLost: 1,
      deepestWave: 3,
    },
    ...overrides,
  };
}

describe('meta/lifetimeStats: empty ledger', () => {
  it('emptyLifetimeStats is all zero at the current schema version', () => {
    expect(emptyLifetimeStats()).toEqual({
      schemaVersion: SCHEMA_VERSION,
      runsStarted: 0,
      runsRetired: 0,
      runsDead: 0,
      totalFights: 0,
      totalWins: 0,
      totalLosses: 0,
      totalBossesCleared: 0,
      bestRun: { bossesCleared: 0, deepestWave: 0 },
      totals: {
        damageDealt: 0,
        damageTaken: 0,
        healingDone: 0,
        goldEarned: 0,
        goldSpent: 0,
        cardsBought: 0,
        gemsBought: 0,
        eventsResolved: 0,
        livesLost: 0,
      },
    });
  });
});

describe('meta/lifetimeStats: recordRunStart', () => {
  it('bumps runsStarted by 1 and returns a NEW object', () => {
    const before = emptyLifetimeStats();
    const after = recordRunStart(before);
    expect(after).not.toBe(before);
    expect(after.runsStarted).toBe(1);
    expect(before.runsStarted).toBe(0); // original untouched
  });
});

describe('meta/lifetimeStats: recordRunEnd', () => {
  it('a retired run bumps runsRetired and folds every counter', () => {
    const before = emptyLifetimeStats();
    const run = endedRun({ status: 'retired' });
    const after = recordRunEnd(before, run);
    expect(after).not.toBe(before);
    expect(after.runsRetired).toBe(1);
    expect(after.runsDead).toBe(0);
    expect(after.totalFights).toBe(run.wins + run.losses);
    expect(after.totalWins).toBe(run.wins);
    expect(after.totalLosses).toBe(run.losses);
    expect(after.totalBossesCleared).toBe(run.bossesCleared);
    expect(after.bestRun).toEqual({ bossesCleared: 1, deepestWave: 3 });
    expect(after.totals).toEqual({
      damageDealt: 100,
      damageTaken: 40,
      healingDone: 10,
      goldEarned: 20,
      goldSpent: 12,
      cardsBought: 2,
      gemsBought: 1,
      eventsResolved: 4,
      livesLost: 1,
    });
    expect(before).toEqual(emptyLifetimeStats()); // original untouched
  });

  it('a dead run bumps runsDead instead of runsRetired', () => {
    const after = recordRunEnd(emptyLifetimeStats(), endedRun({ status: 'defeat' }));
    expect(after.runsDead).toBe(1);
    expect(after.runsRetired).toBe(0);
  });

  it('an unfinished run (active/drafting/victory) is a no-op — never double-counts', () => {
    const stats = emptyLifetimeStats();
    for (const status of ['active', 'drafting', 'victory'] as const) {
      const after = recordRunEnd(stats, endedRun({ status }));
      expect(after).toBe(stats);
    }
  });

  it('bestRun tracks a HIGH-WATER MARK across multiple runs, never regressing', () => {
    let stats = emptyLifetimeStats();
    stats = recordRunEnd(stats, endedRun({ bossesCleared: 5, stats: { ...endedRun().stats, deepestWave: 8 } }));
    expect(stats.bestRun).toEqual({ bossesCleared: 5, deepestWave: 8 });
    // A worse follow-up run must not lower the record.
    stats = recordRunEnd(stats, endedRun({ bossesCleared: 1, stats: { ...endedRun().stats, deepestWave: 2 } }));
    expect(stats.bestRun).toEqual({ bossesCleared: 5, deepestWave: 8 });
    // A better follow-up run raises it.
    stats = recordRunEnd(stats, endedRun({ bossesCleared: 9, stats: { ...endedRun().stats, deepestWave: 20 } }));
    expect(stats.bestRun).toEqual({ bossesCleared: 9, deepestWave: 20 });
  });

  it('accumulates additively across multiple ended runs', () => {
    let stats = emptyLifetimeStats();
    stats = recordRunEnd(stats, endedRun());
    stats = recordRunEnd(stats, endedRun());
    expect(stats.runsRetired).toBe(2);
    expect(stats.totalWins).toBe(6);
    expect(stats.totals.damageDealt).toBe(200);
  });
});

describe('meta/lifetimeStats: load/save round-trip', () => {
  it('loadLifetimeStats on an empty driver returns an empty ledger', () => {
    expect(loadLifetimeStats(fakeStorage())).toEqual(emptyLifetimeStats());
  });

  it('saveLifetimeStats then loadLifetimeStats round-trips byte-for-byte', () => {
    const storage = fakeStorage();
    const stats = recordRunEnd(recordRunStart(emptyLifetimeStats()), endedRun());
    saveLifetimeStats(storage, stats);
    expect(loadLifetimeStats(storage)).toEqual(stats);
    expect(storage.get(LIFETIME_STATS_STORAGE_KEY)).not.toBeNull();
  });
});

describe('meta/lifetimeStats: tolerant loader — never crashes boot', () => {
  it('corrupt (unparseable) JSON resets to an empty ledger', () => {
    const storage = fakeStorage({ [LIFETIME_STATS_STORAGE_KEY]: '{not json at all' });
    expect(loadLifetimeStats(storage)).toEqual(emptyLifetimeStats());
  });

  it('a JSON value that is not an object (e.g. a bare number or array) resets to empty', () => {
    for (const raw of ['42', '"a string"', '[1,2,3]', 'null', 'true']) {
      const storage = fakeStorage({ [LIFETIME_STATS_STORAGE_KEY]: raw });
      expect(loadLifetimeStats(storage)).toEqual(emptyLifetimeStats());
    }
  });

  it('missing fields default to zero/empty rather than throwing', () => {
    const storage = fakeStorage({ [LIFETIME_STATS_STORAGE_KEY]: JSON.stringify({ runsStarted: 5 }) });
    const loaded = loadLifetimeStats(storage);
    expect(loaded.runsStarted).toBe(5);
    expect(loaded.runsRetired).toBe(0);
    expect(loaded.bestRun).toEqual({ bossesCleared: 0, deepestWave: 0 });
    expect(loaded.totals).toEqual(emptyLifetimeStats().totals);
  });

  it('a malformed nested shape (bestRun/totals not objects) defaults those fields instead of throwing', () => {
    const storage = fakeStorage({
      [LIFETIME_STATS_STORAGE_KEY]: JSON.stringify({ runsStarted: 2, bestRun: 'oops', totals: null }),
    });
    expect(() => loadLifetimeStats(storage)).not.toThrow();
    const loaded = loadLifetimeStats(storage);
    expect(loaded.bestRun).toEqual({ bossesCleared: 0, deepestWave: 0 });
    expect(loaded.totals).toEqual(emptyLifetimeStats().totals);
  });

  it('wrong-typed / negative / NaN-ish field values default to 0 instead of propagating', () => {
    const storage = fakeStorage({
      [LIFETIME_STATS_STORAGE_KEY]: JSON.stringify({
        runsStarted: 'five',
        runsRetired: -3,
        runsDead: Number.POSITIVE_INFINITY,
        totalWins: null,
      }),
    });
    const loaded = loadLifetimeStats(storage);
    expect(loaded.runsStarted).toBe(0);
    expect(loaded.runsRetired).toBe(0);
    expect(loaded.runsDead).toBe(0);
    expect(loaded.totalWins).toBe(0);
  });

  it('a FUTURE schemaVersion still loads (best-effort field-by-field), never throws or resets to garbage', () => {
    const future: Record<string, unknown> = {
      schemaVersion: SCHEMA_VERSION + 5,
      runsStarted: 12,
      runsRetired: 4,
      runsDead: 1,
      totalFights: 20,
      totalWins: 15,
      totalLosses: 5,
      totalBossesCleared: 3,
      bestRun: { bossesCleared: 3, deepestWave: 9 },
      totals: {
        damageDealt: 500,
        damageTaken: 200,
        healingDone: 50,
        goldEarned: 80,
        goldSpent: 60,
        cardsBought: 6,
        gemsBought: 3,
        eventsResolved: 9,
        livesLost: 2,
      },
      // A field a future version might add that today's shape doesn't know about.
      someFutureField: { anything: true },
    };
    const storage = fakeStorage({ [LIFETIME_STATS_STORAGE_KEY]: JSON.stringify(future) });
    const loaded = loadLifetimeStats(storage);
    expect(loaded.schemaVersion).toBe(SCHEMA_VERSION); // normalized to what THIS build understands
    expect(loaded.runsStarted).toBe(12);
    expect(loaded.bestRun).toEqual({ bossesCleared: 3, deepestWave: 9 });
    expect(loaded.totals.damageDealt).toBe(500);
    expect('someFutureField' in loaded).toBe(false);
  });
});

describe('meta/lifetimeStats: StorageDriver seam stays DOM-free', () => {
  it('never calls anything beyond the injected get/set contract', () => {
    let gets = 0;
    let sets = 0;
    const spy: StorageDriver = {
      get: (key) => {
        gets += 1;
        return null;
      },
      set: (key, value) => {
        sets += 1;
      },
    };
    loadLifetimeStats(spy);
    saveLifetimeStats(spy, emptyLifetimeStats());
    expect(gets).toBe(1);
    expect(sets).toBe(1);
  });
});
