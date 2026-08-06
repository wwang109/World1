import { describe, expect, it, vi } from 'vitest';
import { rebuildScene, wasPointerConsumedByRebuild } from '../../src/game/sceneRebuild';
import type Phaser from 'phaser';

/**
 * Regression coverage for the pointer-timing bug documented at length in
 * `sceneRebuild.ts` (`wasPointerConsumedByRebuild`'s doc comment): a dialog
 * button's OWN `pointerdown` handler mutates state and calls `rerender()`
 * (→ `rebuildScene()`) synchronously; Phaser's scene-level `POINTER_DOWN` for
 * that SAME physical click fires AFTER the per-object dispatch loop, reaching
 * whichever generic listener is registered AT THAT MOMENT — the FRESH one
 * `create()` just re-registered — which can misinterpret the click against
 * the rebuilt content (this shipped, unguarded, at five+ separate call sites:
 * see docs/audit history for RunProgressStrip's `renderRetireConfirm`, the
 * shop scenes' storefront tiles, and both DeckBuild scenes' TRASH/MERGE/
 * socket-panel/RETIRE dialogs).
 *
 * These tests exercise `rebuildScene`/`wasPointerConsumedByRebuild` directly
 * against a minimal stub — no real Phaser/canvas needed (this repo's vitest
 * env is plain `node`; nothing here touches rendering). The stub's
 * `activePointer.event` is a plain object standing in for a native DOM
 * `Event` — what matters for every test below is OBJECT IDENTITY (`===`),
 * exactly as it does in the real implementation; the plain object's shape is
 * irrelevant.
 */

interface StubPointer { event: object | undefined; downTime: number }

function makeStubScene(activeEvent: object | undefined, downTime = 0): {
  scene: Phaser.Scene & { create: () => void };
  create: ReturnType<typeof vi.fn>;
  removeAllListeners: ReturnType<typeof vi.fn>;
  activePointer: StubPointer;
} {
  const create = vi.fn();
  const removeAllListeners = vi.fn();
  const killAll = vi.fn();
  const removeAllEvents = vi.fn();
  const destroy = vi.fn();
  const activePointer: StubPointer = { event: activeEvent, downTime };
  const scene = {
    input: { activePointer, removeAllListeners },
    tweens: { killAll },
    time: { removeAllEvents },
    children: { list: [{ destroy }, { destroy }] },
    create,
  } as unknown as Phaser.Scene & { create: () => void };
  return { scene, create, removeAllListeners, activePointer };
}

/** A stand-in for a real click's native DOM Event: a fresh object, so `===`
 * behaves exactly like it would for two genuinely distinct browser Events. */
function fakeDomEvent(downTime: number): StubPointer['event'] & { downTime: number } {
  return { downTime };
}

