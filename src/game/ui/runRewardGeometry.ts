import { DESKTOP_PROFILE, MOBILE_PROFILE } from '../layoutProfile';
import type { Rect, RunScreenTemplate, RunTemplatePlatform } from './runScreenTemplate';

/** Fit every event state inside the existing EVENT OUTCOME pane. The story
 * and outer pane are owned by the scene and never replaced by reward chrome. */
export function eventOutcomePaneTemplate(
  template: RunScreenTemplate,
  kind: 'icon' | 'gem' | 'card' | 'picker',
  panel: Rect,
  header: Rect,
): RunScreenTemplate & { eventOutcomePane: { header: Rect } } {
  const compact = template.platform === 'mobile';
  const pad = compact ? 12 : 18;
  const gap = compact ? 8 : 12;
  const innerX = panel.x + pad;
  const innerW = panel.width - pad * 2;
  const bodyY = header.y + header.height + gap;
  const availableH = Math.max(0, panel.y + panel.height - pad - bodyY);
  const terminal = kind !== 'picker';
  const bodyH = terminal ? Math.min(availableH - 52, kind === 'icon' ? 160 : kind === 'gem' ? 190 : 350) : availableH;
  const body = { x: innerX, y: bodyY, width: innerW, height: Math.max(0, bodyH) };
  const buttons = { x: innerX, y: bodyY + body.height + (terminal ? 12 : 0), width: innerW, height: terminal ? 40 : 0 };
  const headline = { ...body, height: Math.min(36, body.height) };
  // The merge price can borrow from feature as before, but a modest detail
  // band keeps all three spent rows and a real candidate/pager reachable.
  const detail = { ...body, y: bodyY + 44, height: terminal ? 0 : 56 };
  const feature = { ...body, y: detail.y + detail.height, height: Math.max(0, body.height - 44 - detail.height) };
  const stacked = compact && kind !== 'icon';
  const visualW = stacked ? innerW : Math.min(kind === 'card' ? 220 : kind === 'gem' ? 310 : 160, innerW * 0.42);
  const outcomeFeature = { x: innerX, y: bodyY, width: visualW, height: stacked ? Math.max(0, body.height - 76) : body.height };
  const outcomeText = stacked
    ? { x: innerX, y: outcomeFeature.y + outcomeFeature.height + 8, width: innerW, height: 68 }
    : { x: innerX + visualW + 16, y: bodyY, width: innerW - visualW - 16, height: body.height };
  return {
    ...template, eventOutcomePane: { header },
    contentSlots: { ...template.contentSlots, reward: {
      panel, gap, buttons, icon: { ...header, height: 0 }, headline, detail, feature,
      outcome: { identity: { ...header, height: 0 }, text: outcomeText, feature: outcomeFeature },
    } },
  };
}
/**
 * Pure geometry for the reward template's `feature` slot — shared by
 * `RunRewardPanel.ts`'s single card/gem/icon feature AND its bonus-draft
 * "PICK ONE TO KEEP" grid, so both go through the exact same clamp-and-place
 * math instead of each caller hand-rolling its own row/column arithmetic.
 * That hand-rolling is the bug this module fixes: before it existed,
 * `DesktopRunEventScene`/`MobileRunEventScene` each wrote their OWN bonus-
 * draft layout off the same `feature` rect, and the two had already
 * drifted — desktop centered a single row inside `feature`, mobile
 * top-anchored a stack of full-width rows, leaving unused space at the
 * bottom on mobile only. No Phaser import — pure module, unit tested in
 * tests/game/runRewardGeometry.test.ts.
 */

export interface Box { x: number; y: number; w: number; h: number }
export type FeatureGridVerticalAlignment = 'center' | 'top';
export type RewardPickerKind = 'bonusDraft' | 'upgradeCard' | 'gemChoice' | 'sellGem' | 'mergeSpent' | 'mergeCandidates';

export interface RewardPickerWindow {
  /** Visible cell boxes for this page, in local page order. */
  cells: Box[];
  page: number;
  pageCount: number;
  pageSize: number;
  /** Inclusive first / exclusive last index into the caller's full options. */
  startIndex: number;
  endIndex: number;
  canPrevious: boolean;
  canNext: boolean;
  /** Bottom navigation band, present only when more than one page is needed. */
  pager: null | { previous: Box; indicator: Box; next: Box };
}

