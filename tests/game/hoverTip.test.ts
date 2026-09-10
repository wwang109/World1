import { describe, expect, it } from 'vitest';
import { attachHoverTip, type HoverTipEntry } from '../../src/game/ui/hoverTip';

/**
 * A REAL touch tap could not open `attachHoverTip`'s tip: the live event
 * order on a phone is `pointerdown -> pointerover -> pointerup ->
 * pointerout`, all four for one finger, and the old wiring routed
 * `pointerout` straight to `hide` regardless of pointer type — so the tap's
 * own trailing `pointerout` destroyed the tip the instant the finger lifted.
 * Traced live on `RunRewardPanel.ts`'s resolved-reward card face; recorded in
 * `.superpowers/sdd/2026-09-06-card-text-migration/progress.md`'s fix-round-4
 * handoff ("a touch tap opens nothing").
 *
 * That fix's first pass then let TWO different targets' tips stay open at
 * once (an independent audit's finding, `task-hovertip-touch-review.md`):
 * before it, every touch tip self-destructed within its own gesture, so a
 * second tip never had anything to pile on top of; once persistence worked,
 * nothing closed target A's tip when target B's opened. The "one tip at a
 * time, scene-wide" describe block below is that fix, proven the same way —
 * two independent targets sharing one scene, driven through real event
 * sequences.
 *
 * This drives `attachHoverTip` through the SAME event sequence a real touch
 * or mouse interaction fires — not a re-implementation of the fix, the real
 * function — using a duck-typed `scene`/`target` (Phaser is a VALUE import
 * elsewhere in `src/game`, but `hoverTip.ts` only ever uses it in type
 * positions, so no `phaser` module needs mocking here; confirmed by this
 * suite actually running under vitest's plain-node environment).
 */

/** Minimal event emitter — same shape `Phaser.Events.EventEmitter` gives
 * `attachHoverTip` (`on`/`once`/`off`, multiple listeners per event, `emit`
 * to drive them). Good enough to prove wiring; not a Phaser stand-in. */
class FakeEmitter {
  private readonly listeners = new Map<string, Set<(...args: unknown[]) => void>>();

  on(event: string, fn: (...args: unknown[]) => void): this {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(fn);
    return this;
  }

  once(event: string, fn: (...args: unknown[]) => void): this {
    const wrapped = (...args: unknown[]): void => { this.off(event, wrapped); fn(...args); };
    return this.on(event, wrapped);
  }

  off(event: string, fn: (...args: unknown[]) => void): this {
    this.listeners.get(event)?.delete(fn);
    return this;
  }

  emit(event: string, ...args: unknown[]): void {
    for (const fn of [...(this.listeners.get(event) ?? [])]) fn(...args);
  }
}

/** A fake pointer carrying exactly the field `attachHoverTip` reads —
 * `Pointer.wasTouch`: true for the whole touch gesture (Phaser's own
 * `Pointer.js` sets it in every touch handler), false for mouse. */
function pointer(wasTouch: boolean): { wasTouch: boolean } {
  return { wasTouch };
}

/** A fake tip container that remembers the UPPERCASED entry titles it was
 * built from (mirroring `renderHoverTipCard`'s own `.toUpperCase()`), so a
 * test can tell WHICH target's tip is the one still alive, not just how many
 * are alive. */
interface FakeContainer { destroyed: boolean; titles: string[]; destroy(): void }

type FakeTarget = Parameters<typeof attachHoverTip>[1];
type FakeScene = Parameters<typeof attachHoverTip>[0];

function chainable<T extends object>(obj: T): T {
  return new Proxy(obj, {
    get(t, prop, receiver) {
      if (prop in t) return Reflect.get(t, prop, receiver);
      return () => chainable(t); // any unlisted method (setOrigin, lineStyle, …) is a no-op chain
    },
  });
}

/** One fake scene, sharing one `containers` list across every
 * `attachHoverTip` call made against it — the shape every real screen this
 * module serves has (one Phaser scene, several hoverable zones). */
