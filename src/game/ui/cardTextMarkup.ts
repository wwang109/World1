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
 *
 * CONTRAST FLOOR (2026-09-02): every entry now clears WCAG AA (4.5:1) against
 * BOTH card fills these tokens actually render on — `UI.battlePlayerCard`
 * (0x35465d, the lighter and therefore binding ground) and
 * `UI.battleEnemyCard` (0x4e3329) — measured with the same relative-luminance
 * formula `textRoleAudit.test.ts` uses, not eyeballed. The 2026-09-02 ground
 * lift had left 13 of 24 entries under the floor (worst: `curse` at 2.46:1 on
 * the player fill — and it was already failing at 2.78 BEFORE the lift).
 * Every lifted value holds its hue exactly (keyword hue is IDENTITY — burn
 * reads red-orange, frost-family reads blue, curse reads purple) and moves
 * only lightness, shedding or adding a little saturation where a family
 * relationship needed preserving. Palette floor after: 4.50 (`curse`,
 * `shatter`). The physics to know before touching these again: 4.5:1 over
 * the player fill forces ANY hue to a relative luminance of >= 0.442, i.e.
 * roughly HSL lightness >= 65-77% depending on hue — a DEEP red/violet
 * cannot exist on these grounds at AA, so depth distinctions between related
 * keywords have to be carried by saturation instead.
 */
