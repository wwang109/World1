import type Phaser from 'phaser';

/**
 * THE re-render idiom for every scene, both platforms: state changed → destroy
 * this frame's objects → run `create()` again, synchronously, inside the same
 * frame. Class fields survive (that is how overlay state like `socketFor`,
 * `pendingTrash`, and picker selections persists a rebuild), and there is no
 * blank frame, unlike `scene.restart()`.
 *
 * Everything `create()` re-registers must be cleared first, or it stacks per
 * rebuild. The two idioms this replaces each handled only part of that list:
 * - `scene.restart()` cleared all three, but its `init()` call wiped overlay
 *   fields (mobile prep's foe picker could never open), and it repaints
 *   through an empty frame.
 * - hand-rolled `rerender()` (destroy children + create) leaked scene-level
 *   input listeners — DesktopWiki stacked pointer handlers on every switch.
 */
export function rebuildScene(scene: Phaser.Scene & { create: () => void }): void {
  // See `wasPointerConsumedByRebuild` below — record BEFORE anything else so
  // the stamp is in place before `create()` re-registers any generic
  // listener that might fire later in THIS SAME physical click's dispatch.
  const activePointer = scene.input?.activePointer;
  if (activePointer) consumedPointerAtByScene.set(scene, activePointer.downTime);

  scene.tweens.killAll();
  scene.time.removeAllEvents();
  // Scene-level listeners the scenes register in create() (drag wiring, masked
  // scroll, wheel). Object-level listeners die with their objects below.
  for (const event of ['pointerdown', 'pointermove', 'pointerup', 'pointerupoutside', 'wheel', 'gameobjectdown', 'gameobjectup']) {
    scene.input.removeAllListeners(event);
  }
  for (const child of [...scene.children.list]) child.destroy();
  scene.create();
}

/**
 * Scene → the `downTime` of whichever pointer was mid-dispatch the LAST time
 * `rebuildScene()` ran for it. Backing store for `wasPointerConsumedByRebuild`
 * — see its doc comment for the mechanism this defeats. A `WeakMap` keyed by
 * the scene INSTANCE (Phaser reuses one instance per scene key across
 * `scene.start()`/`restart()`, so this naturally scopes per screen and never
 * needs manual clearing).
 */
const consumedPointerAtByScene = new WeakMap<Phaser.Scene, number>();

/**
 * THE re-render idiom has one sharp edge, discovered independently at FIVE
 * separate call sites before this guard existed: a dialog button's OWN
 * `pointerdown` handler mutates some open/closed flag and calls `rerender()`
 * (→ `rebuildScene()`) SYNCHRONOUSLY. Phaser dispatches a physical click to
 * per-object listeners FIRST (`GAMEOBJECT_POINTER_DOWN`, one loop over
 * whatever was under the pointer at down-time) and only AFTER that loop
 * finishes does it emit the scene-level `POINTER_DOWN` for the very same
 * click, to whatever is subscribed to `scene.input.on('pointerdown', …)` AT
 * THAT MOMENT (`InputPlugin#processDownEvents`, `node_modules/phaser/src/
 * input/InputPlugin.js`). If the button's handler already rebuilt the scene
 * by then, `rebuildScene()` removed the OLD generic listener and `create()`
 * re-registered a FRESH one — which the scene-level `POINTER_DOWN` reaches
 * instead. That fresh listener hit-tests the REBUILT content at the same
 * pixel and can act on whatever is now exposed there (typically: the dialog
 * just closed, so a board/bag card underneath is "discovered" and a phantom
 * drag/tap starts, resolving into e.g. a bogus SELL confirm on pointerup).
 *
 * A boolean open/closed flag CANNOT guard against this — it is cleared
 * (state mutated to closed) in the exact same synchronous handler, BEFORE
 * `rerender()` runs, so by the time the fresh listener checks it, it already
 * reads "closed."
 *
 * This is the STRUCTURAL fix: `rebuildScene()` stamps the triggering
 * pointer's `downTime` automatically (see above) — no per-button plumbing
 * required. Call this FIRST, before any hit-testing, in every scene-level
 * generic `pointerdown` listener (drag wiring, masked-scroll wiring, …); it
 * transparently covers ANY handler that calls `rerender()`, including ones
 * that forget a bespoke per-button consume call. A rebuild NOT triggered by a
 * click just stamps a `downTime` that can never recur (Phaser's `downTime`s
 * are monotonic per pointer), so the guard is a safe no-op in that case —
 * it only ever suppresses the ONE re-dispatch of the click that caused the
 * rebuild, never a later, genuine click.
 */
export function wasPointerConsumedByRebuild(scene: Phaser.Scene, pointer: Phaser.Input.Pointer): boolean {
  return consumedPointerAtByScene.get(scene) === pointer.downTime;
}
