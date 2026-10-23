import { FONT, UI } from '../theme';

interface GoogleId {
  initialize(options: { client_id: string; nonce: string; callback: (response: { credential?: string }) => void; auto_select: false; ux_mode: 'popup' }): void;
  renderButton(parent: HTMLElement, options: { type: 'standard'; theme: 'outline'; size: 'large'; text: 'continue_with'; width: number }): void;
  disableAutoSelect(): void;
}

function googleId(): GoogleId | undefined {
  return (window as unknown as { google?: { accounts?: { id?: GoogleId } } }).google?.accounts?.id;
}

let sdkPromise: Promise<GoogleId> | null = null;
let closeActive: (() => void) | null = null;

function loadGoogle(): Promise<GoogleId> {
  const loaded = googleId();
  if (loaded) return Promise.resolve(loaded);
  if (sdkPromise) return sdkPromise;
  sdkPromise = new Promise<GoogleId>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    const timer = window.setTimeout(() => failed(), 15_000);
    const failed = (): void => {
      window.clearTimeout(timer);
      script.remove();
      sdkPromise = null;
      reject(new Error("Couldn't load Google sign-in. Check your connection and try again."));
    };
    script.onerror = failed;
    script.onload = () => {
      window.clearTimeout(timer);
      const id = googleId();
      if (id) resolve(id);
      else failed();
    };
    document.head.append(script);
  });
  return sdkPromise;
}

export function closeGoogleSignIn(): void { closeActive?.(); }

export function disableGoogleAutoSelect(): void {
  try { googleId()?.disableAutoSelect(); } catch { /* SDK may be unavailable. */ }
}

export function promptForGoogleSignIn(options: {
  load: () => Promise<{ challenge: string; nonce: string; clientId: string }>;
  redeem: (challenge: string, credential: string) => Promise<string | null>;
  current: () => boolean;
}): Promise<void> {
  closeGoogleSignIn();
  return new Promise(resolve => {
    const previousFocus = document.activeElement as HTMLElement | null;
    const overlay = document.createElement('div');
    overlay.dataset.accountGoogleDialog = '';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:10000;display:flex;align-items:center;justify-content:center;background:#000b;padding:16px;box-sizing:border-box';
    const panel = document.createElement('div');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-labelledby', 'account-google-heading');
    panel.style.cssText = `width:min(420px,100%);max-height:calc(100dvh - 32px);overflow:auto;box-sizing:border-box;padding:20px;border:2px solid #${UI.border.toString(16).padStart(6, '0')};border-radius:4px;background:#${UI.panelAlt.toString(16).padStart(6, '0')};color:${UI.text};font-family:${FONT.body}`;
    const heading = document.createElement('h2');
    heading.id = 'account-google-heading';
    heading.textContent = 'CONTINUE WITH GOOGLE';
    heading.style.cssText = `font-size:15px;letter-spacing:1px;margin:0 0 12px;color:${UI.textAccent}`;
    const hint = document.createElement('p');
    hint.textContent = 'A new Google link keeps this account. An existing link switches to its account. Accounts are not merged.';
    hint.style.cssText = 'font-size:12px;line-height:1.5;margin:0 0 16px';
    const buttonHost = document.createElement('div');
    buttonHost.style.cssText = 'display:flex;justify-content:center;min-height:44px';
    const status = document.createElement('p');
    status.setAttribute('role', 'status');
    status.textContent = 'Loading Google sign-in…';
    status.style.cssText = 'font-size:12px;line-height:1.5;overflow-wrap:anywhere';
    const close = document.createElement('button');
    close.type = 'button';
    close.textContent = 'CLOSE';
    close.style.cssText = `display:block;margin:16px 0 0 auto;min-height:44px;padding:10px 20px;border:1px solid #${UI.border.toString(16).padStart(6, '0')};border-radius:3px;background:#${UI.chip.toString(16).padStart(6, '0')};color:${UI.textOnChip};font-weight:bold;letter-spacing:1px;cursor:pointer`;
    panel.append(heading, hint, buttonHost, status, close);
    overlay.append(panel);
    document.body.append(overlay);
    let alive = true;
    let redeeming = false;
    const done = (): void => {
      if (!alive || redeeming) return;
      alive = false;
      overlay.remove();
      document.removeEventListener('keydown', onKey, true);
      if (closeActive === done) closeActive = null;
      previousFocus?.focus();
      resolve();
    };
    const current = (): boolean => alive && options.current();
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); done(); }
      if (event.key === 'Tab') {
        const focusable = Array.from(panel.querySelectorAll<HTMLElement>('button,iframe,[tabindex="0"]')).filter(el => !el.hasAttribute('disabled'));
        const first = focusable[0] ?? close;
        const last = focusable.at(-1) ?? close;
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    };
    closeActive = done;
    close.addEventListener('click', done);
    overlay.addEventListener('pointerdown', event => { if (event.target === overlay) done(); });
    document.addEventListener('keydown', onKey, true);
    close.focus();
    void (async () => {
      try {
        const challenge = await options.load();
        if (!current()) return;
        const id = await loadGoogle();
        if (!current()) return;
        id.initialize({
          client_id: challenge.clientId, nonce: challenge.nonce, auto_select: false, ux_mode: 'popup',
          callback: response => {
            if (!current() || redeeming || !response.credential) return;
            redeeming = true;
            close.disabled = true;
            buttonHost.style.pointerEvents = 'none';
            buttonHost.setAttribute('aria-busy', 'true');
            status.textContent = 'Signing in…';
            void options.redeem(challenge.challenge, response.credential).then(error => {
              if (!current()) return;
              redeeming = false;
              close.disabled = false;
              if (error) {
                status.textContent = error + ' Close this window and try again.';
                buttonHost.replaceChildren();
              } else done();
            }).catch(() => {
              if (current()) {
                redeeming = false;
                close.disabled = false;
                status.textContent = "Couldn't finish Google sign-in. Close this window and try again.";
                buttonHost.replaceChildren();
              }
            });
          },
        });
        id.renderButton(buttonHost, { type: 'standard', theme: 'outline', size: 'large', text: 'continue_with', width: Math.min(340, panel.clientWidth - 40) });
        status.textContent = 'Choose the Google button to continue. If you cancel the popup, you can try again or close this window.';
      } catch (error) {
        if (current()) status.textContent = error instanceof Error ? error.message : "Couldn't load Google sign-in. Please try again.";
      }
    })();
  });
}
