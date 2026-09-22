/**
 * THE ONE scene-text collector. Both browser-driven scripts
 * (`run-hud-audit.ts`, `shop-smoke.ts`) read the live Phaser display list
 * through this module — they used to carry byte-identical private copies, and
 * a bug fixed in one was still live in the other.
 *
 * The bug in question (2026-08-31): neither copy looked at geometry masks.
 * Phaser CLIPS a masked object, so a shop-shelf row scrolled out of its
 * viewport is not painted at all — but `visible` is still `true`, `alpha` is
 * still `1`, and `getBounds()` still reports the un-clipped rectangle wherever
 * the layout math put it. `run-hud-audit` therefore reported two confident,
 * entirely fictional findings — `"GEM POUCH" x "Frost Sliver"` overlapping and
 * `"2 G"` off-canvas at y928, both inside the shelf mask — which were briefed
 * to another agent as fact and cost it a round trip before a later auditor went
 * and looked. A false-positive audit is worse than no audit, because it is
 * trusted.
 *
 * The browser-side walk here stays deliberately dumb: bounds, plus the raw
 * command buffer of every mask on the object or an ancestor container. All the
 * geometry lives in `src/game/ui/maskedTextBounds.ts`, in pure TypeScript, so
 * `tests/game/maskedTextAudit.test.ts` drives the arithmetic these scripts
 * actually ship rather than a retyped copy of it.
 */
import type { Page } from 'playwright';
import { reduceMaskCommands, visibleBounds, type Rect } from '../src/game/ui/maskedTextBounds';

/**
 * A text as DRAWN. `x/y/width/height` are the part that survives every geometry
 * mask above it. A text a mask clips away entirely never becomes a `TextBound`
 * at all — it is not on screen, so it can neither overlap anything, nor run off
 * the canvas, nor be clicked.
 */
export interface TextBound {
  text: string; x: number; y: number; width: number; height: number; scene: string;
  /** A mask cut part of this text off. The bounds above are what is left. */
  clipped: boolean;
  /** A mask in this text's chain could not be modelled; bounds are UNCLIPPED. */
  unresolvedMask: boolean;
}

/** A scene's camera as the affine map from its world coordinates (what
 * `getBounds()` reports) to real canvas pixels. Identity (`x:0,y:0,scrollX:0,
 * scrollY:0,zoom:1`) for every top-level scene — the run map, prep, battle,
 * etc. all use the default full-canvas camera untouched. An EMBEDDED
 * destination (`RunDestinationHost.render()` -> `positionRunDestination`,
 * `src/game/ui/RunDestinationHost.ts`) gives its launched child scene
 * (`DesktopRunEvent`, `DesktopShop`, ...) a clipped, zoomed, scrolled camera
 * instead, so that scene's own world bounds land somewhere else on screen
 * entirely — reading them raw silently computed the wrong click point. */
export interface SceneCamera { x: number; y: number; scrollX: number; scrollY: number; zoom: number }

/** Raw scene-graph reading, before any mask is applied. */
export interface RawTextBound {
  text: string; x: number; y: number; width: number; height: number; scene: string;
  camera: SceneCamera;
  /** One entry per mask on the object or an ancestor container, outermost
   * first. `null` = a mask that is not a geometry mask (a bitmap mask), which
   * this collector cannot model and therefore refuses to treat as clipping. */
  maskChain: Array<{ commands: number[]; offsetX: number; offsetY: number } | null>;
}

/**
 * Every Text on every active scene, with its world bounds and its mask chain.
 * Nothing is filtered and no geometry decision is made here.
 */
export async function collectRawSceneTexts(page: Page): Promise<RawTextBound[]> {
  // NOTE: deliberately iterative (no nested named function/const-arrow) —
  // tsx/esbuild injects a `__name(...)` helper call around named functions that
  // Playwright's `page.evaluate` serializes by source text alone, which throws
  // `ReferenceError: __name is not defined` in the browser. An explicit stack
  // avoids the recursive named helper entirely.
  return page.evaluate(() => {
    const game = (window as any).__game;
    const out: any[] = [];
    // `masks` is the chain inherited from ancestor containers, outermost first.
    const stack: Array<{ obj: any; scene: string; camera: any; masks: any[] }> = [];
    for (const scene of game.scene.scenes) {
      if (!scene.sys.isActive()) continue;
      const key = scene.sys.settings.key as string;
      const cam = scene.cameras.main;
      const camera = { x: cam.x, y: cam.y, scrollX: cam.scrollX, scrollY: cam.scrollY, zoom: cam.zoom };
      for (const obj of scene.children.list) stack.push({ obj, scene: key, camera, masks: [] });
    }
    while (stack.length > 0) {
      const { obj, scene, camera, masks } = stack.pop()!;
      if (!obj || obj.visible === false || (obj.alpha ?? 1) === 0) continue;
      let chain = masks;
      if (obj.mask) {
        // A GeometryMask exposes the Graphics it was built from; a BitmapMask
        // does not, and is recorded as `null` (unmodellable, non-clipping).
        const g = obj.mask.geometryMask;
        chain = masks.concat([
          g && Array.isArray(g.commandBuffer)
            ? { commands: g.commandBuffer.slice(), offsetX: g.x ?? 0, offsetY: g.y ?? 0 }
            : null,
        ]);
      }
      if (obj.type === 'Text' && typeof obj.text === 'string' && obj.text.length > 0) {
        const b = obj.getBounds();
        out.push({ text: obj.text, x: b.x, y: b.y, width: b.width, height: b.height, scene, camera, maskChain: chain });
      }
      if (Array.isArray(obj.list)) for (const child of obj.list) stack.push({ obj: child, scene, camera, masks: chain });
    }
    return out;
  });
}

/** World rect -> real canvas pixels, through a scene's camera. Identity for
 * every default (non-embedded) camera. */
function toScreenRect(rect: Rect, camera: SceneCamera): Rect {
  return {
    x: camera.x + (rect.x - camera.scrollX) * camera.zoom,
    y: camera.y + (rect.y - camera.scrollY) * camera.zoom,
    width: rect.width * camera.zoom,
    height: rect.height * camera.zoom,
  };
}

/** Resolves raw readings to what the browser ACTUALLY PAINTS. Pure — exported
 * so a test can drive it without a browser. */
export function resolveDrawnTexts(raw: readonly RawTextBound[]): TextBound[] {
  const out: TextBound[] = [];
  for (const t of raw) {
    const box: Rect = { x: t.x, y: t.y, width: t.width, height: t.height };
    const masks = t.maskChain.map((m) => (
      m === null ? { rects: [], unresolved: true } : reduceMaskCommands(m.commands, m.offsetX, m.offsetY)
    ));
    const v = visibleBounds(box, masks);
    if (!v.drawn) continue;
    const screen = toScreenRect(v.rect, t.camera);
    out.push({
      text: t.text, scene: t.scene,
      x: screen.x, y: screen.y, width: screen.width, height: screen.height,
      clipped: v.clipped, unresolvedMask: v.unresolved,
    });
  }
  return out;
}

/** Every text the browser actually paints, clipped to its visible part. */
export async function collectSceneTexts(page: Page): Promise<TextBound[]> {
  return resolveDrawnTexts(await collectRawSceneTexts(page));
}
