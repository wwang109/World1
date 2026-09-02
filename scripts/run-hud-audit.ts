/**
 * Run HUD audit — Playwright-driven verification of `renderRunHud` +
 * `runScreenTemplate` in a real browser. Two layers, per the HUD/screen-
 * template spec (see `src/game/ui/runScreenTemplate.ts`):
 *
 *   1. Walks the LIVE `window.__game` scene graph on every run screen at
 *      both viewports, collecting the world bounds of every Text the browser
 *      actually PAINTS (see MASKS below), and flags: (a) any text extending outside the canvas, (b) any two
 *      texts overlapping by more than a small tolerance, (c) required HUD
 *      strings (DAY/WAVE/GOLD/LV/LIVES/BOSSES) missing from the stats
 *      region.
 *   2. Drives an actual playthrough (Map -> Draft -> Map -> a node -> Deck
 *      Build -> RETIRE -> end summary) against the scene graph (no hardcoded
 *      canvas coordinates for anything the HUD/game renders dynamically),
 *      screenshotting every screen. Text that carries a variable suffix
 *      (node titles, the front-door button) is matched by predicate
 *      (`clickMatchingText`); text that's genuinely fixed is matched exactly
 *      (`clickExactText`). Every navigation click is retried up to 3x against
 *      a real POSTCONDITION (`clickUntil`) — either way, a step whose target text isn't on
 *      screen fails LOUDLY, by the step's own name, instead of silently
 *      clicking nothing and leaving the walkthrough parked on the previous
 *      screen (repeat screenshot hashes are also checked directly, as a
 *      second, independent guard against exactly that failure mode).
 *
 * MASKS (2026-08-31). Layer 1 reports only what is DRAWN. Phaser CLIPS a
 * masked object, so a shop-shelf row scrolled out of its viewport is never
 * painted — yet `visible` stays `true`, `alpha` stays `1`, and `getBounds()`
 * still reports the un-clipped rectangle. Ignoring that produced two
 * confident, entirely fictional findings ("GEM POUCH" x "Frost Sliver"
 * overlapping, "2 G" off-canvas at y928 on an 892px-tall viewport), both
 * inside the shelf mask, both briefed onward to another agent as fact. See
 * `scripts/sceneText.ts` and `src/game/ui/maskedTextBounds.ts`.
 *
 * CALIBRATION. Before any of its zeros are believed, this audit proves its own
 * detector on the mobile/desktop `map-active` screen: an unmasked probe drawn
 * across the DECK/BAG label (the shipped `2ca972a` geometry) MUST be reported;
 * a probe inside a real `createGeometryMask()` viewport it falls outside of
 * must NOT be, while its raw bounds still overlap; a straddling probe must be
 * cut. Any of those failing is a hard failure — see `calibrateCollector`.
 *
 * `[layout-audit]` WARNINGS. `auditControlLabel`/`auditTextBlock` failures are
 * drained off `window.__layoutAudit` on every screen and reported as
 * violations, so a correct warning is no longer confined to a browser console
 * nobody reads.
 *
 * Usage: `npm run audit:hud -- [outDir]` (or `npx tsx scripts/run-hud-audit.ts
 * [outDir]`). Requires the Vite dev server at :5173 (`npm run dev`) and the
 * battle API at :8787 (`npm run api`) — neither is started by this script.
 * Exits NON-ZERO on any violation or hard failure. Env knobs:
 * `AUDIT_SHOW_MASKED=1` also prints what the old mask-blind collector would
 * have said; `AUDIT_TRACE=1` prints a stack for a thrown run.
 */
import { createHash } from 'node:crypto';
import { chromium, type Page } from 'playwright';
import { pinPageAgainstHmr } from './pageHarness';
import { resolveChromiumPath } from './chromiumPath';
import { rollStartDraft, DRAFT_SET_KEYS } from '../src/run/draft';
import { skillBook } from '../src/data/skills';
import { runScreenTemplate } from '../src/game/ui/runScreenTemplate';
import { escapesCanvas, overlapArea } from '../src/game/ui/maskedTextBounds';
import {
  collectRawSceneTexts as collectRawTexts,
  collectSceneTexts as collectTexts,
  type TextBound,
} from './sceneText';

const BASE = process.env.WORLD1_DEV_URL ?? 'http://localhost:5173';
const OUT_DIR = process.argv[2] ?? '.';

