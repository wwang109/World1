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
 *      Build -> RETIRE -> end summary) using ONLY exact-text clicks against
 *      the scene graph (no hardcoded canvas coordinates for anything the
 *      HUD/game renders dynamically), screenshotting every screen.
 *
 * Usage: `npx tsx scripts/run-hud-audit.ts [outDir]`
 * Requires the Vite dev server running at :5173 (`npm run dev`) and the
 * battle API at :8787 (`npm run api`) — neither is started by this script.
 */
import { existsSync, readdirSync } from 'node:fs';
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
  const missingStats = requiredStats.filter((needle) => !texts.some((t) => new RegExp(needle).test(t.text)));
  const result: AuditResult = { screen, platform, offCanvas, overlaps: overlapsFound, missingStats, textCount: texts.length };
  violations.push(result);
  return result;
}

async function clickExactText(page: Page, label: string, platform: Platform): Promise<boolean> {
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
    hardFailures.push(`[${platform}] no visible text "${label}" to click — the walkthrough cannot have gone where it says it went`);
    return false;
  }
  const canvas = page.locator('canvas');
  const box = await canvas.boundingBox();
  if (!box) {
    hardFailures.push(`[${platform}] canvas has no bounding box — nothing was clickable`);
    return false;
  }
  const dw = width || box.width;
  const dh = height || box.height;
  await page.mouse.click(box.x + (hit.x / dw) * box.width, box.y + (hit.y / dh) * box.height);
  return true;
}

async function clickPrefixText(page: Page, prefixes: string[], platform: Platform): Promise<string | null> {
  const found = await page.evaluate((prefixes: string[]) => {
    const game = (window as any).__game;
    let match: { text: string } | null = null;
    const stack: any[] = [];
    for (const scene of game.scene.scenes) {
      if (!scene.sys.isActive()) continue;
      for (const obj of scene.children.list) stack.push(obj);
    }
    while (stack.length > 0 && !match) {
      const obj = stack.shift();
      if (!obj || obj.visible === false) continue;
      if (obj.type === 'Text' && typeof obj.text === 'string' && prefixes.some((p) => obj.text.startsWith(p))) {
        match = { text: obj.text };
      }
      if (Array.isArray(obj.list)) for (const child of obj.list) stack.push(child);
    }
    return match;
  }, prefixes);
  if (!found) {
    hardFailures.push(`[${platform}] no node matching ${prefixes.join('/')} on the map — the run could not be advanced`);
    return null;
  }
  await clickExactText(page, (found as { text: string }).text, platform);
  return (found as { text: string }).text;
}

async function activeSceneKey(page: Page): Promise<string> {
  return page.evaluate(() => {
    const game = (window as any).__game;
    const scene = game.scene.scenes.find((s: any) => s.sys.isActive());
    return scene ? scene.sys.settings.key : '(none)';
  });
}

async function shot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: `${OUT_DIR}/${name}.png` });
}

async function runPlatform(page: Page, platform: Platform): Promise<void> {
  const { width, height } = VIEWPORTS[platform];
  const desktop = platform === 'desktop';
  const REQUIRED_STATS = desktop
    ? ['DAY \\d', 'WAVE \\d', 'GOLD \\d', 'LV \\d', 'LIVES \\d', 'BOSSES \\d']
    : ['D\\d', 'W\\d', 'G\\d', 'LV\\d', '♥\\d', 'B\\d'];

  // ---- 1. Map, no run ----
  await page.goto(`${BASE}/?ui=${platform}&scene=${MAP_SCENE[platform]}`, { waitUntil: 'networkidle' });
  await page.evaluate(({ w, h }) => { (window as any).__gameDesignWidth = w; (window as any).__gameDesignHeight = h; }, { w: width, h: height });
  await page.waitForTimeout(900);
  await shot(page, `${platform}-01-map-start`);
  await auditScreen(page, 'map-start', platform);

  // ---- 2. Start a run -> Draft ----
  await clickExactText(page, 'START', platform);
  await page.waitForTimeout(700);
  await shot(page, `${platform}-02-draft`);
  await auditScreen(page, 'draft', platform);

  // Pick the FIRST card in every draft row — deterministic (same seed=1 the
  // browser's pendingSeed defaults to), computed independently here so the
  // click targets an EXACT text the scene actually rendered. Desktop shows
  // all 4 rows at once; mobile shows one set at a time (NEXT between sets).
  const draft = rollStartDraft(1);
  for (let i = 0; i < DRAFT_SET_KEYS.length; i++) {
    const key = DRAFT_SET_KEYS[i]!;
    const card = draft[key][0];
    const name = card ? skillBook[card.skillId]?.name : undefined;
    if (name) { await clickExactText(page, name, platform); await page.waitForTimeout(150); }
    if (!desktop && i < DRAFT_SET_KEYS.length - 1) { await clickExactText(page, 'NEXT', platform); await page.waitForTimeout(150); }
  }
  await clickExactText(page, 'START', platform);
  await page.waitForTimeout(700);

  // ---- 3. Map, active run ----
  await shot(page, `${platform}-03-map-active`);
  await auditScreen(page, 'map-active', platform, REQUIRED_STATS.filter(Boolean));

  // ---- 4. Pick the first available node -> Prep / Shop / Event ----
  const picked = await clickPrefixText(page, ['FIGHT', 'SHOP', 'EVENT', 'BOSS'], platform);
  await page.waitForTimeout(700);
  const landedOn = await activeSceneKey(page);
  await shot(page, `${platform}-04-node-${landedOn}`);
  await auditScreen(page, `node-${landedOn}`, platform, REQUIRED_STATS.filter(Boolean));
  console.log(`[${platform}] picked "${picked}" -> landed on scene "${landedOn}"`);

  // ---- 5. DECK / BAG (secondary HUD slot) ----
  const deckLabel = desktop ? 'DECK / BAG' : 'DECK/BAG';
  const wentToDeck = await clickExactText(page, deckLabel, platform);
  if (wentToDeck) {
    await page.waitForTimeout(700);
    await shot(page, `${platform}-05-deck`);
    await auditScreen(page, 'deck', platform, REQUIRED_STATS.filter(Boolean));
    await clickExactText(page, '‹ MAP', platform);
    await page.waitForTimeout(700);
  }

  // ---- 6. RETIRE (tertiary HUD slot) -> confirm -> end summary ----
  await clickExactText(page, 'RETIRE', platform);
  await page.waitForTimeout(400);
  await shot(page, `${platform}-06-retire-confirm`);
  await auditScreen(page, 'retire-confirm', platform);
  await clickExactText(page, 'RETIRE', platform); // last match = the dialog's red button
  await page.waitForTimeout(700);
  await shot(page, `${platform}-07-end-summary`);
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
