import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { actionsPriceDeci, capViolations, isOnBudget, MAX_EXPOSE_PCT, MAX_GUARD_PCT } from '../../src/engine/balance';
import { MAX_WARD_CHARGES, type SkillDef } from '../../src/engine/types';
import { validateSkillDocument } from '../../src/data/validateSkillContent';
import { currentVersionOf } from '../../src/data/skillsContent';
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

  it('currentVersionOf resolves CURRENT by highest version, independent of array order (rehomed from the migration proof at cutover)', () => {
    // The rule must not be "the last element": a document store may hand the
    // list back in any order, and array position is authoring convenience
    // only. This is a pure-function property with no dependency on the TS
    // book that used to prove it, so it outlives that book's deletion.
    const ascending = [{ version: 1, tag: 'old' }, { version: 2, tag: 'new' }];
    const descending = [{ version: 2, tag: 'new' }, { version: 1, tag: 'old' }];
    const jumbled = [{ version: 3, tag: 'newest' }, { version: 1, tag: 'old' }, { version: 2, tag: 'mid' }];
    expect(currentVersionOf(ascending).tag).toBe('new');
    expect(currentVersionOf(descending).tag).toBe('new');
    expect(currentVersionOf(jumbled).tag).toBe('newest');
    expect(currentVersionOf([{ version: 7, tag: 'only' }]).tag).toBe('only');
  });

  it('carries no raw non-ASCII bytes — the committed convention this document must keep (rehomed from the exporter\'s idempotency check at cutover)', () => {
    // The diagnostic this was originally found with: an un-escaped export
    // rewrites every `\\uXXXX` site (em dash, middle dot, ...) as a raw UTF-8
    // character. Pinned against the committed file's raw bytes directly, with
    // no dependency on the exporter that used to generate them, so the RULE
    // (skills.v1.json stays ASCII) outlives the MECHANISM (a TS-book exporter)
    // that produced it. gems.v1.json is deliberately NOT held to this — see
    // scripts/exportGems.ts's own doc comment — so this check is skills-only.
    // eslint-disable-next-line no-control-regex
    expect(/[^\x00-\x7f]/.test(RAW)).toBe(false);
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
    // Find any card whose FIRST effect carries a `power` field, rather than
    // assuming `cards[0]` does: the document is sorted by id, so authoring a
    // new card that sorts first (e.g. a `ward` kit, which has no `power`
    // field at all) would otherwise silently break this test's premise
    // without failing loudly — exactly the kind of position-dependent
    // fragility this file's own doc comment warns against.
    const idx = d.cards.findIndex((c) => {
      const first = (vers(d, d.cards.indexOf(c))[0]!.def.effects as Array<Record<string, unknown>> | undefined)?.[0];
      return typeof first?.power === 'number';
    });
    expect(idx, 'expected at least one card whose first effect has a power field').toBeGreaterThanOrEqual(0);
    (vers(d, idx)[0]!.def.effects as Array<Record<string, unknown>>)[0]!.power = 1e300;
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

  // ---- tier-block scope: the field that buys an ABILITY at a tier ---------
  it('a tier-block scope outside the one|all union is rejected', () => {
    const d = clone();
    vers(d)[0]!.def.tierUpgrades = { silver: { scope: 'every', text: 'Hits every foe.' } };
    failsWith(d, 'scope must be one or all');
  });

  it('a tier block that changes scope without text is rejected (the card face would lie)', () => {
    const d = clone();
    vers(d)[0]!.def.tierUpgrades = { diamond: { scope: 'all' } };
    failsWith(d, 'must carry non-empty text');
  });

  it('a tier-block scope that is not carried to every HIGHER tier is rejected', () => {
    // Gold goes AoE, Diamond says nothing → `applyTier` would rebuild Diamond
    // from the BASE card and silently drop the AoE: a downgrade for paying more.
    const d = clone();
    vers(d)[0]!.def.tierUpgrades = { gold: { scope: 'all', text: 'Hits every foe.' } };
    failsWith(d, 'must be carried by every higher tier');
  });

  it('carrying scope up through Diamond validates', () => {
    const d = clone();
    vers(d)[0]!.def.tierUpgrades = {
      gold: { scope: 'all', text: 'Hits every foe.' },
      diamond: { scope: 'all', text: 'Hits every foe, harder.' },
    };
    expect(validateSkillDocument(d)).toEqual([]);
  });

  it('a tier block WITHOUT scope is unaffected by the carry-up rule', () => {
    const d = clone();
    vers(d)[0]!.def.tierUpgrades = { silver: { speedWeight: 12 } };
    expect(validateSkillDocument(d)).toEqual([]);
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

  /**
   * `expose`/`guard` PCT IS BOUNDED BY THE ENGINE'S APPLY-TIME CLAMP — the
   * SAME shape as the `ward`/`negate` charge-count story above, one section
   * up, applied to a `product` (pct × turns) rider instead of a `perUnit`
   * charge count:
   *
   *  - ABOVE the clamp, the card pays PL for amplification it will never
   *    deliver: `interpreter.ts` clamps `expose` to <=50% and `guard` to
   *    <=60% at apply time, but `powerLevelDeci` charges the authored pct.
   *  - BELOW zero, the card BUYS budget for a rider with no apply-time floor
   *    of its own — a negative `pct`/`turns` product prices negatively with
   *    nothing on the engine side to stop it.
   */
  describe('expose/guard pct is bounded by the engine clamp (fail-open close, 2026-08-17)', () => {
    const withEffects = (effects: Array<Record<string, unknown>>): Doc => {
      const d = clone();
      vers(d)[0]!.def.effects = effects;
      return d;
    };
    const passes = (effects: Array<Record<string, unknown>>): void => {
      expect(validateSkillDocument(withEffects(effects))).toEqual([]);
    };

    it('expose pct:100 turns:1 is rejected — the balance gates alone let it through', () => {
      const overClamp: SkillDef = {
        id: 'test_expose_over_clamp', name: 'Over-Exposed', archetypes: ['debuff'],
        property: 'magical', element: 'dark', size: 1, rarity: 'common', tier: 'bronze',
        effects: [{ kind: 'expose', pct: 100, turns: 1 }],
        text: 'Expose 100% for 1 turn.',
      };
      // The engine only ever delivers 50% (Math.min(50, ...)); the balance
      // gates see a card that prices exactly on budget and breaks no cap.
      expect(isOnBudget(overClamp), 'prices exactly on the bronze budget').toBe(true);
      expect(capViolations(overClamp), 'breaks no effect cap').toEqual([]);
      failsWith(withEffects([{ kind: 'expose', pct: 100, turns: 1 }]), `pct must be an integer 1..${MAX_EXPOSE_PCT}`);
    });

    it('guard pct:100 turns:1 is rejected — the balance gates alone let it through', () => {
      const overClamp: SkillDef = {
        id: 'test_guard_over_clamp', name: 'Over-Guarded', archetypes: ['defensive'],
        property: 'magical', element: 'holy', size: 1, rarity: 'common', tier: 'bronze',
        effects: [{ kind: 'guard', property: 'magical', pct: 100, turns: 1 }],
        text: 'Guard 100% for 1 turn.',
      };
      // The engine only ever delivers 60% (Math.min(60, ...)).
      expect(isOnBudget(overClamp), 'prices exactly on the bronze budget').toBe(true);
      expect(capViolations(overClamp), 'breaks no effect cap').toEqual([]);
      failsWith(withEffects([{ kind: 'guard', property: 'magical', pct: 100, turns: 1 }]), `pct must be an integer 0..${MAX_GUARD_PCT}`);
    });

    it('every pct the engine can actually deliver still validates', () => {
      for (const n of [1, 25, MAX_EXPOSE_PCT]) passes([{ kind: 'expose', pct: n, turns: 1 }]);
      for (const n of [0, 30, MAX_GUARD_PCT]) passes([{ kind: 'guard', property: 'magical', pct: n, turns: 1 }]);
    });

    it('a ZERO expose is rejected too — the engine drops it outright, so it is dead content (2026-08-18)', () => {
      // `interpreter.ts`'s expose arm breaks on `pct <= 0 || turns <= 0` before
      // any status exists, because a 0-priced application used to still arm
      // anti-heal, bait a cleanse charge, drain a ward and hold someone else's
      // pile open. `guard` has no such drop, so its own 0 still validates above.
      failsWith(withEffects([{ kind: 'expose', pct: 0, turns: 2 }]), `pct must be an integer 1..${MAX_EXPOSE_PCT}`);
      failsWith(withEffects([{ kind: 'expose', pct: 30, turns: 0 }]), 'turns must be an integer 1..99');
    });
  });

  /**
   * NEGATIVE MAGNITUDES REFUND BUDGET FOR A NO-OP — one more shape of the same
   * fail-open hole, this time on riders the engine turns into a harmless
   * no-op rather than clamping to a smaller positive value: `expose`/`guard`
   * (negative pct), `lifesteal` (negative pct: `stolen <= 0` breaks before any
   * heal) and `slow` (negative weight: `Math.max(pending, weight)` never
   * LOWERS the pending penalty).
   */
  describe('negative magnitudes are rejected — they REFUND budget for a no-op (fail-open close, 2026-08-17)', () => {
    const withEffects = (effects: Array<Record<string, unknown>>): Doc => {
      const d = clone();
      vers(d)[0]!.def.effects = effects;
      return d;
    };

    it('negative pct is rejected for expose and guard', () => {
      failsWith(withEffects([{ kind: 'expose', pct: -20, turns: 5 }]), `pct must be an integer 1..${MAX_EXPOSE_PCT}`);
      failsWith(withEffects([{ kind: 'guard', property: 'magical', pct: -50, turns: 2 }]), `pct must be an integer 0..${MAX_GUARD_PCT}`);
      // The refund is real, not theoretical — this is what the floor closes.
      expect(actionsPriceDeci([{ kind: 'expose', pct: -20, turns: 5 }], 'magical')).toBe(-100);
      expect(actionsPriceDeci([{ kind: 'guard', property: 'magical', pct: -50, turns: 2 }], 'magical')).toBe(-100);
    });

    it('negative pct is rejected for lifesteal', () => {
      failsWith(withEffects([{ kind: 'lifesteal', pct: -150 }]), 'pct must be an integer 0..1000');
      expect(actionsPriceDeci([{ kind: 'lifesteal', pct: -150 }], 'magical')).toBe(-100);
    });

    it('negative weight is rejected for slow', () => {
      failsWith(withEffects([{ kind: 'slow', weight: -8 }]), 'weight must be an integer 0..999');
      expect(actionsPriceDeci([{ kind: 'slow', weight: -8 }], 'physical')).toBe(-20);
    });
  });
});
