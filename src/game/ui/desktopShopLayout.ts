import { DESKTOP_PROFILE } from '../layoutProfile';
import { DESKTOP_LAYOUT } from './DesktopNav';

export interface DesktopShopBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type DesktopShopInventoryTab = 'bag' | 'gems';

export interface DesktopShopInventoryTabLabel {
  id: DesktopShopInventoryTab;
  label: string;
}

export interface DesktopShopDragVisualPlan {
  moveSource: boolean;
  sourceAlpha: number;
  useUnmaskedProxy: boolean;
}

/** Embedded shops must use the host's real height. A synthetic minimum makes
 * the child taller than CHOOSE YOUR NEXT STOP, which summons host scroll
 * arrows and clips the bottom sell zone on short desktop windows. */
export function desktopShopEmbeddedViewHeight(embeddedHeight: number | undefined, fullHeight: number): number {
  return embeddedHeight === undefined ? Math.max(1, fullHeight) : Math.max(1, embeddedHeight);
}

export interface DesktopShopOfferGridLayout {
  cardColumns: number;
  cardRows: number;
  cardHeight: number;
  gemColumns: number;
  gemRows: number;
  gemHeight: number;
  rowGap: number;
  contentHeight: number;
}

/** Preserve the approved two-column shelf at every desktop height. Embedded
 * rows scale together to consume the available lane without forcing the host
 * to scroll or collapsing the catalog into a sparse one-row strip. */
export function desktopShopOfferGridLayout(
  shelfWidth: number,
  availableHeight: number,
  cardCount: number,
  gemCount: number,
  embedded: boolean,
): DesktopShopOfferGridLayout {
  const cards = Math.max(0, Math.floor(cardCount));
  const gems = Math.max(0, Math.floor(gemCount));
  const cardColumns = Math.max(1, Math.min(cards || 1, 2));
  const gemColumns = Math.max(1, Math.min(gems || 1, 2));
  const cardRows = Math.ceil(cards / cardColumns);
  const gemRows = Math.ceil(gems / gemColumns);
  const rowGap = embedded ? 10 : 16;
  const cardCaptionHeight = 24;
  const sectionLabelHeight = 20;
  const sectionGap = cards > 0 && gems > 0 ? (embedded ? 14 : 24) : 0;
  const fixedHeight = (cards > 0 ? sectionLabelHeight + cardRows * cardCaptionHeight : 0)
    + (gems > 0 ? sectionLabelHeight : 0)
    + Math.max(0, cardRows - 1) * rowGap
    + Math.max(0, gemRows - 1) * rowGap
    + sectionGap;
  const preferredCardHeight = 130;
  const preferredGemHeight = 96;
  const preferredVariableHeight = cardRows * preferredCardHeight + gemRows * preferredGemHeight;
  const variableBudget = Math.max(1, availableHeight - fixedHeight);
  const scale = embedded && preferredVariableHeight > 0
    ? Math.min(1, variableBudget / preferredVariableHeight)
    : 1;
  const cardHeight = cards > 0 ? Math.max(54, Math.floor(preferredCardHeight * scale)) : 0;
  const gemHeight = gems > 0 ? Math.max(44, Math.floor(preferredGemHeight * scale)) : 0;
  const contentHeight = fixedHeight + cardRows * cardHeight + gemRows * gemHeight;
  void shelfWidth;
  return {
    cardColumns,
    cardRows,
    cardHeight,
    gemColumns,
    gemRows,
    gemHeight,
    rowGap,
    contentHeight,
  };
}

/** Right-aligned merchant-banner control, vertically centred for both states. */
export function desktopShopBannerControlLayout(
  banner: DesktopShopBox,
  controlWidth = 120,
  controlHeight = 32,
  rightInset = 8,
): DesktopShopBox {
  return {
    x: banner.x + banner.width - rightInset - controlWidth,
    y: banner.y + (banner.height - controlHeight) / 2,
    width: controlWidth,
    height: controlHeight,
  };
}

/** Masked gem tiles stay in their lane; a scene-root proxy follows the drag. */
export function desktopShopDragVisualPlan(kind: 'owned-card' | 'shelf-card' | 'gem'): DesktopShopDragVisualPlan {
  return kind === 'gem' || kind === 'shelf-card'
    ? { moveSource: false, sourceAlpha: 0.35, useUnmaskedProxy: true }
    : { moveSource: true, sourceAlpha: 0.9, useUnmaskedProxy: false };
}

/** Player-facing owned-inventory labels. Gems are intentionally uncapped. */
export function desktopShopInventoryTabs(bagUsed: number): readonly DesktopShopInventoryTabLabel[] {
  const used = Math.max(0, Math.min(10, Math.floor(Number.isFinite(bagUsed) ? bagUsed : 0)));
  return [
    { id: 'bag', label: `BAG · ${used}/10` },
    { id: 'gems', label: 'GEMS' },
  ];
}

export interface DesktopShopWorkspaceLayout {
  shelfColumns: 2;
  shelf: DesktopShopBox;
  board: DesktopShopBox;
  inventory: DesktopShopBox;
  footer: DesktopShopBox;
}

/**
 * Desktop embedded-shop lanes. The catalog keeps the largest share, while the
 * permanent board and swappable inventory lanes retain enough width to render
 * the shared CardToken presentation. One footer spans the complete workspace.
 */
export function desktopShopWorkspaceLayout(
  width: number,
  height: number,
  gutter = DESKTOP_LAYOUT.gutter,
  gap = DESKTOP_PROFILE.gap,
): DesktopShopWorkspaceLayout {
  const safeWidth = Math.max(1, width);
  const safeHeight = Math.max(1, height);
  const right = safeWidth - gutter;
  const ownedWidth = Math.min(560, Math.max(320, Math.round(safeWidth * 0.4)));
  const boardWidth = Math.floor(ownedWidth * 0.45);
  const inventoryWidth = ownedWidth - boardWidth;
  const inventoryX = right - inventoryWidth;
  const boardX = inventoryX - gap - boardWidth;
  const shelfRight = boardX - gap;
  const footerHeight = 44;
  const footerY = safeHeight - gutter - footerHeight;
  const laneHeight = Math.max(1, footerY - gap);
  return {
    shelfColumns: 2,
    shelf: { x: gutter, y: 0, width: shelfRight - gutter, height: laneHeight },
    board: { x: boardX, y: 0, width: boardWidth, height: laneHeight },
    inventory: { x: inventoryX, y: 0, width: inventoryWidth, height: laneHeight },
    footer: { x: gutter, y: footerY, width: right - gutter, height: footerHeight },
  };
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