function makeScene(): { scene: FakeScene; containers: FakeContainer[]; events: FakeEmitter } {
  const containers: FakeContainer[] = [];
  // `scene.add.text(x, y, content, style)` — captured so a container's
  // `titles` can be read back from its real children, the same way a human
  // would recognise "that's target B's tip" by what it says on screen.
  const pendingTexts: string[] = [];
  const makeText = (_x: number, _y: number, content: string): { height: number } & Record<string, unknown> => {
    pendingTexts.push(content);
    return chainable({ height: 8 });
  };
  const makeGraphics = (): Record<string, unknown> => chainable({});
  const makeContainer = (): FakeContainer => {
    const c: FakeContainer = { destroyed: false, titles: [...pendingTexts], destroy() { c.destroyed = true; } };
    pendingTexts.length = 0;
    containers.push(c);
    return chainable(c) as unknown as FakeContainer;
  };
  const events = new FakeEmitter();
  const scene = {
    add: { text: makeText, graphics: makeGraphics, container: makeContainer },
    events,
  } as unknown as FakeScene;
  return { scene, containers, events };
}

function attachTarget(scene: FakeScene, entries: readonly HoverTipEntry[]): FakeEmitter {
  const target = new FakeEmitter();
  attachHoverTip(scene, target as unknown as FakeTarget, RECT, entries);
  return target;
}

const RECT = { x: 10, y: 10, w: 40, h: 40 };
const ENTRIES: HoverTipEntry[] = [{ title: 'Poison', body: 'Deals one poison damage per stack.' }];
const ENTRIES_B: HoverTipEntry[] = [{ title: 'Thorns', body: 'Reflects damage back on being hit.' }];

function aliveContainers(containers: FakeContainer[]): FakeContainer[] {
  return containers.filter((c) => !c.destroyed);
}

/** Real single-finger touch gesture: all four events, in the traced order. */
function tap(target: FakeEmitter): void {
  target.emit('pointerdown', pointer(true));
  target.emit('pointerover', pointer(true));
  target.emit('pointerup', pointer(true));
  target.emit('pointerout', pointer(true));
}

describe('attachHoverTip: touch tap opens the tip and keeps it open, without breaking desktop hover', () => {
  it('renders a title-only entry without creating an empty body line', () => {
    const { scene, containers } = makeScene();
    const target = attachTarget(scene, [
      { title: 'Rank Bronze', body: '' },
      { title: 'Power Level (PL)', body: 'Measures the card cost.' },
    ]);

    target.emit('pointerover', pointer(false));

    expect(aliveContainers(containers)[0]?.titles).toEqual([
      'RANK BRONZE',
      'POWER LEVEL (PL)',
      'Measures the card cost.',
    ]);
  });

  it('a touch-shaped tap sequence (pointerdown -> pointerover -> pointerup -> pointerout) leaves the tip VISIBLE', () => {
    const { scene, containers } = makeScene();
    const target = attachTarget(scene, ENTRIES);

    tap(target);

    expect(aliveContainers(containers).length, 'the tap-opened tip must survive the tap\'s own trailing pointerout').toBe(1);
  });

  it('a second tap on the SAME target (touch) dismisses the tip it opened', () => {
    const { scene, containers } = makeScene();
    const target = attachTarget(scene, ENTRIES);

    tap(target);
    expect(aliveContainers(containers).length).toBe(1);

    tap(target);

    expect(aliveContainers(containers).length, 'a second tap must close it, not reopen it via the trailing pointerover').toBe(0);
  });

  it('a mouse-shaped hover (pointerover -> pointerout) still opens then closes on desktop', () => {
    const { scene, containers } = makeScene();
    const target = attachTarget(scene, ENTRIES);

    target.emit('pointerover', pointer(false));
    expect(aliveContainers(containers).length, 'mouse hover must still open the tip').toBe(1);

    target.emit('pointerout', pointer(false));
    expect(aliveContainers(containers).length, 'moving the mouse away must still close it').toBe(0);
  });

  it('scene shutdown force-hides an open touch tip (owner-handle teardown still holds)', () => {
    const { scene, containers, events } = makeScene();
    const target = attachTarget(scene, ENTRIES);

    target.emit('pointerdown', pointer(true));
    target.emit('pointerover', pointer(true));
    expect(aliveContainers(containers).length).toBe(1);

    events.emit('shutdown');
    expect(aliveContainers(containers).length, 'a scene teardown must not leave an orphaned tip on screen').toBe(0);
  });
});

