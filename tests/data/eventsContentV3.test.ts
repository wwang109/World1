import { describe, expect, expectTypeOf, it } from 'vitest';
import type { Element, WeaponType } from '../../src/engine/types';
import {
  isEventDefV3,
  type AllV3EventContentDocument,
  type EventContentDocument,
  type EventBoundSubjectsV3,
  type EventContentDocumentV3,
  type EventDefV3,
  type EventDefinitionPayloadV1,
  type EventDefinitionPayloadV2,
  type EventDefinitionPayloadV3,
  type EventRequirementV3,
  type LoadedEventDefV3,
  type ResolvedEventVersionWrapper,
  type StoryStateSchemaV3,
  type EventWeightedBranchV3,
} from '../../src/data/eventContentV3';
import type { EventRarity } from '../../src/data/eventTypes';
import type { LoadedEventContent, LoadedEventDef } from '../../src/data/eventsContent';
import { eventSchemaVersionOfWrapper, validateEventDocument } from '../../src/data/validateEventContent';

type JsonRecord = Record<string, any>;
type AssertTrue<T extends true> = T;
type AmbientEventDefV3 = Extract<EventDefV3, { delivery: { kind: 'ambient' } }>;
type QueuedEventDefV3 = Extract<EventDefV3, { delivery: { kind: 'queued_callback' } }>;
type _AmbientRejectsAcceptedBindings = AssertTrue<
  AmbientEventDefV3['acceptsBindings'] extends undefined ? true : false
>;
type _QueuedRejectsAmbientBindings = AssertTrue<
  QueuedEventDefV3['bindings'] extends undefined ? true : false
>;

function assertDeliveryModeBindingOwnership(
  ambient: AmbientEventDefV3,
  queued: QueuedEventDefV3,
): void {
  // @ts-expect-error ambient definitions cannot declare a queued target contract
  const invalidAmbient: EventDefV3 = { ...ambient, acceptsBindings: ['enemy_id'] };
  // @ts-expect-error queued definitions cannot declare ambient subject producers
  const invalidQueued: EventDefV3 = {
    ...queued,
    bindings: [{ as: 'enemy_id', source: 'revenge.enemyId' }],
  };
  void invalidAmbient;
  void invalidQueued;
}
void assertDeliveryModeBindingOwnership;

const clone = <T>(value: T): T => structuredClone(value);

function storyStateSchema(): JsonRecord {
  return {
    oath_mercy: { kind: 'boolean', default: false },
    grave_path: { kind: 'enum', values: ['none', 'opened', 'answered'], default: 'none' },
    honorable_choice: { kind: 'boolean', default: false },
    reliquary_oath: { kind: 'boolean', default: false },
    oath_gate: { kind: 'enum', values: ['none', 'sworn', 'kept', 'released'], default: 'none' },
    venom_bloom: { kind: 'enum', values: ['none', 'cultivated'], default: 'none' },
    rival_spared: { kind: 'boolean', default: false },
    moon_quarry_released: { kind: 'boolean', default: false },
  };
}

function definition(): JsonRecord {
  return {
    title: 'Probe',
    body: 'Typed only.',
    theme: 'omen',
    rarity: 'rare',
    story: { storyId: 'v3_probe', stage: 'setup', role: 'setup' },
    eligibility: {
      all: [
        { fact: 'run.tally', args: { stat: 'wins', op: 'gte', value: 3 } },
        {
          fact: 'owned.card.count',
          args: {
            where: 'any',
            count: 1,
            match: { weapons: ['bow'], elements: ['frost'] },
            tierAtLeast: 'silver',
          },
        },
      ],
    },
    delivery: { kind: 'ambient' },
    visibility: 'hidden_until_eligible',
    priority: 300,
    once: 'run',
    cooldownNodes: 0,
    choiceSet: {
      fixed: [{ id: 'leave', label: 'Leave', cost: 0, outcome: { kind: 'nothing' } }],
      pool: {
        draw: 1,
        entries: [
          {
            id: 'coin',
            label: 'Coin',
            cost: 0,
            outcome: {
              kind: 'weighted',
              branches: [
                { id: 'gold', label: 'Gold (67%)', weight: 2, outcome: { kind: 'grantGold', amount: 1 } },
                { id: 'nothing', label: 'Nothing (33%)', weight: 1, outcome: { kind: 'nothing' } },
              ],
            },
          },
        ],
      },
    },
  };
}

function v3Document(): JsonRecord {
  return {
    schemaVersion: 3,
    storyStateSchema: storyStateSchema(),
    events: [{ id: 'v3_probe', versions: [{ version: 1, def: definition() }] }],
  };
}

function defOf(document: JsonRecord, eventIndex = 0, versionIndex = 0): JsonRecord {
  return document.events[eventIndex].versions[versionIndex].def as JsonRecord;
}

function v1Definition(title = 'Legacy v1'): JsonRecord {
  return {
    title,
    body: 'A legacy definition.',
    theme: 'cache',
    choices: [
      { id: 'take', label: 'Take', outcome: { kind: 'grantGold', amount: 1 } },
      { id: 'leave', label: 'Leave', outcome: { kind: 'nothing' } },
    ],
  };
}

function v2Definition(title = 'Legacy v2'): JsonRecord {
  return {
    title,
    body: 'A schema-v2 definition.',
    theme: 'cache',
    rarity: 'common',
    story: { storyId: 'legacy_v2', stage: 'setup', role: 'setup' },
    eligibility: { fact: 'biome.current', args: { ids: ['arrowfell'] } },
    delivery: { kind: 'ambient' },
    visibility: 'visible',
    priority: 100,
    once: 'run',
    cooldownNodes: 0,
    choices: [
      { id: 'take', label: 'Take', cost: 0, outcome: { kind: 'grantGold', amount: 1 } },
      { id: 'leave', label: 'Leave', cost: 0, outcome: { kind: 'nothing' } },
    ],
  };
}

function documentWithEligibility(eligibility: JsonRecord): JsonRecord {
  const document = v3Document();
  const source = clone(document.events[0]);
  source.id = 'source_event';
  source.versions[0].def.title = 'Source';
  source.versions[0].def.story.storyId = 'source_event';
  document.events.unshift(source);
  defOf(document, 1).eligibility = eligibility;
  return document;
}

function callbackDocument(): JsonRecord {
  const document = v3Document();
  const source = defOf(document);
  source.biomeIds = ['arrowfell'];
  source.bindings = [
    { as: 'enemy_id', source: 'revenge.enemyId' },
    { as: 'mono_type', source: 'board.monoType' },
  ];
  source.choiceSet.fixed[0].callback = {
    callbackId: 'v3_probe_callback',
    eventId: 'v3_probe_callback',
    contentVersion: 1,
    minDepthDelay: 2,
    destinationThemes: ['omen'],
    destinationBiomeIds: ['arrowfell'],
    priority: 700,
    bind: [
      { as: 'enemy_id', source: 'revenge.enemyId' },
      { as: 'mono_type', source: 'board.monoType' },
    ],
    expiry: { expiresAfterNodes: 20, fallback: { outcome: { kind: 'grantGold', amount: 2 } } },
  };

  const target = clone(document.events[0]);
  target.id = 'v3_probe_callback';
  target.versions[0].schemaVersion = 3;
  const targetDef = target.versions[0].def;
  targetDef.title = 'Callback';
  targetDef.story = { storyId: 'v3_probe', stage: 'callback', role: 'callback' };
  targetDef.eligibility = { fact: 'callback.queued', args: { callbackId: 'v3_probe_callback' } };
  targetDef.delivery = { kind: 'queued_callback' };
  targetDef.biomeIds = ['arrowfell'];
  targetDef.acceptsBindings = ['enemy_id', 'mono_type'];
  delete targetDef.bindings;
  for (const choice of targetDef.choiceSet.fixed) delete choice.callback;
  for (const choice of targetDef.choiceSet.pool.entries) delete choice.callback;
  document.events.push(target);
  return document;
}

