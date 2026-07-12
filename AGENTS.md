# AGENTS.md — Codex CLI working agreement (UI & design)

This repo is a TypeScript/Phaser 1v1 roguelite. It's developed by **two agents**:
- **Claude Code** owns the engine, data, balance, run/meta logic, and tests
  (see `CLAUDE.md`). Claude treats the combat sim as sacred and deterministic.
- **You (Codex CLI)** own the **UI and visual/UX design** — everything the
  player sees and clicks. Your home is `src/game/`.

> Read `CLAUDE.md` once for the full project picture, then work from the two
> docs below. They are written FOR you.

## Your two working docs
1. **`docs/codex-ui-guide.md`** — your handbook: the Phaser architecture, the
   design system, the scene inventory, the playback model, how to add UI, how
   to verify, the hard rules, and a prioritized **UI/design backlog**. Start here.
2. **`docs/codex-handoff.md`** — the shared ledger between you and Claude.
   **Append an entry every session**: what you changed, why, verification, and
   anything you need from Claude (a new engine event field, a run-state shape,
   a decision). Claude reads it, verifies your work, and replies in the same doc.
   This is how we stay in sync without stepping on each other.

## Hard rules (breaking these breaks the build — non-negotiable)
- **Only `src/game/` may import `phaser`.** A checker (`scripts/check-boundaries.mjs`)
  fails `npm test` if any other layer imports it. Never import Phaser outside `src/game`.
- **Never edit `src/engine/`, `src/data/`, or `tests/`.** Those are Claude's.
  If you need an engine change (e.g. a new field on an event, a new value in the
  log), **do not hack around it in the scene** — write a request in
  `docs/codex-handoff.md` and Claude will implement it.
- **The battle UI is a dumb playback head.** It renders `simulate()`'s event log;
  it must NEVER recompute combat, roll RNG, or contain game logic. Read state,
  draw it. If a value you want isn't in the event log, request it (see above).
- **Keep it green.** `npm test` (106+ tests) and `npm run build` must both pass
  before you consider a change done. `npm run typecheck` must be clean (strict TS).

## Commands
- `npm run dev` — Vite dev server (open the printed URL to see your UI).
- `npm run build` — production build (must pass).
- `npm test` — boundary checker + full vitest suite (must pass; you won't add tests,
  but you must not break them).
- `npm run typecheck` — `tsc --noEmit`.
- `npm run fight [enemyId] [seed]` — prints an ASCII combat log; handy to see what
  events the battle scene will receive.

## Workflow each session
1. Read `docs/codex-ui-guide.md` (skim if familiar) and the latest entries in
   `docs/codex-handoff.md`.
2. Do the UI/design work in `src/game/` only.
3. Verify: `npm run build` + `npm test` + `npm run typecheck` green; eyeball via
   `npm run dev`; screenshot if you can.
4. **Append a handoff entry** in `docs/codex-handoff.md` (use the template there).
5. Commit on a branch with a clear message; don't push to a shared branch without
   the user's say-so.
