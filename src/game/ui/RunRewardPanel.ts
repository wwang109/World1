import Phaser from 'phaser';
import { playSfx } from '../audio/sfxSynth';
import type { LayoutProfile } from '../layoutProfile';
import { FONT, GEM_RARITY_COLOR, UI } from '../theme';
import { CardToken } from './CardToken';
import { auditControlLabel, auditTextBlock } from './controlLayoutAudit';
import { addHoverTipZone } from './hoverTip';
import { gemHoverEntry } from './gemGlossary';
import { addRunArt } from './runArt';
import type { RunRewardFeature, RunRewardViewModel } from './runRewardViewModel';
import type { Rect, RunScreenTemplate, RunTemplatePlatform } from './runScreenTemplate';

/** Ideal (never-exceeded) feature-visual sizes per platform — the renderer
 * clamps DOWN to the feature rect when it's ever smaller than this, but
 * never stretches up to fill it: a reward screen with a small card still
 * looks like a card, not a poster. */
const FEATURE_CARD_SIZE: Record<RunTemplatePlatform, { w: number; h: number }> = {
  desktop: { w: 142, h: 233 },
  mobile: { w: 126, h: 207 },
};
const FEATURE_GEM_CHIP_SIZE: Record<RunTemplatePlatform, { w: number; h: number }> = {
  desktop: { w: 260, h: 56 },
  mobile: { w: 260, h: 52 },
};
const FEATURE_ICON_SIZE: Record<RunTemplatePlatform, number> = { desktop: 96, mobile: 80 };

/** Centers a `{w,h}` box (clamped to never exceed `rect`) inside `rect`,
 * returning its top-left — the one place that does this arithmetic, so every
 * feature variant below places itself the same way. */
function centeredBox(rect: Rect, w: number, h: number): { x: number; y: number; w: number; h: number } {
  const boxW = Math.min(w, rect.width);
  const boxH = Math.min(h, rect.height);
  return { x: rect.x + (rect.width - boxW) / 2, y: rect.y + (rect.height - boxH) / 2, w: boxW, h: boxH };
}

function renderFeature(scene: Phaser.Scene, platform: RunTemplatePlatform, feature: RunRewardFeature, iconKey: string, rect: Rect): void {
  if (feature.kind === 'card') {
    const ideal = FEATURE_CARD_SIZE[platform];
    // Preserve the card's aspect ratio while clamping to the rect — shrink
    // by whichever axis is tighter rather than distorting the token.
    const scale = Math.min(1, rect.width / ideal.w, rect.height / ideal.h);
    const w = ideal.w * scale;
    const h = ideal.h * scale;
    const box = centeredBox(rect, w, h);
    new CardToken(scene, box.x + box.w / 2, box.y + box.h / 2, feature.skill, { width: box.w, height: box.h, side: 'left' });
    return;
  }
  if (feature.kind === 'gem') {
    const ideal = FEATURE_GEM_CHIP_SIZE[platform];
    const box = centeredBox(rect, ideal.w, ideal.h);
    const gem = feature.gem;
    const chip = scene.add.rectangle(box.x, box.y, box.w, box.h, UI.panelAlt, 0.9)
      .setOrigin(0, 0)
      .setStrokeStyle(1, GEM_RARITY_COLOR[gem.rarity], 0.9)
      .setInteractive({ useHandCursor: true });
    scene.add.rectangle(box.x + 24, box.y + box.h / 2, 14, 14, GEM_RARITY_COLOR[gem.rarity]).setOrigin(0.5).setAngle(45);
    const gemName = scene.add.text(box.x + 44, box.y + box.h / 2, gem.name, {
      fontFamily: FONT.display, fontStyle: 'bold', fontSize: '14px', color: UI.text,
      wordWrap: { width: Math.max(0, box.w - 58) },
    }).setOrigin(0, 0.5);
    auditTextBlock(gemName, { name: 'Run reward gem name', maxWidth: Math.max(0, box.w - 58), maxHeight: box.h - 8, minFontSize: 9 });
    addHoverTipZone(scene, { x: box.x, y: box.y, w: box.w, h: box.h }, [gemHoverEntry(gem)]);
    return;
  }
  // `icon` — the fallback feature for gold/level/nothing/upgrade outcomes: a
  // bigger version of the same top-of-panel icon, so the slot is never blank.
  const size = Math.min(FEATURE_ICON_SIZE[platform], rect.width, rect.height);
  const box = centeredBox(rect, size, size);
  addRunArt(scene, iconKey, { x: box.x, y: box.y, width: box.w, height: box.h }, 0.85);
}

