import { describe, expect, it } from 'vitest';
import { eventCatalog } from '../../src/data/events';
import activeEventDocument from '../../src/data/content/events.v2.json';
import { eventDefOfDocument, validateEventDocument } from '../../src/data/validateEventContent';
import { findDuplicateKeys } from '../../scripts/jsonDuplicateKeys';

type JsonRecord = Record<string, any>;

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

function validDocument(): JsonRecord {
  return {
    schemaVersion: 1,
    notes: ['Event definitions.'],
    events: [
      {
        id: 'sample_event',
        versions: [
          {
            version: 1,
            def: {
              title: 'Sample Event',
              theme: 'training',
              body: 'A useful opportunity appears.',
              notes: ['Authoring context.'],
              choices: [
                {
                  id: 'take_card',
                  label: 'Take the card',
                  outcome: { kind: 'grantCard', cardId: 'aegis_wall' },
                },
                { id: 'leave', label: 'Leave', outcome: { kind: 'nothing' } },
              ],
            },
          },
        ],
      },
    ],
  };
}

function defOf(doc: JsonRecord, event = 0, version = 0): JsonRecord {
  return doc.events[event].versions[version].def;
}

function choiceOf(doc: JsonRecord, choice = 0, event = 0): JsonRecord {
  return defOf(doc, event).choices[choice];
}

function paths(doc: unknown): string[] {
  return validateEventDocument(doc).map((problem) => problem.where);
}

function messages(doc: unknown): string[] {
  return validateEventDocument(doc).map((problem) => problem.message);
}

function withMutation(mutator: (doc: JsonRecord) => void): JsonRecord {
  const doc = validDocument();
  mutator(doc);
  return doc;
}

function withOutcome(outcome: JsonRecord, choice = 0): JsonRecord {
  return withMutation((doc) => { choiceOf(doc, choice).outcome = outcome; });
}

function eventDocument(id: string, requires?: JsonRecord): JsonRecord {
  const event = clone(validDocument().events[0]);
  event.id = id;
  event.versions[0].def.title = id;
  if (requires !== undefined) event.versions[0].def.requires = requires;
  return event;
}

