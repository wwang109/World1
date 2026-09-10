import type {
  EventChoiceV3,
  EventDirectOutcomeSpecV3,
  LoadedEventDefV3,
} from '../../src/data/eventContentV3';
import { recordEventInstance } from '../../src/run/eventInstances';
import { materializeReachedEventV3 } from '../../src/run/eventsV3';
import { createRun, type RunNode, type RunState } from '../../src/run/runState';

export const EVENT_V3_NODE: RunNode = {
  id: 'event-v3-node',
  depth: 4,
  wave: 2,
  kind: 'event',
  eventSeed: 9182,
  eventTheme: 'omen',
  biomeId: 'arrowfell',
};

export function eventV3Choice(
  id: string,
  outcome: EventChoiceV3['outcome'],
  cost = 0,
): EventChoiceV3 {
  return { id, label: `Choice ${id}`, cost, outcome };
}

export function eventV3Fixture(overrides: Partial<LoadedEventDefV3> = {}): LoadedEventDefV3 {
  return {
    id: 'event_v3_store_probe',
    title: 'The Seeded Door',
    body: 'One road opens only when the traveller reaches it.',
    theme: 'omen',
    rarity: 'secret',
    story: { storyId: 'event_v3_store_probe', stage: 'setup', role: 'setup' },
    eligibility: { fact: 'node.depth', args: { op: 'gte', value: 1 } },
    delivery: { kind: 'ambient' },
    visibility: 'hidden_until_eligible',
    priority: 400,
    once: 'run',
    cooldownNodes: 0,
    choiceSet: {
      fixed: [
        eventV3Choice('take', { kind: 'grantGold', amount: 3 }),
        eventV3Choice('leave', { kind: 'nothing' }),
      ],
    },
    contentSchemaVersion: 3,
    ...overrides,
  } as LoadedEventDefV3;
}

export function runAtEventV3Node(seed = 71, overrides: Partial<RunState> = {}): RunState {
  const base = createRun(seed);
  return {
    ...base,
    status: 'active',
    currentNodeId: EVENT_V3_NODE.id,
    map: { ...base.map, depths: [[], [EVENT_V3_NODE]] },
    ...overrides,
  };
}

export function materializedEventV3(
  event: LoadedEventDefV3,
  seed = 71,
  overrides: Partial<RunState> = {},
): RunState {
  const committed = recordEventInstance(runAtEventV3Node(seed, overrides), EVENT_V3_NODE.id, {
    eventId: event.id,
    contentVersion: 1,
    instanceId: `event:${EVENT_V3_NODE.id}`,
    drawnDepth: EVENT_V3_NODE.depth,
  });
  const result = materializeReachedEventV3(committed, EVENT_V3_NODE, event, 1);
  if (!result.ok) throw new Error(`fixture materialization failed (${result.reason})`);
  return result.state;
}

export function eventWithOutcome(outcome: EventDirectOutcomeSpecV3): LoadedEventDefV3 {
  return eventV3Fixture({
    choiceSet: {
      fixed: [
        eventV3Choice('act', outcome),
        eventV3Choice('leave', { kind: 'nothing' }),
      ],
    },
  });
}

/** Generic future-biome producer/consumer pair. Its probe IDs deliberately do
 * not match shipped content, so semantic tests cannot pass through an event-ID
 * special case. */
export function futureBiomeEventV3(
  outcome: EventDirectOutcomeSpecV3 = { kind: 'nothing' },
): { source: LoadedEventDefV3; target: LoadedEventDefV3 } {
  const target = eventV3Fixture({
    id: 'future_biome_callback_probe',
    title: 'Future biome callback probe',
    story: { storyId: 'future_biome_source_probe', stage: 'callback', role: 'callback' },
    eligibility: {
      fact: 'callback.queued', args: { callbackId: 'future_biome_callback_probe' },
    },
    delivery: { kind: 'queued_callback' },
    visibility: 'teased_when_due',
    acceptsBindings: ['destination_biome'],
    choiceSet: { fixed: [
      eventV3Choice('claim', { kind: 'nothing' }),
      eventV3Choice('leave', { kind: 'nothing' }),
    ] },
  });
  const source = eventV3Fixture({
    id: 'future_biome_source_probe',
    bindings: [{
      as: 'destination_biome', source: 'journey.futureBiome', candidates: 'unvisited_catalog',
    }],
    choiceSet: { fixed: [
      {
        ...eventV3Choice('mark_road', outcome),
        callback: {
          callbackId: 'future_biome_callback_probe',
          eventId: target.id,
          contentVersion: 1,
          minDepthDelay: 2,
          destinationThemes: ['omen'],
          priority: 700,
          bind: [{
            as: 'destination_biome', source: 'journey.futureBiome', candidates: 'unvisited_catalog',
          }],
          expiry: { expiresAfterNodes: 20, fallback: 'discard' },
        },
      },
      eventV3Choice('study', { kind: 'grantLevel' }),
    ] },
  });
  return { source, target };
}
