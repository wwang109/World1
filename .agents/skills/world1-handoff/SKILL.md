---
name: world1-handoff
description: Use at the start of every World1 task, before the first edit, and when finishing, blocked, or running out of context. More than one AI agent (OpenAI Codex CLI and Anthropic Claude Code, plus their subagents) edits this SAME checkout, often at the same time. This skill is the cross-agent protocol - find out who else is working and on which files, follow worktree etiquette on a shared live tree, write the one shared SDD ledger under .superpowers/sdd/, and hand off so the other agent can continue without rediscovering anything.
---

# World1 handoff — working alongside other agents

Two agents share this checkout: OpenAI **Codex CLI** (reads `AGENTS.md`,
skills from `.agents/skills/`, runs the superpowers plugin's
subagent-driven-development) and Anthropic **Claude Code** (reads
`CLAUDE.md`, skills from `.claude/skills/`, subagents from `.claude/agents/`).
Neither tool reads the other's skill directory, and neither can see the
other's chat. The only things they share are the working tree, the git
history, and the files described here. Everything below keeps those honest.

Origin: on 2026-09-05 Codex was mid-task (event content v3, Task 6) when a
Claude session ran the full `npm test`. Typecheck failed on two files Codex
had saved two minutes earlier. Nothing was wrong except the timing, and a
report written from that run would have blamed finished work for an edit in
progress.

## 0. Read order (every session, every agent)

1. `CLAUDE.md` — the charter for every agent regardless of vendor. Its
   USER-LOCKED sections bind Codex exactly as they bind Claude.
2. `docs/INDEX.md` — the owner map. Doc vs doc: the owner wins. Doc vs code:
   code wins.
3. This skill.
4. `docs/coordination/session-orchestration.md` — the durable ownership,
   heartbeat, conflict, and handoff contract.
5. `.superpowers/sdd/ACTIVE-WORK.md` — the machine-local live task board.
6. The owner doc for the surface you are about to touch (INDEX names it).

## 1. Who else is here? (before the first edit)

Open `.superpowers/sdd/ACTIVE-WORK.md` first. Register or refresh your Task ID,
Session / agent, Status, Heartbeat, exact File claims, Dependencies, Latest
evidence, and Next action before any product write. Follow
`docs/coordination/session-orchestration.md`. If an active claim may overlap,
mark both rows `CONFLICT` and stop overlapping writes until the coordinator
records a ruling. Silence, an old heartbeat, or a missing process is never
permission to take another task's files.

Run all four in **Git Bash** (the shell both tools use on this machine);
they take seconds:

```
git status --short
ls -t .superpowers/sdd/                    # newest first; the directories are plan ledgers
find . -path ./node_modules -prune -o -path ./.git -prune -o -path ./dist -prune -o -type f -mmin -30 -print
tasklist | grep -i -E "codex|claude"       # agent processes (PowerShell: tasklist | findstr /i "codex claude")
```

(`findstr /i` fails in Git Bash because MSYS rewrites `/i` as a path, and
`pgrep` does not exist here; in PowerShell use `Get-ChildItem .superpowers/sdd
| Sort-Object LastWriteTime -Descending` for line 2.)

Then open the newest `.superpowers/sdd/<ledger>/progress.md`. Its first
lines name the plan file in a `plan:` reference (the ledger directory is NOT always named
after it). The task table says which task is `in progress` (older ledgers use
a per-task list instead); that task's section in the plan lists the files it
owns.

Decide the tree state and say it in your first status line:

- **QUIET** — no agent process, and no file changed in the last ~30 minutes
  that you did not change yourself. Normal work.
- **LIVE** — an agent process is running, or files you did not touch changed
  recently, or a ledger task is `in progress`. Work in **shared-live mode**
  (section 2) and name the in-flight plan and task in your report.

## 2. Worktree etiquette

- **Dirty files you did not change are another agent's in-flight work.**
  Never `git stash`, `git checkout -- <file>`, `git reset`, `git clean`,
  reformat, re-indent, fix line endings, or otherwise "tidy" them.
- **Do not edit a file an in-progress task owns.** If your task needs it,
  stop and ask the user which agent yields. Do not negotiate through the file.
- **Shared-live mode:** create new files in your own area; edit only files no
  ledger task claims; run focused tests (`npx vitest run <file>`), not the
  full gate. The full `npm test` is evidence only on a QUIET tree, and even
  then it describes the whole tree, not just your change. Say so.
- **Generated files are regenerated only by the task that owns them, and only
  through their script:** `content:export` writes `enemies.v1.json` and
  `modifiers.v1.json` (`skills.v1.json`, `gems.v1.json`, `events.v1.json` are
  hand-authored; `scaffold:card` only prints a card block to paste); `content:events` writes
  `events.v3.json`; `content:wiki` writes `docs/generated/event-catalog.md`;
  `art:encode` writes `public/game-art/**`;
  `tests/engine/fixtures/captureOutcomeBaseline.ts` writes
  `outcomeBaseline.json`. `events.v2.json` is frozen. Byte-idempotency tests
  guard all of these and will name you.
- **No agent commits, stages, pushes, or deploys without the user's explicit
  say-so.** `CLAUDE.md` owns the commit/push rule; this skill extends it to
  staging and deploys. Codex's SDD briefs forbid all of it outright per task;
  Claude asks first. Either way the user decides, every time.
- **Line endings:** Windows checkout, `core.autocrlf=true`. Mixed endings in
  the working tree are expected and git normalises on commit; the warning "LF
  will be replaced by CRLF" is noise. Do not fix it repo-wide. That is the
  user's call.
- **Scratch goes to `tmp/`** (probes, screenshots, audit dumps; gitignored).
  Ledgers go to `.superpowers/` (gitignored). Nothing lands in the repo root.
