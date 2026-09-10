import { describe, expect, it, vi } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type Phaser from 'phaser';
import { skillBook } from '../../src/data/skills';

vi.mock('phaser', () => ({
  default: {
    Math: {
      Clamp: (value: number, min: number, max: number) => Math.max(min, Math.min(max, value)),
    },
  },
}));

import { renderCardInfoBox } from '../../src/game/ui/cardInfoBox';

type FakeObject = {
  active: boolean;
  height?: number;
  text?: string;
  list?: FakeObject[];
  destroy: () => void;
  setOrigin: (...args: unknown[]) => FakeObject;
  setInteractive?: (...args: unknown[]) => FakeObject;
  setDepth?: (...args: unknown[]) => FakeObject;
  setMask?: (...args: unknown[]) => FakeObject;
  clearMask?: (...args: unknown[]) => FakeObject;
  setY?: (...args: unknown[]) => FakeObject;
  /** Added 2026-09-07 with the info box's scroll affordance: its two edge
   * fades are shown only on the side that really has more content, the same
   * rule both shop shelves use for theirs. `setVisible` is a universal
   * GameObject capability, so the stub was simply incomplete. */
  setVisible?: (...args: unknown[]) => FakeObject;
  add?: (child: FakeObject) => FakeObject;
};

function fakeScene() {
  const resources: FakeObject[] = [];
  const makeObject = (extra: Partial<FakeObject> = {}): FakeObject => {
    const object = {
      active: true,
      destroy: () => { object.active = false; },
      setOrigin: () => object,
      setInteractive: () => object,
      setDepth: () => object,
      setMask: () => object,
      clearMask: () => object,
      setY: () => object,
      setVisible: () => object,
      ...extra,
    } as FakeObject;
    resources.push(object);
    return object;
  };
  const mask = makeObject();
  const graphics = makeObject() as FakeObject & {
    fillStyle: () => FakeObject;
    fillRect: () => FakeObject;
    createGeometryMask: () => FakeObject;
  };
  graphics.fillStyle = () => graphics;
  graphics.fillRect = () => graphics;
  graphics.createGeometryMask = () => mask;

  const listeners = new Map<string, Set<(...args: never[]) => void>>();
  const scene = {
    make: { graphics: () => graphics },
    add: {
      rectangle: () => makeObject(),
      text: (_x: number, _y: number, text: string) => makeObject({ text, height: Math.max(12, Math.ceil(text.length / 48) * 12) }),
      container: () => {
        const children: FakeObject[] = [];
        const container = makeObject({ list: children });
        container.add = (child) => { children.push(child); return container; };
        const baseDestroy = container.destroy;
        container.destroy = () => {
          for (const child of children) child.destroy();
          baseDestroy();
        };
        return container;
      },
    },
    input: {
      on: (event: string, listener: (...args: never[]) => void) => {
        const set = listeners.get(event) ?? new Set();
        set.add(listener);
        listeners.set(event, set);
      },
      off: (event: string, listener: (...args: never[]) => void) => listeners.get(event)?.delete(listener),
    },
  };
  return { scene: scene as unknown as Phaser.Scene, resources, listeners };
}

