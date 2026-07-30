# Missing Card Art Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate and wire full-card art for the 37 current skills missing authored artwork.

**Architecture:** Keep the current Phaser asset pipeline unchanged. Persist one generated portrait PNG per stable `skillId` under `public/game-art/cards/`, then extend the single `CARD_ART_CATALOG` map in `src/game/ui/cardArtCatalog.ts`; `BootScene` and the shared card templates will consume the new entries automatically.

**Tech Stack:** Phaser 3.90, TypeScript, Vite, Vitest, built-in image generation, PNG assets.

## Global Constraints

- Only `src/game/` may import Phaser.
- Do not edit `src/engine/`, `src/data/`, or `tests/`.
- Preserve all existing art files and catalog mappings.
- Use 1024×1536 portrait artwork when possible; reject anything below 840×1040.
- New art contains no text, logos, watermarks, or rendered card UI.
- Existing card template, skill IDs, card text, and gameplay behavior remain unchanged.

### Task 1: Generate the missing card art set

**Files:**
- Create: `public/game-art/cards/twin-slash-anime.png`
- Create: `public/game-art/cards/ember-lash-anime.png`
- Create: `public/game-art/cards/cinder-dart-anime.png`
- Create: `public/game-art/cards/scorching-brand-anime.png`
- Create: `public/game-art/cards/wildfire-surge-anime.png`
- Create: `public/game-art/cards/inferno-eruption-anime.png`
- Create: `public/game-art/cards/static-jolt-anime.png`
- Create: `public/game-art/cards/thunder-step-anime.png`
- Create: `public/game-art/cards/chain-spark-anime.png`
- Create: `public/game-art/cards/overcharge-anime.png`
- Create: `public/game-art/cards/storm-surge-anime.png`
- Create: `public/game-art/cards/thorn-bite-anime.png`
- Create: `public/game-art/cards/verdant-touch-anime.png`
- Create: `public/game-art/cards/blooming-vine-anime.png`
- Create: `public/game-art/cards/overgrowth-anime.png`
- Create: `public/game-art/cards/glacial-spike-anime.png`
- Create: `public/game-art/cards/frost-shackle-anime.png`
- Create: `public/game-art/cards/deep-freeze-anime.png`
- Create: `public/game-art/cards/lance-thrust-anime.png`
- Create: `public/game-art/cards/braced-pike-anime.png`
- Create: `public/game-art/cards/piercing-reach-anime.png`
- Create: `public/game-art/cards/impaling-charge-anime.png`
- Create: `public/game-art/cards/rapid-volley-anime.png`
- Create: `public/game-art/cards/piercing-arrow-anime.png`
- Create: `public/game-art/cards/marksman-shot-anime.png`
- Create: `public/game-art/cards/barrage-anime.png`
- Create: `public/game-art/cards/bastion-stance-anime.png`
- Create: `public/game-art/cards/aegis-wall-anime.png`
- Create: `public/game-art/cards/sanctified-bulwark-anime.png`
- Create: `public/game-art/cards/fortress-bastion-anime.png`
- Create: `public/game-art/cards/mending-aura-anime.png`
- Create: `public/game-art/cards/swift-march-anime.png`
- Create: `public/game-art/cards/warlord-banner-anime.png`
- Create: `public/game-art/cards/renewing-wave-anime.png`
- Create: `public/game-art/cards/vital-surge-anime.png`
- Create: `public/game-art/cards/void-pierce-anime.png`
- Create: `public/game-art/cards/annihilation-strike-anime.png`

- [ ] Generate each image separately with the shared card-art style block and a card-specific subject derived from its existing name, property, weapon/element, archetype, and effects.
- [ ] Inspect the generated outputs for readable silhouettes, family color identity, no accidental text/watermarks, and a darker lower third.
- [ ] Copy the selected final outputs into `public/game-art/cards/` without replacing any existing file.

### Task 2: Register the new assets

**Files:**
- Modify: `src/game/ui/cardArtCatalog.ts`

**Interfaces:**
- Consumes: stable `skillId` values and the filenames created in Task 1.
- Produces: one `CardArtEntry` per newly covered skill, using texture keys in the existing `card-art:<skill_id>_anime` namespace.

- [ ] Add the 37 entries to `CARD_ART_CATALOG` using the established ordering and kebab-case filenames.
- [ ] Keep all existing entries unchanged and do not add a second art lookup map.

### Task 3: Verify coverage and project health

**Files:**
- Modify: `docs/codex-handoff.md`

- [ ] Run a read-only coverage check that compares `Object.keys(skillBook)` to `Object.keys(CARD_ART_CATALOG)` and verifies each catalog filename exists under `public/game-art/cards/`.
- [ ] Run a read-only image-dimension check and confirm every new PNG is at least 840×1040.
- [ ] Run `npm run typecheck`.
- [ ] Run `npm run build`.
- [ ] Run `npm test` and record the result, including any pre-existing failures outside this change.
- [ ] Append a handoff entry naming the 37 new cards, changed files, verification commands, and any art-quality caveats.
- [ ] Review the final diff to confirm only the intended public assets, catalog, plan/spec docs, and handoff entry changed.
- [ ] Commit the scoped changes with message `feat: add missing card artwork`.
