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
  //
  // `scene.input.activePointer` is ALWAYS a real Pointer once the game has
  // booted — Phaser sets it to `pointers[0]` at construction
  // (`node_modules/phaser/src/input/InputManager.js`:
  // `this.activePointer = this.pointers[0]`), never `undefined`. So this line
  // runs, and stamps SOMETHING, on EVERY rebuild — pointer-triggered or not
  // (e.g. a future battle-service `.then()` that calls `rerender()`). That is
  // fine, and deliberately so — see the "provably cannot collide" section of
  // `wasPointerConsumedByRebuild`'s doc comment below, and the collision-proof
  // tests in `sceneRebuild.test.ts`.
  //
  // SINGLE-POINTER ASSUMPTION: this reads the one `activePointer` Phaser
  // tracks by default (`src/main.ts` never raises `input.activePointers`
  // above Phaser's default of 1 — no multi-touch is configured today). If
  // multi-touch is ever enabled (e.g. pinch-zoom), a second finger becomes a
  // SECOND, DISTINCT `Pointer` object, and `activePointer` — "the most
  // recently interacted pointer" — could already have flipped to that second
  // finger by the time a handler for the FIRST finger's click runs this line,
  // stamping the wrong finger's event. Revisit this the moment a second
  // pointer is enabled; today there is only ever one, so it cannot happen.
  const activePointer = scene.input?.activePointer;
  if (activePointer?.event != null) consumedPointerEventByScene.set(scene, activePointer.event);

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
 * Scene → the native DOM `Event` OBJECT that `activePointer` was carrying the
 * LAST time `rebuildScene()` ran for it. Backing store for
 * `wasPointerConsumedByRebuild` — see its doc comment for the mechanism this
 * defeats and for WHY it is the event object, not a `downTime`/`upTime`
 * number. A `WeakMap` keyed by the scene INSTANCE (Phaser reuses one instance
 * per scene key across `scene.start()`/`restart()`, so this naturally scopes
 * per screen and never needs manual clearing).
 */
const consumedPointerEventByScene = new WeakMap<Phaser.Scene, TouchEvent | MouseEvent | WheelEvent>();

