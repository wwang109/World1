> **HISTORICAL** — a dated superpowers plan/spec, accurate as of its date; superseded by the shipped implementation (see `docs/feature-inventory.md`). Never cite as current.

# Readiness Combat Rebuild Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the one-performance initiative comparison with Claude's deterministic readiness-turn, multi-cast, cursor-traversal model and render its tagged events in the portrait battle log.

**Architecture:** `simulate()` remains the only combat authority. Combatant state stores persistent readiness and a board-slot cursor; a pure selector reports the next card or cooling wait, while the simulator owns gain, play ordering, cost payment, busy traversal, and turn completion. The engine emits additive structured `gain/play/cost/cursor/busy/wait/end` events while retaining effect events needed by existing mechanics; Phaser only formats and highlights those events.

**Tech Stack:** TypeScript 5.8, Vitest 3, Phaser 3.90, Vite 7.

## Global Constraints

- Follow `docs/combat-model-spec.md`; weight is readiness cost and size is cursor footprint.
- Every living combatant gains effective Speed exactly once at the start of each gameplay turn.
- Play order is highest readiness, then higher effective Speed, then player side, then lower unit index.
- Cooldowns count gameplay turns: cast on T is unavailable T+1 through T+cooldown and returns T+cooldown+1.
- Simulation remains deterministic and integer-only; all RNG stays in the existing seeded `Rng`.
- The UI reads events and never recalculates combat eligibility, ordering, damage, cursor movement, or cooldowns.

---

### Task 1: Tagged event and state contract

**Files:**
- Modify: `src/engine/combat/events.ts`
- Modify: `src/engine/combat/state.ts`
- Modify: `src/engine/types.ts`
- Test: `tests/engine/readiness.test.ts`

**Interfaces:**
- Produces: persistent `CombatantState.readiness: number` and tagged `CombatEvent` variants `gain`, `play`, `cost`, `cursor`, `busy`, `wait`, and `end`.
- Preserves: existing effect/result events (`damage`, `heal`, statuses, death, combat end) and stable `(side, unit)` identity.

- [ ] **Step 1: Write a failing state/event contract test**

Create a minimal two-card hero versus one-card enemy setup and assert that turn 1 begins with two `gain` events carrying exact before/after readiness.

- [ ] **Step 2: Run the focused test and confirm RED**

Run: `npx vitest run tests/engine/readiness.test.ts`

Expected: FAIL because `gain` is not a valid emitted event.

- [ ] **Step 3: Add the state field and discriminated event variants**

Define exact integer fields from `docs/combat-model-spec.md` §5.2. Keep aura sources on `play` and keep target identity optional for support/AoE compatibility.

- [ ] **Step 4: Run typecheck and the focused test**

Run: `npm run typecheck` and `npx vitest run tests/engine/readiness.test.ts`.

Expected: typecheck clean; the test remains RED only because simulation has not emitted gains yet.

### Task 2: Card selection, cooldown scan, and cursor footprint

**Files:**
- Modify: `src/engine/combat/castSelect.ts`
- Test: `tests/engine/readiness.test.ts`

**Interfaces:**
- Produces: a deterministic scan result containing either an available `CastChoice`, a cooling card with `turnsLeft`, or no card.
- Consumes: `CombatantState.castCursor`, board pieces, current gameplay turn, and existing aura/weight resolution.

- [ ] **Step 1: Add failing tests for aura plays, cooling scans, and wrapped selection**

Assert that an aura-only card is playable, a cooling card is skipped for a later card, and a one-card cooling board reports the exact remaining turns.

- [ ] **Step 2: Run the selector tests and confirm RED**

Run: `npx vitest run tests/engine/readiness.test.ts -t "selection"`.

Expected: FAIL because the old selector skips passives and returns only `CastChoice | null`.

- [ ] **Step 3: Implement the minimal scan result**

Scan board order from the cursor, wrap once, skip empty slots and cooling starts, allow aura cards, and retain the current aura-adjusted effective weight clamped to at least 1.

- [ ] **Step 4: Run the selector tests and confirm GREEN**

Run: `npx vitest run tests/engine/readiness.test.ts -t "selection"`.

Expected: all selection tests pass.

