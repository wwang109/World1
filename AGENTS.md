# AGENTS.md — entrypoint for every AI agent (Codex CLI, Claude Code, others)

More than one AI agent works in this repository, sometimes at the same time,
in the same checkout. The charter is the same for all of them:

1. **Read `CLAUDE.md` in full.** It is the charter for EVERY agent, not only
   Claude: stack, commands, layer boundaries, determinism rules, and the
   user-locked working conventions (combat log first, both platforms, audit
   every "done", three-bucket reporting, no commit or push without the user's
   word).
2. **Read `docs/INDEX.md`** — the owner map. If two docs disagree, the owner
   named there wins; if a doc disagrees with code, code wins.
3. **Load the `world1-handoff` skill before your first edit.** It is the
   cross-agent protocol: how to see who else is working and on which files,
   worktree etiquette on a shared live tree, the one SDD ledger under
   `.superpowers/sdd/`, and how to hand off. It lives in both
   `.agents/skills/` (Codex) and `.claude/skills/` (Claude Code); the copies
   are identical and `tests/build/skillParity.test.ts` keeps them so.

Skills every agent shares: `world1-handoff`, `world1-game-review`.
Claude-only drivers of the same ledger: `/orchestrate`, `/team-combat`, the
`.claude/agents/` roster, and the `code-reviewer` audit agent.

## History

The original two-agent (Claude ↔ Codex CLI) arrangement ended with the
first-generation UI (removed in commit fff2ced). Its working docs live in
`docs/history/` (codex-ui-guide, codex-handoff, codex-game-brief). Never cite
them as current.
