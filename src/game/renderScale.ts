import Phaser from 'phaser';
import { ACTIVE_PROFILE } from './layoutProfile';

/**
 * Device-pixel-ratio rendering — the fix for blurry text.
 *
 * Phaser 3 has NO devicePixelRatio support (the old `resolution` game config
 * was removed), and `Scale.FIT` only ever restyles the canvas: the backing
 * store stays at the game's width/height while the browser stretches it. A
 * 1440x900 buffer shown at 1728x1080 CSS on a DPR-2 screen is spread across
 * 3456x2160 physical pixels — a 2.4x bilinear upscale that softens every
 * glyph edge. Bumping Text `resolution` cannot fix it: the glyph texture is
 * resampled down INTO the canvas before the browser scales the canvas up.
 *
 * So: size the backing store to the PHYSICAL pixels the canvas will occupy,
 * and zoom the camera by the same factor. Design coordinates are untouched —
 * every layout token still speaks in the profile's canvas space (1440x900 /
 * 412x892) — but the canvas now has `scale`x more real pixels to draw into,
 * so text rasterizes at native sharpness.
 *
 * Trade-off: the factor is computed once at boot. A window resized across DPR
 * boundaries (dragging between monitors) keeps the old buffer until reload,
 * which is the same behavior FIT already had.
 */

export const DESIGN = {
  width: ACTIVE_PROFILE.canvas.width,
  height: ACTIVE_PROFILE.canvas.height,
} as const;

/** Upper bound on the buffer multiplier — 3x a 1440-wide canvas is already a
 * 4320px-wide texture; beyond that the memory cost outruns the visible gain. */
const MAX_SCALE = 3;

/**
 * How many physical pixels one design pixel will occupy: the FIT ratio the
 * Scale Manager is about to apply, multiplied by the display's DPR.
 */
export function computeRenderScale(): number {
  const dpr = window.devicePixelRatio || 1;
  const host = document.getElementById('app');
  const cssW = host?.clientWidth || window.innerWidth || DESIGN.width;
  const cssH = host?.clientHeight || window.innerHeight || DESIGN.height;
  const fit = Math.min(cssW / DESIGN.width, cssH / DESIGN.height);
  const scale = fit * dpr;
  if (!Number.isFinite(scale) || scale <= 0) return 1;
  return Math.max(1, Math.min(MAX_SCALE, scale));
}

/**
 * Puts a scene's camera into design space at the given buffer scale. Must run
 * after every `create()` (including the shared rebuild idiom, which re-runs
 * create), because a fresh camera resets to zoom 1.
 */
export function applyRenderScale(scene: Phaser.Scene, scale: number): void {
  const cam = scene.cameras?.main;
  if (!cam) return;
  cam.setZoom(scale);
  // Zoom is applied about the camera midpoint, so re-centre on the design
  // rect to keep design (0,0) at the canvas's top-left corner.
  cam.centerOn(DESIGN.width / 2, DESIGN.height / 2);
}

/**
 * Wires `applyRenderScale` to every scene in the game, now and forever: each
 * scene's CREATE event fires on first start AND on every `rebuildScene`, so
 * the zoom survives the project's re-render idiom without touching a single
 * scene file.
 */
export function installRenderScale(game: Phaser.Game, scale: number): void {
  const hook = (scene: Phaser.Scene): void => {
    scene.events.on(Phaser.Scenes.Events.CREATE, () => applyRenderScale(scene, scale));
    // A scene already mid-create when we attach (the boot scene) needs it now.
    applyRenderScale(scene, scale);
  };
  for (const scene of game.scene.scenes) hook(scene);
  game.scene.scenes.length === 0
    ? game.events.once(Phaser.Core.Events.READY, () => { for (const s of game.scene.scenes) hook(s); })
    : undefined;
}