describe('event content document envelope', () => {
  it('accepts the minimal complete document', () => {
    expect(validateEventDocument(validDocument())).toEqual([]);
  });

  it('accepts the complete schema-v2 envelope of all 44 active event definitions', () => {
    expect(activeEventDocument.events).toHaveLength(44);
    expect(validateEventDocument(clone(activeEventDocument))).toEqual([]);
    for (const event of activeEventDocument.events) {
      const current = event.versions.reduce((latest, entry) => entry.version > latest.version ? entry : latest);
      expect(eventDefOfDocument(event.id, clone(current.def))).toStrictEqual(eventCatalog[event.id]);
    }
  });

  it.each([
    ['non-object document', null, 'document'],
    ['wrong schema version', { ...validDocument(), schemaVersion: 2 }, 'schemaVersion'],
    ['missing schema version', (() => { const d = validDocument(); delete d.schemaVersion; return d; })(), 'schemaVersion'],
    ['unknown top-level field', { ...validDocument(), surprise: true }, 'document.surprise'],
    ['missing events', (() => { const d = validDocument(); delete d.events; return d; })(), 'events'],
    ['non-array events', { ...validDocument(), events: {} }, 'events'],
    ['empty events', { ...validDocument(), events: [] }, 'events'],
    ['non-array file notes', { ...validDocument(), notes: 'note' }, 'notes'],
    ['empty file note', { ...validDocument(), notes: [''] }, 'notes'],
  ])('rejects %s', (_name, doc, path) => {
    expect(paths(doc)).toContain(path);
  });

  it.each([
    ['non-object event', (d: JsonRecord) => { d.events[0] = null; }, 'events[0]'],
    ['missing id', (d: JsonRecord) => { delete d.events[0].id; }, 'events[0].id'],
    ['non-string id', (d: JsonRecord) => { d.events[0].id = 7; }, 'events[0].id'],
    ['empty id', (d: JsonRecord) => { d.events[0].id = ''; }, 'events[0].id'],
    ['uppercase id', (d: JsonRecord) => { d.events[0].id = 'Bad_id'; }, 'events[0].id'],
    ['hyphenated id', (d: JsonRecord) => { d.events[0].id = 'bad-id'; }, 'events[0].id'],
    ['all-numeric id', (d: JsonRecord) => { d.events[0].id = '42'; }, 'events[0].id'],
    ['unknown envelope key', (d: JsonRecord) => { d.events[0].surprise = true; }, 'sample_event.surprise'],
    ['missing versions', (d: JsonRecord) => { delete d.events[0].versions; }, 'sample_event.versions'],
    ['empty versions', (d: JsonRecord) => { d.events[0].versions = []; }, 'sample_event.versions'],
    ['non-object version', (d: JsonRecord) => { d.events[0].versions[0] = null; }, 'sample_event.versions[0]'],
    ['zero version', (d: JsonRecord) => { d.events[0].versions[0].version = 0; }, 'sample_event.versions[0].version'],
    ['fractional version', (d: JsonRecord) => { d.events[0].versions[0].version = 1.5; }, 'sample_event.versions[0].version'],
    ['unknown version key', (d: JsonRecord) => { d.events[0].versions[0].surprise = true; }, 'sample_event@v1.surprise'],
    ['missing def', (d: JsonRecord) => { delete d.events[0].versions[0].def; }, 'sample_event@v1.def'],
  ])('rejects %s', (_name, mutate, path) => {
    expect(paths(withMutation(mutate))).toContain(path);
  });

  it('rejects duplicate event documents', () => {
    const doc = validDocument();
    doc.events.push(clone(doc.events[0]));
    expect(paths(doc)).toContain('sample_event');
  });

  it('rejects duplicate versions within one event', () => {
    const doc = validDocument();
    doc.events[0].versions.push(clone(doc.events[0].versions[0]));
    expect(paths(doc)).toContain('sample_event@v1.version');
  });

  it('catches duplicate raw object keys before JSON.parse discards the first value', () => {
    const raw = '{"events":[{"id":"sample_event","id":"replaced_event"}]}';
    expect(JSON.parse(raw)).toEqual({ events: [{ id: 'replaced_event' }] });
    expect(findDuplicateKeys(raw)).toMatchObject([{ key: 'id' }]);
  });

  it.each(['id', 'version'])('rejects def.%s because identity is envelope-only', (key) => {
    const doc = validDocument();
    defOf(doc)[key] = key === 'id' ? 'wrong' : 1;
    expect(paths(doc)).toContain(`sample_event@v1.${key}`);
  });

  it('rejects unknown definition fields at their precise path', () => {
    const doc = validDocument();
    defOf(doc).surprise = true;
    expect(paths(doc)).toContain('sample_event@v1.surprise');
  });

  it('reconstructs only allowed runtime fields after validation', () => {
    const definition = {
      ...clone(defOf(validDocument())),
      id: 'payload_id',
      version: 99,
      surprise: true,
    };
    expect(eventDefOfDocument('envelope_id', definition)).toStrictEqual({
      id: 'envelope_id',
      title: 'Sample Event',
      theme: 'training',
      body: 'A useful opportunity appears.',
      choices: [
        { id: 'take_card', label: 'Take the card', outcome: { kind: 'grantCard', cardId: 'aegis_wall' } },
        { id: 'leave', label: 'Leave', outcome: { kind: 'nothing' } },
      ],
    });
  });
});

