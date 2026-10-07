import type { Rect } from './runScreenTemplate';

export function layoutRunGemReward(bounds: Rect, compact: boolean): {
  panel: Rect; header: Rect; identity: Rect; art: Rect; details: Rect; continue: Rect;
} {
  const width = Math.min(bounds.width, compact ? 392 : 620);
  const height = Math.min(bounds.height, compact ? 440 : 380);
  const panel = { x: bounds.x + (bounds.width - width) / 2,
    y: bounds.y + (compact ? 0 : (bounds.height - height) / 2), width, height };
  const pad = compact ? 12 : 18;
  const innerX = panel.x + pad;
  const innerW = Math.max(0, width - pad * 2);
  const header = { x: innerX, y: panel.y + 14, width: innerW, height: 16 };
  const actionH = compact ? 44 : 40;
  const continueRect = { x: innerX, y: panel.y + height - pad - actionH, width: innerW, height: actionH };
  const bodyY = panel.y + (compact ? 154 : 130);
  const bodyH = Math.max(0, continueRect.y - 16 - bodyY);
  const artSize = Math.max(0, Math.min(compact ? 96 : 160, compact ? 96 : bodyH, innerW));
  const art = { x: innerX, y: compact ? panel.y + 44 : bodyY + (bodyH - artSize) / 2,
    width: artSize, height: artSize };
  const identity = compact
    ? { x: innerX + artSize + 12, y: panel.y + 48, width: Math.max(0, innerW - artSize - 12), height: 92 }
    : { x: innerX, y: panel.y + 44, width: innerW, height: 74 };
  const detailsX = compact ? innerX : innerX + artSize + 24;
  const details = { x: detailsX, y: bodyY, width: Math.max(0, panel.x + width - pad - detailsX), height: bodyH };
  return { panel, header, identity, art, details, continue: continueRect };
}
