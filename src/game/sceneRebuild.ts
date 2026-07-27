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