function renderContinueButton(scene: Phaser.Scene, rect: Rect, font: LayoutProfile['font'], onContinue: () => void): void {
  const btn = scene.add.rectangle(rect.x, rect.y, rect.width, rect.height, UI.chip, 1)
    .setOrigin(0, 0)
    .setStrokeStyle(2, UI.border, 0.9)
    .setInteractive({ useHandCursor: true });
  const label = scene.add.text(rect.x + rect.width / 2, rect.y + rect.height / 2, 'CONTINUE ›', {
    fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${font.name + 1}px`, color: UI.textOnChip,
  }).setOrigin(0.5);
  auditControlLabel(btn, label, { name: 'Run reward continue', horizontalPadding: 12, verticalPadding: 8, minFontSize: 10 });
  btn.on('pointerover', () => btn.setFillStyle(UI.chipDark));
  btn.on('pointerout', () => btn.setFillStyle(UI.chip));
  btn.on('pointerdown', () => { playSfx('uiClick'); onContinue(); });
}

/**
 * THE reward-outcome renderer — one component shared by `DesktopRunEventScene`
 * and `MobileRunEventScene` (differing only in which platform's template they
 * pass in). Reads `template.contentSlots.reward`'s declared rects
 * (panel/icon/headline/detail/feature/buttons) and places every part into its
 * rect — no cursor, no per-`EventOutcome`-kind layout branch. Fits by
 * construction: `feature` is sized to (and clamped by) its own rect, and
 * CONTINUE lives in the template's separately-reserved `buttons` row, so a
 * card, a gem, or nothing at all all end up on-screen the same way.
 */
export function renderRunRewardPanel(
  scene: Phaser.Scene,
  template: RunScreenTemplate,
  model: RunRewardViewModel,
  opts: { font: LayoutProfile['font']; onContinue: () => void },
): void {
  const { panel, icon, headline, detail, feature, buttons } = template.contentSlots.reward;

  scene.add.rectangle(panel.x, panel.y, panel.width, panel.height, UI.panelMuted, 0.94)
    .setOrigin(0, 0)
    .setStrokeStyle(2, UI.chip, 0.6);

  const iconSize = Math.min(56, icon.height, icon.width);
  addRunArt(scene, model.iconKey, {
    x: icon.x + (icon.width - iconSize) / 2,
    y: icon.y + (icon.height - iconSize) / 2,
    width: iconSize,
    height: iconSize,
  });

  const headlineMaxW = Math.min(headline.width - 64, 760);
  const headlineText = scene.add.text(headline.x + headline.width / 2, headline.y, model.headline, {
    fontFamily: FONT.display, fontStyle: 'bold', fontSize: `${opts.font.title}px`, color: UI.text,
    align: 'center', wordWrap: { width: headlineMaxW },
  }).setOrigin(0.5, 0);
  auditTextBlock(headlineText, { name: 'Run reward headline', maxWidth: headlineMaxW, maxHeight: headline.height, minFontSize: 12 });

  if (model.detail) {
    const detailMaxW = Math.min(detail.width - 64, 640);
    const detailText = scene.add.text(detail.x + detail.width / 2, detail.y, model.detail, {
      fontFamily: FONT.body, fontSize: `${opts.font.small}px`, color: UI.textDim,
      align: 'center', wordWrap: { width: detailMaxW },
    }).setOrigin(0.5, 0);
    auditTextBlock(detailText, { name: 'Run reward detail', maxWidth: detailMaxW, maxHeight: detail.height, minFontSize: 8 });
  }

  renderFeature(scene, template.platform, model.feature, model.iconKey, feature);
  renderContinueButton(scene, buttons, opts.font, opts.onContinue);
}
