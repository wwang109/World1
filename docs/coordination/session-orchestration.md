# Shared-checkout workflow

Scope: coordination for Claude Code, Codex, and their agents. Product facts
remain owned by the documents named in `docs/INDEX.md`.

User ruling (2026-09-20): no mandatory ownership records, file claims,
heartbeats, task ledgers, or independent reviews. `ACTIVE-WORK.md` is
retired: do not read, update, recreate, or replace it with another global log.
Leave historical records untouched.

## Working safely

- Read the charter once per session, then only the owner docs and references
  relevant to the task. Reuse instructions already in context; do not scan
  unrelated plans, reports, or session history.
- Inspect `git status --short` and `git diff -- <paths you will touch>`.
  Preserve existing changes. Never stash, reset, revert, clean, or reformat
  another person's work.
- If actual edits overlap or a safe change is unclear, coordinate directly
  with the available agent or ask the user. No registration or formal
  ownership approval is required for routine work.
- Include generated derivatives when checking a script's write scope. Do not
  restart or kill development servers another session started.
- Run `npm test` and the relevant behavior evidence required by `CLAUDE.md`.
  Report observed failures without guessing responsibility or changing
  unrelated files. Independent review is optional when requested or useful.
- Staging, committing, pushing, and deploying require user authorization.

## Reporting

Report changed paths, actual verification, unfinished work, and blockers in
the current conversation. A short task-local handoff is optional for genuinely
interrupted or multi-session work; routine changes need no extra files.
