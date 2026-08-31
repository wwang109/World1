# UI Workbook — layouts, audits, screenshots

> **Scope:** LIVING — how to open, audit, and capture the CURRENT UI: the
> `?scene=` routes, the two canvas profiles, the layout/HUD audit tooling,
> and the Playwright capture recipe. Supersedes the 720×1280 / `?view=` era
> docs (`docs/history/ui-spacing-audit.md`, `screenshot-howto.md`,
> `screenshots-readme.md`).

## Canvas profiles (`src/game/layoutProfile.ts`)

- **Desktop**: 1440×900 (`DESKTOP_PROFILE`).
- **Mobile**: 412×892 (`MOBILE_PROFILE`) — real CSS px, no scale factor.

Every feature ships on BOTH (user-locked both-platforms rule —
`docs/design-locked.md`); each platform gets its own layout-appropriate
scene, never a stretched twin. The old 720×1280 portrait canvas and its
`?view=` routes are GONE (first-gen UI deleted).

## Launch routes (`src/game/devLaunch.ts`)

Scenes launch via `?scene=`:

- Desktop: `desktop-prep | desktop-deck | desktop-wiki | desktop-battle |
  desktop-shop | desktop-draft | desktop-runmap | desktop-runprep |
  desktop-runevent`
- Mobile: `mprep | mdeck | mwiki | mbattle | mobile-shop | mobile-draft |
  mrunmap | mrunprep | mrunevent`
- Extras: `seed`, `enemy`, `enemies`, `title`, `rank`, `enemyLevel`,
  `heroLevel`, `mods=diamond,swift`, `board=empty`, `gold` (see
  `docs/feature-inventory.md` header).

**Dev requires two processes**: `npm run dev` (Vite, :5173) AND
`npm run api` (battle service, :8787) — the client cannot simulate
(thin-client rule, `docs/architecture.md`). Battle/prep previews fail
without the API.

## Layout systems (the geometry sources)

- **Run-screen chrome**: `src/game/ui/runScreenTemplate.ts` is THE single
  source of truth for kicker/title/stats/badge/actions/content/footer rects
  and the fixed 4-role action slots on every Run Mode screen, both
  platforms. `renderRunHud` (`RunProgressStrip.ts`) is the only renderer
  that reads it. Unit-tested in `tests/game/runScreenTemplate.test.ts`.
- **Desktop sandbox chrome**: `DESKTOP_LAYOUT` tokens in
  `src/game/ui/DesktopNav.ts` (content top, gaps, nav) — desktop scenes
  never hardcode header coordinates.
- **Card geometry**: `cardTokenSpec.ts` (strip token + accessory rail) and
  `fantasyCardTemplateSpec.ts` (full card) are the ONLY geometry sources.
- **Re-rendering**: every scene rebuilds via the shared `rebuildScene()`
  (`src/game/sceneRebuild.ts`) — never `scene.restart()`, never hand-rolled
  destroy+create. See `docs/architecture.md`.

## Spacing / control audit

Reusable controls call `auditControlLabel`
(`src/game/ui/controlLayoutAudit.ts`): it guarantees ≥8px horizontal and
≥5px vertical label clearance, shrinking the label in 1px steps when
needed; each result is stored on the control as `controlLayoutAudit`.

Open any view with `&layoutAudit=1` — a remaining violation gets a red
outline and a `[layout-audit]` console error. **Treat either as a failed UI
check.** Manual review checklist for every changed control state:

- No label touches or visually crowds a border.
- Adjacent controls have at least 8px of visible separation.
- Text never overlaps icons, values, cards, or neighboring controls
  (persistent overlay text at rest is a defect — `docs/design-locked.md`
  2026-08-03; only transient animation text may cross other UI).
- Long labels work in both inactive and selected states; touch targets stay
  clear even when the visible control is compact.
- Prefer widening the control or shortening its label over shrinking type.

## Run HUD audit (`scripts/run-hud-audit.ts`)

Playwright-driven verification of `renderRunHud` + `runScreenTemplate` in a
real browser, both viewports:

1. Walks the LIVE `window.__game` scene graph on every run screen, collects
   visible Text world-bounds, and flags text outside the canvas, overlapping
   text pairs, and missing required HUD strings
   (DAY/WAVE/GOLD/LV/LIVES/BOSSES).
2. Drives an actual playthrough (Map → Draft → Map → node → Deck Build →
   RETIRE → end summary) using exact-text clicks only, screenshotting every
   screen.
3. BATTLE (in run context) uses a REDUCED required-strings set (2026-08-04
   decision, `renderRunStatsStrip` + `runScreenTemplate`'s `statsOnly` chrome,
   docs/design-locked.md): the stats string
   (DAY/WAVE/GOLD/LV/LIVES/BOSSES) plus the title `BATTLE`, but no banked-PL
   badge text and no action-role button labels (back/DECK·BAG/RETIRE/primary)
   — battle never renders those, by design, so the audit must not flag their
   absence there the way it would on every other run screen.

Run: `npm run audit:hud -- [outDir]` (or `npx tsx scripts/run-hud-audit.ts
[outDir]`) with dev (:5173) and api (:8787) already running. **It exits
non-zero** on any violation or hard failure — it is a gate, not a report. It
cannot live inside `npm test`, which has no servers and no browser; the pure
half of its geometry is covered there by `tests/game/maskedTextAudit.test.ts`.

### Masks (2026-08-31)

