import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { validateEnemyDocument } from '../../src/data/validateEnemyContent';
import { findDuplicateKeys } from '../../scripts/jsonDuplicateKeys';
import document from '../../src/data/content/enemies.v1.json';
import { enemyDocumentOf } from '../../scripts/exportEnemies';
import { enemies } from '../../src/data/enemies';
import type { EnemyGrowthMilestone } from '../../src/engine/types';

const milestone: EnemyGrowthMilestone = {
  family: { kind: 'element', type: 'fire' }, purpose: 'complete-affinity',
  candidates: [{ skillId: 'fireball' }, { skillId: 'cinder_dart', allowDuplicate: true }],
};

const RAW = readFileSync(new URL('../../src/data/content/enemies.v1.json', import.meta.url), 'utf8');

type Doc = { schemaVersion: number; enemies: Array<Record<string, unknown>> };
type Entry = { version: number; def: Record<string, unknown> };
const clone = (): Doc => JSON.parse(JSON.stringify(document)) as Doc;
const vers = (d: Doc, i = 0): Entry[] => d.enemies[i]!.versions as unknown as Entry[];
const failsWith = (d: Doc, fragment: string): void => {
  const problems = validateEnemyDocument(d);
  expect(problems.length, 'expected at least one problem').toBeGreaterThan(0);
  expect(problems.map((p) => p.message).join(' | ')).toContain(fragment);
};

/**
 * THE CONTRACT'S TEETH for enemies.v1.json — the twin of
 * tests/data/contentSchema.test.ts (skills), scoped to `validateEnemyContent.ts`'s
 * smaller surface (no actions/auras/tierUpgrades — see that module's own doc
 * comment for why). Negative cases on purpose: a schema test that only
 * asserts "the real file passes" proves nothing about what the schema would
 * let through.
 */
