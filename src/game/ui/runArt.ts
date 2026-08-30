import Phaser from 'phaser';
import { RUN_ART_KEYS } from './runArtKeys';

// The pure texture-KEY catalog and lookups (`RUN_ART_KEYS`, `eventArtKey`,
// `shopArtKey`, `choiceArtKey`) now live in `runArtKeys.ts` (no Phaser
// import, so pure view-model modules and unit tests can use them) — this
// module re-exports them so every existing `from '../ui/runArt'` call site
// is unchanged. What stays HERE is Phaser-only: the boot-time asset list and
// the actual scene renderer.
export * from './runArtKeys';

/**
 * Boot-time run art. The paths are `.webp` DERIVATIVES of the `.png` masters
 * beside them, produced by `scripts/encode-card-art.ts` (`npm run art:encode`)
 * at the masters' own dimensions — these are already authored at their draw
 * size, so only the container changed: 9.6 MB of PNG became 2.2 MB of WebP
 * with no resolution lost. Unlike card art this set stays EAGER: it is small
 * now, and the run map / shop fronts are full-bleed backdrops where a
 * placeholder would be conspicuous.
 */
export const RUN_ART_ASSETS = [
  { key: RUN_ART_KEYS.shopBanner, path: '/game-art/placeholders/shop-banner.webp' },
  { key: RUN_ART_KEYS.runMap, path: '/game-art/placeholders/run-map.webp' },
  { key: RUN_ART_KEYS.icon.choiceCard, path: '/game-art/placeholders/icon-choice-card.webp' },
  { key: RUN_ART_KEYS.icon.choiceGamble, path: '/game-art/placeholders/icon-choice-gamble.webp' },
  { key: RUN_ART_KEYS.icon.choiceGem, path: '/game-art/placeholders/icon-choice-gem.webp' },
  { key: RUN_ART_KEYS.icon.choiceGold, path: '/game-art/placeholders/icon-choice-gold.webp' },
  { key: RUN_ART_KEYS.icon.choiceLevel, path: '/game-art/placeholders/icon-choice-level.webp' },
  { key: RUN_ART_KEYS.icon.choiceNothing, path: '/game-art/placeholders/icon-choice-nothing.webp' },
  { key: RUN_ART_KEYS.icon.coin, path: '/game-art/placeholders/icon-coin.webp' },
  { key: RUN_ART_KEYS.icon.lifeHeart, path: '/game-art/placeholders/icon-life-heart.webp' },
  { key: RUN_ART_KEYS.icon.bossSkull, path: '/game-art/placeholders/icon-boss-skull.webp' },
  { key: RUN_ART_KEYS.icon.storefront, path: '/game-art/placeholders/icon-storefront.webp' },
  { key: RUN_ART_KEYS.shop.armory, path: '/game-art/placeholders/shop-front-armory.webp' },
  { key: RUN_ART_KEYS.shop.wildworks, path: '/game-art/placeholders/shop-front-wildworks.webp' },
  { key: RUN_ART_KEYS.shop.arcanum, path: '/game-art/placeholders/shop-front-arcanum.webp' },
  { key: RUN_ART_KEYS.shop.sanctum, path: '/game-art/placeholders/shop-front-sanctum.webp' },
  { key: RUN_ART_KEYS.shop.alchemist, path: '/game-art/placeholders/shop-front-alchemist.webp' },
  { key: RUN_ART_KEYS.shop.gemcutter, path: '/game-art/placeholders/shop-front-gemcutter.webp' },
  { key: RUN_ART_KEYS.shop.caravan, path: '/game-art/placeholders/shop-front-caravan.webp' },
  { key: RUN_ART_KEYS.shop.bulwark, path: '/game-art/placeholders/shop-front-bulwark.webp' },
  { key: RUN_ART_KEYS.shop.assassins_den, path: '/game-art/placeholders/shop-front-assassins_den.webp' },
  { key: RUN_ART_KEYS.shop.relic_vault, path: '/game-art/placeholders/shop-front-relic_vault.webp' },
  { key: RUN_ART_KEYS.shop.emberworks, path: '/game-art/placeholders/shop-front-emberworks.webp' },
  { key: RUN_ART_KEYS.shop.frosthold, path: '/game-art/placeholders/shop-front-frosthold.webp' },
  { key: RUN_ART_KEYS.shop.stormspire, path: '/game-art/placeholders/shop-front-stormspire.webp' },
  { key: RUN_ART_KEYS.shop.grovekeep, path: '/game-art/placeholders/shop-front-grovekeep.webp' },
  { key: RUN_ART_KEYS.shop.reliquary, path: '/game-art/placeholders/shop-front-reliquary.webp' },
  { key: RUN_ART_KEYS.shop.umbral_stall, path: '/game-art/placeholders/shop-front-umbral_stall.webp' },
  { key: RUN_ART_KEYS.event.training, path: '/game-art/placeholders/area-hollow-yard.webp' },
  { key: RUN_ART_KEYS.event.cache, path: '/game-art/placeholders/area-silt-hollows.webp' },
  { key: RUN_ART_KEYS.event.recruit, path: '/game-art/placeholders/area-muster-road.webp' },
  { key: RUN_ART_KEYS.event.forge, path: '/game-art/placeholders/area-cinderworks.webp' },
  { key: RUN_ART_KEYS.event.market, path: '/game-art/placeholders/area-tolling-road.webp' },
  { key: RUN_ART_KEYS.event.omen, path: '/game-art/placeholders/area-crossroads-unquiet.webp' },
] as const;

/** Adds a cropped image that fills the requested rect without distorting the source art. */
export function addRunArt(
  scene: Phaser.Scene,
  key: string,
  bounds: { x: number; y: number; width: number; height: number },
  alpha = 1,
): Phaser.GameObjects.Image | undefined {
  if (!scene.textures.exists(key)) return undefined;

  const source = scene.textures.get(key).getSourceImage();
  const sourceWidth = source.width;
  const sourceHeight = source.height;
  const targetRatio = bounds.width / bounds.height;
  const sourceRatio = sourceWidth / sourceHeight;
  let cropX = 0;
  let cropY = 0;
  let cropWidth = sourceWidth;
  let cropHeight = sourceHeight;

  if (sourceRatio > targetRatio) {
    cropWidth = sourceHeight * targetRatio;
    cropX = (sourceWidth - cropWidth) / 2;
  } else if (sourceRatio < targetRatio) {
    cropHeight = sourceWidth / targetRatio;
    cropY = (sourceHeight - cropHeight) / 2;
  }

  return scene.add.image(
    bounds.x + bounds.width / 2,
    bounds.y + bounds.height / 2,
    key,
  )
    .setOrigin(0.5)
    .setCrop(cropX, cropY, cropWidth, cropHeight)
    .setDisplaySize(bounds.width, bounds.height)
    .setAlpha(alpha);
}
