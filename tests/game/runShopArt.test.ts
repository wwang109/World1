import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { shopTypeIds } from '../../src/data/shopTypes';
import { RUN_ART_ASSETS } from '../../src/game/ui/runArt';
import { RUN_ART_KEYS, shopArtKey } from '../../src/game/ui/runArtKeys';

const ROOT = process.cwd();
const SHOP_SCENES = ['DesktopShopScene.ts', 'MobileShopScene.ts'];

function expectedShopArtKey(shopId: string): string {
  return `run-art-shop-${shopId.replaceAll('_', '-')}`;
}

describe('shop art coverage', () => {
  it('gives every live shop its own texture key instead of the generic storefront fallback', () => {
    for (const shopId of shopTypeIds) {
      expect(shopArtKey(shopId), shopId).toBe(expectedShopArtKey(shopId));
      expect(shopArtKey(shopId), shopId).not.toBe(RUN_ART_KEYS.icon.storefront);
    }
  });

  it('preloads every live shop from its exact id-derived served path', () => {
    const loadedPaths = new Map(RUN_ART_ASSETS.map((asset) => [asset.key, asset.path]));

    for (const shopId of shopTypeIds) {
      expect(loadedPaths.get(expectedShopArtKey(shopId)), shopId).toBe(
        `/game-art/placeholders/shop-front-${shopId}.webp`,
      );
    }
  });

  it('ships the served derivative selected for every live shop', () => {
    for (const shopId of shopTypeIds) {
      const derivative = join(ROOT, 'public', 'game-art', 'placeholders', `shop-front-${shopId}.webp`);
      expect(existsSync(derivative), shopId).toBe(true);
    }
  });

  for (const scene of SHOP_SCENES) {
    it(`${scene} renders the general banner in its shelf header`, () => {
      const source = readFileSync(join(ROOT, 'src', 'game', 'scenes', scene), 'utf8');
      expect(source).toMatch(/addBrightRunArt\(this, RUN_ART_KEYS\.shopBanner, \{/);
    });
  }
});
