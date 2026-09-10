import { describe, expect, it } from 'vitest';
import { enemies } from '../../src/data/enemies';
import { enemyDerivedAffinity } from '../../src/data/enemyAffinity';
import { validateEnemyAffinityMatchesBoard } from '../../src/data/validateEnemyContent';

/**
 * THE PERMANENT GUARD for the 2026-09-06 ruling ("affinity are just passive
 * buffs based on the board … there should be no hardcoded enemy that break
 * the rule"): `elementAffinity`/`weaponAffinity` were removed from every
 * entry in `src/data/enemies.ts`, but the fields themselves still exist on
 * `EnemyDef` (`src/engine/types.ts`, out of this change's reach — see that
 * file's own doc history) and are still schema-legal
 * (`validateEnemyContent.ts`'s `validateDef` still accepts them, and a whole
 * enemy may legitimately carry both at once, unlike a card — see
 * `enemiesContentSchema.test.ts`'s dedicated case). Nothing at the TYPE level
 * stops a future enemy from authoring one again.
 *
 * This suite is what stops it in practice: it runs
 * `validateEnemyAffinityMatchesBoard` (the enforcement function,
 * `src/data/validateEnemyContent.ts`) against every enemy's OWN authored
 * fields and its OWN derived board affinity
 * (`enemyDerivedAffinity`/`boardAffinities`) — an authored value that the
 * board does not produce fails here, on the next `npm test`, before it ships.
 */
describe('data: enemy affinity is board-derived only — no authored override may disagree with it', () => {
  it('the live roster authors nothing that disagrees with its own derived board affinity (today: nothing authors anything at all)', () => {
    const problems = Object.values(enemies).flatMap((enemy) => (
      validateEnemyAffinityMatchesBoard(enemy.id, enemy, enemyDerivedAffinity(enemy))
    ));
    expect(problems).toEqual([]);
  });

  it('confirms the roster really authors neither field any more (the guard above would be vacuous otherwise)', () => {
    for (const enemy of Object.values(enemies)) {
      expect(enemy.elementAffinity, enemy.id).toBeUndefined();
      expect(enemy.weaponAffinity, enemy.id).toBeUndefined();
    }
  });

  it('rejects a future authored value the board does not produce (proves the guard is not vacuous)', () => {
    const problems = validateEnemyAffinityMatchesBoard('test_enemy', { elementAffinity: 'fire' }, {});
    expect(problems.length).toBeGreaterThan(0);
    expect(problems[0]!.message).toContain('affinity is board-derived only');
  });

  it('rejects an authored value that disagrees with a board that DOES derive the other axis', () => {
    const problems = validateEnemyAffinityMatchesBoard(
      'test_enemy',
      { weaponAffinity: 'sword' },
      { weaponAffinity: 'axe' },
    );
    expect(problems.length).toBeGreaterThan(0);
    expect(problems[0]!.message).toContain('sword');
    expect(problems[0]!.message).toContain('axe');
  });

  it('accepts an authored value that matches the derived board exactly (the field stays legal, just redundant)', () => {
    const problems = validateEnemyAffinityMatchesBoard(
      'test_enemy',
      { weaponAffinity: 'bow', elementAffinity: 'nature' },
      { weaponAffinity: 'bow', elementAffinity: 'nature' },
    );
    expect(problems).toEqual([]);
  });

  it('accepts an enemy that authors nothing at all, whatever the board derives', () => {
    expect(validateEnemyAffinityMatchesBoard('test_enemy', {}, { weaponAffinity: 'lance' })).toEqual([]);
    expect(validateEnemyAffinityMatchesBoard('test_enemy', {}, {})).toEqual([]);
  });
});
