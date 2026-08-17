import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { actionsPriceDeci, capViolations, isOnBudget } from '../../src/engine/balance';
import { MAX_WARD_CHARGES, type SkillDef } from '../../src/engine/types';
import { validateSkillDocument } from '../../src/data/validateSkillContent';
import { findDuplicateKeys } from '../../scripts/jsonDuplicateKeys';
import document from '../../src/data/content/skills.v1.json';

const RAW = readFileSync(new URL('../../src/data/content/skills.v1.json', import.meta.url), 'utf8');

type Doc = { schemaVersion: number; cards: Array<Record<string, unknown>> };
type Entry = { version: number; def: Record<string, unknown> };
const clone = (): Doc => JSON.parse(JSON.stringify(document)) as Doc;
const vers = (d: Doc, i = 0): Entry[] => d.cards[i]!.versions as unknown as Entry[];
const failsWith = (d: Doc, fragment: string): void => {
  const problems = validateSkillDocument(d);
  expect(problems.length, 'expected at least one problem').toBeGreaterThan(0);
  expect(problems.map((p) => p.message).join(' | ')).toContain(fragment);
};

/**
 * THE CONTRACT'S TEETH.
 *
 * The content document is the single source that must carry everything needed to
 * SHOW what a card does and how it works. These tests pin the rules enforcing
 * that promise, and they are NEGATIVE cases on purpose: a schema test that only
 * asserts "the real file passes" proves nothing about what the schema would let
 * through, which is the whole question.
 */
