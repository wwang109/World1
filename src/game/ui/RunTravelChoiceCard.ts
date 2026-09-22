import type Phaser from 'phaser';
import { playSfx } from '../audio/sfxSynth';
import { textRoleFor, TEXT_ROLE_SPEC, UI, type InkRole, type TextRole } from '../theme';
import { auditControlLabel, auditTextBlock } from './controlLayoutAudit';
import { appearPanel, attachButtonFeel, flashConfirm } from './motion';
import { addRunArt } from './runArt';
import { runTravelChoiceCardCopy } from './runTravelChoiceCardCopy';
import type { RunTravelChoiceViewModel } from './runTravelChoiceViewModel';
import type { Rect } from './runScreenTemplate';
import { roundRect } from './roundedRect';

interface TravelCardOptions { compact: boolean; pending?: boolean; expanded?: boolean; clip?: Rect; fitHeight?: boolean }

export interface RunTravelChoiceCardLayout {
  bounds: Rect;
  art?: Rect;
  header?: Rect;
  eyebrow: Rect;
  title: Rect;
  detail: Rect;
  footer?: Rect;
  requirements?: { heading: Rect; lines: Rect[] };
  action: Rect;
  dossier?: { summary: Rect; toggle?: Rect };
}

/** Existing semantic tones carry destination and risk, never a new palette. */
function travelCardColors(model: RunTravelChoiceViewModel): { edge: number; ink: InkRole } {
  if (model.kind === 'boss') return { edge: UI.bad, ink: 'alarm' };
  if (model.kind === 'shop') return { edge: UI.good, ink: 'gain' };
  if (model.kind === 'event') return { edge: UI.chip, ink: 'accent' };
  if (model.dossier?.difficulty === 'EASY' || model.title.endsWith(' · EASY')) return { edge: UI.good, ink: 'gain' };
  if (model.dossier?.difficulty === 'HARD' || model.title.endsWith(' · HARD')) return { edge: UI.bad, ink: 'alarm' };
  return { edge: UI.waiting, ink: 'resource' };
}

function roleHeight(role: TextRole, compact: boolean): number {
  return Math.ceil(TEXT_ROLE_SPEC[role].size[compact ? 'mobile' : 'desktop'] * 1.4);
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
  if (model.dossier) return encounterDossierLayout(bounds, model, opts);
  const { compact } = opts;
  const pad = compact ? 6 : 12;
  const headerInsetX = compact ? 12 : 16;
  const headerInsetY = compact ? 10 : 12;
  const headerGap = compact ? 10 : 12;
  // The 1.4× line boxes already include leading. Keep compact inter-block
  // spacing small enough for three independently earned receipts on a phone.
  const gap = compact ? 1 : 6;
  const innerW = Math.max(1, bounds.width - pad * 2);
  const copy = runTravelChoiceCardCopy(model, opts.pending);
  const titleRole = compact ? 'statValue' : 'section';
  const detailRole = compact ? 'micro' : 'body';
  const artW = model.artKey ? compact ? 72 : innerW : 0;
  const artH = artW > 0 ? compact ? 60 : Math.min(160, Math.max(104, Math.round(innerW * 0.48))) : 0;
  const textX = bounds.x + pad + (compact && artW > 0 ? artW + 10 : 0);
  const textW = innerW - (compact && artW > 0 ? artW + 10 : 0);
  const art = artW > 0 ? { x: bounds.x + pad, y: bounds.y + pad, width: artW, height: artH } : undefined;
  let cursor = bounds.y + pad + (!compact && art ? artH + 8 : 0);
  const block = (text: string, role: TextRole, x = textX, width = textW, minimumLines = 1): Rect => {
    const rect = { x, y: cursor, width, height: Math.max(minimumLines, textLines(text, width, role, compact)) * roleHeight(role, compact) };
    cursor += rect.height + gap;
    return rect;
  };
  const headerY = cursor;
  const headerTextX = textX + headerInsetX;
  const headerTextW = Math.max(1, textW - headerInsetX * 2);
  cursor += headerInsetY;
  const eyebrow = block(copy.eyebrow, 'kicker', headerTextX, headerTextW);
  cursor = eyebrow.y + eyebrow.height + 6;
  const title = block(copy.title, titleRole, headerTextX, headerTextW);
  const header = { x: textX, y: headerY, width: textW, height: title.y + title.height + headerInsetY - headerY };
  cursor = header.y + header.height + headerGap;
  const detail = block(copy.detail, detailRole);
  if (compact && art) cursor = Math.max(cursor, art.y + art.height + gap);
  const footer = model.footer ? block(model.footer, 'micro', bounds.x + pad, innerW) : undefined;
  let requirements: RunTravelChoiceCardLayout['requirements'];
  if (copy.requirementLines.length > 0) {
    cursor += gap;
    const heading = block(copy.requirementHeading, 'kicker', bounds.x + pad, innerW);
    const lines = copy.requirementLines.map((line) => block(line, 'micro', bounds.x + pad, innerW, compact ? 1 : 2));
    requirements = { heading, lines };
  }
  const actionH = 40;
  const minHeight = cursor - bounds.y + 6 + actionH + pad;
  const height = Math.max(bounds.height, minHeight);
  return {
    bounds: { ...bounds, height }, art, header, eyebrow, title, detail, footer, requirements,
    action: { x: bounds.x + pad, y: bounds.y + height - pad - actionH, width: innerW, height: actionH },
  };
}

