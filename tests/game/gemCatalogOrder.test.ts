import { describe, expect, it } from 'vitest';
import { gemBook } from '../../src/data/gems';
import { gemCatalogOrder } from '../../src/game/ui/gemGlossary';

/**
 * The gem CATALOG surfaces (both wikis, the UI kit) group by rarity. That
 * grouping used to be an ACCIDENT of `src/data/gems.ts` being authored
 * Common-first and the scenes rendering raw `Object.values(gemBook)`; nothing
 * declared it and no test held it. Now that the book is id-sorted (so authoring
 * order can never be load-bearing), the grouping is an explicit presentation
 * decision in `gemCatalogOrder` — and this is what proves the catalogue still
 * reads the way it always did.
 */
describe('game/ui: gem catalog display order', () => {
  const RANK = { common: 0, rare: 1, epic: 2, legendary: 3 } as const;

  it('groups by ascending rarity, then name — regardless of the book order it is handed', () => {
    const ordered = gemCatalogOrder(Object.values(gemBook));
    expect(ordered).toHaveLength(Object.keys(gemBook).length);
    for (let i = 1; i < ordered.length; i += 1) {
      const prev = ordered[i - 1]!;
      const cur = ordered[i]!;
      const drop = RANK[cur.rarity] - RANK[prev.rarity];
      expect(drop, `${prev.id} -> ${cur.id} must not go DOWN in rarity`).toBeGreaterThanOrEqual(0);
      if (drop === 0) expect(prev.name.localeCompare(cur.name)).toBeLessThanOrEqual(0);
    }
  });

  it('is a pure reordering — same membership, input untouched', () => {
    const input = Object.values(gemBook);
    const snapshot = input.map((g) => g.id);
    const ordered = gemCatalogOrder(input);
    expect([...ordered.map((g) => g.id)].sort()).toEqual([...snapshot].sort());
    expect(input.map((g) => g.id)).toEqual(snapshot);
  });
});
