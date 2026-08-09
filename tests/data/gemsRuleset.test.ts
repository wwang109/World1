import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { gemBook } from '../../src/data/gems';
import { gemPowerLevelDeci, isGemOnBudget } from '../../src/engine/balance';
import { categoryOfGem, payloadFingerprint, validateGemDocument } from '../../src/data/validateGemContent';
import { findDuplicateKeys } from '../../scripts/jsonDuplicateKeys';
import document from '../../src/data/content/gems.v1.json';
import type { Gem } from '../../src/engine/types';

const RAW = readFileSync(new URL('../../src/data/content/gems.v1.json', import.meta.url), 'utf8');

type Doc = { schemaVersion: number; gems: Array<Record<string, unknown>> };
type Entry = { version: number; def: Record<string, unknown> };
const clone = (): Doc => JSON.parse(JSON.stringify(document)) as Doc;
const gemAt = (d: Doc, id: string): Record<string, unknown> => d.gems.find((g) => g.id === id)!;
const defOf = (d: Doc, id: string): Record<string, unknown> => (gemAt(d, id).versions as unknown as Entry[])[0]!.def;
const failsWith = (d: Doc, fragment: string): void => {
  const problems = validateGemDocument(d);
  expect(problems.length, 'expected at least one problem').toBeGreaterThan(0);
  expect(problems.map((p) => p.message).join(' | ')).toContain(fragment);
};

/**
 * THE GEM CONTRACT'S TEETH — GEM RULESET v1 (game-director, 2026-08-09) §11.
 *
 * These rules are not style: each one encodes a way the catalog ACTUALLY drifted
 * before the 46 -> 35 migration. 11 gems were mechanical duplicates of another
 * gem; "Echo" named 33 unrelated flat chips; a Common gem out-healed a Legendary
 * by 4x. Written as NEGATIVE cases, because a test that only asserts "the real
 * file passes" says nothing about what the schema would let through.
 */
