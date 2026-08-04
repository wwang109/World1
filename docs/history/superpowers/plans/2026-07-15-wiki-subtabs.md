> **HISTORICAL** — a dated superpowers plan/spec, accurate as of its date; superseded by the shipped implementation (see `docs/feature-inventory.md`). Never cite as current.

# Wiki Subtabs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move Cards and Opponents into Wiki/Cards and Wiki/Opponents subtabs.

**Architecture:** Keep the existing UI-only `PrepView` values as section state, but expose only one Wiki main tab. Route legacy and hierarchical launcher values to the existing Card/Opponent renderers.

**Tech Stack:** TypeScript, Phaser 3, Vite.

## Global Constraints

- Main navigation contains exactly Deck, Bag, Wiki.
- Wiki header contains Cards and Opponents subtabs.
- Preserve ten cards per page and eight opponents per page.
- Preserve legacy direct-view aliases.

---

### Task 1: Navigation Hierarchy

**Files:**
- Modify: `src/game/devLaunch.ts`
- Modify: `src/game/scenes/PrepScene.ts`

- [x] Remove Opponents from the main tab definitions.
- [x] Treat both Wiki sections as active under the Wiki main tab.
- [x] Add Cards/Opponents controls inside both Wiki panel headers.
- [x] Support `wiki/card` and `wiki/opponents` launcher values.

### Task 2: Verify And Handoff

**Files:**
- Modify: `docs/codex-ui-guide.md`
- Modify: `docs/codex-handoff.md`
- Modify: `docs/screenshot-howto.md`

- [x] Capture Wiki/Cards and Wiki/Opponents at 720x1280.
- [x] Exercise subtab switching and both hierarchical direct routes.
- [x] Run strict spacing audit, typecheck, build, tests, and `git diff --check`.
- [x] Record the navigation contract for Claude.