describe('event definitions and choices', () => {
  it.each(['bell_beneath_ice', 'second_toll', 'bell_unbound'])('accepts known event art id %s', (artId) => {
    const doc = validDocument();
    defOf(doc).artId = artId;
    expect(validateEventDocument(doc)).toEqual([]);
    expect(eventDefOfDocument('sample_event', defOf(doc))).toMatchObject({ artId });
  });

  it('rejects an event art id outside the closed asset vocabulary', () => {
    const doc = validDocument();
    defOf(doc).artId = 'missing_bell_art';
    expect(paths(doc)).toContain('sample_event@v1.artId');
  });

  it.each([
    ['title', '', 'sample_event@v1.title'],
    ['body', '   ', 'sample_event@v1.body'],
    ['theme', 'battle', 'sample_event@v1.theme'],
    ['rarity', 'legendary', 'sample_event@v1.rarity'],
    ['notes', [''], 'sample_event@v1.notes'],
    ['biomeIds empty', [], 'sample_event@v1.biomeIds'],
    ['biomeIds duplicate', ['arrowfell', 'arrowfell'], 'sample_event@v1.biomeIds[1]'],
    ['biomeIds unknown', ['not_a_biome'], 'sample_event@v1.biomeIds[0]'],
  ])('rejects invalid %s', (key, value, path) => {
    const doc = validDocument();
    defOf(doc)[key.split(' ')[0]!] = value;
    expect(paths(doc)).toContain(path);
  });

  it.each(['training', 'cache', 'recruit', 'forge', 'market', 'omen'])('accepts theme %s', (theme) => {
    const doc = validDocument();
    defOf(doc).theme = theme;
    expect(paths(doc)).not.toContain('sample_event@v1.theme');
  });

  it.each(['common', 'uncommon', 'rare', 'secret'])('accepts rarity %s', (rarity) => {
    const doc = validDocument();
    defOf(doc).rarity = rarity;
    expect(paths(doc)).not.toContain('sample_event@v1.rarity');
  });

  it('accepts a duplicate-free biome allow-list', () => {
    const doc = validDocument();
    defOf(doc).biomeIds = ['arrowfell', 'thornwild'];
    expect(validateEventDocument(doc)).toEqual([]);
  });

  it.each([
    ['one choice', (d: JsonRecord) => { defOf(d).choices = [choiceOf(d)]; }],
    ['four choices', (d: JsonRecord) => { defOf(d).choices.push(
      { id: 'third', label: 'Third', outcome: { kind: 'grantLevel' } },
      { id: 'fourth', label: 'Fourth', outcome: { kind: 'grantLevel' } },
    ); }],
  ])('rejects %s', (_name, mutate) => {
    expect(paths(withMutation(mutate))).toContain('sample_event@v1.choices');
  });

  it.each([
    ['non-object choice', (d: JsonRecord) => { defOf(d).choices[0] = null; }, 'sample_event@v1.choices[0]'],
    ['unknown choice field', (d: JsonRecord) => { choiceOf(d).surprise = true; }, 'sample_event@v1.choices[0].surprise'],
    ['missing choice id', (d: JsonRecord) => { delete choiceOf(d).id; }, 'sample_event@v1.choices[0].id'],
    ['bad choice id', (d: JsonRecord) => { choiceOf(d).id = 'Bad-id'; }, 'sample_event@v1.choices[0].id'],
    ['empty label', (d: JsonRecord) => { choiceOf(d).label = ' '; }, 'sample_event@v1.choices[0].label'],
    ['negative cost', (d: JsonRecord) => { choiceOf(d).cost = -1; }, 'sample_event@v1.choices[0].cost'],
    ['fractional cost', (d: JsonRecord) => { choiceOf(d).cost = 0.5; }, 'sample_event@v1.choices[0].cost'],
    ['oversized cost', (d: JsonRecord) => { choiceOf(d).cost = 1000; }, 'sample_event@v1.choices[0].cost'],
    ['missing outcome', (d: JsonRecord) => { delete choiceOf(d).outcome; }, 'sample_event@v1.choices[0].outcome'],
  ])('rejects %s', (_name, mutate, path) => {
    expect(paths(withMutation(mutate))).toContain(path);
  });

  it('rejects duplicate choice ids', () => {
    const doc = validDocument();
    choiceOf(doc, 1).id = choiceOf(doc).id;
    expect(paths(doc)).toContain('sample_event@v1.choices[1].id');
  });

  it('requires a cost-zero choice with no choice-level gate as the safe exit', () => {
    const paidExit = withMutation((doc) => {
      choiceOf(doc).cost = 1;
      choiceOf(doc, 1).cost = 1;
    });
    const gatedExit = withMutation((doc) => {
      choiceOf(doc).requiresTally = { stat: 'wins', atLeast: 1 };
      choiceOf(doc, 1).requiresTally = { stat: 'wins', atLeast: 1 };
    });
    expect(paths(paidExit)).toContain('sample_event@v1.choices');
    expect(paths(gatedExit)).toContain('sample_event@v1.choices');
  });

  it('allows a free safe exit regardless of its outcome kind', () => {
    const doc = validDocument();
    choiceOf(doc, 1).outcome = { kind: 'grantLevel' };
    expect(validateEventDocument(doc)).toEqual([]);
  });

  it('does not require a free non-nothing choice when an ungated free exit exists', () => {
    const doc = validDocument();
    choiceOf(doc).cost = 2;
    expect(validateEventDocument(doc)).toEqual([]);
  });
});

