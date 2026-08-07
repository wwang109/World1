import Phaser from 'phaser';
import { ACTIVE_PROFILE } from './layoutProfile';
import { setViewport, viewport } from './viewport';
import { rebuildScene } from './sceneRebuild';

/**
 * Canvas sizing -- "fill the window" plus device-pixel-ratio rendering.
 *
 * ---------------------------------------------------------------------------
 * 1. FILL THE WINDOW (2026-08-06). The game ran `Phaser.Scale.FIT`, which
 *    scales the design canvas uniformly and letterboxes any window whose
 *    aspect is not the profile's. On a 2326x1199 window (aspect 1.94 against
 *    desktop's 1.60) that is 204px of black down each side -- 17.5% of the
 *    screen. It is now `Phaser.Scale.RESIZE`: the canvas is exactly the
 *    window, always. No bars, no crop.
 *
 *    RESIZE alone would make one design pixel equal one CSS pixel, which
 *    shrinks the whole UI and -- worse -- hands a 1280x720 window only
 *    1280x720 design px to lay 1440x900 of content into, guaranteeing
 *    clipping. So the UI scale lives in the CAMERA instead:
 *
 *      uiScale  = min(cssW / DESIGN.width, cssH / DESIGN.height)
 *
 *    which is EXACTLY the ratio FIT was applying -- so nothing changes
 *    apparent size -- and the design-space viewport becomes
 *
 *      cssSize / uiScale   >=  DESIGN  on both axes, always
 *
 *    with one axis at its design minimum and the other extended. That is the
 *    contract `viewport.ts` documents and that the scenes rely on: no scene
 *    ever gets LESS room than it had under FIT, design (0,0) stays the
 *    canvas's top-left pixel, and only right/bottom/centre-anchored geometry
 *    has to become dynamic.
 *
 * ---------------------------------------------------------------------------
 * 2. DEVICE PIXELS (the earlier blurry-text fix, preserved). Phaser 3 has no
 *    devicePixelRatio support, and in RESIZE mode it sizes the canvas backing
 *    store from the parent element's bounding rect -- i.e. CSS pixels -- which
 *    on a DPR-2 display is a 2x browser upscale of every glyph. Text
 *    `resolution` cannot rescue that (the glyph texture is resampled INTO the
 *    canvas before the browser scales the canvas up).
 *
 *    So `installFillHost` sizes the PARENT element to `window x DPR` physical
 *    pixels and pins the canvas itself to `100vw x 100vh` with CSS. Phaser
 *    therefore builds a full-density backing store, while the canvas still
 *    displays at exactly the window size. Phaser's own input maths stays
 *    correct without help: `displayScale` is derived from
 *    `baseSize / canvas.getBoundingClientRect()`, which is precisely DPR.
 */

export const DESIGN = {
  width: ACTIVE_PROFILE.canvas.width,
  height: ACTIVE_PROFILE.canvas.height,
} as const;

/**
 * Upper bound on the backing-store multiplier, so an exotic DPR cannot ask for
 * an unbounded buffer. Past ~3x the extra pixels are below the resolving power
 * of the display anyway.
 */
const MAX_DPR = 3;

/** Physical pixels per CSS pixel -- the backing-store density. */
export function devicePixels(): number {
  const dpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1;
  if (!Number.isFinite(dpr) || dpr <= 0) return 1;
  return Math.max(1, Math.min(MAX_DPR, dpr));
}

/** The CSS size the canvas fills -- the browser window. */
function cssSize(): { width: number; height: number } {
  const host = typeof document === 'undefined' ? null : document.getElementById('app');
  const width = window.innerWidth || host?.clientWidth || DESIGN.width;
  const height = window.innerHeight || host?.clientHeight || DESIGN.height;
  return { width, height };
}

/**
 * Design pixels per CSS pixel. Identical to the ratio `Scale.FIT` used to
 * apply, which is what keeps type and art at the size they are today -- we
 * grow INTO the letterbox rather than shrinking the art to fit more on screen.
 */
