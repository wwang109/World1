import Phaser from 'phaser';
import { playSfx } from '../audio/sfxSynth';
import type { SfxKey } from '../audio/sfxRecipes';
import type { LayoutProfile } from '../layoutProfile';
import type { RunNodeKind } from '../runStore';
import { FONT, UI } from '../theme';
import { auditControlLabel, auditTextBlock } from './controlLayoutAudit';
import { addRunArt } from './runArt';
import { appearPanel, attachButtonFeel, flashConfirm } from './motion';

export interface RunChoiceImage {
  textureKey: string;
}

export interface RunChoiceViewModel {
  nodeId: string;
  kind: RunNodeKind;
  title: string;
  detail: string;
  footer?: string;
  image?: RunChoiceImage;
  accent: number;
  enabled: boolean;
}

function trackObject(track: Phaser.GameObjects.GameObject[] | undefined, object: Phaser.GameObjects.GameObject): void {
  track?.push(object);
}

/** Rendered height of one line of text at `fontSize` — Phaser's line box runs
 * a little over the point size, and rounding down here is what silently eats
 * the detail row, so this deliberately over-estimates. */
function lineH(fontSize: number): number {
  return Math.ceil(fontSize * 1.4);
}

/** The panel's inner margin, derived from the profile's own type ladder —
 * shared by `runChoicePanelMinHeight` and the renderer so the two can never
 * disagree about how much room the stack actually needs. */
function panelInset(font: LayoutProfile['font']): number {
  return Math.max(14, font.small + 6);
}

/**
 * The SMALLEST `bounds.h` that fits this panel's whole stack:
 *
 *   inset · title · 5 · detail · 7 · bottom row · inset
 *
 * The BOTTOM ROW is the footer ("COST 2 GOLD" / "FREE", when the model has
 * one) on the left AND the SELECT/LOCKED affordance on the right, sharing one
 * baseline — so it is reserved unconditionally, footer or not. That is why
 * this no longer takes a `hasFooter` flag: the affordance is drawn on every
 * panel, so the row it sits in exists on every panel.
 *
 * Callers must size rows with this, not a hand-picked number. `detail` — the
 * "REWARD · ..." line, which is what the choice is actually FOR — is the row
 * the renderer reserves FIRST and the title is what yields to it, so a panel
 * given at least this height always prints its reward line in full. Given
 * LESS than this height, the title is squeezed (shrunk, then truncated) and
 * the reward line still survives; that is the deliberate priority order, not
 * a licence to under-size the row.
 *
 * HISTORY. The event choices shipped at h=84 needing ~99, so every
 * "REWARD · ..." hint rendered as the single letter "R…" — `auditTextBlock`
 * shrank it to the leftover height and ellipsized it rather than overflowing
 * visibly. Sizing rows with this function fixed that for a ONE-LINE title;
 * a title that WRAPPED (44+ characters at mobile's width) doubled
 * `title.height` and reopened exactly the same hole, because `detail` was
 * still laid out from the title downward with whatever was left. It is now
 * laid out from the BOTTOM up. Ask for the height instead of guessing it.
 */
export function runChoicePanelMinHeight(font: LayoutProfile['font']): number {
  const inset = panelInset(font);
  return inset * 2 + lineH(font.name) + 5 + lineH(font.small) + 7 + lineH(font.tiny);
}

/** Every measurement `renderRunChoicePanel` lays a panel out with. */
export interface RunChoicePanelLayout {
  /** Left edge of the text column (right of the rail + inset + art thumbnail). */
  contentX: number;
  /** Width of the text column. The TITLE and the DETAIL both wrap to this. */
  contentW: number;
  /** Width the bottom row's FOOTER may use — the column minus the room the
   * SELECT/LOCKED affordance holds at the far right of the same row. */
  footerW: number;
  /** Room held for the affordance itself. */
  actionReserve: number;
  /** The art thumbnail's edge length (0 when the model has no image). */
  imageSize: number;
  /** Top of the title block. */
  titleTop: number;
  /** All the height the title may have — see the module note below. */
  titleMaxH: number;
  /** The lowest the detail block may extend to. */
  detailFloor: number;
  /** One full line of detail text, the row this whole layout protects. */
  detailH: number;
  /** Top of the shared footer/affordance row. */
  bottomRowTop: number;
}

