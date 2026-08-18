import type { EnemyDef } from '../engine/types';
import { currentVersionOf } from './skillsContent';
import { enemyDefOfDocument, validateEnemyDocument } from './validateEnemyContent';
import document from './content/enemies.v1.json';

/**
 * THE JSON CONTENT LOADER for enemies — the twin of `skillsContent.ts` /
 * `gemsContent.ts`, deliberately identical in philosophy so there is ONE way
 * content is loaded in this codebase. Same properties, same reasons (see
 * `skillsContent.ts` for the full rationale):
 *
 *   - STATIC IMPORT, SYNCHRONOUS: one code path across Vite, tsx and
 *     Wrangler; no filesystem, no fetch, no per-request parse.
 *   - ONE DOCUMENT PER ENEMY, versions nested; CURRENT is the HIGHEST
 *     `version`, resolved by value rather than array position.
 *   - SORTED BY ID, because `Object.values(enemies)` feeds seeded-Rng pools
 *     in `src/run/runState.ts` (FIGHT_POOL/BOSS_POOL) and
 *     `src/run/encounter.ts`, so iteration order decides what a run seed
 *     offers.
 *   - META IN A SIDECAR, so the in-memory `EnemyDef` stays byte-identical to
 *     the hand-written literals and every existing consumer is untouched.
 *
 * NOT WIRED UP YET, on purpose. Nothing in `src/data/enemies.ts` imports
 * from here — that file remains the live source of truth for `enemies`.
 * This module exists so the JSON document has a loader to be proven against
 * (see `tests/data/enemiesJsonParity.test.ts`) the same way the document
 * itself has an exporter to be proven against
 * (`tests/data/enemiesExportIdempotency.test.ts`). Switching any runtime
 * consumer over to read `enemyBookFromJson` instead of `enemies` is a
 * separate change with its own risk (see `docs/enemy-design.md` and the
 * migration precedent in `skills.ts`/`gems.ts`, which is itself still
 * incomplete) and is deliberately out of scope here.
 */

const problems = validateEnemyDocument(document);
if (problems.length > 0) {
  // THROW, never silently drop: a dropped enemy is an encounter-pool change,
  // and a half-loaded book would fail far from the cause.
  const detail = problems.slice(0, 10).map((e: { where: string; message: string }) => '  ' + e.where + ': ' + e.message).join('\n');
  throw new Error(
    'enemies.v1.json failed validation with ' + String(problems.length) + ' problem(s):\n' + detail
    + (problems.length > 10 ? '\n  ...and ' + String(problems.length - 10) + ' more' : ''),
  );
}

export interface EnemyContentMeta {
  /** The version this book entry resolved to — the highest present. */
  version: number;
  notes?: readonly string[];
  /** Every version number the document carries, ascending. */
  versions: readonly number[];
}

const book: Record<string, EnemyDef> = {};
const meta: Record<string, EnemyContentMeta> = {};

for (const enemy of [...document.enemies].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
  const entries = enemy.versions as unknown as Array<{ version: number; def: Record<string, unknown> }>;
  const current = currentVersionOf(entries);
  if (book[enemy.id] !== undefined) {
    throw new Error('enemies.v1.json has more than one document for id "' + enemy.id + '"');
  }
  book[enemy.id] = enemyDefOfDocument(enemy.id, current.def);
  meta[enemy.id] = {
    version: current.version,
    ...(current.def.notes ? { notes: current.def.notes as readonly string[] } : {}),
    versions: entries.map((e) => e.version).sort((a, b) => a - b),
  };
}

/** The enemy book, keyed by id, in canonical id order. Shape-identical to the old TS literal book. */
export const enemyBookFromJson: Record<string, EnemyDef> = book;

/** Version / notes per enemy — the sidecar that keeps schema meta OFF EnemyDef. */
export const enemyContentMeta: Readonly<Record<string, EnemyContentMeta>> = meta;
