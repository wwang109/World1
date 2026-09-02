/**
 * Shared Chromium resolution for every Playwright-driven script in this repo
 * (`run-hud-audit.ts`, `shop-smoke.ts`, `encode-card-art.ts`).
 *
 * WHY THIS IS ONE MODULE (2026-09-02). All three scripts used to carry their
 * own copy plus a comment claiming it was "the same resolution strategy" as
 * the others. All three had drifted, and each was broken on Windows in a
 * different way:
 *
 *   - `run-hud-audit.ts` / `shop-smoke.ts` hardcoded ONE developer's home
 *     directory AND a pinned revision
 *     (`C:/Users/<name>/AppData/Local/ms-playwright/chromium-1223/...`). That
 *     resolves on no other machine, and stops resolving on that one too after
 *     the next `playwright install` bumps the revision — while the POSIX half
 *     of the same function was already revision-agnostic. The asymmetry, not
 *     the literal, was the defect.
 *   - `encode-card-art.ts` had the revision-agnostic scan on both platforms
 *     but read `process.env.HOME`, which Windows does not set — it sets
 *     `USERPROFILE`. Git Bash sets `HOME` too, so the throw only appeared from
 *     cmd/PowerShell, which is exactly what npm runs `art:encode` under.
 *
 * A comment cannot keep three copies in step. Sharing the code is what makes
 * that comment true, so the copies are gone and this is the only resolver.
 *
 * Order, highest priority first:
 *
 *   1. `PW_CHROMIUM` — explicit override, always wins (CI, a one-off machine,
 *      whatever). Same env var `docs/ui-workbook.md` already names.
 *   2. `PLAYWRIGHT_BROWSERS_PATH` — the standard Playwright browser-cache dir.
 *      This is scanned rather than handed straight to `chromium.launch()`
 *      because Playwright's own version-resolution wants whatever revision its
 *      installed `playwright` package manifest names, which can be NEWER than
 *      what is actually unpacked under a custom browsers path (seen in
 *      practice: manifest asks for 1228, only 1194 is on disk) — that fails
 *      with "Executable doesn't exist" even though a perfectly good Chromium
 *      IS present. Scanning for whatever `chromium-*` build actually exists
 *      sidesteps the mismatch. The `chromium` convenience symlink some
 *      installs provide (e.g. `/opt/pw-browsers/chromium`) is tried first.
 *   3. Playwright's per-user default cache, scanned by the SAME `scan()` on
 *      every platform — `%USERPROFILE%\AppData\Local\ms-playwright` on
 *      Windows, `~/.cache/ms-playwright` elsewhere.
 *
 * Throws (naming both env vars) if nothing resolves — a browser-less script
 * must fail loudly, not fall through to `undefined` and let Playwright
 * silently pick a possibly-mismatched version.
 */
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The user's home directory. `USERPROFILE` first because it is the ONLY one
 * Windows itself sets: `HOME` exists there only under Git Bash / MSYS, so a
 * `HOME`-only lookup passes in a bash shell and throws under cmd/PowerShell —
 * the same machine, the same install, opposite results. On POSIX
 * `USERPROFILE` is simply absent and `HOME` answers.
 */
function homeDir(): string {
  return process.env.USERPROFILE ?? process.env.HOME ?? '';
}

/**
 * Newest `chromium-<rev>` build actually unpacked under `browsersPath`, or
 * null. Revision-agnostic on purpose — pinning a revision number is how the
 * Windows branch of the old copies rotted.
 */
function scan(browsersPath: string): string | null {
  const isWin = process.platform === 'win32';
  const exeName = isWin ? 'chrome.exe' : 'chrome';
  const platformDirs = isWin ? ['chrome-win64', 'chrome-win'] : ['chrome-linux'];

  const symlink = join(browsersPath, 'chromium');
  if (existsSync(symlink)) return symlink;

  let entries: string[];
  try {
    entries = readdirSync(browsersPath);
  } catch {
    return null;
  }
  // `chromium-1194` yes, `chromium_headless_shell-1194` no — the hyphen is
  // the discriminator. Highest revision first so a stray older unpack (left
  // over from a previous `npx playwright install`) isn't preferred.
  const revisioned = entries
    .filter((e) => /^chromium-\d+$/.test(e))
    .sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]));
  for (const dir of revisioned) {
    for (const sub of platformDirs) {
      const candidate = join(browsersPath, dir, sub, exeName);
      if (existsSync(candidate)) return candidate;
    }
  }
  return null;
}

/** `scriptName` only names the caller in the throw, so the failure says which
 * script could not start rather than pointing here. */
export function resolveChromiumPath(scriptName: string): string {
  if (process.env.PW_CHROMIUM) return process.env.PW_CHROMIUM;

  const browsersPath = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (browsersPath) {
    const found = scan(browsersPath);
    if (found) return found;
  }

  const home = homeDir();
  if (home) {
    const cacheDir = process.platform === 'win32'
      ? join(home, 'AppData', 'Local', 'ms-playwright')
      : join(home, '.cache', 'ms-playwright');
    const found = scan(cacheDir);
    if (found) return found;
  }

  throw new Error(
    `${scriptName}: could not resolve a Chromium executable. Set PW_CHROMIUM to an explicit ` +
    'binary path, or PLAYWRIGHT_BROWSERS_PATH to a Playwright browsers cache dir containing a ' +
    "chromium-* build (see docs/ui-workbook.md's Screenshot capture recipe).",
  );
}
