import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({ default: { Scene: class {} } }));
import {
  MARKER_CELLS,
  MIN_CELL_PX,
  currentColumnIndex,
  moreLabel,
  runRouteLayout,
  snapshotRunRoute,
  type RunRouteColumnSnapshot,
} from '../../src/game/ui/runRouteLayout';
import { expeditionRouteTrackModel } from '../../src/game/ui/RunRouteBoard';
import { createRun, type RunState } from '../../src/run/runState';
import { ensureWavesThrough } from '../../src/run/runMap';

/**
 * THE TRAIL'S LEGIBILITY AT DEPTH.
 *
 * The run map used to draw EVERY depth, so one depth's share of the lane was
 * (lane / depths) and shrank forever. At wave 10 on a phone that was 3.9px for
 * a 9px label — `D1`..`D36` as a vertical smear — and desktop hits the same
 * wall a handful of waves later. Nothing tested it, because the arithmetic
 * lived inside a Phaser module; the bug was found by looking at a screenshot.
 *
 * These tests hold the floor: whatever the depth count, a DRAWN depth gets at
 * least `MIN_CELL_PX`, and what is not drawn is stated rather than dropped.
 */

/** A run standing at the first depth of `wave` — the map generated exactly as
 * the run generates it (`ensureWavesThrough`), the player placed at the depth
 * they would be at. This is the state both scenes hand the board. */
function runAtWave(seed: number, wave: number): RunState {
  const run = createRun(seed);
  const map = ensureWavesThrough(run.map, wave);
  const first = map.depths.findIndex((nodes, depth) => depth > 0 && (nodes[0]?.wave ?? 0) === wave);
  if (first < 0) throw new Error(`map for seed ${String(seed)} never reaches wave ${String(wave)}`);
  return { ...run, map, depth: first - 1 };
}

function columns(count: number, current: number, perWave = 4): RunRouteColumnSnapshot[] {
  return Array.from({ length: count }, (_, i) => ({
    depth: i + 1,
    wave: Math.floor(i / perWave) + 1,
    nodeCount: 3,
    state: i < current ? 'cleared' : i === current ? 'current' : 'future',
  }));
}

