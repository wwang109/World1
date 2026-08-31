import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gridRowCount, gridWindow, inGridWindow } from '../../src/game/ui/gridWindow';
import { captionCellHeight, MOBILE_WIKI_TOKEN_H, WIKI_PL_ROW_H } from '../../src/game/ui/cardCellLayout';
import { skillBook } from '../../src/data/skills';

/**
 * `ui/gridWindow.ts` is the arithmetic both wiki catalogues now scroll on, and
 * the whole point of it is that a card the reader cannot see is not drawn.
 * Phaser does NOT frustum-cull — `CameraManager.render` filters the display
 * list through `willRender`, which reads `visible`/`alpha` and never bounds —
 * so before this module both wikis submitted all 166 cards, each with its own
 * stencil mask, on every single frame. Measured headless at
 * `deviceScaleFactor: 2`: desktop 6424 objects / 2841 Texts / 671 batch
 * flushes per frame / 7.2s per frame; mobile 2715 / 1123 / 221 / 1.3s. An
 * 8-move drag on the desktop grid took 341 SECONDS, which is why a previous
 * probe reported the mobile scene graph as "gone" after a drag — no scene
 * graph was ever lost, the harness simply outran the page.
 *
 * The two failure modes a window can have are opposite and both invisible in a
 * screenshot of the top of the list, so both are pinned here: a window that is
 * too SMALL leaves a hole (a row the reader is looking at was never built), and
 * a window that is too LARGE gives the frame rate back. Every case therefore
 * asserts the exact row span, not "roughly this many".
 */

const MOBILE_CELL_H = captionCellHeight(MOBILE_WIKI_TOKEN_H, WIKI_PL_ROW_H);
const MOBILE_ROW_GAP = 8;
const MOBILE_STRIDE = MOBILE_CELL_H + MOBILE_ROW_GAP;
/** `MobileWikiScene.renderCardCatalog`: top 142, bottom H - 10, H = 892. */
const MOBILE_VIEWPORT_H = 892 - 10 - 142;
const CARDS = Object.keys(skillBook).length;

describe('gridRowCount', () => {
  it('is the ceiling of count over columns', () => {
    expect(gridRowCount(166, 5)).toBe(34);
    expect(gridRowCount(166, 2)).toBe(83);
    expect(gridRowCount(10, 5)).toBe(2);
    expect(gridRowCount(11, 5)).toBe(3);
  });

  it('is zero for an empty or degenerate grid', () => {
    expect(gridRowCount(0, 5)).toBe(0);
    expect(gridRowCount(166, 0)).toBe(0);
  });
});

describe('gridWindow — which rows overlap the viewport', () => {
  const base = {
    count: 100, columns: 2, rowStride: 100, cellH: 90, viewportHeight: 300, scrollY: 0,
  };

  it('at the top of the list, with no overscan, keeps exactly the rows on screen', () => {
    // Rows occupy [0,90) [100,190) [200,290) [300,390). The viewport is
    // [0,300), so rows 0-2 are on screen and row 3 starts exactly at the
    // bottom edge — outside.
    expect(gridWindow({ ...base, overscanRows: 0 })).toMatchObject({ firstRow: 0, lastRow: 2, firstIndex: 0, lastIndex: 5 });
  });

  it('adds the overscan rows below, and clamps them at row 0 above', () => {
    expect(gridWindow({ ...base, overscanRows: 2 })).toMatchObject({ firstRow: 0, lastRow: 4 });
  });

  it('drops a row the moment its bottom edge leaves the viewport top', () => {
    // scrollY -90: viewport is content [90,390). Row 0 ends AT 90 — gone.
    expect(gridWindow({ ...base, scrollY: -90, overscanRows: 0 }).firstRow).toBe(1);
    // One pixel less and row 0 still has a pixel showing.
    expect(gridWindow({ ...base, scrollY: -89, overscanRows: 0 }).firstRow).toBe(0);
  });

  it('does not count the gutter between rows as part of a row', () => {
    // scrollY -95 puts the viewport top inside the [90,100) gutter: row 0 is
    // finished, row 1 has not started, and the window must NOT reach back for
    // a row that is only "near" the edge.
    expect(gridWindow({ ...base, scrollY: -95, overscanRows: 0 }).firstRow).toBe(1);
  });

  it('clamps the last row at the end of the content', () => {
    const rows = gridRowCount(base.count, base.columns);
    const end = gridWindow({ ...base, scrollY: -(rows * base.rowStride - base.viewportHeight), overscanRows: 2 });
    expect(end.lastRow).toBe(rows - 1);
    expect(end.lastIndex).toBe(base.count - 1);
  });

  it('never reports an index past the last cell on a ragged final row', () => {
    // 9 cells over 2 columns: row 4 holds ONE card, not two.
    const win = gridWindow({ ...base, count: 9, scrollY: -400, overscanRows: 2 });
    expect(win.lastRow).toBe(4);
    expect(win.lastIndex).toBe(8);
    expect(inGridWindow(win, 8)).toBe(true);
    expect(inGridWindow(win, 9)).toBe(false);
  });

  it('is empty for an empty grid or a zero-height viewport', () => {
    expect(gridWindow({ ...base, count: 0 }).count).toBe(0);
    expect(gridWindow({ ...base, viewportHeight: 0 }).count).toBe(0);
    expect(inGridWindow(gridWindow({ ...base, count: 0 }), 0)).toBe(false);
  });
});