/** Minimum readable short-axis size for each reward-row family. Card rows stay
 * above `CardToken`'s 42px compact threshold; gem rows retain enough room for
 * name, rarity/kind, and effect; the non-interactive merge-spent chips can be
 * slightly shorter because they carry only two lines. */
const REWARD_PICKER_MIN_ROW_H: Record<RewardPickerKind, number> = {
  bonusDraft: 56,
  upgradeCard: 64,
  gemChoice: 64,
  sellGem: 64,
  mergeSpent: 32,
  mergeCandidates: 56,
};

/** Pager controls use the platform's real tap floor, not a retyped pixel
 * value, while the geometry stays pure and independently testable. */
const REWARD_PICKER_PAGER_H: Record<RunTemplatePlatform, number> = {
  desktop: DESKTOP_PROFILE.minTap,
  mobile: MOBILE_PROFILE.minTap,
};

/**
 * Height of ONE reward/picker CARD ROW, per platform — the reward surfaces'
 * half of the project's single card-list shape.
 *
 * WAS a PORTRAIT `FEATURE_CARD_SIZE` (`142x233` desktop / `126x207` mobile,
 * i.e. exactly `FantasyCardTemplateV2`'s own `420x690` aspect) fed to
 * `layoutFeatureGrid` as a two-dimensional ideal. That was the defect
 * (2026-08-28): the cell was cut to the FANTASY CARD's shape but filled with a
 * `CardToken`, which is a ROW component — every region `cardTokenSpec.ts`
 * places is either edge-anchored or sits at a FIXED `dy` around the token's
 * vertical centre (`name -14`, `effects +1`, `affinity +15`), so stretching one
 * to portrait does not make a portrait card, it makes a row with ~170px of
 * dead art above and below a 40px text block. On mobile it also wrapped: three
 * candidates became "2 + 1 orphan", and the picker's own ⓘ badge landed on top
 * of the token's `×N SLOTS` label in the shared top-inward corner.
 *
 * A `CardToken` is now given the shape it was built for on every reward
 * surface, which is the shape the player already reads everywhere else a LIST
 * of cards appears — deck (mobile `192x60`, desktop `620x43`), bag, battle/prep
 * board, shop shelf (mobile `392x92`, desktop `260x130`) and the turn-zero
 * draft (mobile `392x80`). Before this the three reward pickers were the ONLY
 * portrait `CardToken` callers in the game.
 *
 * Only the HEIGHT is a constant: a row's ideal WIDTH is its container's own
 * width (see `cardRowIdeal`), so a picker can never wrap or orphan a card by
 * construction — one card, one row, however many there are.
 *
 * The numbers are derived from what has to fit UNSCALED, the same rule the
 * old portrait ideal followed:
 *   mobile (92)  — the mobile shop shelf's own card row height, the closest
 *                  analogue (a card being offered, full width). Five rows —
 *                  `bonusDraft`, the widest picker — need `5*92 + 4*gap(8) =
 *                  492` of the real `feature` rect's 544.
 *   desktop (72) — five rows need `5*72 + 4*gap(12) = 408` of the real
 *                  `feature` rect's 422, which is what `runScreenTemplate.ts`'s
 *                  re-derived `REWARD_PANEL_MAX_H` now reserves. Well clear of
 *                  `cardTokenSpec.ts`'s `TOKEN_COMPACT_HEIGHT` (42), below
 *                  which a token drops to its one-line COMPACT variant and the
 *                  card face loses its effects and affinity lines.
 */
export const FEATURE_CARD_ROW_H: Record<RunTemplatePlatform, number> = {
  desktop: 72,
  mobile: 92,
};

/**
 * THE full-width ROW ideal — the one definition of "one item, one row" every
 * reward/picker band uses (card rows, the merge picker's spent chips, the gem
 * pickers' chips). `height` tall, as wide as `rect` itself.
 *
 * Feed it straight to `layoutFeatureGrid`: an ideal width equal to the rect's
 * own width makes that function pick exactly ONE column
 * (`maxCols = floor((w+gap)/(w+gap)) = 1`), so N items always lay out as N
 * full-width rows, top to bottom, with its existing placement / containment /
 * non-overlap guarantees unchanged — and, crucially, with no wrap and so no
 * short last row centred under the others. If more rows are asked for than
 * `rect` can hold at `height`, its uniform scale shrinks them together (aspect
 * preserved, so a short row stays a row) rather than wrapping into a second
 * column.
 */
