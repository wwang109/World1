/**
 * Dumps the LIVE enemy book to the JSON content document.
 *
 *   npm run content:export   (runs this after the skills/gems exports)
 *
 * ONE-SHOT MIGRATION TOOL, same shape as scripts/exportContent.ts and
 * scripts/exportGems.ts and for the same reason: a dump FROM the live book is
 * faithful by construction, where hand transcription is exactly how a silent
 * change to a monster's deck or stats gets in unreviewed. Proven by
 * tests/data/enemiesJsonParity.test.ts (deepEqual against the TS book).
 *
 * src/data/enemies.ts stays the SOURCE OF TRUTH after this runs. This
 * document is an OUTPUT, not yet a second thing to keep in sync by hand —
 * nothing loads from it. Regenerating after enemies.ts changes is this one
 * command, not a merge.
 *
 * Rescues the balance-derivation COMMENTS out of src/data/enemies.ts into the
 * document's `notes` (file-level; enemies.ts carries no per-monster inline
 * comments today, see the module doc on rescueNotes below).
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { enemies } from '../src/data/enemies';
import { asciiSafeStringify } from './asciiSafeJson';

const SRC = new URL('../src/data/enemies.ts', import.meta.url);
const OUT_DIR = new URL('../src/data/content/', import.meta.url);
const OUT = new URL('./enemies.v1.json', OUT_DIR);

const NEWLINE = /\r?\n/;
const BANNER = /^\/\/\s*[-=]{3,}/;
const COMMENT_PREFIX = /^\/\/\s?/;

const srcLines = readFileSync(SRC, 'utf8').split(NEWLINE);
const isComment = (l: string) => l.trim().startsWith('//');
const isBanner = (l: string) => BANNER.test(l.trim());
const clean = (l: string) => l.trim().replace(COMMENT_PREFIX, '').trimEnd();

/**
 * Comments attached to each enemy literal. enemies.ts is a keyed OBJECT, so an
 * enemy opens with `  some_id: {` rather than the bare `  {` skills.ts uses —
 * same opening pattern as gems.ts, hence the same rescue shape as
 * exportGems.ts's rescueNotes.
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
      // STOP at a section banner, do not merely skip it. A banner may span
      // several lines, and only its FIRST line matches `isBanner` — the
      // continuation lines are ordinary comments that happen to end in `---`.
      // Skipping the opener and walking on attached those continuations to the
      // next enemy as if they were its own balance note, dangling `---` and all
      // (bandit_duelist, seraph and wolf_king each carried one). Nothing above a
      // divider belongs to the entry below it, so the walk ends here.
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

/** File-level commentary belonging to no single enemy — rides the DOCUMENT. */
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
 * FIELD ORDER inside the `def` payload — the same "copy -> notes -> query
 * axes -> tuning -> payload" convention exportContent.ts/exportGems.ts use:
 *   name (copy) -> notes -> baseDepth/isElite/isBoss (encounter-role axes) ->
 *   elementAffinity/weaponAffinity (type axes, the matchup query) ->
 *   stats/boardSize/pieces (the deck build itself) -> goldReward/xpReward
 *   (economy tuning).
 * `id` is NOT here: it is the document's KEY (see the envelope docs on the
 * skills/gems loaders) and the loader puts it back when rebuilding the def.
 */
const DEF_FIELD_ORDER = [
  'name',
  'notes',
  'baseDepth', 'isElite', 'isBoss',
  'elementAffinity', 'weaponAffinity',
  'stats', 'boardSize', 'pieces',
  'goldReward', 'xpReward',
] as const;

const enemyList = Object.values(enemies)
  .slice()
  .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  .map((enemy) => {
    const notes = notesById.get(enemy.id);
    // `id` is deliberately dropped from the payload — see DEF_FIELD_ORDER's
    // doc comment; the loader puts it back when it rebuilds the EnemyDef.
    const { id, ...rest } = enemy;
    const source: Record<string, unknown> = { ...(notes ? { notes } : {}), ...rest };
    const def: Record<string, unknown> = {};
    for (const key of DEF_FIELD_ORDER) if (source[key] !== undefined) def[key] = source[key];
    // Anything the field order does not know about still ships, so a new
    // EnemyDef field can never be silently dropped by this exporter.
    for (const key of Object.keys(source)) if (!(key in def)) def[key] = source[key];
    // ONE DOCUMENT PER ENEMY; its versions nested inside, oldest first.
    // CURRENT is the entry with the HIGHEST `version` (not the last element)
    // — see the loader (src/data/enemiesContent.ts, not wired up yet).
    return { id, versions: [{ version: 1, def }] };
  });

const attached = new Set<string>();
for (const notes of notesById.values()) for (const n of notes) attached.add(n);
const docNotes = rescueDocNotes(attached);

/** The document object, before serialization — exposed so tests can inspect it directly. */
export const enemiesDocument = { schemaVersion: 1, notes: docNotes, enemies: enemyList };

/**
 * The EXACT bytes `npm run content:export` writes to enemies.v1.json, computed
 * in memory with no filesystem write. This is what
 * tests/data/enemiesExportIdempotency.test.ts diffs against the committed
 * file to prove the exporter is idempotent — importing this module must not
 * itself write anything, so the write step below is gated to direct
 * invocation only.
 *
 * ASCII-safe on write, same convention as skills.v1.json (see
 * scripts/asciiSafeJson.ts) rather than gems.v1.json's raw-UTF8 form:
 * enemies.ts's rescued doc-level comments carry the same em-dash characters
 * skills.ts's do (see the "run-layer SCALING concern" / "fight result is
 * emergent" notes), so the same "robust across editors/encodings, diffs as
 * plain ASCII" argument applies — and exportGems.ts's own doc comment already
 * flags raw UTF-8 as the form to migrate AWAY from, not the one to extend to
 * a brand-new document. Using the shared helper here keeps this a two-way
 * split (ASCII-safe now the default; gems.v1.json alone still owes its
 * migration) instead of a three-way one.
 */
export const enemiesDocumentText = `${asciiSafeStringify(enemiesDocument, 1)}\n`;

const perEnemy = [...notesById.values()].reduce((n, v) => n + v.length, 0);

function main(): void {
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(OUT, enemiesDocumentText);
  console.log(`wrote ${enemyList.length} enemies -> ${OUT.pathname}`);
  console.log(`notes rescued: ${perEnemy} lines across ${notesById.size}/${enemyList.length} enemies, + ${docNotes.length} document-level = ${perEnemy + docNotes.length} total`);
}

// Only run the write (and its console output) when this file is the process
// entry point (`tsx scripts/exportEnemies.ts`) — NOT when a test imports it
// for `enemiesDocumentText`, which must be a pure, side-effect-free read.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
