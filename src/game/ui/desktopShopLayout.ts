import { DESKTOP_PROFILE } from '../layoutProfile';
import { DESKTOP_LAYOUT } from './DesktopNav';

export interface DesktopShopBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const DESKTOP_SHOP_PAGE_SIZE = 8;

export interface DesktopShopPage {
  page: number;
  pageCount: number;
  ids: readonly string[];
  canPrevious: boolean;
  canNext: boolean;
}

/** Shelf workspace after the permanent inspector was replaced by Card Details. */
export function desktopShopShelfLayout(
  width: number,
  gutter: number,
  columnWidth: number,
  gap: number,
): {
  right: number;
  boardX: number;
  bagX: number;
  columnWidth: number;
  shelfRight: number;
  shelfWidth: number;
} {
  const right = width - gutter;
  const bagX = right - columnWidth;
  const boardX = bagX - gap - columnWidth;
  const shelfRight = boardX - gap;
  return { right, boardX, bagX, columnWidth, shelfRight, shelfWidth: shelfRight - gutter };
}

/** Authored catalog order is stable; paging changes only how much is visible. */
export function desktopShopPage(ids: readonly string[], requestedPage: number): DesktopShopPage {
  const pageCount = Math.max(1, Math.ceil(ids.length / DESKTOP_SHOP_PAGE_SIZE));
  const finitePage = Number.isFinite(requestedPage) ? Math.floor(requestedPage) : 0;
  const page = Math.max(0, Math.min(pageCount - 1, finitePage));
  const start = page * DESKTOP_SHOP_PAGE_SIZE;
  return {
    page,
    pageCount,
    ids: ids.slice(start, start + DESKTOP_SHOP_PAGE_SIZE),
    canPrevious: page > 0,
    canNext: page < pageCount - 1,
  };
}

/**
 * Desktop-only storefront composition. Eight shops fill a four-by-two grid;
 * mobile retains its independent two-by-three layout and six-shop pages.
 */
export function desktopShopStorefrontLayout(width: number, height: number, visibleCount = DESKTOP_SHOP_PAGE_SIZE): {
  heading: { x: number; y: number };
  grid: {
    top: number;
    columns: 4;
    rows: 2;
    gap: number;
    cellWidth: number;
    cellHeight: number;
    artHeight: number;
    cell: (index: number) => DesktopShopBox;
  };
  pager: {
    previous: DesktopShopBox;
    next: DesktopShopBox;
    labelY: number;
    indicatorX: number;
  };
} {
  const gutter = DESKTOP_LAYOUT.gutter;
  const gap = DESKTOP_PROFILE.gap;
  const heading = { x: gutter, y: DESKTOP_LAYOUT.contentTop };
  const gridTop = heading.y + DESKTOP_PROFILE.font.label + 16;
  const pagerHeight = DESKTOP_PROFILE.minTap;
  const pagerY = height - DESKTOP_PROFILE.safe.bottom - pagerHeight;
  const pagerWidth = 132;
  const gridBottom = pagerY - gap;
  const columns = 4 as const;
  const rows = 2 as const;
  const availableWidth = width - gutter * 2;
  const cellWidth = (availableWidth - gap * (columns - 1)) / columns;
  const cellHeight = (gridBottom - gridTop - gap * (rows - 1)) / rows;
  const artHeight = Math.round(cellHeight * 0.46);
  const shown = Math.max(0, Math.min(DESKTOP_SHOP_PAGE_SIZE, Math.floor(visibleCount)));
  return {
    heading,
    grid: {
      top: gridTop,
      columns,
      rows,
      gap,
      cellWidth,
      cellHeight,
      artHeight,
      cell: (index: number) => {
        const row = Math.floor(index / columns);
        const rowStart = row * columns;
        const rowCount = Math.min(columns, Math.max(0, shown - rowStart));
        const rowOffset = Math.max(0, (columns - rowCount) * (cellWidth + gap) / 2);
        return {
          x: gutter + rowOffset + (index % columns) * (cellWidth + gap),
          y: gridTop + row * (cellHeight + gap),
          width: cellWidth,
          height: cellHeight,
        };
      },
    },
    pager: {
      previous: { x: gutter, y: pagerY, width: pagerWidth, height: pagerHeight },
      next: { x: width - gutter - pagerWidth, y: pagerY, width: pagerWidth, height: pagerHeight },
      labelY: pagerY + pagerHeight / 2,
      indicatorX: width / 2,
    },
  };
}
