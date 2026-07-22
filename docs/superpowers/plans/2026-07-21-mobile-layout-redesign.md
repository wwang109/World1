# Mobile Layout Redesign — Plan

Status: battle-screen design LOCKED (v5 mockup, 2026-07-21) · foundation +
deck-build/prep/wiki intents agreed · ready to implement in the plan's
migration order.

## Problem

Every screen is designed at 720 logical px wide and scaled with FIT. On a
~390 px-wide phone the whole UI renders at ~54%: 7-9 px fonts become ~4-5
CSS px, tap targets shrink below comfortable size, and the three-column
battle screen is cramped. Text sharpness is already handled (global 2-3×
text resolution); the problem is SIZE and DENSITY, not blur.

## Locked decisions (user, 2026-07-21)

1. **Two layout profiles** (option B). Desktop AND tablets share the
   current 720×1280 layouts, FIT-scaled to fill the screen (tablets are
   explicitly the same profile as desktop — user, 2026-07-21). The MOBILE
   profile applies only to phone-sized or smaller screens.
   - Boot-time selection (before the Phaser.Game is created — the two
     profiles use different canvas sizes): mobile ⇔
     `min(screen.width, screen.height) ≤ 500` CSS px AND
     `matchMedia('(pointer: coarse)')`. Phones are 320-430, smallest common
     tablets ≈ 600 — the cutoff sits in the gap; the touch guard keeps a
     narrow desktop window on desktop UI. Shorter-edge check is
     rotation-invariant; no live profile switching (per-device fact).
   - `?ui=mobile|desktop` query param overrides the heuristic (dev-launch
     pattern) — used by QA and as the escape hatch for odd devices. The
     Playwright harness screenshots every battle state on BOTH a desktop
     viewport and an emulated phone (touch + 390×844), exercising the
     real heuristic.
   - Implementation shape: a `LAYOUT_PROFILE` module in `src/game/theme.ts`
     (same pattern as `BATTLE_SIDE_LAYOUT`): canvas dimensions, font ladder,
     spacing, hit-target minimums, and per-scene constant blocks. Scenes read
     the active profile instead of hardcoding 720-space numbers.
   - Mobile profile targets a native ~412×892 canvas so a "12px" font is
     truly 12 CSS px on the phone — no scale-factor mental math.
2. **Deck build keeps drag-and-drop** as the primary interaction. Mobile
   changes are size, not model: bigger V2 card faces, bigger slots, larger
   drag hit areas, and the inspect panel reworked to fit the narrow canvas.
3. **Battle screen layout: LOCKED (v5 mockup, user-approved 2026-07-21).**
   Scratchpad mockup `mobile-battle-final.html` (v5 png shared in session).
   Top → bottom:
   - **Log dock (top)**: turn line (`T3 · Hero 18 · SPD +16 · …`) + ~4 log
     rows at 13px in the locked message-sheet grammar, `D:` math sub-lines
     included; `LOG ▼` expands the dock downward over the boards for full
     history.
   - **HP block**: both focused units' bars with big `cur/max` numbers,
     shield strip, status line beneath.
   - **Roster chips** (teams): one chip per unit per side, TRUE ROSTER
     ORDER always (focus never reorders — order matters because the front
     slot holds default aggro). Mini HP sliver per chip; gold border =
     focused (camera); **◎ TARGET badge = current aggro leader per side**,
     driven by live aggro events (taunt moves it, death passes it) —
     independent of the camera. Dead units dim with a skull.
   - **Boards (the stage)**: two columns of card tokens (name, type,
     weight, cooldown badge, slot numbers facing inward, property accent);
     `▶ NEXT` cursor frames with room to travel. Horizontal swipe on a
     column pages between that side's units (page dots below); playback
     auto-follows the acting unit, manual swipe/tap overrides until next
     turn.
   - **Vertical scrubber** in the board gutter: gold fill = progress,
     24px draggable handle labeled with position (`T3·2`). Anchor system:
     MAJOR detents per turn + MINI anchors per log row (each row already
     has a board snapshot) — drag snaps to the nearest anchor, board+log
     preview follows live. Visual rail 16px, invisible hit zone ~40px,
     axis-locked against the horizontal board swipe. Ticks compress evenly
     on long fights.
   - **Turn chips** (`‹ T1 T2 [T3] T4… ›`): precise tap-paging; scroll or
     collapse to a slider past ~7 turns.
   - **Controls**: compact segmented `1×|2×`, then DETAIL and END with
     full-width thumb targets.
   - Aura play-pulse renders on the board tokens; victory/defeat banner
     overlays the boards.

