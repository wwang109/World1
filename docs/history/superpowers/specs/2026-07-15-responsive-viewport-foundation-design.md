> **HISTORICAL** — a dated superpowers plan/spec, accurate as of its date; superseded by the shipped implementation (see `docs/feature-inventory.md`). Never cite as current.

# Responsive Viewport Foundation

## Goal

Center the game correctly on phones and tablets, scale the portrait game without overflow, and expose stable viewport profiles for a future dedicated wide layout.

## Profiles

- `phone-portrait`: viewport width below 768 pixels unless the wide rule matches.
- `tablet-portrait`: viewport width at least 768 pixels unless the wide rule matches.
- `wide`: viewport width at least 900 pixels and aspect ratio at least 1.15.
- Phone landscape remains on the portrait game because it does not meet the 900-pixel wide threshold.

## Current Rendering

- Keep the game's logical resolution at 720 x 1280 for all profiles in this foundation pass.
- Keep Phaser `FIT` scaling so the complete canvas is always visible without cropping or scrolling.
- Replace double centering with one CSS Grid centering owner and set Phaser to `NO_CENTER`.
- Phone portrait fills the available width when width is the limiting dimension.
- Tablet portrait and wide screens display the portrait canvas centered with surrounding page space.
- A future 1280 x 800 layout may consume the `wide` profile without changing the profile contract.

## API

- Add `src/game/ui/viewportProfile.ts` with a pure `classifyViewport(width, height)` function.
- Export profile names and logical portrait/wide dimensions from that module.
- Add the active profile as `data-viewport-profile` on `#app` for browser inspection and future CSS/layout routing.
- Reclassify on browser resize and orientation changes without restarting the current Phaser scene during this foundation pass.

## State And Behavior

- Deck, encounter, seed, scene, log playback, and selected card state remain untouched during resize.
- The UI does not recompute combat or change event playback.
- This pass does not create a wide Battle or Prep scene; it only provides the reliable detection and centering layer those scenes will use.

## Verification

- At 390 x 844, canvas bounds remain within the viewport with no scrolling.
- At 1024 x 1366, the portrait canvas is horizontally centered.
- At 1366 x 768, the portrait canvas is horizontally centered and `#app` reports `wide`.
- Resize updates `data-viewport-profile` without reloading the scene.
- Run type checking, production build, and the full test suite.
