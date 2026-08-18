/**
 * Dumps the LIVE enemy-modifier book to the JSON content document.
 *
 *   npm run content:export   (runs this after the skills/gems/enemies exports)
 *
 * ONE-SHOT MIGRATION TOOL, same shape as scripts/exportEnemies.ts and for the
 * same reason: a dump FROM the live book is faithful by construction, where
 * hand transcription is exactly how a silent change to an affix's tuning
 * gets in unreviewed. Proven by tests/data/modifiersJsonParity.test.ts
 * (deepEqual against the TS book).
 *
 * src/data/modifiers.ts stays the SOURCE OF TRUTH after this runs. This
 * document is an OUTPUT, not yet a second thing to keep in sync by hand —
 * nothing loads from it. Regenerating after modifiers.ts changes is this one
 * command, not a merge.
 *
 * Rescues any balance-derivation COMMENTS attached to each preset literal
 * into the document's per-entry `notes` (none exist today — every preset in
 * modifiers.ts is currently comment-free — but the rescue runs unconditionally
 * so a future affix's reasoning is captured automatically instead of by a
 * hand-edit to the JSON).
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { MODIFIER_PRESETS } from '../src/data/modifiers';
import { asciiSafeStringify } from './asciiSafeJson';

const SRC = new URL('../src/data/modifiers.ts', import.meta.url);
const OUT_DIR = new URL('../src/data/content/', import.meta.url);
const OUT = new URL('./modifiers.v1.json', OUT_DIR);

const NEWLINE = /\r?\n/;
const BANNER = /^\/\/\s*[-=]{3,}/;
const COMMENT_PREFIX = /^\/\/\s?/;

const srcLines = readFileSync(SRC, 'utf8').split(NEWLINE);
const isComment = (l: string) => l.trim().startsWith('//');
const isBanner = (l: string) => BANNER.test(l.trim());
const clean = (l: string) => l.trim().replace(COMMENT_PREFIX, '').trimEnd();

/**
 * Comments attached to each modifier literal. modifiers.ts is a keyed OBJECT
 * whose entries carry their own `id: '...'` field (matching the
 * GemDef/EnemyDef convention — see modifiers.ts's doc comment on why), so
 * this rescue is the SAME shape as exportGems.ts's/exportEnemies.ts's.
 */
function rescueNotes(): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (let i = 0; i < srcLines.length; i += 1) {
    const m = /^\s*id:\s*'([a-z0-9_]+)',/.exec(srcLines[i] ?? '');
    if (!m) continue;
    const id = m[1]!;
    let open = i - 1;
    while (open >= 0 && !/^\s*[a-z0-9_]+:\s*\{\s*$/.test(srcLines[open] ?? '')) open -= 1;
    if (open < 0) continue;
    const above: string[] = [];
    for (let j = open - 1; j >= 0 && isComment(srcLines[j] ?? ''); j -= 1) {
      const line = clean(srcLines[j]!);
      if (isBanner(srcLines[j] ?? '') || /---$/.test(line)) break;
      above.unshift(line);
    }
    const inside: string[] = [];
    let depth = 0;
    for (let j = open; j < srcLines.length; j += 1) {
      const line = srcLines[j] ?? '';
      for (const ch of line) { if (ch === '{') depth += 1; else if (ch === '}') depth -= 1; }
      if (j > open && isComment(line) && !isBanner(line)) inside.push(clean(line));
      if (depth === 0 && j > open) break;
    }
    const notes = [...above, ...inside].filter((n) => n.length > 0);
    if (notes.length) out.set(id, notes);
  }
  return out;
}

/** File-level commentary belonging to no single modifier — rides the DOCUMENT. */
function rescueDocNotes(attached: ReadonlySet<string>): string[] {
  const out: string[] = [];
  for (const raw of srcLines) {
    if (!isComment(raw) || isBanner(raw)) continue;
    const body = clean(raw);
    if (!body || attached.has(body)) continue;
    out.push(body);
  }
  return out;
}

const notesById = rescueNotes();

/**
 * FIELD ORDER inside the `def` payload, matching declaration order in
 * `EnemyModifierPreset`: name/blurb (copy) -> notes -> bonusPL/bonusProfile
 * (the PL-spend dial) -> forceTier (the tier-override dial). `id` is NOT
 * here: it is the document's KEY (see the envelope docs on the
 * skills/gems/enemies loaders) and the loader puts it back when rebuilding
 * the preset.
 */
const DEF_FIELD_ORDER = ['name', 'blurb', 'notes', 'bonusPL', 'bonusProfile', 'forceTier'] as const;

const modifierList = Object.values(MODIFIER_PRESETS)
  .slice()
  .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  .map((preset) => {
    const notes = notesById.get(preset.id);
    // `id` is deliberately dropped from the payload — see DEF_FIELD_ORDER's
    // doc comment; the loader puts it back when it rebuilds the preset.
    const { id, ...rest } = preset;
    const source: Record<string, unknown> = { ...(notes ? { notes } : {}), ...rest };
    const def: Record<string, unknown> = {};
    for (const key of DEF_FIELD_ORDER) if (source[key] !== undefined) def[key] = source[key];
    // Anything the field order does not know about still ships, so a new
    // EnemyModifierPreset field can never be silently dropped by this exporter.
    for (const key of Object.keys(source)) if (!(key in def)) def[key] = source[key];
    // ONE DOCUMENT PER MODIFIER; its versions nested inside, oldest first.
    // CURRENT is the entry with the HIGHEST `version` (not the last element)
    // — see the loader (src/data/modifiersContent.ts).
    return { id, versions: [{ version: 1, def }] };
  });

const attached = new Set<string>();
for (const notes of notesById.values()) for (const n of notes) attached.add(n);
const docNotes = rescueDocNotes(attached);

/** The document object, before serialization — exposed so tests can inspect it directly. */
export const modifiersDocument = { schemaVersion: 1, notes: docNotes, modifiers: modifierList };

/**
 * The EXACT bytes `npm run content:export` writes to modifiers.v1.json,
 * computed in memory with no filesystem write. This is what
 * tests/data/modifiersExportIdempotency.test.ts diffs against the committed
 * file to prove the exporter is idempotent — importing this module must not
 * itself write anything, so the write step below is gated to direct
 * invocation only.
 *
 * ASCII-safe on write, matching skills.v1.json/enemies.v1.json (see
 * scripts/asciiSafeJson.ts) rather than gems.v1.json's raw-UTF8 form: this is
 * a brand-new document with no committed raw-UTF8 history to preserve, and
 * exportGems.ts's own doc comment already flags raw UTF-8 as the form to
 * migrate AWAY from, not one to extend to a new document. ASCII-safe is also
 * simply the majority convention today (2 of the 3 existing documents), so a
 * new document defaults to it rather than to the minority form.
 */
export const modifiersDocumentText = `${asciiSafeStringify(modifiersDocument, 1)}\n`;

const perModifier = [...notesById.values()].reduce((n, v) => n + v.length, 0);

function main(): void {
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(OUT, modifiersDocumentText);
  console.log(`wrote ${modifierList.length} modifiers -> ${OUT.pathname}`);
  console.log(`notes rescued: ${perModifier} lines across ${notesById.size}/${modifierList.length} modifiers, + ${docNotes.length} document-level = ${perModifier + docNotes.length} total`);
}

// Only run the write (and its console output) when this file is the process
// entry point (`tsx scripts/exportModifiers.ts`) — NOT when a test imports it
// for `modifiersDocumentText`, which must be a pure, side-effect-free read.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
