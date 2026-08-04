> **HISTORICAL** — a dated superpowers plan/spec, accurate as of its date; superseded by the shipped implementation (see `docs/feature-inventory.md`). Never cite as current.

# Expanded Wiki Catalog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove duplicate enemy information from Wiki and display ten readable cards per page.

**Architecture:** Reallocate the existing Scout Strip height to the Wiki library. Keep card tile dimensions and interactions unchanged, increasing only the page size and available panel height.

**Tech Stack:** TypeScript, Phaser 3, Vite.

## Global Constraints

- Wiki contains card reference content only; enemy scouting remains on Loadout.
- Preserve the existing two-column card tile width and height.
- Preserve the Inspect panel and footer positions.

---

### Task 1: Expand The Catalog

**Files:**
- Modify: `src/game/scenes/PrepScene.ts`

- [x] Remove the Wiki Scout Strip constant and render call.
- [x] Expand the Wiki library to end above Inspect.
- [x] Increase catalog pagination from six to ten cards.
- [x] Verify five card rows fit without reducing tile text.

### Task 2: Verify And Handoff

**Files:**
- Modify: `docs/codex-ui-guide.md`
- Modify: `docs/codex-handoff.md`

- [x] Capture the ten-card Wiki at 720x1280.
- [x] Run strict spacing audit with zero errors.
- [x] Run typecheck, build, tests, and `git diff --check`.
- [x] Record the result for Claude.