/** Substantial dossiers grow with their host, but never past a card-width
 * aspect cap. A tall browser therefore does not turn them into 800px strips. */
function encounterDossierLayout(bounds: Rect, model: RunTravelChoiceViewModel, opts: TravelCardOptions): RunTravelChoiceCardLayout {
  const compact = opts.compact;
  if (compact && opts.fitHeight && !opts.expanded) {
    const x = bounds.x + 10;
    const width = bounds.width - 20;
    const actionWidth = (width - 8) / 2;
    const actionY = bounds.y + bounds.height - 48;
    return {
      bounds,
      eyebrow: { x, y: bounds.y + 8, width, height: 16 },
      title: { x, y: bounds.y + 27, width, height: 36 },
      detail: { x, y: bounds.y + 64, width, height: 1 },
      footer: { x, y: actionY - 22, width, height: 18 },
      action: { x: x + actionWidth + 8, y: actionY, width: actionWidth, height: 40 },
      dossier: {
        summary: { x, y: bounds.y + 65, width, height: 16 },
        toggle: { x, y: actionY, width: actionWidth, height: 40 },
      },
    };
  }
  const pad = compact ? 12 : 14;
  const width = Math.max(1, bounds.width - pad * 2);
  const cap = Math.min(compact ? 720 : 640, bounds.width * (compact ? 1.85 : 2.4));
  const natural = compact ? 330 + model.dossier!.roster.length * (opts.expanded ? 62 : 48) + (opts.expanded ? 100 : 0) : 470;
  const height = compact && opts.fitHeight
    ? Math.min(bounds.height, 257 + model.dossier!.roster.length * 48)
    : Math.max(1, Math.min(cap, Math.max(natural, bounds.height)));
  const x = bounds.x + pad;
  const eyebrow = { x, y: bounds.y + pad, width, height: compact ? 20 : 22 };
  const title = { x, y: eyebrow.y + eyebrow.height + 5, width, height: compact ? 30 : 44 };
  const artH = compact ? 58 : Math.min(160, width * 0.52, height * 0.24);
  const art = { x, y: title.y + title.height + 8, width, height: artH };
  const action = { x, y: bounds.y + height - pad - 40, width, height: 40 };
  const footer = { x, y: action.y - 28, width, height: 20 };
  const summary = { x, y: footer.y - 24, width, height: 18 };
  const toggle = compact && !opts.fitHeight ? { x, y: summary.y - 36, width, height: 30 } : undefined;
  const detailY = art.y + art.height + 12;
  const detail = { x, y: detailY, width, height: Math.max(1, (toggle?.y ?? summary.y) - detailY - 8) };
  return { bounds: { ...bounds, height }, eyebrow, title, art, detail, footer, action, dossier: { summary, toggle } };
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
  const width = opts.compact ? bounds.width : (bounds.width - gap * (models.length - 1)) / models.length;
  const heights = models.map((model) => runTravelChoiceCardMinHeight(model, { ...opts, width }));
  const dossierCap = Math.min(640, width * 2.4);
  const desktopH = models.some((model) => model.dossier)
    ? Math.max(...heights, Math.min(bounds.height, dossierCap)) : Math.max(...heights);
  let y = bounds.y;
  const cards = models.map((_model, index) => {
    const height = opts.compact ? heights[index]! : desktopH;
    const rect = { x: bounds.x + (opts.compact ? 0 : index * (width + gap)), y: opts.compact ? y : bounds.y, width, height };
    y += height + gap;
    return rect;
  });
  return { cards, height: opts.compact ? y - bounds.y - gap : desktopH };
}

