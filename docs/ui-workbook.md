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

Profile selection happens at boot. Explicit `?ui=desktop|mobile` wins, followed
by a forced `?scene=` profile; otherwise a viewport at most 900 CSS px wide
and with width/height at most 1.25 selects the compact/mobile composition,
including a **900×900 fine-pointer window**. Coarse-pointer phones still use
mobile. Ordinary widescreen desktop remains desktop. Resize then reload to
reselect a profile; resizing alone does not switch scenes. For the 900×900
policy check, omit `?ui=` and profile-forcing `?scene=` overrides.

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
   (`STOP N`, `DAY N/5`, GOLD/LV/LIVES/BOSSES; mobile abbreviates only the
   latter gold/lives/boss labels to G/♥/B).
2. Drives an actual playthrough (Map → Draft → Map → node → Deck Build →
   RETIRE → end summary) using exact-text clicks only, screenshotting every
   screen.
3. BATTLE (in run context) uses a REDUCED required-strings set (2026-08-04
   decision, `renderRunStatsStrip` + `runScreenTemplate`'s `statsOnly` chrome,
   docs/design-locked.md): the stats string
   (`STOP N`, `DAY N/5`, GOLD/LV/LIVES/BOSSES) plus the title `BATTLE`, but no banked-PL
   badge text and no action-role button labels (back/DECK·BAG/RETIRE/primary)
   — battle never renders those, by design, so the audit must not flag their
   absence there the way it would on every other run screen.

Run: `npm run audit:hud -- [outDir]` (or `npx tsx scripts/run-hud-audit.ts
[outDir]`) with dev (:5173) and api (:8787) already running. **It exits
non-zero** on any violation or hard failure — it is a gate, not a report. It
cannot live inside `npm test`, which has no servers and no browser; the pure
half of its geometry is covered there by `tests/game/maskedTextAudit.test.ts`.

The audit's required-stat vocabulary is exercised by
`tests/scripts/runHudAuditVocabulary.test.ts` without launching its browser
walkthrough. The test rejects old absolute-day/wave labels on either profile,
requires both progress values, validates days 1–5, and retains the other stats.
The full audit starts and retires a run: use a controlled browser context, never
the player's current saved run as disposable verification state.

### Travel UI verification

Capture matching run states at **1440×900, 412×892 and 900×900**. The square
window must use the boot-selected compact profile without a forced scene/UI
override. Compare the same event, region and progress against the approved
travel reference; the exact receipt and preview identity matter as much as layout.

- Confirm `EXPEDITION ROUTE`, five-day region progress, days-until-boss copy,
  and the shared `STOP N` / `DAY N/5` HUD remain readable.
- Exercise every ordinary event/shop option, exact preview title/art and concise
  legacy `MET REQUIREMENTS`, then committed `RETURN TO EVENT` and reload.
  Existing event outcome screens and shop behavior remain their own surfaces.
- Verify homogeneous EASY/MEDIUM/HARD choices and the mandatory day-5 boss:
  arrival, true persisted reload/re-entry, then `FACE THE BOSS` to existing Run Prep.
- Open/close `RUN LEDGER` and `REGION GUIDE` inside the destination panel; confirm Back restores the active stop. Also check separate
  earned future `MAP INTEL`; exercise intel scroll and existing HUD overlays.
- Check hover/press during card entrance, dense receipt bounds, actual art crops,
  console/layout failures, and inactive controls beneath overlays. Preserve the
  audit's geometry, overlap, navigation and screenshot-distinctness checks.

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

Chromium resolution is environment-aware and lives in ONE module,
`scripts/chromiumPath.ts`, which `run-hud-audit.ts`, `shop-smoke.ts` and
`encode-card-art.ts` all import. Priority order: `PW_CHROMIUM` (explicit path,
always wins) → `PLAYWRIGHT_BROWSERS_PATH` (scanned for a `chromium-*` build,
since Playwright's own version-resolution can name a revision that isn't
actually unpacked under a custom browsers path) → Playwright's per-user cache,
scanned the same way (`%USERPROFILE%\AppData\Local\ms-playwright` on Windows,
`~/.cache/ms-playwright` elsewhere). It throws with a clear message if nothing
resolves, rather than silently letting Playwright pick a possibly-mismatched
version. On the Linux CI/sandbox environment,
`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers` resolves via the `chromium`
convenience symlink; the launch args already include `--no-sandbox`.

