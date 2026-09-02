// SHARE-CODE PROMPT — clipboard copy, the DOM paste prompt, and the import
// dialog's view-model (docs/sandbox-features-proposal.md §3.7).
//
// WHY A REAL DOM OVERLAY: no clipboard/DOM-input affordance existed anywhere
// in src/game before this module (spec §0), and a real `<textarea>` is the
// only paste surface that works everywhere — `navigator.clipboard.readText()`
// is permission-gated and absent in Firefox, and mobile keyboards /
// long-press-paste need a genuine input element. DOM access from `src/game`
// is established (window/localStorage in metaStore.ts); the Phaser DOM plugin
// stays OFF (src/main.ts) — these overlays never enter the Phaser display
// list, they sit above the canvas in plain fixed-position elements and remove
// themselves on resolve.
//
// COPY runs inside the button's own pointer handler (a user gesture, so no
// permission prompt in Chromium/Safari); on rejection the caller falls back to
// `showCodeFallback`, which shows the code pre-selected with a "copy it
// manually" hint.
//
// The VIEW-MODEL half (describeLoadout / decodeReportLines / the two apply
// explainers / decodeFailureMessage) is pure and node-testable — the Phaser
// dialogs on both prep scenes render exactly these strings, so the spec's
// wording (§3.3, §3.5) is pinned here once instead of twice.

import type { DecodeReport, ShareCodeFailure, ShareLoadout } from '../../run/shareCode';
import { FONT, UI } from '../theme';

// ---------------------------------------------------------------------------
// View-model — pure strings the import dialog shows
// ---------------------------------------------------------------------------

/** The one-line loadout summary: `LV 12 · 5 CARDS (2 GEMMED) · BAG 8 · GEMS 10`. */
export function describeLoadout(loadout: ShareLoadout): string {
  const gemmed = loadout.board.filter((b) => b.gemId !== null).length;
  const cards = `${loadout.board.length} CARD${loadout.board.length === 1 ? '' : 'S'}`;
  const gemNote = gemmed > 0 ? ` (${gemmed} GEMMED)` : '';
  return `LV ${loadout.heroLevel} · ${cards}${gemNote} · BAG ${loadout.bag.length} · GEMS ${loadout.gems.length}`;
}

/**
 * The decode report as dialog lines: the content-drift skip line (spec §3.5
 * wording — `"2 cards + 1 gem no longer exist — skipped"`) followed by the
 * codec's own clamp lines VERBATIM.
 */
export function decodeReportLines(report: DecodeReport): string[] {
  const lines: string[] = [];
  if (report.unknownCards > 0 || report.unknownGems > 0) {
    const parts: string[] = [];
    if (report.unknownCards > 0) parts.push(`${report.unknownCards} card${report.unknownCards === 1 ? '' : 's'}`);
    if (report.unknownGems > 0) parts.push(`${report.unknownGems} gem${report.unknownGems === 1 ? '' : 's'}`);
    lines.push(`${parts.join(' + ')} no longer exist — skipped`);
  }
  lines.push(...report.clamped);
  return lines;
}

/** Hard-reject copy (spec §3.5): the ONLY two player-facing failure lines. */
export function decodeFailureMessage(failure: ShareCodeFailure): string {
  return failure === 'newerVersion' ? 'Code from a newer game version' : 'Not a valid code';
}

/** PLAY IT's what-happens line (spec §3.3 — states every replaced surface). */
export const PLAY_IT_EXPLAINER = 'replaces your board, bag, gems, LV & stat spend';

/** FIGHT IT's what-maps/what-drops line (spec §3.3 — no silent drops). */
export function fightItExplainer(loadout: ShareLoadout): string {
  return `imports board (${loadout.board.length} cards, gems kept) + LV → foe LV · drops: bag, loose gems, stat spend (foe auto-spends its LV)`;
}

/** FIGHT IT disables for an empty-board code — a card-less foe just stalls
 * into attrition (and `applyAsFoe` throws on it by contract). */
export function fightItEnabled(loadout: ShareLoadout): boolean {
  return loadout.board.length > 0;
}

/** The copy button's transient acknowledgement label. */
export function copiedToast(code: string): string {
  return `COPIED · ${code.length} CHARS`;
}

/**
 * The import dialog's state, shared by both prep scenes (a scene class field,
 * so it survives `rebuildScene`): a decoded loadout awaiting PLAY IT/FIGHT IT,
 * a hard-reject message, or the post-apply result view carrying the mapper's
 * returned report lines (shown until CLOSE, never a timer — a rebuild would
 * eat a timer, and the lines are the no-silent-drops contract).
 */
export type ImportDialogState =
  | { kind: 'decoded'; loadout: ShareLoadout; report: DecodeReport }
  | { kind: 'error'; message: string }
  | { kind: 'applied'; title: string; lines: string[] };