type Platform = 'desktop' | 'mobile';
const VIEWPORTS: Record<Platform, { width: number; height: number }> = {
  desktop: { width: 1440, height: 900 },
  mobile: { width: 412, height: 892 },
};
const MAP_SCENE: Record<Platform, string> = { desktop: 'desktop-runmap', mobile: 'mrunmap' };

interface AuditResult {
  screen: string;
  platform: Platform;
  offCanvas: TextBound[];
  overlaps: Array<{ a: TextBound; b: TextBound; overlapPx: number }>;
  missingStats: string[];
  /** Drained from `window.__layoutAudit` — the shrink/truncate/gutting failures
   * `src/game/ui/controlLayoutAudit.ts` used to only `console.warn` about. */
  layoutAudit: Array<{ name: string; message: string; count: number }>;
  textCount: number;
}

/**
 * Drains (and clears) the live layout-audit failure log — see the SINK comment
 * in `src/game/ui/controlLayoutAudit.ts`. Those checks were already correct and
 * already firing; their only outlet was a browser console nobody reads during a
 * manual session, which is how a truncated run-event reward line went unheard
 * for weeks. Reading them here puts them behind this script's exit code.
 *
 * Clearing after each read means each screen is credited with the failures
 * produced since the previous screen, rather than every screen inheriting the
 * whole run's backlog.
 */