function v2CallbackInV3Document(targetSchemaVersion: 2 | 3): JsonRecord {
  const callbackId = 'mixed_schema_callback';
  const targetId = 'mixed_schema_target';
  const source = v2Definition('Mixed schema source');
  source.story.storyId = 'mixed_schema_source';
  source.choices[0].callback = {
    callbackId,
    eventId: targetId,
    contentVersion: 1,
    minDepthDelay: 1,
    destinationThemes: ['omen'],
    priority: 500,
    bind: [],
    expiry: { expiresAfterNodes: 10, fallback: 'discard' },
  };

  const target = targetSchemaVersion === 2
    ? v2Definition('Mixed schema target')
    : definition();
  target.story = { storyId: 'mixed_schema', stage: 'callback', role: 'callback' };
  target.delivery = { kind: 'queued_callback' };
  target.eligibility = { fact: 'callback.queued', args: { callbackId } };
  target.theme = 'omen';

  return {
    schemaVersion: 3,
    storyStateSchema: storyStateSchema(),
    events: [
      { id: 'mixed_schema_source', versions: [{ version: 1, schemaVersion: 2, def: source }] },
      { id: targetId, versions: [{ version: 1, schemaVersion: targetSchemaVersion, def: target }] },
    ],
  };
}

const paths = (document: unknown): string[] =>
  validateEventDocument(document).map((problem) => problem.where);

describe('schema v3 event contract', () => {
  it('accepts a closed v3 requirement tree and rejects a v2-only matcher shape', () => {
    expect(validateEventDocument(v3Document())).toEqual([]);

    const invalid = clone(v3Document());
    invalid.events[0].versions[0].def.eligibility.all.push({
      fact: 'owned.card.count',
      args: { where: 'any', count: 1, match: { mystery: ['bow'] } },
    });
    expect(paths(invalid)).toContain('v3_probe@v1.eligibility.all[2].args.match.mystery');
  });

  it('rejects an undeclared story key, an unknown fact, numeric add, and an unpaired binding slot', () => {
    const invalid = clone(v3Document());
    invalid.events[0].versions[0].def.eligibility.all.push({ fact: 'quest.any', args: {} });
    invalid.events[0].versions[0].def.choiceSet.fixed[0].mutations = [
      { op: 'add', key: 'grave_path', value: 1 },
    ];
    invalid.events[0].versions[0].def.bindings = [
      { as: 'enemy_id', source: 'signature.cardId' },
    ];

    const where = paths(invalid);
    expect(where).toContain('v3_probe@v1.eligibility.all[2].fact');
    expect(where).toContain('v3_probe@v1.choiceSet.fixed[0].mutations[0].op');
    expect(where).toContain('v3_probe@v1.bindings[0].source');
  });
});

describe('schema v3 story registry and wrapper versions', () => {
  it('requires the exact eight-key registry with exact defaults and enum order', () => {
    expect(validateEventDocument(v3Document())).toEqual([]);

    const missing = clone(v3Document());
    delete missing.storyStateSchema.oath_mercy;
    expect(paths(missing)).toContain('storyStateSchema.oath_mercy');

    const extra = clone(v3Document());
    extra.storyStateSchema.unapproved_flag = { kind: 'boolean', default: false };
    expect(paths(extra)).toContain('storyStateSchema.unapproved_flag');

    const wrongBoolean = clone(v3Document());
    wrongBoolean.storyStateSchema.rival_spared.default = true;
    expect(paths(wrongBoolean)).toContain('storyStateSchema.rival_spared.default');

    const wrongEnum = clone(v3Document());
    wrongEnum.storyStateSchema.grave_path.values = ['none', 'answered', 'opened'];
    expect(paths(wrongEnum)).toContain('storyStateSchema.grave_path.values');

    const unknownField = clone(v3Document());
    unknownField.storyStateSchema.venom_bloom.numeric = false;
    expect(paths(unknownField)).toContain('storyStateSchema.venom_bloom.numeric');
  });

  it('exposes the exact key-discriminated story schema and flag authoring unions', () => {
    const registry = {
      oath_mercy: { kind: 'boolean', default: false },
      grave_path: { kind: 'enum', values: ['none', 'opened', 'answered'], default: 'none' },
      honorable_choice: { kind: 'boolean', default: false },
      reliquary_oath: { kind: 'boolean', default: false },
      oath_gate: { kind: 'enum', values: ['none', 'sworn', 'kept', 'released'], default: 'none' },
      venom_bloom: { kind: 'enum', values: ['none', 'cultivated'], default: 'none' },
      rival_spared: { kind: 'boolean', default: false },
      moon_quarry_released: { kind: 'boolean', default: false },
    } as const satisfies StoryStateSchemaV3;
    const requirements = [
      { fact: 'story.flag', args: { key: 'oath_mercy', op: 'neq', value: true } },
      { fact: 'story.flag', args: { key: 'grave_path', op: 'eq', value: 'answered' } },
      { fact: 'story.flag', args: { key: 'oath_gate', op: 'in', value: ['sworn', 'kept'] } },
      { fact: 'story.flag', args: { key: 'venom_bloom', op: 'neq', value: 'none' } },
    ] as const satisfies readonly EventRequirementV3[];

    expectTypeOf(registry.oath_mercy.default).toEqualTypeOf<false>();
    expectTypeOf(registry.grave_path.values).toEqualTypeOf<readonly ['none', 'opened', 'answered']>();
    expect(requirements).toHaveLength(4);

    // @ts-expect-error boolean story keys cannot author enum registry metadata
    const invalidBooleanRegistry: StoryStateSchemaV3['oath_mercy'] = { kind: 'enum', values: ['none'], default: 'none' };
    // @ts-expect-error boolean story flags do not support the enum-only in operator
    const invalidBooleanIn: EventRequirementV3 = { fact: 'story.flag', args: { key: 'oath_mercy', op: 'in', value: ['false'] } };
    // @ts-expect-error enum story flags do not accept boolean values
    const invalidEnumBoolean: EventRequirementV3 = { fact: 'story.flag', args: { key: 'grave_path', op: 'eq', value: false } };
    // @ts-expect-error enum story flags accept only the declared value vocabulary
    const invalidEnumValue: EventRequirementV3 = { fact: 'story.flag', args: { key: 'venom_bloom', op: 'eq', value: 'harvested' } };
    void [invalidBooleanRegistry, invalidBooleanIn, invalidEnumBoolean, invalidEnumValue];

    expectTypeOf<EventDefV3['rarity']>().toEqualTypeOf<EventRarity>();
  });

  it('inherits schema 3 when the wrapper tag is absent and honors explicit historical tags', () => {
    const document = v3Document();
    document.events[0].versions = [
      { version: 1, schemaVersion: 1, def: v1Definition() },
      { version: 2, schemaVersion: 2, def: v2Definition() },
      { version: 3, def: definition() },
    ];

    expect(validateEventDocument(document)).toEqual([]);
    expect(eventSchemaVersionOfWrapper(2, { version: 1, def: v1Definition() })).toBe(2);
    expect(eventSchemaVersionOfWrapper(3, { version: 3, def: definition() })).toBe(3);
    expect(eventSchemaVersionOfWrapper(3, { version: 2, schemaVersion: 2, def: v2Definition() })).toBe(2);
  });

  it('makes explicit wrapper tags strict and keeps schema identity out of def', () => {
    const wrongVersion = clone(v3Document());
    wrongVersion.events[0].versions[0].schemaVersion = 4;
    expect(paths(wrongVersion)).toContain('v3_probe@v1.schemaVersion');

    const v1TaggedV3 = clone(v3Document());
    v1TaggedV3.events[0].versions[0].schemaVersion = 1;
    expect(paths(v1TaggedV3)).toContain('v3_probe@v1.story');

    const nestedTag = clone(v3Document());
    defOf(nestedTag).schemaVersion = 3;
    expect(paths(nestedTag)).toContain('v3_probe@v1.schemaVersion');
  });
});

