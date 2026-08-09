import type { Rarity } from '../../engine/types';
import type { GemDef } from '../../data/gems';
import { stripCardTextMarkup } from './cardTextMarkup';
import type { HoverTipEntry } from './hoverTip';

/**
 * Hover entry for a gem — effect text and rarity, wherever a gem shows up
 * (pouch row, socket panel, shop shelf, event reward, wiki). One shared
 * builder so every gem surface reads identically. Rarity is the rank a
 * player needs; Power Level is a pricing detail and is not surfaced here
 * (it still gates content via `isGemOnBudget`/`gemAudit.test.ts` — this is
 * display-only).
 */
export function gemHoverEntry(gem: GemDef): HoverTipEntry {
  const kind = gem.kind === 'stat' ? 'Stat mod' : 'Effect rider';
  return {
    title: `${gem.name} — ${gem.rarity.toUpperCase()}`,
    body: `${kind}. ${stripCardTextMarkup(gem.text)}`,
  };
}

// Exhaustive over `Rarity` by construction: tsc fails here if the union grows,
// which is the point — a new rarity must be placed deliberately, not defaulted.
const GEM_RARITY_RANK: Record<Rarity, number> = {
  common: 0, rare: 1, epic: 2, legendary: 3,
};

/**
 * CATALOG DISPLAY ORDER for gem grids/lists (both wikis, the UI kit): ascending
 * rarity, then name.
 *
 * WHY THIS EXISTS (2026-08-09): these surfaces used to render raw
 * `Object.values(gemBook)`, and their tidy rarity grouping was an ACCIDENT of
 * `src/data/gems.ts` happening to be authored Common-first. Nothing declared it
 * and no test held it, so the grouping would have silently shattered the moment
 * the book was reordered — which it now is (`gemBook` is id-sorted, so authoring
 * order can never be load-bearing again). Display order is a PRESENTATION
 * decision, so it is stated here, once, instead of being inherited from a data
 * file's layout. `tests/game/gemCatalogOrder.test.ts` pins it.
 */
export function gemCatalogOrder(gems: readonly GemDef[]): GemDef[] {
  return [...gems].sort((a, b) =>
    GEM_RARITY_RANK[a.rarity] - GEM_RARITY_RANK[b.rarity] || a.name.localeCompare(b.name));
}
