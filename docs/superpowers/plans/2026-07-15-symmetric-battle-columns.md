# Symmetric Battle Columns Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Align all battle headers and panels to a symmetric grid without selection highlights changing panel size.

**Architecture:** Update only BattleScene presentation geometry. Use fixed outer lane bounds and represent roster selection with an interior accent object rather than a wider Phaser stroke.

**Tech Stack:** TypeScript, Phaser 3, Vite, Playwright visual verification

## Global Constraints

- Modify only `src/game/` UI code plus Codex documentation and screenshots.
- Do not change combat simulation, event playback, data, or tests.
- Preserve the 720 x 1280 portrait layout and all current vertical positions.

---

### Task 1: Symmetric Columns And Stable Selection

**Files:**
- Modify: `src/game/scenes/BattleScene.ts`
- Modify: `docs/codex-handoff.md`
- Create: `docs/screenshots/battle-symmetric-columns.png`
- Create: `docs/screenshots/battle-symmetric-columns-multi.png`

**Interfaces:**
- Consumes: existing `PLAYER_PANEL`, `LOG_PANEL`, `ENEMY_PANEL`, `RosterChip`, `drawRosterStrip`, and `focusEnemy` presentation state.
- Produces: 202/236/202-pixel columns with 12-pixel gaps and fixed-size roster selection accents.

- [x] **Step 1: Apply symmetric lane geometry**

Set Party to `{ x: 28, w: 202 }`, Turn Log to `{ x: 242, w: 236 }`, and Enemies to `{ x: 490, w: 202 }`. Align all three headers and their direct panels to those exact bounds.

- [x] **Step 2: Add inset roster selection**

Extend `RosterChip` with an inner accent rectangle. Keep the outer stroke at 1 pixel, toggle the accent visibility in `focusEnemy`, and include it in damage-shake targets.

- [x] **Step 3: Run static verification**

Run `npm run typecheck`. Expected: exit code 0 with no TypeScript errors.

- [x] **Step 4: Verify portrait rendering**

Capture Bandit Duelist and two-enemy scenes at 720 x 1280. Select each enemy and confirm header/panel edges align, both side rails are equal, the selected chip does not grow, and no content overflows.

- [x] **Step 5: Record the handoff**

Add a newest entry to `docs/codex-handoff.md` describing the symmetric columns, stable inset selection, screenshots, and verification results.

- [x] **Step 6: Run complete verification**

Run `npm run typecheck`, `npm run build`, and `npm test`. Expected: all commands exit 0 and all tests pass.
