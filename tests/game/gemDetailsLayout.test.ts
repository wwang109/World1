import { describe, expect, it } from 'vitest';
import { gemDetailsLayout } from '../../src/game/ui/gemDetailsLayout';

describe('compact gem detail geometry', () => {
  it.each([[1440, 900, false], [412, 892, true], [496, 892, true], [376, 443, true], [372, 436, true]] as const)('contains long content and fixed actions in %ix%i', (width, height, compact) => {
    const layout = gemDetailsLayout({ x: 10, y: 40, width, height }, compact, 1200);
    expect(layout.pane.x).toBeGreaterThanOrEqual(10);
    expect(layout.pane.y).toBeGreaterThanOrEqual(40);
    expect(layout.pane.x + layout.pane.width).toBeLessThanOrEqual(width + 10);
    expect(layout.pane.y + layout.pane.height).toBeLessThanOrEqual(height + 40);
    expect(layout.body.y + layout.body.height).toBeLessThan(layout.footer.y);
    expect(layout.body.height).toBeGreaterThan(200);
    expect(layout.footer.height).toBeGreaterThanOrEqual(compact ? 50 : 40);
    expect(layout.info.width).toBeGreaterThanOrEqual(180);
    expect(layout.art.width).toBeLessThanOrEqual(120);
  });
  it('sizes a short desktop summary to content, not the tall viewport', () => {
    const layout = gemDetailsLayout({ x: 0, y: 0, width: 1440, height: 900 }, false, 140);
    expect(layout.pane.width).toBeGreaterThanOrEqual(540);
    expect(layout.pane.width).toBeLessThanOrEqual(620);
    expect(layout.pane.height).toBeGreaterThanOrEqual(280);
    expect(layout.pane.height).toBeLessThanOrEqual(320);
  });
});