describe('data: gem ruleset contract', () => {
  it('the shipped document is clean — no duplicate keys, no problems', () => {
    expect(findDuplicateKeys(RAW)).toEqual([]);
    expect(validateGemDocument(document)).toEqual([]);
  });

  // ---- R1.1 category is derived from PAYLOAD; name + opener must agree ----
  it('derives the category from the payload, never from the name', () => {
    expect(categoryOfGem({ kind: 'stat', scope: 'card', mods: {} })).toBe('Core');
    expect(categoryOfGem({ kind: 'stat', scope: 'hero', mods: {} })).toBe('Charm');
    expect(categoryOfGem({ kind: 'effect', actions: [{ kind: 'poison', stacks: 2 }] })).toBe('Sliver');
    expect(categoryOfGem({ kind: 'effect', actions: [{ kind: 'statStrike', shareOf: 2, echoHostPower: true }] })).toBe('Echo');
  });

  it('rejects a name whose suffix disagrees with the payload', () => {
    const d = clone();
    defOf(d, 'swift_charm').name = 'Swift Sliver';
    failsWith(d, 'payload is a Charm but the name ends "Sliver"');
  });

  it('rejects a Core that does not open "This card:"', () => {
    const d = clone();
    defOf(d, 'war_banner_echo').text = 'Each hit +4 damage.';
    failsWith(d, 'must open its text with "This card:"');
  });

  it('rejects a Charm that does not open "Hero:"', () => {
    const d = clone();
    defOf(d, 'swift_charm').text = '+4 SPD.';
    failsWith(d, 'must open its text with "Hero:"');
  });

  it('rejects a Sliver that borrows another category opener', () => {
    const d = clone();
    defOf(d, 'venom_sliver').text = 'This card: apply Poison 2.';
    failsWith(d, 'opens like a Core');
  });

  // ---- R7 one kind, scope-matching mods only -----------------------------
  it('rejects an off-scope mods bundle (silently inert AND unpriced today)', () => {
    const d = clone();
    (defOf(d, 'swift_charm').mods as Record<string, unknown>).card = { damageFlat: 4 };
    failsWith(d, 'off-scope bundle is silently inert AND unpriced');
  });

  it('rejects an effect gem carrying stat-gem payload, and vice versa', () => {
    const a = clone();
    defOf(a, 'venom_sliver').scope = 'card';
    failsWith(a, 'scope belongs to a stat gem');
    const b = clone();
    defOf(b, 'swift_charm').actions = [{ kind: 'poison', stacks: 2 }];
    failsWith(b, 'actions belongs to an effect gem');
  });

  it('rejects an unknown mod key', () => {
    const d = clone();
    (defOf(d, 'swift_charm').mods as Record<string, Record<string, unknown>>).hero!.luck = 3;
    failsWith(d, 'unknown hero mod luck');
  });

  // ---- R8.1 payload uniqueness — the 11-duplicates problem ---------------
  it('rejects two gems with an identical payload at the same band (mechanical twins)', () => {
    const d = clone();
    const twin = JSON.parse(JSON.stringify(gemAt(d, 'venom_sliver'))) as Record<string, unknown>;
    twin.id = 'venom_sliver_two';
    (twin.versions as unknown as Entry[])[0]!.def.name = 'Venom Two Sliver';
    d.gems.push(twin);
    failsWith(d, 'mechanical twin of venom_sliver');
  });

  it('allows the SAME shape at a DIFFERENT band (a legal ladder rung, R8.3)', () => {
    const a = { kind: 'effect', rarity: 'common', actions: [{ kind: 'poison', stacks: 2 }] };
    const b = { kind: 'effect', rarity: 'rare', actions: [{ kind: 'poison', stacks: 4 }] };
    expect(payloadFingerprint(a)).not.toBe(payloadFingerprint(b));
  });

  it('fingerprints ignore name/text but not magnitude', () => {
    const base = { kind: 'effect', rarity: 'common', actions: [{ kind: 'poison', stacks: 2 }] };
    expect(payloadFingerprint({ ...base, name: 'A', text: 'x' })).toBe(payloadFingerprint({ ...base, name: 'B', text: 'y' }));
    expect(payloadFingerprint(base)).not.toBe(payloadFingerprint({ ...base, actions: [{ kind: 'poison', stacks: 3 }] }));
  });

  // ---- R6 hits are Echo-only, Legendary-only -----------------------------
  it('rejects a flat damage action on a gem (delivers ~1 after mitigation)', () => {
    const d = clone();
    defOf(d, 'venom_sliver').actions = [{ kind: 'damage', power: 4 }];
    failsWith(d, 'ONLY legal gem hit is an Echo');
  });

  it('rejects a hit on a non-Legendary gem', () => {
    const d = clone();
    const def = defOf(d, 'venom_sliver');
    def.actions = [{ kind: 'statStrike', shareOf: 2, echoHostPower: true }];
    def.name = 'Venom Echo';
    def.text = 'Echo: repeats.';
    failsWith(d, 'only a Legendary gem may carry an appended hit');
  });

  it('rejects an Echo whose name does not end Echo', () => {
    const d = clone();
    defOf(d, 'resonant_echo').name = 'Resonant Sliver';
    failsWith(d, 'name must end "Echo"');
  });

  it('rejects a CAPPED statStrike (a band-sized cap flattens the Echo)', () => {
    const d = clone();
    (defOf(d, 'resonant_echo').actions as Array<Record<string, unknown>>)[0]!.cap = 16;
    failsWith(d, 'capped statStrike is banned');
  });

  it('rejects weightIncreasePct on anything but an Echo', () => {
    const d = clone();
    defOf(d, 'venom_sliver').weightIncreasePct = 25;
    failsWith(d, 'only an Echo may carry it');
  });

  // ---- structurally unpriceable payloads, with the arithmetic -------------
  it('rejects stun / negate / cleanse and explains the band arithmetic', () => {
    const cases: Array<[string, Record<string, unknown>, string]> = [
      ['stun', { turns: 1 }, '100 deci/turn'],
      ['negate', { property: 'physical', charges: 1 }, '100 deci/charge'],
      ['cleanse', { charges: 1 }, '25/50/75/100'],
    ];
    for (const [kind, extra, fragment] of cases) {
      const d = clone();
      defOf(d, 'venom_sliver').actions = [{ kind, ...extra }];
      failsWith(d, fragment);
    }
  });

  it('rejects cooldownReduction (100 deci/turn, no band lands)', () => {
    const d = clone();
    defOf(d, 'venom_sliver').cooldownReduction = 1;
    failsWith(d, 'cooldownReduction costs 100 deci/turn');
  });

  it('rejects lifesteal above 60% and Core weightDelta below -2', () => {
    const a = clone();
    (defOf(a, 'leeching_fang_echo').actions as Array<Record<string, unknown>>)[0]!.pct = 90;
    failsWith(a, 'lifesteal is capped at 60%');
    const b = clone();
    (defOf(b, 'lightweight_core').mods as Record<string, Record<string, unknown>>).card!.weightDelta = -3;
    failsWith(b, 'weightDelta must be >= -2');
  });

  it('rejects a non-snake_case or all-numeric id', () => {
    const a = clone(); gemAt(a, 'venom_sliver').id = 'Venom-Sliver';
    failsWith(a, 'lowercase snake_case');
    const b = clone(); gemAt(b, 'venom_sliver').id = '42';
    failsWith(b, 'lowercase snake_case');
  });

  // ---- R4.1 minimal magnitude (a BALANCE rule: it needs the PRICE tables) --
  it('every shipped magnitude is MINIMAL for its band — no floor twins', () => {
    const twins: string[] = [];
    for (const gem of Object.values(gemBook)) {
      const base = gemPowerLevelDeci(gem);
      for (const [path, smaller] of smallerVariants(gem)) {
        if (gemPowerLevelDeci(smaller) === base && isGemOnBudget(smaller)) { twins.push(gem.id + ' ' + path); break; }
      }
    }
    expect(twins, 'gems whose magnitude could be smaller for the same price').toEqual([]);
  });

  it('the floor-twin detector actually fires (lifesteal 31% prices the same as 30%)', () => {
    const base = gemBook.leeching_fang_echo!;
    const at = (pct: number): Gem => {
      const g = JSON.parse(JSON.stringify(base)) as Extract<Gem, { kind: 'effect' }>;
      (g.actions[0] as unknown as Record<string, unknown>).pct = pct;
      return g;
    };
    expect(gemPowerLevelDeci(at(31))).toBe(gemPowerLevelDeci(at(30)));
    expect(isGemOnBudget(at(31))).toBe(true);
    const flagged = [...smallerVariants(at(31))].some(([, g]) => gemPowerLevelDeci(g) === gemPowerLevelDeci(at(31)) && isGemOnBudget(g));
    expect(flagged, 'a 31% lifesteal gem must be flagged as a floor twin').toBe(true);
  });
});

