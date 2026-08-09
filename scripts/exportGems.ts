/**
 * Dumps the LIVE gem book to the JSON content document.
 *
 *   npm run content:export   (runs this after the skills export)
 *
 * ONE-SHOT MIGRATION TOOL, same as scripts/exportContent.ts and for the same
 * reason: a dump FROM the live book is faithful by construction, where hand
 * transcription is how a silent balance change gets in. Proven by
 * tests/data/gemsJsonParity.test.ts (deepEqual against the TS book).
 *
 * Rescues the balance-derivation COMMENTS out of src/data/gems.ts into each
 * document's `notes`. The catalog was rewritten on 2026-08-09 (46 -> 35), so
 * those comments are fresh and are the reasoning behind every band placement.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { gemBookFromDefs } from '../src/data/gems';

const SRC = new URL('../src/data/gems.ts', import.meta.url);
const OUT_DIR = new URL('../src/data/content/', import.meta.url);
const OUT = new URL('./gems.v1.json', OUT_DIR);

const NEWLINE = /\r?\n/;
const BANNER = /^\/\/\s*[-=]{3,}/;
const COMMENT_PREFIX = /^\/\/\s?/;

const srcLines = readFileSync(SRC, 'utf8').split(NEWLINE);
const isComment = (l: string) => l.trim().startsWith('//');
const isBanner = (l: string) => BANNER.test(l.trim());
const clean = (l: string) => l.trim().replace(COMMENT_PREFIX, '').trimEnd();

/**
 * Comments attached to each gem literal. gems.ts is a keyed OBJECT, so a gem
 * opens with `  some_id: {` rather than the bare `  {` skills.ts uses — hence a
 * different opening pattern from the skills rescue.
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
      if (!isBanner(srcLines[j] ?? '')) above.unshift(clean(srcLines[j]!));
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

/** File-level commentary belonging to no single gem — rides the DOCUMENT. */
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

/** Field order inside `def`: copy -> notes -> query axes -> payload. */
const DEF_FIELD_ORDER = [
  'name', 'text',
  'notes',
  'kind', 'rarity', 'scope',
  'actions', 'mods',
  'weightIncreasePct', 'cooldownReduction',
] as const;

const gems = Object.values(gemBookFromDefs)
  .slice()
  .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  .map((gem) => {
    const notes = notesById.get(gem.id);
    const { id, ...rest } = gem;
    const source: Record<string, unknown> = { ...(notes ? { notes } : {}), ...rest };
    const def: Record<string, unknown> = {};
    for (const key of DEF_FIELD_ORDER) if (source[key] !== undefined) def[key] = source[key];
    for (const key of Object.keys(source)) if (!(key in def)) def[key] = source[key];
    return { id, versions: [{ version: 1, def }] };
  });

const attached = new Set<string>();
for (const notes of notesById.values()) for (const n of notes) attached.add(n);
const docNotes = rescueDocNotes(attached);

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(OUT, `${JSON.stringify({ schemaVersion: 1, notes: docNotes, gems }, null, 1)}\n`);

const perGem = [...notesById.values()].reduce((n, v) => n + v.length, 0);
console.log(`wrote ${gems.length} gems -> ${OUT.pathname}`);
console.log(`notes rescued: ${perGem} lines across ${notesById.size}/${gems.length} gems, + ${docNotes.length} document-level = ${perGem + docNotes.length} total`);
