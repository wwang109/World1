/**
 * Dumps the LIVE card book to the JSON content document.
 *
 *   npm run content:export
 *
 * ONE-SHOT MIGRATION TOOL. It is the mechanical path on purpose: transcribing 72
 * cards by hand is exactly how a silent balance change gets in, whereas a dump
 * FROM the live book is faithful by construction and is then PROVEN so by
 * tests/data/skillsJsonParity.test.ts (deepEqual old vs new).
 *
 * It also rescues the balance-derivation COMMENTS out of src/data/skills.ts into
 * each document's `notes` — JSON has no comments, and those lines are the
 * reasoning behind every price. Losing them would quietly destroy the audit trail
 * the balance work depends on.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { skillBookFromDefs } from '../src/data/skills';
import { asciiSafeStringify } from './asciiSafeJson';

const SRC = new URL('../src/data/skills.ts', import.meta.url);
const OUT_DIR = new URL('../src/data/content/', import.meta.url);
const OUT = new URL('./skills.v1.json', OUT_DIR);

const NEWLINE = /\r?\n/;
const BANNER = /^\/\/\s*[-=]{3,}/;
const COMMENT_PREFIX = /^\/\/\s?/;

const srcLines = readFileSync(SRC, 'utf8').split(NEWLINE);
const isComment = (l: string) => l.trim().startsWith('//');
const isBanner = (l: string) => BANNER.test(l.trim());
const clean = (l: string) => l.trim().replace(COMMENT_PREFIX, '').trimEnd();

/**
 * Comment lines attached to each card literal: every `//` line INSIDE the card's
 * own object literal, plus the contiguous `//` block directly above its opening
 * brace. Section banners are dropped — they describe the FILE's layout, which
 * the JSON document does not have, not the card.
 */
function rescueNotes(): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (let i = 0; i < srcLines.length; i += 1) {
    const m = /^\s*id:\s*'([a-z0-9_]+)',/.exec(srcLines[i] ?? '');
    if (!m) continue;
    const id = m[1]!;
    let open = i - 1;
    while (open >= 0 && !/^\s*\{\s*$/.test(srcLines[open] ?? '')) open -= 1;
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

/** File-level commentary belonging to no single card — rides the DOCUMENT. */
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
 * FIELD ORDER inside the `def` payload. Chosen for the AUTHOR (increasingly an
 * agent), not for the machine — nothing downstream depends on key order, because
 * the loader rebuilds objects and the determinism lock's normalizer sorts keys.
 *   copy -> notes -> query axes -> tuning -> payload
 * `id` and `version` are NOT here: they are the document's KEY and live at the
 * top level (see the envelope docs below).
 */
const DEF_FIELD_ORDER = [
  'name', 'text',
  'notes',
  'archetypes', 'property', 'element', 'weapon', 'size', 'rarity', 'tier',
  'speedWeight', 'cooldownTurns', 'scope', 'special',
  'effects', 'aura', 'tierUpgrades',
] as const;

const cards = Object.values(skillBookFromDefs)
  .slice()
  .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  .map((skill) => {
    const notes = notesById.get(skill.id);
    // `id` is deliberately dropped from the payload: it is half the KEY, and
    // duplicating it inside the VALUE is exactly the drift a store would suffer
    // from. The loader puts it back when it rebuilds the SkillDef.
    const { id, ...rest } = skill;
    const source: Record<string, unknown> = { ...(notes ? { notes } : {}), ...rest };
    const def: Record<string, unknown> = {};
    for (const key of DEF_FIELD_ORDER) if (source[key] !== undefined) def[key] = source[key];
    // Anything the field order does not know about still ships, so a new field
    // can never be silently dropped by this exporter.
    for (const key of Object.keys(source)) if (!(key in def)) def[key] = source[key];
    // ONE DOCUMENT PER CARD; its versions nested inside, oldest first.
    // CURRENT is the entry with the HIGHEST `version` (not the last element) —
    // see the loader. Order here is authoring convenience, not meaning.
    return { id, versions: [{ version: 1, def }] };
  });

const attached = new Set<string>();
for (const notes of notesById.values()) for (const n of notes) attached.add(n);
const docNotes = rescueDocNotes(attached);

/** The document object, before serialization — exposed so tests can inspect it directly. */
export const skillsDocument = { schemaVersion: 1, notes: docNotes, cards };

/**
 * The EXACT bytes `npm run content:export` writes to skills.v1.json, computed
 * in memory with no filesystem write. This is what
 * tests/data/exportIdempotency.test.ts diffs against the committed file to
 * prove the exporter is idempotent — importing this module must not itself
 * write anything, so the write step below is gated to direct invocation only.
 *
 * ASCII-safe on write (see scripts/asciiSafeJson.ts) — the committed document
 * escapes non-ASCII characters (rescued comments use "—" for em dash,
 * "·" for middle dot, etc.) rather than carrying raw UTF-8, so this must
 * match or every export rewrites those sites for zero content change.
 */
export const skillsDocumentText = `${asciiSafeStringify(skillsDocument, 1)}\n`;

const perCard = [...notesById.values()].reduce((n, v) => n + v.length, 0);

function main(): void {
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(OUT, skillsDocumentText);
  console.log(`wrote ${cards.length} cards -> ${OUT.pathname}`);
  console.log(`notes rescued: ${perCard} lines across ${notesById.size}/${cards.length} cards, + ${docNotes.length} document-level = ${perCard + docNotes.length} total`);
}

// Only run the write (and its console output) when this file is the process
// entry point (`tsx scripts/exportContent.ts`) — NOT when a test imports it
// for `skillsDocumentText`, which must be a pure, side-effect-free read.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
