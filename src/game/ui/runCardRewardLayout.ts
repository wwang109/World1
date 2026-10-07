import type { Rect } from './runScreenTemplate';

export function layoutRunCardReward(
  panel: Rect,
  header: Rect,
  compact: boolean,
): { card: Rect; identity: Rect; details: Rect; expand: Rect; continue: Rect } {
  const pad = compact ? 12 : 24;
  const gap = compact ? 8 : 20;
  const aspect = 420 / 690;
  const innerX = panel.x + Math.min(pad, panel.width / 2);
  const innerY = panel.y + Math.min(pad, panel.height / 2);
  const innerW = Math.max(0, panel.width - pad * 2);
  const innerH = Math.max(0, panel.height - pad * 2);
  const actionH = Math.min(44, innerH);
  const continueY = innerY + innerH - actionH;
  const bodyBottom = Math.max(innerY, continueY - gap);
  const headerBottom = header.y + header.height;
  const bodyTop = Math.min(bodyBottom, Math.max(innerY, headerBottom + (headerBottom > innerY ? gap : 0)));
  const bodyH = bodyBottom - bodyTop;
  const continueRect: Rect = { x: innerX, y: continueY, width: innerW, height: actionH };

  if (compact) {
    const identityH = Math.min(48, bodyH);
    const identity: Rect = { x: innerX, y: bodyTop, width: innerW, height: identityH };
    const cardTop = Math.min(bodyBottom, bodyTop + identityH + gap);
    const expandH = Math.min(44, Math.max(0, bodyBottom - cardTop));
    const cardH = Math.max(0, Math.min(280, innerW / aspect, bodyBottom - cardTop - expandH - gap * 2 - 150));
    const cardW = cardH * aspect;
    const card: Rect = { x: innerX + (innerW - cardW) / 2, y: cardTop, width: cardW, height: cardH };
    const expandW = Math.min(innerW, Math.max(144, cardW));
    const expandY = Math.min(bodyBottom - expandH, cardTop + cardH + gap);
    const expand: Rect = { x: innerX + (innerW - expandW) / 2, y: expandY, width: expandW, height: expandH };
    const detailsTop = Math.min(bodyBottom, expandY + expandH + gap);
    const details: Rect = { x: innerX, y: detailsTop, width: innerW, height: bodyBottom - detailsTop };
    return { card, identity, details, expand, continue: continueRect };
  }

  const expandH = Math.min(44, bodyH);
  const cardH = Math.max(0, Math.min(400, innerW * 0.36 / aspect, bodyH - expandH - gap));
  const cardW = cardH * aspect;
  const card: Rect = { x: innerX, y: bodyTop, width: cardW, height: cardH };
  const expand: Rect = { x: innerX, y: Math.min(bodyBottom - expandH, bodyTop + cardH + gap), width: cardW, height: expandH };
  const detailsX = Math.min(innerX + innerW, innerX + cardW + gap);
  const detailsW = Math.max(0, innerX + innerW - detailsX);
  const identityH = Math.min(80, bodyH);
  const identity: Rect = { x: detailsX, y: bodyTop, width: detailsW, height: identityH };
  const detailsTop = Math.min(bodyBottom, bodyTop + identityH + gap);
  const details: Rect = { x: detailsX, y: detailsTop, width: detailsW, height: bodyBottom - detailsTop };
  return { card, identity, details, expand, continue: continueRect };
}
