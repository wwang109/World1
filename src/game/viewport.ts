/**
 * The LIVE design-space viewport — how much design-coordinate room the current
 * browser window actually offers.
 *
 * WHY THIS EXISTS. The game used to run `Phaser.Scale.FIT`, which scales the
 * whole canvas uniformly and letterboxes anything whose aspect is not the
 * profile's. On a 2326x1199 window (aspect 1.94 vs desktop's 1.60) that is
 * 204px of black on each side — 17.5% of the window. The fix is
 * `Phaser.Scale.EXPAND` (main.ts): the canvas fills the window, the axis with
 * slack GROWS, and the other stays pinned at its design size.
 *
 * The contract EXPAND gives us, and that this module exposes:
 *
 *   width  >= ACTIVE_PROFILE.canvas.width
 *   height >= ACTIVE_PROFILE.canvas.height
 *   exactly one axis is (normally) at its design minimum; the other extends
 *   design (0,0) is ALWAYS the canvas's top-left pixel
 *
 * That is what makes this a safe conversion rather than a rewrite:
 * - no scene ever gets LESS space than it had under FIT, so nothing that fits
 *   today can start overflowing;
 * - every top-left-anchored coordinate is unchanged;
 * - the UI scale (and therefore type size) is identical to what FIT produced —
 *   we grow INTO the letterbox, we do not shrink the art to fit more in.
 *
 * Only right-, bottom- and centre-anchored geometry has to become dynamic, and
 * nearly all of it already reads `SCREEN.width`/`SCREEN.height` (theme.ts),
 * which are now live getters onto this module. Cropping was rejected
 * explicitly: `Phaser.Scale.ENVELOP` fills the same window by cutting ~79
 * design px off the top AND bottom at aspect 1.94, which is exactly where the
 * run HUD (kicker/title/stats/badge) and mobile's footer primary button live.
 *
 * Pure module (no Phaser import) so it is unit-testable and so the headless
 * fallback below is trivially correct: with no browser, the viewport IS the
 * profile canvas, which is what every existing test already assumes.
 */

import { ACTIVE_PROFILE } from './layoutProfile';

export interface ViewportSize {
  width: number;
  height: number;
}

/** The design size the whole app was authored against — and, by the EXPAND
 * contract above, the FLOOR of the live viewport on both axes. */
export const DESIGN_SIZE: ViewportSize = {
  width: ACTIVE_PROFILE.canvas.width,
  height: ACTIVE_PROFILE.canvas.height,
};

/**
 * Mutable because the window is: `renderScale.ts` pushes a new value on every
 * Scale Manager RESIZE. Starts at the design size so any consumer that runs
 * before the first push (module init, unit tests, SSR) sees exactly the
 * pre-EXPAND numbers.
 */
let current: ViewportSize = { ...DESIGN_SIZE };

/** The live viewport, in DESIGN coordinates. Read at LAYOUT time, never cached
 * in a module-level const — that is the one rule this whole system rests on. */
export function viewport(): ViewportSize {
  return current;
}

/**
 * Called by `renderScale.ts` only. Clamped to the design size on both axes so
 * the ">= design" contract holds even if a browser reports a degenerate parent
 * size mid-layout (a 0-height parent during a CSS transition, say) — a scene
 * asked to lay out into a 40px-tall viewport would produce garbage, whereas
 * one that briefly overflows a too-small window just scrolls off, exactly as
 * FIT's downscale did.
 */
export function setViewport(size: ViewportSize): void {
  const width = Math.max(DESIGN_SIZE.width, Math.floor(size.width));
  const height = Math.max(DESIGN_SIZE.height, Math.floor(size.height));
  if (width === current.width && height === current.height) return;
  current = { width, height };
}

/** Test/dev hook: restore the pristine design-size viewport. */
export function resetViewport(): void {
  current = { ...DESIGN_SIZE };
}

/**
 * How far the live viewport has grown past the design size on each axis. This
 * is the ONLY number a right-anchored piece of fixed geometry needs: a rect
 * authored at `x = 1440 - 32 - 200` stays right-aligned by adding `slack().x`.
 */
export function slack(): ViewportSize {
  return {
    width: current.width - DESIGN_SIZE.width,
    height: current.height - DESIGN_SIZE.height,
  };
}