describe('event gates and references', () => {
  function twoEventDocument(): JsonRecord {
    const doc = validDocument();
    doc.events = [
      eventDocument('source_event'),
      eventDocument('sample_event', { eventId: 'source_event', choiceIds: ['take_card'] }),
    ];
    return doc;
  }

  it('accepts legacy event/choice gates, tallies, and mixed requiresAll requirements', () => {
    const doc = twoEventDocument();
    const target = defOf(doc, 1);
    target.requiresTally = { stat: 'wins', atLeast: 1 };
    target.requiresAll = [
      { kind: 'resolution', eventId: 'source_event', choiceIds: ['leave'] },
      { kind: 'tally', stat: 'goldSpent', atLeast: 2 },
    ];
    target.choices.push({ id: 'free_card', label: 'Take another card', outcome: { kind: 'grantLevel' } });
    choiceOf(doc, 0, 1).requires = { eventId: 'source_event' };
    choiceOf(doc, 0, 1).requiresTally = { stat: 'cardsBought', atLeast: 1 };
    expect(validateEventDocument(doc)).toEqual([]);
  });

  it('resolves references independently of event document order', () => {
    const doc = twoEventDocument();
    doc.events.reverse();
    expect(validateEventDocument(doc)).toEqual([]);
  });

  it.each([
    ['non-object requires', (d: JsonRecord) => { defOf(d, 1).requires = 'source_event'; }, 'sample_event@v1.requires'],
    ['unknown gate key', (d: JsonRecord) => { defOf(d, 1).requires.surprise = true; }, 'sample_event@v1.requires.surprise'],
    ['empty gate event id', (d: JsonRecord) => { defOf(d, 1).requires.eventId = ''; }, 'sample_event@v1.requires.eventId'],
    ['empty choiceIds', (d: JsonRecord) => { defOf(d, 1).requires.choiceIds = []; }, 'sample_event@v1.requires.choiceIds'],
    ['duplicate choiceIds', (d: JsonRecord) => { defOf(d, 1).requires.choiceIds = ['leave', 'leave']; }, 'sample_event@v1.requires.choiceIds[1]'],
    ['empty choice id value', (d: JsonRecord) => { defOf(d, 1).requires.choiceIds = ['']; }, 'sample_event@v1.requires.choiceIds[0]'],
    ['non-object tally', (d: JsonRecord) => { defOf(d, 1).requiresTally = 'wins'; }, 'sample_event@v1.requiresTally'],
    ['unknown tally key', (d: JsonRecord) => { defOf(d, 1).requiresTally = { stat: 'wins', atLeast: 1, surprise: true }; }, 'sample_event@v1.requiresTally.surprise'],
    ['unknown tally stat', (d: JsonRecord) => { defOf(d, 1).requiresTally = { stat: 'damage', atLeast: 1 }; }, 'sample_event@v1.requiresTally.stat'],
    ['zero tally threshold', (d: JsonRecord) => { defOf(d, 1).requiresTally = { stat: 'wins', atLeast: 0 }; }, 'sample_event@v1.requiresTally.atLeast'],
    ['empty requiresAll', (d: JsonRecord) => { defOf(d, 1).requiresAll = []; }, 'sample_event@v1.requiresAll'],
    ['duplicate requirements', (d: JsonRecord) => { defOf(d, 1).requiresAll = [
      { kind: 'tally', stat: 'wins', atLeast: 1 },
      { kind: 'tally', stat: 'wins', atLeast: 1 },
    ]; }, 'sample_event@v1.requiresAll[1]'],
    ['non-object requirement', (d: JsonRecord) => { defOf(d, 1).requiresAll = [null]; }, 'sample_event@v1.requiresAll[0]'],
    ['unknown requirement kind', (d: JsonRecord) => { defOf(d, 1).requiresAll = [{ kind: 'mystery' }]; }, 'sample_event@v1.requiresAll[0].kind'],
    ['unknown resolution key', (d: JsonRecord) => { defOf(d, 1).requiresAll = [{ kind: 'resolution', eventId: 'source_event', surprise: true }]; }, 'sample_event@v1.requiresAll[0].surprise'],
    ['illegal resolution tally field', (d: JsonRecord) => { defOf(d, 1).requiresAll = [{ kind: 'resolution', eventId: 'source_event', atLeast: 1 }]; }, 'sample_event@v1.requiresAll[0].atLeast'],
    ['unknown tally requirement key', (d: JsonRecord) => { defOf(d, 1).requiresAll = [{ kind: 'tally', stat: 'wins', atLeast: 1, surprise: true }]; }, 'sample_event@v1.requiresAll[0].surprise'],
    ['illegal tally eventId field', (d: JsonRecord) => { defOf(d, 1).requiresAll = [{ kind: 'tally', stat: 'wins', atLeast: 1, eventId: 'source_event' }]; }, 'sample_event@v1.requiresAll[0].eventId'],
    ['choice-level requiresAll', (d: JsonRecord) => { choiceOf(d, 0, 1).requiresAll = []; }, 'sample_event@v1.choices[0].requiresAll'],
  ])('rejects %s', (_name, mutate, path) => {
    const doc = twoEventDocument();
    mutate(doc);
    expect(paths(doc)).toContain(path);
  });

  it('accepts every tally stat', () => {
    const stats = ['goldSpent', 'cardsBought', 'gemsBought', 'livesLost', 'wins', 'losses', 'bossesCleared'];
    for (const stat of stats) {
      const doc = validDocument();
      defOf(doc).requiresTally = { stat, atLeast: 1 };
      expect(paths(doc)).not.toContain('sample_event@v1.requiresTally.stat');
    }
  });

  it('rejects dangling event and choice references', () => {
    const missingEvent = twoEventDocument();
    defOf(missingEvent, 1).requires.eventId = 'missing_event';
    const missingChoice = twoEventDocument();
    defOf(missingChoice, 1).requires.choiceIds = ['missing_choice'];
    expect(paths(missingEvent)).toContain('sample_event@v1.requires.eventId');
    expect(paths(missingChoice)).toContain('sample_event@v1.requires.choiceIds[0]');
  });

  it('rejects a dangling choice-level event reference', () => {
    const doc = twoEventDocument();
    choiceOf(doc, 0, 1).requires = { eventId: 'missing_event' };
    expect(paths(doc)).toContain('sample_event@v1.choices[0].requires.eventId');
  });

  it('resolves references against the highest version even when versions are unsorted', () => {
    const doc = twoEventDocument();
    const oldVersion = clone(doc.events[0].versions[0]);
    oldVersion.version = 1;
    const currentVersion = clone(oldVersion);
    currentVersion.version = 2;
    currentVersion.def.choices[0].id = 'current_choice';
    doc.events[0].versions = [currentVersion, oldVersion];
    defOf(doc, 1).requires.choiceIds = ['current_choice'];
    expect(validateEventDocument(doc)).toEqual([]);
  });

  it('rejects a self-dependency', () => {
    const doc = validDocument();
    defOf(doc).requires = { eventId: 'sample_event' };
    expect(paths(doc)).toContain('sample_event@v1.requires.eventId');
  });

  it('rejects a two-event cycle', () => {
    const doc = validDocument();
    doc.events = [
      eventDocument('first_event', { eventId: 'second_event' }),
      eventDocument('second_event', { eventId: 'first_event' }),
    ];
    expect(messages(doc).some((message) => message.includes('cycle'))).toBe(true);
  });

  it('diagnoses a cycle even when it is also deeper than the maximum chain', () => {
    const doc = validDocument();
    doc.events = [
      eventDocument('first_event', { eventId: 'second_event' }),
      eventDocument('second_event', { eventId: 'third_event' }),
      eventDocument('third_event', { eventId: 'fourth_event' }),
      eventDocument('fourth_event', { eventId: 'first_event' }),
    ];
    expect(messages(doc).some((message) => message.includes('cycle'))).toBe(true);
  });

  it('allows two dependency edges and rejects three', () => {
    const twoEdges = validDocument();
    twoEdges.events = [
      eventDocument('first_event', { eventId: 'second_event' }),
      eventDocument('second_event', { eventId: 'third_event' }),
      eventDocument('third_event'),
    ];
    const threeEdges = clone(twoEdges);
    threeEdges.events.push(eventDocument('fourth_event'));
    threeEdges.events[2].versions[0].def.requires = { eventId: 'fourth_event' };
    expect(validateEventDocument(twoEdges)).toEqual([]);
    expect(messages(threeEdges).some((message) => message.includes('deeper than two'))).toBe(true);
  });

  it('returns depth problems instead of throwing on a 6,000-event chain', () => {
    const doc = validDocument();
    doc.events = Array.from({ length: 6_000 }, (_unused, index) => eventDocument(
      `chain_${index}`,
      index < 5_999 ? { eventId: `chain_${index + 1}` } : undefined,
    ));
    const problems = validateEventDocument(doc);
    expect(problems.some((problem) => problem.message.includes('deeper than two'))).toBe(true);
  });
});