It is one module because it used to be three copies that had drifted: two
pinned one developer's home directory AND Chromium revision 1223, and the
third read `HOME`, which Windows only sets under Git Bash — so `npm run
art:encode` threw from cmd/PowerShell. Scan for whatever revision is unpacked;
never write a username or a revision number into the path.

## Card-face truncation audit (`scripts/card-face-truncation-audit.ts`)

Guards one invariant on `CardToken`'s `segmentedLine`: a too-narrow effects
line may cut a whole segment, but that cut must NEVER be silent. The
regression this exists to catch (2026-09-06): `skillPresentation.ts` added an
`Nt` duration suffix to `guard`/`expose`/`buffStat`/`debuffStat`, tipping 143
tier-resolved variants that pair a duration effect with another segment into
overflowing on real card-face widths — the renderer dropped the excess
segment with no marker at all (`frostbind_litany[gold]` read as
`-25% MATK 2t · -25% MDEF 2t`, its CLEANSE simply gone). Fixed by ellipsising
the TAIL segment in place instead of dropping it, and by always marking a
drop that happens anyway; this script is the standing proof that stays true.

Same Chromium/HMR-pinning infra as the audits above, but a different SHAPE:
it does not click through a playthrough. `CardToken.ts` is Phaser-backed and
genuinely cannot be imported into a vitest test (this repo's vitest is
`environment: 'node'`, no canvas/jsdom — confirmed by direct import throwing
`ReferenceError: window is not defined`), so instead it dynamically
`import()`s the ACTUAL, unmodified `CardToken`/`skillBook`/`applyTier` off the
live Vite dev server, builds a real token off-canvas for every
duration+multi-effect tier variant in the book on all five real surfaces that
ship one (mobile battle effects/compact, desktop battle, shop owned
board/bag, mobile prep/deckbuild/wiki), and reads the ACTUAL rendered `Text`
children. Nothing here reimplements `segmentedLine`'s width arithmetic — that
duplicate (`segmentedLineSurvivors`, once in
`tests/game/cardTokenSpec.test.ts`) is exactly what an earlier audit caught
disagreeing with the real proportional-font renderer, and was deleted.

Run: `npm run audit:cardface -- [outDir]` (or `npx tsx
scripts/card-face-truncation-audit.ts [outDir]`) with dev (:5173) already
running — it does not need the battle API. **It exits non-zero** the moment
any surface renders even one whole-segment drop with no "…" cue; it also
hard-fails if the duration+multi-effect population ever reads 0 (a green
audit that checked nothing). `[outDir]` also gets a
`card-face-truncation-report.json` with the full per-surface counts.

## Continue the Codex session from a phone

This is an app-level connection, separate from serving the game. In the
desktop app, open **Settings → Connections → Control this PC → Set up/Add**,
approve remote access, then scan the QR code with the latest ChatGPT mobile app
while signed into the same account and workspace. Keep the latest desktop app
open and the computer awake and online while using the phone. Do not expose the Codex App Server directly to a
network; use the product's Remote connection (or an approved VPN) instead.

Official setup and security details:
<https://learn.chatgpt.com/es-419/docs/remote-connections>

## Open the development game on a phone

The phone and development computer must be on the same trusted local network.
Run the two existing services on the computer:

```text
npm run api
npm run dev
```

Find the computer's local IPv4 address, then open
`http://<computer-ip>:5173` on the phone. Vite already listens on the local
network. In development, the browser now derives the battle API as
`http://<computer-ip>:8787`, so battle and damage-preview requests return to
the computer instead of incorrectly targeting the phone's own `localhost`.
`VITE_BATTLE_API` still overrides this address when a different service origin
is intentional. If Windows Firewall prompts for either service, allow access
only on the trusted/private network.

## Screenshot capture recipe