describe('data: enemies content schema contract', () => {
  it('the shipped document is clean — no duplicate keys, no schema problems', () => {
    expect(findDuplicateKeys(RAW)).toEqual([]);
    expect(validateEnemyDocument(document)).toEqual([]);
  });

  it('two documents sharing an id are rejected', () => {
    const d = clone();
    d.enemies.push(JSON.parse(JSON.stringify(d.enemies[0])) as Record<string, unknown>);
    failsWith(d, 'duplicate document for id');
  });

  it('two versions with the same number inside one document are rejected', () => {
    const d = clone();
    vers(d).push(JSON.parse(JSON.stringify(vers(d)[0])) as Entry);
    failsWith(d, 'duplicate version');
  });

  it('an all-numeric id is rejected', () => {
    const d = clone(); d.enemies[0]!.id = '42';
    failsWith(d, 'an all-numeric id is not allowed');
  });

  it('an unknown field in def is rejected (a typo must not validate)', () => {
    const d = clone();
    vers(d)[0]!.def.elementAffinty = 'fire';
    failsWith(d, 'unknown field elementAffinty');
  });

  it('an unknown field inside stats is rejected', () => {
    const d = clone();
    (vers(d)[0]!.def.stats as Record<string, unknown>).luck = 5;
    failsWith(d, 'unknown stat field luck');
  });

  it('a stats object missing a required field is rejected', () => {
    const d = clone();
    delete (vers(d)[0]!.def.stats as Record<string, unknown>).speed;
    failsWith(d, 'missing required field speed');
  });

  it('an enemy carrying BOTH elementAffinity and weaponAffinity validates (unlike a card, an enemy is not one type badge — stone_beetle carried exactly this until the 2026-08-18 theme pass dropped its `weaponAffinity`, a real card the field never matched; the rule stays validator-enforced even with no live example on the shipped roster today)', () => {
    const d = clone();
    vers(d)[0]!.def.elementAffinity = 'fire';
    vers(d)[0]!.def.weaponAffinity = 'sword';
    expect(validateEnemyDocument(d)).toEqual([]);
  });

  it('empty name is rejected', () => {
    const d = clone(); vers(d)[0]!.def.name = '';
    failsWith(d, 'name must be a non-empty string');
  });

  it('an empty pieces array is rejected (nothing to cast)', () => {
    const d = clone(); vers(d)[0]!.def.pieces = [];
    failsWith(d, 'pieces must be a non-empty array');
  });

  it('two pieces sharing a slot are rejected', () => {
    const d = clone();
    const pieces = vers(d)[0]!.def.pieces as Array<Record<string, unknown>>;
    pieces.push({ skillId: pieces[0]!.skillId, slot: pieces[0]!.slot });
    failsWith(d, 'is already used by pieces[');
  });

  it('a piece slot outside boardSize is rejected', () => {
    const d = clone();
    vers(d)[0]!.def.boardSize = 1;
    (vers(d)[0]!.def.pieces as Array<Record<string, unknown>>)[1]!.slot = 5;
    failsWith(d, 'is outside boardSize');
  });

  it('isElite: false is rejected (the flag is present-or-absent, never false)', () => {
    const d = clone();
    vers(d)[0]!.def.isElite = false;
    failsWith(d, 'literally true');
  });

  it('an unsupported schemaVersion is rejected', () => {
    const d = clone(); (d as unknown as { schemaVersion: number }).schemaVersion = 2;
    failsWith(d, 'unsupported schemaVersion');
  });

  it('growth must be an array', () => {
    const d = clone();
    vers(d)[0]!.def.growth = 'cinder_dart';
    failsWith(d, 'growth must be an array of milestones');
  });

  it('an empty-string growth entry is rejected', () => {
    const d = clone();
    vers(d)[0]!.def.growth = [''];
    failsWith(d, 'growth milestone must be an object');
  });

  it('a non-string growth entry is rejected', () => {
    const d = clone();
    vers(d)[0]!.def.growth = [42];
    failsWith(d, 'growth milestone must be an object');
  });

  it('a growth list longer than the three-entry maximum is rejected', () => {
    const d = clone();
    vers(d)[0]!.def.growth = ['cinder_dart', 'scorching_brand', 'kindling_rite', 'ember_lash'];
    failsWith(d, 'more than MAX_GROWTH_CARDS (3)');
  });

  it('exports and validates the full ordered milestone shape without dropping duplicate permission', () => {
    const exported = enemyDocumentOf({ ...enemies.cinder_sprite!, growth: [milestone] });
    expect(exported.versions[0]!.def.growth).toEqual([{
      family: { kind: 'element', type: 'fire' }, purpose: 'complete-affinity',
      candidates: [{ skillId: 'fireball' }, { skillId: 'cinder_dart', allowDuplicate: true }],
    }]);
    expect(validateEnemyDocument({ schemaVersion: 1, enemies: [exported] })).toEqual([]);
  });

  it.each([
    [{ ...milestone, family: { kind: 'element', type: 'axe' } }, 'family.type'],
    [{ ...milestone, family: { kind: 'weapon', type: 'fire' } }, 'family.type'],
    [{ ...milestone, family: { kind: 'other', type: 'fire' } }, 'family.kind'],
    [{ ...milestone, purpose: 'more-power' }, 'purpose'],
    [{ ...milestone, candidates: [] }, 'non-empty array'],
    [{ ...milestone, candidates: ['cinder_dart'] }, 'candidate must be an object'],
    [{ ...milestone, candidates: [{ skillId: '' }] }, 'skillId'],
    [{ ...milestone, candidates: [{ skillId: 'cinder_dart', allowDuplicate: false }] }, 'literally true'],
    [{ ...milestone, candidates: [{ skillId: 'cinder_dart', allowDuplicates: true }] }, 'unknown candidate field'],
    [{ ...milestone, family: { kind: 'element', type: 'fire', axis: 'fire' } }, 'unknown family field'],
    [{ ...milestone, random: true }, 'unknown milestone field'],
  ])('rejects malformed milestone %j', (growth, reason) => {
    const d = clone();
    vers(d)[0]!.def.growth = [growth];
    failsWith(d, reason);
  });
});
