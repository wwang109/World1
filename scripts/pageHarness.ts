/**
 * Shared Playwright page setup for the browser-driven scripts.
 */
import type { Page } from 'playwright';

/**
 * Cuts the Vite HMR client out of the page, so nothing but this script decides
 * when it navigates.
 *
 * WHY (2026-08-31). `npm run dev` full-page-reloads the browser every time a
 * source file it serves changes. In this repo that is not a rare event: several
 * agents edit `src/` at once, and a single audit run spans minutes. A reload
 * mid-walkthrough destroys the JS execution context, so the very next
 * `page.evaluate` throws `Execution context was destroyed, most likely because
 * of a navigation` — and, worse, the reload silently resets the whole run, so a
 * script that happens NOT to be mid-evaluate carries on auditing a fresh Start
 * screen under the name of whatever screen it thought it was on. Measured
 * directly: `vite` logged 16 `page reload` lines in eight minutes, and
 * `shop-smoke.ts` failed at the SAME point with and without any change of its
 * own, twice, in two different places.
 *
 * A gate that fails at random is the same disease as a gate that reports
 * fictional violations: nobody can act on either.
 *
 * HOW. The HMR client's only channel is a WebSocket opened with the `vite-hmr`
 * subprotocol; every reload it performs is a message on that socket. An init
 * script (installed before any page script runs) hands that ONE socket a stub
 * that never opens and never delivers a message, and passes every other
 * WebSocket straight through untouched.
 *
 * NOT `page.route('**\/@vite\/client')`, which was the first version of this.
 * It works, but enabling Playwright routing sends EVERY request through the
 * driver, and this app's boot fetches a lot of art: measured on this machine,
 * a desktop boot went 2233/2343ms unrouted to 3182/2790ms routed — ~25-40%
 * slower, on the exact code path that already has a timeout of its own. An
 * init script costs nothing per request.
 *
 * A production preview build never opens this socket and is unaffected.
 */
export async function pinPageAgainstHmr(page: Page): Promise<void> {
  // Passed as SOURCE, not as a function. `addInitScript` serializes a function
  // by its text, and tsx/esbuild wraps named function expressions in a
  // `__name(...)` helper call that does not exist in the browser — the same
  // `ReferenceError: __name is not defined` trap `collectRawSceneTexts`
  // documents for `page.evaluate`. A string cannot be transpiled at all.
  await page.addInitScript({
    content: [
      '(() => {',
      '  const Native = window.WebSocket;',
      '  const Stub = function (url, protocols) {',
      "    const vite = protocols === 'vite-hmr' || (Array.isArray(protocols) && protocols.indexOf('vite-hmr') >= 0);",
      '    if (!vite) return new Native(url, protocols);',
      '    // CLOSED, permanently. Vite\'s client attaches its listeners and then',
      '    // waits; with no message it has nothing to act on and never reloads.',
      '    return {',
      "      url: String(url), readyState: 3, protocol: '', extensions: '', binaryType: 'blob',",
      '      bufferedAmount: 0, onopen: null, onclose: null, onmessage: null, onerror: null,',
      '      close() {}, send() {}, addEventListener() {}, removeEventListener() {},',
      '      dispatchEvent() { return false; },',
      '    };',
      '  };',
      '  Stub.CONNECTING = 0; Stub.OPEN = 1; Stub.CLOSING = 2; Stub.CLOSED = 3;',
      '  Stub.prototype = Native.prototype;',
      '  window.WebSocket = Stub;',
      '})();',
    ].join('\n'),
  });
}
