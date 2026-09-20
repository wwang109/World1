# Screen pairs — pre-grepped from `src/game/scenes/`

Verified by `ls src/game/scenes/`, 2026-09-15. This is a snapshot of what
exists, not an enumeration to keep in sync by hand — re-run the `ls` in
`SKILL.md` §1 before trusting this on a tree that has moved.

## Paired (Desktop + Mobile, both present)

| Screen | Desktop | Mobile |
|---|---|---|
| Battle | `DesktopBattleScene.ts` | `MobileBattleScene.ts` |
| Deck build | `DesktopDeckBuildScene.ts` | `MobileDeckBuildScene.ts` |
| Draft | `DesktopDraftScene.ts` | `MobileDraftScene.ts` |
| Prep | `DesktopPrepScene.ts` | `MobilePrepScene.ts` |
| Run event | `DesktopRunEventScene.ts` | `MobileRunEventScene.ts` |
| Run map | `DesktopRunMapScene.ts` | `MobileRunMapScene.ts` |
| Run prep | `DesktopRunPrepScene.ts` | `MobileRunPrepScene.ts` |
| Shop | `DesktopShopScene.ts` | `MobileShopScene.ts` |
| Wiki | `DesktopWikiScene.ts` | `MobileWikiScene.ts` |

At the time of writing, every screen that has a Desktop side also has a
Mobile side — no one-sided screen found. If your `ls` turns up a
`Desktop*Scene.ts` with no `Mobile*Scene.ts` counterpart (or vice versa),
that is exactly the half-done state §1 warns about; do not treat it as a
pre-existing exception without checking `docs/feature-inventory.md` for
whether that screen is deliberately single-platform.

## Not a platform pair (shared/singleton scenes)

These have no Desktop/Mobile prefix and are not a violation of the
both-platforms rule — they are shared infrastructure, not a per-platform
composition:

- `BootScene.ts` — boot/profile-selection, runs before a platform is chosen
- `StartScene.ts` — title/entry scene
- `UiKitScene.ts` — component sandbox, dev-only

## Shared chrome and geometry an edit will usually touch

Verified present:

| Module | Role |
|---|---|
| `src/game/ui/runScreenTemplate.ts` | Single source of truth for the Run Mode screen chrome — kicker/title/stats/badge/actions/content/footer rects, both platforms |
| `src/game/ui/cardTokenSpec.ts` | Card-strip token + accessory-rail geometry |
| `src/game/ui/fantasyCardTemplateSpec.ts` | Full-card geometry |
| `src/game/layoutProfile.ts` | `DESKTOP_PROFILE` (1440×900) / `MOBILE_PROFILE` (412×892) and profile-selection logic |
| `src/game/runStore.ts` | The Phaser-side bridge into `src/run` state |
| `src/game/sceneRebuild.ts` | `rebuildScene()` — the only re-render path (see `SKILL.md` §3) |
| `src/game/battleApi.ts` | The client's one caller into the battle service — combat itself is never run in `src/game` (see `SKILL.md` §2) |

## How a shared module is proved

No test file pins any of these, and none may (`CLAUDE.md` § "Verification
is by evidence — no test files"). A change to a shared module is proved
through the screens that consume it:

- `runScreenTemplate.ts`, `layoutProfile.ts`, `sceneRebuild.ts` — `npm run
  audit:hud` walks the Run Mode screens at both viewports and checks painted
  text for overlap/off-canvas; plus a screenshot PAIR of at least one
  consuming screen (`SKILL.md` §4).
- `cardTokenSpec.ts`, `fantasyCardTemplateSpec.ts` — `npm run audit:cardface`
  measures card-face text at every call-site width it knows; plus a
  screenshot pair of a card-bearing screen (wiki, shop, reward).
- `battleApi.ts` — `node scripts/check-boundaries.mjs` (the thin-client
  rule) and a battle screenshot pair with `npm run api` running.

The commands, prerequisites and real output are in
`references/verifying-a-screen.md`.