/**
 * THE PANEL'S STACK, RESERVED FROM THE BOTTOM UP — pure arithmetic, no Phaser,
 * so `tests/game/runChoicePanelLayout.test.ts` can hold it directly.
 *
 * Two decisions live here, and both are the 2026-08-30 fix:
 *
 * 1. `titleMaxH` is what is LEFT once the detail line and the bottom row have
 *    been taken out — the title's budget is derived from the reward line's,
 *    never the other way round. The renderer audits the title against this
 *    BEFORE it places anything below it, so a title that wraps shrinks itself
 *    and the "REWARD · ..." hint keeps its full line. Previously the title was
 *    laid out first with a `max(font.name * 2, bounds.h * 0.42)` allowance and
 *    `detail` got the remainder: a two-line title (any label of 44+ characters
 *    at mobile's width) left the remainder under one line, and the hint
 *    rendered as the single character "R…" on `crossroads_shrine/moon_rite`,
 *    `broken_axle/salvage_properly` and `two_ravens/walk_around` — all three
 *    of them the PAID option, so the player was told nothing about what the
 *    gold bought. Desktop, being wider, never wrapped and always showed it.
 *
 * 2. `contentW` is the TITLE's wrap width, not `contentW - actionReserve`.
 *    The affordance used to sit in the top-right corner beside the title,
 *    costing it 62 of mobile's 300px column; it now shares the bottom row with
 *    the (short, left-aligned) footer, so the title gets the whole column and
 *    all three of those labels fit on ONE line at full size.
 *
 * `bounds.h` under `runChoicePanelMinHeight(font)` is still handled, not
 * merely undefined: `titleMaxH` floors at `font.tiny` and the detail line is
 * still reserved, so a squeezed panel loses title, never reward.
 */
export function runChoicePanelLayout(
  bounds: { x: number; y: number; w: number; h: number },
  font: LayoutProfile['font'],
  hasImage: boolean,
): RunChoicePanelLayout {
  const railW = 6;
  const inset = panelInset(font);
  const imageSize = hasImage ? Math.min(46, Math.max(28, bounds.h - inset * 2)) : 0;
  const imageGap = imageSize > 0 ? 8 : 0;
  const contentX = bounds.x + railW + inset + imageSize + imageGap;
  const contentW = Math.max(0, bounds.w - railW - inset * 2 - imageSize - imageGap);
  const actionReserve = Math.max(56, font.tiny * 6 + 8);
  const bottomRowH = lineH(font.tiny);
  const detailH = lineH(font.small);
  const bottomRowTop = bounds.y + bounds.h - inset - bottomRowH;
  const detailFloor = bottomRowTop - 7;
  const titleTop = bounds.y + inset;
  return {
    contentX,
    contentW,
    footerW: Math.max(0, contentW - actionReserve),
    actionReserve,
    imageSize,
    titleTop,
    titleMaxH: Math.max(font.tiny, detailFloor - detailH - 5 - titleTop),
    detailFloor,
    detailH,
    bottomRowTop,
  };
}

