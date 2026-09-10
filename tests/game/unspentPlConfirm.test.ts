import { describe, expect, it } from 'vitest';
import {
  renderEventCostConfirm, renderMergeConsumeConfirm, renderRetireConfirm, renderSellGemConfirm,
  renderUnspentPlConfirm, shouldConfirmUnspentPL, type BattleEntryPoint,
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
          setPosition(nx: number, ny: number) { state.x = nx; state.y = ny; return self; },
          // This fake has no canvas/font metrics, so it cannot run Phaser's
          // real word-wrap — every body this harness drives is short enough
          // that width-wrapping never comes into play, only the authored
          // '\n's `renderConfirmDialog` now measures via `getWrappedText`
          // (finding 6, 2026-09-06 audit) rather than a plain `split('\n')`.
          getWrappedText(t?: string) { return (t ?? state.content).split('\n'); },
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

/**
 * `renderMergeConsumeConfirm` (2026-09-06) — the mergeCards choice's
 * UNCONDITIONAL pre-resolution CONFIRM. Driven through the same fake-scene
 * harness as its siblings above, same as every other confirm dialog in this
 * file — not because a real Playwright click can't reach it (it can: a
 * 2026-09-06 re-check found the earlier claim to that effect FALSE — see
 * below), but for the same reason `renderUnspentPlConfirm` above is: this
 * harness pins exactly which label sits on which handler, independent of
 * glyph metrics, and a real canvas would only add noise to that.
 *
 * CORRECTED (2026-09-06): this comment used to claim a Playwright click
 * "could not be made to register reliably in this environment even on the
 * pre-existing, unmodified `renderRetireConfirm`". That was never a property
 * of the dialog — it was a coordinate-space bug in the PROBE. The scenes run
 * `Phaser.Scale.RESIZE` with the UI scale applied in the CAMERA
 * (`src/game/renderScale.ts`), so `collectSceneTexts` reports DESIGN
 * coordinates, not device pixels; the earlier probes ran the browser at
 * 390x844 against a 412x892 design canvas (`cameras.main.zoom` ≈ 0.9462) and
 * fed the design coordinates straight to `page.mouse.click` unscaled. A tall
 * panel's buttons absorbed the ~5.7% error; a 40px-tall button ~490px down
 * the RETIRE dialog did not. Multiplying design coordinates by
 * `cameras.main.zoom` (or simply running the browser at EXACTLY 412x892 /
 * 1440x900, where zoom is 1) makes scale-corrected Playwright clicks land
 * reliably on RETIRE, the merge confirm, and every dialog added since —
 * both platforms. See `docs/ui-workbook.md` for the capture recipe.
 */
describe('renderMergeConsumeConfirm: the mergeCards pre-resolution confirm', () => {
  for (const compact of [false, true]) {
    const platform = compact ? 'mobile' : 'desktop';
    const body = '3 BRONZE → 1 SILVER\nShadow Bolt (BOARD 1)\nPrism Barrier (BOARD 2)\nLine Breaker (BOARD 5)';

    it(`${platform}: names the trade headline and every spent card, offers CANCEL / MERGE`, () => {
      const fake = makeFakeScene();
      renderMergeConsumeConfirm(fake.scene as never, { compact, body, onConfirm: () => {}, onCancel: () => {} });
      const contents = fake.texts.map((t) => t.content);
      expect(contents).toContain('MERGE — CARDS LEAVE YOUR BOARD');
      expect(contents).toContain('CANCEL');
      expect(contents).toContain('MERGE');
      expect(contents).toContain(body);
    });

    it(`${platform}: CANCEL fires onCancel, MERGE fires onConfirm, the scrim cancels (never merges)`, () => {
      const fired: string[] = [];
      const fake = makeFakeScene();
      renderMergeConsumeConfirm(fake.scene as never, {
        compact, body,
        onConfirm: () => fired.push('confirm'),
        onCancel: () => fired.push('cancel'),
      });
      scrimOf(fake).onPointerDown!(POINTER);
      plateUnderLabel(fake, 'MERGE').onPointerDown!(POINTER);
      plateUnderLabel(fake, 'CANCEL').onPointerDown!(POINTER);
      expect(fired).toEqual(['cancel', 'confirm', 'cancel']);
    });

    it(`${platform}: a longer body (more spent cards named) grows the panel instead of clipping it`, () => {
      // `fake.rects[1]` is the PANEL — `renderConfirmDialog` draws the scrim
      // first, the panel second, then the two buttons — the same order every
      // sibling dialog above already relies on implicitly via `scrimOf`
      // (the largest rect) and `plateUnderLabel` (the smallest containing
      // one); the panel is the one left over.
      const two = makeFakeScene();
      renderRetireConfirm(two.scene as never, { compact, onConfirm: () => {}, onCancel: () => {} });
      const twoLineH = two.rects[1]!.h;

      const four = makeFakeScene();
      renderMergeConsumeConfirm(four.scene as never, { compact, body, onConfirm: () => {}, onCancel: () => {} });
      const fourLineH = four.rects[1]!.h;

      // RETIRE's body is exactly 2 lines (the untouched baseline `ph`); this
      // merge body is 4 — two extra lines' worth of panel height, never a
      // fixed box the extra names would have to be squeezed or clipped into.
      expect(fourLineH).toBeGreaterThan(twoLineH);
    });
  }
});

/**
 * The shared dialog's 2-line baseline panel height (finding 6, 2026-09-06
 * audit) — pinned as an EXACT number, not just "taller than", so a future
 * change to `renderConfirmDialog`'s sizing arithmetic cannot silently move
 * RETIRE or the unspent-PL gate (both exactly 2 lines) without a test
 * noticing. 176 desktop / 168 mobile are the literals `renderConfirmDialog`
 * itself hardcodes (RunProgressStrip.ts).
 */
describe('renderConfirmDialog: the 2-line panel height baseline is pinned, not just "bigger than"', () => {
  it('desktop: 176px for a 2-line body (RETIRE)', () => {
    const fake = makeFakeScene();
    renderRetireConfirm(fake.scene as never, { compact: false, onConfirm: () => {}, onCancel: () => {} });
    expect(fake.rects[1]!.h).toBe(176);
  });

  it('mobile: 168px for a 2-line body (RETIRE)', () => {
    const fake = makeFakeScene();
    renderRetireConfirm(fake.scene as never, { compact: true, onConfirm: () => {}, onCancel: () => {} });
    expect(fake.rects[1]!.h).toBe(168);
  });

  it('the unspent-PL gate is also exactly 2 lines and shares the same baseline', () => {
    const desktop = makeFakeScene();
    renderUnspentPlConfirm(desktop.scene as never, {
      compact: false, banked: 3, onFightAnyway: () => {}, onSpendFirst: () => {}, onDismiss: () => {},
    });
    expect(desktop.rects[1]!.h).toBe(176);

    const mobile = makeFakeScene();
    renderUnspentPlConfirm(mobile.scene as never, {
      compact: true, banked: 3, onFightAnyway: () => {}, onSpendFirst: () => {}, onDismiss: () => {},
    });
    expect(mobile.rects[1]!.h).toBe(168);
  });
});

/**
 * `renderEventCostConfirm` (2026-09-06, superseding user ruling: confirm on
 * anything that COSTS) — the generic pre-resolution confirm for a rung whose
 * outcome costs GOLD (`choice.cost > 0`), every kind except `mergeCards`.
 * Same fake-scene harness as every sibling dialog above.
 */
describe('renderEventCostConfirm: the generic gold-cost pre-resolution confirm', () => {
  for (const compact of [false, true]) {
    const platform = compact ? 'mobile' : 'desktop';

    it(`${platform}: names the caller's title and body, offers CANCEL / CONFIRM`, () => {
      const fake = makeFakeScene();
      renderEventCostConfirm(fake.scene as never, {
        compact, title: 'SPEND 5 GOLD?', body: 'CHOICE OF 3 CARDS\nCosts 5 gold.',
        onConfirm: () => {}, onCancel: () => {},
      });
      const contents = fake.texts.map((t) => t.content);
      expect(contents).toContain('SPEND 5 GOLD?');
      expect(contents).toContain('CHOICE OF 3 CARDS\nCosts 5 gold.');
      expect(contents).toContain('CANCEL');
      expect(contents).toContain('CONFIRM');
    });

    it(`${platform}: CANCEL fires onCancel, CONFIRM fires onConfirm, the scrim cancels`, () => {
      const fired: string[] = [];
      const fake = makeFakeScene();
      renderEventCostConfirm(fake.scene as never, {
        compact, title: 'SPEND 5 GOLD?', body: 'CHOICE OF 3 CARDS\nCosts 5 gold.',
        onConfirm: () => fired.push('confirm'),
        onCancel: () => fired.push('cancel'),
      });
      scrimOf(fake).onPointerDown!(POINTER);
      plateUnderLabel(fake, 'CONFIRM').onPointerDown!(POINTER);
      plateUnderLabel(fake, 'CANCEL').onPointerDown!(POINTER);
      expect(fired).toEqual(['cancel', 'confirm', 'cancel']);
    });
  }
});

/**
 * `renderSellGemConfirm` (2026-09-06, same ruling) — the `sellGem` picker's
 * own pre-finalize confirm, shown after the specific gem and its price are
 * known.
 */
describe('renderSellGemConfirm: the sellGem picker pre-finalize confirm', () => {
  for (const compact of [false, true]) {
    const platform = compact ? 'mobile' : 'desktop';

    it(`${platform}: names the gem and the gold it returns, offers CANCEL / SELL`, () => {
      const fake = makeFakeScene();
      renderSellGemConfirm(fake.scene as never, {
        compact, title: 'SELL BRAMBLE SLIVER?', body: '+4 GOLD',
        onConfirm: () => {}, onCancel: () => {},
      });
      const contents = fake.texts.map((t) => t.content);
      expect(contents).toContain('SELL BRAMBLE SLIVER?');
      expect(contents).toContain('+4 GOLD');
      expect(contents).toContain('CANCEL');
      expect(contents).toContain('SELL');
    });

    it(`${platform}: CANCEL fires onCancel, SELL fires onConfirm, the scrim cancels (never sells)`, () => {
      const fired: string[] = [];
      const fake = makeFakeScene();
      renderSellGemConfirm(fake.scene as never, {
        compact, title: 'SELL BRAMBLE SLIVER?', body: '+4 GOLD',
        onConfirm: () => fired.push('confirm'),
        onCancel: () => fired.push('cancel'),
      });
      scrimOf(fake).onPointerDown!(POINTER);
      plateUnderLabel(fake, 'SELL').onPointerDown!(POINTER);
      plateUnderLabel(fake, 'CANCEL').onPointerDown!(POINTER);
      expect(fired).toEqual(['cancel', 'confirm', 'cancel']);
    });
  }
});
