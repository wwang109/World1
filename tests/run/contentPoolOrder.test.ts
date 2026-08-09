import { describe, expect, it } from 'vitest';
import { skillBook } from '../../src/data/skills';
import { gemBook } from '../../src/data/gems';
import { cardPoolForShop, gemPoolForShop } from '../../src/run/shop';
import { shopTypeIds } from '../../src/data/shopTypes';

/**
 * CONTENT POOL ORDER IS PART OF THE CONTRACT (2026-08-09).
 *
 * `src/run/shop.ts`, `src/run/draft.ts` and `src/run/events.ts` build their
 * offer pools with `Object.values(skillBook)` / `Object.values(gemBook)` and
 * then draw from them with the SEEDED Rng. That makes iteration order silently
 * load-bearing: it decides which cards a given run seed is offered.
 *
 * Before this test, that order was the PHYSICAL AUTHORING ORDER of
 * `src/data/skills.ts` / `src/data/gems.ts`, and NOTHING pinned it — moving a
 * card within its file, or inserting one, changed every shop for every seed
 * while the whole suite stayed green. That is also precisely what a
 * content-format migration would trip: a JSON array or a document store is free
 * to hand rows back in any order it likes.
 *
 * So the books are now built in CANONICAL id-sorted order, and this test is what
 * keeps it that way. If it fails, do NOT "fix" it by re-sorting the assertion —
 * a book that is no longer id-sorted means run offers have moved for every seed.
 */
describe('run: content pool ordering', () => {
  it('skillBook iterates in canonical id order', () => {
    const ids = Object.keys(skillBook);
    expect(ids).toEqual([...ids].sort());
  });

  it('gemBook iterates in canonical id order', () => {
    const ids = Object.keys(gemBook);
    expect(ids).toEqual([...ids].sort());
  });

  it('every book id round-trips to a def carrying that same id (no key/id drift)', () => {
    for (const [id, def] of Object.entries(skillBook)) expect(def.id).toBe(id);
    for (const [id, def] of Object.entries(gemBook)) expect(def.id).toBe(id);
  });

  it('the SHOP pools every theme draws from are id-sorted, which is what fixes the draw per seed', () => {
    expect(shopTypeIds.length).toBeGreaterThan(0);
    // NB: an EMPTY pool is legitimate — `gemcutter` is a gem-only shop and
    // offers no cards at all. Order is what this test pins, not membership.
    for (const shopId of shopTypeIds) {
      const cardIds = cardPoolForShop(shopId).map((s) => s.id);
      expect(cardIds, `${shopId} card pool`).toEqual([...cardIds].sort());
      const gemIds = gemPoolForShop(shopId).map((g) => g.id);
      expect(gemIds, `${shopId} gem pool`).toEqual([...gemIds].sort());
    }
  });
});
