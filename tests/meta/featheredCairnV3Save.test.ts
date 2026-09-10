import { describe, expect, it } from 'vitest';
import { isEventDefV3 } from '../../src/data/eventContentV3';
import { eventDefAtVersion } from '../../src/data/eventsContent';
import {
  loadRun,
  RUN_SAVE_STORAGE_KEY,
  saveRun,
} from '../../src/meta/runSave';
import { recordEventInstance } from '../../src/run/eventInstances';
import { materializeReachedEventV3, resolveEventChoiceV3 } from '../../src/run/eventsV3';
import { EVENT_V3_NODE, runAtEventV3Node } from '../fixtures/eventV3';
import { fakeStorage } from '../fixtures/storage';

describe('Feathered Cairn live schema-v3 save compatibility', () => {
  it('round-trips the exact pending version-2 offer bytes without rerolling or recounting', () => {
    const event = eventDefAtVersion('feathered_cairn', 2);
    expect(event !== undefined && isEventDefV3(event)).toBe(true);
    if (event === undefined || !isEventDefV3(event)) throw new Error('missing Feathered Cairn @2');

    const instanceId = `event:${EVENT_V3_NODE.id}`;
    const committed = recordEventInstance(runAtEventV3Node(803), EVENT_V3_NODE.id, {
      eventId: event.id,
      contentVersion: 2,
      instanceId,
      drawnDepth: EVENT_V3_NODE.depth,
    });
    const materialized = materializeReachedEventV3(committed, EVENT_V3_NODE, event, 2);
    expect(materialized.ok).toBe(true);
    if (!materialized.ok) throw new Error(materialized.reason);
    const resolved = resolveEventChoiceV3(
      materialized.state,
      instanceId,
      'take_fletchers_gift',
      eventDefAtVersion,
    );
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) throw new Error(resolved.reason);
    expect(resolved.outcome.kind).toBe('cardChoice');
    expect(resolved.state.stats.eventsResolved).toBe(1);

    const storage = fakeStorage();
    expect(saveRun(storage, resolved.state)).toEqual({ ok: true });
    const firstBytes = storage.get(RUN_SAVE_STORAGE_KEY);
    const reloaded = loadRun(storage);
    expect(reloaded).toStrictEqual(resolved.state);
    expect(reloaded?.eventMaterializations[instanceId]).toStrictEqual(
      resolved.state.eventMaterializations[instanceId],
    );

    expect(saveRun(storage, reloaded!)).toEqual({ ok: true });
    expect(storage.get(RUN_SAVE_STORAGE_KEY)).toBe(firstBytes);
    expect(reloaded?.stats.eventsResolved).toBe(1);
  });
});
