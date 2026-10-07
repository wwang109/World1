import type Phaser from 'phaser';
import type { LayoutProfile } from '../layoutProfile';
import { FONT, UI } from '../theme';
import { openRunModal } from './RunModal';
import { FantasyCardTemplateV2 } from './FantasyCardTemplateV2';
import { renderCardDetailsDrawer } from './cardDetailsDrawer';
import { buildTierUpgradeDiff } from './tierUpgradeDiff';
import type { AvailableTierUpgradePreview } from './tierUpgradePreview';
import type { SkillFaceMode } from './skillPresentation';

export function renderRunTierUpgradeModal(owner: Phaser.Scene, preview: AvailableTierUpgradePreview,
  opts: { font: LayoutProfile['font']; mode: SkillFaceMode; onClose: () => void }): void {
  const compact = opts.mode === 'summed';
  openRunModal(owner, { id: 'tier-upgrade-details', title: 'UPGRADE DETAILS', compact, width: 740, height: 660,
    onClose: opts.onClose, render: (scene, layout) => {
      const { body } = layout;
      const cardH = compact ? 150 : 340, cardW = cardH * 420 / 690;
      const card = new FantasyCardTemplateV2(scene, body.x + (compact ? body.width / 2 : cardW / 2), body.y + cardH / 2,
        preview.toSkill, { width: cardW, height: cardH, tier: preview.toSkill.tier, glossary: false });
      card.setInteractive({ useHandCursor: true }).on('pointerdown', () => renderCardDetailsDrawer(scene, preview.toSkill, { compact, onClose: () => {} }));
      const x = compact ? body.x : body.x + cardW + 24;
      const width = compact ? body.width : body.width - cardW - 24;
      let y = compact ? body.y + cardH + 16 : body.y;
      const cue = preview.conditionalTrade ? 'CONDITIONAL' : preview.conditionalGain ? 'GATED' : 'UPGRADE';
      const title = scene.add.text(x, y, `${cue} · ${preview.from.toUpperCase()} → ${preview.to.toUpperCase()}`, {
        fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${opts.font.name}px`,
        color: preview.conditionalTrade ? `#${UI.bad.toString(16).padStart(6, '0')}` : UI.textAccent, wordWrap: { width },
      });
      y += title.height + 18;
      const viewport = { x, y, width, height: Math.max(1, body.y + body.height - y) };
      const surface = scene.add.rectangle(x, y, width, viewport.height, UI.panelAlt, 0.001).setOrigin(0).setInteractive();
      const maskShape = scene.make.graphics({}, false).fillStyle(0xffffff).fillRect(x, y, width, viewport.height);
      const mask = maskShape.createGeometryMask();
      const list = scene.add.container(x, y).setMask(mask);
      let cursor = 0;
      for (const line of buildTierUpgradeDiff(preview.fromSkill, preview.toSkill, opts.mode).lines) {
        const label = scene.add.text(0, cursor, line.label, { fontFamily: FONT.body, fontSize: `${opts.font.subtitle}px`,
          color: UI.textSoft, wordWrap: { width: width * 0.53 } });
        const value = scene.add.text(width, cursor, line.value, { fontFamily: FONT.body, fontSize: `${opts.font.subtitle}px`,
          color: line.kind === 'unchanged' ? UI.textDim : UI.textBright, align: 'right', wordWrap: { width: width * 0.42 } }).setOrigin(1, 0);
        list.add([label, value]); cursor += Math.max(label.height, value.height) + 14;
      }
      const maxScroll = Math.max(0, cursor - viewport.height);
      const thumbH = Math.min(viewport.height, Math.max(20, viewport.height * viewport.height / Math.max(cursor, 1)));
      const track = scene.add.rectangle(x + width - 3, y, 3, viewport.height, UI.border, 0.4).setOrigin(0).setVisible(maxScroll > 0);
      const thumb = scene.add.rectangle(x + width - 3, y, 3, thumbH, UI.chip).setOrigin(0).setVisible(maxScroll > 0);
      let scroll = 0, drag: { y: number; scroll: number } | null = null;
      list.setName('tier-upgrade-diff-scroll').setData({ viewport, maxScroll });
      const apply = (next: number): void => {
        scroll = Math.max(0, Math.min(maxScroll, next)); list.setY(y - scroll).setData('scrollOffset', scroll);
        thumb.setY(y + (maxScroll > 0 ? scroll / maxScroll * (viewport.height - thumbH) : 0));
      };
      const inside = (pointer: Phaser.Input.Pointer): boolean => pointer.worldX >= x && pointer.worldX <= x + width
        && pointer.worldY >= y && pointer.worldY <= y + viewport.height;
      const wheel = (pointer: Phaser.Input.Pointer, _objects: unknown, _dx: number, dy: number): void => {
        if (inside(pointer)) apply(scroll + dy);
      };
      const down = (pointer: Phaser.Input.Pointer): void => { if (inside(pointer)) drag = { y: pointer.worldY, scroll }; };
      const move = (pointer: Phaser.Input.Pointer): void => { if (drag && pointer.isDown) apply(drag.scroll + drag.y - pointer.worldY); };
      const up = (): void => { drag = null; };
      scene.input.on('wheel', wheel).on('pointerdown', down).on('pointermove', move).on('pointerup', up).on('pointerupoutside', up);
      surface.once('destroy', () => {
        scene.input.off('wheel', wheel).off('pointerdown', down).off('pointermove', move).off('pointerup', up).off('pointerupoutside', up);
        if (list.scene) list.clearMask(); mask.destroy(); maskShape.destroy();
      });
      apply(0);
    },
  });
}
