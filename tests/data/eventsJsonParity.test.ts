import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  eventCatalogFromJson,
  eventContentMeta,
  loadEventContent,
  requireLegacyEventContent,
} from '../../src/data/eventsContent';
import { eventCatalog, eventCatalogIds } from '../../src/data/events';
import { eventDefOfDocument, validateEventDocument } from '../../src/data/validateEventContent';

interface ParsedEventDocument {
  id: string;
  versions: Array<{ version: number; def: Record<string, unknown> }>;
}

interface ParsedEventsContent {
  notes?: string[];
  events: ParsedEventDocument[];
}

const jsonPath = new URL('../../src/data/content/events.v1.json', import.meta.url);
const document = JSON.parse(readFileSync(jsonPath, 'utf8')) as ParsedEventsContent;
const activeJsonPath = new URL('../../src/data/content/events.v2.json', import.meta.url);
const activeDocumentBytes = readFileSync(activeJsonPath, 'utf8');
const activeDocument = JSON.parse(activeDocumentBytes) as ParsedEventsContent;

const FROZEN_PRE_BELL_EVENT_IDS = [
  'abandoned_cache',
  'banner_scribe',
  'beast_nest',
  'broken_axle',
  'cinderworks_regrind',
  'circle_of_adepts',
  'collapsed_barrow',
  'crossroads_shrine',
  'ember_pit',
  'factors_ledger',
  'fences_offer',
  'field_medic',
  'flaw_finder',
  'fortune_teller',
  'gambler',
  'gemsellers_mishap',
  'hermits_riddle',
  'overloaded_caravan',
  'pyre_watch',
  'quartermasters_error',
  'recruiter',
  'retiring_smith',
  'ruined_anvil',
  'sellsword_camp',
  'sparring_circle',
  'sweep_drill',
  'the_lands_measure',
  'the_lapidary',
  'the_reckoning',
  'thorn_garden_shrine',
  'toll_bridge',
  'toll_collectors_ledger',
  'tutors_return',
  'two_ravens',
  'venomers_den',
  'veterans_last_lesson',
  'wandering_smith',
  'wandering_tutor',
  'weighing_stone',
] as const;

const BELL_EVENT_IDS = ['bell_beneath_ice', 'the_bell_unbound', 'the_second_toll'] as const;
const EXPECTED_EVENT_IDS = [...FROZEN_PRE_BELL_EVENT_IDS, ...BELL_EVENT_IDS].sort();
const MATERIALIZED_EVENT_IDS = ['feathered_cairn', 'feathered_cairn_far_sight'] as const;
const EXPECTED_ACTIVE_EVENT_IDS = [...EXPECTED_EVENT_IDS, ...MATERIALIZED_EVENT_IDS].sort();

const EXPECTED_DEFINITION_SHA256 = 'd74bec09871e5b5cd0988fabc5d5dfdb4f0d709fe7cfac1794d882e45812584b';
const FROZEN_ACTIVE_V2_SHA256 = '5d6e14f0edead7f18606116af5d5800edb1590bbf5b2b3a6db3905fb9e9cbd7a';

/** Canonicalize object-key order while preserving every array order. The only
 * omitted field is authoring-only `notes`, which never belongs to EventDef. */
function normalizedDefinition(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizedDefinition);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => key !== 'notes')
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, nested]) => [key, normalizedDefinition(nested)]),
  );
}

const definition = (title: string, notes?: readonly string[]): Record<string, unknown> => ({
  title,
  body: 'A test event.',
  theme: 'training',
  ...(notes !== undefined ? { notes } : {}),
  choices: [
    { id: 'take', label: 'Take', outcome: { kind: 'grantGold', amount: 1 } },
    { id: 'leave', label: 'Leave', outcome: { kind: 'nothing' } },
  ],
});

const eventDocument = (id: string, versions: readonly { version: number; def: Record<string, unknown> }[]) => ({ id, versions });

