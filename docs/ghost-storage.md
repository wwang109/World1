# Ghost storage — dev file store and production D1 twin

Scope: how a submitted ghost boss build ([feature] "ghost" defense boards) is
persisted and rotated per band, in dev (`server/`) and in production
(`functions/`).

## Shared rules (one pure module)

`src/run/ghostPool.ts` owns the `GhostStore` contract, `GHOST_POOL_PER_BAND`
(10), and the three pure rules both stores call so they cannot drift:

- `rankCompare` / `rankGhosts` — defense wins desc, defense losses asc,
  newest first.
- `evictionCandidateId` — which id to drop once a band exceeds the pool size.
- `nextRotationPick` — which record a fetch returns given a cursor and an
  excluded owner, round-robin by insertion order.

`server/ghostStoreFile.ts` (dev JSON file) and `functions/ghostStoreD1.ts`
(production D1) both call these helpers; neither reimplements ranking,
eviction, or rotation.

## Dev: file store

`server/ghostStoreFile.ts` persists to `.tmp/ghost-store.json` (gitignored),
served by `server/battleApi.ts`'s `/ghosts` routes.

## Production: Cloudflare D1

`migrations/0001_ghosts.sql` is the schema: a `ghosts` table (id, code,
display_name, band, fight_number, created_at, owner_local_id, defense_wins,
defense_losses) indexed on `band`, plus a `band_cursor` table for the
per-band rotation cursor.

`functions/d1.ts` declares a minimal local `D1Database`/`D1PreparedStatement`
type (prepare/bind/first/all/run/batch) — no new dependency; it is not the
full `@cloudflare/workers-types` surface, just what `functions/ghostStoreD1.ts`
calls.

`functions/ghosts.ts` (`GET`/`POST /ghosts`) and
`functions/ghosts/[id]/result.ts` (`POST /ghosts/:id/result`) mirror the dev
routes' status codes and bodies exactly, reading a `GHOSTS_DB` binding from
`env`.

### Setup (deploy is a separate user step)

1. `wrangler d1 create <name>` — creates the D1 database.
2. Apply the migration: `wrangler d1 execute <name> --file=migrations/0001_ghosts.sql`
   (add `--remote` for the deployed database, omit it to seed a local dev
   D1 instance).
3. Bind it as `GHOSTS_DB` in the Cloudflare Pages project's settings (Pages →
   your project → Settings → Functions → D1 database bindings). No
   `wrangler.toml` is required for this — the project currently has none, and
   adding one would change how `wrangler pages deploy` behaves; binding
   through the dashboard is the option that doesn't. A `wrangler.toml` with a
   `[[d1_databases]]` block is the alternative if the project later adopts one.

### Without the binding

`GHOSTS_DB` missing is not an error: `GET /ghosts` returns `200` with body
`null` (same shape as "no ghost for this band yet"), and `POST /ghosts`
returns `503 {"error":"ghost-store-unavailable"}`. `src/game/ghostApi.ts`
already treats both as a soft failure — the run continues without a ghost
offer/upload.
