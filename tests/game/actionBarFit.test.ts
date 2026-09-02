import { describe, expect, it } from 'vitest';
import type Phaser from 'phaser';
import { renderActionBar, type ActionButton } from '../../src/game/ui/ActionBar';
import type { ControlAuditResult } from '../../src/game/ui/controlLayoutAudit';
import { MOBILE_PROFILE } from '../../src/game/layoutProfile';

/**
 * MOBILE FOOTER ROW FIT (2026-08-17 bug report): at the mobile design width,
 * `MobileBattleScene`'s 5-button Sandbox row (PREP / REPLAY / speed / SUMMARY
 * / BACK TO PREP ›) rendered every label at a fixed 13px regardless of its
 * button's width — the longest label ("BACK TO PREP ›") overflowed its own
 * rect and visibly overlapped/clipped the button beside it.
 *
 * `renderActionBar` (ui/ActionBar.ts) is the ONE place this row's fit is
 * actually computed (per-button width from `flex`, then a shrink-then-
 * ellipsize pass via `auditControlLabel`) — that computation is Phaser-free
 * arithmetic plus the same audited-label helper already unit-tested against
 * a duck-typed stub in `controlLayoutAudit.test.ts`, so it's tested the same
 * way here: a fake "scene" that hands back plain objects satisfying exactly
 * the shape `renderActionBar`/`auditControlLabel` touch, with text WIDTH
 * modeled as `length * pxPerCharAt13 * (fontSize / 13)` — a deliberately
 * approximate stand-in for real glyph metrics (those need an actual canvas,
 * which is what the Playwright screenshots at the bottom of this change are
 * for), but one that exercises the REAL width/flex math and the REAL
 * shrink/truncate loop, not a tautology.
 */

interface FakeRect {
  displayWidth: number;
  displayHeight: number;
  data: Map<string, unknown>;
  setOrigin(): FakeRect;
  setStrokeStyle(): FakeRect;
  setInteractive(): FakeRect;
  setFillStyle(): FakeRect;
  on(): FakeRect;
  setData(key: string, value: unknown): FakeRect;
  getData(key: string): unknown;
}

function makeRect(w: number, h: number): FakeRect {
  const data = new Map<string, unknown>();
  const rect: FakeRect = {
    displayWidth: w,
    displayHeight: h,
    data,
    setOrigin: () => rect,
    setStrokeStyle: () => rect,
    setInteractive: () => rect,
    setFillStyle: () => rect,
    on: () => rect,
    setData: (key, value) => { data.set(key, value); return rect; },
    getData: (key) => data.get(key),
  };
  return rect;
}

interface FakeText {
  style: { fontSize: string };
  readonly width: number;
  readonly height: number;
  readonly text: string;
  setOrigin(): FakeText;
  setFontSize(size: number): FakeText;
  setText(value: string): FakeText;
  setData(): FakeText;
}

/** Uppercase bold ~13px is roughly 8.5px/glyph advance — see module doc. */
const PX_PER_CHAR_AT_13 = 8.5;

function makeLabel(initial: string): FakeText {
  let text = initial;
  let fontSize = 13;
  const label: FakeText = {
    style: { fontSize: '13px' },
    get width() { return text.length * PX_PER_CHAR_AT_13 * (fontSize / 13); },
    get height() { return Math.round(fontSize * 1.2); },
    get text() { return text; },
    setOrigin: () => label,
    setFontSize: (size: number) => { fontSize = size; return label; },
    setText: (value: string) => { text = value; return label; },
    setData: () => label,
  };
  return label;
}

interface FakeScene {
  add: {
    rectangle: (...args: unknown[]) => FakeRect;
    text: (x: number, y: number, str: string, ..._rest: unknown[]) => FakeText;
  };
}

function makeFakeScene(): { scene: FakeScene; rects: FakeRect[]; labels: FakeText[] } {
  const rects: FakeRect[] = [];
  const labels: FakeText[] = [];
  const scene: FakeScene = {
    add: {
      rectangle: (...args: unknown[]) => {
        const w = args[2] as number;
        const h = args[3] as number;
        const r = makeRect(w, h);
        rects.push(r);
        return r;
      },
      text: (_x, _y, str) => {
        const t = makeLabel(str);
        labels.push(t);
        return t;
      },
    },
  };
  return { scene, rects, labels };
}

// Mirrors MobileBattleScene.footerButtons()'s Sandbox row at the outcome step
// (`atEnd`) — the exact shape from the 2026-08-17 report.
const SANDBOX_AT_END_BUTTONS: ActionButton[] = [
  { label: 'PREP', onPress: () => {} },
  { label: 'REPLAY', onPress: () => {} },
  { label: '×1', flex: 0.6, onPress: () => {} },
  { label: 'SUMMARY', onPress: () => {} },
  { label: 'BACK TO PREP ›', primary: true, flex: 1.6, onPress: () => {} },
];

