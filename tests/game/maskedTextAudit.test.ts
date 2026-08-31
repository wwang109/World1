import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  escapesCanvas,
  overlapArea,
  reduceMaskCommands,
  visibleBounds,
  type Rect,
} from '../../src/game/ui/maskedTextBounds';
import { resolveDrawnTexts, type RawTextBound } from '../../scripts/sceneText';
import {
  auditTextBlock,
  layoutAuditFailures,
  resetLayoutAuditFailures,
} from '../../src/game/ui/controlLayoutAudit';

/**
 * MASKED TEXT AUDIT — a browser-driven layout audit may only report what is
 * actually DRAWN, and it must still be able to see a real collision.
 *
 * THE SHIPPED BUG THIS EXISTS TO CATCH (2026-08-31). `scripts/run-hud-audit.ts`
 * walked the live scene graph collecting every `Text` object's world bounds and
 * flagged off-canvas / overlapping pairs. It never looked at geometry masks.
 * Phaser CLIPS a masked object — a shop-shelf row scrolled out of its viewport
 * is not painted at all — but `visible` stays `true`, `alpha` stays `1`, and
 * `getBounds()` still reports the un-clipped rectangle wherever the layout math
 * put it. The audit therefore produced two confident findings:
 *
 *     "GEM POUCH" x "Frost Sliver"     overlap
 *     "2 G" off-canvas at y928         off-canvas   (a 892px-tall viewport)
 *
 * Neither was on screen. Both were inside the shop shelf's mask. Both were then
 * briefed to another agent as fact and cost it a round trip before a later
 * auditor went and looked. A false-positive audit is WORSE than no audit,
 * because it is trusted.
 *
 * WHY A TEST AND NOT JUST THE SCRIPT. The script needs a dev server, a battle
 * API and a real Chromium; it cannot run in `npm test`, so nothing in CI could
 * observe this arithmetic regressing. The geometry therefore lives in
 * `src/game/ui/maskedTextBounds.ts` as pure TypeScript and the browser-side
 * half stays dumb (bounds + raw mask command buffers), which is what lets this
 * file drive the code the scripts actually ship rather than a retyped copy of
 * it — the drift this project has already closed for `fmtDamage`,
 * `OFFENSIVE_KINDS` and the tier scaler's "fourth mirror".
 *
 * THE TEETH are the last block: the same detector, pointed at the PRE-`2ca972a`
 * header-rule geometry, must still report a collision. Calibrating a detector
 * on a known-broken input before believing its zeros is the standard this
 * project already set — the agent that swept 13 scenes for overlaps proved its
 * detector found 4 problems in a known-bad expression first. If that block ever
 * goes quiet, this audit has stopped being able to see what it was written for
 * and every green run it produces is meaningless.
 */

/** How Phaser's `Graphics.fillStyle(color)` then `fillRect(x,y,w,h)` lands in
 * the command buffer — the construction EVERY scroll viewport in this game
 * ships (`DesktopShopScene`, `MobileShopScene`, `MobileDeckBuildScene`,
 * `MobileWikiScene`, `DesktopWikiScene`, `MobileRunEventScene`, `cardInfoBox`). */
function fillRectBuffer(x: number, y: number, w: number, h: number): number[] {
  return [7, 0xffffff, 1, 3, x, y, w, h];
}

function raw(text: string, box: Rect, maskBuffers: number[][] = []): RawTextBound {
  return {
    text, scene: 'MobileShop',
    x: box.x, y: box.y, width: box.width, height: box.height,
    maskChain: maskBuffers.map((commands) => ({ commands, offsetX: 0, offsetY: 0 })),
  };
}

// ---------------------------------------------------------------------------
// Reading a mask off a Phaser command buffer.
// ---------------------------------------------------------------------------

