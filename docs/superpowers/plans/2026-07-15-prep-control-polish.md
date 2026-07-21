# Prep Control Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refine Prep controls and cards with thinner borders, restrained shadows, and better-spaced steppers.

**Architecture:** Keep the current Phaser scene structure and shared `CardView`. Apply global card-surface polish in `CardView`, then adjust Prep-specific controls in `PrepScene` without changing state or gameplay behavior.

**Tech Stack:** TypeScript, Phaser 3, Vite.

## Global Constraints

- Modify UI code only under `src/game/`.
- Preserve the 720x1280 portrait layout and existing interaction targets.
- Do not change combat or encounter calculations.

---

### Task 1: Lighten Shared Card Surfaces

**Files:**
- Modify: `src/game/ui/CardView.ts`

**Interfaces:**
- Consumes: Existing `CardView` constructor and `setHighlight` API.
- Produces: The same API with lighter resting borders and stronger-but-controlled highlights.

- [x] Reduce mini/full resting stroke widths and strengthen the existing offset shadow.
- [x] Keep highlighted cards visually distinct without returning to a heavy resting outline.
- [x] Run `npm.cmd run typecheck` and expect a clean exit.

### Task 2: Refine Prep Controls

**Files:**
- Modify: `src/game/scenes/PrepScene.ts`

**Interfaces:**
- Consumes: Existing `viewSmallButton`, enemy editor state, and hero/enemy step methods.
- Produces: Grouped enemy and hero steppers with unchanged callbacks.

- [x] Reduce tab, footer, slot, chip, modal, and small-button stroke weights.
- [x] Add restrained offset shadows behind major tabs and footer actions.
- [x] Group LV/RANK controls with fixed internal spacing and preserve their current values/callbacks.
- [x] Capture the 720x1280 Prep screen and exercise the controls.

### Task 3: Verify And Handoff

**Files:**
- Modify: `docs/codex-ui-guide.md`
- Modify: `docs/codex-handoff.md`

**Interfaces:**
- Consumes: Finished UI behavior and verification output.
- Produces: Durable design notes and the newest Claude handoff entry.

- [x] Run `npm.cmd run typecheck`, `npm.cmd run build`, `npm.cmd test`, and `git diff --check`.
- [x] Record the visual decision and verification results in the shared docs.
