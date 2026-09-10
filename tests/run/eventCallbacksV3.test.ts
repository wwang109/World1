import { describe, expect, it } from 'vitest';
import type {
  EventBoundSubjectsV3,
  EventCallbackSpecV3,
  LoadedEventDefV3,
} from '../../src/data/eventContentV3';
import type { EventTheme } from '../../src/data/eventTypes';
import type { Element } from '../../src/engine/types';
import { hashSeed } from '../../src/engine/rng';
import {
  deliverEventCallback,
  dueEventCallback,
  repairDeliveredCallback,
  scheduleEventCallback,
  scheduleEventCallbackV3,
  sweepExpiredEventCallbacks,
} from '../../src/run/eventCallbacks';
import { eventInstanceAt } from '../../src/run/eventInstances';
import {
  createRun,
  type EventCallbackQueueEntryV3,
  type RunNode,
  type RunState,
} from '../../src/run/runState';
import { farSightCallback } from '../fixtures/eventV2';

const source = {
  eventInstanceId: 'event:d4-1',
  choiceId: 'enter_mirror',
  nodeDepth: 4,
  ordinal: 0,
};

const spec: EventCallbackSpecV3 = {
  callbackId: 'mirror_transformation',
  eventId: 'mirror_transformation',
  contentVersion: 3,
  minDepthDelay: 3,
  destinationThemes: ['forge'],
  destinationBiomeIds: ['arrowfell'],
  priority: 700,
  bind: [{ as: 'mono_type', source: 'board.monoType' }],
  expiry: { expiresAfterNodes: 20, fallback: 'discard' },
};

const target: LoadedEventDefV3 = {
  id: 'mirror_transformation',
  title: 'Beyond the Board\'s Mirror',
  body: 'The reflection waits.',
  theme: 'forge',
  rarity: 'secret',
  story: { storyId: 'mirror_of_the_board', stage: 'callback', role: 'callback' },
  eligibility: { fact: 'callback.queued', args: { callbackId: 'mirror_transformation' } },
  delivery: { kind: 'queued_callback' },
  visibility: 'teased_when_due',
  priority: 700,
  once: 'run',
  cooldownNodes: 0,
  acceptsBindings: ['mono_type'],
  choiceSet: {
    fixed: [
      { id: 'transform', label: 'Transform', cost: 0, outcome: { kind: 'nothing' } },
      { id: 'leave', label: 'Leave', cost: 0, outcome: { kind: 'nothing' } },
    ],
  },
  contentSchemaVersion: 3,
};

function schedule(
  state: RunState = createRun(11),
  callbackSpec: EventCallbackSpecV3 = spec,
  subjects: Readonly<EventBoundSubjectsV3> = {
    mono_type: { typeKind: 'weapon', type: 'sword' },
  },
  definition: LoadedEventDefV3 | undefined = target,
) {
  return scheduleEventCallbackV3(state, callbackSpec, source, subjects, () => definition);
}

const dueNode: RunNode = {
  id: 'd7-0', depth: 7, wave: 3, kind: 'event', eventSeed: 9,
  eventTheme: 'forge', biomeId: 'arrowfell',
};

function queuedV3(
  state: RunState = createRun(21),
  callbackSpec: EventCallbackSpecV3 = spec,
  subjects: Readonly<EventBoundSubjectsV3> = {
    mono_type: { typeKind: 'weapon', type: 'sword' },
  },
  definition: LoadedEventDefV3 = target,
): { state: RunState; entry: EventCallbackQueueEntryV3 } {
  const result = schedule(state, callbackSpec, subjects, definition);
  if (!result.ok) throw new Error(`test setup failed: ${result.reason}`);
  return result;
}

