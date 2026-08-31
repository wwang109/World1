/**
 * Shop smoke — on-demand Playwright interaction coverage for the shop scenes
 * (`DesktopShopScene`/`MobileShopScene`), which had ZERO automated coverage
 * before this script: the gem-row input rework (shelfGem routed through the
 * unified `draggables` system with a viewport gate — see `DesktopShopScene`'s
 * `DragSource.shelfGem` doc comment) and the LEAVE SHOP regression fix were
 * both verified only by one manual Playwright session.
 *
 * Same mold as `scripts/run-hud-audit.ts`: same Chromium resolution via
 * `PW_CHROMIUM`/`PLAYWRIGHT_BROWSERS_PATH`, same named-step hard-failure
 * discipline — a step whose target isn't on screen, or whose postcondition
 * doesn't hold, fails LOUDLY by that step's own name. Never silently no-ops.
 *
 * What this proves, per viewport (1440x900, 412x892):
 *   1. Reach a shop in RUN MODE (gold is a real, finite number there — the
 *      Sandbox route `?scene=desktop-shop` has `GOLD UNLIMITED` and can't
 *      exercise "gold decreased by the shown price"). Route used: the SAME
 *      map deep-link `run-hud-audit.ts` uses (`?scene=desktop-runmap` /
 *      `?scene=mrunmap`) → START RUN → draft → walk the map, preferring a
 *      SHOP node over FIGHT/EVENT, retrying with a fresh page (new random
 *      run seed — `runStore.ts`'s `pendingSeed` re-rolls on every full
 *      navigation) if a run never turns one up or ends in DEFEAT.
 *   2. Tap an IN-VIEWPORT gem row → the detail/BUY dock opens (named-step
 *      assert on the dock's own BUY/NEED text appearing). Scrolls the shelf
 *      first if no gem row starts inside the visible masked viewport, so
 *      this always taps a genuinely on-screen row, never one hanging off
 *      the mask by its unclipped hit box.
 *   3. Buy it if affordable — assert gold dropped by EXACTLY the shown price.
 *   4. REROLL twice — assert the label escalates 1G→2G and the gold reading
 *      matches (previous gold minus the cost just paid) after each.
 *   5. LEAVE SHOP — assert the active scene actually changed away from the
 *      shop (the exact regression this script exists to guard).
 *
 * Usage: `npx tsx scripts/shop-smoke.ts [outDir]`
 * Requires the Vite dev server (`npm run dev`) and the battle API
 * (`npm run api`) — neither is started by this script.
 */
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type Page } from 'playwright';
import { pinPageAgainstHmr } from './pageHarness';
import { collectSceneTexts as collectTexts, type TextBound } from './sceneText';
import { rollStartDraft, DRAFT_SET_KEYS } from '../src/run/draft';
import { skillBook } from '../src/data/skills';
import { gemBook } from '../src/data/gems';
import { eventCatalog } from '../src/data/events';

const BASE = process.env.WORLD1_DEV_URL ?? 'http://localhost:5173';
const OUT_DIR = process.argv[2] ?? '.';

/** Same resolution strategy as `scripts/run-hud-audit.ts` — see that file's
 * doc comment for the full rationale (manifest/unpacked-revision mismatch). */
function resolveChromiumPath(): string {
  if (process.env.PW_CHROMIUM) return process.env.PW_CHROMIUM;
  const isWin = process.platform === 'win32';
  const exeName = isWin ? 'chrome.exe' : 'chrome';
  const platformDirs = isWin ? ['chrome-win64', 'chrome-win'] : ['chrome-linux'];
  function scan(browsersPath: string): string | null {
    const symlink = join(browsersPath, 'chromium');
    if (existsSync(symlink)) return symlink;
    let entries: string[];
    try { entries = readdirSync(browsersPath); } catch { return null; }
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
  if (browsersPath) { const found = scan(browsersPath); if (found) return found; }
  if (isWin) {
    const winDefault = 'C:/Users/wenwa/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe';
    if (existsSync(winDefault)) return winDefault;
  } else {
    const home = process.env.HOME ?? '';
    const found = home ? scan(join(home, '.cache', 'ms-playwright')) : null;
    if (found) return found;
  }
  throw new Error(
    'shop-smoke: could not resolve a Chromium executable. Set PW_CHROMIUM to an explicit ' +
    'binary path, or PLAYWRIGHT_BROWSERS_PATH to a Playwright browsers cache dir containing a ' +
    "chromium-* build (see docs/ui-workbook.md's Screenshot capture recipe).",
  );
}

type Platform = 'desktop' | 'mobile';
const VIEWPORTS: Record<Platform, { width: number; height: number }> = {
  desktop: { width: 1440, height: 900 },
  mobile: { width: 412, height: 892 },
};
const MAP_SCENE: Record<Platform, string> = { desktop: 'desktop-runmap', mobile: 'mrunmap' };
const MAP_SCENE_KEY: Record<Platform, string> = { desktop: 'DesktopRunMap', mobile: 'MobileRunMap' };
const SHOP_SCENE_KEY: Record<Platform, string> = { desktop: 'DesktopShop', mobile: 'MobileShop' };
const DRAFT_SCENE: Record<Platform, string> = { desktop: 'DesktopDraft', mobile: 'MobileDraft' };

/** Every named-step failure — the ONLY thing that flips the exit code. Each
 * entry names exactly which step failed and why, per the brief's "fails BY
 * NAME, never silently" requirement. */
const hardFailures: string[] = [];
const passed: string[] = [];

function fail(platform: Platform, step: string, why: string): void {
  hardFailures.push(`[${platform}] step "${step}": ${why}`);
}
function pass(platform: Platform, step: string): void {
  passed.push(`[${platform}] ${step}`);
  console.log(`  [${platform}] OK — ${step}`);
}

/** Reconstructs the HUD's label/value stat pair (`GOLD`/`G` + the NEXT text
 * strictly to its right on the same row) — the run HUD draws them as separate
 * sibling Text nodes (`ui/statRunModel.ts` builds the run,
 * `ui/statRunStrip.ts#renderStatRun` draws it), never one "GOLD 7" string, on
 * both platforms (desktop: 'GOLD', mobile compact: 'G'). Returns null (not a
 * guess) if unreadable, so a caller can hard-fail the step instead of silently
 * comparing against garbage.
 *
 * TWO THINGS THE STAT-RUN RENDERER CHANGED, and why this reads the way it does
 * now. (1) The halves no longer share a `y`: a 9px label beside a 13px value is
 * BOTTOM-ALIGNED, so `y` differs by a few px while `y + height` is identical —
 * same-row is therefore tested on the bottom edge, which is the baseline a
 * reader actually sees. (2) The value carries a LEADING SPACE (' 137'), which
 * is how the renderer owns the gap between the two halves — so the figure is
 * trimmed before it is parsed. Both of these silently returned null before
 * they were handled, which would have hard-failed every gold assertion here. */
function readGold(texts: TextBound[]): number | null {
  const label = texts.find((t) => t.text === 'GOLD ' || t.text === 'GOLD' || t.text === 'G');
  if (!label) return null;
  const bottom = (t: TextBound): number => t.y + t.height;
  const sameRow = texts.filter((t) => t !== label && Math.abs(bottom(t) - bottom(label)) <= 3 && t.x > label.x);
  sameRow.sort((a, b) => a.x - b.x);
  const value = sameRow[0];
  if (value && /^\d+$/.test(value.text.trim())) return Number(value.text.trim());
  return null;
}

async function readPendingSeed(page: Page): Promise<number | null> {
  const texts = await collectTexts(page);
  for (const t of texts) {
    const m = /^seed (\d+)/.exec(t.text);
    if (m) return Number(m[1]);
  }
  return null;
}

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
  if (!hit) { fail(platform, step, `no visible text "${label}" to click`); return false; }
  const canvas = page.locator('canvas');
  const box = await canvas.boundingBox();
  if (!box) { fail(platform, step, 'canvas has no bounding box — nothing was clickable'); return false; }
  const dw = width || box.width;
  const dh = height || box.height;
  await page.mouse.click(box.x + (hit.x / dw) * box.width, box.y + (hit.y / dh) * box.height);
  return true;
}

