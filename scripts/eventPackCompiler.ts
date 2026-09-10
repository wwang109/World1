/**
 * Deterministic build-time compiler for JSON-authored event packs.
 *
 * Runtime deliberately imports only the generated aggregate. This compiler is
 * the single place where filesystem discovery is allowed, and it sorts source
 * names in explicit code-unit order before preserving every authored event and
 * choice array in that order.
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { basename, join, resolve } from 'node:path';
import { findDuplicateKeys } from './jsonDuplicateKeys';
import { validateEventDocument } from '../src/data/validateEventContent';

export interface EventPackEvent {
  id: string;
  versions: readonly {
    version: number;
    schemaVersion?: 1 | 2 | 3;
    def: Record<string, unknown>;
  }[];
}

export interface EventPackDocument {
  schemaVersion: 1 | 2 | 3;
  notes?: readonly string[];
  storyStateSchema?: Record<string, unknown>;
  events: readonly EventPackEvent[];
}

export interface EventPackSource {
  name: string;
  path: string;
  document: EventPackDocument;
}

export interface CompiledEventPacks {
  sourceFiles: readonly EventPackSource[];
  document: EventPackDocument;
}

function asPath(value: string | URL): string {
  return value instanceof URL ? fileURLToPath(value) : value;
}

function codeUnitCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function fail(problems: readonly string[]): never {
  throw new Error(`event pack compilation failed:\n${problems.map((problem) => `  - ${problem}`).join('\n')}`);
}

function parsePack(path: string): { document?: EventPackDocument; problems: string[] } {
  const name = basename(path);
  const raw = readFileSync(path, 'utf8');
  const problems = findDuplicateKeys(raw).map((dupe) =>
    `${name} line ${String(dupe.line)} (${dupe.path}): duplicate key "${dupe.key}" (first line ${String(dupe.firstLine)})`,
  );
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    problems.push(`${name}: invalid JSON (${error instanceof Error ? error.message : String(error)})`);
    return { problems };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    problems.push(`${name}: pack document must be an object`);
    return { problems };
  }
  const record = parsed as Record<string, unknown>;
  const validation = validateEventDocument(parsed, { includeCrossEventReferences: false });
  for (const problem of validation) problems.push(`${name} ${problem.where}: ${problem.message}`);
  return { document: parsed as EventPackDocument, problems };
}

function canonicalFingerprint(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalFingerprint).join(',')}]`;
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? String(value);
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort(codeUnitCompare).map((key) =>
    `${JSON.stringify(key)}:${canonicalFingerprint(record[key])}`).join(',')}}`;
}

function aggregateEvent(
  event: EventPackEvent,
  sourceSchemaVersion: EventPackDocument['schemaVersion'],
  aggregateSchemaVersion: EventPackDocument['schemaVersion'],
): EventPackEvent {
  if (sourceSchemaVersion === aggregateSchemaVersion) return event;
  return {
    id: event.id,
    versions: event.versions.map((wrapper) => wrapper.schemaVersion === undefined
      ? {
        version: wrapper.version,
        // Schema-2 source envelopes grandfather legacy definitions by their
        // lack of `delivery`. Once lifted into a v3 envelope that structural
        // inheritance must become an honest v1 tag; actual v2 definitions
        // retain v2 identity. Authored explicit tags are preserved below.
        schemaVersion: sourceSchemaVersion === 2 && !('delivery' in wrapper.def)
          ? 1
          : sourceSchemaVersion,
        def: wrapper.def,
      }
      : wrapper),
  };
}

/** Compile every `*.json` source pack in explicit code-unit filename order. */
export function compileEventPacks(packDirectory: string | URL): CompiledEventPacks {
  const directory = asPath(packDirectory);
  const paths = readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => join(directory, entry.name))
    .sort(codeUnitCompare);
  if (paths.length === 0) fail([`${directory}: no *.json event packs found`]);

  const sourceFiles: EventPackSource[] = [];
  const problems: string[] = [];
  const ids = new Map<string, string>();
  let v3Registry: { name: string; value: Record<string, unknown>; fingerprint: string } | undefined;
  for (const path of paths) {
    const parsed = parsePack(path);
    problems.push(...parsed.problems);
    if (!parsed.document) continue;
    const name = basename(path);
    if (parsed.document.schemaVersion === 3
      && parsed.document.storyStateSchema !== undefined
      && typeof parsed.document.storyStateSchema === 'object'
      && parsed.document.storyStateSchema !== null
      && !Array.isArray(parsed.document.storyStateSchema)) {
      const value = parsed.document.storyStateSchema;
      const fingerprint = canonicalFingerprint(value);
      if (v3Registry === undefined) v3Registry = { name, value, fingerprint };
      else if (fingerprint !== v3Registry.fingerprint) {
        problems.push(`conflicting storyStateSchema in ${v3Registry.name} and ${name}`);
      }
    }
    if (parsed.problems.length > 0) continue;
    for (const event of parsed.document.events) {
      const first = ids.get(event.id);
      if (first !== undefined) problems.push(`duplicate event id "${event.id}" in ${first} and ${name}`);
      else ids.set(event.id, name);
    }
    sourceFiles.push({ name, path, document: parsed.document });
  }
  if (problems.length > 0) fail(problems);

  const schemaVersion = sourceFiles.reduce<EventPackDocument['schemaVersion']>(
    (highest, source) => Math.max(highest, source.document.schemaVersion) as EventPackDocument['schemaVersion'],
    1,
  );
  const events = sourceFiles.flatMap((source) => source.document.events.map((event) =>
    aggregateEvent(event, source.document.schemaVersion, schemaVersion)));
  const document: EventPackDocument = schemaVersion === 3
    ? { schemaVersion, storyStateSchema: v3Registry!.value, events }
    : schemaVersion === 2
      ? { schemaVersion, storyStateSchema: {}, events }
      : {
        schemaVersion,
        ...(sourceFiles.some((source) => (source.document.notes?.length ?? 0) > 0)
          ? { notes: sourceFiles.flatMap((source) => source.document.notes ?? []) }
          : {}),
        events,
      };
  const aggregateProblems = validateEventDocument(document);
  if (aggregateProblems.length > 0) {
    fail(aggregateProblems.map((problem) => `aggregate ${problem.where}: ${problem.message}`));
  }
  return { sourceFiles, document };
}