/**
 * THE re-render idiom has one sharp edge, discovered independently at FIVE+
 * separate call sites before this guard existed: a dialog button's OWN
 * `pointerdown` (or `pointerup` — see below) handler mutates some open/closed
 * flag and calls `rerender()` (→ `rebuildScene()`) SYNCHRONOUSLY. Phaser
 * dispatches a physical click/tap to per-object listeners FIRST
 * (`GAMEOBJECT_POINTER_DOWN` / `GAMEOBJECT_POINTER_UP`, one loop over
 * whatever was under the pointer) and only AFTER that loop finishes does it
 * emit the SCENE-level `POINTER_DOWN` / `POINTER_UP` for the very same
 * physical event, to whatever is subscribed to
 * `scene.input.on('pointerdown'|'pointerup', …)` AT THAT MOMENT.
 * `InputPlugin#processDownEvents` and `#processUpEvents`
 * (`node_modules/phaser/src/input/InputPlugin.js`) have IDENTICAL two-phase
 * structure — this is not a pointerdown-only hazard; a scene-level generic
 * `pointerup` listener is exposed to exactly the same re-dispatch from an
 * object-level `pointerup` handler that rebuilds. If the triggering handler
 * already rebuilt the scene by the time the second phase fires,
 * `rebuildScene()` removed the OLD generic listener and `create()`
 * re-registered a FRESH one — which the scene-level emit reaches instead.
 * That fresh listener hit-tests the REBUILT content at the same pixel and can
 * act on whatever is now exposed there (typically: the dialog just closed, so
 * a board/bag card underneath is "discovered" and a phantom drag/tap starts,
 * resolving into e.g. a bogus SELL confirm on pointerup).
 *
 * A boolean open/closed flag CANNOT guard against this — it is cleared
 * (state mutated to closed) in the exact same synchronous handler, BEFORE
 * `rerender()` runs, so by the time the fresh listener checks it, it already
 * reads "closed."
 *
 * This is the STRUCTURAL fix: `rebuildScene()` stamps the triggering
 * pointer's most-recently-processed native DOM `Event` OBJECT automatically
 * (see above) — no per-button plumbing required. Call this FIRST, before any
 * hit-testing, in every scene-level generic `pointerdown`/`pointerup`
 * listener (drag wiring, masked-scroll wiring, …); it transparently covers
 * ANY handler that calls `rerender()`, including ones that forget a bespoke
 * per-button consume call.
 *
 * WHY THE EVENT OBJECT, AND NOT `pointer.downTime`/`upTime` (a PLAIN NUMBER —
 * the native event's `timeStamp`): `timeStamp` is not guaranteed unique.
 * Browsers with reduced timer resolution for fingerprinting protection
 * (Firefox's `privacy.resistFingerprinting` rounds to ~2ms buckets; Tor
 * Browser coarser still) or synthetic input (Playwright can dispatch several
 * events inside one rounded tick) CAN produce two genuinely DIFFERENT
 * physical clicks with an IDENTICAL `timeStamp`. A rebuild NOT triggered by a
 * click still stamps whatever `activePointer.event` happens to be at that
 * moment — some PAST, real click's event — and a numeric `downTime`/`upTime`
 * match cannot distinguish "the click that triggered THIS rebuild" from "a
 * later, unrelated click that happens to round to the same millisecond."
 * Comparing the Event OBJECT itself closes that hole structurally rather than
 * probabilistically: the browser (and jsdom/synthetic dispatchers) allocate a
 * new, distinct `Event` instance per dispatched event, always — no two
 * SEPARATE clicks/taps can ever produce a `===`-equal `pointer.event`,
 * regardless of how their timestamps round. A rebuild not triggered by a
 * click, or one whose stamped event is stale, is therefore a genuinely safe
 * no-op BY CONSTRUCTION — it can only ever match the ONE re-dispatch of the
 * SAME click/tap that caused it, never a later, distinct one. See
 * `sceneRebuild.test.ts`'s "downTime collision cannot false-positive" case
 * for the proof (two distinct real clicks CAN legitimately share a
 * `downTime`; they can never share a `pointer.event`).
 *
 * `pointer.event` starts `undefined` (`node_modules/phaser/src/input/Pointer.js`:
 * `this.event;`, never assigned in the constructor) and stays that way only
 * before the FIRST event a given Pointer has EVER processed. Any pointer that
 * reaches a REAL `'pointerdown'`/`'pointerup'` handler has, by definition,
 * already had a real `Event` assigned to it before Phaser dispatches
 * (`InputManager#onMouseDown`/`onMouseUp`/`onTouchStart`/`onTouchEnd` call
 * `pointer.down(event)`/`pointer.up(event)` — which sets `.event` — BEFORE
 * `updateInputPlugins()` runs the two-phase dispatch above), so `undefined`
 * can never appear as `pointer.event` inside a real listener either.
 *
 * That is not the ONLY way `.event` can go absent, though — mid-session, not
 * just pre-first-event: `InputPlugin#resetPointers()`
 * (`node_modules/phaser/src/input/InputPlugin.js:3162`) loops every tracked
 * Pointer and calls `Pointer#reset()` (`Pointer.js:1208`), which sets
 * `.event` back to `null`. Nothing in `src/` calls `resetPointers()` today
 * (grep-confirmed), so this cannot happen in this codebase as it stands — but
 * if it ever is wired up (its own doc: "if input has been stolen from Phaser
 * via a 3rd party component"), it is still harmless here: both the stamp site
 * above (`activePointer?.event != null`) and the compare below
 * (`consumed != null`) already null-check, so a reset pointer just makes this
 * a safe no-op, never a false match.
 */
export function wasPointerConsumedByRebuild(scene: Phaser.Scene, pointer: Phaser.Input.Pointer): boolean {
  const consumed = consumedPointerEventByScene.get(scene);
  return consumed != null && consumed === pointer.event;
}
