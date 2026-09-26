import Phaser from 'phaser';
import type { SkillDef, SkillTier } from '../../engine/types';
import { FONT, TIER_COLOR, UI } from '../theme';
import { roundRect } from './roundedRect';
import { auditTextBlock } from './controlLayoutAudit';
import { tierProgressLine } from './tierProgressDisplay';

export interface OwnedCardPickerRow {
  instanceId: string;
  skill: SkillDef;
  tier: SkillTier;
  points: number;
}

const ROW_H = 56;
const ROW_GAP = 8;
const PANEL_W = 420;
const HEADER_H = 44;

/**
 * Centered modal listing owned card rows (skill name, tier, merge-progress
 * counter) — the MERGE copy chooser and the merge-slot target picker share
 * this one renderer. `onInspect` is optional (opens the caller's own detail
 * overlay); `onPick` commits; `onCancel` closes with nothing chosen.
 */
export function renderOwnedCardPicker(
  scene: Phaser.Scene,
  opts: {
    viewWidth: number;
    viewHeight: number;
    title: string;
    rows: readonly OwnedCardPickerRow[];
    fontBody: number;
    fontName: number;
    onPick: (instanceId: string) => void;
    onInspect?: (instanceId: string) => void;
    onCancel: () => void;
  },
): void {
  const rowCount = Math.max(1, opts.rows.length);
  const panelH = HEADER_H + rowCount * ROW_H + (rowCount - 1) * ROW_GAP + 32 + 56;
  const bw = Math.min(PANEL_W, opts.viewWidth - 40);
  const bh = Math.min(panelH, opts.viewHeight - 40);
  const bx = opts.viewWidth / 2 - bw / 2;
  const by = opts.viewHeight / 2 - bh / 2;

  const scrim = scene.add.rectangle(0, 0, opts.viewWidth, opts.viewHeight, 0x000000, 0.55).setOrigin(0, 0).setInteractive();
  scrim.on('pointerdown', () => opts.onCancel());

  const panel = roundRect(scene.add.rectangle(bx, by, bw, bh, UI.panelAlt, 0.98), 14).setOrigin(0, 0).setStrokeStyle(2, UI.chip);
  panel.setInteractive();
  panel.on('pointerdown', (_p: unknown, _lx: number, _ly: number, event: { stopPropagation: () => void }) => event.stopPropagation());

  const title = scene.add.text(bx + bw / 2, by + 22, opts.title, {
    fontFamily: FONT.display, fontStyle: 'bold', fontSize: `${opts.fontName}px`, color: UI.text,
  }).setOrigin(0.5);
  auditTextBlock(title, { name: 'Owned card picker title', maxWidth: bw - 32, maxHeight: title.height + 4, minFontSize: 9 });

  let y = by + HEADER_H + 16;
  const rowW = bw - 32;
  opts.rows.forEach((row) => {
    const rx = bx + 16;
    const tierHex = `#${TIER_COLOR[row.tier].toString(16).padStart(6, '0')}`;
    const cell = roundRect(scene.add.rectangle(rx, y, rowW, ROW_H, UI.panelMuted, 0.95), 10)
      .setOrigin(0, 0).setStrokeStyle(1, TIER_COLOR[row.tier], 0.9).setInteractive({ useHandCursor: true });
    cell.on('pointerdown', (_p: unknown, _lx: number, _ly: number, event: { stopPropagation: () => void }) => {
      event.stopPropagation();
      opts.onPick(row.instanceId);
    });

    const name = scene.add.text(rx + 14, y + 10, row.skill.name, {
      fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${opts.fontBody}px`, color: UI.textBright,
    }).setOrigin(0, 0);
    auditTextBlock(name, { name: 'Owned card picker row name', maxWidth: rowW - 100, maxHeight: name.height + 4, minFontSize: 8 });

    const progress = tierProgressLine({ tier: row.tier, points: row.points });
    const subtitle = `${row.tier.toUpperCase()}${progress ? ` · ${progress}` : ''}`;
    const sub = scene.add.text(rx + 14, y + 10 + name.height + 4, subtitle, {
      fontFamily: FONT.body, fontSize: `${Math.max(8, opts.fontBody - 2)}px`, color: tierHex,
    }).setOrigin(0, 0);
    auditTextBlock(sub, { name: 'Owned card picker row subtitle', maxWidth: rowW - 100, maxHeight: sub.height + 4, minFontSize: 7 });

    if (opts.onInspect) {
      const inspectBtn = roundRect(scene.add.rectangle(rx + rowW - 68, y + ROW_H / 2 - 14, 56, 28, UI.panelAlt, 0.95), 6)
        .setOrigin(0, 0).setStrokeStyle(1, UI.border, 0.9).setInteractive({ useHandCursor: true });
      inspectBtn.on('pointerdown', (_p: unknown, _lx: number, _ly: number, event: { stopPropagation: () => void }) => {
        event.stopPropagation();
        opts.onInspect?.(row.instanceId);
      });
      scene.add.text(rx + rowW - 40, y + ROW_H / 2, 'VIEW', {
        fontFamily: FONT.body, fontStyle: 'bold', fontSize: '10px', color: UI.textAccent,
      }).setOrigin(0.5);
    }

    y += ROW_H + ROW_GAP;
  });

  const cancelY = by + bh - 48;
  const cancelBtn = roundRect(scene.add.rectangle(bx + bw / 2 - 60, cancelY, 120, 36, UI.panelMuted, 0.95), 8)
    .setOrigin(0, 0).setStrokeStyle(1, UI.border, 0.9).setInteractive({ useHandCursor: true });
  cancelBtn.on('pointerdown', (_p: unknown, _lx: number, _ly: number, event: { stopPropagation: () => void }) => {
    event.stopPropagation();
    opts.onCancel();
  });
  scene.add.text(bx + bw / 2, cancelY + 18, 'CANCEL', {
    fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${opts.fontBody}px`, color: UI.text,
  }).setOrigin(0.5);
}
