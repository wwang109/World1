import Phaser from 'phaser';
import { playSfx } from '../audio/sfxSynth';
import { applyTier } from '../../engine/cards';
import { skillBook } from '../../data/skills';
import type { SkillDef } from '../../engine/types';
import type { DraftCard } from '../../run/draft';
import type { UpgradeCardOption } from '../../run/events';
import { DESKTOP_PROFILE, MOBILE_PROFILE, type LayoutProfile } from '../layoutProfile';
import { FONT, GEM_RARITY_COLOR, UI } from '../theme';
import { CardToken } from './CardToken';
import { auditControlLabel, auditTextBlock } from './controlLayoutAudit';
import { addHoverTipZone, attachHoverTip } from './hoverTip';
import { cardHoverEntries } from './cardHoverEntries';
import { renderCardDetailOverlay } from './cardDetailOverlay';
import { gemHoverEntry } from './gemGlossary';
import { addRunArt, choiceArtKey } from './runArt';
import { centeredBox, FEATURE_CARD_SIZE, layoutFeatureGrid, type Box } from './runRewardGeometry';
import type { RunRewardFeature, RunRewardViewModel } from './runRewardViewModel';
import type { Rect, RunScreenTemplate, RunTemplatePlatform } from './runScreenTemplate';

/**
 * Ideal (never-exceeded) feature-visual sizes per platform — the renderer
 * clamps DOWN to the feature rect when it's ever smaller than this, but
 * never stretches past it. These are the gem/icon's OWN natural size
 * elsewhere (a board slot, a shop shelf) — REVERTED 2026-08-06 from a ~35%
 * bump a same-day earlier pass introduced to keep the feature from looking
 * small inside the (then still full-region-sized) reward panel; now that
 * the panel is capped and centered to hug its content
 * (`runScreenTemplate.ts`'s `REWARD_PANEL_MAX_W`/`_H`), the bump is no
 * longer needed — see `runRewardGeometry.ts`'s `FEATURE_CARD_SIZE` doc
 * comment for the full rationale (the card variant lives there, reverted
 * alongside these).
 *
 * The CARD variant (`FEATURE_CARD_SIZE`) lives in `runRewardGeometry.ts`
 * instead of here — it's imported above — because that pure module also
 * doubles as the per-card ideal size for the bonus-draft grid AND the
 * upgrade-card grid (`renderRunBonusDraftPicker`/`renderRunUpgradeCardPicker`
 * below, so a picker card reads at a consistent visual weight across both)
 * and is unit-tested directly against the template's real `feature` rects in
 * `tests/game/runRewardGeometry.test.ts` — a single source of truth instead
 * of a hand-synced duplicate. `FEATURE_*_SOLO` below are a SEPARATE, BIGGER
 * ideal size used ONLY by the resolved-outcome screen's single feature (see
 * `renderBigFeature`) — deliberately not shared with the grids: a picker
 * has to fit 4-5 cards across the SAME width a solo reward has all to
 * itself, so the two ideals cannot be the same number without either
 * cramming the grid or under-using the solo screen.
 */
const FEATURE_GEM_CHIP_SIZE: Record<RunTemplatePlatform, { w: number; h: number }> = {
  desktop: { w: 260, h: 56 },
  mobile: { w: 260, h: 52 },
};
const FEATURE_ICON_SIZE: Record<RunTemplatePlatform, number> = { desktop: 96, mobile: 80 };

/**
 * Task #41 density pass (2026-08-08) — the resolved-outcome screen's OWN,
 * LARGER feature ideal (see `runScreenTemplate.ts`'s `reward.outcome` doc
 * comment): once a card/gem/icon is the ONLY thing in the feature column
 * (not one of 4-5 in a grid), it can afford to be the visual anchor of the
 * whole panel instead of matching the grid's cramped size. `FEATURE_CARD_SIZE
 * _SOLO` keeps the SAME aspect ratio as the grid's `FEATURE_CARD_SIZE`
 * (~0.61) at roughly 1.5x the linear size — big enough to read as "the
 * subject," small enough to still leave the backdrop plate (`renderFeature
 * Backdrop`) visible around it.
 */
