import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadedEventCatalogFromJson } from '../../src/data/eventsContent';
import { validateEventDocument } from '../../src/data/validateEventContent';
import { compileEventPacks, serializeEventPackAggregate } from '../../scripts/eventPackCompiler';

type JsonRecord = Record<string, any>;

const PACK_DIRECTORY = new URL('../../src/data/content/event-packs/', import.meta.url);
const GENERATED_V3 = new URL('../../src/data/content/events.v3.json', import.meta.url);
const FROZEN_V2 = new URL('../../src/data/content/events.v2.json', import.meta.url);
const GENERATED_WIKI = new URL('../../docs/generated/event-catalog.md', import.meta.url);

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

const PACK_IDS = {
  '100-global-payoffs.json': ['gilded_detour', 'victors_table', 'bitter_rematch'],
  '110-global-chains.json': [
    'last_light_at_roads_end', 'last_light_secret_route',
    'mirror_of_the_board', 'mirror_transformation',
    'card_that_remembered', 'signature_card_capstone',
    'cartographers_missing_road', 'missing_road_destination',
  ],
} as const;

const NEW_IDS = Object.values(PACK_IDS).flat();
const ALL_ARCHETYPES = ['offense', 'defensive', 'healing', 'support', 'debuff'] as const;

const AFFINITY_GEM_CASES = [
  { when: { typeKind: 'weapon', type: 'sword' }, filter: [{ ids: ['follow_through_echo', 'bramble_sliver', 'iron_bulwark_echo'] }] },
  { when: { typeKind: 'weapon', type: 'axe' }, filter: [{ ids: ['armor_break_echo', 'shield_splitter_echo', 'rending_sliver'] }] },
  { when: { typeKind: 'weapon', type: 'lance' }, filter: [{ ids: ['ward_of_silence_echo', 'millstone_sliver', 'crippling_strike_echo'] }] },
  { when: { typeKind: 'weapon', type: 'bow' }, filter: [{ ids: ['concussive_shot_echo', 'weak_point_sliver', 'swift_charm'] }] },
  { when: { typeKind: 'weapon', type: 'beast' }, filter: [{ ids: ['venom_fang_echo', 'leeching_fang_echo', 'battle_howl_echo'] }] },
  { when: { typeKind: 'element', type: 'fire' }, filter: [{ ids: ['fireball_echo', 'empowering_core', 'mana_ward_echo'] }] },
  { when: { typeKind: 'element', type: 'frost' }, filter: [{ ids: ['frost_ward_echo', 'mana_ward_echo', 'time_crystal_echo'] }] },
  { when: { typeKind: 'element', type: 'lightning' }, filter: [{ ids: ['time_crystal_echo', 'battle_howl_echo', 'quickening_sliver'] }] },
  { when: { typeKind: 'element', type: 'nature' }, filter: [{ ids: ['bramble_sliver', 'second_wind_echo', 'time_crystal_echo'] }] },
  { when: { typeKind: 'element', type: 'holy' }, filter: [{ ids: ['mending_light_echo', 'purify_echo', 'ward_of_silence_echo'] }] },
  { when: { typeKind: 'element', type: 'dark' }, filter: [{ ids: ['hex_of_frailty_echo', 'blunting_sliver', 'slow_hex_echo'] }] },
] as const;

const AFFINITY_GEM_OUTCOME = {
  kind: 'gemChoice',
  boundSubject: { slot: 'mono_type', cases: AFFINITY_GEM_CASES },
} as const;

const DYNAMIC_MONO_UPGRADE = {
  kind: 'upgradeCardTargeted',
  target: { boundSubject: { slot: 'mono_type' } },
  fallback: { kind: 'grantGold', amount: 2 },
} as const;