describe('game/ui/maskedTextBounds: reduceMaskCommands', () => {
  it('reads the fillStyle-then-fillRect buffer every scroll viewport in this game ships', () => {
    const shelfViewport = { x: 8, y: 152, width: 396, height: 200 };
    const shape = reduceMaskCommands(fillRectBuffer(8, 152, 396, 200));
    expect(shape.unresolved).toBe(false);
    expect(shape.rects).toEqual([shelfViewport]);
  });

  it('stays in sync through a lineStyle, which the ad-hoc scratchpad reducer did not', () => {
    // `scratchpad/shopaudit/lib.ts` skipped 1 argument for FILL_STYLE and 2 for
    // LINE_STYLE; both are off by one (they push 2 and 3). It survived only
    // because a stray alpha of 1 is not a command id. A mask drawn with a line
    // style first desynchronises it — this asserts the shipped reducer does not.
    const buffer = [6, 2, 0x000000, 1, ...fillRectBuffer(10, 20, 30, 40)];
    expect(reduceMaskCommands(buffer)).toEqual({
      rects: [{ x: 10, y: 20, width: 30, height: 40 }],
      unresolved: false,
    });
  });

  it('refuses to guess past an opcode it cannot model, rather than reading arguments as commands', () => {
    // ARC (0) has arguments this reducer does not know the count of. Continuing
    // would make every later byte ambiguous and produce confident nonsense.
    const shape = reduceMaskCommands([...fillRectBuffer(0, 0, 10, 10), 0, 5, 5, 5, 0, 6.28]);
    expect(shape.unresolved).toBe(true);
    expect(shape.rects).toEqual([{ x: 0, y: 0, width: 10, height: 10 }]);
  });

  it('honours the mask Graphics own world position', () => {
    expect(reduceMaskCommands(fillRectBuffer(0, 0, 10, 10), 100, 50).rects)
      .toEqual([{ x: 100, y: 50, width: 10, height: 10 }]);
  });
});

// ---------------------------------------------------------------------------
// What survives the clip.
// ---------------------------------------------------------------------------

describe('game/ui/maskedTextBounds: visibleBounds', () => {
  /** The mobile shop shelf viewport, and a row scrolled below its fold. */
  const shelf = reduceMaskCommands(fillRectBuffer(8, 152, 396, 200));

  it('an unmasked text is untouched', () => {
    const box = { x: 10, y: 10, width: 60, height: 14 };
    expect(visibleBounds(box, [])).toEqual({ drawn: true, clipped: false, rect: box, unresolved: false });
  });

  it('drops a row scrolled clean out of its viewport — the "2 G at y928" false positive', () => {
    const scrolledAway = { x: 360, y: 928, width: 24, height: 14 };
    expect(visibleBounds(scrolledAway, [shelf]).drawn).toBe(false);
  });

  it('keeps a row straddling the fold, cut to the part above it', () => {
    // Row top 340, 20px tall; the shelf ends at 352. 12px survive.
    const straddling = { x: 20, y: 340, width: 100, height: 20 };
    const seen = visibleBounds(straddling, [shelf]);
    expect(seen.drawn).toBe(true);
    expect(seen.clipped).toBe(true);
    expect(seen.rect.height).toBe(12);
    expect(seen.rect.y).toBe(340);
  });

  it('composes masks by intersection — a masked row inside a masked panel', () => {
    const panel = reduceMaskCommands(fillRectBuffer(0, 0, 412, 300));
    const seen = visibleBounds({ x: 20, y: 280, width: 100, height: 40 }, [panel, shelf]);
    // Panel ends at 300, shelf starts at 152 — 280..300 is the only agreement.
    expect(seen.rect).toEqual({ x: 20, y: 280, width: 100, height: 20 });
    expect(seen.clipped).toBe(true);
  });

  it('a mask it cannot model does NOT clip, and says so instead of guessing quietly', () => {
    const box = { x: 10, y: 900, width: 60, height: 14 };
    const seen = visibleBounds(box, [{ rects: [], unresolved: true }]);
    expect(seen.drawn).toBe(true);
    expect(seen.rect).toEqual(box);
    expect(seen.unresolved).toBe(true); // the script turns this into a hard failure
  });
});

