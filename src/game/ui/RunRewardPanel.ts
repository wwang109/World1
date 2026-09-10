import Phaser from 'phaser';
import { playSfx } from '../audio/sfxSynth';
import { applyTier } from '../../engine/cards';
import { skillBook } from '../../data/skills';
import { gemBook, type GemDef } from '../../data/gems';
import type { SkillDef, SkillTier } from '../../engine/types';
import type { SellGemOption, UpgradeCardOption } from '../../run/events';
import { DESKTOP_PROFILE, MOBILE_PROFILE, type LayoutProfile } from '../layoutProfile';
import { FONT, GEM_RARITY_COLOR, TEXT_SHRINK_FLOOR_PX, TIER_COLOR, textRoleFor, UI } from '../theme';
import { CardToken } from './CardToken';
import { FantasyCardTemplateV2 } from './FantasyCardTemplateV2';
import { FANTASY_CARD_TEMPLATE_SPEC } from './fantasyCardTemplateSpec';
import { auditControlLabel, auditTextBlock } from './controlLayoutAudit';
import { addHoverTipZone, attachHoverTip } from './hoverTip';
import { cardHoverEntries } from './cardHoverEntries';
import { renderCardDetailOverlay } from './cardDetailOverlay';
import { gemChipLines, gemHoverEntries } from './gemPresentation';
import { addRunArt, choiceArtKey } from './runArt';
import {
  cardRowIdeal,
  centeredBox,
  layoutRewardPickerWindow,
  rowIdeal,
  type Box,
  type RewardPickerWindow,
} from './runRewardGeometry';
import {
  layoutMergePicker, mergeChipIdeal,
  type MergeCandidateEntry, type MergeSpentEntry, type RunMergeViewModel,
} from './runMergeViewModel';
import type { RunRewardFeature, RunRewardViewModel } from './runRewardViewModel';
import type { Rect, RunScreenTemplate, RunTemplatePlatform } from './runScreenTemplate';
import { attachButtonFeel } from './motion';
import { tierUpgradePreview } from './tierUpgradePreview';

// Local to the persistent event outcome pane: brighter teal-navy, warm gold and
// ivory. Do not propagate this treatment to choosing, shop or global chrome.
export const EVENT_REWARD_COLORS = {
  ...UI,
  panelAlt: 0x213d4d,
  panelMuted: 0x1b303f,
  chip: 0xd5aa55,
  chipDark: 0x294859,
  border: 0xd5aa55,
  text: '#fff0c9',
  textBright: '#fff0c9',
  textDim: '#d6b77b',
  textSoft: '#d6b77b',
  textMuted: '#c5b58e',
  textDisabled: '#c5b58e',
  textAccent: '#e3b966',
};
type RewardColors = typeof EVENT_REWARD_COLORS;
const rewardColors = (template: RunScreenTemplate): RewardColors => template.eventOutcomePane ? EVENT_REWARD_COLORS : UI;

/**
 * Ideal (never-exceeded) feature-visual sizes per platform — the renderer
 * clamps DOWN to the feature rect when it's ever smaller than this, but
 * never stretches past it. These are the gem/icon's OWN natural size
 * elsewhere (a board slot, a shop shelf) — REVERTED 2026-08-06 from a ~35%
 * bump a same-day earlier pass introduced to keep the feature from looking
 * small inside the (then still full-region-sized) reward panel; now that
 * the panel is capped and centered to hug its content
 * (`runScreenTemplate.ts`'s `REWARD_PANEL_MAX_W`/`_H`), the bump is no
 * longer needed.
 *
 * NO CARD entry here, and none in `runRewardGeometry.ts` either any more —
 * this module no longer sizes a card at all (2026-08-28). A card on a reward
 * surface is now one of exactly TWO shapes, and both derive their size from
 * the rect they are given rather than from a per-screen constant:
 *
 *   a card in a LIST of cards (all three pickers) is a `CardToken` ROW, as
 *   wide as its band — `runRewardGeometry.ts`'s `cardRowIdeal` /
 *   `FEATURE_CARD_ROW_H`, the same shape the deck, bag, board, shop shelf and
 *   turn-zero draft already draw;
 *
 *   a card as the SUBJECT (the resolved-outcome screen's single feature,
 *   `renderBigFeature` below) is a `FantasyCardTemplateV2` at its own
 *   `420x690` aspect, the same full card the ⓘ inspect overlay, the wiki and
 *   the shop's detail view already show.
 *
 * What is gone is the third thing that was neither: a `CardToken` — a ROW
 * component whose text block sits at fixed `dy`s around its vertical centre —
 * stretched into the fantasy card's portrait aspect. See
 * `runRewardGeometry.ts`'s `FEATURE_CARD_ROW_H` for the full write-up.
 */
/** Height of ONE gem chip ROW in the gem pickers' grids, per platform. Like
 * the card rows and the merge picker's spent chips, the WIDTH is the band's own
 * (`rowIdeal`) — WAS a `260x56`/`260x52` two-dimensional ideal (2026-08-28),
 * which on desktop's 802px-wide band fitted TWO chips abreast and so laid a
 * three-gem offer out as "2 + 1 orphan centred underneath", the same wrap the
 * card pass removed from the three card pickers. Every picker in the run is now
 * one stack of full-width rows. */
const FEATURE_GEM_CHIP_H: Record<RunTemplatePlatform, number> = { desktop: 84, mobile: 84 };
const FEATURE_ICON_SIZE: Record<RunTemplatePlatform, number> = { desktop: 96, mobile: 80 };

/**
 * Task #41 density pass (2026-08-08) — the resolved-outcome screen's OWN,
 * LARGER feature ideal (see `runScreenTemplate.ts`'s `reward.outcome` doc
 * comment): once a gem/icon is the ONLY thing in the feature column (not one
 * of several in a grid), it can afford to be the visual anchor of the whole
 * panel instead of matching the grid's cramped size.
 *
 * The CARD variant that used to live here (`FEATURE_CARD_SIZE_SOLO`,
 * `210x345`/`195x320`) is gone: the solo card now fills its column as a
 * `FantasyCardTemplateV2` at that template's own aspect, so there is no
 * hand-tuned portrait size left to keep in sync. See `renderBigFeature`.
 */
const FEATURE_GEM_CHIP_SIZE_SOLO: Record<RunTemplatePlatform, { w: number; h: number }> = {
  desktop: { w: 420, h: 112 },
  mobile: { w: 340, h: 108 },
};
const FEATURE_ICON_SIZE_SOLO: Record<RunTemplatePlatform, number> = { desktop: 176, mobile: 150 };

/** Gap between bonus-draft/upgrade-card grid cells — the platform's own
 * spacing constant, never a literal re-typed at the call site. */
const GRID_GAP: Record<RunTemplatePlatform, number> = { desktop: DESKTOP_PROFILE.gap, mobile: MOBILE_PROFILE.gap };

/**
 * A soft "spotlight" plate behind the resolved-outcome screen's big solo
 * feature — sized relative to `rect` (clamped to never exceed it) and
 * centered on that SAME rect the feature's own `box` is centered in, so the
 * two read as concentric. Purely compositional (no new information): it
 * fills the visual field a lone, modestly-sized card/gem/icon would
 * otherwise leave as dead space around itself, which is the bulk of what
 * made the resolved-outcome screen read as empty before this pass. Never
 * drawn for the bonus-draft/upgrade-card GRIDS — a 4-5 card row already
 * fills its row on its own.
 */