export function uiScale(): number {
  const { width, height } = cssSize();
  const scale = Math.min(width / DESIGN.width, height / DESIGN.height);
  return Number.isFinite(scale) && scale > 0 ? scale : 1;
}

/**
 * Sizes the Phaser parent to physical pixels and pins the canvas to the
 * window. Must run BEFORE `new Phaser.Game` so the very first parent size
 * Phaser reads is already the full-density one. Returns the sizing hook so the
 * caller can re-run it on window resize.
 */
export function installFillHost(): () => void {
  const host = document.getElementById('app');
  if (!host) return () => {};
  host.style.position = 'fixed';
  host.style.left = '0';
  host.style.top = '0';
  host.style.overflow = 'hidden';
  // The canvas is pinned to the VISUAL window while its backing store follows
  // the (DPR-inflated) parent -- see the module doc, part 2.
  const style = document.createElement('style');
  style.textContent = '#app > canvas { position: fixed; left: 0; top: 0; width: 100vw; height: 100vh; }';
  document.head.appendChild(style);

  const size = (): void => {
    const dpr = devicePixels();
    const { width, height } = cssSize();
    host.style.width = String(Math.round(width * dpr)) + 'px';
    host.style.height = String(Math.round(height * dpr)) + 'px';
    publishViewport();
  };
  size();
  return size;
}

/**
 * Publishes the design viewport straight from the WINDOW, with no dependency
 * on the Scale Manager.
 *
 * This is what makes `SCREEN.width`/`SCREEN.height` correct for the very first
 * thing that draws. `BootScene` builds its loading UI in `preload()`, which
 * Phaser runs BEFORE it emits Core READY -- so a viewport published only from
 * `syncViewport(game)` (a READY listener) would still read the design size at
 * that moment, and the loading wordmark would centre on 1440/2 inside a
 * 1746-wide viewport. Publishing here, from `installFillHost` (which main.ts
 * calls before `new Phaser.Game`), removes that ordering hazard entirely.
 */
export function publishViewport(): void {
  const zoom = uiScale();
  if (zoom <= 0) return;
  const { width, height } = cssSize();
  setViewport({ width: width / zoom, height: height / zoom });
}

/**
 * Republishes the live design viewport from the Scale Manager's CURRENT
 * backing-store size. `baseSize` is physical pixels; dividing by the camera
 * zoom converts it to the design coordinates scenes lay out in.
 */
export function syncViewport(game: Phaser.Game): void {
  const base = game.scale?.baseSize;
  const zoom = uiScale() * devicePixels();
  if (!base || zoom <= 0) return;
  setViewport({ width: base.width / zoom, height: base.height / zoom });
}

/**
 * Puts a scene's camera into design space. Must run after every `create()`
 * (including the shared rebuild idiom, which re-runs create), because a fresh
 * camera resets to zoom 1.
 *
 * Centres on the LIVE viewport, not on `DESIGN`: the camera is now as wide as
 * the window, so centring on the (smaller) design rect would push design (0,0)
 * inward by half the slack and re-create a letterbox in reverse.
 */
export function applyRenderScale(scene: Phaser.Scene): void {
  const cam = scene.cameras?.main;
  if (!cam) return;
  // Re-size the camera to the CURRENT backing store FIRST. Phaser does this
  // too (CameraManager.onResize), but on its own RESIZE listener -- and this
  // module's listener is registered on `game.scale` before any scene has
  // booted, so ours runs FIRST. `centerOn` derives scroll from `camera.width`,
  // so centring against the pre-resize width left every scene's world origin
  // offset by half the size change: the header scrolled off the top of the
  // screen and the content hung off the left edge. Setting the size here makes
  // this function correct regardless of listener order.
  const base = scene.scale?.baseSize;
  if (base && base.width > 0 && base.height > 0) cam.setSize(base.width, base.height);
  cam.setZoom(uiScale() * devicePixels());
  const v = viewport();
  cam.centerOn(v.width / 2, v.height / 2);
}

