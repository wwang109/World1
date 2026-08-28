export type FantasyTemplateTier = 'bronze' | 'silver' | 'gold' | 'diamond';

export type FantasyTemplateTextRuleKey =
  | 'title-short'
  | 'title-medium'
  | 'title-long'
  | 'body-3-line'
  | 'body-4-line'
  | 'body-5-line'
  | 'wt-1-digit'
  | 'wt-2-digit'
  | 'wt-3-digit';

export type FantasyTemplateRegion =
  | 'artFrame'
  | 'leftRail'
  | 'rightRail'
  | 'tierFrame'
  | 'slotLabel'
  | 'titleBox'
  | 'divider'
  | 'bodyBox'
  | 'typeBadge'
  | 'wtPlate'
  | 'tierDiamond'
  | 'glossaryTip';

export interface RegionBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface FantasyCardTemplateSpec {
  baseSize: { width: 420; height: 690 };
  cornerRadius: 28;
  regions: Record<FantasyTemplateRegion, RegionBox>;
  /** Archetype badges stack inside `rightRail`, top-down. Offsets are from the rail's top edge. */
  archetypeStack: { w: number; h: number; firstCenterY: number; pitch: number; max: number };
  /** `Slot` label + one box glyph per occupied board slot, right-aligned inside `slotLabel`. */
  slotDisplay: { labelFontSize: number; glyphFontSize: number; gap: number };
  /** Hover/tap explanation tooltip rendered inside `glossaryTip`. */
  glossaryText: { titleFontSize: number; bodyFontSize: number; pad: number };
  /** Decorative corner filigree drawn in the tier trim color, all four corners. */
  cornerArt: { inset: number; length: number; innerGap: number; diamond: number; overshoot: number };
  textRules: Record<FantasyTemplateTextRuleKey, {
    fontSize: number;
    lineSpacing: number;
    maxLines: number;
    wrapWidth: number;
  }>;
}

export const FANTASY_CARD_TEMPLATE_SPEC: FantasyCardTemplateSpec = {
  baseSize: { width: 420, height: 690 },
  cornerRadius: 28,
  regions: {
    // Full-art layout: the art runs edge-to-edge under everything; the lower
    // portion carries a gradient scrim (tierFrame) instead of a boxed plate.
    artFrame: { x: 0, y: 0, w: 420, h: 690 },
    // Badges clear the corner filigree (main line at 24, echo at 30) with
    // ~8 units of air.
    leftRail: { x: 34, y: 34, w: 56, h: 56 },
    rightRail: { x: 334, y: 38, w: 48, h: 160 },
    tierFrame: { x: 0, y: 440, w: 420, h: 250 },
    slotLabel: { x: 230, y: 644, w: 156, h: 20 },
    titleBox: { x: 40, y: 500, w: 340, h: 44 },
    divider: { x: 60, y: 550, w: 300, h: 2 },
    bodyBox: { x: 40, y: 562, w: 340, h: 76 },
    typeBadge: { x: 38, y: 38, w: 48, h: 48 },
    // Bottom-left footer row, mirroring slotLabel on the right.
    wtPlate: { x: 34, y: 644, w: 110, h: 20 },
    // Tier marker centered in the footer row between weight and slots.
    tierDiamond: { x: 198, y: 642, w: 24, h: 24 },
    // Below the card silhouette (y > 690) so explanations never cover the card.
    glossaryTip: { x: 20, y: 704, w: 380, h: 180 },
  },
  archetypeStack: { w: 48, h: 48, firstCenterY: 24, pitch: 56, max: 3 },
  slotDisplay: { labelFontSize: 9, glyphFontSize: 12, gap: 8 },
  glossaryText: { titleFontSize: 13, bodyFontSize: 11, pad: 14 },
  cornerArt: { inset: 14, length: 88, innerGap: 6, diamond: 5, overshoot: 11 },
  textRules: {
    'title-short': { fontSize: 24, lineSpacing: -5, maxLines: 1, wrapWidth: 284 },
    'title-medium': { fontSize: 22, lineSpacing: -5, maxLines: 1, wrapWidth: 284 },
    'title-long': { fontSize: 20, lineSpacing: -6, maxLines: 2, wrapWidth: 284 },
    'body-3-line': { fontSize: 13, lineSpacing: 5, maxLines: 3, wrapWidth: 292 },
    'body-4-line': { fontSize: 12, lineSpacing: 4, maxLines: 4, wrapWidth: 292 },
    'body-5-line': { fontSize: 11, lineSpacing: 3, maxLines: 5, wrapWidth: 292 },
    'wt-1-digit': { fontSize: 15, lineSpacing: 0, maxLines: 1, wrapWidth: 56 },
    'wt-2-digit': { fontSize: 13, lineSpacing: 0, maxLines: 1, wrapWidth: 56 },
    'wt-3-digit': { fontSize: 11, lineSpacing: 0, maxLines: 1, wrapWidth: 56 },
  },
};

