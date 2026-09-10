import { describe, expect, it } from 'vitest';
import {
  clearRun,
  loadRun,
  migrateV1Run,
  RUN_SAVE_BACKUP_KEY,
  RUN_SAVE_STORAGE_KEY,
  RUN_SAVE_V1_BACKUP_KEY,
  RUN_SAVE_V1_STORAGE_KEY,
  RUN_SAVE_V2_BACKUP_KEY,
  RUN_SAVE_V2_STORAGE_KEY,
  SCHEMA_VERSION,
  type RunStateV1,
  type RunStateV2,
  type StorageDriver,
} from '../../src/meta/runSave';
import { createRun } from '../../src/run/runState';
import { fakeStorage } from '../fixtures/storage';

function v1Run(): RunStateV1 {
  const {
    eventCallbackQueue: _queue,
    completedStoryIds: _completedStories,
    eventCallbackResolutionIds: _callbackResolutions,
    mapIntelByBand: _mapIntel,
    appliedMapInfoSourceIds: _mapInfoSources,
    combatFactLedger: _combatFacts,
    revengeFactLedger: _revengeFacts,
    signatureFactLedger: _signatureFacts,
    journeyFactLedger: _journeyFacts,
    eventBindingReservations: _reservations,
    eventMaterializations: _materializations,
    storyStateV3: _storyState,
    ...run
  } = createRun(1103);
  return {
    ...run,
    eventInstances: { 'd1-0': 'factors_ledger' },
    eventResolutions: {
      'd1-0': { eventId: 'factors_ledger', choiceId: 'standing_credit', pending: true },
    },
  };
}

function v2Run(seed: number): RunStateV2 {
  const {
    combatFactLedger: _combatFacts,
    revengeFactLedger: _revengeFacts,
    signatureFactLedger: _signatureFacts,
    journeyFactLedger: _journeyFacts,
    eventBindingReservations: _reservations,
    eventMaterializations: _materializations,
    storyStateV3: _storyState,
    eventCallbackQueue: _currentCallbacks,
    ...run
  } = createRun(seed);
  return { ...run, eventCallbackQueue: [] };
}

function v1Bytes(): string {
  return JSON.stringify({ schemaVersion: 1, run: v1Run() });
}

