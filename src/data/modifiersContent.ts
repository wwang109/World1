import type { EnemyModifierPreset } from './modifiers';
import { currentVersionOf } from './skillsContent';
import { modifierPresetOfDocument, validateModifierDocument } from './validateModifierContent';
import document from './content/modifiers.v1.json';

/**
 * THE JSON CONTENT LOADER for enemy modifiers — the twin of
 * `enemiesContent.ts` / `skillsContent.ts` / `gemsContent.ts`, deliberately
 * identical in philosophy so there is ONE way content is loaded in this
 * codebase. Same properties, same reasons (see `skillsContent.ts` for the
 * full rationale):
 *
 *   - STATIC IMPORT, SYNCHRONOUS: one code path across Vite, tsx and
 *     Wrangler; no filesystem, no fetch, no per-request parse.
 *   - ONE DOCUMENT PER MODIFIER, versions nested; CURRENT is the HIGHEST
 *     `version`, resolved by value rather than array position.
 *   - SORTED BY ID, because `Object.keys(MODIFIER_PRESETS)` feeds
 *     `ENEMY_MODIFIER_IDS` in `src/run/encounter.ts`, which
 *     `src/run/runState.ts` slices (`ENEMY_MODIFIER_IDS.slice(0, count)`) to
 *     decide which affixes an overflow fight offers — so iteration order is
 *     load-bearing, exactly like the enemy/skill/gem pools.
 *   - META IN A SIDECAR, so the in-memory `EnemyModifierPreset` stays
 *     byte-identical to the hand-written literals and every existing
 *     consumer is untouched.
 *
 * NOT WIRED UP YET, on purpose. Nothing in `src/data/modifiers.ts` imports
 * from here — that file remains the live source of truth for
 * `MODIFIER_PRESETS`. This module exists so the JSON document has a loader
 * to be proven against (see `tests/data/modifiersJsonParity.test.ts`) the
 * same way the document itself has an exporter to be proven against
 * (`tests/data/modifiersExportIdempotency.test.ts`). Switching any runtime
 * consumer over to read from here instead of `MODIFIER_PRESETS` is a
 * separate change with its own risk and is deliberately out of scope here.
 */

const problems = validateModifierDocument(document);
if (problems.length > 0) {
  // THROW, never silently drop: a dropped modifier is a difficulty-affix
  // change, and a half-loaded book would fail far from the cause.
  const detail = problems.slice(0, 10).map((e: { where: string; message: string }) => '  ' + e.where + ': ' + e.message).join('\n');
  throw new Error(
    'modifiers.v1.json failed validation with ' + String(problems.length) + ' problem(s):\n' + detail
    + (problems.length > 10 ? '\n  ...and ' + String(problems.length - 10) + ' more' : ''),
  );
}

export interface ModifierContentMeta {
  /** The version this book entry resolved to — the highest present. */
  version: number;
  notes?: readonly string[];
  /** Every version number the document carries, ascending. */
  versions: readonly number[];
}

const book: Record<string, EnemyModifierPreset> = {};
const meta: Record<string, ModifierContentMeta> = {};

for (const modifier of [...document.modifiers].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
  const entries = modifier.versions as unknown as Array<{ version: number; def: Record<string, unknown> }>;
  const current = currentVersionOf(entries);
  if (book[modifier.id] !== undefined) {
    throw new Error('modifiers.v1.json has more than one document for id "' + modifier.id + '"');
  }
  book[modifier.id] = modifierPresetOfDocument(modifier.id, current.def);
  meta[modifier.id] = {
    version: current.version,
    ...(current.def.notes ? { notes: current.def.notes as readonly string[] } : {}),
    versions: entries.map((e) => e.version).sort((a, b) => a - b),
  };
}

/** The modifier book, keyed by id, in canonical id order. Shape-identical to the old TS literal book. */
export const modifierBookFromJson: Record<string, EnemyModifierPreset> = book;

/** Version / notes per modifier — the sidecar that keeps schema meta OFF EnemyModifierPreset. */
export const modifierContentMeta: Readonly<Record<string, ModifierContentMeta>> = meta;
