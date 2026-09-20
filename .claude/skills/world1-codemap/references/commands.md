Covers the npm scripts you'll actually reach for. Owner: `package.json` is
the full, authoritative list — this is a curated selection, not an
enumeration.

| Command | What it does |
|---|---|
| `npm test` | `check-boundaries.mjs` → `typecheck` → `check-skill-parity.mjs`. The whole gate chain; no vitest step exists |
| `node scripts/check-boundaries.mjs` | Layer boundaries + the no-`*.test.ts` guard; prints `boundaries OK` |
| `npm run typecheck` | `tsc --noEmit` **plus** `tsc -p tsconfig.functions.json --noEmit` |
| `node scripts/check-skill-parity.mjs` | `.agents/skills` vs `.claude/skills` twins, frontmatter, gitignore whitelist; prints `skill parity OK` |
| `npm run dev` | Vite, :5173 |
| `npm run api` | Battle service, :8787 — **required alongside `dev`**; the client cannot simulate |
| `npm run fight [enemyId] [seed]` | ASCII combat log — the evidence for any combat claim. Env board overrides: `FIGHT_NARROW`, `FIGHT_HERO_BOARD`, `FIGHT_FOE_BOARD`, `FIGHT_HERO_STATS`, `FIGHT_FOE_STATS`, `FIGHT_FOE_SLOTS`, `FIGHT_HERO_HP`, `FIGHT_ENEMY_LEVEL`, `FIGHT_EXTRA_ENEMY`, `FIGHT_EXTRA_CARDS` |
| `npm run sim` | Headless balance harness (`scripts/balance.ts`) — manual exploration, never a gate |
| `npm run scaffold:card` | Solve + print a new card block and its per-tier PL audit (writes nothing) |
| `npm run content:validate` | JSON content gate incl. stale-check of the generated event aggregate and wiki; also runs first inside `npm run build` |
| `npm run content:export` | Regenerate `src/data/content/enemies.v1.json` + `src/data/content/modifiers.v1.json` |
| `npm run content:events` | Compile `src/data/content/event-packs/*.json` → `src/data/content/events.v3.json` |
| `npm run content:wiki` | Regenerate `docs/generated/event-catalog.md` |
| `npm run art:encode` | `art-src/` masters → committed `public/game-art/**` WebP |
| `npm run audit:hud` / `audit:cardface` / `shop:smoke` | Playwright layout + content audits at both viewports (`scripts/run-hud-audit.ts`, `scripts/card-face-truncation-audit.ts`, `scripts/shop-smoke.ts`) |
| `npm run build` / `preview` / `deploy` | Production build, local preview, Cloudflare Pages deploy |

`npm run` needs a `node_modules/.bin` the clone may or may not have (see
`references/verification.md`). The JS entrypoint runs either way — every script
above is a thin wrapper over one (`node scripts/<file>.mjs`,
`node node_modules/typescript/bin/tsc`, `node node_modules/tsx/dist/cli.mjs
scripts/<file>.ts`) — so prefer it.