- **Sandbox note (Codex):** if the sandbox blocks `tsx` or `vitest` from
  reading the project config, ask the user for approval to rerun outside the
  boundary, then record the approval and the rerun in the report. Never weaken
  a test to get past the sandbox.

## 3. The one shared ledger (SDD)

Both agents write the same artifacts, so either can pick up where the other
stopped. Claude's `/orchestrate` and Codex's superpowers
subagent-driven-development are two drivers of one ledger. A task that
leaves nothing on disk is invisible to the other agent.

The global index is `.superpowers/sdd/ACTIVE-WORK.md`; it owns only current
session/task/file ownership and points into the detailed per-goal ledgers below.
Keep it compact and current. Do not replace task reports or evidence with board
summaries.

```
docs/superpowers/specs/<YYYY-MM-DD>-<slug>-design.md   the spec   (tracked; INDEX row)
docs/superpowers/plans/<YYYY-MM-DD>-<slug>.md          the plan   (tracked; tasks with files and steps)
docs/superpowers/reports/<YYYY-MM-DD>-<slug>.md        shipped evidence (tracked; INDEX row, HISTORY)
.superpowers/sdd/<YYYY-MM-DD>-<slug>/                  the live ledger (this machine only; gitignored)
  progress.md              REQUIRED. Names the plan in its first lines; task table | Task | Implementation | Review | Fix loops | Status |,
                           "## Rulings" (decision, why, cost if wrong), "## Review log", "## Handoff" blocks
  task-N-report.md         REQUIRED per task: scope, RED/GREEN evidence with counts, files, concerns
  task-N-review.md         REQUIRED per task: independent adversarial review, findings by severity, evidence, verdict
  task-N-brief.md          usual: what the implementer was told (files, interfaces, steps, constraints)
  task-N-review.diff       usual: the task-scoped diff the reviewer was given
  task-N-baseline/         optional: pre-edit copies + manifest.md with protected-file SHA-256 hashes
  task-N-fix-round-M-*     optional: brief/baseline for each review-fix loop
```

Rules of the ledger:

- One directory per plan; `progress.md` names the plan in its first lines.
  Never rename or delete another agent's ledger. Append.
- Every claim of green carries the command and exact counts
  (`focused 47/47`, `repository-wide 4,111 passed / 1 skipped`).
- Reviews report what is **wrong**, ordered Critical / Important / Minor, and
  end with `APPROVED` or `CHANGES_REQUESTED`. A review that only re-summarises
  what works is not a review (CLAUDE.md, "Audit every done").
- The ledger is local to this machine. If work moves to another clone, the
  tracked plan's checkboxes and the tracked report carry the state. Update
  them before you stop.
- Unplanned quick fix with no plan? No ledger needed. Leave the tree clean:
  your files only, focused tests run, and name every file you touched in chat.

## 4. Definition of done (identical for both agents)

- `npm test` green with exact counts on a QUIET tree (boundaries, typecheck,
  vitest).
- **Both platforms** for any UI change: desktop 1440x900 and mobile 412x892
  are separate layouts, each verified. Routes and the capture recipe are in
  `docs/ui-workbook.md`; what each screen must show is
  `docs/feature-inventory.md`.
- Any claim about what a card or keyword does leads with an `npm run fight`
  log, never a hand-written rendering (CLAUDE.md).
- LIVING docs updated in the same change; `docs/INDEX.md` names the owner.
- An **independent** review before the word "done": the `code-reviewer`
  agent on the Claude side, the SDD reviewer on the Codex side. Either way
  the review lands in `task-N-review.md`.
- The user confirms. Nothing is done on an agent's own say-so.

## 5. Stopping — finished, blocked, or context running out

Append to the plan's `progress.md`:

```
## Handoff 2026-09-05 13:40 (claude-code | codex)
- state: Task 6 in progress. Packs 100/110 written; runtime test half done.
- files: src/data/content/event-packs/100-global-payoffs.json (done); tests/run/globalEventsV3Runtime.test.ts (line 411 unfinished)
- tests: npx vitest run tests/run/globalEventsV3Runtime.test.ts -> 12/14; typecheck red at eventV3Rewards.ts:206
- next: finish the boundSubject narrowing, then Task 6 review
- ask the user: none
```

Then report in chat using CLAUDE.md's three buckets (IN PROGRESS / DONE —
AWAITING YOUR CONFIRMATION / NOT STARTED-BLOCKED) and its short closing
summary. Name the tree state (QUIET or LIVE) and the in-flight plan, if any.

## 6. Where each tool keeps its things

| | Codex CLI | Claude Code |
|---|---|---|
| Instructions | `AGENTS.md`, which summarises and points to `CLAUDE.md` | `CLAUDE.md` |
| Project skills | `.agents/skills/` | `.claude/skills/` |
| Shared skills | `world1-handoff`, `world1-game-review` in both roots, identical; `tests/build/skillParity.test.ts` enforces it | same |
| Orchestration | superpowers SDD (brief, implement, review) | `/orchestrate`, `/team-combat`, the `.claude/agents/` roster, the `code-reviewer` audit |
| Private state | `~/.codex/`, `.codex-remote-attachments/` | `~/.claude/projects/<repo>/memory/` |
| Scratch | `tmp/`, `.superpowers/` | `tmp/`, `.superpowers/` |

Editing a shared skill: change one copy, then copy it over the other
(`cp .agents/skills/<name>/SKILL.md .claude/skills/<name>/SKILL.md`), and keep
the frontmatter to the portable keys (`name`, `description`). A new shared
skill also needs its `.gitignore` whitelist lines and an entry in the
`SHARED_SKILLS` list of the parity test. The test names whichever is missing.
