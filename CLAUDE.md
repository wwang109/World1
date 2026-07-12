# World1 — Game Studio Agent Architecture

A 1v1 turn-based semi-auto roguelite skill-board battler (The Bazaar-inspired),
developed through a small team of coordinated Claude Code subagents. Each agent
owns one domain; a **Fable orchestrator** dispatches work to them, reads their
summaries, and keeps every agent on the correct path.

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
| `npm run fight [enemyId] [seed]` | ASCII combat log for eyeballing engine behavior |
| `npm run sim` | Headless N-fight balance harness |
| `npm run dev` / `npm run build` | Vite dev server / production build |

## Architecture — strict layer boundaries

Only `src/game` may import Phaser. Enforced by `scripts/check-boundaries.mjs`
(run inside `npm test`). Never violate this — it keeps the sim testable and
deterministic.

```
src/engine/   Pure deterministic combat sim. NO Phaser. Integer-only state.
src/data/     Content: skills, enemies, heroes. No logic.
src/run/      In-run state: loadout/board placement, mapgen, shop, leveling. Pure TS.
src/meta/     Persistence, account progression. Pure TS. (not built yet)
src/game/     Phaser scenes + playback rendering ONLY.
scripts/      fight.ts, balance.ts, check-boundaries.mjs
tests/        vitest suites
```

### Determinism invariants (do not break)

- `simulate(config, seed)` is a **pure function** — same input, same event log.
- Simulation state holds **integers only**; percentages are computed transiently
  and floored immediately. Balance math uses deci-PL (×10) integers.
- No `Date.now()` / `Math.random()` in the engine — all randomness flows through
  `Rng` (seeded mulberry32) in a fixed call order.
- Iterate arrays by index, never `Map`/`Set` where order can vary.
- The 100-config determinism test and the balance audit test must stay green.

## Core mechanics (locked)

- **Initiative comparison**: each turn score = `bank + Speed − queued card weight`;
  higher performs (tie → player); the loser banks Speed. No cooldowns, no mana.
- **Spell spans**: a size-N card busies its caster N−1 further turns.
- **Property × archetype matrix**: physical/magical (mitigated by Armor/Magic
  Resist, scale off Attack/Magic Power) vs true (ignores defenses). Typed shield
  pools stack, carry over, cap at max HP. True heals are flat.
- **Power Level budgets**: Bronze 10 · Silver 15 · Gold 20 · Diamond 25 PL. Every
  modifier is priced per unit; the balance audit test enforces it. Full priced
  table, rationale, and socket/gem PL accounting:
  [`docs/power-level-reference.md`](docs/power-level-reference.md) (single
  source of truth is `PRICE` in `src/engine/balance.ts`).
- **Elements** (magical): Fire→Nature→Lightning→Frost→Fire, Holy↔Dark. **Weapon
  triangle** (physical): Sword→Axe→Lance→Sword; Beast (monster attacks) and Bow
  outside it, Bow beats Beast. Matchups ±50%/−25%, PL-neutral.
- **Special ability riders**: slowNext, stagger, lifesteal, shieldBreak, comboBonus
  — each priced per unit of magnitude.

Full design lives in the plan file / git history; treat this section as the
durable summary.

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