// ---------------------------------------------------------------------------
// Clipboard
// ---------------------------------------------------------------------------

/**
 * Copy `text` via the async clipboard API. Resolves false (never throws) when
 * the API is missing or the write is rejected — the caller shows
 * `showCodeFallback` then.
 */
export async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    if (typeof navigator === 'undefined' || !navigator.clipboard) return false;
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// DOM overlays
// ---------------------------------------------------------------------------

/** Packed 0xRRGGBB → CSS hex (theme tokens only — never a pasted literal). */
function css(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}

interface PromptDom {
  overlay: HTMLDivElement;
  textarea: HTMLTextAreaElement;
  hint: HTMLDivElement;
  cancelBtn: HTMLButtonElement;
  applyBtn: HTMLButtonElement;
  cleanup: () => void;
}

function buildPromptDom(title: string, applyLabel: string): PromptDom {
  const overlay = document.createElement('div');
  overlay.style.cssText = [
    'position:fixed', 'inset:0', 'z-index:10000',
    'display:flex', 'align-items:center', 'justify-content:center',
    `background:${css(UI.shadow)}c0`,
  ].join(';');

  const panel = document.createElement('div');
  panel.style.cssText = [
    `background:${css(UI.panelAlt)}`, `border:2px solid ${css(UI.border)}`,
    'border-radius:4px', 'padding:16px', 'width:min(560px, 92vw)',
    `font-family:${FONT.body}`, 'box-sizing:border-box',
  ].join(';');

  const heading = document.createElement('div');
  heading.textContent = title;
  heading.style.cssText = `color:${UI.textAccent};font-weight:bold;font-size:13px;letter-spacing:1px;margin-bottom:10px`;

  const textarea = document.createElement('textarea');
  textarea.rows = 4;
  textarea.spellcheck = false;
  textarea.setAttribute('autocapitalize', 'off');
  textarea.setAttribute('autocomplete', 'off');
  textarea.style.cssText = [
    'width:100%', 'box-sizing:border-box', 'resize:none',
    `background:${css(UI.panelMuted)}`, `color:${UI.text}`,
    `border:1px solid ${css(UI.border)}`, 'border-radius:3px',
    'padding:8px', 'font-size:13px', `font-family:${FONT.body}`,
    'word-break:break-all',
  ].join(';');

  const hint = document.createElement('div');
  hint.style.cssText = `color:${UI.textMuted};font-size:11px;margin-top:8px`;

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

  panel.append(heading, textarea, hint, row);
  overlay.append(panel);
  document.body.append(overlay);

  const cleanup = (): void => { overlay.remove(); };
  return { overlay, textarea, hint, cancelBtn, applyBtn, cleanup };
}

/**
 * The paste prompt: a real `<textarea>` over the canvas. Resolves the trimmed
 * text on APPLY/Enter, `null` on CANCEL/Escape/scrim — the element is removed
 * either way. Resolves `null` immediately outside a browser (defensive; only
 * scenes call this).
 */
export function promptForCode(): Promise<string | null> {
  if (typeof document === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    const dom = buildPromptDom('PASTE A SHARE CODE', 'APPLY');
    dom.textarea.placeholder = 'W1-…';
    dom.hint.textContent = 'Paste a W1- code, then APPLY (Enter). Escape cancels.';
    const done = (value: string | null): void => {
      document.removeEventListener('keydown', onKey, true);
      dom.cleanup();
      resolve(value);
    };
    const apply = (): void => { done(dom.textarea.value.trim()); };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') { e.preventDefault(); done(null); }
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); apply(); }
    };
    document.addEventListener('keydown', onKey, true);
    dom.cancelBtn.addEventListener('click', () => done(null));
    dom.applyBtn.addEventListener('click', apply);
    dom.overlay.addEventListener('pointerdown', (e) => { if (e.target === dom.overlay) done(null); });
    dom.textarea.focus();
  });
}

/**
 * The copy FALLBACK (clipboard write rejected/unavailable): the same overlay
 * with the code pre-filled and pre-selected plus a "copy it manually" hint.
 * CLOSE/Escape/scrim dismisses.
 */
export function showCodeFallback(code: string): void {
  if (typeof document === 'undefined') return;
  const dom = buildPromptDom('YOUR SHARE CODE', 'CLOSE');
  dom.textarea.value = code;
  dom.textarea.readOnly = true;
  dom.hint.textContent = 'Clipboard is blocked here — copy it manually (the code is selected).';
  dom.cancelBtn.remove();
  const done = (): void => {
    document.removeEventListener('keydown', onKey, true);
    dom.cleanup();
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') { e.preventDefault(); done(); }
  };
  document.addEventListener('keydown', onKey, true);
  dom.applyBtn.addEventListener('click', done);
  dom.overlay.addEventListener('pointerdown', (e) => { if (e.target === dom.overlay) done(); });
  dom.textarea.focus();
  dom.textarea.select();
}
