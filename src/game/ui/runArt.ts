import Phaser from 'phaser';
import { UI } from '../theme';
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
 * in `art-src/placeholders/` (non-served — `vite build` copies `public/`
 * verbatim), produced by `scripts/encode-card-art.ts` (`npm run art:encode`)
 * at the masters' own dimensions — these are already authored at their draw
 * size, so only the container changed: the current 53-master group is 19.6 MB
 * of PNG and 3.0 MB of WebP (84.9% smaller) with no resolution lost. Unlike
 * card art this set stays EAGER: it is small
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
  { key: RUN_ART_KEYS.shop.swordwright, path: '/game-art/placeholders/shop-front-swordwright.webp' },
  { key: RUN_ART_KEYS.shop.cleaving_yard, path: '/game-art/placeholders/shop-front-cleaving_yard.webp' },
  { key: RUN_ART_KEYS.shop.lancers_rest, path: '/game-art/placeholders/shop-front-lancers_rest.webp' },
  { key: RUN_ART_KEYS.shop.fletchers_loft, path: '/game-art/placeholders/shop-front-fletchers_loft.webp' },
  { key: RUN_ART_KEYS.shop.beastmoot, path: '/game-art/placeholders/shop-front-beastmoot.webp' },
  { key: RUN_ART_KEYS.biome.arrowfell, path: '/game-art/placeholders/biome-arrowfell.webp' },
  { key: RUN_ART_KEYS.biome.duskbarrow, path: '/game-art/placeholders/biome-duskbarrow.webp' },
  { key: RUN_ART_KEYS.biome.emberwaste, path: '/game-art/placeholders/biome-emberwaste.webp' },
  { key: RUN_ART_KEYS.biome.frostmarch, path: '/game-art/placeholders/biome-frostmarch.webp' },
  { key: RUN_ART_KEYS.biome.hallowfield, path: '/game-art/placeholders/biome-hallowfield.webp' },
  { key: RUN_ART_KEYS.biome.howlmoor, path: '/game-art/placeholders/biome-howlmoor.webp' },
  { key: RUN_ART_KEYS.biome.ironmoot, path: '/game-art/placeholders/biome-ironmoot.webp' },
  { key: RUN_ART_KEYS.biome.pikewold, path: '/game-art/placeholders/biome-pikewold.webp' },
  { key: RUN_ART_KEYS.biome.stormreach, path: '/game-art/placeholders/biome-stormreach.webp' },
  { key: RUN_ART_KEYS.biome.swornhold, path: '/game-art/placeholders/biome-swornhold.webp' },
  { key: RUN_ART_KEYS.biome.thornwild, path: '/game-art/placeholders/biome-thornwild.webp' },
  { key: RUN_ART_KEYS.event.training, path: '/game-art/placeholders/area-hollow-yard.webp' },
  { key: RUN_ART_KEYS.event.cache, path: '/game-art/placeholders/area-silt-hollows.webp' },
  { key: RUN_ART_KEYS.event.recruit, path: '/game-art/placeholders/area-muster-road.webp' },
  { key: RUN_ART_KEYS.event.forge, path: '/game-art/placeholders/area-cinderworks.webp' },
  { key: RUN_ART_KEYS.event.market, path: '/game-art/placeholders/area-tolling-road.webp' },
  { key: RUN_ART_KEYS.event.omen, path: '/game-art/placeholders/area-crossroads-unquiet.webp' },
  { key: RUN_ART_KEYS.eventStory.bell_beneath_ice, path: '/game-art/placeholders/event-bell-beneath-ice.webp' },
  { key: RUN_ART_KEYS.eventStory.second_toll, path: '/game-art/placeholders/event-second-toll.webp' },
  { key: RUN_ART_KEYS.eventStory.bell_unbound, path: '/game-art/placeholders/event-bell-unbound.webp' },
] as const;

export interface RunArtCropGeometry {
  cropX: number;
  cropY: number;
  cropWidth: number;
  cropHeight: number;
  scaleX: number;
  scaleY: number;
}

/** Pure "cover" geometry. Phaser's `setDisplaySize()` measures the original
 * texture, not the active crop, so using it after `setCrop()` shrinks portrait
 * crops into a narrow strip. Scaling from the cropped dimensions guarantees
 * that the visible pixels fill the requested frame on either platform. */
export function runArtCropGeometry(
  source: { width: number; height: number },
  target: { width: number; height: number },
): RunArtCropGeometry {
  const targetRatio = target.width / target.height;
  const sourceRatio = source.width / source.height;
  let cropX = 0;
  let cropY = 0;
  let cropWidth = source.width;
  let cropHeight = source.height;

  if (sourceRatio > targetRatio) {
    cropWidth = source.height * targetRatio;
    cropX = (source.width - cropWidth) / 2;
  } else if (sourceRatio < targetRatio) {
    cropHeight = source.width / targetRatio;
    cropY = (source.height - cropHeight) / 2;
  }

  return {
    cropX,
    cropY,
    cropWidth,
    cropHeight,
    scaleX: target.width / cropWidth,
    scaleY: target.height / cropHeight,
  };
}

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
  const geometry = runArtCropGeometry(
    { width: sourceWidth, height: sourceHeight },
    { width: bounds.width, height: bounds.height },
  );

  return scene.add.image(
    bounds.x + bounds.width / 2,
    bounds.y + bounds.height / 2,
    key,
  )
    .setOrigin(0.5)
    .setCrop(geometry.cropX, geometry.cropY, geometry.cropWidth, geometry.cropHeight)
    .setScale(geometry.scaleX, geometry.scaleY)
    .setAlpha(alpha);
}

interface BrightArtTreatment {
  imageAlpha: number;
  liftAlpha: number;
}

/** Draws one stable bright-art stack: illustration first, faint pale wash
 * second. Scenes cannot accidentally put a dark veil back over the asset. */
export function addBrightRunArt(
  scene: Phaser.Scene,
  key: string,
  bounds: { x: number; y: number; width: number; height: number },
  treatment: BrightArtTreatment,
): { image: Phaser.GameObjects.Image | undefined; lift: Phaser.GameObjects.Rectangle } {
  const image = addRunArt(scene, key, bounds, treatment.imageAlpha);
  const lift = scene.add.rectangle(bounds.x, bounds.y, bounds.width, bounds.height, UI.artLift, treatment.liftAlpha)
    .setOrigin(0, 0);
  return { image, lift };
}
