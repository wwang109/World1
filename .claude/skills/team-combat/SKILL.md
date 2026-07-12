---
name: team-combat
description: "Orchestrate the combat team for World1: design → price → implement → render → test a combat feature (a card, rider, matchup rule, or engine mechanic) end-to-end, with an approval gate at each phase."
argument-hint: "[combat feature, e.g. 'a Frost element rider that freezes the next cast']"
user-invocable: true
allowed-tools: Read, Glob, Grep, Bash, Task, AskUserQuestion, TaskCreate, TaskUpdate
model: fable
---

**Argument check:** If no feature is provided, output:
> "Usage: `/team-combat [feature]` — e.g. `a lifesteal rider for magical cards`, `a Poison-stacking rework`, `a new boss with a Holy affinity`."
Then stop.

Orchestrate the combat pipeline. Provide full context (paths, existing types) in
every agent prompt. Read each summary and verify the path before the next phase;
use `AskUserQuestion` at each gate.

## Team
`game-director` (does it serve the pillars?) · `balance-designer` (PL price) ·
`combat-engine-programmer` (`src/engine` — Opus) · `content-designer` (`src/data`) ·
`phaser-ui-programmer` (`src/game` playback) · `qa-tester` (tests).

## Pipeline

### Phase 1 — Design & price
Spawn `game-director` to confirm the feature fits the pillars and define its intent
(what it does, edge cases, why it's fun). Then `balance-designer` to set the PL
price / budget and, if it's a new effect, the pricing rule.
Gate: `AskUserQuestion` — proceed / revise / stop.

### Phase 2 — Engine
If the feature needs a new `Action` kind, rule, or event, spawn
`combat-engine-programmer`: extend the closed union, keep `simulate()` pure and
integer/deterministic, emit a `CombatEvent`, add engine tests. Verify the summary:
determinism preserved? tests green with counts?

### Phase 3 — Content & UI (parallel where independent)
- `content-designer`: author the card(s)/enemy using the new capability; must pass
  the balance audit and carry correct element/weapon tags.
- `phaser-ui-programmer`: render the new event in battle playback + tooltip/log.

### Phase 4 — Validate
Spawn `qa-tester`: unit + invariant tests, `npm run fight` to eyeball it, Playwright
smoke if UI changed. Require `npm test` green with exact counts.

### Phase 5 — Sign-off
Report COMPLETE / NEEDS-WORK / BLOCKED with per-agent verdicts and open items.
Ask before committing.

## Error recovery
If an agent returns BLOCKED, surface it immediately, don't proceed past a
dependency, and offer skip-and-note / retry-narrower / stop via AskUserQuestion.
Always produce a partial report — never discard completed work.

## Next steps
- `/orchestrate` for broader multi-system goals.
- Run `npm run sim` (via `balance-designer`) if the feature shifts win rates.
