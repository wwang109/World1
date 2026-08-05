import Phaser from 'phaser';
import { playSfx } from '../audio/sfxSynth';
import type { SfxKey } from '../audio/sfxRecipes';
import type { LayoutProfile } from '../layoutProfile';
import type { RunNodeKind } from '../runStore';
import { FONT, UI } from '../theme';
import { auditControlLabel, auditTextBlock } from './controlLayoutAudit';
import { addRunArt } from './runArt';

export interface RunChoiceImage {
  textureKey: string;
}

export interface RunChoiceViewModel {
  nodeId: string;
  kind: RunNodeKind;
  title: string;
  detail: string;
  footer?: string;
  image?: RunChoiceImage;
  accent: number;
  enabled: boolean;
}

function trackObject(track: Phaser.GameObjects.GameObject[] | undefined, object: Phaser.GameObjects.GameObject): void {
  track?.push(object);
}

export function renderRunChoicePanel(
  scene: Phaser.Scene,
  bounds: { x: number; y: number; w: number; h: number },
  model: RunChoiceViewModel,
  opts: { font: LayoutProfile['font']; onSelect: () => void; track?: Phaser.GameObjects.GameObject[]; sfx?: SfxKey },
): void {
  const railW = 6;
  const inset = Math.max(14, opts.font.small + 6);
  const imageSize = model.image ? Math.min(46, Math.max(28, bounds.h - inset * 2)) : 0;
  const imageGap = imageSize > 0 ? 8 : 0;
  const contentX = bounds.x + railW + inset + imageSize + imageGap;
  const contentW = Math.max(0, bounds.w - railW - inset * 2 - imageSize - imageGap);
  const actionCopy = model.enabled ? 'SELECT' : 'LOCKED';
  const actionReserve = Math.max(56, opts.font.tiny * 6 + 8);
  const fill = model.enabled ? UI.panel : UI.panelMuted;
  const alpha = model.enabled ? 0.95 : 0.56;
  const panel = scene.add.rectangle(bounds.x, bounds.y, bounds.w, bounds.h, fill, alpha)
    .setOrigin(0, 0)
    .setStrokeStyle(2, model.accent, model.enabled ? 0.9 : 0.38);
  const rail = scene.add.rectangle(bounds.x, bounds.y, railW, bounds.h, model.accent, model.enabled ? 1 : 0.48).setOrigin(0, 0);
  const image = model.image
    ? addRunArt(scene, model.image.textureKey, {
      x: bounds.x + railW + inset,
      y: bounds.y + (bounds.h - imageSize) / 2,
      width: imageSize,
      height: imageSize,
    }, model.enabled ? 1 : 0.48)
    : undefined;
  const title = scene.add.text(contentX, bounds.y + inset - 2, model.title, {
    fontFamily: FONT.display,
    fontStyle: 'bold',
    fontSize: `${opts.font.name}px`,
    color: model.enabled ? UI.text : UI.textSoft,
    wordWrap: { width: Math.max(0, contentW - actionReserve) },
  });
  const action = scene.add.text(bounds.x + bounds.w - inset, bounds.y + inset, actionCopy, {
    fontFamily: FONT.body,
    fontStyle: 'bold',
    fontSize: `${opts.font.tiny}px`,
    color: model.enabled ? UI.textAccent : UI.textSoft,
  }).setOrigin(1, 0);
  const detailY = bounds.y + inset + title.height + 5;
  const detailMaxH = Math.max(opts.font.tiny, bounds.h - (detailY - bounds.y) - inset - (model.footer ? opts.font.tiny + 7 : 0));
  const detail = scene.add.text(contentX, detailY, model.detail, {
    fontFamily: FONT.body,
    fontSize: `${opts.font.small}px`,
    color: model.enabled ? UI.textDim : UI.textSoft,
    wordWrap: { width: contentW },
    lineSpacing: 2,
  });
  let footer: Phaser.GameObjects.Text | undefined;
  if (model.footer) {
    footer = scene.add.text(contentX, bounds.y + bounds.h - inset, model.footer, {
      fontFamily: FONT.body,
      fontStyle: 'bold',
      fontSize: `${opts.font.tiny}px`,
      color: model.enabled ? UI.textAccent : UI.textSoft,
      wordWrap: { width: contentW },
    }).setOrigin(0, 1);
  }

  trackObject(opts.track, panel);
  trackObject(opts.track, rail);
  if (image) trackObject(opts.track, image);
  trackObject(opts.track, title);
  trackObject(opts.track, action);
  trackObject(opts.track, detail);
  if (footer) trackObject(opts.track, footer);

  auditControlLabel(panel, title, {
    name: `${model.nodeId} choice`,
    horizontalPadding: railW + inset + imageSize + imageGap,
    verticalPadding: inset,
    minFontSize: 8,
  });
  auditTextBlock(title, { name: `${model.nodeId} title`, maxWidth: Math.max(0, contentW - actionReserve), maxHeight: Math.max(opts.font.name * 2, bounds.h * 0.42), minFontSize: 8 });
  auditTextBlock(action, { name: `${model.nodeId} ${actionCopy.toLowerCase()} affordance`, maxWidth: actionReserve, maxHeight: opts.font.tiny * 2, minFontSize: 8 });
  auditTextBlock(detail, { name: `${model.nodeId} detail`, maxWidth: contentW, maxHeight: detailMaxH, minFontSize: 8 });
  if (footer) auditTextBlock(footer, { name: `${model.nodeId} footer`, maxWidth: contentW, maxHeight: opts.font.tiny * 2, minFontSize: 8 });

  if (!model.enabled) return;
  panel.setInteractive({ useHandCursor: true });
  panel.on('pointerover', () => panel.setFillStyle(UI.slotHover, 0.95));
  panel.on('pointerout', () => panel.setFillStyle(fill, alpha));
  panel.on('pointerdown', () => { playSfx(opts.sfx ?? 'uiClick'); opts.onSelect(); });
}
