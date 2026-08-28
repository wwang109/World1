/**
 * Run HUD audit — Playwright-driven verification of `renderRunHud` +
 * `runScreenTemplate` in a real browser. Two layers, per the HUD/screen-
 * template spec (see `src/game/ui/runScreenTemplate.ts`):
 *
 *   1. Walks the LIVE `window.__game` scene graph on every run screen at
 *      both viewports, collecting every visible Text object's world bounds,
 *      and flags: (a) any text extending outside the canvas, (b) any two
 *      texts overlapping by more than a small tolerance, (c) required HUD
 *      strings (DAY/WAVE/GOLD/LV/LIVES/BOSSES) missing from the stats
 *      region.
 *   2. Drives an actual playthrough (Map -> Draft -> Map -> a node -> Deck
 *      Build -> RETIRE -> end summary) against the scene graph (no hardcoded
 *      canvas coordinates for anything the HUD/game renders dynamically),
 *      screenshotting every screen. Text that carries a variable suffix
 *      (node titles, the front-door button) is matched by PREFIX
 *      (`clickPrefixText`); text that's genuinely fixed is matched exactly
 *      (`clickExactText`) — either way, a step whose target text isn't on
 *      screen fails LOUDLY, by the step's own name, instead of silently
 *      clicking nothing and leaving the walkthrough parked on the previous
 *      screen (repeat screenshot hashes are also checked directly, as a
 *      second, independent guard against exactly that failure mode).
 *
 * Usage: `npx tsx scripts/run-hud-audit.ts [outDir]`
 * Requires the Vite dev server running at :5173 (`npm run dev`) and the
 * battle API at :8787 (`npm run api`) — neither is started by this script.
 */
import { existsSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { chromium, type Page } from 'playwright';
import { rollStartDraft, DRAFT_SET_KEYS } from '../src/run/draft';
import { skillBook } from '../src/data/skills';
import { runScreenTemplate } from '../src/game/ui/runScreenTemplate';

const BASE = process.env.WORLD1_DEV_URL ?? 'http://localhost:5173';
const OUT_DIR = process.argv[2] ?? '.';

/**
 * Resolve the Chromium executable to launch, in priority order:
 *
 *   1. `PW_CHROMIUM` — explicit override, always wins (CI, a one-off machine,
 *      whatever). Same env var `docs/ui-workbook.md` already names.
 *   2. `PLAYWRIGHT_BROWSERS_PATH` — the standard Playwright browser-cache dir.
 *      This is scanned rather than handed straight to `chromium.launch()`
 *      because Playwright's own version-resolution wants whatever revision
 *      its installed `playwright` package manifest names, which can be NEWER
 *      than what is actually unpacked under a custom browsers path (seen in
 *      practice: manifest asks for 1228, only 1194 is on disk) — that fails
 *      with "Executable doesn't exist" even though a perfectly good Chromium
 *      IS present. Scanning for whatever `chromium-*` build actually exists
 *      sidesteps the mismatch. The `chromium` convenience symlink some
 *      installs provide (e.g. `/opt/pw-browsers/chromium`) is tried first.
 *   3. A platform default, scanned the same way: the Windows dev-machine path
 *      this project has historically used, or Playwright's default
 *      `~/.cache/ms-playwright` on Linux/Mac.
 *
 * Throws (with a message naming both env vars) if nothing resolves — a
 * browser-less audit must fail loudly, not fall through to `undefined` and
 * let Playwright silently pick a possibly-mismatched version.
 */
function resolveChromiumPath(): string {
  if (process.env.PW_CHROMIUM) return process.env.PW_CHROMIUM;

  const isWin = process.platform === 'win32';
  const exeName = isWin ? 'chrome.exe' : 'chrome';
  const platformDirs = isWin ? ['chrome-win64', 'chrome-win'] : ['chrome-linux'];

  function scan(browsersPath: string): string | null {
    const symlink = join(browsersPath, 'chromium');
    if (existsSync(symlink)) return symlink;
    let entries: string[];
    try {
      entries = readdirSync(browsersPath);
    } catch {
      return null;
    }
    // `chromium-1194` yes, `chromium_headless_shell-1194` no — the hyphen is
    // the discriminator. Highest revision first so a stray older unpack
    // (left over from a previous `npx playwright install`) isn't preferred.
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

  const browsersPath = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (browsersPath) {
    const found = scan(browsersPath);
    if (found) return found;
  }

  if (isWin) {
    const winDefault = 'C:/Users/wenwa/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe';
    if (existsSync(winDefault)) return winDefault;
  } else {
    const home = process.env.HOME ?? '';
    const found = home ? scan(join(home, '.cache', 'ms-playwright')) : null;
    if (found) return found;
  }

  throw new Error(
    'run-hud-audit: could not resolve a Chromium executable. Set PW_CHROMIUM to an explicit ' +
    'binary path, or PLAYWRIGHT_BROWSERS_PATH to a Playwright browsers cache dir containing a ' +
    "chromium-* build (see docs/ui-workbook.md's Screenshot capture recipe)."
  );
}

type Platform = 'desktop' | 'mobile';
const VIEWPORTS: Record<Platform, { width: number; height: number }> = {
  desktop: { width: 1440, height: 900 },
  mobile: { width: 412, height: 892 },
};
const MAP_SCENE: Record<Platform, string> = { desktop: 'desktop-runmap', mobile: 'mrunmap' };

interface TextBound { text: string; x: number; y: number; width: number; height: number; scene: string }

interface AuditResult {
  screen: string;
  platform: Platform;
  offCanvas: TextBound[];
  overlaps: Array<{ a: TextBound; b: TextBound; overlapPx: number }>;
  missingStats: string[];
  textCount: number;
}

const violations: AuditResult[] = [];

/**
 * Things that make the audit itself untrustworthy, as opposed to a layout bug:
 * a run that threw, a navigation click whose label no longer exists, an
 * uncaught page error, a screen that was never reached. Any one of these means
 * the audit did NOT audit what it claims to have audited, so it must exit
 * non-zero — an audit that cannot fail is worse than no audit, because it is
 * trusted. (This script used to swallow a thrown run and exit 0 having
 * inspected nothing at all.)
 */
const hardFailures: string[] = [];

const PLATFORMS: Platform[] = ['desktop', 'mobile'];

/** Every screen a complete run MUST have visited, per platform. Without this,
 * a renamed button silently re-audits the PREVIOUS screen under the next
 * screen's name and the run still reports green. */
const EXPECTED_SCREENS: Array<{ label: string; matches: (screen: string) => boolean }> = [
  { label: 'map-start', matches: (s) => s === 'map-start' },
  { label: 'draft', matches: (s) => s === 'draft' },
  { label: 'map-active', matches: (s) => s === 'map-active' },
  { label: 'node-*', matches: (s) => s.startsWith('node-') },
  { label: 'deck', matches: (s) => s === 'deck' },
  { label: 'retire-confirm', matches: (s) => s === 'retire-confirm' },
  { label: 'end-summary', matches: (s) => s === 'end-summary' },
];

/** Pulls every visible Text object's world bounds off the live scene graph
 * (recursing into Containers) — the ONLY thing this script trusts is what
 * the browser actually rendered. */
async function collectTexts(page: Page): Promise<TextBound[]> {
  // NOTE: deliberately iterative (no nested named function/const-arrow) —
  // tsx/esbuild injects a `__name(...)` helper call around named functions
  // that Playwright's `page.evaluate` serializes by source text alone, which
  // throws `ReferenceError: __name is not defined` in the browser. An
  // explicit stack avoids the recursive named helper entirely.
  return page.evaluate(() => {
    const game = (window as any).__game;
    const out: Array<{ text: string; x: number; y: number; width: number; height: number; scene: string }> = [];
    const stack: Array<{ obj: any; scene: string }> = [];
    for (const scene of game.scene.scenes) {
      if (!scene.sys.isActive()) continue;
      const key = scene.sys.settings.key as string;
      for (const obj of scene.children.list) stack.push({ obj, scene: key });
    }
    while (stack.length > 0) {
      const { obj, scene } = stack.pop()!;
      if (!obj || obj.visible === false || (obj.alpha ?? 1) === 0) continue;
      if (obj.type === 'Text' && typeof obj.text === 'string' && obj.text.length > 0) {
        const b = obj.getBounds();
        out.push({ text: obj.text, x: b.x, y: b.y, width: b.width, height: b.height, scene });
      }
      if (Array.isArray(obj.list)) for (const child of obj.list) stack.push({ obj: child, scene });
    }
    return out;
  });
}

function overlaps(a: TextBound, b: TextBound): number {
  const ix = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const iy = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  if (ix <= 0 || iy <= 0) return 0;
  return ix * iy;
}

/**
 * Reconstructs the HUD stats line(s) that `RunProgressStrip.ts` draws as
 * SEQUENTIAL sibling Text objects (label, value, separator — each its own
 * node, sharing one color per segment) rather than one string. A regex like
 * `DAY \d` will never match any SINGLE object's `.text` under that scheme —
 * "DAY " and "0" are two different nodes — so naively testing each text node
 * in isolation flags every required stat "missing" even when the HUD is
 * rendering them correctly. So the segments are grouped back into rows and
 * concatenated left-to-right by `x`, which reconstructs the line the audit
 * actually needs to test against.
 *
 * GROUPED BY THE ROW'S BOTTOM EDGE, not by `y`. Segments used to share one `y`
 * because they shared one font size; since the HUD adopted the stat-run
 * renderer (`ui/statRunStrip.ts`) a row mixes an 11px label with a 13px value
 * and every piece is BOTTOM-ALIGNED onto a single reading line — so the tops
 * differ by a few px while `y + height` is identical. Grouping on the top edge
 * split each line into a labels-only row and a values-only row, and every
 * required stat read as missing on every run screen. The bottom edge is also
 * the more honest definition of "same row": it is the baseline a reader sees.
 */
function reconstructRows(texts: TextBound[]): string[] {
  const groups = new Map<string, TextBound[]>();
  for (const t of texts) {
    const key = `${t.scene}|${Math.round(t.y + t.height)}`;
    const g = groups.get(key);
    if (g) g.push(t); else groups.set(key, [t]);
  }
  const rows: string[] = [];
  for (const g of groups.values()) {
    if (g.length < 2) continue; // a lone text needs no reconstruction — already checked directly
    rows.push([...g].sort((a, b) => a.x - b.x).map((t) => t.text).join(''));
  }
  return rows;
}

/** Layer (a)+(b): canvas containment + pairwise overlap, both with a small
 * pixel tolerance (subpixel rounding / hairline kerning is not a real bug). */
async function auditScreen(page: Page, screen: string, platform: Platform, requiredStats: string[] = []): Promise<AuditResult> {
  const { width, height } = VIEWPORTS[platform];
  const texts = await collectTexts(page);
  const TOL = 2;
  const offCanvas = texts.filter((t) => t.x < -TOL || t.y < -TOL || t.x + t.width > width + TOL || t.y + t.height > height + TOL);
  const overlapsFound: AuditResult['overlaps'] = [];
  for (let i = 0; i < texts.length; i++) {
    for (let j = i + 1; j < texts.length; j++) {
      const area = overlaps(texts[i]!, texts[j]!);
      if (area > 36) overlapsFound.push({ a: texts[i]!, b: texts[j]!, overlapPx: area }); // >6x6px real overlap
    }
  }
  const rows = reconstructRows(texts);
  const missingStats = requiredStats.filter((needle) => {
    const re = new RegExp(needle);
    return !texts.some((t) => re.test(t.text)) && !rows.some((r) => re.test(r));
  });
  const result: AuditResult = { screen, platform, offCanvas, overlaps: overlapsFound, missingStats, textCount: texts.length };
  violations.push(result);
  return result;
}

/**
 * Scrapes the pre-run seed straight off the Start screen's own footnote
 * ("seed 123456 · tap to reroll", `StartScene.ts`) instead of assuming a
 * fixed value. `pendingSeed` is randomized at module load
 * (`1 + Math.floor(Math.random() * 999999)`, `runStore.ts`) — a script that
 * hardcodes `seed=1` to pre-compute the draft's card names will match the
 * live board only by a 1-in-999999 coincidence, which is exactly the kind of
 * silent, un-thrown mismatch this audit exists to catch. Reading the real
 * seed off the page keeps the picked cards byte-identical to what a player
 * actually sees, no matter what `pendingSeed` rolls to.
 */
async function readPendingSeed(page: Page): Promise<number | null> {
  const texts = await collectTexts(page);
  for (const t of texts) {
    const m = /^seed (\d+)/.exec(t.text);
    if (m) return Number(m[1]);
  }
  return null;
}

/**
 * Clicks the ONE Text object whose rendered string equals `label` exactly.
 * `step` is a short, human-readable name for what this click is SUPPOSED to
 * accomplish ("map-start -> START RUN", "retire-confirm -> RETIRE (confirm)",
 * ...) — every failure is reported against that name, never silently, so a
 * stale selector fails the step it broke instead of quietly no-opping and
 * letting the walkthrough re-audit the previous screen under the next
 * screen's label (the "byte-identical screenshots" failure mode this script
 * used to have).
 *
 * KNOWN HARNESS FLAKE (task #62, 2026-08-19) — unlike `shop-smoke.ts`, this
 * script does NOT retry a click that lands with no effect; per the doc
 * comment above, a step that doesn't take is meant to fail loudly by name.
 * Be aware, though, that a "no visible text to click"/"scene never changed"
 * failure on a button whose text WAS confirmed present a moment earlier can
 * be this known artifact rather than a real regression: this script (like
 * `shop-smoke.ts`) launches Chromium with `--use-angle=swiftshader` (no real
 * GPU in this sandbox), and a direct measurement of `game.loop.actualFps`
 * during a real run showed the game loop at ~5-30 fps against Phaser's
 * 60fps target. Phaser defers a dispatched pointer event's hit-test to its
 * own next game step rather than processing it synchronously with the DOM
 * event; at this frame rate that step can be 150-200ms+ away — long enough
 * for an unrelated in-flight action (another rebuild, a tween-heavy fight
 * render) to destroy-and-recreate the display list before the queued click
 * is hit-tested, leaving it with nothing to land on. Confirmed NOT a
 * `Scale.Events.RESIZE`-driven relayout race (logged every RESIZE event
 * across dozens of repro attempts in `shop-smoke.ts`; none fired at the
 * failure point) and NOT a Playwright-synthetic-event artifact (the same
 * click mechanism reproduced zero no-effect clicks in short, lightly-loaded
 * sessions). A real player's device clears Phaser's frame budget with far
 * more headroom than this software-rendered sandbox, so if this audit starts
 * flaking on a specific click, retry it (mirroring `shop-smoke.ts`'s
 * pattern) rather than treating a single failure as proof of a product bug —
 * see `shop-smoke.ts`'s `handleFight` CONTINUE-retry comment for the full
 * writeup.
 */
async function clickExactText(page: Page, label: string, platform: Platform, step: string): Promise<boolean> {
  const { width, height } = await page.evaluate(() => ({ width: (window as any).__gameDesignWidth, height: (window as any).__gameDesignHeight }));
  const hit = await page.evaluate((label: string) => {
    const game = (window as any).__game;
    let found: { x: number; y: number } | null = null;
    const stack: any[] = [];
    for (const scene of game.scene.scenes) {
      if (!scene.sys.isActive()) continue;
      for (const obj of scene.children.list) stack.push(obj);
    }
    // Last match wins (a confirm dialog's button is added AFTER the HUD's,
    // so it's later in this walk order) — iterate front-to-back, not a stack
    // pop, so "last added" really means "last visited".
    while (stack.length > 0) {
      const obj = stack.shift();
      if (!obj || obj.visible === false) continue;
      if (obj.type === 'Text' && obj.text === label) {
        const b = obj.getBounds();
        found = { x: b.centerX, y: b.centerY };
      }
      if (Array.isArray(obj.list)) for (const child of obj.list) stack.push(child);
    }
    return found;
  }, label);
  if (!hit) {
    hardFailures.push(`[${platform}] step "${step}": no visible text "${label}" to click — the walkthrough cannot have gone where it says it went`);
    return false;
  }
  const canvas = page.locator('canvas');
  const box = await canvas.boundingBox();
  if (!box) {
    hardFailures.push(`[${platform}] step "${step}": canvas has no bounding box — nothing was clickable`);
    return false;
  }
  const dw = width || box.width;
  const dh = height || box.height;
  await page.mouse.click(box.x + (hit.x / dw) * box.width, box.y + (hit.y / dh) * box.height);
  return true;
}

/**
 * Clicks the first visible Text object whose string satisfies `predicate` —
 * the resilient matcher: node titles / front-door copy carry variable
 * suffixes ("FIGHT · EASY", "START RUN ›") that an exact-text match would go
 * stale against on every wording tweak. The predicate runs in NODE (against
 * texts fetched via `collectTexts`), not serialized into the page, so it can
 * be as precise as the caller needs — a naive `startsWith('BOSS')`, for
 * instance, also matches the HUD's own `"BOSSES "` stat-strip label (a
 * completely different, non-interactive text object that happens to render
 * on every run screen), silently "picking" that instead of a real BOSS node
 * and leaving the walkthrough exactly where it started with no thrown error.
 * `describe` names the match rule in any failure message. Reports the actual
 * matched string (not just the rule) so a caller can chain a further exact
 * click against precisely what's on screen.
 */
async function clickMatchingText(
  page: Page,
  platform: Platform,
  step: string,
  predicate: (text: string) => boolean,
  describe: string,
): Promise<string | null> {
  const texts = await collectTexts(page);
  const match = texts.find((t) => predicate(t.text));
  if (!match) {
    hardFailures.push(`[${platform}] step "${step}": no visible text matching ${describe} — the walkthrough could not advance`);
    return null;
  }
  await clickExactText(page, match.text, platform, step);
  return match.text;
}

async function activeSceneKey(page: Page): Promise<string> {
  return page.evaluate(() => {
    const game = (window as any).__game;
    const scene = game.scene.scenes.find((s: any) => s.sys.isActive());
    return scene ? scene.sys.settings.key : '(none)';
  });
}

/** Polls `predicate` every 200ms until it's true or `timeoutMs` elapses.
 * Returns whether it succeeded — callers turn a `false` into a named,
 * loud hard failure rather than plowing on regardless. */
async function waitUntil(page: Page, predicate: () => Promise<boolean>, timeoutMs: number): Promise<boolean> {
  const start = Date.now();
  for (;;) {
    if (await predicate()) return true;
    if (Date.now() - start >= timeoutMs) return false;
    await page.waitForTimeout(200);
  }
}

/**
 * Waits for at least one visible Text matching `predicate` to appear.
 * Replaces this script's old fixed `waitForTimeout(900)` after page load,
 * which assumed the BootScene loader always finishes near-instantly — on
 * this machine it's documented to take 20s+, so a 900ms sleep raced it and
 * intermittently screenshotted/audited the STILL-LOADING screen while the
 * walkthrough's very first click ("START RUN") found nothing yet and the
 * failure looked like a stale selector rather than a slow loader.
 */
async function waitForText(
  page: Page,
  platform: Platform,
  step: string,
  predicate: (text: string) => boolean,
  describe: string,
  timeoutMs = 30_000,
): Promise<boolean> {
  const ok = await waitUntil(page, async () => (await collectTexts(page)).some((t) => predicate(t.text)), timeoutMs);
  if (!ok) hardFailures.push(`[${platform}] step "${step}": no text matching ${describe} appeared within ${timeoutMs}ms`);
  return ok;
}

/**
 * Waits for the active scene to become something OTHER than any key in
 * `awayFrom` — the post-condition for every click that's supposed to trigger
 * a `scene.start(...)` transition. A click whose target text existed and got
 * clicked, but whose handler was gated off (e.g. the Draft "START" button is
 * only interactive once every row has a pick) leaves the scene unchanged with
 * NO thrown error and no missing-selector failure either — the only way to
 * catch that is to check the postcondition actually holds.
 */
async function waitForSceneChange(page: Page, platform: Platform, step: string, awayFrom: string[], timeoutMs = 15_000): Promise<string> {
  await waitUntil(page, async () => !awayFrom.includes(await activeSceneKey(page)), timeoutMs);
  const landed = await activeSceneKey(page);
  if (awayFrom.includes(landed)) {
    hardFailures.push(`[${platform}] step "${step}": scene is still "${landed}" ${timeoutMs}ms later — the click had no effect (target disabled? postcondition not met?)`);
  }
  return landed;
}

/** md5 of every screenshot ever taken, by platform — the direct guard against
 * this script's own historical failure mode: a click that silently missed
 * left the walkthrough parked on the previous screen, so every later
 * screenshot in the run was byte-identical to the one before it while the
 * script still reported nothing wrong. A repeated hash now fails LOUDLY and
 * names which two screens collided, independent of whether the click that
 * caused it also happened to report a hard failure of its own. */
const shotHashes: Record<Platform, Map<string, string>> = { desktop: new Map(), mobile: new Map() };

async function shot(page: Page, name: string, platform: Platform): Promise<void> {
  const path = `${OUT_DIR}/${name}.png`;
  const buf = await page.screenshot({ path });
  const hash = createHash('md5').update(buf).digest('hex');
  const seen = shotHashes[platform];
  for (const [prevName, prevHash] of seen) {
    if (prevHash === hash) {
      hardFailures.push(`[${platform}] screenshot "${name}" is byte-identical (md5 ${hash}) to earlier "${prevName}" — the walkthrough did not actually move between them`);
    }
  }
  seen.set(name, hash);
}

async function runPlatform(page: Page, platform: Platform): Promise<void> {
  const { width, height } = VIEWPORTS[platform];
  const desktop = platform === 'desktop';
  // `\s*` between token and figure: the stat-run renderer draws the value as
  // its own Text with a leading space (' 137'), so the reconstructed row reads
  // "GOLD 137" on desktop and "G 137" on mobile. The label/figure PAIRING is
  // what this check is about, not how many spaces sit between the two halves.
  const REQUIRED_STATS = desktop
    ? ['DAY\\s*\\d', 'WAVE\\s*\\d', 'GOLD\\s*\\d', 'LV\\s*\\d', 'LIVES\\s*\\d', 'BOSSES\\s*\\d']
    : ['D\\s*\\d', 'W\\s*\\d', 'G\\s*\\d', 'LV\\s*\\d', '♥\\s*\\d', 'B\\s*\\d'];

  const DRAFT_SCENE = desktop ? 'DesktopDraft' : 'MobileDraft';
  const MAP_SCENE_KEY = desktop ? 'DesktopRunMap' : 'MobileRunMap';
  const DECK_SCENE = desktop ? 'DesktopDeck' : 'MobileDeckBuild';

  // ---- 1. Map, no run ----
  // A run map with no active run is now a single, one-door redirect straight
  // to the `Start` scene (`DesktopRunMapScene`/`MobileRunMapScene`: "ONE
  // front door: no duplicate start panel here"). `?scene=desktop-runmap`/
  // `mrunmap` still resolves the VIEWPORT profile via `layoutProfile.ts`, the
  // redirect just fires before this screen paints anything of its own — so
  // what actually gets audited here is the Start screen, and that is correct.
  //
  // NO fixed sleep here: `BootScene`'s asset loader is documented to take
  // 20s+ on this machine, and a short `waitForTimeout` used to race it —
  // intermittently screenshotting/auditing the still-loading screen and then
  // failing the FIRST click ("START RUN") in a way that looked exactly like
  // a stale selector. Wait for the condition that actually matters instead:
  // the front-door button text is on screen.
  await page.goto(`${BASE}/?ui=${platform}&scene=${MAP_SCENE[platform]}`, { waitUntil: 'networkidle' });
  await page.evaluate(({ w, h }) => { (window as any).__gameDesignWidth = w; (window as any).__gameDesignHeight = h; }, { w: width, h: height });
  await waitForText(page, platform, 'map-start -> loader finished', (t) => t.startsWith('START RUN') || t.startsWith('RESUME RUN'), 'START RUN/RESUME RUN', 30_000);
  await shot(page, `${platform}-01-map-start`, platform);
  await auditScreen(page, 'map-start', platform);

  // Read the REAL pre-run seed off the Start screen's own footnote
  // ("seed 123456 · tap to reroll") before pressing START — `pendingSeed` is
  // randomized at module load (`runStore.ts`), not a fixed `1`, so the draft
  // this script pre-computes below must use the number actually on screen or
  // its card-name clicks silently target skills the live board never rolled.
  const seed = await readPendingSeed(page);
  if (seed === null) {
    hardFailures.push(`[${platform}] step "map-start -> read seed": no "seed NNNN · tap to reroll" text found — cannot predict the draft`);
  }

  // ---- 2. Start a run -> Draft ----
  // The front door reads "START RUN ›" (or "RESUME RUN ›" if a run is already
  // active) — `runStore.ts`'s in-memory state is always fresh here since each
  // platform gets its own full page navigation above, so "START RUN" is the
  // only branch this walkthrough should ever hit, but both are matched so a
  // rerun against a page that didn't fully reset fails loudly instead of
  // silently clicking nothing.
  await clickMatchingText(page, platform, 'map-start -> START RUN', (t) => t.startsWith('START RUN') || t.startsWith('RESUME RUN'), '"START RUN"/"RESUME RUN"');
  await waitForSceneChange(page, platform, 'map-start -> START RUN transition', ['Start']);
  await shot(page, `${platform}-02-draft`, platform);
  await auditScreen(page, 'draft', platform);

  // Pick the FIRST card in every draft row, computed against the SEED READ
  // OFF THE PAGE above (not a hardcoded guess), so the click always targets
  // an EXACT text the scene actually rendered. Desktop shows all 4 rows at
  // once; mobile shows one set at a time (NEXT between sets).
  const draft = rollStartDraft(seed ?? 1);
  for (let i = 0; i < DRAFT_SET_KEYS.length; i++) {
    const key = DRAFT_SET_KEYS[i]!;
    const card = draft[key][0];
    const name = card ? skillBook[card.skillId]?.name : undefined;
    if (name) { await clickExactText(page, name, platform, `draft -> pick ${key} (${name})`); await page.waitForTimeout(150); }
    if (!desktop && i < DRAFT_SET_KEYS.length - 1) { await clickExactText(page, 'NEXT', platform, `draft -> NEXT (after ${key})`); await page.waitForTimeout(150); }
  }
  await clickExactText(page, 'START', platform, 'draft -> START');
  // The draft's START button is only INTERACTIVE once all 4 rows have a pick
  // (`DesktopDraftScene`/`MobileDraftScene`: `ready = picks.length === 4`) —
  // its Text label reads "START" either way, so a click that lands on a
  // disabled button finds its target text (no missing-selector failure) and
  // does nothing (no scene change, no thrown error). Checking the actual
  // postcondition — the scene left Draft — is the only way to catch that.
  await waitForSceneChange(page, platform, 'draft -> START transition', [DRAFT_SCENE]);

  // ---- 3. Map, active run ----
  await shot(page, `${platform}-03-map-active`, platform);
  await auditScreen(page, 'map-active', platform, REQUIRED_STATS.filter(Boolean));

  // ---- 4. Pick the first available node -> Prep / Shop / Event ----
  // Match rule: exactly the kind label, or the kind label followed by the
  // "KIND · SUFFIX" theme grammar (`DesktopRunMapScene.choiceViewModel`) — NOT
  // a bare `startsWith('BOSS')`. The run HUD's own stats strip prints a
  // "BOSSES " label (`RunProgressStrip.ts`) on EVERY run screen including
  // this one; `'BOSSES '.startsWith('BOSS')` is true, so a naive prefix match
  // silently "picks" that stat label instead of a real node — no thrown
  // error, just a click on a non-interactive text that changes nothing.
  const NODE_KINDS = ['FIGHT', 'SHOP', 'EVENT', 'BOSS'];
  const picked = await clickMatchingText(
    page, platform, 'map-active -> pick a node',
    (t) => NODE_KINDS.some((k) => t === k || t.startsWith(`${k} ·`)),
    'a node title (KIND or KIND · SUFFIX)',
  );
  const landedOn = await waitForSceneChange(page, platform, 'map-active -> node transition', [MAP_SCENE_KEY]);
  await shot(page, `${platform}-04-node-${landedOn}`, platform);
  await auditScreen(page, `node-${landedOn}`, platform, REQUIRED_STATS.filter(Boolean));
  console.log(`[${platform}] picked "${picked}" -> landed on scene "${landedOn}"`);

  // ---- 5. DECK / BAG (secondary HUD slot) ----
  const deckLabel = desktop ? 'DECK / BAG' : 'DECK/BAG';
  const wentToDeck = await clickExactText(page, deckLabel, platform, `node-${landedOn} -> DECK/BAG`);
  if (wentToDeck) {
    await waitForSceneChange(page, platform, `node-${landedOn} -> DECK/BAG transition`, [landedOn]);
    await shot(page, `${platform}-05-deck`, platform);
    await auditScreen(page, 'deck', platform, REQUIRED_STATS.filter(Boolean));
    await clickExactText(page, '‹ MAP', platform, 'deck -> ‹ MAP');
    await waitForSceneChange(page, platform, 'deck -> ‹ MAP transition', [DECK_SCENE]);
  }

  // ---- 6. RETIRE (tertiary HUD slot) -> confirm -> end summary ----
  // Neither RETIRE click triggers a `scene.start` — both just flip a boolean
  // and re-render the SAME scene (`this.retireConfirmOpen = true; this.rerender()`
  // then `retireActiveRun(); this.rerender()`) — so the postcondition to wait
  // for is new TEXT appearing, not a scene-key change.
  await clickExactText(page, 'RETIRE', platform, 'map-active -> RETIRE');
  await waitForText(page, platform, 'map-active -> RETIRE confirm dialog', (t) => t === 'RETIRE THIS RUN?', '"RETIRE THIS RUN?"', 10_000);
  await shot(page, `${platform}-06-retire-confirm`, platform);
  await auditScreen(page, 'retire-confirm', platform);
  await clickExactText(page, 'RETIRE', platform, 'retire-confirm -> RETIRE (confirm)'); // last match = the dialog's red button
  await waitForText(page, platform, 'retire-confirm -> end summary', (t) => t === 'RUN RETIRED' || t === 'DEFEAT', '"RUN RETIRED"/"DEFEAT"', 10_000);
  await shot(page, `${platform}-07-end-summary`, platform);
  await auditScreen(page, 'end-summary', platform);
}

async function main(): Promise<void> {
  const chromiumPath = resolveChromiumPath();
  console.log(`Using Chromium: ${chromiumPath}`);
  const browser = await chromium.launch({
    executablePath: chromiumPath,
    args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--disable-gpu-sandbox', '--no-sandbox'],
  });
  for (const platform of PLATFORMS) {
    const page = await browser.newPage({ viewport: VIEWPORTS[platform] });
    // Same precedent as scripts/smoke.mjs: a thrown exception inside the game
    // fails the run. A screen that renders while throwing is not a pass.
    page.on('pageerror', (err) => hardFailures.push(`[${platform}] page error: ${String(err)}`));
    try {
      await runPlatform(page, platform);
    } catch (err) {
      hardFailures.push(`[${platform}] audit run threw: ${err instanceof Error ? err.message : String(err)}`);
    }
    await page.close();
  }
  await browser.close();

  for (const platform of PLATFORMS) {
    const audited = violations.filter((v) => v.platform === platform).map((v) => v.screen);
    for (const { label, matches } of EXPECTED_SCREENS) {
      if (!audited.some(matches)) hardFailures.push(`[${platform}] screen "${label}" was never audited`);
    }
  }

  let bad = 0;
  for (const v of violations) {
    const problems = v.offCanvas.length + v.overlaps.length + v.missingStats.length;
    if (problems === 0) continue;
    bad += problems;
    console.log(`\n=== VIOLATIONS: ${v.platform} / ${v.screen} (${v.textCount} texts) ===`);
    for (const t of v.offCanvas) console.log(`  OFF-CANVAS: "${t.text}" @ (${t.x.toFixed(0)},${t.y.toFixed(0)}) ${t.width.toFixed(0)}x${t.height.toFixed(0)} [${t.scene}]`);
    for (const o of v.overlaps) console.log(`  OVERLAP (${o.overlapPx.toFixed(0)}px^2): "${o.a.text}" [${o.a.scene}] <-> "${o.b.text}" [${o.b.scene}]`);
    for (const m of v.missingStats) console.log(`  MISSING STAT: "${m}"`);
  }
  if (hardFailures.length > 0) {
    console.log(`\n=== AUDIT DID NOT COMPLETE (${hardFailures.length}) ===`);
    for (const f of hardFailures) console.log(`  ${f}`);
  }

  console.log(`\nrunScreenTemplate desktop content region:`, runScreenTemplate('desktop').regions.content);
  console.log(`\nTotal screens audited: ${violations.length}. Total violations: ${bad}. Hard failures: ${hardFailures.length}.`);
  process.exit(bad > 0 || hardFailures.length > 0 ? 1 : 0);
}

// A failure to even start (no browser binary, bad dev URL) is a failed audit,
// not a silent pass — Node's unhandled-rejection default is not relied on.
void main().catch((err) => {
  console.error('audit could not run:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
