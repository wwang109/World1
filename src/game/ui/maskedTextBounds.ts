/**
 * MASKED TEXT BOUNDS — what a Phaser geometry mask actually leaves on screen.
 *
 * WHY THIS EXISTS (2026-08-31). `scripts/run-hud-audit.ts` walked the live
 * scene graph collecting every visible `Text` object's world bounds and flagged
 * off-canvas / overlapping pairs. It never looked at masks. Phaser CLIPS a
 * masked object: a shelf row scrolled out of its viewport, or a pouch row below
 * the fold, is not drawn at all — but `visible` is still `true`, `alpha` is
 * still `1`, and `getBounds()` still reports the un-clipped rectangle wherever
 * the layout math put it. So the audit reported, as hard violations:
 *
 *     "GEM POUCH x Frost Sliver"          (overlap)
 *     "2 G off-canvas at y928"            (off-canvas)
 *
 * Neither is on screen. Both are inside the shop shelf's geometry mask. Those
 * two findings were briefed to an agent as fact and cost it a round trip before
 * a later auditor went and looked. A false-positive audit is worse than no
 * audit, because it is trusted — so the clip is modelled here, and modelled in
 * PURE TypeScript so `tests/game/maskedTextAudit.test.ts` can drive the same
 * arithmetic the script ships (rather than the test re-typing a copy of it,
 * which is the drift this project has already closed three times elsewhere).
 *
 * The browser-side half stays deliberately dumb: it reads each object's mask
 * chain and reduces every mask `Graphics` to the `FILL_RECT`s in its command
 * buffer. All the geometry decisions happen here, in Node.
 *
 * CONSERVATIVE BY CONSTRUCTION. Every approximation in this file errs toward
 * calling a text DRAWN:
 *   - a mask whose command buffer contains anything this reducer cannot model
 *     (a path fill, an arc, a transform) is reported `unresolved` and does NOT
 *     clip — the caller is told it could not be resolved instead of being
 *     silently handed a smaller box;
 *   - a mask made of several rectangles is collapsed to the BOUNDING BOX of the
 *     text's intersections with them, which is >= the true visible area.
 * The audit can therefore lose a real violation only by a route it is told
 * about, and can never invent one out of a mask it misread.
 */

export interface Rect { x: number; y: number; width: number; height: number }

/** One geometry mask, reduced to the world-space rectangles its Graphics fills. */
export interface MaskShape {
  rects: Rect[];
  /** The command buffer held something `reduceMaskCommands` cannot model. */
  unresolved: boolean;
}

export interface VisibleBounds {
  /** False when a mask clips the text away entirely — Phaser draws nothing. */
  drawn: boolean;
  /** True when a mask cuts part of it off (`rect` is then the surviving part). */
  clipped: boolean;
  /** The part actually painted. Equal to the input bounds when unmasked. */
  rect: Rect;
  /** A mask in the chain could not be modelled; `rect` is the UNCLIPPED box. */
  unresolved: boolean;
}

/** Phaser `Graphics` command ids (`node_modules/phaser/src/gameobjects/graphics/Commands.js`). */
const FILL_RECT = 3;
const LINE_STYLE = 6;
const FILL_STYLE = 7;
/** Argument counts, by command id. `undefined` = this reducer cannot model it. */
const ARG_COUNT: Record<number, number | undefined> = {
  [FILL_RECT]: 4,
  [LINE_STYLE]: 3,
  [FILL_STYLE]: 2,
};

/**
 * Reduces a Phaser `Graphics.commandBuffer` to the rectangles it fills.
 *
 * `offsetX`/`offsetY` are the mask Graphics' own world position — every mask in
 * this project is a `make.graphics({}, false)` left at the origin, so they are
 * normally 0, but reading them costs nothing and a mask placed elsewhere would
 * otherwise clip the wrong region silently.
 *
 * Anything other than FILL_RECT / FILL_STYLE / LINE_STYLE stops the walk and
 * returns `unresolved: true`: an unrecognised opcode makes every BYTE after it
 * ambiguous (arguments would be read as commands), so continuing would produce
 * confident nonsense. Note this is exactly the bug in the ad-hoc reducer the
 * shop-audit agent wrote in `scratchpad/shopaudit/lib.ts`, which skipped 1 arg
 * for FILL_STYLE and 2 for LINE_STYLE — both off by one. It happened to still
 * find the right rect for a `[FILL_STYLE, color, alpha, FILL_RECT, …]` buffer
 * because the stray alpha value (1) is not a command id; a mask drawn with
 * `lineStyle` first would have desynchronised it.
 */
export function reduceMaskCommands(commands: readonly number[], offsetX = 0, offsetY = 0): MaskShape {
  const rects: Rect[] = [];
  let i = 0;
  while (i < commands.length) {
    const cmd = commands[i]!;
    const args = ARG_COUNT[cmd];
    if (args === undefined) return { rects, unresolved: true };
    if (cmd === FILL_RECT) {
      rects.push({
        x: commands[i + 1]! + offsetX,
        y: commands[i + 2]! + offsetY,
        width: commands[i + 3]!,
        height: commands[i + 4]!,
      });
    }
    i += args + 1;
  }
  return { rects, unresolved: false };
}

function intersect(a: Rect, b: Rect): Rect | null {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  if (right <= x || bottom <= y) return null;
  return { x, y, width: right - x, height: bottom - y };
}

/**
 * What survives of `bounds` after every mask in `masks` (the object's own mask
 * plus every mask inherited from an ancestor container) has clipped it.
 *
 * Masks COMPOSE by intersection — Phaser applies each one in turn while
 * rendering, so a row inside a masked container inside a masked panel is drawn
 * only where all three agree.
 */
export function visibleBounds(bounds: Rect, masks: readonly MaskShape[]): VisibleBounds {
  let rect = bounds;
  let clipped = false;
  let unresolved = false;
  for (const mask of masks) {
    if (mask.unresolved) { unresolved = true; continue; }
    if (mask.rects.length === 0) continue;
    // Bounding box of the intersections with each filled rect. For the single
    // rect every mask in this project uses, that IS the intersection.
    let next: Rect | null = null;
    for (const r of mask.rects) {
      const hit = intersect(rect, r);
      if (!hit) continue;
      next = next === null ? hit : {
        x: Math.min(next.x, hit.x),
        y: Math.min(next.y, hit.y),
        width: Math.max(next.x + next.width, hit.x + hit.width) - Math.min(next.x, hit.x),
        height: Math.max(next.y + next.height, hit.y + hit.height) - Math.min(next.y, hit.y),
      };
    }
    if (next === null) return { drawn: false, clipped: true, rect: { x: rect.x, y: rect.y, width: 0, height: 0 }, unresolved };
    if (next.width < rect.width - 0.5 || next.height < rect.height - 0.5) clipped = true;
    rect = next;
  }
  return { drawn: true, clipped, rect, unresolved };
}

/** Overlapping area of two drawn boxes, in px². 0 when they do not touch. */
export function overlapArea(a: Rect, b: Rect): number {
  const hit = intersect(a, b);
  return hit === null ? 0 : hit.width * hit.height;
}

/** True when `rect` pokes outside `0,0,width,height` by more than `tolerance`. */
export function escapesCanvas(rect: Rect, width: number, height: number, tolerance = 2): boolean {
  return rect.x < -tolerance
    || rect.y < -tolerance
    || rect.x + rect.width > width + tolerance
    || rect.y + rect.height > height + tolerance;
}