describe('card and gem filters', () => {
  it('accepts every card-filter clause field and enum value', () => {
    const doc = withOutcome({
      kind: 'grantCard',
      filter: [{
        properties: ['physical', 'magical', 'true'],
        weapons: ['sword', 'axe', 'lance', 'bow', 'beast'],
        elements: ['fire', 'frost', 'lightning', 'nature', 'holy', 'dark'],
        archetypes: ['offense', 'defensive', 'healing', 'support', 'debuff'],
      }],
    });
    expect(validateEventDocument(doc)).toEqual([]);
  });

  it.each([
    ['empty filter', [], 'sample_event@v1.choices[0].outcome.filter'],
    ['non-object clause', [null], 'sample_event@v1.choices[0].outcome.filter[0]'],
    ['empty clause', [{}], 'sample_event@v1.choices[0].outcome.filter[0]'],
    ['unknown clause field', [{ surprise: ['x'] }], 'sample_event@v1.choices[0].outcome.filter[0].surprise'],
    ['empty property list', [{ properties: [] }], 'sample_event@v1.choices[0].outcome.filter[0].properties'],
    ['duplicate properties', [{ properties: ['physical', 'physical'] }], 'sample_event@v1.choices[0].outcome.filter[0].properties[1]'],
    ['empty weapon list', [{ weapons: [] }], 'sample_event@v1.choices[0].outcome.filter[0].weapons'],
    ['duplicate weapons', [{ weapons: ['sword', 'sword'] }], 'sample_event@v1.choices[0].outcome.filter[0].weapons[1]'],
    ['empty element list', [{ elements: [] }], 'sample_event@v1.choices[0].outcome.filter[0].elements'],
    ['duplicate elements', [{ elements: ['fire', 'fire'] }], 'sample_event@v1.choices[0].outcome.filter[0].elements[1]'],
    ['empty archetype list', [{ archetypes: [] }], 'sample_event@v1.choices[0].outcome.filter[0].archetypes'],
    ['duplicate archetypes', [{ archetypes: ['offense', 'offense'] }], 'sample_event@v1.choices[0].outcome.filter[0].archetypes[1]'],
    ['bad property', [{ properties: ['arcane'] }], 'sample_event@v1.choices[0].outcome.filter[0].properties[0]'],
    ['bad weapon', [{ weapons: ['staff'] }], 'sample_event@v1.choices[0].outcome.filter[0].weapons[0]'],
    ['bad element', [{ elements: ['water'] }], 'sample_event@v1.choices[0].outcome.filter[0].elements[0]'],
    ['bad archetype', [{ archetypes: ['tank'] }], 'sample_event@v1.choices[0].outcome.filter[0].archetypes[0]'],
  ])('rejects card filter with %s', (_name, filter, path) => {
    expect(paths(withOutcome({ kind: 'grantCard', filter }))).toContain(path);
  });

  it('accepts each gem-filter clause axis', () => {
    const filters = [
      [{ ids: ['archmages_core'] }],
      [{ actionKinds: ['damage', 'ward'] }],
      [{ heroStats: ['attack', 'magicPower', 'armor', 'magicResist', 'speed'] }],
      [{ all: true }],
    ];
    for (const filter of filters) {
      expect(validateEventDocument(withOutcome({ kind: 'grantGem', filter }))).toEqual([]);
    }
  });

  it.each([
    ['empty filter', [], 'sample_event@v1.choices[0].outcome.filter'],
    ['non-object clause', [null], 'sample_event@v1.choices[0].outcome.filter[0]'],
    ['empty clause', [{}], 'sample_event@v1.choices[0].outcome.filter[0]'],
    ['unknown clause field', [{ surprise: true }], 'sample_event@v1.choices[0].outcome.filter[0].surprise'],
    ['multiple axes', [{ ids: ['archmages_core'], all: true }], 'sample_event@v1.choices[0].outcome.filter[0]'],
    ['false all', [{ all: false }], 'sample_event@v1.choices[0].outcome.filter[0].all'],
    ['empty ids', [{ ids: [] }], 'sample_event@v1.choices[0].outcome.filter[0].ids'],
    ['duplicate ids', [{ ids: ['archmages_core', 'archmages_core'] }], 'sample_event@v1.choices[0].outcome.filter[0].ids[1]'],
    ['unknown id', [{ ids: ['missing_gem'] }], 'sample_event@v1.choices[0].outcome.filter[0].ids[0]'],
    ['bad action kind', [{ actionKinds: ['unknownAction'] }], 'sample_event@v1.choices[0].outcome.filter[0].actionKinds[0]'],
    ['empty action kinds', [{ actionKinds: [] }], 'sample_event@v1.choices[0].outcome.filter[0].actionKinds'],
    ['duplicate action kinds', [{ actionKinds: ['damage', 'damage'] }], 'sample_event@v1.choices[0].outcome.filter[0].actionKinds[1]'],
    ['bad hero stat', [{ heroStats: ['health'] }], 'sample_event@v1.choices[0].outcome.filter[0].heroStats[0]'],
    ['empty hero stats', [{ heroStats: [] }], 'sample_event@v1.choices[0].outcome.filter[0].heroStats'],
    ['duplicate hero stats', [{ heroStats: ['attack', 'attack'] }], 'sample_event@v1.choices[0].outcome.filter[0].heroStats[1]'],
  ])('rejects gem filter with %s', (_name, filter, path) => {
    expect(paths(withOutcome({ kind: 'grantGem', filter }))).toContain(path);
  });
});

