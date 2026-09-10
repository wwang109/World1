import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadEventContent, loadedEventCatalogFromJson } from '../../src/data/eventsContent';
import { validateEventDocument } from '../../src/data/validateEventContent';
import { compileEventPacks, serializeEventPackAggregate } from '../../scripts/eventPackCompiler';
import liveEventsV2 from '../../src/data/content/events.v2.json';

type JsonRecord = Record<string, any>;

const PACK_DIRECTORY = new URL('../../src/data/content/event-packs/', import.meta.url);
const GENERATED_V3 = new URL('../../src/data/content/events.v3.json', import.meta.url);
const FROZEN_V2 = new URL('../../src/data/content/events.v2.json', import.meta.url);
const GENERATED_WIKI = new URL('../../docs/generated/event-catalog.md', import.meta.url);
const FROZEN_V2_SHA256 = '5d6e14f0edead7f18606116af5d5800edb1590bbf5b2b3a6db3905fb9e9cbd7a';

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
  '20-duskbarrow.json': ['names_under_stone', 'names_under_stone_answer'],
  '30-emberwaste.json': ['cinderheart_crucible'],
  '40-frostmarch.json': ['whiteout_pilgrim', 'whiteout_guidance'],
  '50-howlmoor.json': ['moon_scented_trail', 'moon_scented_hunt'],
  '60-ironmoot.json': ['red_standard'],
  '70-pikewold.json': ['last_hedge'],
  '80-stormreach.json': ['thunder_in_a_bottle'],
  '90-thornwild.json': ['bloom_behind_the_teeth'],
} as const;

const NEW_IDS = Object.values(PACK_IDS).flat();