export function renderRunTravelChoiceCard(
  scene: Phaser.Scene,
  bounds: Rect,
  model: RunTravelChoiceViewModel,
  opts: TravelCardOptions & { onSelect: () => void; onToggle?: () => void; appearIndex?: number },
): void {
  if (model.dossier) { renderEncounterDossier(scene, bounds, model, opts); return; }
  const layout = runTravelChoiceCardLayout(bounds, model, opts);
  const copy = runTravelChoiceCardCopy(model, opts.pending);
  const profile = opts.compact ? 'mobile' : 'desktop';
  const chain = model.kind === 'event' && model.event?.chainUnlocked === true;
  const colors = travelCardColors(model);
  const fill = model.enabled ? UI.panelAlt : UI.panelMuted;
  const alpha = model.enabled ? 0.98 : 0.6;
  const plate = roundRect(scene.add.rectangle(bounds.x, bounds.y, bounds.width, layout.bounds.height, fill, alpha), opts.compact ? 12 : 0).setOrigin(0, 0)
    .setStrokeStyle(chain ? 3 : 1, colors.edge, model.enabled ? 0.95 : 0.4);
  const parts: Array<Phaser.GameObjects.Rectangle | Phaser.GameObjects.Text | Phaser.GameObjects.Image> = [plate];
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
  addText(layout.eyebrow, copy.eyebrow, 'kicker', colors.ink);
  addText(layout.title, copy.title, opts.compact ? 'statValue' : 'section', 'primary');
  addText(layout.detail, copy.detail, opts.compact ? 'micro' : 'body', 'secondary');
  if (layout.footer && model.footer) addText(layout.footer, model.footer, 'micro', model.footerInk ?? 'accent');
  if (layout.requirements) {
    addText(layout.requirements.heading, copy.requirementHeading, 'kicker', 'gain');
    layout.requirements.lines.forEach((rect, index) => addText(rect, copy.requirementLines[index]!, 'micro', 'secondary'));
  }
  const actionFill = chain && model.enabled ? UI.chip : UI.panelMuted;
  const action = roundRect(scene.add.rectangle(layout.action.x, layout.action.y, layout.action.width, layout.action.height, actionFill, alpha), opts.compact ? 12 : 0)
    .setOrigin(0, 0).setStrokeStyle(1, colors.edge, model.enabled ? 0.9 : 0.4);
  const label = scene.add.text(layout.action.x + layout.action.width / 2, layout.action.y + layout.action.height / 2, copy.action,
    textRoleFor(profile, 'label', { ink: !model.enabled ? 'disabled' : chain ? 'onAccent' : colors.ink })).setOrigin(0.5);
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
    onPress: () => { playSfx('uiClick'); flashConfirm(scene, plate); opts.onSelect(); },
  });
}

