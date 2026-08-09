import type { SkillBook, SkillDef } from '../engine/types';
import { skillDefOfDocument, validateSkillDocument } from './validateSkillContent';
import document from './content/skills.v1.json';

/**
 * THE JSON CONTENT LOADER for cards.
 *
 * STATIC IMPORT, SYNCHRONOUS, DELIBERATELY. Vite inlines the JSON for the
 * client, tsx for the dev battle service, and Wrangler for the Pages Function —
 * one code path in all three runtimes, no filesystem, no fetch, no per-request
 * parse, and therefore no way for two players in the same minute to hold
 * different card definitions. Runtime-loaded content (KV/D1/assets) was rejected
 * for exactly that reason: it is poison for a deterministic sim.
 * Synchronous also matters structurally — src/game initialises books at module
 * scope in 15+ scenes, so an async loader would need an await-before-render gate
 * in every one of them and a whole new class of "content not loaded yet" bug.
 *
 * SCHEMA SHAPE — (id, version) IS THE KEY, `def` IS THE VALUE:
 *
 *     { "id": "sword_slash", "version": 1, "def": { ...the whole card... } }
 *
 * The envelope carries ONLY the key; everything the card actually IS sits nested
 * under `def`. That is the shape saying what versioning means: a card id plus a
 * version RESOLVES TO one self-contained definition. (In a flat document,
 * `version` sits alongside `name` and `power` and reads as a property OF the
 * card rather than the thing that SELECTS it.)
 *
 * HISTORY FALLS OUT OF THIS FOR FREE, and needs no extra construct: several
 * documents may simply share an `id` with different `version` values, each
 * carrying its own complete payload, and lookup is a filter on the pair. There is
 * no nesting-inside-nesting and no "current is the last array element"
 * convention to remember. When that day comes the only loader change is picking
 * the MAX version per id instead of asserting one.
 *
 * An ARRAY of such documents (not a keyed map) is what a document store wants:
 * one row per document, primary key (id, version), payload as a single nested
 * value. The on-disk shape and the in-memory shape are DECOUPLED by this loader,
 * which is what lets the migration be provably behaviour-neutral.
 *
 * `version` is a plain hand-set integer and NOTHING BRANCHES ON IT today.
 *
 * META STAYS OFF SkillDef. `version` (envelope) and `notes` (authoring-only) are
 * exposed as a SIDECAR map, never folded into the def, so the in-memory SkillDef
 * is byte-identical to the hand-written literals it replaces and the
 * outcome-baseline normalizer needs no new strip rules.
 */

const problems = validateSkillDocument(document);
if (problems.length > 0) {
  // THROW, never silently drop: a dropped card is a balance change, and a
  // half-loaded book would fail the balance audit somewhere far from the cause.
  const detail = problems.slice(0, 10).map((e: { where: string; message: string }) => '  ' + e.where + ': ' + e.message).join('\n');
  throw new Error(
    'skills.v1.json failed validation with ' + String(problems.length) + ' problem(s):\n' + detail
    + (problems.length > 10 ? '\n  ...and ' + String(problems.length - 10) + ' more' : ''),
  );
}

export interface SkillContentMeta {
  /** The version this book entry resolved to — the highest present. */
  version: number;
  notes?: readonly string[];
  /** Every version number the document carries, ascending. */
  versions: readonly number[];
}

/**
 * CURRENT = the entry with the HIGHEST `version`.
 *
 * Resolving by VALUE rather than by POSITION is deliberate: array order is an
 * authoring convenience, and a document store is free to hand the list back in
 * any order, so "the last one" is exactly the kind of implicit convention that
 * breaks silently later. Highest-wins is order-independent by construction.
 * Duplicate version numbers are rejected by the validator, so the maximum is
 * unambiguous. Exported so `tests/data/skillsJsonParity.test.ts` can pin the rule.
 */
export function currentVersionOf<T extends { version: number }>(entries: readonly T[]): T {
  let current = entries[0]!;
  for (const entry of entries) if (entry.version > current.version) current = entry;
  return current;
}

const book: Record<string, SkillDef> = {};
const meta: Record<string, SkillContentMeta> = {};

// SORTED BY ID. Object.values(skillBook) feeds seeded-Rng pools in src/run, so
// iteration order decides what a given run seed is offered. Canonicalising here
// means the physical order of the document can never be load-bearing — which is
// exactly what a JSON array (or, later, a document store) must be free to change.
for (const card of [...document.cards].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
  const entries = card.versions as unknown as Array<{ version: number; def: Record<string, unknown> }>;
  const current = currentVersionOf(entries);
  book[card.id] = skillDefOfDocument(card.id, current.def);
  meta[card.id] = {
    version: current.version,
    ...(current.def.notes ? { notes: current.def.notes as readonly string[] } : {}),
    /** Every version this card has, ascending — the history, for display/audit. */
    versions: entries.map((e) => e.version).sort((a, b) => a - b),
  };
}

/** The card book, keyed by id, in canonical id order. Shape-identical to the old TS literal book. */
export const skillBookFromJson: SkillBook = book;

/** Version / notes per card — the sidecar that keeps schema meta OFF SkillDef. */
export const skillContentMeta: Readonly<Record<string, SkillContentMeta>> = meta;