describe('ui/ActionBar: mobile footer row fit', () => {
  it('every Sandbox-at-end button label fits inside its own button at the mobile design width — none reports overlap', () => {
    const { scene, rects } = makeFakeScene();
    renderActionBar(scene as unknown as Phaser.Scene, MOBILE_PROFILE.canvas.width, MOBILE_PROFILE.canvas.height, SANDBOX_AT_END_BUTTONS);
    expect(rects).toHaveLength(SANDBOX_AT_END_BUTTONS.length);
    const audits = rects.map((r) => r.getData('controlLayoutAudit') as ControlAuditResult);
    for (const [i, audit] of audits.entries()) {
      expect(audit, `button ${i} (${SANDBOX_AT_END_BUTTONS[i]!.label}) never ran the label-fit audit`).toBeDefined();
      expect(audit.passed, `button ${i} (${SANDBOX_AT_END_BUTTONS[i]!.label}) overflowed its own rect: ${JSON.stringify(audit)}`).toBe(true);
    }
  });

  it('button rects tile the row exactly (no gap, no overlap between adjacent rects) regardless of flex', () => {
    const { scene, rects } = makeFakeScene();
    const screenW = MOBILE_PROFILE.canvas.width;
    renderActionBar(scene as unknown as Phaser.Scene, screenW, MOBILE_PROFILE.canvas.height, SANDBOX_AT_END_BUTTONS);
    // Every button gets a positive width and the row sums (with its gaps)
    // back to the full inset row width — the arithmetic bug this defect
    // could also have taken the shape of (a `flex` that overflows the row).
    const totalWidth = screenW - 10 * 2; // FOOTER_SIDE_MARGIN both sides
    const gap = 8;
    const summed = rects.reduce((s, r) => s + r.displayWidth, 0) + gap * (rects.length - 1);
    expect(summed).toBeCloseTo(totalWidth, 0);
    for (const r of rects) expect(r.displayWidth).toBeGreaterThan(0);
    // The primary (longest-label) button was given more room than a
    // same-length-label neighbor precisely because it carries the row's
    // longest text — proving the fix isn't "shrink alone papers over a bad
    // width split".
    const primaryWidth = rects[rects.length - 1]!.displayWidth;
    const summaryWidth = rects[3]!.displayWidth;
    expect(primaryWidth).toBeGreaterThan(summaryWidth);
  });

  // WHY THESE THREE ROWS JOINED THE AUDIT (2026-09-02, sandbox share codes +
  // foe deck editor): the MobilePrep footer grew a third button (CODE), and
  // two NEW overlay rows render through the same renderActionBar — the foe
  // deck editor's AUTO/CANCEL/APPLY and the import dialog's CANCEL/FIGHT IT/
  // PLAY IT. Every row is pinned at the 412px design width with its WIDEST
  // live labels (SEED at its 6-digit max, APPLY in its disabled "(0)" form,
  // FIGHT IT in its inert "NO BOARD" form) — the exact shape the 2026-08-17
  // clipping bug took. No budget loosened: the assertion is the same
  // audit.passed the Sandbox row already answers to.
  const SANDBOX_NEW_ROWS: Array<[string, ActionButton[]]> = [
    ['MobilePrep footer (CODE · SEED · FIGHT)', [
      { label: 'CODE', flex: 0.8, onPress: () => {} },
      { label: 'SEED 999999', onPress: () => {} },
      { label: 'FIGHT', primary: true, flex: 2, onPress: () => {} },
    ]],
    ['foe deck editor (AUTO · CANCEL · APPLY)', [
      { label: 'AUTO', onPress: () => {} },
      { label: 'CANCEL', onPress: () => {} },
      { label: 'APPLY (0)', flex: 1.4, onPress: () => {} },
    ]],
    ['import dialog (CANCEL · FIGHT IT · PLAY IT)', [
      { label: 'CANCEL', onPress: () => {} },
      { label: 'FIGHT IT', onPress: () => {} },
      { label: 'PLAY IT', primary: true, flex: 1.3, onPress: () => {} },
    ]],
  ];

  it.each(SANDBOX_NEW_ROWS)('%s: every label fits its own button at the mobile design width', (_name, buttons) => {
    const { scene, rects } = makeFakeScene();
    renderActionBar(scene as unknown as Phaser.Scene, MOBILE_PROFILE.canvas.width, MOBILE_PROFILE.canvas.height, buttons);
    expect(rects).toHaveLength(buttons.length);
    for (const [i, rect] of rects.entries()) {
      const audit = rect.getData('controlLayoutAudit') as ControlAuditResult;
      expect(audit, `button ${i} (${buttons[i]!.label}) never ran the label-fit audit`).toBeDefined();
      expect(audit.passed, `button ${i} (${buttons[i]!.label}) overflowed its own rect: ${JSON.stringify(audit)}`).toBe(true);
      // Fitting by ellipsis would pass the overlap bar while hiding the verb —
      // these labels are short enough that they must fit UNTRUNCATED.
      expect(audit.truncated, `button ${i} (${buttons[i]!.label}) should not need truncation`).toBe(false);
    }
  });

  it('a label too wide even at the shrink floor still fits ONLY because it ellipsizes — proving the safety net, not just generous flex, is what prevents overlap', () => {
    const { scene, rects } = makeFakeScene();
    // Four flex-1 siblings squeeze the last button down to a sliver — its
    // label has nowhere to borrow width from, isolating the ellipsis
    // fallback (`auditControlLabel`'s `truncateOverflowText`) from the flex
    // tuning exercised above.
    const buttons: ActionButton[] = [
      { label: 'A', onPress: () => {} },
      { label: 'B', onPress: () => {} },
      { label: 'C', onPress: () => {} },
      { label: 'D', onPress: () => {} },
      { label: 'AN EXTREMELY LONG BUTTON LABEL THAT CANNOT POSSIBLY FIT', flex: 0.3, onPress: () => {} },
    ];
    renderActionBar(scene as unknown as Phaser.Scene, MOBILE_PROFILE.canvas.width, MOBILE_PROFILE.canvas.height, buttons);
    const audit = rects[rects.length - 1]!.getData('controlLayoutAudit') as ControlAuditResult;
    expect(audit.resized, 'the shrink pass must have run before truncation kicks in').toBe(true);
    expect(audit.truncated).toBe(true);
    expect(audit.passed, 'even the ellipsized result must still clear its own rect — that is the overlap guarantee').toBe(true);
  });
});
