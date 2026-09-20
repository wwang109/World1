---
name: world1-codemap
description: Use when you need to find WHERE something lives in the World1 codebase - before adding or changing a card, gem, enemy, event, keyword, price, run screen, save format, or combat rule, and whenever you are about to grep the tree to work out how the game is built. Level 1 (this file) is the "I want to change X, start at Y" routing table over src/engine, src/data, src/run, src/meta, src/game. Level 2 (references/) drills into: the layer-boundary rules, the resolver seam, determinism invariants, authored-vs-generated JSON, which evidence proves each subject and which gate must stay green, grep recipes that actually work here, and the command list.
---

# World1 codemap — where everything lives

Orientation only. This file **points**; it never restates a mechanic, a price
or a rule, and it never counts things — file counts and content counts go
stale the moment another agent lands a change. The owner of each fact is in
[`docs/INDEX.md`](../../../docs/INDEX.md) — **doc vs doc, the owner wins;
doc vs code, code wins.** If you find a restated rule or a tally in here, it is
a bug: delete it and link the owner instead. (Paths, command names and localhost
ports are addresses, not facts — those belong here.)

Before your first edit, load **`world1-handoff`** — another agent is often
editing this same tree.

No `*.test.ts` file exists in this repo, by user ruling — `CLAUDE.md`
§"Verification is by evidence — no test files (USER-LOCKED 2026-09-15)" owns the
rule and `scripts/check-boundaries.mjs` enforces it. Every "prove it" pointer
below names a script, a fight-log recipe or an audit command, never a test file.

This is the level-1 router: the one table you always need. Everything else —
boundary rules, determinism, authored-vs-generated, verification evidence, grep
recipes, commands — is a `references/*.md` load away. Load only the one your
task needs; see the table at the bottom.

## 1. I want to change X → start at Y

