# Attached Turn Detail Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Attach the selected-turn detail panel to the Turn Log header and use the recovered height for clearer combat calculations.

**Architecture:** Change only presentation geometry and text bounds in `BattleScene`. Preserve the panel bottom edge so the log feed and playback controls remain fixed, and continue rendering only precomputed event data.

**Tech Stack:** TypeScript, Phaser 3, Vite, Playwright visual verification

## Global Constraints

- Modify only `src/game/` UI code plus Codex documentation and screenshots.
- Do not change combat simulation, data, or tests.
- Keep the 720 x 1280 portrait layout and prevent overlap or overflow.

---

### Task 1: Attach And Expand Turn Detail

**Files:**
- Modify: `src/game/scenes/BattleScene.ts`
- Modify: `docs/codex-handoff.md`
- Create: `docs/screenshots/battle-turn-detail-attached.png`

**Interfaces:**
- Consumes: existing `ActivationRow`, `COMPARISON_PANEL`, `renderTurnAuraSources`, and `renderTurnCalculation` presentation state.
- Produces: an attached 234-pixel-high detail panel whose bottom edge and log-feed start position are unchanged.

- [x] **Step 1: Change panel geometry**

Set `COMPARISON_PANEL` to `{ x: LOG_PANEL.x + 12, y: 148, w: LOG_PANEL.w - 24, h: 234 }`. This aligns it with the log rows and keeps `COMPARISON_PANEL.y + COMPARISON_PANEL.h` equal to `382`.

- [x] **Step 2: Rebalance content positions**

Keep the heading at `+13`; allow four activation-summary lines from `+40`; place aura-source tokens from `+98`; place up to three result lines from `+124`; place a 38-pixel calculation strip at `+182`; and render calculation tokens from `+188`, wrapping complete tokens onto a second line when needed.

- [x] **Step 3: Run static verification**

Run `npm run typecheck`. Expected: exit code 0 with no TypeScript errors.

- [x] **Step 4: Verify portrait rendering**

Capture the single-enemy and multi-enemy battle scenes at 720 x 1280. Confirm the panel begins immediately below the lane header, the first log row still begins at `y = 394`, detail text does not overlap, and no horizontal overflow appears.

- [x] **Step 5: Record the handoff**

Add a newest entry to `docs/codex-handoff.md` describing the attached panel, unchanged combat behavior, screenshot path, and verification results.

- [x] **Step 6: Run complete verification**

Run `npm run typecheck`, `npm run build`, and `npm test`. Expected: all commands exit 0 and the full test suite passes.
