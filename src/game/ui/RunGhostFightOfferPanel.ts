import type Phaser from 'phaser';
import { textRoleFor, UI, type InkRole, type TextRole } from '../theme';
import { auditControlLabel, auditTextBlock } from './controlLayoutAudit';
import { attachButtonFeel } from './motion';
import { addRunArt } from './runArt';
import { RUN_ART_KEYS } from './runArtKeys';
import { roundRect } from './roundedRect';
import type { Rect } from './runScreenTemplate';

export interface RunGhostFightOfferViewModel {
  displayName: string;
  level: number;
}

export const GHOST_FIGHT_OFFER_EYEBROW = 'EXTRA FIGHT · OPTIONAL';
export const GHOST_FIGHT_OFFER_WIN_LINE = 'Win and you can save your build for others to fight.';
export const GHOST_FIGHT_OFFER_LOSE_LINE = 'A loss costs a life.';

export function ghostFightOfferSubline(model: RunGhostFightOfferViewModel): string {
  return `LV ${model.level} · a saved player build`;
}

export interface RunGhostFightOfferPanelLayout {
  emblem: Rect;
  eyebrow: Rect;
  headline: Rect;
  sub: Rect;
  winLine: Rect;
  loseLine: Rect;
  faceAction: Rect;
  declineAction: Rect;
}

export function runGhostFightOfferPanelLayout(bounds: Rect, opts: { compact: boolean }): RunGhostFightOfferPanelLayout {
  const { compact } = opts;
  const pad = Math.min(compact ? 16 : 24, bounds.width * 0.05, bounds.height * 0.06);
  const width = Math.max(1, Math.min(bounds.width - pad * 2, compact ? bounds.width - pad * 2 : bounds.width * 0.66));
  const x = bounds.x + (compact ? pad : (bounds.width - width) / 2);
  const emblemSize = Math.min(compact ? 56 : 72, bounds.height * 0.2);
  const emblem = { x, y: bounds.y + pad, width: emblemSize, height: emblemSize };
  const textX = x + emblemSize + 14;
  const textW = width - emblemSize - 14;
  const eyebrow = { x: textX, y: bounds.y + pad, width: textW, height: 18 };
  const headline = { x: textX, y: eyebrow.y + eyebrow.height + 4, width: textW, height: compact ? 24 : 30 };
  const sub = { x: textX, y: headline.y + headline.height + 2, width: textW, height: 18 };
  const rowY = emblem.y + emblem.height + 16;
  const winLine = { x, y: rowY, width, height: compact ? 32 : 22 };
  const loseLine = { x, y: winLine.y + winLine.height + 6, width, height: compact ? 32 : 22 };
  const actionY = loseLine.y + loseLine.height + 16;
  const actionH = compact ? 44 : 48;
  const gap = 12;
  const actionW = (width - gap) / 2;
  const faceAction = { x, y: actionY, width: actionW, height: actionH };
  const declineAction = { x: x + actionW + gap, y: actionY, width: actionW, height: actionH };
  return { emblem, eyebrow, headline, sub, winLine, loseLine, faceAction, declineAction };
}

