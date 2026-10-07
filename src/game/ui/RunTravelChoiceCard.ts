import type Phaser from 'phaser';
import { INK, textRoleFor, TEXT_ROLE_SPEC, UI, type InkRole, type TextRole } from '../theme';
import { auditControlLabel, auditTextBlock } from './controlLayoutAudit';
import { appearPanel, attachButtonFeel, flashConfirm } from './motion';
import { addRunArt } from './runArt';
import { runTravelChoiceCardCopy } from './runTravelChoiceCardCopy';
import type { RunTravelChoiceViewModel } from './runTravelChoiceViewModel';
import type { Rect } from './runScreenTemplate';
import { roundRect } from './roundedRect';
import { trackedLootSummary } from './equipmentLootTrackingModel';
import { renderEquipmentChancePanel } from './equipmentPossibleLoot';
import { renderPaintedChrome } from './paintedChrome';

interface TravelCardOptions { compact: boolean; pending?: boolean }

export interface RunTravelChoiceCardLayout {
  bounds: Rect;
  art?: Rect;
  header?: Rect;
  eyebrow: Rect;
  title: Rect;
  detail: Rect;
  footer?: Rect;
  trackedLoot?: Rect;
  requirements?: { heading: Rect; lines: Rect[] };
  action: Rect;
  equipmentDrops?: Rect;
}

/** Existing semantic tones carry destination and risk, never a new palette. */
function travelCardColors(model: RunTravelChoiceViewModel): { edge: number; ink: InkRole } {
  if (model.kind === 'boss') return { edge: UI.bad, ink: 'alarm' };
  if (model.kind === 'shop') return { edge: UI.good, ink: 'gain' };
  if (model.kind === 'event') return { edge: UI.chip, ink: 'accent' };
  if (model.detail.startsWith('EASY · ') || model.title.endsWith(' · EASY')) return { edge: UI.good, ink: 'gain' };
  if (model.detail.startsWith('HARD · ') || model.title.endsWith(' · HARD')) return { edge: UI.bad, ink: 'alarm' };
  return { edge: UI.waiting, ink: 'resource' };
}

function roleHeight(role: TextRole, compact: boolean): number {
  return Math.ceil(TEXT_ROLE_SPEC[role].size[compact ? 'mobile' : 'desktop'] * (compact ? 1.4 : 1.2));
}

/** Conservative word-wrap budget; the renderer also audits real font metrics.
 * Compact receipts use the full width below the art/copy row, so short earned
 * facts need not reserve an unused second line. */
function textLines(text: string, width: number, role: TextRole, compact: boolean): number {
  const size = TEXT_ROLE_SPEC[role].size[compact ? 'mobile' : 'desktop'];
  const capacity = Math.max(1, Math.floor(width / (size * 0.65)));
  let lines = 0;
  for (const paragraph of text.split('\n')) {
    let used = 0;
    lines += 1;
    for (const word of paragraph.split(/\s+/)) {
      const needed = word.length + (used > 0 ? 1 : 0);
      if (used > 0 && used + needed > capacity) { lines += 1; used = 0; }
      if (word.length > capacity) {
        lines += Math.floor((word.length - 1) / capacity);
        used = (word.length - 1) % capacity + 1;
      } else used += word.length + (used > 0 ? 1 : 0);
    }
  }
  return Math.max(1, lines);
}

/** All positions, including the protected receipt and action, are calculated
 * here without starting Phaser. Undersized callers grow to the content floor. */
