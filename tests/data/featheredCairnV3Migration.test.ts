import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import frozenV2 from '../../src/data/content/events.v2.json';
import { isEventDefV3 } from '../../src/data/eventContentV3';
import { loadEventContent } from '../../src/data/eventsContent';
import { validateEventDocument } from '../../src/data/validateEventContent';

type EventVersion = {
  version: number;
  schemaVersion?: 1 | 2 | 3;
  def: Record<string, unknown>;
};

type EventDocument = {
  schemaVersion: number;
  storyStateSchema: Record<string, unknown>;
  events: Array<{ id: string; versions: EventVersion[] }>;
};

const STORY_STATE_V3 = {
  oath_mercy: { kind: 'boolean', default: false },
  grave_path: { kind: 'enum', values: ['none', 'opened', 'answered'], default: 'none' },
  honorable_choice: { kind: 'boolean', default: false },
  reliquary_oath: { kind: 'boolean', default: false },
  oath_gate: { kind: 'enum', values: ['none', 'sworn', 'kept', 'released'], default: 'none' },
  venom_bloom: { kind: 'enum', values: ['none', 'cultivated'], default: 'none' },
  rival_spared: { kind: 'boolean', default: false },
  moon_quarry_released: { kind: 'boolean', default: false },
} as const;

const sourcePath = new URL('../../src/data/content/event-packs/10-arrowfell.json', import.meta.url);
const source = JSON.parse(readFileSync(sourcePath, 'utf8')) as EventDocument;
const aggregatePath = new URL('../../src/data/content/events.v3.json', import.meta.url);
const FROZEN_V2_SHA256 = '5d6e14f0edead7f18606116af5d5800edb1590bbf5b2b3a6db3905fb9e9cbd7a';
const HISTORICAL_DEF_SHA256: Readonly<Record<string, string>> = {
  feathered_cairn: '959bbeaf01c49afa7c73758d22b695707105646bb4219e2c1059c6a8d097f748',
  feathered_cairn_far_sight: '22863bf9586ceb71f5d0c7287c44463c2ca8c6d7f6b8d0ce6ebbe817402a7c44',
};

function eventOf(document: EventDocument, id: string) {
  const event = document.events.find((candidate) => candidate.id === id);
  if (event === undefined) throw new Error(`missing ${id}`);
  return event;
}

describe('Arrowfell schema-v3 migration', () => {
  it('retains both shipped version-1 definitions exactly under explicit schema-2 wrappers', () => {
    expect(source.schemaVersion).toBe(3);

    for (const id of ['feathered_cairn', 'feathered_cairn_far_sight']) {
      const historical = eventOf(source, id).versions.find((version) => version.version === 1);
      const frozen = eventOf(frozenV2 as EventDocument, id).versions.find((version) => version.version === 1);

      expect(historical, `${id}@1 source wrapper`).toBeDefined();
      expect(frozen, `${id}@1 frozen wrapper`).toBeDefined();
      expect(historical?.schemaVersion, `${id}@1 schema identity`).toBe(2);
      expect(historical?.def, `${id}@1 historical definition`).toStrictEqual(frozen?.def);
      expect(createHash('sha256').update(JSON.stringify(historical?.def)).digest('hex')).toBe(
        HISTORICAL_DEF_SHA256[id],
      );
    }
  });

  it('adds exact schema-v3 version-2 definitions without changing approved choice semantics', () => {
    expect(source.storyStateSchema).toStrictEqual(STORY_STATE_V3);

    const cairn = eventOf(source, 'feathered_cairn');
    const farSight = eventOf(source, 'feathered_cairn_far_sight');
    expect(cairn.versions.map((version) => version.version)).toEqual([1, 2]);
    expect(farSight.versions.map((version) => version.version)).toEqual([1, 2]);

    const cairnV1 = structuredClone(cairn.versions[0]!.def) as Record<string, any>;
    const expectedCairnV2 = structuredClone(cairnV1) as Record<string, any>;
    const cairnChoices = expectedCairnV2.choices as Array<Record<string, any>>;
    delete expectedCairnV2.choices;
    cairnChoices[0]!.callback.contentVersion = 2;
    delete cairnChoices[1]!.outcome.tier;
    cairnChoices[1]!.outcome.maxTier = 'bronze';
    expectedCairnV2.choiceSet = { fixed: cairnChoices };

    const farSightV1 = structuredClone(farSight.versions[0]!.def) as Record<string, any>;
    const expectedFarSightV2 = structuredClone(farSightV1) as Record<string, any>;
    const farSightChoices = expectedFarSightV2.choices as Array<Record<string, any>>;
    delete expectedFarSightV2.choices;
    expectedFarSightV2.choiceSet = { fixed: farSightChoices };

    expect(cairn.versions[1]).toStrictEqual({ version: 2, def: expectedCairnV2 });
    expect(farSight.versions[1]).toStrictEqual({ version: 2, def: expectedFarSightV2 });
  });

  it('keeps the Arrowfell prefix exact in the valid 66-id mixed aggregate while leaving v2 frozen', async () => {
    expect(existsSync(aggregatePath), 'events.v3.json must be generated from source packs').toBe(true);
    if (!existsSync(aggregatePath)) return;

    const bytes = readFileSync(aggregatePath, 'utf8');
    const aggregate = JSON.parse(bytes) as EventDocument;
    const v2Bytes = readFileSync(new URL('../../src/data/content/events.v2.json', import.meta.url), 'utf8');
    const { compileEventPacks, serializeEventPackAggregate } = await import('../../scripts/eventPackCompiler');
    const compiled = compileEventPacks(new URL('../../src/data/content/event-packs/', import.meta.url));

    expect(bytes).toBe(serializeEventPackAggregate(compiled));
    expect(createHash('sha256').update(v2Bytes).digest('hex')).toBe(FROZEN_V2_SHA256);
    expect(aggregate.schemaVersion).toBe(3);
    expect(aggregate.storyStateSchema).toStrictEqual(STORY_STATE_V3);
    expect(aggregate.events).toHaveLength(66);
    expect(new Set(aggregate.events.map((event) => event.id)).size).toBe(66);
    expect(aggregate.events.slice(0, 42).every((event) => (
      event.versions.every((version) => version.schemaVersion === 1)
    ))).toBe(true);
    expect(validateEventDocument(aggregate)).toEqual([]);

    const loaded = loadEventContent(aggregate);
    for (const id of ['feathered_cairn', 'feathered_cairn_far_sight']) {
      const authored = eventOf(aggregate, id);
      expect(authored.versions.map((version) => ({
        version: version.version,
        schemaVersion: version.schemaVersion,
      }))).toStrictEqual([
        { version: 1, schemaVersion: 2 },
        { version: 2, schemaVersion: undefined },
      ]);
      expect(isEventDefV3(loaded.eventDefAtVersion(id, 1)!)).toBe(false);
      expect(isEventDefV3(loaded.eventDefAtVersion(id, 2)!)).toBe(true);
      expect(loaded.catalog[id]).toBe(loaded.eventDefAtVersion(id, 2));
      expect(loaded.meta[id]).toStrictEqual({ version: 2, versions: [1, 2] });
    }
  });
});
