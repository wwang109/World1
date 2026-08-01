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
import { chromium, type Page } from 'playwright';
import { rollStartDraft, DRAFT_SET_KEYS } from '../src/run/draft';
import { skillBook } from '../src/data/skills';
import { runScreenTemplate } from '../src/game/ui/runScreenTemplate';

const BASE = process.env.WORLD1_DEV_URL ?? 'http://localhost:5173';
const OUT_DIR = process.argv[2] ?? '.';
const CHROMIUM_PATH = process.env.PW_CHROMIUM
  || 'C:/Users/wenwa/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe';

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

async function clickExactText(page: Page, label: string): Promise<boolean> {
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
  if (!hit) return false;
  const canvas = page.locator('canvas');
  const box = await canvas.boundingBox();
  if (!box) return false;
  const dw = width || box.width;
  const dh = height || box.height;
  await page.mouse.click(box.x + (hit.x / dw) * box.width, box.y + (hit.y / dh) * box.height);
  return true;
}

async function clickPrefixText(page: Page, prefixes: string[]): Promise<string | null> {
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
  if (!found) return null;
  await clickExactText(page, (found as { text: string }).text);
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
  await clickExactText(page, 'START');
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
    if (name) { await clickExactText(page, name); await page.waitForTimeout(150); }
    if (!desktop && i < DRAFT_SET_KEYS.length - 1) { await clickExactText(page, 'NEXT'); await page.waitForTimeout(150); }
  }
  await clickExactText(page, 'START');
  await page.waitForTimeout(700);

  // ---- 3. Map, active run ----
  await shot(page, `${platform}-03-map-active`);
  await auditScreen(page, 'map-active', platform, REQUIRED_STATS.filter(Boolean));

  // ---- 4. Pick the first available node -> Prep / Shop / Event ----
  const picked = await clickPrefixText(page, ['FIGHT', 'SHOP', 'EVENT', 'BOSS']);
  await page.waitForTimeout(700);
  const landedOn = await activeSceneKey(page);
  await shot(page, `${platform}-04-node-${landedOn}`);
  await auditScreen(page, `node-${landedOn}`, platform, REQUIRED_STATS.filter(Boolean));
  console.log(`[${platform}] picked "${picked}" -> landed on scene "${landedOn}"`);

  // ---- 5. DECK / BAG (secondary HUD slot) ----
  const deckLabel = desktop ? 'DECK / BAG' : 'DECK/BAG';
  const wentToDeck = await clickExactText(page, deckLabel);
  if (wentToDeck) {
    await page.waitForTimeout(700);
    await shot(page, `${platform}-05-deck`);
    await auditScreen(page, 'deck', platform, REQUIRED_STATS.filter(Boolean));
    await clickExactText(page, '‹ MAP');
    await page.waitForTimeout(700);
  }

  // ---- 6. RETIRE (tertiary HUD slot) -> confirm -> end summary ----
  await clickExactText(page, 'RETIRE');
  await page.waitForTimeout(400);
  await shot(page, `${platform}-06-retire-confirm`);
  await auditScreen(page, 'retire-confirm', platform);
  await clickExactText(page, 'RETIRE'); // last match = the dialog's red button
  await page.waitForTimeout(700);
  await shot(page, `${platform}-07-end-summary`);
  await auditScreen(page, 'end-summary', platform);
}

async function main(): Promise<void> {
  const browser = await chromium.launch({
    executablePath: CHROMIUM_PATH,
    args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--disable-gpu-sandbox', '--no-sandbox'],
  });
  for (const platform of ['desktop', 'mobile'] as Platform[]) {
    const page = await browser.newPage({ viewport: VIEWPORTS[platform] });
    page.on('pageerror', (err) => console.error(`[${platform}] page error:`, err));
    try {
      await runPlatform(page, platform);
    } catch (err) {
      console.error(`[${platform}] audit run threw:`, err);
    }
    await page.close();
  }
  await browser.close();

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
  console.log(`\nrunScreenTemplate desktop content region:`, runScreenTemplate('desktop').regions.content);
  console.log(`\nTotal screens audited: ${violations.length}. Total violations: ${bad}.`);
  process.exit(bad > 0 ? 1 : 0);
}

void main();