function renderFeatureBackdrop(scene: Phaser.Scene, rect: Rect, box: Box, color: number): void {
  const w = Math.min(rect.width, box.w + 64);
  const h = Math.min(rect.height, box.h + 56);
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  scene.add.rectangle(cx, cy, w, h, color, 0.12).setStrokeStyle(1, color, 0.4);
}

/**
 * Draws ONE gem chip's visual — background plate, rarity marker, and the SAME
 * three facts `gemHoverEntries` (ui/gemPresentation.ts) puts in a desktop hover tip:
 * the gem's NAME, its RARITY + kind, and WHAT IT DOES. Extracted (2026-08-18)
 * so `renderBigFeature`'s solo gem feature and `renderRunGemChoicePicker` /
 * `renderRunSellGemPicker`'s grid cells share the IDENTICAL chip rather than
 * each re-deriving one. Leaves the chip's own click/hover wiring to the
 * caller (the callers want different affordances: the solo feature is inert
 * but hoverable, a picker cell is a clickable pick target).
 *
 * THE EFFECT LINE IS NEW (2026-08-30) AND IS THE POINT. The chip used to draw
 * a marker and a NAME, nothing else — so "PICK ONE TO KEEP" offered
 * `Ripple Sliver` / `Opening Sliver` / `Judgment Sliver` with no effect, no
 * rarity and no stats anywhere on screen, and the ONLY place that information
 * existed was an `attachHoverTip` the picker wired for
 * `template.platform === 'desktop'` only. A phone has no hover, so a phone got
 * NOTHING: an irreversible choice made blind, on the one device the game is
 * read on. The shop shelf has always printed the same gem's effect verbatim
 * (`MobileShopScene`'s gem rows), so the text was never missing — only this
 * surface's willingness to show it was.
 *
 * SIZES. The name still scales with `box.h` (it is the chip's headline and the
 * chip ranges from a picker cell to the much larger solo feature); the two
 * information rows take fixed TEXT ROLES (`kicker`/`micro` via `textRoleFor`,
 * resolved for THIS template's platform rather than the live profile) because
 * small type must not shrink with its container — 9px is the floor, and a
 * fraction of a shrunken cell would go under it.
 *
 * PAGES INSTEAD OF COLLAPSING. The sell picker maps the WHOLE gem pouch, which
 * is unbounded. `layoutRewardPickerWindow` keeps a readable minimum row height
 * and exposes the remaining authored-order options through the shared pager;
 * `auditTextBlock` still clamps each line inside its visible chip.
 *
 * `priceLabel` (added 2026-08-20 for `renderRunSellGemPicker`) draws a small
 * right-aligned gold-colored tag ("SELL 2g") inside the chip's own right
 * edge — optional and omitted by every OTHER caller. The text column's own
 * wrap width shrinks to leave room for it, so nothing can run under the tag.
 */
function renderGemChip(
  scene: Phaser.Scene,
  box: Box,
  gem: GemDef,
  platform: RunTemplatePlatform,
  priceLabel?: string,
  colors: RewardColors = UI,
): void {
  scene.add.rectangle(box.x, box.y, box.w, box.h, colors.panelAlt, 0.9)
    .setOrigin(0, 0)
    .setStrokeStyle(1, GEM_RARITY_COLOR[gem.rarity], 0.9);
  const markerSize = box.h * 0.2;
  const markerCx = box.x + markerSize * 1.7;
  const textX = markerCx + markerSize * 1.5;
  const pad = Math.max(5, Math.round(box.h * 0.11));
  const namePx = Math.max(TEXT_SHRINK_FLOOR_PX, Math.round(box.h * 0.2));
  let priceW = 0;
  if (priceLabel) {
    const priceText = scene.add.text(box.x + box.w - 10, box.y + box.h / 2, priceLabel, {
      fontFamily: FONT.display, fontStyle: 'bold', fontSize: `${Math.round(box.h * 0.18)}px`, color: colors.textAccent,
    }).setOrigin(1, 0.5);
    priceW = priceText.width + 12;
  }
  const textW = Math.max(0, box.x + box.w - textX - 10 - priceW);
  const chipBottom = box.y + box.h - pad;
  // The marker sits on the NAME's own line rather than the chip's vertical
  // centre: the chip is a top-anchored stack of rows now, so a centred diamond
  // would float beside the effect text instead of the thing it marks.
  scene.add.rectangle(markerCx, box.y + pad + namePx * 0.6, markerSize, markerSize, GEM_RARITY_COLOR[gem.rarity]).setOrigin(0.5).setAngle(45);

  const lines = gemChipLines(gem);
  let cursor = box.y + pad;
  const gemName = scene.add.text(textX, cursor, lines.name, {
    fontFamily: FONT.display, fontStyle: 'bold', fontSize: `${namePx}px`, color: colors.text,
    wordWrap: { width: textW },
  }).setOrigin(0, 0);
  auditTextBlock(gemName, { name: 'Run reward gem name', maxWidth: textW, maxHeight: Math.max(namePx, chipBottom - cursor), minFontSize: 9 });
  cursor += gemName.height + 2;

  // RARITY + KIND — the hover tip's own title suffix and body prefix, in the
  // words `gemHoverEntries` already uses so the two surfaces cannot drift.
  const metaStyle = textRoleFor(platform, 'kicker');
  const metaLineH = Number.parseFloat(metaStyle.fontSize) * 1.4;
  if (chipBottom - cursor >= metaLineH) {
    const meta = scene.add.text(textX, cursor, lines.meta, {
      ...metaStyle, ...(colors !== UI ? { color: colors.textSoft } : {}), wordWrap: { width: textW },
    }).setOrigin(0, 0);
    auditTextBlock(meta, { name: 'Run reward gem rarity', maxWidth: textW, maxHeight: chipBottom - cursor, minFontSize: 9 });
    cursor += meta.height + 2;
  }

  // WHAT IT DOES — the same generated `renderGemText(gem)` the shop shelf and
  // the hover tip print, so all three surfaces say one thing about one gem.
  const effectStyle = textRoleFor(platform, 'micro');
  const effectLineH = Number.parseFloat(effectStyle.fontSize) * 1.4;
  if (chipBottom - cursor >= effectLineH) {
    const effect = scene.add.text(textX, cursor, lines.effect, {
      ...effectStyle, ...(colors !== UI ? { color: colors.textDim } : {}), wordWrap: { width: textW }, lineSpacing: 1,
    }).setOrigin(0, 0);
    auditTextBlock(effect, { name: 'Run reward gem effect', maxWidth: textW, maxHeight: chipBottom - cursor, minFontSize: 9 });
  }
}

/**
 * Renders the resolved-outcome screen's ONE big feature visual (card/gem/
 * icon) into `rect`, backed by `renderFeatureBackdrop`. CENTERED, unlike the
 * interactive picker grids' explicit top alignment, since `rect`
 * (`runScreenTemplate.ts`'s
 * `reward.outcome.feature`) is generously sized on both platforms and a
 * centered subject reads as the deliberate focal point the identity band +
 * text column now point at, rather than a token pinned to the top of a
 * mostly-empty box.
 */
