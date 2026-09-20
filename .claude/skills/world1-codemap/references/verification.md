Covers which EVIDENCE proves each subject and which GATE must stay green.
Owner: `CLAUDE.md` §"Verification is by evidence — no test files (USER-LOCKED
2026-09-15)" states the rule; the `world1-testing` skill owns the how; the
`world1-combat-log` skill owns the fight-log conventions; `docs/ui-workbook.md`
owns the screen capture recipe. This file only routes a subject to the command
that proves it.

No `*.test.ts` file exists in this repo. `scripts/check-boundaries.mjs` fails
if one reappears, so a claim can never live in a test file — it lives in a
script result, a fight log, or a screenshot.

## The gate chain — what `npm test` runs

Three scripts and both TypeScript projects. Each prints a one-line verdict
(`boundaries OK`, `skill parity OK`, silent tsc = exit 0) or names every
violation. Direct-`node` forms run whether or not the clone has a
`node_modules/.bin`, so prefer them:

```bash
node scripts/check-boundaries.mjs                                        # boundaries OK
node node_modules/typescript/bin/tsc --noEmit                            # main project
node node_modules/typescript/bin/tsc -p tsconfig.functions.json --noEmit # Cloudflare functions
node scripts/check-skill-parity.mjs                                      # skill parity OK
```

The chain is fast and safe on a LIVE tree — run all of it, every time. What it
cannot do is prove YOUR change: it proves the tree compiles and obeys the
boundaries. The evidence below proves the change.

## Subject → evidence → gate

| Subject | Evidence that proves it | Gate that must stay green |
|---|---|---|
| combat rules, keywords, statuses, riders | An `npm run fight` **on/off pair**: one run with the effect on the board, one without, same seed; the log shows the effect firing and not firing. Board from env: `FIGHT_HERO_BOARD`, `FIGHT_FOE_BOARD`, `FIGHT_HERO_STATS`, `FIGHT_FOE_STATS`, `FIGHT_FOE_SLOTS`, `FIGHT_HERO_HP`, `FIGHT_ENEMY_LEVEL`, `FIGHT_EXTRA_ENEMY`, `FIGHT_EXTRA_CARDS`; `FIGHT_NARROW=1` for the mobile reflow. Never a hand-written renderer | typecheck |
| determinism (`simulate` is a pure function) | Two **same-seed** runs, diffed byte-identical — before AND after your edit on an un-featured board: `node node_modules/tsx/dist/cli.mjs scripts/fight.ts bandit_duelist 5 > tmp/a.txt`, run it again into `tmp/b.txt`, `diff tmp/a.txt tmp/b.txt` is silent. Then the same pair on a board that exercises your change. `tests/engine/fixtures/outcomeBaseline.json` may still be on disk; nothing reads it — it is an orphan of the deleted suite, not evidence | typecheck + boundaries (the radioactive files are listed in `references/boundaries-and-determinism.md`) |
| PL / balance of a card | `npm run scaffold:card -- --id <id> --tier <tier> --size <n> --property <p> --archetypes <a> --keywords <k,...>` for that one card — it solves against `src/engine/balance.ts` and prints the audit summary at every tier (usage header: `scripts/scaffoldCard.ts`). One card at a time; `npm run sim` is manual exploration only, never a pass/fail | `npm run content:validate` |
| generated card text | The same `scaffold:card` run prints the exact face the game draws at every tier; which surfaces read which registry field, and which steps fail silently: `docs/card-text-surfaces.md`. Combat-log wording: the `npm run fight` log itself | `npm run content:validate` + typecheck |
| content schemas (skills, gems, enemies, modifiers, events, discoveries) | `npm run content:validate` prints `content validation passed`; the contract is `src/data/content/README.md` | `npm run content:validate` (also runs first inside `npm run build`) |
| generated files stay idempotent | Regenerate through the owning script (`references/authored-vs-generated.md`), then `git diff --stat` — an empty diff is the proof. `npm run content:validate` additionally refuses a stale `events.v3.json` or `docs/generated/event-catalog.md` | `npm run content:validate` |
| event pack compiler + generated wiki | `npm run content:events` then `npm run content:wiki`, then `npm run content:validate` (it recompiles and re-renders both and compares bytes) and `git diff --stat` on the two generated files | `npm run content:validate` |
| layer boundaries (Phaser / combat / no test files) | `node scripts/check-boundaries.mjs` prints `boundaries OK` or names the file and the rule it broke. The checker is proven by running it — there is no separate pin | boundaries |
| shared-skill parity (`.agents/skills` vs `.claude/skills`) | `node scripts/check-skill-parity.mjs` prints `skill parity OK`; per skill, `diff -r .agents/skills/<name> .claude/skills/<name>` is silent | skill parity |
| save format / migration | No script proves migration today. Evidence is `npm run typecheck` over `src/meta/runSave.ts`'s shape predicates plus a hands-on run: `npm run dev` + `npm run api`, start a run, reload, and confirm it resumes; an older-version save in `localStorage` must migrate or be refused as the file's header comment states | typecheck |
| run map / shop / draft | Shop: `npm run shop:smoke` (`scripts/shop-smoke.ts`, Playwright, both viewports, run-mode gold). Map and draft: `npm run audit:hud` drives Map → Draft → Map → node → Deck Build → RETIRE at both viewports and screenshots every screen; hands-on via the `?scene=` routes in `docs/ui-workbook.md` | typecheck |
| scene layout | `npm run audit:hud` (text outside the canvas, overlapping text, missing HUD strings — both viewports), `npm run audit:cardface` (card-face segment truncation), `npm run shop:smoke`, plus Playwright screenshots at **1440×900 and 412×892** (`docs/ui-workbook.md`); a change is half done if only one platform is proven | boundaries (src/game never reaches combat) + typecheck |

## Running on a LIVE tree

Run the whole gate chain — it is seconds, and it does not touch anyone's files.
Then produce the focused evidence for YOUR change from the table above. A red
gate names an observed failure, not proof of who caused it. Inspect the scoped
diff and coordinate directly if fixing it would overlap unrelated work.
Report results honestly; no ownership registry or independent reviewer is required.