describe('all event outcome variants', () => {
  const validOutcomes: Array<[string, JsonRecord, number?]> = [
    ['grantCard', { kind: 'grantCard', cardId: 'aegis_wall', tier: 'diamond', filter: [{ weapons: ['sword'] }] }],
    ['grantGem', { kind: 'grantGem', gemId: 'archmages_core', filter: [{ ids: ['archmages_core'] }] }],
    ['cardChoice', { kind: 'cardChoice', filterFrom: 'biomeLean', tier: 'bronze' }],
    ['gemChoice', { kind: 'gemChoice', filter: [{ all: true }] }],
    ['grantGold', { kind: 'grantGold', amount: 1 }],
    ['loseGold', { kind: 'loseGold', amount: 2 }],
    ['grantLevel', { kind: 'grantLevel' }],
    ['bonusDraft', { kind: 'bonusDraft', filterFrom: 'boardIdentity' }],
    ['upgradeCard', { kind: 'upgradeCard' }],
    ['sellGem', { kind: 'sellGem' }],
    ['mergeCards', { kind: 'mergeCards' }],
    ['nothing', { kind: 'nothing' }, 1],
  ];

  it.each(validOutcomes)('accepts a valid %s outcome', (_kind, outcome, choice = 0) => {
    expect(validateEventDocument(withOutcome(outcome, choice))).toEqual([]);
  });

  it.each(validOutcomes)('rejects %s with a missing required field', (kind, outcome, choice = 0) => {
    const invalid = clone(outcome);
    if (kind === 'grantGold' || kind === 'loseGold') delete invalid.amount;
    else delete invalid.kind;
    const field = kind === 'grantGold' || kind === 'loseGold' ? 'amount' : 'kind';
    expect(paths(withOutcome(invalid, choice))).toContain(`sample_event@v1.choices[${choice}].outcome.${field}`);
  });

  it.each(validOutcomes)('rejects %s with an unknown field', (_kind, outcome, choice = 0) => {
    const invalid = { ...clone(outcome), surprise: true };
    expect(paths(withOutcome(invalid, choice))).toContain(`sample_event@v1.choices[${choice}].outcome.surprise`);
  });

  it.each(validOutcomes)('rejects %s with another outcome kind\'s payload', (kind, outcome, choice = 0) => {
    const illegalKey = kind === 'grantGold' || kind === 'loseGold' ? 'cardId' : 'amount';
    const invalid = { ...clone(outcome), [illegalKey]: illegalKey === 'amount' ? 1 : 'aegis_wall' };
    expect(paths(withOutcome(invalid, choice))).toContain(`sample_event@v1.choices[${choice}].outcome.${illegalKey}`);
  });

  it.each([
    ['non-object outcome', null, 'sample_event@v1.choices[0].outcome'],
    ['non-string kind', { kind: 1 }, 'sample_event@v1.choices[0].outcome.kind'],
    ['unknown kind', { kind: 'mystery' }, 'sample_event@v1.choices[0].outcome.kind'],
    ['bad card id', { kind: 'grantCard', cardId: 'missing_card' }, 'sample_event@v1.choices[0].outcome.cardId'],
    ['bad gem id', { kind: 'grantGem', gemId: 'missing_gem' }, 'sample_event@v1.choices[0].outcome.gemId'],
    ['bad grant-card tier', { kind: 'grantCard', tier: 'platinum' }, 'sample_event@v1.choices[0].outcome.tier'],
    ['non-bronze card-choice tier', { kind: 'cardChoice', tier: 'silver' }, 'sample_event@v1.choices[0].outcome.tier'],
    ['bad filterFrom', { kind: 'cardChoice', filterFrom: 'biome' }, 'sample_event@v1.choices[0].outcome.filterFrom'],
    ['zero grant amount', { kind: 'grantGold', amount: 0 }, 'sample_event@v1.choices[0].outcome.amount'],
    ['fractional loss amount', { kind: 'loseGold', amount: 1.5 }, 'sample_event@v1.choices[0].outcome.amount'],
  ])('rejects %s', (_name, outcome, path) => {
    expect(paths(withOutcome(outcome as JsonRecord))).toContain(path);
  });

  it.each(['biomeLean', 'biomeCounter', 'boardIdentity'])('accepts filterFrom %s', (filterFrom) => {
    expect(validateEventDocument(withOutcome({ kind: 'bonusDraft', filterFrom }))).toEqual([]);
  });

  it.each(['cardChoice', 'bonusDraft'])('rejects filter plus filterFrom on %s', (kind) => {
    const doc = withOutcome({ kind, filter: [{ weapons: ['sword'] }], filterFrom: 'biomeLean' });
    expect(paths(doc)).toContain('sample_event@v1.choices[0].outcome.filterFrom');
  });
});