// ---------------------------------------------------------------------------
// The collector both scripts share.
// ---------------------------------------------------------------------------

describe('scripts/sceneText: resolveDrawnTexts', () => {
  const shelf = fillRectBuffer(8, 152, 396, 200);

  it('reproduces BOTH shipped false positives and then removes them', () => {
    const readings = [
      // The pair the audit reported overlapping. Both sit inside the shelf's
      // scrolled content, below the fold — Phaser paints neither.
      raw('GEM POUCH', { x: 12, y: 640, width: 80, height: 14 }, [shelf]),
      raw('Frost Sliver', { x: 40, y: 642, width: 80, height: 14 }, [shelf]),
      // The one the audit reported off-canvas on a 892px-tall viewport.
      raw('2 G', { x: 360, y: 928, width: 24, height: 14 }, [shelf]),
    ];

    // What the OLD, mask-blind collector saw: a real-looking overlap and a
    // real-looking escape. Staging the false positive is what makes its
    // absence below mean something.
    expect(overlapArea(readings[0]!, readings[1]!)).toBeGreaterThan(36);
    expect(escapesCanvas(readings[2]!, 412, 892)).toBe(true);

    // What the browser actually paints: nothing.
    expect(resolveDrawnTexts(readings)).toEqual([]);
  });

  it('leaves an unmasked collision entirely alone', () => {
    const a = raw('×2 SLOTS', { x: 344, y: 275, width: 52, height: 12 });
    const b = raw('2 G', { x: 370, y: 274, width: 26, height: 14 });
    const drawn = resolveDrawnTexts([a, b]);
    expect(drawn).toHaveLength(2);
    expect(overlapArea(drawn[0]!, drawn[1]!)).toBeGreaterThan(36);
  });
});

// ---------------------------------------------------------------------------
// THE TEETH. If this block goes quiet the detector has stopped working, and
// every green audit it produces is worthless.
// ---------------------------------------------------------------------------

