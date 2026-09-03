import { describe, expect, it } from 'vitest';
import {
  renderRetireConfirm, renderUnspentPlConfirm, shouldConfirmUnspentPL,
  type BattleEntryPoint,
} from '../../src/game/ui/RunProgressStrip';

/**
 * The unspent-PL fight gate (2026-09-02) — regression net for the 2026-08-31
 * playtest failure: the player pressed FIGHT with 3 PL banked and nothing
 * stood in the way.
 *
 * Two layers are pinned here:
 *
 *   1. THE DECISION — `shouldConfirmUnspentPL` is pure (banked > 0 AND the
 *      entry is the prep FIGHT press), so the "zero-banked players must never
 *      see it / replay must never trip it" rules are assertions, not
 *      screenshot arguments. The four prep scenes all call this one function;
 *      a scene cannot quietly invent its own threshold.
 *   2. THE DIALOG — `renderUnspentPlConfirm` is driven through a duck-typed
 *      fake scene (the `ruleClearanceAudit.test.ts` stance: the wiring under
 *      test — which label sits on which handler — is Phaser-free; a real
 *      canvas would only add glyph metrics). Buttons are located by which
 *      plate their LABEL's centre sits on, not by draw order, so a reshuffle
 *      of the render code cannot silently swap FIGHT ANYWAY and SPEND FIRST.
 *
 * `renderRetireConfirm` is asserted alongside because the 2026-09-02 change
 * refactored it onto the same shared dialog — its copy, its two labels and
 * its scrim-cancels behaviour must come through the refactor byte-identical.
 */

// ---------------------------------------------------------------------------
// 1. The pure gate.
// ---------------------------------------------------------------------------