/**
 * READABILITY FLOOR for the card's TITLE, in real screen px — the title never
 * renders smaller than this no matter how far the card is scaled down (the
 * catalog grid and the mobile detail overlays run the 420x690 template at
 * cardScale 0.33-0.52). `FantasyCardTemplateV2.makeTitle` used to spell this
 * as a bare `Math.max(13, px(rule.fontSize))`; it lives here because the
 * geometry it interacts with lives here.
 */
export const TITLE_MIN_FONT_PX = 13;

/**
 * Rendered line box / font size, for the display face at the sizes this
 * template uses. Approximate on purpose (real glyph metrics need a canvas —
 * measured 1.13-1.25 across 13/20/22/24px, so this takes the conservative
 * end), and it is only ever used to decide HOW MANY LINES fit above the
 * divider, never to place anything: a slightly pessimistic factor drops a
 * line, it can never let one overflow.
 */
export const TITLE_LINE_HEIGHT_RATIO = 1.25;

/** Air a hairline must keep between itself and the text above it. */
export const TITLE_RULE_CLEARANCE_PX = 2;

export interface FantasyTitleLayout {
  fontSize: number;
  lineSpacing: number;
  /** One rendered line's box height at `fontSize`. */
  lineHeight: number;
  /** Lines that actually FIT above the divider — <= the text rule's own cap. */
  maxLines: number;
  /** Space from the title box's top edge down to the divider, less clearance. */
  room: number;
}

/**
 * The title's type AND its line budget, derived from the hairline it has to
 * clear rather than from the text rule alone.
 *
 * THE BUG THIS EXISTS TO CLOSE (2026-08-28 rule-clearance sweep, same class as
 * `RunProgressStrip`'s mobile header rule): the title's font size has a
 * readability FLOOR (`TITLE_MIN_FONT_PX`) but `divider`/`titleBox` are pure
 * spec rects that scale with the card. Below cardScale ~0.65 the floor wins,
 * so the type stops shrinking while the 50-unit gap between `titleBox.y` and
 * `divider.y` keeps closing — and a `title-long` (maxLines 2) title then drew
 * its second line straight THROUGH the divider and on into `bodyBox`:
 * measured 11.3px past the rule at cardScale 0.333 (the 140px card in
 * `cardDetailOverlay`/`MobileDeckBuildScene`/`MobileDraftScene`), 3.2px at
 * 0.476 (the 200px card in `DesktopShopScene`), 0.8px at 0.524 (the 220px
 * card in `DesktopWikiScene`) — i.e. wrong on BOTH platforms, and 1px-margin
 * wrong on desktop, exactly the signature the header rule had.
 *
 * `makeBody` already took this stance for the body text ("Min font clamps can
 * outgrow a heavily shrunken card, so the box height — not just the ladder —
 * bounds the visible line count"); this is the same rule for the title, and it
 * is a NO-OP at cardScale 1 (2 lines still fit, `title-long` still gets 2).
 */
export function fantasyTitleLayout(
  titleRule: FantasyTemplateTextRuleKey,
  cardScale: number,
): FantasyTitleLayout {
  const rule = FANTASY_CARD_TEMPLATE_SPEC.textRules[titleRule];
  const { titleBox, divider } = FANTASY_CARD_TEMPLATE_SPEC.regions;
  // `Math.round` inside the `max`, mirroring `FantasyCardTemplateV2.px()`
  // exactly — this must reproduce the shipped font size byte for byte, or the
  // fix would silently restyle every card it was supposed to leave alone.
  const fontSize = Math.max(TITLE_MIN_FONT_PX, Math.round(rule.fontSize * cardScale));
  const lineSpacing = Math.round(rule.lineSpacing * cardScale);
  const lineHeight = fontSize * TITLE_LINE_HEIGHT_RATIO;
  const room = (divider.y - titleBox.y) * cardScale - TITLE_RULE_CLEARANCE_PX;
  // n lines occupy n*lineHeight + (n-1)*lineSpacing.
  const fits = Math.floor((room + lineSpacing) / (lineHeight + lineSpacing));
  // At least one line always renders — a card with no name at all is worse
  // than a tight one, and the 1-line case has always cleared the rule.
  const maxLines = Math.max(1, Math.min(rule.maxLines, fits));
  return { fontSize, lineSpacing, lineHeight, maxLines, room };
}

export function selectTitleRule(name: string): 'title-short' | 'title-medium' | 'title-long' {
  if (name.length <= 14) return 'title-short';
  if (name.length <= 24) return 'title-medium';
  return 'title-long';
}

export function selectBodyRule(text: string, effectCount: number): 'body-3-line' | 'body-4-line' | 'body-5-line' {
  const density = text.length + Math.max(0, effectCount - 1) * 28;
  if (density <= 90) return 'body-3-line';
  if (density <= 145) return 'body-4-line';
  return 'body-5-line';
}

export function selectWtRule(weight: number): 'wt-1-digit' | 'wt-2-digit' | 'wt-3-digit' {
  const digits = String(weight).length;
  if (digits === 1) return 'wt-1-digit';
  if (digits === 2) return 'wt-2-digit';
  return 'wt-3-digit';
}
