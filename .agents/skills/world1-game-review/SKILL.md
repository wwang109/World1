---
name: world1-game-review
description: Use when reviewing the World1 game, assessing its current quality or change readiness, planning game changes, finding missing or placeholder visual assets, or generating and integrating World1 artwork.
---

# World1 Game Review

Review the game from current evidence, turn findings into change-ready work,
and complete requested art gaps without violating World1's architecture or
asset pipeline.

## Core rule

Treat code and a freshly running build as the current game. Use the owner map
in `docs/INDEX.md` to interpret intent. Never infer the current experience from
historical documents or old screenshots.

This skill supports review and preparation by default. Do not change code or
generate assets unless the user asks for those actions. A request to review is
not authorization to implement every finding.

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
4. The implementation and tests for the actual surface. When documentation and
   code disagree, code describes current behavior; report the documentation
   drift against the owner map.

Check `git status` before working. Preserve unrelated user changes and do not
rewrite or clean the worktree as part of a review.

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

- Inspect the pure engine and its tests before making claims.
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

Run checks proportional to the review:

- focused pure logic: targeted Vitest files plus typecheck when types changed
- UI/layout: targeted tests, fresh captures for both profiles, relevant browser
  audit, and the full test gate before completion
- broad or cross-layer work: `npm test`, `npm run typecheck`, and
  `npm run build`

Remember the boundaries enforced by `scripts/check-boundaries.mjs`:

- only `src/game` may import Phaser
- `src/game` plays battle event logs and must never simulate combat
- modifiers enter combat through the effective-card/combatant resolver seam
- engine state stays deterministic, seeded, ordered, and integer-only

## Report the review

Lead with the highest-impact evidence. Separate:

- **Observed defect**: reproducible current failure
- **Design gap**: current behavior conflicts with a locked or owner document
- **Quality opportunity**: improvement with no violated requirement
- **Unknown**: insufficient evidence; name the check that would resolve it

For each actionable finding include:

1. affected surface and platform
2. concrete evidence or reproduction route
3. user impact
4. likely owner file or subsystem
5. recommended change and verification bar
6. confidence and remaining uncertainty

Do not turn preferences into defects. Rank findings by player impact, breadth,
and change risk rather than by how easy they are to fix.

Follow the three status buckets and compact closing summary required by
`CLAUDE.md`.

## Prepare changes

When the user asks to prepare implementation, produce a change slice that can
be executed without rediscovering the problem:

- desired player-visible outcome
- files and architectural layer likely involved
- invariants and locked decisions that must remain true
- acceptance criteria for desktop and mobile where UI is involved
- failing or missing tests to add first
- live verification route, viewport, state, and visible proof
- art dependencies and exact final paths
- documentation owner that must be updated with the code

Prefer the smallest coherent slice. Keep unrelated refactors outside it. Use
the project's normal brainstorming, planning, TDD, debugging, and verification
skills when the request moves from preparation into implementation.

## Find missing images

An image is not "missing" merely because its final art is unattractive.
Classify each candidate by comparing all four sources:

1. runtime catalog or preload reference in `src/game`
2. intended master path in `art-src/`
3. served derivative in `public/game-art/`
4. prompt or asset contract in the relevant art document

Use these categories:

- **broken reference**: runtime expects a derivative that is absent
- **missing master**: derivative exists but the editable PNG master is absent
- **unencoded master**: master exists but its WebP derivative is absent or stale
- **placeholder**: both files exist, but the documented placeholder still needs
  final artwork
- **unwired art**: artwork exists but no current runtime surface uses it
- **optional opportunity**: no contract requires it; propose rather than assume

Inspect the image visually before classifying it. Filename, flat-color size, or
directory alone is not enough proof that an asset is still a placeholder.

Return an inventory with the asset's purpose, current state, source of truth,
master path, derivative path, target dimensions/aspect, transparency, runtime
consumer, and recommended next action.

## Generate and integrate requested art

Use the image-generation skill/tool for raster artwork. Reuse an existing prompt
block from `docs/icon-generation-prompts.md` or `docs/art-prompt-pack.md` when it
owns the asset family. Preserve its shared style lines, composition constraints,
alpha/opaque requirement, crop safety, and exact subject. Do not silently invent
a new visual language.

For a new asset family:

1. derive the visual requirements from its actual display slot and both layouts
2. propose the reusable style and exact path contract
3. add the prompt/placement contract to the appropriate owner document
4. add placeholder generation support when the project expects placeholders
5. generate the final raster only after the user has authorized generation

For each generated or replaced image:

1. inspect the result at full size
2. reject text, watermarks, unintended borders, bad alpha, wrong aspect, unsafe
   crops, illegible small-scale silhouettes, and style drift
3. save the PNG master to the exact `art-src/` path
4. run `npm run art:encode`
5. confirm the matching committed WebP exists under `public/game-art/`
6. open the live consuming screen at desktop and mobile sizes
7. verify crop, contrast, readability, seams, and loading behavior
8. run the relevant tests and final project gate

Commit or deliver both the PNG master and WebP derivative. `vite build` does not
perform encoding.

Do not replace badge icons or generate duplicate thumbnails when the art owner
document says to reuse or crop an existing asset.

## Completion bar

A review is complete when every conclusion is traceable to current evidence and
the scope is explicit. A prepared change is complete when another agent can
implement and verify it without guessing. An art task is complete only when the
master and derivative exist, the live game uses the derivative correctly on both
platforms, and the relevant checks pass.
