import { gemPowerLevel } from '../../engine/balance';
import type { GemDef } from '../../data/gems';
import { stripCardTextMarkup } from './cardTextMarkup';
import type { HoverTipEntry } from './hoverTip';

/**
 * Hover entry for a gem — effect text, rarity, and +PL, wherever a gem shows
 * up (pouch row, socket panel, shop shelf, event reward, wiki). One shared
 * builder so every gem surface reads identically. Pure text — reads the
 * already-priced `gemPowerLevel`, never repricing it.
 */
export function gemHoverEntry(gem: GemDef): HoverTipEntry {
  const kind = gem.kind === 'stat' ? 'Stat mod' : 'Effect rider';
  return {
    title: `${gem.name} — ${gem.rarity.toUpperCase()} · +${gemPowerLevel(gem)} PL`,
    body: `${kind}. ${stripCardTextMarkup(gem.text)}`,
  };
}
