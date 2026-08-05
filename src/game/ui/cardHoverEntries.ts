import type { SkillDef } from '../../engine/types';
import { powerLevelDeci } from '../../engine/balance';
import { stripCardTextMarkup } from './cardTextMarkup';
import {
  powerLevelEntry,
  skillKeywordEntries,
  slotEntry,
  statScalingSuffixEntry,
  tierEntry,
  typeBadgeEntries,
  weightEntry,
  type GlossaryEntry,
} from './cardGlossary';
import type { HoverTipEntry } from './hoverTip';

/** The authored `(+ATK)` / `(+MATK)` parenthetical — printed verbatim on any
 * card whose damage/heal/shield line scales off a stat (see
 * `docs/card-text-style-guide.md`). */
const STAT_SUFFIX_PATTERN = /\(\+ATK\)|\(\+MATK\)/;

/**
 * Every glossary entry a card's own face can teach — type/element/weapon
 * matchup, weight, board footprint, tier, Power Level, the "(+ATK)" scaling
 * suffix (when the printed text uses it), and one entry per mechanical
 * keyword (bleed/poison/burn/riders/etc.) the card's effects use. Pure text —
 * the single composition point so DeckBuild (hover tip + mobile overlays) and
 * any future caller never hand-assemble this list differently.
 */
export function cardGlossaryEntries(skill: SkillDef): GlossaryEntry[] {
  const entries: GlossaryEntry[] = [
    ...typeBadgeEntries(skill),
    weightEntry(skill),
    slotEntry(skill),
    tierEntry(skill.tier),
    powerLevelEntry(),
  ];
  if (STAT_SUFFIX_PATTERN.test(skill.text)) entries.push(statScalingSuffixEntry());
  entries.push(...skillKeywordEntries(skill));
  return entries;
}

/**
 * Full hover-tip entry set for one card token: a header (name · tier · PL ·
 * the full markup-stripped skill text) followed by `cardGlossaryEntries`.
 * Used wherever a whole card gets ONE combined tooltip (desktop DeckBuild
 * hover, draft grids) rather than per-region zones (that's
 * `FantasyCardTemplateV2`'s own `showGlossary` idiom).
 */
/** First sentence only — hover tips must stay glanceable (user feedback:
 * the full bodies made the tip too long). The overlay/panel views keep the
 * complete text via `cardGlossaryEntries`. */
function brief(entry: GlossaryEntry): GlossaryEntry {
  const firstStop = entry.body.indexOf('. ');
  return firstStop < 0 ? entry : { ...entry, body: entry.body.slice(0, firstStop + 1) };
}

export function cardHoverEntries(skill: SkillDef): HoverTipEntry[] {
  const plDeci = powerLevelDeci(skill);
  const header: HoverTipEntry = {
    title: skill.name,
    body: `${skill.tier.toUpperCase()} · PL ${(plDeci / 10).toFixed(0)} — ${stripCardTextMarkup(skill.text)}`,
  };
  // Hover carries only what the face can't teach at a glance: the scaling
  // suffix + the card's own mechanical keywords, one brief line each. The
  // universal entries (type/weight/slot/tier/PL) live in the overlay and
  // socket-panel views, which scroll — not here.
  const entries: GlossaryEntry[] = [];
  if (STAT_SUFFIX_PATTERN.test(skill.text)) entries.push(statScalingSuffixEntry());
  entries.push(...skillKeywordEntries(skill));
  return [header, ...entries.map(brief)];
}
