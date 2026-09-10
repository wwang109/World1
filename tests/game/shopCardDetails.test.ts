import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

import { classifyShopShelfGesture } from '../../src/game/ui/shopGestureArbitration';
import { desktopShopShelfLayout } from '../../src/game/ui/desktopShopLayout';

describe('shop Card Details redesign', () => {
  it('reserves no permanent desktop detail dock and returns its width to the shelf workspace', () => {
    const layout = desktopShopShelfLayout(1440, 24, 220, 24);

    expect(layout.right).toBe(1416);
    expect(layout.bagX + layout.columnWidth).toBe(layout.right);
    expect(layout.shelfWidth).toBeGreaterThan(850);
  });

  it('classifies a vertical swipe beginning on card art as shelf scrolling', () => {
    expect(classifyShopShelfGesture(2, -18)).toBe('scroll');
    expect(classifyShopShelfGesture(-3, 22)).toBe('scroll');
  });

  it('preserves taps and intentional lateral drag-to-buy gestures', () => {
    expect(classifyShopShelfGesture(2, 3)).toBe('pending');
    expect(classifyShopShelfGesture(20, 4)).toBe('drag');
  });

  it('names the offer modal Card Details on both platforms', () => {
    const desktop = readFileSync('src/game/scenes/DesktopShopScene.ts', 'utf8');
    const mobile = readFileSync('src/game/scenes/MobileShopScene.ts', 'utf8');

    expect(desktop).toContain('Card Details');
    expect(mobile).toContain('Card Details');
    expect(desktop).not.toContain('renderDock(shopId)');
  });
});