const CHOICE_MANIFEST = {
  names_under_stone: {
    fixed: [
      { id: 'raise_dark_name', cost: 0, outcome: { kind: 'upgradeCardTargeted', target: { filter: { where: 'any', match: { elements: ['dark'] } } }, fallback: { kind: 'grantGold', amount: 2 } }, mutations: [], callback: null },
      { id: 'take_grave_silver', cost: 0, outcome: { kind: 'grantGold', amount: 4 }, mutations: [{ op: 'set', key: 'grave_path', value: 'opened' }], callback: { callbackId: 'names_under_stone_answer', eventId: 'names_under_stone_answer', contentVersion: 1, minDepthDelay: 3, destinationThemes: ['omen'], priority: 700, bind: [], expiry: { expiresAfterNodes: 20, fallback: 'discard' } } },
      { id: 'leave', cost: 0, outcome: { kind: 'nothing' }, mutations: [], callback: null },
    ],
    pool: null,
  },
  names_under_stone_answer: {
    fixed: [
      { id: 'answer_name', cost: 0, outcome: { kind: 'cardChoice', filter: [{ elements: ['dark'] }], maxTier: 'bronze' }, mutations: [{ op: 'set', key: 'grave_path', value: 'answered' }, { op: 'completeStory', storyId: 'names_under_stone' }], callback: null },
      { id: 'take_silver', cost: 0, outcome: { kind: 'grantGold', amount: 3 }, mutations: [{ op: 'completeStory', storyId: 'names_under_stone' }], callback: null },
      { id: 'close_stone', cost: 0, outcome: { kind: 'nothing' }, mutations: [{ op: 'completeStory', storyId: 'names_under_stone' }], callback: null },
    ],
    pool: null,
  },
  cinderheart_crucible: {
    fixed: [
      { id: 'bank_cinders', cost: 0, outcome: { kind: 'grantGold', amount: 3 }, mutations: [], callback: null },
    ],
    pool: {
      draw: 1,
      entries: [
        { id: 'temper_fire_card', cost: 0, outcome: { kind: 'upgradeCardTargeted', target: { filter: { where: 'any', match: { elements: ['fire'] } } }, fallback: { kind: 'grantGold', amount: 2 } }, mutations: [], callback: null },
        { id: 'choose_fire_gem', cost: 0, outcome: { kind: 'gemChoice', filter: [{ actionKinds: ['burn'] }, { ids: ['empowering_core', 'mana_ward_echo'] }] }, mutations: [], callback: null },
      ],
    },
  },
  whiteout_pilgrim: {
    fixed: [
      { id: 'share_white_road', cost: 0, outcome: { kind: 'cardChoice', filter: [{ elements: ['frost'] }], maxTier: 'bronze' }, mutations: [], callback: { callbackId: 'whiteout_guidance', eventId: 'whiteout_guidance', contentVersion: 1, minDepthDelay: 2, destinationThemes: ['training'], destinationBiomeIds: ['frostmarch'], priority: 700, bind: [], expiry: { expiresAfterNodes: 12, fallback: 'discard' } } },
      { id: 'take_ward', cost: 0, outcome: { kind: 'gemChoice', filter: [{ actionKinds: ['shield', 'guard', 'ward'] }] }, mutations: [], callback: null },
      { id: 'leave', cost: 0, outcome: { kind: 'nothing' }, mutations: [], callback: null },
    ],
    pool: null,
  },
  whiteout_guidance: {
    fixed: [
      { id: 'take_guidance', cost: 0, outcome: { kind: 'grantMapInfo', bandsAhead: 2 }, mutations: [{ op: 'completeStory', storyId: 'whiteout_pilgrim' }], callback: null },
      { id: 'take_ward', cost: 0, outcome: { kind: 'gemChoice', filter: [{ actionKinds: ['shield', 'guard', 'ward'] }] }, mutations: [{ op: 'completeStory', storyId: 'whiteout_pilgrim' }], callback: null },
      { id: 'walk_unaided', cost: 0, outcome: { kind: 'nothing' }, mutations: [{ op: 'completeStory', storyId: 'whiteout_pilgrim' }], callback: null },
    ],
    pool: null,
  },
  moon_scented_trail: {
    fixed: [
      { id: 'follow_hunt', cost: 0, outcome: { kind: 'cardChoice', filter: [{ weapons: ['beast'] }], maxTier: 'bronze' }, mutations: [], callback: { callbackId: 'moon_scented_hunt', eventId: 'moon_scented_hunt', contentVersion: 1, minDepthDelay: 3, destinationThemes: ['recruit'], destinationBiomeIds: ['howlmoor'], priority: 700, bind: [], expiry: { expiresAfterNodes: 15, fallback: 'discard' } } },
      { id: 'take_trophy', cost: 0, outcome: { kind: 'gemChoice', filter: [{ ids: ['battle_howl_echo', 'leeching_fang_echo', 'bloodscent_sliver'] }] }, mutations: [], callback: null },
      { id: 'leave', cost: 0, outcome: { kind: 'nothing' }, mutations: [], callback: null },
    ],
    pool: null,
  },
  moon_scented_hunt: {
    fixed: [
      { id: 'finish_hunt', cost: 0, outcome: { kind: 'upgradeCardTargeted', target: { filter: { where: 'any', match: { weapons: ['beast'] } } }, fallback: { kind: 'grantGold', amount: 2 } }, mutations: [{ op: 'completeStory', storyId: 'moon_scented_trail' }], callback: null },
      { id: 'share_quarry', cost: 0, outcome: { kind: 'gemChoice', filter: [{ ids: ['battle_howl_echo', 'leeching_fang_echo', 'bloodscent_sliver'] }] }, mutations: [{ op: 'completeStory', storyId: 'moon_scented_trail' }], callback: null },
      { id: 'release_quarry', cost: 0, outcome: { kind: 'nothing' }, mutations: [{ op: 'set', key: 'moon_quarry_released', value: true }, { op: 'completeStory', storyId: 'moon_scented_trail' }], callback: null },
    ],
    pool: null,
  },
  red_standard: {
    fixed: [
      { id: 'sell_standard', cost: 0, outcome: { kind: 'grantGold', amount: 3 }, mutations: [], callback: null },
    ],
    pool: {
      draw: 1,
      entries: [
        { id: 'claim_axe_draft', cost: 0, outcome: { kind: 'bonusDraft', filter: [{ weapons: ['axe'] }] }, mutations: [], callback: null },
        { id: 'hone_axe', cost: 0, outcome: { kind: 'upgradeCardTargeted', target: { filter: { where: 'any', match: { weapons: ['axe'] } } }, fallback: { kind: 'grantGold', amount: 2 } }, mutations: [], callback: null },
      ],
    },
  },
  last_hedge: {
    fixed: [
      { id: 'take_lance_lesson', cost: 0, outcome: { kind: 'cardChoice', filter: [{ weapons: ['lance'] }], maxTier: 'bronze' }, mutations: [], callback: null },
      { id: 'take_hedge_ward', cost: 0, outcome: { kind: 'gemChoice', filter: [{ actionKinds: ['shield', 'guard', 'ward'] }] }, mutations: [], callback: null },
      { id: 'drill_then_leave', cost: 0, outcome: { kind: 'grantLevel' }, mutations: [], callback: null },
    ],
    pool: null,
  },
  thunder_in_a_bottle: {
    fixed: [
      { id: 'sell_storm', cost: 0, outcome: { kind: 'grantGold', amount: 4 }, mutations: [], callback: null },
    ],
    pool: {
      draw: 1,
      entries: [
        { id: 'socket_thunder', cost: 0, outcome: { kind: 'gemChoice', filter: [{ actionKinds: ['slow'] }, { ids: ['time_crystal_echo'] }] }, mutations: [], callback: null },
        { id: 'teach_the_card', cost: 0, outcome: { kind: 'upgradeCardTargeted', target: { filter: { where: 'any', match: { elements: ['lightning'] } } }, fallback: { kind: 'grantGold', amount: 2 } }, mutations: [], callback: null },
      ],
    },
  },
  bloom_behind_the_teeth: {
    fixed: [
      { id: 'harvest_venom', cost: 0, outcome: { kind: 'gemChoice', filter: [{ actionKinds: ['poison'] }, { ids: ['festering_sliver'] }] }, mutations: [], callback: null },
      { id: 'cultivate_bloom', cost: 0, outcome: { kind: 'upgradeCardTargeted', target: { filter: { where: 'any', match: { elements: ['nature'] } } }, fallback: { kind: 'grantGold', amount: 2 } }, mutations: [{ op: 'set', key: 'venom_bloom', value: 'cultivated' }], callback: null },
      { id: 'leave', cost: 0, outcome: { kind: 'nothing' }, mutations: [], callback: null },
    ],
    pool: null,
  },
} as const;

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

