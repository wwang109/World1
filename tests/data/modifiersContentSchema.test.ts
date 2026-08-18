import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { validateModifierDocument } from '../../src/data/validateModifierContent';
import { findDuplicateKeys } from '../../scripts/jsonDuplicateKeys';
import document from '../../src/data/content/modifiers.v1.json';

const RAW = readFileSync(new URL('../../src/data/content/modifiers.v1.json', import.meta.url), 'utf8');

type Doc = { schemaVersion: number; modifiers: Array<Record<string, unknown>> };
type Entry = { version: number; def: Record<string, unknown> };
const clone = (): Doc => JSON.parse(JSON.stringify(document)) as Doc;
const vers = (d: Doc, i = 0): Entry[] => d.modifiers[i]!.versions as unknown as Entry[];
const failsWith = (d: Doc, fragment: string): void => {
  const problems = validateModifierDocument(d);
  expect(problems.length, 'expected at least one problem').toBeGreaterThan(0);
  expect(problems.map((p) => p.message).join(' | ')).toContain(fragment);
};

/**
 * THE CONTRACT'S TEETH for modifiers.v1.json — the twin of
 * tests/data/enemiesContentSchema.test.ts, scoped to
 * `validateModifierContent.ts`'s smaller surface (a modifier preset has
 * exactly two effect shapes: a PL auto-spend, or a tier override). Negative
 * cases on purpose: a schema test that only asserts "the real file passes"
 * proves nothing about what the schema would let through — the brief for
 * this validator is specifically that it rejects an unknown `forceTier`, a
 * missing name/blurb, and an out-of-range tuning value, so each of those is
 * exercised below alongside the modifier-specific cross-field checks.
 */
describe('data: modifiers content schema contract', () => {
  it('the shipped document is clean — no duplicate keys, no schema problems', () => {
    expect(findDuplicateKeys(RAW)).toEqual([]);
    expect(validateModifierDocument(document)).toEqual([]);
  });

  it('two documents sharing an id are rejected', () => {
    const d = clone();
    d.modifiers.push(JSON.parse(JSON.stringify(d.modifiers[0])) as Record<string, unknown>);
    failsWith(d, 'duplicate document for id');
  });

  it('two versions with the same number inside one document are rejected', () => {
    const d = clone();
    vers(d).push(JSON.parse(JSON.stringify(vers(d)[0])) as Entry);
    failsWith(d, 'duplicate version');
  });

  it('an all-numeric id is rejected', () => {
    const d = clone(); d.modifiers[0]!.id = '42';
    failsWith(d, 'an all-numeric id is not allowed');
  });

  it('an unknown field in def is rejected (a typo must not validate)', () => {
    const d = clone();
    vers(d)[0]!.def.forcetier = 'diamond';
    failsWith(d, 'unknown field forcetier');
  });

  it('an unknown forceTier value is rejected', () => {
    const d = clone();
    vers(d)[0]!.def.forceTier = 'platinum';
    failsWith(d, 'must be bronze|silver|gold|diamond');
  });

  it('empty name is rejected', () => {
    const d = clone(); vers(d)[0]!.def.name = '';
    failsWith(d, 'name must be a non-empty string');
  });

  it('a missing name is rejected', () => {
    const d = clone(); delete vers(d)[0]!.def.name;
    failsWith(d, 'missing required field name');
  });

  it('empty blurb is rejected', () => {
    const d = clone(); vers(d)[0]!.def.blurb = '';
    failsWith(d, 'blurb must be a non-empty string');
  });

  it('a missing blurb is rejected', () => {
    const d = clone(); delete vers(d)[0]!.def.blurb;
    failsWith(d, 'missing required field blurb');
  });

  it('bonusPL out of range is rejected', () => {
    const d = clone();
    const swift = d.modifiers.find((m) => m.id === 'swift')!;
    (swift.versions as unknown as Entry[])[0]!.def.bonusPL = 0;
    failsWith(d, 'bonusPL must be an integer 1..999');
  });

  it('bonusPL without a bonusProfile is rejected (a bonus that would silently never apply)', () => {
    const d = clone();
    const swift = d.modifiers.find((m) => m.id === 'swift')!;
    delete (swift.versions as unknown as Entry[])[0]!.def.bonusProfile;
    failsWith(d, 'bonusPL and bonusProfile must both be present or both be absent');
  });

  it('bonusProfile without a bonusPL is rejected (the same pairing rule, other direction)', () => {
    const d = clone();
    const diamond = d.modifiers.find((m) => m.id === 'diamond')!;
    (diamond.versions as unknown as Entry[])[0]!.def.bonusProfile = { speed: 1 };
    failsWith(d, 'bonusPL and bonusProfile must both be present or both be absent');
  });

  it('an unknown bonusProfile stat field is rejected', () => {
    const d = clone();
    const swift = d.modifiers.find((m) => m.id === 'swift')!;
    (swift.versions as unknown as Entry[])[0]!.def.bonusProfile = { luck: 1 };
    failsWith(d, 'unknown profile field luck');
  });

  it('an empty bonusProfile object is rejected (spends the bonus on nothing)', () => {
    const d = clone();
    const swift = d.modifiers.find((m) => m.id === 'swift')!;
    (swift.versions as unknown as Entry[])[0]!.def.bonusProfile = {};
    failsWith(d, 'bonusProfile must carry at least one stat weight');
  });

  it('a bonusProfile weight out of range is rejected', () => {
    const d = clone();
    const swift = d.modifiers.find((m) => m.id === 'swift')!;
    (swift.versions as unknown as Entry[])[0]!.def.bonusProfile = { speed: -1 };
    failsWith(d, 'speed must be an integer 0..1000');
  });

  it('a modifier with no effect at all (no bonusPL/bonusProfile, no forceTier) is rejected', () => {
    const d = clone();
    const diamond = d.modifiers.find((m) => m.id === 'diamond')!;
    delete (diamond.versions as unknown as Entry[])[0]!.def.forceTier;
    failsWith(d, 'a modifier must define at least one effect');
  });

  it('an unsupported schemaVersion is rejected', () => {
    const d = clone(); (d as unknown as { schemaVersion: number }).schemaVersion = 2;
    failsWith(d, 'unsupported schemaVersion');
  });

  it('id/version inside def is rejected (those belong on the envelope)', () => {
    const d = clone();
    vers(d)[0]!.def.id = 'diamond';
    failsWith(d, 'id belongs on the document envelope');
  });
});
