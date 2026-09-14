import { describe, expect, it } from 'vitest';
import { cardDetailsLayout } from '../../src/game/ui/cardDetailsLayout';

describe('card details visible viewport layout', () => {
  it.each([[392, 438], [412, 740], [412, 892]])('uses the approved Mobile Shop hero and fixed footer at %ix%i', (width, height) => {
    const layout = cardDetailsLayout({ x: 0, y: 0, width, height }, true, 'mobile-shop');
    expect(layout.card.x + layout.card.width).toBeLessThan(layout.identity.x);
    expect(layout.card.y).toBe(layout.identity.y);
    expect(layout.identity.width).toBeGreaterThan(layout.card.width);
    expect(layout.info.y).toBeGreaterThan(layout.card.y + layout.card.height);
    expect(layout.preview.height).toBe(0);
    expect(layout.footer.y + layout.footer.height).toBeLessThan(height);
  });
  it.each([[376, 443], [372, 436]])('reserves readable keywords above the footer in actual compact host %ix%i', (width, height) => {
    const layout = cardDetailsLayout({ x: 0, y: 0, width, height }, true);
    expect(layout.short).toBe(true);
    expect(layout.preview.x).toBeGreaterThan(layout.card.x + layout.card.width);
    expect(layout.info.y).toBeGreaterThan(layout.card.y + layout.card.height);
    expect(layout.info.height).toBeGreaterThanOrEqual(120);
    expect(layout.info.y + layout.info.height).toBeLessThan(layout.footer.y);
  });
  it.each([[1440, 900], [1120, 600], [860, 600], [1920, 1080]])('keeps desktop %ix%i context visible with card and definitions alongside', (width, height) => {
    const layout = cardDetailsLayout({ x: 0, y: 0, width, height }, false);
    expect(layout.pane.width).toBeGreaterThanOrEqual(Math.min(1240, width * 0.8));
    expect(layout.pane.x + layout.pane.width).toBeLessThan(width);
    expect(layout.info.x).toBeGreaterThan(layout.card.x + layout.card.width);
    expect(layout.info.width).toBeGreaterThan(400);
    expect(layout.info.height).toBeGreaterThanOrEqual(300);
    expect(layout.card.y + layout.card.height).toBeLessThan(layout.footer.y);
    expect(layout.footer.y + layout.footer.height).toBeLessThan(height);
  });
  it.each([[1440, 900, false], [412, 892, true], [496, 892, true], [372, 436, true]])('fits four rank buttons outside the content mask at %ix%i', (width, height, compact) => {
    const layout = cardDetailsLayout({ x: 0, y: 0, width: width as number, height: height as number }, compact as boolean);
    expect(layout.rankButtons).toHaveLength(4);
    for (const button of layout.rankButtons) {
      expect(button.height).toBeGreaterThanOrEqual(compact ? 50 : 40);
      expect(button.y + button.height).toBeLessThanOrEqual(layout.preview.y + layout.preview.height);
      expect(button.x + button.width).toBeLessThanOrEqual(layout.preview.x + layout.preview.width);
    }
    expect(layout.preview.y + layout.preview.height).toBeLessThan(layout.info.y);
  });
  it.each([[412, 892], [412, 740], [496, 892], [412, 1100]])('keeps compact %ix%i card and identity side by side with full-width keywords', (width, height) => {
    const layout = cardDetailsLayout({ x: 0, y: 230, width, height }, true);
    expect(layout.info.y).toBeGreaterThan(layout.card.y + layout.card.height);
    expect(layout.info.x).toBe(layout.body.x);
    expect(layout.info.width).toBe(layout.body.width);
    expect(layout.card.width).toBeGreaterThan(90);
    expect(layout.info.height).toBeGreaterThanOrEqual(200);
    expect(layout.footer.y + layout.footer.height).toBeLessThan(230 + height);
    expect(layout.pane.y).toBeGreaterThan(230);
  });
});
