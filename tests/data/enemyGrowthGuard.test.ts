import { describe, expect, it } from 'vitest';
import { enemies } from '../../src/data/enemies';
import { skillBook } from '../../src/data/skills';
import { GENERIC_GROWTH_CARDS } from '../../src/run/encounter';
import { MAX_GROWTH_CARDS, validateEnemyGrowthCardsExist } from '../../src/data/validateEnemyContent';

/**
 * THE PERMANENT GUARD for `EnemyDef.growth`: every candidate ID in every
 * ordered milestone must exist in the skill book, including unused fallbacks.
 * Runtime tries candidates in authored order and throws EnemyGrowthResolutionError
 * when none qualifies; this guard also rejects unknown IDs hidden by a valid
 * fallback. It runs with both books available, keeping the schema validator
 * independent of the skill book's load order.
 */
describe('data: enemy growth cards must exist in the skill book', () => {
  it('the live roster names only existing skills, including unused fallback candidates', () => {
    const knownIds = new Set(Object.keys(skillBook));
    const problems = Object.values(enemies).flatMap((enemy) => (
      validateEnemyGrowthCardsExist(enemy.id, enemy.growth, knownIds)
    ));
    expect(problems).toEqual([]);
  });

  it('every live enemy has a nonempty short sequence, so candidate validation cannot pass vacuously', () => {
    for (const enemy of Object.values(enemies)) {
      expect(enemy.growth?.length, enemy.id).toBeGreaterThanOrEqual(1);
      expect(enemy.growth!.length, enemy.id).toBeLessThanOrEqual(2);
      for (const milestone of enemy.growth!) {
        expect(milestone.candidates.length, enemy.id).toBeGreaterThan(0);
        for (const candidate of milestone.candidates) {
          const card = skillBook[candidate.skillId];
          expect(card, `${enemy.id}/${candidate.skillId}`).toBeDefined();
          expect(card![milestone.family.kind], `${enemy.id}/${candidate.skillId}`).toBe(milestone.family.type);
        }
      }
    }
  });

  it('rejects a future growth list that names an id the skill book does not have (proves the guard is not vacuous)', () => {
    const problems = validateEnemyGrowthCardsExist('test_enemy', [{ family: { kind: 'element', type: 'fire' }, purpose: 'reinforce-family', candidates: [{ skillId: 'cinder_dart' }, { skillId: 'not_a_real_skill_id' }] }], new Set(Object.keys(skillBook)));
    expect(problems.length).toBeGreaterThan(0);
    expect(problems[0]!.message).toContain('not_a_real_skill_id');
  });

  it('accepts a growth list whose every id is real', () => {
    const realId = Object.keys(skillBook)[0]!;
    const problems = validateEnemyGrowthCardsExist('test_enemy', [{ family: { kind: 'element', type: 'fire' }, purpose: 'reinforce-family', candidates: [{ skillId: realId }] }], new Set(Object.keys(skillBook)));
    expect(problems).toEqual([]);
  });

  it('accepts an enemy with no growth list at all', () => {
    expect(validateEnemyGrowthCardsExist('test_enemy', undefined, new Set())).toEqual([]);
  });

  /**
   * SYNC GUARD: `MAX_GROWTH_CARDS` (`validateEnemyContent.ts`, the schema's
   * own length cap) and `GENERIC_GROWTH_CARDS` (`encounter.ts`, the PL
   * ledger's pre-draw worst-case estimate) are two SEPARATE literals on
   * purpose — `src/data` may not depend on `src/run` (the reverse of this
   * project's layering direction) — but they must stay numerically equal, or
   * a longer-than-priced growth list could ship and silently under-price the
   * PL ledger. This is the test that would catch that drift.
   */
  it('MAX_GROWTH_CARDS (schema cap) stays equal to GENERIC_GROWTH_CARDS (PL ledger estimate)', () => {
    expect(MAX_GROWTH_CARDS).toBe(GENERIC_GROWTH_CARDS);
  });
});
