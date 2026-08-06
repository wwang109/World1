import { TEXT_SHRINK_FLOOR_PX } from '../theme';

/** Least fraction of a string that must SURVIVE truncation for the result to
 * still count as laid out rather than gutted — see the gutting check in
 * `auditTextBlock`. Trimming a tail is fine; keeping one letter is a bug. */
const GUT_RATIO = 1 / 3;

interface RectangleControl {
  displayWidth: number;
  displayHeight: number;
  setData(key: string, value: unknown): unknown;
  setStrokeStyle(lineWidth: number, color: number, alpha?: number): unknown;
}

interface TextControl {
  width: number;
  height: number;
  text: string;
  style: { fontSize: string | number };
  setFontSize(size: number): unknown;
  setText(value: string): unknown;
  setData(key: string, value: unknown): unknown;
}

interface ControlAuditOptions {
  name: string;
  horizontalPadding?: number;
  verticalPadding?: number;
  minFontSize?: number;
}

interface TextBoxAuditOptions {
  name: string;
  maxWidth: number;
  maxHeight: number;
  minFontSize?: number;
}

export interface ControlAuditResult {
  name: string;
  passed: boolean;
  horizontalClearance: number;
  verticalClearance: number;
  fontSize: number;
  resized: boolean;
  /** True if the label's text was shortened with a trailing '…' (only
   * happens once shrinking hits `TEXT_SHRINK_FLOOR_PX` and it still overflows). */
  truncated: boolean;
}

export interface TextBoxAuditResult {
  name: string;
  passed: boolean;
  width: number;
  height: number;
  fontSize: number;
  resized: boolean;
  /** True if the text was shortened with a trailing '…' (only happens once
   * shrinking hits `TEXT_SHRINK_FLOOR_PX` and it still overflows). */
  truncated: boolean;
}

/**
 * Ellipsis-before-shrink (policy, 2026-08, user-approved): once a caller's
 * shrink loop bottoms out (at `TEXT_SHRINK_FLOOR_PX`, see theme.ts) and the
 * text STILL overflows, drop trailing characters one at a time and append
 * '…' rather than continuing to shrink the font below the floor. No-op
 * (never touches `text`) when `overflow()` is already false.
 */
function truncateOverflowText(text: TextControl, overflow: () => boolean): boolean {
  if (!overflow()) return false;
  let candidate = text.text;
  let truncated = false;
  while (candidate.length > 1) {
    candidate = candidate.slice(0, -1).trimEnd();
    text.setText(`${candidate}…`);
    truncated = true;
    if (!overflow()) break;
  }
  return truncated;
}

/**
 * Keeps a centered control label away from its border and exposes the result on
 * the rectangle for browser-driven layout checks.
 */
export function auditControlLabel(
  rect: RectangleControl,
  text: TextControl,
  options: ControlAuditOptions,
): ControlAuditResult {
  const horizontalPadding = options.horizontalPadding ?? 8;
  const verticalPadding = options.verticalPadding ?? 5;
  // Floor wins over whatever a caller asks for — see TEXT_SHRINK_FLOOR_PX.
  const minFontSize = Math.max(options.minFontSize ?? 8, TEXT_SHRINK_FLOOR_PX);
  let fontSize = Number.parseFloat(String(text.style.fontSize));
  let resized = false;

  const overflow = (): boolean => (
    text.width > rect.displayWidth - horizontalPadding * 2
    || text.height > rect.displayHeight - verticalPadding * 2
  );

  while (fontSize > minFontSize && overflow()) {
    fontSize -= 1;
    text.setFontSize(fontSize);
    resized = true;
  }

  const truncated = truncateOverflowText(text, overflow);

  const horizontalClearance = (rect.displayWidth - text.width) / 2;
  const verticalClearance = (rect.displayHeight - text.height) / 2;
  const passed = horizontalClearance >= horizontalPadding && verticalClearance >= verticalPadding;
  const result: ControlAuditResult = {
    name: options.name,
    passed,
    horizontalClearance,
    verticalClearance,
    fontSize,
    resized,
    truncated,
  };
  rect.setData('controlLayoutAudit', result);

  const auditMode = typeof window !== 'undefined'
    && new URLSearchParams(window.location.search).get('layoutAudit') === '1';
  if (!passed) {
    const message = `[layout-audit] ${options.name}: label clearance ${horizontalClearance.toFixed(1)}px x ${verticalClearance.toFixed(1)}px${truncated ? ' (still overflowing after truncation)' : ''}`;
    if (auditMode) {
      rect.setStrokeStyle(2, 0xc94c3b, 1);
      console.error(message);
    } else {
      console.warn(message);
    }
  }

  return result;
}