const FEATURE_CARD_SIZE_SOLO: Record<RunTemplatePlatform, { w: number; h: number }> = {
  desktop: { w: 210, h: 345 },
  mobile: { w: 195, h: 320 },
};
const FEATURE_GEM_CHIP_SIZE_SOLO: Record<RunTemplatePlatform, { w: number; h: number }> = {
  desktop: { w: 340, h: 76 },
  mobile: { w: 300, h: 68 },
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
 * Renders the resolved-outcome screen's ONE big feature visual (card/gem/
 * icon) into `rect`, backed by `renderFeatureBackdrop`. CENTERED (not
 * top-anchored — contrast the grids' own `layoutFeatureGrid` centering,
 * which this now matches) since `rect` (`runScreenTemplate.ts`'s
 * `reward.outcome.feature`) is generously sized on both platforms and a
 * centered subject reads as the deliberate focal point the identity band +
 * text column now point at, rather than a token pinned to the top of a
 * mostly-empty box.
 */
function renderBigFeature(scene: Phaser.Scene, platform: RunTemplatePlatform, feature: RunRewardFeature, iconKey: string, rect: Rect): void {
  if (feature.kind === 'card') {
    const ideal = FEATURE_CARD_SIZE_SOLO[platform];
    // Preserve the card's aspect ratio while clamping to the rect — shrink
    // by whichever axis is tighter rather than distorting the token.
    const scale = Math.min(1, rect.width / ideal.w, rect.height / ideal.h);
    const box = centeredBox(rect, ideal.w * scale, ideal.h * scale);
    renderFeatureBackdrop(scene, rect, box, UI.chip);
    new CardToken(scene, box.x + box.w / 2, box.y + box.h / 2, feature.skill, { width: box.w, height: box.h, side: 'left' });
    return;
  }
  if (feature.kind === 'gem') {
    const ideal = FEATURE_GEM_CHIP_SIZE_SOLO[platform];
    const scale = Math.min(1, rect.width / ideal.w, rect.height / ideal.h);
    const box = centeredBox(rect, ideal.w * scale, ideal.h * scale);
    const gem = feature.gem;
    renderFeatureBackdrop(scene, rect, box, GEM_RARITY_COLOR[gem.rarity]);
    const chip = scene.add.rectangle(box.x, box.y, box.w, box.h, UI.panelAlt, 0.9)
      .setOrigin(0, 0)
      .setStrokeStyle(1, GEM_RARITY_COLOR[gem.rarity], 0.9)
      .setInteractive({ useHandCursor: true });
    // Every internal offset is a fraction of the chip's OWN height, not a
    // fixed pixel tuned to the (smaller) grid chip size — so this scales
    // cleanly to whatever `ideal`/`rect` clamp down to, on either platform.
    const markerSize = box.h * 0.28;
    const markerCx = box.x + markerSize * 1.5;
    const textX = markerCx + markerSize * 1.3;
    const fontPx = Math.round(box.h * 0.28);
    scene.add.rectangle(markerCx, box.y + box.h / 2, markerSize, markerSize, GEM_RARITY_COLOR[gem.rarity]).setOrigin(0.5).setAngle(45);
    const gemName = scene.add.text(textX, box.y + box.h / 2, gem.name, {
      fontFamily: FONT.display, fontStyle: 'bold', fontSize: `${fontPx}px`, color: UI.text,
      wordWrap: { width: Math.max(0, box.x + box.w - textX - 10) },
    }).setOrigin(0, 0.5);
    auditTextBlock(gemName, { name: 'Run reward gem name', maxWidth: Math.max(0, box.x + box.w - textX - 10), maxHeight: box.h - 8, minFontSize: 9 });
    addHoverTipZone(scene, { x: box.x, y: box.y, w: box.w, h: box.h }, [gemHoverEntry(gem)]);
    return;
  }
  // `icon` — the fallback feature for gold/level/nothing/upgrade outcomes: a
  // bigger version of the same top-of-panel icon, so the slot is never blank.
  const size = Math.min(FEATURE_ICON_SIZE_SOLO[platform], rect.width, rect.height);
  const box = centeredBox(rect, size, size);
  renderFeatureBackdrop(scene, rect, box, UI.chip);
  addRunArt(scene, iconKey, { x: box.x, y: box.y, width: box.w, height: box.h }, 0.9);
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
function renderRewardText(scene: Phaser.Scene, platform: RunTemplatePlatform, rect: Rect, model: RunRewardViewModel, font: LayoutProfile['font']): void {
  const centered = platform === 'mobile';
  const align = centered ? 'center' : 'left';
  const originX = centered ? 0.5 : 0;
  const textX = centered ? rect.x + rect.width / 2 : rect.x;

  const headlineText = scene.add.text(textX, 0, model.headline, {
    fontFamily: FONT.display, fontStyle: 'bold', fontSize: `${font.title}px`, color: UI.text,
    align, wordWrap: { width: rect.width },
  }).setOrigin(originX, 0);
  auditTextBlock(headlineText, { name: 'Run reward headline', maxWidth: rect.width, maxHeight: rect.height, minFontSize: 12 });

  let detailText: Phaser.GameObjects.Text | undefined;
  if (model.detail) {
    detailText = scene.add.text(textX, 0, model.detail, {
      fontFamily: FONT.body, fontSize: `${font.small}px`, color: UI.textDim,
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
 * screen and the bonus-draft/upgrade-card pickers (all three own the WHOLE
 * panel, see `runScreenTemplate.ts`'s `reward` doc). */
function renderPanelBackground(scene: Phaser.Scene, panel: Rect): void {
  scene.add.rectangle(panel.x, panel.y, panel.width, panel.height, UI.panelMuted, 0.94)
    .setOrigin(0, 0)
    .setStrokeStyle(2, UI.chip, 0.6);
}

/**
 * THE reward-outcome renderer — one component shared by `DesktopRunEventScene`
 * and `MobileRunEventScene` (differing only in which platform's template they
 * pass in). Reads `template.contentSlots.reward.outcome`'s declared rects
 * (identity/text/feature, plus the shared `panel`/`buttons`) and places every
 * part into its rect — no cursor, no per-`EventOutcome`-kind layout branch.
 * Fits by construction: `feature` is sized to (and clamped by) its own rect.
 *
 * Task #41 density pass (2026-08-08): this used to stack a tiny centered
 * icon, a headline, an optional detail, and a modest top-anchored feature in
 * ONE column — correct geometry, but a single card/gem/icon in that shape
 * read as sparse (see `runScreenTemplate.ts`'s `reward.outcome` doc for the
 * full before/after rationale). Now: an `identity` row ties the reward back
 * to the event that produced it, `text` and `feature` share the panel's
 * width instead of one column wasting the other's share of it (DESKTOP:
 * side by side; MOBILE: stacked, but `feature` is now much bigger — see
 * `runScreenTemplate.ts`), and `feature` itself renders at a dedicated,
 * larger SOLO size with a spotlight backdrop (`renderBigFeature`) instead of
 * the grid's cramped ideal. The `panel`'s own size is UNCHANGED (still
 * `REWARD_PANEL_MAX_W`/`_H` on desktop, still content-filling on mobile) —
 * this is a composition change, not a resize.
 *
 * CONTINUE lives in the template's separately-reserved `buttons` row on
 * DESKTOP ONLY (`template.platform === 'desktop'`) — its primary go-forward
 * action sits in the HEADER (`runScreenTemplate`'s `actions` region,
 * top-right), physically far from this panel, so a bottom-anchored confirm
 * right under the content it confirms earns its own button there. On MOBILE
 * this used to ALSO draw a second CONTINUE into `buttons`, stacking two
 * identical buttons — the HUD's thumb-reachable footer (`renderRunHud`'s
 * `primary` role) already puts one right below it, calling the exact same
 * handler — a thumb's-width apart for no reason (task #33, 2026-08-07 fix).
 * Mobile's `buttons` rect is zero-height (`runScreenTemplate.ts`'s
 * `REWARD_BUTTON_H`), so skipping the draw here leaves no dead gap: the
 * panel already extends to fill the space that reservation would have cost.
 *
 * The "PICK ONE TO KEEP" bonus-draft picker and the "CHOOSE A CARD TO
 * UPGRADE" upgrade-card picker (`renderRunBonusDraftPicker`/
 * `renderRunUpgradeCardPicker` below) are this module's other two
 * reward-screen renderers. They deliberately keep the ORIGINAL flat
 * `icon`/`headline`/`feature` stacked shape (untouched by this pass) — a
 * 4-5 card grid already needs the wide, short `feature` row that shape
 * gives it, and reads full on its own; only their icon row picked up the
 * same `renderIdentityRow` treatment (see `renderPickHeader`) for
 * consistency. Neither draws a `buttons` CONTINUE on either platform
 * (picking a card IS the confirm action), so they needed no change there.
 */
export function renderRunRewardPanel(
  scene: Phaser.Scene,
  template: RunScreenTemplate,
  model: RunRewardViewModel,
  opts: { font: LayoutProfile['font']; eventTitle: string; onContinue: () => void },
): void {
  const { panel, buttons } = template.contentSlots.reward;
  const { identity, text, feature } = template.contentSlots.reward.outcome;

  renderPanelBackground(scene, panel);
  renderIdentityRow(scene, identity, model.iconKey, opts.eventTitle, opts.font, 'Run reward event identity');
  renderRewardText(scene, template.platform, text, model, opts.font);
  renderBigFeature(scene, template.platform, model.feature, model.iconKey, feature);
  // Desktop only — see the module doc above for why mobile does not repeat
  // the HUD footer's CONTINUE here.
  if (template.platform === 'desktop') {
    renderContinueButton(scene, buttons, opts.font, opts.onContinue);
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
  renderPanelBackground(scene, panel);
  renderIdentityRow(scene, icon, iconKey, eventTitle, font, `${auditName} identity`);
  const label = scene.add.text(headline.x + headline.width / 2, headline.y, title, {
    fontFamily: FONT.display, fontStyle: 'bold', fontSize: `${font.title}px`, color: UI.textAccent, align: 'center',
  }).setOrigin(0.5, 0);
  auditTextBlock(label, { name: auditName, maxWidth: headline.width - 64, maxHeight: headline.height, minFontSize: 10 });
}

/**
 * Attaches ONE cell's inspect affordance in a bonus-draft/upgrade-card
 * picker grid — desktop gets a mouse hover-tip (`cardHoverEntries`, the SAME
 * entries `DesktopDraftScene`'s own start-draft grid already shows); mobile
 * gets a small "ⓘ" corner badge (mirrors `MobileDraftScene`'s own badge)
 * that opens `renderCardDetailOverlay` instead of picking. Before this, a
 * mid-run, irreversible 5-wide pick carried strictly LESS information than
 * the reversible turn-zero draft — this is the one place both pickers below
 * pick up that parity, instead of each re-deriving it.
 *
 * The badge is a second, smaller interactive object drawn ON TOP of the
 * cell's own PICK hit-rectangle (`hit`) — Phaser dispatches only the topmost
 * hit-testing object under the pointer, so the badge's own `stopPropagation`
 * is what keeps the PICK handler underneath it silent on an inspect tap.
 * No-op on mobile if the caller has no `onInspect` wired (never true today,
 * but keeps this helper honest about being opt-in).
 */
function attachCellInspect(
  scene: Phaser.Scene,
  template: RunScreenTemplate,
  cell: Box,
  skill: SkillDef,
  onInspect: (() => void) | undefined,
): void {
  if (template.platform === 'desktop') {
    const hit = scene.add.rectangle(cell.x + cell.w / 2, cell.y + cell.h / 2, cell.w, cell.h, 0xffffff, 0);
    attachHoverTip(scene, hit, { x: cell.x, y: cell.y, w: cell.w, h: cell.h }, cardHoverEntries(skill));
    return;
  }
  if (!onInspect) return;
  const badgeSize = 22;
  const bx = cell.x + cell.w - badgeSize / 2 - 4;
  const by = cell.y + badgeSize / 2 + 4;
  const badge = scene.add.rectangle(bx, by, badgeSize, badgeSize, 0x0b1420, 0.85)
    .setOrigin(0.5).setStrokeStyle(1, UI.chip, 0.9).setInteractive({ useHandCursor: true });
  scene.add.text(bx, by, 'i', { fontFamily: FONT.display, fontStyle: 'bold', fontSize: '11px', color: UI.textAccent }).setOrigin(0.5);
  badge.on('pointerdown', (_p: Phaser.Input.Pointer, _lx: number, _ly: number, event: Phaser.Types.Input.EventData) => {
    event.stopPropagation();
    playSfx('uiClick');
    onInspect();
  });
}

/**
 * The "PICK ONE TO KEEP" bonus-draft picker — THE one implementation both
 * `DesktopRunEventScene` and `MobileRunEventScene` call for a resolved
 * `bonusDraft` outcome, in place of each scene's own hand-rolled row/column
 * math (which had already drifted — see the module doc above and
 * `runRewardGeometry.ts`'s doc comment). Uses `renderPickHeader` (panel/icon/
 * headline = "PICK ONE TO KEEP"), then fills `feature` with a
 * `layoutFeatureGrid` of `cards.length` card-sized cells —
 * `FEATURE_CARD_SIZE[platform]` is the same ideal card size the
 * upgrade-card picker's own grid uses, so the two pickers' cards read as the
 * same visual weight. No `detail` row (the picker never has one) — left
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
  cards: readonly DraftCard[],
  opts: {
    font: LayoutProfile['font'];
    eventTitle: string;
    onPick: (card: DraftCard) => void;
    inspectedIndex?: number | null;
    onInspect?: (index: number | null) => void;
  },
): void {
  renderPickHeader(scene, template, choiceArtKey('bonusDraft'), 'PICK ONE TO KEEP', opts.eventTitle, opts.font, 'Run reward bonus draft title');

  const { feature } = template.contentSlots.reward;
  const ideal = FEATURE_CARD_SIZE[template.platform];
  const cells = layoutFeatureGrid(feature, cards.length, ideal.w, ideal.h, GRID_GAP[template.platform]);
  let inspecting: SkillDef | undefined;
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
    attachCellInspect(scene, template, cell, shown, opts.onInspect ? () => opts.onInspect?.(i) : undefined);
    if (opts.inspectedIndex === i) inspecting = shown;
  });
  if (inspecting) {
    renderCardDetailOverlay(scene, inspecting, { font: opts.font, onClose: () => opts.onInspect?.(null) });
  }
}

/** Small label-strip height (per platform) reserved ABOVE each card in the
 * upgrade-card picker's grid, showing its "BRONZE → SILVER" tier jump —
 * folded straight into `layoutFeatureGrid`'s ideal HEIGHT (see
 * `renderRunUpgradeCardPicker` below), so it scales down by the exact same
 * uniform factor as the card sharing its cell and can never grow the grid
 * past what `layoutFeatureGrid` already fits inside `feature`. */
const UPGRADE_TIER_LABEL_H: Record<RunTemplatePlatform, number> = { desktop: 22, mobile: 18 };

/**
 * The "CHOOSE A CARD TO UPGRADE" picker — `upgradeCard`'s counterpart to
 * `renderRunBonusDraftPicker` above, called by both `DesktopRunEventScene`/
 * `MobileRunEventScene` for a resolved `upgradeCardPick` outcome
 * (`src/run/events.ts`'s deferred-pick shape mirrors `bonusDraft`'s: roll the
 * eligible set now, resolve which one on tap). Same `renderPickHeader` +
 * `layoutFeatureGrid` shape as the bonus-draft picker, with one addition:
 * unlike a fresh bonus-draft card, every option here is something the player
 * ALREADY owns, so the tier the tap commits to needs to be legible up front
 * rather than only implied — each cell reserves a small
 * `UPGRADE_TIER_LABEL_H` strip above its card for "FROM → TO", computed by
 * folding that strip into the grid's ideal HEIGHT (so `layoutFeatureGrid`'s
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
  options: readonly UpgradeCardOption[],
  opts: {
    font: LayoutProfile['font'];
    eventTitle: string;
    onPick: (option: UpgradeCardOption) => void;
    inspectedIndex?: number | null;
    onInspect?: (index: number | null) => void;
  },
): void {
  renderPickHeader(scene, template, choiceArtKey('upgradeCard'), 'CHOOSE A CARD TO UPGRADE', opts.eventTitle, opts.font, 'Run reward upgrade picker title');

  const { feature } = template.contentSlots.reward;
  const cardIdeal = FEATURE_CARD_SIZE[template.platform];
  const labelH = UPGRADE_TIER_LABEL_H[template.platform];
  const idealH = cardIdeal.h + labelH;
  const cells = layoutFeatureGrid(feature, options.length, cardIdeal.w, idealH, GRID_GAP[template.platform]);
  let inspecting: SkillDef | undefined;
  options.forEach((option, i) => {
    const cell = cells[i];
    const base = skillBook[option.skillId];
    if (!cell || !base) return;
    // `layoutFeatureGrid` scales width/height UNIFORMLY off the same ideal
    // aspect ratio, so this one ratio recovers exactly how much the label
    // strip itself shrank alongside the card sharing its cell.
    const scale = cell.h / idealH;
    const cellLabelH = labelH * scale;
    const cardH = cell.h - cellLabelH;
    const cx = cell.x + cell.w / 2;
    const shown = option.from === base.tier ? base : applyTier(base, option.from);

    const tierLabel = scene.add.text(cx, cell.y + cellLabelH / 2, `${option.from.toUpperCase()} → ${option.to.toUpperCase()}`, {
      fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${Math.max(8, Math.round(11 * scale))}px`, color: UI.textAccent, align: 'center',
    }).setOrigin(0.5);
    auditTextBlock(tierLabel, { name: 'Run reward upgrade tier label', maxWidth: cell.w, maxHeight: Math.max(1, cellLabelH), minFontSize: 7 });

    const cy = cell.y + cellLabelH + cardH / 2;
    new CardToken(scene, cx, cy, shown, { width: cell.w, height: cardH, side: 'left' });
    const hit = scene.add.rectangle(cx, cell.y + cell.h / 2, cell.w, cell.h, 0xffffff, 0).setInteractive({ useHandCursor: true });
    hit.on('pointerdown', () => { playSfx('uiClick'); opts.onPick(option); });
    // Inspect target is the CARD sub-rect (excludes the tier-label strip
    // above it) so a mobile badge sits at the card's own top-right corner,
    // matching every other card's badge position, rather than floating
    // above the card in the label strip.
    const cardCell: Box = { x: cell.x, y: cell.y + cellLabelH, w: cell.w, h: cardH };
    attachCellInspect(scene, template, cardCell, shown, opts.onInspect ? () => opts.onInspect?.(i) : undefined);
    if (opts.inspectedIndex === i) inspecting = shown;
  });
  if (inspecting) {
    renderCardDetailOverlay(scene, inspecting, { font: opts.font, onClose: () => opts.onInspect?.(null) });
  }
}
