# Run Mode Event + Day UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the approved Option 1 + Option 3 Run Mode UI: a compact event planner attached to the existing route board, with clear five-wave day progress on desktop and mobile.

**Architecture:** Keep Run Map and Run Event as the existing scene entry points and keep all state transitions in `src/game/runStore.ts`. Extract only presentation helpers that consume plain view models: a progress strip, route-board geometry, and reusable choice panels. Desktop and mobile scenes will compose those helpers with their existing profile-specific layouts and retain their current shop, fight, event, outcome, and draft-picker routing.

**Tech Stack:** TypeScript, Phaser 3 in `src/game/` only, existing `theme.ts`, `layoutProfile.ts`, `displayLibrary.ts`, and `controlLayoutAudit.ts` utilities.

## Global Constraints

- Only `src/game/` may import `phaser`.
- Do not edit `src/engine/`, `src/data/`, or `tests/`.
- The battle UI remains unchanged; Run UI is a dumb selection/playback surface over `runStore`.
- The current run model remains five waves; display the requested day framing as `DAY n / 5`, derived from the current/next column wave.
- All visual constants use the existing navy/bronze theme and profile typography; do not add a second design system.
- Desktop keeps the horizontal route board; mobile keeps the vertical route board.
- Changed controls must pass `layoutAudit=1` with no red outlines or `[layout-audit]` errors.
- Preserve unrelated user changes in `src/game/ui/RunStatPanel.ts`, `src/game/ui/hoverTip.ts`, and `.claude/settings.local.json`.

## Files and responsibilities

- Create `src/game/ui/RunProgressStrip.ts`: derive a plain progress snapshot from `RunState` and render the shared day/wave markers and compact run status.
- Create `src/game/ui/RunRouteBoard.ts`: render the map's cleared/current/future column geometry and wave bands from a plain route snapshot; it owns no node selection or run transitions.
- Create `src/game/ui/RunChoicePanel.ts`: render one event/shop/fight/boss choice surface from a plain choice view model and expose only an `onSelect` callback.
- Modify `src/game/scenes/DesktopRunMapScene.ts`: compose the shared helpers into the desktop map while preserving existing node routing, stat panel, start panel, and victory/defeat behavior.
- Modify `src/game/scenes/MobileRunMapScene.ts`: compose the shared helpers into the mobile map while preserving the portrait route and existing node routing.
- Modify `src/game/scenes/DesktopRunEventScene.ts`: add the shared progress/status chrome and restyle the existing event choice, outcome, and bonus-draft states.
- Modify `src/game/scenes/MobileRunEventScene.ts`: add the compact progress/status chrome and restyle the existing mobile event states.
- Modify `docs/codex-handoff.md`: append the session entry after implementation and verification, including any engine request if one is discovered.

No new engine/data/test files are expected for this UI pass.

---

### Task 1: Add shared Run Mode presentation helpers

**Files:**
- Create: `src/game/ui/RunProgressStrip.ts`
- Create: `src/game/ui/RunRouteBoard.ts`
- Create: `src/game/ui/RunChoicePanel.ts`

**Interfaces:**

`RunProgressStrip.ts` consumes `RunState` through the `RunState` type re-exported by `src/game/runStore.ts` and produces:

```ts
export interface RunProgressSnapshot {
  currentWave: number;
  waveCount: number;
  currentDepth: number;
  totalDepth: number;
  gold: number;
  heroLevel: number;
  wins: number;
  losses: number;
}

export function snapshotRunProgress(run: Readonly<RunState>): RunProgressSnapshot;
export function renderRunProgressStrip(
  scene: Phaser.Scene,
  bounds: { x: number; y: number; w: number },
  snapshot: RunProgressSnapshot,
  opts?: { compact?: boolean; track?: Phaser.GameObjects.GameObject[] },
): void;
```

The snapshot derives the wave from the next available map column, falling back to the current column and then wave 1, matching the existing map header. The rendered copy is `DAY n / 5` with `WAVE n / 5` or the compact equivalent; it never introduces a new persisted day value.

`RunRouteBoard.ts` consumes this plain snapshot shape:

```ts
export interface RunRouteColumnSnapshot {
  depth: number;
  wave: number;
  nodeCount: number;
  state: 'cleared' | 'current' | 'future';
}

export interface RunRouteSnapshot {
  columns: readonly RunRouteColumnSnapshot[];
  currentDepth: number;
  nextDepth: number;
}

export function snapshotRunRoute(run: Readonly<RunState>): RunRouteSnapshot;
export function renderRunRouteBoard(
  scene: Phaser.Scene,
  bounds: { x: number; y: number; w: number; h: number },
  route: RunRouteSnapshot,
  opts: { mode: 'desktop' | 'mobile'; track?: Phaser.GameObjects.GameObject[] },
): void;
```

The board draws the existing alternating wave bands, depth labels, cleared pips, current marker, and dimmed future node previews. It does not make nodes interactive; the scene still owns the choice hit targets and routing.

`RunChoicePanel.ts` consumes a plain view model:

