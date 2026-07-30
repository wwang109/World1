# Run Mode Event Planner + Route Board Design

**Status:** Approved visual direction; awaiting written-spec review

**Date:** 2026-07-30

## Goal

Refresh the Run Mode navigation UI so event selection feels intentional and the player can understand their current day/wave at a glance, while preserving the existing combat screen and run-map identity.

The selected direction combines:

- Option 1's compact event planner: readable, selectable event rows with concise risk/reward information.
- Option 3's tactical route board: the existing node trail remains the primary mental model, with the current route and day/wave highlighted.

## Existing context and constraints

- The current run is five waves. Each wave contains 2–3 event/shop stops and ends in one mandatory fight; wave five ends in the boss.
- The current map already renders wave bands, node-kind colors, depth labels, mandatory columns, and 2–3 next-node choices.
- The current event flow already supports an event title/body, 2–3 choices, cost/reward hints, outcomes, bonus card picks, and a return to the map.
- The run UI reads through `src/game/runStore.ts`; it must not recompute map generation, encounters, event outcomes, or RNG.
- Only `src/game/` may import Phaser. Do not edit `src/engine/`, `src/data/`, or `tests/` for this UI pass.
- The visual language remains the existing dark navy, bronze/gold, steel-blue, green, and red palette; square framed panels; thin rules; serif display typography; and compact uppercase labels.
- Desktop and mobile scenes remain separate responsive surfaces, using the existing 1440×900 desktop and 720×1280 portrait profiles.

## Terminology decision

The first UI pass will present the existing five-wave progression as `DAY n / 5` with `WAVE n / 5` as the secondary label where space allows. This gives the mode the requested day-based framing without inventing a new ten-day state or changing the run model.

The day number is derived from the same next-column/current-column wave lookup already used by the map header. A future true day system can replace this display value through a run-state contract, but it is explicitly out of scope here.

## Screen architecture

### Shared run chrome

Both Run Map and Run Event screens use the same compact chrome:

1. `WORLD1 / RUN MODE` eyebrow and the current screen title (`RUN` or `EVENT`).
2. A progress strip showing `DAY n / 5`, five wave/day markers, cleared markers, the current marker, and dimmed future markers.
3. Compact status values for `GOLD`, `HERO LV`, and `W · L`.
4. A `DECK / BAG` entry point that preserves the current run-context deck behavior.

The progress strip must be visually subordinate to the route board on desktop and remain compact enough to avoid pushing the next-stop choices below the first viewport on mobile.

### Route board

The route board keeps the current combat map structure rather than replacing it.

Desktop:

- Preserve the horizontal column trail and its alternating wave bands.
- Keep cleared depths as thin pips and future depths as dimmed node previews.
- Expand only the next available column into the event/shop choice area.
- Add a stronger current-day/wave rail and a small `DAY n` label aligned to the active band.
- Keep node-kind colors unchanged: steel-blue fight, bronze event, green shop, red boss.

Mobile:

- Preserve the vertical trail and compact depth rows.
- Group the trail into five clearly labeled day/wave bands without turning the map into a separate page.
- Keep the current column centered and highlighted; future nodes remain readable but dimmed.
- Place the next-stop choice list directly below the active map segment so the player can connect the choice to the route.

### Event selection planner

The next-stop area is titled `CHOOSE YOUR NEXT STOP` on the map and `EVENT SELECT` on the event-choice view.

Each event choice row contains:

- Event kind and theme label.
- Event title.
- One concise preview line describing the opportunity or danger.
- Cost (`FREE` or `COST n GOLD`).
- A short outcome hint using the existing `choiceOutcomeHint` helper.
- A clear `SELECT` affordance.

The selected/hovered row uses the existing slot-hover fill and a brighter bronze outline or side accent. Unaffordable rows remain visible and dimmed, matching the existing event behavior. The row must remain one interactive control with its label, cost, hint, and action inside the same hit target.

When an event row is selected, continue to the existing event scene and keep the current event-resolution behavior unchanged. The event scene receives the same shared progress strip and status chrome so the player never loses day/wave context.

### Event detail view

The existing event title/body and choice stack remain the source of truth for event content. The visual refresh adds:

- A compact route/day context band above the event panel.
- A framed event panel with clearer hierarchy between title, body, choices, and cost/reward hints.
- The current outcome and bonus-draft states with the same context band and `CONTINUE` behavior.

The first pass should not require new event-data fields. If event illustration assets are already available, use them in the compact event row/detail treatment; otherwise retain the existing text-first event presentation and use the shared theme styling without adding new asset work to this pass.

## Interaction and data flow

The UI remains a dumb playback/selection layer:

1. Read the active `RunState` through `runStore`.
2. Derive the visible day/wave label from the next/current map column exactly as the existing map header does.
3. Render the route board from `run.map`, `run.depth`, and `choices()`.
4. On a choice click, call `pickNode(node.id)` and route to the existing shop, event, or prep scene.
5. On an event-choice click, call `resolveCurrentEventChoice(event.id, choice.id)` and render the existing outcome or bonus-draft phase.
6. On continue, call `leaveCurrentEvent()` and return to the existing run map.

No new simulation, RNG, encounter preview math, event resolution, or persistence is introduced in the UI.

## Proposed component boundaries

Keep the scene entry points stable and extract shared presentation helpers only where they remove desktop/mobile drift:

- `src/game/ui/RunProgressStrip.ts`: draws the day/wave progress strip and exposes compact/desktop sizing options.
- `src/game/ui/RunRouteBoard.ts`: draws the existing route trail, wave bands, active column, and node-kind markers; accepts callbacks for selecting a node.
- `src/game/ui/RunChoicePanel.ts`: draws one event/shop/fight choice row with the existing `KIND_COLOR`, labels, hints, and interaction behavior.
- `src/game/scenes/DesktopRunMapScene.ts`: composes desktop chrome, route board, and expanded next-stop choices.
- `src/game/scenes/MobileRunMapScene.ts`: composes mobile chrome, vertical route board, and stacked next-stop choices.
- `src/game/scenes/DesktopRunEventScene.ts`: composes desktop event detail/outcome states with shared chrome.
- `src/game/scenes/MobileRunEventScene.ts`: composes mobile event detail/outcome states with shared chrome.

The helper APIs should accept plain render options and callbacks; they must not import from `src/run/` directly or own state transitions.

## Responsive behavior

- Desktop prioritizes route comprehension: the full horizontal trail remains visible, with the expanded next column in a wide side/center panel.
- Mobile prioritizes decision speed: the active day/wave context is visible above the choices, while the route board is compressed into a scroll-safe vertical section.
- All changed controls must use the existing control-layout audit utilities and preserve minimum readable type sizes.
- No new landscape-only layout is introduced.

## Copy and visual details

- Use `DAY n / 5` and `WAVE n / 5`; never show a fabricated `DAY n / 10` value in the implementation.
- Use `CHOOSE YOUR NEXT STOP`, `EVENT SELECT`, `SELECT`, `DECK / BAG`, `VIEW MAP`, and `CONTINUE ›` consistently.
- Keep decorative geometry limited to existing frame lines, corner brackets, wave rails, node diamonds/circles, and restrained background blooms.
- Do not introduce rounded cards, neon colors, glossy sci-fi dashboards, new font families, or a second visual identity.

## Non-goals

- No combat-scene redesign.
- No map-generation, node-choice, event-catalog, shop, or encounter-balance changes.
- No new day persistence or run-state field.
- No changes to card art, card data, engine events, or tests.
- No new route/page outside the existing Run Map and Run Event scenes.

## Verification criteria

Before implementation is considered complete:

- `npm run build` passes.
- `npm test` passes, including the Phaser boundary checker.
- `npm run typecheck` passes with strict TypeScript settings.
- Desktop and mobile Run Map screens show the active day/wave, route board, and next-stop choices without overlap or clipped text.
- Desktop and mobile Run Event screens preserve choice affordability, outcome, bonus-draft, and continue behavior.
- Clicking event/shop/fight choices still routes to the existing scenes and uses the existing run-store transitions.
- Changed controls pass the layout audit with `layoutAudit=1`; no red outlines or `[layout-audit]` errors remain.
- Combat Prep and Battle screens are visually unchanged.
