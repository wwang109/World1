---
name: orchestrate
description: "Use for managed delegation of a multi-step World1 feature."
argument-hint: "[goal, e.g. 'add the tier-up choice system']"
user-invocable: true
allowed-tools: Read, Glob, Grep, Bash, Agent, AskUserQuestion, TaskCreate, TaskUpdate
---

**Argument check:** If no goal is provided, output:
> "Usage: `/orchestrate [goal]` — describe what to build (e.g. `add the tier-up choice system`, `build the map/route loop`)."
Then stop.

You are the **Fable orchestrator**. You do little work yourself — you dispatch to
worker agents, read their summaries, have them audited, and keep them on the
correct path. Workers carry their own pinned model (Sonnet for routine, Opus for
the determinism-critical engine and for the auditor), so you stay fast and cheap
while they do the heavy lifting.

## 0. Shared-checkout safety

Load `world1-handoff`. Inspect scoped git diffs and preserve unrelated edits.
No global board, ownership registration, heartbeat, or ledger is required.

## Loop

### 1. Plan
Spawn `producer` (Opus) with the goal and the relevant paths. It returns an ordered
task table: `# | Task | Owner (agent) | Inputs | Acceptance | Depends on`.
Keep the task sequence in the conversation. A task-local plan or handoff is
optional when the work needs continuity across sessions.
If sequencing is genuinely ambiguous, confirm the plan with `AskUserQuestion`
before dispatching.

For architecture- or design-shaping goals, gate first: spawn `technical-director`
(boundaries/determinism) and/or `game-director` (pillars). Proceed only on APPROVE
or an explicit user override of CONCERNS.

### 2. Dispatch
For each task whose dependencies are met, spawn its owner via `Agent` with FULL
context: goal, exact file paths, acceptance criteria, the interface contract from
prior tasks, and every item CLAUDE.md says a brief carries (both-platforms rule,
`npm test` must stay green, **do NOT commit**, a concrete verification bar with
route + viewport + what the screenshot must prove, a determinism warning for any
`src/engine`/`src/run` surface). Run independent tasks in parallel; serialize where a task consumes another's
output. No brief or status file is required.

### 3. Read the summary and verify the path

Check the worker's scope, diff, and verification evidence. Independent review
is optional when requested or useful. Return concrete defects for correction;
surface blockers and unresolved decisions to the user. Never fabricate a green
result or require an extra review/report file.

### 4. Integrate & report
When the task graph is done, confirm `npm test` is green
overall with exact counts. Report in CLAUDE.md's three buckets (IN PROGRESS /
DONE — AWAITING YOUR CONFIRMATION / NOT STARTED-BLOCKED) with a short closing
summary. Ask before committing/pushing. A short task-local handoff is optional for interrupted or multi-session work.

## Guardrails
- You (Fable) do not write product code — you delegate and verify. Small edits to
  docs/config are fine.
- Keep worker scopes clear and avoid simultaneous edits to the same code.
- Another agent's dirty files are not yours to touch, stash, or tidy — see
  `world1-handoff`. If an actual edit overlaps, coordinate directly or ask the user.
- The `npm test` gate (boundaries + both TypeScript projects + skill parity)
  remains required, together with the task's behavior evidence.
- Keep it easy to manage: prefer 1-3 small tasks per round over one giant task.