function renderBigFeature(scene: Phaser.Scene, platform: RunTemplatePlatform, feature: RunRewardFeature, iconKey: string, rect: Rect, colors: RewardColors = UI): void {
  if (feature.kind === 'card') {
    // THE CARD AS SUBJECT (see the ideal-sizes doc block above): the same
    // `FantasyCardTemplateV2` the ⓘ inspect overlay, the wiki and the shop's
    // detail view already show, filling this column at the template's own
    // `420x690` aspect. It replaces a portrait-stretched `CardToken`
    // (2026-08-28) — the column was already cut to the fantasy card's aspect,
    // so the card it now holds is the one that shape was for, and the same
    // card the player meets on tapping ⓘ anywhere else. No
    // `renderFeatureBackdrop` here: the fantasy frame carries its own border
    // and corner art, and the card now fills the column it used to float in,
    // so a spotlight plate behind it would just be a second frame 1px away.
    const base = FANTASY_CARD_TEMPLATE_SPEC.baseSize;
    const scale = Math.min(rect.width / base.width, rect.height / base.height);
    const box = centeredBox(rect, base.width * scale, base.height * scale);
    const card = new FantasyCardTemplateV2(scene, box.x + box.w / 2, box.y + box.h / 2, feature.skill, {
      width: box.w, height: box.h, tier: feature.skill.tier, glossary: false,
    });
    // THE REWARD FACE HAS TO BE LOOKABLE-UP TOO. This branch built the card and
    // returned, so the one screen that HANDS the player a card was the one
    // screen with no route to a keyword's rule — the same defect the Wiki and
    // both Shop panes were fixed for, found in a third place by auditing
    // reachability PER SITE instead of per file (the `cardHoverEntries` at
    // `attachCardHoverTip` below and the `renderCardDetailOverlay` calls in the
    // picker grids belong to different functions, and crediting them here is
    // exactly the inference that hid this).
    //
    // ONE ROUTE, BOTH PLATFORMS: `attachHoverTip` is documented as covering
    // both by design — "Desktop: mouse hover (`pointerover`/`pointerout`).
    // Mobile: tap (touch fires `pointerdown`/`pointerover` too, so the same
    // wiring works)" (hoverTip.ts) — and it carries `cardHoverEntries`, which
    // is `cardGlossaryEntries`' brief form: every keyword definition this card
    // opens, and after the same file's gated-hover fix that now includes a
    // gated keyword's own rule rather than only its gate.
    //
    // NOT the detail overlay for mobile, deliberately: `renderCardDetailOverlay`
    // delegates its whole teardown to a caller-supplied `onClose`, which the
    // pickers satisfy from their own `inspectedIndex`/`onInspect` state.
    // `renderRunRewardPanel` takes neither, so wiring it here would mean
    // widening this module's public options AND editing the two run-event
    // scenes that call it — scenes another agent is live in. A tip needs no
    // state and no close contract.
    card.setInteractive({ useHandCursor: true });
    attachHoverTip(scene, card, { x: box.x, y: box.y, w: box.w, h: box.h }, cardHoverEntries(feature.skill));
    return;
  }
  if (feature.kind === 'gem') {
    const ideal = FEATURE_GEM_CHIP_SIZE_SOLO[platform];
    const scale = Math.min(1, rect.width / ideal.w, rect.height / ideal.h);
    const box = centeredBox(rect, ideal.w * scale, ideal.h * scale);
    const gem = feature.gem;
    renderFeatureBackdrop(scene, rect, box, GEM_RARITY_COLOR[gem.rarity]);
    renderGemChip(scene, box, gem, platform, undefined, colors);
    addHoverTipZone(scene, { x: box.x, y: box.y, w: box.w, h: box.h }, gemHoverEntries(gem));
    return;
  }
  // `icon` — the fallback feature for gold/level/nothing/upgrade outcomes: a
  // bigger version of the same top-of-panel icon, so the slot is never blank.
  const size = Math.min(FEATURE_ICON_SIZE_SOLO[platform], rect.width, rect.height);
  const box = centeredBox(rect, size, size);
  renderFeatureBackdrop(scene, rect, box, colors.chip);
  addRunArt(scene, iconKey, { x: box.x, y: box.y, width: box.w, height: box.h }, colors === UI ? 0.9 : 1);
}

/**
 * Icon + a short label, laid out as ONE ROW spanning the FULL width of
 * `rect` (icon on the left, label filling the rest) — the density-pass
 * (task #41) replacement for a LONE centered icon, which used a fixed ~56px
 * square in the middle of a rect that was often much wider (`icon`/
 * `outcome.identity` both span the panel's full inner width). `label`
 * omitted draws the icon alone, still left-aligned rather than re-centered,
 * so a caller that has no label yet (there is none today, but the shape
 * stays honest) doesn't jump the icon around.
 *
 * Shared by `renderRunRewardPanel`'s `identity` band (label = the EVENT's
 * own title, the density pass's "ties the reward back to what happened"
 * answer — see `runScreenTemplate.ts`'s `reward.outcome` doc — bounded to
 * ONE line, never the free-flowing body text task #29 stopped re-rendering
 * here) and `renderPickHeader`'s `icon` row (same label) below, so a picker
 * and the resolved-outcome screen carry the same context.
 */
function renderIdentityRow(
  scene: Phaser.Scene,
  rect: Rect,
  iconKey: string,
  label: string | undefined,
  font: LayoutProfile['font'],
  auditName: string,
): void {
  const size = Math.min(rect.height, 40);
  addRunArt(scene, iconKey, { x: rect.x, y: rect.y + (rect.height - size) / 2, width: size, height: size });
  if (!label) return;
  const textX = rect.x + size + 12;
  const maxW = Math.max(0, rect.width - size - 12);
  const labelText = scene.add.text(textX, rect.y + rect.height / 2, label, {
    fontFamily: FONT.body, fontStyle: 'italic', fontSize: `${font.small}px`, color: UI.textSoft,
    wordWrap: { width: maxW },
  }).setOrigin(0, 0.5);
  auditTextBlock(labelText, { name: auditName, maxWidth: maxW, maxHeight: rect.height, minFontSize: 8 });
}

/**
 * Headline (+ optional detail), stacked and treated as ONE BLOCK that is
 * vertically CENTERED within `rect` — the resolved-outcome screen's `text`
 * column (`runScreenTemplate.ts`'s `reward.outcome.text`) can be much taller
 * than either line needs (DESKTOP: the full body height of the two-column
 * layout; MOBILE: a still-generous fixed band), so a top-anchored pair would
 * read as pinned to the column's ceiling. DESKTOP left-aligns (a narrower
 * column reads like a caption beside the feature); MOBILE keeps the
 * existing center alignment (a full-width band, matching the rest of the
 * screen's centered text). Both lines still wrap to `rect.width` and are
 * still `auditTextBlock`-guarded against `rect`'s own bounds, so centering
 * the block can never push either line outside its declared rect.
 */
function renderRewardText(scene: Phaser.Scene, platform: RunTemplatePlatform, rect: Rect, model: RunRewardViewModel, font: LayoutProfile['font'], colors: RewardColors = UI): void {
  const centered = platform === 'mobile';
  const align = centered ? 'center' : 'left';
  const originX = centered ? 0.5 : 0;
  const textX = centered ? rect.x + rect.width / 2 : rect.x;

  const headlineText = scene.add.text(textX, 0, model.headline, {
    fontFamily: FONT.display, fontStyle: 'bold', fontSize: `${font.title}px`, color: colors.text,
    align, wordWrap: { width: rect.width },
  }).setOrigin(originX, 0);
  auditTextBlock(headlineText, { name: 'Run reward headline', maxWidth: rect.width, maxHeight: rect.height, minFontSize: 12 });

  let detailText: Phaser.GameObjects.Text | undefined;
  if (model.detail) {
    detailText = scene.add.text(textX, 0, model.detail, {
      fontFamily: FONT.body, fontSize: `${font.small}px`, color: colors.textDim,
      align, wordWrap: { width: rect.width },
    }).setOrigin(originX, 0);
    auditTextBlock(detailText, {
      name: 'Run reward detail', maxWidth: rect.width, maxHeight: Math.max(0, rect.height - headlineText.height - 10), minFontSize: 8,
    });
  }

  const gap = 10;
  const totalH = headlineText.height + (detailText ? gap + detailText.height : 0);
  const top = rect.y + Math.max(0, (rect.height - totalH) / 2);
  headlineText.setY(top);
  if (detailText) detailText.setY(top + headlineText.height + gap);
}