const CHOICE_MANIFEST = {
  gilded_detour: {
    fixed: [
      { id: 'keep_fortune', cost: 0, outcome: { kind: 'nothing' }, mutations: [], callback: null },
    ],
    pool: {
      draw: 1,
      entries: [
        { id: 'buy_gold_upgrade', cost: 8, outcome: { kind: 'upgradeCard' }, mutations: [], callback: null },
        { id: 'buy_premium_gem', cost: 6, outcome: { kind: 'gemChoice', filter: [{ all: true }] }, mutations: [], callback: null },
      ],
    },
  },
  victors_table: {
    fixed: [
      { id: 'take_purse', cost: 0, outcome: { kind: 'grantGold', amount: 3 }, mutations: [], callback: null },
    ],
    pool: {
      draw: 1,
      entries: [
        { id: 'toast_growth', cost: 0, outcome: { kind: 'grantLevel' }, mutations: [], callback: null },
        { id: 'choose_spoils', cost: 0, outcome: { kind: 'cardChoice', filter: [{ archetypes: ALL_ARCHETYPES }], maxTier: 'bronze' }, mutations: [], callback: null },
      ],
    },
  },
  bitter_rematch: {
    fixed: [
      { id: 'spare_rival', cost: 0, outcome: { kind: 'nothing' }, mutations: [{ op: 'set', key: 'rival_spared', value: true }], callback: null },
    ],
    pool: {
      draw: 1,
      entries: [
        { id: 'honor_finisher', cost: 0, outcome: { kind: 'upgradeCardTargeted', target: { boundSubject: { slot: 'revenge_finisher_card_id' } }, fallback: { kind: 'grantGold', amount: 2 } }, mutations: [], callback: null },
        { id: 'claim_rematch_purse', cost: 0, outcome: { kind: 'grantGold', amount: 4 }, mutations: [], callback: null },
      ],
    },
  },
  last_light_at_roads_end: {
    fixed: [
      { id: 'take_healing_card', cost: 0, outcome: { kind: 'cardChoice', filter: [{ archetypes: ['healing'] }], maxTier: 'bronze' }, mutations: [], callback: null },
      { id: 'take_recovery_gold', cost: 0, outcome: { kind: 'grantGold', amount: 3 }, mutations: [], callback: null },
      { id: 'risk_last_road', cost: 0, outcome: { kind: 'grantGold', amount: 1 }, mutations: [], callback: { callbackId: 'last_light_secret_route', eventId: 'last_light_secret_route', contentVersion: 1, minDepthDelay: 2, destinationThemes: ['omen'], priority: 700, bind: [], expiry: { expiresAfterNodes: 12, fallback: 'discard' } } },
    ],
    pool: null,
  },
  last_light_secret_route: {
    fixed: [
      { id: 'take_last_cache', cost: 0, outcome: { kind: 'cardChoice', filter: [{ archetypes: ['healing'] }], maxTier: 'diamond' }, mutations: [{ op: 'completeStory', storyId: 'last_light_at_roads_end' }], callback: null },
      { id: 'walk_for_strength', cost: 0, outcome: { kind: 'grantLevel' }, mutations: [{ op: 'completeStory', storyId: 'last_light_at_roads_end' }], callback: null },
      { id: 'turn_back', cost: 0, outcome: { kind: 'nothing' }, mutations: [{ op: 'completeStory', storyId: 'last_light_at_roads_end' }], callback: null },
    ],
    pool: null,
  },
  mirror_of_the_board: {
    fixed: [
      { id: 'perfect_reflection', cost: 0, outcome: DYNAMIC_MONO_UPGRADE, mutations: [], callback: null },
      { id: 'take_affinity_gem', cost: 0, outcome: AFFINITY_GEM_OUTCOME, mutations: [], callback: null },
      { id: 'enter_mirror', cost: 0, outcome: { kind: 'grantGold', amount: 1 }, mutations: [], callback: { callbackId: 'mirror_transformation', eventId: 'mirror_transformation', contentVersion: 1, minDepthDelay: 3, destinationThemes: ['forge'], priority: 700, bind: [{ as: 'mono_type', source: 'board.monoType' }], expiry: { expiresAfterNodes: 20, fallback: 'discard' } } },
    ],
    pool: null,
  },
  mirror_transformation: {
    fixed: [
      { id: 'transform_card', cost: 0, outcome: DYNAMIC_MONO_UPGRADE, mutations: [{ op: 'completeStory', storyId: 'mirror_of_the_board' }], callback: null },
      { id: 'take_mirror_gem', cost: 0, outcome: AFFINITY_GEM_OUTCOME, mutations: [{ op: 'completeStory', storyId: 'mirror_of_the_board' }], callback: null },
      { id: 'break_mirror', cost: 0, outcome: { kind: 'nothing' }, mutations: [{ op: 'completeStory', storyId: 'mirror_of_the_board' }], callback: null },
    ],
    pool: null,
  },
  card_that_remembered: {
    fixed: [
      { id: 'awaken_capstone', cost: 0, outcome: { kind: 'grantGold', amount: 1 }, mutations: [], callback: { callbackId: 'signature_card_capstone', eventId: 'signature_card_capstone', contentVersion: 1, minDepthDelay: 2, destinationThemes: ['forge'], priority: 700, bind: [{ as: 'signature_card_id', source: 'signature.cardId' }], expiry: { expiresAfterNodes: 20, fallback: { outcome: { kind: 'grantGold', amount: 1 } } } } },
      { id: 'upgrade_signature', cost: 0, outcome: { kind: 'upgradeCardTargeted', target: { boundSubject: { slot: 'signature_card_id' } }, fallback: { kind: 'grantGold', amount: 2 } }, mutations: [], callback: null },
      { id: 'take_signature_gem', cost: 0, outcome: { kind: 'gemChoice', filter: [{ all: true }] }, mutations: [], callback: null },
    ],
    pool: null,
  },
  signature_card_capstone: {
    fixed: [
      { id: 'perfect_signature', cost: 0, outcome: { kind: 'upgradeCardTargeted', target: { boundSubject: { slot: 'signature_card_id' } }, fallback: { kind: 'grantGold', amount: 2 } }, mutations: [{ op: 'completeStory', storyId: 'card_that_remembered' }], callback: null },
      { id: 'take_answering_gem', cost: 0, outcome: { kind: 'gemChoice', filter: [{ all: true }] }, mutations: [{ op: 'completeStory', storyId: 'card_that_remembered' }], callback: null },
      { id: 'let_memory_rest', cost: 0, outcome: { kind: 'nothing' }, mutations: [{ op: 'completeStory', storyId: 'card_that_remembered' }], callback: null },
    ],
    pool: null,
  },
  cartographers_missing_road: {
    fixed: [
      { id: 'mark_missing_road', cost: 0, outcome: { kind: 'grantGold', amount: 1 }, mutations: [], callback: { callbackId: 'missing_road_destination', eventId: 'missing_road_destination', contentVersion: 1, minDepthDelay: 2, destinationThemes: ['cache'], priority: 700, bind: [{ as: 'destination_biome', source: 'journey.futureBiome', candidates: 'unvisited_catalog' }], expiry: { expiresAfterNodes: 20, fallback: 'discard' } } },
      { id: 'study_map', cost: 0, outcome: { kind: 'grantLevel' }, mutations: [], callback: null },
      { id: 'sell_map', cost: 0, outcome: { kind: 'grantGold', amount: 5 }, mutations: [], callback: null },
    ],
    pool: null,
  },
  missing_road_destination: {
    fixed: [
      { id: 'open_hidden_map', cost: 0, outcome: { kind: 'grantMapInfo', bandsAhead: 3 }, mutations: [{ op: 'completeStory', storyId: 'cartographers_missing_road' }], callback: null },
      { id: 'claim_road_cache', cost: 0, outcome: { kind: 'cardChoice', filter: [{ archetypes: ALL_ARCHETYPES }], maxTier: 'bronze' }, mutations: [{ op: 'completeStory', storyId: 'cartographers_missing_road' }], callback: null },
      { id: 'leave_road_missing', cost: 0, outcome: { kind: 'nothing' }, mutations: [{ op: 'completeStory', storyId: 'cartographers_missing_road' }], callback: null },
    ],
    pool: null,
  },
} as const;