export function serializeEventPackAggregate(compiled: CompiledEventPacks): string {
  return `${JSON.stringify(compiled.document, null, 2)}\n`;
}

/** Throws when generated runtime bytes do not exactly match the source packs. */
export function assertGeneratedEventAggregateCurrent(
  packDirectory: string | URL,
  generatedPath: string | URL,
): CompiledEventPacks {
  const compiled = compileEventPacks(packDirectory);
  const output = asPath(generatedPath);
  const expected = serializeEventPackAggregate(compiled);
  if (!existsSync(output) || readFileSync(output, 'utf8') !== expected) {
    throw new Error(`${output}: generated event aggregate is stale; run npm run content:events`);
  }
  return compiled;
}

export function writeCompiledEventPacks(
  packDirectory: string | URL,
  generatedPath: string | URL,
): CompiledEventPacks {
  const compiled = compileEventPacks(packDirectory);
  writeFileSync(asPath(generatedPath), serializeEventPackAggregate(compiled), 'utf8');
  return compiled;
}

/** Write only the aggregate matching the highest active source schema. Older
 * compatibility aggregates are immutable inputs once a higher schema ships. */
export function writeVersionedEventPackAggregate(
  packDirectory: string | URL,
  contentDirectory: string | URL,
): CompiledEventPacks {
  const compiled = compileEventPacks(packDirectory);
  const generatedPath = join(
    asPath(contentDirectory),
    `events.v${String(compiled.document.schemaVersion)}.json`,
  );
  writeFileSync(generatedPath, serializeEventPackAggregate(compiled), 'utf8');
  return compiled;
}

const PACK_DIRECTORY = new URL('../src/data/content/event-packs/', import.meta.url);
const CONTENT_DIRECTORY = new URL('../src/data/content/', import.meta.url);

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  writeVersionedEventPackAggregate(PACK_DIRECTORY, CONTENT_DIRECTORY);
}
