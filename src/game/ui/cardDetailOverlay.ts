import Phaser from 'phaser';
import type { SkillDef } from '../../engine/types';
import { powerLevelDeci } from '../../engine/balance';
import { playSfx } from '../audio/sfxSynth';
import type { LayoutProfile } from '../layoutProfile';
import { FONT, SCREEN, UI } from '../theme';
import { FantasyCardTemplateV2 } from './FantasyCardTemplateV2';
import { renderCardInfoBox } from './cardInfoBox';

export function renderDetailOverlayHeader(
  scene: Phaser.Scene,
  skill: SkillDef,
  opts: {
    onClose: () => void; font: LayoutProfile['font']; title?: string;
    panelWidth?: number; cardWidth?: number; cardHeightFraction?: number;
  },
): {
  centerX: number; paneWidth: number; y: number; contentTop: number;
  originX: number; originY: number; W: number; H: number; embedded: boolean;
} {
  const embedded = scene.data?.get('embeddedRunView') as { x: number; y: number; width: number; height: number } | undefined;
  const W = embedded?.width ?? SCREEN.width;
  const H = embedded?.height ?? SCREEN.height;
  const originX = embedded?.x ?? 0;
  const originY = embedded?.y ?? 0;
  const veil = scene.add.rectangle(originX, originY, W, H, 0x05070c, 0.88).setOrigin(0, 0).setInteractive();
  veil.on('pointerdown', () => { playSfx('uiBack'); opts.onClose(); });

  const closeBtn = scene.add.rectangle(originX + W - 30, originY + (embedded ? 26 : 46), 28, 28, 0x24344a, 1)
    .setOrigin(0.5).setStrokeStyle(1, 0x8a94a6, 0.8).setInteractive({ useHandCursor: true }).setDepth(1);
  scene.add.text(closeBtn.x, closeBtn.y, '×', {
    fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${opts.font.xlarge}px`, color: UI.textBright,
  }).setOrigin(0.5).setDepth(1);
  closeBtn.on('pointerdown', (_p: Phaser.Input.Pointer, _lx: number, _ly: number, event: Phaser.Types.Input.EventData) => {
    event.stopPropagation();
    playSfx('uiBack');
    opts.onClose();
  });

  const paneWidth = Math.min(W - 40, opts.panelWidth ?? Infinity);
  const centerX = originX + W / 2;
  const cardWidthCap = opts.cardWidth ?? 140;
  const cardHeightFraction = opts.cardHeightFraction ?? 0.32;
  const cardW = embedded ? Math.min(cardWidthCap, W * 0.35, Math.max(60, H * cardHeightFraction) / (690 / 420)) : cardWidthCap;
  const cardH = cardW * (690 / 420);
  let y = originY + (embedded ? 46 : 66);
  const contentTop = y;
  if (opts.title) {
    const title = scene.add.text(originX + 20, y - 34, opts.title.toUpperCase(), {
      fontFamily: FONT.display, fontStyle: 'bold', fontSize: `${opts.font.label}px`, color: UI.textAccent,
    }).setOrigin(0, 0.5);
    title.setDepth(2);
  }
  const cardY = y + cardH / 2;
  new FantasyCardTemplateV2(scene, centerX, cardY, skill, { width: cardW, height: cardH, tier: skill.tier, glossary: false }).setDepth(1);
  y = cardY + cardH / 2 + 10;

  const name = scene.add.text(centerX, y, skill.name, {
    fontFamily: FONT.display, fontStyle: 'bold', fontSize: `${opts.font.heading}px`, color: UI.textBright,
    align: 'center', wordWrap: { width: paneWidth },
  }).setOrigin(0.5, 0).setDepth(1);
  y += name.height + 4;
  return { centerX, paneWidth, y, contentTop, originX, originY, W, H, embedded: embedded !== undefined };
}

export function renderCardDetailOverlay(
  scene: Phaser.Scene,
  skill: SkillDef,
  opts: {
    onClose: () => void;
    font: LayoutProfile['font'];
    title?: string;
    primaryAction?: { label: string; enabled: boolean; onPress: () => void };
  },
): void {
  const { centerX, paneWidth, y: headerY, originY, W, H, embedded } = renderDetailOverlayHeader(scene, skill, opts);
  let y = headerY;

  const plDeci = powerLevelDeci(skill);
  const plLine = scene.add.text(centerX, y, `POWER ${(plDeci / 10).toFixed(0)} · ${skill.tier.toUpperCase()}`, {
    fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${opts.font.label}px`, color: '#e8b446',
  }).setOrigin(0.5, 0);
  y += plLine.height + 10;

  const infoTop = y;
  const actionHeight = opts.primaryAction ? 52 : 0;
  const infoH = embedded
    ? Math.max(40, originY + H - infoTop - 20 - actionHeight)
    : H - infoTop - 20 - actionHeight;
  scene.add.rectangle(centerX - paneWidth / 2, infoTop, paneWidth, infoH, 0x101a2a, 0.6).setOrigin(0, 0).setStrokeStyle(1, UI.border, 0.5);
  renderCardInfoBox(scene, centerX - paneWidth / 2, infoTop, paneWidth, infoH, skill);

  if (opts.primaryAction) {
    const action = opts.primaryAction;
    const buttonY = infoTop + infoH + 8;
    const button = scene.add.rectangle(centerX, buttonY, paneWidth, 40, action.enabled ? UI.chip : UI.panelMuted, action.enabled ? 1 : 0.5)
      .setOrigin(0.5, 0).setStrokeStyle(1, UI.border, action.enabled ? 1 : 0.4);
    scene.add.text(centerX, buttonY + 20, action.label, {
      fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${opts.font.label}px`,
      color: action.enabled ? UI.textOnChip : UI.textSoft,
    }).setOrigin(0.5);
    if (action.enabled) {
      button.setInteractive({ useHandCursor: true });
      button.on('pointerdown', (_p: Phaser.Input.Pointer, _lx: number, _ly: number, event: Phaser.Types.Input.EventData) => {
        event.stopPropagation();
        playSfx('uiClick');
        action.onPress();
      });
    }
  }
}