```ts
export interface RunChoiceViewModel {
  nodeId: string;
  kind: RunNodeKind;
  title: string;
  detail: string;
  footer?: string;
  accent: number;
  enabled: boolean;
}

export function renderRunChoicePanel(
  scene: Phaser.Scene,
  bounds: { x: number; y: number; w: number; h: number },
  model: RunChoiceViewModel,
  opts: { font: LayoutProfile['font']; onSelect: () => void; track?: Phaser.GameObjects.GameObject[] },
): void;
```

The panel uses the existing square panel, accent rail, slot-hover fill, and layout-audit helpers. An unavailable choice remains visible but does not get an interactive handler. The helper never imports `src/run/` and never calls `runStore`.

- [ ] **Step 1: Implement the three plain view-model interfaces and exports.**
- [ ] **Step 2: Implement `snapshotRunProgress` and `snapshotRunRoute` using the existing current/next-column fallback rules.**
- [ ] **Step 3: Implement the shared progress strip using `UI`, `FONT`, `SCREEN`, and profile sizing; render five markers with cleared/current/future states.**
- [ ] **Step 4: Implement the route board's desktop horizontal and mobile vertical geometry without interactive node behavior.**
- [ ] **Step 5: Implement the choice panel with a single hit target and `auditControlLabel`/`auditTextBlock` checks.**
- [ ] **Step 6: Run `npm run typecheck` and `npm run build` to catch helper API or Phaser typing errors before integrating scenes.**
- [ ] **Step 7: Commit the helpers with `git add src/game/ui/RunProgressStrip.ts src/game/ui/RunRouteBoard.ts src/game/ui/RunChoicePanel.ts` and `git commit -m "feat: add shared run mode ui helpers"`.**

### Task 2: Integrate the shared route board into Desktop Run Map

**Files:**
- Modify: `src/game/scenes/DesktopRunMapScene.ts`

**Interfaces:**

- Consume `snapshotRunProgress`, `snapshotRunRoute`, `renderRunProgressStrip`, `renderRunRouteBoard`, and `renderRunChoicePanel` from Task 1.
- Continue consuming `choices`, `pickNode`, `previewEncounter`, `enemyNameFor`, `shopCatalog`, and `eventThemeBlurb` through the existing imports.
- Produce the same scene routes: `DesktopShop`, `DesktopRunEvent`, and `DesktopRunPrep` after `pickNode(node.id)`.

- [ ] **Step 1: Replace the existing desktop header-only stats row with the shared progress strip while retaining the banked-PL badge and stat-panel callback.**
- [ ] **Step 2: Render the shared horizontal route board behind the expanded next-choice column, preserving the current wave bands and depth labels.**
- [ ] **Step 3: Convert each `RunNode` from `choices()` into a `RunChoiceViewModel`: event rows use the existing event theme blurb, shops use the existing shop tagline/shelf count, and fights/bosses use the existing `previewEncounter`/`enemyNameFor` display.**
- [ ] **Step 4: Render the choice rows with the shared choice panel and keep `pickNode` plus the existing scene-name routing inside the desktop scene callback.**
- [ ] **Step 5: Keep the start-run panel, drafting redirect, victory/defeat banner, deck/bag button, stat panel, and reroll behavior unchanged.**
- [ ] **Step 6: Run `npm run typecheck` and `npm run build`.**
- [ ] **Step 7: Commit with `git add src/game/scenes/DesktopRunMapScene.ts && git commit -m "feat: refresh desktop run map choices"`.**

### Task 3: Integrate the shared route board into Mobile Run Map

**Files:**
- Modify: `src/game/scenes/MobileRunMapScene.ts`

**Interfaces:**

- Consume the Task 1 helpers and the existing mobile `MOBILE_PROFILE`/`SCREEN` geometry.
- Preserve `choices`, `pickNode`, `previewEncounter`, `enemyNameFor`, `shopCatalog`, `eventThemeBlurb`, deck context, stat panel, start-run, and banner behavior.

- [ ] **Step 1: Add the compact shared progress strip below the mobile Run title and deck/bag entry point, showing `DAY n / 5`, `WAVE n / 5`, gold, hero level, and W/L without clipping.**
- [ ] **Step 2: Render the vertical route board with five labeled wave/day bands and the active current column centered above the next-stop choices.**
- [ ] **Step 3: Convert mobile choices into the same `RunChoiceViewModel` used by desktop so event, shop, fight, and boss copy stays consistent.**
- [ ] **Step 4: Render stacked mobile choice rows with the shared hit-target and route the callback through the existing `pickNode` scene transitions.**
- [ ] **Step 5: Keep drafting, victory/defeat, start-run, reroll, deck/bag, stat-panel, and current-node behavior unchanged.**
- [ ] **Step 6: Run `npm run typecheck` and `npm run build`.**
- [ ] **Step 7: Commit with `git add src/game/scenes/MobileRunMapScene.ts && git commit -m "feat: refresh mobile run map choices"`.**

### Task 4: Refresh Desktop Run Event with day context and event planner hierarchy