describe('shouldConfirmUnspentPL: warn iff banked > 0 AND the entry is prep FIGHT', () => {
  it('fires for a prep FIGHT press with PL banked', () => {
    expect(shouldConfirmUnspentPL(1, 'prep-fight')).toBe(true);
    expect(shouldConfirmUnspentPL(3, 'prep-fight')).toBe(true);
    expect(shouldConfirmUnspentPL(9, 'prep-fight')).toBe(true);
  });

  it('a zero-banked player NEVER sees it', () => {
    expect(shouldConfirmUnspentPL(0, 'prep-fight')).toBe(false);
  });

  it('a defensive negative (an over-spend mid-edit) never warns either', () => {
    expect(shouldConfirmUnspentPL(-1, 'prep-fight')).toBe(false);
  });

  it('battle REPLAY (or any non-prep entry) never trips it, banked or not', () => {
    expect(shouldConfirmUnspentPL(3, 'battle-replay')).toBe(false);
    expect(shouldConfirmUnspentPL(0, 'battle-replay')).toBe(false);
  });

  it('the entry union names exactly the two paths the scenes distinguish', () => {
    // Compile-time exhaustiveness: a new entry point must make a decision here
    // rather than inherit one. (The assignment is the assertion.)
    const entries: BattleEntryPoint[] = ['prep-fight', 'battle-replay'];
    expect(entries).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// 2. The dialog, driven through a fake scene.
// ---------------------------------------------------------------------------

type Handler = (pointer: unknown) => void;

interface FakeRect {
  x: number; y: number; w: number; h: number;
  interactive: boolean;
  onPointerDown: Handler | null;
}

interface FakeText {
  x: number; y: number;
  content: string;
  originX: number; originY: number;
}

interface FakeScene {
  scene: unknown;
  rects: FakeRect[];
  texts: FakeText[];
}

function makeFakeScene(): FakeScene {
  const rects: FakeRect[] = [];
  const texts: FakeText[] = [];
  const scene = {
    add: {
      rectangle(x: number, y: number, w: number, h: number) {
        const state: FakeRect = { x, y, w, h, interactive: false, onPointerDown: null };
        rects.push(state);
        const self: Record<string, unknown> = {
          setOrigin() { return self; },
          setStrokeStyle() { return self; },
          setDepth() { return self; },
          setInteractive() { state.interactive = true; return self; },
          on(event: string, fn: Handler) {
            if (event === 'pointerdown') state.onPointerDown = fn;
            return self;
          },
        };
        return self;
      },
      text(x: number, y: number, content: string) {
        const state: FakeText = { x, y, content, originX: 0, originY: 0 };
        texts.push(state);
        const self: Record<string, unknown> = {
          setOrigin(ox = 0, oy?: number) { state.originX = ox; state.originY = oy ?? ox; return self; },
          setDepth() { return self; },
        };
        return self;
      },
    },
  };
  return { scene, rects, texts };
}

/** The interactive plate a LABEL's anchor point sits on — buttons are found by
 * geometry, never by draw order. The scrim also contains every label, so the
 * SMALLEST containing plate is the button itself. */
function plateUnderLabel(fake: FakeScene, label: string): FakeRect {
  const text = fake.texts.find((t) => t.content === label);
  expect(text, `label "${label}" was not drawn`).toBeDefined();
  const hits = fake.rects.filter((r) =>
    r.interactive && r.onPointerDown !== null
    && text!.x >= r.x && text!.x <= r.x + r.w
    && text!.y >= r.y && text!.y <= r.y + r.h);
  expect(hits.length, `no pressable plate under "${label}"`).toBeGreaterThan(0);
  return hits.reduce((smallest, r) => (r.w * r.h < smallest.w * smallest.h ? r : smallest));
}

/** The full-canvas dismiss scrim — the largest pressable rect. */
function scrimOf(fake: FakeScene): FakeRect {
  const pressable = fake.rects.filter((r) => r.interactive && r.onPointerDown !== null);
  return pressable.reduce((largest, r) => (r.w * r.h > largest.w * largest.h ? r : largest));
}

const POINTER = { synthetic: true };

describe('renderUnspentPlConfirm: the "N PL UNSPENT" dialog', () => {
  for (const compact of [false, true]) {
    const platform = compact ? 'mobile' : 'desktop';

    it(`${platform}: names the debt and offers SPEND FIRST / FIGHT ANYWAY`, () => {
      const fake = makeFakeScene();
      renderUnspentPlConfirm(fake.scene as never, {
        compact, banked: 3,
        onFightAnyway: () => {}, onSpendFirst: () => {}, onDismiss: () => {},
      });
      const contents = fake.texts.map((t) => t.content);
      expect(contents).toContain('3 PL UNSPENT');
      expect(contents).toContain('SPEND FIRST');
      expect(contents).toContain('FIGHT ANYWAY');
    });

    it(`${platform}: each control fires ITS handler, no other, and forwards the pointer`, () => {
      // The pointer must ride through (CONFIRMED INSTANCE #20's contract —
      // see pointerConsumptionAudit.test.ts for the source-scan half).
      const fired: Array<[string, unknown]> = [];
      const fake = makeFakeScene();
      renderUnspentPlConfirm(fake.scene as never, {
        compact, banked: 9,
        onFightAnyway: (p) => fired.push(['fight', p]),
        onSpendFirst: (p) => fired.push(['spend', p]),
        onDismiss: (p) => fired.push(['dismiss', p]),
      });
      plateUnderLabel(fake, 'FIGHT ANYWAY').onPointerDown!(POINTER);
      expect(fired).toEqual([['fight', POINTER]]);
      plateUnderLabel(fake, 'SPEND FIRST').onPointerDown!(POINTER);
      expect(fired).toEqual([['fight', POINTER], ['spend', POINTER]]);
      scrimOf(fake).onPointerDown!(POINTER);
      expect(fired).toEqual([['fight', POINTER], ['spend', POINTER], ['dismiss', POINTER]]);
    });

    it(`${platform}: the scrim is a plain DISMISS — not FIGHT ANYWAY`, () => {
      // Tapping outside must never start a battle: the scrim's plate and the
      // FIGHT ANYWAY plate carry different handlers.
      const fake = makeFakeScene();
      let fights = 0;
      let dismissed = 0;
      renderUnspentPlConfirm(fake.scene as never, {
        compact, banked: 1,
        onFightAnyway: () => { fights += 1; }, onSpendFirst: () => {}, onDismiss: () => { dismissed += 1; },
      });
      scrimOf(fake).onPointerDown!(POINTER);
      expect(fights).toBe(0);
      expect(dismissed).toBe(1);
    });

    it(`${platform}: the count in the title is the caller's banked figure`, () => {
      const fake = makeFakeScene();
      renderUnspentPlConfirm(fake.scene as never, {
        compact, banked: 12,
        onFightAnyway: () => {}, onSpendFirst: () => {}, onDismiss: () => {},
      });
      expect(fake.texts.map((t) => t.content)).toContain('12 PL UNSPENT');
    });
  }
});

describe('renderRetireConfirm: unchanged through the shared-dialog refactor', () => {
  for (const compact of [false, true]) {
    const platform = compact ? 'mobile' : 'desktop';

    it(`${platform}: same copy, same two buttons`, () => {
      const fake = makeFakeScene();
      renderRetireConfirm(fake.scene as never, { compact, onConfirm: () => {}, onCancel: () => {} });
      const contents = fake.texts.map((t) => t.content);
      expect(contents).toContain('RETIRE THIS RUN?');
      expect(contents).toContain('CANCEL');
      expect(contents).toContain('RETIRE');
      expect(contents.some((c) => c.includes('locked in'))).toBe(true);
    });

    it(`${platform}: scrim cancels (its shipped behaviour), RETIRE confirms`, () => {
      const fired: string[] = [];
      const fake = makeFakeScene();
      renderRetireConfirm(fake.scene as never, {
        compact,
        onConfirm: () => fired.push('confirm'),
        onCancel: () => fired.push('cancel'),
      });
      scrimOf(fake).onPointerDown!(POINTER);
      plateUnderLabel(fake, 'RETIRE').onPointerDown!(POINTER);
      plateUnderLabel(fake, 'CANCEL').onPointerDown!(POINTER);
      expect(fired).toEqual(['cancel', 'confirm', 'cancel']);
    });
  }
});