function renderContinueButton(scene: Phaser.Scene, rect: Rect, font: LayoutProfile['font'], onContinue: () => void, colors: RewardColors = UI): void {
  const btn = scene.add.rectangle(rect.x, rect.y, rect.width, rect.height, colors.chip, 1)
    .setOrigin(0, 0)
    .setStrokeStyle(2, colors.border, colors === UI ? 0.9 : 1)
    .setInteractive({ useHandCursor: true });
  const label = scene.add.text(rect.x + rect.width / 2, rect.y + rect.height / 2, 'CONTINUE ›', {
    fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${font.name + 1}px`, color: UI.textOnChip,
  }).setOrigin(0.5);
  auditControlLabel(btn, label, { name: 'Run reward continue', horizontalPadding: 12, verticalPadding: 8, minFontSize: 10 });
  // Shared feel (./motion): tweened hover, immediate darken-and-sink on press.
  // This is the most-pressed button in a run, so it is the one where a dead
  // click was most noticeable.
  attachButtonFeel(scene, btn, {
    fill: colors.chip,
    hover: colors === UI ? UI.chipDark : 0xe4bd72,
    follow: [label],
    onPress: () => { playSfx('uiClick'); onContinue(); },
  });
}

/** The reward panel's background plate — identical on the resolved-outcome
 * screen and the bonus-draft/upgrade-card pickers (all three own the WHOLE
 * panel, see `runScreenTemplate.ts`'s `reward` doc). */
function renderPanelBackground(scene: Phaser.Scene, panel: Rect, colors: RewardColors = UI): void {
  scene.add.rectangle(panel.x, panel.y, panel.width, panel.height, colors.panelAlt, colors === UI ? 0.94 : 1)
    .setOrigin(0, 0)
    .setStrokeStyle(2, colors.chip, colors === UI ? 0.6 : 1);
}

/** One persistent outcome plate/header for choices, pickers and receipts.
 * The scene renders its unchanged story/art alongside this pane. */
export function renderRunEventOutcomePane(scene: Phaser.Scene, template: RunScreenTemplate): void {
  const pane = template.eventOutcomePane;
  if (!pane) return;
  renderPanelBackground(scene, template.contentSlots.reward.panel, rewardColors(template));
  const header = pane.header;
  const label = scene.add.text(header.x, header.y, 'EVENT OUTCOME', {
    ...textRoleFor(template.platform, 'kicker'), color: EVENT_REWARD_COLORS.textAccent,
  });
  auditTextBlock(label, { name: 'Event outcome heading', maxWidth: header.width * 0.55, maxHeight: header.height, minFontSize: 9 });
}

/** Shared reward contents. Event callers supply eventOutcomePane slots, so
 * this renderer adds no background/identity shell and owns one pane-local
 * CONTINUE on either platform. Card/gem/icon subjects and their inspections
 * are unchanged. Non-event template callers retain their original treatment. */

export function renderRunRewardPanel(
  scene: Phaser.Scene,
  template: RunScreenTemplate,
  model: RunRewardViewModel,
  opts: { font: LayoutProfile['font']; eventTitle: string; onContinue: () => void },
): void {
  const { panel, buttons } = template.contentSlots.reward;
  const { identity, text, feature } = template.contentSlots.reward.outcome;

  if (!template.eventOutcomePane) {
    renderPanelBackground(scene, panel);
    renderIdentityRow(scene, identity, model.iconKey, opts.eventTitle, opts.font, 'Run reward event identity');
  }
  renderRewardText(scene, template.platform, text, model, opts.font, rewardColors(template));
  renderBigFeature(scene, template.platform, model.feature, model.iconKey, feature, rewardColors(template));
  // Events always own their exit here, never in a second HUD action.
  if (template.eventOutcomePane || template.platform === 'desktop') {
    renderContinueButton(scene, buttons, opts.font, opts.onContinue, rewardColors(template));
  }
}

/**
 * Shared header for every "tap one to pick" reward-screen overlay (the
 * bonus-draft grid and the upgrade-card grid below): the panel background,
 * the top-of-panel identity row (icon + the event's own title — task #41,
 * same context callback the resolved-outcome screen's `identity` band
 * gives), and a bold centered title in the `headline` rect. Pulled out so
 * the two pickers can't drift on this shared shell — only the grid contents
 * below it differ between them.
 */
function renderPickHeader(
  scene: Phaser.Scene,
  template: RunScreenTemplate,
  iconKey: string,
  title: string,
  eventTitle: string,
  font: LayoutProfile['font'],
  auditName: string,
): void {
  const { panel, icon, headline } = template.contentSlots.reward;
  if (!template.eventOutcomePane) {
    renderPanelBackground(scene, panel);
    renderIdentityRow(scene, icon, iconKey, eventTitle, font, `${auditName} identity`);
  }
  const label = scene.add.text(headline.x + headline.width / 2, headline.y, title, {
    fontFamily: FONT.display, fontStyle: 'bold', fontSize: `${font.title}px`, color: rewardColors(template).textAccent, align: 'center',
  }).setOrigin(0.5, 0);
  auditTextBlock(label, { name: auditName, maxWidth: headline.width - 64, maxHeight: headline.height, minFontSize: 10 });
}

interface RewardPickerPagingOptions {
  page: number;
  onPageChange: (page: number) => void;
}

/** Draws the navigation returned by `layoutRewardPickerWindow`. The scene owns
 * the page integer and rebuilds through the shared scene-rebuild idiom; this
 * renderer only reports the requested destination page. Disabled boundary
 * controls are intentionally inert. */
function renderPickerPager(
  scene: Phaser.Scene,
  pickerWindow: RewardPickerWindow,
  platform: RunTemplatePlatform,
  onPageChange: (page: number) => void,
  colors: RewardColors = UI,
): void {
  const { pager } = pickerWindow;
  if (!pager) return;

  const renderControl = (box: Box, labelText: string, enabled: boolean, page: number): void => {
    const control = scene.add.rectangle(box.x, box.y, box.w, box.h, enabled ? colors.panelAlt : colors.panelMuted, enabled ? 1 : 0.55)
      .setOrigin(0, 0)
      .setStrokeStyle(1, enabled ? colors.chip : colors.border, enabled ? 0.9 : 0.45);
    const label = scene.add.text(box.x + box.w / 2, box.y + box.h / 2, labelText, {
      ...textRoleFor(platform, 'label'),
      color: enabled ? colors.textBright : colors.textDisabled,
    }).setOrigin(0.5);
    auditControlLabel(control, label, { name: `Run reward picker ${labelText}`, horizontalPadding: 8, verticalPadding: 5, minFontSize: 8 });
    if (!enabled) return;
    control.setInteractive({ useHandCursor: true });
    attachButtonFeel(scene, control, {
      fill: colors.panelAlt,
      hover: colors.chipDark,
      follow: [label],
      onPress: () => { playSfx('uiClick'); onPageChange(page); },
    });
  };

  renderControl(pager.previous, '‹ PREVIOUS', pickerWindow.canPrevious, pickerWindow.page - 1);
  renderControl(pager.next, 'NEXT ›', pickerWindow.canNext, pickerWindow.page + 1);
  const indicator = scene.add.text(
    pager.indicator.x + pager.indicator.w / 2,
    pager.indicator.y + pager.indicator.h / 2,
    `PAGE ${pickerWindow.page + 1} / ${pickerWindow.pageCount}`,
    { ...textRoleFor(platform, 'kicker'), color: colors.textMuted },
  ).setOrigin(0.5);
  auditTextBlock(indicator, {
    name: 'Run reward picker page indicator',
    maxWidth: pager.indicator.w,
    maxHeight: pager.indicator.h,
    minFontSize: 8,
  });
}

/**
 * A bonus-draft/upgrade-card/merge picker cell's DESKTOP hover-tip
 * (`cardHoverEntries`, the SAME entries `DesktopDraftScene`'s own start-draft
 * grid already shows). No-op on mobile.
 *
 * FIXED 2026-08-28: this used to add its OWN transparent rect and hand THAT to
 * `attachHoverTip`, without ever calling `setInteractive()` on it — and
 * `attachHoverTip` only subscribes to `pointerover`/`pointerout`/`pointerdown`,
 * which a non-interactive object never emits. So no desktop picker has ever
 * actually shown a tip, and since `DesktopRunEventScene` passes no `onInspect`
 * either, desktop had NO way to read a card before an irreversible pick. It
 * now hooks the cell's REAL, already-interactive PICK rect (`target`), which
 * also avoids stacking a second interactive rect on top of the pick surface —
 * Phaser's `topOnly` dispatch means that would have swallowed the pick click.
 * A tip opened by the same `pointerdown` that commits the pick is harmless:
 * the pick rerenders the scene, which destroys it.
 *
 * The MOBILE half of what this used to do — a hand-rolled 22px "ⓘ" badge drawn
 * at the CELL's top-right corner — is gone (2026-08-28). `CardToken` already
 * owns an inspect button (`CardTokenOptions.onInspect`, the one the shop's
 * owned board/bag columns use), and `cardTokenSpec.ts` places it in the token's
 * OUTWARD top corner with a full-height reserved text strip beside it. The
 * hand-rolled badge instead landed in the token's INWARD top corner, which is
 * where `CardToken` already draws the slot number / `×N SLOTS` span label — so
 * the two overlapped and printed "×2 SLO[i]", losing the one thing that label
 * exists to say (how many board slots a tap commits to). The pickers now pass
 * `onInspect` to the token itself: same affordance, correct corner, and the
 * text clamps account for it, so there is nothing left to collide.
 */
function attachCellHoverTip(
  scene: Phaser.Scene,
  template: RunScreenTemplate,
  target: Phaser.GameObjects.GameObject,
  cell: Box,
  skill: SkillDef,
): void {
  if (template.platform !== 'desktop') return;
  attachHoverTip(scene, target, { x: cell.x, y: cell.y, w: cell.w, h: cell.h }, cardHoverEntries(skill));
}

/**
 * The clickable PICK surface under one picker cell, plus the `CardToken` on top
 * of it — in THAT order, deliberately. Phaser hit-tests only the TOPMOST
 * interactive object under the pointer (`topOnly`), and the token's own ⓘ
 * inspect button is interactive: adding the pick rect FIRST leaves the button
 * above it, so an inspect tap opens the overlay and does NOT also commit the
 * pick, while every other pixel of the row falls through to the pick rect (the
 * token's remaining children are inert). The old hand-rolled badge got the same
 * effect by being drawn after the pick rect and calling `stopPropagation`;
 * ordering is the same guarantee with nothing to remember.
 */
function renderPickableCardRow(
  scene: Phaser.Scene,
  cell: Box,
  cardBox: Box,
  skill: SkillDef,
  onPick: () => void,
  onInspect: (() => void) | undefined,
): Phaser.GameObjects.Rectangle {
  const hit = scene.add.rectangle(cell.x + cell.w / 2, cell.y + cell.h / 2, cell.w, cell.h, 0xffffff, 0)
    .setInteractive({ useHandCursor: true });
  hit.on('pointerdown', () => { playSfx('uiClick'); onPick(); });
  new CardToken(scene, cardBox.x + cardBox.w / 2, cardBox.y + cardBox.h / 2, skill, {
    width: cardBox.w, height: cardBox.h, side: 'left', onInspect,
  });
  return hit;
}

/**
 * The "PICK ONE TO KEEP" bonus-draft picker — THE one implementation both
 * `DesktopRunEventScene` and `MobileRunEventScene` call for a resolved
 * `bonusDraft` outcome, in place of each scene's own hand-rolled row/column
 * math (which had already drifted — see the module doc above and
 * `runRewardGeometry.ts`'s doc comment). Uses `renderPickHeader` (panel/icon/
 * headline = "PICK ONE TO KEEP"), then fills `feature` with a
 * `layoutRewardPickerWindow` of authored-order full-width CARD ROWS —
 * `cardRowIdeal` is the same row shape the upgrade-card and merge pickers'
 * grids use, so all three pickers read as the same shape at the same visual
 * weight, and as the same shape the deck/bag/board/shelf already draw. No `detail` row (the picker never has one) — left
 * blank exactly like every other outcome that has no detail text, not a
 * special case.
 *
 * `inspectedIndex`/`onInspect` (both optional) are the mobile ⓘ-overlay's
 * state, owned by the calling SCENE (same "lift state up" shape as
 * `DesktopShopScene`'s `inspectOwned`/`MobileDraftScene`'s `detailSkillId`)
 * — this function stays a stateless renderer of whatever index the scene
 * says is currently inspected, never owning that state itself so it survives
 * this function being re-invoked wholesale on every `rerender()`.
 */
export function renderRunBonusDraftPicker(
  scene: Phaser.Scene,
  template: RunScreenTemplate,
  cards: readonly RunRewardCardOption[],
  opts: {
    font: LayoutProfile['font'];
    eventTitle: string;
    onPick: (card: RunRewardCardOption) => void;
    inspectedIndex?: number | null;
    onInspect?: (index: number | null) => void;
  } & RewardPickerPagingOptions,
): void {
  renderPickHeader(scene, template, choiceArtKey('bonusDraft'), 'PICK ONE TO KEEP', opts.eventTitle, opts.font, 'Run reward bonus draft title');

  const { feature } = template.contentSlots.reward;
  const ideal = cardRowIdeal(feature, template.platform);
  const pickerWindow = layoutRewardPickerWindow('bonusDraft', template.platform, feature, cards.length, ideal.w, ideal.h, GRID_GAP[template.platform], opts.page);
  renderPickerPager(scene, pickerWindow, template.platform, opts.onPageChange, rewardColors(template));
  let inspecting: SkillDef | undefined;
  pickerWindow.cells.forEach((cell, localIndex) => {
    const i = pickerWindow.startIndex + localIndex;
    const card = cards[i];
    if (!card) return;
    const skill = skillBook[card.skillId];
    if (!skill) return;
    const shown = card.tier === skill.tier ? skill : applyTier(skill, card.tier);
    const hit = renderPickableCardRow(scene, cell, cell, shown, () => opts.onPick(card),
      opts.onInspect ? () => opts.onInspect?.(i) : undefined);
    attachCellHoverTip(scene, template, hit, cell, shown);
    if (opts.inspectedIndex === i) inspecting = shown;
  });
  if (inspecting) {
    renderCardDetailOverlay(scene, inspecting, { font: opts.font, onClose: () => opts.onInspect?.(null) });
  }
}

/** A card offered by an event picker. Unlike the start-draft `DraftCard`, an
 * event offer persists its actual tier and may legitimately be Silver+; the
 * renderer therefore consumes this neutral, widened shape. */
export interface RunRewardCardOption {
  skillId: string;
  tier: SkillTier;
}

/** A persisted upgrade target can outlive a temporary deck/bag arrangement.
 * Keep the offered instance visible even when its card can no longer be
 * rendered, so reopening never silently drops one of the committed options. */
export type RunRewardUpgradeOption =
  | (UpgradeCardOption & { available?: true })
  | { instanceId: string; available: false; fallbackLabel: string };

/** Small label-strip height (per platform) reserved ABOVE each card in the
 * upgrade-card picker's grid, showing its "BRONZE → SILVER" tier jump —
 * folded straight into the picker window's ideal HEIGHT (see
 * `renderRunUpgradeCardPicker` below), so it scales down by the exact same
 * uniform factor as the card sharing its cell and can never grow the grid
 * past what its bounded page already fits inside `feature`. */
const UPGRADE_TIER_LABEL_H: Record<RunTemplatePlatform, number> = { desktop: 22, mobile: 18 };

/**
 * The "CHOOSE A CARD TO UPGRADE" picker — `upgradeCard`'s counterpart to
 * `renderRunBonusDraftPicker` above, called by both `DesktopRunEventScene`/
 * `MobileRunEventScene` for a resolved `upgradeCardPick` outcome
 * (`src/run/events.ts`'s deferred-pick shape mirrors `bonusDraft`'s: roll the
 * eligible set now, resolve which one on tap). Same `renderPickHeader` +
 * `layoutRewardPickerWindow` shape as the bonus-draft picker, with one addition:
 * unlike a fresh bonus-draft card, every option here is something the player
 * ALREADY owns, so the tier the tap commits to needs to be legible up front
 * rather than only implied — each cell reserves a small
 * `UPGRADE_TIER_LABEL_H` strip above its card for "FROM → TO", computed by
 * folding that strip into the grid's ideal HEIGHT (so the shared grid's
 * one uniform scale factor governs both the card and its label together,
 * never just the card) rather than drawing it as a separate, unscaled
 * overlay that could grow past a shrunk cell.
 *
 * `inspectedIndex`/`onInspect` mirror `renderRunBonusDraftPicker`'s own
 * (same doc comment applies: state lives in the calling scene, this stays a
 * stateless renderer of whichever index the scene says is inspected).
 */
export function renderRunUpgradeCardPicker(
  scene: Phaser.Scene,
  template: RunScreenTemplate,
  options: readonly RunRewardUpgradeOption[],
  opts: {
    font: LayoutProfile['font'];
    eventTitle: string;
    onPick: (option: RunRewardUpgradeOption) => void;
    inspectedIndex?: number | null;
    onInspect?: (index: number | null) => void;
  } & RewardPickerPagingOptions,
): void {
  renderPickHeader(scene, template, choiceArtKey('upgradeCard'), 'CHOOSE A CARD TO UPGRADE', opts.eventTitle, opts.font, 'Run reward upgrade picker title');

  const { feature } = template.contentSlots.reward;
  const cardIdeal = cardRowIdeal(feature, template.platform);
  const labelH = UPGRADE_TIER_LABEL_H[template.platform];
  const idealH = cardIdeal.h + labelH;
  const pickerWindow = layoutRewardPickerWindow('upgradeCard', template.platform, feature, options.length, cardIdeal.w, idealH, GRID_GAP[template.platform], opts.page);
  renderPickerPager(scene, pickerWindow, template.platform, opts.onPageChange, rewardColors(template));
  let inspecting: SkillDef | undefined;
  pickerWindow.cells.forEach((cell, localIndex) => {
    const i = pickerWindow.startIndex + localIndex;
    const option = options[i];
    if (!option) return;
    if (!('skillId' in option)) {
      const fallbackStyle = textRoleFor(template.platform, 'label', { ink: 'alarm' });
      const fallback = scene.add.rectangle(cell.x, cell.y, cell.w, cell.h, UI.panelAlt, 0.98)
        .setOrigin(0, 0)
        .setStrokeStyle(2, UI.bad, 0.8)
        .setInteractive({ useHandCursor: true });
      const label = scene.add.text(cell.x + cell.w / 2, cell.y + cell.h / 2, option.fallbackLabel, {
        ...fallbackStyle,
        align: 'center',
        wordWrap: { width: Math.max(1, cell.w - 24) },
      }).setOrigin(0.5);
      auditTextBlock(label, { name: 'Run reward unavailable upgrade option', maxWidth: Math.max(1, cell.w - 24), maxHeight: Math.max(1, cell.h - 16), minFontSize: 8 });
      attachButtonFeel(scene, fallback, {
        fill: UI.panelAlt,
        hover: UI.badSoft,
        follow: [label],
        onPress: () => opts.onPick(option),
      });
      return;
    }
    const preview = tierUpgradePreview(option.skillId, option.from, option.to);
    if (!preview.available) return;
    // `layoutFeatureGrid` scales width/height UNIFORMLY off the same ideal
    // aspect ratio, so this one ratio recovers exactly how much the label
    // strip itself shrank alongside the card sharing its cell.
    const scale = cell.h / idealH;
    const cellLabelH = labelH * scale;
    const cardH = cell.h - cellLabelH;
    const cx = cell.x + cell.w / 2;
    const tierStep = `${option.from.toUpperCase()} → ${option.to.toUpperCase()}`;
    const previewCue = preview.conditionalTrade ? 'CONDITIONAL PREVIEW' : 'PREVIEW';

    const tierLabel = scene.add.text(cx, cell.y + cellLabelH / 2, `${previewCue} · ${tierStep}`, {
      fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${Math.max(8, Math.round(11 * scale))}px`,
      color: preview.conditionalTrade ? `#${UI.bad.toString(16).padStart(6, '0')}` : rewardColors(template).textAccent, align: 'center',
    }).setOrigin(0.5);
    auditTextBlock(tierLabel, { name: 'Run reward upgrade tier label', maxWidth: cell.w, maxHeight: Math.max(1, cellLabelH), minFontSize: 7 });

    // The card is the CARD sub-rect of the cell (the tier-label strip above it
    // is not part of the row), while the PICK surface stays the whole cell so
    // the label is tappable too.
    const cardCell: Box = { x: cell.x, y: cell.y + cellLabelH, w: cell.w, h: cardH };
    const hit = renderPickableCardRow(scene, cell, cardCell, preview.toSkill, () => opts.onPick(option),
      opts.onInspect ? () => opts.onInspect?.(i) : undefined);
    attachCellHoverTip(scene, template, hit, cardCell, preview.toSkill);
    if (opts.inspectedIndex === i) inspecting = preview.toSkill;
  });
  if (inspecting) {
    renderCardDetailOverlay(scene, inspecting, { font: opts.font, onClose: () => opts.onInspect?.(null) });
  }
}