- Chromium for Playwright: whatever `scripts/chromiumPath.ts` resolves, or
  `PW_CHROMIUM` if you want to pin one. On Windows the default cache is
  `%USERPROFILE%\AppData\Local\ms-playwright\chromium-<rev>\chrome-win64\chrome.exe`
  — the revision moves with every `playwright install`, so read it, don't
  memorise it. Launch arg for headless canvas capture:
  `--enable-unsafe-swiftshader`.
- Viewport = the platform profile: `{1440, 900}` or `{412, 892}`.
- Navigate straight to a `?scene=` URL (plus dial params), wait ~1-2s for the
  scene to settle, then `page.screenshot(...)`.
- Synthetic canvas clicks DO work headless — a 2026-09-06 re-check found the
  earlier claim here (that they were "unreliable" and had to be routed around
  via `window.__game.scene.getScene(key)`) FALSE. The real bug was a
  coordinate-space mismatch in the probe, not the click mechanism. Scene text
  and rect positions are DESIGN coordinates, while `page.mouse.click` and
  `page.click` want CSS pixels. The current camera writes the UI scale × the
  backing-store device-pixel ratio into `cameras.main.zoom`, so convert through
  the canvas CSS bounds and backing-store dimensions; multiplying by zoom alone
  is wrong on high-DPI displays:

  ```js
  const box = canvas.getBoundingClientRect();
  const cssX = box.x + designX * camera.zoom * box.width / canvas.width;
  const cssY = box.y + designY * camera.zoom * box.height / canvas.height;
  await page.mouse.click(cssX, cssY);
  ```

  This is a zero-origin camera conversion: `designX`/`designY` are the scene
  point, `camera.zoom` maps it into backing-store pixels, and the final ratios
  map backing-store pixels into the canvas's CSS rectangle. For these scenes,
  an exact design-sized CSS viewport (`1440x900` desktop or `412x892` mobile)
  makes design and CSS coordinates equal at every backing-store DPR because
  the zoom and backing-width/height ratio cancel. Camera zoom itself is `1`
  only in the effective backing-store DPR-1 case; at DPR 2 it is `2` while the
  converted design coordinate is still the same CSS coordinate.

  At DPR 1 on the exact desktop profile, the simple case is therefore
  `canvas.width=1440`, `canvas.height=900`, `box.width=1440`, `box.height=900`,
  `camera.zoom=1`: a design point `(593, 797.5)` is clicked at CSS `(593,
  797.5)`. Keep the conversion above in probes so the same recipe remains
  correct when the backing store is denser.

  Worked DPR-2 verification (route:
  `/?scene=desktop-runevent&eventFixture=ruined_anvil&layoutAudit=1`, viewport
  `1440x900`): the `ruined_anvil` merge row center is design `(593, 797.5)`;
  Chromium reports `camera.zoom=2`, backing `2880x1800`, and CSS bounds
  `(0,0,1440,900)`. The conversion yields CSS `(593, 797.5)`, and that click
  opens `MERGE — CARDS LEAVE YOUR BOARD` with `CANCEL` and `MERGE` present.
  The DPR-1 run opens the same confirmation from the same CSS point. Do not
  use `(designX * zoom, designY * zoom)` by itself: at DPR 2 that would click
  `(1186, 1595)` and miss the row.

```js
// Run under tsx (`npx tsx one-off.ts`) so the shared resolver is importable.
const { chromium } = await import('playwright');
const { resolveChromiumPath } = await import('./scripts/chromiumPath');
const browser = await chromium.launch({
  headless: true,
  executablePath: resolveChromiumPath('one-off'),
  args: ['--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1,
});
await page.goto('http://localhost:5173/?scene=desktop-runmap&seed=7', { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
await page.screenshot({ path: 'runmap-desktop.png' });
await browser.close();
```

## Review captures

Do not keep point-in-time screenshots or HTML mockups in tracked documentation;
they become misleading as the scenes evolve. Capture the current routes at both
required profiles into `tmp/`, inspect them during review, and record the route,
viewport, console, and layout-audit evidence in the local SDD ledger. Git history
retains any old committed captures needed for historical archaeology.