export function rowIdeal(rect: Rect, height: number): { w: number; h: number } {
  return { w: rect.width, h: height };
}

/** `rowIdeal` at the platform's CARD row height — what the three card pickers
 * (`renderRunBonusDraftPicker` / `renderRunUpgradeCardPicker` /
 * `renderRunMergeCardsPicker`) size their cells with. */
export function cardRowIdeal(rect: Rect, platform: RunTemplatePlatform): { w: number; h: number } {
  return rowIdeal(rect, FEATURE_CARD_ROW_H[platform]);
}

/** Centers a `{w,h}` box (clamped to never exceed `rect`) inside `rect`,
 * returning its top-left — the shared arithmetic used by resolved feature
 * visuals and by `layoutFeatureGrid`'s default alignment. */
export function centeredBox(rect: Rect, w: number, h: number): Box {
  const boxW = Math.min(w, rect.width);
  const boxH = Math.min(h, rect.height);
  return { x: rect.x + (rect.width - boxW) / 2, y: rect.y + (rect.height - boxH) / 2, w: boxW, h: boxH };
}

/**
 * Like `centeredBox` (clamped to never exceed `rect`), but anchored at the
 * TOP of `rect` — still horizontally centered — instead of vertically
 * centered. Kept as the standalone-box counterpart to
 * `layoutFeatureGrid(..., 'top')`.
 */
export function topAnchoredBox(rect: Rect, w: number, h: number): Box {
  const boxW = Math.min(w, rect.width);
  const boxH = Math.min(h, rect.height);
  return { x: rect.x + (rect.width - boxW) / 2, y: rect.y, w: boxW, h: boxH };
}

/**
 * Lays out `count` same-shaped `idealW x idealH` boxes into `rect`:
 *
 *  1. Picks as many COLUMNS as fit side-by-side at the ideal size (never more
 *     than `count`) — a wide `rect` (desktop's `feature`, plenty of spare
 *     width) puts every item on one row; a narrow one (mobile's `feature`)
 *     wraps into fewer columns and more rows instead of squeezing every item
 *     into an unreadably thin sliver.
 *  2. Scales every box down UNIFORMLY (never up, never distorting the aspect
 *     ratio) only if that column/row count would still overflow `rect`.
 *  3. Centers the WHOLE grid inside `rect` by default (via `centeredBox`), or
 *     top-aligns it when explicitly requested; either way it then centers
 *     any short last row inside the grid's own width — 5 items in 2 columns
 *     reads as "2, 2, 1 centered", never "2, 2, 1 flush left".
 *
 * Returns one box per item, in the same order as the input count (row-major:
 * left-to-right, then top-to-bottom).
 */
export function layoutFeatureGrid(
  rect: Rect,
  count: number,
  idealW: number,
  idealH: number,
  gap: number,
  verticalAlignment: FeatureGridVerticalAlignment = 'center',
): Box[] {
  if (count <= 0 || idealW <= 0 || idealH <= 0) return [];
  const maxCols = Math.max(1, Math.floor((rect.width + gap) / (idealW + gap)));
  const cols = Math.min(count, maxCols);
  const rows = Math.ceil(count / cols);
  // `cols` is bounded against `rect.width` via `maxCols` above, so its scale
  // numerator can never go negative. `rows` has no equivalent bound against
  // `rect.height` (it's just `count` divided across whatever `cols` width
  // allowed), so the height-side numerator CAN go negative when enough rows'
  // worth of `gap` alone exceeds `rect.height`. Clamp to 0 rather than let
  // that flow through as a negative scale — a zero-size box is still a valid
  // (if degenerate) box, never a negative-size one.
  const scale = Math.max(
    0,
    Math.min(
      1,
      (rect.width - gap * (cols - 1)) / (cols * idealW),
      (rect.height - gap * (rows - 1)) / (rows * idealH),
    ),
  );
  const cellW = idealW * scale;
  const cellH = idealH * scale;
  const gridW = cols * cellW + gap * (cols - 1);
  const gridH = rows * cellH + gap * (rows - 1);
  const grid = verticalAlignment === 'top'
    ? topAnchoredBox(rect, gridW, gridH)
    : centeredBox(rect, gridW, gridH);

  const boxes: Box[] = [];
  for (let i = 0; i < count; i++) {
    const row = Math.floor(i / cols);
    const colInRow = i - row * cols;
    const itemsInRow = row === rows - 1 ? count - row * cols : cols;
    const rowW = itemsInRow * cellW + gap * (itemsInRow - 1);
    const rowStartX = grid.x + (grid.w - rowW) / 2;
    boxes.push({
      x: rowStartX + colInRow * (cellW + gap),
      y: grid.y + row * (cellH + gap),
      w: cellW,
      h: cellH,
    });
  }
  return boxes;
}

