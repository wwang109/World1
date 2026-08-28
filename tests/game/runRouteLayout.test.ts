import { describe, expect, it } from 'vitest';
import {
  MARKER_CELLS,
  MIN_CELL_PX,
  currentColumnIndex,
  moreLabel,
  runRouteLayout,
  snapshotRunRoute,
  type RunRouteColumnSnapshot,
} from '../../src/game/ui/runRouteLayout';
import { bandBannerForWave, bandBannerHeight } from '../../src/game/ui/bandBannerViewModel';
import { runScreenTemplate } from '../../src/game/ui/runScreenTemplate';
import { DESKTOP_PROFILE, MOBILE_PROFILE } from '../../src/game/layoutProfile';
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

/**
 * THE LANE THE SCENES ACTUALLY HAND IT. These recompute the two run maps'
 * lane arithmetic from the same constants the scenes use, so the numbers in the
 * fix's report are the numbers the code produces — the mobile lane in
 * particular is what the band banner's height leaves behind.
 */
describe('the run map lanes, at wave 1 and at wave 10', () => {
  /** MobileRunMapScene.renderTrail, in numbers. */
  function mobileTrailLane(run: RunState): { usable: number; cellSize: number; drawn: number } {
    const t = runScreenTemplate('mobile');
    const wave = run.map.depths[run.depth]?.[0]?.wave ?? 1;
    const bannerH = bandBannerHeight(bandBannerForWave(run, wave), 'mobile');
    const choiceStackH = MOBILE_PROFILE.font.tiny + 8 + 94 * 3 + 10 * 2;
    const choicesTop = t.contentSlots.choices.y + t.contentSlots.choices.height - choiceStackH;
    const laneTop = t.regions.content.y + bannerH + 8;
    const laneH = Math.max(60, choicesTop - 12 - laneTop);
    const usable = laneH - MOBILE_PROFILE.gap * 2;
    const layout = runRouteLayout(snapshotRunRoute(run).columns, usable, MIN_CELL_PX.mobile, MARKER_CELLS.mobile);
    return { usable, cellSize: layout.cellSize, drawn: layout.slots.filter((s) => s.kind === 'column').length };
  }

  /** DesktopRunMapScene.renderTrail, in numbers. */
  function desktopTrailLane(run: RunState): { usable: number; cellSize: number; drawn: number } {
    const area = DESKTOP_PROFILE.canvas.width - DESKTOP_PROFILE.safe.x * 2;
    const wave = run.map.depths[run.depth]?.[0]?.wave ?? 1;
    const bannerW = Math.min(360, Math.round(area * 0.28));
    const usable = area - bannerW - 16 - DESKTOP_PROFILE.gap * 2;
    void bandBannerHeight(bandBannerForWave(run, wave), 'desktop');
    const layout = runRouteLayout(snapshotRunRoute(run).columns, usable, MIN_CELL_PX.desktop, MARKER_CELLS.desktop);
    return { usable, cellSize: layout.cellSize, drawn: layout.slots.filter((s) => s.kind === 'column').length };
  }

  for (const wave of [1, 10, 20]) {
    it(`wave ${String(wave)}: both platforms stay above the legibility floor`, () => {
      const run = runAtWave(7, wave);
      const mobile = mobileTrailLane(run);
      const desktop = desktopTrailLane(run);
      expect(mobile.cellSize).toBeGreaterThanOrEqual(MIN_CELL_PX.mobile);
      expect(desktop.cellSize).toBeGreaterThanOrEqual(MIN_CELL_PX.desktop);
      expect(mobile.drawn).toBeGreaterThan(0);
      expect(desktop.drawn).toBeGreaterThan(0);
    });
  }

  it('DESKTOP at wave 10 is untouched — all 36 depths, same cell as before', () => {
    const run = runAtWave(7, 10);
    const total = snapshotRunRoute(run).columns.length;
    expect(total).toBeGreaterThanOrEqual(30);
    const desktop = desktopTrailLane(run);
    expect(desktop.drawn).toBe(total);
    expect(desktop.cellSize).toBeCloseTo(desktop.usable / total, 6);
  });

  it('MOBILE at wave 10 reads: it windows instead of smearing', () => {
    const run = runAtWave(7, 10);
    const total = snapshotRunRoute(run).columns.length;
    const mobile = mobileTrailLane(run);
    // The regression, in one line: drawing ALL of them in this lane is far
    // under the floor — 6.1px a depth even after the choice block gives back
    // the space it never used, and 3.9px in the lane as the banner shipped it.
    expect(mobile.usable / total).toBeLessThan(MIN_CELL_PX.mobile);
    expect(mobile.cellSize).toBeGreaterThanOrEqual(MIN_CELL_PX.mobile);
    expect(mobile.drawn).toBeLessThan(total);
    expect(mobile.drawn).toBeGreaterThanOrEqual(8);
  });
});