**Files:**
- Modify: `src/game/scenes/DesktopRunEventScene.ts`

**Interfaces:**

- Consume `snapshotRunProgress` and `renderRunProgressStrip` from Task 1.
- Preserve `currentEventDef`, `resolveCurrentEventChoice`, `applyCurrentBonusDraftPick`, `leaveCurrentEvent`, `skillBook`, `gemBook`, `CardToken`, `choiceOutcomeHint`, and `outcomeHeadline` behavior.

- [ ] **Step 1: Add the shared progress/status strip below the existing `WORLD1 / RUN MODE` chrome and keep gold visible in the same top band.**
- [ ] **Step 2: Rework the choice panel geometry into the approved framed event-planner hierarchy: event title/body first, then compact choice rows with cost and outcome hint aligned in the same row.**
- [ ] **Step 3: Keep affordability exactly as-is: unaffordable choices remain dimmed and non-interactive; affordable choices call `resolveCurrentEventChoice(event.id, choice.id)` once.**
- [ ] **Step 4: Restyle the bonus-draft picker and outcome panel so both retain the shared day context, existing card/gem rendering, and `CONTINUE ›` behavior.**
- [ ] **Step 5: Add layout-audit coverage to every changed choice/continue control and text block.**
- [ ] **Step 6: Run `npm run typecheck` and `npm run build`.**
- [ ] **Step 7: Commit with `git add src/game/scenes/DesktopRunEventScene.ts && git commit -m "feat: refresh desktop run event ui"`.**

### Task 5: Refresh Mobile Run Event with compact day context

**Files:**
- Modify: `src/game/scenes/MobileRunEventScene.ts`

**Interfaces:**

- Consume the shared progress strip and choice-panel view model/presentation from Task 1.
- Preserve the existing event phases, event resolver calls, card/gem outcome rendering, and return-to-map behavior.

- [ ] **Step 1: Add the compact day/wave strip and status line to the mobile event header without moving the gold value outside the safe width.**
- [ ] **Step 2: Render the event title/body and stacked choice rows with consistent labels, cost copy, reward hints, and full-width minimum tap targets.**
- [ ] **Step 3: Keep all unaffordable rows visible but dimmed and non-interactive; keep the existing event resolver callback unchanged.**
- [ ] **Step 4: Refit the mobile bonus-draft picker, outcome card/gem, and `CONTINUE ›` button so the new header does not cause overlap or bottom clipping.**
- [ ] **Step 5: Add layout-audit checks to all changed mobile controls and bounded text blocks.**
- [ ] **Step 6: Run `npm run typecheck` and `npm run build`.**
- [ ] **Step 7: Commit with `git add src/game/scenes/MobileRunEventScene.ts && git commit -m "feat: refresh mobile run event ui"`.**

### Task 6: Verify the complete Run Mode flow and record the handoff

**Files:**
- Modify: `docs/codex-handoff.md`
- Do not modify: `src/engine/`, `src/data/`, or `tests/`

**Interfaces:**

- Verify the scene entry points and callbacks produced by Tasks 1–5.
- Record any missing engine/data contract as a request rather than working around it in a scene.

- [ ] **Step 1: Run `npm run typecheck`.**
- [ ] **Step 2: Run `npm run build`.**
- [ ] **Step 3: Run `npm test` and confirm the Phaser boundary checker remains green.**
- [ ] **Step 4: Launch the desktop Run Map with `?scene=desktop-runmap&ui=desktop&layoutAudit=1` and inspect the day strip, route board, event/shop/fight choices, deck/bag control, and stat-panel overlay.**
- [ ] **Step 5: Launch the mobile Run Map with `?scene=mrunmap&ui=mobile&layoutAudit=1` and inspect the vertical route, active day band, stacked choices, and bottom safe area.**
- [ ] **Step 6: Open both Run Event scenes, test affordable and unaffordable choices, bonus-draft selection, outcome rendering, and `CONTINUE ›` back to the map.**
- [ ] **Step 7: Open a Run Prep/Battle flow and confirm those combat surfaces retain their existing layout and behavior.**
- [ ] **Step 8: Append a newest-first handoff entry describing changed files, the `DAY n / 5` derivation, verification results, assumptions, and any request to Claude.**
- [ ] **Step 9: Run `git diff --check` and `git status --short`; confirm only the intended UI/docs files are part of the feature commits and the pre-existing user changes remain unstaged.**
- [ ] **Step 10: Commit the handoff entry with `git add docs/codex-handoff.md && git commit -m "docs: record run mode ui handoff"`.**

## Self-review checklist

- The plan covers the shared progress strip, route board, event selection, desktop/mobile map scenes, desktop/mobile event scenes, verification, and handoff requirements from the design spec.
- No task edits engine, data, or test files.
- The helper interfaces pass plain view models for rendering and callbacks for interaction; they do not own run state transitions.
- `DAY n / 5` is explicitly derived from the existing five-wave run model, so the plan does not silently add a new persisted day field.
- Every implementation step names its files, interfaces, behavior, and verification command.
- All later tasks consume the helper names and view-model types introduced in Task 1.