/**
 * Clicks the Nth occurrence (0-indexed, sorted top-to-bottom then
 * left-to-right) of `label` among ALL currently-visible matches, instead of
 * `clickExactText`'s "whichever one the DOM-order tiebreak resolves to."
 *
 * Desktop's draft renders all 4 rows (offense/defense/support/wildcard)
 * SIMULTANEOUSLY, and the 4 row pools can genuinely roll the same skill name
 * into two different rows (real repro: seed rolled "Warded Reprisal" into
 * both `defense` and a later row) — plain name-matching then has no way to
 * tell which row's copy a click was meant to land on, and can silently pick
 * the WRONG row (or re-toggle an already-picked one off), leaving the
 * intended row's pick counter stuck. Since rows stack top-to-bottom in
 * `DRAFT_SET_KEYS` order, and this loop processes rows in that SAME order,
 * "the occurrence index equal to how many times this name has already been
 * clicked this draft" always resolves to the CURRENT row's copy, regardless
 * of how many other rows also happen to roll the same name.
 */
async function clickNthText(page: Page, label: string, occurrence: number, platform: Platform, step: string): Promise<boolean> {
  const { width, height } = await page.evaluate(() => ({ width: (window as any).__gameDesignWidth, height: (window as any).__gameDesignHeight }));
  const texts = await collectTexts(page);
  const matches = texts.filter((t) => t.text === label).sort((a, b) => (a.y - b.y) || (a.x - b.x));
  const target = matches[occurrence];
  if (!target) { fail(platform, step, `no visible text "${label}" at occurrence index ${occurrence} (found ${matches.length} total)`); return false; }
  const canvas = page.locator('canvas');
  const box = await canvas.boundingBox();
  if (!box) { fail(platform, step, 'canvas has no bounding box — nothing was clickable'); return false; }
  const dw = width || box.width;
  const dh = height || box.height;
  const cx = target.x + target.width / 2;
  const cy = target.y + target.height / 2;
  await page.mouse.click(box.x + (cx / dw) * box.width, box.y + (cy / dh) * box.height);
  return true;
}