describe('sceneRebuild: wasPointerConsumedByRebuild (the phantom-dialog guard)', () => {
  it('is false before any rebuild has ever run for a scene', () => {
    const { scene } = makeStubScene(fakeDomEvent(111));
    const pointer = { event: scene.input.activePointer.event, downTime: 111 } as unknown as Phaser.Input.Pointer;
    expect(wasPointerConsumedByRebuild(scene, pointer)).toBe(false);
  });

  it('rebuildScene() stamps the CURRENT active pointer\'s event BEFORE calling create()', () => {
    const evt = fakeDomEvent(555);
    const { scene, create } = makeStubScene(evt);
    let stampedDuringCreate = false;
    create.mockImplementation(() => {
      // A scene's create() re-registers its generic pointerdown listener; by
      // the time it runs, the stamp must already be in place — this is the
      // "record BEFORE anything else" ordering the doc comment requires.
      const pointer = { event: evt, downTime: 555 } as unknown as Phaser.Input.Pointer;
      stampedDuringCreate = wasPointerConsumedByRebuild(scene, pointer);
    });
    rebuildScene(scene);
    expect(stampedDuringCreate).toBe(true);
  });

  it('matches the pointer whose EVENT triggered the rebuild, and no other', () => {
    const evt = fakeDomEvent(42);
    const { scene } = makeStubScene(evt);
    rebuildScene(scene);
    expect(wasPointerConsumedByRebuild(scene, { event: evt, downTime: 42 } as unknown as Phaser.Input.Pointer)).toBe(true);
    const otherEvt = fakeDomEvent(43);
    expect(wasPointerConsumedByRebuild(scene, { event: otherEvt, downTime: 43 } as unknown as Phaser.Input.Pointer)).toBe(false);
  });

  it('is scoped per scene instance — two scenes never share a consumed pointer', () => {
    const evt = fakeDomEvent(9);
    const a = makeStubScene(evt);
    const b = makeStubScene(evt);
    rebuildScene(a.scene);
    expect(wasPointerConsumedByRebuild(a.scene, { event: evt, downTime: 9 } as unknown as Phaser.Input.Pointer)).toBe(true);
    expect(wasPointerConsumedByRebuild(b.scene, { event: evt, downTime: 9 } as unknown as Phaser.Input.Pointer)).toBe(false);
  });

  it('a rebuild before ANY pointer event has ever fired (activePointer.event undefined) is a safe no-op', () => {
    // This IS the reachable precondition: Phaser boots with a real Pointer
    // object whose `.event` field is simply never assigned yet
    // (node_modules/phaser/src/input/Pointer.js: `this.event;`), NOT with
    // `activePointer === undefined` — that state cannot occur (confirmed in
    // Phaser source: `InputManager` sets `this.activePointer = this.pointers[0]`
    // at construction, always a real Pointer). A prior version of this test
    // asserted the unreachable `activePointer === undefined` precondition;
    // this asserts the one that can actually happen.
    const { scene } = makeStubScene(undefined);
    expect(() => rebuildScene(scene)).not.toThrow();
    // Nothing was stamped (no real event existed to stamp), so nothing can
    // spuriously match — not even another pointer whose `.event` is ALSO
    // still undefined (see the `!= null` guard in `wasPointerConsumedByRebuild`
    // and its doc comment: any pointer reaching a real handler already has a
    // real event, so this can't collide with genuine input either way).
    expect(wasPointerConsumedByRebuild(scene, { event: undefined, downTime: 0 } as unknown as Phaser.Input.Pointer)).toBe(false);
  });

  it('a non-click-triggered rebuild stamps whatever STALE event is on activePointer — and that stale stamp is a safe no-op, PROVABLY: it can never equal a later, genuinely distinct click\'s event, even one with the identical downTime', () => {
    // Simulate: a real click happened a while ago (downTime 1000), then LATER
    // some non-pointer trigger (e.g. a battle-service `.then()`) calls
    // rerender() → rebuildScene(). At that moment `activePointer.event` is
    // still the OLD click's event object — genuinely stale, exactly the
    // scenario GAP 1 flags as untested.
    const staleEvent = fakeDomEvent(1000);
    const { scene, activePointer } = makeStubScene(staleEvent, 1000);
    rebuildScene(scene); // the non-click-triggered rebuild

    // Now a GENUINE, later click arrives. Browsers with reduced timestamp
    // resolution (Firefox privacy.resistFingerprinting, Playwright synthetic
    // input) CAN legitimately round its `timeStamp` to the exact same
    // millisecond as the stale one — so pick the adversarial case where the
    // numbers collide (downTime 1000 again) but the click is a DIFFERENT,
    // real DOM event (a distinct object, as every real Event always is).
    const newClickEvent = fakeDomEvent(1000); // same downTime, DIFFERENT object
    activePointer.event = newClickEvent;
    activePointer.downTime = 1000;
    const newPointer = { event: newClickEvent, downTime: 1000 } as unknown as Phaser.Input.Pointer;

    // The OLD downTime-based guard would have false-positived here (1000 ===
    // 1000) and silently swallowed this genuine click. The event-identity
    // guard does not: different object, no match.
    expect(wasPointerConsumedByRebuild(scene, newPointer)).toBe(false);
  });

  it('a SECOND rebuild (a second click) updates the stamp — the guard never wedges shut', () => {
    const firstEvt = fakeDomEvent(1);
    const { scene, activePointer } = makeStubScene(firstEvt, 1);
    rebuildScene(scene);
    expect(wasPointerConsumedByRebuild(scene, { event: firstEvt, downTime: 1 } as unknown as Phaser.Input.Pointer)).toBe(true);
    // A later, genuine click (different event object) triggers its own
    // rebuild — the OLD stamp must no longer match; the new one must.
    const secondEvt = fakeDomEvent(2);
    activePointer.event = secondEvt;
    activePointer.downTime = 2;
    rebuildScene(scene);
    expect(wasPointerConsumedByRebuild(scene, { event: firstEvt, downTime: 1 } as unknown as Phaser.Input.Pointer)).toBe(false);
    expect(wasPointerConsumedByRebuild(scene, { event: secondEvt, downTime: 2 } as unknown as Phaser.Input.Pointer)).toBe(true);
  });

  it('still clears scene-level listeners (both pointerdown AND pointerup — symmetric guard) and destroys+recreates the frame (unchanged base behavior)', () => {
    const { scene, create, removeAllListeners } = makeStubScene(fakeDomEvent(7), 7);
    rebuildScene(scene);
    expect(removeAllListeners).toHaveBeenCalledWith('pointerdown');
    expect(removeAllListeners).toHaveBeenCalledWith('pointerup');
    expect(create).toHaveBeenCalledTimes(1);
  });
});
