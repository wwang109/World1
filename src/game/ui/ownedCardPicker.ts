import Phaser from 'phaser';
import type { SkillDef, SkillTier } from '../../engine/types';
import type { TierProgress } from '../../run/shop';
import { FONT, UI } from '../theme';
import { roundRect } from './roundedRect';
import { auditTextBlock } from './controlLayoutAudit';
import { CardToken } from './CardToken';
import { attachButtonFeel } from './motion';
import { tierProgressMergeLine } from './tierProgressDisplay';
import { tierUpgradePreview, type AvailableTierUpgradePreview } from './tierUpgradePreview';
import { buildTierUpgradeDiff, formatTierUpgradeDiffLine } from './tierUpgradeDiff';
import { renderTierUpgradeDetailOverlay } from './tierUpgradeDetailOverlay';
import type { SkillFaceMode } from './skillPresentation';

export interface OwnedCardPickerRow {
  instanceId: string;
  skill: SkillDef;
  tier: SkillTier;
  points: number;
  to: TierProgress;
}

const LABEL_H = 18;
const HEADLINE_H = 16;
const ROW_GAP = 10;
const HEADER_H = 52;
const FOOTER_H = 60;

export function renderOwnedCardPicker(
  scene: Phaser.Scene,
  opts: {
    viewWidth: number;
    viewHeight: number;
    title: string;
    actionWord: string;
    rows: readonly OwnedCardPickerRow[];
    fontBody: number;
    fontName: number;
    font: Parameters<typeof renderTierUpgradeDetailOverlay>[2]['font'];
    compact: boolean;
    page: number;
    onPageChange: (page: number) => void;
    inspectedInstanceId: string | null;
    onInspect: (instanceId: string | null) => void;
    onPick: (instanceId: string) => void;
    onCancel: () => void;
  },
): void {
  const faceMode: SkillFaceMode = opts.compact ? 'summed' : 'composition';
  const cardH = opts.compact ? 58 : 66;
  const cellH = LABEL_H + HEADLINE_H + cardH;
  const bw = Math.min(opts.compact ? opts.viewWidth - 24 : 520, opts.viewWidth - 24);
  const maxH = opts.viewHeight - 40;
  const perPage = Math.max(1, Math.floor((maxH - HEADER_H - FOOTER_H + ROW_GAP) / (cellH + ROW_GAP)));
  const pageCount = Math.max(1, Math.ceil(opts.rows.length / perPage));
  const page = Math.min(Math.max(0, opts.page), pageCount - 1);
  const shown = opts.rows.slice(page * perPage, page * perPage + perPage);
  const bodyH = Math.max(1, shown.length) * cellH + (Math.max(1, shown.length) - 1) * ROW_GAP;
  const bh = HEADER_H + bodyH + FOOTER_H;
  const bx = opts.viewWidth / 2 - bw / 2;
  const by = Math.max(20, opts.viewHeight / 2 - bh / 2);

  const scrim = scene.add.rectangle(0, 0, opts.viewWidth, opts.viewHeight, UI.shadow, 0.72).setOrigin(0, 0).setInteractive();
  scrim.on('pointerdown', () => opts.onCancel());

  const panel = roundRect(scene.add.rectangle(bx, by, bw, bh, UI.panelAlt, 0.98), 14).setOrigin(0, 0).setStrokeStyle(2, UI.border, 0.8);
  panel.setInteractive();
  panel.on('pointerdown', (_p: unknown, _lx: number, _ly: number, event: { stopPropagation: () => void }) => event.stopPropagation());

  const title = scene.add.text(bx + bw / 2, by + HEADER_H / 2, opts.title, {
    fontFamily: FONT.display, fontStyle: 'bold', fontSize: `${opts.fontName}px`, color: UI.textAccent,
  }).setOrigin(0.5);
  auditTextBlock(title, { name: 'Owned card picker title', maxWidth: bw - 32, maxHeight: title.height + 4, minFontSize: 9 });

  const cellW = bw - 32;
  const cx = bx + bw / 2;
  let inspecting: AvailableTierUpgradePreview | undefined;
  shown.forEach((row, i) => {
    const y = by + HEADER_H + i * (cellH + ROW_GAP);
    const preview = tierUpgradePreview(row.skill.id, row.tier, row.to.tier);
    if (!preview.available) return;
    const step = tierProgressMergeLine({ tier: row.tier, points: row.points }, row.to).toUpperCase().replace('->', '→');
    const label = scene.add.text(cx, y + LABEL_H / 2, `${opts.actionWord} · ${step}`, {
      fontFamily: FONT.body, fontStyle: 'bold', fontSize: '11px', color: UI.textAccent, align: 'center',
    }).setOrigin(0.5);
    auditTextBlock(label, { name: 'Owned card picker step', maxWidth: cellW, maxHeight: LABEL_H, minFontSize: 7 });

    const diff = row.to.tier !== row.tier ? buildTierUpgradeDiff(preview.fromSkill, preview.toSkill, faceMode) : null;
    if (diff?.headline) {
      const headline = scene.add.text(cx, y + LABEL_H + HEADLINE_H / 2, formatTierUpgradeDiffLine(diff.headline), {
        fontFamily: FONT.body, fontStyle: 'bold', fontSize: '10px', color: UI.textBright, align: 'center',
      }).setOrigin(0.5);
      auditTextBlock(headline, { name: 'Owned card picker headline', maxWidth: cellW, maxHeight: HEADLINE_H, minFontSize: 7 });
    }

    const cardY = y + LABEL_H + HEADLINE_H;
    const hit = scene.add.rectangle(cx, y + cellH / 2, cellW, cellH, 0xffffff, 0).setInteractive({ useHandCursor: true });
    hit.on('pointerdown', (_p: unknown, _lx: number, _ly: number, event: { stopPropagation: () => void }) => {
      event.stopPropagation();
      opts.onPick(row.instanceId);
    });
    new CardToken(scene, cx, cardY + cardH / 2, preview.toSkill, {
      width: cellW, height: cardH, side: 'left', tier: row.to.tier, faceMode,
      onInspect: () => opts.onInspect(row.instanceId),
    });
    if (opts.inspectedInstanceId === row.instanceId) inspecting = preview;
  });

  const footY = by + bh - FOOTER_H + 12;
  const button = (x: number, w: number, text: string, enabled: boolean, onPress: () => void): void => {
    const r = roundRect(scene.add.rectangle(x, footY, w, 36, UI.panelMuted, enabled ? 0.95 : 0.4), 8)
      .setOrigin(0, 0).setStrokeStyle(1, UI.border, enabled ? 0.9 : 0.3);
    const t = scene.add.text(x + w / 2, footY + 18, text, {
      fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${opts.fontBody}px`, color: enabled ? UI.text : UI.textSoft,
    }).setOrigin(0.5);
    if (!enabled) return;
    r.setInteractive({ useHandCursor: true });
    r.on('pointerdown', (_p: unknown, _lx: number, _ly: number, event: { stopPropagation: () => void }) => event.stopPropagation());
    attachButtonFeel(scene, r, { fill: UI.panelMuted, hover: UI.panelAlt, follow: [t], onPress });
  };
  if (pageCount > 1) {
    button(bx + 16, 44, '‹', page > 0, () => opts.onPageChange(page - 1));
    scene.add.text(bx + 70, footY + 18, `${page + 1}/${pageCount}`, {
      fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${opts.fontBody}px`, color: UI.textSoft,
    }).setOrigin(0, 0.5);
    button(bx + 112, 44, '›', page < pageCount - 1, () => opts.onPageChange(page + 1));
  }
  button(bx + bw - 136, 120, 'CANCEL', true, opts.onCancel);

  if (inspecting) {
    const row = opts.rows.find((r) => r.instanceId === opts.inspectedInstanceId);
    renderTierUpgradeDetailOverlay(scene, inspecting, {
      font: opts.font,
      mode: faceMode,
      actionWord: opts.actionWord,
      progressLine: row ? tierProgressMergeLine({ tier: row.tier, points: row.points }, row.to) : undefined,
      onClose: () => opts.onInspect(null),
    });
  }
}
