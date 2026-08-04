> **HISTORICAL** — a dated superpowers plan/spec, accurate as of its date; superseded by the shipped implementation (see `docs/feature-inventory.md`). Never cite as current.

# Fantasy Anime Card Prototype Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Wiki inspection with a card-sheet modal and establish a reusable fantasy-anime card template before applying art to the whole catalog.

**Architecture:** Keep authored card data untouched. Add a `src/game/ui/cardArtPresentation.ts` helper for type, archetype, and tier presentation plus a `FantasyCardTemplate` component. The component reserves a borderless full-bleed artwork surface but renders no generated artwork.

**Tech Stack:** TypeScript, Phaser 3, Vite static assets under `public/`.

---

### Task 1: Borderless Card Template

**Files:**
- Create: `src/game/ui/FantasyCardTemplate.ts`
- Modify: `src/game/ui/cardArtPresentation.ts`

- [x] **Step 1: Reserve a borderless, full-bleed artwork surface**

Keep the rounded card silhouette art-first with no surrounding frame. The initial surface is intentionally blank/tinted so no generated art is applied yet.

- [x] **Step 2: Add reusable overlay plates and enlarged skill text panel**

Place tier/weight and type icons on the left, support one to three archetypes on the right, and use a larger neutral text border with a centered diamond cap.

### Task 2: Card Presentation Helper

**Files:**
- Create: `src/game/ui/cardArtPresentation.ts`

- [x] **Step 1: Define type, archetype, and tier helpers**

Map the existing authored type/archetype/tier data to the small visual plates without changing card data.

- [x] **Step 2: Remove the unused generated-art loader**

Do not preload or consume generated art while this template pass is being evaluated.

### Task 3: Wiki Modal + Prototype Card Face

**Files:**
- Modify: `src/game/scenes/PrepScene.ts`

- [x] **Step 1: Change Wiki tile tap behavior**

Tapping the tile opens a full card modal instead of filling the persistent `INSPECT` panel.

- [x] **Step 2: Draw the reusable no-art template in the Wiki sheet**

Show a blank full-bleed surface with top-corner `WT` and type badges, one to three archetype badges, and the enlarged title/effect band.

- [x] **Step 3: Add a reusable Wiki card sheet**

Use the same modal behavior as Combat: dimmed overlay, card information sheet, close button, and outside tap closes.

### Task 4: Verify and Handoff

**Files:**
- Modify: `docs/codex-handoff.md`

- [x] **Step 1: Run `npm run typecheck`**

Expected: clean.

- [x] **Step 2: Run `npm run build`**

Expected: pass.

- [x] **Step 3: Run `npm test`**

Expected: pass or report any unrelated existing failures exactly.

- [x] **Step 4: Append a handoff entry**

Record files changed, verification, design decision, and open choices for the user.
