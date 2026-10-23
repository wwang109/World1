import { FONT, UI } from '../theme';

export function confirmCardDesignerAction(opts: {
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel?: string;
  signal: AbortSignal;
}): Promise<boolean> {
  return new Promise((resolve) => {
    const previous = document.activeElement as HTMLElement | null;
    const css = (color: number): string => `#${color.toString(16).padStart(6, '0')}`;
    const overlay = document.createElement('div');
    overlay.style.cssText = `position:fixed;inset:0;z-index:10000;background:${css(UI.shadow)}c0;display:flex;align-items:center;justify-content:center`;
    const panel = document.createElement('section');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-labelledby', 'card-designer-confirm-title');
    panel.style.cssText = `width:min(460px,92vw);padding:24px;box-sizing:border-box;background:${css(UI.panelAlt)};border:2px solid ${css(UI.border)};font-family:${FONT.body};color:${UI.text}`;
    const title = document.createElement('h2');
    title.id = 'card-designer-confirm-title';
    title.textContent = opts.title;
    title.style.cssText = `font-size:17px;margin:0 0 12px;color:${UI.textAccent}`;
    const body = document.createElement('p');
    body.textContent = opts.body;
    body.style.cssText = 'font-size:14px;line-height:1.5;margin:0 0 20px;white-space:pre-wrap';
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:12px;justify-content:flex-end';
    const button = (label: string, primary: boolean): HTMLButtonElement => {
      const result = document.createElement('button');
      result.type = 'button'; result.textContent = label;
      result.style.cssText = `min-height:40px;padding:8px 16px;border:1px solid ${css(UI.border)};background:${css(primary ? UI.chip : UI.panelMuted)};color:${primary ? UI.textOnChip : UI.text};font: bold 12px ${FONT.body};cursor:pointer`;
      return result;
    };
    const cancel = button(opts.cancelLabel ?? 'CANCEL', false);
    const confirm = button(opts.confirmLabel, true);
    let finished = false;
    const done = (value: boolean): void => {
      if (finished) return; finished = true;
      document.removeEventListener('keydown', onKey, true);
      opts.signal.removeEventListener('abort', aborted);
      overlay.remove(); previous?.focus(); resolve(value);
    };
    const aborted = (): void => done(false);
    const onKey = (event: KeyboardEvent): void => {
      event.stopPropagation();
      if (event.key === 'Escape') { event.preventDefault(); done(false); }
      if (event.key === 'Tab') { event.preventDefault(); (document.activeElement === cancel ? confirm : cancel).focus(); }
    };
    cancel.onclick = () => done(false); confirm.onclick = () => done(true);
    overlay.onpointerdown = (event) => { if (event.target === overlay) done(false); };
    row.append(cancel, confirm); panel.append(title, body, row); overlay.append(panel); document.body.append(overlay);
    document.addEventListener('keydown', onKey, true);
    opts.signal.addEventListener('abort', aborted, { once: true });
    cancel.focus();
    if (opts.signal.aborted) done(false);
  });
}
