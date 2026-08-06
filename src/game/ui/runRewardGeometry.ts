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
 * Ideal (never-exceeded) feature-visual size for a reward/bonus-draft CARD,
 * per platform. Lives here (moved 2026-08-06, was a same-named literal
 * inside `RunRewardPanel.ts`) so `RunRewardPanel.ts` and
 * `tests/game/runRewardGeometry.test.ts`'s "real reward feature rect"
 * checks share the ONE constant — drift between the renderer and the test
 * that's supposed to catch its regressions is no longer possible by
 * construction. `RunRewardPanel.ts`'s own doc comment (`renderFeature`)
 * explains WHY these are ~35% larger than the card's natural board-slot size;
 * this is just the value, kept next to the pure geometry that consumes it.
 */
export const FEATURE_CARD_SIZE: Record<RunTemplatePlatform, { w: number; h: number }> = {
  desktop: { w: 192, h: 315 },
  mobile: { w: 170, h: 279 },
};

/** Centers a `{w,h}` box (clamped to never exceed `rect`) inside `rect`,
 * returning its top-left — the one place that does this arithmetic, so every
 * feature variant (single card/gem/icon, and the bonus-draft grid below)
 * places itself the same way. */
export function centeredBox(rect: Rect, w: number, h: number): Box {
  const boxW = Math.min(w, rect.width);
  const boxH = Math.min(h, rect.height);
  return { x: rect.x + (rect.width - boxW) / 2, y: rect.y + (rect.height - boxH) / 2, w: boxW, h: boxH };
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
