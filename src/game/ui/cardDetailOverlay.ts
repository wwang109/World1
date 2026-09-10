import Phaser from 'phaser';
import type { SkillDef } from '../../engine/types';
import { powerLevelDeci } from '../../engine/balance';
import { playSfx } from '../audio/sfxSynth';
import type { LayoutProfile } from '../layoutProfile';
import { FONT, SCREEN, UI } from '../theme';
import { FantasyCardTemplateV2 } from './FantasyCardTemplateV2';
import { renderCardInfoBox } from './cardInfoBox';

/**
 * Full-screen, read-only "inspect" veil for one resolved `SkillDef` — a big
 * card render, its name, a POWER/tier line, then the scrollable text +
 * glossary box (`renderCardInfoBox`, the SAME glossary every hover-tip and
 * deck-build detail panel already uses). No PICK/BUY button: tapping the
 * veil or the × closes it via `opts.onClose` and nothing else.
 *
 * Mirrors `MobileDraftScene`'s own inline `renderDetail` (its ⓘ-badge
 * target) layout byte-for-byte, pulled out here so mobile's mid-run reward
 * pickers (`RunRewardPanel.ts`'s `renderRunBonusDraftPicker`/
 * `renderRunUpgradeCardPicker`) can share this ONE detail surface instead of
 * hand-rolling a third copy of it — three independent copies of the same
 * presentation rule is a repeat defect in this codebase (see this module's
 * callers' doc comments).
 */
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
  const embedded = scene.data?.get('embeddedRunView') as { x: number; y: number; width: number; height: number } | undefined;
  const W = embedded?.width ?? SCREEN.width;
  const H = embedded?.height ?? SCREEN.height;
  const originX = embedded?.x ?? 0;
  const originY = embedded?.y ?? 0;
  const veil = scene.add.rectangle(originX, originY, W, H, 0x05070c, 0.88).setOrigin(0, 0).setInteractive();
  veil.on('pointerdown', () => { playSfx('uiBack'); opts.onClose(); });

  const closeBtn = scene.add.rectangle(originX + W - 30, originY + (embedded ? 26 : 46), 28, 28, 0x24344a, 1)
    .setOrigin(0.5).setStrokeStyle(1, 0x8a94a6, 0.8).setInteractive({ useHandCursor: true });
  scene.add.text(closeBtn.x, closeBtn.y, '×', {
    fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${opts.font.xlarge}px`, color: UI.textBright,
  }).setOrigin(0.5);
  closeBtn.on('pointerdown', (_p: Phaser.Input.Pointer, _lx: number, _ly: number, event: Phaser.Types.Input.EventData) => {
    event.stopPropagation();
    playSfx('uiBack');
    opts.onClose();
  });

  const paneWidth = W - 40;
  const centerX = originX + W / 2;
  const cardW = embedded ? Math.min(140, W * 0.35, Math.max(60, H * 0.32) / (690 / 420)) : 140;
  const cardH = cardW * (690 / 420);
  let y = originY + (embedded ? 46 : 66);
  if (opts.title) {
    const title = scene.add.text(originX + 20, y - 34, opts.title.toUpperCase(), {
      fontFamily: FONT.display, fontStyle: 'bold', fontSize: `${opts.font.label}px`, color: UI.textAccent,
    }).setOrigin(0, 0.5);
    title.setDepth(2);
  }
  const cardY = y + cardH / 2;
  new FantasyCardTemplateV2(scene, centerX, cardY, skill, { width: cardW, height: cardH, tier: skill.tier, glossary: false });
  y = cardY + cardH / 2 + 10;

  const name = scene.add.text(centerX, y, skill.name, {
    fontFamily: FONT.display, fontStyle: 'bold', fontSize: `${opts.font.heading}px`, color: UI.textBright,
    align: 'center', wordWrap: { width: paneWidth },
  }).setOrigin(0.5, 0);
  y += name.height + 4;

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