async function clickMatchingText(
  page: Page, platform: Platform, step: string,
  predicate: (text: string) => boolean, describe: string,
): Promise<string | null> {
  const texts = await collectTexts(page);
  const match = texts.find((t) => predicate(t.text));
  if (!match) { fail(platform, step, `no visible text matching ${describe} — could not advance`); return null; }
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

async function waitUntil(page: Page, predicate: () => Promise<boolean>, timeoutMs: number): Promise<boolean> {
  const start = Date.now();
  for (;;) {
    if (await predicate()) return true;
    if (Date.now() - start >= timeoutMs) return false;
    await page.waitForTimeout(200);
  }
}

async function waitForText(
  page: Page, platform: Platform, step: string,
  predicate: (text: string) => boolean, describe: string, timeoutMs = 30_000,
): Promise<boolean> {
  const ok = await waitUntil(page, async () => (await collectTexts(page)).some((t) => predicate(t.text)), timeoutMs);
  if (!ok) fail(platform, step, `no text matching ${describe} appeared within ${timeoutMs}ms`);
  return ok;
}

async function waitForSceneChange(page: Page, platform: Platform, step: string, awayFrom: string[], timeoutMs = 15_000): Promise<string> {
  await waitUntil(page, async () => !awayFrom.includes(await activeSceneKey(page)), timeoutMs);
  const landed = await activeSceneKey(page);
  if (awayFrom.includes(landed)) {
    fail(platform, step, `scene is still "${landed}" ${timeoutMs}ms later — the click had no effect`);
  }
  return landed;
}

async function shot(page: Page, name: string, platform: Platform): Promise<void> {
  await page.screenshot({ path: `${OUT_DIR}/${platform}-${name}.png` });
}

/**
 * Reads the shop scene's OWN `shelfViewport` field straight off the live
 * instance (private is TS-only — the field exists at runtime) instead of
 * guessing "anywhere within the canvas." This is the real gate `wireDrag`'s
 * pointerdown handler applies to `shelfGem`/`shelfCard` — a gem whose TEXT
 * happens to sit inside the full canvas bounds but past the masked shelf
 * viewport's bottom edge (e.g. overlapping the reserved BOARD/BAG band on
 * mobile, which sits BELOW the shelf, not beside it as on desktop) is NOT
 * actually clickable, and asserting against the wrong boundary here is
 * exactly the kind of false pass this script exists to avoid.
 */
async function getShelfViewport(page: Page): Promise<{ x: number; y: number; width: number; height: number } | null> {
  return page.evaluate(() => {
    const game = (window as any).__game;
    const scene = game.scene.scenes.find((s: any) => s.sys.isActive() && (s.sys.settings.key === 'DesktopShop' || s.sys.settings.key === 'MobileShop'));
    const v = scene?.shelfViewport;
    return v && v.width > 0 && v.height > 0 ? { x: v.x, y: v.y, width: v.width, height: v.height } : null;
  });
}

function insideViewport(t: TextBound, v: { x: number; y: number; width: number; height: number }): boolean {
  return t.y >= v.y - 1 && t.y + t.height <= v.y + v.height + 1 && t.x >= v.x - 1 && t.x + t.width <= v.x + v.width + 1;
}

/**
 * Scrolls the shelf DIRECTLY to whatever offset brings the topmost gem row
 * fully inside the masked viewport, then applies the exact same assignment
 * the real scroll-wheel handler makes (`this.shelfScrollY = clamp(...);
 * container.setY(...); this.syncShelfScrollAffordance()` — see
 * `DesktopShopScene`'s `wheel` listener) — this is NOT a shortcut around the
 * real behavior, it IS the real behavior, just driven directly instead of
 * through emulated wheel-delta timing (which proved unreliable here: on a
 * real run-mode shop, `page.mouse.wheel` sometimes never nudged
 * `shelfContainer`'s y at all, most likely because Playwright's synthetic
 * wheel events don't reliably hit a canvas-only Phaser input listener at an
 * unmoved default pointer position — repro left in
 * `/tmp/.../scratchpad/debug-mobile-shop2.ts`, where the SAME sandbox-route
 * scroll worked fine, so this is route-sensitive timing, not a product bug).
 * Returns the gem's name once it's genuinely inside the viewport, or null if
 * the shop has no gem offers to find at all.
 */
async function scrollTopmostGemIntoView(page: Page, gemNames: string[]): Promise<string | null> {
  return page.evaluate((names: string[]) => {
    const nameSet = new Set(names);
    const game = (window as any).__game;
    const scene = game.scene.scenes.find((s: any) => s.sys.isActive() && (s.sys.settings.key === 'DesktopShop' || s.sys.settings.key === 'MobileShop'));
    const container = scene?.shelfContainer;
    const viewport = scene?.shelfViewport;
    if (!scene || !container || !viewport) return null;
    const gemTexts = (container.list as any[]).filter((o) => o.type === 'Text' && nameSet.has(o.text));
    if (gemTexts.length === 0) return null;
    // Local (unscrolled) y is the object's OWN `.y` inside the container —
    // topmost by that, not by current (possibly-already-scrolled) world y.
    gemTexts.sort((a, b) => a.y - b.y);
    const target = gemTexts[0];
    const maxScroll = scene.shelfMaxScroll ?? 0;
    const desired = Math.max(-maxScroll, Math.min(0, viewport.y - target.y));
    scene.shelfScrollY = desired;
    container.setY(desired);
    if (typeof scene.syncShelfScrollAffordance === 'function') scene.syncShelfScrollAffordance();
    return target.text as string;
  }, gemNames);
}

// ---------------------------------------------------------------------------
// Minimal FIGHT/EVENT handling — just enough to ADVANCE the map toward a
// shop node; not a battle/event audit (that's `run-hud-audit.ts`/manual QA's
// job). Best-effort: an unresolved fight/event is a hard failure by name
// (this script can't claim to have reached a shop "on the level" if the
// walkthrough silently got stuck en route).
// ---------------------------------------------------------------------------

/**
 * Best-effort speed-up. Desktop shows 3 ALWAYS-present fixed buttons
 * ('×½'/'×1'/'×2', `DesktopBattleScene`) — clicking '×2' is idempotent
 * regardless of current speed. Mobile has ONE toggle button whose label IS
 * the current multiplier and that CYCLES ×1 → ×2 → ×½ → ×1
 * (`MobileBattleScene`), and — because `speedMult` is a plain class field
 * with no `init()` reset — it carries over from whatever fight ran before
 * it in the SAME run. Blindly clicking "×1 or ×2, whichever is on screen"
 * (this script's first cut) hits that toggle on ALREADY-×2 fights too,
 * silently demoting it to the SLOWEST ×½ setting and turning an ordinary
 * fight into a 60s+ timeout — this instead reads the CURRENT label first and
 * clicks only enough times to reach ×2, never past it.
 */
async function speedUpBattle(page: Page, platform: Platform, prefix: string): Promise<void> {
  if (platform === 'desktop') {
    const hasSpeedButtons = (await collectTexts(page)).some((t) => t.text === '×2');
    if (hasSpeedButtons) await clickExactText(page, '×2', platform, `${prefix} -> speed up to ×2 (best effort)`);
    return;
  }
  for (let i = 0; i < 2; i++) {
    const current = (await collectTexts(page)).find((t) => t.text === '×1' || t.text === '×2' || t.text === '×½');
    if (!current || current.text === '×2') return; // absent, or already fastest
    await clickExactText(page, current.text, platform, `${prefix} -> speed up from ${current.text} (best effort)`);
    await page.waitForTimeout(100);
  }
}

async function handleFight(page: Page, platform: Platform, prefix: string): Promise<boolean> {
  const clicked = await clickExactText(page, 'FIGHT', platform, `${prefix} -> FIGHT`);
  if (!clicked) return false;
  const landed = await waitForSceneChange(page, platform, `${prefix} -> FIGHT transition`, ['DesktopRunPrep', 'MobileRunPrep']);
  if (!landed.includes('Battle')) { fail(platform, `${prefix} -> FIGHT transition`, `did not land on a battle scene, got "${landed}"`); return false; }
  await speedUpBattle(page, platform, prefix);
  const resolved = await waitForText(page, platform, `${prefix} -> battle resolves`, (t) => t === 'VICTORY' || t === 'DEFEAT', '"VICTORY"/"DEFEAT"', 90_000);
  if (!resolved) return false;
  // Retry the CONTINUE click — observed occasionally landing with no effect
  // (scene still on the battle screen seconds later) despite the button
  // being found and clicked. INVESTIGATED (task #62, 2026-08-19): confirmed
  // HARNESS-ONLY, not a `DesktopBattleScene`/`MobileBattleScene` bug —
  // `footerButtons` always includes CONTINUE with no precondition/debounce
  // once `getBattleContext() === 'run'`, and its `.on('pointerdown', ...)` is
  // wired synchronously in the SAME `render()` call that draws the button
  // (checked both platforms; no async gap between "text visible" and
  // "listener attached").
  //   Root cause is this SANDBOX's forced software rendering: both this
  // script and `run-hud-audit.ts` launch Chromium with
  // `--use-angle=swiftshader` (no real GPU here), and a direct measurement
  // (`game.loop.actualFps` + a raw `requestAnimationFrame` counter) during a
  // real run showed the game loop at ~5-30 fps against Phaser's 60fps
  // target — an environment-specific 2-12x slowdown, confirmed by the
  // "GPU stall due to ReadPixels" warnings Chromium logs to the page console
  // here. Phaser defers a dispatched pointer event's HIT-TEST to its own next
  // game step rather than processing it synchronously with the DOM event; at
  // this frame rate that step can be 150-200ms+ away, wide enough for an
  // UNRELATED action already in flight (e.g. the previous card pick's own
  // `rerender()`, or this same fight's floating-number/tween churn) to
  // destroy-and-recreate the display list before the queued click is finally
  // hit-tested, leaving it with nothing to land on. Two things this is NOT:
  // (a) a spurious `Scale.Events.RESIZE` → `relayoutScene` → `rebuildScene`
  // race (`src/game/renderScale.ts`) — logged every RESIZE event across
  // dozens of retries reproduced this way and NONE fired at the retry point;
  // (b) a Playwright-synthetic-event artifact — the SAME click mechanism
  // against the SAME buttons via the SAME production route reproduced ZERO
  // no-effect clicks (0/220+) in short, lightly-loaded sessions, and only
  // showed up once a longer session (many real battle-service fights, heavy
  // WebGL/tween load) was already driving the frame rate down. A real
  // player's device — even a slow phone — clears Phaser's 60fps budget by
  // 10-30x more headroom than this sandbox's software renderer, which is why
  // this reads as "occasional" for a live player but reproduces at up to
  // 100% here under load. Re-clicking with a fresh coordinate lookup each
  // attempt is a good compensating control for that: nothing to fix in the
  // scenes themselves.
  for (let attempt = 1; attempt <= 3; attempt++) {
    await clickMatchingText(page, platform, `${prefix} -> CONTINUE (attempt ${attempt})`, (t) => t.startsWith('CONTINUE'), '"CONTINUE ›"');
    const left = await waitUntil(page, async () => !['DesktopBattle', 'MobileBattle'].includes(await activeSceneKey(page)), attempt < 3 ? 4000 : 10000);
    if (left) return true;
  }
  fail(platform, `${prefix} -> CONTINUE transition`, 'scene is still on the battle screen after 3 click attempts');
  return false;
}

/** Reads the story title straight off the screen and looks it up in the SAME
 * `eventCatalog` the scene renders from (the `run-smoke.ts` idiom) — clicking
 * "whatever uppercase text looks like a choice" is exactly the fragile guess
 * that misfired here on the first pass (it clicked event flavor-text, not a
 * real choice, and the walkthrough silently stalled with no CONTINUE ever
 * appearing). The catalog's own choice labels are the only reliable source
 * of "what is actually clickable here." */
async function handleEvent(page: Page, platform: Platform, prefix: string): Promise<boolean> {
  await page.waitForTimeout(300);
  const texts = await collectTexts(page);
  const titleHit = texts.find((t) => Object.values(eventCatalog).some((e) => e.title === t.text));
  const eventDef = titleHit ? Object.values(eventCatalog).find((e) => e.title === titleHit.text) : undefined;
  if (!eventDef) { fail(platform, `${prefix} -> read event title`, `on-screen title "${titleHit?.text ?? '(none found)'}" does not match any catalog event`); return false; }
  // Prefer the FREE choice — this detour exists only to ADVANCE the map
  // toward a shop, and the shop assertions downstream need real gold left in
  // the wallet (a paid choice here starved an earlier pass down to 1 gold,
  // just enough to buy one gem and then fail the very first REROLL as
  // unaffordable, which is a test-harness gap, not a product bug).
  const free = eventDef.choices.find((c) => (c.cost ?? 0) === 0);
  const pickLabel = (free ?? eventDef.choices[0])?.label;
  if (!pickLabel) { fail(platform, `${prefix} -> pick a choice`, `event "${eventDef.title}" has no choices to pick`); return false; }
  // Retried against a real POSTCONDITION, not a fixed sleep. Both run-event
  // scenes only draw CONTINUE › once `phase === 'outcome' && outcome` (or
  // 'resolved') — see `DesktopRunEventScene.renderHud` — so a choice click that
  // silently misses (the harness flake documented on `handleFight`'s CONTINUE
  // retry, task #62) leaves the scene in `choosing` with no CONTINUE at all,
  // and the failure surfaces one step later as the inscrutable "no visible text
  // matching CONTINUE ›". Observed repeatedly on DESKTOP on 2026-08-31 while
  // mobile passed 6/6 in the same runs: this was the last un-retried click in
  // the script. Re-clicking is safe — once the choice resolves its label is
  // gone from the scene, so a retry can only ever land while still choosing.
  const mark = hardFailures.length;
  let resolved = false;
  for (let attempt = 1; attempt <= 3 && !resolved; attempt++) {
    await clickExactText(page, pickLabel, platform, `${prefix} -> choose "${pickLabel}" (attempt ${attempt})`);
    resolved = await waitUntil(page, async () => (await collectTexts(page)).some((t) =>
      t.text.startsWith('CONTINUE') || /CHOOSE A CARD|CHOOSE A GEM|UPGRADE A CARD|PICK ONE/i.test(t.text)),
      attempt < 3 ? 2500 : 6000);
  }
  // Removes ONLY entries naming an attempt, so an unrelated `page error`
  // pushed asynchronously during the retry window survives the rollback.
  hardFailures.splice(mark, hardFailures.length - mark, ...hardFailures.slice(mark).filter((f) => !f.includes('(attempt ')));
  if (!resolved) { fail(platform, `${prefix} -> choose "${pickLabel}"`, 'the choice never resolved (no CONTINUE and no reward picker) after 3 attempts'); return false; }
  const after = await collectTexts(page);
  const isPicker = after.some((t) => /CHOOSE A CARD|CHOOSE A GEM|UPGRADE A CARD|PICK ONE/i.test(t.text));
  if (isPicker) {
    const rewardPick = after.find((t) => Object.values(skillBook).some((s) => s.name === t.text)) ?? after.find((t) => Object.values(gemBook).some((g) => g.name === t.text));
    if (rewardPick) {
      // Same postcondition as the choice above — the reward pick is what moves
      // the scene into `outcome`, and CONTINUE only exists after that.
      const pickMark = hardFailures.length;
      let picked = false;
      for (let attempt = 1; attempt <= 3 && !picked; attempt++) {
        await clickExactText(page, rewardPick.text, platform, `${prefix} -> pick reward "${rewardPick.text}" (attempt ${attempt})`);
        picked = await waitUntil(page, async () => (await collectTexts(page)).some((t) => t.text.startsWith('CONTINUE')), attempt < 3 ? 2500 : 6000);
      }
      // Removes ONLY entries naming an attempt, so an unrelated `page error`
      // pushed asynchronously during the retry window survives the rollback.
      hardFailures.splice(pickMark, hardFailures.length - pickMark, ...hardFailures.slice(pickMark).filter((f) => !f.includes('(attempt ')));
      if (!picked) { fail(platform, `${prefix} -> pick reward "${rewardPick.text}"`, 'CONTINUE never appeared after 3 attempts'); return false; }
    }
  }
  // CONTINUE gets the retry every other scene-changing click in this script
  // has (task #62) — its target text is confirmed present a moment earlier, so
  // a single no-effect click here would fail a step that is not broken.
  const contMark = hardFailures.length;
  let left = false;
  for (let attempt = 1; attempt <= 3 && !left; attempt++) {
    await clickMatchingText(page, platform, `${prefix} -> CONTINUE (attempt ${attempt})`, (t) => t.startsWith('CONTINUE'), '"CONTINUE ›"');
    left = await waitUntil(page, async () => !['DesktopRunEvent', 'MobileRunEvent'].includes(await activeSceneKey(page)), attempt < 3 ? 3000 : 8000);
  }
  // Removes ONLY entries naming an attempt, so an unrelated `page error`
  // pushed asynchronously during the retry window survives the rollback.
  hardFailures.splice(contMark, hardFailures.length - contMark, ...hardFailures.slice(contMark).filter((f) => !f.includes('(attempt ')));
  if (!left) { fail(platform, `${prefix} -> CONTINUE`, 'the event scene never closed after 3 click attempts'); return false; }
  return true;
}

/** Walks the map, preferring a SHOP node every stop, advancing via FIGHT/EVENT
 * otherwise. Returns true once a shop is actually entered (active scene is
 * the shop scene) — false if the run ends in DEFEAT or exhausts MAX_STOPS,
 * either of which is NOT itself a hard failure (the caller retries with a
 * fresh page/seed; only running out of retries is). */
async function walkToShop(page: Page, platform: Platform): Promise<boolean> {
  const MAX_STOPS = 20;
  // A fresh run starts at 0 gold (`runState.ts`'s initial state) — rushing
  // straight into the FIRST shop seen (this script's first cut) reaches one
  // with nothing to spend, which can't exercise "buy something" or "REROLL
  // twice, gold matches" at all. EASY fights are the gold source, so this
  // banks at least 2 of them before a SHOP choice becomes acceptable — still
  // capped by MAX_STOPS, and a SHOP is taken unconditionally once stops start
  // running out, so a genuinely shop-poor map doesn't strand this in FIGHT
  // nodes forever.
  let fightsCompleted = 0;
  const MIN_FIGHTS_BEFORE_SHOP = 2;
  for (let stop = 1; stop <= MAX_STOPS; stop++) {
    const mapTexts = await collectTexts(page);
    const kinds: Array<{ kind: string; text: string }> = [];
    for (const t of mapTexts) {
      for (const k of ['FIGHT', 'SHOP', 'EVENT', 'BOSS']) {
        if (t.text === k || t.text.startsWith(`${k} ·`)) kinds.push({ kind: k, text: t.text });
      }
    }
    if (kinds.length === 0) return false; // stuck / map exhausted — let the caller retry
    const shopChoice = kinds.find((k) => k.kind === 'SHOP');
    const easyFight = kinds.find((k) => k.kind === 'FIGHT' && /EASY/.test(k.text));
    const nearlyOutOfStops = stop >= MAX_STOPS - 2;
    const takeShop = shopChoice && (fightsCompleted >= MIN_FIGHTS_BEFORE_SHOP || nearlyOutOfStops);
    const choice = takeShop ? shopChoice! : easyFight ?? kinds.find((k) => k.kind === 'FIGHT') ?? kinds.find((k) => k.kind === 'EVENT') ?? shopChoice ?? kinds[0]!;
    console.log(`  [${platform}] stop ${stop}: options = [${kinds.map((k) => k.text).join(', ')}] -> picking "${choice.text}" (fightsCompleted=${fightsCompleted})`);
    await clickExactText(page, choice.text, platform, `stop ${stop} -> pick "${choice.text}"`);
    const landed = await waitForSceneChange(page, platform, `stop ${stop} -> node transition`, [MAP_SCENE_KEY[platform]]);
    if (landed === SHOP_SCENE_KEY[platform]) return true; // reached — hand off to the shop assertions
    if (landed.includes('RunPrep')) {
      if (!(await handleFight(page, platform, `s${stop}-fight`))) return false;
      fightsCompleted += 1;
    }
    else if (landed.includes('RunEvent')) { if (!(await handleEvent(page, platform, `s${stop}-event`))) return false; }
    else { fail(platform, `stop ${stop} -> node transition`, `picked "${choice.text}" but landed on unexpected scene "${landed}"`); return false; }
    // Back on the map (or a DEFEAT banner re-rendering the same scene key).
    await waitForSceneChange(page, platform, `stop ${stop} -> back to map`, [landed]).catch(() => {});
    const postTexts = await collectTexts(page);
    if (postTexts.some((t) => t.text === 'DEFEAT')) { console.log(`  [${platform}] run ended in DEFEAT at stop ${stop} — retrying with a fresh run`); return false; }
    const back = await activeSceneKey(page);
    if (!back.includes('RunMap')) return false;
  }
  return false;
}

/** Runs draft → returns once the map is active. Throws (not a soft anomaly)
 * on anything that means the draft itself is broken — a shop assertion built
 * on top of a broken draft would be meaningless. */
async function runDraft(page: Page, platform: Platform): Promise<void> {
  const { width, height } = VIEWPORTS[platform];
  await page.goto(`${BASE}/?ui=${platform}&scene=${MAP_SCENE[platform]}`, { waitUntil: 'networkidle' });
  await page.evaluate(({ w, h }) => { (window as any).__gameDesignWidth = w; (window as any).__gameDesignHeight = h; }, { w: width, h: height });
  const loaded = await waitForText(page, platform, 'map-start -> loader finished', (t) => t.startsWith('START RUN') || t.startsWith('RESUME RUN'), 'START RUN/RESUME RUN', 30_000);
  if (!loaded) throw new Error('loader never finished');
  const seed = await readPendingSeed(page);
  if (seed === null) throw new Error('could not read the pre-run seed footnote');
  await clickMatchingText(page, platform, 'map-start -> START RUN', (t) => t.startsWith('START RUN') || t.startsWith('RESUME RUN'), '"START RUN"/"RESUME RUN"');
  await waitForSceneChange(page, platform, 'map-start -> START RUN transition', ['Start']);

  const desktop = platform === 'desktop';
  const draft = rollStartDraft(seed);
  const nameOccurrenceUsed = new Map<string, number>();
  for (let i = 0; i < DRAFT_SET_KEYS.length; i++) {
    const key = DRAFT_SET_KEYS[i]!;
    const card = draft[key][0];
    const name = card ? skillBook[card.skillId]?.name : undefined;
    if (name) {
      const occurrence = nameOccurrenceUsed.get(name) ?? 0;
      // Verify the pick counter actually advanced — a skill name that appears
      // in TWO rows this seed's draft rolled (same idiom `run-smoke.ts` guards
      // against) means "last match wins" text-clicking can land on the WRONG
      // row's copy and leave this row unpicked with no thrown error, which
      // then surfaces downstream as a generic, hard-to-diagnose "START did
      // nothing" — checking the counter here names the ACTUAL row that
      // failed. Retried up to 3x with a fresh coordinate lookup each time —
      // an occasional single click not registering (same shape, and same
      // confirmed harness-only root cause — see `handleFight`'s CONTINUE
      // retry comment, task #62) as the battle CONTINUE button — otherwise
      // misreports as "ambiguous duplicate name" when it's really just a
      // missed click.
      let progressed = false;
      for (let attempt = 1; attempt <= 3 && !progressed; attempt++) {
        await clickNthText(page, name, occurrence, platform, `draft -> pick ${key} (${name}, attempt ${attempt})`);
        // Lower-level `waitUntil` on the intermediate attempts (not
        // `waitForText`) — this loop's own final `throw` is the one named
        // failure that should surface; recording every RETRIED attempt as
        // its own hard failure would misreport a successful-on-attempt-2
        // pick as broken.
        progressed = await waitUntil(page, async () => (await collectTexts(page)).some((t) =>
          t.text.startsWith(`PICK ONE PER ROW · ${i + 1}/`) || t.text.startsWith(`${i + 1}/${DRAFT_SET_KEYS.length} PICKED`)),
          attempt < 3 ? 2000 : 5000);
      }
      nameOccurrenceUsed.set(name, occurrence + 1);
      if (!progressed) throw new Error(`draft pick "${name}" for row "${key}" did not advance the pick counter after 3 attempts`);
    }
    if (!desktop && i < DRAFT_SET_KEYS.length - 1) {
      // Wait for the NEXT row's own header ("DRAFT · SET N/4") rather than a
      // fixed sleep — mobile shows ONE row at a time, and proceeding before
      // the transition paints means the very next name-click below finds
      // ZERO matches (this row's cards genuinely aren't on screen yet),
      // which read like a missing-card bug rather than a timing gap. Retried
      // with a fresh click each time — the same occasional "clicked it, no
      // effect" flake seen on CONTINUE/START (confirmed harness-only, task
      // #62 — see `handleFight`'s CONTINUE retry comment), just hitting NEXT
      // this time.
      const nextSet = i + 2; // 1-based index of the row NEXT is advancing TO
      let advanced = false;
      for (let attempt = 1; attempt <= 3 && !advanced; attempt++) {
        await clickExactText(page, 'NEXT', platform, `draft -> NEXT (after ${key}, attempt ${attempt})`);
        advanced = await waitUntil(page, async () => (await collectTexts(page)).some((t) => t.text.startsWith(`DRAFT · SET ${nextSet}/`)), attempt < 3 ? 2000 : 5000);
      }
      if (!advanced) throw new Error(`draft -> NEXT (after ${key}) did not advance to SET ${nextSet} after 3 attempts`);
    }
  }
  // Retry the START click — the same occasional "found the text, clicked it,
  // scene didn't move" flake observed on the battle CONTINUE button
  // (confirmed harness-only, task #62 — see `handleFight`'s CONTINUE retry
  // comment), just hitting the draft's START button instead. Not a gating
  // issue (every row reported PICK ONE PER ROW · 4/4 before this point, and
  // `DesktopDraftScene`/`MobileDraftScene` only call `setInteractive()` on
  // START once `ready` — checked true here — with no separate debounce).
  let draftLanded = DRAFT_SCENE[platform];
  for (let attempt = 1; attempt <= 3 && draftLanded === DRAFT_SCENE[platform]; attempt++) {
    await clickExactText(page, 'START', platform, `draft -> START (attempt ${attempt})`);
    await waitUntil(page, async () => (await activeSceneKey(page)) !== DRAFT_SCENE[platform], attempt < 3 ? 4000 : 10000);
    draftLanded = await activeSceneKey(page);
  }
  if (draftLanded === DRAFT_SCENE[platform]) throw new Error('draft -> START did not leave the Draft scene after 3 attempts');
}

// ---------------------------------------------------------------------------
// The actual shop assertions this script exists for.
// ---------------------------------------------------------------------------

async function runShopAssertions(page: Page, platform: Platform): Promise<void> {
  await shot(page, '01-shop-shelf', platform);

  // ---- 1. tap an IN-VIEWPORT gem row -> detail/BUY dock opens ----
  const gemNameList = Object.values(gemBook).map((g) => g.name);
  const gemNames = new Set(gemNameList);
  let viewport = await getShelfViewport(page);
  if (!viewport) { fail(platform, 'shop -> read shelf viewport', 'shop scene has no shelfViewport (0-size or scene not found)'); return; }
  let texts = await collectTexts(page);
  let gemHit = texts.find((t) => gemNames.has(t.text) && insideViewport(t, viewport!));
  if (!gemHit) {
    // Not visible without scrolling — scroll the shelf DIRECTLY to the
    // topmost gem row's position (see `scrollTopmostGemIntoView`'s doc
    // comment for why this replaced an emulated-wheel loop) so this always
    // taps a GENUINELY on-screen row, never one hanging off the masked
    // viewport by its unclipped hit box.
    const scrolledName = await scrollTopmostGemIntoView(page, gemNameList);
    if (scrolledName) {
      await page.waitForTimeout(150);
      viewport = await getShelfViewport(page) ?? viewport;
      texts = await collectTexts(page);
      gemHit = texts.find((t) => t.text === scrolledName && insideViewport(t, viewport!));
    }
  }
  if (!gemHit) { fail(platform, 'shop -> find an in-viewport gem row', 'no gem offer name found inside the shelf viewport, even after scrolling directly to the topmost one'); return; }
  pass(platform, `found in-viewport gem row "${gemHit.text}"`);

  const goldBeforeGemTap = readGold(await collectTexts(page));
  await clickExactText(page, gemHit.text, platform, `shop -> tap gem row "${gemHit.text}"`);
  await page.waitForTimeout(250);
  await shot(page, '02-gem-dock', platform);
  const dockTexts = await collectTexts(page);
  const dockOpened = dockTexts.some((t) => /^BUY ·/.test(t.text) || /^NEED \d+ GOLD$/.test(t.text));
  if (!dockOpened) { fail(platform, 'shop -> gem dock opens', `tapped "${gemHit.text}" but no BUY/NEED text appeared in the dock`); return; }
  pass(platform, `gem dock opened for "${gemHit.text}"`);

  // ---- 2. buy it if affordable -> gold drops by exactly the shown price ----
  // Reserves enough gold to still afford BOTH rerolls below (1G + 2G = 3) —
  // buying is explicitly "if affordable" (best-effort) per the brief, while
  // the reroll escalation check is not, so a cheap gem here must not starve
  // the wallet needed for the step that actually has to pass.
  const buyBtn = dockTexts.find((t) => /^BUY ·\s*(\d+)\s*GOLD$/.test(t.text));
  const RESERVE_FOR_REROLLS = 3;
  if (buyBtn) {
    const price = Number(/^BUY ·\s*(\d+)\s*GOLD$/.exec(buyBtn.text)![1]);
    const goldBefore = readGold(dockTexts);
    if (goldBefore === null) { fail(platform, 'shop -> read gold before buy', 'GOLD label/value pair not found or unreadable'); return; }
    if (goldBefore - price < RESERVE_FOR_REROLLS) {
      console.log(`  [${platform}] skipping the buy — ${goldBefore}G minus this gem's ${price}G would leave less than the ${RESERVE_FOR_REROLLS}G the two REROLL assertions below need`);
    } else {
      await clickExactText(page, buyBtn.text, platform, `shop -> BUY gem (${buyBtn.text})`);
      await page.waitForTimeout(250);
      await shot(page, '03-gem-confirm', platform);
      const confirmed = await clickMatchingText(page, platform, 'shop -> confirm BUY', (t) => t === 'BUY', '"BUY" confirm button');
      if (!confirmed) return;
      await page.waitForTimeout(250);
      await shot(page, '04-after-buy', platform);
      const goldAfter = readGold(await collectTexts(page));
      if (goldAfter === null) { fail(platform, 'shop -> read gold after buy', 'GOLD label/value pair not found or unreadable'); return; }
      if (goldAfter !== goldBefore - price) {
        fail(platform, 'shop -> gold decreases by shown price', `gold went ${goldBefore} -> ${goldAfter}, expected ${goldBefore} -> ${goldBefore - price} (price ${price})`);
        return;
      }
      pass(platform, `bought "${gemHit.text}" for ${price}G, gold ${goldBefore} -> ${goldAfter}`);
    }
  } else {
    console.log(`  [${platform}] gem "${gemHit.text}" not affordable (no "BUY ·" text) — skipping the buy assertion, proceeding to REROLL`);
  }
  void goldBeforeGemTap;

  // ---- 3. REROLL twice -> label escalates 1G->2G, gold matches ----
  const rerollCostOf = (label: string): number | null => {
    const m = /^REROLL\s*·\s*(\d+)\s*G$/.exec(label.replace(/\s+/g, ' ').trim());
    return m ? Number(m[1]) : null;
  };
  let expectedCosts = [1, 2];
  for (let i = 0; i < 2; i++) {
    const before = await collectTexts(page);
    const goldBefore = readGold(before);
    const rerollLabel = before.find((t) => /^REROLL/.test(t.text));
    if (!rerollLabel) { fail(platform, `shop -> reroll #${i + 1}`, 'no REROLL button visible (FULL STOCK or unaffordable) — cannot verify escalation'); return; }
    const cost = rerollCostOf(rerollLabel.text);
    if (cost === null) { fail(platform, `shop -> reroll #${i + 1} label`, `could not parse a "REROLL · N G" cost out of "${rerollLabel.text}"`); return; }
    if (cost !== expectedCosts[i]) {
      fail(platform, `shop -> reroll #${i + 1} cost escalation`, `expected REROLL cost ${expectedCosts[i]}, label reads "${rerollLabel.text}" (${cost})`);
      return;
    }
    if (goldBefore === null) { fail(platform, `shop -> reroll #${i + 1} gold read`, 'GOLD label/value pair not found or unreadable'); return; }
    await clickExactText(page, rerollLabel.text, platform, `shop -> reroll #${i + 1} (${rerollLabel.text})`);
    await page.waitForTimeout(300);
    await shot(page, `05-reroll${i + 1}`, platform);
    const after = await collectTexts(page);
    const goldAfter = readGold(after);
    if (goldAfter === null) { fail(platform, `shop -> reroll #${i + 1} gold after`, 'GOLD label/value pair not found or unreadable after reroll'); return; }
    if (goldAfter !== goldBefore - cost) {
      fail(platform, `shop -> reroll #${i + 1} gold deduction`, `gold went ${goldBefore} -> ${goldAfter}, expected ${goldBefore} -> ${goldBefore - cost} (cost ${cost})`);
      return;
    }
    pass(platform, `reroll #${i + 1}: label "${rerollLabel.text}" (${cost}G), gold ${goldBefore} -> ${goldAfter}`);
  }
  void expectedCosts;

  // ---- 4. LEAVE SHOP -> scene actually changes (the regression this exists to catch) ----
  const beforeLeave = await activeSceneKey(page);
  if (beforeLeave !== SHOP_SCENE_KEY[platform]) { fail(platform, 'shop -> LEAVE SHOP precondition', `expected to still be on "${SHOP_SCENE_KEY[platform]}", actually on "${beforeLeave}"`); return; }
  await clickExactText(page, 'LEAVE SHOP', platform, 'shop -> LEAVE SHOP');
  const left = await waitUntil(page, async () => (await activeSceneKey(page)) !== SHOP_SCENE_KEY[platform], 8000);
  if (!left) {
    const stuckTexts = await collectTexts(page);
    fail(platform, 'shop -> LEAVE SHOP', `scene is still "${SHOP_SCENE_KEY[platform]}" 8s later — texts on screen: ${JSON.stringify(stuckTexts.map((t) => t.text))}`);
    return;
  }
  const landedOn = await activeSceneKey(page);
  await shot(page, '06-after-leave', platform);
  pass(platform, `LEAVE SHOP -> scene changed to "${landedOn}"`);
}

async function runPlatform(page: Page, platform: Platform): Promise<void> {
  const MAX_ATTEMPTS = 3;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    console.log(`[${platform}] attempt ${attempt}/${MAX_ATTEMPTS}: draft + walk to a shop`);
    const preAttemptFailures = hardFailures.length;
    try {
      await runDraft(page, platform);
    } catch (err) {
      fail(platform, 'draft', err instanceof Error ? err.message : String(err));
      return; // a broken draft is not retryable by re-seeding — it's a real bug
    }
    if (hardFailures.length > preAttemptFailures) return; // runDraft's own named failures already recorded
    const reached = await walkToShop(page, platform);
    if (reached) {
      console.log(`[${platform}] reached a shop on attempt ${attempt}`);
      await runShopAssertions(page, platform);
      return;
    }
    console.log(`[${platform}] attempt ${attempt} did not reach a shop — retrying with a fresh run` + (attempt < MAX_ATTEMPTS ? '' : ' (out of attempts)'));
  }
  fail(platform, 'reach a shop', `never entered a shop within ${MAX_ATTEMPTS} full-run attempts`);
}