/**
 * The "PICK ONE TO KEEP" gem picker — `gemChoice`'s counterpart to
 * `renderRunBonusDraftPicker`/`renderRunUpgradeCardPicker` above, called by
 * both `DesktopRunEventScene`/`MobileRunEventScene` for a resolved
 * `gemChoicePick` outcome (`src/run/events.ts`'s `{kind:'gemChoicePick',
 * options}` — gem ids only, no display metadata; resolved against `gemBook`
 * here, same as every other surface that only carries a gem id). Same
 * `renderPickHeader` + `layoutRewardPickerWindow` shape as the other two pickers,
 * with `renderGemChip` (the SAME chip visual `renderBigFeature`'s solo gem
 * feature draws, as a full-width row at the grid's own `FEATURE_GEM_CHIP_H`
 * instead of the solo `_SOLO` size) filling each cell instead of a `CardToken`.
 *
 * NO INSPECT AFFORDANCE IS NEEDED HERE — because the chip itself now carries
 * the information, on both platforms. That claim used to be made and was
 * false: the chip drew a marker and a name, and the effect/rarity lived ONLY
 * in the `attachHoverTip` wired below for `template.platform === 'desktop'`,
 * so the phone — the device this game is read on — was asked to make an
 * irreversible pick with nothing but three names to go on. `renderGemChip`
 * prints the rarity, the kind and the effect text inline now (see its doc
 * comment), which is what the two card pickers' ⓘ badge exists to reach and
 * what the shop shelf has always shown. The desktop hover stays: it costs a
 * mouse user nothing and is the same tip the solo resolved-outcome gem
 * feature shows, so the two surfaces still agree.
 */