describe('the wiki catalogues draw a small fraction of the book', () => {
  it('mobile keeps well under a quarter of the catalogue live at any offset', () => {
    const rows = gridRowCount(CARDS, 2);
    let worst = 0;
    for (let row = 0; row < rows; row++) {
      const win = gridWindow({
        count: CARDS, columns: 2, rowStride: MOBILE_STRIDE, cellH: MOBILE_CELL_H,
        viewportHeight: MOBILE_VIEWPORT_H, scrollY: -row * MOBILE_STRIDE, overscanRows: 2,
      });
      worst = Math.max(worst, win.count);
    }
    // The whole point: the live set is bounded by the VIEWPORT, not by the
    // catalogue. 166 cards must never all be live again.
    expect(worst).toBeLessThan(CARDS / 4);
    expect(worst).toBeGreaterThan(0);
  });

  it('every card is reachable — sweeping the scroll range covers the whole book', () => {
    const seen = new Set<number>();
    const rows = gridRowCount(CARDS, 2);
    for (let row = 0; row < rows; row++) {
      const win = gridWindow({
        count: CARDS, columns: 2, rowStride: MOBILE_STRIDE, cellH: MOBILE_CELL_H,
        viewportHeight: MOBILE_VIEWPORT_H, scrollY: -row * MOBILE_STRIDE, overscanRows: 0,
      });
      for (let i = win.firstIndex; i <= win.lastIndex; i++) seen.add(i);
    }
    expect(seen.size).toBe(CARDS);
  });
});

describe('both wiki scenes actually go through the window', () => {
  const read = (name: string): string =>
    readFileSync(join(process.cwd(), 'src/game/scenes', name), 'utf8');

  // A scene that builds its grid in a `for … of skills.entries()` loop again
  // has silently un-fixed this, and no unit test on the pure module would
  // notice. Both scenes must build cells through their `ensure*` seam only.
  it('mobile builds catalogue cells lazily and hides the rest', () => {
    const src = read('MobileWikiScene.ts');
    expect(src).toContain("from '../ui/gridWindow'");
    expect(src).toContain('private ensureRow(');
    expect(src).toContain('private syncWindow(');
    expect(src.match(/new CardToken\(/g)).toHaveLength(1);
    // The GEMS tab is the same defect: 53 masked row containers, all drawn.
    expect(src).toContain('private ensureGemRow(');
    expect(src).toContain('private syncGemWindow(');
  });

  it('desktop builds gallery cells lazily and hides the rest', () => {
    const src = read('DesktopWikiScene.ts');
    expect(src).toContain("from '../ui/gridWindow'");
    expect(src).toContain('private ensureGalleryCard(');
    expect(src).toContain('private syncWindow(');
    // Two: the gallery cell, and the detail pane's single large preview.
    expect(src.match(/new FantasyCardTemplateV2\(/g)).toHaveLength(2);
  });
});
