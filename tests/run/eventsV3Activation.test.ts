import { describe, expect, it } from 'vitest';
import { isEventDefV3 } from '../../src/data/eventContentV3';
import type { LoadedEventDef } from '../../src/data/eventsContent';
import {
  eventCatalogFromJson,
  eventContentMeta,
  eventDefAtVersion,
  loadedEventCatalogFromJson,
} from '../../src/data/eventsContent';
import { eventCatalog, eventCatalogIds, eventRuntimeCatalogIds, type EventDef } from '../../src/data/events';
import { hashSeed } from '../../src/engine/rng';
import {
  rollEventForNode,
  type EventSelectionContent,
} from '../../src/run/events';
import { EVENT_V3_NODE, eventV3Fixture, runAtEventV3Node } from '../fixtures/eventV3';
import { activeRun, eventNode, withBowAffinityBoard } from '../fixtures/eventV2';

function source(events: readonly LoadedEventDef[]): EventSelectionContent {
  return {
    catalog: Object.fromEntries(events.map((event) => [event.id, event])),
    orderedIds: events.map((event) => event.id),
    currentVersionOf: () => 1,
  };
}

describe('rollEventForNode schema-v3 activation path', () => {
  it('activates all 66 current definitions while retaining the frozen 44-id legacy facade and exact history', () => {
    expect(Object.keys(loadedEventCatalogFromJson)).toHaveLength(66);
    expect(eventRuntimeCatalogIds).toHaveLength(66);
    expect(Object.keys(eventCatalogFromJson)).toHaveLength(44);
    expect(eventCatalogIds).toHaveLength(44);
    expect(eventCatalog).toBe(eventCatalogFromJson);

    const cairnV1 = eventDefAtVersion('feathered_cairn', 1);
    const cairnV2 = eventDefAtVersion('feathered_cairn', 2);
    expect(isEventDefV3(cairnV1!)).toBe(false);
    expect(isEventDefV3(cairnV2!)).toBe(true);
    expect(loadedEventCatalogFromJson.feathered_cairn).toBe(cairnV2);
    expect(eventContentMeta.feathered_cairn).toMatchObject({ version: 2, versions: [1, 2] });
  });

  it('uses the sole default selector to commit current v3 content only when its node is reached', () => {
    const state = withBowAffinityBoard(activeRun(8128));
    const def = eventDefAtVersion('feathered_cairn', 2);
    expect(def !== undefined && isEventDefV3(def)).toBe(true);
    if (def === undefined || !isEventDefV3(def)) throw new Error('missing current Feathered Cairn');
    let eventSeed = -1;
    for (let seed = 0; seed <= 32; seed += 1) {
      if (hashSeed('eventRarity', seed, def.id) % 2 === 0) {
        eventSeed = seed;
        break;
      }
    }
    expect(eventSeed).toBeGreaterThanOrEqual(0);
    const node = eventNode({ id: 'live-v3-cairn', eventSeed });

    expect(state.eventInstances).toEqual({});
    expect(state.eventMaterializations).toEqual({});
    const selected = rollEventForNode(state, node);
    expect(selected.event).toBe(def);
    expect(selected.state.eventInstances[node.id]).toMatchObject({
      eventId: 'feathered_cairn', contentVersion: 2, instanceId: `event:${node.id}`,
    });
    expect(selected.state.eventMaterializations[`event:${node.id}`]?.choiceIds).toEqual([
      'read_feathers', 'take_fletchers_gift', 'leave',
    ]);
  });

  it('keeps lookup-only selection honestly mixed while explicit frozen content stays legacy-shaped', () => {
    const state = withBowAffinityBoard(activeRun(8128));
    const currentCairn = eventDefAtVersion('feathered_cairn', 2);
    const legacyCairn = eventCatalog.feathered_cairn;
    if (currentCairn === undefined || !isEventDefV3(currentCairn) || legacyCairn === undefined) {
      throw new Error('missing current or frozen Feathered Cairn');
    }
    const eventSeed = Array.from({ length: 33 }, (_unused, seed) => seed).find(
      (seed) => hashSeed('eventRarity', seed, currentCairn.id) % 2 === 0,
    );
    expect(eventSeed).toBeDefined();
    const node = eventNode({ id: 'lookup-only-live-v3', eventSeed });
    const legacyLookup = (eventId: string, contentVersion: number): EventDef | undefined => (
      contentVersion === 1 ? eventCatalog[eventId] : undefined
    );

    const lookupOnly = rollEventForNode(state, node, legacyLookup);
    expect(isEventDefV3(lookupOnly.event)).toBe(true);
    expect(lookupOnly.event).toBe(currentCairn);
    // @ts-expect-error Lookup-only calls use live mixed content; callers must narrow before legacy-only fields.
    void lookupOnly.event.choices;

    const frozenCatalog: Record<string, EventDef> = { [legacyCairn.id]: legacyCairn };
    const frozenContent = {
      catalog: frozenCatalog,
      orderedIds: [legacyCairn.id],
      currentVersionOf: () => 1,
    };
    const frozen = rollEventForNode(state, { ...node, id: 'explicit-frozen-v2' }, legacyLookup, frozenContent);
    expect(isEventDefV3(frozen.event)).toBe(false);
    expect(frozen.event).toBe(legacyCairn);
    expect(frozen.event.choices.length).toBeGreaterThan(0);
  });

  it('selects only on the reached node and persists the exact v3 materialization before return', () => {
    const candidates = [
      eventV3Fixture({ id: 'alpha', rarity: 'common' }),
      eventV3Fixture({ id: 'beta', rarity: 'common' }),
    ];
    const content = source(candidates);
    const lookup = (id: string, version: number) => version === 1 ? content.catalog[id] : undefined;
    const first = rollEventForNode(runAtEventV3Node(1), EVENT_V3_NODE, lookup, content);
    const replay = rollEventForNode(structuredClone(first.state), EVENT_V3_NODE, lookup, content);

    expect(first.event.id).toMatch(/^(alpha|beta)$/);
    expect(first.state.eventMaterializations[`event:${EVENT_V3_NODE.id}`]?.choiceIds).toHaveLength(2);
    expect(Object.keys(first.state.eventInstances)).toEqual([EVENT_V3_NODE.id]);
    expect(replay.event.id).toBe(first.event.id);
    expect(replay.state.eventMaterializations).toEqual(first.state.eventMaterializations);

    const drawn = new Set<string>();
    for (let seed = 1; seed <= 24; seed += 1) {
      drawn.add(rollEventForNode(runAtEventV3Node(seed), EVENT_V3_NODE, lookup, content).event.id);
    }
    expect(drawn).toEqual(new Set(['alpha', 'beta']));
  });
});