The collector respects geometry masks. Phaser CLIPS a masked object, so a shop
shelf row scrolled out of its viewport is never painted — but `visible` stays
`true`, `alpha` stays `1`, and `getBounds()` still reports the un-clipped
rectangle. Ignoring that produced two confident, entirely fictional findings
(`"GEM POUCH" × "Frost Sliver"` overlapping, `"2 G"` off-canvas at y928 on an
892px-tall viewport), both inside the shelf mask, both briefed onward as fact.

Texts a mask hides completely are dropped; texts it cuts are reported with the
surviving bounds. The geometry is pure TypeScript in
`src/game/ui/maskedTextBounds.ts`; the browser-side walk (`scripts/sceneText.ts`,
shared with `shop-smoke.ts`) only reads bounds and raw mask command buffers. A
mask the reducer cannot model becomes a HARD FAILURE by name — never a silent
guess. `AUDIT_SHOW_MASKED=1` additionally prints what the old mask-blind
collector would have reported, so the size of the false-positive population
stays measurable.

### Calibration (every run, not on request)

Before any of its zeros are believed, the audit injects three probes into the
live mobile/desktop `map-active` screen and checks the detector against them:

1. an UNMASKED text drawn across the DECK/BAG label's centre — the shipped
   `2ca972a` geometry (mobile band 74..96, label centre 85, rule at 86) — must
   still be reported as an overlap;
2. a text inside a real `createGeometryMask()` viewport it falls outside of must
   NOT be reported, while its raw bounds still overlap (the false positive is
   staged, then shown gone);
3. a text straddling the viewport edge must survive with its bounds cut.

Any of those failing is a hard failure. Probes are destroyed before the screen
is audited or screenshotted.

### `[layout-audit]` warnings

`auditControlLabel` / `auditTextBlock` failures are recorded in a sink
(`src/game/ui/controlLayoutAudit.ts`, published on `window.__layoutAudit`) as
well as printed to the console. The audit drains that sink on every screen and
reports what it finds as violations. Before this, the only outlet was a browser
console during a manual session — which is how a correct warning about a
truncated run-event reward line went unheard for weeks.

### HMR

Both browser scripts neuter Vite's HMR socket (`scripts/pageHarness.ts` — an
init script that stubs the one WebSocket opened with the `vite-hmr`
subprotocol). `npm run dev` full-page-reloads on every source change; with
several agents editing `src/` at once that destroys the JS context
mid-walkthrough and the run reports nonsense. Measured: 16 vite `page reload`
lines in eight minutes, and `shop-smoke.ts` failing at the same point with and
without any change of its own. Verified directly — with a `src/` file touched
under the page, an unpinned context comes back `null` (reloaded) and a pinned
one comes back alive.

Not `page.route('**/@vite/client')`, which was the first cut: enabling
Playwright routing sends every request through the driver and measured 25-40%
slower on a boot that already has a timeout.

### Flaky clicks

Navigation clicks in BOTH scripts retry up to 3× against a real postcondition
(the draft's own pick counter, a scene-key change, the confirm dialog's text,
the event scene's CONTINUE › appearing) rather than a fixed sleep — the
swiftshader frame-rate flake documented on `clickExactText`. Only the third
failure is recorded, so a succeeded-on-attempt-2 step is not misreported as
broken.

`shop-smoke.ts`'s event choice and reward pick were the last un-retried clicks
in either script; a missed choice click leaves the run-event scene in
`choosing`, where neither scene draws CONTINUE › at all, and the failure
surfaced one step later as "no visible text matching CONTINUE ›".

Chromium resolution is environment-aware (`resolveChromiumPath` in the
script), in priority order: `PW_CHROMIUM` (explicit path, always wins) →
`PLAYWRIGHT_BROWSERS_PATH` (scanned for a `chromium-*` build, since
Playwright's own version-resolution can name a revision that isn't actually
unpacked under a custom browsers path) → a platform default (the historical
Windows dev-machine path below, or `~/.cache/ms-playwright` on Linux/Mac,
scanned the same way). It throws with a clear message if nothing resolves,
rather than silently letting Playwright pick a possibly-mismatched version.
On the Linux CI/sandbox environment, `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`
resolves via the `chromium` convenience symlink; the launch args already
include `--no-sandbox`.

## Screenshot capture recipe

- Chromium for Playwright on this machine:
  `C:/Users/wenwa/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe`
  (also the `PW_CHROMIUM` default in run-hud-audit). Launch arg for headless
  canvas capture: `--enable-unsafe-swiftshader`.
- Viewport = the platform profile: `{1440, 900}` or `{412, 892}`.
- Navigate straight to a `?scene=` URL (plus dial params), wait ~1-2s for the
  scene to settle, then `page.screenshot(...)`.
- Synthetic canvas clicks are unreliable headless — prefer driving the scene
  via `window.__game.scene.getScene(key)` in `page.evaluate`, or exact-text
  bound clicks the way `run-hud-audit.ts` does.

```js
const { chromium } = await import('playwright');
const browser = await chromium.launch({
  headless: true,
  executablePath: 'C:/Users/wenwa/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe',
  args: ['--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto('http://localhost:5173/?scene=desktop-runmap&seed=7', { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
await page.screenshot({ path: 'runmap-desktop.png' });
await browser.close();
```

## Reference captures (`docs/screenshots/`)

Committed captures are point-in-time references — many predate the current
scenes (720×1280 era). Trust only captures you re-take against the current
routes; when a screen changes materially, re-capture at both profiles and
commit alongside the change.
