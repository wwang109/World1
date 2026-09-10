import type { SkillDef } from '../../engine/types';
import {
  powerLevelEntry,
  skillKeywordEntries,
  slotEntry,
  targetingEntry,
  tierEntry,
  typeBadgeEntries,
  weightEntry,
  type GlossaryEntry,
} from './cardGlossary';
import type { HoverTipEntry } from './hoverTip';
import { isAoeSkill } from './skillPresentation';

/**
 * Every glossary entry a card's own face can teach — type/element/weapon
 * matchup, weight, board footprint, tier, Power Level, and one entry per mechanical
 * keyword (bleed/poison/burn/riders/etc.) the card's effects use. Pure text —
 * the single composition point so DeckBuild (hover tip + mobile overlays) and
 * any future caller never hand-assemble this list differently.
 */
export function cardGlossaryEntries(skill: SkillDef): GlossaryEntry[] {
  const entries: GlossaryEntry[] = [
    ...skillKeywordEntries(skill),
    ...typeBadgeEntries(skill),
    weightEntry(skill),
    slotEntry(skill),
    tierEntry(skill.tier),
    powerLevelEntry(),
  ];
  if (isAoeSkill(skill)) entries.push(targetingEntry());
  return entries;
}

/**
 * Full hover-tip entry set for one card token: a header (name · tier · PL,
 * metadata only — no effect text) followed by GENERIC keyword definitions.
 * Used wherever a whole card gets ONE combined tooltip (desktop DeckBuild
 * hover, draft grids) rather than per-region zones (that's
 * `FantasyCardTemplateV2`'s own `showGlossary` idiom).
 *
 * THE HOVER NEVER RESTATES THIS CARD'S OWN NUMBERS (user-locked 2026-09-06:
 * "maybe the hovr shoud only explain combat info or logs and not how much
 * damage or how much turn or debuff its applying its a generic helper to
 * show user what keyword do"). The header used to append
 * `renderSkillText(skill)` — the card's own generated face text, complete
 * with its damage/stack/turn numbers — which is exactly the amount the face
 * itself already prints (`CardToken`/`FantasyCardTemplateV2`, both
 * platforms). Now it carries only `name`/`tier`/`PL`: identifying metadata,
 * not "how much". Everything below is already a keyword DEFINITION
 * (`skillKeywordEntries` → `ruleEntryOf`,
 * `targetingEntry`) — mechanism prose that reads identically regardless of
 * this copy's tier or magnitudes, which is the generic-helper contract this
 * module exists to keep. The full generated text — the one place a player
 * reads THIS card's actual numbers when the face itself is too small to
 * hold them — still lives one tap away in `cardGlossaryEntries` (via
 * `renderCardInfoBox`/`renderCardDetailOverlay`), unaffected by this file.
 */
/** Desktop hover uses the complete canonical keyword bodies. */
export function cardHoverEntries(skill: SkillDef): HoverTipEntry[] {
  const header: HoverTipEntry = {
    title: skill.name,
    body: `RANK ${skill.tier.toUpperCase()}`,
  };
  // Hover carries only what the face can't teach at a glance: the card's own
  // mechanical keywords with complete canonical bodies. Stat suffixes remain
  // plain notation and create no entry. The universal
  // entries (type/weight/slot/tier/PL) live in the overlay and socket-panel
  // views, which scroll — not here. AoE targeting is the same kind of face
  // abbreviation as a keyword token (the face prints "AOE", this unpacks
  // what it means), so it belongs in this set too.
  const entries: GlossaryEntry[] = [];
  entries.push(...skillKeywordEntries(skill));
  if (skill.property === 'true') entries.push(...typeBadgeEntries(skill).filter((entry) => entry.title.startsWith('(T)')));
  if (skill.size > 1) entries.push(slotEntry(skill));
  if (isAoeSkill(skill)) entries.push(targetingEntry());
  return [header, ...entries];
}