function sha256(url: URL): string {
  return createHash('sha256').update(readFileSync(url)).digest('hex');
}

function sourceDocument(name: keyof typeof PACK_IDS): JsonRecord | undefined {
  const url = new URL(name, PACK_DIRECTORY);
  if (!existsSync(url)) return undefined;
  return JSON.parse(readFileSync(url, 'utf8')) as JsonRecord;
}

function currentDef(document: JsonRecord, id: string): JsonRecord {
  const event = document.events.find((candidate: JsonRecord) => candidate.id === id);
  if (event === undefined) throw new Error(`missing ${id}`);
  return event.versions[event.versions.length - 1].def as JsonRecord;
}

function choiceContract(entry: JsonRecord): JsonRecord {
  return {
    id: entry.id,
    cost: entry.cost,
    outcome: entry.outcome,
    mutations: entry.mutations ?? [],
    callback: entry.callback ?? null,
  };
}

function choiceSetContract(def: JsonRecord): JsonRecord {
  return {
    fixed: def.choiceSet.fixed.map(choiceContract),
    pool: def.choiceSet.pool === undefined ? null : {
      draw: def.choiceSet.pool.draw,
      entries: def.choiceSet.pool.entries.map(choiceContract),
    },
  };
}

describe('schema-v3 global event source packs', () => {
  it('compiles only the approved packs into the deterministic 66-ID live aggregate', () => {
    const compiled = compileEventPacks(PACK_DIRECTORY);
    const expectedSources = [
      '00-core.json', '10-arrowfell.json', ...Object.keys(PACK_IDS),
      '20-duskbarrow.json', '30-emberwaste.json', '40-frostmarch.json', '50-howlmoor.json',
      '60-ironmoot.json', '70-pikewold.json', '80-stormreach.json', '90-thornwild.json',
    ];
    expect(compiled.sourceFiles.map((source) => source.name)).toEqual(expectedSources);
    expect(compiled.document.schemaVersion).toBe(3);
    expect(compiled.document.storyStateSchema).toStrictEqual(STORY_STATE_V3);
    expect(compiled.document.events).toHaveLength(66);
    expect(new Set(compiled.document.events.map((event) => event.id)).size).toBe(66);
    expect(compiled.document.events.map((event) => event.id).filter((id) => NEW_IDS.includes(id as typeof NEW_IDS[number]))).toEqual(NEW_IDS);
    expect(compiled.document.events.map((event) => event.id)).not.toEqual(expect.arrayContaining([
      'unlit_reliquary', 'gate_of_oaths', 'gate_of_oaths_answer',
    ]));
    expect(readFileSync(GENERATED_V3, 'utf8')).toBe(serializeEventPackAggregate(compiled));
    expect(validateEventDocument(compiled.document)).toEqual([]);
  });

  it('repeats the exact closed eight-field story registry and owns only approved IDs', () => {
    for (const [name, ids] of Object.entries(PACK_IDS) as Array<[keyof typeof PACK_IDS, readonly string[]]>) {
      const document = sourceDocument(name);
      expect(document, `${name} must exist`).toBeDefined();
      if (document === undefined) continue;
      expect(document.schemaVersion).toBe(3);
      expect(document.storyStateSchema).toStrictEqual(STORY_STATE_V3);
      expect(document.events.map((event: JsonRecord) => event.id)).toEqual(ids);
      expect(document.events.every((event: JsonRecord) => (
        event.versions.length === 1
        && event.versions[0].version === 1
        && event.versions[0].schemaVersion === undefined
      ))).toBe(true);
      expect(validateEventDocument(document, { includeCrossEventReferences: false })).toEqual([]);
    }
  });

  it('authors exact global gates, story roles, delivery, rarity, visibility, and bindings', () => {
    const document = compileEventPacks(PACK_DIRECTORY).document as JsonRecord;
    const expected = {
      gilded_detour: ['market', 'uncommon', 'payoff', 'visible', 200, { all: [
        { fact: 'wallet.current', args: { op: 'gte', value: 15 } },
        { fact: 'run.tally', args: { stat: 'goldSpent', op: 'gte', value: 10 } },
      ] }, undefined, undefined],
      victors_table: ['recruit', 'uncommon', 'payoff', 'visible', 200, { fact: 'run.tally', args: { stat: 'wins', op: 'gte', value: 5 } }, undefined, undefined],
      bitter_rematch: ['training', 'rare', 'payoff', 'hidden_until_eligible', 300, { fact: 'combat.revengeReady', args: {} }, [
        { as: 'enemy_id', source: 'revenge.enemyId' },
        { as: 'revenge_finisher_card_id', source: 'revenge.finisherCardId', optional: true },
      ], undefined],
      last_light_at_roads_end: ['omen', 'rare', 'setup', 'hidden_until_eligible', 300, { all: [
        { fact: 'lives.current', args: { op: 'eq', value: 1 } },
        { fact: 'combat.recentLoss', args: { withinDepth: 3 } },
        { not: { fact: 'owned.card.count', args: { where: 'any', count: 1, match: { archetypes: ['healing'] } } } },
      ] }, undefined, undefined],
      last_light_secret_route: ['omen', 'secret', 'callback', 'teased_when_due', 700, { fact: 'callback.queued', args: { callbackId: 'last_light_secret_route' } }, undefined, undefined],
      mirror_of_the_board: ['forge', 'secret', 'setup', 'hidden_until_eligible', 400, { all: [
        { any: [
          { fact: 'board.isMonoType', args: { typeKind: 'weapon' } },
          { fact: 'board.isMonoType', args: { typeKind: 'element' } },
        ] },
        { fact: 'owned.card.count', args: { where: 'board', count: 1, tierAtLeast: 'gold', match: { archetypes: ALL_ARCHETYPES } } },
        { fact: 'run.tally', args: { stat: 'bossesCleared', op: 'gte', value: 1 } },
      ] }, [{ as: 'mono_type', source: 'board.monoType' }], undefined],
      mirror_transformation: ['forge', 'secret', 'callback', 'teased_when_due', 700, { fact: 'callback.queued', args: { callbackId: 'mirror_transformation' } }, undefined, ['mono_type']],
      card_that_remembered: ['omen', 'secret', 'capstone', 'hidden_until_eligible', 400, { fact: 'combat.signatureReady', args: { winsAtLeast: 3, bossFinisher: true } }, [{ as: 'signature_card_id', source: 'signature.cardId' }], undefined],
      signature_card_capstone: ['forge', 'secret', 'callback', 'teased_when_due', 700, { fact: 'callback.queued', args: { callbackId: 'signature_card_capstone' } }, undefined, ['signature_card_id']],
      cartographers_missing_road: ['market', 'rare', 'setup', 'hidden_until_eligible', 300, { all: [
        { fact: 'journey.visitedBiomes', args: { op: 'gte', value: 3 } },
        { fact: 'journey.completedChains', args: { op: 'gte', value: 2 } },
      ] }, [{ as: 'destination_biome', source: 'journey.futureBiome', candidates: 'unvisited_catalog' }], undefined],
      missing_road_destination: ['cache', 'rare', 'callback', 'teased_when_due', 700, { fact: 'callback.queued', args: { callbackId: 'missing_road_destination' } }, undefined, ['destination_biome']],
    } as const;

    for (const [id, [theme, rarity, stage, visibility, priority, eligibility, bindings, acceptsBindings]] of Object.entries(expected)) {
      const def = currentDef(document, id);
      const storyId = ({
        last_light_secret_route: 'last_light_at_roads_end',
        mirror_transformation: 'mirror_of_the_board',
        signature_card_capstone: 'card_that_remembered',
        missing_road_destination: 'cartographers_missing_road',
      } as Record<string, string>)[id] ?? id;
      expect({
        theme: def.theme, rarity: def.rarity, biomeIds: def.biomeIds,
        story: def.story, delivery: def.delivery, visibility: def.visibility,
        priority: def.priority, once: def.once, cooldownNodes: def.cooldownNodes,
        eligibility: def.eligibility, bindings: def.bindings, acceptsBindings: def.acceptsBindings,
      }, id).toStrictEqual({
        theme, rarity, biomeIds: undefined,
        story: { storyId, stage, role: stage },
        delivery: { kind: stage === 'callback' ? 'queued_callback' : 'ambient' },
        visibility, priority, once: 'run', cooldownNodes: 0,
        eligibility, bindings, acceptsBindings,
      });
    }
  });

  it('locks every fixed/pool choice, cost, outcome, mutation, and callback exactly', () => {
    const document = compileEventPacks(PACK_DIRECTORY).document as JsonRecord;
    expect(Object.keys(CHOICE_MANIFEST)).toEqual(NEW_IDS);
    for (const [eventId, expected] of Object.entries(CHOICE_MANIFEST)) {
      expect(choiceSetContract(currentDef(document, eventId)), eventId).toStrictEqual(expected);
    }
  });

  it('uses fixed three-choice chains and fixed-safe plus one-of-two global payoff pools', () => {
    const document = compileEventPacks(PACK_DIRECTORY).document as JsonRecord;
    for (const id of [
      'last_light_at_roads_end', 'last_light_secret_route', 'mirror_of_the_board',
      'mirror_transformation', 'card_that_remembered', 'signature_card_capstone',
      'cartographers_missing_road', 'missing_road_destination',
    ]) {
      const choiceSet = currentDef(document, id).choiceSet;
      expect(choiceSet.fixed).toHaveLength(3);
      expect(choiceSet.pool).toBeUndefined();
    }
    for (const [id, safe] of [
      ['gilded_detour', 'keep_fortune'],
      ['victors_table', 'take_purse'],
      ['bitter_rematch', 'spare_rival'],
    ] as const) {
      const choiceSet = currentDef(document, id).choiceSet;
      expect(choiceSet.fixed.map((entry: JsonRecord) => entry.id)).toEqual([safe]);
      expect(choiceSet.pool).toMatchObject({ draw: 1 });
      expect(choiceSet.pool.entries).toHaveLength(2);
    }
  });

  it('validates the closed dynamic mono upgrade and exhaustive JSON-owned affinity selector', () => {
    const source = sourceDocument('110-global-chains.json');
    expect(source).toBeDefined();
    if (source === undefined) return;
    expect(validateEventDocument(source, { includeCrossEventReferences: false })).toEqual([]);

    const mutate = (change: (outcome: JsonRecord) => void): JsonRecord => {
      const copy = structuredClone(source);
      const outcome = currentDef(copy, 'mirror_of_the_board').choiceSet.fixed[1].outcome;
      change(outcome);
      return copy;
    };
    const mixed = mutate((outcome) => { outcome.filter = [{ all: true }]; });
    const duplicate = mutate((outcome) => { outcome.boundSubject.cases[10] = structuredClone(outcome.boundSubject.cases[0]); });
    const missing = mutate((outcome) => { outcome.boundSubject.cases.pop(); });
    const unknown = mutate((outcome) => { outcome.boundSubject.cases[0].when.type = 'hammer'; });
    const extra = mutate((outcome) => { outcome.boundSubject.cases[0].when.extra = true; });

    for (const [name, document] of Object.entries({ mixed, duplicate, missing, unknown, extra })) {
      expect(validateEventDocument(document, { includeCrossEventReferences: false }), name).not.toEqual([]);
    }
  });

  it('keeps frozen V2 byte-identical while live V3 and the wiki expose the approved definitions', () => {
    expect(sha256(FROZEN_V2)).toBe('5d6e14f0edead7f18606116af5d5800edb1590bbf5b2b3a6db3905fb9e9cbd7a');
    expect(Object.keys(loadedEventCatalogFromJson)).toHaveLength(66);
    const wiki = readFileSync(GENERATED_WIKI, 'utf8');
    for (const id of NEW_IDS) {
      expect(loadedEventCatalogFromJson[id]).toBeDefined();
      expect(wiki).toContain(`## \`${id}\` · current version`);
    }
    expect(wiki).toContain('Live runtime selection uses the validated current `src/data/content/events.v3.json` aggregate.');
  });
});
