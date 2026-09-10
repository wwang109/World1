import { describe, expect, it } from 'vitest';
import type { EventMonoTypeBindingValueV3 } from '../../src/data/eventContentV3';
import {
  clearRun,
  loadRun,
  migrateV1RunToV2,
  migrateV2Run,
  RUN_SAVE_BACKUP_KEY,
  RUN_SAVE_V1_BACKUP_KEY,
  RUN_SAVE_V1_STORAGE_KEY,
  RUN_SAVE_V2_BACKUP_KEY,
  RUN_SAVE_STORAGE_KEY,
  RUN_SAVE_V2_STORAGE_KEY,
  saveRun,
  SCHEMA_VERSION,
  type RunStateV1,
  type RunStateV2,
  type StorageDriver,
} from '../../src/meta/runSave';
import { forecastBand } from '../../src/run/biomeForecast';
import { gemBook } from '../../src/data/gems';
import type { EventDeferredOfferV3 } from '../../src/run/eventV3Materialization';
import type {
  EventInstanceRecord,
  EventInstanceRecordV2,
} from '../../src/run/eventInstances';
import {
  createRun,
  type EventCallbackQueueEntryV2,
  type EventCallbackQueueEntryV3,
  type RunState,
} from '../../src/run/runState';
import { fakeStorage } from '../fixtures/storage';

const REAL_MONO_CALLBACK = 'mirror_transformation';
const REAL_DESTINATION_CALLBACK = 'missing_road_destination';

type Assert<T extends true> = T;
type Equal<TLeft, TRight> =
  (<T>() => T extends TLeft ? 1 : 2) extends (<T>() => T extends TRight ? 1 : 2)
    ? (<T>() => T extends TRight ? 1 : 2) extends (<T>() => T extends TLeft ? 1 : 2)
      ? true
      : false
    : false;

type ShippedV1Keys =
  | 'seed' | 'map' | 'status' | 'depth' | 'lives' | 'bossesCleared' | 'currentNodeId'
  | 'pieces' | 'bagSlots' | 'held' | 'draft' | 'gemInventory' | 'nextCardInstanceId'
  | 'shopShelves' | 'eventBag' | 'eventBagRefills' | 'eventThemeBags'
  | 'eventThemeBagRefills' | 'eventInstances' | 'eventResolutions'
  | 'gold' | 'heroLevel' | 'heroAllocation' | 'wins' | 'losses' | 'stats';

type V2OrV3OnlyKeys =
  | 'eventCallbackQueue' | 'completedStoryIds' | 'eventCallbackResolutionIds'
  | 'mapIntelByBand' | 'appliedMapInfoSourceIds'
  | 'combatFactLedger' | 'revengeFactLedger' | 'signatureFactLedger'
  | 'journeyFactLedger' | 'eventBindingReservations' | 'eventMaterializations'
  | 'storyStateV3';

type _V1HasExactShippedKeys = Assert<Equal<keyof RunStateV1, ShippedV1Keys>>;
type _V1ExcludesEveryLaterKey = Assert<Equal<Extract<keyof RunStateV1, V2OrV3OnlyKeys>, never>>;
type _V1UsesStringInstances = Assert<Equal<RunStateV1['eventInstances'], Record<string, string>>>;
type _HistoricalRecordExcludesBinding = Assert<Equal<
  Extract<keyof EventInstanceRecordV2, 'boundSubjects'>,
  never
>>;
type _V2StateRecordExcludesBinding = Assert<Equal<
  Extract<keyof RunStateV2['eventInstances'][string], 'boundSubjects'>,
  never
>>;
type _CurrentRecordIncludesBinding = Assert<Equal<
  Extract<keyof EventInstanceRecord, 'boundSubjects'>,
  'boundSubjects'
>>;
type _CurrentStateRecordIncludesBinding = Assert<Equal<
  Extract<keyof RunState['eventInstances'][string], 'boundSubjects'>,
  'boundSubjects'
>>;
type _HistoricalQueueIsExactlyV2 = Assert<Equal<
  RunStateV2['eventCallbackQueue'][number],
  EventCallbackQueueEntryV2
>>;
type _HistoricalQueueExcludesStructuredMono = Assert<Equal<
  Extract<RunStateV2['eventCallbackQueue'][number]['boundSubjects']['mono_type'], object>,
  never
>>;
type _CurrentQueueIncludesV3 = Assert<
  EventCallbackQueueEntryV3 extends RunState['eventCallbackQueue'][number] ? true : false
>;
type _CurrentV3QueueUsesStructuredMono = Assert<Equal<
  EventCallbackQueueEntryV3['boundSubjects']['mono_type'],
  EventMonoTypeBindingValueV3 | undefined
>>;

const V3_DEFAULTS = {
  combatFactLedger: [],
  revengeFactLedger: [],
  signatureFactLedger: [],
  journeyFactLedger: { visitedBiomeIds: [] },
  eventBindingReservations: [],
  eventMaterializations: {},
  storyStateV3: {
    oath_mercy: false,
    grave_path: 'none',
    honorable_choice: false,
    reliquary_oath: false,
    oath_gate: 'none',
    venom_bloom: 'none',
    rival_spared: false,
    moon_quarry_released: false,
  },
} as const;

/**
 * Historical schema-v2 fixture captured while createRun still returned v2.
 * Every v3 field is named and removed so the fixture remains schema-v2 after
 * createRun advances; the assertions make an accidentally-added v3 field loud.
 */
function historicalV2Run(seed: number): RunStateV2 {
  const current = createRun(seed);
  const {
    combatFactLedger,
    revengeFactLedger,
    signatureFactLedger,
    journeyFactLedger,
    eventBindingReservations,
    eventMaterializations,
    storyStateV3,
    eventCallbackQueue: _currentCallbacks,
    ...v2
  } = current;
  expect({
    combatFactLedger,
    revengeFactLedger,
    signatureFactLedger,
    journeyFactLedger,
    eventBindingReservations,
    eventMaterializations,
    storyStateV3,
  }).toEqual(V3_DEFAULTS);
  return { ...v2, eventCallbackQueue: [] };
}

function historicalV1Run(seed: number): RunStateV1 {
  const {
    eventCallbackQueue: _callbacks,
    completedStoryIds: _completedStories,
    eventCallbackResolutionIds: _callbackResolutions,
    mapIntelByBand: _mapIntel,
    appliedMapInfoSourceIds: _mapInfoSources,
    ...v1Base
  } = historicalV2Run(seed);
  return {
    ...v1Base,
    eventInstances: { 'd1-0': 'factors_ledger' },
    eventResolutions: {
      'd1-0': { eventId: 'factors_ledger', choiceId: 'standing_credit', pending: true },
    },
  };
}

/**
 * A historical schema-v1 event resolution whose (eventId, contentVersion)
 * now resolves to a schema-3 event definition — the reachable shape of the
 * "resumes once, then unloadable forever" migration defect: no legacy
 * catalog event is schema-3 today, but any future re-authoring of an
 * existing event id/contentVersion pair to schema 3 makes an old save
 * carrying that exact resolution hit this path. `REAL_MONO_CALLBACK` at
 * contentVersion 1 is a real, currently-shipping schema-3 definition
 * (`src/data/content/events.v3.json`), reused here rather than invented so
 * the fixture proves the real catalog lookup, not a synthetic stand-in.
 */
function historicalV1RunWithSchema3Resolution(seed: number): RunStateV1 {
  const run = historicalV1Run(seed);
  return {
    ...run,
    eventInstances: { 'd1-0': REAL_MONO_CALLBACK },
    eventResolutions: { 'd1-0': { eventId: REAL_MONO_CALLBACK, choiceId: 'take' } },
  };
}

/** Schema-v2 counterpart of {@link historicalV1RunWithSchema3Resolution}. */
function historicalV2RunWithSchema3Resolution(seed: number): RunStateV2 {
  const run = historicalV2Run(seed);
  return {
    ...run,
    eventInstances: {
      'd1-0': { eventId: REAL_MONO_CALLBACK, contentVersion: 1, instanceId: 'legacy:d1-0', drawnDepth: 1 },
    },
    eventResolutions: {
      'd1-0': { eventId: REAL_MONO_CALLBACK, contentVersion: 1, instanceId: 'legacy:d1-0', choiceId: 'take' },
    },
  };
}

function validCombatFact(): Record<string, unknown> {
  return {
    battleId: 'battle:d3-1', nodeId: 'd3-1', depth: 3, biomeId: 'arrowfell',
    enemyIds: ['bandit_duelist'], result: 'win', boss: false, turns: 5,
    affinityId: 'sword', usedCardIds: ['sword_slash'], statusKinds: ['burn'],
    actionKinds: ['damage'], finisherCardId: 'sword_slash',
  };
}

function validRevengeFact(): Record<string, unknown> {
  return {
    battleId: 'battle:d3-1', enemyId: 'bandit_duelist', finisherCardId: 'sword_slash',
    achievedDepth: 3, status: 'reserved', reservedByInstanceId: 'event:d4-1',
  };
}

