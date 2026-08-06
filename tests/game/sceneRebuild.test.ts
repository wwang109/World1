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
 * env is plain `node`; nothing here touches rendering).
 */

interface StubPointer { downTime: number }

function makeStubScene(activeDownTime: number | null): {
  scene: Phaser.Scene & { create: () => void };
  create: ReturnType<typeof vi.fn>;
  removeAllListeners: ReturnType<typeof vi.fn>;
} {
  const create = vi.fn();
  const removeAllListeners = vi.fn();
  const killAll = vi.fn();
  const removeAllEvents = vi.fn();
  const destroy = vi.fn();
  const activePointer: StubPointer | undefined = activeDownTime === null ? undefined : { downTime: activeDownTime };
  const scene = {
    input: { activePointer, removeAllListeners },
    tweens: { killAll },
    time: { removeAllEvents },
    children: { list: [{ destroy }, { destroy }] },
    create,
  } as unknown as Phaser.Scene & { create: () => void };
  return { scene, create, removeAllListeners };
}

describe('sceneRebuild: wasPointerConsumedByRebuild (the phantom-dialog guard)', () => {
  it('is false before any rebuild has ever run for a scene', () => {
    const { scene } = makeStubScene(111);
    expect(wasPointerConsumedByRebuild(scene, { downTime: 111 } as Phaser.Input.Pointer)).toBe(false);
  });

  it('rebuildScene() stamps the CURRENT active pointer\'s downTime BEFORE calling create()', () => {
    const { scene, create } = makeStubScene(555);
    let stampedDuringCreate = false;
    create.mockImplementation(() => {
      // A scene's create() re-registers its generic pointerdown listener; by
      // the time it runs, the stamp must already be in place — this is the
      // "record BEFORE anything else" ordering the doc comment requires.
      stampedDuringCreate = wasPointerConsumedByRebuild(scene, { downTime: 555 } as Phaser.Input.Pointer);
    });
    rebuildScene(scene);
    expect(stampedDuringCreate).toBe(true);
  });

  it('matches the pointer that triggered the rebuild, and no other', () => {
    const { scene } = makeStubScene(42);
    rebuildScene(scene);
    expect(wasPointerConsumedByRebuild(scene, { downTime: 42 } as Phaser.Input.Pointer)).toBe(true);
    expect(wasPointerConsumedByRebuild(scene, { downTime: 43 } as Phaser.Input.Pointer)).toBe(false);
  });

  it('is scoped per scene instance — two scenes never share a consumed pointer', () => {
    const a = makeStubScene(9);
    const b = makeStubScene(9);
    rebuildScene(a.scene);
    expect(wasPointerConsumedByRebuild(a.scene, { downTime: 9 } as Phaser.Input.Pointer)).toBe(true);
    expect(wasPointerConsumedByRebuild(b.scene, { downTime: 9 } as Phaser.Input.Pointer)).toBe(false);
  });

  it('a rebuild with no active pointer (e.g. a non-click-triggered rerender) is a safe no-op', () => {
    const { scene } = makeStubScene(null);
    expect(() => rebuildScene(scene)).not.toThrow();
    // No downTime was ever stamped, so nothing can spuriously match — even a
    // pointer with downTime 0 (should one ever exist) is not falsely "consumed".
    expect(wasPointerConsumedByRebuild(scene, { downTime: 0 } as Phaser.Input.Pointer)).toBe(false);
  });

  it('a SECOND rebuild (a second click) updates the stamp — the guard never wedges shut', () => {
    const { scene } = makeStubScene(1);
    rebuildScene(scene);
    expect(wasPointerConsumedByRebuild(scene, { downTime: 1 } as Phaser.Input.Pointer)).toBe(true);
    // A later, genuine click (different downTime) triggers its own rebuild —
    // the OLD stamp must no longer match; the new one must.
    const { scene: _unused } = makeStubScene(2); // (unused; keeps intent explicit)
    void _unused;
    (scene.input as unknown as { activePointer: StubPointer }).activePointer = { downTime: 2 };
    rebuildScene(scene);
    expect(wasPointerConsumedByRebuild(scene, { downTime: 1 } as Phaser.Input.Pointer)).toBe(false);
    expect(wasPointerConsumedByRebuild(scene, { downTime: 2 } as Phaser.Input.Pointer)).toBe(true);
  });

  it('still clears scene-level listeners and destroys+recreates the frame (unchanged base behavior)', () => {
    const { scene, create, removeAllListeners } = makeStubScene(7);
    rebuildScene(scene);
    expect(removeAllListeners).toHaveBeenCalledWith('pointerdown');
    expect(removeAllListeners).toHaveBeenCalledWith('pointerup');
    expect(create).toHaveBeenCalledTimes(1);
  });
});
