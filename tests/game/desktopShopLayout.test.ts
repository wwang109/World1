import { describe, expect, it } from 'vitest';
import { shopTypeIds } from '../../src/data/shopTypes';
import { DESKTOP_PROFILE } from '../../src/game/layoutProfile';
import {
  DESKTOP_SHOP_PAGE_SIZE,
  desktopShopBannerControlLayout,
  desktopShopDragVisualPlan,
  desktopShopEmbeddedViewHeight,
  desktopShopInventoryTabs,
  desktopShopOfferGridLayout,
  desktopShopPage,
  desktopShopShelfLayout,
  desktopShopStorefrontLayout,
  desktopShopWorkspaceLayout,
} from '../../src/game/ui/desktopShopLayout';

describe('desktop shop storefront layout', () => {
  it('uses the exact embedded destination height so the sell zone cannot be clipped by a synthetic minimum', () => {
    expect(desktopShopEmbeddedViewHeight(516, 900)).toBe(516);
    expect(desktopShopEmbeddedViewHeight(undefined, 900)).toBe(900);
  });

  it('keeps the approved two-column card and gem shelves while fitting their rows to the panel height', () => {
    const layout = desktopShopOfferGridLayout(780, 760, 6, 5, true);

    expect(layout.cardColumns).toBe(2);
    expect(layout.cardRows).toBe(3);
    expect(layout.gemColumns).toBe(2);
    expect(layout.gemRows).toBe(3);
    expect(layout.cardHeight).toBeGreaterThan(80);
    expect(layout.gemHeight).toBeGreaterThan(60);
    expect(layout.contentHeight).toBeLessThanOrEqual(760);
  });

  it('compresses the same approved two-column composition instead of changing its rows on a short panel', () => {
    const layout = desktopShopOfferGridLayout(780, 560, 6, 5, true);

    expect(layout).toMatchObject({ cardColumns: 2, cardRows: 3, gemColumns: 2, gemRows: 3 });
    expect(layout.cardHeight).toBeLessThan(130);
    expect(layout.gemHeight).toBeLessThan(96);
    expect(layout.contentHeight).toBeLessThanOrEqual(560);
  });

  it('centres the reroll control inside the merchant banner without shifting its right edge', () => {
    const banner = { x: 12, y: 100, width: 600, height: 56 };
    const control = desktopShopBannerControlLayout(banner);

    expect(control).toEqual({ x: 484, y: 112, width: 120, height: 32 });
    expect(control.y - banner.y).toBe((banner.height - control.height) / 2);
    expect(control.x + control.width).toBe(banner.x + banner.width - 8);
  });

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

  it('keeps a roomy two-column shelf beside permanent board and swappable inventory lanes', () => {
    const layout = desktopShopWorkspaceLayout(960, 680, 12, DESKTOP_PROFILE.gap);

    expect(layout.shelf.width).toBeGreaterThanOrEqual(500);
    expect(layout.shelfColumns).toBe(2);
    expect(layout.board.width).toBeGreaterThanOrEqual(160);
    expect(layout.inventory.width).toBeGreaterThan(layout.board.width);
    expect(layout.shelf.x + layout.shelf.width + DESKTOP_PROFILE.gap).toBe(layout.board.x);
    expect(layout.board.x + layout.board.width + DESKTOP_PROFILE.gap).toBe(layout.inventory.x);
    expect(layout.inventory.x + layout.inventory.width).toBe(948);
  });

  it('reserves one full-width sell footer below all three desktop lanes', () => {
    const layout = desktopShopWorkspaceLayout(960, 680, 12, DESKTOP_PROFILE.gap);

    expect(layout.footer.x).toBe(12);
    expect(layout.footer.width).toBe(936);
    expect(layout.footer.height).toBeGreaterThanOrEqual(40);
    expect(layout.shelf.y + layout.shelf.height).toBeLessThanOrEqual(layout.footer.y - DESKTOP_PROFILE.gap);
    expect(layout.board.y + layout.board.height).toBeLessThanOrEqual(layout.footer.y - DESKTOP_PROFILE.gap);
    expect(layout.inventory.y + layout.inventory.height).toBeLessThanOrEqual(layout.footer.y - DESKTOP_PROFILE.gap);
  });

  it('labels the owned inventory tabs without inventing a gem capacity', () => {
    expect(desktopShopInventoryTabs(10)).toEqual([
      { id: 'bag', label: 'BAG · 10/10' },
      { id: 'gems', label: 'GEMS' },
    ]);
  });

  it('keeps shelf cards visible through an unmasked full-card proxy like bag dragging', () => {
    expect(desktopShopDragVisualPlan('gem')).toEqual({
      moveSource: false,
      sourceAlpha: 0.35,
      useUnmaskedProxy: true,
    });
    expect(desktopShopDragVisualPlan('shelf-card')).toEqual({
      moveSource: false,
      sourceAlpha: 0.35,
      useUnmaskedProxy: true,
    });
    expect(desktopShopDragVisualPlan('owned-card')).toEqual({
      moveSource: true,
      sourceAlpha: 0.9,
      useUnmaskedProxy: false,
    });
  });
});
