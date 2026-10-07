import type { Rect } from './runScreenTemplate';

export interface RunModalLayout { view: Rect; panel: Rect; header: Rect; body: Rect; footer: Rect }

export function runModalLayout(view: Rect, opts: {
  compact: boolean; width?: number; height?: number; footerHeight?: number; closable?: boolean;
}): RunModalLayout {
  const margin = opts.compact ? 12 : 24;
  const pad = opts.compact ? 16 : 24;
  const width = Math.min(opts.width ?? (opts.compact ? 388 : 880), view.width - margin * 2);
  const height = Math.min(opts.height ?? (opts.compact ? 740 : 650), view.height - margin * 2);
  const panel = { x: view.x + (view.width - width) / 2, y: view.y + (view.height - height) / 2, width, height };
  const header = { x: panel.x + pad, y: panel.y + pad, width: width - pad * 2 - (opts.closable ? 56 : 0), height: 32 };
  const footerHeight = Math.min(opts.footerHeight ?? 0, Math.max(0, height - 108));
  const footer = { x: panel.x + pad, y: panel.y + height - pad - footerHeight, width: width - pad * 2, height: footerHeight };
  const body = { x: panel.x + pad, y: header.y + header.height + 16, width: width - pad * 2,
    height: Math.max(0, footer.y - (footerHeight > 0 ? 12 : 0) - header.y - header.height - 16) };
  return { view, panel, header, body, footer };
}