describe('meta/runSave v2 migration', () => {
  it('migrates a v1 string instance and versionless pending resolution without changing v1 bytes', () => {
    const legacy = v1Bytes();
    const storage = fakeStorage({ [RUN_SAVE_V1_STORAGE_KEY]: legacy });

    const loaded = loadRun(storage)!;

    expect(SCHEMA_VERSION).toBe(3);
    expect(loaded.eventInstances['d1-0']).toEqual({
      eventId: 'factors_ledger', contentVersion: 1, instanceId: 'legacy:d1-0', drawnDepth: 1,
    });
    expect(loaded.eventResolutions?.['d1-0']).toEqual({
      eventId: 'factors_ledger', contentVersion: 1, instanceId: 'legacy:d1-0', choiceId: 'standing_credit', pending: true,
    });
    expect(loaded.eventCallbackQueue).toEqual([]);
    expect(loaded.completedStoryIds).toEqual([]);
    expect(loaded.eventCallbackResolutionIds).toEqual([]);
    expect(loaded.mapIntelByBand).toEqual({});
    expect(loaded.appliedMapInfoSourceIds).toEqual([]);
    expect(storage.get(RUN_SAVE_V1_STORAGE_KEY)).toBe(legacy);
    expect(JSON.parse(storage.get(RUN_SAVE_STORAGE_KEY)!)).toMatchObject({ schemaVersion: 3 });
  });

  it('migrates through the exported v1 migration seam', () => {
    expect(migrateV1Run(v1Run()).eventInstances['d1-0']?.instanceId).toBe('legacy:d1-0');
  });

  it('does not resurrect a valid v1 save when the present v2 marker is JSON null', () => {
    const legacy = v1Bytes();
    const storage = fakeStorage({ [RUN_SAVE_V2_STORAGE_KEY]: 'null', [RUN_SAVE_V1_STORAGE_KEY]: legacy });

    expect(loadRun(storage)).toBeNull();
    expect(storage.get(RUN_SAVE_V1_STORAGE_KEY)).toBe(legacy);
  });

  it('uses a current v2 save in preference to a valid v1 save', () => {
    const historicalV2 = v2Run(2207);
    const legacy = v1Bytes();
    const storage = fakeStorage({
      [RUN_SAVE_V2_STORAGE_KEY]: JSON.stringify({ schemaVersion: 2, run: historicalV2 }),
      [RUN_SAVE_V1_STORAGE_KEY]: legacy,
    });

    expect(loadRun(storage)).toMatchObject(historicalV2);
    expect(storage.get(RUN_SAVE_V1_STORAGE_KEY)).toBe(legacy);
  });

  it('backs up corrupt v2 bytes under the v2 backup key and never falls back to v1', () => {
    const legacy = v1Bytes();
    const storage = fakeStorage({ [RUN_SAVE_V2_STORAGE_KEY]: '{v2 corrupt', [RUN_SAVE_V1_STORAGE_KEY]: legacy });

    expect(loadRun(storage)).toBeNull();
    expect(storage.get(RUN_SAVE_V2_BACKUP_KEY)).toBe('{v2 corrupt');
    expect(storage.get(RUN_SAVE_V1_STORAGE_KEY)).toBe(legacy);
  });

  it('backs up corrupt v1 bytes under the v1 backup key when v2 is absent', () => {
    const storage = fakeStorage({ [RUN_SAVE_V1_STORAGE_KEY]: '{v1 corrupt' });

    expect(loadRun(storage)).toBeNull();
    expect(storage.get(RUN_SAVE_V1_BACKUP_KEY)).toBe('{v1 corrupt');
    expect(storage.get(RUN_SAVE_BACKUP_KEY)).toBeNull();
  });

  it.each([
    ['a missing eventInstances ledger', { schemaVersion: 1, run: {} }],
    ['an array eventInstances ledger', { schemaVersion: 1, run: { eventInstances: [] } }],
    ['a non-string event instance', { schemaVersion: 1, run: { eventInstances: { node: 7 } } }],
    ['a malformed event resolution', { schemaVersion: 1, run: { eventInstances: {}, eventResolutions: { node: { eventId: 'factors_ledger' } } } }],
    ['a malformed map depth list', { schemaVersion: 1, run: { eventInstances: {}, map: { depths: 'not-an-array' } } }],
  ])('backs up malformed v1 input with %s and never throws or falls through', (_name, envelope) => {
    const raw = JSON.stringify(envelope);
    const storage = fakeStorage({ [RUN_SAVE_V1_STORAGE_KEY]: raw });

    expect(() => loadRun(storage)).not.toThrow();
    expect(loadRun(storage)).toBeNull();
    expect(storage.get(RUN_SAVE_V1_BACKUP_KEY)).toBe(raw);
    expect(storage.get(RUN_SAVE_STORAGE_KEY)).toBeNull();
  });

  it('refuses a present unsupported future v2 schema without loading v1 or backing it up', () => {
    const future = JSON.stringify({ schemaVersion: 3, run: createRun(991) });
    const storage = fakeStorage({ [RUN_SAVE_V2_STORAGE_KEY]: future, [RUN_SAVE_V1_STORAGE_KEY]: v1Bytes() });

    expect(loadRun(storage)).toBeNull();
    expect(storage.get(RUN_SAVE_V2_STORAGE_KEY)).toBe(future);
    expect(storage.get(RUN_SAVE_V2_BACKUP_KEY)).toBeNull();
  });

  it('returns the migrated run even when the one-time v2 write fails, preserving legacy bytes', () => {
    const legacy = v1Bytes();
    const values = new Map([[RUN_SAVE_V1_STORAGE_KEY, legacy]]);
    const writeFailure: StorageDriver = {
      get: (key) => values.get(key) ?? null,
      set: () => false,
    };

    expect(loadRun(writeFailure)?.eventInstances['d1-0']?.eventId).toBe('factors_ledger');
    expect(writeFailure.get(RUN_SAVE_STORAGE_KEY)).toBeNull();
    expect(writeFailure.get(RUN_SAVE_V1_STORAGE_KEY)).toBe(legacy);
  });

  it('reports a successful v2 tombstone write and never touches v1 bytes', () => {
    const legacy = v1Bytes();
    const storage = fakeStorage({ [RUN_SAVE_V1_STORAGE_KEY]: legacy });

    expect(clearRun(storage)).toEqual({ ok: true });

    expect(storage.get(RUN_SAVE_STORAGE_KEY)).toBe('null');
    expect(storage.get(RUN_SAVE_V1_STORAGE_KEY)).toBe(legacy);
  });

  it('reports a rejected tombstone write without claiming stale v2 bytes were cleared', () => {
    const stale = JSON.stringify({ schemaVersion: 2, run: createRun(144) });
    const storage: StorageDriver = {
      get: (key) => key === RUN_SAVE_STORAGE_KEY ? stale : null,
      set: () => false,
    };

    expect(clearRun(storage)).toEqual({ ok: false, reason: 'write-failed' });
    expect(storage.get(RUN_SAVE_STORAGE_KEY)).toBe(stale);
  });
});