describe('attachHoverTip: one tip at a time, scene-wide (independent audit finding, task-hovertip-touch-review.md)', () => {
  it('tap A then tap B (two different targets, one scene) leaves exactly ONE tip alive, and it is B\'s', () => {
    const { scene, containers } = makeScene();
    const targetA = attachTarget(scene, ENTRIES);
    const targetB = attachTarget(scene, ENTRIES_B);

    tap(targetA);
    expect(aliveContainers(containers).length, 'tap A alone must still open A\'s tip').toBe(1);

    tap(targetB);

    const alive = aliveContainers(containers);
    expect(alive.length, 'opening B\'s tip must close A\'s, not stack on top of it').toBe(1);
    expect(alive[0]!.titles, 'the survivor must be B\'s tip, not a leftover A').toContain('THORNS');
    expect(alive[0]!.titles).not.toContain('POISON');
  });

  it('tap A then tap A again still closes it (the same-target toggle is not regressed by the registry)', () => {
    const { scene, containers } = makeScene();
    const targetA = attachTarget(scene, ENTRIES);
    attachTarget(scene, ENTRIES_B); // a second target exists on the scene but is never touched

    tap(targetA);
    expect(aliveContainers(containers).length).toBe(1);

    tap(targetA);

    expect(aliveContainers(containers).length, 'a second tap on the SAME target must still dismiss it').toBe(0);
  });

  it('desktop: hover A then hover B (no pointerout on A in between) still leaves exactly one tip, B\'s', () => {
    const { scene, containers } = makeScene();
    const targetA = attachTarget(scene, ENTRIES);
    const targetB = attachTarget(scene, ENTRIES_B);

    targetA.emit('pointerover', pointer(false));
    expect(aliveContainers(containers).length).toBe(1);

    // No pointerout on A — proves the scene-wide takeover itself closes A,
    // not merely a coincidence of the ordinary hover-leaves-first sequence.
    targetB.emit('pointerover', pointer(false));

    const alive = aliveContainers(containers);
    expect(alive.length, 'desktop must still show one tip at a time across targets').toBe(1);
    expect(alive[0]!.titles).toContain('THORNS');
  });

  it('scene shutdown with one tip open leaves zero tips and clears the scene registry (two scenes never share state)', () => {
    const sceneOne = makeScene();
    const sceneTwo = makeScene();
    const oneA = attachTarget(sceneOne.scene, ENTRIES);
    attachTarget(sceneTwo.scene, ENTRIES_B);

    tap(oneA);
    expect(aliveContainers(sceneOne.containers).length).toBe(1);
    expect(aliveContainers(sceneTwo.containers).length).toBe(0);

    sceneOne.events.emit('shutdown');
    expect(aliveContainers(sceneOne.containers).length, 'scene one\'s own tip must close on its own shutdown').toBe(0);

    // Opening a fresh tip on scene one after its shutdown must not resurrect
    // or interact with anything left behind — proves the registry entry was
    // actually cleared, not merely orphaned.
    const oneC = attachTarget(sceneOne.scene, ENTRIES);
    tap(oneC);
    expect(aliveContainers(sceneOne.containers).length).toBe(1);
    expect(aliveContainers(sceneTwo.containers).length, 'scene two must never have been touched by scene one\'s teardown').toBe(0);
  });
});