describe('schema v3 requirement AST', () => {
  const validLeaves: Array<[string, JsonRecord]> = [
    ['wallet.current', { fact: 'wallet.current', args: { op: 'gte', value: 0 } }],
    ['lives.current', { fact: 'lives.current', args: { op: 'eq', value: 2 } }],
    ['node.depth', { fact: 'node.depth', args: { op: 'lte', value: 9 } }],
    ['node.wave', { fact: 'node.wave', args: { op: 'gte', value: 1 } }],
    ['run.tally', { fact: 'run.tally', args: { stat: 'bossesCleared', op: 'gte', value: 1 } }],
    ['event.choice', { fact: 'event.choice', args: { eventId: 'source_event', choiceIds: ['leave', 'coin'] } }],
    ['story.flag boolean', { fact: 'story.flag', args: { key: 'oath_mercy', op: 'eq', value: false } }],
    ['story.flag enum', { fact: 'story.flag', args: { key: 'grave_path', op: 'in', value: ['opened', 'answered'] } }],
    ['chain.completed', { fact: 'chain.completed', args: { storyId: 'source_event' } }],
    ['biome.current', { fact: 'biome.current', args: { ids: ['arrowfell', 'thornwild'] } }],
    ['board.affinity', { fact: 'board.affinity', args: { affinityId: 'frost' } }],
    ['board.isMonoType', { fact: 'board.isMonoType', args: { typeKind: 'weapon' } }],
    ['owned.card.count', { fact: 'owned.card.count', args: { where: 'held', count: 1, match: { cardIds: ['aegis_wall'], weapons: ['sword'], elements: ['holy'], archetypes: ['defensive'] }, tierAtLeast: 'gold' } }],
    ['owned.gem.count', { fact: 'owned.gem.count', args: { where: 'socketed', count: 1, match: { gemIds: ['archmages_core'], actionKinds: ['damage'], heroStats: ['attack'] } } }],
    ['combat.enemyDefeated by id', { fact: 'combat.enemyDefeated', args: { enemyId: 'giant_rat', atLeast: 1 } }],
    ['combat.enemyDefeated by affinity', { fact: 'combat.enemyDefeated', args: { weaponAffinity: 'beast', atLeast: 2 } }],
    ['combat.biomeBossDefeated', { fact: 'combat.biomeBossDefeated', args: { biomeId: 'arrowfell' } }],
    ['combat.affinityWin', { fact: 'combat.affinityWin', args: { affinityId: 'bow', atLeast: 2, biomeId: 'arrowfell' } }],
    ['combat.statusUsed', { fact: 'combat.statusUsed', args: { status: 'poison', result: 'bossWin', biomeId: 'arrowfell' } }],
    ['combat.actionKindUsed', { fact: 'combat.actionKindUsed', args: { actionKind: 'ward', result: 'win', biomeId: 'arrowfell' } }],
    ['combat.fastWin', { fact: 'combat.fastWin', args: { maxTurns: 4, element: 'lightning' } }],
    ['combat.recentLoss', { fact: 'combat.recentLoss', args: { withinDepth: 2 } }],
    ['combat.noLossesInBiome', { fact: 'combat.noLossesInBiome', args: { biomeId: 'arrowfell' } }],
    ['combat.revengeReady', { fact: 'combat.revengeReady', args: {} }],
    ['combat.signatureReady', { fact: 'combat.signatureReady', args: { winsAtLeast: 3, bossFinisher: true } }],
    ['journey.visitedBiomes', { fact: 'journey.visitedBiomes', args: { op: 'gte', value: 2 } }],
    ['journey.completedChains', { fact: 'journey.completedChains', args: { op: 'gte', value: 1 } }],
    ['callback.queued', { fact: 'callback.queued', args: { callbackId: 'v3_probe_callback' } }],
  ];

  it.each(validLeaves)('accepts the %s leaf', (_name, requirement) => {
    expect(validateEventDocument(documentWithEligibility(requirement))).toEqual([]);
  });

  it('accepts recursively nested non-empty composites', () => {
    const document = documentWithEligibility({
      all: [
        { not: { fact: 'story.flag', args: { key: 'oath_mercy', op: 'eq', value: true } } },
        { any: [
          { fact: 'wallet.current', args: { op: 'gte', value: 2 } },
          { fact: 'node.depth', args: { op: 'gte', value: 3 } },
        ] },
      ],
    });
    expect(validateEventDocument(document)).toEqual([]);
  });

  it.each([
    ['empty composite', { all: [] }, 'v3_probe@v1.eligibility.all'],
    ['mixed composite and leaf', { all: [{ fact: 'node.depth', args: { op: 'gte', value: 1 } }], fact: 'node.wave', args: { op: 'eq', value: 1 } }, 'v3_probe@v1.eligibility.fact'],
    ['duplicate composite child', { any: [{ fact: 'node.depth', args: { op: 'gte', value: 1 } }, { args: { value: 1, op: 'gte' }, fact: 'node.depth' }] }, 'v3_probe@v1.eligibility.any[1]'],
    ['unknown fact', { fact: 'quest.any', args: {} }, 'v3_probe@v1.eligibility.fact'],
    ['invalid numeric operator', { fact: 'wallet.current', args: { op: 'neq', value: 1 } }, 'v3_probe@v1.eligibility.args.op'],
    ['unknown tally stat', { fact: 'run.tally', args: { stat: 'damage', op: 'gte', value: 1 } }, 'v3_probe@v1.eligibility.args.stat'],
    ['empty choice OR-list', { fact: 'event.choice', args: { eventId: 'source_event', choiceIds: [] } }, 'v3_probe@v1.eligibility.args.choiceIds'],
    ['duplicate choice OR-list', { fact: 'event.choice', args: { eventId: 'source_event', choiceIds: ['leave', 'leave'] } }, 'v3_probe@v1.eligibility.args.choiceIds[1]'],
    ['wrong boolean story value', { fact: 'story.flag', args: { key: 'oath_mercy', op: 'eq', value: 'false' } }, 'v3_probe@v1.eligibility.args.value'],
    ['invalid boolean story op', { fact: 'story.flag', args: { key: 'oath_mercy', op: 'in', value: [false] } }, 'v3_probe@v1.eligibility.args.op'],
    ['unknown enum story value', { fact: 'story.flag', args: { key: 'grave_path', op: 'eq', value: 'buried' } }, 'v3_probe@v1.eligibility.args.value'],
    ['duplicate enum OR-list', { fact: 'story.flag', args: { key: 'grave_path', op: 'in', value: ['opened', 'opened'] } }, 'v3_probe@v1.eligibility.args.value[1]'],
    ['unknown biome', { fact: 'biome.current', args: { ids: ['missing_biome'] } }, 'v3_probe@v1.eligibility.args.ids[0]'],
    ['unknown affinity', { fact: 'board.affinity', args: { affinityId: 'water' } }, 'v3_probe@v1.eligibility.args.affinityId'],
    ['nonpositive card count', { fact: 'owned.card.count', args: { where: 'any', count: 0, match: {} } }, 'v3_probe@v1.eligibility.args.count'],
    ['unknown card matcher field', { fact: 'owned.card.count', args: { where: 'any', count: 1, match: { properties: ['physical'] } } }, 'v3_probe@v1.eligibility.args.match.properties'],
    ['unknown card id', { fact: 'owned.card.count', args: { where: 'any', count: 1, match: { cardIds: ['missing_card'] } } }, 'v3_probe@v1.eligibility.args.match.cardIds[0]'],
    ['unknown gem id', { fact: 'owned.gem.count', args: { where: 'any', count: 1, match: { gemIds: ['missing_gem'] } } }, 'v3_probe@v1.eligibility.args.match.gemIds[0]'],
    ['two enemy selectors', { fact: 'combat.enemyDefeated', args: { enemyId: 'giant_rat', weaponAffinity: 'beast', atLeast: 1 } }, 'v3_probe@v1.eligibility.args'],
    ['unknown enemy', { fact: 'combat.enemyDefeated', args: { enemyId: 'missing_enemy', atLeast: 1 } }, 'v3_probe@v1.eligibility.args.enemyId'],
    ['nonpositive combat count', { fact: 'combat.affinityWin', args: { affinityId: 'bow', atLeast: 0 } }, 'v3_probe@v1.eligibility.args.atLeast'],
    ['unknown action kind', { fact: 'combat.actionKindUsed', args: { actionKind: 'teleport', result: 'win' } }, 'v3_probe@v1.eligibility.args.actionKind'],
    ['false boss finisher', { fact: 'combat.signatureReady', args: { winsAtLeast: 1, bossFinisher: false } }, 'v3_probe@v1.eligibility.args.bossFinisher'],
    ['journey non-gte operator', { fact: 'journey.visitedBiomes', args: { op: 'eq', value: 1 } }, 'v3_probe@v1.eligibility.args.op'],
    ['unknown nested arg', { fact: 'node.depth', args: { op: 'gte', value: 1, surprise: true } }, 'v3_probe@v1.eligibility.args.surprise'],
  ])('rejects %s', (_name, requirement, path) => {
    expect(paths(documentWithEligibility(requirement as JsonRecord))).toContain(path);
  });
});

