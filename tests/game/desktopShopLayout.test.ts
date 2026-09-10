import { describe, expect, it } from 'vitest';
import { shopTypeIds } from '../../src/data/shopTypes';
import { DESKTOP_PROFILE } from '../../src/game/layoutProfile';
import {
  DESKTOP_SHOP_PAGE_SIZE,
  desktopShopPage,
  desktopShopShelfLayout,
  desktopShopStorefrontLayout,
} from '../../src/game/ui/desktopShopLayout';

describe('desktop shop storefront layout', () => {
  it('paginates the authored catalog into eight-shop pages without loss or duplication', () => {
    expect(DESKTOP_SHOP_PAGE_SIZE).toBe(8);
    const first = desktopShopPage(shopTypeIds, 0);
    const pages = Array.from({ length: first.pageCount }, (_unused, page) => desktopShopPage(shopTypeIds, page));
    const reached = pages.flatMap((entry) => entry.ids);

    expect(pages.map((entry) => entry.ids.length)).toEqual([8, 8, 5]);
    expect(reached).toEqual(shopTypeIds);
    expect(new Set(reached).size).toBe(shopTypeIds.length);
    expect(pages[0]).toMatchObject({ page: 0, canPrevious: false, canNext: true });
    expect(pages.at(-1)).toMatchObject({ page: 2, canPrevious: true, canNext: false });
    expect(desktopShopPage(shopTypeIds, -99).page).toBe(0);
    expect(desktopShopPage(shopTypeIds, 99).page).toBe(2);
  });

  it('uses a four-by-two art-led grid with separate desktop paging controls', () => {
    const layout = desktopShopStorefrontLayout(1440, 900);
    expect(layout.grid.columns).toBe(4);
    expect(layout.grid.rows).toBe(2);
    expect(layout.grid.cellWidth).toBeGreaterThanOrEqual(320);
    expect(layout.grid.cellHeight).toBeGreaterThanOrEqual(290);
    expect(layout.grid.artHeight).toBeGreaterThanOrEqual(130);

    const cells = Array.from({ length: DESKTOP_SHOP_PAGE_SIZE }, (_unused, index) => layout.grid.cell(index));
    expect(new Set(cells.map((cell) => cell.x)).size).toBe(4);
    expect(new Set(cells.map((cell) => cell.y)).size).toBe(2);
    expect(cells.at(-1)!.y + cells.at(-1)!.height)
      .toBeLessThanOrEqual(layout.pager.previous.y - DESKTOP_PROFILE.gap);
    expect(layout.pager.previous.height).toBeGreaterThanOrEqual(DESKTOP_PROFILE.minTap);
    expect(layout.pager.next.height).toBeGreaterThanOrEqual(DESKTOP_PROFILE.minTap);
  });

  it('keeps every cell and pager control inside the 1440x900 safe bounds', () => {
    const layout = desktopShopStorefrontLayout(1440, 900);
    for (let index = 0; index < DESKTOP_SHOP_PAGE_SIZE; index += 1) {
      const cell = layout.grid.cell(index);
      expect(cell.x).toBeGreaterThanOrEqual(DESKTOP_PROFILE.safe.x);
      expect(cell.y).toBeGreaterThanOrEqual(layout.grid.top);
      expect(cell.x + cell.width).toBeLessThanOrEqual(1440 - DESKTOP_PROFILE.safe.x);
      expect(cell.y + cell.height).toBeLessThanOrEqual(layout.pager.previous.y - DESKTOP_PROFILE.gap);
    }
    expect(layout.pager.next.x + layout.pager.next.width).toBeLessThanOrEqual(1440 - DESKTOP_PROFILE.safe.x);
    expect(layout.pager.next.y + layout.pager.next.height).toBeLessThanOrEqual(900 - DESKTOP_PROFILE.safe.bottom);
  });

  it('centres a partial final row instead of leaving one tile stranded at the left edge', () => {
    const layout = desktopShopStorefrontLayout(1440, 900, 5);
    const loneSecondRowCell = layout.grid.cell(4);
    expect(loneSecondRowCell.x + loneSecondRowCell.width / 2).toBeCloseTo(1440 / 2, 5);
  });

  it('uses the full safe width for shelf plus owned columns without a detail dock', () => {
    const layout = desktopShopShelfLayout(1440, 24, 220, DESKTOP_PROFILE.gap);
    expect(layout.right).toBe(1416);
    expect(layout.bagX + layout.columnWidth).toBe(layout.right);
    expect(layout.shelfRight).toBe(layout.boardX - DESKTOP_PROFILE.gap);
  });
});