async function main(): Promise<void> {
  const chromiumPath = resolveChromiumPath();
  console.log(`Using Chromium: ${chromiumPath}`);
  const browser = await chromium.launch({
    executablePath: chromiumPath,
    args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--disable-gpu-sandbox', '--no-sandbox'],
  });
  const PLATFORMS: Platform[] = ['desktop', 'mobile'];
  for (const platform of PLATFORMS) {
    const page = await browser.newPage({ viewport: VIEWPORTS[platform] });
    // Nothing but this script decides when the page navigates — see
    // `pinPageAgainstHmr`. Without it a concurrent `src/` edit reloads the
    // browser mid-walkthrough and the run reports nonsense.
    await pinPageAgainstHmr(page);
    page.on('pageerror', (err) => fail(platform, 'page error', String(err)));
    try {
      await runPlatform(page, platform);
    } catch (err) {
      fail(platform, 'run', `threw: ${err instanceof Error ? err.message : String(err)}`);
    }
    await page.close();
  }
  await browser.close();

  console.log('\n=== PASSED ===');
  for (const p of passed) console.log(`  ${p}`);
  if (hardFailures.length > 0) {
    console.log(`\n=== HARD FAILURES (${hardFailures.length}) ===`);
    for (const f of hardFailures) console.log(`  ${f}`);
  }
  console.log(`\nTotals: passed=${passed.length} hardFailures=${hardFailures.length}`);
  process.exit(hardFailures.length > 0 ? 1 : 0);
}

void main().catch((err) => {
  console.error('shop-smoke could not run:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