describe('data: content schema contract', () => {
  it('the shipped document is clean — no duplicate keys, no schema problems', () => {
    expect(findDuplicateKeys(RAW)).toEqual([]);
    expect(validateSkillDocument(document)).toEqual([]);
  });

  it('RAW duplicate keys inside one object are caught (JSON.parse hides them)', () => {
    expect(JSON.parse('{"power":20,"power":999}')).toEqual({ power: 999 });
    const found = findDuplicateKeys('{"def":{"power":20,"power":999}}');
    expect(found).toHaveLength(1);
    expect(found[0]!.key).toBe('power');
  });

  it('the same key in DIFFERENT objects is legal', () => {
    expect(findDuplicateKeys('[{"id":"a"},{"id":"b"}]')).toEqual([]);
  });

  it('two documents sharing an id are rejected', () => {
    const d = clone();
    d.cards.push(JSON.parse(JSON.stringify(d.cards[0])) as Record<string, unknown>);
    failsWith(d, 'duplicate document for id');
  });

  it('two versions with the same number inside one document are rejected', () => {
    const d = clone();
    vers(d).push(JSON.parse(JSON.stringify(vers(d)[0])) as Entry);
    failsWith(d, 'duplicate version');
  });

  // ---- unknown fields are ERRORS, not warnings ----------------------------
  it('an unknown field in def is rejected (a typo must not validate)', () => {
    const d = clone();
    vers(d)[0]!.def.weappon = 'sword';
    failsWith(d, 'unknown field weappon');
  });

  it('an unknown field on an ACTION is rejected (the `capp` typo case)', () => {
    const d = clone();
    (vers(d)[0]!.def.effects as Array<Record<string, unknown>>)[0]!.capp = 5;
    failsWith(d, 'unknown field capp');
  });

  it('unknown envelope and version-entry fields are rejected', () => {
    const a = clone(); a.cards[0]!.flavour = 'x';
    failsWith(a, 'unknown envelope field flavour');
    const b = clone(); (vers(b)[0] as unknown as Record<string, unknown>).comment = 'x';
    failsWith(b, 'unknown field comment');
  });

  // ---- completeness: a card must be able to SHOW itself -------------------
  it('a magical card without an element is rejected', () => {
    const d = clone();
    const def = vers(d)[0]!.def;
    def.property = 'magical'; delete def.weapon; delete def.element;
    failsWith(d, 'MAGICAL card requires an element');
  });

  it('a physical card without a weapon is rejected', () => {
    const d = clone();
    const def = vers(d)[0]!.def;
    def.property = 'physical'; delete def.weapon; delete def.element;
    failsWith(d, 'PHYSICAL card requires a weapon');
  });

  it('a card typed by NEITHER element nor weapon is rejected', () => {
    const d = clone();
    const def = vers(d)[0]!.def;
    delete def.weapon; delete def.element;
    failsWith(d, 'must carry an element OR a weapon');
  });

  it('a card typed by BOTH is rejected (the face draws one type badge)', () => {
    const d = clone();
    const def = vers(d)[0]!.def;
    def.element = 'fire'; def.weapon = 'sword';
    failsWith(d, 'exactly ONE of element or weapon');
  });

  it('empty text or empty name is rejected', () => {
    const a = clone(); vers(a)[0]!.def.text = '   ';
    failsWith(a, 'the card must be able to SHOW what it does');
    const b = clone(); vers(b)[0]!.def.name = '';
    failsWith(b, 'name must be a non-empty string');
  });

  it('an empty archetypes list is rejected', () => {
    const d = clone(); vers(d)[0]!.def.archetypes = [];
    failsWith(d, 'NON-EMPTY array');
  });

  // ---- aura completeness (this shape used to crash simulate at first use) --
  it('an aura with no mods is rejected', () => {
    const d = clone(); vers(d)[0]!.def.aura = { affects: 'adjacent' };
    failsWith(d, 'mods is required');
  });

  it('an aura with an unknown direction is rejected', () => {
    const d = clone(); vers(d)[0]!.def.aura = { affects: 'diagonal', mods: { damageFlat: 5 } };
    failsWith(d, 'adjacent|left|right|allBoard');
  });

  it('an aura whose mods modify nothing is rejected', () => {
    const d = clone(); vers(d)[0]!.def.aura = { affects: 'adjacent', mods: {} };
    failsWith(d, 'at least one of');
  });

  // ---- numbers, ids, tiers, actions ---------------------------------------
  it('an unsafe integer is rejected', () => {
    const d = clone();
    (vers(d)[0]!.def.effects as Array<Record<string, unknown>>)[0]!.power = 1e300;
    failsWith(d, 'must be an integer');
  });

  it('an all-numeric card id is rejected (JS integer-key enumeration)', () => {
    const d = clone(); d.cards[0]!.id = '42';
    failsWith(d, 'all-numeric id is not allowed');
  });

  it('a tier upgrade that changes effects without text is rejected', () => {
    const d = clone();
    vers(d)[0]!.def.tierUpgrades = { silver: { effects: [{ kind: 'damage', power: 30 }] } };
    failsWith(d, 'must carry non-empty text');
  });

  it('an unknown action kind is rejected', () => {
    const d = clone();
    (vers(d)[0]!.def.effects as Array<Record<string, unknown>>)[0]!.kind = 'teleport';
    failsWith(d, 'unhandled action kind');
  });

  /**
   * CHARGE COUNTS ARE BOUNDED BY THE ENGINE'S APPLY-TIME CLAMP.
   *
   * Both directions are a SILENT ZERO, which is why the schema — not judgement —
   * has to hold the line:
   *
   *  - ABOVE the clamp, the card PAYS for a charge it can never receive.
   *    `applyAction` grants at most `MAX_WARD_CHARGES`, but `powerLevelDeci`
   *    charges the authored count, so `ward charges: 4` on a size-3 bronze card
   *    priced exactly on budget AND under the empower cap while the 4th charge
   *    was unreachable. The first test below pins that whole story: the two
   *    balance gates say yes, and the document validator is what says no.
   *  - BELOW zero, the card BUYS budget. Charges price linearly with no floor,
   *    so `ward charges: -3` refunds 150 deci (15 PL) of headroom for real
   *    damage, and the apply-time `Math.max(0, ...)` makes it a no-op.
   */
  describe('charge counts are bounded by the engine clamp', () => {
    const withEffects = (effects: Array<Record<string, unknown>>): Doc => {
      const d = clone();
      vers(d)[0]!.def.effects = effects;
      return d;
    };
    const passes = (effects: Array<Record<string, unknown>>): void => {
      expect(validateSkillDocument(withEffects(effects))).toEqual([]);
    };

    it('ward past MAX_WARD_CHARGES is rejected — the balance gates alone let it through', () => {
      const overClamp: SkillDef = {
        id: 'test_ward_over_clamp', name: 'Over-Warded', archetypes: ['defensive'],
        property: 'physical', size: 3, rarity: 'common', tier: 'bronze', weapon: 'sword',
        effects: [{ kind: 'ward', charges: MAX_WARD_CHARGES + 1 }, { kind: 'damage', power: 56 }],
        text: 'Ward 4. Deal 56 (+ATK) Sword damage.',
      };
      // The card the engine can never honour is, to the balance gates, perfect.
      expect(isOnBudget(overClamp), 'prices exactly on the bronze budget').toBe(true);
      expect(capViolations(overClamp), 'breaks no effect cap').toEqual([]);
      // The schema is the gate that catches it.
      failsWith(withEffects([{ kind: 'ward', charges: MAX_WARD_CHARGES + 1 }]), 'charges must be an integer 0..3');
    });

    it('negative charges are rejected for ward, negate and cleanse (they REFUND budget)', () => {
      failsWith(withEffects([{ kind: 'ward', charges: -3 }]), 'charges must be an integer 0..3');
      failsWith(withEffects([{ kind: 'negate', property: 'magical', charges: -1 }]), 'charges must be an integer 0..3');
      failsWith(withEffects([{ kind: 'cleanse', charges: -1 }]), 'charges must be an integer 0..999');
      // The refund is real, not theoretical — this is what the floor closes.
      expect(actionsPriceDeci([{ kind: 'ward', charges: -3 }], 'physical')).toBe(-150);
    });

    it('negate past its per-property clamp is rejected', () => {
      failsWith(withEffects([{ kind: 'negate', property: 'magical', charges: 4 }]), 'charges must be an integer 0..3');
    });

    it('every count the engine can actually grant still validates', () => {
      for (let n = 0; n <= MAX_WARD_CHARGES; n += 1) passes([{ kind: 'ward', charges: n }]);
      for (let n = 0; n <= 3; n += 1) passes([{ kind: 'negate', property: 'magical', charges: n }]);
      // cleanse has no engine clamp — spare charges simply find nothing to strip.
      for (const n of [0, 1, 4, 999]) passes([{ kind: 'cleanse', charges: n }]);
    });
  });
});