describe('run/eventCallbacks v3 scheduling', () => {
  it('keeps the historical v2 callback schedule JSON bytes unchanged', () => {
    const state = scheduleEventCallback(createRun(1103), farSightCallback, {
      eventInstanceId: 'run:1103:node:d3-0', choiceId: 'read_feathers', nodeDepth: 3, ordinal: 0,
    });

    expect(JSON.stringify(state.eventCallbackQueue[0])).toBe(
      '{"callbackInstanceId":"callback:3149474782","callbackId":"feathered_cairn_far_sight","eventId":"feathered_cairn_far_sight","contentVersion":1,"scheduledDepth":3,"earliestDepth":5,"minDepthDelay":2,"destinationThemes":["omen"],"destinationBiomeIds":["arrowfell"],"priority":700,"boundSubjects":{},"expiry":{"expiresAfterNodes":20,"fallback":"discard"}}',
    );
  });

  it('copies a structured subject and derives stable identity from the map seed', () => {
    const initial = createRun(11);
    const state = { ...initial, seed: 99, map: { ...initial.map, seed: 23 } };

    const result = scheduleEventCallbackV3(
      state,
      spec,
      source,
      { mono_type: { typeKind: 'weapon', type: 'sword' } },
      () => target,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.entry).toEqual({
      callbackInstanceId: `callback:${hashSeed(
        state.map.seed,
        'event-callback-v3',
        source.eventInstanceId,
        source.choiceId,
        spec.callbackId,
        source.ordinal,
      )}`,
      callbackId: 'mirror_transformation',
      eventId: 'mirror_transformation',
      contentVersion: 3,
      scheduledDepth: 4,
      earliestDepth: 7,
      minDepthDelay: 3,
      destinationThemes: ['forge'],
      destinationBiomeIds: ['arrowfell'],
      priority: 700,
      boundSubjects: { mono_type: { typeKind: 'weapon', type: 'sword' } },
      expiry: { expiresAfterNodes: 20, fallback: 'discard' },
    });
    expect(result.state.eventCallbackQueue).toEqual([result.entry]);
  });

  it('copies only named subjects plus authored arrays and expiry before caller mutation', () => {
    const destinationThemes: EventTheme[] = ['forge'];
    const destinationBiomeIds = ['arrowfell'];
    const callbackSpec: EventCallbackSpecV3 = {
      ...spec,
      destinationThemes,
      destinationBiomeIds,
      expiry: { expiresAfterNodes: 9, fallback: { outcome: { kind: 'grantGold', amount: 2 } } },
    };
    const mono: { typeKind: 'element'; type: Element } = { typeKind: 'element', type: 'fire' };
    const result = schedule(
      createRun(12),
      callbackSpec,
      { mono_type: mono, enemy_id: 'must-not-copy' },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    destinationThemes[0] = 'omen';
    destinationBiomeIds[0] = 'emberwaste';
    callbackSpec.expiry.expiresAfterNodes = 99;
    if (callbackSpec.expiry.fallback !== 'discard') callbackSpec.expiry.fallback.outcome.amount = 99;
    mono.type = 'frost';

    expect(result.entry.destinationThemes).toEqual(['forge']);
    expect(result.entry.destinationBiomeIds).toEqual(['arrowfell']);
    expect(result.entry.boundSubjects).toEqual({ mono_type: { typeKind: 'element', type: 'fire' } });
    expect(result.entry.expiry).toEqual({
      expiresAfterNodes: 9,
      fallback: { outcome: { kind: 'grantGold', amount: 2 } },
    });
  });

  it('uses a copied destination binding as the sole destination biome', () => {
    const destinationSpec: EventCallbackSpecV3 = {
      ...spec,
      destinationBiomeIds: ['arrowfell', 'swornhold'],
      bind: [{
        as: 'destination_biome', source: 'journey.futureBiome', candidates: 'unvisited_catalog',
      }],
    };
    const destinationTarget: LoadedEventDefV3 = {
      ...target,
      acceptsBindings: ['destination_biome'],
    };
    const result = schedule(
      createRun(13),
      destinationSpec,
      { destination_biome: 'emberwaste' },
      destinationTarget,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.entry.destinationBiomeIds).toEqual(['emberwaste']);
    expect(result.entry.boundSubjects).toEqual({ destination_biome: 'emberwaste' });
  });

  it.each(['not_a_biome', ''])(
    'rejects non-catalog dynamic destination %j atomically at scheduling',
    (destinationBiome) => {
      const destinationSpec: EventCallbackSpecV3 = {
        ...spec,
        bind: [{
          as: 'destination_biome', source: 'journey.futureBiome', candidates: 'unvisited_catalog',
        }],
      };
      const destinationTarget: LoadedEventDefV3 = {
        ...target,
        acceptsBindings: ['destination_biome'],
      };
      const state = createRun(131);
      const before = JSON.stringify(state);

      const result = scheduleEventCallbackV3(
        state,
        destinationSpec,
        source,
        { destination_biome: destinationBiome },
        () => destinationTarget,
      );

      expect(result).toEqual({ ok: false, state, reason: 'missing-subject' });
      expect(result.state).toBe(state);
      expect(JSON.stringify(state)).toBe(before);
    },
  );

  it.each([
    ['an unknown id', ['not_a_biome']],
    ['an empty list', []],
  ] as const)('rejects a static destination list with %s', (_name, destinationBiomeIds) => {
    const state = createRun(132);
    const result = scheduleEventCallbackV3(
      state,
      { ...spec, destinationBiomeIds: [...destinationBiomeIds] },
      source,
      { mono_type: { typeKind: 'weapon', type: 'sword' } },
      () => target,
    );

    expect(result).toEqual({ ok: false, state, reason: 'invalid-target' });
    expect(result.state).toBe(state);
  });

  it.each([
    ['missing subject', spec, {}, target, 'missing-subject'],
    ['malformed subject', spec, { mono_type: 'sword' }, target, 'missing-subject'],
    ['open structured subject', spec, { mono_type: { typeKind: 'weapon', type: 'sword', extra: true } }, target, 'missing-subject'],
    ['missing target', spec, { mono_type: { typeKind: 'weapon', type: 'sword' } }, undefined, 'invalid-target'],
    ['wrong target id', spec, { mono_type: { typeKind: 'weapon', type: 'sword' } }, { ...target, id: 'other' }, 'invalid-target'],
    ['wrong target schema', spec, { mono_type: { typeKind: 'weapon', type: 'sword' } }, { ...target, contentSchemaVersion: 2 }, 'invalid-target'],
    ['wrong target delivery', spec, { mono_type: { typeKind: 'weapon', type: 'sword' } }, { ...target, delivery: { kind: 'ambient' } }, 'invalid-target'],
    ['undeclared accepted slot', spec, { mono_type: { typeKind: 'weapon', type: 'sword' } }, { ...target, acceptsBindings: [] }, 'invalid-target'],
    ['missing required target slot', { ...spec, bind: [] }, {}, target, 'invalid-target'],
    ['wrong required target slot', {
      ...spec,
      bind: [{ as: 'signature_card_id', source: 'signature.cardId' }],
    }, { signature_card_id: 'sword_slash' }, target, 'invalid-target'],
  ] as const)('leaves the identical state for %s', (_name, callbackSpec, subjects, definition, reason) => {
    const state = createRun(14);
    const result = scheduleEventCallbackV3(
      state,
      callbackSpec,
      source,
      subjects as Readonly<EventBoundSubjectsV3>,
      () => definition as LoadedEventDefV3 | undefined,
    );

    expect(result).toEqual({ ok: false, state, reason });
    expect(result.state).toBe(state);
    expect(state.eventCallbackQueue).toEqual([]);
  });

  it('requests the exact content version and rejects an unavailable version without a write', () => {
    const state = createRun(15);
    const calls: Array<readonly [string, number]> = [];
    const result = scheduleEventCallbackV3(state, { ...spec, contentVersion: 4 }, source, {
      mono_type: { typeKind: 'weapon', type: 'sword' },
    }, (eventId, contentVersion) => {
      calls.push([eventId, contentVersion]);
      return contentVersion === 3 ? target : undefined;
    });

    expect(calls).toEqual([['mirror_transformation', 4]]);
    expect(result).toEqual({ ok: false, state, reason: 'invalid-target' });
  });

  it('returns the existing entry for an identical replay and rejects conflicting bytes', () => {
    const first = schedule();
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const replayedState = JSON.parse(JSON.stringify(first.state)) as RunState;
    const duplicate = schedule(replayedState);

    expect(duplicate.ok).toBe(true);
    if (!duplicate.ok) return;
    expect(duplicate.state).toBe(replayedState);
    expect(duplicate.entry).toBe(replayedState.eventCallbackQueue[0]);

    const conflictingState: RunState = {
      ...replayedState,
      eventCallbackQueue: [{ ...replayedState.eventCallbackQueue[0]!, priority: 701 }],
    };
    const conflict = schedule(conflictingState);
    expect(conflict).toEqual({ ok: false, state: conflictingState, reason: 'identity-conflict' });
    expect(conflict.state).toBe(conflictingState);

    const openMonoState = {
      ...replayedState,
      eventCallbackQueue: [{
        ...replayedState.eventCallbackQueue[0]!,
        boundSubjects: {
          mono_type: { typeKind: 'weapon' as const, type: 'sword' as const, extra: true },
        },
      }],
    } as unknown as RunState;
    const openMonoConflict = schedule(openMonoState);
    expect(openMonoConflict).toEqual({
      ok: false, state: openMonoState, reason: 'identity-conflict',
    });
  });

  it('does not resurrect an identity whose terminal resolution is already recorded', () => {
    const first = queuedV3();
    const terminalId = `callback-resolution:${first.entry.callbackInstanceId}`;
    const terminalState: RunState = {
      ...first.state,
      eventCallbackQueue: [],
      eventCallbackResolutionIds: [terminalId],
    };

    const replay = schedule(terminalState);
    expect(replay).toEqual({ ok: false, state: terminalState, reason: 'identity-conflict' });
    expect(replay.state).toBe(terminalState);
    expect(terminalState.eventCallbackQueue).toEqual([]);
    expect(terminalState.eventCallbackResolutionIds).toEqual([terminalId]);
  });

  it('does not resurrect an identity committed to an event instance before its terminal append', () => {
    const first = queuedV3();
    const committedState: RunState = {
      ...first.state,
      eventCallbackQueue: [],
      eventCallbackResolutionIds: [],
      eventInstances: {
        committed: {
          eventId: first.entry.eventId,
          contentVersion: first.entry.contentVersion,
          instanceId: 'event:committed',
          drawnDepth: 7,
          callbackInstanceId: first.entry.callbackInstanceId,
          boundSubjects: first.entry.boundSubjects,
        },
      },
    };

    const replay = schedule(committedState);
    expect(replay).toEqual({ ok: false, state: committedState, reason: 'identity-conflict' });
    expect(replay.state).toBe(committedState);
    expect(committedState.eventCallbackQueue).toEqual([]);
    expect(committedState.eventCallbackResolutionIds).toEqual([]);
  });

  it('fails closed when a malformed live queue repeats one callback identity', () => {
    const first = queuedV3();
    const duplicateState: RunState = {
      ...first.state,
      eventCallbackQueue: [first.entry, { ...first.entry, priority: first.entry.priority + 1 }],
    };

    const replay = schedule(duplicateState);
    expect(replay).toEqual({ ok: false, state: duplicateState, reason: 'identity-conflict' });
    expect(replay.state).toBe(duplicateState);
    expect(duplicateState.eventCallbackQueue).toHaveLength(2);
  });

  it('does not alter source fact reservations or statuses while scheduling', () => {
    const state: RunState = {
      ...createRun(16),
      revengeFactLedger: [{
        battleId: 'battle:1', enemyId: 'wolf_king', finisherCardId: 'sword_slash',
        achievedDepth: 2, status: 'reserved', reservedByInstanceId: source.eventInstanceId,
      }],
      eventBindingReservations: [{
        reservationId: 'reservation:1', instanceId: source.eventInstanceId, source: 'revenge',
        sourceBattleId: 'battle:1', subjectId: 'wolf_king',
      }],
    };
    const beforeFacts = state.revengeFactLedger;
    const beforeReservations = state.eventBindingReservations;
    const result = schedule(state);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.revengeFactLedger).toBe(beforeFacts);
    expect(result.state.eventBindingReservations).toBe(beforeReservations);
  });
});