### Task 3: Readiness gain and multi-cast resolve loop

**Files:**
- Modify: `src/engine/combat/simulate.ts`
- Modify: `src/engine/combat/interpreter.ts`
- Test: `tests/engine/readiness.test.ts`
- Modify: readiness-dependent existing tests under `tests/engine/` only where the old one-cast schedule was asserted.

**Interfaces:**
- Consumes: scan results from Task 2 and existing `applyCast()` effect resolution.
- Produces: ordered tagged events and final deterministic combat state.

- [ ] **Step 1: Add the worked-example failing test**

Use fixed no-crit stats and cards equivalent to Jab (8), Poke (8), Greatswing (20/size 3), and Slash (10). Assert T1 hero plays twice, T2 hero then enemy play, T3/T4 hero emits busy traversal, costs preserve leftover readiness, and waits expose affordability/cooldown.

- [ ] **Step 2: Run the worked-example test and confirm RED**

Run: `npx vitest run tests/engine/readiness.test.ts -t "worked example"`.

Expected: FAIL because the old loop emits one performer per turn and resets bank to zero.

- [ ] **Step 3: Implement gain and resolve phases**

At each turn: tick start effects; add effective Speed to every living unit; advance each mid-card cursor once and mark it busy for this turn; repeatedly select the highest-readiness affordable non-busy combatant; emit `play`; resolve the cast; emit `cost`; advance cursor one slot; stop that unit's chain after a size>1 play; then emit one authoritative wait for each non-busy unit that cannot play and finish with `end`.

- [ ] **Step 4: Move readiness-affecting effects to the new state field**

Update stagger to drain readiness and report an authoritative post-drain value. Preserve all existing targeting, aura, damage, healing, status, sudden-death, fatigue, and deterministic RNG paths.

- [ ] **Step 5: Run the focused engine suite and confirm GREEN**

Run: `npx vitest run tests/engine/readiness.test.ts tests/engine/cooldowns.test.ts tests/engine/comparison.test.ts tests/engine/determinism.test.ts`.

Expected: all focused tests pass under the readiness contract.

### Task 4: CLI and portrait battle playback

**Files:**
- Modify: `scripts/fight.ts`
- Modify: `src/game/scenes/BattleScene.ts`
- Modify: `docs/codex-ui-guide.md`

**Interfaces:**
- Consumes: tagged `CombatEvent` variants only for readiness log sequencing.
- Produces: readable text output and selectable mobile event rows keyed to exact `(side, unit, slot, skillId)` data.

- [ ] **Step 1: Update the CLI formatter**

Print each tagged event in the approved `T# tag actor details` shape; print effect events as indented results without deriving engine values.

- [ ] **Step 2: Replace comparison rows with tagged event rows**

Group visually by gameplay turn, color actor/result lines by side, retain compact no-gap paging, and show `gain`, multiple `play` entries, `cost`, `cursor`, `busy`, `wait`, and `end` in chronological order.

- [ ] **Step 3: Wire row selection to board highlighting**

For `play` highlight the casting card and target combatant; for `cursor`, `busy`, and `wait` highlight the referenced card/cell; for `gain`/`cost` highlight the combatant. Clear previous highlights before applying the selected event.

- [ ] **Step 4: Run typecheck and build**

Run: `npm run typecheck` and `npm run build`.

Expected: both exit 0.

### Task 5: Full verification and handoff

**Files:**
- Modify: `docs/codex-handoff.md`
- Update: `docs/screenshots/battle-portrait.png`

- [ ] **Step 1: Run the full deterministic verification set**

Run: `npm test`, `npm run typecheck`, `npm run build`, and `npm run fight -- bandit_duelist 1`.

Expected: zero test failures; output contains multiple same-turn plays when readiness permits and no legacy comparison formula.

- [ ] **Step 2: Inspect the portrait UI at 720×1280**

Confirm no horizontal overflow, no clipped feed controls, readable turn grouping, actor color coding, and correct card highlights when selecting play/wait/busy rows.

- [ ] **Step 3: Append the Claude handoff**

Record the engine contract, migration decisions, changed files, verification counts, UI behavior, and any residual compatibility decisions.

