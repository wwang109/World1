# Collisions — whose file is this?

Read when: a file you need is already dirty, another task claims it, it is
generated, or you cannot tell which tool owns it.

## Why this exists

On 2026-09-05 Codex was mid-task (event content v3, Task 6) when a Claude
session ran the full `npm test`. Typecheck failed on two files Codex had saved
two minutes earlier. Nothing was wrong except the timing, and a report written
from that run would have blamed finished work for an edit in progress. The
lesson is not "do not run the gate" — it is "attribute every red to the task
that claims the file before you report it" (`../SKILL.md` §3).

## The playbook

1. **Compare your proposed file claims directly with available agents' active
   claims** before you write. Any possible overlap becomes `CONFLICT` before
   either session continues; unclear ownership requires a question.
2. **Mark the affected per-goal tasks `CONFLICT`** and stop overlapping writes until the
   coordinator records a ruling. Do not negotiate through the file.
3. **If your task genuinely needs a claimed file, stop and ask the user which
   agent yields.** Silence, a stale heartbeat, or a missing process is never
   permission. `STALE` is not permission to take ownership either.
4. **One task owns a writable file at a time.** Reviewers own only their report
   and scratch evidence; they do not inherit implementation ownership.
5. **A line-disjoint, additive overlap can proceed** when deadlocking would
   break the other session too (for example a one-line append to a shared list
   that the parity script requires). Both sessions must then use a
   string-replacement edit, never a whole-file write, and both must confirm the agreement directly and in
   their per-goal records.
6. **Never "tidy" another agent's work** — [`../SKILL.md`](../SKILL.md) §2 owns
   that list, and it binds from the moment a file you did not change is dirty.

`docs/coordination/session-orchestration.md` owns the status vocabulary
(`ACTIVE`, `READY_FOR_REVIEW`, `CHANGES_REQUESTED`, `AWAITING_USER`, `BLOCKED`,
`UNCLAIMED`, `CONFLICT`, `STALE`, `CLOSED`), the heartbeat cadence, and the
coordinator's duties. Read the definitions there.

## Generated files

Regenerated only by the task that owns them, and only through their script.
Idempotency is proven by regenerating and running `git diff --stat` — an empty
diff is the proof; `npm run content:validate` additionally refuses a stale
`events.v3.json` or `docs/generated/event-catalog.md`.

- `content:export` writes `enemies.v1.json` and `modifiers.v1.json`.
- `skills.v1.json`, `gems.v1.json`, `events.v1.json` are HAND-AUTHORED;
  `scaffold:card` only prints a card block to paste.
- `content:events` writes `events.v3.json`. `events.v2.json` is frozen.
- `content:wiki` writes `docs/generated/event-catalog.md`.
- `art:encode` writes `public/game-art/**`.
- `tests/engine/fixtures/outcomeBaseline.json` is an ORPHAN: its writer
  `tests/engine/fixtures/captureOutcomeBaseline.ts` still exists, but nothing
  reads the file since the suite was deleted. Do not regenerate it as evidence.

Script names above are the `package.json` entries; invoke them directly
(`node node_modules/tsx/dist/cli.mjs scripts/<file>.ts`) — that form runs
whether or not the clone has the `node_modules/.bin` `npm run` needs.

## Line endings and the sandbox

- Windows checkout, `core.autocrlf=true`. Mixed endings in the working tree are
  expected and git normalises on commit; the warning "LF will be replaced by
  CRLF" is noise. Do not fix it repo-wide — that is the user's call.
- **Sandbox note (Codex):** if the sandbox blocks `tsx` or `tsc` from reading
  the project config, ask the user for approval to rerun outside the boundary,
  then record the approval and the rerun in the report. Never weaken a gate
  script or trim the evidence to get past the sandbox.

## Where each tool keeps its things

| | Codex CLI | Claude Code |
|---|---|---|
| Instructions | `AGENTS.md`, which summarises and points to `CLAUDE.md` | `CLAUDE.md` |
| Project skills | `.agents/skills/` | `.claude/skills/` |
| Shared skills | identical twins in both roots; `scripts/check-skill-parity.mjs` enforces it | same |
| Orchestration | superpowers SDD (brief, implement, review) | `/orchestrate`, `/team-combat`, the `.claude/agents/` roster, the `code-reviewer` audit |
| Private state | `~/.codex/`, `.codex-remote-attachments/` | `~/.claude/projects/<repo>/memory/` |
| Scratch | `tmp/`, `.superpowers/` | `tmp/`, `.superpowers/` |

Editing a shared skill: change one copy, then copy the whole directory over the
other, and keep the frontmatter to the portable keys (`name`, `description`);
`references/*.md` carry no frontmatter at all. Prove parity with
`node scripts/check-skill-parity.mjs` (prints `skill parity OK`) and
`diff -r .agents/skills/<name> .claude/skills/<name>` — it must be silent. A
NEW shared skill also needs its `.gitignore` whitelist lines and an entry in the
script's `SHARED_SKILLS` list; the script names whichever is missing.

Back to [`../SKILL.md`](../SKILL.md).
