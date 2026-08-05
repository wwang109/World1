import Phaser from 'phaser';
import type { EventTheme } from '../../data/events';

export const RUN_ART_KEYS = {
  shopBanner: 'run-art-shop-banner',
  runMap: 'run-art-run-map',
  icon: {
    choiceCard: 'run-art-icon-choice-card',
    choiceGamble: 'run-art-icon-choice-gamble',
    choiceGem: 'run-art-icon-choice-gem',
    choiceGold: 'run-art-icon-choice-gold',
    choiceLevel: 'run-art-icon-choice-level',
    choiceNothing: 'run-art-icon-choice-nothing',
    coin: 'run-art-icon-coin',
    lifeHeart: 'run-art-icon-life-heart',
    bossSkull: 'run-art-icon-boss-skull',
    storefront: 'run-art-icon-storefront',
  } as const,
  shop: {
    armory: 'run-art-shop-armory',
    wildworks: 'run-art-shop-wildworks',
    arcanum: 'run-art-shop-arcanum',
    sanctum: 'run-art-shop-sanctum',
    alchemist: 'run-art-shop-alchemist',
    gemcutter: 'run-art-shop-gemcutter',
    caravan: 'run-art-shop-caravan',
    bulwark: 'run-art-shop-bulwark',
    assassins_den: 'run-art-shop-assassins-den',
    relic_vault: 'run-art-shop-relic-vault',
    emberworks: 'run-art-shop-emberworks',
    frosthold: 'run-art-shop-frosthold',
    stormspire: 'run-art-shop-stormspire',
    grovekeep: 'run-art-shop-grovekeep',
    reliquary: 'run-art-shop-reliquary',
    umbral_stall: 'run-art-shop-umbral-stall',
  } as const,
  event: {
    training: 'run-art-event-training',
    cache: 'run-art-event-cache',
    recruit: 'run-art-event-recruit',
    forge: 'run-art-event-forge',
    market: 'run-art-event-market',
    omen: 'run-art-event-omen',
  } satisfies Record<EventTheme, string>,
} as const;

export const RUN_ART_ASSETS = [
  { key: RUN_ART_KEYS.shopBanner, path: '/game-art/placeholders/shop-banner.png' },
  { key: RUN_ART_KEYS.runMap, path: '/game-art/placeholders/run-map.png' },
  { key: RUN_ART_KEYS.icon.choiceCard, path: '/game-art/placeholders/icon-choice-card.png' },
  { key: RUN_ART_KEYS.icon.choiceGamble, path: '/game-art/placeholders/icon-choice-gamble.png' },
  { key: RUN_ART_KEYS.icon.choiceGem, path: '/game-art/placeholders/icon-choice-gem.png' },
  { key: RUN_ART_KEYS.icon.choiceGold, path: '/game-art/placeholders/icon-choice-gold.png' },
  { key: RUN_ART_KEYS.icon.choiceLevel, path: '/game-art/placeholders/icon-choice-level.png' },
  { key: RUN_ART_KEYS.icon.choiceNothing, path: '/game-art/placeholders/icon-choice-nothing.png' },
  { key: RUN_ART_KEYS.icon.coin, path: '/game-art/placeholders/icon-coin.png' },
  { key: RUN_ART_KEYS.icon.lifeHeart, path: '/game-art/placeholders/icon-life-heart.png' },
  { key: RUN_ART_KEYS.icon.bossSkull, path: '/game-art/placeholders/icon-boss-skull.png' },
  { key: RUN_ART_KEYS.icon.storefront, path: '/game-art/placeholders/icon-storefront.png' },
  { key: RUN_ART_KEYS.shop.armory, path: '/game-art/placeholders/shop-front-armory.png' },
  { key: RUN_ART_KEYS.shop.wildworks, path: '/game-art/placeholders/shop-front-wildworks.png' },
  { key: RUN_ART_KEYS.shop.arcanum, path: '/game-art/placeholders/shop-front-arcanum.png' },
  { key: RUN_ART_KEYS.shop.sanctum, path: '/game-art/placeholders/shop-front-sanctum.png' },
  { key: RUN_ART_KEYS.shop.alchemist, path: '/game-art/placeholders/shop-front-alchemist.png' },
  { key: RUN_ART_KEYS.shop.gemcutter, path: '/game-art/placeholders/shop-front-gemcutter.png' },
  { key: RUN_ART_KEYS.shop.caravan, path: '/game-art/placeholders/shop-front-caravan.png' },
  { key: RUN_ART_KEYS.shop.bulwark, path: '/game-art/placeholders/shop-front-bulwark.png' },
  { key: RUN_ART_KEYS.shop.assassins_den, path: '/game-art/placeholders/shop-front-assassins_den.png' },
  { key: RUN_ART_KEYS.shop.relic_vault, path: '/game-art/placeholders/shop-front-relic_vault.png' },
  { key: RUN_ART_KEYS.shop.emberworks, path: '/game-art/placeholders/shop-front-emberworks.png' },
  { key: RUN_ART_KEYS.shop.frosthold, path: '/game-art/placeholders/shop-front-frosthold.png' },
  { key: RUN_ART_KEYS.shop.stormspire, path: '/game-art/placeholders/shop-front-stormspire.png' },
  { key: RUN_ART_KEYS.shop.grovekeep, path: '/game-art/placeholders/shop-front-grovekeep.png' },
  { key: RUN_ART_KEYS.shop.reliquary, path: '/game-art/placeholders/shop-front-reliquary.png' },
  { key: RUN_ART_KEYS.shop.umbral_stall, path: '/game-art/placeholders/shop-front-umbral_stall.png' },
  { key: RUN_ART_KEYS.event.training, path: '/game-art/placeholders/area-hollow-yard.png' },
  { key: RUN_ART_KEYS.event.cache, path: '/game-art/placeholders/area-silt-hollows.png' },
  { key: RUN_ART_KEYS.event.recruit, path: '/game-art/placeholders/area-muster-road.png' },
  { key: RUN_ART_KEYS.event.forge, path: '/game-art/placeholders/area-cinderworks.png' },
  { key: RUN_ART_KEYS.event.market, path: '/game-art/placeholders/area-tolling-road.png' },
  { key: RUN_ART_KEYS.event.omen, path: '/game-art/placeholders/area-crossroads-unquiet.png' },
] as const;

export function eventArtKey(theme: EventTheme): string {
  return RUN_ART_KEYS.event[theme];
}

export function shopArtKey(shopId: string): string {
  return RUN_ART_KEYS.shop[shopId as keyof typeof RUN_ART_KEYS.shop] ?? RUN_ART_KEYS.icon.storefront;
}

export function choiceArtKey(kind: string): string {
  switch (kind) {
    case 'grantCard':
    case 'bonusDraft':
    case 'upgradeCard':
      return RUN_ART_KEYS.icon.choiceCard;
    case 'grantGem':
      return RUN_ART_KEYS.icon.choiceGem;
    case 'grantGold':
    case 'loseGold':
      return RUN_ART_KEYS.icon.choiceGold;
    case 'grantLevel':
      return RUN_ART_KEYS.icon.choiceLevel;
    case 'gamble':
      return RUN_ART_KEYS.icon.choiceGamble;
    case 'nothing':
    default:
      return RUN_ART_KEYS.icon.choiceNothing;
  }
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
