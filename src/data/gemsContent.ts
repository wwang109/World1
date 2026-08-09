import type { GemDef } from './gems';
import { currentVersionOf } from './skillsContent';
import { gemDefOfDocument, validateGemDocument } from './validateGemContent';
import document from './content/gems.v1.json';

/**
 * THE JSON CONTENT LOADER for gems — the twin of `skillsContent.ts`, deliberately
 * identical in philosophy so there is ONE way content is loaded in this codebase.
 *
 * Same properties, same reasons (see `skillsContent.ts` for the full rationale):
 *   - STATIC IMPORT, SYNCHRONOUS: one code path across Vite, tsx and Wrangler; no
 *     filesystem, no fetch, no per-request parse, so two players in the same
 *     minute cannot hold different gem definitions.
 *   - ONE DOCUMENT PER GEM, versions nested; CURRENT is the HIGHEST `version`,
 *     resolved by value rather than array position.
 *   - SORTED BY ID, because `Object.values(gemBook)` feeds seeded-Rng pools in
 *     `src/run/shop.ts` / `draft.ts` / `events.ts`, so iteration order decides
 *     what a run seed is offered.
 *   - META IN A SIDECAR, so the in-memory `GemDef` stays byte-identical to the
 *     hand-written literals and every existing consumer is untouched.
 *
 * The gem CONTRACT carries more than shape: the four categories (Sliver / Echo /
 * Core / Charm) are derived from the payload and cross-checked against the name
 * suffix and text opener, hits are Echo-only, and payloads must be unique across
 * the file. Those rules live in `validateGemContent.ts` and exist because the
 * pre-2026-08-09 catalog had drifted into 11 mechanical duplicates and an "Echo"
 * name that meant nothing.
 */

const problems = validateGemDocument(document);
if (problems.length > 0) {
  const detail = problems.slice(0, 10).map((e) => '  ' + e.where + ': ' + e.message).join('\n');
  throw new Error(
    'gems.v1.json failed validation with ' + String(problems.length) + ' problem(s):\n' + detail
    + (problems.length > 10 ? '\n  ...and ' + String(problems.length - 10) + ' more' : ''),
  );
}

export interface GemContentMeta {
  /** The version this book entry resolved to — the highest present. */
  version: number;
  notes?: readonly string[];
  /** Every version number the document carries, ascending. */
  versions: readonly number[];
}

const book: Record<string, GemDef> = {};
const meta: Record<string, GemContentMeta> = {};

for (const gem of [...document.gems].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
  const entries = gem.versions as unknown as Array<{ version: number; def: Record<string, unknown> }>;
  const current = currentVersionOf(entries);
  if (book[gem.id] !== undefined) {
    throw new Error('gems.v1.json has more than one document for id "' + gem.id + '"');
  }
  book[gem.id] = gemDefOfDocument(gem.id, current.def) as GemDef;
  meta[gem.id] = {
    version: current.version,
    ...(current.def.notes ? { notes: current.def.notes as readonly string[] } : {}),
    versions: entries.map((e) => e.version).sort((a, b) => a - b),
  };
}

/** The gem book, keyed by id, in canonical id order. Shape-identical to the old TS literal book. */
export const gemBookFromJson: Record<string, GemDef> = book;

/** Version / notes per gem — the sidecar that keeps schema meta OFF GemDef. */
export const gemContentMeta: Readonly<Record<string, GemContentMeta>> = meta;