describe('data: events.v1 legacy content remains exact in the active v2 catalog', () => {
  it('loads fixtures in code-unit id order, with selected-version metadata isolated and frozen', () => {
    const loaded = requireLegacyEventContent(loadEventContent({
      schemaVersion: 1,
      events: [
        eventDocument('ab', [{ version: 1, def: definition('ab') }]),
        eventDocument('a_', [{ version: 1, def: definition('a_') }]),
        eventDocument('wandering_tutor', [
          { version: 2, def: definition('Current tutor', ['current authoring note']) },
          { version: 1, def: definition('Old tutor', ['old authoring note']) },
        ]),
        eventDocument('constructor', [{ version: 1, def: definition('Reserved id') }]),
        eventDocument('a0_b', [{ version: 1, def: definition('a0_b') }]),
        eventDocument('a00', [{ version: 1, def: definition('a00') }]),
        eventDocument('a1', [{ version: 1, def: definition('a1') }]),
        eventDocument('a__', [{ version: 1, def: definition('a__') }]),
        eventDocument('a_b', [{ version: 1, def: definition('a_b') }]),
        eventDocument('a0', [{ version: 1, def: definition('a0') }]),
        eventDocument('aa', [{ version: 1, def: definition('aa') }]),
      ],
    }));

    expect(Object.keys(loaded.catalog)).toEqual([
      'a0', 'a00', 'a0_b', 'a1', 'a_', 'a__', 'a_b', 'aa', 'ab', 'constructor', 'wandering_tutor',
    ]);
    expect(loaded.catalog.wandering_tutor).toMatchObject({ title: 'Current tutor' });
    expect(loaded.catalog.wandering_tutor).not.toHaveProperty('version');
    expect(loaded.catalog.wandering_tutor).not.toHaveProperty('notes');
    expect(loaded.meta.wandering_tutor).toEqual({
      version: 2,
      versions: [1, 2],
      notes: ['current authoring note'],
    });
    expect(Object.isFrozen(loaded.catalog)).toBe(true);
    expect(Object.isFrozen(loaded.catalog.wandering_tutor)).toBe(true);
    expect(Object.isFrozen(loaded.catalog.wandering_tutor!.choices)).toBe(true);
    expect(Object.isFrozen(loaded.catalog.wandering_tutor!.choices[0]!)).toBe(true);
    expect(Object.isFrozen(loaded.catalog.wandering_tutor!.choices[0]!.outcome)).toBe(true);
    expect(Object.isFrozen(loaded.meta)).toBe(true);
    expect(Object.isFrozen(loaded.meta.wandering_tutor)).toBe(true);
    expect(Object.isFrozen(loaded.meta.wandering_tutor!.versions)).toBe(true);
    expect(Object.isFrozen(loaded.meta.wandering_tutor!.notes)).toBe(true);
  });

  it('rejects a duplicate event document before projecting a catalog', () => {
    expect(() => loadEventContent({
      schemaVersion: 1,
      events: [
        eventDocument('same_event', [{ version: 1, def: definition('First') }]),
        eventDocument('same_event', [{ version: 1, def: definition('Second') }]),
      ],
    })).toThrow(/duplicate document for id same_event/);
  });

  it('loads a frozen, canonically ordered runtime projection with authoring metadata in a sidecar', () => {
    expect(Object.isFrozen(eventCatalogFromJson)).toBe(true);
    expect(Object.isFrozen(eventContentMeta)).toBe(true);
    expect(Object.keys(eventCatalogFromJson)).toEqual([...Object.keys(eventCatalogFromJson)].sort());
    expect(Object.values(eventCatalogFromJson).every((event) => !('version' in event) && !('notes' in event))).toBe(true);
    expect(eventContentMeta.wandering_tutor).toMatchObject({ version: 1, versions: [1] });
    expect(eventCatalog).toBe(eventCatalogFromJson);
  });

  it('deep-freezes production event definitions so nested catalog mutation fails', () => {
    const event = eventCatalogFromJson.abandoned_cache!;
    const choice = event.choices.find((entry) => entry.id === 'open')!;
    const outcome = choice.outcome;

    expect(Object.isFrozen(event)).toBe(true);
    expect(Object.isFrozen(event.choices)).toBe(true);
    expect(Object.isFrozen(choice)).toBe(true);
    expect(Object.isFrozen(outcome)).toBe(true);
    expect(() => { (outcome as { amount: number }).amount = 999; }).toThrow(TypeError);
    expect(eventCatalogFromJson.abandoned_cache!.choices.find((entry) => entry.id === 'open')!.outcome).toMatchObject({
      kind: 'grantGold', amount: 1,
    });
  });

  it('deep-freezes a projection without freezing or aliasing its caller-owned document', () => {
    const sourceDefinition = definition('Caller-owned');
    const loaded = requireLegacyEventContent(loadEventContent({
      schemaVersion: 1,
      events: [eventDocument('caller_owned', [{ version: 1, def: sourceDefinition }])],
    }));
    const sourceChoices = sourceDefinition.choices as Array<{ outcome: { amount?: number } }>;

    sourceDefinition.title = 'Mutated caller input';
    sourceChoices[0]!.outcome.amount = 999;

    expect(Object.isFrozen(sourceDefinition)).toBe(false);
    expect(Object.isFrozen(sourceChoices)).toBe(false);
    expect(loaded.catalog.caller_owned).toMatchObject({ title: 'Caller-owned' });
    expect(loaded.catalog.caller_owned!.choices[0]!.outcome).toMatchObject({ kind: 'grantGold', amount: 1 });
  });

  it('parses and validates the active schema-2 envelope', () => {
    expect(validateEventDocument(activeDocument)).toEqual([]);
  });

  it('keeps the checked-in active schema-2 compatibility aggregate byte-for-byte frozen during compiler staging', () => {
    expect(createHash('sha256').update(activeDocumentBytes).digest('hex')).toBe(FROZEN_ACTIVE_V2_SHA256);
  });

  it('appends only the two materialized ids after the unchanged legacy document order', () => {
    expect(eventCatalogIds).toEqual(EXPECTED_ACTIVE_EVENT_IDS);
    expect(Object.keys(eventCatalogFromJson)).toEqual(EXPECTED_ACTIVE_EVENT_IDS);
    expect(document.events.map((event) => event.id)).toEqual(EXPECTED_EVENT_IDS);
    expect(activeDocument.events.slice(0, document.events.length).map((event) => event.id)).toEqual(EXPECTED_EVENT_IDS);
    expect(activeDocument.events.slice(document.events.length).map((event) => event.id)).toEqual(MATERIALIZED_EVENT_IDS);
  });

  it('keeps every legacy version envelope and definition byte-for-byte equivalent in v2', () => {
    expect(activeDocument.events.slice(0, document.events.length)).toStrictEqual(document.events);
  });

  it('adds only the three Bell ids to the frozen pre-cutover 39-event subset', () => {
    expect(document.events).toHaveLength(42);
    expect(document.events.map((event) => event.id).filter(
      (id) => !(FROZEN_PRE_BELL_EVENT_IDS as readonly string[]).includes(id),
    )).toEqual(BELL_EVENT_IDS);
    expect(FROZEN_PRE_BELL_EVENT_IDS.every((id) => eventCatalog[id] !== undefined)).toBe(true);
  });

  it('retains meaningful pre-cutover authoring rationale only in metadata', () => {
    expect(document.notes?.join(' ')).toMatch(/seeded selection/i);
    const noteBearing = Object.values(eventContentMeta).filter((meta) => (meta.notes?.length ?? 0) > 0);
    expect(noteBearing.length).toBeGreaterThanOrEqual(12);
    expect(eventContentMeta.crossroads_shrine?.notes?.join(' ')).toMatch(/93% holy.*83% dark/i);
    expect(eventContentMeta.ruined_anvil?.notes?.join(' ')).toMatch(/seeded event sequence/i);
    expect(eventContentMeta.sweep_drill?.notes?.join(' ')).toMatch(/7%/);
    expect(eventContentMeta.tutors_return?.notes?.join(' ')).toMatch(/once per run/i);
    expect(Object.values(eventCatalog).every((event) => !('notes' in event))).toBe(true);
  });

  it('matches the pre-cutover normalized definition digest, including choice order', () => {
    const definitions = FROZEN_PRE_BELL_EVENT_IDS.map((id) => normalizedDefinition(eventCatalog[id]));
    const digest = createHash('sha256').update(JSON.stringify(definitions)).digest('hex');
    expect(digest).toBe(EXPECTED_DEFINITION_SHA256);
  });

  it('reconstructs every definition with strict field and choice-order parity', () => {
    for (const event of document.events) {
      expect(event.versions).toHaveLength(1);
      const version = event.versions[0]!;
      expect(version.version).toBe(1);
      expect(eventDefOfDocument(event.id, version.def), event.id).toStrictEqual(eventCatalog[event.id]);
    }
  });
});
