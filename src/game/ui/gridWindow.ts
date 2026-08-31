/**
 * SCROLL-GRID WINDOWING — which cells of a long scrollable grid are close
 * enough to the viewport to be worth drawing.
 *
 * THE DEFECT THIS CLOSES. Both wiki catalogues built EVERY entry up front and
 * left all of them on the display list forever. Measured 2026-08-31 on
 * `?scene=desktop-wiki` / `?scene=mwiki`, headless Chromium, `flush` = Phaser
 * WebGL batch flushes per frame (hardware-independent) and `floor` = the same
 * canvas with every object hidden:
 *
 *                       objects  Texts  masks  flush/frame   frame
 *   desktop DPR 2  was     6424   2841    665          671  7184ms  (floor 334ms)
 *                  now      865    382     90          123  1758ms
 *   desktop DPR 1  was     6425   2841    666          817  2288ms  (floor  41ms)
 *                  now      865    382     90          123   531ms
 *   mobile  DPR 2  was     2715   1123    364          221  1260ms  (floor  45ms)
 *                  now      320    131     45           40   370ms
 *   mobile  DPR 1  was     2747   1123    396          290   896ms  (floor  17ms)
 *                  now      320    131     45           40   108ms
 *
 * Phaser does NOT frustum-cull. `CameraManager.render` filters the display
 * list through `GameObject.willRender(camera)`, which looks at `visible`,
 * `alpha` and the camera filter — never at bounds. A card scrolled a thousand
 * pixels off the bottom of a masked viewport was therefore submitted to the
 * batch in full every frame: its own geometry mask pushed (a batch flush plus
 * a stencil pass), its ~16 children drawn, and each of its Texts is its own
 * canvas-backed texture, so each one broke the batch again. The pixels were
 * then thrown away by the stencil test.
 *
 * The defect is PRE-EXISTING and NOT DPR-specific — both platforms were
 * already sub-1-FPS at DPR 1. DPR 2 makes it ~3x worse (four times the pixels
 * per stencil pass), which is only why it was noticed at retina first.
 *
 * `visible` is the one thing `willRender` DOES look at, so windowing is the
 * whole fix: a scene keeps the cells that overlap the viewport (plus a couple
 * of rows of overscan so a fast drag never shows a hole) and hides the rest.
 * Construction is lazy on top of that, which is what takes the 72 card-art
 * textures the wiki used to resolve on entry (~200 MB VRAM, no eviction
 * anywhere) down to the 9 the first screen actually shows — and the whole
 * catalogue walked end to end still resolves only 29.
 *
 * The frame cost also stops depending on WHERE the reader is: the desktop
 * grid scrolled to the last card drew 6329 objects before this and draws 671
 * after, because the other 2154 it has built along the way are hidden.
 *
 * Pure module — no Phaser import — so `tests/game/gridWindow.test.ts` drives
 * the arithmetic the scenes ship rather than a retyped copy of it.
 */

/** A uniform grid scrolled vertically inside a fixed-height viewport. */
export interface GridWindowInput {
  /** Total number of cells in the grid. */
  count: number;
  /** Cells per row. */
  columns: number;
  /** Distance from one row's top edge to the next row's top edge. */
  rowStride: number;
  /** Height of ONE cell — `rowStride` minus the gap between rows. */
  cellH: number;
  /** Height of the scrolling viewport, in the same units. */
  viewportHeight: number;
  /**
   * The scenes' scroll offset: `0` at the top of the content and NEGATIVE as
   * the content moves up, which is the sign convention both wiki scenes (and
   * `Phaser.Math.Clamp(scroll, -maxScroll, 0)`) already use.
   */
  scrollY: number;
  /** Rows kept live ABOVE and BELOW the viewport. Default 2. */
  overscanRows?: number;
}

/** The inclusive index/row span a scene should keep live. Empty grid → `count: 0`. */
export interface GridWindow {
  firstRow: number;
  lastRow: number;
  firstIndex: number;
  lastIndex: number;
  /** Number of cells in the window — `0` when the grid itself is empty. */
  count: number;
}

const EMPTY: GridWindow = { firstRow: 0, lastRow: -1, firstIndex: 0, lastIndex: -1, count: 0 };

/** Rows the grid has in total, for `count` cells over `columns` columns. */
export function gridRowCount(count: number, columns: number): number {
  if (count <= 0 || columns <= 0) return 0;
  return Math.ceil(count / columns);
}

/**
 * The inclusive cell span to keep live for the current scroll offset.
 *
 * A row is IN when its `[rowTop, rowTop + cellH)` band overlaps the viewport's
 * `[-scrollY, -scrollY + viewportHeight)` band, which is the only condition
 * that matters — the row gap is deliberately NOT part of a row's band, so a
 * grid scrolled exactly into a gutter keeps the two rows either side of it and
 * not a third.
 */
export function gridWindow(input: GridWindowInput): GridWindow {
  const { count, columns, rowStride, cellH, viewportHeight, scrollY } = input;
  const rows = gridRowCount(count, columns);
  if (rows === 0 || rowStride <= 0 || viewportHeight <= 0) return EMPTY;
  const overscan = Math.max(0, Math.floor(input.overscanRows ?? 2));

  const top = -scrollY;
  const bottom = top + viewportHeight;
  // First row whose BOTTOM is past the viewport top, last row whose TOP is
  // before the viewport bottom.
  const firstRow = Math.max(0, Math.floor((top - cellH) / rowStride) + 1 - overscan);
  const lastRow = Math.min(rows - 1, Math.ceil(bottom / rowStride) - 1 + overscan);
  if (lastRow < firstRow) return EMPTY;

  const firstIndex = firstRow * columns;
  const lastIndex = Math.min(count - 1, lastRow * columns + columns - 1);
  return { firstRow, lastRow, firstIndex, lastIndex, count: lastIndex - firstIndex + 1 };
}

/** True when cell `index` is inside `window`. */
export function inGridWindow(window: GridWindow, index: number): boolean {
  return window.count > 0 && index >= window.firstIndex && index <= window.lastIndex;
}
