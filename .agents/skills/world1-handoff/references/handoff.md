# Stopping — finished, blocked, or out of context

Read when: you are about to stop for any reason, or you are deciding whether
something is actually done.

## Definition of done (identical for both agents)

- The gate chain green — boundaries, both TypeScript projects, skill parity —
  with each printed verdict quoted, and any red attributed to the task that
  claims the file. On this machine invoke them directly:
  `node scripts/check-boundaries.mjs` (`boundaries OK`),
  `node node_modules/typescript/bin/tsc --noEmit`,
  `node node_modules/typescript/bin/tsc -p tsconfig.functions.json --noEmit`,
  `node scripts/check-skill-parity.mjs` (`skill parity OK`).
- The evidence the brief asked for, produced and filed: the `npm run fight`
  on/off pair (and the same-seed diff for any `src/engine` edit),
  `npm run content:validate` / `npm run scaffold:card` for content, the audit
  script run for a screen. No `*.test.ts` exists to stand in for any of it.
- **Both platforms** for any UI change: desktop 1440x900 and mobile 412x892 are
  separate layouts, each verified. Routes and the capture recipe are in
  `docs/ui-workbook.md`; what each screen must show is
  `docs/feature-inventory.md`.
- Any claim about what a card or keyword does leads with a real combat log from
  `scripts/fight.ts`, never a hand-written rendering (`CLAUDE.md` owns this
  rule, including the mobile log format).
- LIVING docs updated in the same change; `docs/INDEX.md` names the owner.
- An **independent** review before the word "done": the `code-reviewer` agent on
  the Claude side, the SDD reviewer on the Codex side. Either way the review
  lands in `task-N-review.md`.
- The user confirms. Nothing is done on an agent's own say-so.

## Before you stop — write the handoff

Append to the goal ledger's `progress.md` under a `## Handoff` heading, using
the field names `docs/coordination/session-orchestration.md` mandates:

```markdown
## Handoff <YYYY-MM-DD HH:MM local> (<claude|codex> / <session-or-agent-id>)

- Status: ACTIVE | READY_FOR_REVIEW | CHANGES_REQUESTED | AWAITING_USER | BLOCKED
- File claims: <exact paths or allowlist; say which you are RELEASING and which you still hold>
- Changed: <exact completed work; distinguish generated, canonical and served files>
- Evidence: <gate chain: `boundaries OK` / tsc exit 0 (both projects) / `skill parity OK`; then what proves the change — fight log paths and the on/off boards, same-seed diff silent, audit script output, screenshots with viewports; review/report paths>
- Remaining: <bounded unfinished work>
- Next action: <the first executable step, no rediscovery required>
- Dependencies/blocker: <task IDs or none>
- User decision: <the exact question, or none>
- Safety: <servers or processes left running; no stage/commit/push/deploy unless explicitly authorised>
```

Keep the per-goal record's Status, Heartbeat, and File claims current.
Notify affected agents directly which paths are released or still held.
Do not open or update the retired global board.

`docs/coordination/session-orchestration.md` owns the canonical field list and
the status values; read it there rather than trusting a copy.

## Then report in chat

Use `CLAUDE.md`'s three buckets — IN PROGRESS / DONE — AWAITING YOUR
CONFIRMATION / NOT STARTED-BLOCKED — and its short closing summary. Name the
tree state (QUIET or LIVE) and the in-flight plan, if any. Do not restate the
detail that is already in the ledger; point at it.

Back to [`../SKILL.md`](../SKILL.md).
