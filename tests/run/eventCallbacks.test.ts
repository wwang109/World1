import { describe, expect, it } from 'vitest';
import type { EventDefV2 } from '../../src/data/eventContentV2';
import { hashSeed } from '../../src/engine/rng';
import type { EventCallbackQueueEntry, RunNode, RunState } from '../../src/run/runState';
import {
  deliverEventCallback,
  dueEventCallback,
  repairDeliveredCallback,
  scheduleEventCallback,
  sweepExpiredEventCallbacks,
} from '../../src/run/eventCallbacks';
import { eventInstanceAt, recordEventInstance } from '../../src/run/eventInstances';
import { resolveEventChoice, rollEventForNode } from '../../src/run/events';
import { biomeFor } from '../../src/run/biome';
import { leaveEvent, leaveShop, recordBattleResult } from '../../src/run/runState';
import { activeRun, eventNode, farSightCallback, installCurrentNode, roundTrip } from '../fixtures/eventV2';

const source = {
  eventInstanceId: 'run:1103:node:d3-0',
  choiceId: 'read_feathers',
  nodeDepth: 3,
  ordinal: 0,
};

const dueNode: RunNode = {
  id: 'd5-0', depth: 5, wave: 3, kind: 'event', eventSeed: 9, eventTheme: 'omen', biomeId: 'arrowfell',
};

const farSightDelivery: EventDefV2 = {
  id: 'feathered_cairn_far_sight', title: 'Far Sight', body: 'Copy that must not affect delivery.', theme: 'omen', rarity: 'common',
  biomeIds: ['arrowfell'], story: { storyId: 'feathered_cairn', stage: 'callback', role: 'callback' },
  eligibility: { fact: 'callback.queued', args: { callbackId: 'feathered_cairn_far_sight' } },
  delivery: { kind: 'queued_callback' }, visibility: 'teased_when_due', priority: 700, once: 'run', cooldownNodes: 0,
  choices: [{ id: 'leave', label: 'Leave', cost: 0, outcome: { kind: 'nothing' } }],
};

const callbackSetup: EventDefV2 = {
  id: 'callback_setup', title: 'Setup', body: 'Presentation text has no resolver role.', theme: 'cache', rarity: 'common',
  story: { storyId: 'callback_setup', stage: 'setup', role: 'setup' },
  eligibility: { fact: 'callback.queued', args: { callbackId: 'not_used_for_setup' } },
  delivery: { kind: 'ambient' }, visibility: 'visible', priority: 200, once: 'run', cooldownNodes: 0,
  choices: [{
    id: 'read_feathers', label: 'Different presentation string', cost: 2, outcome: { kind: 'grantGold', amount: 1 },
    mutations: [{ op: 'completeStory', storyId: 'callback_setup' }], callback: farSightCallback,
  }],
};

function queuedFarSight(seed = 1103): RunState {
  return scheduleEventCallback(activeRun(seed), farSightCallback, source);
}

function entry(id: string, overrides: Partial<EventCallbackQueueEntry> = {}): EventCallbackQueueEntry {
  return {
    callbackInstanceId: id,
    callbackId: 'feathered_cairn_far_sight',
    eventId: 'feathered_cairn_far_sight',
    contentVersion: 1,
    scheduledDepth: 3,
    earliestDepth: 5,
    minDepthDelay: 2,
    destinationThemes: ['omen'],
    destinationBiomeIds: ['arrowfell'],
    priority: 700,
    boundSubjects: {},
    expiry: { expiresAfterNodes: 20, fallback: 'discard' },
    ...overrides,
  };
}

function expiredGrantEntry(): EventCallbackQueueEntry {
  return entry('callback:expired-grant', {
    scheduledDepth: 3,
    earliestDepth: 3,
    minDepthDelay: 0,
    expiry: { expiresAfterNodes: 0, fallback: { outcome: { kind: 'grantGold', amount: 3 } } },
  });
}

