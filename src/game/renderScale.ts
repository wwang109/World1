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

/**
 * Upper bound on the buffer multiplier. 3x clamped on setups that are common
 * rather than exotic — a 2560x1440 window at DPR 2 wants 3.2x, and a 1920x1080
 * one at DPR 3 wants 3.6x — leaving text just short of native there. 4x covers
 * both exactly (2560x1440 @2x lands on a 4608x2880 buffer, ~53MB RGBA) and
 * still bounds the worst case, since past ~4x the extra pixels are below the
 * resolving power of the display anyway.
 */
const MAX_SCALE = 4;

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
 * Wires `applyRenderScale` to every scene: the zoom is set from each scene's
 * CREATE event on first start, and survives the project's `rebuildScene` idiom
 * because that helper only destroys children and re-runs `create()` — it never
 * touches the camera (and does NOT re-emit CREATE). If a scene ever starts
 * resetting its own camera in `create()`, it must reapply the scale itself.
 */
export function installRenderScale(game: Phaser.Game, scale: number): void {
  const hook = (scene: Phaser.Scene): void => {
    scene.events.on(Phaser.Scenes.Events.CREATE, () => applyRenderScale(scene, scale));
    applyRenderScale(scene, scale);
  };
  // `game.scene.scenes` is ALWAYS empty here: this runs synchronously after the
  // Phaser.Game constructor, and the SceneManager only populates its list from
  // `bootQueue` on Core READY, which itself waits for DOMContentLoaded. So wait
  // for READY rather than iterating an empty list.
  game.events.once(Phaser.Core.Events.READY, () => {
    for (const scene of game.scene.scenes) hook(scene);
  });
}
