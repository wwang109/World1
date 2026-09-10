import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as devLaunch from '../../src/game/devLaunch';
import { RUN_SAVE_STORAGE_KEY } from '../../src/meta/runSave';
import { mapIntelRecords } from '../../src/run/eventMapInfo';
import type { RunState } from '../../src/run/runState';

const localStorageCells = new Map<string, string>();
const localStorageWrites: Array<{ key: string; value: string | null }> = [];

function stubLocalStorage(): void {
  vi.stubGlobal('window', {
    localStorage: {
      getItem: (key: string) => localStorageCells.get(key) ?? null,
      setItem: (key: string, value: string) => {
        localStorageWrites.push({ key, value });
        localStorageCells.set(key, value);
      },
      removeItem: (key: string) => {
        localStorageWrites.push({ key, value: null });
        localStorageCells.delete(key);
      },
    },
  });
}

beforeEach(() => {
  localStorageCells.clear();
  localStorageWrites.length = 0;
  stubLocalStorage();
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

type DevLaunchWithEventFixture = ReturnType<typeof devLaunch.readDevLaunchConfig> & {
  eventFixtureId?: string | null;
};

type DevLaunchFixtureModule = typeof devLaunch & {
  buildDevEventFixture?: (eventId: string, seed?: number) => RunState;
  shouldPreserveDrawingBufferForLayoutAudit?: (isDev: boolean, search: string) => boolean;
};

const FAR_SIGHT_FIXTURES = [
  'feathered_cairn',
  'far_sight_queued',
  'far_sight_due',
  'far_sight_reloaded',
  'far_sight_follow_mark',
  'far_sight_take_cache',
  'far_sight_ignore_mark',
  'map_intel_2',
  'map_intel_3',
] as const;

function firstInstanceId(state: RunState, eventId: string): string {
  const entry = Object.values(state.eventInstances).find((instance) => instance.eventId === eventId);
  if (!entry) throw new Error(`fixture did not commit ${eventId}`);
  return entry.instanceId;
}

/** Every launch recipe must park the scalar depth on the same real map node
 * it exposes as current. A fixture with a split `depth`/`currentNodeId` would
 * make source-relative callbacks look valid while corrupting other run reads. */
function currentFixtureNode(state: RunState) {
  const currentNodeId = state.currentNodeId;
  if (!currentNodeId) throw new Error('fixture did not keep an active event node');
  const node = state.map.depths.flat().find((candidate) => candidate.id === currentNodeId);
  if (!node) throw new Error(`fixture current node ${currentNodeId} is absent from its map`);
  expect(state.depth).toBe(node.depth);
  return node;
}

function currentFixtureInstance(state: RunState) {
  const node = currentFixtureNode(state);
  const instance = state.eventInstances[node.id];
  if (!instance) throw new Error(`fixture did not record its current event node ${node.id}`);
  return instance;
}

describe('development event launch fixture', () => {
  it('preserves WebGL drawing buffers only for the explicit development layout-audit route', () => {
    const decide = (devLaunch as DevLaunchFixtureModule).shouldPreserveDrawingBufferForLayoutAudit;
    expect(decide).toBeTypeOf('function');

    expect(decide!(true, '?layoutAudit=1')).toBe(true);
    expect(decide!(true, '?scene=desktop-runevent&layoutAudit=1')).toBe(true);
    expect(decide!(true, '')).toBe(false);
    expect(decide!(true, '?layoutAudit=0')).toBe(false);
    expect(decide!(false, '?layoutAudit=1')).toBe(false);
  });

  it('accepts the Bell and exact Far Sight fixture ids from ?eventFixture=', () => {
    expect(devLaunch.DEV_EVENT_FIXTURE_IDS).toEqual([
      'bell_beneath_ice', 'the_second_toll', 'the_bell_unbound', ...FAR_SIGHT_FIXTURES,
      'ember_pit', 'ruined_anvil',
    ]);
    for (const eventId of devLaunch.DEV_EVENT_FIXTURE_IDS) {
      const config = devLaunch.readDevLaunchConfig(`?scene=desktop-runevent&eventFixture=${eventId}`) as DevLaunchWithEventFixture;
      expect(config.eventFixtureId).toBe(eventId);
    }

    const unknown = devLaunch.readDevLaunchConfig('?scene=desktop-runevent&eventFixture=secret_spoiler') as DevLaunchWithEventFixture;
    expect(unknown.eventFixtureId).toBeNull();
  });

  it('parses the four exact desktop/mobile audit routes', () => {
    const routes = [
      ['?scene=desktop-runevent&eventFixture=feathered_cairn&layoutAudit=1', 'desktop-runevent', 'feathered_cairn'],
      ['?scene=mrunevent&eventFixture=far_sight_due&layoutAudit=1', 'mrunevent', 'far_sight_due'],
      ['?scene=desktop-runmap&eventFixture=map_intel_2&layoutAudit=1', 'desktop-runmap', 'map_intel_2'],
      ['?scene=mrunmap&eventFixture=map_intel_3&layoutAudit=1', 'mrunmap', 'map_intel_3'],
    ] as const;

    for (const [route, scene, eventFixtureId] of routes) {
      const config = devLaunch.readDevLaunchConfig(route) as DevLaunchWithEventFixture;
      expect(config.scene).toBe(scene);
      expect(config.eventFixtureId).toBe(eventFixtureId);
      expect(devLaunch.shouldPreserveDrawingBufferForLayoutAudit(true, route)).toBe(true);
    }
  });

  it('builds an active run parked on an event node with the requested stage memoized', () => {
    const buildFixture = (devLaunch as DevLaunchFixtureModule).buildDevEventFixture;
    expect(buildFixture).toBeTypeOf('function');

    const state = buildFixture!('bell_beneath_ice', 1103);
    const currentNode = currentFixtureNode(state);
    expect(state.status).toBe('active');
    expect(currentNode?.kind).toBe('event');
    expect(state.eventInstances[state.currentNodeId!]).toEqual({
      eventId: 'bell_beneath_ice',
      contentVersion: 1,
      instanceId: `event:${state.currentNodeId!}`,
      drawnDepth: currentNode!.depth,
    });
    expect(state.eventResolutions).toEqual({});
    expect(state.pieces.length + state.bagSlots.length).toBe(4);
  });

  it('seeds only the prerequisite resolutions needed for the requested recap', () => {
    const buildFixture = (devLaunch as DevLaunchFixtureModule).buildDevEventFixture;
    expect(buildFixture).toBeTypeOf('function');

    const stage2 = buildFixture!('the_second_toll', 1103);
    expect(Object.values(stage2.eventResolutions ?? {})).toEqual([
      { eventId: 'bell_beneath_ice', contentVersion: 1, instanceId: 'event:stage1', choiceId: 'prise_it_free' },
    ]);

    const stage3 = buildFixture!('the_bell_unbound', 1103);
    expect(Object.values(stage3.eventResolutions ?? {})).toEqual([
      { eventId: 'bell_beneath_ice', contentVersion: 1, instanceId: 'event:stage1', choiceId: 'prise_it_free' },
      { eventId: 'the_second_toll', contentVersion: 1, instanceId: 'event:stage2', choiceId: 'answer_the_bell' },
    ]);
  });

  it('builds every Far Sight fixture from committed v1 identities and typed production state', () => {
    const buildFixture = (devLaunch as DevLaunchFixtureModule).buildDevEventFixture;
    expect(buildFixture).toBeTypeOf('function');

    const fixtures = Object.fromEntries(FAR_SIGHT_FIXTURES.map((id) => [id, buildFixture!(id, 1103)])) as Record<(typeof FAR_SIGHT_FIXTURES)[number], RunState>;
    for (const state of Object.values(fixtures)) {
      expect(state.status).toBe('active');
      currentFixtureNode(state);
    }

    const source = fixtures.feathered_cairn;
    const sourceInstance = currentFixtureInstance(source);
    expect(sourceInstance).toEqual({
      eventId: 'feathered_cairn',
      contentVersion: 1,
      instanceId: `event:${source.currentNodeId!}`,
      drawnDepth: source.map.depths.flat().find((node) => node.id === source.currentNodeId)!.depth,
    });
    expect(source.eventResolutions).toEqual({});
    expect(mapIntelRecords(source)).toEqual([]);

    const queued = fixtures.far_sight_queued;
    const queuedSourceId = firstInstanceId(queued, 'feathered_cairn');
    expect(queued.eventResolutions?.[queued.currentNodeId!]).toEqual({
      eventId: 'feathered_cairn', contentVersion: 1, instanceId: queuedSourceId, choiceId: 'read_feathers',
    });
    expect(queued.eventCallbackQueue).toHaveLength(1);
    expect(queued.eventCallbackQueue[0]).toMatchObject({
      callbackId: 'feathered_cairn_far_sight', eventId: 'feathered_cairn_far_sight', contentVersion: 1,
      scheduledDepth: sourceInstance.drawnDepth, earliestDepth: sourceInstance.drawnDepth + 2,
      minDepthDelay: 2, destinationThemes: ['omen'], destinationBiomeIds: ['arrowfell'], priority: 700,
      boundSubjects: {}, expiry: { expiresAfterNodes: 20, fallback: 'discard' },
    });
    expect(mapIntelRecords(queued).map((record) => ({ band: record.band, source: record.sourceEventInstanceId }))).toEqual([
      { band: 1, source: queuedSourceId }, { band: 2, source: queuedSourceId },
    ]);

    const due = fixtures.far_sight_due;
    const dueInstance = currentFixtureInstance(due);
    expect(dueInstance).toMatchObject({
      eventId: 'feathered_cairn_far_sight', contentVersion: 1, instanceId: `event:${due.currentNodeId!}`,
      callbackInstanceId: queued.eventCallbackQueue[0]!.callbackInstanceId,
    });
    expect(due.eventCallbackQueue).toEqual([]);
    const dueNode = due.map.depths.flat().find((node) => node.id === due.currentNodeId)!;
    expect(dueNode).toMatchObject({ kind: 'event', eventTheme: 'omen', biomeId: 'arrowfell', depth: sourceInstance.drawnDepth + 2 });
    expect(fixtures.far_sight_reloaded).toEqual(due);

    const follow = fixtures.far_sight_follow_mark;
    expect(follow.eventResolutions?.[follow.currentNodeId!]).toEqual({
      eventId: 'feathered_cairn_far_sight', contentVersion: 1, instanceId: firstInstanceId(follow, 'feathered_cairn_far_sight'), choiceId: 'follow_mark',
    });
    expect(mapIntelRecords(follow).map((record) => ({ band: record.band, source: record.sourceEventInstanceId }))).toEqual([
      { band: 1, source: firstInstanceId(follow, 'feathered_cairn') },
      { band: 2, source: firstInstanceId(follow, 'feathered_cairn') },
      { band: 3, source: firstInstanceId(follow, 'feathered_cairn_far_sight') },
    ]);

    const cache = fixtures.far_sight_take_cache;
    expect(cache.eventResolutions?.[cache.currentNodeId!]).toEqual({
      eventId: 'feathered_cairn_far_sight', contentVersion: 1, instanceId: firstInstanceId(cache, 'feathered_cairn_far_sight'), choiceId: 'take_cache', pending: true,
    });
    expect(mapIntelRecords(cache).map((record) => record.band)).toEqual([1, 2]);

    const ignored = fixtures.far_sight_ignore_mark;
    expect(ignored.eventResolutions?.[ignored.currentNodeId!]).toEqual({
      eventId: 'feathered_cairn_far_sight', contentVersion: 1, instanceId: firstInstanceId(ignored, 'feathered_cairn_far_sight'), choiceId: 'ignore_mark',
    });
    expect(mapIntelRecords(ignored).map((record) => record.band)).toEqual([1, 2]);
    expect(mapIntelRecords(fixtures.map_intel_2)).toEqual(mapIntelRecords(queued));
    expect(mapIntelRecords(fixtures.map_intel_3)).toEqual(mapIntelRecords(follow));
  });

  it('keeps every exact fixture depth on its exposed current map node', () => {
    const buildFixture = (devLaunch as DevLaunchFixtureModule).buildDevEventFixture;
    expect(buildFixture).toBeTypeOf('function');

    for (const eventId of devLaunch.DEV_EVENT_FIXTURE_IDS) {
      currentFixtureNode(buildFixture!(eventId, 1103));
    }
  });

  /** `ember_pit` and `ruined_anvil` are the catalog's two `mergeCards` doors —
   * proving the fixture reaches the row is not enough; a board with nothing
   * to merge renders that row LOCKED ("need 3 cards of one grade") and the
   * confirm this fixture exists to reach is never seen. `mergeCardsPreview`
   * is the exported read `runEventScenePresenter.ts`'s own row/preview logic
   * calls, and it returns null on exactly the same condition
   * (`choiceLockReason`'s private `mergeCardsPlan(state) === null`) that
   * would lock the row — so a non-null preview here IS an unlocked row, not
   * a proxy for one. */
  it('arms ember_pit and ruined_anvil with an UNLOCKED mergeCards rung, not a locked one', async () => {
    const { mergeCardsPreview } = await import('../../src/run/events');
    const buildFixture = (devLaunch as DevLaunchFixtureModule).buildDevEventFixture;
    expect(buildFixture).toBeTypeOf('function');

    for (const eventId of ['ember_pit', 'ruined_anvil'] as const) {
      const state = buildFixture!(eventId, 1103);
      expect(mergeCardsPreview(state), `${eventId}: no mergeable trio on the fixture's armed board`).not.toBeNull();
      // Deterministic, not incidental: same three instance ids every call.
      const again = buildFixture!(eventId, 1103);
      expect(again.bagSlots.slice(0, 3)).toEqual(state.bagSlots.slice(0, 3));
      expect(state.pieces).toEqual([]);
    }
  });
});

describe('ephemeral event fixtures', () => {
  it('never writes a resumable run save, including during fixture event lookup', async () => {
    const runStore = await import('../../src/game/runStore');
    const buildFixture = (devLaunch as DevLaunchFixtureModule).buildDevEventFixture!;
    const fixture = buildFixture('bell_beneath_ice', 1103);

    runStore.installDevRunFixture(fixture);
    expect(runStore.getActiveRun()).toEqual(fixture);

    // Lookup crosses the normal run-store update seam; fixture state must
    // remain ephemeral after installation too.
    expect(runStore.currentEventDef()?.id).toBe('bell_beneath_ice');
    expect(localStorageWrites).toEqual([]);
    expect(localStorageCells.has(RUN_SAVE_STORAGE_KEY)).toBe(false);
  });

  it('cannot create a fixture-derived resume on the next ordinary launch', async () => {
    const fixtureStore = await import('../../src/game/runStore');
    const buildFixture = (devLaunch as DevLaunchFixtureModule).buildDevEventFixture!;
    fixtureStore.installDevRunFixture(buildFixture('bell_beneath_ice', 1103));
    expect(fixtureStore.currentEventDef()?.id).toBe('bell_beneath_ice');

    vi.resetModules();
    const ordinaryStore = await import('../../src/game/runStore');

    expect(ordinaryStore.getActiveRun()).toBeNull();
    expect(localStorageCells.has(RUN_SAVE_STORAGE_KEY)).toBe(false);
  });

  it('leaves a legitimate pre-existing save byte-for-byte unchanged', async () => {
    const ordinaryStore = await import('../../src/game/runStore');
    ordinaryStore.startRun(0x51a7e);
    const savedBeforeFixture = localStorageCells.get(RUN_SAVE_STORAGE_KEY);
    expect(savedBeforeFixture).toBeTypeOf('string');
    localStorageWrites.length = 0;

    const buildFixture = (devLaunch as DevLaunchFixtureModule).buildDevEventFixture!;
    ordinaryStore.installDevRunFixture(buildFixture('bell_beneath_ice', 1103));
    expect(ordinaryStore.currentEventDef()?.id).toBe('bell_beneath_ice');

    expect(localStorageWrites).toEqual([]);
    expect(localStorageCells.get(RUN_SAVE_STORAGE_KEY)).toBe(savedBeforeFixture);

    vi.resetModules();
    const nextOrdinaryStore = await import('../../src/game/runStore');
    expect(nextOrdinaryStore.getActiveRun()?.seed).toBe(0x51a7e);
  });

  it('keeps every Far Sight fixture and its persisted map intel out of the v2 save key', async () => {
    const runStore = await import('../../src/game/runStore');
    const buildFixture = (devLaunch as DevLaunchFixtureModule).buildDevEventFixture!;
    const storeWithIntel = runStore as typeof runStore & { currentMapIntel?: () => ReturnType<typeof mapIntelRecords> };
    expect(storeWithIntel.currentMapIntel).toBeTypeOf('function');

    for (const eventId of FAR_SIGHT_FIXTURES) {
      const fixture = buildFixture(eventId, 1103);
      runStore.installDevRunFixture(fixture);
      expect(storeWithIntel.currentMapIntel!()).toEqual(mapIntelRecords(fixture));
      runStore.currentEventDef();
    }

    expect(localStorageWrites).toEqual([]);
    expect(localStorageCells.has(RUN_SAVE_STORAGE_KEY)).toBe(false);
  });
});
