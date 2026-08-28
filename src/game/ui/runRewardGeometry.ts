import type { Rect, RunTemplatePlatform } from './runScreenTemplate';

/**
 * Pure geometry for the reward template's `feature` slot — shared by
 * `RunRewardPanel.ts`'s single card/gem/icon feature AND its bonus-draft
 * "PICK ONE TO KEEP" grid, so both go through the exact same clamp-and-center
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
 * full-width rows, top to bottom, with its existing centering / containment /
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
 * returning its top-left — the one place that does this arithmetic, so every
 * feature variant (the bonus-draft grid below, and — via `layoutFeatureGrid`
 * — its own row/grid centering) places itself the same way. */
export function centeredBox(rect: Rect, w: number, h: number): Box {
  const boxW = Math.min(w, rect.width);
  const boxH = Math.min(h, rect.height);
  return { x: rect.x + (rect.width - boxW) / 2, y: rect.y + (rect.height - boxH) / 2, w: boxW, h: boxH };
}

/**
 * Like `centeredBox` (clamped to never exceed `rect`), but anchored at the
 * TOP of `rect` — still horizontally centered — instead of vertically
 * centered. Used for a SINGLE reward feature (card/gem/icon,
 * `RunRewardPanel.ts`'s `renderFeature`) so it sits close under the
 * headline/detail stack instead of floating in the middle of whatever
 * height `feature` happens to have. That distinction matters because
 * `feature`'s height isn't always tight: mobile's stays generous even after
 * the redesign above, since it also has to fit the bonus-draft grid's
 * wrapped rows (see `runScreenTemplate.ts`'s doc comment) — top-anchoring
 * the single-item case keeps IT from drifting into that leftover room
 * without taking any room away from the grid, which keeps using
 * `centeredBox`/`layoutFeatureGrid`'s own centering, unchanged.
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
 *  3. Centers the WHOLE grid inside `rect` (via `centeredBox`), then centers
 *     any short last row inside the grid's own width — 5 items in 2 columns
 *     reads as "2, 2, 1 centered", never "2, 2, 1 flush left".
 *
 * Returns one box per item, in the same order as the input count (row-major:
 * left-to-right, then top-to-bottom).
 */
export function layoutFeatureGrid(rect: Rect, count: number, idealW: number, idealH: number, gap: number): Box[] {
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
  const grid = centeredBox(rect, gridW, gridH);

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
