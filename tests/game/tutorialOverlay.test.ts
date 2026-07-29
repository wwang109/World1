import { describe, expect, it, vi } from 'vitest';
import { renderTutorialCard } from '../../src/game/tutorial/overlay';
import { TUTORIAL_STEPS } from '../../src/game/tutorial/steps';

/**
 * A minimal stand-in for `Phaser.Scene` — just enough surface for
 * `renderTutorialCard` to call into. Every drawing call is a spy so the
 * "missing anchor never throws, and never draws" contract is directly
 * assertable without booting a real Phaser canvas (vitest runs in `node`).
 */
function fakeScene() {
  const state = { calls: 0 };
  const fakeText = () => {
    state.calls += 1;
    const obj = {
      width: 10, height: 10,
      setOrigin: () => obj, setVisible: () => obj, setInteractive: () => obj,
      setDepth: () => obj, setColor: () => obj, on: () => obj, destroy: () => undefined,
    };
    return obj;
  };
  const fakeRect = () => {
    state.calls += 1;
    const obj = {
      setOrigin: () => obj, setStrokeStyle: () => obj, setDepth: () => obj,
      setInteractive: () => obj, on: () => obj,
    };
    return obj;
  };
  const scene = { add: { text: vi.fn(fakeText), rectangle: vi.fn(fakeRect) } };
  return { calls: state.calls, scene };
}

describe('tutorial overlay — defensive-by-construction', () => {
  it('a missing anchor is a silent no-op: no draw calls, no throw', () => {
    const { scene } = fakeScene();
    const card = { step: TUTORIAL_STEPS[0]!, payload: {} };
    expect(() => renderTutorialCard(scene as never, card, undefined, () => {}, () => {})).not.toThrow();
    expect((scene.add.text as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0);
    expect((scene.add.rectangle as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0);
  });

  it('a missing card is a silent no-op even with a real anchor', () => {
    const { scene } = fakeScene();
    const anchor = { x: 0, y: 0, w: 100, h: 20 };
    expect(() => renderTutorialCard(scene as never, undefined, anchor, () => {}, () => {})).not.toThrow();
    expect((scene.add.text as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0);
  });

  it('draws when both a card and an anchor are present', () => {
    const { scene } = fakeScene();
    const card = { step: TUTORIAL_STEPS[0]!, payload: { amount: 7 } };
    const anchor = { x: 0, y: 0, w: 100, h: 20 };
    renderTutorialCard(scene as never, card, anchor, () => {}, () => {});
    expect((scene.add.text as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(0);
    expect((scene.add.rectangle as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(0);
  });
});