function boxFitsRect(box: Box, rect: Rect): boolean {
  const epsilon = 1e-6;
  return box.x >= rect.x - epsilon
    && box.y >= rect.y - epsilon
    && box.x + box.w <= rect.x + rect.width + epsilon
    && box.y + box.h <= rect.y + rect.height + epsilon;
}

function usablePickerCells(cells: readonly Box[], rect: Rect, minRowH: number): boolean {
  return cells.length > 0 && cells.every((cell) => cell.h >= minRowH && boxFitsRect(cell, rect));
}

/**
 * The one layout seam for every interactive reward picker.
 *
 * Sparse options retain the existing full feature rect and are always
 * top-aligned. If the full set would shrink below its row family's readable
 * floor (or leave the rect), the helper reserves a platform-minimum bottom pager and
 * returns only the bounded, authored-order page that fits above it. The
 * caller owns `requestedPage`; this function clamps it and never reorders,
 * duplicates, or drops an option.
 */
export function layoutRewardPickerWindow(
  kind: RewardPickerKind,
  platform: RunTemplatePlatform,
  rect: Rect,
  count: number,
  idealW: number,
  idealH: number,
  gap: number,
  requestedPage: number,
): RewardPickerWindow {
  if (count <= 0 || idealW <= 0 || idealH <= 0) {
    return {
      cells: [], page: 0, pageCount: 1, pageSize: 0, startIndex: 0, endIndex: 0,
      canPrevious: false, canNext: false, pager: null,
    };
  }

  const minRowH = REWARD_PICKER_MIN_ROW_H[kind];
  const allCells = layoutFeatureGrid(rect, count, idealW, idealH, gap, 'top');
  if (usablePickerCells(allCells, rect, minRowH)) {
    return {
      cells: allCells, page: 0, pageCount: 1, pageSize: count,
      startIndex: 0, endIndex: count, canPrevious: false, canNext: false, pager: null,
    };
  }

  const pagerH = Math.min(REWARD_PICKER_PAGER_H[platform], Math.max(0, rect.height));
  const pagerY = rect.y + rect.height - pagerH;
  const itemsRect: Rect = {
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: Math.max(0, pagerY - gap - rect.y),
  };

  // Start from the largest row count the minimum-height arithmetic permits,
  // then verify with the real uniform-scaling function. The decrement is
  // important when a future caller uses an ideal narrower than the rect and
  // `layoutFeatureGrid` chooses multiple columns.
  let pageSize = Math.max(1, Math.min(count, Math.floor((itemsRect.height + gap) / (minRowH + gap))));
  while (pageSize > 1) {
    const candidate = layoutFeatureGrid(itemsRect, pageSize, idealW, idealH, gap, 'top');
    if (usablePickerCells(candidate, itemsRect, minRowH)) break;
    pageSize -= 1;
  }

  const pageCount = Math.max(1, Math.ceil(count / pageSize));
  const finitePage = Number.isFinite(requestedPage) ? Math.floor(requestedPage) : 0;
  const page = Math.max(0, Math.min(pageCount - 1, finitePage));
  const startIndex = page * pageSize;
  const endIndex = Math.min(count, startIndex + pageSize);
  const cells = layoutFeatureGrid(itemsRect, endIndex - startIndex, idealW, idealH, gap, 'top');
  const slotW = Math.max(0, (rect.width - gap * 2) / 3);
  const pager = {
    previous: { x: rect.x, y: pagerY, w: slotW, h: pagerH },
    indicator: { x: rect.x + slotW + gap, y: pagerY, w: slotW, h: pagerH },
    next: { x: rect.x + (slotW + gap) * 2, y: pagerY, w: slotW, h: pagerH },
  };

  return {
    cells,
    page,
    pageCount,
    pageSize,
    startIndex,
    endIndex,
    canPrevious: page > 0,
    canNext: page < pageCount - 1,
    pager,
  };
}
