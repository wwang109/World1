---
name: world1-handoff
description: Use when starting or handing off World1 work in the shared checkout, or when edits may overlap another agent.
---

# World1 shared-checkout workflow

Read `docs/coordination/session-orchestration.md` once per session; reuse it
when already in context. It owns coordination and the retirement of the
global board, mandatory ownership records, and mandatory independent reviews.

Inspect scoped git status/diffs and preserve existing changes. When an actual
overlap prevents a safe edit, communicate directly or ask the user. Routine
work needs no file claims, heartbeat, ledger, or review agent.

`CLAUDE.md` owns engine/UI invariants, verification, and publication permission.
Use `world1-testing` for the relevant evidence; a passing gate alone does not
prove behavior.

Read only as needed:

- [Collisions](references/collisions.md): overlapping or generated files.
- [Handoff](references/handoff.md): finishing or interrupted work.
- [Optional notes](references/ledger.md): continuity across sessions.
