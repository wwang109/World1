import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('src/game/scenes/DesktopDeckBuildScene.ts', 'utf8');

describe('desktop run-context Bag HUD level affordance', () => {
  it('uses the shared level-up drawer from the HUD LV cell', () => {
    expect(source).toContain('private statPanelOpen = false;');
    expect(source).toContain('onOpenStatPanel: () => { this.statPanelOpen = true; this.rerender(); }');
    expect(source).toContain('renderRunStatPanel(this, {');
    expect(source).toContain('this.statPanelOpen || this.retireConfirmOpen');
  });
});
