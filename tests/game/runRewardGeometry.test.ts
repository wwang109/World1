import { describe, expect, it } from 'vitest';
import { DESKTOP_PROFILE, MOBILE_PROFILE } from '../../src/game/layoutProfile';
import { TOKEN_COMPACT_HEIGHT } from '../../src/game/ui/cardTokenSpec';
import { cardRowIdeal, centeredBox, FEATURE_CARD_ROW_H, layoutFeatureGrid, type Box } from '../../src/game/ui/runRewardGeometry';
import { runScreenTemplate, type Rect } from '../../src/game/ui/runScreenTemplate';

function within(inner: Box, outer: Rect): boolean {
  return (
    inner.x >= outer.x - 1e-6
    && inner.y >= outer.y - 1e-6
    && inner.x + inner.w <= outer.x + outer.width + 1e-6
    && inner.y + inner.h <= outer.y + outer.height + 1e-6
  );
}

function overlaps(a: Box, b: Box): boolean {
  return a.x < b.x + b.w - 1e-6 && b.x < a.x + a.w - 1e-6 && a.y < b.y + b.h - 1e-6 && b.y < a.y + a.h - 1e-6;
}

describe('centeredBox', () => {
  it('centers a box smaller than the rect, unclamped', () => {
    const rect: Rect = { x: 10, y: 20, width: 100, height: 200 };
    const box = centeredBox(rect, 40, 50);
    expect(box).toEqual({ x: 10 + (100 - 40) / 2, y: 20 + (200 - 50) / 2, w: 40, h: 50 });
  });

  it('clamps a box independently on each axis when it exceeds the rect', () => {
    const rect: Rect = { x: 0, y: 0, width: 50, height: 300 };
    // wider than rect, shorter than rect
    const box = centeredBox(rect, 200, 60);
    expect(box.w).toBe(50);
    expect(box.h).toBe(60);
    expect(box.x).toBe(0);
    expect(box.y).toBe((300 - 60) / 2);
  });

  it('never returns a box larger than the rect on either axis', () => {
    const rect: Rect = { x: 5, y: 5, width: 80, height: 40 };
    const box = centeredBox(rect, 1000, 1000);
    expect(box.w).toBeLessThanOrEqual(rect.width);
    expect(box.h).toBeLessThanOrEqual(rect.height);
  });
});

