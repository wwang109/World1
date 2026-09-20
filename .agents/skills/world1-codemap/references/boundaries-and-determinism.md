Covers what `scripts/check-boundaries.mjs` enforces, the resolver seam (how
features get added without touching the core loop), and the determinism
invariants. Owners: [`docs/architecture.md`](../../../../docs/architecture.md)
§"Boundary rules" for the boundary rules, `CLAUDE.md` §"Determinism invariants
(do not break)" for determinism and §"Verification is by evidence — no test
files (USER-LOCKED 2026-09-15)" for the no-test-files rule — the rules and why
they exist are stated there, not here. This file only says where they are
enforced and where a careless edit bites.

## What `check-boundaries.mjs` enforces

**`scripts/check-boundaries.mjs`** runs first inside `npm test` and prints
`boundaries OK` or names every violating file and the rule it broke. It is
proven by running it — there is no separate pin of the checker's behaviour.
Read the script for the exact walk; it enforces three things:

1. **Phaser** — only `src/game` imports it. `src/engine`, `src/data`, `src/run`
   and `src/meta` never import `phaser` or anything under `src/game`.
2. **Combat** — `src/game` may never value-import `resolveBattle` or
   `combat/simulate`, directly *or transitively*; `import type` is fine.
   `src/run/analysis.ts` is the file that leaked it once — check it first.
3. **No test files** — no `*.test.ts` anywhere in the repo (it skips
   `node_modules`, `.git`, `dist`, `.superpowers`, `tmp`). A test file
   reappearing is a red gate, by the user's ruling of 2026-09-15.

The first two are an AST walk: it follows re-export barrels and transitive
value-imports, and **fails closed** on a dynamic `import()`/`require()` whose
specifier is not a literal string. Escape hatch: `// boundary-allow: <reason>`.

## Determinism invariants

`Rng` (seeded mulberry32) lives in `src/engine/rng.ts`, and its call order is
part of the contract: inserting a draw reorders every later draw.

**Radioactive — a careless edit here silently rewrites every seeded outcome:**
`src/engine/combat/` — `simulate.ts`, `castSelect.ts`, `interpreter.ts`,
`state.ts` — plus `src/engine/rng.ts`, `src/engine/cards.ts`,
`src/engine/balance.ts`.

Their gate is the **same-seed diff**: run `scripts/fight.ts` twice with the
same enemy, seed and board, redirect each into a file, and `diff` them — silent
means deterministic. Do it BEFORE and AFTER your edit on an un-featured board
(the "before" log must match the "after" log too), then on a board that
exercises the change. Recipe in `references/verification.md`.
`tests/engine/fixtures/outcomeBaseline.json` may still be on disk, but nothing
reads it — it is an orphan of the deleted suite and is not evidence.

## The resolver seam — add a feature without touching the core loop

Per-instance modifiers (gems today; tiers, enchantments, gear later) fold into an
**effective** card and combatant inside `src/engine/cards.ts`:

- `resolveEffectiveSkill(def, piece)` — what the sim consumes
- `resolveDisplaySkill(def, piece)` — what the UI shows
- `applyTier` / `autoScaleTier`, `gemCardMods`, `gemHeroStats`, `applyHeroGems`,
  `resolveDisplayHeroStats`

`simulate`, `interpreter`, `castSelect` and `aurasOn` consume **only** the
resolved form and stay feature-agnostic. Adding a feature = extend the resolver + add its
data. Do **not** change core signatures or add feature-specific branches to the
loop. Un-featured input must resolve byte-identically — prove it with the
same-seed fight diff above on a board that does not use the feature. Behaviour
the closed Action DSL genuinely cannot express goes in
`src/engine/combat/specials.ts`, never in `src/data`.