describe('run/eventCallbacks: schedule and due ordering', () => {
  it('derives legacy callback identity from the canonical map seed when the duplicate seed diverges', () => {
    const initial = activeRun(0);
    const state = { ...initial, map: { ...initial.map, seed: 2 } };

    const queued = scheduleEventCallback(state, farSightCallback, source);

    expect(queued.eventCallbackQueue[0]?.callbackInstanceId).toBe(`callback:${hashSeed(
      'eventCallback',
      state.map.seed,
      source.eventInstanceId,
      source.choiceId,
      farSightCallback.callbackId,
      source.ordinal,
    )}`);
  });

  it('uses the canonical map seed for a legacy callback on an unstamped node', () => {
    const initial = activeRun(0);
    const state = { ...initial, map: { ...initial.map, seed: 2 } };
    const queued = scheduleEventCallback(state, farSightCallback, source);
    const unstamped: RunNode = { ...dueNode, biomeId: undefined };

    expect(biomeFor(state.map.seed, unstamped.wave).id).toBe('arrowfell');
    expect(biomeFor(state.seed, unstamped.wave).id).not.toBe('arrowfell');
    expect(dueEventCallback(queued, unstamped)).toBe(queued.eventCallbackQueue[0]);
  });

  it('schedules the exact Far Sight source at depth 3 with its two-node delay, and rejects a forge destination', () => {
    const queued = queuedFarSight();

    expect(queued.eventCallbackQueue[0]).toMatchObject({
      scheduledDepth: 3,
      earliestDepth: 5,
      minDepthDelay: 2,
    });
    const wrong: RunNode = { ...dueNode, eventTheme: 'forge' };
    expect(dueEventCallback(queued, wrong)).toBeUndefined();
  });

  it('orders compatible due callbacks by descending priority, then earliest source depth, then lexical instance id', () => {
    const state: RunState = {
      ...activeRun(),
      eventCallbackQueue: [
        entry('callback:z', { priority: 700, scheduledDepth: 4 }),
        entry('callback:b', { priority: 900, scheduledDepth: 4 }),
        entry('callback:a', { priority: 900, scheduledDepth: 4 }),
        entry('callback:c', { priority: 900, scheduledDepth: 3 }),
      ],
    };

    expect(dueEventCallback(state, dueNode)?.callbackInstanceId).toBe('callback:c');
    expect(dueEventCallback({ ...state, eventCallbackQueue: state.eventCallbackQueue.filter((candidate) => candidate.callbackInstanceId !== 'callback:c') }, dueNode)?.callbackInstanceId)
      .toBe('callback:a');
  });

  it('retains incompatible and avoided callbacks, and does not duplicate the exact source schedule across reload', () => {
    const queued = queuedFarSight();
    const duplicate = scheduleEventCallback(roundTrip(queued), farSightCallback, source);
    const shop: RunNode = { id: 'd4-shop', depth: 4, wave: 2, kind: 'shop', shopId: 'shelter', shopSeed: 3, biomeId: 'arrowfell' };
    const avoided = leaveShop(installCurrentNode(duplicate, shop));

    expect(duplicate.eventCallbackQueue).toEqual(queued.eventCallbackQueue);
    expect(dueEventCallback(avoided, { ...dueNode, eventTheme: 'forge' })).toBeUndefined();
    expect(avoided.eventCallbackQueue).toEqual(queued.eventCallbackQueue);
    expect(dueEventCallback(roundTrip(avoided), dueNode)?.callbackInstanceId).toBe(queued.eventCallbackQueue[0]?.callbackInstanceId);
  });

  it('delivers a biome-restricted callback to an unstamped legacy node when its run-derived biome is Arrowfell', () => {
    const queued = queuedFarSight(2);
    const legacyNode: RunNode = { ...dueNode, biomeId: undefined };
    expect(biomeFor(queued.seed, legacyNode.wave, legacyNode.biomeId).id).toBe('arrowfell');

    const selected = dueEventCallback(queued, legacyNode);
    expect(selected).toBeDefined();
    if (!selected) return;
    expect(deliverEventCallback(queued, legacyNode, selected, () => farSightDelivery)?.event.id).toBe('feathered_cairn_far_sight');
  });

  it('does not deliver a biome-restricted callback to an unstamped legacy node with a different derived biome', () => {
    const queued = queuedFarSight(0);
    const legacyNode: RunNode = { ...dueNode, biomeId: undefined };
    expect(biomeFor(queued.seed, legacyNode.wave, legacyNode.biomeId).id).toBe('swornhold');
    expect(dueEventCallback(queued, legacyNode)).toBeUndefined();
  });
});