export function runTravelChoiceCardLayout(
  bounds: Rect,
  model: RunTravelChoiceViewModel,
  opts: TravelCardOptions,
): RunTravelChoiceCardLayout {
  const { compact } = opts;
  const pad = compact ? 6 : 10;
  const headerInsetX = compact ? 12 : 16;
  const headerInsetY = compact ? 10 : 4;
  const headerGap = compact ? 10 : 4;
  // The 1.4× line boxes already include leading. Keep compact inter-block
  // spacing small enough for three independently earned receipts on a phone.
  const gap = compact ? 1 : 4;
  const innerW = Math.max(1, bounds.width - pad * 2);
  const copy = runTravelChoiceCardCopy(model, opts.pending);
  const titleRole = compact ? 'statValue' : 'section';
  const detailRole = compact ? 'micro' : 'body';
  const artW = model.artKey ? compact ? 72 : Math.min(220, Math.round(innerW * 0.28)) : 0;
  const artH = artW > 0 ? compact ? 60 : Math.min(160, Math.max(104, Math.round(innerW * 0.48))) : 0;
  const textX = bounds.x + pad + (artW > 0 ? artW + (compact ? 10 : 16) : 0);
  const textW = bounds.x + bounds.width - pad - textX;
  const art = artW > 0 ? { x: bounds.x + pad, y: bounds.y + pad, width: artW, height: artH } : undefined;
  let cursor = bounds.y + pad;
  const bodyX = compact ? bounds.x + pad : textX;
  const bodyW = compact ? innerW : textW;
  const block = (text: string, role: TextRole, x = textX, width = textW, minimumLines = 1): Rect => {
    const rect = { x, y: cursor, width, height: Math.max(minimumLines, textLines(text, width, role, compact)) * roleHeight(role, compact) };
    cursor += rect.height + gap;
    return rect;
  };
  const headerY = cursor;
  const headerTextX = textX + headerInsetX;
  const headerTextW = Math.max(1, textW - headerInsetX * 2);
  cursor += headerInsetY;
  const iconInset = model.categoryIconKey ? (compact ? 24 : 30) : 0;
  const eyebrow = block(copy.eyebrow, 'kicker', headerTextX + iconInset, headerTextW - iconInset);
  cursor = eyebrow.y + eyebrow.height + (compact ? 6 : 4);
  const title = block(copy.title, titleRole, headerTextX, headerTextW);
  const header = { x: textX, y: headerY, width: textW, height: title.y + title.height + headerInsetY - headerY };
  cursor = header.y + header.height + headerGap;
  const inlineFooter = !compact && model.equipmentDrops !== undefined && model.footer !== undefined;
  const detail = block(copy.detail, detailRole, textX, inlineFooter ? textW / 2 - 6 : textW);
  if (compact && art) cursor = Math.max(cursor, art.y + art.height + gap);
  const detailBottom = cursor;
  if (inlineFooter) cursor = detail.y;
  const footer = model.footer
    ? block(model.footer, 'micro', inlineFooter ? textX + textW / 2 + 6 : bodyX,
      inlineFooter ? textW / 2 - 6 : bodyW, model.footerSegments?.length ?? 1)
    : undefined;
  if (inlineFooter) cursor = Math.max(cursor, detailBottom);
  const trackedLoot = model.trackedLoot?.length
    ? block(trackedLootSummary(model.trackedLoot), 'micro', bodyX, bodyW)
    : undefined;
  let requirements: RunTravelChoiceCardLayout['requirements'];
  if (copy.requirementLines.length > 0) {
    cursor += gap;
    const heading = block(copy.requirementHeading, 'kicker', bodyX, bodyW);
    const lines = copy.requirementLines.map((line) => block(line, 'micro', bodyX, bodyW));
    requirements = { heading, lines };
  }
  const actionH = 40;
  const minHeight = cursor - bounds.y + 6 + actionH + pad;
  const height = Math.max(bounds.height, minHeight);
  if (!compact && art) art.height = height - pad * 2;
  const actionW = model.equipmentDrops ? (bodyW - 8) / 2 : bodyW;
  const actionY = bounds.y + height - pad - actionH;
  return {
    bounds: { ...bounds, height }, art, header, eyebrow, title, detail, footer, trackedLoot, requirements,
    action: { x: bodyX + (model.equipmentDrops ? actionW + 8 : 0), y: actionY, width: actionW, height: actionH },
    ...(model.equipmentDrops ? { equipmentDrops: { x: bodyX, y: actionY, width: actionW, height: actionH } } : {}),
  };
}

export function runTravelChoiceCardMinHeight(
  model: RunTravelChoiceViewModel,
  opts: TravelCardOptions & { width: number },
): number {
  return runTravelChoiceCardLayout({ x: 0, y: 0, width: opts.width, height: 0 }, model, opts).bounds.height;
}

/** Desktop aligns content-sized cards; compact rows each pay for their receipt.
 * Available viewport height is not empty space to inject into every card. */
export function runTravelChoiceCardsLayout(
  bounds: Rect,
  models: readonly RunTravelChoiceViewModel[],
  opts: TravelCardOptions,
): { cards: Rect[]; height: number } {
  if (models.length === 0) return { cards: [], height: 0 };
  const gap = opts.compact ? 8 : 12;
  const width = bounds.width;
  const heights = models.map((model) => runTravelChoiceCardMinHeight(model, { ...opts, width }));
  let y = bounds.y;
  const cards = models.map((_model, index) => {
    const height = heights[index]!;
    const rect = { x: bounds.x, y, width, height };
    y += height + gap;
    return rect;
  });
  return { cards, height: y - bounds.y - gap };
}

