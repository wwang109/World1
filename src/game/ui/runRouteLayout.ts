/**
 * Run route layout — WHICH depths the run map's trail draws, and how big each
 * one gets. Pure (no Phaser), unit-tested in `tests/game/runRouteLayout.test.ts`;
 * `RunRouteBoard.ts` draws whatever slot list this hands it.
 *
 * WHY THIS MODULE EXISTS. The trail used to draw EVERY depth in the run, so its
 * legibility was O(1/depth): the lane is a fixed number of pixels, the depth
 * count grows forever, and the cell each depth gets shrinks until `D1`..`D36`
 * are a vertical smear and the preview squares merge into a solid block. On
 * mobile at wave 10 that cell was 3.9px for a 9px label. It was never a mobile
 * bug — desktop hits the same wall a few waves later (76 depths at wave 20 is
 * 12.8px for a 10px label); the phone just got there first, and the band banner
 * taking the top of the map lane is what made it visible at wave 10 instead of
 * wave 20.
 *
 * So the trail WINDOWS. A depth never gets less than `MIN_CELL_PX` of the
 * primary axis; when the whole route no longer fits at that size, the board
 * shows a contiguous run of depths around the player and states, in a slot of
 * its own at each end, how many it is not showing. The window is biased
 * FORWARD (the player sits a third of the way down it) because the thing a
 * route map is read for is what is coming, not what is already cleared.
 *
 * This is a no-op wherever the route already fits — desktop at wave 10 draws
 * exactly the 36 columns it drew before, at exactly the same cell size — so
 * "window the trail" costs nothing until it is the only thing that helps.
 */

import type { RunState } from '../../run/runState';

export interface RunRouteColumnSnapshot {
  depth: number;
  wave: number;
  nodeCount: number;
  state: 'cleared' | 'current' | 'future';
}

export interface RunRouteSnapshot {
  columns: readonly RunRouteColumnSnapshot[];
  currentDepth: number;
  nextDepth: number;
}

export function snapshotRunRoute(run: Readonly<RunState>): RunRouteSnapshot {
  const actionableDepth = run.depth + 1;
  const columns = run.map.depths.slice(1).map((nodes, index) => {
    const depth = index + 1;
    return {
      depth,
      wave: nodes[0]?.wave ?? 1,
      nodeCount: nodes.length,
      state: depth < actionableDepth ? 'cleared' : depth === actionableDepth ? 'current' : 'future',
    } satisfies RunRouteColumnSnapshot;
  });

  return {
    columns,
    currentDepth: run.depth,
    nextDepth: run.depth + 1,
  };
}

/**
 * The floor on one depth's share of the primary axis, per platform.
 *
 * MOBILE (13): the trail runs vertically and the label is `profile.font.tiny`
 * = 9px, so consecutive `D34`/`D35`/`D36` rows need ~12px of pitch before the
 * glyph boxes touch. 13 leaves a hairline of air.
 * DESKTOP (26): the trail runs horizontally, so the constraint is WIDTH — `D36`
 * at 10px bold measures ~21px and a four-digit depth ~28px, and the future
 * column's preview square is 14px wide. 26 keeps neighbouring labels apart at
 * three digits and is deliberately just under the 27.1px that 36 depths get in
 * the current 1000px desktop lane: wave 10 is unwindowed, wave 11 is not.
 */
export const MIN_CELL_PX: Record<'desktop' | 'mobile', number> = { desktop: 26, mobile: 13 };

/**
 * How many CELLS a `'more'` marker spends, per platform — because the marker is
 * a SENTENCE ("+36 BEHIND") and a cell is sized for `D36`.
 *
 * On mobile the trail runs vertically, so the marker's long axis is the lane's
 * CROSS axis (it sits in the same left gutter the depth labels use) and one
 * cell of pitch is all it needs. On desktop the trail runs horizontally and the
 * marker is ~62px of text in a ~26px cell, so one cell puts it straight through
 * the neighbouring depth label — it takes three.
 */
export const MARKER_CELLS: Record<'desktop' | 'mobile', number> = { desktop: 3, mobile: 1 };

