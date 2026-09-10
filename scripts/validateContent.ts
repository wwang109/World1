/**
 * BUILD GATE for the JSON content documents.
 *
 *   npm run content:validate     (also runs first inside `npm run build`)
 *
 * WHY THIS EXISTS AS A SEPARATE STEP. For skills/gems, the loader
 * (`src/data/skillsContent.ts` / `gemsContent.ts`) already THROWS at import
 * time, which covers the dev server, vitest, the dev battle service and —
 * because `functions/battle.ts` transitively imports it — the deployed Pages
 * Function at module init. But "throws at module init in production" means
 * the first player request of the deploy is what discovers the bad content.
 * This step moves that discovery to BUILD time, so no deployable artifact can
 * be produced from a document that would not load.
 *
 * ENEMIES/MODIFIERS ARE DIFFERENT, AND THIS STEP MATTERS MORE FOR THEM: their
 * loaders (`enemiesContent.ts` / `modifiersContent.ts`) exist and throw the
 * same way, but nothing in the running app imports them yet — `src/data/
 * enemies.ts` / `modifiers.ts` are still the live hand-written sources (see
 * those loaders' own "NOT WIRED UP YET" doc comments), and their throw-at-
 * import guard is otherwise exercised ONLY by their parity tests. Before this
 * change, `enemies.v1.json` / `modifiers.v1.json` shipped with zero build-time
 * or run-time gate at all — a break there would sit undiscovered in the repo
 * until the day something starts reading it. Wiring them in here closes that
 * gap now, ahead of the cutover, rather than leaving it as a second migration
 * TODO.
 *
 * NOT CEREMONY EVEN WHERE A LOADER ALREADY THROWS: this step also runs the
 * RAW-BYTES duplicate-key check below, which no loader can perform — by the
 * time a loader sees a document, `JSON.parse` has already silently resolved
 * a duplicate key to its LAST value, so that structural lie is invisible to
 * every import-time throw and can only be caught by reading the source text.
 *
 * STRICT: errors AND warnings both fail. Warnings are unknown fields — a typo
 * (`capp` for `cap`) is indistinguishable from a field of a newer schema, so the
 * repo that OWNS the content refuses both, while the runtime loader stays lenient
 * for an older reader in the wild. That asymmetry is the design.
 *
 * Output names the card id, the field and the reason, because the intended
 * author is an agent acting on the message rather than a human reading the code.
 */
import { readFileSync } from 'node:fs';
import type { ContentProblem } from '../src/data/validateSkillContent';
import { validateSkillDocument } from '../src/data/validateSkillContent';
import { validateGemDocument } from '../src/data/validateGemContent';
import { validateEnemyDocument } from '../src/data/validateEnemyContent';
import { validateModifierDocument } from '../src/data/validateModifierContent';
import { validateEventDocument } from '../src/data/validateEventContent';
import { renderEventCatalogWiki, validateEventDiscoveryDocument } from './generateEventCatalog';
import { assertGeneratedEventAggregateCurrent } from './eventPackCompiler';
import { loadEventContent } from '../src/data/eventsContent';
import { findDuplicateKeys } from './jsonDuplicateKeys';
import skills from '../src/data/content/skills.v1.json';
import gems from '../src/data/content/gems.v1.json';
import enemies from '../src/data/content/enemies.v1.json';
import modifiers from '../src/data/content/modifiers.v1.json';
import eventsV2 from '../src/data/content/events.v2.json';
import eventsV3 from '../src/data/content/events.v3.json';
import eventDiscoveries from '../src/data/content/event-discoveries.v1.json';

type Validator = (doc: unknown) => ContentProblem[];
const documents: Array<[string, URL, unknown, Validator]> = [
  ['src/data/content/skills.v1.json', new URL('../src/data/content/skills.v1.json', import.meta.url), skills, validateSkillDocument],
  ['src/data/content/gems.v1.json', new URL('../src/data/content/gems.v1.json', import.meta.url), gems, validateGemDocument],
  ['src/data/content/enemies.v1.json', new URL('../src/data/content/enemies.v1.json', import.meta.url), enemies, validateEnemyDocument],
  ['src/data/content/modifiers.v1.json', new URL('../src/data/content/modifiers.v1.json', import.meta.url), modifiers, validateModifierDocument],
  ['src/data/content/events.v2.json', new URL('../src/data/content/events.v2.json', import.meta.url), eventsV2, validateEventDocument],
  ['src/data/content/events.v3.json', new URL('../src/data/content/events.v3.json', import.meta.url), eventsV3, validateEventDocument],
];

