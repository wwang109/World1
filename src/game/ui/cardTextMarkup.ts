/**
 * Card-text keyword markup. Authors may wrap a mechanical verb in double
 * braces — `Deal 12 damage and {{poison}} for 5 for 3 turns.` — and the UI
 * renders that token in the keyword's semantic style while every plain
 * renderer strips the braces. The engine never reads markup; `text` stays
 * display-only.
 *
 * The keyword id is the lowercased brace content; the display text keeps the
 * author's casing.
 */

export interface CardTextSegment {
  text: string;
  /** Lowercased keyword id when this segment came from a {{...}} token. */
  keyword?: string;
}

const MARKUP_PATTERN = /\{\{([^{}]+)\}\}/g;

/** Split text into plain and keyword segments, in order. */
export function parseCardTextMarkup(text: string): CardTextSegment[] {
  const segments: CardTextSegment[] = [];
  let lastIndex = 0;
  for (const match of text.matchAll(MARKUP_PATTERN)) {
    const index = match.index ?? 0;
    if (index > lastIndex) {
      segments.push({ text: text.slice(lastIndex, index) });
    }
    const token = match[1]!.trim();
    segments.push({ text: token, keyword: token.toLowerCase() });
    lastIndex = index + match[0].length;
  }
  if (lastIndex < text.length) {
    segments.push({ text: text.slice(lastIndex) });
  }
  return segments;
}

/** Plain rendering: `{{poison}}` -> `poison`. */
export function stripCardTextMarkup(text: string): string {
  return text.replace(MARKUP_PATTERN, (_match, token: string) => token.trim());
}

/** Lowercased keyword ids marked in the text, in order, deduplicated. */
export function markedKeywords(text: string): string[] {
  const keywords: string[] = [];
  for (const match of text.matchAll(MARKUP_PATTERN)) {
    const keyword = match[1]!.trim().toLowerCase();
    if (!keywords.includes(keyword)) keywords.push(keyword);
  }
  return keywords;
}

/**
 * Semantic text color per keyword id. Aligned with the status/archetype
 * palette in theme.ts; extend here when a new mechanical verb gets markup.
 *
 * poison / thorns / expose (2026-08-17 fix): these three now match the battle
 * scenes' own ailment palette EXACTLY (`AILMENT_COLOR`/`AILMENT_TINT` in
 * MobileBattleScene.ts / DesktopBattleScene.ts, off-limits to this file —
 * those are the source of truth). They used to be a DIFFERENT COLOR FAMILY
 * entirely — card text highlighted "poison" in purple while the status it
 * applies tints the HP bar green, same for thorns (olive vs teal) and expose
 * (pink vs purple) — a genuine contradiction, not a shade difference, so a
 * player learning a keyword's color here could not then recognize it in
 * battle. `thorns`'s old value (`#9fb86a`) was, byte for byte, the olive the
 * battle palette itself retired the same day for being indistinguishable from
 * poison-green — this file was the last place it still lived.
 * burn/bleed/stun keep their own distinct (if not byte-identical) shades —
 * unlike the three above, they were never a contradicting color FAMILY vs the
 * battle bar, just a slightly different tone of the same hue, so reconciling
 * them was out of this pass's proven-defect scope.
 */
export const KEYWORD_TEXT_COLOR: Record<string, string> = {
  poison: '#8fbe5a',
  burn: '#f0824c',
  bleed: '#e05555',
  expose: '#a678d8',
  stun: '#f2d24c',
  shield: '#7fa8f0',
  guard: '#7fc0e8',
  negate: '#9fd0e8',
  cleanse: '#8fdcA8',
  // Ward is prevention, cleanse is removal — kept in the same cool-green family
  // as cleanse (both are "the ailment is gone") but distinctly lighter.
  ward: '#a8e8d0',
  lifesteal: '#e07a90',
  disrupt: '#e0b060',
  slow: '#d8c078',
  // BURDEN is slow one scope down (card-scope tax vs unit-wide), so it takes the
  // shade the tax family already had — kept in the same warm amber family as
  // `slow` so the two read as related, but NOT the same shade: `slow`'s old
  // sibling value here (`#c8b8a0`, HSL 36°/27%/71%) was so desaturated and close
  // in lightness to the plain body-text color (`#f1efe8` in
  // FantasyCardTemplateV2.ts) that it read as un-highlighted body text rather
  // than a keyword — a genuine legibility defect, not a shade choice (2026-08-19
  // fix). This value is a real saturated hue (30°/54%/49%) — deeper and more than
  // DOUBLE the saturation of the old one — so it pops the way every other keyword
  // in this map does. (It was `splash`'s colour until 2026-08-21, when the weight
  // tax was split out of the spreader; the colour followed the TAX, which is the
  // thing a player was learning to recognise.)
  burden: '#c07c3a',
  // SPLASH is now the SPREADER — it has no payload of its own, it widens the
  // reach of the burden/curse beside it. Deliberately NOT in the tax family's
  // amber: it is not a tax, and colouring it like one is exactly the misread the
  // 2026-08-21 split exists to undo. A cool neutral steel reads as "geometry"
  // (the band) next to the warm burden/curse it modifies, and stays clear of
  // every existing family (shield/guard blues are lighter and bluer).
  splash: '#9aa6b4',
  // CURSE is burden's sibling on the DAMAGE axis, so it borrows from the
  // damage-denial end of the palette rather than the tax end: a desaturated
  // violet, adjacent to `expose` (#a678d8, the other card-vs-damage debuff) but
  // darker and greyer, so "they hit softer" and "they take more" are relatives
  // without being confusable.
  curse: '#8f76b0',
  combo: '#e8c060',
  // CHAIN is `combo` one axis over — same "your previous cast decides whether
  // this pays" promise, gated on the previous cast's TYPE (a weapon or an
  // element) instead of its archetype. Deliberately a NEAR-SIBLING of combo's
  // warm gold rather than a new family: a player who has learned that gold means
  // "sequence-dependent bonus" should read this the same way at a glance. Shifted
  // warmer and slightly deeper (36 deg -> 28 deg, a touch more saturation) so the
  // two are still tellable apart side by side on one card face, which is a real
  // case — nothing stops a card carrying both riders.
  chain: '#e8a850',
  // The third member of the gated-payoff family, one step warmer again than
  // chain so combo/chain/affinity read as siblings without collapsing together.
  affinity: '#e89040',
  // CHARGE is affinity's forward-armed half. Same family hue, pulled lighter and
  // slightly desaturated: on a face the two must be readable as relatives (both
  // are "your board unlocked this") while the lighter value reads as the one that
  // has not happened yet.
  charge: '#f0b878',
  // ATTUNED plating. Deliberately in the SHIELD family's blue rather than the
  // affinity family's warm range: what a player must read at a glance is "this
  // is a wall", and the attunement is a modifier on the wall. Slightly deeper
  // and more saturated than plain shield text so the two are tellable apart.
  attuned: '#6f9fd8',
  shatter: '#d88f6a',
  thorns: '#3f9e7a',
  true: '#e8d5a0',
};

export function keywordTextColor(keyword: string): string | undefined {
  return KEYWORD_TEXT_COLOR[keyword];
}
