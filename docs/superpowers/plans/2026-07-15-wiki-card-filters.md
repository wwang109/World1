# Wiki Card Filters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add combinable Role, Property, Weight, Card Size, and sorting controls to the tiered card Wiki.

**Architecture:** Keep filter state inside `PrepScene`, derive the visible catalog from authored skill data, and present editing through the existing Phaser modal pattern. No engine or data changes are required.

**Tech Stack:** TypeScript, Phaser 3, Vite.

## Global Constraints

- Modify UI code only under `src/game/`.
- Preserve six card tiles per page and 720x1280 portrait fit.
- Read weight, PL, archetypes, and effects; never duplicate combat calculations.

---

### Task 1: Filter State And Derivation

**Files:**
- Modify: `src/game/scenes/PrepScene.ts`

- [x] Define typed role/property/weight/card-size/sort selections.
- [x] Filter with AND semantics and sort the selected-tier card definitions.
- [x] Reset pagination whenever committed filters change.

### Task 2: Filter Sheet

**Files:**
- Modify: `src/game/scenes/PrepScene.ts`

- [x] Add the active-count FILTER control to the Wiki header.
- [x] Render category choices in a modal sheet with CLEAR, APPLY, and close behavior.
- [x] Preserve tile dimensions and show empty-result feedback without overflow.

### Task 3: Verify And Handoff

**Files:**
- Modify: `docs/codex-ui-guide.md`
- Modify: `docs/codex-handoff.md`

- [x] Exercise combined filters, empty results, and sorting at 720x1280.
- [x] Run typecheck, build, tests, and `git diff --check`.
- [x] Record the filter semantics and verification in the shared handoff.
