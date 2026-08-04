# World1 — Game Studio Agent Architecture

A turn-based semi-auto roguelite skill-board party battler (The Bazaar-inspired;
the hero fights teams of up to `MAX_FOES` = 5 enemies), developed through a
small team of coordinated Claude Code subagents. Each agent owns one domain; a
**Fable orchestrator** dispatches work to them, reads their summaries, and
keeps every agent on the correct path.

Doc map: [`docs/INDEX.md`](docs/INDEX.md) lists every doc, its class
(LOCKED/LIVING/HISTORY) and scope. If docs disagree, the INDEX-listed owner
wins; if a doc disagrees with code, code wins.

Adapted from the tier structure of
[claude-code-game-studios](https://github.com/donchitos/claude-code-game-studios),
right-sized for this project's TypeScript/Phaser stack.

## Technology Stack

- **Language**: TypeScript (strict; `noUncheckedIndexedAccess`, `isolatedModules`)
- **Engine**: Phaser 3 (rendering/scenes only)
- **Build**: Vite 7 · **Tests**: Vitest 3 · **Scripts**: tsx
- **Version Control**: Git, feature branches, PRs

## Commands

| Command | What it does |
|---|---|
| `npm test` | Boundary checker + full vitest suite (the gate for every change) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run api` | Battle service (`server/battleApi.ts`, :8787) — REQUIRED alongside `npm run dev`: the client cannot simulate |
| `npm run fight [enemyId] [seed]` | ASCII combat log for eyeballing engine behavior |
| `npm run sim` | Headless N-fight balance harness |
| `npm run dev` / `npm run build` | Vite dev server / production build |

## Architecture — strict layer boundaries

Two rules, both enforced by `scripts/check-boundaries.mjs` (run inside `npm test`):

1. **Only `src/game` may import Phaser** — the pure layers (`src/engine`,
   `src/data`, `src/run`, `src/meta`) never import Phaser or anything from
   `src/game`. This keeps the sim testable and deterministic.
2. **Thin client: `src/game` may never RUN combat** — no value-import (direct
   or transitive) of `resolveBattle` / `combat/simulate` (type-only imports are
   fine). Battles come from the battle service as an event log.

```
src/engine/   Pure deterministic combat sim. NO Phaser. Integer-only state.
src/data/     Content: skills, enemies, heroes, gems, events, shop themes. No logic.
src/run/      In-run state: loadout, mapgen, shop, events, leveling, run state. Pure TS.
src/meta/     Persistence, account progression. Pure TS. (not built yet)
src/game/     Phaser scenes + playback rendering ONLY. Cannot simulate.
server/       battleApi.ts — the dev battle service (npm run api, :8787).
functions/    Cloudflare Pages Functions — production twins of the battle service.
scripts/      fight.ts, balance.ts, run-hud-audit.ts, check-boundaries.mjs
tests/        vitest suites
```

Full layer/dev-workflow detail: [`docs/architecture.md`](docs/architecture.md).

### Additive features — the resolver seam (design principle)

Add features WITHOUT editing the core combat loop. All per-instance modifiers
(gems now; tiers, enchantments, gear later) fold into an **effective** card +
combatant in `src/engine/cards.ts` (`resolveEffectiveSkill` + gem/stat folding).
The core loop — `simulate`, `interpreter`, `castSelect`, `aurasOn` — consumes ONLY
the resolved form and stays feature-agnostic. Adding a feature = extend the
resolver + add its data; do NOT change core function signatures or add
feature-specific branches to the loop. Un-featured input must resolve to
byte-identical behavior (the determinism + audit tests prove it).

### Determinism invariants (do not break)

- `simulate(config, seed)` is a **pure function** — same input, same event log.
- Simulation state holds **integers only**; percentages are computed transiently
  and floored immediately. Balance math uses deci-PL (×10) integers.
- No `Date.now()` / `Math.random()` in the engine — all randomness flows through
  `Rng` (seeded mulberry32) in a fixed call order.
- Iterate arrays by index, never `Map`/`Set` where order can vary.
- The 100-config determinism test and the balance audit test must stay green.

## Core mechanics — pointers, not copies

The mechanics live in owner docs and code constants; this section only routes.
(The old "initiative comparison / no cooldowns / spell spans" text described
the pre-rebuild loop — the engine now runs the readiness model.)

- **Combat loop (readiness model)**: every living combatant gains Speed once
  per turn into `readiness`; the highest-readiness combatant that can afford
  its queued card's weight performs, pays the weight, and the resolve loop
  repeats (multi-cast). Cooldowns gate eligibility (`BASELINE_COOLDOWN = 3`,
  `src/engine/types.ts`). A size-N card is walked cursor-slot by cursor-slot,
  busying its caster N−1 turns after firing. Owner:
  [`docs/combat-model-spec.md`](docs/combat-model-spec.md).
- **Stalemate breakers**: attrition — escalating TRUE damage to everyone from
  `ATTRITION_START_TURN` (15), lowest initiative first — plus sudden death and
  fatigue. Constants and rationale in `src/engine/combat/simulate.ts`.
- **Damage/defense matrix, elements, weapon triangle, riders**: see
  [`docs/combat-model-spec.md`](docs/combat-model-spec.md) §5 and
  [`docs/design-locked.md`](docs/design-locked.md).
- **Power Level budgets & pricing**: single source of truth is `PRICE` /
  `TIER_BUDGET_DECI` / `EFFECT_CAPS_DECI` in `src/engine/balance.ts`; prose and
  rationale in [`docs/power-level-reference.md`](docs/power-level-reference.md).
- **Balance philosophy (locked): PL is the balance unit — not winrate.**
  Never tune content to a fixed board's winrate; make prices honest and let
  outcomes be emergent. `npm run sim` is a manual exploration tool only. Full
  statement: [`docs/design-locked.md`](docs/design-locked.md).
- **Run structure (endless ladder, lives, gold, shops, events, leveling)**:
  [`docs/run-structure.md`](docs/run-structure.md).

---

## Orchestration model

**Fable orchestrates. Mixed Sonnet/Opus workers do the heavy lifting.**

The main session (run on Fable via `/model`) acts as the orchestrator: it breaks
work into tasks, dispatches each to the right agent via the Task tool, **reads
the returned summary to confirm the agent stayed on the correct path**, and only
then moves on. Worker agents have their model pinned in frontmatter, so tier is
independent of the orchestrator model.

Use `/orchestrate <goal>` to run the delegate → summary → verify loop, or
`/team-combat <feature>` for the combat feature pipeline.

### Agent roster (3 tiers)

**Tier 1 — Directors (opus)** — judgment, gates, keeping work on-path:
- `technical-director` — architecture, layer boundaries, determinism, tech risk
- `game-director` — creative vision, design pillars, what the game should feel like
- `producer` — task breakdown, sequencing, coordination, status/verification

**Tier 2 — Leads (sonnet)**:
- `lead-programmer` — code architecture within the boundaries, interface contracts
- `qa-lead` — test strategy, determinism & balance audit ownership

**Tier 3 — Specialists**:
- `combat-engine-programmer` (**opus** — determinism-critical core) — `src/engine`
- `gameplay-programmer` (sonnet) — `src/run`, `src/meta`
- `phaser-ui-programmer` (sonnet) — `src/game` scenes/playback
- `content-designer` (sonnet) — `src/data` cards/enemies/heroes
- `balance-designer` (sonnet) — Power Level pricing, tuning, `scripts/balance.ts`
- `qa-tester` (sonnet) — vitest suites, `npm run fight`, Playwright smoke

## Collaboration protocol

**User-driven, not autonomous.** Every non-trivial task follows:
**Question → Options → Decision → Draft → Approval.**

- Use `AskUserQuestion` for real forks (Explain in prose first, then capture).
- Show a draft or summary before large multi-file changes.
- `npm test` must be green before any commit. Never commit or push without the
  user's say-so; branch off, don't commit to a shared main directly.
- Workers return a **structured summary** (what changed, files, test result,
  deviations, open questions) so the orchestrator can verify the path.