describe('schema v3 choices, mutations, and outcomes', () => {
  it('accepts every typed story mutation and rejects add, wrong values, and generic paths', () => {
    const valid = v3Document();
    defOf(valid).choiceSet.fixed[0].mutations = [
      { op: 'completeStory', storyId: 'v3_probe' },
      { op: 'set', key: 'oath_mercy', value: true },
      { op: 'set', key: 'honorable_choice', value: false },
      { op: 'set', key: 'reliquary_oath', value: true },
      { op: 'set', key: 'rival_spared', value: false },
      { op: 'set', key: 'moon_quarry_released', value: true },
      { op: 'set', key: 'grave_path', value: 'answered' },
      { op: 'set', key: 'oath_gate', value: 'kept' },
      { op: 'set', key: 'venom_bloom', value: 'cultivated' },
    ];
    expect(validateEventDocument(valid)).toEqual([]);

    const cases: Array<[JsonRecord, string]> = [
      [{ op: 'add', key: 'grave_path', value: 1 }, 'op'],
      [{ op: 'set', key: 'oath_mercy', value: 'true' }, 'value'],
      [{ op: 'set', key: 'grave_path', value: 'buried' }, 'value'],
      [{ op: 'set', key: 'unknown_flag', value: true }, 'key'],
      [{ op: 'set', path: 'story.oath_mercy', value: true }, 'path'],
      [{ op: 'completeStory', storyId: 'v3_probe', value: true }, 'value'],
    ];
    for (const [mutation, field] of cases) {
      const invalid = v3Document();
      defOf(invalid).choiceSet.fixed[0].mutations = [mutation];
      expect(paths(invalid)).toContain(`v3_probe@v1.choiceSet.fixed[0].mutations[0].${field}`);
    }
  });

  it('preserves fixed and pool authoring order while enforcing the 2–3 displayed-choice contract', async () => {
    const { loadEventContent } = await import('../../src/data/eventsContent');
    const valid = v3Document();
    defOf(valid).choiceSet.fixed.unshift({ id: 'first', label: 'First', cost: 0, outcome: { kind: 'nothing' } });
    expect(validateEventDocument(valid)).toEqual([]);

    const loaded = loadEventContent(valid);
    const projected = loaded.catalog.v3_probe as unknown as JsonRecord;
    expect(projected.choiceSet.fixed.map((choice: JsonRecord) => choice.id)).toEqual(['first', 'leave']);
    expect(projected.choiceSet.pool.entries.map((choice: JsonRecord) => choice.id)).toEqual(['coin']);
    expect(projected).toMatchObject({ id: 'v3_probe', contentSchemaVersion: 3 });
    expect(projected).not.toHaveProperty('schemaVersion');
    expect(projected).not.toHaveProperty('version');
    expect(projected).not.toHaveProperty('choices');

    const tooFew = v3Document();
    delete defOf(tooFew).choiceSet.pool;
    expect(paths(tooFew)).toContain('v3_probe@v1.choiceSet');

    const tooMany = clone(valid);
    defOf(tooMany).choiceSet.fixed.push({ id: 'fourth', label: 'Fourth', cost: 0, outcome: { kind: 'nothing' } });
    expect(paths(tooMany)).toContain('v3_probe@v1.choiceSet');

    const drawTwo = v3Document();
    defOf(drawTwo).choiceSet.pool.draw = 2;
    expect(paths(drawTwo)).toContain('v3_probe@v1.choiceSet.pool.draw');

    const emptyPool = v3Document();
    defOf(emptyPool).choiceSet.pool.entries = [];
    expect(paths(emptyPool)).toContain('v3_probe@v1.choiceSet.pool.entries');

    const duplicate = v3Document();
    defOf(duplicate).choiceSet.pool.entries[0].id = 'leave';
    expect(paths(duplicate)).toContain('v3_probe@v1.choiceSet.pool.entries[0].id');

    const poolOnlyExit = v3Document();
    defOf(poolOnlyExit).choiceSet.fixed[0].cost = 1;
    expect(paths(poolOnlyExit)).toContain('v3_probe@v1.choiceSet.fixed');
  });

  it('normalizes weighted labels by largest remainder and authored-order ties', () => {
    const equal = v3Document();
    defOf(equal).choiceSet.pool.entries[0].outcome.branches = [
      { id: 'first', label: 'First — 34%', weight: 1, outcome: { kind: 'grantGold', amount: 1 } },
      { id: 'second', label: 'Second — 33%', weight: 1, outcome: { kind: 'nothing' } },
      { id: 'third', label: 'Third — 33%', weight: 1, outcome: { kind: 'nothing' }, mutations: [{ op: 'set', key: 'oath_mercy', value: true }] },
    ];
    expect(validateEventDocument(equal)).toEqual([]);

    const unequal = clone(equal);
    defOf(unequal).choiceSet.pool.entries[0].outcome.branches = [
      { id: 'first', label: 'First — 17%', weight: 1, outcome: { kind: 'nothing' } },
      { id: 'second', label: 'Second — 33%', weight: 2, outcome: { kind: 'nothing' } },
      { id: 'third', label: 'Third — 50%', weight: 3, outcome: { kind: 'nothing' } },
    ];
    expect(validateEventDocument(unequal)).toEqual([]);

    const wrongOdds = clone(equal);
    defOf(wrongOdds).choiceSet.pool.entries[0].outcome.branches[0].label = 'First — 33%';
    expect(paths(wrongOdds)).toContain('v3_probe@v1.choiceSet.pool.entries[0].outcome.branches[0].label');

    const embeddedDigits = clone(equal);
    defOf(embeddedDigits).choiceSet.pool.entries[0].outcome.branches[0].label = 'First — 134%';
    expect(paths(embeddedDigits)).toContain('v3_probe@v1.choiceSet.pool.entries[0].outcome.branches[0].label');
  });

  it.each([
    ['missing branch label', (outcome: JsonRecord) => { delete outcome.branches[0].label; }, 'branches[0].label'],
    ['duplicate branch id', (outcome: JsonRecord) => { outcome.branches[1].id = outcome.branches[0].id; }, 'branches[1].id'],
    ['zero branch weight', (outcome: JsonRecord) => { outcome.branches[0].weight = 0; }, 'branches[0].weight'],
    ['fractional branch weight', (outcome: JsonRecord) => { outcome.branches[0].weight = 1.5; }, 'branches[0].weight'],
    ['recursive weighted branch', (outcome: JsonRecord) => { outcome.branches[0].outcome = clone(outcome); }, 'branches[0].outcome.kind'],
    ['unknown branch field', (outcome: JsonRecord) => { outcome.branches[0].surprise = true; }, 'branches[0].surprise'],
  ])('rejects %s', (_name, mutate, suffix) => {
    const invalid = v3Document();
    const outcome = defOf(invalid).choiceSet.pool.entries[0].outcome;
    mutate(outcome);
    expect(paths(invalid)).toContain(`v3_probe@v1.choiceSet.pool.entries[0].outcome.${suffix}`);
  });

  it('accepts higher-tier event offers and all closed targeted-upgrade targets', () => {
    const outcomes: JsonRecord[] = [
      { kind: 'cardChoice', filter: [{ elements: ['dark'] }], maxTier: 'gold' },
      { kind: 'cardChoice', filter: [{ weapons: ['bow'] }], maxTier: 'diamond' },
      { kind: 'upgradeCardTargeted', target: { filter: { where: 'any', match: { elements: ['dark'] } } }, fallback: { kind: 'grantGold', amount: 2 } },
      { kind: 'upgradeCardTargeted', target: { boundSubject: { slot: 'revenge_finisher_card_id' } }, fallback: { kind: 'nothing' } },
      { kind: 'upgradeCardTargeted', target: { boundSubject: { slot: 'signature_card_id' } }, fallback: { kind: 'grantGold', amount: 1 } },
      { kind: 'upgradeCardTargeted', target: { boundSubject: { slot: 'mono_type', typeKind: 'weapon' } }, fallback: { kind: 'nothing' } },
    ];
    for (const outcome of outcomes) {
      const document = v3Document();
      defOf(document).choiceSet.pool.entries[0].outcome = outcome;
      const bound = outcome.kind === 'upgradeCardTargeted'
        ? outcome.target.boundSubject as JsonRecord | undefined
        : undefined;
      if (bound?.slot === 'revenge_finisher_card_id') {
        defOf(document).bindings = [{
          as: 'revenge_finisher_card_id', source: 'revenge.finisherCardId',
        }];
      } else if (bound?.slot === 'signature_card_id') {
        defOf(document).bindings = [{ as: 'signature_card_id', source: 'signature.cardId' }];
        defOf(document).eligibility.all.unshift({
          fact: 'combat.signatureReady', args: { winsAtLeast: 3, bossFinisher: true },
        });
      } else if (bound?.slot === 'mono_type') {
        defOf(document).bindings = [{ as: 'mono_type', source: 'board.monoType' }];
      }
      expect(validateEventDocument(document), JSON.stringify(outcome)).toEqual([]);
    }
  });

  it('accepts capstone card offers only in Secret capstone/capstone definitions, including weighted branches', () => {
    const direct = v3Document();
    const directDef = defOf(direct);
    directDef.rarity = 'secret';
    directDef.story = { storyId: 'v3_probe', stage: 'capstone', role: 'capstone' };
    directDef.choiceSet.pool.entries[0].outcome = {
      kind: 'cardChoice', filter: [{ weapons: ['bow'] }], maxTier: 'diamond', capstone: true,
    };
    expect(validateEventDocument(direct)).toEqual([]);

    const weighted = clone(direct);
    defOf(weighted).choiceSet.pool.entries[0].outcome = {
      kind: 'weighted',
      branches: [
        {
          id: 'capstone', label: 'Capstone (50%)', weight: 1,
          outcome: { kind: 'cardChoice', filter: [{ weapons: ['bow'] }], maxTier: 'diamond', capstone: true },
        },
        { id: 'nothing', label: 'Nothing (50%)', weight: 1, outcome: { kind: 'nothing' } },
      ],
    };
    expect(validateEventDocument(weighted)).toEqual([]);
  });

  it.each([
    ['non-Secret rarity', (def: JsonRecord) => { def.rarity = 'rare'; }, 'capstone'],
    ['non-capstone stage', (def: JsonRecord) => { def.story.stage = 'payoff'; }, 'capstone'],
    ['non-capstone role', (def: JsonRecord) => { def.story.role = 'payoff'; }, 'capstone'],
    ['non-Diamond maximum', (def: JsonRecord) => { def.choiceSet.pool.entries[0].outcome.maxTier = 'gold'; }, 'maxTier'],
  ])('rejects capstone card offers with %s', (_name, mutate, field) => {
    const document = v3Document();
    const def = defOf(document);
    def.rarity = 'secret';
    def.story = { storyId: 'v3_probe', stage: 'capstone', role: 'capstone' };
    def.choiceSet.pool.entries[0].outcome = {
      kind: 'cardChoice', filter: [{ weapons: ['bow'] }], maxTier: 'diamond', capstone: true,
    };
    mutate(def);
    expect(paths(document)).toContain(`v3_probe@v1.choiceSet.pool.entries[0].outcome.${field}`);
  });

  it('rejects an unauthorized capstone card offer inside a weighted branch at that branch path', () => {
    const document = v3Document();
    defOf(document).choiceSet.pool.entries[0].outcome = {
      kind: 'weighted',
      branches: [
        {
          id: 'capstone', label: 'Capstone (50%)', weight: 1,
          outcome: { kind: 'cardChoice', filter: [{ weapons: ['bow'] }], maxTier: 'diamond', capstone: true },
        },
        { id: 'nothing', label: 'Nothing (50%)', weight: 1, outcome: { kind: 'nothing' } },
      ],
    };
    expect(paths(document)).toContain(
      'v3_probe@v1.choiceSet.pool.entries[0].outcome.branches[0].outcome.capstone',
    );
  });

  it.each([
    ['v2 card-choice tier', { kind: 'cardChoice', filter: [{ elements: ['dark'] }], tier: 'bronze', maxTier: 'gold' }, 'tier'],
    ['missing event maxTier', { kind: 'cardChoice', filter: [{ elements: ['dark'] }] }, 'maxTier'],
    ['false capstone', { kind: 'cardChoice', filter: [{ elements: ['dark'] }], maxTier: 'diamond', capstone: false }, 'capstone'],
    ['empty targeted match', { kind: 'upgradeCardTargeted', target: { filter: { where: 'any', match: {} } }, fallback: { kind: 'nothing' } }, 'target.filter.match'],
    ['mixed target kinds', { kind: 'upgradeCardTargeted', target: { filter: { where: 'any', match: { elements: ['dark'] } }, boundSubject: { slot: 'signature_card_id' } }, fallback: { kind: 'nothing' } }, 'target'],
    ['recursive fallback', { kind: 'upgradeCardTargeted', target: { boundSubject: { slot: 'signature_card_id' } }, fallback: { kind: 'upgradeCardTargeted' } }, 'fallback.kind'],
  ])('rejects %s', (_name, outcome, suffix) => {
    const document = v3Document();
    defOf(document).choiceSet.pool.entries[0].outcome = outcome;
    expect(paths(document)).toContain(`v3_probe@v1.choiceSet.pool.entries[0].outcome.${suffix}`);
  });

  it('accepts a mono target without typeKind as the exact persisted structured identity', () => {
    const document = v3Document();
    defOf(document).choiceSet.pool.entries[0].outcome = {
      kind: 'upgradeCardTargeted',
      target: { boundSubject: { slot: 'mono_type' } },
      fallback: { kind: 'nothing' },
    };
    defOf(document).bindings = [{ as: 'mono_type', source: 'board.monoType' }];
    expect(validateEventDocument(document)).toEqual([]);
  });
});