describe('run/eventCallbacks: atomic exact-version delivery and repair', () => {
  it('scans a due callback before conditional or ordinary selection, but leaves a missing version for an ordinary draw', () => {
    const delivered = rollEventForNode(queuedFarSight(), dueNode, () => farSightDelivery);
    expect(delivered.event.id).toBe('feathered_cairn_far_sight');
    expect(delivered.state.eventCallbackQueue).toEqual([]);

    const ordinary = rollEventForNode(queuedFarSight(), dueNode, () => undefined);
    expect(ordinary.event.id).not.toBe('feathered_cairn_far_sight');
    expect(ordinary.state.eventCallbackQueue).toHaveLength(1);
  });

  it('delivers the selected callback by committing the node instance and removing only that queue entry', () => {
    const queued = {
      ...queuedFarSight(),
      eventCallbackQueue: [...queuedFarSight().eventCallbackQueue, entry('callback:competitor', { priority: 600 })],
    };
    const selected = dueEventCallback(queued, dueNode);
    expect(selected).toBeDefined();
    if (!selected) return;

    const delivered = deliverEventCallback(queued, dueNode, selected, () => farSightDelivery);
    expect(delivered?.event.id).toBe('feathered_cairn_far_sight');
    expect(eventInstanceAt(delivered!.state, dueNode.id)).toMatchObject({
      eventId: 'feathered_cairn_far_sight', contentVersion: 1, callbackInstanceId: selected.callbackInstanceId,
    });
    expect(delivered!.state.eventCallbackQueue.map((candidate) => candidate.callbackInstanceId)).toEqual(['callback:competitor']);

    const reloaded = rollEventForNode(roundTrip(delivered!.state), dueNode, () => farSightDelivery);
    expect(reloaded.event.id).toBe('feathered_cairn_far_sight');
    expect(reloaded.state.eventCallbackQueue.map((candidate) => candidate.callbackInstanceId)).toEqual(['callback:competitor']);
  });

  it('keeps a missing exact version queued without mutating the node, so a caller can continue to ordinary selection', () => {
    const queued = queuedFarSight();
    const selected = dueEventCallback(queued, dueNode);
    expect(selected).toBeDefined();
    if (!selected) return;

    expect(deliverEventCallback(queued, dueNode, selected, () => undefined)).toBeUndefined();
    expect(eventInstanceAt(queued, dueNode.id)).toBeUndefined();
    expect(queued.eventCallbackQueue).toHaveLength(1);
  });

  it('repairs only an interrupted matching delivery and is idempotent without rerolling or rewarding', () => {
    const queued = queuedFarSight();
    const selected = dueEventCallback(queued, dueNode);
    expect(selected).toBeDefined();
    if (!selected) return;
    const delivered = deliverEventCallback(queued, dueNode, selected, () => farSightDelivery);
    expect(delivered).toBeDefined();
    if (!delivered) return;
    const interrupted = { ...delivered.state, eventCallbackQueue: [selected] };

    const repaired = repairDeliveredCallback(interrupted, dueNode);
    expect(repaired.eventCallbackQueue).toEqual([]);
    expect(repaired.gold).toBe(interrupted.gold);
    expect(repairDeliveredCallback(repaired, dueNode)).toBe(repaired);
  });
});