describe('runRouteLayout: a depth is never drawn smaller than it can be read', () => {
  it('draws EVERY depth, unchanged, while they all fit', () => {
    const all = columns(12, 5);
    const layout = runRouteLayout(all, 1000, MIN_CELL_PX.desktop);
    expect(layout.windowed).toBe(false);
    expect(layout.slots).toHaveLength(12);
    expect(layout.slots.every((s) => s.kind === 'column')).toBe(true);
    // The pre-window board computed exactly this. Windowing costs nothing until
    // it is the only thing that helps.
    expect(layout.cellSize).toBe(1000 / 12);
  });

  it('never lets a drawn cell fall under the floor, at any depth count', () => {
    for (const total of [1, 2, 5, 12, 36, 60, 120, 400]) {
      for (const [mode, usable] of [['desktop', 976] as const, ['mobile', 217] as const]) {
        const layout = runRouteLayout(columns(total, Math.floor(total / 2)), usable, MIN_CELL_PX[mode]);
        expect(layout.cellSize).toBeGreaterThanOrEqual(MIN_CELL_PX[mode]);
        expect(layout.slots.length).toBeGreaterThan(0);
      }
    }
  });

  it('keeps the player on screen wherever they are in the run', () => {
    const total = 80;
    for (let current = 0; current < total; current++) {
      const layout = runRouteLayout(columns(total, current), 217, MIN_CELL_PX.mobile);
      const drawn = layout.slots.flatMap((s) => (s.kind === 'column' ? [s.column] : []));
      expect(drawn.some((c) => c.state === 'current')).toBe(true);
    }
  });

  it('looks FORWARD: two thirds of the window is route still to walk', () => {
    const total = 80;
    const layout = runRouteLayout(columns(total, 40), 217, MIN_CELL_PX.mobile);
    const drawn = layout.slots.flatMap((s) => (s.kind === 'column' ? [s.column] : []));
    const at = drawn.findIndex((c) => c.state === 'current');
    expect(at).toBeGreaterThanOrEqual(0);
    expect(drawn.length - 1 - at).toBeGreaterThan(at);
  });

  it('STATES what it is hiding rather than starting at D14 in silence', () => {
    const layout = runRouteLayout(columns(80, 40), 217, MIN_CELL_PX.mobile);
    expect(layout.windowed).toBe(true);
    const markers = layout.slots.flatMap((s) => (s.kind === 'more' ? [s] : []));
    expect(markers).toHaveLength(2);
    expect(markers[0]?.side).toBe('before');
    expect(markers[1]?.side).toBe('after');
    const drawn = layout.slots.filter((s) => s.kind === 'column').length;
    expect((markers[0]?.hidden ?? 0) + drawn + (markers[1]?.hidden ?? 0)).toBe(80);
    expect(moreLabel(markers[0]!)).toBe(`+${String(markers[0]?.hidden)} BEHIND`);
    expect(moreLabel(markers[1]!)).toBe(`+${String(markers[1]?.hidden)} AHEAD`);
    for (const m of markers) expect(moreLabel(m).length).toBeLessThanOrEqual(28);
  });

  it('a window pinned to an end pays for one marker, not two', () => {
    const start = runRouteLayout(columns(80, 0), 217, MIN_CELL_PX.mobile);
    expect(start.slots.filter((s) => s.kind === 'more')).toHaveLength(1);
    expect(start.firstDepthIndex).toBe(0);
    const end = runRouteLayout(columns(80, 79), 217, MIN_CELL_PX.mobile);
    expect(end.slots.filter((s) => s.kind === 'more')).toHaveLength(1);
    // ...and it spends that reclaimed cell on a depth: one more column than the
    // middle-of-the-run case, which pays for both markers.
    const middle = runRouteLayout(columns(80, 40), 217, MIN_CELL_PX.mobile);
    expect(start.slots.filter((s) => s.kind === 'column')).toHaveLength(
      middle.slots.filter((s) => s.kind === 'column').length + 1,
    );
  });

  it('a marker gets the room its SENTENCE needs, not the room a `D36` needs', () => {
    // DESKTOP draws the trail horizontally, so "+36 BEHIND" (~62px at 10px
    // bold) sits in a ~26px cell and lands straight on top of the next depth
    // label — the first cut of this fix did exactly that. The marker spans
    // three cells there and one on mobile, where its long axis is the lane's
    // CROSS axis and it shares the depth labels' gutter.
    expect(MARKER_CELLS.desktop).toBeGreaterThan(1);
    expect(MARKER_CELLS.mobile).toBe(1);
    const layout = runRouteLayout(columns(200, 199), 976, MIN_CELL_PX.desktop, MARKER_CELLS.desktop);
    const marker = layout.slots.find((s) => s.kind === 'more');
    expect(marker?.span).toBe(MARKER_CELLS.desktop);
    // Its own box is wide enough for the words it holds.
    expect(layout.cellSize * (marker?.span ?? 1)).toBeGreaterThan(70);
    // Cells are laid end to end, no gaps and no overlaps.
    let cell = 0;
    for (const slot of layout.slots) {
      expect(slot.cell).toBe(cell);
      cell += slot.span;
    }
    expect(layout.cellSize * cell).toBeCloseTo(976, 6);
  });

  it('an empty route draws nothing at all', () => {
    const layout = runRouteLayout([], 217, MIN_CELL_PX.mobile);
    expect(layout.slots).toHaveLength(0);
    expect(layout.windowed).toBe(false);
  });
});

describe('approved five-day expedition track', () => {
  it.each([1, 2, 3, 4, 5, 6, 10])('wave %i has five unambiguous regional-day positions and exactly one current marker', (wave) => {
    const model = expeditionRouteTrackModel(snapshotRunRoute(runAtWave(7, wave)));
    expect(model.days.map((day) => day.label)).toEqual([
      'REGION DAY 1/5', 'REGION DAY 2/5', 'REGION DAY 3/5', 'REGION DAY 4/5', 'REGION DAY 5/5',
    ]);
    expect(model.days.filter((day) => day.state === 'current')).toHaveLength(1);
    expect(model.days.find((day) => day.state === 'current')?.day).toBe(((wave - 1) % 5) + 1);
  });

  it('distinguishes completed, current, and upcoming positions without exposing absolute depth labels', () => {
    const model = expeditionRouteTrackModel(snapshotRunRoute(runAtWave(7, 3)));
    expect(model.currentDay).toBe(3);
    expect(model.days.map((day) => day.state)).toEqual(['completed', 'completed', 'current', 'upcoming', 'upcoming']);
    expect(model.days.every((day) => !/^D\d+$/.test(day.label))).toBe(true);
  });

  it('starts a fresh regional track after day five instead of spilling into a second day group', () => {
    const model = expeditionRouteTrackModel(snapshotRunRoute(runAtWave(7, 6)));
    expect(model.currentDay).toBe(1);
    expect(model.currentLabel).toBe('REGION DAY 1/5');
    expect(model.days.map((day) => day.state)).toEqual(['current', 'upcoming', 'upcoming', 'upcoming', 'upcoming']);
  });
});
