import Phaser from 'phaser';
import { DISPLAY_THEME, FONT, SCREEN, TYPE_SCALE, UI } from '../theme';
import { auditControlLabel, auditTextBlock } from './controlLayoutAudit';

export interface DisplayBounds {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PanelShellOptions {
  fill?: number;
  alpha?: number;
  accent?: number;
  track?: Phaser.GameObjects.GameObject[];
}

/**
 * Vertical center of a panel's standard header band — align title and header
 * controls to this. The visible band runs from the inner frame line to the
 * divider, so the center is measured between those, not from the panel edge.
 */
export function panelHeaderCenterY(bounds: DisplayBounds): number {
  return bounds.y + Math.round((DISPLAY_THEME.chrome.frameInset + DISPLAY_THEME.spacing.panelHeaderH) / 2);
}

/**
 * Center Y of the Nth control row (0-based) below a panel's header divider.
 * Row 0 clears the divider by panelToolbarGap; rows repeat at panelToolbarPitch.
 */
export function panelToolbarRowY(bounds: DisplayBounds, row = 0): number {
  const { panelHeaderH, panelControlH, panelToolbarGap, panelToolbarPitch } = DISPLAY_THEME.spacing;
  return bounds.y + panelHeaderH + panelToolbarGap + panelControlH / 2 + row * panelToolbarPitch;
}

export interface BackdropOptions {
  track?: Phaser.GameObjects.GameObject[];
}

export interface CompactTextBlockOptions {
  name: string;
  maxWidth: number;
  maxHeight: number;
  lineSpacing?: number;
  minFontSize?: number;
  track?: Phaser.GameObjects.GameObject[];
}

export interface StatRow {
  label: string;
  value: string;
  color?: string;
}

export interface StepperControlOptions {
  label: string;
  value: string;
  width: number;
  onDec: () => void;
  onInc: () => void;
  canDec: boolean;
  canInc: boolean;
  track?: Phaser.GameObjects.GameObject[];
}

function trackObject(track: Phaser.GameObjects.GameObject[] | undefined, object: Phaser.GameObjects.GameObject): void {
  if (track) track.push(object);
}

function drawCornerBracket(
  scene: Phaser.Scene,
  x: number,
  y: number,
  flipX: 1 | -1,
  flipY: 1 | -1,
  color: number,
  track?: Phaser.GameObjects.GameObject[],
): void {
  const h1 = scene.add.rectangle(x, y, 18, 2, color, 0.72).setOrigin(flipX > 0 ? 0 : 1, flipY > 0 ? 0 : 1);
  const v1 = scene.add.rectangle(x, y, 2, 18, color, 0.72).setOrigin(flipX > 0 ? 0 : 1, flipY > 0 ? 0 : 1);
  trackObject(track, h1);
  trackObject(track, v1);
}

export function drawBackdrop(scene: Phaser.Scene, opts: BackdropOptions = {}): void {
  const base = scene.add.rectangle(0, 0, SCREEN.width, SCREEN.height, UI.bg).setOrigin(0, 0);
  const topBloom = scene.add.circle(-58, 100, 280, UI.bgBlobA, 0.26);
  const midBloom = scene.add.circle(624, 250, 220, UI.bgBlobB, 0.18);
  const lowerBloom = scene.add.circle(324, 1128, 280, UI.bgBlobC, 0.18);
  const bandA = scene.add.rectangle(0, 468, SCREEN.width, 212, UI.bgBlobA, 0.08).setOrigin(0, 0);
  const bandB = scene.add.rectangle(0, 950, SCREEN.width, 230, UI.bgBlobB, 0.1).setOrigin(0, 0);
  const border = scene.add.rectangle(14, 14, SCREEN.width - 28, SCREEN.height - 28, 0, 0).setOrigin(0, 0).setStrokeStyle(1, UI.border, 0.52);

  trackObject(opts.track, base);
  trackObject(opts.track, topBloom);
  trackObject(opts.track, midBloom);
  trackObject(opts.track, lowerBloom);
  trackObject(opts.track, bandA);
  trackObject(opts.track, bandB);
  trackObject(opts.track, border);

  drawCornerBracket(scene, 22, 22, 1, 1, UI.border, opts.track);
  drawCornerBracket(scene, SCREEN.width - 22, 22, -1, 1, UI.border, opts.track);
  drawCornerBracket(scene, 22, SCREEN.height - 22, 1, -1, UI.border, opts.track);
  drawCornerBracket(scene, SCREEN.width - 22, SCREEN.height - 22, -1, -1, UI.border, opts.track);
}

export function drawPanelShell(
  scene: Phaser.Scene,
  bounds: DisplayBounds,
  label: string,
  opts: PanelShellOptions = {},
): {
    shadow: Phaser.GameObjects.Rectangle;
    panel: Phaser.GameObjects.Rectangle;
    line: Phaser.GameObjects.Rectangle;
    title: Phaser.GameObjects.Text;
  } {
  const fill = opts.fill ?? UI.panel;
  const alpha = opts.alpha ?? DISPLAY_THEME.chrome.panelAlpha;
  const accentColor = opts.accent ?? UI.chip;
  const headerH = DISPLAY_THEME.spacing.panelHeaderH;
  const inset = DISPLAY_THEME.spacing.panelHeaderInset;

  const shadow = scene.add.rectangle(bounds.x + 3, bounds.y + 4, bounds.w, bounds.h, UI.shadow, DISPLAY_THEME.chrome.shadowAlpha).setOrigin(0, 0);
  const panel = scene.add.rectangle(bounds.x, bounds.y, bounds.w, bounds.h, fill, alpha).setOrigin(0, 0).setStrokeStyle(1.25, accentColor, 0.54);
  const line = scene.add.rectangle(bounds.x, bounds.y + headerH, bounds.w, 1, UI.border, DISPLAY_THEME.chrome.lineAlpha).setOrigin(0, 0);
  const frameInset = DISPLAY_THEME.chrome.frameInset;
  const inner = scene.add.rectangle(bounds.x + frameInset, bounds.y + frameInset, bounds.w - frameInset * 2, bounds.h - frameInset * 2, 0, 0).setOrigin(0, 0).setStrokeStyle(1, UI.border, 0.22);
  const title = scene.add.text(bounds.x + inset, panelHeaderCenterY(bounds), label, {
    fontSize: TYPE_SCALE.small,
    color: UI.text,
    fontFamily: FONT.body,
    fontStyle: 'bold',
    letterSpacing: 1.2,
  }).setOrigin(0, 0.5);

  trackObject(opts.track, shadow);
  trackObject(opts.track, panel);
  trackObject(opts.track, line);
  trackObject(opts.track, inner);
  trackObject(opts.track, title);

  drawCornerBracket(scene, bounds.x + 6, bounds.y + 6, 1, 1, accentColor, opts.track);
  drawCornerBracket(scene, bounds.x + bounds.w - 6, bounds.y + 6, -1, 1, accentColor, opts.track);
  drawCornerBracket(scene, bounds.x + 6, bounds.y + bounds.h - 6, 1, -1, accentColor, opts.track);
  drawCornerBracket(scene, bounds.x + bounds.w - 6, bounds.y + bounds.h - 6, -1, -1, accentColor, opts.track);

  return { shadow, panel, line, title };
}

export function drawCompactTextBlock(
  scene: Phaser.Scene,
  x: number,
  y: number,
  text: string,
  style: Phaser.Types.GameObjects.Text.TextStyle,
  opts: CompactTextBlockOptions,
): Phaser.GameObjects.Text {
  const label = scene.add.text(x, y, text, {
    ...style,
    wordWrap: { width: opts.maxWidth },
    lineSpacing: opts.lineSpacing ?? 4,
  });
  auditTextBlock(label, {
    name: opts.name,
    maxWidth: opts.maxWidth,
    maxHeight: opts.maxHeight,
    minFontSize: opts.minFontSize,
  });
  trackObject(opts.track, label);
  return label;
}

export function drawStatRows(
  scene: Phaser.Scene,
  x: number,
  y: number,
  rows: StatRow[],
  opts: { width: number; rowGap?: number; track?: Phaser.GameObjects.GameObject[] } = { width: 200 },
): Phaser.GameObjects.Text[] {
  const rowGap = opts.rowGap ?? DISPLAY_THEME.spacing.rowGap;
  const labels: Phaser.GameObjects.Text[] = [];
  let offsetY = y;

  for (const row of rows) {
    const label = scene.add.text(x, offsetY, row.label, {
      fontSize: DISPLAY_THEME.typography.small,
      color: UI.textDim,
      fontFamily: FONT.body,
      fontStyle: 'bold',
    });
    const value = scene.add.text(x + opts.width, offsetY, row.value, {
      fontSize: DISPLAY_THEME.typography.small,
      color: row.color ?? UI.text,
      fontFamily: FONT.body,
      fontStyle: 'bold',
    }).setOrigin(1, 0);
    trackObject(opts.track, label);
    trackObject(opts.track, value);
    labels.push(label, value);
    offsetY += rowGap + Math.max(label.height, value.height);
  }

  return labels;
}

export function drawStepperControl(
  scene: Phaser.Scene,
  x: number,
  y: number,
  opts: StepperControlOptions,
): void {
  const height = 28;
  const labelW = Math.max(28, Math.min(42, 14 + opts.label.length * 6));
  const buttonW = 22;
  const valueW = Math.max(28, opts.width - labelW - (buttonW * 2) - 10);
  const valueX = x + labelW + 4 + buttonW + 4;

  const shadow = scene.add.rectangle(x + 2, y + 3, opts.width, height, UI.shadow, DISPLAY_THEME.chrome.shadowAlpha).setOrigin(0, 0);
  const panel = scene.add.rectangle(x, y, opts.width, height, UI.panel, 0.82).setOrigin(0, 0).setStrokeStyle(1.1, UI.border, 0.55);
  const labelCell = scene.add.rectangle(x + labelW / 2, y + height / 2, labelW, height - 4, UI.chipDark, 0.72).setStrokeStyle(1, UI.border, 0.34);
  const decRect = scene.add.rectangle(x + labelW + 4 + buttonW / 2, y + height / 2, buttonW, height - 4, opts.canDec ? UI.panelMuted : UI.slot, 0.96)
    .setStrokeStyle(1, UI.border, opts.canDec ? 0.68 : 0.32)
    .setInteractive({ useHandCursor: opts.canDec });
  const valueCell = scene.add.rectangle(valueX + valueW / 2, y + height / 2, valueW, height - 4, UI.panelAlt, 0.86).setStrokeStyle(1, UI.border, 0.42);
  const incRect = scene.add.rectangle(x + opts.width - buttonW / 2 - 2, y + height / 2, buttonW, height - 4, opts.canInc ? UI.panelMuted : UI.slot, 0.96)
    .setStrokeStyle(1, UI.border, opts.canInc ? 0.68 : 0.32)
    .setInteractive({ useHandCursor: opts.canInc });
  const labelText = scene.add.text(x + labelW / 2, y + height / 2, opts.label, {
    fontSize: '10px',
    color: UI.textDim,
    fontFamily: FONT.body,
    fontStyle: 'bold',
  }).setOrigin(0.5);
  const valueText = scene.add.text(valueX + valueW / 2, y + height / 2, opts.value, {
    fontSize: '12px',
    color: UI.text,
    fontFamily: FONT.body,
    fontStyle: 'bold',
  }).setOrigin(0.5);
  const decText = scene.add.text(x + labelW + 4 + buttonW / 2, y + height / 2, '−', {
    fontSize: '12px',
    color: opts.canDec ? UI.text : UI.textSoft,
    fontFamily: FONT.body,
    fontStyle: 'bold',
  }).setOrigin(0.5);
  const incText = scene.add.text(x + opts.width - buttonW / 2 - 2, y + height / 2, '+', {
    fontSize: '12px',
    color: opts.canInc ? UI.text : UI.textSoft,
    fontFamily: FONT.body,
    fontStyle: 'bold',
  }).setOrigin(0.5);

  const controlTrack = opts.track;
  trackObject(controlTrack, shadow);
  trackObject(controlTrack, panel);
  trackObject(controlTrack, labelCell);
  trackObject(controlTrack, decRect);
  trackObject(controlTrack, valueCell);
  trackObject(controlTrack, incRect);
  trackObject(controlTrack, labelText);
  trackObject(controlTrack, valueText);
  trackObject(controlTrack, decText);
  trackObject(controlTrack, incText);

  auditControlLabel(labelCell, labelText, { name: `${opts.label} label`, horizontalPadding: 4, verticalPadding: 4, minFontSize: 8 });
  auditControlLabel(decRect, decText, { name: `${opts.label} minus`, horizontalPadding: 4, verticalPadding: 4, minFontSize: 8 });
  auditControlLabel(valueCell, valueText, { name: `${opts.label} value`, horizontalPadding: 4, verticalPadding: 4, minFontSize: 8 });
  auditControlLabel(incRect, incText, { name: `${opts.label} plus`, horizontalPadding: 4, verticalPadding: 4, minFontSize: 8 });

  if (opts.canDec) {
    decRect.on('pointerdown', opts.onDec);
  }
  if (opts.canInc) {
    incRect.on('pointerdown', opts.onInc);
  }
}
