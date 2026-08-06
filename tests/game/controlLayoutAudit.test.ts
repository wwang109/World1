import { describe, expect, it } from 'vitest';
import { auditTextBlock } from '../../src/game/ui/controlLayoutAudit';
import { TEXT_SHRINK_FLOOR_PX } from '../../src/game/theme';

/**
 * `auditTextBlock`'s gutting check (GUT_RATIO, added 2026-08-05) has never
 * been exercised from Node: its only visible output is `console.warn`/
 * `console.error` gated behind `typeof window !== 'undefined'`
 * (`layoutAudit` query-param check), and vitest runs `environment: 'node'`
 * (see vitest.config.ts) where `window` doesn't exist at all — so nothing in
 * CI could ever observe a regression here. This was the user's original
 * complaint: a "REWARD - ..." line ellipsized down to "R…" and nothing
 * caught it, because the function RETURNS a `TextBoxAuditResult` (`passed`/
 * `truncated`/`resized`) independent of the console side-effect — this file
 * drives that return value directly with a duck-typed stub, no DOM required.
 *
 * `TextControl` only touches: `style.fontSize`, `setFontSize`, `setText`,
 * `text`, `width`, `height` — the stub below models exactly those, with a
 * controllable width function so a test can force "shrinking helps" vs
 * "shrinking can't help, only truncation can" scenarios deterministically.
 */

interface TextStub {
  style: { fontSize: number };
  height: number;
  setFontSize(size: number): void;
  setText(value: string): void;
  setData(): void;
  readonly text: string;
  readonly width: number;
}

/**
 * `widthPerChar` may depend on the CURRENT font size (pass `fontSensitive:
 * true`) or be fixed (the default) — a fixed-width model proves shrinking
 * the font can never rescue an overflow (only truncation can), while a
 * font-sensitive model proves the shrink loop actually helps before
 * truncation is ever reached.
 */
function makeTextStub(initial: string, opts: { widthPerChar: number; fontSensitive?: boolean; height?: number; fontSize?: number }): TextStub {
  let text = initial;
  const style = { fontSize: opts.fontSize ?? 20 };
  return {
    style,
    height: opts.height ?? 20,
    setFontSize(size: number) { style.fontSize = size; },
    setText(value: string) { text = value; },
    setData() { /* no-op — production only reads this via GameObject.getData */ },
    get text() { return text; },
    // Fixed model: width = length * widthPerChar (font size irrelevant —
    // shrinking can never rescue this one, matching Phaser text whose glyph
    // advance stops mattering once you've already committed to a per-char
    // constant). Font-sensitive model: width = length * widthPerChar *
    // fontSize, so a bigger font is proportionally wider — shrinking the
    // font shrinks width too, exactly like a real Phaser Text object.
    get width() { return text.length * opts.widthPerChar * (opts.fontSensitive ? style.fontSize : 1); },
  };
}

