import { MOBILE_PROFILE } from '../layoutProfile';

export interface MobileShopBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

const SIDE = 10;
const TAB_GAP = 5;
const GRID_GAP = 6;
export const MOBILE_SHOP_PAGE_SIZE = 6;

export interface MobileShopPage {
  page: number;
  pageCount: number;
  ids: readonly string[];
  canPrevious: boolean;
  canNext: boolean;
}

/** Catalog order is authored order. Paging is only a view over that immutable
 * list: no shuffle, duplicate, or dropped trailing page. */
export function mobileShopPage(ids: readonly string[], requestedPage: number): MobileShopPage {
  const pageCount = Math.max(1, Math.ceil(ids.length / MOBILE_SHOP_PAGE_SIZE));
  const finitePage = Number.isFinite(requestedPage) ? Math.floor(requestedPage) : 0;
  const page = Math.max(0, Math.min(pageCount - 1, finitePage));
  const start = page * MOBILE_SHOP_PAGE_SIZE;
  return {
    page,
    pageCount,
    ids: ids.slice(start, start + MOBILE_SHOP_PAGE_SIZE),
    canPrevious: page > 0,
    canNext: page < pageCount - 1,
  };
}

/** Pure geometry for the sandbox shop picker. The balance and heading own
 * separate vertical bands so their longest shipped labels cannot collide. */
export function mobileShopStorefrontLayout(
  width: number,
  height: number,
  tabCount: number,
): {
  tabs: MobileShopBox[];
  tabLabelY: number;
  gold: { y: number; height: number };
  heading: { y: number; height: number };
  grid: {
    top: number;
    columns: 2;
    rows: 3;
    gap: number;
    cellWidth: number;
    cellHeight: number;
    artHeight: number;
    cell: (index: number) => MobileShopBox;
  };
  pager: {
    previous: MobileShopBox;
    next: MobileShopBox;
    labelY: number;
    indicatorX: number;
  };
} {
  const tabY = MOBILE_PROFILE.safe.top;
  const tabHeight = MOBILE_PROFILE.minTap;
  const tabWidth = (width - SIDE * 2 - TAB_GAP * Math.max(0, tabCount - 1)) / Math.max(1, tabCount);
  const tabs = Array.from({ length: tabCount }, (_unused, index) => ({
    x: SIDE + index * (tabWidth + TAB_GAP),
    y: tabY,
    width: tabWidth,
    height: tabHeight,
  }));

  const gold = { y: tabY + tabHeight + 6, height: MOBILE_PROFILE.font.body };
  const heading = { y: gold.y + gold.height + 6, height: MOBILE_PROFILE.font.label };
  const gridTop = heading.y + heading.height + 6;
  const columns = 2 as const;
  const rows = 3 as const;
  const cellWidth = (width - SIDE * 2 - GRID_GAP) / columns;
  const pagerHeight = MOBILE_PROFILE.minTap;
  const pagerY = height - MOBILE_PROFILE.safe.bottom - pagerHeight;
  const pagerButtonWidth = 104;
  const pager = {
    previous: { x: SIDE, y: pagerY, width: pagerButtonWidth, height: pagerHeight },
    next: { x: width - SIDE - pagerButtonWidth, y: pagerY, width: pagerButtonWidth, height: pagerHeight },
    labelY: pagerY + pagerHeight / 2,
    indicatorX: width / 2,
  };
  const gridBottom = pagerY - MOBILE_PROFILE.gap;
  const cellHeight = Math.floor((gridBottom - gridTop - GRID_GAP * (rows - 1)) / rows);
  const artHeight = Math.min(Math.round(cellWidth * 9 / 16), Math.round(cellHeight * 0.5));

  return {
    tabs,
    tabLabelY: tabY + tabHeight / 2,
    gold,
    heading,
    grid: {
      top: gridTop,
      columns,
      rows,
      gap: GRID_GAP,
      cellWidth,
      cellHeight,
      artHeight,
      cell: (index) => ({
        x: SIDE + (index % columns) * (cellWidth + GRID_GAP),
        y: gridTop + Math.floor(index / columns) * (cellHeight + GRID_GAP),
        width: cellWidth,
        height: cellHeight,
      }),
    },
    pager,
  };
}

/** One shared shelf-header row: BACK and REROLL/FULL STOCK are true 40px
 * controls, with the scrollable catalog starting below their hit surfaces. */
export function mobileShopShelfHeaderLayout(width: number, top: number): {
  back: MobileShopBox;
  stock: MobileShopBox;
  titleY: number;
  labelY: number;
  contentTop: number;
} {
  const height = MOBILE_PROFILE.minTap;
  const back: MobileShopBox = { x: SIDE, y: top, width: 70, height };
  const stock: MobileShopBox = { x: width - SIDE - 92, y: top, width: 92, height };
  return {
    back,
    stock,
    titleY: top + (height - MOBILE_PROFILE.font.lead) / 2,
    labelY: top + height / 2,
    contentTop: top + height + MOBILE_PROFILE.gap,
  };
}

/** Bottom-anchored confirmation row used by both BUY/MERGE and SELL dialogs. */
export function mobileShopConfirmButtonLayout(
  dialog: MobileShopBox,
  buttonCount: number,
): { dialog: MobileShopBox; buttons: MobileShopBox[]; labelY: number } {
  const margin = 16;
  const gap = 8;
  const height = MOBILE_PROFILE.minTap;
  const count = Math.max(1, buttonCount);
  const width = (dialog.width - margin * 2 - gap * (count - 1)) / count;
  const y = dialog.y + dialog.height - margin - height;
  const buttons = Array.from({ length: buttonCount }, (_unused, index) => ({
    x: dialog.x + margin + index * (width + gap),
    y,
    width,
    height,
  }));
  return { dialog, buttons, labelY: y + height / 2 };
}
