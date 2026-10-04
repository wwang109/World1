export type FantasyTemplateTier = 'bronze' | 'silver' | 'gold' | 'diamond';
export type FantasyCardTemplateVariant = 'classic' | 'printed-v2';

export const DEFAULT_CARD_TEMPLATE_VARIANT: FantasyCardTemplateVariant = 'classic';

export function resolveCardTemplateVariant(
  variant?: FantasyCardTemplateVariant,
  search = typeof window === 'undefined' ? '' : window.location.search,
): FantasyCardTemplateVariant {
  if (variant) return variant;
  const preview = new URLSearchParams(search).get('cardTemplate');
  return preview === 'classic' || preview === 'printed-v2' ? preview : DEFAULT_CARD_TEMPLATE_VARIANT;
}

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
  cornerRadius: number;
  regions: Record<FantasyTemplateRegion, RegionBox> & Partial<Record<
    'header' | 'rulesBand' | 'rulesCaption' | 'footer' | 'progress' | 'headerTrim' | 'rulesTrim' | 'bodyTrim', RegionBox
  >>;
  /** Archetype badges stack inside `rightRail`, top-down. Offsets are from the rail's top edge. */
  archetypeStack: { w: number; h: number; firstCenterY: number; pitch: number; max: number };
  /** `Slot` label + one box glyph per occupied board slot, right-aligned inside `slotLabel`. */
  slotDisplay: { labelFontSize: number; glyphFontSize: number; gap: number };
  /** Hover/tap explanation tooltip rendered inside `glossaryTip`. */
  glossaryText: { titleFontSize: number; bodyFontSize: number; pad: number };
  /** Decorative corner filigree drawn in the tier trim color, all four corners. */
  cornerArt: { inset: number; length: number; innerGap: number; diamond: number; overshoot: number };
  printed?: {
    background: number; panel: number; ink: string; frameInset: number;
    titlePlate: RegionBox; progressBox: RegionBox; artRadius: number;
    rowGap: number; labelWidth: number; labelFontSize: number;
    bodyFontSize: number; bodyMinFontSize: number; bodyLineHeightRatio: number;
    labelMinScale: number; compactLabelWidth: number;
    frameStroke: number; panelStroke: number;
    bandColor: number; caption: string; captionFontSize: number; titleInk: string;
  };
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
    leftRail: { x: 34, y: 34, w: 56, h: 56 },
    rightRail: { x: 334, y: 38, w: 48, h: 160 },
    tierFrame: { x: 0, y: 360, w: 420, h: 330 },
    slotLabel: { x: 230, y: 644, w: 156, h: 20 },
    titleBox: { x: 100, y: 40, w: 222, h: 48 },
    divider: { x: 110, y: 94, w: 202, h: 2 },
    bodyBox: { x: 26, y: 472, w: 368, h: 166 },
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

export const PRINTED_CARD_TEMPLATE_SPEC: FantasyCardTemplateSpec = {
  ...FANTASY_CARD_TEMPLATE_SPEC,
  cornerRadius: 22,
  regions: {
    ...FANTASY_CARD_TEMPLATE_SPEC.regions,
    artFrame: { x: 0, y: 0, w: 420, h: 690 },
    header: { x: 18, y: 12, w: 384, h: 50 },
    leftRail: { x: 20, y: 12, w: 48, h: 48 },
    typeBadge: { x: 20, y: 12, w: 48, h: 48 },
    rightRail: { x: 354, y: 76, w: 48, h: 160 },
    titleBox: { x: 76, y: 22, w: 302, h: 30 },
    divider: { x: 76, y: 62, w: 302, h: 0 },
    rulesBand: { x: 18, y: 416, w: 384, h: 38 },
    rulesCaption: { x: 76, y: 430, w: 268, h: 28 },
    headerTrim: { x: 76, y: 8, w: 302, h: 4 },
    rulesTrim: { x: 44, y: 424, w: 332, h: 4 },
    bodyTrim: { x: 44, y: 640, w: 332, h: 4 },
    tierFrame: { x: 18, y: 454, w: 384, h: 182 },
    bodyBox: { x: 34, y: 468, w: 352, h: 152 },
    footer: { x: 18, y: 646, w: 384, h: 44 },
    progress: { x: 160, y: 674, w: 100, h: 12 },
    wtPlate: { x: 32, y: 650, w: 110, h: 20 },
    slotLabel: { x: 248, y: 650, w: 140, h: 20 },
    tierDiamond: { x: 198, y: 647, w: 24, h: 24 },
  },
  archetypeStack: { w: 48, h: 48, firstCenterY: 24, pitch: 56, max: 3 },
  cornerArt: { inset: 10, length: 12, innerGap: 4, diamond: 3, overshoot: 4 },
  printed: {
    background: 0x164f83, panel: 0xffffff, ink: '#202b3b', frameInset: 0,
    titlePlate: { x: 18, y: 12, w: 384, h: 50 },
    progressBox: { x: 160, y: 674, w: 100, h: 12 }, artRadius: 22,
    rowGap: 5, labelWidth: 66, labelFontSize: 11,
    bodyFontSize: 15, bodyMinFontSize: 8, bodyLineHeightRatio: 1.25,
    labelMinScale: 0.6, compactLabelWidth: 6,
    frameStroke: 2, panelStroke: 2,
    bandColor: 0x65b8ed, caption: 'RULES', captionFontSize: 23, titleInk: '#082b4c',
  },
};

export function cardTemplateSpec(variant: FantasyCardTemplateVariant): FantasyCardTemplateSpec {
  return variant === 'printed-v2' ? PRINTED_CARD_TEMPLATE_SPEC : FANTASY_CARD_TEMPLATE_SPEC;
}

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

export function fantasyTitleLayout(
  titleRule: FantasyTemplateTextRuleKey,
  cardScale: number,
  spec: FantasyCardTemplateSpec = FANTASY_CARD_TEMPLATE_SPEC,
): FantasyTitleLayout {
  const rule = spec.textRules[titleRule];
  const { titleBox, divider } = spec.regions;
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