describe('run/eventCallbacks v3 delivery', () => {
  it('schedules and delivers a valid callback with an empty binding snapshot', () => {
    const emptySpec: EventCallbackSpecV3 = { ...spec, bind: [] };
    const emptyTarget: LoadedEventDefV3 = { ...target, acceptsBindings: undefined };
    const queued = queuedV3(createRun(20), emptySpec, {}, emptyTarget);

    expect(queued.entry.boundSubjects).toEqual({});
    const delivered = deliverEventCallback(queued.state, dueNode, queued.entry, () => emptyTarget);
    expect(delivered?.state.eventCallbackQueue).toEqual([]);
    expect(eventInstanceAt(delivered!.state, dueNode.id)?.boundSubjects).toEqual({});
    expect(delivered?.state.eventCallbackResolutionIds).toEqual([
      `callback-resolution:${queued.entry.callbackInstanceId}`,
    ]);
  });

  it('uses map.seed for both legacy and v3 due biome compatibility', () => {
    const initial = createRun(0);
    const splitSeed = { ...initial, map: { ...initial.map, seed: 2 } };
    const v3Spec: EventCallbackSpecV3 = {
      ...spec,
      destinationBiomeIds: ['arrowfell'],
    };
    const v3 = queuedV3(splitSeed, v3Spec);
    const unstamped = { ...dueNode, biomeId: undefined };

    expect(dueEventCallback(v3.state, unstamped, () => target)).toBe(v3.entry);

    const legacy = scheduleEventCallback(splitSeed, farSightCallback, {
      eventInstanceId: 'legacy:event', choiceId: 'legacy', nodeDepth: 4, ordinal: 0,
    });
    expect(dueEventCallback(
      legacy,
      { ...unstamped, eventTheme: 'omen' },
    )).toBe(legacy.eventCallbackQueue[0]);
  });

  it('delivers at the inclusive expiry boundary without a rarity roll and commits one terminal identity', () => {
    const expiringSpec: EventCallbackSpecV3 = {
      ...spec,
      expiry: { expiresAfterNodes: 3, fallback: 'discard' },
    };
    const queued = queuedV3(createRun(22), expiringSpec);
    const atBoundary = sweepExpiredEventCallbacks(queued.state, 7);
    expect(atBoundary).toBe(queued.state);

    const delivered = deliverEventCallback(atBoundary, dueNode, queued.entry, () => target);
    expect(delivered?.event).toBe(target);
    expect(delivered?.state.eventCallbackQueue).toEqual([]);
    expect(delivered?.state.eventCallbackResolutionIds).toEqual([
      `callback-resolution:${queued.entry.callbackInstanceId}`,
    ]);
    expect(eventInstanceAt(delivered!.state, dueNode.id)).toEqual({
      eventId: target.id,
      contentVersion: 3,
      instanceId: `event:${dueNode.id}`,
      drawnDepth: dueNode.depth,
      callbackInstanceId: queued.entry.callbackInstanceId,
      boundSubjects: { mono_type: { typeKind: 'weapon', type: 'sword' } },
    });
  });

  it('checks callback.queued before removal and leaves competitors and source reservations untouched', () => {
    const base: RunState = {
      ...createRun(23),
      eventBindingReservations: [{
        reservationId: 'reservation:1', instanceId: source.eventInstanceId, source: 'revenge',
        sourceBattleId: 'battle:1', subjectId: 'wolf_king',
      }],
    };
    const queued = queuedV3(base);
    const competitor: EventCallbackQueueEntryV3 = {
      ...queued.entry,
      callbackInstanceId: 'callback:competitor',
      callbackId: 'other',
      priority: 1,
    };
    const state = { ...queued.state, eventCallbackQueue: [queued.entry, competitor] };
    const reservations = state.eventBindingReservations;

    const delivered = deliverEventCallback(state, dueNode, queued.entry, () => target);
    expect(delivered).toBeDefined();
    expect(delivered?.state.eventCallbackQueue).toEqual([competitor]);
    expect(delivered?.state.eventBindingReservations).toBe(reservations);
  });

  it('delivers the canonical persisted binding when the caller passes stale bytes for the same identity', () => {
    const queued = queuedV3();
    const stale: EventCallbackQueueEntryV3 = {
      ...queued.entry,
      boundSubjects: { mono_type: { typeKind: 'weapon', type: 'axe' } },
    };

    const delivered = deliverEventCallback(queued.state, dueNode, stale, () => target);
    expect(eventInstanceAt(delivered!.state, dueNode.id)?.boundSubjects).toEqual({
      mono_type: { typeKind: 'weapon', type: 'sword' },
    });
  });

  it.each([
    ['discard', 'discard' as const],
    ['gold', { outcome: { kind: 'grantGold' as const, amount: 5 } }],
  ])('does not deliver a stale queue entry after %s expiry is terminal', (_name, fallback) => {
    const queued = queuedV3(createRun(26), {
      ...spec,
      expiry: { expiresAfterNodes: 0, fallback },
    });
    const settled = sweepExpiredEventCallbacks(queued.state, 5);
    const stale: RunState = { ...settled, eventCallbackQueue: [queued.entry] };
    const beforeGold = stale.gold;
    const beforeGoldEarned = stale.stats.goldEarned;

    expect(deliverEventCallback(stale, dueNode, queued.entry, () => target)).toBeUndefined();
    expect(stale.eventCallbackQueue).toEqual([queued.entry]);
    expect(stale.eventInstances).toEqual({});
    expect(stale.eventCallbackResolutionIds).toEqual([
      `callback-resolution:${queued.entry.callbackInstanceId}`,
    ]);
    expect(stale.gold).toBe(beforeGold);
    expect(stale.stats.goldEarned).toBe(beforeGoldEarned);
  });

  it('fails closed on duplicate live callback identities without deleting either record', () => {
    const queued = queuedV3();
    const conflict: EventCallbackQueueEntryV3 = {
      ...queued.entry,
      eventId: 'conflicting_target',
      priority: queued.entry.priority + 1,
    };
    const duplicateState: RunState = {
      ...queued.state,
      eventCallbackQueue: [queued.entry, conflict],
    };

    expect(deliverEventCallback(duplicateState, dueNode, queued.entry, () => target)).toBeUndefined();
    expect(duplicateState.eventCallbackQueue).toEqual([queued.entry, conflict]);
    expect(duplicateState.eventInstances).toEqual({});
    expect(duplicateState.eventCallbackResolutionIds).toEqual([]);
  });

  it.each([
    ['missing target', dueNode, undefined],
    ['wrong target id', dueNode, { ...target, id: 'other' }],
    ['wrong target delivery', dueNode, { ...target, delivery: { kind: 'ambient' } }],
    ['wrong theme', { ...dueNode, eventTheme: 'omen' }, target],
    ['wrong biome', { ...dueNode, biomeId: 'emberwaste' }, { ...target, biomeIds: ['arrowfell'] }],
    ['unaccepted queued subject', dueNode, { ...target, acceptsBindings: [] }],
  ] as const)('retains the exact queued state for %s', (_name, node, definition) => {
    const queued = queuedV3();
    expect(deliverEventCallback(
      queued.state,
      node as RunNode,
      queued.entry,
      () => definition as LoadedEventDefV3 | undefined,
    )).toBeUndefined();
    expect(queued.state.eventCallbackQueue).toEqual([queued.entry]);
    expect(eventInstanceAt(queued.state, dueNode.id)).toBeUndefined();
  });

  it.each([
    ['missing required subject', {}],
    ['wrong required subject', { signature_card_id: 'sword_slash' }],
    ['extra subject', {
      mono_type: { typeKind: 'weapon', type: 'sword' }, enemy_id: 'wolf_king',
    }],
  ] as const)('retains a queued v3 callback with %s', (_name, boundSubjects) => {
    const queued = queuedV3();
    const malformedEntry = { ...queued.entry, boundSubjects } as EventCallbackQueueEntryV3;
    const malformedState: RunState = { ...queued.state, eventCallbackQueue: [malformedEntry] };
    const before = JSON.stringify(malformedState);

    expect(deliverEventCallback(malformedState, dueNode, malformedEntry, () => target)).toBeUndefined();
    expect(JSON.stringify(malformedState)).toBe(before);
    expect(malformedState.eventCallbackQueue).toEqual([malformedEntry]);
    expect(eventInstanceAt(malformedState, dueNode.id)).toBeUndefined();
  });

  it('requires a destination-bound callback to keep its copied biome as the sole destination', () => {
    const destinationSpec: EventCallbackSpecV3 = {
      ...spec,
      bind: [{
        as: 'destination_biome', source: 'journey.futureBiome', candidates: 'unvisited_catalog',
      }],
    };
    const destinationTarget: LoadedEventDefV3 = {
      ...target,
      acceptsBindings: ['destination_biome'],
    };
    const queued = queuedV3(
      createRun(29), destinationSpec, { destination_biome: 'arrowfell' }, destinationTarget,
    );
    const malformedEntry: EventCallbackQueueEntryV3 = {
      ...queued.entry,
      destinationBiomeIds: ['emberwaste'],
    };
    const malformedState = { ...queued.state, eventCallbackQueue: [malformedEntry] };
    const destinationNode = { ...dueNode, biomeId: 'emberwaste' };

    expect(deliverEventCallback(
      malformedState, destinationNode, malformedEntry, () => destinationTarget,
    )).toBeUndefined();
    expect(malformedState.eventCallbackQueue).toEqual([malformedEntry]);
    expect(eventInstanceAt(malformedState, destinationNode.id)).toBeUndefined();
  });

  it.each(['not_a_biome', ''])(
    'retains a queued callback with non-catalog dynamic destination %j',
    (destinationBiome) => {
      const destinationSpec: EventCallbackSpecV3 = {
        ...spec,
        bind: [{
          as: 'destination_biome', source: 'journey.futureBiome', candidates: 'unvisited_catalog',
        }],
      };
      const destinationTarget: LoadedEventDefV3 = {
        ...target,
        acceptsBindings: ['destination_biome'],
      };
      const queued = queuedV3(
        createRun(291), destinationSpec, { destination_biome: 'arrowfell' }, destinationTarget,
      );
      const malformedEntry: EventCallbackQueueEntryV3 = {
        ...queued.entry,
        boundSubjects: { destination_biome: destinationBiome },
        destinationBiomeIds: [destinationBiome],
      };
      const malformedState: RunState = { ...queued.state, eventCallbackQueue: [malformedEntry] };
      const before = JSON.stringify(malformedState);

      expect(deliverEventCallback(
        malformedState, dueNode, malformedEntry, () => destinationTarget,
      )).toBeUndefined();
      expect(JSON.stringify(malformedState)).toBe(before);
      expect(malformedState.eventCallbackQueue).toEqual([malformedEntry]);
      expect(eventInstanceAt(malformedState, dueNode.id)).toBeUndefined();
    },
  );

  it('rechecks once and cooldown without consuming the queued callback', () => {
    const queued = queuedV3();
    const previous = {
      ...queued.state,
      eventInstances: {
        prior: {
          eventId: target.id, contentVersion: 3, instanceId: 'event:prior', drawnDepth: 5,
        },
      },
    };
    expect(deliverEventCallback(previous, dueNode, queued.entry, () => target)).toBeUndefined();

    const cooldownTarget: LoadedEventDefV3 = { ...target, once: 'node', cooldownNodes: 2 };
    expect(deliverEventCallback(previous, dueNode, queued.entry, () => cooldownTarget)).toBeUndefined();
    expect(previous.eventCallbackQueue).toEqual([queued.entry]);
  });
});