/**
 * Keeps a block of text inside a fixed box. Used for long UI copy in layout
 * audit mode so overflow is visible instead of silently clipped.
 */
export function auditTextBlock(
  text: TextControl,
  options: TextBoxAuditOptions,
): TextBoxAuditResult {
  // Floor wins over whatever a caller asks for — see TEXT_SHRINK_FLOOR_PX.
  const minFontSize = Math.max(options.minFontSize ?? 8, TEXT_SHRINK_FLOOR_PX);
  let fontSize = Number.parseFloat(String(text.style.fontSize));
  let resized = false;

  const overflow = (): boolean => (
    text.width > options.maxWidth || text.height > options.maxHeight
  );

  while (fontSize > minFontSize && overflow()) {
    fontSize -= 1;
    text.setFontSize(fontSize);
    resized = true;
  }

  const before = String(text.text);
  const truncated = truncateOverflowText(text, overflow);

  // GUTTING CHECK (2026-08-05). Fitting is not the same as being readable, and
  // for a long time this function conflated them: it shrank, then truncated,
  // then declared PASS because the result fit. A box far too small for its text
  // therefore reported success while showing a single letter — the run event
  // choices rendered "REWARD · A card" as "R…" and nothing complained, because
  // by this function's old definition "R…" fits and is therefore fine.
  //
  // Truncation is legitimate for trimming a tail ("Sanctified Bulwa…"). It is a
  // LAYOUT BUG when almost nothing survives: that means the box is mis-sized,
  // not that the text is slightly long. Keeping under a third of the content is
  // treated as a failure so it surfaces like any other overflow.
  const kept = String(text.text).replace(/…$/, '');
  const gutted = truncated && before.length > 0 && kept.length / before.length < GUT_RATIO;

  const passed = text.width <= options.maxWidth && text.height <= options.maxHeight && !gutted;
  const result: TextBoxAuditResult = {
    name: options.name,
    passed,
    width: text.width,
    height: text.height,
    fontSize,
    resized,
    truncated,
  };
  text.setData('textLayoutAudit', result);

  const auditMode = typeof window !== 'undefined'
    && new URLSearchParams(window.location.search).get('layoutAudit') === '1';
  if (!passed) {
    const message = `[layout-audit] ${options.name}: text ${text.width.toFixed(1)}px x ${text.height.toFixed(1)}px exceeds ${options.maxWidth}x${options.maxHeight}${truncated ? ' (still overflowing after truncation)' : ''}`;
    if (auditMode) {
      console.error(message);
    } else {
      console.warn(message);
    }
  }

  return result;
}

/**
 * NAME-OVERFLOW GUARD CONTRACT: truncates ONLY the `name` portion of a
 * "<name><suffix>" composite label (e.g. "Bandit Duelist   ·   ELITE   ·   LV
 * 7") with a trailing ellipsis when the combined string would overflow
 * `maxWidth` at the text object's CURRENT font size — `suffix` (title/LV, or
 * '' when there's none) is never shortened, so it always stays fully
 * visible. Sets `text`'s content directly (via `setText`) to the final
 * (possibly truncated) string and returns the name portion actually used.
 * No-op (byte-identical, single `setText` call with the untruncated string)
 * when `name + suffix` already fits — true for every enemy name/title in the
 * game today.
 */
export function truncateNameKeepingSuffix(
  text: TextControl,
  name: string,
  suffix: string,
  maxWidth: number,
): string {
  text.setText(`${name}${suffix}`);
  if (text.width <= maxWidth) return name;
  let candidate = name;
  while (candidate.length > 1) {
    candidate = candidate.slice(0, -1).trimEnd();
    text.setText(`${candidate}…${suffix}`);
    if (text.width <= maxWidth) return candidate;
  }
  text.setText(`${name.slice(0, 1)}…${suffix}`);
  return name.slice(0, 1);
}
