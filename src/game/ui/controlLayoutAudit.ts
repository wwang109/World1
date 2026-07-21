interface RectangleControl {
  displayWidth: number;
  displayHeight: number;
  setData(key: string, value: unknown): unknown;
  setStrokeStyle(lineWidth: number, color: number, alpha?: number): unknown;
}

interface TextControl {
  width: number;
  height: number;
  style: { fontSize: string | number };
  setFontSize(size: number): unknown;
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
}

export interface TextBoxAuditResult {
  name: string;
  passed: boolean;
  width: number;
  height: number;
  fontSize: number;
  resized: boolean;
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
  const minFontSize = options.minFontSize ?? 8;
  let fontSize = Number.parseFloat(String(text.style.fontSize));
  let resized = false;

  while (
    fontSize > minFontSize
    && (text.width > rect.displayWidth - horizontalPadding * 2
      || text.height > rect.displayHeight - verticalPadding * 2)
  ) {
    fontSize -= 1;
    text.setFontSize(fontSize);
    resized = true;
  }

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
  };
  rect.setData('controlLayoutAudit', result);

  const auditMode = typeof window !== 'undefined'
    && new URLSearchParams(window.location.search).get('layoutAudit') === '1';
  if (!passed) {
    const message = `[layout-audit] ${options.name}: label clearance ${horizontalClearance.toFixed(1)}px x ${verticalClearance.toFixed(1)}px`;
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
  const minFontSize = options.minFontSize ?? 8;
  let fontSize = Number.parseFloat(String(text.style.fontSize));
  let resized = false;

  while (
    fontSize > minFontSize
    && (text.width > options.maxWidth || text.height > options.maxHeight)
  ) {
    fontSize -= 1;
    text.setFontSize(fontSize);
    resized = true;
  }

  const passed = text.width <= options.maxWidth && text.height <= options.maxHeight;
  const result: TextBoxAuditResult = {
    name: options.name,
    passed,
    width: text.width,
    height: text.height,
    fontSize,
    resized,
  };
  text.setData('textLayoutAudit', result);

  const auditMode = typeof window !== 'undefined'
    && new URLSearchParams(window.location.search).get('layoutAudit') === '1';
  if (!passed) {
    const message = `[layout-audit] ${options.name}: text ${text.width.toFixed(1)}px x ${text.height.toFixed(1)}px exceeds ${options.maxWidth}x${options.maxHeight}`;
    if (auditMode) {
      console.error(message);
    } else {
      console.warn(message);
    }
  }

  return result;
}
