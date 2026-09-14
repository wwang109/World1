import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  mobileDraftActions,
  mobileDraftLayout,
  resolveBrowserViewportSize,
  type MobileDraftActionId,
} from '../../src/game/ui/mobileDraftLayout';

const ids = (setIndex: number, currentPicked: boolean, ready = false): MobileDraftActionId[] =>
  mobileDraftActions(setIndex, currentPicked, ready).map((action) => action.id);

describe('mobile draft: approved phone composition', () => {
  it.each([false, true])('grows all five rows with taller internal viewport and consumes slack (run=%s)', run => {
    const layouts = [892, 1000, 1100].map(height => mobileDraftLayout(412, height, run));
    expect(layouts[1]!.cards[0]!.h).toBeGreaterThan(layouts[0]!.cards[0]!.h);
    expect(layouts[2]!.cards[0]!.h).toBeGreaterThan(layouts[1]!.cards[0]!.h);
    for (const layout of layouts) {
      const bottom = layout.picks[0]!.name.y + layout.picks[0]!.name.h;
      expect(layout.footer.y - bottom).toBeGreaterThanOrEqual(12);
      expect(layout.footer.y - bottom).toBeLessThan(20);
    }
  });
  it.each([[412, 740], [496, 892], [412, 892], [412, 1100]])('keeps rows, picks and footer separated at internal %ix%i', (width, height) => {
    const layout = mobileDraftLayout(width, height, true);
    expect(layout.cards[0]!.h).toBeGreaterThanOrEqual(48);
    expect(layout.cards.at(-1)!.y + layout.cards.at(-1)!.h).toBeLessThan(layout.picksTitleY);
    expect(layout.picks.every(pick => pick.name.y + pick.name.h <= layout.footer.y - 12)).toBe(true);
    expect(layout.footer.y + layout.footer.h).toBeLessThanOrEqual(height - 10);
  });
  it('keeps five existing card rows, YOUR PICKS, and the footer separated at 412x892', () => {
    const layout = mobileDraftLayout(412, 892);
    expect(layout.cards).toHaveLength(5);
    expect(layout.picks).toHaveLength(4);
    expect(layout.cards[0]).toMatchObject({ x: 10, w: 392 });
    expect(layout.cards.at(-1)!.y + layout.cards.at(-1)!.h).toBeLessThan(layout.picksTitleY);
    expect(layout.picks.every((pick) => pick.name.y + pick.name.h <= layout.footer.y - 12)).toBe(true);
    expect(layout.footer.y + layout.footer.h).toBeLessThanOrEqual(892 - 10);
  });

  it('reserves the existing sandbox tabs and the taller run HUD before laying out draft content', () => {
    const sandbox = mobileDraftLayout(412, 892, false);
    const run = mobileDraftLayout(412, 892, true);
    expect(sandbox.header.top).toBeGreaterThanOrEqual(50);
    expect(run.header.top).toBeGreaterThanOrEqual(100);
    expect(run.cards[0]!.y).toBeGreaterThan(sandbox.cards[0]!.y);
    expect(run.picks.every((pick) => pick.name.y + pick.name.h <= run.footer.y - 12)).toBe(true);
  });

  it('allocates each picked card a dedicated art tile and a separate two-line full-name area', () => {
    const layout = mobileDraftLayout(412, 892, false);
    for (const pick of layout.picks) {
      expect(pick.art.w).toBeGreaterThanOrEqual(90);
      expect(pick.art.h).toBeGreaterThanOrEqual(48);
      expect(pick.name).toMatchObject({ w: pick.art.w, h: 24 });
      expect(pick.name.y).toBeGreaterThan(pick.art.y + pick.art.h);
    }
  });

  it('keeps all controls in the design viewport that is scaled into a short 412x740 visual viewport', () => {
    const layout = mobileDraftLayout(412, 892);
    const scale = Math.min(412 / 412, 740 / 892);
    expect((layout.footer.y + layout.footer.h) * scale).toBeLessThanOrEqual(740);
    expect(layout.footer.h * scale).toBeGreaterThanOrEqual(39);
  });
});

describe('mobile draft: surrounding context and summary renderer contracts', () => {
  const source = readFileSync(resolve(process.cwd(), 'src/game/scenes/MobileDraftScene.ts'), 'utf8');

  it('keeps the sandbox navigation and run-context shared HUD branches', () => {
    expect(source).toContain("if (this.runContext)");
    expect(source).toContain("renderRunHud(this, { screen: 'DRAFT'");
    expect(source).toContain('this.renderTabs();');
    expect(source).toContain("['MENU', false");
    expect(source).toContain("['DRAFT', true");
  });

  it('uses real card art plus a separate wrapped name in YOUR PICKS, never a miniature CardToken', () => {
    const start = source.indexOf('  private renderPicks(): void {');
    const end = source.indexOf('\n  /** Read-only card detail', start);
    const body = source.slice(start, end);
    expect(body).toContain('buildCardArtPlaceholder');
    expect(body).toContain('whenCardArtReady');
    expect(body).toContain('wordWrap: { width: box.name.w }');
    expect(body).not.toContain('new CardToken');
  });
});

describe('mobile draft: browser-safe canvas', () => {
  it('uses the visible phone viewport instead of the taller layout viewport hidden by browser chrome', () => {
    expect(resolveBrowserViewportSize({
      innerWidth: 412,
      innerHeight: 892,
      visualViewport: { width: 412, height: 740, offsetLeft: 0, offsetTop: 72 },
    }, true)).toEqual({ width: 412, height: 740, left: 0, top: 72 });
  });

  it('keeps desktop on the stable layout viewport even when VisualViewport exists', () => {
    expect(resolveBrowserViewportSize({
      innerWidth: 1440,
      innerHeight: 900,
      visualViewport: { width: 1400, height: 860, offsetLeft: 20, offsetTop: 20 },
    }, false)).toEqual({ width: 1440, height: 900, left: 0, top: 0 });
  });

  it('removes phone safe-area insets from the drawable visual viewport', () => {
    expect(resolveBrowserViewportSize({
      innerWidth: 412,
      innerHeight: 892,
      visualViewport: { width: 412, height: 820, offsetLeft: 0, offsetTop: 0 },
    }, true, { top: 0, right: 0, bottom: 34, left: 0 })).toEqual({
      width: 412,
      height: 786,
      left: 0,
      top: 0,
    });
  });
});

describe('mobile draft: gated navigation and final-only reroll', () => {
  it.each([0, 1, 2])('set %i never renders REROLL', (setIndex) => {
    expect(ids(setIndex, true)).not.toContain('reroll');
  });

  it('NEXT stays visible but disabled until the current set has a pick', () => {
    const blocked = mobileDraftActions(1, false, false).find((action) => action.id === 'next');
    const enabled = mobileDraftActions(1, true, false).find((action) => action.id === 'next');
    expect(blocked).toMatchObject({ label: 'NEXT', enabled: false });
    expect(enabled).toMatchObject({ label: 'NEXT', enabled: true });
  });

  it('set 4 renders BACK, REROLL, and disabled START until all four picks exist', () => {
    expect(ids(3, true, false)).toEqual(['back', 'reroll', 'start']);
    expect(mobileDraftActions(3, true, false).at(-1)).toMatchObject({ label: 'START RUN', enabled: false });
    expect(mobileDraftActions(3, true, true).at(-1)).toMatchObject({ label: 'START RUN', enabled: true });
  });
});
