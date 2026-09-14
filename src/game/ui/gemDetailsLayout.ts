import type { DetailsRect } from './cardDetailsLayout';

/** Content-sized gem inspector in the camera's visible world area. */
export function gemDetailsLayout(view: DetailsRect, compact: boolean, contentHeight: number) {
  const pad = compact ? 14 : 20;
  const width = Math.min(620, view.width - 12);
  const header = 58;
  const footerHeight = compact ? 70 : 66;
  const height = Math.min(view.height - 12, Math.max(280, header + contentHeight + footerHeight + 12));
  const pane = { x: view.x + (view.width - width) / 2, y: view.y + (view.height - height) / 2, width, height };
  const body = { x: pane.x + pad, y: pane.y + header, width: width - pad * 2, height: height - header - footerHeight - 12 };
  const artWidth = compact ? 88 : 110;
  const art = { x: 0, y: 0, width: artWidth, height: artWidth };
  const info = { x: artWidth + 18, y: 0, width: body.width - artWidth - 30, height: 0 };
  const footer = { x: pane.x + pad, y: pane.y + height - footerHeight, width: body.width, height: compact ? 50 : 44 };
  return { pane, body, art, info, footer };
}