## Design targets (mobile profile)

- Body text ≥ 12 px effective; nothing below 10 px. Headings 14-18 px.
- Tap targets ≥ 40 px on their short axis.
- All text growth is paid for by DENSITY cuts (fewer always-visible
  panels, collapsible detail, swipe/pagination) — never by shrinking fonts.
- Card faces (FantasyCardTemplateV2) stay the identity anchor: bigger
  everywhere, tap → full-size modal (already built).
- Effects like the aura play-pulse must read at mobile scale.

## Screen inventory & rough intent (subject to per-screen design)

| Screen | Intent |
|---|---|
| Battle | LOCKED — v5 spec in decision 3 (`docs/mockups/mobile-battle-final.html`, `docs/screenshots/mobile-battle-final-v5.png`) |
| Deck build | LOCKED (v2+art mockups, user-approved 2026-07-21): PREP/DECK BUILD/WIKI tab bar on top · slim TEMP HOLDING strip · ACTIVE DECK left / BAG right as battle-style vertical columns (10 slots EACH, size-2 cards span two) · slim TRASH strip on the bottom (confirm on drop) · drag-and-drop primary (short horizontal hop across the gutter) · **tokens use CARD ART backgrounds with a left-anchored dark gradient overlay** (shared constant; same token component as the battle boards; art from `cardArtCatalog`) · identity pips under the deck column · tap = V2 card modal (inspect is modal-only) · **gem socketing UI: DEFERRED** (no mobile design yet — user, 2026-07-21; long-press + bottom sheet was floated, nothing locked) |
| Prep / choose fight | One enemy visible + swipe between roster entries; keep stat block + DMG/turn threat line |
| Wiki | Cards grid 2-wide; RULES tabs already single-column and reflow cleanly; TABLE view likely desktop-only or horizontally scrollable |

## Shared components (user-locked 2026-07-22)

All three mobile screens are assemblies of TWO shared components in
`src/game/ui/` — never per-scene copies:

- **CardToken — DISPLAY SPEC (user-locked 2026-07-22).** Identical on every
  screen; only size and badge set vary:
  - **Background**: the card's art (`cardArtCatalog`), cover-fit, focal
    point ~22% from the top; over it a LEFT-anchored legibility gradient
    (near-opaque panel color on the left, fading to ~20% by the right
    edge). The gradient is left-anchored on BOTH columns — text legibility
    beats visual symmetry; only the slot number mirrors.
  - **Accent stripe**: 4px property-color bar on the token's left edge,
    always.
  - **Text block**: left-aligned over the gradient with text shadow —
    name (bold, profile type ladder) + one sub-line (type icon · context
    numbers: weight in battle, effect summary in prep/bag, tier when
    relevant).
  - **Slot number**: INWARD top corner — left column top-RIGHT, right
    column top-LEFT — on every slot, filled or EMPTY (empties are flat
    panel color at ~45% opacity, no art, number only). The token reserves
    that corner so the number never collides with name or badges.
  - **Badges**: cooldown ⏳n bottom-inward corner (battle) · gem 💎
    bottom-right (deck build) · gold corner plates for ▶ NEXT (cursor) and
    DRAGGING states · cursor/drag emphasis = 3px gold outline + glow.
  - **Size-N cards** render as ONE token spanning N slot heights, numbered
    `5-6` style.
  - Fonts and paddings come from the layout profile's ladder — the same
    component renders at battle, deck-build, or prep sizes unchanged.
- **BoardColumn(pieces, side, mode, bounds)** — 10 slots, size-N cards span
  N; `side` mirrors gradient/number/accent alignment; `mode` is `playback`
  (cursor + aura pulse), `editable` (drag), or `readonly` (tap-inspect).

Screen assemblies: battle = header + log dock + 2×BoardColumn(playback) +
scrubber · deck build = tabs + holding + 2×BoardColumn(editable) + trash ·
prep = tabs + enemy sheet + BoardColumn(readonly)×2. The invariant across
all screens: YOUR deck is the LEFT column, the opposition is the RIGHT.

## Migration order

1. `LAYOUT_PROFILE` foundation in theme.ts + boot-time selection + a
   Playwright screenshot harness at 390×844 (device-emulated) so every step
   is verified at real phone scale.
2. Battle screen — per the locked v5 spec.
3. Deck build.
4. Prep + wiki reflows.

## Constraints

- `src/game` only — engine/run/data untouched (layer boundaries).
- Desktop layouts must remain byte-identical while the mobile profile is
  built (profile default = desktop when viewport is wide).
- Every step lands with phone-scale screenshots for review before commit.