function renderEncounterDossier(
  scene: Phaser.Scene, bounds: Rect, model: RunTravelChoiceViewModel,
  opts: TravelCardOptions & { onSelect: () => void; onToggle?: () => void },
): void {
  const dossier = model.dossier!;
  const layout = encounterDossierLayout(bounds, model, opts);
  const copy = runTravelChoiceCardCopy(model, opts.pending);
  const colors = travelCardColors(model);
  const profile = opts.compact ? 'mobile' : 'desktop';
  roundRect(scene.add.rectangle(bounds.x, bounds.y, bounds.width, layout.bounds.height, UI.panelAlt, 0.98), opts.compact ? 12 : 0)
    .setOrigin(0, 0).setStrokeStyle(1, colors.edge, model.enabled ? 0.95 : 0.4);
  const edgeInset = opts.compact ? 12 : 0;
  scene.add.rectangle(bounds.x + edgeInset, bounds.y, bounds.width - edgeInset * 2, 3, colors.edge, 1).setOrigin(0, 0);
  const text = (rect: Rect, value: string, role: TextRole, ink: InkRole): void => {
    const label = scene.add.text(rect.x, rect.y, value, {
      ...textRoleFor(profile, role, { ink: model.enabled ? ink : 'disabled' }), wordWrap: { width: rect.width },
    });
    auditTextBlock(label, { name: `${model.nodeId} dossier ${role}`, maxWidth: rect.width, maxHeight: rect.height, minFontSize: 9 });
  };
  text(layout.eyebrow, copy.eyebrow, 'kicker', colors.ink);
  text(layout.title, copy.title, opts.compact ? 'statValue' : 'section', 'primary');
  if (model.artKey && layout.art) addRunArt(scene, model.artKey, layout.art, model.enabled ? 1 : 0.5);
  const detailed = !opts.compact || opts.expanded;
  const rowH = Math.max(1, layout.detail.height / dossier.roster.length);
  if (!opts.fitHeight || opts.expanded) dossier.roster.forEach((member, index) => {
    const row = { x: layout.detail.x, y: layout.detail.y + index * rowH, width: layout.detail.width, height: rowH };
    if (index > 0) scene.add.rectangle(row.x, row.y - 3, row.width, 1, UI.border, 0.5).setOrigin(0, 0);
    text({ ...row, height: Math.max(1, rowH * 0.52 - 2) }, `${member.name} · LV ${member.level}`, 'label', 'primary');
    text({ ...row, y: row.y + rowH * 0.52, height: Math.max(1, rowH * 0.48 - 5) },
      `${member.tier}${detailed && member.archetypes ? ` · ${member.archetypes}` : ''}`, 'micro', 'secondary');
  });
  text(layout.dossier!.summary, `THREAT · ${dossier.danger}`, 'micro', colors.ink);
  text(layout.footer!, dossier.reward, 'label', 'gain');
  const button = (rect: Rect, value: string, onPress: () => void): void => {
    const box = roundRect(scene.add.rectangle(rect.x, rect.y, rect.width, rect.height, UI.panelMuted, 1), opts.compact ? 12 : 0)
      .setOrigin(0, 0).setStrokeStyle(1, colors.edge, 0.9);
    const label = scene.add.text(rect.x + rect.width / 2, rect.y + rect.height / 2, value,
      textRoleFor(profile, 'label', { ink: model.enabled ? colors.ink : 'disabled' })).setOrigin(0.5);
    auditControlLabel(box, label, { name: `${model.nodeId} dossier action`, horizontalPadding: 8, verticalPadding: 6, minFontSize: 9 });
    if (!model.enabled) return;
    box.setInteractive({ useHandCursor: true });
    // A visual mask does not clip Phaser hit tests. Clip button hits as well.
    if (opts.clip && box.input) {
      const clip = opts.clip;
      const original = box.input.hitAreaCallback;
      box.input.hitAreaCallback = (area, localX, localY, object) => {
        const point = box.getWorldTransformMatrix().transformPoint(localX, localY);
        return point.x >= clip.x && point.x <= clip.x + clip.width && point.y >= clip.y && point.y <= clip.y + clip.height
          && original(area, localX, localY, object);
      };
    }
    attachButtonFeel(scene, box, { fill: UI.panelMuted, hover: UI.chipDark, follow: [label], lift: 0,
      onPress: () => { playSfx('uiClick'); onPress(); } });
  };
  if (layout.dossier!.toggle) button(layout.dossier!.toggle!, opts.fitHeight ? 'DETAILS ›' : opts.expanded ? 'HIDE DETAILS −' : 'ENCOUNTER DETAILS +', () => opts.onToggle?.());
  button(layout.action, copy.action, opts.onSelect);
}