export function renderRunGemChoicePicker(
  scene: Phaser.Scene,
  template: RunScreenTemplate,
  gemIds: readonly string[],
  opts: { font: LayoutProfile['font']; eventTitle: string; onPick: (gemId: string) => void } & RewardPickerPagingOptions,
): void {
  renderPickHeader(scene, template, choiceArtKey('gemChoicePick'), 'PICK ONE TO KEEP', opts.eventTitle, opts.font, 'Run reward gem choice title');

  const { feature } = template.contentSlots.reward;
  const ideal = rowIdeal(feature, FEATURE_GEM_CHIP_H[template.platform]);
  const pickerWindow = layoutRewardPickerWindow('gemChoice', template.platform, feature, gemIds.length, ideal.w, ideal.h, GRID_GAP[template.platform], opts.page);
  renderPickerPager(scene, pickerWindow, template.platform, opts.onPageChange, rewardColors(template));
  pickerWindow.cells.forEach((cell, localIndex) => {
    const gemId = gemIds[pickerWindow.startIndex + localIndex];
    if (!gemId) return;
    const gem = gemBook[gemId];
    if (!gem) return;
    const box: Box = { x: cell.x, y: cell.y, w: cell.w, h: cell.h };
    renderGemChip(scene, box, gem, template.platform, undefined, rewardColors(template));
    const hit = scene.add.rectangle(cell.x + cell.w / 2, cell.y + cell.h / 2, cell.w, cell.h, 0xffffff, 0)
      .setInteractive({ useHandCursor: true });
    hit.on('pointerdown', () => { playSfx('uiClick'); opts.onPick(gemId); });
    attachGemCellInspect(scene, template, hit, box, gem);
  });
}

