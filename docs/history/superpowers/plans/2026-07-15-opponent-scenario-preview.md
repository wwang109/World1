> **HISTORICAL** — a dated superpowers plan/spec, accurate as of its date; superseded by the shipped implementation (see `docs/feature-inventory.md`). Never cite as current.

# Opponent Scenario Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add reference-only Level, Title, and Card Tier scenario controls to Opponents.

**Architecture:** Store preview controls as `PrepScene` UI state. Resolve every tile/detail through the existing run-layer encounter builder, translating uniform tier to a rank override after title extra cards are known.

**Tech Stack:** TypeScript, Phaser 3, Vite.

## Global Constraints

- No Auto tier option.
- CLEAR resets Level 1, Normal, Bronze.
- Preview controls never mutate configured fight state.
- UI never reproduces level/title/tier combat calculations.

---

### Task 1: Preview State And Resolution

**Files:**
- Modify: `src/game/scenes/PrepScene.ts`

- [x] Add Level, Title, and Tier preview state with required defaults.
- [x] Resolve title extra cards first, then pass uniform tier rank to `buildEnemyEncounter`.
- [x] Add CLEAR behavior that restores all defaults.

### Task 2: Toolbar And Scenario Presentation

**Files:**
- Modify: `src/game/scenes/PrepScene.ts`

- [x] Add the two-row preview toolbar above opponent tiles.
- [x] Render tiles from resolved stats/decks and selected title/tier.
- [x] Render detail sheets from the same resolved encounter, including added cards.
- [x] Preserve 2×4 pagination and mobile text clearance.

### Task 3: Verification And Handoff

**Files:**
- Modify: `docs/codex-ui-guide.md`
- Modify: `docs/codex-handoff.md`

- [x] Capture default and Boss/Diamond scenarios at 720x1280.
- [x] Verify CLEAR and reference-only state isolation.
- [x] Run strict spacing audit, typecheck, build, tests, and `git diff --check`.
- [x] Record the resolved preview semantics for Claude.
