# Review procedure

## Establish current context

Read these before evaluating the game:

1. `CLAUDE.md` for the charter, commands, architecture, and user-locked working
   conventions.
2. `docs/INDEX.md` for ownership and document status.
3. The owner documents relevant to the requested surface. Common routes:
   - combat: `docs/combat-model-spec.md`, `docs/design-locked.md`
   - run flow: `docs/run-structure.md`, `docs/feature-inventory.md`
   - UI: `docs/ui-workbook.md`, `docs/card-template-spec.md`
   - balance: `docs/power-level-reference.md` and the constants in
     `src/engine/balance.ts`
   - art: `docs/icon-generation-prompts.md`, `docs/art-prompt-pack.md`
4. The implementation for the actual surface — there are no test files to read
   alongside it (`CLAUDE.md`, "Verification is by evidence — no test files",
   USER-LOCKED 2026-09-15). When documentation and code disagree, code
   describes current behavior; report the documentation drift against the
   owner map.

## Choose the review depth

Use the smallest depth that answers the request:

- **Focused review**: one mechanic, screen, asset family, or reported problem.
- **Flow review**: a connected journey such as map → shop → prep → battle.
- **Game review**: representative coverage of combat, run progression, UI,
  content, usability, presentation, and technical health.

State the selected depth and any exclusions. Do not describe a sample as a
complete audit.

## Build an evidence set

Prefer reproducible evidence over impressions.

### Mechanics and combat

- Inspect the pure engine, then run it, before making claims — the log is
  the evidence, not a reading of the source.
- Any claim about what a card, keyword, status, or combat rule does must lead
  with a real `npm run fight` log, following the mobile-first format required by
  `CLAUDE.md`.
- Use paired runs when the meaning depends on a condition: on/off,
  matching/non-matching, or before/after.
- Never hand-write or independently reformat a combat log.
- Treat `npm run sim` as exploration, not as a balance oracle. Power Level and
  its code constants are the balance authority.

### UI and play flow

- Use current `?scene=` routes from `docs/ui-workbook.md`.
- **Review Run Mode destinations in their real host.** Events, shops, ordinary
  encounters, and boss arrivals are player-facing states inside the run map's
  bounded `CHOOSE YOUR NEXT STOP` panel. Reach them through `desktop-runmap`
  or `mrunmap` and select the destination, or use a current screenshot of that
  embedded state. Do not use `desktop-shop`, `mobile-shop`,
  `desktop-runevent`, or `mrunevent` by themselves as the visual reference for
  a run-map review or mockup: those routes expose child/debug scenes without
  `RunDestinationHost`'s bounds, camera crop, host controls, or surrounding
  route context. Direct child-scene routes are valid only when the task
  explicitly targets that standalone renderer in isolation.
- Before proposing or generating a run destination redesign, verify the fresh
  capture visibly includes its real parent surface (for example
  `CHOOSE YOUR NEXT STOP` plus `BACK` / `LEAVE SHOP` for an embedded shop).
  If it does not, stop and obtain the correctly hosted state rather than
  designing from the detached child scene.
- Review both 1440×900 desktop and 412×892 mobile. They are distinct layouts,
  not interchangeable responsive snapshots.
- Start both the Vite client and battle API for battle or prep surfaces.
- Capture fresh screenshots. Old committed captures are reference history only.
- Use `layoutAudit=1` and the existing HUD or smoke audit where applicable.
- Inspect the complete state set affected by a finding: default, selected,
  disabled, confirmation, outcome, scrolled, long-label, and failure states as
  relevant.
- Do not report geometry inferred from hidden or masked object bounds; respect
  the mask-aware audit described in `docs/ui-workbook.md`.

### Technical health

There are no test files in this repo (`CLAUDE.md`, "Verification is by
evidence — no test files", USER-LOCKED 2026-09-15); `scripts/check-boundaries.mjs`
fails if one appears. Health is the gate chain plus surface evidence, in
proportion to the review:

- every review: the gate chain — `npm test` is
  `node scripts/check-boundaries.mjs && npm run typecheck && node
  scripts/check-skill-parity.mjs` (`package.json`). It is fine to run on a
  LIVE tree; what you may not do is turn its result into a whole-tree verdict
  — a red typecheck can be another agent's half-saved file. Diff against
  HEAD in an isolated worktree before blaming anything, and name the in-flight
  task in the report (`world1-handoff`, "The gate chain plus YOUR evidence,
  on any tree").
- combat or a card's behaviour: an `npm run fight` on/off pair and two
  same-seed runs diffed silent (`world1-combat-log`).
- content: `npm run content:validate`; a card's PL via `npm run scaffold:card`
  against `src/engine/balance.ts`.
- UI/layout: fresh captures for both profiles, plus `npm run audit:hud`,
  `npm run audit:cardface` or `npm run shop:smoke` as the surface warrants.
- broad or cross-layer work: the gate chain and `npm run build`.

The route from a surface to its evidence is `world1-testing`'s job; this
procedure only says which evidence a review must show.

This checkout may have no `node_modules/.bin`, in which case `npm run
<script>` and `npx <tool>` fail to resolve. The direct forms, each run on
this checkout:

```bash
node scripts/check-boundaries.mjs
node node_modules/typescript/bin/tsc --noEmit
node node_modules/typescript/bin/tsc -p tsconfig.functions.json --noEmit
node scripts/check-skill-parity.mjs
node node_modules/tsx/dist/cli.mjs scripts/validateContent.ts
```

`npm run build` has no equivalent one-liner; its direct form is
`node node_modules/tsx/dist/cli.mjs scripts/validateContent.ts && node
node_modules/typescript/bin/tsc --noEmit && node node_modules/typescript/bin/tsc
-p tsconfig.functions.json --noEmit && node node_modules/vite/bin/vite.js
build` (each stage of `npm run build` run directly in order).

Remember the boundaries enforced by `scripts/check-boundaries.mjs`:

- only `src/game` may import Phaser
- `src/game` plays battle event logs and must never simulate combat
- modifiers enter combat through the effective-card/combatant resolver seam
- engine state stays deterministic, seeded, ordered, and integer-only

## Prepare changes

When the user asks to prepare implementation, produce a change slice that can
be executed without rediscovering the problem:

- desired player-visible outcome
- files and architectural layer likely involved
- invariants and locked decisions that must remain true
- acceptance criteria for desktop and mobile where UI is involved
- the evidence the change must produce — a fight on/off pair, an audit
  script's output, both-platform screenshots — never a test file
- live verification route, viewport, state, and visible proof
- art dependencies and exact final paths
- documentation owner that must be updated with the code

Prefer the smallest coherent slice. Keep unrelated refactors outside it. Use
the project's normal brainstorming, planning, debugging, and verification
skills when the request moves from preparation into implementation.

A prepared change is complete when another agent can implement and verify it
without guessing.