function validSignatureFact(): Record<string, unknown> {
  return {
    battleId: 'battle:d3-1', cardId: 'sword_slash', achievedDepth: 3,
    bossFinisher: true, status: 'consumed', reservedByInstanceId: 'event:d4-1',
  };
}

function validReservation(): Record<string, unknown> {
  return {
    reservationId: 'reservation:1', instanceId: 'event:d4-1', source: 'revenge',
    sourceBattleId: 'battle:d3-1', subjectId: 'bandit_duelist',
  };
}

function validMaterialization(): Record<string, unknown> {
  return {
    eventInstanceId: 'event:d4-1',
    choiceIds: ['take', 'leave'],
    selectedWeightedBranchIds: { take: 'rare' },
    unavailableChoiceReasonsByChoiceId: {},
    boundSubjects: {
      enemy_id: 'bandit_duelist',
      mono_type: { typeKind: 'weapon', type: 'sword' },
    },
    deferredOffersByChoiceId: {
      take: {
        kind: 'cardChoice', status: 'pending',
        options: [
          { skillId: 'sword_slash', tier: 'bronze' },
          { skillId: 'twin_slash', tier: 'silver' },
          { skillId: 'sworn_edge', tier: 'gold' },
        ],
      },
      leave: {
        kind: 'upgradeCardTargeted', status: 'settled', optionInstanceIds: ['card:1'],
        fallback: { kind: 'grantGold', amount: 2 }, selectedInstanceId: 'card:1',
      },
    },
  };
}

function expectMalformedV3BackedUp(mutate: (run: Record<string, unknown>) => void): void {
  const run = JSON.parse(JSON.stringify(createRun(7001))) as Record<string, unknown>;
  mutate(run);
  const raw = JSON.stringify({ schemaVersion: 3, run });
  const storage = fakeStorage({ [RUN_SAVE_STORAGE_KEY]: raw });

  expect(loadRun(storage)).toBeNull();
  expect(storage.get(RUN_SAVE_BACKUP_KEY)).toBe(raw);
  expect(storage.get(RUN_SAVE_STORAGE_KEY)).toBe(raw);
}

function v3TopologyRun(): RunState {
  const run = createRun(7100);
  const gems = Object.keys(gemBook).slice(0, 3) as [string, string, string];
  run.eventInstances = {
    'd1-0': {
      eventId: 'known_v3_callback', contentVersion: 3,
      instanceId: 'event:d1-0', drawnDepth: 1,
    },
  };
  run.eventMaterializations = {
    'event:d1-0': {
      eventInstanceId: 'event:d1-0', choiceIds: ['take', 'leave'],
      selectedWeightedBranchIds: {}, unavailableChoiceReasonsByChoiceId: {}, boundSubjects: {},
      deferredOffersByChoiceId: {
        take: { kind: 'gemChoice', status: 'pending', optionGemIds: gems },
        leave: { kind: 'gemChoice', status: 'pending', optionGemIds: gems },
      },
    },
  };
  run.eventResolutions = {
    'd1-0': {
      eventId: 'known_v3_callback', contentVersion: 3,
      instanceId: 'event:d1-0', choiceId: 'take', pending: true,
    },
  };
  return run;
}

function expectRunBackedUpExactly(run: RunState): void {
  const raw = JSON.stringify({ schemaVersion: 3, run });
  const storage = fakeStorage({ [RUN_SAVE_STORAGE_KEY]: raw });
  expect(loadRun(storage)).toBeNull();
  expect(storage.get(RUN_SAVE_BACKUP_KEY)).toBe(raw);
  expect(storage.get(RUN_SAVE_STORAGE_KEY)).toBe(raw);
}

function expectSavedRunBackedUpExactly(run: RunState): void {
  const storage = fakeStorage();
  expect(saveRun(storage, run)).toEqual({ ok: true });
  const raw = storage.get(RUN_SAVE_STORAGE_KEY);
  expect(raw).not.toBeNull();
  expect(loadRun(storage)).toBeNull();
  expect(storage.get(RUN_SAVE_BACKUP_KEY)).toBe(raw);
  expect(storage.get(RUN_SAVE_STORAGE_KEY)).toBe(raw);
}