describe('the detector can still see the bug it was written for', () => {
  /**
   * `2ca972a` — "the mobile header rule struck through its own buttons",
   * verbatim from its commit message. These are HISTORICAL numbers and must
   * never be re-derived from the current layout: they are the calibration
   * input, so they have to stay fixed while the layout moves.
   *
   *     mobile actions band   74..96
   *     mobile content.y      100
   *     divider drawn at      content.y - 14 = 86   <- the bug
   *     DECK/BAG label centre 85
   *     divider after the fix                  98
   *
   * Measured live on 2026-08-31 by `run-hud-audit.ts`'s own calibration pass:
   * the mobile DECK/BAG label box is 81..90, centre 85 — the same centre the
   * commit names.
   */
  const LABEL_CENTRE_Y = 85;
  const label: Rect = { x: 12, y: 79, width: 78, height: 12 };
  const ruleAt = (y: number): Rect => ({ x: 12, y: y - 1, width: 78, height: 2 });

  it('reports the pre-2ca972a rule struck across the DECK/BAG label', () => {
    expect(label.y).toBeLessThan(LABEL_CENTRE_Y);
    expect(label.y + label.height).toBeGreaterThan(LABEL_CENTRE_Y);
    // 86 vs a label centred at 85: strikethrough, on every mobile run screen.
    expect(overlapArea(label, ruleAt(86))).toBeGreaterThan(36);
  });

  it('and reports the post-2ca972a rule as clear', () => {
    expect(overlapArea(label, ruleAt(98))).toBe(0);
  });

  it('a mask cannot silence a collision that is genuinely on screen', () => {
    // The header sits ABOVE every scroll viewport in the game, so no mask in
    // the chain touches it — the fix must not have bought its quiet by
    // over-clipping. Modelled with the shelf mask present but not covering it.
    const shelf = reduceMaskCommands(fillRectBuffer(8, 152, 396, 200));
    const seen = visibleBounds(label, []);
    expect(seen.drawn).toBe(true);
    expect(overlapArea(seen.rect, ruleAt(86))).toBeGreaterThan(36);
    // Sanity: that same shelf mask WOULD hide the label if it applied to it,
    // which is what makes the "no mask in the chain" part load-bearing.
    expect(visibleBounds(label, [shelf]).drawn).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The other half of finding 2: a correct warning with nowhere to go.
// ---------------------------------------------------------------------------

describe('game/ui/controlLayoutAudit: the failure sink', () => {
  // The console.warn side-effect is the behaviour under test's OTHER half and
  // stays exactly as it was; it is silenced here only so 25 identical lines do
  // not bury the rest of the suite's output.
  /** Same duck-typed stub idiom as `controlLayoutAudit.test.ts`: width is
   * font-size-independent, so shrinking can never rescue the overflow and only
   * truncation can — the exact shape of the reported "REWARD · …" -> "R…" bug. */
  function textStub(initial: string, widthPerChar: number, height = 12) {
    let value = initial;
    const style = { fontSize: 12 };
    return {
      style, height,
      setFontSize(size: number) { style.fontSize = size; },
      setText(next: string) { value = next; },
      setData() { /* production reads this via GameObject.getData */ },
      get text() { return value; },
      get width() { return value.length * widthPerChar; },
    };
  }

  let warn: ReturnType<typeof vi.spyOn>;
  beforeAll(() => { warn = vi.spyOn(console, 'warn').mockImplementation(() => {}); });
  afterAll(() => { warn.mockRestore(); });
  beforeEach(() => resetLayoutAuditFailures());

  it('still writes the console line it always did', () => {
    auditTextBlock(textStub('REWARD · Choose a card from the shop for free', 6), { name: 'Run event reward line', maxWidth: 30, maxHeight: 400 });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('[layout-audit] Run event reward line'));
  });

  it('records a failing audit so something other than a console can see it', () => {
    // The console branch is gated behind `typeof window !== 'undefined'` and
    // vitest runs `environment: 'node'` — before the sink existed, a failure
    // here was observable ONLY as a return value the call sites discard. That
    // is how a truncated run-event reward line warned correctly, every session,
    // for weeks, and was never heard.
    const text = textStub('REWARD · Choose a card from the shop for free', 6);
    const result = auditTextBlock(text, { name: 'Run event reward line', maxWidth: 30, maxHeight: 400 });
    expect(result.passed).toBe(false);

    const failures = layoutAuditFailures();
    expect(failures).toHaveLength(1);
    expect(failures[0]!.name).toBe('Run event reward line');
    expect(failures[0]!.message).toContain('[layout-audit]');
  });

  it('deduplicates by message and counts — a rebuilt scene must not flood the log', () => {
    for (let i = 0; i < 25; i++) {
      auditTextBlock(textStub('REWARD · Choose a card from the shop for free', 6), { name: 'Run event reward line', maxWidth: 30, maxHeight: 400 });
    }
    const failures = layoutAuditFailures();
    expect(failures).toHaveLength(1);
    expect(failures[0]!.count).toBe(25);
  });

  it('records nothing when the layout is fine', () => {
    const text = textStub('OK', 6);
    expect(auditTextBlock(text, { name: 'fits fine', maxWidth: 400, maxHeight: 400 }).passed).toBe(true);
    expect(layoutAuditFailures()).toEqual([]);
  });

  it('publishes the sink on globalThis, which is how the browser audit drains it', () => {
    auditTextBlock(textStub('REWARD · Choose a card from the shop for free', 6), { name: 'Run event reward line', maxWidth: 30, maxHeight: 400 });
    const sink = (globalThis as unknown as { __layoutAudit?: { failures(): unknown[]; reset(): void } }).__layoutAudit;
    expect(sink).toBeDefined();
    expect(sink!.failures()).toHaveLength(1);
    sink!.reset();
    expect(sink!.failures()).toEqual([]);
  });
});
