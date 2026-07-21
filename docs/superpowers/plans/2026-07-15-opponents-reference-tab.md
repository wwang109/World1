# Opponents Reference Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a fourth, reference-only Opponents tab with a readable enemy catalog and detail sheet.

**Architecture:** Extend the UI-only `PrepView` state and launcher map. Render authored enemy data directly in `PrepScene`; opponent interactions open a modal and never write encounter selection state.

**Tech Stack:** TypeScript, Phaser 3, Vite.

## Global Constraints

- Opponents browsing must not alter `enemyTeam`, `enemyId`, levels, ranks, or titles.
- All Phaser code remains under `src/game/`.
- Detail calculations use authored fields and existing presentation helpers only.
- Fit 720x1280 portrait with strict spacing audit enabled.

---

### Task 1: Navigation And Launcher

**Files:**
- Modify: `src/game/demoState.ts`
- Modify: `src/game/devLaunch.ts`
- Modify: `src/game/scenes/PrepScene.ts`

- [x] Add `opponents` to `PrepView` and `?view=opponents` parsing.
- [x] Rebalance the tab bar into four equal controls.
- [x] Route the new view without changing existing tab behavior.

### Task 2: Opponent Catalog And Detail

**Files:**
- Modify: `src/game/scenes/PrepScene.ts`

- [x] Render eight authored opponents per page in a 2×4 grid.
- [x] Add page controls and a reference-only explanation.
- [x] Build a reusable opponent detail sheet with stats, weaknesses, rewards, and card rotation.
- [x] Confirm tile/modal interactions do not mutate fight configuration.

### Task 3: Verification And Handoff

**Files:**
- Modify: `docs/codex-ui-guide.md`
- Modify: `docs/codex-handoff.md`
- Modify: `docs/screenshot-howto.md`

- [x] Capture catalog and open detail sheet at 720x1280.
- [x] Run strict spacing audit with zero errors.
- [x] Run typecheck, build, tests, and `git diff --check`.
- [x] Record direct URL and behavior for Claude.
