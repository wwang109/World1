import Phaser from 'phaser';
import { playSfx } from '../audio/sfxSynth';
import { applyTier } from '../../engine/cards';
import { skillBook } from '../../data/skills';
import type { DraftCard } from '../../run/draft';
import { DESKTOP_PROFILE, MOBILE_PROFILE, type LayoutProfile } from '../layoutProfile';
import { FONT, GEM_RARITY_COLOR, UI } from '../theme';
import { CardToken } from './CardToken';
import { auditControlLabel, auditTextBlock } from './controlLayoutAudit';
import { addHoverTipZone } from './hoverTip';
import { gemHoverEntry } from './gemGlossary';
import { addRunArt, choiceArtKey } from './runArt';
import { centeredBox, FEATURE_CARD_SIZE, layoutFeatureGrid } from './runRewardGeometry';
import type { RunRewardFeature, RunRewardViewModel } from './runRewardViewModel';
import type { Rect, RunScreenTemplate, RunTemplatePlatform } from './runScreenTemplate';

/**
 * Ideal (never-exceeded) feature-visual sizes per platform — the renderer
 * clamps DOWN to the feature rect when it's ever smaller than this, but
 * never stretches past it. These are ~35% larger than the card/gem's OWN
 * natural size elsewhere (a board slot, a shop shelf): `feature` now owns
 * the WHOLE panel remainder (see `runScreenTemplate.ts`'s `reward` doc), so
 * at the old literal board-slot size the feature sat as a small token
 * floating inside as much as ~500px of otherwise-empty panel. Scaling the
 * IDEAL up (rather than shrinking the template's reserved rect) keeps the
 * panel's documented "feature gets whatever's left, never a fixed ceiling"
 * invariant — and every existing containment/gap test on that rect — intact;
 * on a genuinely small `feature` rect this still clamps down exactly as
 * before.
 *
 * The CARD variant (`FEATURE_CARD_SIZE`) lives in `runRewardGeometry.ts`
 * instead of here — it's imported above — because that pure module also
 * doubles as the per-card ideal size for the bonus-draft grid
 * (`renderRunBonusDraftPicker` below, so a reward card and a draft-pick card
 * read as the same visual weight) and is unit-tested directly against the
 * template's real `feature` rects in `tests/game/runRewardGeometry.test.ts` —
 * a single source of truth instead of a hand-synced duplicate.
 */
const FEATURE_GEM_CHIP_SIZE: Record<RunTemplatePlatform, { w: number; h: number }> = {
  desktop: { w: 351, h: 76 },
  mobile: { w: 351, h: 70 },
};
const FEATURE_ICON_SIZE: Record<RunTemplatePlatform, number> = { desktop: 130, mobile: 108 };

/** Gap between bonus-draft grid cells — the platform's own spacing constant,
 * never a literal re-typed at the call site. */
const GRID_GAP: Record<RunTemplatePlatform, number> = { desktop: DESKTOP_PROFILE.gap, mobile: MOBILE_PROFILE.gap };

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
    // Same uniform-scale clamp as the card branch above (this used to scale
    // width/height INDEPENDENTLY via `centeredBox`'s own per-axis min, which
    // could squash/stretch the chip's aspect ratio despite this module's own
    // doc comment claiming aspect-preserving clamping for both feature kinds).
    const scale = Math.min(1, rect.width / ideal.w, rect.height / ideal.h);
    const box = centeredBox(rect, ideal.w * scale, ideal.h * scale);
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

/** Renders the small top-of-panel outcome icon into `rect` — shared by the
 * resolved-outcome screen (`model.iconKey`) and the bonus-draft picker (a
 * fixed `'bonusDraft'` icon key), so both draw the icon row identically. */