describe('run/events: callback choice transaction', () => {
  it('commits cost, typed outcome, story completion, queue, resolution, and stats together exactly once', () => {
    const node = eventNode({ id: 'd3-0', depth: 3, eventTheme: 'cache' });
    const active = installCurrentNode({ ...activeRun(), gold: 10 }, node);
    const committed = recordEventInstance(active, node.id, {
      eventId: 'callback_setup', contentVersion: 1, instanceId: source.eventInstanceId, drawnDepth: 3,
    });

    const resolved = resolveEventChoice(committed, 'callback_setup', 'read_feathers', () => callbackSetup);
    expect(resolved.outcome).toEqual({ kind: 'grantGold', amount: 1 });
    expect(resolved.state.gold).toBe(9);
    expect(resolved.state.stats).toMatchObject({ goldSpent: committed.stats.goldSpent + 2, goldEarned: committed.stats.goldEarned + 1, eventsResolved: committed.stats.eventsResolved + 1 });
    expect(resolved.state.completedStoryIds).toEqual(['callback_setup']);
    expect(resolved.state.eventCallbackQueue).toHaveLength(1);
    expect(resolved.state.eventResolutions?.[node.id]).toMatchObject({ eventId: 'callback_setup', contentVersion: 1, instanceId: source.eventInstanceId, choiceId: 'read_feathers' });
    expect(() => resolveEventChoice(resolved.state, 'callback_setup', 'read_feathers', () => callbackSetup)).toThrow(/already resolved/);
    expect(resolved.state.eventCallbackQueue).toHaveLength(1);
  });
});

describe('run/eventCallbacks: strict post-node expiry', () => {
  it('leaves a callback deliverable at its expiry boundary, then expires it only after the boundary', () => {
    const queued = scheduleEventCallback(activeRun(), { ...farSightCallback, expiry: { expiresAfterNodes: 2, fallback: 'discard' } }, source);

    const atBoundary = sweepExpiredEventCallbacks(queued, 5);
    expect(atBoundary.eventCallbackQueue).toHaveLength(1);
    expect(dueEventCallback(atBoundary, dueNode)).toBeDefined();
    expect(sweepExpiredEventCallbacks(atBoundary, 6).eventCallbackQueue).toEqual([]);
  });

  it('uses the same post-clear sweep for a fight, shop, and event, and runs a grant fallback once', () => {
    const cases: Array<{ name: string; node: RunNode; finish: (state: RunState) => RunState }> = [
      {
        name: 'fight',
        node: { id: 'd4-fight', depth: 4, wave: 2, kind: 'fight', fightNumber: 2, fightOption: 'standard', encounterSeed: 3, biomeId: 'arrowfell' },
        finish: (state) => recordBattleResult(state, { won: true, goldEarned: 0 }),
      },
      {
        name: 'shop',
        node: { id: 'd4-shop', depth: 4, wave: 2, kind: 'shop', shopId: 'shelter', shopSeed: 3, biomeId: 'arrowfell' },
        finish: leaveShop,
      },
      {
        name: 'event',
        node: { ...eventNode({ id: 'd4-event', depth: 4, wave: 2, eventTheme: 'cache' }) },
        finish: leaveEvent,
      },
    ];

    for (const { name, node, finish } of cases) {
      const before = { ...installCurrentNode(activeRun(), node), eventCallbackQueue: [expiredGrantEntry()] };
      const after = finish(before);
      expect(after.currentNodeId, name).toBeNull();
      expect(after.eventCallbackQueue, name).toEqual([]);
      expect(after.gold, name).toBe(before.gold + 3);
      expect(after.stats.goldEarned, name).toBe(before.stats.goldEarned + 3);
      expect(sweepExpiredEventCallbacks(after, node.depth), name).toBe(after);
    }
  });
});
