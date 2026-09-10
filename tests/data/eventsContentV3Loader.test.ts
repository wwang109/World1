import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import activeDocument from '../../src/data/content/events.v2.json';
import { eventCatalog, eventCatalogIds } from '../../src/data/events';
import { legacyCurrentEventCatalog, loadEventContent } from '../../src/data/eventsContent';

const storyStateSchema = {
  oath_mercy: { kind: 'boolean', default: false },
  grave_path: { kind: 'enum', values: ['none', 'opened', 'answered'], default: 'none' },
  honorable_choice: { kind: 'boolean', default: false },
  reliquary_oath: { kind: 'boolean', default: false },
  oath_gate: { kind: 'enum', values: ['none', 'sworn', 'kept', 'released'], default: 'none' },
  venom_bloom: { kind: 'enum', values: ['none', 'cultivated'], default: 'none' },
  rival_spared: { kind: 'boolean', default: false },
  moon_quarry_released: { kind: 'boolean', default: false },
} as const;

function v3Def() {
  return {
    title: 'Probe', body: 'Only a loader fixture.', theme: 'omen', rarity: 'rare',
    story: { storyId: 'v3_probe', stage: 'setup', role: 'setup' },
    eligibility: { fact: 'node.depth', args: { op: 'gte', value: 1 } },
    delivery: { kind: 'ambient' }, visibility: 'hidden_until_eligible',
    priority: 300, once: 'run', cooldownNodes: 0,
    choiceSet: { fixed: [
      { id: 'take', label: 'Take', cost: 0, outcome: { kind: 'grantGold', amount: 1 } },
      { id: 'leave', label: 'Leave', cost: 0, outcome: { kind: 'nothing' } },
    ] },
  };
}

function v2Def() {
  return {
    title: 'Legacy probe', body: 'Inherited from the envelope.', theme: 'cache', rarity: 'common',
    story: { storyId: 'v2_probe', stage: 'setup', role: 'setup' },
    eligibility: { fact: 'biome.current', args: { ids: ['arrowfell'] } },
    delivery: { kind: 'ambient' }, visibility: 'visible', priority: 100,
    once: 'node', cooldownNodes: 0,
    choices: [
      { id: 'take', label: 'Take', cost: 0, outcome: { kind: 'grantGold', amount: 1 } },
      { id: 'leave', label: 'Leave', cost: 0, outcome: { kind: 'nothing' } },
    ],
  };
}

describe('event content v3 loader seam', () => {
  it('loads a compiler-produced mixed aggregate with exact historical schema identity', async () => {
    const { compileEventPacks } = await import('../../scripts/eventPackCompiler');
    const root = mkdtempSync(join(tmpdir(), 'world1-v3-loader-'));
    const packs = join(root, 'event-packs');
    mkdirSync(packs);
    writeFileSync(join(packs, '10-v2.json'), `${JSON.stringify({
      schemaVersion: 2,
      storyStateSchema: {},
      events: [{ id: 'v2_probe', versions: [{ version: 1, def: v2Def() }] }],
    }, null, 2)}\n`, 'utf8');
    writeFileSync(join(packs, '20-v3.json'), `${JSON.stringify({
      schemaVersion: 3,
      storyStateSchema,
      events: [{ id: 'v3_probe', versions: [{ version: 1, def: v3Def() }] }],
    }, null, 2)}\n`, 'utf8');

    const compiled = compileEventPacks(packs);
    const loaded = loadEventContent(compiled.document);

    expect(compiled.document.events[0]!.versions[0]).toMatchObject({ schemaVersion: 2 });
    expect(loaded.eventDefAtVersion('v2_probe', 1)).not.toHaveProperty('contentSchemaVersion');
    expect(loaded.eventDefAtVersion('v3_probe', 1)).toMatchObject({ contentSchemaVersion: 3 });
  });

  it('projects an explicit v3 wrapper tag and inherits an untagged v2 envelope', () => {
    const v3Raw = {
      schemaVersion: 3,
      storyStateSchema,
      events: [{ id: 'v3_probe', versions: [{ version: 1, schemaVersion: 3, def: v3Def() }] }],
    };
    const loadedV3 = loadEventContent(v3Raw);
    expect(loadedV3.meta.v3_probe!.version).toBe(1);
    expect(loadedV3.eventDefAtVersion('v3_probe', 1)).toEqual(expect.objectContaining({
      id: 'v3_probe', contentSchemaVersion: 3,
    }));
    expect(v3Raw.events[0]!.versions[0]!.def).not.toHaveProperty('contentSchemaVersion');

    const loadedV2 = loadEventContent({
      schemaVersion: 2,
      storyStateSchema: {},
      events: [{ id: 'v2_probe', versions: [{ version: 1, def: v2Def() }] }],
    });
    expect(loadedV2.eventDefAtVersion('v2_probe', 1)).not.toHaveProperty('contentSchemaVersion');
  });

  it('keeps mixed schema identities for exact historical versions of one event id', () => {
    const loaded = loadEventContent({
      schemaVersion: 3,
      storyStateSchema,
      events: [{ id: 'evolving_probe', versions: [
        { version: 1, schemaVersion: 2, def: v2Def() },
        { version: 2, def: v3Def() },
      ] }],
    });

    expect(loaded.eventDefAtVersion('evolving_probe', 1)).toHaveProperty('choices');
    expect(loaded.eventDefAtVersion('evolving_probe', 1)).not.toHaveProperty('contentSchemaVersion');
    expect(loaded.eventDefAtVersion('evolving_probe', 2)).toMatchObject({
      id: 'evolving_probe', contentSchemaVersion: 3,
    });
    expect(loaded.catalog.evolving_probe).toBe(loaded.eventDefAtVersion('evolving_probe', 2));
  });

  it('keeps the active aggregate and catalog byte-for-byte schema-v2', () => {
    expect(activeDocument.schemaVersion).toBe(2);
    expect(eventCatalogIds).toEqual(Object.keys(eventCatalog));
    expect(Object.values(eventCatalog).every((event) => !('contentSchemaVersion' in event))).toBe(true);
  });

  it('keeps v3 definitions out of the temporary .choices facade without hiding them from exact lookup', () => {
    const loaded = loadEventContent({
      schemaVersion: 3,
      storyStateSchema,
      events: [
        { id: 'v2_probe', versions: [{ version: 1, schemaVersion: 2, def: v2Def() }] },
        { id: 'v3_probe', versions: [{ version: 1, def: v3Def() }] },
      ],
    });

    expect(Object.keys(legacyCurrentEventCatalog(loaded))).toEqual(['v2_probe']);
    expect(loaded.eventDefAtVersion('v3_probe', 1)).toMatchObject({ contentSchemaVersion: 3 });
  });
});
