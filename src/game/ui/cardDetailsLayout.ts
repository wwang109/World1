export interface DetailsRect { x: number; y: number; width: number; height: number }
export type CardDetailsPresentation = 'default' | 'mobile-shop';

/** Coordinates are in the scene camera's visible world area, including embedded shops. */
export function cardDetailsLayout(view: DetailsRect, compact: boolean, presentation: CardDetailsPresentation = 'default') {
  const margin = compact ? 6 : 12;
  const width = compact ? view.width - margin * 2 : Math.min(1240, view.width * 0.88);
  const height = compact ? view.height - margin * 2 : Math.min(720, view.height - margin * 2);
  const pane = { x: view.x + (view.width - width) / 2, y: view.y + (view.height - height) / 2, width, height };
  const pad = compact ? 14 : 24;
  const headerHeight = compact ? 52 : 74;
  const footerHeight = compact ? 64 : 82;
  const body = { x: pane.x + pad, y: pane.y + headerHeight, width: width - pad * 2, height: pane.height - headerHeight - footerHeight - 12 };
  const footer = { x: pane.x + pad, y: pane.y + pane.height - footerHeight + 12, width: body.width, height: 44 };
  if (compact && presentation === 'mobile-shop') {
    const cardWidth = Math.min(150, Math.max(82, Math.min(body.width * 0.38, body.height * 0.35 / (690 / 420))));
    const cardHeight = cardWidth * (690 / 420);
    const card = { x: body.x, y: body.y, width: cardWidth, height: cardHeight };
    const identity = { x: card.x + card.width + 12, y: card.y, width: body.width - card.width - 12, height: card.height };
    const infoY = card.y + card.height + 12;
    const info = { x: body.x, y: infoY, width: body.width, height: Math.max(80, footer.y - infoY - 8) };
    const preview = { x: identity.x, y: identity.y, width: identity.width, height: 0 };
    return { pane, body, card, identity, info, keywords: info, preview, rankButtons: [], footer, compact, short: view.height < 650 };
  }
  const short = compact && view.height < 650;
  const cardWidth = short ? 86 : compact ? 150 : Math.min(280, body.width * 0.30, (body.height - 100) / (690 / 420));
  const cardHeight = cardWidth * (690 / 420);
  const card = { x: compact && !short ? body.x + (body.width - cardWidth) / 2 : body.x, y: body.y, width: cardWidth, height: cardHeight };
  const info = compact
    ? { x: body.x, y: card.y + card.height + 16, width: body.width, height: body.height - card.height - 16 }
    : { x: card.x + card.width + 24, y: body.y, width: body.width - card.width - 24, height: body.height };
  const identity = { ...info };
  const preview = short
    ? { x: card.x + card.width + 14, y: body.y, width: body.width - card.width - 14, height: 136 }
    : { x: info.x, y: info.y, width: info.width, height: compact ? 80 : 70 };
  if (!short) { info.y += preview.height + 12; info.height -= preview.height + 12; }
  const columns = short ? 2 : 4;
  const buttonWidth = (preview.width - 16 - (columns - 1) * 6) / columns;
  const rankButtons = Array.from({ length: 4 }, (_, index) => ({
    x: preview.x + 8 + index % columns * (buttonWidth + 6),
    y: preview.y + 24 + Math.floor(index / columns) * 56,
    width: buttonWidth, height: compact ? 50 : 40,
  }));
  return { pane, body, card, identity, info, keywords: info, preview, rankButtons, footer, compact, short };
}
