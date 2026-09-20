# Per-goal SDD records

**User ruling (2026-09-20):** `ACTIVE-WORK.md` is retired. Do not open,
update, or recreate it, and do not treat historical board rows as current
ownership. Use direct coordination with available agents and the existing
per-goal task record. Other ownership, heartbeat, review, and verification
requirements remain unchanged.


Read when: you are about to make your first write of a task, you need to record
evidence, or you are trying to find what another agent already did.

Both agents write the same artifacts, so either can pick up where the other
stopped. Claude's `/orchestrate` and Codex's superpowers
subagent-driven-development are two drivers of ONE ledger. A task that leaves
nothing on disk is invisible to the other agent.

## Where things live

```

.superpowers/sdd/<YYYY-MM-DD>-<slug>/  the per-goal ledger (GITIGNORED, machine-local)
docs/superpowers/specs/<YYYY-MM-DD>-<slug>-design.md   the spec
docs/superpowers/plans/<YYYY-MM-DD>-<slug>.md          the plan (tasks with files and steps)
docs/superpowers/reports/<YYYY-MM-DD>-<slug>.md        shipped evidence
```

`.superpowers/` AND `/docs/superpowers/` are both gitignored on this checkout,
so NONE of it survives a fresh clone — check `.gitignore` before assuming a
path is tracked. Several `docs/superpowers/**` files do carry a `docs/INDEX.md`
row even though the bytes are local; INDEX is the owner map either way.

Coordinate current file ownership directly with available agents. Keep the
relevant per-goal ledger current; do not create a replacement global index.

## Registering — copy this

Record in the relevant goal's `progress.md`. Fill every line; `docs/coordination/session-orchestration.md` owns what each field means
and the legal values for Status.

```markdown
W1-<YYYYMMDD>-<NN>-<slug> — ACTIVE, <runtime + visible session/agent id, or `unknown-external`>.
Heartbeat: <local timestamp> — <latest durable action>.
User goal: <one sentence, in the user's terms>.
CLAIMS: <exact paths, or the narrowest safe directory/allowlist; name generated derivatives as well as their source>.
READ-ONLY on: <the surfaces you might otherwise be suspected of touching>.
Dependencies: <task IDs, decisions or gates that must finish first; `none` when independent>.
Latest evidence: <gate-chain result (`boundaries OK` / tsc exit 0 / `skill parity OK`) + the fight logs, audit output or screenshots that prove the change; a review verdict; or `none yet`>.
Next action: <one concrete step another session could execute without rediscovery>.
Tree: <QUIET|LIVE>. Gate chain + focused evidence; attribute any red to its owning task. No stage, commit, push or deploy.
```

`CLAIMS` is this template's spelling of the owner doc's **File claims**; every other
line carries the owner doc's field name.

The `Heartbeat` line is what keeps the row LIVE: `SKILL.md` §2 binds you to the
refresh cadence, and a record with no fresh heartbeat for 45 minutes is
`STALE` — which is not permission for anyone to take your files. Never leave a
row `ACTIVE` with no next action.

Historical board rows are not current claims; use direct agent communication.

## Inside a per-goal ledger

```
progress.md              REQUIRED. Names the plan in its first lines (the directory is NOT always
                         named after it). Task table | Task | Implementation | Review | Fix loops | Status |,
                         plus "## Rulings" (decision, why, cost if wrong), "## Review log", "## Handoff"
task-N-report.md         REQUIRED per task: scope, before/after evidence (gate-chain result, fight logs,
                         audit output, screenshots with viewports), files, concerns
task-N-review.md         REQUIRED per task: independent adversarial review, findings by severity, evidence, verdict
task-N-brief.md          usual: what the implementer was told (files, interfaces, steps, constraints)
task-N-review.diff       usual: the task-scoped diff the reviewer was given
task-N-baseline/         optional: pre-edit copies + manifest.md with protected-file SHA-256 hashes
task-N-fix-round-M-*     optional: brief/report/review/baseline for each review-fix loop
task-N-before.md|.txt    optional: the "before" evidence — the fight log or screenshot that shows the bug
design-qa.md             optional: visual QA for a UI goal
```

For current work, read the supplied goal's `progress.md` and its referenced
plan only. Confirm active ownership directly; do not scan other ledgers.

## Rules of the ledger

- One directory per plan. Never rename or delete another agent's ledger. Append.
- Every claim of green carries the command AND its printed verdict
  (`boundaries OK`, `skill parity OK`, tsc exit 0) plus the evidence that proves
  the change itself — a fight log, an audit run, a screenshot with its viewport.
  Never a bare "green" or "passes".
- Reviews report what is **wrong**, ordered Critical / Important / Minor, and end
  with `APPROVED` or `CHANGES_REQUESTED`. A review that only re-summarises what
  works is not a review (`CLAUDE.md`, "Audit every done").
- The ledger is local to this machine. If work moves to another clone, only the
  tracked plan's checkboxes and the tracked report carry the state — update them
  before you stop.
- Unplanned quick fix with no plan? No ledger needed. Leave the tree clean: your
  files only, the gate chain run, the evidence for the fix in chat, and every
  file you touched named there.

Back to [`../SKILL.md`](../SKILL.md).