function choice(def: JsonRecord, id: string): JsonRecord {
  const choices = [...def.choiceSet.fixed, ...(def.choiceSet.pool?.entries ?? [])] as JsonRecord[];
  const found = choices.find((candidate) => candidate.id === id);
  if (found === undefined) throw new Error(`missing choice ${id}`);
  return found;
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

describe('schema-v3 biome event source packs', () => {
  it('retains the eight approved biome packs in the deterministic 66-ID current aggregate', () => {
    const compiled = compileEventPacks(PACK_DIRECTORY);
    const expectedSources = [
      '00-core.json', '10-arrowfell.json', '100-global-payoffs.json', '110-global-chains.json',
      ...Object.keys(PACK_IDS),
    ];
    const generatedBytes = readFileSync(GENERATED_V3, 'utf8');

    expect(compiled.sourceFiles.map((source) => source.name)).toEqual(expectedSources);
    expect(compiled.document.schemaVersion).toBe(3);
    expect(compiled.document.storyStateSchema).toStrictEqual(STORY_STATE_V3);
    expect(compiled.document.events).toHaveLength(66);
    expect(new Set(compiled.document.events.map((event) => event.id)).size).toBe(66);
    expect(compiled.document.events.slice(-NEW_IDS.length).map((event) => event.id)).toEqual(NEW_IDS);
    expect(generatedBytes).toBe(serializeEventPackAggregate(compiled));
    expect(validateEventDocument(compiled.document)).toEqual([]);
  });

  it('repeats the exact closed eight-field story registry and owns only the approved IDs', () => {
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

  it('authors exact biome, story, rarity, visibility, priority, and eligibility facts', () => {
    const document = compileEventPacks(PACK_DIRECTORY).document as JsonRecord;
    const expected = {
      names_under_stone: ['omen', 'rare', ['duskbarrow'], 'setup', 'hidden_until_eligible', 300, { all: [
        { fact: 'combat.biomeBossDefeated', args: { biomeId: 'duskbarrow' } },
        { fact: 'owned.card.count', args: { where: 'any', count: 1, match: { elements: ['dark'] } } },
      ] }],
      names_under_stone_answer: ['omen', 'rare', undefined, 'callback', 'teased_when_due', 700, { fact: 'callback.queued', args: { callbackId: 'names_under_stone_answer' } }],
      cinderheart_crucible: ['forge', 'rare', ['emberwaste'], 'payoff', 'hidden_until_eligible', 300, { any: [
        { fact: 'owned.card.count', args: { where: 'any', count: 1, tierAtLeast: 'gold', match: { elements: ['fire'] } } },
        { fact: 'combat.statusUsed', args: { status: 'burn', result: 'bossWin', biomeId: 'emberwaste' } },
      ] }],
      whiteout_pilgrim: ['training', 'uncommon', ['frostmarch'], 'setup', 'visible', 200, { fact: 'combat.affinityWin', args: { affinityId: 'frost', atLeast: 1, biomeId: 'frostmarch' } }],
      whiteout_guidance: ['training', 'uncommon', ['frostmarch'], 'callback', 'teased_when_due', 700, { fact: 'callback.queued', args: { callbackId: 'whiteout_guidance' } }],
      moon_scented_trail: ['recruit', 'uncommon', ['howlmoor'], 'setup', 'visible', 200, { any: [
        { fact: 'board.affinity', args: { affinityId: 'beast' } },
        { fact: 'combat.enemyDefeated', args: { weaponAffinity: 'beast', atLeast: 3 } },
      ] }],
      moon_scented_hunt: ['recruit', 'rare', ['howlmoor'], 'callback', 'teased_when_due', 700, { fact: 'callback.queued', args: { callbackId: 'moon_scented_hunt' } }],
      red_standard: ['training', 'rare', ['ironmoot'], 'payoff', 'hidden_until_eligible', 300, { fact: 'combat.affinityWin', args: { affinityId: 'axe', atLeast: 3, biomeId: 'ironmoot' } }],
      last_hedge: ['training', 'uncommon', ['pikewold'], 'setup', 'visible', 200, { all: [
        { fact: 'owned.card.count', args: { where: 'any', count: 1, match: { weapons: ['lance'] } } },
        { fact: 'owned.card.count', args: { where: 'any', count: 1, match: { archetypes: ['defensive'] } } },
      ] }],
      thunder_in_a_bottle: ['cache', 'rare', ['stormreach'], 'payoff', 'hidden_until_eligible', 300, { fact: 'combat.fastWin', args: { maxTurns: 8, element: 'lightning' } }],
      bloom_behind_the_teeth: ['cache', 'secret', ['thornwild'], 'capstone', 'hidden_until_eligible', 400, { all: [
        { fact: 'combat.statusUsed', args: { status: 'poison', result: 'bossWin', biomeId: 'thornwild' } },
        { fact: 'board.affinity', args: { affinityId: 'nature' } },
      ] }],
    } as const;

    for (const [id, [theme, rarity, biomeIds, stage, visibility, priority, eligibility]] of Object.entries(expected)) {
      const def = currentDef(document, id);
      expect({
        theme: def.theme, rarity: def.rarity, biomeIds: def.biomeIds,
        story: def.story, delivery: def.delivery, visibility: def.visibility,
        priority: def.priority, once: def.once, cooldownNodes: def.cooldownNodes,
        eligibility: def.eligibility,
      }, id).toStrictEqual({
        theme, rarity, biomeIds,
        story: { storyId: stage === 'callback' ? ({
          names_under_stone_answer: 'names_under_stone',
          whiteout_guidance: 'whiteout_pilgrim',
          moon_scented_hunt: 'moon_scented_trail',
        } as Record<string, string>)[id] : id, stage, role: stage },
        delivery: { kind: stage === 'callback' ? 'queued_callback' : 'ambient' },
        visibility, priority, once: 'run', cooldownNodes: 0, eligibility,
      });
    }
  });

  it('keeps chain doors fixed and uses one seeded reward option only for non-callback payoffs', () => {
    const document = compileEventPacks(PACK_DIRECTORY).document as JsonRecord;
    for (const id of ['names_under_stone', 'names_under_stone_answer', 'whiteout_pilgrim', 'whiteout_guidance', 'moon_scented_trail', 'moon_scented_hunt', 'last_hedge', 'bloom_behind_the_teeth']) {
      expect(currentDef(document, id).choiceSet).toMatchObject({ fixed: expect.any(Array) });
      expect(currentDef(document, id).choiceSet.fixed).toHaveLength(3);
      expect(currentDef(document, id).choiceSet.pool).toBeUndefined();
    }
    for (const [id, safeChoice] of [
      ['cinderheart_crucible', 'bank_cinders'],
      ['red_standard', 'sell_standard'],
      ['thunder_in_a_bottle', 'sell_storm'],
    ] as const) {
      const choiceSet = currentDef(document, id).choiceSet;
      expect(choiceSet.fixed.map((entry: JsonRecord) => entry.id)).toEqual([safeChoice]);
      expect(choiceSet.pool.draw).toBe(1);
      expect(choiceSet.pool.entries).toHaveLength(2);
    }
  });

  it('binds every stable ordered choice ID, zero cost, typed outcome, mutation, and callback exactly', () => {
    const document = compileEventPacks(PACK_DIRECTORY).document as JsonRecord;
    const outcome = (eventId: string, choiceId: string) => choice(currentDef(document, eventId), choiceId).outcome;
    const mutations = (eventId: string, choiceId: string) => choice(currentDef(document, eventId), choiceId).mutations;

    expect(Object.keys(CHOICE_MANIFEST)).toEqual(NEW_IDS);
    for (const [eventId, expected] of Object.entries(CHOICE_MANIFEST)) {
      expect(choiceSetContract(currentDef(document, eventId)), eventId).toStrictEqual(expected);
    }

    expect(outcome('names_under_stone', 'raise_dark_name')).toStrictEqual({ kind: 'upgradeCardTargeted', target: { filter: { where: 'any', match: { elements: ['dark'] } } }, fallback: { kind: 'grantGold', amount: 2 } });
    expect(outcome('names_under_stone', 'take_grave_silver')).toStrictEqual({ kind: 'grantGold', amount: 4 });
    expect(mutations('names_under_stone', 'take_grave_silver')).toStrictEqual([{ op: 'set', key: 'grave_path', value: 'opened' }]);
    expect(choice(currentDef(document, 'names_under_stone'), 'take_grave_silver').callback).toStrictEqual({ callbackId: 'names_under_stone_answer', eventId: 'names_under_stone_answer', contentVersion: 1, minDepthDelay: 3, destinationThemes: ['omen'], priority: 700, bind: [], expiry: { expiresAfterNodes: 20, fallback: 'discard' } });
    expect(outcome('names_under_stone_answer', 'answer_name')).toStrictEqual({ kind: 'cardChoice', filter: [{ elements: ['dark'] }], maxTier: 'bronze' });
    expect(outcome('names_under_stone_answer', 'take_silver')).toStrictEqual({ kind: 'grantGold', amount: 3 });

    expect(outcome('cinderheart_crucible', 'temper_fire_card')).toStrictEqual({ kind: 'upgradeCardTargeted', target: { filter: { where: 'any', match: { elements: ['fire'] } } }, fallback: { kind: 'grantGold', amount: 2 } });
    expect(outcome('cinderheart_crucible', 'choose_fire_gem')).toStrictEqual({ kind: 'gemChoice', filter: [{ actionKinds: ['burn'] }, { ids: ['empowering_core', 'mana_ward_echo'] }] });
    expect(outcome('cinderheart_crucible', 'bank_cinders')).toStrictEqual({ kind: 'grantGold', amount: 3 });

    expect(outcome('whiteout_pilgrim', 'share_white_road')).toStrictEqual({ kind: 'cardChoice', filter: [{ elements: ['frost'] }], maxTier: 'bronze' });
    expect(choice(currentDef(document, 'whiteout_pilgrim'), 'share_white_road').callback).toMatchObject({ callbackId: 'whiteout_guidance', contentVersion: 1, minDepthDelay: 2, destinationThemes: ['training'], destinationBiomeIds: ['frostmarch'], priority: 700, bind: [], expiry: { expiresAfterNodes: 12, fallback: 'discard' } });
    expect(outcome('whiteout_guidance', 'take_guidance')).toStrictEqual({ kind: 'grantMapInfo', bandsAhead: 2 });

    const protective = { kind: 'gemChoice', filter: [{ actionKinds: ['shield', 'guard', 'ward'] }] };
    expect(outcome('whiteout_pilgrim', 'take_ward')).toStrictEqual(protective);
    expect(outcome('whiteout_guidance', 'take_ward')).toStrictEqual(protective);

    const beastGems = { kind: 'gemChoice', filter: [{ ids: ['battle_howl_echo', 'leeching_fang_echo', 'bloodscent_sliver'] }] };
    expect(outcome('moon_scented_trail', 'follow_hunt')).toStrictEqual({ kind: 'cardChoice', filter: [{ weapons: ['beast'] }], maxTier: 'bronze' });
    expect(outcome('moon_scented_trail', 'take_trophy')).toStrictEqual(beastGems);
    expect(choice(currentDef(document, 'moon_scented_trail'), 'follow_hunt').callback).toMatchObject({ callbackId: 'moon_scented_hunt', contentVersion: 1, minDepthDelay: 3, destinationThemes: ['recruit'], destinationBiomeIds: ['howlmoor'], priority: 700, bind: [], expiry: { expiresAfterNodes: 15, fallback: 'discard' } });
    expect(outcome('moon_scented_hunt', 'finish_hunt')).toStrictEqual({ kind: 'upgradeCardTargeted', target: { filter: { where: 'any', match: { weapons: ['beast'] } } }, fallback: { kind: 'grantGold', amount: 2 } });
    expect(outcome('moon_scented_hunt', 'share_quarry')).toStrictEqual(beastGems);
    expect(mutations('moon_scented_hunt', 'release_quarry')).toStrictEqual([{ op: 'set', key: 'moon_quarry_released', value: true }, { op: 'completeStory', storyId: 'moon_scented_trail' }]);

    expect(outcome('red_standard', 'claim_axe_draft')).toStrictEqual({ kind: 'bonusDraft', filter: [{ weapons: ['axe'] }] });
    expect(outcome('red_standard', 'hone_axe')).toStrictEqual({ kind: 'upgradeCardTargeted', target: { filter: { where: 'any', match: { weapons: ['axe'] } } }, fallback: { kind: 'grantGold', amount: 2 } });
    expect(outcome('red_standard', 'sell_standard')).toStrictEqual({ kind: 'grantGold', amount: 3 });

    expect(outcome('last_hedge', 'take_lance_lesson')).toStrictEqual({ kind: 'cardChoice', filter: [{ weapons: ['lance'] }], maxTier: 'bronze' });
    expect(outcome('last_hedge', 'take_hedge_ward')).toStrictEqual({ kind: 'gemChoice', filter: [{ actionKinds: ['shield', 'guard', 'ward'] }] });
    expect(outcome('last_hedge', 'drill_then_leave')).toStrictEqual({ kind: 'grantLevel' });

    expect(outcome('thunder_in_a_bottle', 'socket_thunder')).toStrictEqual({ kind: 'gemChoice', filter: [{ actionKinds: ['slow'] }, { ids: ['time_crystal_echo'] }] });
    expect(outcome('thunder_in_a_bottle', 'teach_the_card')).toStrictEqual({ kind: 'upgradeCardTargeted', target: { filter: { where: 'any', match: { elements: ['lightning'] } } }, fallback: { kind: 'grantGold', amount: 2 } });
    expect(outcome('thunder_in_a_bottle', 'sell_storm')).toStrictEqual({ kind: 'grantGold', amount: 4 });

    expect(outcome('bloom_behind_the_teeth', 'harvest_venom')).toStrictEqual({ kind: 'gemChoice', filter: [{ actionKinds: ['poison'] }, { ids: ['festering_sliver'] }] });
    expect(outcome('bloom_behind_the_teeth', 'cultivate_bloom')).toStrictEqual({ kind: 'upgradeCardTargeted', target: { filter: { where: 'any', match: { elements: ['nature'] } } }, fallback: { kind: 'grantGold', amount: 2 } });
    expect(mutations('bloom_behind_the_teeth', 'cultivate_bloom')).toStrictEqual([{ op: 'set', key: 'venom_bloom', value: 'cultivated' }]);

    for (const [eventId, storyId] of [
      ['names_under_stone_answer', 'names_under_stone'],
      ['whiteout_guidance', 'whiteout_pilgrim'],
      ['moon_scented_hunt', 'moon_scented_trail'],
    ] as const) {
      for (const callbackChoice of currentDef(document, eventId).choiceSet.fixed) {
        expect(callbackChoice.mutations, `${eventId}/${callbackChoice.id}`).toContainEqual({ op: 'completeStory', storyId });
      }
    }
  });

  it('keeps frozen V2 byte-identical while the live catalog and wiki include the biome definitions', () => {
    const frozenBytes = readFileSync(FROZEN_V2, 'utf8');
    const wiki = readFileSync(GENERATED_WIKI, 'utf8');
    const live = loadEventContent(liveEventsV2);
    expect(createHash('sha256').update(frozenBytes).digest('hex')).toBe(FROZEN_V2_SHA256);
    for (const id of NEW_IDS) {
      expect(live.catalog[id]).toBeUndefined();
      expect(loadedEventCatalogFromJson[id]).toBeDefined();
      expect(wiki).toContain(`## \`${id}\` · current version`);
    }
    for (const id of ['unlit_reliquary', 'gate_of_oaths', 'gate_of_oaths_answer']) {
      expect(live.catalog[id]).toBeUndefined();
      expect(wiki).not.toContain(`## \`${id}\` · version`);
      expect(wiki).not.toContain(`## \`${id}\` · current version`);
    }
    const currentIds = new Set(compileEventPacks(PACK_DIRECTORY).document.events.map((event) => event.id));
    expect(currentIds.has('unlit_reliquary')).toBe(false);
    expect(currentIds.has('gate_of_oaths')).toBe(false);
    expect(currentIds.has('gate_of_oaths_answer')).toBe(false);
  });
});
