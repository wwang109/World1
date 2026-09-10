import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import activeEvents from '../../src/data/content/events.v2.json';
import generatedEventsV3 from '../../src/data/content/events.v3.json';
import { eventCatalog, eventCatalogIds, type EventDef } from '../../src/data/events';
import {
  eventSelectionIdsForCatalog,
  rollEventForNode,
  type EventSelectionContent,
} from '../../src/run/events';
import { createRun, type RunNode } from '../../src/run/runState';

type EventEnvelope = {
  id: string;
  versions: {
    version: number;
    schemaVersion?: 1 | 2 | 3;
    def: Record<string, unknown>;
  }[];
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

const frozenLookup = (eventId: string, contentVersion: number): EventDef | undefined => (
  contentVersion === 1 ? eventCatalog[eventId] : undefined
);
const frozenContent: EventSelectionContent<EventDef> = {
  catalog: eventCatalog,
  orderedIds: eventSelectionIdsForCatalog(eventCatalogIds),
  currentVersionOf: () => 1,
};
const rollFrozen = (state: ReturnType<typeof createRun>, node: RunNode) => (
  rollEventForNode(state, node, frozenLookup, frozenContent)
);

function pack(events: readonly EventEnvelope[]) {
  return { schemaVersion: 2, storyStateSchema: {}, events };
}

function v1Pack(events: readonly EventEnvelope[]) {
  return { schemaVersion: 1, events };
}

function v3Pack(events: readonly EventEnvelope[], storyStateSchema: unknown = STORY_STATE_V3) {
  return { schemaVersion: 3, storyStateSchema, events };
}

function event(id: string): EventEnvelope {
  return {
    id,
    versions: [{ version: 1, def: {
      title: id,
      body: 'A deterministic pack fixture.',
      theme: 'cache',
      choices: [
        { id: 'take', label: 'Take', outcome: { kind: 'grantGold', amount: 1 } },
        { id: 'leave', label: 'Leave', outcome: { kind: 'nothing' } },
      ],
    } }],
  };
}

function v2Event(id: string): EventEnvelope {
  return {
    id,
    versions: [{ version: 1, def: {
      title: id,
      body: 'A schema-two compiler fixture.',
      theme: 'cache',
      rarity: 'common',
      story: { storyId: id, stage: 'setup', role: 'setup' },
      eligibility: { fact: 'biome.current', args: { ids: ['arrowfell'] } },
      delivery: { kind: 'ambient' },
      visibility: 'visible',
      priority: 100,
      once: 'node',
      cooldownNodes: 0,
      choices: [
        { id: 'take', label: 'Take', cost: 0, outcome: { kind: 'grantGold', amount: 1 } },
        { id: 'leave', label: 'Leave', cost: 0, outcome: { kind: 'nothing' } },
      ],
    } }],
  };
}

function v3Event(id: string): EventEnvelope {
  return {
    id,
    versions: [{ version: 1, def: {
      title: id,
      body: 'A schema-three compiler fixture.',
      theme: 'omen',
      rarity: 'rare',
      story: { storyId: id, stage: 'setup', role: 'setup' },
      eligibility: { fact: 'node.depth', args: { op: 'gte', value: 1 } },
      delivery: { kind: 'ambient' },
      visibility: 'hidden_until_eligible',
      priority: 300,
      once: 'run',
      cooldownNodes: 0,
      choiceSet: { fixed: [
        { id: 'take', label: 'Take', cost: 0, outcome: { kind: 'grantGold', amount: 1 } },
        { id: 'leave', label: 'Leave', cost: 0, outcome: { kind: 'nothing' } },
      ] },
    } }],
  };
}

function temporaryPackDirectory(): string {
  const root = mkdtempSync(join(tmpdir(), 'world1-event-packs-'));
  const packs = join(root, 'event-packs');
  mkdirSync(packs);
  return packs;
}

function writePack(directory: string, filename: string, events: readonly EventEnvelope[]): void {
  writeFileSync(join(directory, filename), `${JSON.stringify(pack(events), null, 2)}\n`, 'utf8');
}

function writeDocument(directory: string, filename: string, document: unknown): void {
  writeFileSync(join(directory, filename), `${JSON.stringify(document, null, 2)}\n`, 'utf8');
}

function eventNode(id: string, eventSeed: number): RunNode {
  return { id, depth: 1, wave: 1, kind: 'event', eventSeed, eventTheme: 'cache' };
}

describe('scripts/eventPackCompiler: deterministic event-pack aggregate', () => {
  it('compiles schema 1, 2, and 3 packs into a schema-3 aggregate without reinterpreting source wrappers', async () => {
    const { compileEventPacks } = await import('../../scripts/eventPackCompiler');
    const packs = temporaryPackDirectory();
    const legacy = event('legacy_one');
    const schemaTwo = v2Event('schema_two');
    const schemaThree = v3Event('schema_three');
    writeDocument(packs, '30-v3.json', v3Pack([schemaThree]));
    writeDocument(packs, '10-v1.json', v1Pack([legacy]));
    writeDocument(packs, '20-v2.json', pack([schemaTwo]));

    const compiled = compileEventPacks(packs);

    expect(compiled.sourceFiles.map((source) => source.name)).toEqual([
      '10-v1.json', '20-v2.json', '30-v3.json',
    ]);
    expect(compiled.document.schemaVersion).toBe(3);
    expect(compiled.document.storyStateSchema).toStrictEqual(STORY_STATE_V3);
    expect(compiled.document.events.map((entry) => entry.id)).toEqual([
      'legacy_one', 'schema_two', 'schema_three',
    ]);
    expect(compiled.document.events[0]!.versions[0]).toStrictEqual({
      version: 1,
      schemaVersion: 1,
      def: legacy.versions[0]!.def,
    });
    expect(compiled.document.events[1]!.versions[0]).toStrictEqual({
      version: 1,
      schemaVersion: 2,
      def: schemaTwo.versions[0]!.def,
    });
    expect(compiled.document.events[2]!.versions[0]).toStrictEqual(schemaThree.versions[0]);
  });

  it('can wrap the untouched real schema-2 packs beside a schema-3 pack', async () => {
    const { compileEventPacks } = await import('../../scripts/eventPackCompiler');
    const packs = temporaryPackDirectory();
    writeFileSync(
      join(packs, '00-core.json'),
      readFileSync(new URL('../../src/data/content/event-packs/00-core.json', import.meta.url), 'utf8'),
      'utf8',
    );
    writeFileSync(
      join(packs, '10-arrowfell.json'),
      readFileSync(new URL('../../src/data/content/event-packs/10-arrowfell.json', import.meta.url), 'utf8'),
      'utf8',
    );
    writeDocument(packs, '20-v3.json', v3Pack([v3Event('schema_three')]));

    const compiled = compileEventPacks(packs);

    expect(compiled.document.schemaVersion).toBe(3);
    expect(compiled.document.events).toHaveLength(45);
    expect(compiled.document.events[0]!.versions[0]).toMatchObject({ schemaVersion: 1 });
    expect(compiled.document.events[42]!.versions[0]).toMatchObject({ schemaVersion: 2 });
    expect(compiled.document.events[44]!.versions[0]).not.toHaveProperty('schemaVersion');
    expect(compiled.document.events.slice(0, 44).map((entry) => entry.id)).toEqual(
      activeEvents.events.map((entry) => entry.id),
    );
  });

  it('keeps authored version order and explicit wrapper tags while adding only required compatibility tags', async () => {
    const { compileEventPacks } = await import('../../scripts/eventPackCompiler');
    const packs = temporaryPackDirectory();
    const historical = v2Event('versioned_probe');
    const firstDef = structuredClone(historical.versions[0]!.def);
    const secondDef = structuredClone(historical.versions[0]!.def);
    firstDef.title = 'Authored second';
    secondDef.title = 'Authored first';
    historical.versions = [
      { version: 2, schemaVersion: 2, def: firstDef },
      { version: 1, def: secondDef },
    ];
    writeDocument(packs, '10-v2.json', pack([historical]));
    writeDocument(packs, '20-v3.json', v3Pack([v3Event('schema_three')]));

    const compiled = compileEventPacks(packs);
    const wrappers = compiled.document.events[0]!.versions;

    expect(wrappers.map((wrapper) => wrapper.version)).toEqual([2, 1]);
    expect(wrappers[0]).toStrictEqual({ version: 2, schemaVersion: 2, def: firstDef });
    expect(wrappers[1]).toStrictEqual({ version: 1, schemaVersion: 2, def: secondDef });
  });

  it('uses the exact shared story-state registry for every schema-3 source pack', async () => {
    const { compileEventPacks } = await import('../../scripts/eventPackCompiler');
    const packs = temporaryPackDirectory();
    writeDocument(packs, '10-v3.json', v3Pack([v3Event('first_v3')]));
    writeDocument(packs, '20-v3.json', v3Pack([v3Event('second_v3')]));

    expect(compileEventPacks(packs).document.storyStateSchema).toStrictEqual(STORY_STATE_V3);

    const conflicting = structuredClone(STORY_STATE_V3) as Record<string, unknown>;
    conflicting.oath_mercy = { kind: 'boolean', default: true };
    writeDocument(packs, '20-v3.json', v3Pack([v3Event('second_v3')], conflicting));

    expect(() => compileEventPacks(packs)).toThrow(/conflicting storyStateSchema.*10-v3\.json.*20-v3\.json/i);
  });

  it('rejects duplicate versions before aggregate generation', async () => {
    const { compileEventPacks } = await import('../../scripts/eventPackCompiler');
    const packs = temporaryPackDirectory();
    const duplicate = v3Event('duplicate_version');
    duplicate.versions = [duplicate.versions[0]!, structuredClone(duplicate.versions[0]!)];
    writeDocument(packs, '10-v3.json', v3Pack([duplicate]));

    expect(() => compileEventPacks(packs)).toThrow(/duplicate_version@v1\.version: duplicate version 1/i);
  });

  it('keeps an explicitly tagged schema-2 legacy shape strict', async () => {
    const { compileEventPacks } = await import('../../scripts/eventPackCompiler');
    const packs = temporaryPackDirectory();
    const explicit = event('explicit_schema_two');
    explicit.versions[0]!.schemaVersion = 2;
    writeDocument(packs, '10-v2.json', pack([explicit]));

    expect(() => compileEventPacks(packs)).toThrow(/explicit_schema_two@v1\.delivery: delivery must be ambient or queued_callback/i);
  });

  it('rejects a callback whose exact target version is absent after all packs merge', async () => {
    const { compileEventPacks } = await import('../../scripts/eventPackCompiler');
    const packs = temporaryPackDirectory();
    const source = v3Event('callback_source');
    const sourceDef = source.versions[0]!.def;
    const fixed = (sourceDef.choiceSet as { fixed: Array<Record<string, unknown>> }).fixed;
    fixed[0]!.callback = {
      callbackId: 'callback_target', eventId: 'callback_target', contentVersion: 2,
      minDepthDelay: 1, destinationThemes: ['omen'], priority: 700, bind: [],
      expiry: { expiresAfterNodes: 10, fallback: 'discard' },
    };
    writeDocument(packs, '10-source.json', v3Pack([source]));
    writeDocument(packs, '20-target.json', v3Pack([v3Event('callback_target')]));

    expect(() => compileEventPacks(packs)).toThrow(/unknown callback content version 2 for event callback_target/i);
  });

  it('merges source packs in code-unit filename order, independent of creation order', async () => {
    const { compileEventPacks } = await import('../../scripts/eventPackCompiler');
    const packs = temporaryPackDirectory();
    writePack(packs, 'z-last.json', [event('z_last')]);
    writePack(packs, 'a-first.json', [event('a_first')]);

    const compiled = compileEventPacks(packs);

    expect(compiled.sourceFiles.map((file) => file.name)).toEqual(['a-first.json', 'z-last.json']);
    expect(compiled.document.events.map((entry) => entry.id)).toEqual(['a_first', 'z_last']);
  });

  it('rejects a duplicate event id across packs with both actionable source names', async () => {
    const { compileEventPacks } = await import('../../scripts/eventPackCompiler');
    const packs = temporaryPackDirectory();
    writePack(packs, 'a-core.json', [event('duplicate_event')]);
    writePack(packs, 'b-arrowfell.json', [event('duplicate_event')]);

    expect(() => compileEventPacks(packs)).toThrow(/duplicate_event.*a-core\.json.*b-arrowfell\.json/i);
  });

  it('compiles the twelve real packs to the generated 66-event schema-v3 aggregate', async () => {
    const { compileEventPacks } = await import('../../scripts/eventPackCompiler');
    const compiled = compileEventPacks(new URL('../../src/data/content/event-packs/', import.meta.url));

    expect(compiled.sourceFiles.map((file) => file.name)).toEqual([
      '00-core.json', '10-arrowfell.json', '100-global-payoffs.json', '110-global-chains.json',
      '20-duskbarrow.json', '30-emberwaste.json',
      '40-frostmarch.json', '50-howlmoor.json', '60-ironmoot.json', '70-pikewold.json',
      '80-stormreach.json', '90-thornwild.json',
    ]);
    expect(compiled.document).toStrictEqual(generatedEventsV3);
    expect(compiled.document.events).toHaveLength(66);
  });

  it('allows the Feathered Cairn callback target to live in a later source pack', async () => {
    const { compileEventPacks } = await import('../../scripts/eventPackCompiler');
    const packs = temporaryPackDirectory();
    const cairn = activeEvents.events.find((entry) => entry.id === 'feathered_cairn')! as EventEnvelope;
    const farSight = activeEvents.events.find((entry) => entry.id === 'feathered_cairn_far_sight')! as EventEnvelope;
    writePack(packs, '10-cairn.json', [cairn]);
    writePack(packs, '20-far-sight.json', [farSight]);

    const compiled = compileEventPacks(packs);

    expect(compiled.document.events.map((entry) => entry.id)).toEqual([
      'feathered_cairn',
      'feathered_cairn_far_sight',
    ]);
  });

  it('still rejects a missing callback target after merging every pack', async () => {
    const { compileEventPacks } = await import('../../scripts/eventPackCompiler');
    const packs = temporaryPackDirectory();
    const cairn = activeEvents.events.find((entry) => entry.id === 'feathered_cairn')! as EventEnvelope;
    writePack(packs, '10-cairn.json', [cairn]);

    expect(() => compileEventPacks(packs)).toThrow(/unknown callback event feathered_cairn_far_sight/i);
  });

  it('keeps per-pack unknown-field validation strict before merge', async () => {
    const { compileEventPacks } = await import('../../scripts/eventPackCompiler');
    const packs = temporaryPackDirectory();
    const cairn = structuredClone(activeEvents.events.find((entry) => entry.id === 'feathered_cairn')!) as EventEnvelope;
    cairn.versions[0]!.def.unexpected = true;
    writePack(packs, '10-cairn.json', [cairn]);

    expect(() => compileEventPacks(packs)).toThrow(/unexpected: unknown field unexpected/i);
  });

  it('reports a stale generated aggregate without accepting it as runtime source', async () => {
    const { assertGeneratedEventAggregateCurrent } = await import('../../scripts/eventPackCompiler');
    const packs = temporaryPackDirectory();
    const generated = join(packs, '..', 'events.v2.json');
    writePack(packs, 'a-core.json', [event('fresh_event')]);
    writeFileSync(generated, `${JSON.stringify(pack([event('stale_event')]), null, 2)}\n`, 'utf8');

    expect(() => assertGeneratedEventAggregateCurrent(packs, generated)).toThrow(/events\.v2\.json.*stale.*content:events/i);
  });

  it('writes the highest active schema to its versioned aggregate path without overwriting v2', async () => {
    const { writeVersionedEventPackAggregate } = await import('../../scripts/eventPackCompiler');
    const packs = temporaryPackDirectory();
    const contentDirectory = join(packs, '..', 'content');
    mkdirSync(contentDirectory);
    writeDocument(packs, '10-v2.json', pack([v2Event('schema_two')]));
    writeDocument(packs, '20-v3.json', v3Pack([v3Event('schema_three')]));

    const compiled = writeVersionedEventPackAggregate(packs, contentDirectory);

    expect(compiled.document.schemaVersion).toBe(3);
    expect(existsSync(join(contentDirectory, 'events.v3.json'))).toBe(true);
    expect(existsSync(join(contentDirectory, 'events.v2.json'))).toBe(false);
    expect(JSON.parse(readFileSync(join(contentDirectory, 'events.v3.json'), 'utf8'))).toStrictEqual(compiled.document);
  });

  it('keeps same-seed JSON choices reproducible while bounded different seeds draw more than one eligible event', () => {
    const first = rollFrozen(createRun(701), eventNode('same-seed', 17));
    const second = rollFrozen(createRun(701), eventNode('same-seed', 17));
    expect(second.event.id).toBe(first.event.id);
    expect(second.event.choices).toStrictEqual(first.event.choices);
    const authored = activeEvents.events.find((entry) => entry.id === first.event.id)!;
    const current = authored.versions.reduce((latest, version) => version.version > latest.version ? version : latest);
    expect(first.event.choices).toStrictEqual(current.def.choices);

    const drawn = new Set<string>();
    for (let seed = 0; seed < 32; seed += 1) {
      drawn.add(rollFrozen(createRun(seed), eventNode(`seed-${String(seed)}`, seed)).event.id);
    }
    expect(drawn.size).toBeGreaterThan(1);
    expect([...drawn].every((id) => eventCatalog[id] !== undefined)).toBe(true);
  });
});
