> **HISTORICAL** — a dated superpowers plan/spec, accurate as of its date; superseded by the shipped implementation (see `docs/feature-inventory.md`). Never cite as current.

# Battle Log Paging And Skill Highlight Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the selected prep deck launch a playable deterministic battle view with a continuous speed log, ten-turn paging, and synchronized highlights for both skills compared on a tapped turn.

**Architecture:** Keep `PrepScene -> demoState -> BattleScene -> simulate()` as the source-of-truth flow. `BattleScene` projects each `comparison` and same-turn result events into compact rows; selecting a row updates the detail HUD and board-card strokes without recomputing combat.

**Tech Stack:** TypeScript, Phaser 3, existing deterministic combat events, Vite.

## Global Constraints

- Modify UI only under `src/game/` plus shared documentation.
- Do not edit `src/engine/`, `src/data/`, `src/run/`, or `tests/`.
- Preserve the 720x1280 portrait canvas and prevent overflow.
- Show event values exactly; do not simulate cooldowns, initiative, or damage in the scene.

---

### Task 1: Replace round grouping with continuous pages

**Files:**
- Modify: `src/game/scenes/BattleScene.ts`

**Interfaces:**
- Consumes: `CombatEvent[]`, especially `comparison.entries`, `performer`, and `performerUnit`.
- Produces: ten compact `ActivationRow` entries per page with previous/next page controls.

- [x] Remove `RoundGroup`, `selectedRound`, and round-button state.
- [x] Store each turn's comparison entries on its `ActivationRow`.
- [x] Render ten chronological rows per page and label the visible turn range.
- [x] Make page controls clear the prior turn selection and select the first row on the new page.

### Task 2: Synchronize tapped rows with both board cards

**Files:**
- Modify: `src/game/scenes/BattleScene.ts`
- Modify: `src/game/theme.ts`

**Interfaces:**
- Consumes: each selected row's queued `(side, unit, queuedSlot, queuedSkillId, state)` entries.
- Produces: `ACTIVATED` highlight for the performer and `FAILED / SPEED BANKED` highlight for ready non-performers.

- [x] Make row backgrounds interactive and preserve a selected-row visual state.
- [x] Clear every board-card highlight before selecting a new turn.
- [x] Highlight the performer with the semantic success color and ready losers with the semantic waiting color.
- [x] Update the comparison panel with both speed formulas, bank outcomes, activation, and first result line.
- [x] Treat `nothingUsable` as idle/wasted with unchanged bank, matching Claude's event contract.

### Task 3: Verify the playable flow and hand off

**Files:**
- Modify: `docs/codex-handoff.md`
- Refresh: `docs/screenshots/battle-portrait.png`

- [x] Run `npm run typecheck`, `npm run build`, and `npm test`.
- [x] Launch the prep view at 720x1280, confirm a non-empty deck can start Battle, and inspect page/row/card interactions.
- [x] Capture and inspect a battle screenshot for overlap and overflow.
- [x] Append the result and any remaining engine requests to the shared ledger.
