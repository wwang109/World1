import { describe, expect, it } from 'vitest';
import { shopTypeIds } from '../../src/data/shopTypes';
import { MOBILE_PROFILE } from '../../src/game/layoutProfile';
import {
  activateMobileShopCard,
  closeMobileShopCardDetails,
  mobileShopConfirmButtonLayout,
  mobileShopPage,
  mobileRunShopBrowseLayout,
  mobileShopShelfHeaderLayout,
  mobileShopStorefrontLayout,
} from '../../src/game/ui/mobileShopLayout';

describe('mobile shop layout', () => {
  it.each([[392, 438], [412, 740], [412, 892]])('keeps the Run Shop browse flow fixed inside %ix%i', (width, height) => {
    const layout = mobileRunShopBrowseLayout(width, height);

    expect(layout.tabs.cards.y).toBeGreaterThanOrEqual(layout.header.y + layout.header.height);
    expect(layout.shelf.height).toBeGreaterThanOrEqual(120);
    expect(layout.owned.y).toBeGreaterThanOrEqual(layout.shelf.y + layout.shelf.height);
    expect(layout.pouch.y).toBeGreaterThanOrEqual(layout.owned.y + layout.owned.height);
    expect(layout.sell.y).toBeGreaterThanOrEqual(layout.pouch.y + layout.pouch.height);
    expect(layout.footer.y).toBeGreaterThanOrEqual(layout.sell.y + layout.sell.height);
    expect(layout.footer.y + layout.footer.height).toBeLessThanOrEqual(height - 6);
    expect(layout.footer.leave.width).toBeGreaterThanOrEqual(120);
    expect(layout.footer.buy.width).toBeGreaterThanOrEqual(120);
  });

  it('selects on the first card tap, opens on the completed same-card activation, and keeps selection after close', () => {
    const initial = { selectedCardIndex: null, detailCardIndex: null };
    const selected = activateMobileShopCard(initial, 2, false);
    expect(selected).toEqual({ selectedCardIndex: 2, detailCardIndex: null });

    const opened = activateMobileShopCard(selected, 2, true);
    expect(opened).toEqual({ selectedCardIndex: 2, detailCardIndex: 2 });
    expect(closeMobileShopCardDetails(opened)).toEqual({ selectedCardIndex: 2, detailCardIndex: null });
  });

  it('moves selection without opening details when the second tap targets another card', () => {
    const selected = { selectedCardIndex: 1, detailCardIndex: null };
    expect(activateMobileShopCard(selected, 4, false)).toEqual({ selectedCardIndex: 4, detailCardIndex: null });
  });

  it('separates the 412x892 storefront gold balance from its heading and keeps the catalog in two columns', () => {
    const layout = mobileShopStorefrontLayout(
      MOBILE_PROFILE.canvas.width,
      MOBILE_PROFILE.canvas.height,
      6,
    );

    expect(layout.gold.y + layout.gold.height).toBeLessThanOrEqual(layout.heading.y);
    expect(layout.heading.y + layout.heading.height).toBeLessThanOrEqual(layout.grid.top);
    expect(layout.grid.columns).toBe(2);

    const cells = shopTypeIds.slice(0, 6).map((_id, index) => layout.grid.cell(index));
    expect(new Set(cells.map((cell) => cell.x)).size).toBe(2);
    expect(cells[0]!.y).toBe(cells[1]!.y);
    expect(cells.at(-1)!.y + cells.at(-1)!.height).toBeLessThanOrEqual(MOBILE_PROFILE.canvas.height - 12);
  });

  it('paginates every shop exactly once in deterministic six-shop pages', () => {
    const first = mobileShopPage(shopTypeIds, 0);
    expect(first.pageCount).toBe(4);
    const pages = Array.from({ length: first.pageCount }, (_unused, page) => mobileShopPage(shopTypeIds, page));
    const reached = pages.flatMap((entry) => entry.ids);

    expect(pages.map((entry) => entry.ids.length)).toEqual([6, 6, 6, 3]);
    expect(reached).toEqual(shopTypeIds);
    expect(new Set(reached).size).toBe(shopTypeIds.length);
    expect(pages[0]).toMatchObject({ page: 0, canPrevious: false, canNext: true });
    expect(pages.at(-1)).toMatchObject({ page: 3, canPrevious: true, canNext: false });
    expect(mobileShopPage(shopTypeIds, -99).page).toBe(0);
    expect(mobileShopPage(shopTypeIds, 99).page).toBe(3);
  });

  it('uses three large art-led rows and 40px previous/next controls at 412x892', () => {
    const layout = mobileShopStorefrontLayout(412, 892, 6);

    expect(layout.grid.rows).toBe(3);
    expect(layout.grid.artHeight).toBeGreaterThanOrEqual(90);
    expect(layout.grid.cellHeight).toBeGreaterThanOrEqual(180);
    expect(layout.pager.previous.height).toBeGreaterThanOrEqual(MOBILE_PROFILE.minTap);
    expect(layout.pager.next.height).toBeGreaterThanOrEqual(MOBILE_PROFILE.minTap);
    expect(layout.grid.cell(5).y + layout.grid.cell(5).height).toBeLessThanOrEqual(layout.pager.previous.y - MOBILE_PROFILE.gap);
  });

  it('gives every top tab, sandbox back control, and reroll/full-stock surface the mobile tap-floor height', () => {
    const storefront = mobileShopStorefrontLayout(412, 892, 6);
    const shelf = mobileShopShelfHeaderLayout(412, 72);

    expect(storefront.tabs).toHaveLength(6);
    for (const tab of storefront.tabs) expect(tab.height).toBeGreaterThanOrEqual(MOBILE_PROFILE.minTap);
    expect(shelf.back.height).toBeGreaterThanOrEqual(MOBILE_PROFILE.minTap);
    expect(shelf.stock.height).toBeGreaterThanOrEqual(MOBILE_PROFILE.minTap);
    expect(shelf.contentTop).toBeGreaterThanOrEqual(shelf.stock.y + shelf.stock.height);
  });

  it('keeps BUY/MERGE and SELL confirmation controls at the tap floor without overlap', () => {
    const buyMerge = mobileShopConfirmButtonLayout({ x: 30, y: 321, width: 352, height: 250 }, 3);
    const sell = mobileShopConfirmButtonLayout({ x: 30, y: 380, width: 352, height: 132 }, 2);

    for (const layout of [buyMerge, sell]) {
      for (const button of layout.buttons) {
        expect(button.height).toBeGreaterThanOrEqual(MOBILE_PROFILE.minTap);
        expect(layout.labelY).toBe(button.y + button.height / 2);
        expect(button.y + button.height).toBeLessThanOrEqual(layout.dialog.y + layout.dialog.height);
      }
      for (let i = 1; i < layout.buttons.length; i += 1) {
        expect(layout.buttons[i - 1]!.x + layout.buttons[i - 1]!.width).toBeLessThan(layout.buttons[i]!.x);
      }
    }
  });
});