const MAG_KEYS = ['power', 'stacks', 'turns', 'pct', 'amount', 'weight', 'charges', 'shareOf'];

/** Every same-sign magnitude strictly smaller than the authored one, one field at a time. */
function* smallerVariants(gem: Gem): Generator<[string, Gem]> {
  const steps = (v: number): number[] => (v > 0
    ? Array.from({ length: v - 1 }, (_, i) => i + 1)
    : Array.from({ length: -v - 1 }, (_, i) => -(i + 1)));
  if (gem.kind === 'effect') {
    for (let i = 0; i < gem.actions.length; i += 1) {
      const action = gem.actions[i] as unknown as Record<string, unknown>;
      for (const k of Object.keys(action)) {
        if (!MAG_KEYS.includes(k)) continue;
        const v = action[k];
        if (typeof v !== 'number') continue;
        for (const smaller of steps(v)) {
          const c = JSON.parse(JSON.stringify(gem)) as Extract<Gem, { kind: 'effect' }>;
          (c.actions[i] as unknown as Record<string, unknown>)[k] = smaller;
          yield ['actions[' + String(i) + '].' + k, c];
        }
      }
    }
  } else {
    const bundle = (gem.mods as unknown as Record<string, Record<string, number>>)[gem.scope] ?? {};
    for (const k of Object.keys(bundle)) {
      for (const smaller of steps(bundle[k]!)) {
        const c = JSON.parse(JSON.stringify(gem)) as Extract<Gem, { kind: 'stat' }>;
        (c.mods as unknown as Record<string, Record<string, number>>)[gem.scope]![k] = smaller;
        yield ['mods.' + gem.scope + '.' + k, c];
      }
    }
  }
}
