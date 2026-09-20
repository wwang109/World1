import { FONT, UI } from '../theme';

/**
 * GENERIC TEXT PROMPT — a plain DOM overlay above the canvas, same convention
 * as `codePrompt.ts`'s share-code paste dialog (that module's own header
 * comment: "the Phaser DOM plugin stays OFF — these overlays never enter the
 * Phaser display list"). This is the project's ONLY other typed-text
 * surface, so the Card Designer's name field and JSON layer editor reuse this
 * rather than inventing a second convention or turning the DOM plugin on.
 *
 * Two shapes: `promptForLine` (single-line `<input>`, for the card name) and
 * `promptForBlock` (multi-line `<textarea>`, for the per-tier JSON layer).
 * Both resolve the trimmed value on APPLY/Enter (block: Ctrl/Cmd+Enter, so a
 * plain Enter can still insert a newline inside JSON), `null` on
 * CANCEL/Escape/scrim.
 */

function css(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}

interface PromptDom {
  overlay: HTMLDivElement;
  field: HTMLInputElement | HTMLTextAreaElement;
  hint: HTMLDivElement;
  error: HTMLDivElement;
  cancelBtn: HTMLButtonElement;
  applyBtn: HTMLButtonElement;
  cleanup: () => void;
}

function buildPromptDom(title: string, applyLabel: string, multiline: boolean, rows: number): PromptDom {
  const overlay = document.createElement('div');
  overlay.style.cssText = [
    'position:fixed', 'inset:0', 'z-index:10000',
    'display:flex', 'align-items:center', 'justify-content:center',
    `background:${css(UI.shadow)}c0`,
  ].join(';');

  const panel = document.createElement('div');
  panel.style.cssText = [
    `background:${css(UI.panelAlt)}`, `border:2px solid ${css(UI.border)}`,
    'border-radius:4px', 'padding:16px', `width:min(${multiline ? 640 : 420}px, 92vw)`,
    `font-family:${FONT.body}`, 'box-sizing:border-box',
  ].join(';');

  const heading = document.createElement('div');
  heading.textContent = title;
  heading.style.cssText = `color:${UI.textAccent};font-weight:bold;font-size:13px;letter-spacing:1px;margin-bottom:10px`;

  const field = document.createElement(multiline ? 'textarea' : 'input') as HTMLInputElement | HTMLTextAreaElement;
  if (field instanceof HTMLTextAreaElement) field.rows = rows;
  else field.type = 'text';
  field.spellcheck = false;
  field.setAttribute('autocapitalize', 'off');
  field.setAttribute('autocomplete', 'off');
  field.style.cssText = [
    'width:100%', 'box-sizing:border-box', 'resize:none',
    `background:${css(UI.panelMuted)}`, `color:${UI.text}`,
    `border:1px solid ${css(UI.border)}`, 'border-radius:3px',
    'padding:8px', `font-size:${multiline ? 12 : 13}px`,
    `font-family:${multiline ? 'Consolas, Menlo, monospace' : FONT.body}`,
    'word-break:break-all',
  ].join(';');

  const hint = document.createElement('div');
  hint.style.cssText = `color:${UI.textMuted};font-size:11px;margin-top:8px`;

  const error = document.createElement('div');
  error.style.cssText = `color:#e8907a;font-size:11px;margin-top:6px;white-space:pre-wrap`;

  const row = document.createElement('div');
  row.style.cssText = 'display:flex;justify-content:flex-end;gap:8px;margin-top:12px';
  const buttonCss = 'font-weight:bold;font-size:12px;letter-spacing:1px;border-radius:3px;padding:10px 18px;cursor:pointer';
  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.textContent = 'CANCEL';
  cancelBtn.style.cssText = `${buttonCss};background:${css(UI.panelMuted)};color:${UI.text};border:1px solid ${css(UI.border)}`;
  const applyBtn = document.createElement('button');
  applyBtn.type = 'button';
  applyBtn.textContent = applyLabel;
  applyBtn.style.cssText = `${buttonCss};background:${css(UI.chip)};color:${UI.textOnChip};border:1px solid ${css(UI.border)}`;
  row.append(cancelBtn, applyBtn);

  panel.append(heading, field, hint, error, row);
  overlay.append(panel);
  document.body.append(overlay);

  const cleanup = (): void => { overlay.remove(); };
  return { overlay, field, hint, error, cancelBtn, applyBtn, cleanup };
}

interface PromptOpts {
  title: string;
  initial: string;
  hint?: string;
  applyLabel?: string;
  /** Validated on every APPLY attempt; a non-null return is shown inline and
   * the prompt stays open instead of resolving. */
  validate?: (value: string) => string | null;
}

/** Single-line prompt (a plain `<input>`) — the card name field. */
export function promptForLine(opts: PromptOpts): Promise<string | null> {
  return promptFor(opts, false, 1);
}

/** Multi-line prompt (a `<textarea>`) — the per-tier JSON layer editor. */
export function promptForBlock(opts: PromptOpts & { rows?: number }): Promise<string | null> {
  return promptFor(opts, true, opts.rows ?? 20);
}

function promptFor(opts: PromptOpts, multiline: boolean, rows: number): Promise<string | null> {
  if (typeof document === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    const dom = buildPromptDom(opts.title, opts.applyLabel ?? 'APPLY', multiline, rows);
    dom.field.value = opts.initial;
    if (opts.hint) dom.hint.textContent = opts.hint;
    const done = (value: string | null): void => {
      document.removeEventListener('keydown', onKey, true);
      dom.cleanup();
      resolve(value);
    };
    const apply = (): void => {
      const value = dom.field.value;
      const problem = opts.validate?.(value) ?? null;
      if (problem) { dom.error.textContent = problem; return; }
      done(value);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') { e.preventDefault(); done(null); return; }
      if (!multiline && e.key === 'Enter') { e.preventDefault(); apply(); return; }
      if (multiline && e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); apply(); }
    };
    document.addEventListener('keydown', onKey, true);
    dom.cancelBtn.addEventListener('click', () => done(null));
    dom.applyBtn.addEventListener('click', apply);
    dom.overlay.addEventListener('pointerdown', (e) => { if (e.target === dom.overlay) done(null); });
    dom.field.focus();
    if (dom.field instanceof HTMLInputElement) dom.field.select();
  });
}