function renderIcon(scene: Phaser.Scene, rect: Rect, iconKey: string): void {
  const size = Math.min(56, rect.height, rect.width);
  addRunArt(scene, iconKey, {
    x: rect.x + (rect.width - size) / 2,
    y: rect.y + (rect.height - size) / 2,
    width: size,
    height: size,
  });
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

/** The reward panel's background plate — identical on the resolved-outcome
 * screen and the bonus-draft picker (both own the WHOLE panel, see
 * `runScreenTemplate.ts`'s `reward` doc). */
function renderPanelBackground(scene: Phaser.Scene, panel: Rect): void {
  scene.add.rectangle(panel.x, panel.y, panel.width, panel.height, UI.panelMuted, 0.94)
    .setOrigin(0, 0)
    .setStrokeStyle(2, UI.chip, 0.6);
}

/**
 * THE reward-outcome renderer — one component shared by `DesktopRunEventScene`
 * and `MobileRunEventScene` (differing only in which platform's template they
 * pass in). Reads `template.contentSlots.reward`'s declared rects
 * (panel/icon/headline/detail/feature/buttons) and places every part into its
 * rect — no cursor, no per-`EventOutcome`-kind layout branch. Fits by
 * construction: `feature` is sized to (and clamped by) its own rect, and
 * CONTINUE lives in the template's separately-reserved `buttons` row, so a
 * card, a gem, or nothing at all all end up on-screen the same way. The
 * "PICK ONE TO KEEP" bonus-draft picker (`renderRunBonusDraftPicker` below)
 * is this module's other reward-screen renderer, sharing the same panel/icon/
 * headline rects and the same `centeredBox`/`layoutFeatureGrid` clamp-and-
 * center geometry (`runRewardGeometry.ts`) for its `feature` slot.
 */
export function renderRunRewardPanel(
  scene: Phaser.Scene,
  template: RunScreenTemplate,
  model: RunRewardViewModel,
  opts: { font: LayoutProfile['font']; onContinue: () => void },
): void {
  const { panel, icon, headline, detail, feature, buttons } = template.contentSlots.reward;

  renderPanelBackground(scene, panel);
  renderIcon(scene, icon, model.iconKey);

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

/**
 * The "PICK ONE TO KEEP" bonus-draft picker — THE one implementation both
 * `DesktopRunEventScene` and `MobileRunEventScene` call for a resolved
 * `bonusDraft` outcome, in place of each scene's own hand-rolled row/column
 * math (which had already drifted — see the module doc above and
 * `runRewardGeometry.ts`'s doc comment). Uses the SAME `panel`/`icon`/`headline` rects
 * `renderRunRewardPanel` uses (icon = the `bonusDraft` choice art, headline =
 * "PICK ONE TO KEEP"), then fills `feature` with a `layoutFeatureGrid` of
 * `cards.length` card-sized cells — `FEATURE_CARD_SIZE[platform]` is the same
 * ideal card size the resolved-outcome screen's own `grantCard` feature uses,
 * so a reward card and a draft-pick card read as the same visual weight. No
 * `detail` row (the picker never has one) — left blank exactly like every
 * other outcome that has no detail text, not a special case.
 */
export function renderRunBonusDraftPicker(
  scene: Phaser.Scene,
  template: RunScreenTemplate,
  cards: readonly DraftCard[],
  opts: { font: LayoutProfile['font']; onPick: (card: DraftCard) => void },
): void {
  const { panel, icon, headline, feature } = template.contentSlots.reward;

  renderPanelBackground(scene, panel);
  renderIcon(scene, icon, choiceArtKey('bonusDraft'));

  const label = scene.add.text(headline.x + headline.width / 2, headline.y, 'PICK ONE TO KEEP', {
    fontFamily: FONT.display, fontStyle: 'bold', fontSize: `${opts.font.title}px`, color: UI.textAccent, align: 'center',
  }).setOrigin(0.5, 0);
  auditTextBlock(label, { name: 'Run reward bonus draft title', maxWidth: headline.width - 64, maxHeight: headline.height, minFontSize: 10 });

  const ideal = FEATURE_CARD_SIZE[template.platform];
  const cells = layoutFeatureGrid(feature, cards.length, ideal.w, ideal.h, GRID_GAP[template.platform]);
  cards.forEach((card, i) => {
    const cell = cells[i];
    const skill = skillBook[card.skillId];
    if (!cell || !skill) return;
    const shown = card.tier === skill.tier ? skill : applyTier(skill, card.tier);
    const cx = cell.x + cell.w / 2;
    const cy = cell.y + cell.h / 2;
    new CardToken(scene, cx, cy, shown, { width: cell.w, height: cell.h, side: 'left' });
    const hit = scene.add.rectangle(cx, cy, cell.w, cell.h, 0xffffff, 0).setInteractive({ useHandCursor: true });
    hit.on('pointerdown', () => { playSfx('uiClick'); opts.onPick(card); });
  });
}
