# Verifying a screen — routes, viewports, servers, audits

No test file pins a layout, and none may (`CLAUDE.md` § "Verification is by
evidence — no test files (USER-LOCKED 2026-09-15)"). A screen is proved by
the audit scripts below plus screenshots on both platforms. Which evidence
any other surface needs: the **`world1-testing`** skill.

## Start the app (both processes)

The client cannot simulate combat (thin-client rule) — running only `npm run
dev` leaves any Battle/Prep-adjacent screen broken:

```bash
npm run dev     # Vite, :5173
npm run api     # battle service, :8787 — REQUIRED alongside dev
```

Check before starting either — on 2026-09-15 both were ALREADY answering
(`curl -s -o /dev/null -w '%{http_code}' http://localhost:5173` → `200`,
`:8787` → `404` for a bare GET, which is the service answering), started by
another agent's session. If you find them up, they are someone else's
processes: use them, never restart or kill them — `world1-handoff` §1.

## `?scene=` routes (from `src/game/devLaunch.ts`, cross-checked against
`docs/ui-workbook.md`)

- Desktop: `desktop-prep`, `desktop-deck`, `desktop-wiki`, `desktop-battle`,
  `desktop-shop`, `desktop-draft`, `desktop-runmap`, `desktop-runprep`,
  `desktop-runevent`
- Mobile: `mprep`, `mdeck`, `mwiki`, `mbattle`, `mobile-shop`,
  `mobile-draft`, `mrunmap`, `mrunprep`, `mrunevent`
- Extra query params: `seed`, `enemy`, `enemies`, `title`, `rank`,
  `enemyLevel`, `heroLevel`, `mods=diamond,swift`, `board=empty`, `gold` —
  see `docs/feature-inventory.md`'s header for what each does.
- `&layoutAudit=1` turns on the live spacing/control audit
  (`src/game/ui/controlLayoutAudit.ts`) on any route — a violation is
  recorded and logged either way. Getting a CAPTURED screenshot to actually
  show the red outline needs one more thing: `shouldPreserveDrawingBufferForLayoutAudit`
  (`src/game/devLaunch.ts`) gates WebGL buffer preservation on `isDev &&`
  the query param, where `isDev` is Vite's `import.meta.env.DEV` (true under
  `npm run dev`, false in a production build) — so the recipe is "dev server
  + the query param", not the query param alone. Treat a logged
  `[layout-audit]` line as a failed check either way.

A forced `?scene=` value pins the profile regardless of viewport; add
`?ui=desktop` / `?ui=mobile` to force the profile independent of the scene
name. To exercise the real auto-detection instead of a forced pin, omit
both overrides — the rule is `compactViewport` in `detectProfile()`
(`src/game/layoutProfile.ts`), a viewport-WIDTH threshold COMBINED WITH an
aspect-ratio test (plus a separate short-edge-and-coarse-pointer branch for
phones reporting a landscape-ish `window.screen`) — not a fixed 900×900
square check. Read the function for the exact thresholds rather than
trusting a restated pair here; they are the kind of number that drifts.

## Viewports (`src/game/layoutProfile.ts`)

| Profile | Canvas | Constant |
|---|---|---|
| Desktop | 1440×900 | `DESKTOP_PROFILE` |
| Mobile | 412×892 (real CSS px, no scale factor) | `MOBILE_PROFILE` |

## Audit scripts — what each needs and does

Script names are `package.json`'s. Each takes an output directory as its
first argument (`process.argv[2]`; defaults are `.` or `tmp`) — always pass
scratch (`tmp/`, gitignored), never the repo root, because they write
screenshots and JSON reports there. Each reads `WORLD1_DEV_URL` if the dev
server is not on `http://localhost:5173`. The direct-`node` form runs whether
or not the clone has `node_modules/.bin`.

| Command | Script | Needs | Does |
|---|---|---|---|
| `npm run audit:hud` | `scripts/run-hud-audit.ts` | `dev` + `api` | Playwright walks a real playthrough (Map → Draft → Map → node → Deck Build → Retire) at BOTH viewports, collecting every painted Text's bounds and checking overlap, off-canvas, and required HUD strings |
| `npm run audit:cardface` | `scripts/card-face-truncation-audit.ts` | `dev` | Opens `?scene=mwiki&layoutAudit=1` at 412×892 and measures card-title / card-body text at every call-site width the script knows (wiki gallery, shop docks, reward slots, detail pane), against a recorded ceiling per width |
| `npm run shop:smoke` | `scripts/shop-smoke.ts` | `dev` + `api` | A real RUN MODE shop (finite gold), buy + reroll flow at BOTH viewports |


## Manual layout checklist (from `docs/ui-workbook.md`)

- No label touches or visually crowds a border.
- Adjacent controls keep at least 8px of visible separation.
- Text never overlaps icons, values, cards, or neighboring controls at rest
  (persistent overlay text at rest is a defect; only transient animation
  text may cross other UI).
- Long labels work in both inactive and selected states; touch targets stay
  clear even when the visible control is compact.
- Prefer widening the control or shortening the label over shrinking type.