export function renderRunChoicePanel(
  scene: Phaser.Scene,
  bounds: { x: number; y: number; w: number; h: number },
  model: RunChoiceViewModel,
  opts: {
    font: LayoutProfile['font'];
    onSelect: () => void;
    track?: Phaser.GameObjects.GameObject[];
    sfx?: SfxKey;
    /**
     * This panel's position in the list it belongs to. When set, the panel FADES
     * AND RISES into place, staggered by its index, so a screen of options
     * assembles instead of appearing all at once — the "new panel appearing" feel
     * (user, 2026-08-21). Omit it and the panel is drawn statically exactly as
     * before, so any caller that has not opted in is untouched.
     */
    appearIndex?: number;
  },
): void {
  const railW = 6;
  const inset = panelInset(opts.font);
  // EVERY measurement comes from the pure helper above — the renderer does no
  // vertical arithmetic of its own, so the test that holds the guarantee is
  // holding the same numbers that get drawn.
  const { contentX, contentW, footerW, actionReserve, imageSize, titleTop, titleMaxH, detailFloor, detailH } =
    runChoicePanelLayout(bounds, opts.font, model.image !== undefined);
  const imageGap = imageSize > 0 ? 8 : 0;
  const actionCopy = model.enabled ? 'SELECT' : 'LOCKED';
  const fill = model.enabled ? UI.panel : UI.panelMuted;
  const alpha = model.enabled ? 0.95 : 0.56;
  const panel = scene.add.rectangle(bounds.x, bounds.y, bounds.w, bounds.h, fill, alpha)
    .setOrigin(0, 0)
    .setStrokeStyle(2, model.accent, model.enabled ? 0.9 : 0.38);
  const rail = scene.add.rectangle(bounds.x, bounds.y, railW, bounds.h, model.accent, model.enabled ? 1 : 0.48).setOrigin(0, 0);
  const image = model.image
    ? addRunArt(scene, model.image.textureKey, {
      x: bounds.x + railW + inset,
      y: bounds.y + (bounds.h - imageSize) / 2,
      width: imageSize,
      height: imageSize,
    }, model.enabled ? 1 : 0.48)
    : undefined;
  // THE TITLE WRAPS TO THE FULL CONTENT COLUMN. It used to stop short by
  // `actionReserve` because SELECT sat in the top-right corner beside it,
  // which on a phone left the title 238px of a 300px column — enough to wrap
  // every 44+ character choice label in the catalog onto a second line and
  // starve the reward hint below it. The affordance now shares the bottom row
  // with the footer (which is short, and left-aligned), so the top of the
  // panel belongs to the title alone: all three offending labels
  // (`moon_rite` 44 chars, `salvage_properly` 47, `walk_around` 51) fit on
  // ONE line at full size in 300px.
  const title = scene.add.text(contentX, titleTop - 2, model.title, {
    fontFamily: FONT.display,
    fontStyle: 'bold',
    fontSize: `${opts.font.name}px`,
    color: model.enabled ? UI.text : UI.textSoft,
    wordWrap: { width: contentW },
  });
  // The title's audits run HERE, before anything below it is placed, because
  // `detailY` reads the title's FINAL height — a title that had to shrink or
  // truncate must have done so before the rest of the stack is measured
  // against it.
  auditControlLabel(panel, title, {
    name: `${model.nodeId} choice`,
    // The title's real box is the CONTENT COLUMN, not a symmetric inset: the
    // rail and the art thumbnail exist only on the LEFT. `auditControlLabel`
    // measures padding symmetrically, so this is the half-difference that
    // reproduces the content column's true width. Passing the left-hand
    // padding (as this did) fabricates an identical margin on the right that
    // is not there, and shrinks a title that actually fits.
    horizontalPadding: Math.max(0, (bounds.w - contentW) / 2),
    verticalPadding: inset,
    minFontSize: 8,
  });
  auditTextBlock(title, { name: `${model.nodeId} title`, maxWidth: contentW, maxHeight: titleMaxH, minFontSize: 8 });

  // BOTTOM ROW, RIGHT: the SELECT/LOCKED affordance, pinned opposite the
  // footer rather than above the title (see the title's own note above).
  const action = scene.add.text(bounds.x + bounds.w - inset, bounds.y + bounds.h - inset, actionCopy, {
    fontFamily: FONT.body,
    fontStyle: 'bold',
    fontSize: `${opts.font.tiny}px`,
    color: model.enabled ? UI.textAccent : UI.textSoft,
  }).setOrigin(1, 1);
  const detailY = titleTop + title.height + 5;
  // Guaranteed >= `detailH` by construction: `title.height <= titleMaxH`, and
  // `titleMaxH` was derived by subtracting `detailH` from this same floor.
  const detailMaxH = Math.max(detailH, detailFloor - detailY);
  const detail = scene.add.text(contentX, detailY, model.detail, {
    fontFamily: FONT.body,
    fontSize: `${opts.font.small}px`,
    color: model.enabled ? UI.textDim : UI.textSoft,
    wordWrap: { width: contentW },
    lineSpacing: 2,
  });
  // BOTTOM ROW, LEFT: the cost footer, wrapped to what the affordance on its
  // right leaves free (`footerW`) so the two can never run into each other.
  let footer: Phaser.GameObjects.Text | undefined;
  if (model.footer) {
    footer = scene.add.text(contentX, bounds.y + bounds.h - inset, model.footer, {
      fontFamily: FONT.body,
      fontStyle: 'bold',
      fontSize: `${opts.font.tiny}px`,
      color: model.enabled ? UI.textAccent : UI.textSoft,
      wordWrap: { width: footerW },
    }).setOrigin(0, 1);
  }

  trackObject(opts.track, panel);
  trackObject(opts.track, rail);
  if (image) trackObject(opts.track, image);
  trackObject(opts.track, title);
  trackObject(opts.track, action);
  trackObject(opts.track, detail);
  if (footer) trackObject(opts.track, footer);

  // (the title's two audits already ran above, before `detailY` was measured)
  auditTextBlock(action, { name: `${model.nodeId} ${actionCopy.toLowerCase()} affordance`, maxWidth: actionReserve, maxHeight: opts.font.tiny * 2, minFontSize: 8 });
  auditTextBlock(detail, { name: `${model.nodeId} detail`, maxWidth: contentW, maxHeight: detailMaxH, minFontSize: 8 });
  if (footer) auditTextBlock(footer, { name: `${model.nodeId} footer`, maxWidth: footerW, maxHeight: opts.font.tiny * 2, minFontSize: 8 });

  // FADE-AND-RISE, opt-in per caller (see `appearIndex`). Runs AFTER every
  // layout audit above has measured the final geometry — `appearPanel` only
  // touches `y`/`alpha` at runtime, so the audits still see the authored
  // positions and nothing about layout verification changes.
  if (opts.appearIndex !== undefined) {
    const parts = [panel, rail, title, action, detail, ...(image ? [image] : []), ...(footer ? [footer] : [])];
    appearPanel(scene, parts, { delay: opts.appearIndex * 45, stagger: 0 });
  }

  if (!model.enabled) return;
  panel.setInteractive({ useHandCursor: true });
  // An OPTION, not a button: the same hover/press feel, plus a confirmation
  // pulse on the panel that was actually chosen — several options look alike, so
  // the pulse is what tells the player which one the game took. `lift: 0`
  // because these panels are laid out from their own origin and a translate
  // would fight the row alignment; the colour and the pulse carry the feedback.
  attachButtonFeel(scene, panel, {
    fill,
    hover: UI.slotHover,
    alpha,
    lift: 0,
    onPress: () => {
      playSfx(opts.sfx ?? 'uiClick');
      // The RAIL flashes, not the whole plate: it is the panel's accent
      // element, so the confirmation reads without the plate itself blinking.
      flashConfirm(scene, rail);
      opts.onSelect();
    },
  });
}
