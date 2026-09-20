# Overlapping and generated files

The owner is `docs/coordination/session-orchestration.md`.

Inspect the current scoped diff before editing. If actual changes overlap,
coordinate directly or ask the user before overwriting them. Do not restore
a whole shared file to remove your own changes, or normalize unrelated
formatting. Formal file claims and registration are not required.

Before running a generator, include its derivatives in the inspected scope:

- `content:export`: `enemies.v1.json`, `modifiers.v1.json`.
- `content:events`: `events.v3.json`; `events.v2.json` remains frozen.
- `content:wiki`: `docs/generated/event-catalog.md`.
- `art:encode`: `public/game-art/**`.
- `skills.v1.json`, `gems.v1.json`, `events.v1.json` are authored;
  `scaffold:card` prints output rather than rewriting them.

Apply shared skill edits to both `.agents/skills/` and `.claude/skills/`,
preserving unrelated changes. Run `node scripts/check-skill-parity.mjs`.
Keep historical audit output out of reusable instructions.

If a sandbox blocks a required command, request the supported escalation;
never weaken a gate to bypass it.
