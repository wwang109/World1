import { describe, expect, it } from 'vitest';
import { DRAFT_SET_KEYS, rollStartDraft } from '../../src/run/draft';
import { skillBook } from '../../src/data/skills';

describe('run/draft: rollStartDraft', () => {
  it('same seed -> identical sets', () => {
    const a = rollStartDraft(777);
    const b = rollStartDraft(777);
    expect(a).toEqual(b);
  });

  it('different seeds differ somewhere', () => {
    const a = rollStartDraft(1);
    const b = rollStartDraft(2);
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
  });

  it('rolls 4 sets of 5, all bronze tier', () => {
    const draft = rollStartDraft(42);
    for (const key of DRAFT_SET_KEYS) {
      expect(draft[key].length).toBe(5);
      for (const card of draft[key]) {
        expect(card.tier).toBe('bronze');
      }
    }
  });

  it('all 20 cards across all 4 sets are distinct', () => {
    for (const seed of [1, 2, 3, 42, 999, 123456]) {
      const draft = rollStartDraft(seed);
      const ids = DRAFT_SET_KEYS.flatMap((key) => draft[key].map((c) => c.skillId));
      expect(new Set(ids).size).toBe(20);
    }
  });

  it('each themed set matches its theme filter (wildcard is unconstrained)', () => {
    for (const seed of [1, 2, 3, 42, 999]) {
      const draft = rollStartDraft(seed);
      for (const card of draft.offense) {
        expect(skillBook[card.skillId]!.archetypes).toContain('offense');
      }
      for (const card of draft.defense) {
        const archetypes = skillBook[card.skillId]!.archetypes;
        expect(archetypes.includes('defensive') || archetypes.includes('healing')).toBe(true);
      }
      for (const card of draft.support) {
        const archetypes = skillBook[card.skillId]!.archetypes;
        expect(archetypes.includes('support') || archetypes.includes('debuff')).toBe(true);
      }
    }
  });

  it('every offered skillId exists in the skill book', () => {
    const draft = rollStartDraft(9001);
    for (const key of DRAFT_SET_KEYS) {
      for (const card of draft[key]) {
        expect(skillBook[card.skillId]).toBeDefined();
      }
    }
  });
});