/**
 * THE GEM PICK CELL'S INSPECT AFFORDANCE — a desktop hover tip, a mobile ⓘ.
 *
 * WHY IT EXISTS (2026-09-07, review 2). Both gem pickers wired
 * `attachHoverTip` behind `template.platform === 'desktop'`, so on a phone the
 * `GEM EFFECT` block — and with it the fact that `empowering_core`'s `+6
 * damage` lands on EVERY hit — was unreachable before an IRREVERSIBLE pick.
 * The chip already prints the gem's own parameters (`renderGemChip`); what the
 * phone had no route to was the definitions.
 *
 * The tap cannot be borrowed: on these cells a tap COMMITS the pick. So mobile
 * gets the same shape the two CARD pickers use — a small badge in the cell's
 * corner, added AFTER the pick rect so Phaser's `topOnly` dispatch puts it
 * ABOVE (see `renderPickableCardRow`'s doc for that ordering guarantee), with
 * `stopPropagation` as the belt to that braces. `textRoleFor` supplies the
 * glyph's style, so this adds no `fontSize` literal to a file whose ratchet
 * budget is exactly spent.
 */
function attachGemCellInspect(
  scene: Phaser.Scene,
  template: RunScreenTemplate,
  pickTarget: Phaser.GameObjects.GameObject,
  box: Box,
  gem: GemDef,
): void {
  const entries = gemHoverEntries(gem);
  if (template.platform === 'desktop') {
    attachHoverTip(scene, pickTarget, box, entries);
    return;
  }
  const size = 22;
  const cx = box.x + box.w - size / 2 - 4;
  const cy = box.y + size / 2 + 4;
  const badge = scene.add.rectangle(cx, cy, size, size, UI.chip, 0.92)
    .setOrigin(0.5).setStrokeStyle(1, UI.border, 0.9).setInteractive({ useHandCursor: true });
  scene.add.text(cx, cy, 'i', textRoleFor(template.platform, 'micro', { ink: 'onAccent' })).setOrigin(0.5);
  attachHoverTip(scene, badge, { x: box.x, y: box.y, w: box.w, h: box.h }, entries);
  badge.on('pointerdown', (_p: Phaser.Input.Pointer, _lx: number, _ly: number, event: Phaser.Types.Input.EventData) => {
    event.stopPropagation();
  });
}

/**
 * The "PICK ONE TO SELL" pouch-gem picker — `sellGem`'s counterpart to
 * `renderRunGemChoicePicker` above, reusing its EXACT shell (`renderPickHeader`
 * + `layoutRewardPickerWindow` + `renderGemChip`) so a "gain a gem"/"sell a gem"
 * picker read as visually related, not two unrelated overlays. The only real
 * difference is `renderGemChip`'s new optional `priceLabel` (a "SELL Ng" tag
 * per chip, since — unlike `gemChoicePick`'s freshly-rolled candidates, which
 * are interchangeable until picked — each `SellGemOption` here can carry a
 * DIFFERENT price, so the player needs to see it per-option before tapping)
 * and addressing pick targets by `pouchIndex` (a specific pouch slot) rather
 * than `gemId` (which the pouch can hold duplicates of).
 */
export function renderRunSellGemPicker(
  scene: Phaser.Scene,
  template: RunScreenTemplate,
  options: readonly SellGemOption[],
  opts: { font: LayoutProfile['font']; eventTitle: string; onPick: (option: SellGemOption) => void } & RewardPickerPagingOptions,
): void {
  renderPickHeader(scene, template, choiceArtKey('sellGemPick'), 'PICK ONE TO SELL', opts.eventTitle, opts.font, 'Run reward sell-gem choice title');

  const { feature } = template.contentSlots.reward;
  const ideal = rowIdeal(feature, FEATURE_GEM_CHIP_H[template.platform]);
  const pickerWindow = layoutRewardPickerWindow('sellGem', template.platform, feature, options.length, ideal.w, ideal.h, GRID_GAP[template.platform], opts.page);
  renderPickerPager(scene, pickerWindow, template.platform, opts.onPageChange, rewardColors(template));
  pickerWindow.cells.forEach((cell, localIndex) => {
    const option = options[pickerWindow.startIndex + localIndex];
    if (!option) return;
    const gem = gemBook[option.gemId];
    if (!gem) return;
    const box: Box = { x: cell.x, y: cell.y, w: cell.w, h: cell.h };
    renderGemChip(scene, box, gem, template.platform, `SELL ${option.price}g`, rewardColors(template));
    const hit = scene.add.rectangle(cell.x + cell.w / 2, cell.y + cell.h / 2, cell.w, cell.h, 0xffffff, 0)
      .setInteractive({ useHandCursor: true });
    hit.on('pointerdown', () => { playSfx('uiClick'); opts.onPick(option); });
    attachGemCellInspect(scene, template, hit, box, gem);
  });
}

