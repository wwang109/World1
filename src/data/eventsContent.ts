import type { EventDef } from './eventTypes';
import {
  eventDefV3OfDocument,
  isEventDefV3,
  type AllV3EventContentDocument,
  type EventContentDocument,
  type LoadedEventDefV3,
  type ResolvedEventVersionWrapperV3,
} from './eventContentV3';
import { currentVersionOf } from './skillsContent';
import {
  eventDefOfDocument,
  eventSchemaVersionOfWrapper,
  type EventContentSchemaVersion,
  validateEventDocument,
} from './validateEventContent';
import activeDocument from './content/events.v3.json';
import frozenV2Document from './content/events.v2.json';

/**
 * Validated JSON source of the live event catalog. The compatibility facade in
 * `events.ts` aliases this projection so existing run/game imports stay stable.
 */

export interface EventContentMeta {
  /** The version this event resolved to — always the highest present. */
  version: number;
  /** Authoring-only notes from the selected version. */
  notes?: readonly string[];
  /** Every version number carried by this document, ascending. */
  versions: readonly number[];
}

type ValidatedEventVersion = { version: number; schemaVersion?: EventContentSchemaVersion; def: Record<string, unknown> };
type ValidatedEventContentDocument = {
  schemaVersion: EventContentSchemaVersion;
  events: readonly { id: string; versions: readonly ValidatedEventVersion[] }[];
};

export type LoadedEventDef = EventDef | LoadedEventDefV3;

export interface LoadedEventContent<TEvent extends LoadedEventDef = LoadedEventDef> {
  catalog: Readonly<Record<string, TEvent>>;
  versions: Readonly<Record<string, Readonly<Record<number, TEvent>>>>;
  meta: Readonly<Record<string, EventContentMeta>>;
  eventDefAtVersion(eventId: string, contentVersion: number): TEvent | undefined;
}

/** Clone JSON-derived values before freezing so callers retain ownership of
 * their input document while every exported catalog/meta descendant is fixed. */
function cloneAndDeepFreeze<T>(value: T): T {
  if (Array.isArray(value)) {
    return Object.freeze(value.map((entry) => cloneAndDeepFreeze(entry))) as T;
  }
  if (value !== null && typeof value === 'object') {
    const copy: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value)) copy[key] = cloneAndDeepFreeze(nested);
    return Object.freeze(copy) as T;
  }
  return value;
}

/** Validate and project an event document synchronously for import and tests. */
export function loadEventContent(raw: AllV3EventContentDocument): LoadedEventContent<LoadedEventDefV3>;
export function loadEventContent(raw: EventContentDocument): LoadedEventContent<LoadedEventDef>;
export function loadEventContent(raw: unknown): LoadedEventContent<LoadedEventDef>;
export function loadEventContent(raw: unknown): LoadedEventContent<LoadedEventDef> {
  const problems = validateEventDocument(raw);
  if (problems.length > 0) {
    const detail = problems.map((problem) => `  ${problem.where}: ${problem.message}`).join('\n');
    throw new Error(`event content document failed validation with ${String(problems.length)} problem(s):\n${detail}`);
  }

  const document = raw as ValidatedEventContentDocument;
  const catalog: Record<string, LoadedEventDef> = {};
  const versions: Record<string, Readonly<Record<number, LoadedEventDef>>> = {};
  const meta: Record<string, EventContentMeta> = {};

  for (const event of [...document.events].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
    const entries = event.versions;
    if (Object.hasOwn(catalog, event.id)) {
      throw new Error(`event content document has more than one entry for id "${event.id}"`);
    }

    const current = currentVersionOf(entries);
    const byVersion: Record<number, LoadedEventDef> = {};
    for (const entry of entries) {
      const schemaVersion = eventSchemaVersionOfWrapper(document.schemaVersion, entry);
      const projected = schemaVersion === 3
        ? eventDefV3OfDocument(event.id, { ...entry, schemaVersion: 3 } as ResolvedEventVersionWrapperV3)
        : eventDefOfDocument(event.id, entry.def);
      byVersion[entry.version] = cloneAndDeepFreeze(projected);
    }
    versions[event.id] = Object.freeze(byVersion);
    catalog[event.id] = byVersion[current.version]!;
    meta[event.id] = cloneAndDeepFreeze({
      version: current.version,
      ...(current.def.notes !== undefined ? { notes: [...(current.def.notes as readonly string[])] } : {}),
      versions: entries.map((entry) => entry.version).sort((a, b) => a - b),
    });
  }

  const frozenVersions = Object.freeze(versions);
  return {
    catalog: Object.freeze(catalog),
    versions: frozenVersions,
    meta: Object.freeze(meta),
    eventDefAtVersion: (eventId, contentVersion) => frozenVersions[eventId]?.[contentVersion],
  };
}

/** Narrow a loaded document only after checking every retained runtime version.
 * Kept as an explicit compatibility utility for callers that truly require a
 * legacy-only document; the active loader no longer applies this restriction. */
export function requireLegacyEventContent(
  content: LoadedEventContent<LoadedEventDef>,
): LoadedEventContent<EventDef> {
  for (const byVersion of Object.values(content.versions)) {
    for (const event of Object.values(byVersion)) {
      if (isEventDefV3(event)) {
        throw new Error('event content document contains a schema-v3 definition');
      }
    }
  }
  return content as LoadedEventContent<EventDef>;
}

/** Temporary source-compatible facade for legacy callers that still read
 * `.choices` directly. Unlike `requireLegacyEventContent`, it retains only
 * legacy current projections: V3 definitions stay available through the mixed
 * runtime catalog and exact lookup without ever reaching a `.choices` reader.
 * The all-legacy active V2 catalog keeps its original object identity. */
export function legacyCurrentEventCatalog(
  content: LoadedEventContent<LoadedEventDef>,
): Readonly<Record<string, EventDef>> {
  const entries = Object.entries(content.catalog);
  if (entries.every(([, event]) => !isEventDefV3(event))) {
    return content.catalog as Readonly<Record<string, EventDef>>;
  }
  return Object.freeze(Object.fromEntries(
    entries.filter((entry): entry is [string, EventDef] => !isEventDefV3(entry[1])),
  ));
}

/** Event definitions keyed in canonical code-unit id order. */
const loadedEventContent: LoadedEventContent<LoadedEventDef> = loadEventContent(activeDocument);

/** Frozen compatibility projection for legacy `.choices` readers. This is
 * deliberately loaded separately from the active mixed-schema catalog: V1/V2
 * pinned definitions remain available without filtering current V3 entries
 * out of production selection. */
const frozenLegacyEventContent = requireLegacyEventContent(loadEventContent(frozenV2Document));

/** The complete active mixed-schema runtime catalog. */
export const loadedEventCatalogFromJson = loadedEventContent.catalog;

/** Source-compatible schema-v2 facade for legacy `.choices` callers. */
export const eventCatalogFromJson = frozenLegacyEventContent.catalog;

/** Version history and authoring notes kept out of the runtime EventDef shape. */
export const eventContentMeta = loadedEventContent.meta;

/** Retrieve the immutable historical definition committed to an event
 * instance from the active aggregate's retained version history. */
export function eventDefAtVersion(eventId: string, contentVersion: number): LoadedEventDef | undefined {
  return loadedEventContent.eventDefAtVersion(eventId, contentVersion);
}
