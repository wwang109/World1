# Compact Wiki Filter Modal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the Wiki filter as a compact floating ledger sheet.

**Architecture:** Keep the existing draft filter state and behavior. Change only Phaser display composition and row geometry in `PrepScene`, continuing to route every interactive label through `auditControlLabel`.

**Tech Stack:** TypeScript, Phaser 3, Vite.

## Global Constraints

- Preserve all five filter categories and AND semantics.
- Fit the complete sheet inside 720x1280 without scrolling.
- Use one outer sheet, one header band, and no nested row panels.
- Preserve minimum control-label clearance through strict layout audit mode.

---

### Task 1: Compact Sheet Composition

**Files:**
- Modify: `src/game/scenes/PrepScene.ts`

- [x] Replace the tall modal geometry with a centered 612x420 floating sheet.
- [x] Add a dark title band and compact footer treatment.
- [x] Move category labels and choices onto single horizontal rows.
- [x] Keep CLEAR, APPLY, close, overlay-dismiss, and draft behavior unchanged.

### Task 2: Visual Verification And Handoff

**Files:**
- Modify: `docs/codex-ui-guide.md`
- Modify: `docs/codex-handoff.md`

- [x] Capture default and selected modal states at 720x1280.
- [x] Run strict `layoutAudit=1` and require zero errors.
- [x] Run typecheck, build, tests, and `git diff --check`.
- [x] Record the result for Claude.
