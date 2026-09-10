import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import stagedEventsV3 from '../../src/data/content/events.v3.json';
import { loadEventContent } from '../../src/data/eventsContent';

const discoveryFile = new URL('../../src/data/content/event-discoveries.v1.json', import.meta.url);

const EXPECTED = [
  ['far_sighted', 'Far-Sighted', 'feathered_cairn'],
  ['the_grave_answers', 'The Grave Answers', 'names_under_stone'],
  ['tempered_by_fire', 'Tempered by Fire', 'cinderheart_crucible'],
  ['white_road_walker', 'White Road Walker', 'whiteout_pilgrim'],
  ['hunted_the_hunter', 'Hunted the Hunter', 'moon_scented_trail'],
  ['under_the_red_standard', 'Under the Red Standard', 'red_standard'],
  ['hold_the_line', 'Hold the Line', 'last_hedge'],
  ['storm_in_hand', 'Storm in Hand', 'thunder_in_a_bottle'],
  ['venom_crown', 'Venom Crown', 'bloom_behind_the_teeth'],
  ['heavy_purse', 'Heavy Purse', 'gilded_detour'],
  ['proven_fivefold', 'Proven Fivefold', 'victors_table'],
  ['settled_score', 'Settled Score', 'bitter_rematch'],
  ['last_light', 'Last Light', 'last_light_at_roads_end'],
  ['one_purpose', 'One Purpose', 'mirror_of_the_board'],
  ['signature_skill', 'Signature Skill', 'card_that_remembered'],
  ['off_the_map', 'Off the Map', 'cartographers_missing_road'],
] as const;

type Problem = { where: string; message: string };
type Validator = (
  raw: unknown,
  content: ReturnType<typeof loadEventContent>,
) => readonly Problem[];

async function discoveryValidator(): Promise<Validator> {
  const module = await import('../../scripts/generateEventCatalog') as Record<string, unknown>;
  const candidate = module.validateEventDiscoveryDocument;
  expect(candidate).toBeTypeOf('function');
  return candidate as Validator;
}

function rawDiscoveryDocument(): unknown {
  return JSON.parse(readFileSync(discoveryFile, 'utf8'));
}

describe('event discovery metadata', () => {
  it('owns the exact 16 stable future discoveries in authored order', () => {
    const raw = rawDiscoveryDocument() as {
      schemaVersion: unknown;
      discoveries: Array<Record<string, unknown>>;
    };

    expect(raw.schemaVersion).toBe(1);
    expect(raw.discoveries.map((entry) => [entry.id, entry.label, entry.eventId])).toStrictEqual(EXPECTED);
    expect(raw.discoveries.every((entry) => entry.accountStatus === 'future')).toBe(true);
    expect(raw.discoveries.every((entry) => Object.keys(entry).sort().join(',') === 'accountStatus,eventId,id,label')).toBe(true);
    expect(new Set(raw.discoveries.map((entry) => entry.id)).size).toBe(16);
    expect(new Set(raw.discoveries.map((entry) => entry.eventId)).size).toBe(16);
  });

  it('validates schema, ownership, uniqueness, ambient owners, and references', async () => {
    const validate = await discoveryValidator();
    const content = loadEventContent(stagedEventsV3);
    const raw = rawDiscoveryDocument();

    expect(validate(raw, content)).toEqual([]);

    const cases: Array<[string, (copy: any) => void, RegExp]> = [
      ['schema', (copy) => { copy.schemaVersion = 2; }, /schemaVersion/i],
      ['top-level unknown', (copy) => { copy.extra = true; }, /unknown field extra/i],
      ['entry unknown', (copy) => { copy.discoveries[0].extra = true; }, /unknown field extra/i],
      ['stable id', (copy) => { copy.discoveries[0].id = 'Far Sight'; }, /stable snake_case/i],
      ['label', (copy) => { copy.discoveries[0].label = ''; }, /non-empty label/i],
      ['status', (copy) => { copy.discoveries[0].accountStatus = 'earned'; }, /accountStatus.*future/i],
      ['duplicate id', (copy) => { copy.discoveries[1].id = copy.discoveries[0].id; }, /duplicate discovery id/i],
      ['duplicate owner', (copy) => { copy.discoveries[1].eventId = copy.discoveries[0].eventId; }, /more than one discovery/i],
      ['unknown event', (copy) => { copy.discoveries[0].eventId = 'gate_of_oaths'; }, /unknown owning event/i],
      ['callback owner', (copy) => { copy.discoveries[0].eventId = 'feathered_cairn_far_sight'; }, /ambient event/i],
    ];

    for (const [name, mutate, expected] of cases) {
      const copy = structuredClone(raw);
      mutate(copy);
      expect(validate(copy, content).map((problem) => problem.message).join('\n'), name).toMatch(expected);
    }
  });

  it('excludes callbacks and the three deferred absent event IDs', () => {
    const raw = rawDiscoveryDocument() as { discoveries: Array<{ eventId: string }> };
    const eventIds = raw.discoveries.map((entry) => entry.eventId);

    expect(eventIds).not.toEqual(expect.arrayContaining([
      'feathered_cairn_far_sight',
      'names_under_stone_answer',
      'whiteout_guidance',
      'moon_scented_hunt',
      'last_light_secret_route',
      'mirror_transformation',
      'signature_card_capstone',
      'missing_road_destination',
      'unlit_reliquary',
      'gate_of_oaths',
      'gate_of_oaths_answer',
    ]));
  });
});
