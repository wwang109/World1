---
name: world1-testing
description: Use before claiming any World1 change works, before reporting a task done, and when writing a brief that must name the evidence its verification will produce. No *.test.ts file may exist in this repo (CLAUDE.md, USER-LOCKED 2026-09-15) - so this skill routes a change by SURFACE (combat rule, card or gem data, a price, run logic, a screen, a doc or skill) to the evidence that proves it (npm run fight on/off pair, same-seed determinism diff, content:validate, scaffold:card, the audit scripts, both-platform screenshots) and to the gate chain that must stay green.
---

# World1 testing — evidence, not test files

**No `*.test.ts` file may exist in this repository.** The ruling, and the
gate that enforces it, are stated once in `CLAUDE.md` § "Verification is by
evidence — no test files (USER-LOCKED 2026-09-15)" — read that section; this
skill is the HOW, not a second copy of the WHAT. `node
scripts/check-boundaries.mjs` fails on any test file, so writing one is a
red gate, never a verification route.

## 1. The decision: "I changed X — what proves it?"

Route by the surface you touched. Every command is spelled out with real,
pasted output in `references/evidence-routes.md`; the gate column is
`references/gate-chain.md`.

| Surface | Evidence that proves it | Gate |
|---|---|---|
| Combat rule / engine (`src/engine/**`) | An `npm run fight` ON/OFF pair — the effect firing and the control case not firing. Plus determinism: same board, same seed, run twice, `diff` silent. Log format: **`world1-combat-log`**. | whole chain |
| Card / gem / enemy / event data (`src/data/content/*.json`) | `npm run content:validate` clean, and a fight log showing the card fire (same ON/OFF shape). | whole chain |
| A price / PL (`src/engine/balance.ts`, a card's effects) | `npm run scaffold:card` audit block `OK` at every tier. Which constants and why: **`world1-balance`**. | whole chain |
| Run logic (`src/run/**`, `src/meta/**`) | `npm run output` for enemy/encounter resolution; `npm run shop:smoke` where the change reaches the shop; otherwise a `tsx -e` probe calling the module's exported function, pasted with its output. | whole chain |
| A screen (`src/game/**`) | `npm run audit:hud` / `audit:cardface` / `shop:smoke` plus Playwright screenshots on BOTH platforms. Routes, viewports, servers: **`world1-screens`**. | whole chain |
| A doc or a shared skill | `node scripts/check-skill-parity.mjs` → `skill parity OK`, and every path or command the text cites verified by `ls` or by running it. | parity |

The "whole chain" is `npm test` = boundaries → both tsc projects → skill
parity. It runs in seconds (timed in `references/gate-chain.md`), so run it
even on a live tree — but read its output per file, not as a verdict on the
tree (§3).

## 2. Before you report done

- **Paste the evidence, do not describe it.** A fight log is the log, not
  "the log shows". A screenshot is attached, not "looked right". An audit
  script's totals line is the line, not "passed".
- **Two runs beat one.** ON/OFF, before/after, matching/non-matching — one
  run proves the effect exists, the pair proves what gates it.
- **Determinism is explicit** whenever you touched `src/engine/combat/*`,
  `rng.ts`, `cards.ts` or `balance.ts`: two same-seed runs, `diff`, silent.
- **The gate chain ran**, and you say which lines are yours.
- **Nothing you cite is imagined**: every script name comes from
  `package.json`, every path exists.

## 3. On a LIVE shared tree

Another agent's half-saved file can turn any gate red (see
**`world1-handoff`** §3). The chain is fast enough to run anyway; the rule is
about READING it: a red line naming a file you did not touch is theirs —
report it, do not fix it, do not call your own change blocked by it. Focused
fight logs and audit scripts against your own surface are the evidence for
your change; a whole-tree "all green" is a claim only a QUIET tree supports.

## 4. What a brief must demand

Name the evidence route, never a test file. A brief that says "add a case"
is asking for a red gate. Write instead: "prove it with a fight ON/OFF pair
on `<board>` seed `<n>`, determinism diff, `npm test` green", or "screenshot
both platforms at `?scene=…`, `audit:hud` totals line pasted".

## References

| File | Covers |
|---|---|
| `references/evidence-routes.md` | Per surface: the copy-pasteable command(s) and their real output — fight pair, determinism diff, content:validate, scaffold:card, run-layer probe, audit scripts, parity |
| `references/gate-chain.md` | The three gate scripts and what each checks, the two tsc projects, direct-`node` forms, measured timings, the live-tree reading rule |
