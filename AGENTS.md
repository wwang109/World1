# AGENTS.md — entrypoint for every AI agent (Codex CLI, Claude Code, others)

**User ruling (2026-09-20):** `ACTIVE-WORK.md` is retired. Do not open,
update, or recreate it, and do not treat historical board rows as current
ownership. Use direct coordination with available agents and the existing
per-goal task record. Other ownership, heartbeat, review, and verification
requirements remain unchanged.


More than one AI agent works in this repository, sometimes at the same time,
in the same checkout. The charter is the same for all of them:

1. **Read `CLAUDE.md` in full.** It is the charter for EVERY agent, not only
   Claude: stack, commands, layer boundaries, determinism rules, and the
   user-locked working conventions (combat log first, both platforms, audit
   every "done", three-bucket reporting, tag every game entity by kind —
   `[card] Hibernation`, never a bare id — comments say WHAT and the ledger
   says WHY (default: no comment), no commit or push without the user's
   word).
2. **Read `docs/INDEX.md`** — the owner map. If two docs disagree, the owner
   named there wins; if a doc disagrees with code, code wins.
3. **Load the `world1-handoff` skill before your first edit.** It is the
   cross-agent protocol: how to see who else is working and on which files,
   worktree etiquette on a shared live tree, the one SDD ledger under
   `.superpowers/sdd/`, and how to hand off. It lives in both
   `.agents/skills/` (Codex) and `.claude/skills/` (Claude Code); the copies
   are identical and `scripts/check-skill-parity.mjs` keeps them so.
4. **No test files — verification is by evidence.** No `*.test.ts` may exist
   in this repository (user ruling 2026-09-15; `scripts/check-boundaries.mjs`
   fails if one reappears). The gate is `npm test`: boundaries → typecheck →
   skill parity. Prove behaviour with `npm run fight` on/off logs (two
   same-seed runs diffed for determinism), `npm run content:validate`, the
   audit scripts and screenshots on both platforms — CLAUDE.md,
   "Verification is by evidence". The old suite grew to 274 files, one per
   task; that is why.

Skills every agent shares: `world1-handoff` (cross-agent protocol),
`world1-codemap` (where things live), `world1-card-text` (card wording rules),
`world1-game-review` (playtest/review pass), `world1-balance` (Power Level
pricing and tuning), `world1-combat-log` (reading and citing fight logs),
`world1-screens` (UI screen/layout conventions), `world1-testing`
(evidence-based verification and the gate chain). Each lives in both
`.agents/skills/` and `.claude/skills/`, identical, kept honest by
`scripts/check-skill-parity.mjs`.
Claude-only drivers of the same ledger: `/orchestrate`, `/team-combat`, the
`.claude/agents/` roster, and the `code-reviewer` audit agent.

## History

The original two-agent (Claude ↔ Codex CLI) arrangement ended with the
first-generation UI (removed in commit fff2ced). Its working docs live in
`docs/history/` (codex-ui-guide, codex-handoff, codex-game-brief). Never cite
them as current.
