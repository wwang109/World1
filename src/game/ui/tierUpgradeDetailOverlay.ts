import Phaser from 'phaser';
import { FONT, UI } from '../theme';
import type { LayoutProfile } from '../layoutProfile';
import { auditTextBlock } from './controlLayoutAudit';
import { renderDetailOverlayHeader } from './cardDetailOverlay';
import { roundRect } from './roundedRect';
import type { AvailableTierUpgradePreview } from './tierUpgradePreview';
import { buildTierUpgradeDiff } from './tierUpgradeDiff';
import type { SkillFaceMode } from './skillPresentation';

const TARGET_BG_WIDTH = 360;
const SIDE_MARGIN = 24;
const PANEL_PAD = 18;
const TOP_GAP = 22;
const BOTTOM_GAP = 22;
const PANEL_FILL_ALPHA = 0.4;
const PANEL_BORDER_ALPHA = 0.35;

export function renderTierUpgradeDetailOverlay(
  scene: Phaser.Scene,
  preview: AvailableTierUpgradePreview,
  opts: { onClose: () => void; font: LayoutProfile['font']; mode: SkillFaceMode; actionWord?: string; progressLine?: string },
): void {
  const { centerX, paneWidth: headerPaneWidth, y: headerY, contentTop, W } = renderDetailOverlayHeader(scene, preview.toSkill, {
    ...opts, panelWidth: TARGET_BG_WIDTH - PANEL_PAD * 2, cardWidth: 190, cardHeightFraction: 0.4,
  });
  const bgWidth = Math.min(TARGET_BG_WIDTH, W - SIDE_MARGIN * 2);
  const paneWidth = Math.min(headerPaneWidth, bgWidth - PANEL_PAD * 2);
  let y = headerY;

  const actionWord = opts.actionWord ?? 'UPGRADE';
  const cue = preview.conditionalTrade ? 'CONDITIONAL' : preview.conditionalGain ? 'GATED' : actionWord;
  const cueColor = preview.conditionalTrade ? `#${UI.bad.toString(16).padStart(6, '0')}` : UI.textAccent;
  const tierLine = scene.add.text(centerX, y, `${cue} · ${preview.from.toUpperCase()} → ${preview.to.toUpperCase()}`, {
    fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${opts.font.name}px`, color: cueColor, align: 'center',
  }).setOrigin(0.5, 0).setDepth(1);
  auditTextBlock(tierLine, { name: 'Tier upgrade overlay tier line', maxWidth: paneWidth, maxHeight: tierLine.height + 4, minFontSize: 7 });
  y += tierLine.height + 20;

  if (opts.progressLine) {
    const progressText = scene.add.text(centerX, y, opts.progressLine, {
      fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${opts.font.subtitle}px`, color: UI.textSoft, align: 'center',
    }).setOrigin(0.5, 0).setDepth(1);
    auditTextBlock(progressText, { name: 'Tier upgrade overlay progress line', maxWidth: paneWidth, maxHeight: progressText.height + 4, minFontSize: 7 });
    y += progressText.height + 16;
  }

  const diff = buildTierUpgradeDiff(preview.fromSkill, preview.toSkill, opts.mode);
  const labelX = centerX - paneWidth / 2;
  const valueX = centerX + paneWidth / 2;
  for (const line of diff.lines) {
    const label = scene.add.text(labelX, y, line.label, {
      fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${opts.font.subtitle}px`, color: UI.textSoft,
    }).setOrigin(0, 0).setDepth(1);
    auditTextBlock(label, { name: 'Tier upgrade diff label', maxWidth: paneWidth * 0.55, maxHeight: label.height + 4, minFontSize: 7 });
    const valueColor = line.kind === 'unchanged' ? UI.textDim : UI.textBright;
    const value = scene.add.text(valueX, y, line.value, {
      fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${opts.font.subtitle}px`, color: valueColor, align: 'right',
    }).setOrigin(1, 0).setDepth(1);
    auditTextBlock(value, { name: 'Tier upgrade diff value', maxWidth: paneWidth * 0.42, maxHeight: value.height + 4, minFontSize: 7 });
    y += Math.max(label.height, value.height) + 14;
  }

  const panelLeft = centerX - bgWidth / 2;
  const panelTop = contentTop - TOP_GAP;
  const contentBottom = y - 14;
  const panelBottom = contentBottom + BOTTOM_GAP;
  roundRect(scene.add.rectangle(panelLeft, panelTop, bgWidth, panelBottom - panelTop, UI.panelAlt, PANEL_FILL_ALPHA), 14)
    .setOrigin(0, 0).setStrokeStyle(1, UI.border, PANEL_BORDER_ALPHA);
}