describe('schema v3 bindings and callbacks', () => {
  it('accepts the exact ambient producer and queued consumer matrices in separate delivery contexts', () => {
    const ambient = v3Document();
    defOf(ambient).bindings = [
      { as: 'enemy_id', source: 'revenge.enemyId' },
      { as: 'revenge_finisher_card_id', source: 'revenge.finisherCardId' },
      { as: 'signature_card_id', source: 'signature.cardId' },
      { as: 'mono_type', source: 'board.monoType' },
      { as: 'destination_biome', source: 'journey.futureBiome', candidates: 'unvisited_catalog' },
    ];
    defOf(ambient).eligibility.all.unshift({
      fact: 'combat.signatureReady', args: { winsAtLeast: 3, bossFinisher: true },
    });
    expect(validateEventDocument(ambient)).toEqual([]);

    const queued = v3Document();
    defOf(queued).delivery = { kind: 'queued_callback' };
    defOf(queued).eligibility = {
      fact: 'callback.queued', args: { callbackId: 'v3_probe_callback' },
    };
    defOf(queued).acceptsBindings = [
      'enemy_id',
      'revenge_finisher_card_id',
      'signature_card_id',
      'mono_type',
      'destination_biome',
    ];
    expect(validateEventDocument(queued)).toEqual([]);
  });

  it('rejects binding declarations owned by the opposite delivery mode', () => {
    const ambient = v3Document();
    defOf(ambient).acceptsBindings = ['enemy_id'];
    expect(paths(ambient)).toContain('v3_probe@v1.acceptsBindings');

    const queued = v3Document();
    defOf(queued).delivery = { kind: 'queued_callback' };
    defOf(queued).eligibility = {
      fact: 'callback.queued', args: { callbackId: 'v3_probe_callback' },
    };
    defOf(queued).bindings = [{ as: 'enemy_id', source: 'revenge.enemyId' }];
    expect(paths(queued)).toContain('v3_probe@v1.bindings');

    const queuedOptional = clone(queued);
    queuedOptional.events[0].versions[0].def.bindings = [{
      as: 'revenge_finisher_card_id', source: 'revenge.finisherCardId', optional: true,
    }];
    expect(paths(queuedOptional)).toEqual(expect.arrayContaining([
      'v3_probe@v1.bindings',
      'v3_probe@v1.bindings[0].optional',
    ]));
  });

  it.each([
    ['wrong paired source', { as: 'enemy_id', source: 'signature.cardId' }, 'source'],
    ['wrong destination candidates', { as: 'destination_biome', source: 'journey.futureBiome', candidates: 'all_catalog' }, 'candidates'],
    ['candidates on a fixed source', { as: 'mono_type', source: 'board.monoType', candidates: 'unvisited_catalog' }, 'candidates'],
    ['unknown slot', { as: 'card_id', source: 'signature.cardId' }, 'as'],
    ['unknown source', { as: 'signature_card_id', source: 'signature.skillId' }, 'source'],
  ])('rejects %s', (_name, binding, field) => {
    const document = v3Document();
    defOf(document).bindings = [binding];
    expect(paths(document)).toContain(`v3_probe@v1.bindings[0].${field}`);
  });

  it('rejects duplicate binding outputs and invalid accepted slots', () => {
    const duplicate = v3Document();
    defOf(duplicate).bindings = [
      { as: 'enemy_id', source: 'revenge.enemyId' },
      { as: 'enemy_id', source: 'revenge.enemyId' },
    ];
    expect(paths(duplicate)).toContain('v3_probe@v1.bindings[1].as');

    const invalidAccepted = v3Document();
    defOf(invalidAccepted).delivery = { kind: 'queued_callback' };
    defOf(invalidAccepted).eligibility = {
      fact: 'callback.queued', args: { callbackId: 'v3_probe_callback' },
    };
    defOf(invalidAccepted).acceptsBindings = ['enemy_id', 'enemy_id', 'unknown_slot'];
    expect(paths(invalidAccepted)).toContain('v3_probe@v1.acceptsBindings[1]');
    expect(paths(invalidAccepted)).toContain('v3_probe@v1.acceptsBindings[2]');
  });

  it('accepts typed callback bindings and both terminal expiry fallbacks', () => {
    const grant = callbackDocument();
    expect(validateEventDocument(grant)).toEqual([]);

    const discard = clone(grant);
    defOf(discard).choiceSet.fixed[0].callback.expiry.fallback = 'discard';
    expect(validateEventDocument(discard)).toEqual([]);
  });

  it('allows optional revenge finishers only in ambient bindings, never callback copies', () => {
    const ambient = v3Document();
    defOf(ambient).bindings = [{
      as: 'revenge_finisher_card_id', source: 'revenge.finisherCardId', optional: true,
    }];
    expect(validateEventDocument(ambient)).toEqual([]);

    const callback = callbackDocument();
    defOf(callback).choiceSet.fixed[0].callback.bind[0] = {
      as: 'revenge_finisher_card_id', source: 'revenge.finisherCardId', optional: true,
    };
    defOf(callback).bindings[0] = {
      as: 'revenge_finisher_card_id', source: 'revenge.finisherCardId', optional: true,
    };
    defOf(callback, 1).acceptsBindings[0] = 'revenge_finisher_card_id';
    expect(paths(callback)).toContain(
      'v3_probe@v1.choiceSet.fixed[0].callback.bind[0].optional',
    );
  });

  it('requires every direct, weighted, and callback bound consumer from its delivery source', () => {
    const direct = v3Document();
    defOf(direct).choiceSet.pool.entries[0].outcome = {
      kind: 'upgradeCardTargeted',
      target: { boundSubject: { slot: 'mono_type' } },
      fallback: { kind: 'nothing' },
    };
    expect(paths(direct)).toContain(
      'v3_probe@v1.choiceSet.pool.entries[0].outcome.target.boundSubject.slot',
    );

    const weighted = v3Document();
    defOf(weighted).choiceSet.pool.entries[0].outcome = {
      kind: 'weighted',
      branches: [
        {
          id: 'bound', label: 'Bound (50%)', weight: 1,
          outcome: {
            kind: 'upgradeCardTargeted',
            target: { boundSubject: { slot: 'mono_type' } },
            fallback: { kind: 'nothing' },
          },
        },
        { id: 'safe', label: 'Safe (50%)', weight: 1, outcome: { kind: 'nothing' } },
      ],
    };
    expect(paths(weighted)).toContain(
      'v3_probe@v1.choiceSet.pool.entries[0].outcome.branches[0].outcome.target.boundSubject.slot',
    );

    const callback = callbackDocument();
    defOf(callback).bindings = [{ as: 'enemy_id', source: 'revenge.enemyId' }];
    expect(paths(callback)).toContain(
      'v3_probe@v1.choiceSet.fixed[0].callback.bind[1].as',
    );

    const queued = callbackDocument();
    defOf(queued, 1).choiceSet.fixed[0].outcome = {
      kind: 'upgradeCardTargeted',
      target: { boundSubject: { slot: 'signature_card_id' } },
      fallback: { kind: 'nothing' },
    };
    expect(paths(queued)).toContain(
      'v3_probe_callback@v1.choiceSet.fixed[0].outcome.target.boundSubject.slot',
    );
  });

  it('requires each callback producer slot set to exactly match its target contract', () => {
    const missing = callbackDocument();
    defOf(missing).choiceSet.fixed[0].callback.bind.pop();
    expect(paths(missing)).toContain('v3_probe@v1.choiceSet.fixed[0].callback.bind');

    const extra = callbackDocument();
    defOf(extra).bindings.push({ as: 'signature_card_id', source: 'signature.cardId' });
    defOf(extra).eligibility.all.unshift({
      fact: 'combat.signatureReady', args: { winsAtLeast: 3, bossFinisher: true },
    });
    defOf(extra).choiceSet.fixed[0].callback.bind.push({
      as: 'signature_card_id', source: 'signature.cardId',
    });
    expect(paths(extra)).toContain(
      'v3_probe@v1.choiceSet.fixed[0].callback.bind[2].as',
    );

    const wrong = callbackDocument();
    defOf(wrong).bindings[1] = { as: 'signature_card_id', source: 'signature.cardId' };
    defOf(wrong).eligibility.all.unshift({
      fact: 'combat.signatureReady', args: { winsAtLeast: 3, bossFinisher: true },
    });
    defOf(wrong).choiceSet.fixed[0].callback.bind[1] = {
      as: 'signature_card_id', source: 'signature.cardId',
    };
    const wrongPaths = paths(wrong);
    expect(wrongPaths).toContain('v3_probe@v1.choiceSet.fixed[0].callback.bind');
    expect(wrongPaths).toContain('v3_probe@v1.choiceSet.fixed[0].callback.bind[1].as');
  });

  it('requires schema-v2 callbacks to target schema-v2 definitions in a mixed document', () => {
    expect(validateEventDocument(v2CallbackInV3Document(2))).toEqual([]);
    expect(paths(v2CallbackInV3Document(3))).toContain(
      'mixed_schema_source@v1.choices[0].callback.eventId',
    );
  });

  it.each([
    ['missing event', (document: JsonRecord) => { defOf(document).choiceSet.fixed[0].callback.eventId = 'missing_callback'; }, 'eventId'],
    ['missing content version', (document: JsonRecord) => { defOf(document).choiceSet.fixed[0].callback.contentVersion = 2; }, 'contentVersion'],
    ['ambient target', (document: JsonRecord) => {
      defOf(document, 1).delivery.kind = 'ambient';
      delete defOf(document, 1).acceptsBindings;
    }, 'eventId'],
    ['non-exact queued eligibility', (document: JsonRecord) => { defOf(document, 1).eligibility = { any: [{ fact: 'callback.queued', args: { callbackId: 'v3_probe_callback' } }] }; }, 'eventId'],
    ['unaccepted bound slot', (document: JsonRecord) => { defOf(document, 1).acceptsBindings = ['enemy_id']; }, 'bind[1].as'],
    ['incompatible target theme', (document: JsonRecord) => { defOf(document, 1).theme = 'cache'; }, 'destinationThemes'],
    ['incompatible target biome', (document: JsonRecord) => { defOf(document, 1).biomeIds = ['thornwild']; }, 'destinationBiomeIds'],
  ])('rejects a callback with %s', (_name, mutate, suffix) => {
    const document = callbackDocument();
    mutate(document);
    expect(paths(document)).toContain(`v3_probe@v1.choiceSet.fixed[0].callback.${suffix}`);
  });

  it.each([
    ['weighted expiry', { outcome: { kind: 'weighted', branches: [] } }, 'kind'],
    ['interactive expiry', { outcome: { kind: 'cardChoice', filter: [{ elements: ['dark'] }], maxTier: 'gold' } }, 'kind'],
    ['recursive targeted expiry', { outcome: { kind: 'upgradeCardTargeted' } }, 'kind'],
    ['zero expiry gold', { outcome: { kind: 'grantGold', amount: 0 } }, 'amount'],
    ['unknown fallback field', { outcome: { kind: 'grantGold', amount: 1 }, surprise: true }, 'surprise'],
  ])('rejects %s because expiry is immediate, noninteractive, and nonrecursive', (_name, fallback, field) => {
    const document = callbackDocument();
    defOf(document).choiceSet.fixed[0].callback.expiry.fallback = fallback;
    expect(paths(document)).toContain(`v3_probe@v1.choiceSet.fixed[0].callback.expiry.fallback${field === 'surprise' ? '' : '.outcome'}.${field}`);
  });

  it('defers all callback reference checks until the whole document is structurally valid', () => {
    const invalid = callbackDocument();
    delete defOf(invalid, 1).title;
    defOf(invalid).choiceSet.fixed[0].callback.eventId = 'missing_callback';

    const invalidPaths = paths(invalid);
    expect(invalidPaths).toContain('v3_probe_callback@v1.title');
    expect(invalidPaths).not.toContain('v3_probe@v1.choiceSet.fixed[0].callback.eventId');

    defOf(invalid, 1).title = 'Callback';
    expect(paths(invalid)).toContain('v3_probe@v1.choiceSet.fixed[0].callback.eventId');
  });
});