| I want to… | Start at | Also |
|---|---|---|
| **a card's numbers** (damage, stacks, weight, size, tier) | `src/data/content/skills.v1.json` — the `effects` array of that card's `def` | Solve magnitudes with `npm run scaffold:card` (it asks the pricing functions, never a copy). The PL audit for that one card is the same command — it prints an on-budget/cap summary at every tier against `src/engine/balance.ts`; the schema gate is `npm run content:validate` |
| **what a card's text SAYS** | `src/engine/keywords/text.ts` — `KEYWORD_TEXT[kind]` is the face token + clause template | Card faces are **generated from `effects`**, never authored. Composition/ordering: `src/engine/keywords/compose.ts` (`renderSkillText`). Every renderer that reads the registry: the **`world1-card-text`** skill. `docs/card-text-style-guide.md` is HISTORY |
| **add a new keyword / Action kind** | `src/engine/types.ts` (`ActionKinds` union) → `src/engine/keywords/pricing.ts` (rate) → `src/engine/keywords/text.ts` (text) → `src/engine/combat/interpreter.ts` (behaviour) | All of them. Which steps the compiler catches and which fail silently: `docs/card-text-surfaces.md` (via the **`world1-card-text`** skill). Prove the behaviour with an `npm run fight` on/off pair (the **`world1-combat-log`** skill). The design spec `docs/superpowers/specs/2026-09-06-keyword-registry-design.md` is **local-only, NOT in the repo** (`docs/superpowers/` is gitignored) — a fresh clone will not have it, so treat the registries above as the source of truth |
| **the turn loop** (readiness, weight, multi-cast, attrition) | `src/engine/combat/simulate.ts` | Who casts what: `src/engine/combat/castSelect.ts`. Effect behaviour: `src/engine/combat/interpreter.ts`. Mutable state/statuses: `src/engine/combat/state.ts`. Log shapes: `src/engine/combat/events.ts`. Owner doc: `docs/combat-model-spec.md`. Determinism-critical: prove no drift with two same-seed `npm run fight` runs diffed (`references/verification.md`) |
| **PL pricing** | `src/engine/balance.ts` — `PRICE`, `TIER_BUDGET_DECI`, `EFFECT_CAPS_DECI`, `RARITY_PL_DECI` are the single source of truth | Per-kind rate table: `src/engine/keywords/pricing.ts` (`buildKeywordPricing`). Rationale only: `docs/power-level-reference.md` |
| **a gem** | `src/data/content/gems.v1.json` (authored) | Loader `src/data/gemsContent.ts`; folded into a card by `src/engine/cards.ts`; text `src/engine/keywords/gemText.ts`; UI `src/game/ui/GemToken.ts`, `src/game/ui/gemDetailsDrawer.ts` |
| **an enemy** | `src/data/enemies.ts` — still the **hand-written live source** (`src/data/content/enemies.v1.json` is an export, not yet wired) | Authored at a Bronze floor; all scaling is run-layer: `src/run/encounter.ts` + `src/run/leveling.ts` + `src/run/enemyDepth.ts`. Affixes: `src/data/modifiers.ts`. Doc: `docs/enemy-design.md` |
| **an event** | `src/data/content/event-packs/*.json` (authored) → compile with `npm run content:events` **then** `npm run content:wiki` | `npm run content:validate` recompiles the packs and re-renders the wiki and refuses a stale `events.v3.json` or `docs/generated/event-catalog.md` — and `npm run build` runs it first, so skipping either step ships a red build. Idempotency of the regeneration itself: run the script again and `git diff --stat` must be empty. Runtime: `src/run/events.ts` (selection + resolution), `src/run/eventEligibilityV3.ts`, `src/run/eventV3Rewards.ts`, `src/run/eventV3Materialization.ts`. Docs: `docs/run-structure.md`, `docs/event-chains-proposal.md` |
| **a screen's layout** | the **pair** `src/game/scenes/Desktop*Scene.ts` + `src/game/scenes/Mobile*Scene.ts` — both platforms, always | Shared Run chrome: `src/game/ui/runScreenTemplate.ts`. Card geometry: `src/game/ui/cardTokenSpec.ts`, `src/game/ui/fantasyCardTemplateSpec.ts`. Canvas profile: `src/game/layoutProfile.ts`. Re-render: `src/game/sceneRebuild.ts` (never `scene.restart()`). Routes: `docs/ui-workbook.md`. What each screen must show: `docs/feature-inventory.md`. Prove it: `npm run audit:hud` / `audit:cardface` / `shop:smoke` + screenshots on both viewports (the **`world1-screens`** skill) |
| **the run map / shop / draft** | `src/run/runMap.ts` · `src/run/shop.ts` · `src/run/draft.ts` | The state machine over all of them is `src/run/runState.ts`; the Phaser-side bridge is `src/game/runStore.ts`. Biomes: `src/run/biome.ts` + `src/data/biomes.ts`. Doc: `docs/run-structure.md` |
| **save data / migration** | `src/meta/runSave.ts` — `SCHEMA_VERSION` and the migration chain live in its own header comment (INDEX names the file itself as the owner) | Lifetime totals: `src/meta/lifetimeStats.ts`. Browser wiring: `src/game/metaStore.ts` |
| **the battle service** | `src/run/resolveBattle.ts` — the one place combat is resolved | Dev server `server/battleApi.ts` (`npm run api`, :8787); production twin `functions/battle.ts` + `functions/damage-band.ts`; the client's only caller `src/game/battleApi.ts`. **Change one, change both** |
| **the ASCII combat log** | `scripts/fight.ts` + `scripts/logFormat.ts` | Never hand-roll a second renderer (USER-LOCKED). `FIGHT_NARROW=1` is the mobile reflow of the same output |
| **balance exploration** | `scripts/balance.ts` (`npm run sim`) | Manual tool only — PL is the balance unit, not winrate (`docs/design-locked.md`) |

## References — load the one you need

| Subject | File |
|---|---|
| The boundary rules `check-boundaries.mjs` enforces, determinism invariants, the resolver seam | `references/boundaries-and-determinism.md` |
| Which JSON/docs are hand-authored vs script-generated, and how idempotency is proven | `references/authored-vs-generated.md` |
| Which evidence proves each subject and which gate must stay green; running the gate chain on a live tree | `references/verification.md` |
| Grep recipes verified to hit on this checkout | `references/grep-recipes.md` |
| The command list (gate chain/dev/content pipeline/audits) | `references/commands.md` |