describe('meta/runSave v3 foundation', () => {
  it('normalizes older schema-v3 materializations without unavailable-choice metadata', () => {
    const legacy = v3TopologyRun() as unknown as Record<string, unknown>;
    const materializations = legacy.eventMaterializations as Record<string, Record<string, unknown>>;
    delete materializations['event:d1-0']!.unavailableChoiceReasonsByChoiceId;
    const storage = fakeStorage({
      [RUN_SAVE_STORAGE_KEY]: JSON.stringify({ schemaVersion: 3, run: legacy }),
    });

    expect(loadRun(storage)?.eventMaterializations['event:d1-0']?.unavailableChoiceReasonsByChoiceId)
      .toEqual({});

    const saved = fakeStorage();
    expect(saveRun(saved, legacy as unknown as RunState)).toEqual({ ok: true });
    const written = JSON.parse(saved.get(RUN_SAVE_STORAGE_KEY)!) as {
      run: { eventMaterializations: Record<string, Record<string, unknown>> };
    };
    expect(written.run.eventMaterializations['event:d1-0']?.unavailableChoiceReasonsByChoiceId)
      .toEqual({});
  });

  it('round-trips valid v3 pending, settled, unchosen-pending, and deterministic topology', () => {
    const pending = v3TopologyRun();
    const pendingStorage = fakeStorage();
    expect(saveRun(pendingStorage, pending)).toEqual({ ok: true });
    expect(loadRun(pendingStorage)).toEqual(pending);

    const settled = structuredClone(pending);
    const selected = settled.eventMaterializations['event:d1-0']!.deferredOffersByChoiceId.take;
    if (selected?.kind !== 'gemChoice' || selected.status !== 'pending') throw new Error('bad fixture');
    settled.eventMaterializations = {
      'event:d1-0': {
        ...settled.eventMaterializations['event:d1-0']!,
        deferredOffersByChoiceId: {
          ...settled.eventMaterializations['event:d1-0']!.deferredOffersByChoiceId,
          take: { ...selected, status: 'settled', selectedId: selected.optionGemIds[0]! },
        },
      },
    };
    settled.eventResolutions = {
      'd1-0': { ...settled.eventResolutions!['d1-0']!, pending: undefined },
    };
    const settledStorage = fakeStorage();
    expect(saveRun(settledStorage, settled)).toEqual({ ok: true });
    expect(loadRun(settledStorage)).toEqual(settled);

    const deterministic = structuredClone(pending);
    deterministic.eventMaterializations = {
      ...deterministic.eventMaterializations,
      'event:d1-0': {
        ...deterministic.eventMaterializations['event:d1-0']!, deferredOffersByChoiceId: {},
      },
    };
    deterministic.eventResolutions = {
      'd1-0': { ...deterministic.eventResolutions!['d1-0']!, pending: undefined },
    };
    const deterministicStorage = fakeStorage();
    expect(saveRun(deterministicStorage, deterministic)).toEqual({ ok: true });
    expect(loadRun(deterministicStorage)).toEqual(deterministic);
  });

  it.each([
    ['orphan materialization', (run: RunState) => { run.eventInstances = {}; }],
    ['resolution event id', (run: RunState) => { run.eventResolutions!['d1-0']!.eventId = 'wrong'; }],
    ['resolution version', (run: RunState) => { run.eventResolutions!['d1-0']!.contentVersion = 2; }],
    ['resolution instance', (run: RunState) => { run.eventResolutions!['d1-0']!.instanceId = 'event:wrong'; }],
    ['resolution choice', (run: RunState) => { run.eventResolutions!['d1-0']!.choiceId = 'missing'; }],
    ['pending missing offer', (run: RunState) => {
      run.eventMaterializations = {
        ...run.eventMaterializations,
        'event:d1-0': { ...run.eventMaterializations['event:d1-0']!, deferredOffersByChoiceId: {} },
      };
    }],
    ['pending settled offer', (run: RunState) => {
      const record = run.eventMaterializations['event:d1-0']!;
      const offer = record.deferredOffersByChoiceId.take;
      if (offer?.kind !== 'gemChoice' || offer.status !== 'pending') throw new Error('bad fixture');
      run.eventMaterializations = {
        ...run.eventMaterializations,
        'event:d1-0': {
          ...record, deferredOffersByChoiceId: {
            ...record.deferredOffersByChoiceId,
            take: { ...offer, status: 'settled', selectedId: offer.optionGemIds[0]! },
          },
        },
      };
    }],
  ])('backs up corrupt v3 topology byte-exactly: %s', (_name, mutate) => {
    const run = v3TopologyRun();
    mutate(run);
    expectRunBackedUpExactly(run);
  });

  it.each([
    ['settled offer without a resolution', (run: RunState) => {
      const materialization = run.eventMaterializations['event:d1-0']!;
      const offer = materialization.deferredOffersByChoiceId.take;
      if (offer?.kind !== 'gemChoice' || offer.status !== 'pending') throw new Error('bad fixture');
      run.eventMaterializations = {
        'event:d1-0': {
          ...materialization,
          deferredOffersByChoiceId: {
            ...materialization.deferredOffersByChoiceId,
            take: { ...offer, status: 'settled', selectedId: offer.optionGemIds[0]! },
          },
        },
      };
      run.eventResolutions = {};
    }],
    ['settled offer on the unchosen choice', (run: RunState) => {
      const materialization = run.eventMaterializations['event:d1-0']!;
      const offer = materialization.deferredOffersByChoiceId.leave;
      if (offer?.kind !== 'gemChoice' || offer.status !== 'pending') throw new Error('bad fixture');
      run.eventMaterializations = {
        'event:d1-0': {
          ...materialization,
          deferredOffersByChoiceId: {
            ...materialization.deferredOffersByChoiceId,
            leave: { ...offer, status: 'settled', selectedId: offer.optionGemIds[0]! },
          },
        },
      };
    }],
  ] as const)('backs up saved impossible terminal offer topology byte-exactly: %s', (_name, mutate) => {
    const run = v3TopologyRun();
    mutate(run);
    expectSavedRunBackedUpExactly(run);
  });

  it.each([
    ['non-adjacent merge tiers', (offer: Record<string, unknown>) => { offer.to = 'gold'; }],
    ['candidate tier differs from merge output', (offer: Record<string, unknown>) => {
      const candidates = offer.candidates as Array<Record<string, unknown>>;
      candidates[0]!.tier = 'diamond';
    }],
    ['duplicate consumed location', (offer: Record<string, unknown>) => {
      const consumed = offer.consumed as Array<Record<string, unknown>>;
      consumed[1]!.location = consumed[0]!.location;
      consumed[1]!.index = consumed[0]!.index;
    }],
  ])('backs up mechanically impossible persisted offers byte-exactly: %s', (_name, mutate) => {
    const run = v3TopologyRun();
    const materialization = run.eventMaterializations['event:d1-0']!;
    const merge: Record<string, unknown> = {
      kind: 'mergeCards', status: 'pending', from: 'bronze', to: 'silver',
      consumed: [
        { instanceId: 'a', skillId: 'sword_slash', tier: 'bronze', location: 'bag', index: 0 },
        { instanceId: 'b', skillId: 'twin_slash', tier: 'bronze', location: 'bag', index: 1 },
        { instanceId: 'c', skillId: 'sworn_edge', tier: 'bronze', location: 'board', index: 0 },
      ],
      candidates: [{ skillId: 'sword_slash', tier: 'silver' }],
      fallback: { kind: 'grantGold', amount: 2 },
    };
    mutate(merge);
    run.eventMaterializations = {
      ...run.eventMaterializations,
      'event:d1-0': { ...materialization, deferredOffersByChoiceId: { take: merge as never } },
    };
    expectRunBackedUpExactly(run);
  });

  it('backs up a gem choice that is not exactly three distinct known ids', () => {
    const run = v3TopologyRun();
    const record = run.eventMaterializations['event:d1-0']!;
    const offer = record.deferredOffersByChoiceId.take;
    if (offer?.kind !== 'gemChoice' || offer.status !== 'pending') throw new Error('bad fixture');
    run.eventMaterializations = {
      ...run.eventMaterializations,
      'event:d1-0': {
        ...record, deferredOffersByChoiceId: {
          ...record.deferredOffersByChoiceId,
          take: { ...offer, optionGemIds: [offer.optionGemIds[0]!] as never },
        },
      },
    };
    expectRunBackedUpExactly(run);
  });

  it('round-trips every closed v3 persisted legacy-outcome commitment', () => {
    const gemId = Object.keys(gemBook)[0]!;
    const run = createRun(7000);
    const offers: Record<string, EventDeferredOfferV3> = {
      card: { kind: 'grantCard', status: 'pending', card: { skillId: 'sword_slash', tier: 'bronze' } },
      gem: { kind: 'grantGem', status: 'settled', gemId },
      draft: { kind: 'bonusDraft', status: 'pending', options: [
        { skillId: 'sword_slash', tier: 'bronze' },
        { skillId: 'twin_slash', tier: 'bronze' },
        { skillId: 'sworn_edge', tier: 'bronze' },
        { skillId: 'aegis_wall', tier: 'bronze' },
        { skillId: 'arcane_bolt', tier: 'bronze' },
      ] },
      gems: {
        kind: 'gemChoice', status: 'pending',
        optionGemIds: Object.keys(gemBook).slice(0, 3) as [string, string, string],
      },
      upgrade: { kind: 'upgradeCard', status: 'pending', optionInstanceIds: ['card:1'], fallback: { kind: 'grantGold', amount: 2 } },
      sell: { kind: 'sellGem', status: 'pending', options: [{ pouchIndex: 0, gemId, price: 1 }] },
      sellUnavailable: { kind: 'sellGem', status: 'unavailable' },
      mergeUnavailable: { kind: 'mergeCards', status: 'unavailable' },
      merge: {
        kind: 'mergeCards', status: 'pending', from: 'bronze', to: 'silver',
        consumed: [
          { instanceId: 'card:1', skillId: 'sword_slash', tier: 'bronze', location: 'bag', index: 0 },
          { instanceId: 'card:2', skillId: 'twin_slash', tier: 'bronze', location: 'bag', index: 1 },
          { instanceId: 'card:3', skillId: 'sworn_edge', tier: 'bronze', location: 'board', index: 0 },
        ],
        candidates: [
          { skillId: 'twin_slash', tier: 'silver' },
          { skillId: 'sworn_edge', tier: 'silver' },
          { skillId: 'sword_slash', tier: 'silver' },
        ], fallback: { kind: 'grantGold', amount: 2 },
      },
    };
    run.eventMaterializations = Object.fromEntries(Object.entries(offers).map(([choiceId, offer]) => {
      const eventInstanceId = `event:${choiceId}`;
      return [eventInstanceId, {
        eventInstanceId,
        choiceIds: [choiceId, 'leave'],
        selectedWeightedBranchIds: {},
        unavailableChoiceReasonsByChoiceId: {},
        boundSubjects: {},
        deferredOffersByChoiceId: { [choiceId]: offer },
      }];
    }));
    run.eventInstances = Object.fromEntries(Object.keys(run.eventMaterializations).map((instanceId, index) => [
      `offer-node:${String(index)}`,
      { eventId: `offer:${String(index)}`, contentVersion: 1, instanceId, drawnDepth: index },
    ]));
    run.eventResolutions = {
      'offer-node:1': {
        eventId: 'offer:1', contentVersion: 1, instanceId: 'event:gem', choiceId: 'gem',
      },
    };
    const storage = fakeStorage();
    expect(saveRun(storage, run)).toEqual({ ok: true });
    expect(loadRun(storage)).toEqual(run);
  });

  it('backs up malformed or duplicate identities in new v3 commitments', () => {
    expectMalformedV3BackedUp((run) => {
      run.eventMaterializations = { bad: validMaterialization() };
    });
    expectMalformedV3BackedUp((run) => {
      run.eventMaterializations = {
        'event:d4-1': {
          ...validMaterialization(),
          deferredOffersByChoiceId: { x: { kind: 'gemChoice', status: 'pending', optionGemIds: ['missing_gem'] } },
        },
      };
    });
    expectMalformedV3BackedUp((run) => {
      run.eventMaterializations = {
        'event:d4-1': {
          ...validMaterialization(),
          deferredOffersByChoiceId: { x: {
            kind: 'bonusDraft', status: 'pending',
            options: [{ skillId: 'sword_slash', tier: 'bronze' }, { skillId: 'sword_slash', tier: 'bronze' }],
          } },
        },
      };
    });
    expectMalformedV3BackedUp((run) => {
      run.eventMaterializations = {
        'event:d4-1': { ...validMaterialization(), choiceIds: ['take', 'take'] },
      };
    });
    expectMalformedV3BackedUp((run) => {
      run.eventMaterializations = {
        'event:d4-1': {
          ...validMaterialization(),
          deferredOffersByChoiceId: {
            missing: { kind: 'grantCard', status: 'pending', card: { skillId: 'sword_slash', tier: 'bronze' } },
          },
        },
      };
    });
    expectMalformedV3BackedUp((run) => {
      run.eventMaterializations = {
        'event:d4-1': { ...validMaterialization(), selectedWeightedBranchIds: { missing: 'branch' } },
      };
    });
    expectMalformedV3BackedUp((run) => {
      run.eventMaterializations = {
        'event:d4-1': {
          ...validMaterialization(),
          unavailableChoiceReasonsByChoiceId: { take: 'unknown_reason' },
        },
      };
    });
    expectMalformedV3BackedUp((run) => {
      run.eventMaterializations = {
        'event:d4-1': {
          ...validMaterialization(),
          unavailableChoiceReasonsByChoiceId: { missing: 'no_unvisited_biome' },
        },
      };
    });
    expectMalformedV3BackedUp((run) => {
      run.eventMaterializations = {
        'event:d4-1': {
          ...validMaterialization(),
          deferredOffersByChoiceId: {
            take: { kind: 'gemChoice', status: 'settled', optionGemIds: [Object.keys(gemBook)[0]], selectedId: 'not-offered' },
          },
        },
      };
    });
    expectMalformedV3BackedUp((run) => {
      run.eventMaterializations = {
        'event:d4-1': {
          ...validMaterialization(),
          deferredOffersByChoiceId: { take: {
            kind: 'upgradeCard', status: 'pending', optionInstanceIds: ['card:1', 'card:1'],
            fallback: { kind: 'grantGold', amount: 2 },
          } },
        },
      };
    });
    expectMalformedV3BackedUp((run) => {
      run.eventMaterializations = {
        'event:d4-1': {
          ...validMaterialization(),
          deferredOffersByChoiceId: { take: { kind: 'sellGem', status: 'pending', options: [] } },
        },
      };
    });
  });

  it('creates a new run with the exact schema-v3 persistence defaults', () => {
    expect(SCHEMA_VERSION).toBe(3);
    expect(createRun(73)).toMatchObject(V3_DEFAULTS);
  });

  it('migrates complete v2 bytes into v3 defaults while retaining the v2 bytes exactly', () => {
    const v2 = historicalV2Run(73);
    const v2Bytes = JSON.stringify({ schemaVersion: 2, run: v2 });
    const storage = fakeStorage({ [RUN_SAVE_V2_STORAGE_KEY]: v2Bytes });

    expect(loadRun(storage)).toEqual({ ...v2, ...V3_DEFAULTS });
    expect(storage.get(RUN_SAVE_V2_STORAGE_KEY)).toBe(v2Bytes);
    expect(JSON.parse(storage.get(RUN_SAVE_STORAGE_KEY)!)).toEqual({
      schemaVersion: 3,
      run: { ...v2, ...V3_DEFAULTS },
    });
  });

  it('migrates schema 1 through explicit v2 and v3 seams without losing pending event identity', () => {
    const v1 = historicalV1Run(91);
    const v2 = migrateV1RunToV2(v1);
    const v3 = migrateV2Run(v2);

    expect(v2.eventInstances['d1-0']).toEqual({
      eventId: 'factors_ledger', contentVersion: 1, instanceId: 'legacy:d1-0', drawnDepth: 1,
    });
    expect(v2.completedStoryIds).toEqual([]);
    expect(v2.eventCallbackResolutionIds).toEqual([]);
    expect(v3.eventResolutions?.['d1-0']).toEqual({
      eventId: 'factors_ledger', contentVersion: 1, instanceId: 'legacy:d1-0',
      choiceId: 'standing_credit', pending: true,
    });
    expect(v3).toEqual({ ...v2, ...V3_DEFAULTS });
  });

  it('accepts the historically-supported schema-1 envelope at the v2 key and writes only v3', () => {
    const v1Bytes = JSON.stringify({ schemaVersion: 1, run: historicalV1Run(92) });
    const storage = fakeStorage({ [RUN_SAVE_V2_STORAGE_KEY]: v1Bytes });

    const loaded = loadRun(storage)!;
    expect(loaded.eventInstances['d1-0']).toMatchObject({
      eventId: 'factors_ledger', contentVersion: 1, instanceId: 'legacy:d1-0',
    });
    expect(loaded.eventResolutions?.['d1-0']?.pending).toBe(true);
    expect(loaded).toMatchObject(V3_DEFAULTS);
    expect(storage.get(RUN_SAVE_V2_STORAGE_KEY)).toBe(v1Bytes);
    expect(JSON.parse(storage.get(RUN_SAVE_STORAGE_KEY)!)).toMatchObject({ schemaVersion: 3 });
  });

  it('preserves every ordering-sensitive v2 event, bag, callback, story, and map-intel field', () => {
    const base = historicalV2Run(117);
    const snapshot = forecastBand(createRun(117), 1);
    const v2: RunStateV2 = {
      ...base,
      eventBag: ['second', 'first'],
      eventBagRefills: 4,
      eventThemeBags: { omen: ['omen-b', 'omen-a'], market: ['market-a'] },
      eventThemeBagRefills: { omen: 3, market: 1 },
      eventInstances: {
        'd4-2': { eventId: 'second', contentVersion: 2, instanceId: 'event:d4-2', drawnDepth: 4 },
        'd1-1': { eventId: 'first', contentVersion: 1, instanceId: 'event:d1-1', drawnDepth: 1 },
      },
      eventResolutions: {
        'd4-2': {
          eventId: 'second', contentVersion: 2, instanceId: 'event:d4-2', choiceId: 'choose', pending: true,
        },
      },
      eventCallbackQueue: [
        {
          callbackInstanceId: 'callback:z', callbackId: 'late', eventId: 'late_event', contentVersion: 2,
          scheduledDepth: 7, earliestDepth: 9, minDepthDelay: 2, destinationThemes: ['omen'],
          priority: 1, boundSubjects: { enemy_id: 'wolf_king' },
          expiry: { expiresAfterNodes: 5, fallback: { outcome: { kind: 'grantGold', amount: 7 } } },
        },
        {
          callbackInstanceId: 'callback:a', callbackId: 'early', eventId: 'early_event', contentVersion: 1,
          scheduledDepth: 2, earliestDepth: 3, minDepthDelay: 1, destinationThemes: ['market'],
          destinationBiomeIds: ['arrowfell'], priority: 9, boundSubjects: {},
        },
      ],
      completedStoryIds: ['story-z', 'story-a'],
      eventCallbackResolutionIds: ['resolved-z', 'resolved-a'],
      mapIntelByBand: { '1': { band: 1, sourceEventInstanceId: 'event:d4-2', snapshot } },
      appliedMapInfoSourceIds: ['event:z', 'event:a'],
      shopShelves: {
        'd2-1': { cards: [], gems: [], rerollCount: 6 },
      },
      draft: { rerolls: 5, picks: { offense: 'sword_slash', wildcard: 'firebolt' } },
    };

    expect(migrateV2Run(v2)).toEqual({ ...v2, ...V3_DEFAULTS });
  });

  it('round-trips closed v3 materializations, bindings, reservations, and every deferred-offer state', () => {
    const run: RunState = {
      ...createRun(303),
      eventInstances: {
        'd1-0': {
          eventId: 'bound_event', contentVersion: 3, instanceId: 'event:d1-0', drawnDepth: 1,
          boundSubjects: {
            enemy_id: 'wolf_king',
            mono_type: { typeKind: 'weapon', type: 'sword' },
          },
        },
        'd4-1': {
          eventId: 'other_event', contentVersion: 1, instanceId: 'event:d4-1', drawnDepth: 4,
        },
      },
      eventBindingReservations: [{
        reservationId: 'reservation:1', instanceId: 'event:d1-0', source: 'revenge',
        sourceBattleId: 'battle:d3-1', subjectId: 'wolf_king',
      }],
      eventMaterializations: {
        'event:d1-0': {
          eventInstanceId: 'event:d1-0',
          choiceIds: ['spare', 'hunt'],
          selectedWeightedBranchIds: { hunt: 'ambush' },
          unavailableChoiceReasonsByChoiceId: {},
          boundSubjects: { enemy_id: 'wolf_king', mono_type: { typeKind: 'weapon', type: 'sword' } },
          deferredOffersByChoiceId: {
            spare: {
              kind: 'cardChoice', status: 'pending',
              options: [
                { skillId: 'sword_slash', tier: 'bronze' },
                { skillId: 'twin_slash', tier: 'silver' },
                { skillId: 'sworn_edge', tier: 'gold' },
              ],
            },
            hunt: {
              kind: 'upgradeCardTargeted', status: 'settled', optionInstanceIds: ['card:1', 'card:2'],
              fallback: { kind: 'grantGold', amount: 4 }, selectedInstanceId: 'card:2',
            },
          },
        },
        'event:d4-1': {
          eventInstanceId: 'event:d4-1',
          choiceIds: ['take', 'study', 'leave'],
          selectedWeightedBranchIds: { take: 'rare' },
          unavailableChoiceReasonsByChoiceId: {},
          boundSubjects: { mono_type: { typeKind: 'element', type: 'fire' }, destination_biome: 'emberwaste' },
          deferredOffersByChoiceId: {
            take: {
              kind: 'cardChoice', status: 'settled', selectedSkillId: 'cinder_dart',
              options: [
                { skillId: 'cinder_dart', tier: 'bronze' },
                { skillId: 'fireball', tier: 'silver' },
                { skillId: 'thermal_shock', tier: 'gold' },
              ],
            },
            study: {
              kind: 'upgradeCardTargeted', status: 'pending', optionInstanceIds: ['card:9'],
              fallback: { kind: 'nothing' },
            },
          },
        },
      },
      eventResolutions: {
        'd1-0': {
          eventId: 'bound_event', contentVersion: 3, instanceId: 'event:d1-0', choiceId: 'hunt',
        },
        'd4-1': {
          eventId: 'other_event', contentVersion: 1, instanceId: 'event:d4-1', choiceId: 'take',
        },
      },
    };
    const storage = fakeStorage();

    expect(saveRun(storage, run)).toEqual({ ok: true });
    expect(loadRun(storage)).toEqual(run);
  });

  it('round-trips a closed structured binding on a known schema-v3 callback target', () => {
    const run: RunState = {
      ...createRun(304),
      eventCallbackQueue: [{
        callbackInstanceId: 'callback:known-v3', callbackId: REAL_MONO_CALLBACK,
        eventId: REAL_MONO_CALLBACK, contentVersion: 1,
        scheduledDepth: 4, earliestDepth: 7, minDepthDelay: 3,
        destinationThemes: ['forge'], priority: 700,
        boundSubjects: { mono_type: { typeKind: 'weapon', type: 'sword' } },
        expiry: { expiresAfterNodes: 20, fallback: 'discard' },
      }],
    };
    const storage = fakeStorage();

    expect(saveRun(storage, run)).toEqual({ ok: true });
    expect(loadRun(storage)).toEqual(run);
  });

  it('round-trips only an exact delivered v3 callback subject contract', () => {
    const run = createRun(3041);
    run.eventInstances = {
      delivered: {
        eventId: REAL_MONO_CALLBACK, contentVersion: 1,
        instanceId: 'event:delivered', drawnDepth: 7,
        callbackInstanceId: 'callback:known-v3',
        boundSubjects: { mono_type: { typeKind: 'weapon', type: 'sword' } },
      },
    };
    const storage = fakeStorage();
    expect(saveRun(storage, run)).toEqual({ ok: true });
    expect(loadRun(storage)).toEqual(run);

    for (const boundSubjects of [
      {},
      { signature_card_id: 'sword_slash' },
      {
        mono_type: { typeKind: 'weapon', type: 'sword' },
        signature_card_id: 'sword_slash',
      },
    ]) {
      expectMalformedV3BackedUp((candidate) => {
        candidate.eventInstances = {
          delivered: {
            eventId: REAL_MONO_CALLBACK, contentVersion: 1,
            instanceId: 'event:delivered', drawnDepth: 7,
            callbackInstanceId: 'callback:known-v3', boundSubjects,
          },
        };
      });
    }
  });

  it.each([
    ['missing required slot', {}],
    ['wrong required slot', { signature_card_id: 'sword_slash' }],
    ['extra slot', {
      mono_type: { typeKind: 'weapon', type: 'sword' },
      signature_card_id: 'sword_slash',
    }],
  ])('backs up a known v3 callback whose target contract has a %s', (_name, boundSubjects) => {
    expectMalformedV3BackedUp((run) => {
      run.eventCallbackQueue = [{
        callbackInstanceId: 'callback:known-v3', callbackId: REAL_MONO_CALLBACK,
        eventId: REAL_MONO_CALLBACK, contentVersion: 1,
        scheduledDepth: 4, earliestDepth: 7, minDepthDelay: 3,
        destinationThemes: ['forge'], priority: 700, boundSubjects,
        expiry: { expiresAfterNodes: 20, fallback: 'discard' },
      }];
    });
  });

  it.each([
    ['missing copied destination', {}, undefined],
    ['wrong copied destination', { destination_biome: 'arrowfell' }, ['emberwaste']],
    ['extra copied destination', {
      destination_biome: 'arrowfell', enemy_id: 'wolf_king',
    }, ['arrowfell']],
  ])('backs up a known destination callback with %s', (_name, boundSubjects, destinationBiomeIds) => {
    expectMalformedV3BackedUp((run) => {
      run.eventCallbackQueue = [{
        callbackInstanceId: 'callback:known-destination',
        callbackId: REAL_DESTINATION_CALLBACK,
        eventId: REAL_DESTINATION_CALLBACK, contentVersion: 1,
        scheduledDepth: 4, earliestDepth: 7, minDepthDelay: 3,
        destinationThemes: ['cache'], priority: 700, boundSubjects,
        ...(destinationBiomeIds === undefined ? {} : { destinationBiomeIds }),
        expiry: { expiresAfterNodes: 20, fallback: 'discard' },
      }];
    });
  });

  it('round-trips real staged Missing Road queued and delivered subject contracts', () => {
    const queued: RunState = {
      ...createRun(3042),
      eventCallbackQueue: [{
        callbackInstanceId: 'callback:real-destination',
        callbackId: REAL_DESTINATION_CALLBACK,
        eventId: REAL_DESTINATION_CALLBACK,
        contentVersion: 1,
        scheduledDepth: 4,
        earliestDepth: 6,
        minDepthDelay: 2,
        destinationThemes: ['cache'],
        destinationBiomeIds: ['emberwaste'],
        priority: 700,
        boundSubjects: { destination_biome: 'emberwaste' },
        expiry: { expiresAfterNodes: 20, fallback: 'discard' },
      }],
    };
    const queuedStorage = fakeStorage();
    expect(saveRun(queuedStorage, queued)).toEqual({ ok: true });
    expect(loadRun(queuedStorage)).toEqual(queued);

    const delivered: RunState = {
      ...createRun(3043),
      eventInstances: {
        delivered: {
          eventId: REAL_DESTINATION_CALLBACK,
          contentVersion: 1,
          instanceId: 'event:delivered',
          drawnDepth: 6,
          callbackInstanceId: 'callback:real-destination',
          boundSubjects: { destination_biome: 'emberwaste' },
        },
      },
    };
    const deliveredStorage = fakeStorage();
    expect(saveRun(deliveredStorage, delivered)).toEqual({ ok: true });
    expect(loadRun(deliveredStorage)).toEqual(delivered);
  });

  it.each(['not_a_biome', ''])(
    'backs up real staged queued and delivered callbacks with dynamic destination %j',
    (destinationBiome) => {
      expectMalformedV3BackedUp((run) => {
        run.eventCallbackQueue = [{
          callbackInstanceId: 'callback:invalid-destination',
          callbackId: REAL_DESTINATION_CALLBACK,
          eventId: REAL_DESTINATION_CALLBACK,
          contentVersion: 1,
          scheduledDepth: 4,
          earliestDepth: 6,
          minDepthDelay: 2,
          destinationThemes: ['cache'],
          destinationBiomeIds: [destinationBiome],
          priority: 700,
          boundSubjects: { destination_biome: destinationBiome },
          expiry: { expiresAfterNodes: 20, fallback: 'discard' },
        }];
      });
      expectMalformedV3BackedUp((run) => {
        run.eventInstances = {
          delivered: {
            eventId: REAL_DESTINATION_CALLBACK,
            contentVersion: 1,
            instanceId: 'event:delivered',
            drawnDepth: 6,
            callbackInstanceId: 'callback:invalid-destination',
            boundSubjects: { destination_biome: destinationBiome },
          },
        };
      });
    },
  );

  it.each([
    ['a non-catalog biome', ['not_a_biome']],
    ['no biome', []],
  ])('backs up a static callback destination list containing %s', (_name, destinationBiomeIds) => {
    expectMalformedV3BackedUp((run) => {
      run.eventCallbackQueue = [{
        callbackInstanceId: 'callback:invalid-static-destination',
        callbackId: REAL_MONO_CALLBACK,
        eventId: REAL_MONO_CALLBACK,
        contentVersion: 1,
        scheduledDepth: 4,
        earliestDepth: 7,
        minDepthDelay: 3,
        destinationThemes: ['forge'],
        destinationBiomeIds,
        priority: 700,
        boundSubjects: { mono_type: { typeKind: 'weapon', type: 'sword' } },
        expiry: { expiresAfterNodes: 20, fallback: 'discard' },
      }];
    });
  });

  it.each(['queued', 'delivered'] as const)(
    'backs up an unresolved current %s callback target instead of bypassing topology',
    (kind) => {
      expectMalformedV3BackedUp((run) => {
        if (kind === 'queued') {
          run.eventCallbackQueue = [{
            callbackInstanceId: 'callback:unknown-current',
            callbackId: 'unknown_current_callback',
            eventId: 'unknown_current_callback',
            contentVersion: 99,
            scheduledDepth: 4,
            earliestDepth: 6,
            minDepthDelay: 2,
            destinationThemes: ['cache'],
            destinationBiomeIds: ['emberwaste'],
            priority: 700,
            boundSubjects: { destination_biome: 'arrowfell' },
            expiry: { expiresAfterNodes: 20, fallback: 'discard' },
          }];
          return;
        }
        run.eventInstances = {
          delivered: {
            eventId: 'unknown_current_callback',
            contentVersion: 99,
            instanceId: 'event:delivered',
            drawnDepth: 6,
            callbackInstanceId: 'callback:unknown-current',
            boundSubjects: {},
          },
        };
      });
    },
  );

  it.each([
    ['reason on a non-consuming choice', {}, { study_map: 'no_unvisited_biome' }],
    ['reason while a destination is present', { destination_biome: 'emberwaste' }, {
      mark_missing_road: 'no_unvisited_biome',
    }],
    ['missing required reason', {}, {}],
  ])('backs up Cartographer materialization with %s', (_name, boundSubjects, reasons) => {
    const run = createRun(3044);
    run.eventInstances = {
      cartographer: {
        eventId: 'cartographers_missing_road', contentVersion: 1,
        instanceId: 'event:cartographer', drawnDepth: 8, boundSubjects,
      },
    };
    run.eventMaterializations = {
      'event:cartographer': {
        eventInstanceId: 'event:cartographer',
        choiceIds: ['mark_missing_road', 'study_map', 'sell_map'],
        selectedWeightedBranchIds: {},
        unavailableChoiceReasonsByChoiceId: reasons,
        boundSubjects,
        deferredOffersByChoiceId: {},
      },
    } as RunState['eventMaterializations'];
    expectRunBackedUpExactly(run);
  });

  it('round-trips both exact Cartographer unavailability states through the real staged definition', () => {
    for (const [boundSubjects, reasons] of [
      [{}, { mark_missing_road: 'no_unvisited_biome' }],
      [{ destination_biome: 'emberwaste' }, {}],
    ] as const) {
      const run = createRun(3045);
      run.eventInstances = {
        cartographer: {
          eventId: 'cartographers_missing_road', contentVersion: 1,
          instanceId: 'event:cartographer', drawnDepth: 8, boundSubjects,
        },
      };
      run.eventMaterializations = {
        'event:cartographer': {
          eventInstanceId: 'event:cartographer',
          choiceIds: ['mark_missing_road', 'study_map', 'sell_map'],
          selectedWeightedBranchIds: {},
          unavailableChoiceReasonsByChoiceId: reasons,
          boundSubjects,
          deferredOffersByChoiceId: {},
        },
      };
      const storage = fakeStorage();
      expect(saveRun(storage, run)).toEqual({ ok: true });
      expect(loadRun(storage)).toEqual(run);
    }
  });

  it.each(['not_a_biome', ''])(
    'backs up a Cartographer materialization with dynamic destination %j',
    (destinationBiome) => {
      const run = createRun(3046);
      const boundSubjects = { destination_biome: destinationBiome };
      run.eventInstances = {
        cartographer: {
          eventId: 'cartographers_missing_road', contentVersion: 1,
          instanceId: 'event:cartographer', drawnDepth: 8, boundSubjects,
        },
      };
      run.eventMaterializations = {
        'event:cartographer': {
          eventInstanceId: 'event:cartographer',
          choiceIds: ['mark_missing_road', 'study_map', 'sell_map'],
          selectedWeightedBranchIds: {},
          unavailableChoiceReasonsByChoiceId: {},
          boundSubjects,
          deferredOffersByChoiceId: {},
        },
      };
      expectRunBackedUpExactly(run);
    },
  );

  it.each([
    ['unknown slot', { mono_type: { typeKind: 'weapon', type: 'sword' }, extra: 'value' }],
    ['wrong scalar', { mono_type: 7 }],
    ['stringly mono', { mono_type: 'sword' }],
    ['malformed mono', { mono_type: { typeKind: 'weapon', type: 'fire' } }],
  ])('backs up malformed known-v3 callback subjects: %s', (_name, boundSubjects) => {
    expectMalformedV3BackedUp((run) => {
      run.eventCallbackQueue = [{
        callbackInstanceId: 'callback:known-v3', callbackId: REAL_MONO_CALLBACK,
        eventId: REAL_MONO_CALLBACK, contentVersion: 1,
        scheduledDepth: 4, earliestDepth: 7, minDepthDelay: 3,
        destinationThemes: ['forge'], priority: 700, boundSubjects,
        expiry: { expiresAfterNodes: 20, fallback: 'discard' },
      }];
    });
  });

  it.each([
    ['identical', (entry: Record<string, unknown>) => ({ ...entry })],
    ['conflicting', (entry: Record<string, unknown>) => ({ ...entry, priority: 701 })],
  ])('backs up current v3 queues with %s duplicate callback identities', (_name, duplicateOf) => {
    expectMalformedV3BackedUp((run) => {
      const entry: Record<string, unknown> = {
        callbackInstanceId: 'callback:duplicate', callbackId: REAL_MONO_CALLBACK,
        eventId: REAL_MONO_CALLBACK, contentVersion: 1,
        scheduledDepth: 4, earliestDepth: 7, minDepthDelay: 3,
        destinationThemes: ['forge'], priority: 700,
        boundSubjects: { mono_type: { typeKind: 'weapon', type: 'sword' } },
        expiry: { expiresAfterNodes: 20, fallback: 'discard' },
      };
      run.eventCallbackQueue = [entry, duplicateOf(entry)];
    });
  });

  it.each([
    ['identical', (entry: EventCallbackQueueEntryV2) => ({ ...entry })],
    ['conflicting', (entry: EventCallbackQueueEntryV2) => ({ ...entry, priority: 701 })],
  ])('backs up historical v2 queues with %s duplicate callback identities', (_name, duplicateOf) => {
    const entry: EventCallbackQueueEntryV2 = {
      callbackInstanceId: 'callback:legacy-duplicate', callbackId: 'legacy_callback',
      eventId: 'legacy_callback', contentVersion: 2,
      scheduledDepth: 4, earliestDepth: 6, minDepthDelay: 2,
      destinationThemes: ['omen'], priority: 700, boundSubjects: {},
      expiry: { expiresAfterNodes: 20, fallback: 'discard' },
    };
    const malformed: RunStateV2 = {
      ...historicalV2Run(305),
      eventCallbackQueue: [entry, duplicateOf(entry)],
    };
    const raw = JSON.stringify({ schemaVersion: 2, run: malformed });
    const storage = fakeStorage({ [RUN_SAVE_V2_STORAGE_KEY]: raw });

    expect(loadRun(storage)).toBeNull();
    expect(storage.get(RUN_SAVE_V2_BACKUP_KEY)).toBe(raw);
    expect(storage.get(RUN_SAVE_V2_STORAGE_KEY)).toBe(raw);
    expect(storage.get(RUN_SAVE_STORAGE_KEY)).toBeNull();
  });

  it('uses strict v3 then v2 then v1 key precedence', () => {
    const v3 = createRun(3);
    const v2 = historicalV2Run(2);
    const v1 = historicalV1Run(1);
    const storage = fakeStorage({
      [RUN_SAVE_STORAGE_KEY]: JSON.stringify({ schemaVersion: 3, run: v3 }),
      [RUN_SAVE_V2_STORAGE_KEY]: JSON.stringify({ schemaVersion: 2, run: v2 }),
      [RUN_SAVE_V1_STORAGE_KEY]: JSON.stringify({ schemaVersion: 1, run: v1 }),
    });

    expect(loadRun(storage)).toEqual(v3);
  });

  it('treats a present v3 null tombstone as authoritative over valid historical keys', () => {
    const storage = fakeStorage({
      [RUN_SAVE_STORAGE_KEY]: 'null',
      [RUN_SAVE_V2_STORAGE_KEY]: JSON.stringify({ schemaVersion: 2, run: historicalV2Run(2) }),
      [RUN_SAVE_V1_STORAGE_KEY]: JSON.stringify({ schemaVersion: 1, run: historicalV1Run(1) }),
    });

    expect(loadRun(storage)).toBeNull();
  });

  it('backs up corrupt v3 bytes exactly and never falls back to v2 or v1', () => {
    const corrupt = '{"schemaVersion":3,"run":';
    const storage = fakeStorage({
      [RUN_SAVE_STORAGE_KEY]: corrupt,
      [RUN_SAVE_V2_STORAGE_KEY]: JSON.stringify({ schemaVersion: 2, run: historicalV2Run(2) }),
      [RUN_SAVE_V1_STORAGE_KEY]: JSON.stringify({ schemaVersion: 1, run: historicalV1Run(1) }),
    });

    expect(loadRun(storage)).toBeNull();
    expect(storage.get(RUN_SAVE_BACKUP_KEY)).toBe(corrupt);
    expect(storage.get(RUN_SAVE_STORAGE_KEY)).toBe(corrupt);
  });

  it('backs up a lower-schema envelope at the v3 key and a malformed envelope at the v2 key', () => {
    const wrongAtV3 = JSON.stringify({ schemaVersion: 2, run: historicalV2Run(4) });
    const v3Storage = fakeStorage({ [RUN_SAVE_STORAGE_KEY]: wrongAtV3 });
    expect(loadRun(v3Storage)).toBeNull();
    expect(v3Storage.get(RUN_SAVE_BACKUP_KEY)).toBe(wrongAtV3);

    const wrongAtV2 = JSON.stringify({ schemaVersion: 2, run: { seed: 4 } });
    const v2Storage = fakeStorage({ [RUN_SAVE_V2_STORAGE_KEY]: wrongAtV2 });
    expect(loadRun(v2Storage)).toBeNull();
    expect(v2Storage.get(RUN_SAVE_V2_BACKUP_KEY)).toBe(wrongAtV2);
  });

  it.each([
    ['combat missing battleId', (run: Record<string, unknown>) => {
      const fact = validCombatFact(); delete fact.battleId; run.combatFactLedger = [fact];
    }],
    ['combat invalid result', (run: Record<string, unknown>) => {
      run.combatFactLedger = [{ ...validCombatFact(), result: 'draw' }];
    }],
    ['combat invalid optional affinity', (run: Record<string, unknown>) => {
      run.combatFactLedger = [{ ...validCombatFact(), affinityId: 7 }];
    }],
    ['combat fractional depth', (run: Record<string, unknown>) => {
      run.combatFactLedger = [{ ...validCombatFact(), depth: 3.5 }];
    }],
    ['combat negative turns', (run: Record<string, unknown>) => {
      run.combatFactLedger = [{ ...validCombatFact(), turns: -1 }];
    }],
    ['combat non-finite turns', (run: Record<string, unknown>) => {
      run.combatFactLedger = [{ ...validCombatFact(), turns: Number.POSITIVE_INFINITY }];
    }],
    ['combat unknown key', (run: Record<string, unknown>) => {
      run.combatFactLedger = [{ ...validCombatFact(), extra: true }];
    }],
    ['revenge missing enemyId', (run: Record<string, unknown>) => {
      const fact = validRevengeFact(); delete fact.enemyId; run.revengeFactLedger = [fact];
    }],
    ['revenge invalid status', (run: Record<string, unknown>) => {
      run.revengeFactLedger = [{ ...validRevengeFact(), status: 'waiting' }];
    }],
    ['revenge invalid optional reservation id', (run: Record<string, unknown>) => {
      run.revengeFactLedger = [{ ...validRevengeFact(), reservedByInstanceId: 1 }];
    }],
    ['revenge unknown key', (run: Record<string, unknown>) => {
      run.revengeFactLedger = [{ ...validRevengeFact(), extra: true }];
    }],
    ['signature missing cardId', (run: Record<string, unknown>) => {
      const fact = validSignatureFact(); delete fact.cardId; run.signatureFactLedger = [fact];
    }],
    ['signature invalid bossFinisher', (run: Record<string, unknown>) => {
      run.signatureFactLedger = [{ ...validSignatureFact(), bossFinisher: 'yes' }];
    }],
    ['signature negative achievedDepth', (run: Record<string, unknown>) => {
      run.signatureFactLedger = [{ ...validSignatureFact(), achievedDepth: -1 }];
    }],
    ['signature unknown key', (run: Record<string, unknown>) => {
      run.signatureFactLedger = [{ ...validSignatureFact(), extra: true }];
    }],
    ['journey missing visitedBiomeIds', (run: Record<string, unknown>) => {
      run.journeyFactLedger = {};
    }],
    ['journey invalid visit item', (run: Record<string, unknown>) => {
      run.journeyFactLedger = { visitedBiomeIds: ['arrowfell', 2] };
    }],
    ['journey unknown key', (run: Record<string, unknown>) => {
      run.journeyFactLedger = { visitedBiomeIds: [], completedStoryIds: [] };
    }],
    ['reservation missing sourceBattleId', (run: Record<string, unknown>) => {
      const reservation = validReservation(); delete reservation.sourceBattleId;
      run.eventBindingReservations = [reservation];
    }],
    ['reservation invalid source', (run: Record<string, unknown>) => {
      run.eventBindingReservations = [{ ...validReservation(), source: 'journey' }];
    }],
    ['reservation unknown key', (run: Record<string, unknown>) => {
      run.eventBindingReservations = [{ ...validReservation(), extra: true }];
    }],
  ])('rejects and backs up malformed closed v3 fact state: %s', (_name, mutate) => {
    expectMalformedV3BackedUp(mutate);
  });

  it.each([
    ['unknown binding slot', (bound: Record<string, unknown>) => {
      bound.enemy = 'bandit_duelist';
    }],
    ['wrong scalar binding value', (bound: Record<string, unknown>) => {
      bound.enemy_id = 7;
    }],
    ['malformed structured mono type', (bound: Record<string, unknown>) => {
      bound.mono_type = { typeKind: 'weapon', type: 'fire' };
    }],
    ['array-valued weapon mono type', (bound: Record<string, unknown>) => {
      bound.mono_type = { typeKind: 'weapon', type: ['sword'] };
    }],
    ['array-valued element mono type', (bound: Record<string, unknown>) => {
      bound.mono_type = { typeKind: 'element', type: ['fire'] };
    }],
    ['nested-array weapon mono type', (bound: Record<string, unknown>) => {
      bound.mono_type = { typeKind: 'weapon', type: [['sword']] };
    }],
  ])('rejects and backs up malformed event-instance binding: %s', (_name, mutate) => {
    expectMalformedV3BackedUp((run) => {
      const bound: Record<string, unknown> = {
        enemy_id: 'bandit_duelist', mono_type: { typeKind: 'weapon', type: 'sword' },
      };
      mutate(bound);
      run.eventInstances = {
        'd1-0': {
          eventId: 'bound_event', contentVersion: 3, instanceId: 'event:d1-0',
          drawnDepth: 1, boundSubjects: bound,
        },
      };
    });
  });

  it.each([
    ['materialization missing eventInstanceId', (materialization: Record<string, unknown>) => {
      delete materialization.eventInstanceId;
    }],
    ['materialization invalid choice count', (materialization: Record<string, unknown>) => {
      materialization.choiceIds = ['only'];
    }],
    ['materialization unknown key', (materialization: Record<string, unknown>) => {
      materialization.extra = true;
    }],
    ['bound subjects unknown key', (materialization: Record<string, unknown>) => {
      (materialization.boundSubjects as Record<string, unknown>).extra = 'value';
    }],
    ['mono binding mismatched kind and type', (materialization: Record<string, unknown>) => {
      (materialization.boundSubjects as Record<string, unknown>).mono_type = {
        typeKind: 'weapon', type: 'fire',
      };
    }],
    ['mono binding unknown key', (materialization: Record<string, unknown>) => {
      (materialization.boundSubjects as Record<string, unknown>).mono_type = {
        typeKind: 'weapon', type: 'sword', extra: true,
      };
    }],
    ['card offer invalid options tuple length', (materialization: Record<string, unknown>) => {
      const offers = materialization.deferredOffersByChoiceId as Record<string, Record<string, unknown>>;
      offers.take!.options = [{ skillId: 'sword_slash', tier: 'bronze' }];
    }],
    ['card offer item unknown key', (materialization: Record<string, unknown>) => {
      const offers = materialization.deferredOffersByChoiceId as Record<string, Record<string, unknown>>;
      offers.take!.options = [
        { skillId: 'sword_slash', tier: 'bronze', extra: true },
        { skillId: 'twin_slash', tier: 'silver' },
        { skillId: 'sworn_edge', tier: 'gold' },
      ];
    }],
    ['card offer item unknown skill id', (materialization: Record<string, unknown>) => {
      const offers = materialization.deferredOffersByChoiceId as Record<string, Record<string, unknown>>;
      (offers.take!.options as Array<Record<string, unknown>>)[0]!.skillId = 'fabricated_missing_skill';
    }],
    ['card offer duplicate skill ids', (materialization: Record<string, unknown>) => {
      const offers = materialization.deferredOffersByChoiceId as Record<string, Record<string, unknown>>;
      const options = offers.take!.options as Array<Record<string, unknown>>;
      options[1]!.skillId = options[0]!.skillId;
    }],
    ['pending card offer has settled-only field', (materialization: Record<string, unknown>) => {
      const offers = materialization.deferredOffersByChoiceId as Record<string, Record<string, unknown>>;
      offers.take!.selectedSkillId = 'sword_slash';
    }],
    ['settled card offer misses selectedSkillId', (materialization: Record<string, unknown>) => {
      const offers = materialization.deferredOffersByChoiceId as Record<string, Record<string, unknown>>;
      offers.take!.status = 'settled';
    }],
    ['settled card offer selects a known off-list skill id', (materialization: Record<string, unknown>) => {
      const offers = materialization.deferredOffersByChoiceId as Record<string, Record<string, unknown>>;
      offers.take!.status = 'settled';
      offers.take!.selectedSkillId = 'cinder_dart';
    }],
    ['settled card offer selects an unknown skill id', (materialization: Record<string, unknown>) => {
      const offers = materialization.deferredOffersByChoiceId as Record<string, Record<string, unknown>>;
      offers.take!.status = 'settled';
      offers.take!.selectedSkillId = 'fabricated_missing_skill';
    }],
    ['deferred offer unknown key', (materialization: Record<string, unknown>) => {
      const offers = materialization.deferredOffersByChoiceId as Record<string, Record<string, unknown>>;
      offers.take!.extra = true;
    }],
    ['targeted offer invalid option id item', (materialization: Record<string, unknown>) => {
      const offers = materialization.deferredOffersByChoiceId as Record<string, Record<string, unknown>>;
      offers.leave!.optionInstanceIds = ['card:1', 2];
    }],
    ['targeted pending offer has settled-only field', (materialization: Record<string, unknown>) => {
      const offers = materialization.deferredOffersByChoiceId as Record<string, Record<string, unknown>>;
      offers.leave!.status = 'pending';
    }],
    ['grant fallback amount is not a positive integer', (materialization: Record<string, unknown>) => {
      const offers = materialization.deferredOffersByChoiceId as Record<string, Record<string, unknown>>;
      offers.leave!.fallback = { kind: 'grantGold', amount: 0 };
    }],
    ['grant fallback amount is fractional', (materialization: Record<string, unknown>) => {
      const offers = materialization.deferredOffersByChoiceId as Record<string, Record<string, unknown>>;
      offers.leave!.fallback = { kind: 'grantGold', amount: 1.5 };
    }],
    ['grant fallback amount is non-finite', (materialization: Record<string, unknown>) => {
      const offers = materialization.deferredOffersByChoiceId as Record<string, Record<string, unknown>>;
      offers.leave!.fallback = { kind: 'grantGold', amount: Number.POSITIVE_INFINITY };
    }],
    ['fallback unknown key', (materialization: Record<string, unknown>) => {
      const offers = materialization.deferredOffersByChoiceId as Record<string, Record<string, unknown>>;
      offers.leave!.fallback = { kind: 'nothing', extra: true };
    }],
  ])('rejects and backs up malformed closed v3 materialization state: %s', (_name, mutate) => {
    expectMalformedV3BackedUp((run) => {
      const materialization = validMaterialization();
      mutate(materialization);
      run.eventMaterializations = { 'event:d4-1': materialization };
    });
  });

  it.each([
    ['missing story key', (story: Record<string, unknown>) => { delete story.oath_mercy; }],
    ['invalid story enum', (story: Record<string, unknown>) => { story.grave_path = 'forgotten'; }],
    ['unknown story key', (story: Record<string, unknown>) => { story.extra = false; }],
  ])('rejects and backs up malformed closed v3 story state: %s', (_name, mutate) => {
    expectMalformedV3BackedUp((run) => {
      const story = { ...(run.storyStateV3 as Record<string, unknown>) };
      mutate(story);
      run.storyStateV3 = story;
    });
  });

  it('backs up an incomplete schema-v1 run and never writes v3', () => {
    const raw = JSON.stringify({ schemaVersion: 1, run: { eventInstances: {} } });
    const storage = fakeStorage({ [RUN_SAVE_V1_STORAGE_KEY]: raw });

    expect(loadRun(storage)).toBeNull();
    expect(storage.get(RUN_SAVE_V1_BACKUP_KEY)).toBe(raw);
    expect(storage.get(RUN_SAVE_STORAGE_KEY)).toBeNull();
  });

  it('refuses a future v3 envelope without backup, overwrite, clear, or historical fallback', () => {
    const future = JSON.stringify({ schemaVersion: 4, run: { seed: 404, future: true } });
    const storage = fakeStorage({
      [RUN_SAVE_STORAGE_KEY]: future,
      [RUN_SAVE_V2_STORAGE_KEY]: JSON.stringify({ schemaVersion: 2, run: historicalV2Run(2) }),
    });

    expect(loadRun(storage)).toBeNull();
    expect(storage.get(RUN_SAVE_BACKUP_KEY)).toBeNull();
    expect(saveRun(storage, createRun(9))).toEqual({ ok: false, reason: 'newer-version-on-disk' });
    expect(clearRun(storage)).toEqual({ ok: false, reason: 'newer-version-on-disk' });
    expect(storage.get(RUN_SAVE_STORAGE_KEY)).toBe(future);
  });

  it('returns a valid migrated run when the v3 migration write fails', () => {
    const v2 = historicalV2Run(515);
    const v2Bytes = JSON.stringify({ schemaVersion: 2, run: v2 });
    const storage: StorageDriver = {
      get: (key) => key === RUN_SAVE_V2_STORAGE_KEY ? v2Bytes : null,
      set: () => false,
    };

    expect(loadRun(storage)).toEqual({ ...v2, ...V3_DEFAULTS });
    expect(storage.get(RUN_SAVE_V2_STORAGE_KEY)).toBe(v2Bytes);
  });

  it.each([
    ['schema-v1', () => ({
      raw: JSON.stringify({ schemaVersion: 1, run: historicalV1RunWithSchema3Resolution(701) }),
      storageKey: RUN_SAVE_V1_STORAGE_KEY,
      backupKey: RUN_SAVE_V1_BACKUP_KEY,
    })],
    ['schema-v2', () => ({
      raw: JSON.stringify({ schemaVersion: 2, run: historicalV2RunWithSchema3Resolution(702) }),
      storageKey: RUN_SAVE_V2_STORAGE_KEY,
      backupKey: RUN_SAVE_V2_BACKUP_KEY,
    })],
  ])('refuses a %s envelope whose resolution now resolves to a schema-3 event, backs up the original bytes untouched, and never writes an unloadable v3 blob', (_name, build) => {
    const { raw, storageKey, backupKey } = build();
    const storage = fakeStorage({ [storageKey]: raw });

    // First load must not resume into a run a second load would then reject —
    // that "resumes once, then lost forever" gap is exactly the defect.
    const first = loadRun(storage);
    expect(first).toBeNull();
    expect(storage.get(backupKey)).toBe(raw);
    expect(storage.get(storageKey)).toBe(raw);
    expect(storage.get(RUN_SAVE_STORAGE_KEY)).toBeNull();

    const second = loadRun(storage);
    expect(second).toEqual(first);
    expect(storage.get(storageKey)).toBe(raw);
    expect(storage.get(RUN_SAVE_STORAGE_KEY)).toBeNull();
  });

  it.each([
    ['legacy-only resolution migrates and resumes', () => historicalV2Run(616), 'resumable'] as const,
    ['resolution now resolving to a schema-3 event refuses to migrate', () => (
      historicalV2RunWithSchema3Resolution(617)
    ), 'refused'] as const,
  ])('is idempotent across repeated migrated loads and does not rewrite historical bytes: %s', (_name, buildRun, expected) => {
    const v2 = buildRun();
    const v2Bytes = JSON.stringify({ schemaVersion: 2, run: v2 });
    const values = new Map([[RUN_SAVE_V2_STORAGE_KEY, v2Bytes]]);
    const writtenKeys: string[] = [];
    const storage: StorageDriver = {
      get: (key) => values.get(key) ?? null,
      set: (key, value) => { writtenKeys.push(key); values.set(key, value); return true; },
    };

    const first = loadRun(storage);
    const second = loadRun(storage);
    expect(second).toEqual(first);
    expect(storage.get(RUN_SAVE_V2_STORAGE_KEY)).toBe(v2Bytes);

    if (expected === 'resumable') {
      expect(first).not.toBeNull();
      expect(writtenKeys).toEqual([RUN_SAVE_STORAGE_KEY]);
    } else {
      expect(first).toBeNull();
      expect(writtenKeys.every((key) => key !== RUN_SAVE_STORAGE_KEY)).toBe(true);
      expect(storage.get(RUN_SAVE_STORAGE_KEY)).toBeNull();
      expect(storage.get(RUN_SAVE_V2_BACKUP_KEY)).toBe(v2Bytes);
    }
  });

  it('writes a v3 null tombstone that blocks stale v2 and v1 resurrection', () => {
    const v2Bytes = JSON.stringify({ schemaVersion: 2, run: historicalV2Run(2) });
    const v1Bytes = JSON.stringify({ schemaVersion: 1, run: historicalV1Run(1) });
    const storage = fakeStorage({
      [RUN_SAVE_V2_STORAGE_KEY]: v2Bytes,
      [RUN_SAVE_V1_STORAGE_KEY]: v1Bytes,
    });

    expect(clearRun(storage)).toEqual({ ok: true });
    expect(storage.get(RUN_SAVE_STORAGE_KEY)).toBe('null');
    expect(storage.get(RUN_SAVE_V2_STORAGE_KEY)).toBe(v2Bytes);
    expect(storage.get(RUN_SAVE_V1_STORAGE_KEY)).toBe(v1Bytes);
    expect(loadRun(storage)).toBeNull();
  });
});
