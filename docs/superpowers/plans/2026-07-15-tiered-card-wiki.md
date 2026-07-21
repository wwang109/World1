# Tiered Card Wiki Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a tier-aware card catalog with canonical verb summaries and duplicate-safe bag additions.

**Architecture:** Extend UI demo state with owned-card instance records, preserving engine-compatible `BoardPiece` fields. Add a pure UI presentation helper for canonical action labels, then render fixed Wiki catalog tiles that consume authored/tier-resolved card data.

**Tech Stack:** TypeScript, Phaser 3, Vite.

## Global Constraints

- Modify UI code only under `src/game/`; request data-name changes from Claude.
- Preserve deterministic combat and the one-instance-one-place bag/deck invariant.
- Keep the 720x1280 portrait layout free of overflow.

---

### Task 1: Owned Card Instances

**Files:**
- Modify: `src/game/demoState.ts`
- Modify: `src/game/scenes/PrepScene.ts`

**Interfaces:**
- Produces: `OwnedCard`, `OwnedBoardPiece`, and `createOwnedCard(skillId, tier)`.
- Preserves: Existing `BoardPiece` compatibility for encounter simulation.

- [x] Store unique instance IDs and tiers in bag slots and equipped pieces.
- [x] Preserve identity and tier while moving copies between bag and deck.
- [x] Allow duplicate skill IDs while retaining one physical location per instance.

### Task 2: Canonical Verb Presentation

**Files:**
- Create: `src/game/ui/cardActionPresentation.ts`
- Modify: `src/game/theme.ts`

**Interfaces:**
- Produces: `presentCardActions(skill): CardActionLabel[]` with canonical verb, short effect, and semantic color.

- [x] Map every authored `Action.kind` to a canonical verb and concise mechanical effect.
- [x] Add semantic verb colors without changing engine/data definitions.

### Task 3: Tiered Wiki Catalog

**Files:**
- Modify: `src/game/scenes/PrepScene.ts`

**Interfaces:**
- Consumes: `applyTier`, `presentCardActions`, and owned-card instance helpers.
- Produces: Six uniform tiles per page, global tier preview, and `+ BAG` behavior.

- [x] Render tier controls and fixed two-column catalog tiles.
- [x] Show property, weight, PL, verbs/effects, copy counts, and bag state.
- [x] Make inspection tier-aware and verify every page fits.

### Task 4: Verify And Handoff

**Files:**
- Modify: `docs/codex-ui-guide.md`
- Modify: `docs/codex-handoff.md`

- [x] Run typecheck, build, tests, and `git diff --check`.
- [x] Capture the Wiki and record the stable-ID/tier behavior.
- [x] Request Claude's display-name audit without changing stable skill IDs.