/**
 * ONE consumed card's chip in the merge picker's SPENT strip — the visual
 * counterpart of `renderGemChip` above, for a card the trade is about to
 * destroy rather than a gem it is about to grant. Deliberately NOT a
 * `CardToken`: these three are not choices and not rewards, they are the price,
 * and drawing them at the same weight as the three tappable candidates below
 * would invite a tap on the wrong half of the screen. A chip says everything
 * identification needs — name, grade, and where it is sitting right now — in
 * one row.
 *
 * The plate is stroked in the INPUT tier's own colour (`TIER_COLOR`) so the
 * "three of one grade" rule is visible as three matching frames, and carries a
 * left rail in `UI.bad` — the palette's "this is a loss" colour, the same one
 * the RETIRE action uses — because nothing else on a reward screen ever
 * subtracts. Every internal offset is a fraction of `box`'s own height, the
 * same rule `renderGemChip` follows, so the chip scales with whatever the
 * shared reward-picker window hands it.
 */
function renderMergeSpentChip(scene: Phaser.Scene, box: Box, entry: MergeSpentEntry, colors: RewardColors = UI): void {
  const rail = Math.max(3, Math.round(box.h * 0.09));
  scene.add.rectangle(box.x, box.y, box.w, box.h, colors.panelMuted, 0.92)
    .setOrigin(0, 0)
    .setStrokeStyle(1, TIER_COLOR[entry.tier], 0.85);
  scene.add.rectangle(box.x, box.y, rail, box.h, UI.bad, 0.9).setOrigin(0, 0);
  const pad = Math.max(6, Math.round(box.h * 0.16));
  const textX = box.x + rail + pad;
  const textW = Math.max(0, box.w - rail - pad * 2);
  // TWO LINES, not one row of three columns: a card name is the long part and a
  // one-row chip made it compete with its own metadata for width, which cost
  // exactly the thing this strip exists to show (the first cut of this rendered
  // "Aegis C…" and "Arc Cas…" — two cards the player could no longer identify).
  // Name gets the full width; grade and place share the quieter line below.
  const namePx = Math.max(9, Math.round(box.h * 0.30));
  const metaPx = Math.max(8, Math.round(box.h * 0.23));
  const name = scene.add.text(textX, box.y + box.h * 0.28, entry.name, {
    fontFamily: FONT.display, fontStyle: 'bold', fontSize: `${namePx}px`, color: colors.text,
  }).setOrigin(0, 0.5);
  const meta = scene.add.text(textX, box.y + box.h * 0.71, `${entry.tierLabel} · ${entry.whereLabel}`, {
    fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${metaPx}px`, color: colors.textSoft,
  }).setOrigin(0, 0.5);
  auditTextBlock(name, { name: 'Run merge spent card name', maxWidth: textW, maxHeight: box.h * 0.5, minFontSize: 8 });
  auditTextBlock(meta, { name: 'Run merge spent card place', maxWidth: textW, maxHeight: box.h * 0.45, minFontSize: 7 });
}

/** Small centered caption drawn at the top of one of the merge picker's two
 * bands. Returns the y the band's own content should start at, so the caption
 * can never overlap what it labels. */
function renderMergeBandCaption(
  scene: Phaser.Scene,
  rect: Rect,
  text: string,
  font: LayoutProfile['font'],
  color: string,
  auditName: string,
): number {
  const label = scene.add.text(rect.x + rect.width / 2, rect.y, text, {
    fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${font.tiny}px`, color, align: 'center',
  }).setOrigin(0.5, 0);
  auditTextBlock(label, { name: auditName, maxWidth: rect.width, maxHeight: font.tiny * 2, minFontSize: 7 });
  return rect.y + label.height + 4;
}

/**
 * THE CARD MERGE PICKER — `mergeCards`'s counterpart to the four pickers above,
 * called by both `DesktopRunEventScene` and `MobileRunEventScene` for a
 * resolved `mergeCardsPick` outcome. Same `renderPickHeader` + grid shell as
 * its siblings, with the one thing none of them needs: the PRICE, shown beside
 * the reward.
 *
 * Three owned cards leave and one arrives, and this is the only screen in the
 * run where tapping destroys something. So the spent strip is not behind a
 * confirm and not on a second page — the three named instances (`buildRunMerge
 * ViewModel`, which resolves each one's board slot) sit directly above the
 * three candidates, both visible when the tap happens. `layoutMergePicker`
 * hands the strip the otherwise-unused `detail` rect and lets it borrow from
 * the top of `feature` only when it must, so on desktop the candidate cards
 * still render at the bonus-draft picker's exact size.
 *
 * The candidates keep the SAME inspect affordance as the other two card
 * pickers (`attachCellInspect`: a desktop hover-tip, a mobile ⓘ badge) — an
 * irreversible three-for-one trade that showed less about its output than the
 * reversible turn-zero draft would be the same information gap that helper was
 * written to close.
 */
export function renderRunMergeCardsPicker(
  scene: Phaser.Scene,
  template: RunScreenTemplate,
  model: RunMergeViewModel,
  opts: {
    font: LayoutProfile['font'];
    eventTitle: string;
    onPick: (candidate: MergeCandidateEntry) => void;
    inspectedIndex?: number | null;
    onInspect?: (index: number | null) => void;
  } & RewardPickerPagingOptions,
): void {
  renderPickHeader(scene, template, choiceArtKey('mergeCardsPick'), model.title, opts.eventTitle, opts.font, 'Run reward merge picker title');

  const { detail, feature } = template.contentSlots.reward;
  const bands = layoutMergePicker(detail, feature, template.platform, model.spent.length);

  // ---- what LEAVES ----
  const spentTop = renderMergeBandCaption(scene, bands.spent, model.spentCaption, opts.font, rewardColors(template).textSoft, 'Run reward merge spent caption');
  const spentRect: Rect = {
    x: bands.spent.x,
    y: spentTop,
    width: bands.spent.width,
    height: Math.max(0, bands.spent.y + bands.spent.height - spentTop),
  };
  const chipIdeal = mergeChipIdeal(spentRect, template.platform);
  const spentWindow = layoutRewardPickerWindow('mergeSpent', template.platform, spentRect, model.spent.length, chipIdeal.w, chipIdeal.h, GRID_GAP[template.platform], 0);
  spentWindow.cells.forEach((cell, localIndex) => {
    const entry = model.spent[spentWindow.startIndex + localIndex];
    if (!entry) return;
    renderMergeSpentChip(scene, cell, entry, rewardColors(template));
  });

  // ---- what ARRIVES ----
  const pickTop = renderMergeBandCaption(scene, bands.candidates, model.pickCaption, opts.font, rewardColors(template).textAccent, 'Run reward merge pick caption');
  const gridRect: Rect = {
    x: bands.candidates.x,
    y: pickTop,
    width: bands.candidates.width,
    height: Math.max(0, bands.candidates.y + bands.candidates.height - pickTop),
  };
  const cardIdeal = cardRowIdeal(gridRect, template.platform);
  const pickerWindow = layoutRewardPickerWindow('mergeCandidates', template.platform, gridRect, model.candidates.length, cardIdeal.w, cardIdeal.h, GRID_GAP[template.platform], opts.page);
  renderPickerPager(scene, pickerWindow, template.platform, opts.onPageChange, rewardColors(template));
  let inspecting: SkillDef | undefined;
  pickerWindow.cells.forEach((cell, localIndex) => {
    const i = pickerWindow.startIndex + localIndex;
    const candidate = model.candidates[i];
    if (!candidate) return;
    const hit = renderPickableCardRow(scene, cell, cell, candidate.skill, () => opts.onPick(candidate),
      opts.onInspect ? () => opts.onInspect?.(i) : undefined);
    attachCellHoverTip(scene, template, hit, cell, candidate.skill);
    if (opts.inspectedIndex === i) inspecting = candidate.skill;
  });
  if (inspecting) {
    renderCardDetailOverlay(scene, inspecting, { font: opts.font, onClose: () => opts.onInspect?.(null) });
  }
}
