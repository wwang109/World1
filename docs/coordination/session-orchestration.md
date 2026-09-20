# Cross-session orchestration

**User ruling (2026-09-20):** `ACTIVE-WORK.md` is retired. Do not open,
update, or recreate it, and do not treat historical board rows as current
ownership. Use direct coordination with available agents and the existing
per-goal task record. Other ownership, heartbeat, review, and verification
requirements remain unchanged.


Scope: the durable coordination contract for every Claude Code, Codex, and
sub-agent session working in this checkout. Product facts remain owned by the
documents named in `docs/INDEX.md`; this file owns only task ownership, status,
and handoff rules.

## Sources of truth

Use these in order:

1. Current code describes implemented behaviour.
2. Direct coordination with available agents and the relevant per-goal task
   record establish current task/session/file ownership.
3. Each `.superpowers/sdd/<goal>/progress.md`, task brief, report, and review
   owns detailed evidence for that goal.
4. Chat memory and process names are clues, never authoritative task records.

Per-goal records are machine-local. A tracked plan/report must receive a
handoff before work moves to another clone.

## Required task record

Register before the first product, artwork, generated-output, test, or owner-doc
write. Register in the existing per-goal task record, not a global board.

| Field | Required content |
|---|---|
| Task ID | Stable `W1-YYYYMMDD-NN[-slug]` identifier. |
| Session / agent | Runtime plus visible session/agent ID; use `unknown-external` when it cannot be discovered. |
| Status | One status from the state table below. |
| Heartbeat | Local timestamp and the latest durable action. |
| File claims | Exact paths or the narrowest safe directory/allowlist. Generated families name both source and derivative ownership. |
| Dependencies | Task IDs, decisions, or gates that must finish first; `none` when independent. |
| Latest evidence | Exact test counts, review verdict, receipt, or current measurable progress. Never write only “tests pass”. |
| Next action | One concrete action another session can execute without rediscovery. |

## Status vocabulary

- `ACTIVE` — an identified owner is currently implementing or generating.
- `READY_FOR_REVIEW` — implementation stopped and an independent reviewer may begin.
- `CHANGES_REQUESTED` — review found unresolved Critical/Important/Minor work.
- `AWAITING_USER` — independently reviewed work requires user visual or design confirmation.
- `BLOCKED` — the owner cannot progress; the record names the blocker and the attempted alternatives.
- `UNCLAIMED` — known work has no identified owner and no product writes may be attributed to a session.
- `CONFLICT` — active or newly observed work overlaps another task's file claim. Stop overlapping writes until the coordinator records a ruling.
- `STALE` — no heartbeat, process, or matching file activity for 45 minutes; this is not permission to take ownership.
- `CLOSED` — independently approved and user-confirmed, or explicitly cancelled. Mark it closed in the per-goal task record.

## Claim and heartbeat rules

1. Check scoped git status/diffs, coordinate writable paths directly with
   available agents, and add or refresh the relevant per-goal task record.
2. Compare proposed File claims with the other agents' directly reported
   active claims. Any possible overlap becomes `CONFLICT` before either
   session continues. If ownership is unclear, ask rather than scan history.
3. One task owns a writable file at a time. Reviewers own only their report and
   scratch evidence; they do not inherit implementation ownership.
4. Refresh Heartbeat at task start, after every material write batch, before a
   long-running tool call, and at least every 30 minutes.
5. Record observable facts. If an owner or state is uncertain, write
   `unknown-external` or `UNCLAIMED`; do not infer completion from silence.
6. Update the per-goal task ledger when status changes and notify affected
   agents directly. There is no global index.
7. Before stopping, relinquishing, or exhausting context, provide the handoff
   block below. Never leave a row as `ACTIVE` with no next action.

## Handoff block

```markdown
### W1-YYYYMMDD-NN — YYYY-MM-DD HH:MM local — claude|codex / session-id
- Status: ACTIVE | READY_FOR_REVIEW | CHANGES_REQUESTED | AWAITING_USER | BLOCKED
- File claims: exact paths or allowlist
- Changed: exact completed work; distinguish generated, canonical, and served files
- Evidence: command -> exact counts; review/report paths; screenshots and viewports
- Remaining: bounded unfinished work
- Next action: first executable step
- Dependencies/blocker: task IDs or none
- User decision: exact question or none
- Safety: servers/processes left running; no stage/commit/push/deploy unless explicitly authorised
```

## Coordinator duties

The primary session coordinates claims directly without taking credit for worker work.
It reconciles recent writes against heartbeats, marks uncertainty honestly,
routes completed implementation to an independent reviewer, and assigns only
non-overlapping tasks. It may mark a row `STALE`; only an explicit ruling may
reassign its File claims. It closes the per-goal task after user confirmation rather than accumulating
global status rows.

The checkout is `LIVE` while any task is `ACTIVE`, `CONFLICT`, or visibly
writing. Run focused checks only. Run repository-wide `npm test` only on a
verified `QUIET` tree, following `world1-handoff`.
