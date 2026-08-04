> **HISTORICAL** — a dated superpowers plan/spec, accurate as of its date; superseded by the shipped implementation (see `docs/feature-inventory.md`). Never cite as current.

# Prep Enemy Skills + Current Deck Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Prep fight card show the enemy's resolved skills and make the Prep side panel show the exact current deck being brought into the fight instead of an inspect prompt.

**Architecture:** Keep the change entirely inside `src/game/`. Reuse the existing enemy resolver for the fight preview and the shared detail panel for the current-deck summary, so the UI stays a dumb readout over prepared state. Do not change combat logic, enemy generation, or the run layer.

**Tech Stack:** TypeScript, Phaser, existing `SkillDetailPanel`, existing `PrepScene` layout helpers, existing `demoState` / `buildEnemyEncounter` / `buildAutoHeroSetup`.

---

### Task 1: Give Prep a current-deck summary panel

**Files:**
- Modify: `src/game/ui/SkillDetailPanel.ts`
- Modify: `src/game/scenes/PrepScene.ts`

- [ ] **Step 1: Add a reusable summary setter to the shared detail panel**

Add a method that can replace the inspect copy with a custom title, meta line, stats line, and body text so the panel can show a live deck summary on the Prep tab without pretending to be an inspector.

- [ ] **Step 2: Render the current deck in the Prep tab**

Update the loadout branch in `PrepScene` so the detail panel shows the exact equipped deck, hero level, PL, and damage band instead of the old inspect prompt. Keep the actual card inspection behavior in Bag and Wiki.

- [ ] **Step 3: Verify the new panel content is wired to the live deck**

Run the app on the Prep tab and confirm the panel updates from `demoState.pieces` / `demoState.heroLevel`, not from a stale cached label.

### Task 2: Show enemy skills on the Prep fight card

**Files:**
- Modify: `src/game/scenes/PrepScene.ts`
- Modify: `docs/codex-handoff.md`
- Modify: `docs/codex-ui-guide.md`

- [ ] **Step 1: Expand the fight-card preview with a skill list**

Add a compact resolved enemy skill readout to the existing fight card, using the same enemy resolver that already drives the stat preview, so the player sees what the opponent actually brings into battle.

- [ ] **Step 2: Remove the “inspect” framing from the Prep tab copy**

Replace the remaining loadout-page instruction text with deck/fight-language that matches the new summary panel and the enemy skill preview.

- [ ] **Step 3: Update the shared docs**

Record the new Prep behavior in the UI guide and handoff log so Claude's shared ledger stays accurate.

- [ ] **Step 4: Verify**

Run `npm run typecheck`, `npm run build`, and `npm test`. Then open `?view=prep` and confirm the current deck summary and enemy skill list both render cleanly in portrait.