describe('layoutFeatureGrid', () => {
  it('returns nothing for a non-positive count or ideal size', () => {
    const rect: Rect = { x: 0, y: 0, width: 500, height: 500 };
    expect(layoutFeatureGrid(rect, 0, 100, 100, 10)).toEqual([]);
    expect(layoutFeatureGrid(rect, 5, 0, 100, 10)).toEqual([]);
    expect(layoutFeatureGrid(rect, 5, 100, 0, 10)).toEqual([]);
  });

  it('returns exactly `count` boxes', () => {
    const rect: Rect = { x: 0, y: 0, width: 1000, height: 1000 };
    for (const count of [1, 2, 3, 5, 7]) {
      expect(layoutFeatureGrid(rect, count, 50, 80, 8)).toHaveLength(count);
    }
  });

  it('a single item matches `centeredBox` at the ideal size exactly', () => {
    const rect: Rect = { x: 20, y: 30, width: 400, height: 300 };
    const [cell] = layoutFeatureGrid(rect, 1, 100, 150, 8);
    expect(cell).toEqual(centeredBox(rect, 100, 150));
  });

  it('a WIDE rect (plenty of spare width) puts every item on one row, unscaled', () => {
    // Mirrors desktop's real reward `feature` rect (1376 wide) — 5 cards at
    // their 192x315 ideal size fit on one row with room to spare.
    const rect: Rect = { x: 32, y: 130, width: 1376, height: 492 };
    const cells = layoutFeatureGrid(rect, 5, 192, 315, 12);
    expect(cells).toHaveLength(5);
    for (const cell of cells) {
      expect(cell.w).toBe(192);
      expect(cell.h).toBe(315);
    }
    // All 5 share the same row (y) — never scaled down, since it fits.
    const ys = new Set(cells.map((c) => c.y));
    expect(ys.size).toBe(1);
    // Left-to-right order, gapped by exactly 12.
    for (let i = 1; i < cells.length; i++) {
      expect(cells[i]!.x - (cells[i - 1]!.x + cells[i - 1]!.w)).toBeCloseTo(12);
    }
    // The row is centered inside `rect` (equal margin left/right).
    const leftMargin = cells[0]!.x - rect.x;
    const rightMargin = rect.x + rect.width - (cells[4]!.x + cells[4]!.w);
    expect(leftMargin).toBeCloseTo(rightMargin);
  });

  it('a NARROW rect wraps into multiple columns, scaling down uniformly (aspect preserved)', () => {
    // Mirrors mobile's real reward `feature` rect (392 wide) — 5 cards at
    // their 170x279 ideal size do NOT fit in one row of 5, so this wraps.
    const rect: Rect = { x: 10, y: 100, width: 392, height: 522 };
    const idealW = 170;
    const idealH = 279;
    const cells = layoutFeatureGrid(rect, 5, idealW, idealH, 8);
    expect(cells).toHaveLength(5);
    // More than one row was needed.
    const rowYs = [...new Set(cells.map((c) => c.y))];
    expect(rowYs.length).toBeGreaterThan(1);
    // Every cell keeps the ideal aspect ratio (uniform scale, never distorted).
    for (const cell of cells) {
      expect(cell.w / cell.h).toBeCloseTo(idealW / idealH, 5);
      expect(cell.w).toBeLessThanOrEqual(idealW);
      expect(cell.h).toBeLessThanOrEqual(idealH);
    }
    // Every cell fits fully inside the rect and none overlap.
    for (const cell of cells) expect(within(cell, rect)).toBe(true);
    for (let i = 0; i < cells.length; i++) {
      for (let j = i + 1; j < cells.length; j++) expect(overlaps(cells[i]!, cells[j]!)).toBe(false);
    }
  });

  it('centers a short last row within the grid, not flush to one side', () => {
    // 5 items, 2 columns → rows of [2, 2, 1]. The lone 5th item should sit
    // centered under the two columns above it, not flush left.
    const rect: Rect = { x: 0, y: 0, width: 220, height: 900 };
    const cells = layoutFeatureGrid(rect, 5, 100, 100, 10);
    const col0X = cells[0]!.x;
    const col1X = cells[1]!.x;
    const lastRowCell = cells[4]!;
    const expectedCenterX = (col0X + (col1X + cells[1]!.w)) / 2 - lastRowCell.w / 2;
    expect(lastRowCell.x).toBeCloseTo(expectedCenterX);
  });

  it('never scales a cell up past its ideal size', () => {
    const rect: Rect = { x: 0, y: 0, width: 5000, height: 5000 };
    const cells = layoutFeatureGrid(rect, 3, 80, 120, 10);
    for (const cell of cells) {
      expect(cell.w).toBeLessThanOrEqual(80);
      expect(cell.h).toBeLessThanOrEqual(120);
    }
  });

  it('degrades gracefully (still positive, still non-overlapping) even when the rect is too small for the ideal size', () => {
    const rect: Rect = { x: 0, y: 0, width: 60, height: 60 };
    const cells = layoutFeatureGrid(rect, 5, 100, 100, 8);
    expect(cells).toHaveLength(5);
    for (const cell of cells) {
      expect(within(cell, rect)).toBe(true);
      expect(cell.w).toBeGreaterThan(0);
      expect(cell.h).toBeGreaterThan(0);
    }
    for (let i = 0; i < cells.length; i++) {
      for (let j = i + 1; j < cells.length; j++) expect(overlaps(cells[i]!, cells[j]!)).toBe(false);
    }
  });

  it('never returns a negative scale (and thus negative-width/height boxes) when rows overflow the rect height', () => {
    // `cols` is bounded against `rect.width` via `maxCols`, so its scale
    // numerator (`rect.width - gap * (cols - 1)`) can never go negative.
    // `rows = Math.ceil(count / cols)` has no equivalent bound against
    // `rect.height` — a tall stack of rows times a real gap can drive the
    // height-side numerator negative. Concretely: cols=1 (200 wide ideal
    // items only fit 1 per row in a 200-wide rect), rows=5, so the height
    // numerator is `200 - 60*(5-1) = -40`, giving an unclamped scale of
    // `-40/50 = -0.8` and negative cellW/cellH (-160/-8). The "degrades
    // gracefully" case above stays just barely positive, which is why this
    // went unnoticed.
    const rect: Rect = { x: 0, y: 0, width: 200, height: 200 };
    const cells = layoutFeatureGrid(rect, 5, 200, 10, 60);
    expect(cells).toHaveLength(5);
    for (const cell of cells) {
      expect(cell.w).toBeGreaterThanOrEqual(0);
      expect(cell.h).toBeGreaterThanOrEqual(0);
    }
    // Pin the chosen degenerate behavior: a scale that would go negative is
    // clamped to zero (a zero-size box), never a negative-size one.
    for (const cell of cells) {
      expect(cell.w).toBe(0);
      expect(cell.h).toBe(0);
    }
  });

  // Integration check against the REAL reward `feature` rects (pure geometry,
  // no Phaser). The row ideal comes straight from `runRewardGeometry.ts`'s own
  // `cardRowIdeal`/`FEATURE_CARD_ROW_H` (the same the three pickers in
  // `RunRewardPanel.ts` call) and the gap from the platform's own
  // `layoutProfile.ts` — no hand-typed duplicate of either exists, so drift
  // between this test and the real renderer's inputs is impossible by
  // construction.
  //
  // REWRITTEN 2026-08-28 with the portrait -> landscape-row pass. The two cases
  // this replaces pinned the OLD shape's real relationship to each rect:
  // "desktop fits 5 PORTRAIT cards in one unscaled ROW" and "mobile WRAPS them
  // into (at least) 2 columns". Both were true and both are now the wrong
  // thing to want — the mobile wrap is precisely the orphaned third card this
  // pass removes. What is pinned instead is the property the fix has to keep:
  // ONE COLUMN of full-width rows, at the ideal height, unscaled, on both
  // platforms and at every real picker count. That is just as load-bearing on
  // `FEATURE_CARD_ROW_H` as the old pair was on `FEATURE_CARD_SIZE` — raise
  // either platform's row height past what its real rect can stack and the
  // "unscaled" assertions go red.
  const GRID_GAP: Record<'desktop' | 'mobile', number> = { desktop: DESKTOP_PROFILE.gap, mobile: MOBILE_PROFILE.gap };
  // 5 = `bonusDraft`, the widest picker; 3 = the merge picker's candidates.
  const PICKER_COUNTS = [1, 3, 5] as const;

  for (const platform of ['desktop', 'mobile'] as const) {
    for (const count of PICKER_COUNTS) {
      it(`${platform}: ${count} real picker cards stack as ${count} full-width rows — no wrap, no orphan`, () => {
        const feature = runScreenTemplate(platform).contentSlots.reward.feature;
        const ideal = cardRowIdeal(feature, platform);
        const cells = layoutFeatureGrid(feature, count, ideal.w, ideal.h, GRID_GAP[platform]);
        expect(cells).toHaveLength(count);
        for (const cell of cells) {
          expect(within(cell, feature)).toBe(true);
          // Full width of the band, at the ideal height: unscaled, so the rows
          // really do fit the real rect rather than being shrunk into it.
          expect(cell.w).toBeCloseTo(feature.width, 6);
          expect(cell.h).toBeCloseTo(FEATURE_CARD_ROW_H[platform], 6);
          // A ROW, and tall enough that `CardToken` renders its full
          // name/effects/affinity face rather than the one-line COMPACT variant.
          expect(cell.w).toBeGreaterThan(cell.h);
          expect(cell.h).toBeGreaterThan(TOKEN_COMPACT_HEIGHT);
        }
        // One column: every row shares the same x, and each is strictly below
        // the previous one. This is the "no orphan centred under the others"
        // guard — a wrapped short last row would have a different x.
        for (const cell of cells) expect(cell.x).toBeCloseTo(cells[0]!.x, 6);
        for (let i = 1; i < cells.length; i++) {
          expect(cells[i]!.y - (cells[i - 1]!.y + cells[i - 1]!.h)).toBeCloseTo(GRID_GAP[platform], 6);
        }
        for (let i = 0; i < cells.length; i++) {
          for (let j = i + 1; j < cells.length; j++) expect(overlaps(cells[i]!, cells[j]!)).toBe(false);
        }
      });
    }
  }
});
