import type { Rarity } from '../../engine/types';
import { gemRuleEntries, renderGemText } from '../../engine/keywords/gemText';
import type { GemDef } from '../../data/gems';
import { stripCardTextMarkup } from './cardTextMarkup';
import type { HoverTipEntry } from './hoverTip';

/**
 * GEM PRESENTATION — the twin of `skillPresentation.ts`, and deliberately NOT
 * a glossary.
 *
 * `ui/gemGlossary.ts` IS GONE (2026-09-06). It held two functions that pasted
 * a gem's AUTHORED `text` into a tooltip and a chip, which meant a gem's
 * explanation was whatever its author had typed — 17 of the 53 described a
 * keyword's mechanism in their own words, in wordings that disagreed with the
 * card faces carrying the same keyword. User-locked, same day: *"they should
 * have same text so that there is no new text for stats every description
 * should come from 1 reference i dont even want a gem glossary"*.
 *
 * So THIS FILE CONTAINS NO PROSE AT ALL — grep it: there is not one sentence
 * about what any gem or keyword does. Every word it shows comes from
 * `src/engine/keywords/gemText.ts` (the gem's own parameters) and
 * `src/engine/keywords/text.ts` (the ONE definition per keyword and per stat,
 * the same one a card's face opens). What is left here is layout: which facts
 * go in which row, and what order a catalog grid lists gems in.
 */

/**
 * THE HOVER/TAP ENTRIES FOR ONE GEM — a `Gem effect` header, then the game's
 * definitions for the keywords and stats that header's clauses name.
 *
 * The header exists because the user asked for it in as many words (*"its jus
 * for gem for the hover it should say Gem effect or something"*): a gem's
 * lines have to be attributable to the GEM, especially in the socket panel and
 * the card-token hover where they sit beside the host card's own lines.
 * `hoverTip.ts` renders every entry title in caps, so it reads `GEM EFFECT`.
 *
 * The entries under it are the SHARED helpers — byte-identical to what a card
 * carrying the same keyword opens — which is what makes the header a label
 * rather than a separate vocabulary. Bodies are NOT shortened to their first
 * sentence the way `cardHoverEntries` shortens a card's (a card can carry six
 * keywords; a gem carries one payload, at most three entries).
 */
export function gemHoverEntries(gem: GemDef): HoverTipEntry[] {
  const header: HoverTipEntry = {
    title: 'Gem effect',
    body: `${gem.name} · ${gem.rarity.toUpperCase()} — ${stripCardTextMarkup(renderGemText(gem))}`,
  };
  return [header, ...gemRuleEntries(gem)];
}

/**
 * THE THREE LINES A GEM CHIP SHOWS — name, rarity + kind, and what it does.
 *
 * `gemHoverEntries` above is the same facts formatted for a TOOLTIP; this is
 * them formatted for a CHIP the player is looking at without hovering. Same
 * source, one builder each, so the two surfaces cannot drift into telling a
 * player different amounts about one gem.
 *
 * WHY IT EXISTS (2026-08-30). `RunRewardPanel.ts`'s gem chip drew a coloured
 * rarity marker and a NAME. Everything else about the gem lived only in the
 * desktop-only hover tooltip — so "PICK ONE TO KEEP" offered a phone three
 * names and no effect, no rarity and no stats, for a choice that cannot be
 * taken back. `renderGemChip` prints all three rows on BOTH platforms now.
 */
export function gemChipLines(gem: GemDef): { name: string; meta: string; effect: string } {
  return {
    name: gem.name,
    meta: `${gem.rarity.toUpperCase()} · ${gem.kind === 'stat' ? 'STAT MOD' : 'EFFECT GEM'}`,
    effect: stripCardTextMarkup(renderGemText(gem)),
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

/**
 * THE GEM'S DEFINITIONS AS ONE PRINTABLE BLOCK — the same entries
 * `gemHoverEntries` puts under the `GEM EFFECT` header, formatted for a panel
 * that has ROOM rather than for a floating tip.
 *
 * WHY IT EXISTS (2026-09-07, review 2). The per-hit rule that makes
 * `empowering_core` worth double on a two-hit card reached three of the six
 * surfaces a gem appears on: the deck-build socket panel, the shop's OWNED-card
 * detail and the solo resolved-outcome chip — all three because they render a
 * host card through `renderCardInfoBox`. The three that show a gem with NO host
 * (the shop's gem BUY dock, and both platforms' Wiki GEMS detail) had nowhere
 * to put it: `renderCardInfoBox` needs a `SkillDef`, and those panels have a
 * gem and nothing else.
 *
 * So this is the host-less half of that route, and it is a FORMATTER, not a
 * second renderer: no scene, no interactivity, no layout decisions, and every
 * word still comes from the registry via `gemHoverEntries`. A caller prints it
 * with one `add.text` in its own panel's own style.
 *
 * Returns `''` when the gem opens no definition (the two plain-heal Slivers),
 * so a caller can skip the row entirely rather than draw an empty box.
 */
export function gemDefinitionsText(gem: GemDef): string {
  return gemHoverEntries(gem)
    .slice(1) // [0] is the `Gem effect` header — the panel already shows that
    .map((entry) => `${entry.title.toUpperCase()} — ${entry.body}`)
    .join('\n\n');
}
