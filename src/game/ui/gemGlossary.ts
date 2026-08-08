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