async function drainLayoutAudit(page: Page): Promise<Array<{ name: string; message: string; count: number }>> {
  return page.evaluate(() => {
    const sink = (window as any).__layoutAudit;
    if (!sink) return [];
    const found = sink.failures();
    sink.reset();
    return found;
  });
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

function overlaps(a: TextBound, b: TextBound): number {
  return overlapArea(a, b);
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
  // A mask this script cannot model is an AUDIT failure, never a silent pass:
  // its text is measured unclipped, so anything it says about that text — flag
  // or no flag — is a guess. Say so by name instead of guessing quietly.
  for (const t of texts) {
    if (t.unresolvedMask) {
      hardFailures.push(`[${platform}] screen "${screen}": text "${t.text}" [${t.scene}] sits under a mask this audit cannot model — its bounds are unclipped and every finding about it is unreliable`);
    }
  }
  const offCanvas = texts.filter((t) => escapesCanvas(t, width, height, TOL));
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
  const layoutAudit = await drainLayoutAudit(page);

  // AUDIT_SHOW_MASKED=1 — the same two checks run against the MASK-BLIND
  // reading, i.e. exactly what this script reported before 2026-08-31. Not a
  // violation source (these are not on screen); a diagnostic, so the size of
  // the false-positive population this fix removed stays measurable instead of
  // becoming folklore.
  if (process.env.AUDIT_SHOW_MASKED) {
    const blind = (await collectRawTexts(page)).map((t) => ({
      text: t.text, x: t.x, y: t.y, width: t.width, height: t.height, scene: t.scene,
      clipped: false, unresolvedMask: false,
    }));
    const blindOff = blind.filter((t) => escapesCanvas(t, width, height, TOL));
    let blindOverlaps = 0;
    for (let i = 0; i < blind.length; i++) {
      for (let j = i + 1; j < blind.length; j++) if (overlaps(blind[i]!, blind[j]!) > 36) blindOverlaps++;
    }
    const ghostOff = blindOff.length - offCanvas.length;
    const ghostOverlap = blindOverlaps - overlapsFound.length;
    if (ghostOff > 0 || ghostOverlap > 0) {
      console.log(`  [mask-blind] ${platform}/${screen}: ${ghostOff} off-canvas + ${ghostOverlap} overlaps that are NOT drawn`);
      for (const t of blindOff) {
        if (!offCanvas.some((o) => o.text === t.text && Math.abs(o.y - t.y) < 1)) {
          console.log(`    ghost OFF-CANVAS: "${t.text}" @ (${t.x.toFixed(0)},${t.y.toFixed(0)}) [${t.scene}]`);
        }
      }
    }
  }

  const result: AuditResult = { screen, platform, offCanvas, overlaps: overlapsFound, missingStats, layoutAudit, textCount: texts.length };
  violations.push(result);
  return result;
}

/**
 * CALIBRATION — the detector proves it can still see a real overlap BEFORE any
 * of its zeros are believed, and proves it now drops a masked one.
 *
 * This runs inside every audit, on the mobile `map-active` screen, and any
 * failure is a HARD failure: a green audit from an uncalibrated collector is
 * exactly the thing that cost an agent a round trip on 2026-08-31 ("GEM POUCH
 * x Frost Sliver", "2 G off-canvas at y928" — both inside the shop shelf's
 * geometry mask, neither ever drawn). Precedent: the agent that swept 13 scenes
 * for overlaps first pointed its detector at a known-broken expression and
 * confirmed it reported 4 problems; only then did its zeros mean anything.
 *
 * THE POSITIVE CONTROL is the shipped bug from `2ca972a` — "the mobile header
 * rule struck through its own buttons":
 *
 *     mobile actions band   74..96
 *     mobile content.y      100
 *     divider drawn at      content.y - 14 = 86
 *     DECK/BAG label centre 85
 *
 * A hairline at 86 through a label centred at 85 read as strikethrough on
 * EVERY mobile run screen. The probe is a Text placed at the measured centre of
 * the live DECK/BAG label — the same collision, in the same coordinates, drawn
 * for real into the live scene — and the collector must report it. (The rule
 * itself is a `Graphics` line, which a TEXT collector cannot see at all; the
 * probe is what makes that geometry visible to this detector. `2f9fb2a`'s
 * `ruleClearanceAudit.test.ts` is what guards the rule-vs-label case proper.)
 *
 * THE NEGATIVE CONTROLS are built with the SAME construction every scroll
 * viewport in this game ships (`make.graphics` -> `fillRect` ->
 * `createGeometryMask` -> `container.setMask`, as in `DesktopShopScene.ts`,
 * `MobileShopScene.ts` and `MobileDeckBuildScene.ts`), not a strawman:
 *   - a probe scrolled fully outside the viewport rect must vanish from the
 *     collector while its RAW bounds still overlap something (i.e. the old
 *     collector would have flagged it — the false positive is reproduced and
 *     then shown to be gone);
 *   - a probe straddling the viewport edge must survive with bounds CUT to the
 *     visible part.
 */
interface CalibrationProbe { text: string; rawOverlapPx: number }

async function calibrateCollector(page: Page, platform: Platform): Promise<void> {
  const step = `${platform} collector calibration`;
  const anchorLabel = platform === 'desktop' ? 'DECK / BAG' : 'DECK/BAG';
  const before = await collectTexts(page);
  const anchor = before.find((t) => t.text === anchorLabel);
  if (!anchor) {
    hardFailures.push(`[${platform}] ${step}: no "${anchorLabel}" label on screen to calibrate against — the detector was never proven`);
    return;
  }

  const geo = await page.evaluate((a: { x: number; y: number; width: number; height: number }) => {
    const game = (window as any).__game;
    const scene = game.scene.scenes.find((s: any) => s.sys.isActive() && s.children.list.length > 0);
    if (!scene) return null;
    const style = { fontSize: '10px', color: '#ff00ff', fontFamily: 'monospace', fontStyle: 'bold' };
    const cx = a.x + a.width / 2;
    const cy = a.y + a.height / 2;

    // (1) POSITIVE: unmasked, drawn straight across the anchor label's centre.
    const hit = scene.add.text(cx, cy, '⟦P1⟧————', style).setOrigin(0.5, 0.5).setDepth(9999);

    // (2) NEGATIVE: the shipped scroll-viewport construction, with the probe
    // laid out entirely OUTSIDE the viewport rect — a shelf row scrolled away.
    const viewport = { x: cx - 60, y: cy + 200, w: 120, h: 40 };
    const gAway = scene.make.graphics({}, false);
    gAway.fillStyle(0xffffff);
    gAway.fillRect(viewport.x, viewport.y, viewport.w, viewport.h);
    const away = scene.add.container(0, 0).setDepth(9999);
    const awayText = scene.add.text(cx, cy, '⟦P2⟧————', style).setOrigin(0.5, 0.5);
    away.add(awayText);
    away.setMask(gAway.createGeometryMask());

    // (3) NEGATIVE: straddling the viewport's top edge — half drawn.
    const gHalf = scene.make.graphics({}, false);
    gHalf.fillStyle(0xffffff);
    const halfTop = cy;
    gHalf.fillRect(0, halfTop, 4000, 400);
    const half = scene.add.container(0, 0).setDepth(9999);
    const halfText = scene.add.text(cx, cy, '⟦P3⟧————', style).setOrigin(0.5, 0.5);
    half.add(halfText);
    half.setMask(gHalf.createGeometryMask());

    const hb = halfText.getBounds();
    return {
      anchorCentreY: cy,
      bandTop: a.y,
      bandBottom: a.y + a.height,
      probeY: hit.getBounds().y,
      viewport,
      halfTop,
      halfRaw: { y: hb.y, height: hb.height },
    };
  }, { x: anchor.x, y: anchor.y, width: anchor.width, height: anchor.height });

  if (!geo) {
    hardFailures.push(`[${platform}] ${step}: no active scene to inject probes into`);
    return;
  }
  await page.waitForTimeout(120);

  const raw = await collectRawTexts(page);
  const drawn = await collectTexts(page);

  // How badly each probe overlaps the anchor when masks are IGNORED — i.e.
  // what the pre-fix collector saw. Reproducing the false positive is what
  // makes its absence below mean something.
  const rawProbe = (needle: string): CalibrationProbe | null => {
    const t = raw.find((r) => r.text.startsWith(needle));
    if (!t) return null;
    return { text: t.text, rawOverlapPx: overlapArea(t, anchor) };
  };
  const positiveRaw = rawProbe('⟦P1⟧');
  const maskedRaw = rawProbe('⟦P2⟧');
  const clippedRaw = rawProbe('⟦P3⟧');

  const drawnOverlap = (needle: string): number => {
    const t = drawn.find((d) => d.text.startsWith(needle));
    return t ? overlapArea(t, anchor) : -1;
  };
  const positiveSeen = drawnOverlap('⟦P1⟧');
  const maskedSeen = drawn.some((d) => d.text.startsWith('⟦P2⟧'));
  const clippedProbe = drawn.find((d) => d.text.startsWith('⟦P3⟧'));

  console.log(`\n--- CALIBRATION (${platform}) ---`);
  console.log(`  anchor "${anchorLabel}"`);
  console.log(`    band ${geo.bandTop.toFixed(0)}..${geo.bandBottom.toFixed(0)}`);
  console.log(`    centre y ${geo.anchorCentreY.toFixed(0)}`);
  console.log(`  P1 unmasked strike`);
  console.log(`    raw overlap ${(positiveRaw?.rawOverlapPx ?? -1).toFixed(0)}px2`);
  console.log(`    seen overlap ${positiveSeen.toFixed(0)}px2`);
  console.log(`  P2 fully masked`);
  console.log(`    raw overlap ${(maskedRaw?.rawOverlapPx ?? -1).toFixed(0)}px2`);
  console.log(`    still reported: ${maskedSeen}`);
  console.log(`  P3 half masked`);
  console.log(`    raw y ${geo.halfRaw.y.toFixed(0)} h ${geo.halfRaw.height.toFixed(0)}`);
  console.log(`    mask top y ${geo.halfTop.toFixed(0)}`);
  console.log(`    seen y ${(clippedProbe?.y ?? -1).toFixed(0)} h ${(clippedProbe?.height ?? -1).toFixed(0)}`);
  console.log(`    clipped flag: ${clippedProbe?.clipped}`);

  if (positiveSeen <= 36) {
    hardFailures.push(`[${platform}] ${step}: the UNMASKED strike probe over "${anchorLabel}" (the 2ca972a geometry) reported ${positiveSeen.toFixed(0)}px2 — this detector can no longer see a real overlap, so none of its zeros mean anything`);
  }
  if ((maskedRaw?.rawOverlapPx ?? 0) <= 36) {
    hardFailures.push(`[${platform}] ${step}: the masked probe's RAW bounds did not overlap the anchor, so the false positive it is meant to reproduce was never staged — the negative control proves nothing`);
  }
  if (maskedSeen) {
    hardFailures.push(`[${platform}] ${step}: a text a geometry mask hides entirely is STILL being reported — the mask fix is not in effect`);
  }
  if (!clippedProbe) {
    hardFailures.push(`[${platform}] ${step}: the half-masked probe vanished entirely — the clip is over-eager and would hide real violations`);
  } else if (!clippedProbe.clipped || clippedProbe.height >= geo.halfRaw.height - 0.5) {
    hardFailures.push(`[${platform}] ${step}: the half-masked probe kept its full height (${clippedProbe.height.toFixed(1)} vs raw ${geo.halfRaw.height.toFixed(1)}) — partial clipping is not being modelled`);
  }
  if (clippedRaw === null) {
    hardFailures.push(`[${platform}] ${step}: the half-masked probe was never injected`);
  }

  // Probes are torn down before the screen is audited or screenshotted, so the
  // calibration can never leak into the violation list or a shot's md5.
  await page.evaluate(() => {
    const game = (window as any).__game;
    for (const scene of game.scene.scenes) {
      if (!scene.sys.isActive()) continue;
      for (const obj of scene.children.list.slice()) {
        if (obj.depth === 9999) obj.destroy();
      }
    }
  });
  await page.waitForTimeout(120);
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

/**
 * Clicks the `occurrence`-th visible Text (top-to-bottom, then left-to-right)
 * whose string equals `label` exactly. `clickExactText`'s "last match wins" is
 * right for a confirm dialog stacked over the HUD, and WRONG for the draft:
 * one seed's four rows can roll the SAME skill name twice, and "last match"
 * then clicks the other row's copy, leaving this row unpicked with no thrown
 * error. Ported from `shop-smoke.ts`, which hit exactly that.
 */
async function clickNthText(page: Page, label: string, occurrence: number, platform: Platform, step: string): Promise<boolean> {
  const { width, height } = await page.evaluate(() => ({ width: (window as any).__gameDesignWidth, height: (window as any).__gameDesignHeight }));
  const texts = await collectTexts(page);
  const matches = texts.filter((t) => t.text === label).sort((a, b) => (a.y - b.y) || (a.x - b.x));
  const target = matches[occurrence];
  if (!target) {
    hardFailures.push(`[${platform}] step "${step}": no visible text "${label}" at occurrence index ${occurrence} (found ${matches.length})`);
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
  await page.mouse.click(box.x + ((target.x + target.width / 2) / dw) * box.width, box.y + ((target.y + target.height / 2) / dh) * box.height);
  return true;
}

/**
 * Click, then verify the POSTCONDITION, up to 3 times — the compensating
 * control for the harness flake documented on `clickExactText` (task #62).
 *
 * This script used to refuse to retry on principle: "a step that doesn't take
 * is meant to fail loudly by name". That principle is right about SILENCE and
 * wrong about repetition. Under swiftshader the game loop measures 5-30fps
 * against Phaser's 60fps target, and Phaser defers a dispatched pointer event's
 * hit-test to its own next game step — so a click can be hit-tested 150-200ms
 * later, after an unrelated rebuild has replaced the display list, and land on
 * nothing. On 2026-08-31 two back-to-back runs of this audit failed in two
 * DIFFERENT places for that reason and produced two different, equally
 * worthless violation lists. A gate that fails at random is the same disease as
 * a gate that reports fictional violations: nobody can act on either. So the
 * loud failure now fires after three attempts instead of one, and names the
 * postcondition that never held.
 *
 * Intermediate attempts' own failures are rolled back — recording a
 * succeeded-on-attempt-2 step as broken is exactly the false report this is
 * trying to remove. The rollback removes ONLY entries naming an attempt, so an
 * unrelated `page error` pushed asynchronously during the retry window (by the
 * `pageerror` handler in `main`) survives it: a blanket truncate would have
 * silently eaten a real thrown exception.
 */
async function clickUntil(
  page: Page,
  platform: Platform,
  step: string,
  click: (attempt: number) => Promise<unknown>,
  settled: () => Promise<boolean>,
  why: string,
): Promise<boolean> {
  const mark = hardFailures.length;
  let ok = false;
  for (let attempt = 1; attempt <= 3 && !ok; attempt++) {
    await click(attempt);
    ok = await waitUntil(page, settled, attempt < 3 ? 2500 : 8000);
  }
  hardFailures.splice(mark, hardFailures.length - mark, ...hardFailures.slice(mark).filter((f) => !f.includes('(attempt ')));
  if (!ok) hardFailures.push(`[${platform}] step "${step}": ${why} after 3 click attempts`);
  return ok;
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
  // Each pick is verified against the scene's OWN pick counter — desktop draws
  // "PICK ONE PER ROW · n/4" (`DesktopDraftScene.ts:75`), mobile "n/4 PICKED"
  // (`MobileDraftScene.ts:108`) — rather than a fixed 150ms sleep. A sleep
  // cannot tell "the click missed" from "the click is still queued", and both
  // surface identically three steps later as an inscrutable "START did
  // nothing".
  const occurrenceUsed = new Map<string, number>();
  for (let i = 0; i < DRAFT_SET_KEYS.length; i++) {
    const key = DRAFT_SET_KEYS[i]!;
    const card = draft[key][0];
    const name = card ? skillBook[card.skillId]?.name : undefined;
    if (name) {
      const occurrence = occurrenceUsed.get(name) ?? 0;
      occurrenceUsed.set(name, occurrence + 1);
      const step = `draft -> pick ${key} (${name})`;
      await clickUntil(
        page, platform, step,
        (attempt) => clickNthText(page, name, occurrence, platform, `${step} (attempt ${attempt})`),
        async () => (await collectTexts(page)).some((t) =>
          t.text.startsWith(`PICK ONE PER ROW · ${i + 1}/`) || t.text.startsWith(`${i + 1}/${DRAFT_SET_KEYS.length} PICKED`)),
        `the pick counter never reached ${i + 1}/${DRAFT_SET_KEYS.length}`,
      );
    }
    if (!desktop && i < DRAFT_SET_KEYS.length - 1) {
      // Mobile shows ONE row at a time; wait for the NEXT row's own header
      // rather than a sleep, or this loop's next name-click genuinely has no
      // matches on screen and reads like a missing-card bug.
      const nextSet = i + 2;
      const step = `draft -> NEXT (after ${key})`;
      await clickUntil(
        page, platform, step,
        (attempt) => clickExactText(page, 'NEXT', platform, `${step} (attempt ${attempt})`),
        async () => (await collectTexts(page)).some((t) => t.text.startsWith(`DRAFT · SET ${nextSet}/`)),
        `SET ${nextSet}/${DRAFT_SET_KEYS.length} never appeared`,
      );
    }
  }
  // The draft's START button is only INTERACTIVE once all 4 rows have a pick
  // (`DesktopDraftScene`/`MobileDraftScene`: `ready = picks.length === 4`) —
  // its Text label reads "START" either way, so a click that lands on a
  // disabled button finds its target text (no missing-selector failure) and
  // does nothing (no scene change, no thrown error). Checking the actual
  // postcondition — the scene left Draft — is the only way to catch that.
  await clickUntil(
    page, platform, 'draft -> START',
    (attempt) => clickExactText(page, 'START', platform, `draft -> START (attempt ${attempt})`),
    async () => (await activeSceneKey(page)) !== DRAFT_SCENE,
    'the Draft scene never closed (all 4 rows picked?)',
  );

  // ---- 3. Map, active run ----
  // CALIBRATE FIRST, on the screen the 2ca972a bug actually shipped on, and
  // before anything on this screen is audited or screenshotted: an audit whose
  // detector has not been proven on a known-broken geometry is an audit whose
  // zeros mean nothing. Probes are torn down inside this call.
  await calibrateCollector(page, platform);
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
  let picked: string | null = null;
  await clickUntil(
    page, platform, 'map-active -> pick a node',
    async (attempt) => {
      picked = await clickMatchingText(
        page, platform, `map-active -> pick a node (attempt ${attempt})`,
        (t) => NODE_KINDS.some((k) => t === k || t.startsWith(`${k} ·`)),
        'a node title (KIND or KIND · SUFFIX)',
      );
    },
    async () => (await activeSceneKey(page)) !== MAP_SCENE_KEY,
    'the run map never handed off to a node scene',
  );
  const landedOn = await activeSceneKey(page);
  await shot(page, `${platform}-04-node-${landedOn}`, platform);
  await auditScreen(page, `node-${landedOn}`, platform, REQUIRED_STATS.filter(Boolean));
  console.log(`[${platform}] picked "${picked}" -> landed on scene "${landedOn}"`);

  // ---- 5. DECK / BAG (secondary HUD slot) ----
  const deckLabel = desktop ? 'DECK / BAG' : 'DECK/BAG';
  const wentToDeck = await clickUntil(
    page, platform, `node-${landedOn} -> DECK/BAG`,
    (attempt) => clickExactText(page, deckLabel, platform, `node-${landedOn} -> DECK/BAG (attempt ${attempt})`),
    async () => (await activeSceneKey(page)) === DECK_SCENE,
    'the deck screen never opened',
  );
  if (wentToDeck) {
    await shot(page, `${platform}-05-deck`, platform);
    await auditScreen(page, 'deck', platform, REQUIRED_STATS.filter(Boolean));
    await clickUntil(
      page, platform, 'deck -> ‹ MAP',
      (attempt) => clickExactText(page, '‹ MAP', platform, `deck -> ‹ MAP (attempt ${attempt})`),
      async () => (await activeSceneKey(page)) !== DECK_SCENE,
      'the deck screen never closed',
    );
  }

  // ---- 6. RETIRE (tertiary HUD slot) -> confirm -> end summary ----
  // Neither RETIRE click triggers a `scene.start` — both just flip a boolean
  // and re-render the SAME scene (`this.retireConfirmOpen = true; this.rerender()`
  // then `retireActiveRun(); this.rerender()`) — so the postcondition to wait
  // for is new TEXT appearing, not a scene-key change.
  await clickUntil(
    page, platform, 'map-active -> RETIRE',
    (attempt) => clickExactText(page, 'RETIRE', platform, `map-active -> RETIRE (attempt ${attempt})`),
    async () => (await collectTexts(page)).some((t) => t.text === 'RETIRE THIS RUN?'),
    'the retire confirm dialog never opened',
  );
  await shot(page, `${platform}-06-retire-confirm`, platform);
  await auditScreen(page, 'retire-confirm', platform);
  await clickUntil(
    page, platform, 'retire-confirm -> RETIRE (confirm)',
    // last match = the dialog's red button, which is added after the HUD's
    (attempt) => clickExactText(page, 'RETIRE', platform, `retire-confirm -> RETIRE (confirm, attempt ${attempt})`),
    async () => (await collectTexts(page)).some((t) => t.text === 'RUN RETIRED' || t.text === 'DEFEAT'),
    'the end summary never appeared',
  );
  await shot(page, `${platform}-07-end-summary`, platform);
  await auditScreen(page, 'end-summary', platform);
}

async function main(): Promise<void> {
  const chromiumPath = resolveChromiumPath('run-hud-audit');
  console.log(`Using Chromium: ${chromiumPath}`);
  const browser = await chromium.launch({
    executablePath: chromiumPath,
    args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--disable-gpu-sandbox', '--no-sandbox'],
  });
  for (const platform of PLATFORMS) {
    const page = await browser.newPage({ viewport: VIEWPORTS[platform] });
    // Nothing but this script decides when the page navigates — see
    // `pinPageAgainstHmr`. Without it a concurrent `src/` edit reloads the
    // browser mid-walkthrough and the run reports nonsense.
    await pinPageAgainstHmr(page);
    // Same precedent as scripts/smoke.mjs: a thrown exception inside the game
    // fails the run. A screen that renders while throwing is not a pass.
    page.on('pageerror', (err) => hardFailures.push(`[${platform}] page error: ${String(err)}`));
    try {
      await runPlatform(page, platform);
    } catch (err) {
      hardFailures.push(`[${platform}] audit run threw: ${err instanceof Error ? err.message : String(err)}`);
      if (process.env.AUDIT_TRACE && err instanceof Error) console.log(err.stack);
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
    const problems = v.offCanvas.length + v.overlaps.length + v.missingStats.length + v.layoutAudit.length;
    if (problems === 0) continue;
    bad += problems;
    console.log(`\n=== VIOLATIONS: ${v.platform} / ${v.screen} (${v.textCount} texts) ===`);
    for (const t of v.offCanvas) console.log(`  OFF-CANVAS: "${t.text}" @ (${t.x.toFixed(0)},${t.y.toFixed(0)}) ${t.width.toFixed(0)}x${t.height.toFixed(0)} [${t.scene}]`);
    for (const o of v.overlaps) {
      // Coordinates on the line: an overlap report with no geometry cannot be
      // checked against a screenshot without re-running the whole audit.
      const box = (t: TextBound): string => `(${t.x.toFixed(0)},${t.y.toFixed(0)}) ${t.width.toFixed(0)}x${t.height.toFixed(0)}${t.clipped ? ' clipped' : ''}`;
      console.log(`  OVERLAP (${o.overlapPx.toFixed(0)}px^2): "${o.a.text}" ${box(o.a)} [${o.a.scene}] <-> "${o.b.text}" ${box(o.b)} [${o.b.scene}]`);
    }
    for (const m of v.missingStats) console.log(`  MISSING STAT: "${m}"`);
    for (const l of v.layoutAudit) console.log(`  LAYOUT-AUDIT (x${l.count}): ${l.message}`);
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
