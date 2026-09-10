/**
 * Shared presentation values for the brighter anime-illustrated run screens.
 * Geometry remains owned by each desktop/mobile scene; this module only keeps
 * exposure and visual-density decisions from drifting between platforms.
 */
import { UI } from '../theme';

export const BRIGHT_ART_TREATMENT = {
  start: {
    imageAlpha: 0.68,
    liftAlpha: 0.1,
    // The Start screen's localized readability treatment. Twenty-four nested
    // ellipses at 0.09 preserve the approved soft vignette while accumulating
    // to 0.896 at its center; it replaces the obsolete rectangular label plate.
    vignette: {
      layers: 24,
      layerAlpha: 0.09,
      scaleStep: 0.019,
    },
  },
  story: {
    imageAlpha: 1,
    liftAlpha: 0.06,
  },
  storefront: {
    imageAlpha: 1,
    liftAlpha: 0.16,
    idleStrokeAlpha: 0.5,
    dividerAlpha: 0.3,
  },
  map: {
    imageAlpha: 0.62,
    ambienceAlpha: 0.28,
    liftAlpha: 0.08,
  },
  chrome: {
    headerScrimAlpha: 0.72,
    // These two surfaces carry 8-10px muted/gold copy. At 0.93 they retain
    // >=4.5:1 contrast even if the underlying illustration pixel is white.
    routeScrimAlpha: 0.93,
    labelPlateAlpha: 0.93,
  },
  biome: {
    scrimAlpha: 0.26,
    textStroke: `#${UI.bg.toString(16).padStart(6, '0')}`,
    textStrokeThickness: 3,
  },
  route: {
    waveBandAlpha: 0.1,
    lineAlpha: 0.6,
  },
} as const;