export function renderRunTravelChoiceCard(
  scene: Phaser.Scene,
  bounds: Rect,
  model: RunTravelChoiceViewModel,
  opts: TravelCardOptions & { onSelect: () => void; appearIndex?: number; deferSelection?: (select: () => void) => () => void },
): void {
  const layout = runTravelChoiceCardLayout(bounds, model, opts);
  const copy = runTravelChoiceCardCopy(model, opts.pending);
  const profile = opts.compact ? 'mobile' : 'desktop';
  const chain = model.kind === 'event' && model.event?.chainUnlocked === true;
  const colors = travelCardColors(model);
  const fill = model.enabled ? UI.panelAlt : UI.panelMuted;
  const alpha = model.enabled ? 0.98 : 0.6;
  const plate = roundRect(scene.add.rectangle(bounds.x, bounds.y, bounds.width, layout.bounds.height, fill, alpha), opts.compact ? 12 : 0).setOrigin(0, 0)
    .setStrokeStyle(chain ? 3 : 1, colors.edge, model.enabled ? 0.95 : 0.4);
  const parts: Array<Phaser.GameObjects.Rectangle | Phaser.GameObjects.Text | Phaser.GameObjects.Image | Phaser.GameObjects.Container> = [plate];
  const frame = renderPaintedChrome(scene, bounds.x, bounds.y, bounds.width, layout.bounds.height, { borderOnly: true, corner: opts.compact ? 12 : 16 });
  if (frame) parts.push(frame.setAlpha(alpha));
  const edgeInset = opts.compact ? 12 : 0;
  const edge = scene.add.rectangle(bounds.x + edgeInset, bounds.y, bounds.width - edgeInset * 2, 3, colors.edge, alpha).setOrigin(0, 0);
  parts.push(edge);
  if (layout.art && model.artKey) {
    const art = addRunArt(scene, model.artKey, layout.art, model.enabled ? 1 : 0.48);
    if (art) parts.push(art);
  }
  // A bounded header groups kind and name, separate from body facts and CTA.
  const headerBounds = layout.header!;
  const header = roundRect(scene.add.rectangle(headerBounds.x, headerBounds.y, headerBounds.width,
    headerBounds.height, UI.panelMuted, alpha), opts.compact ? 10 : 0).setOrigin(0, 0);
  parts.push(header);
  const addText = (rect: Rect, value: string, role: TextRole, ink: InkRole): Phaser.GameObjects.Text => {
    const text = scene.add.text(rect.x, rect.y, value, {
      ...textRoleFor(profile, role, { ink: model.enabled ? ink : 'disabled' }),
      wordWrap: { width: rect.width },
    });
    auditTextBlock(text, { name: `${model.nodeId} travel ${role}: ${value}`, maxWidth: rect.width, maxHeight: rect.height, minFontSize: 9 });
    parts.push(text);
    return text;
  };
  // A footer segment's identity colour rides a small SWATCH, never the text
  // itself — several of `theme.ts`'s fill palettes fail WCAG AA as a text
  // foreground on this card either way up (see `rewardChipTextColor`'s doc
  // comment, `runTravelChoiceViewModel.ts`); the label stays in an audited ink.
  const addFooterSegment = (rect: Rect, segment: NonNullable<RunTravelChoiceViewModel['footerSegments']>[number]): void => {
    const swatchSize = Math.round(rect.height * 0.42);
    const swatchGap = 5;
    let textX = rect.x;
    if (segment.swatchColor !== undefined) {
      const swatchY = rect.y + (rect.height - swatchSize) / 2;
      const swatch = scene.add.rectangle(rect.x, swatchY, swatchSize, swatchSize, segment.swatchColor, model.enabled ? 1 : 0.4).setOrigin(0, 0);
      parts.push(swatch);
      textX = rect.x + swatchSize + swatchGap;
    }
    const text = scene.add.text(textX, rect.y, segment.text, {
      ...textRoleFor(profile, 'micro'),
      color: model.enabled ? segment.textColor : INK.disabled,
      wordWrap: { width: Math.max(1, rect.x + rect.width - textX) },
    });
    auditTextBlock(text, { name: `${model.nodeId} travel footer segment: ${segment.text}`, maxWidth: Math.max(1, rect.x + rect.width - textX), maxHeight: rect.height, minFontSize: 9 });
    parts.push(text);
  };
  if (model.categoryIconKey) {
    const size = opts.compact ? 20 : 24;
    const icon = scene.add.image(layout.eyebrow.x - size / 2 - 4, layout.eyebrow.y + layout.eyebrow.height / 2,
      model.categoryIconKey).setDisplaySize(size, size).setAlpha(model.enabled ? 1 : 0.48)
      .setName(`event-category-${model.nodeId}`);
    parts.push(icon);
  }
  addText(layout.eyebrow, copy.eyebrow, 'kicker', colors.ink);
  addText(layout.title, copy.title, opts.compact ? 'statValue' : 'section', 'primary');
  addText(layout.detail, copy.detail, opts.compact ? 'micro' : 'body', 'secondary');
  if (layout.footer && model.footerSegments && model.footerSegments.length > 0) {
    const lineH = layout.footer.height / model.footerSegments.length;
    model.footerSegments.forEach((segment, index) => {
      addFooterSegment({ x: layout.footer!.x, y: layout.footer!.y + index * lineH, width: layout.footer!.width, height: lineH }, segment);
    });
  } else if (layout.footer && model.footer) {
    addText(layout.footer, model.footer, 'micro', model.footerInk ?? 'accent');
  }
  if (layout.requirements) {
    addText(layout.requirements.heading, copy.requirementHeading, 'kicker', 'gain');
    layout.requirements.lines.forEach((rect, index) => addText(rect, copy.requirementLines[index]!, 'micro', 'secondary'));
  }
  if (layout.trackedLoot && model.trackedLoot?.length) {
    const label = addText(layout.trackedLoot, trackedLootSummary(model.trackedLoot), 'micro', 'accent');
    label.setData('equipmentTrackedLoot', model.nodeId).setInteractive({ useHandCursor: true })
      .on('pointerdown', () => renderEquipmentChancePanel(scene, opts.compact, model.trackedLoot!));
  }
  if (layout.equipmentDrops && model.equipmentDrops) {
    const rect = layout.equipmentDrops;
    const dropButton = roundRect(scene.add.rectangle(rect.x, rect.y, rect.width, rect.height, UI.panelMuted, 1), opts.compact ? 12 : 0)
      .setOrigin(0).setStrokeStyle(1, UI.border).setData('equipmentDropButton', model.nodeId).setInteractive({ useHandCursor: true });
    const dropLabel = scene.add.text(rect.x + rect.width / 2, rect.y + rect.height / 2, 'EQUIPMENT DROPS',
      textRoleFor(profile, 'label', { ink: 'accent' })).setOrigin(0.5);
    auditControlLabel(dropButton, dropLabel, { name: `${model.nodeId} equipment drops`, horizontalPadding: 8, verticalPadding: 6, minFontSize: 9 });
    parts.push(dropButton, dropLabel);
    const showDrops = () => renderEquipmentChancePanel(scene, opts.compact, model.equipmentDrops!);
    attachButtonFeel(scene, dropButton, { fill: UI.panelMuted, hover: UI.chipDark, lift: 0, follow: [dropLabel],
      onPress: opts.deferSelection ? opts.deferSelection(showDrops) : showDrops });
    const dropChrome = dropButton.getData('paintedButtonChrome') as Phaser.GameObjects.Container | undefined;
    if (dropChrome) parts.splice(parts.indexOf(dropLabel), 0, dropChrome);
  }
  const actionFill = chain && model.enabled ? UI.chip : UI.panelMuted;
  const action = roundRect(scene.add.rectangle(layout.action.x, layout.action.y, layout.action.width, layout.action.height, actionFill, alpha), opts.compact ? 12 : 0)
    .setOrigin(0, 0).setStrokeStyle(1, colors.edge, model.enabled ? 0.9 : 0.4).setData('runTravelAction', model.nodeId);
  const label = scene.add.text(layout.action.x + layout.action.width / 2, layout.action.y + layout.action.height / 2, copy.action,
    textRoleFor(profile, 'label', { ink: !model.enabled ? 'disabled' : chain ? 'onAccent' : colors.ink })).setOrigin(0.5).setData('runTravelActionLabel', model.nodeId);
  auditControlLabel(action, label, { name: `${model.nodeId} travel action`, horizontalPadding: 8, verticalPadding: 6, minFontSize: 9 });
  parts.push(action, label);
  if (opts.appearIndex !== undefined) {
    // Entrance owns the parent transform/alpha; hover owns only the action's
    // fill. A fast pointerover must not kill the action's arrival mid-tween.
    const entrance = scene.add.container(0, 0, parts);
    appearPanel(scene, [entrance], { delay: opts.appearIndex * 45, stagger: 0 });
  }
  if (!model.enabled) return;
  action.setInteractive({ useHandCursor: true });
  attachButtonFeel(scene, action, {
    fill: actionFill, hover: UI.chipDark, alpha, lift: 0, follow: [label],
    onPress: () => { flashConfirm(scene, plate); opts.onSelect(); },
  });
}
