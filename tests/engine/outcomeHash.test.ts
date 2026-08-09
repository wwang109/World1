import { describe, expect, it } from 'vitest';
import { normalizeForHash, outcomeHash } from './helpers/outcomeHash';
import { simulate } from '../../src/engine/combat/simulate';
import { skillBook } from '../../src/data/skills';
import type { CombatConfig, SkillBook } from '../../src/engine/types';

/**
 * The outcome-baseline hash must be blind to card COPY and strict about
 * everything the sim reads. Both properties are load-bearing: the first stops
 * content copy-edits from forcing a fixture regeneration, the second is the
 * whole point of the regression lock.
 */
describe('outcomeHash normalization', () => {
  const duel = (book: SkillBook): CombatConfig => ({
    playerTeam: [
      {
        name: 'hero',
        stats: { maxHp: 200, hp: 200, attack: 10, magicPower: 0, armor: 0, magicResist: 0, speed: 10 },
        boardSize: 10,
        pieces: [{ skillId: 'sword_slash', slot: 0 }],
      },
    ],
    enemyTeam: [
      {
        name: 'foe',
        stats: { maxHp: 200, hp: 200, attack: 5, magicPower: 0, armor: 2, magicResist: 0, speed: 8 },
        boardSize: 10,
        pieces: [{ skillId: 'sword_slash', slot: 0 }],
      },
    ],
    skillBook: book,
    maxTurns: 12,
  });

  const run = (book: SkillBook): string => {
    const r = simulate(duel(book), 7);
    return outcomeHash({ events: r.events, finalState: r.finalState, result: r.result });
  };

  const base = skillBook.sword_slash!;

  it('is BLIND to card text and card name (presentation only — the sim never reads them)', () => {
    const retitled: SkillBook = {
      ...skillBook,
      sword_slash: { ...base, name: 'Completely Different Name', text: 'totally rewritten copy' },
    };
    expect(run(retitled)).toBe(run(skillBook));
  });

  it('still catches a behavioural change (an effect number the sim DOES read)', () => {
    const first = base.effects[0]!;
    if (first.kind !== 'damage') throw new Error('expected sword_slash to lead with a damage effect');
    const buffed: SkillBook = {
      ...skillBook,
      sword_slash: {
        ...base,
        effects: [{ ...first, power: first.power + 1 }, ...base.effects.slice(1)],
      },
    };
    expect(run(buffed)).not.toBe(run(skillBook));
  });

  it('strips `text` anywhere but keeps a non-SkillDef `name` (e.g. a combatant)', () => {
    const normalized = normalizeForHash({
      name: 'hero', // combatant name: a config input, still hashed
      skill: { id: 'x', property: 'physical', size: 1, effects: [], name: 'Card', text: 'copy' },
      nested: { text: 'copy', keep: 1 },
    }) as Record<string, Record<string, unknown>>;
    expect(normalized.name).toBe('hero');
    expect(normalized.skill).toEqual({ id: 'x', property: 'physical', size: 1, effects: [] });
    expect(normalized.nested).toEqual({ keep: 1 });
  });

  it('preserves arrays and nulls, and emits object keys in CANONICAL (sorted) order', () => {
    // Input keys are deliberately UNSORTED: z, list, a — and the nested object
    // is b-before-a. The serialisation must come back sorted at every depth.
    const input = { z: null, list: [1, { text: 'x', b: 2, a: 3 }], a: 1 };
    expect(JSON.stringify(normalizeForHash(input))).toBe(JSON.stringify({ a: 1, list: [1, { a: 3, b: 2 }], z: null }));
  });

  it('hashes the same for two objects that differ ONLY in key order (the loader-churn guard)', () => {
    // This is the property the content-format migration depends on: a loader
    // that builds a SkillDef with its own field order must not move the lock.
    const a = { id: 'x', property: 'physical', size: 1, effects: [{ kind: 'damage', power: 3 }] };
    const b = { effects: [{ power: 3, kind: 'damage' }], size: 1, property: 'physical', id: 'x' };
    expect(outcomeHash(a)).toBe(outcomeHash(b));
  });

  it('still separates two objects whose VALUES differ (sorting removes order, not signal)', () => {
    expect(outcomeHash({ a: 1, b: 2 })).not.toBe(outcomeHash({ a: 2, b: 1 }));
  });

  it('ARRAY order is still load-bearing (effects fire in order; the log is a sequence)', () => {
    expect(outcomeHash([1, 2])).not.toBe(outcomeHash([2, 1]));
  });
});