describe('mobile Wiki card-info lifecycle', () => {
  it('renders rank as one line with no empty body or reserved body gap', () => {
    const { scene, resources } = fakeScene();
    const handle = renderCardInfoBox(scene, 20, 400, 372, 430, skillBook.fireball!);
    const texts = resources.filter((resource) => resource.text !== undefined);
    const rankTextIndex = texts.findIndex((resource) => resource.text === 'RANK BRONZE');
    const rankEntryIndex = texts
      .slice(1, rankTextIndex + 1)
      .filter((resource) => resource.text?.toUpperCase() === resource.text).length - 1;

    expect(rankTextIndex, 'the dynamic rank label is visible').toBeGreaterThan(0);
    expect(texts.some((resource) => resource.text === 'BRONZE TIER')).toBe(false);
    expect(texts.some((resource) => resource.text === '')).toBe(false);
    expect(texts[rankTextIndex + 1]?.text, 'Power Level remains the next separate entry').toBe('POWER LEVEL (PL)');
    expect(
      handle.entryTops[rankEntryIndex + 1]! - handle.entryTops[rankEntryIndex]!,
      'a title-only rank entry reserves only its title plus the normal inter-entry gap',
    ).toBe(20);
  });

  it('returns one owner handle that destroys every display and mask resource', () => {
    const { scene, resources } = fakeScene();
    const handle = renderCardInfoBox(scene, 20, 400, 372, 430, skillBook.nullshroud!) as unknown as
      | { destroy: () => void }
      | undefined;

    expect(handle, 'Wiki rerenders need an owner for the glossary container, hit surface, and mask').toBeDefined();
    if (!handle) return;

    handle.destroy();
    expect(resources.every((resource) => !resource.active)).toBe(true);
  });

  /**
   * THE TEARDOWN TEST ABOVE MUST ACTUALLY COVER THE SCROLL DECORATIONS.
   *
   * It asserts every created resource is inactive after `destroy()`, which is
   * only meaningful for the track/thumb/two fades if the box SCROLLED in that
   * case — the decorations are created only then. That was true by luck (it
   * was how the `Graphics` and `setVisible` failures surfaced at all), and
   * luck is not a pin: if a future entry list got shorter, the teardown test
   * would keep passing while covering four fewer objects.
   */
  it('the teardown case really does scroll, so it covers the scroll decorations', () => {
    const { scene, resources } = fakeScene();
    const handle = renderCardInfoBox(scene, 20, 400, 372, 430, skillBook.nullshroud!);
    // 4 decorations = track + thumb + fadeTop + fadeBottom. Their presence is
    // the proof the box overflowed; `renderCardInfoBox` returns early before
    // creating any of them when it fits.
    const rectangles = resources.filter((r) => r.text === undefined && r.list === undefined);
    expect(rectangles.length, 'hit surface + 4 scroll decorations').toBeGreaterThanOrEqual(5);
    handle.destroy();
    expect(resources.every((r) => !r.active)).toBe(true);
  });

  /**
   * THE ENTRY SNAP STRANDS A TALL ENTRY IF ITS BOX IS SHORTER THAN IT.
   *
   * Scrolling snaps the viewport top to an entry boundary so no definition is
   * cut mid-sentence at the top edge. Reachable tops are therefore exactly the
   * recorded `entryTops` plus `maxScroll` (the bottom is kept reachable so the
   * LAST entry can always be finished). For a MIDDLE entry spanning
   * `[t, next)`, nothing lands in `(t, t + h]`, so if `next - t > h` the slice
   * `[t + h, next)` cannot be scrolled to at all.
   *
   * THE PREVIOUS VERSION OF THIS PIN WAS WRONG IN BOTH HALVES.
   *
   *   It measured the wrong pairs. `renderCardInfoBox` emits the card's own
   *   FACE LINE first and then a title/body pair per entry, so walking
   *   `texts[i], texts[i+1]` from i=0 pairs the face line with the first title
   *   and is one text out of step for the rest of the list. It reported 96px
   *   and labelled that "entry" with a BODY string — the tell. The real answer
   *   is 118px boundary-to-boundary (108px of ink plus the renderer's own 2+8
   *   gaps) on `TEMPO TOLL`. It now reads `handle.entryTops`, which the
   *   renderer records as it lays out, so the test cannot walk out of step with
   *   the layout or re-derive its gaps.
   *
   *   And it invented its bound. `SMALLEST_BOX_H = 154` was a magic number
   *   from one caller at one viewport, while five of the call sites floor their
   *   height at `Math.max(60, …)`. 60 is the height the callers actually
   *   guarantee, it is DERIVED from their source below, and the tallest entry
   *   does NOT fit it — so "the tallest entry fits the smallest box" was not a
   *   true invariant, it was a true-looking one measured against a number
   *   chosen to make it pass.
   */
  describe('the entry snap vs the tallest entry', () => {
    /** Boundary-to-boundary height of every entry, from the renderer's record. */
    function tallestEntry(): { px: number; title: string; card: string } {
      let px = 0;
      let title = '';
      let card = '';
      for (const skill of Object.values(skillBook)) {
        const { scene, resources } = fakeScene();
        const handle = renderCardInfoBox(scene, 0, 0, 372, 60, skill);
        const bounds = [...handle.entryTops, handle.contentHeight];
        for (let i = 0; i + 1 < bounds.length; i += 1) {
          const h = (bounds[i + 1] ?? 0) - (bounds[i] ?? 0);
          if (h <= px) continue;
          px = h;
          // Entry `i`'s TITLE is text index `1 + 2i` — one face line, then
          // title/body pairs. Stated here only to name the offender in the
          // failure message; the measurement above does not depend on it.
          const texts = resources.filter((r) => r.text !== undefined);
          title = String(texts[1 + 2 * i]?.text ?? '?');
          card = skill.id;
        }
      }
      return { px, title, card };
    }

    it('the tallest entry in the catalog is 118px, on TEMPO TOLL', () => {
      const { px, title, card } = tallestEntry();
      // A RATCHET, in this suite's own idiom: a measured high-water mark that
      // may fall freely and must not rise unnoticed. It rises when a
      // `ruleSentence` gets longer, which is a text decision worth seeing.
      expect(px, `tallest entry is "${title}" on ${card}`).toBeLessThanOrEqual(118);
      expect(title).toBe('TEMPO TOLL');
      expect(card).toBe('deadweight_toll');
    });

    it('60 is the box height the callers actually guarantee — read, not assumed', () => {
      // Derived from the call sites so it cannot drift from them, and so the
      // bound is never again a number somebody picked.
      // Bound to the VARIABLE that is actually handed to the box as its
      // height, so a `Math.max` elsewhere in the same scene cannot be mistaken
      // for this one: find `const h = Math.max(N, …)`, then require `h` to
      // appear in a `renderCardInfoBox(` argument list.
      const SCENES = join(process.cwd(), 'src', 'game', 'scenes');
      const floors = new Set<number>();
      const floored: string[] = [];
      for (const name of readdirSync(SCENES)) {
        if (!name.endsWith('.ts')) continue;
        const src = readFileSync(join(SCENES, name), 'utf8');
        const calls = src.match(/renderCardInfoBox\([^;]*/g) ?? [];
        if (calls.length === 0) continue;
        for (const m of src.matchAll(/const (\w+) = Math\.max\((\d+),/g)) {
          const [, varName, floor] = m;
          if (varName === undefined || floor === undefined) continue;
          const passed = calls.some((call) => new RegExp(`\\b${varName}\\b`).test(call));
          if (!passed) continue;
          floors.add(Number(floor));
          floored.push(`${name}: ${varName} = Math.max(${floor}, …)`);
        }
      }
      expect(floored.length, `floored info-box heights found:\n${floored.join('\n')}`)
        .toBeGreaterThanOrEqual(4);
      expect([...floors], `every floored call site uses the same floor:\n${floored.join('\n')}`)
        .toEqual([60]);
    });

    it('so box height ALONE does not protect a middle entry — the bottom escape does', () => {
      // The honest statement of today's position, replacing the false claim:
      // the tallest entry (118px) is TALLER than the floor the callers
      // guarantee (60px), so at that floor a middle entry's tail would be
      // unreachable. What bounds the damage is the escape hatch in
      // `applyScroll` — the very bottom is always a reachable top, so the LAST
      // entry can always be finished however tall it is.
      const { px } = tallestEntry();
      expect(px).toBeGreaterThan(60);
      const src = readFileSync(join(process.cwd(), 'src', 'game', 'ui', 'cardInfoBox.ts'), 'utf8');
      expect(src, 'applyScroll must keep the very bottom reachable')
        .toMatch(/if \(-clamped >= maxScroll - 1\) snapped = -maxScroll;/);
    });
  });
});
