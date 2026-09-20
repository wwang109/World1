---
name: world1-screens
description: Use before editing anything a player sees in World1 — a scene, a layout, an HUD panel, or shared chrome under src/game. Enforces the both-platforms rule (a screen is a Desktop/Mobile PAIR, not one file), the src/game boundary (Phaser-only, never runs combat), the shared re-render helper, and the concrete route/viewport/audit-script/screenshot recipe for proving a layout change actually works on both platforms — by evidence, since no test file may exist in this repo.
---

# World1 screens — both platforms, always

Audits keep finding the same defect class: a fix applied to one platform in
violation of the both-platforms rule (`docs/design-locked.md`). This skill
exists to make that mistake structurally harder before the edit, not to
catch it after.

## 1. A screen is a PAIR

Every Run Mode screen is `src/game/scenes/Desktop*Scene.ts` **and**
`src/game/scenes/Mobile*Scene.ts` — two separate, layout-appropriate
compositions, never one stretched to fit the other. Before touching a
scene:

```bash
ls src/game/scenes/ | grep -i <screen-word>
```

If only ONE file comes back, the change you are about to make is half
done — check `references/screen-pairs.md` for the current pairing before
assuming a lone file is really unpaired by design (a few scenes are
genuinely single, shared chrome, not a platform pair).

## 2. The layer boundary

`src/game` is the ONLY layer allowed to import Phaser, and it may **never**
run combat — no value-import (direct or transitive) of `resolveBattle` or
`combat/simulate`; `import type` is fine. `node scripts/check-boundaries.mjs`
enforces both rules and runs first inside `npm test`. Full detail on what
counts as a violation and how the checker walks imports: the
**`world1-codemap`** skill's `references/boundaries-and-determinism.md` —
this skill does not restate it.

## 3. Re-render through the shared helper

Every scene rebuilds via `rebuildScene()` (`src/game/sceneRebuild.ts`).
Never `scene.restart()`, never a hand-rolled destroy+create — those skip
state the shared helper is responsible for carrying across the rebuild.

## 4. Proving a layout change — evidence, never a test file

No `*.test.ts` may exist in this repository (`CLAUDE.md` § "Verification is
by evidence — no test files (USER-LOCKED 2026-09-15)"). A layout is not
pinned by a test; it is proved, every time, by three things:

1. **Screenshots on BOTH platforms.** State, before you capture: the exact
   `?scene=` route, the viewport (desktop 1440×900 or mobile 412×892 — real
   CSS px, not scaled), and what the image must show (which text, which
   control, which absence of overlap). `docs/ui-workbook.md` owns the
   launch-route list, the profile-selection rules and the Playwright capture
   recipe — read it before improvising a route.
2. **The audit scripts**, run against the real dev server and pasted by
   their `Totals:` line: `npm run audit:hud`, `npm run audit:cardface`,
   `npm run shop:smoke`. `references/verifying-a-screen.md` gives the
   commands, what each needs, and what was actually run on this checkout.
3. **`npm test` green** — boundaries → both tsc projects → skill parity.
   The `src/game` rules in §2 are enforced there.

Which evidence a change to some OTHER surface needs is routed by the
**`world1-testing`** skill; this one owns the screen route.

## References

| File | Covers |
|---|---|
| `references/screen-pairs.md` | The actual Desktop/Mobile pairs in `src/game/scenes/`, flagged if any is missing a side, plus the shared chrome/spec modules a screen change usually touches and how each is proved |
| `references/verifying-a-screen.md` | The `?scene=` routes, viewports, how to start `dev`+`api`, and the audit scripts — with the real output of the ones that were run |