type VersionedContentDocument = {
  cards?: readonly unknown[];
  gems?: readonly unknown[];
  enemies?: readonly unknown[];
  modifiers?: readonly unknown[];
  events?: readonly unknown[];
};

let failures = 0;

let compiledEventPacks: ReturnType<typeof assertGeneratedEventAggregateCurrent> | undefined;
try {
  compiledEventPacks = assertGeneratedEventAggregateCurrent(
    new URL('../src/data/content/event-packs/', import.meta.url),
    new URL('../src/data/content/events.v3.json', import.meta.url),
  );
  console.log(`ok  src/data/content/event-packs — ${String(compiledEventPacks.sourceFiles.length)} packs, ${String(compiledEventPacks.document.events.length)} events, generated aggregate current`);
} catch (error) {
  failures += 1;
  console.error(`  ERROR  ${error instanceof Error ? error.message : String(error)}`);
}

for (const [name, file, doc, validate] of documents) {
  // (1) RAW BYTES FIRST. Duplicate keys inside one object are invisible after
  // JSON.parse (it silently keeps the LAST one), so this is the only place that
  // structural lie can be seen at all.
  const dupes = findDuplicateKeys(readFileSync(file, 'utf8'));
  for (const d of dupes) {
    failures += 1;
    console.error(`  ERROR  ${name} line ${String(d.line)} (${d.path}): duplicate key "${d.key}" — first seen line ${String(d.firstLine)}; JSON.parse keeps only the LAST`);
  }

  // (2) PARSED SHAPE: schema + completeness. One outcome — any problem fails.
  const problems = validate(doc);
  for (const p of problems) {
    failures += 1;
    console.error(`  ERROR  ${name} ${p.where}: ${p.message}`);
  }

  if (dupes.length === 0 && problems.length === 0) {
    const d = doc as VersionedContentDocument;
    const count = (d.cards ?? d.gems ?? d.enemies ?? d.modifiers ?? d.events)?.length ?? 0;
    console.log(`ok  ${name} — ${String(count)} documents, no problems`);
  }
}

const eventDiscoveryFile = new URL('../src/data/content/event-discoveries.v1.json', import.meta.url);
const eventDiscoveryDupes = findDuplicateKeys(readFileSync(eventDiscoveryFile, 'utf8'));
for (const duplicate of eventDiscoveryDupes) {
  failures += 1;
  console.error(`  ERROR  src/data/content/event-discoveries.v1.json line ${String(duplicate.line)} (${duplicate.path}): duplicate key "${duplicate.key}" — first seen line ${String(duplicate.firstLine)}; JSON.parse keeps only the LAST`);
}
const stagedEventContent = loadEventContent(eventsV3);
const eventDiscoveryProblems = validateEventDiscoveryDocument(eventDiscoveries, stagedEventContent);
for (const problem of eventDiscoveryProblems) {
  failures += 1;
  console.error(`  ERROR  src/data/content/event-discoveries.v1.json ${problem.where}: ${problem.message}`);
}
if (eventDiscoveryDupes.length === 0 && eventDiscoveryProblems.length === 0) {
  console.log(`ok  src/data/content/event-discoveries.v1.json — ${String(eventDiscoveries.discoveries.length)} discoveries, no problems`);
}

const eventCatalogWiki = new URL('../docs/generated/event-catalog.md', import.meta.url);
const sourceLabels: Readonly<Record<string, string>> = compiledEventPacks === undefined
  ? {}
  : Object.fromEntries(compiledEventPacks.sourceFiles.flatMap((source) =>
    source.document.events.map((event) => [event.id, `src/data/content/event-packs/${source.name}`] as const),
  ));
const expectedEventCatalogWiki = renderEventCatalogWiki(
  stagedEventContent,
  eventDiscoveries,
  sourceLabels,
);
let actualEventCatalogWiki: string | undefined;
try {
  actualEventCatalogWiki = readFileSync(eventCatalogWiki, 'utf8');
} catch {
  failures += 1;
  console.error('  ERROR  docs/generated/event-catalog.md: missing generated event catalog; run npm run content:wiki');
}
if (actualEventCatalogWiki !== undefined && actualEventCatalogWiki !== expectedEventCatalogWiki) {
  failures += 1;
  console.error('  ERROR  docs/generated/event-catalog.md: generated catalog is stale; run npm run content:wiki');
}

if (failures > 0) {
  console.error(
    `\ncontent validation FAILED: ${String(failures)} problem(s).`
    + '\nThe schema is a CONTRACT: it rejects anything it does not define, unknown fields included.'
    + '\nSee src/data/content/README.md for the shape, the enum values, and the rules a card must satisfy.',
  );
  process.exit(1);
}
console.log('content validation passed');
