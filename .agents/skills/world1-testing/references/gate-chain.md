# The gate chain — what `npm test` is, and what each link checks

`package.json` is the source of truth. As of 2026-09-15:

```
npm test          = node scripts/check-boundaries.mjs && npm run typecheck && node scripts/check-skill-parity.mjs
npm run typecheck = tsc --noEmit && tsc -p tsconfig.functions.json --noEmit
```

There is no vitest step. No `*.test.ts` file exists, and the first link
fails if one appears — see `CLAUDE.md` § "Verification is by evidence — no
test files (USER-LOCKED 2026-09-15)".

## Direct-`node` forms (work whether or not `node_modules/.bin` exists)

`npm run <script>` and `npx <tool>` resolve only where the clone has a
`node_modules/.bin`; an install by another session can flip that mid-task.
`npm test` itself calls `npm run typecheck`, which wants a bare `tsc` on
PATH. The JS entrypoints below run in either state, so prefer them and the
chain is:

```bash
node scripts/check-boundaries.mjs
node node_modules/typescript/bin/tsc --noEmit
node node_modules/typescript/bin/tsc -p tsconfig.functions.json --noEmit
node scripts/check-skill-parity.mjs
```

## Link 1 — `scripts/check-boundaries.mjs` (prints `boundaries OK`)

An AST walk (TypeScript compiler API) over every source file, four passes:

1. **Fail-closed dynamic imports** — in `src/engine`, `src/data`, `src/run`,
   `src/meta`, `src/game`, any `import(x)` / `require(x)` whose specifier is
   not a string literal is a violation unless a `// boundary-allow: <reason>`
   comment sits on that line or the one above.
2. **Pure layers stay headless** — `src/engine`, `src/data`, `src/run`,
   `src/meta` may not import `phaser` (or `phaser/...`) or anything under
   `src/game`. Type-only imports count here.
3. **Thin client** — from every `src/game` file, walk the value-import graph
   (barrels and re-exports included); reaching `resolveBattle` or
   `combat/simulate` is a violation. `import type` is erased and ignored.
4. **No test files** — walk the whole repo (skipping `node_modules`, `.git`,
   `dist`, `.superpowers`, `tmp`) and fail on any `*.test.ts`.

Paths are printed POSIX-style on every platform so a failure line reads the
same on Windows and CI.

## Link 2 — `npm run typecheck`, two projects

- `tsc --noEmit` — the main project (`tsconfig.json`; read its `include`
  list rather than trusting a restated one), full Node libs. No `*.test.ts`
  may exist under any of those directories.
- `tsc -p tsconfig.functions.json --noEmit` — `functions/` (Cloudflare Pages
  Functions, Workers runtime, no Node types). It catches Workers-only type
  errors the main project cannot see. Both halves must exit 0.

## Link 3 — `scripts/check-skill-parity.mjs` (prints `skill parity OK`)

For every shared skill in its `SHARED_SKILLS` list, both roots
(`.agents/skills/<n>` and `.claude/skills/<n>`) must: exist with a
`SKILL.md`; hold the identical file set; be byte-identical file by file
(CRLF/LF normalised); have a UTF-8 frontmatter block with no BOM whose
`name` equals the directory name, a `description` longer than 20 and at most
1024 chars, and only portable keys (`name`, `description`, `license`,
`compatibility`, `metadata`, `allowed-tools`); be tracked by git (asked via
`git check-ignore`); and carry no frontmatter in `references/*.md`. Every
skill directory in either root must be listed as shared or as
Claude-only/Codex-only, and `AGENTS.md` and `CLAUDE.md` must each name every
shared skill in backticks.

## Timings, measured 2026-09-15 on a LIVE tree (several agents editing)

```
node scripts/check-boundaries.mjs                                      real 0m1.112s
node node_modules/typescript/bin/tsc --noEmit                          real 0m5.008s   exit 0
node node_modules/typescript/bin/tsc -p tsconfig.functions.json --noEmit real 0m1.482s   exit 0
node scripts/check-skill-parity.mjs                                    real 0m0.878s   skill parity OK
```

Under ten seconds end to end. That is fast enough to run on a live tree —
the rule below is about reading it, not about avoiding it.

## Reading the chain on a LIVE tree

The chain describes the WHOLE tree. A red line naming a file you did not
touch is another agent's in-flight work: report it by name, do not fix it,
do not treat it as your regression. Real output from the same run:

```
$ npm test
> node scripts/check-boundaries.mjs && npm run typecheck && node scripts/check-skill-parity.mjs

Layer boundary violations (pure layers must not import phaser/src/game; src/game must not run combat; no *.test.ts files):
  tests/engine/attunedShield.test.ts: test file present — this repo does not carry *.test.ts files by user ruling of 2026-09-15; verification is by `npm run fight` logs, tsc, this script, content:validate, and the audit scripts
exit 1
```

For a current failure, confirm the file's ownership directly with available
agents; historical task records are not proof of current ownership. The honest report is "link 1
red on `<file>`, not mine; links 2–4 green" — and the evidence for your own
change is the surface-specific route in `references/evidence-routes.md`, not
the chain's exit code. A whole-tree "all green" is a claim only a QUIET tree
supports (`world1-handoff` §1 defines QUIET/LIVE).