export const KEYWORD_TEXT_COLOR: Record<string, string> = {
  // 4.54:1 / 5.43:1 (player/enemy fill). Was `#8fbe5a` (4.43) — the smallest
  // lift in the pass, one L step. Moved in LOCKSTEP with both battle scenes'
  // `AILMENT_COLOR`/`AILMENT_TINT` and the pin test (see the doc block above).
  poison: '#92c05f',
  // 4.53 / 5.41. Was `#f0824c` (3.66). Same 20-degree fire hue, lifted to L70
  // with a touch more saturation so it stays "flame", not "peach".
  burn: '#f89b6d',
  // 4.51 / 5.39. Was `#e05555` (2.56). Hue 0 held at full-ish saturation, but
  // see the doc block: a DEEP blood red cannot reach AA on these grounds, so
  // this is honestly a light coral red. Still the palette's only pure red.
  bleed: '#f49999',
  // 4.54 / 5.43. Was `#a678d8` (2.88). Lockstep with the ailment palette,
  // same as poison/thorns.
  expose: '#c4a6e5',
  stun: '#f2d24c',
  // 4.53 / 5.41. Was `#7fa8f0` (4.01). Smallest possible lift, hue 218 held.
  shield: '#8fb3f2',
  guard: '#7fc0e8',
  // 5.22:1 / 6.23:1. First card to carry the keyword: champions_challenge
  // (2026-09-02) — taunt had an interpreter arm, a targeting policy and a
  // price, but zero cards, so no entry existed and the every-keyword-has-a-
  // color lint (rightly) failed the moment one shipped. Brass, not stun's
  // yellow (#f2d24c) and warmer than affinity (#f1a056): a challenge, read
  // at a glance as "come hit ME".
  taunt: '#e8b84f',
  negate: '#9fd0e8',
  cleanse: '#8fdcA8',
  // Ward is prevention, cleanse is removal — kept in the same cool-green family
  // as cleanse (both are "the ailment is gone") but distinctly lighter.
  ward: '#a8e8d0',
  // 4.52 / 5.39. Was `#e07a90` (3.37). Rose hue 347 held, saturation shed a
  // step so it stays tellable from `bleed`'s hotter, more saturated hue-0 red
  // now that both are forced to the same lightness band (see the doc block).
  lifesteal: '#e49fae',
  disrupt: '#e0b060',
  slow: '#d8c078',
  // BURDEN is slow one scope down (card-scope tax vs unit-wide), so it takes the
  // shade the tax family already had — kept in the same warm amber family as
  // `slow` so the two read as related, but NOT the same shade: `slow`'s old
  // sibling value here (`#c8b8a0`, HSL 36°/27%/71%) was so desaturated and close
  // in lightness to the plain body-text color (`#f1efe8` in
  // FantasyCardTemplateV2.ts) that it read as un-highlighted body text rather
  // than a keyword — a genuine legibility defect, not a shade choice (2026-08-19
  // fix). This value is a real saturated hue (30°/66%/65%) — still well over
  // DOUBLE the saturation of that old washed-out tan, which is what keeps it
  // reading as a keyword now that AA (4.52/5.40; was `#c07c3a` at 2.83) forces
  // its lightness back up near body-text territory. (It was `splash`'s colour
  // until 2026-08-21, when the weight tax was split out of the spreader; the
  // colour followed the TAX, which is the thing a player was learning to
  // recognise.)
  burden: '#e1a66c',
  // SPLASH is now the SPREADER — it has no payload of its own, it widens the
  // reach of the burden/curse beside it. Deliberately NOT in the tax family's
  // amber: it is not a tax, and colouring it like one is exactly the misread the
  // 2026-08-21 split exists to undo. A cool neutral steel reads as "geometry"
  // (the band) next to the warm burden/curse it modifies, and stays clear of
  // every existing family (shield/guard blues are lighter and bluer).
  // 4.52 / 5.40. Was `#9aa6b4` (3.88) — same steel, one lightness step up.
  splash: '#a9b3bf',
  // CURSE is burden's sibling on the DAMAGE axis, so it borrows from the
  // damage-denial end of the palette rather than the tax end: a desaturated
  // violet, adjacent to `expose` (#c4a6e5, the other card-vs-damage debuff)
  // but distinctly GREYER (33% vs 55% saturation at near-equal lightness), so
  // "they hit softer" and "they take more" are relatives without being
  // confusable. 4.50 / 5.38 — the palette floor, and the pass's hard case:
  // it was 2.46 (worst in the map, failing since before the ground lift), and
  // its old identity was "darker AND greyer" than expose — the darker half is
  // physically unreachable at AA on these grounds (doc block above), so
  // grey-ness now carries the distinction alone. This is as deep as a
  // WCAG-clean violet gets here.
  curse: '#bcaad4',
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
  // 4.53 / 5.41. Was `#e89040` (3.89): lifted to L64 with the family's highest
  // saturation (85% vs chain's 77%), so "warmest and most vivid" stays its
  // slot in the ladder.
  affinity: '#f1a056',
  // CHARGE is affinity's forward-armed half. Same family hue, pulled lighter and
  // slightly desaturated: on a face the two must be readable as relatives (both
  // are "your board unlocked this") while the lighter value reads as the one that
  // has not happened yet.
  charge: '#f0b878',
  // ATTUNED plating. Deliberately in the SHIELD family's blue rather than the
  // affinity family's warm range: what a player must read at a glance is "this
  // is a wall", and the attunement is a modifier on the wall. Slightly deeper
  // and GREYER than plain shield text so the two are tellable apart — it used
  // to be deeper and more saturated, but AA (4.52/5.40; was `#6f9fd8` at 3.49)
  // pins both blues to the same lightness band, so vividness (57% vs shield's
  // 79%) is the axis that survived.
  attuned: '#90b5e1',
  // 4.50 / 5.38. Was `#d88f6a` (3.69). Same hue-20 as burn, still separated
  // from it the way it always was: by saturation (53% vs burn's 91%).
  shatter: '#dba68b',
  // 4.53 / 5.41. Was `#3f9e7a` (2.92) — the deepest lift in the pass (L 43 ->
  // 59), teal held. Lockstep with the ailment palette, same as poison/expose.
  thorns: '#68c3a0',
  true: '#e8d5a0',
};

export function keywordTextColor(keyword: string): string | undefined {
  return KEYWORD_TEXT_COLOR[keyword];
}