/**
 * Wires `applyRenderScale` to every scene: the camera is set from each scene's
 * CREATE event on first start, and survives the project's `rebuildScene` idiom
 * because that helper only destroys children and re-runs `create()` -- it
 * never touches the camera (and does NOT re-emit CREATE). If a scene ever
 * starts resetting its own camera in `create()`, it must reapply the scale
 * itself.
 *
 * Also owns LIVE RESIZING. Phaser resizes the canvas and every camera by
 * itself; what it cannot do is re-run a scene's layout, and under this model
 * the viewport a scene laid out against has genuinely changed. So: republish
 * the viewport, re-centre the cameras, and re-render whatever is on screen
 * through the project's standard `rebuildScene` idiom -- the same call every
 * scene already makes on any state change, so no scene needs new code of its
 * own to become resizable.
 */
export function installRenderScale(game: Phaser.Game): void {
  const hook = (scene: Phaser.Scene): void => {
    scene.events.on(Phaser.Scenes.Events.CREATE, () => applyRenderScale(scene));
    applyRenderScale(scene);
  };
  // `game.scene.scenes` is ALWAYS empty here: this runs synchronously after the
  // Phaser.Game constructor, and the SceneManager only populates its list from
  // `bootQueue` on Core READY, which itself waits for DOMContentLoaded. So wait
  // for READY rather than iterating an empty list.
  game.events.once(Phaser.Core.Events.READY, () => {
    syncViewport(game);
    for (const scene of game.scene.scenes) hook(scene);
  });

  let lastW = viewport().width;
  let lastH = viewport().height;
  game.scale.on(Phaser.Scale.Events.RESIZE, () => {
    syncViewport(game);
    const v = viewport();
    // The camera is re-applied on EVERY resize, but the scene is only re-laid
    // out when the DESIGN viewport actually changed. Those are genuinely two
    // different conditions and conflating them is a bug: the camera zoom
    // tracks the BUFFER (physical pixels), the layout tracks the VIEWPORT
    // (design pixels), and the buffer can change while the viewport does not.
    // 1920x1080 and 1280x720 are the same 1600x900 design viewport but need
    // zoom 1.2 and 0.8 respectively -- skipping the camera there left the UI
    // rendered at the previous window's scale. Conversely, rebuilding when the
    // viewport has NOT changed would throw away scene state and replay art
    // fades for nothing (Phaser also emits RESIZE on boot and on parent-bounds
    // jitter).
    const viewportChanged = v.width !== lastW || v.height !== lastH;
    lastW = v.width;
    lastH = v.height;
    for (const scene of game.scene.getScenes(true)) {
      applyRenderScale(scene);
      if (viewportChanged) relayoutScene(scene);
    }
  });
}

/**
 * Re-lays-out one running scene for a new viewport.
 *
 * `rebuildScene` stamps `input.activePointer.event` so a rebuild triggered
 * from inside a pointer handler cannot have that same physical click
 * re-dispatched into the freshly-built content (see `sceneRebuild.ts`). A
 * resize-driven rebuild is NOT inside a pointer dispatch, so it stamps some
 * older, already-finished event -- which is exactly the harmless case that
 * guard is built for: `wasPointerConsumedByRebuild` compares Event OBJECT
 * identity, and no future click can ever produce a `===`-equal event, so a
 * stale stamp can only ever fail to match. Nothing to special-case here.
 *
 * Wrapped because a resize is a cosmetic event: a scene whose `create()`
 * throws mid-resize must not take the RESIZE handler -- and therefore every
 * other scene's relayout -- down with it.
 */
function relayoutScene(scene: Phaser.Scene): void {
  const withCreate = scene as Phaser.Scene & { create?: () => void };
  if (typeof withCreate.create !== 'function') return;
  try {
    rebuildScene(withCreate as Phaser.Scene & { create: () => void });
  } catch (err) {
    console.warn('[renderScale] relayout failed for', scene.scene?.key, err);
  }
}