/** One drawn cell: a real depth, or the count of depths the window is hiding
 * off that end. Both occupy exactly one cell, so the board's arithmetic does
 * not care which it is holding. */
export type RunRouteSlot =
  | { kind: 'column'; column: RunRouteColumnSnapshot; span: 1; cell: number }
  | { kind: 'more'; side: 'before' | 'after'; hidden: number; span: number; cell: number };

export interface RunRouteLayout {
  /** Exactly what the board draws, in order along the primary axis. Each slot
   * knows its `cell` (offset in cells from the lane start) and its `span`, so
   * the board positions it without keeping a cursor of its own. */
  slots: readonly RunRouteSlot[];
  /** Primary-axis size of ONE cell. A depth is always one cell. */
  cellSize: number;
  /** True when at least one depth is not on screen. */
  windowed: boolean;
  /** Index of the first drawn depth in the FULL column list (0 when unwindowed). */
  firstDepthIndex: number;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** The index the window centres on: the depth the player may act on, or the
 * last cleared one when the map has run out ahead of the run. */
export function currentColumnIndex(columns: readonly RunRouteColumnSnapshot[]): number {
  const i = columns.findIndex((c) => c.state === 'current');
  return i >= 0 ? i : Math.max(0, columns.length - 1);
}

/**
 * Picks the visible run of depths. `capacity` is how many CELLS fit; a `'more'`
 * marker spends one of them, so the answer is solved for rather than assumed —
 * a window pinned to either end pays for only the one marker it needs, and gets
 * that cell back as a depth.
 */
function windowRange(total: number, current: number, capacity: number, markerSpan: number): { start: number; count: number } {
  if (capacity >= total) return { start: 0, count: total };
  // Bias FORWARD: the player sits one third in, so two thirds of the window is
  // the route still to walk.
  const place = (count: number): number => clamp(current - Math.floor((count - 1) / 3), 0, total - count);
  let count = Math.max(1, capacity);
  let start = place(count);
  // Two passes settle it: pass one learns which ends are truncated, pass two
  // re-solves with those markers paid for. A third pass can never change the
  // answer — shrinking the window cannot un-truncate an end that was truncated
  // by a LARGER one.
  for (let pass = 0; pass < 2; pass++) {
    const markers = (start > 0 ? 1 : 0) + (start + count < total ? 1 : 0);
    const want = Math.max(1, capacity - markers * markerSpan);
    if (want === count) break;
    count = want;
    start = place(count);
  }
  return { start, count };
}

/**
 * The trail's drawn cells for `columns` in `usablePrimary` px of primary axis.
 * `minCell` is the legibility floor — see `MIN_CELL_PX`.
 */
export function runRouteLayout(
  columns: readonly RunRouteColumnSnapshot[],
  usablePrimary: number,
  minCell: number,
  markerSpan = 1,
): RunRouteLayout {
  if (columns.length === 0) return { slots: [], cellSize: 0, windowed: false, firstDepthIndex: 0 };
  const capacity = Math.max(1, Math.floor(usablePrimary / minCell));
  const { start, count } = windowRange(columns.length, currentColumnIndex(columns), capacity, markerSpan);
  const slots: RunRouteSlot[] = [];
  let cell = 0;
  const marker = (side: 'before' | 'after', hidden: number): void => {
    slots.push({ kind: 'more', side, hidden, span: markerSpan, cell });
    cell += markerSpan;
  };
  if (start > 0) marker('before', start);
  for (let i = start; i < start + count; i++) {
    slots.push({ kind: 'column', column: columns[i]!, span: 1, cell });
    cell += 1;
  }
  const after = columns.length - (start + count);
  if (after > 0) marker('after', after);
  return {
    slots,
    cellSize: usablePrimary / cell,
    windowed: count < columns.length,
    firstDepthIndex: start,
  };
}

/** The label a `'more'` slot prints. Kept here so the words are unit-tested
 * next to the arithmetic that decides whether they appear at all. */
export function moreLabel(slot: { side: 'before' | 'after'; hidden: number }): string {
  return slot.side === 'before' ? `+${String(slot.hidden)} BEHIND` : `+${String(slot.hidden)} AHEAD`;
}