export function renderRunGhostFightOfferPanel(
  scene: Phaser.Scene,
  bounds: Rect,
  model: RunGhostFightOfferViewModel,
  opts: { compact: boolean; onFace: () => void; onDecline: () => void },
): void {
  const layout = runGhostFightOfferPanelLayout(bounds, opts);
  const profile = opts.compact ? 'mobile' : 'desktop';
  roundRect(scene.add.rectangle(bounds.x, bounds.y, bounds.width, bounds.height, UI.panelMuted, 1), opts.compact ? 12 : 0)
    .setOrigin(0, 0).setStrokeStyle(1, UI.border, 0.8);
  addRunArt(scene, RUN_ART_KEYS.icon.bossSkull, layout.emblem);
  const addText = (rect: Rect, value: string, role: TextRole, ink: InkRole): void => {
    const text = scene.add.text(rect.x, rect.y, value, {
      ...textRoleFor(profile, role, { ink }), wordWrap: { width: rect.width },
    });
    auditTextBlock(text, { name: `Ghost offer ${role}: ${value}`, maxWidth: rect.width, maxHeight: rect.height, minFontSize: 9 });
  };
  addText(layout.eyebrow, GHOST_FIGHT_OFFER_EYEBROW, 'kicker', 'accent');
  addText(layout.headline, model.displayName, 'section', 'primary');
  addText(layout.sub, ghostFightOfferSubline(model), 'micro', 'secondary');

  const winRow = scene.add.rectangle(layout.winLine.x, layout.winLine.y, layout.winLine.width, layout.winLine.height, UI.panelAlt, 0.9)
    .setOrigin(0, 0).setStrokeStyle(1, UI.border, 0.7);
  const winText = scene.add.text(layout.winLine.x + 10, layout.winLine.y + layout.winLine.height / 2, GHOST_FIGHT_OFFER_WIN_LINE,
    { ...textRoleFor(profile, 'micro', { ink: 'secondary' }), wordWrap: { width: layout.winLine.width - 20 } }).setOrigin(0, 0.5);
  auditTextBlock(winText, { name: 'Ghost offer win line', maxWidth: layout.winLine.width - 20, maxHeight: layout.winLine.height, minFontSize: 8 });
  void winRow;

  const loseRow = scene.add.rectangle(layout.loseLine.x, layout.loseLine.y, layout.loseLine.width, layout.loseLine.height, UI.panelAlt, 0.9)
    .setOrigin(0, 0).setStrokeStyle(1, UI.bad, 0.7);
  const loseIcon = { x: layout.loseLine.x + 8, y: layout.loseLine.y + (layout.loseLine.height - 16) / 2, width: 16, height: 16 };
  addRunArt(scene, RUN_ART_KEYS.icon.lifeHeart, loseIcon);
  const loseText = scene.add.text(loseIcon.x + loseIcon.width + 6, layout.loseLine.y + layout.loseLine.height / 2, GHOST_FIGHT_OFFER_LOSE_LINE,
    { ...textRoleFor(profile, 'micro', { ink: 'alarm' }), wordWrap: { width: layout.loseLine.width - loseIcon.width - 34 } }).setOrigin(0, 0.5);
  auditTextBlock(loseText, { name: 'Ghost offer lose line', maxWidth: layout.loseLine.width - loseIcon.width - 34, maxHeight: layout.loseLine.height, minFontSize: 8 });
  void loseRow;

  const face = roundRect(scene.add.rectangle(layout.faceAction.x, layout.faceAction.y, layout.faceAction.width, layout.faceAction.height, UI.bad, 1), opts.compact ? 10 : 0)
    .setOrigin(0, 0).setStrokeStyle(1, UI.bad, 1).setInteractive({ useHandCursor: true });
  const faceLabel = scene.add.text(layout.faceAction.x + layout.faceAction.width / 2, layout.faceAction.y + layout.faceAction.height / 2,
    'FACE IT ›', textRoleFor(profile, 'label', { ink: 'onAlarm' })).setOrigin(0.5);
  auditControlLabel(face, faceLabel, { name: 'Ghost offer face it', horizontalPadding: 8, verticalPadding: 6, minFontSize: 9 });
  attachButtonFeel(scene, face, { fill: UI.bad, hover: UI.bad, lift: 1, follow: [faceLabel], onPress: opts.onFace });

  const decline = roundRect(scene.add.rectangle(layout.declineAction.x, layout.declineAction.y, layout.declineAction.width, layout.declineAction.height, UI.chip, 1), opts.compact ? 10 : 0)
    .setOrigin(0, 0).setStrokeStyle(1, UI.border, 0.9).setInteractive({ useHandCursor: true });
  const declineLabel = scene.add.text(layout.declineAction.x + layout.declineAction.width / 2, layout.declineAction.y + layout.declineAction.height / 2,
    'MOVE ON ›', textRoleFor(profile, 'label', { ink: 'onAccent' })).setOrigin(0.5);
  auditControlLabel(decline, declineLabel, { name: 'Ghost offer move on', horizontalPadding: 8, verticalPadding: 6, minFontSize: 9 });
  attachButtonFeel(scene, decline, { fill: UI.chip, hover: UI.border, follow: [declineLabel], lift: 0, onPress: opts.onDecline });
}
