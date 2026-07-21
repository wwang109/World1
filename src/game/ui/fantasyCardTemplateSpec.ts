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
