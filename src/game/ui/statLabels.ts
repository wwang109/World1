import type { CombatantStats } from '../../engine/types';
import {
  STAT_KEYS as REGISTRY_STAT_KEYS,
  STAT_LABELS as REGISTRY_STAT_LABELS,
  STAT_LONG_NAME as REGISTRY_STAT_LONG_NAME,
  STAT_TOKEN as REGISTRY_STAT_TOKEN,
  statRuleByToken,
  type StatLabelKey,
} from '../../engine/keywords/text';
import type { HoverTipEntry } from './hoverTip';

/**
 * THE STAT LABEL SURFACE for `src/game` — now a RE-EXPORT, not a second table.
 *
 * Before this module existed the same stat was spelled three different ways
 * across the UI (MAG in `statGlossary.ts`, MATK on the battle log, "Magic
 * Power" in glossary prose). It fixed that by owning one table — and then the
 * card-text migration had to write the SAME table again inside
 * `src/engine/keywords/text.ts`, because a `buffStat` clause has to spell a
 * stat and `src/engine` may not import from `src/game`. Two tables held equal
 * by a pin test are still two tables.
 *
 * The registry is now the ONLY definition and this file re-exports it
 * (`src/game` importing `src/engine` is the direction the layer rule allows).
 * User-locked 2026-09-06: *"they should have same text so that there is no new
 * text for stats every description should come from 1 reference"*.
 *
 * `statGlossary.ts` IS GONE with the same change: its six stat definitions were
 * the only prose it held, and they moved into the registry beside every
 * keyword's `ruleSentence` (`STAT_RULE`). `statHoverEntry` and `STAT_LABELS`
 * live on here as one-line lookups, so every existing statline call site keeps
 * working and no gem, card or statline can be handed a different sentence about
 * the same stat.
 *
 * Does NOT cover the unrelated `Property` labels (PHYS/MAG/TRUE —
 * `theme.ts#PROPERTY_LABEL`, which name the physical/magical/true DAMAGE TYPE,
 * not the Magic Power STAT, and are intentionally left alone).
 */

/** Every player-facing stat key — the engine's five `BuffableStat` scaling
 * stats plus max HP (not itself buffable, but shown on every statline). */
export type StatKey = StatLabelKey;

/** Canonical display order for a full statline (HP first, then the five
 * buffable stats in the order every existing statline already used). */
export const STAT_KEYS: readonly StatKey[] = REGISTRY_STAT_KEYS;

/**
 * THE canonical short token per stat, per the locked stat model: HP, ATK,
 * MATK, DEF (armor), MDEF (magicResist), SPD. Physical scales off ATK,
 * magical off MATK — every statline/log line/card face/glossary title in
 * `src/game` must read one of these six tokens, never a synonym.
 */
export const STAT_TOKEN: Record<StatKey, string> = REGISTRY_STAT_TOKEN;

/** Long-form name for glossary bodies and full-word action descriptions
 * (e.g. "20 + Magic Power damage") — the prose companion to `STAT_TOKEN`. */
export const STAT_LONG_NAME: Record<StatKey, string> = REGISTRY_STAT_LONG_NAME;

/** The six canonical stat tokens, in statline order — `STAT_KEYS` mapped
 * through `STAT_TOKEN` so this can never drift from the single source. */
export const STAT_LABELS: readonly string[] = REGISTRY_STAT_LABELS;

/**
 * Hover entry for one stat label — the registry's ONE definition of that stat,
 * the same sentence a card's `+20% ATK (2t)` clause and a Charm gem's
 * `Hero: +8 ATK` face both open. Falls back to a generic explanation for an
 * unrecognized/abbreviated label so a caller never has to guard it.
 *
 * `HoverTipEntry` and the registry's rule entry are the same `{title, body}`
 * shape by design (so is `cardGlossary.ts`'s `GlossaryEntry`): the tooltip
 * idiom is structural, the words are the registry's.
 */
export function statHoverEntry(label: string): HoverTipEntry {
  return statRuleByToken(label);
}

/**
 * `" (+N)"` attribution for a hero-scope stat gem's contribution to
 * `statKey`, or `''` when no socketed gem bumps that stat — appended right
 * after a stat's TOTAL number wherever a hero statline prints one, so a
 * gem-boosted number reads differently from a naturally-high (level-bought)
 * one (the bug this exists to fix: gem stats were folded into combat but
 * never surfaced on any hero stat readout). `gemAdds` is the caller's own
 * `gemHeroStats(pieces)` call (`src/engine/cards.ts`) — this module stays
 * presentation-only and never computes the fold itself.
 */
export function gemStatSuffix(statKey: StatKey, gemAdds: Partial<CombatantStats>): string {
  const add = gemAdds[statKey];
  return add ? ` (+${add})` : '';
}
