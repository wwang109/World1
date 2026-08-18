import { describe, expect, it } from 'vitest';
import { enemies } from '../../src/data/enemies';
import { enemyBookFromJson, enemyContentMeta } from '../../src/data/enemiesContent';
import { validateEnemyDocument } from '../../src/data/validateEnemyContent';
import document from '../../src/data/content/enemies.v1.json';

/**
 * PARITY PROOF for enemies.v1.json against the live TS book, the twin of
 * tests/data/skillsJsonParity.test.ts / gemsJsonParity.test.ts.
 *
 * UNLIKE its skills/gems siblings this is NOT a migration proof — there is no
 * prior enemies.v1.json to preserve back-compat with and no runtime consumer
 * switching over; src/data/enemies.ts stays the one and only source of
 * truth. This file exists purely to prove the GENERATED document agrees with
 * its source, which is the property that makes "regenerate" a safe,
 * mechanical answer to every future roster change instead of a hand merge.
 *
 * Because there is no migration-era frozen set to scope to, this compares the
 * WHOLE books directly — no MIGRATED_*_IDS frozen-list indirection, and
 * therefore nothing to get the frozen-list bug wrong in the first place
 * (skillsJsonParity.test.ts / gemsJsonParity.test.ts were both fixed this
 * session for pinning that list where a subset check was correct: an enemy
 * being ADDED to enemies.ts is not a regression, only one VANISHING from the
 * generated document while still present in the TS book — or vice versa —
 * is). If enemies.ts changes without a `npm run content:export` re-run
 * afterwards, THIS test is what goes red, not
 * enemiesExportIdempotency.test.ts's byte check alone.
 */
describe('data: enemies.v1.json is behaviour-identical to the TS book', () => {
  it('carries exactly the same id set as the TS book (an enemy vanishing from either side is a regression)', () => {
    expect(Object.keys(enemyBookFromJson).sort()).toEqual(Object.keys(enemies).sort());
  });

  it('deep-equals the TS book across every enemy', () => {
    expect(enemyBookFromJson).toStrictEqual(enemies);
  });

  it('every enemy round-trips field-for-field, including optional fields', () => {
    for (const id of Object.keys(enemies)) {
      const ts = enemies[id]!;
      const js = enemyBookFromJson[id]!;
      expect(Object.keys(js).sort(), id + ' field set').toEqual(Object.keys(ts).sort());
      expect(js, id).toStrictEqual(ts);
    }
  });

  it('carries NO schema meta on the EnemyDef itself (version/notes are sidecar only)', () => {
    for (const [id, def] of Object.entries(enemyBookFromJson)) {
      const keys = Object.keys(def);
      expect(keys, id).not.toContain('version');
      expect(keys, id).not.toContain('notes');
    }
  });

  it('resolves every enemy to exactly one version today', () => {
    for (const id of Object.keys(enemyBookFromJson)) {
      expect(enemyContentMeta[id]!.versions, id).toEqual([1]);
      expect(enemyContentMeta[id]!.version, id).toBe(1);
    }
  });

  it('validates clean — the contract has ONE outcome, so any problem is a failure', () => {
    expect(validateEnemyDocument(document)).toEqual([]);
  });

  it('every enemy exposes a version in the sidecar', () => {
    for (const id of Object.keys(enemyBookFromJson)) {
      expect(enemyContentMeta[id]!.version, id).toBeGreaterThanOrEqual(1);
    }
  });
});
