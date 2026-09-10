import type { MapIntelRecord } from '../../run/runState';

export interface MapIntelRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface MapIntelLayoutCard {
  record: MapIntelRecord;
  rect: MapIntelRect;
}

/** One pure geometry contract for the two intentionally separate surfaces:
 * desktop reserves a permanent rail beside the route; mobile uses a masked
 * read sheet with a touch-safe close row. Both consume the same persisted
 * records, never a forecast recomputation. */
export interface MapIntelLayoutModel {
  mode: 'desktop' | 'mobile';
  rail: MapIntelRect;
  route: MapIntelRect;
  /** The title's reserved footprint. Cards always start below it. */
  heading: MapIntelRect;
  cards: readonly MapIntelLayoutCard[];
  mask?: MapIntelRect;
  close?: MapIntelRect;
  maxScroll: number;
}

function orderedMapIntel(records: readonly MapIntelRecord[]): readonly MapIntelRecord[] {
  return [...records].sort((left, right) => left.band - right.band);
}

/** Pure layout. The authored 1440×900 / 412×892 canvases are first-class;
 * larger canvases retain the same safe margins and grow only the available
 * route/read regions. The mobile card coordinates are unscrolled content
 * coordinates so the mask can prove both endpoints are reachable. */
export function mapIntelLayoutModel(
  records: readonly MapIntelRecord[],
  viewport: { width: number; height: number },
): MapIntelLayoutModel {
  const ordered = orderedMapIntel(records);
  if (viewport.width > 640) {
    const safeX = Math.max(24, Math.round(viewport.width * (32 / 1440)));
    const bannerWidth = Math.min(360, Math.round((viewport.width - safeX * 2) * 0.28));
    const laneY = Math.round(viewport.height * (514 / 900));
    const laneBottom = viewport.height - Math.max(24, Math.round(viewport.height * (24 / 900)));
    const rail: MapIntelRect = {
      x: safeX + bannerWidth + 16,
      y: laneY,
      width: Math.min(320, Math.max(260, Math.round(viewport.width * 0.22))),
      height: Math.max(0, laneBottom - laneY),
    };
    const route: MapIntelRect = {
      x: rail.x + rail.width + 16,
      y: laneY,
      width: Math.max(0, viewport.width - safeX - (rail.x + rail.width + 16)),
      height: rail.height,
    };
    const heading: MapIntelRect = { x: rail.x + 10, y: rail.y + 8, width: rail.width - 20, height: 18 };
    const pad = 10;
    const gap = 8;
    const cardsTop = heading.y + heading.height + gap;
    const cardHeight = ordered.length === 0
      ? 0
      : Math.max(1, Math.floor((rail.y + rail.height - pad - cardsTop - gap * (ordered.length - 1)) / ordered.length));
    return {
      mode: 'desktop',
      rail,
      route,
      heading,
      cards: ordered.map((record, index) => ({
        record,
        rect: { x: rail.x + pad, y: cardsTop + index * (cardHeight + gap), width: rail.width - pad * 2, height: cardHeight },
      })),
      maxScroll: 0,
    };
  }

  const railY = Math.max(130, Math.round(viewport.height * (130 / 892)));
  const footerTop = viewport.height - Math.max(54, Math.round(viewport.height * (54 / 892)));
  const rail: MapIntelRect = {
    x: 10,
    y: railY,
    width: Math.max(0, viewport.width - 20),
    height: Math.max(0, footerTop - 12 - railY),
  };
  const heading: MapIntelRect = { x: rail.x + 12, y: rail.y + 19, width: rail.width - 104, height: 18 };
  const close: MapIntelRect = { x: rail.x + rail.width - 78, y: rail.y + 10, width: 68, height: 40 };
  const mask: MapIntelRect = {
    x: rail.x + 12,
    y: rail.y + 62,
    width: rail.width - 24,
    height: Math.max(0, rail.height - 74),
  };
  const cardHeight = 92;
  const gap = 8;
  const contentHeight = ordered.length === 0 ? 0 : ordered.length * cardHeight + (ordered.length - 1) * gap;
  return {
    mode: 'mobile',
    rail,
    // The sheet intentionally owns the mobile read; the trail is paused below
    // it rather than squeezed beside it as it is on desktop.
    route: { x: 10, y: 122, width: Math.max(0, viewport.width - 20), height: Math.max(0, footerTop - 134) },
    heading,
    cards: ordered.map((record, index) => ({
      record,
      rect: { x: mask.x, y: mask.y + index * (cardHeight + gap), width: mask.width, height: cardHeight },
    })),
    mask,
    close,
    maxScroll: Math.max(0, contentHeight - mask.height),
  };
}
