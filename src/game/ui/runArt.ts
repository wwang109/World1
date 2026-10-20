import { artManifest, manifestLoadAssets } from '../../data/artManifest';
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
 * at the masters' own dimensions. Unlike card art this set stays EAGER: the
 * run map / shop fronts / biome panes are full-bleed backdrops where a
 * placeholder would be conspicuous.
 */
export const RUN_ART_ASSETS = manifestLoadAssets(artManifest.eager);
export const DESKTOP_RUN_ART_ASSETS = manifestLoadAssets(artManifest.eagerDesktop);

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

export function addEnemyPortrait(
  scene: Phaser.Scene,
  key: string,
  bounds: { x: number; y: number; width: number; height: number },
  alpha = 1,
): Phaser.GameObjects.Image | undefined {
  if (!scene.textures.exists(key)) return undefined;
  const source = scene.textures.get(key).getSourceImage();
  const scale = Math.min(bounds.width * 0.96 / source.width, bounds.height * 0.96 / source.height);
  return scene.add.image(bounds.x + bounds.width / 2, bounds.y + bounds.height, key)
    .setOrigin(0.5, 1).setScale(scale).setAlpha(alpha);
}

export function driftRunArt(
  scene: Phaser.Scene,
  image: Phaser.GameObjects.Image | undefined,
  bounds: { width: number; height: number },
  zoomTo = 1.06,
  duration = 9000,
): void {
  if (!image) return;
  const source = image.texture.getSourceImage();
  const base = runArtCropGeometry({ width: source.width, height: source.height }, bounds);
  scene.tweens.addCounter({
    from: 1, to: zoomTo, duration, ease: 'Sine.easeInOut', yoyo: true, repeat: -1,
    onUpdate: (tween: Phaser.Tweens.Tween) => {
      if (!image.active) return;
      const zoom = tween.getValue() ?? 1;
      const width = base.cropWidth / zoom;
      const height = base.cropHeight / zoom;
      image
        .setCrop(base.cropX + (base.cropWidth - width) / 2, base.cropY + (base.cropHeight - height) / 2, width, height)
        .setScale(base.scaleX * zoom, base.scaleY * zoom);
    },
  });
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