describe('game/ui/controlLayoutAudit: auditTextBlock (node-side, no DOM)', () => {
  it('GUT_RATIO is the ONLY thing making passed false: a width-only gutting case that already fits vertically', () => {
    // Width is font-size-independent here, so the shrink loop cannot help —
    // only truncation can, and truncation has to cut almost everything to
    // reach `maxWidth`. This is the exact shape of the reported bug: a
    // "REWARD - Choose a card from the shop for free" line collapsing to "R…".
    //
    // Crucially, `maxHeight` is generous and the stub's `height` never
    // changes with truncation, so the HEIGHT clause of `passed` is satisfied
    // throughout — and we assert the WIDTH clause explicitly too, once
    // truncation is done. That isolates `gutted` as the only remaining thing
    // that can flip `passed` to false: proven below by asserting `width` and
    // `height` are independently within bounds BEFORE asserting `passed` is
    // false. (Sanity check: set GUT_RATIO = 0 in controlLayoutAudit.ts and
    // this test goes red — unlike the height-only scenario below, which
    // stays green under GUT_RATIO = 0 because it fails on the height clause
    // alone.)
    const before = 'REWARD - Choose a card from the shop for free this run';
    const widthPerChar = 6;
    const text = makeTextStub(before, { widthPerChar });
    // Only ~10% of the string can survive at this maxWidth.
    const maxWidth = Math.floor((before.length * widthPerChar) / 10);
    const maxHeight = 200;
    const result = auditTextBlock(text, { name: 'reward-choice', maxWidth, maxHeight });
    expect(result.truncated).toBe(true);
    // Both bare clauses hold on their own — width and height both fit — so
    // the only remaining lever for `passed` is the gutting check.
    expect(result.width).toBeLessThanOrEqual(maxWidth);
    expect(result.height).toBeLessThanOrEqual(maxHeight);
    expect(text.text.replace(/…$/, '').length / before.length).toBeLessThan(1 / 3);
    expect(result.passed).toBe(false);
  });

  it('passed is true for a mild tail trim — most of the string survives', () => {
    const before = 'Sanctified Bulwark of the Old Ward';
    const widthPerChar = 6;
    const text = makeTextStub(before, { widthPerChar });
    // Keep ~80% of the string — a normal "…" tail trim, not a gutting.
    const maxWidth = Math.floor(before.length * widthPerChar * 0.8);
    const result = auditTextBlock(text, { name: 'card-name', maxWidth, maxHeight: 200 });
    expect(result.truncated).toBe(true);
    expect(text.text.replace(/…$/, '').length / before.length).toBeGreaterThanOrEqual(1 / 3);
    expect(result.passed).toBe(true);
  });

  it('passed is true and untruncated when the text already fits', () => {
    const text = makeTextStub('Short', { widthPerChar: 6 });
    const result = auditTextBlock(text, { name: 'fits', maxWidth: 200, maxHeight: 200 });
    expect(result.truncated).toBe(false);
    expect(result.resized).toBe(false);
    expect(result.passed).toBe(true);
  });

  it('the font-shrink loop shrinks only as far as needed to fit, and never truncates if shrinking alone works', () => {
    const before = 'Fits After Shrinking';
    // width(fontSize) = length * fontSize (fontSensitive) — fits once the
    // font drops to 12px (still well above the floor of 9).
    const text = makeTextStub(before, { widthPerChar: 1, fontSensitive: true, fontSize: 20 });
    const maxWidth = before.length * 12;
    const result = auditTextBlock(text, { name: 'shrink-fits', maxWidth, maxHeight: 200 });
    expect(result.resized).toBe(true);
    expect(result.truncated).toBe(false);
    expect(result.passed).toBe(true);
    expect(result.fontSize).toBe(12);
    expect(result.fontSize).toBeGreaterThan(TEXT_SHRINK_FLOOR_PX);
  });

  it('the font-shrink loop stops exactly at TEXT_SHRINK_FLOOR_PX and hands off to truncation when shrinking alone is not enough', () => {
    const before = 'Still Too Wide Even At The Floor';
    // width(fontSize) = length * fontSize — even at the floor (9px) this
    // still overflows, so the loop must stop AT the floor, not below it.
    const text = makeTextStub(before, { widthPerChar: 1, fontSensitive: true, fontSize: 20 });
    const maxWidth = before.length * 5; // unreachable even at fontSize 9 (9 * length)
    const result = auditTextBlock(text, { name: 'shrink-floor', maxWidth, maxHeight: 200 });
    expect(result.resized).toBe(true);
    expect(result.fontSize).toBe(TEXT_SHRINK_FLOOR_PX);
    expect(result.truncated).toBe(true);
  });

  it('a caller-supplied minFontSize below TEXT_SHRINK_FLOOR_PX never wins — the floor always wins', () => {
    const before = 'Still Too Wide Even At The Floor';
    const text = makeTextStub(before, { widthPerChar: 1, fontSensitive: true, fontSize: 20 });
    const maxWidth = before.length * 5;
    const result = auditTextBlock(text, { name: 'floor-wins', maxWidth, maxHeight: 200, minFontSize: 3 });
    expect(result.fontSize).toBe(TEXT_SHRINK_FLOOR_PX);
  });

  it('reproduces the reported RunChoicePanel bug directly: a too-short PANEL HEIGHT ellipsizes a single-line row to nearly nothing, and it is flagged rather than silently passed', () => {
    // `RunChoicePanel.ts`'s own doc comment: "the event choices shipped at
    // h=84 needing ~99, so every 'REWARD · ...' hint rendered as a single
    // letter." A single-line Phaser Text's height is set by font
    // size/line-height, NOT character count — trimming characters can never
    // shrink it. `overflow()` bundles width AND height, so when height alone
    // is the defect, the shrink loop still bottoms out and
    // `truncateOverflowText` still fires — uselessly chewing through a
    // string that already fit on width, all the way down to one character,
    // because nothing it does can ever satisfy the height side of `overflow`.
    //
    // NOTE: this scenario's `passed: false` comes from the plain HEIGHT
    // clause of `passed` (`height <= options.maxHeight`) — the stub's
    // height is a fixed 40 against a maxHeight of 20, so this fails
    // regardless of `gutted`/GUT_RATIO. It is NOT a GUT_RATIO regression
    // test (see the case above for that); it is here to pin the OTHER half
    // of the original incident — truncation firing uselessly against a
    // height-only overflow, right down to one character, and the result
    // still correctly reporting failure instead of a false "R…" pass.
    const before = 'REWARD - Choose a card from the shop for free this run';
    const text = makeTextStub(before, { widthPerChar: 2, height: 40 }); // plenty of width headroom
    const result = auditTextBlock(text, { name: 'reward-detail', maxWidth: 400, maxHeight: 20 });
    expect(result.truncated).toBe(true);
    expect(text.text).toBe('R…');
    expect(result.passed).toBe(false);
  });
});
