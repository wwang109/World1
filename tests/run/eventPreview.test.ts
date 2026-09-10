import { describe, expect, it } from 'vitest';
import { eventDefAtVersion } from '../../src/data/eventsContent';
import { hashSeed } from '../../src/engine/rng';
import { scheduleEventCallback } from '../../src/run/eventCallbacks';
import { recordEventInstance } from '../../src/run/eventInstances';
import { previewEventForNode } from '../../src/run/eventPreview';
import { rollEventForNode } from '../../src/run/events';
import type { RunNode } from '../../src/run/runState';
import { activeRun, eventNode, farSightCallback, withOffBoardBowCards } from '../fixtures/eventV2';

describe('previewEventForNode', () => {
  it.each(['shop', 'fight', 'boss'] as const)(
    'does not accidentally roll an event or mutate state for a %s node',
    (kind) => {
      const state = activeRun();
      const node: RunNode = { id: `preview-${kind}`, depth: 3, wave: 2, kind };
      const before = JSON.stringify(state);

      expect(previewEventForNode(state, node)).toBeNull();
      expect(JSON.stringify(state)).toBe(before);
    },
  );

  it.each([0, 1, 1103])(
    'does not consume bags or change the subsequently committed identity for seed %i',
    (seed) => {
      const state = { ...activeRun(seed), gold: 0 };
      const node = eventNode({ eventTheme: undefined });
      const before = JSON.stringify(state);

      const preview = previewEventForNode(state, node);
      expect(preview).not.toBeNull();
      expect(JSON.stringify(state)).toBe(before);
      expect(previewEventForNode(state, node)).toBe(preview);
      expect(JSON.stringify(state)).toBe(before);

      const committed = rollEventForNode(state, node);
      const instance = committed.state.eventInstances[node.id]!;
      expect(committed.event.id).toBe(preview!.id);
      expect(committed.event.title).toBe(preview!.title);
      expect(eventDefAtVersion(instance.eventId, instance.contentVersion)).toBe(preview);
      expect(committed.state.eventInstances[node.id]).toBeDefined();
      expect(committed.state.eventBagRefills).toBeGreaterThan(state.eventBagRefills);
      expect(JSON.stringify(state)).toBe(before);
    },
  );

  it('does not substitute current content for a recorded historical version', () => {
    const node = eventNode();
    const state = recordEventInstance(activeRun(), node.id, {
      eventId: 'feathered_cairn', contentVersion: 1,
      instanceId: 'preview-historical', drawnDepth: node.depth,
    });
    const before = JSON.stringify(state);

    const preview = previewEventForNode(state, node);
    expect(preview).toBe(eventDefAtVersion('feathered_cairn', 1));
    expect(preview).not.toBe(eventDefAtVersion('feathered_cairn', 2));
    const committed = rollEventForNode(state, node);
    expect(committed.event).toBe(preview);
    expect(committed.state.eventInstances[node.id]?.contentVersion).toBe(1);
    expect(JSON.stringify(state)).toBe(before);
  });

  it('does not consume a due callback while previewing its exact version ahead of ordinary events', () => {
    const state = scheduleEventCallback(activeRun(), farSightCallback, {
      eventInstanceId: 'preview-source', choiceId: 'read_feathers', nodeDepth: 3, ordinal: 0,
    });
    const node = eventNode({ id: 'preview-callback', depth: 5, wave: 3, eventTheme: 'omen' });
    const before = JSON.stringify(state);

    const preview = previewEventForNode(state, node);
    expect(preview).toBe(eventDefAtVersion('feathered_cairn_far_sight', 1));
    expect(JSON.stringify(state)).toBe(before);
    const committed = rollEventForNode(state, node);
    expect(committed.event).toBe(preview);
    expect(committed.state.eventInstances[node.id]?.contentVersion).toBe(1);
    expect(committed.state.eventCallbackQueue).toEqual([]);
    expect(state.eventCallbackQueue).toHaveLength(1);
    expect(JSON.stringify(state)).toBe(before);
  });

  it('does not persist v3 conditional materialization or lose its selected version during preview', () => {
    const state = withOffBoardBowCards(activeRun(8128));
    const eventSeed = Array.from({ length: 33 }, (_, seed) => seed).find(
      (seed) => hashSeed('eventRarity', seed, 'feathered_cairn') % 2 === 0,
    );
    expect(eventSeed).toBeDefined();
    const node = eventNode({ id: 'preview-v3-cairn', eventSeed });
    const before = JSON.stringify(state);

    const preview = previewEventForNode(state, node);
    expect(preview).toBe(eventDefAtVersion('feathered_cairn', 2));
    expect(JSON.stringify(state)).toBe(before);
    const committed = rollEventForNode(state, node);
    expect(committed.event).toBe(preview);
    expect(committed.state.eventInstances[node.id]?.contentVersion).toBe(2);
    expect(committed.state.eventMaterializations[`event:${node.id}`]).toBeDefined();
    expect(state.eventMaterializations).toEqual({});
    expect(JSON.stringify(state)).toBe(before);
  });
});
