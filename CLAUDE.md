# World1 — working agreement & project map

## Collaboration protocol (owner-directed, 2026-07)

Claude acts as ORCHESTRATOR, not first-resort implementer:

1. **Understand before building.** For any new rule, mechanic, or system:
   restate the design in plain words, bounce questions/trade-offs with the
   owner, and get agreement BEFORE writing code. Pure data entry inside
   already-agreed rules may proceed directly.
2. **Delegate implementation to sub-agents** (Agent tool): Sonnet for code,
   Haiku for mechanical/bulk data work, Opus only for hard engine surgery.
   Give each agent a precise brief and require a **summary of ≤400
   characters** describing what was done.
   **Agents run in the BACKGROUND, always** — never block-waiting on one
   (blocking drops the owner's incoming messages). Split large jobs into
   smaller parallel agents; end the turn after launching and pick the
   result up from the completion notification.
3. **Verify, then confirm.** Read the summaries, then independently re-run
   `npx tsc --noEmit`, `npx vitest run`, and relevant `npm run battle` sims
   before reporting done. Summaries are claims, not proof.
4. Report to the owner: agent summaries + verified result. Don't recite
   test counts unless asked.

## Design laws (details in docs/build-themes.md)

- One-sentence rules that flow through existing engine primitives — no
  bespoke bookkeeping per rule. New cards RECOMBINE the ~26 verbs.
- Combat is deterministic and RNG-free; integers only.
- Base damage is sacred: repetition/spam penalties act on TEMPO (weight,
  rest) or BONUS effectiveness, never base numbers.
- One card ladder: Common→Rare→Epic→Legendary (10/15/20/25 PL budgets,
  audit-enforced) + UNIQUE (one copy, fixed rank, never upgrades).
- Elites are tactic checks via kits, not stat walls; every check needs a
  sim-proven answer deck.
- Every balance claim gets simmed (`npm run battle -- --hero "a,b,c"
  --enemy all`) before it ships.

## Layout

- Card/enemy/enchant data: `src/data/*.json` (audited by tests).
- Engine: `src/engine/` (balance.ts price table, combat/ loop).
- Demo UI: `src/game/scenes/`. CLI tools: `scripts/battle.ts`, `codex.ts`.
- Branch: push to `claude/skills-tree-expansion-dkwbg0`.
