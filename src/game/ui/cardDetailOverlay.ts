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
  opts: { onClose: () => void; font: LayoutProfile['font'] },
): void {
  const W = SCREEN.width;
  const H = SCREEN.height;
  const veil = scene.add.rectangle(0, 0, W, H, 0x05070c, 0.88).setOrigin(0, 0).setInteractive();
  veil.on('pointerdown', () => { playSfx('uiBack'); opts.onClose(); });

  const closeBtn = scene.add.rectangle(W - 30, 46, 28, 28, 0x24344a, 1)
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
  const centerX = W / 2;
  const cardW = 140;
  const cardH = cardW * (690 / 420);
  let y = 66;
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
  const infoH = H - infoTop - 20;
  scene.add.rectangle(centerX - paneWidth / 2, infoTop, paneWidth, infoH, 0x101a2a, 0.6).setOrigin(0, 0).setStrokeStyle(1, UI.border, 0.5);
  renderCardInfoBox(scene, centerX - paneWidth / 2, infoTop, paneWidth, infoH, skill);
}
