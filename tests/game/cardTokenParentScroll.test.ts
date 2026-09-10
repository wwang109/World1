import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { syncCardArtMask } from '../../src/game/ui/cardTokenArtMask';
import { bindShopShelfMaskSync } from '../../src/game/ui/shopShelfScroll';

describe('CardToken art mask under parent shelf movement', () => {
  it('moves a parent and writes the child world-transform rectangle to its actual mask command', () => {
    const parent = { y: 0 };
    const commands: number[][] = [[999, 999, 1, 1]];
    const mask = {
      clear: () => { commands.length = 0; },
      fillStyle: () => undefined,
      fillRect: (x: number, y: number, width: number, height: number) => { commands.push([x, y, width, height]); },
    };
    const token = {
      localX: 120,
      localY: 260,
      syncWorldArtMask() {
        syncCardArtMask(mask, { transformPoint: () => ({ x: this.localX, y: this.localY + parent.y }) }, 180, 110);
      },
    };
    const container = { list: [token], setY(y: number) { parent.y = y; return this; } };
    bindShopShelfMaskSync(container);

    // This is the exact seam the real wheel/drag call sites use: ordinary
    // parent setY after the shelf has been bound. It cannot bypass mask sync.
    container.setY(-85);

    expect(parent.y).toBe(-85);
    expect(commands).toEqual([[30, 120, 180, 110]]);
  });

  it('pins both shop scenes to the tested shared parent-scroll integration', () => {
    for (const file of ['DesktopShopScene.ts', 'MobileShopScene.ts']) {
      const source = readFileSync(`src/game/scenes/${file}`, 'utf8');
      expect(source).toContain('bindShopShelfMaskSync(container)');
    }
  });
});