describe('run/eventCallbacks terminal repair and expiry', () => {
  it('repairs only the exact committed callback, appends its terminal once, and is identity-idempotent', () => {
    const queued = queuedV3();
    const delivered = deliverEventCallback(queued.state, dueNode, queued.entry, () => target)!;
    const interrupted = { ...delivered.state, eventCallbackQueue: [queued.entry] };

    const wrong = repairDeliveredCallback(interrupted, {
      ...eventInstanceAt(interrupted, dueNode.id)!, callbackInstanceId: 'callback:wrong',
    });
    expect(wrong).toBe(interrupted);

    const repaired = repairDeliveredCallback(interrupted, dueNode);
    expect(repaired.eventCallbackQueue).toEqual([]);
    expect(repaired.eventCallbackResolutionIds).toEqual([
      `callback-resolution:${queued.entry.callbackInstanceId}`,
    ]);
    expect(repairDeliveredCallback(repaired, dueNode)).toBe(repaired);
  });

  it('expires discard and gold entries in queue order after the strict boundary, then becomes an identical no-op', () => {
    const first = queuedV3(createRun(24), {
      ...spec,
      expiry: { expiresAfterNodes: 2, fallback: 'discard' },
    });
    const secondEntry: EventCallbackQueueEntryV3 = {
      ...first.entry,
      callbackInstanceId: 'callback:gold',
      expiry: { expiresAfterNodes: 2, fallback: { outcome: { kind: 'grantGold', amount: 4 } } },
    };
    const state = { ...first.state, eventCallbackQueue: [first.entry, secondEntry] };

    expect(sweepExpiredEventCallbacks(state, 6)).toBe(state);
    const expired = sweepExpiredEventCallbacks(state, 7);
    expect(expired.eventCallbackQueue).toEqual([]);
    expect(expired.gold).toBe(state.gold + 4);
    expect(expired.stats.goldEarned).toBe(state.stats.goldEarned + 4);
    expect(expired.eventCallbackResolutionIds).toEqual([
      `callback-resolution:${first.entry.callbackInstanceId}`,
      'callback-resolution:callback:gold',
    ]);
    expect(sweepExpiredEventCallbacks(expired, 8)).toBe(expired);
  });

  it('removes an already-terminal stale entry without paying its fallback again', () => {
    const queued = queuedV3(createRun(25), {
      ...spec,
      expiry: { expiresAfterNodes: 0, fallback: { outcome: { kind: 'grantGold', amount: 5 } } },
    });
    const terminalId = `callback-resolution:${queued.entry.callbackInstanceId}`;
    const stale = { ...queued.state, eventCallbackResolutionIds: [terminalId] };

    const swept = sweepExpiredEventCallbacks(stale, 5);
    expect(swept.eventCallbackQueue).toEqual([]);
    expect(swept.eventCallbackResolutionIds).toEqual([terminalId]);
    expect(swept.gold).toBe(stale.gold);
    expect(swept.stats.goldEarned).toBe(stale.stats.goldEarned);
  });
});
