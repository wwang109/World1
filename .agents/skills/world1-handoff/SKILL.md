---
name: world1-handoff
description: Use at the START of every World1 task, before the first edit, and again when finishing, blocked, or running out of context. OpenAI Codex CLI and Anthropic Claude Code (plus their subagents) edit this SAME checkout, often at the same time. Level 1 is the liveness check, the file-claim etiquette, and the gate-chain and evidence commands that actually work here; references/ carries the SDD ledger and registration format, the collision playbook, and the handoff procedure.
---

# World1 handoff — working alongside other agents

**User ruling (2026-09-20):** `ACTIVE-WORK.md` is retired. Do not open,
update, or recreate it, and do not treat historical board rows as current
ownership. Use direct coordination with available agents and the existing
per-goal task record. Other ownership, heartbeat, review, and verification
requirements remain unchanged.


Codex CLI (reads `AGENTS.md`, skills from `.agents/skills/`) and Claude Code
(reads `CLAUDE.md`, skills from `.claude/skills/`, subagents from
`.claude/agents/`) share this working tree and this git history and nothing
else — neither reads the other's skills, neither sees the other's chat. Assume
another agent is mid-edit until you have checked.

## 1. Liveness check — run BEFORE your first edit

Git Bash, seconds. Every command below is verified to work on this checkout.

```
git status --short

find . -path ./node_modules -prune -o -path ./.git -prune -o -path ./dist -prune -o -type f -mmin -30 -print
tasklist | grep -i -E "codex|claude"
```

PowerShell: `tasklist | findstr /i "codex claude"`. (`findstr /i` fails in Git
Bash — MSYS rewrites `/i` as a path — and `pgrep` does not exist here.)

Then inspect the diff for paths you intend to edit and coordinate claims
directly with available agents. Read only the per-goal task record supplied
for this work, not the newest ledger or unrelated history. `.superpowers/`
is GITIGNORED and machine-local; a missing record never means "no other agent".

Name the verdict in your first status line:

- **QUIET** — no agent process, and no file changed in the last **~30 minutes**
  that you did not change yourself.
- **LIVE** — an agent process is running, or a file you did not touch changed in
  the last **~30 minutes**, or a directly reported task is `ACTIVE`, `READY_FOR_REVIEW`,
  `CHANGES_REQUESTED` or `CONFLICT`, or a ledger task is in progress. Work in
  shared-live mode and name the in-flight task in your report.

## 2. File-claim etiquette (binding)

- **Register your Task ID, Heartbeat and exact File claims before your first
  product write.** The Heartbeat is a local timestamp plus your latest durable
  action; refresh it at task start, after every material write batch, before a
  long-running tool call, when your status changes, and at least every **30
  minutes**. It is the only thing that separates a LIVE task from a `STALE` one.
- **Dirty files you did not change are another agent's in-flight work.** Never
  `git stash`, `git checkout -- <file>`, `git reset`, `git clean`, reformat,
  re-indent, fix line endings, or otherwise "tidy" them.
- **Do not edit a file an active task claims.** Mark the affected per-goal tasks `CONFLICT` and
  stop overlapping writes until the coordinator records a ruling. Silence, an old
  heartbeat, or a missing process is never permission to take another task's files.
- **Create new files in your own area**; edit only files no active task claims.
- **No agent stages, commits, pushes, or deploys without the user's explicit
  say-so.** `CLAUDE.md` owns the commit/push rule; this skill extends it to
  staging and deploys.
- **Scratch goes to `tmp/`, ledgers to `.superpowers/`** — both gitignored.
  Nothing lands in the repo root.

## 3. The gate chain plus YOUR evidence, on any tree

No `*.test.ts` file exists in this repo — `CLAUDE.md` §"Verification is by
evidence — no test files (USER-LOCKED 2026-09-15)" owns the rule, and
`scripts/check-boundaries.mjs` fails if one reappears. So there is no "focused
suite" to pick from and no full suite to avoid. The gate chain is three scripts
and both TypeScript projects; it is seconds, touches nobody's files, and is safe
on a LIVE tree. Run all of it, every time.

**`npm run <script>` and `npx <tool>` run only where the clone has a
`node_modules/.bin`** — it may or may not, and another session's install can
flip that mid-task. The direct entrypoints work in either state, so prefer them:

```
node scripts/check-boundaries.mjs                                        # boundaries OK
node node_modules/typescript/bin/tsc --noEmit
node node_modules/typescript/bin/tsc -p tsconfig.functions.json --noEmit
node scripts/check-skill-parity.mjs                                      # skill parity OK
node node_modules/tsx/dist/cli.mjs scripts/fight.ts <enemyId> <seed>     # the combat evidence
```

The chain proves the TREE compiles and obeys the boundaries. It does not prove
YOUR change — that is the focused evidence the brief asked for: an `npm run
fight` on/off pair for your board (two same-seed runs diffed when you touched
`src/engine`), `npm run content:validate` and `npm run scaffold:card` for
content, the audit script and both-viewport screenshots for your screen. The
`world1-codemap` skill's `references/verification.md` maps each subject to its
evidence.

What you do NOT do on a LIVE tree is claim a whole-tree verdict from someone
else's in-flight files. A red gate is as likely another agent's half-saved file
as your bug: confirm the failing file's ownership directly, name the owner
when known in your report, and never "fix" unrelated work. Diff against HEAD in an
isolated worktree if you cannot tell whose it is.

## References

| Read this | At this moment |
|---|---|
| [`references/ledger.md`](references/ledger.md) | Before your first write — per-goal registration and evidence |
| [`references/collisions.md`](references/collisions.md) | A file you need is dirty, claimed, generated, or you cannot tell whose it is |
| [`references/handoff.md`](references/handoff.md) | Finishing, blocked, or out of context — plus the definition of done |

Read order, every session, before the work: `CLAUDE.md` (the charter for every
agent regardless of vendor) -> `docs/INDEX.md` (the owner map; doc vs doc the
owner wins, doc vs code code wins) -> this skill ->
`docs/coordination/session-orchestration.md` (owns the task-record fields,
status vocabulary, heartbeats, conflict handling and the handoff block) -> the
relevant per-goal task record -> the owner doc for the surface you are about to touch. Read those rather
than restating them.