describe('schema v3 document references and runtime projection', () => {
  it('keeps weighted labels required and mono-type runtime snapshots structurally typed', () => {
    expectTypeOf<EventWeightedBranchV3['label']>().toEqualTypeOf<string>();
    expectTypeOf<NonNullable<EventBoundSubjectsV3['mono_type']>>().toEqualTypeOf<
      | { readonly typeKind: 'weapon'; readonly type: WeaponType }
      | { readonly typeKind: 'element'; readonly type: Element }
    >();

    const snapshots: EventBoundSubjectsV3[] = [
      { enemy_id: 'giant_rat', mono_type: { typeKind: 'weapon', type: 'bow' } },
      { destination_biome: 'arrowfell', mono_type: { typeKind: 'element', type: 'frost' } },
    ];
    expect(snapshots.map((snapshot) => snapshot.mono_type)).toEqual([
      { typeKind: 'weapon', type: 'bow' },
      { typeKind: 'element', type: 'frost' },
    ]);
  });

  it('loads a public mixed-wrapper document into the precise runtime union', async () => {
    const { loadEventContent, requireLegacyEventContent } = await import('../../src/data/eventsContent');
    const resolvedWrappers = [
      { version: 1, schemaVersion: 1, def: v1Definition('Historical v1') as EventDefinitionPayloadV1 },
      { version: 2, schemaVersion: 2, def: v2Definition('Historical v2') as EventDefinitionPayloadV2 },
      { version: 3, schemaVersion: 3, def: definition() as EventDefinitionPayloadV3 },
    ] as const satisfies readonly ResolvedEventVersionWrapper[];
    const mixedDocument = {
      schemaVersion: 3,
      storyStateSchema: storyStateSchema() as StoryStateSchemaV3,
      events: [
        {
          id: 'mixed_probe',
          versions: [resolvedWrappers[0], resolvedWrappers[1], { version: 3, def: definition() as EventDefinitionPayloadV3 }],
        },
        {
          id: 'legacy_current',
          versions: [{ version: 1, schemaVersion: 2, def: v2Definition('Current v2') as EventDefinitionPayloadV2 }],
        },
      ],
    } satisfies EventContentDocumentV3;
    const publicDocument: EventContentDocument = mixedDocument;

    expect(validateEventDocument(publicDocument)).toEqual([]);
    const loaded = loadEventContent(mixedDocument);
    expectTypeOf(loaded).toEqualTypeOf<LoadedEventContent<LoadedEventDef>>();
    expectTypeOf<(typeof resolvedWrappers)[number]['schemaVersion']>().toEqualTypeOf<1 | 2 | 3>();
    expect(isEventDefV3(loaded.versions.mixed_probe![1]!)).toBe(false);
    expect(isEventDefV3(loaded.versions.mixed_probe![2]!)).toBe(false);
    expect(isEventDefV3(loaded.versions.mixed_probe![3]!)).toBe(true);
    expect(isEventDefV3(loaded.catalog.mixed_probe!)).toBe(true);
    expect(isEventDefV3(loaded.catalog.legacy_current!)).toBe(false);
    expect(() => requireLegacyEventContent(loaded)).toThrow(/schema-v3 definition/);

    const opaqueDocument: unknown = mixedDocument;
    expectTypeOf(loadEventContent(opaqueDocument)).toEqualTypeOf<LoadedEventContent<LoadedEventDef>>();

    const allV3Document: AllV3EventContentDocument = {
      schemaVersion: 3,
      storyStateSchema: storyStateSchema() as StoryStateSchemaV3,
      events: [{
        id: 'v3_probe',
        versions: [{ version: 1, def: definition() as EventDefinitionPayloadV3 }],
      }],
    };
    const allV3Loaded: LoadedEventContent<LoadedEventDefV3> = loadEventContent(allV3Document);
    expectTypeOf(allV3Loaded).toEqualTypeOf<LoadedEventContent<LoadedEventDefV3>>();
  });

  it('reports caller-supplied validation failures without naming a schema-specific file', async () => {
    const { loadEventContent } = await import('../../src/data/eventsContent');
    const invalid = v3Document();
    delete defOf(invalid).rarity;
    let message = '';
    try {
      loadEventContent(invalid);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toMatch(/^event content document failed validation/);
    expect(message).not.toContain('events.v2.json');
  });

  it('validates event.choice references and dependency cycles after structure passes', () => {
    const missingEvent = documentWithEligibility({ fact: 'event.choice', args: { eventId: 'missing_event' } });
    expect(paths(missingEvent)).toContain('v3_probe@v1.eligibility.args.eventId');

    const missingChoice = documentWithEligibility({ fact: 'event.choice', args: { eventId: 'source_event', choiceIds: ['missing_choice'] } });
    expect(paths(missingChoice)).toContain('v3_probe@v1.eligibility.args.choiceIds[0]');

    const cycle = documentWithEligibility({ fact: 'event.choice', args: { eventId: 'source_event' } });
    defOf(cycle).eligibility = { fact: 'event.choice', args: { eventId: 'v3_probe' } };
    expect(validateEventDocument(cycle).some((problem) => problem.message.includes('cycle'))).toBe(true);
  });

  it('projects only the v3 runtime contract plus its discriminator and deep-freezes it', async () => {
    const { loadEventContent } = await import('../../src/data/eventsContent');
    const source = v3Document();
    source.events[0].versions[0].schemaVersion = 3;
    const loaded = loadEventContent(source);
    const projected = loaded.catalog.v3_probe as unknown as JsonRecord;

    expect(isEventDefV3(loaded.catalog.v3_probe!)).toBe(true);
    expect(projected).toStrictEqual({
      id: 'v3_probe',
      ...definition(),
      contentSchemaVersion: 3,
    });
    expect(Object.isFrozen(projected)).toBe(true);
    expect(Object.isFrozen(projected.choiceSet)).toBe(true);
    expect(Object.isFrozen(projected.choiceSet.pool.entries[0].outcome.branches)).toBe(true);
  });
});
