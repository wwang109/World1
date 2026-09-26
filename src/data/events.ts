import { eventCatalogFromJson, loadedEventCatalogFromJson } from './eventsContent';

export type {
  EventTheme,
  EventGate,
  EventTallyGate,
  EventRarity,
  EventArtId,
  EventRequirement,
  FilterFromSource,
  EventOutcomeSpec,
  EventChoiceDef,
  EventDef,
  MarketStat,
} from './eventTypes';
export type { LoadedEventDefV3 } from './eventContentV3';
export type { LoadedEventDef, LoadedEventContent } from './eventsContent';

export { eventContentMeta } from './eventsContent';

/** Frozen schema-v2 compatibility facade for legacy run/game readers. */
export const eventCatalog = eventCatalogFromJson;

/** Mixed-schema current runtime view consumed by the live selector. */
export const eventRuntimeCatalog = loadedEventCatalogFromJson;

/** Canonical code-unit order established by the validated JSON loader. */
export const eventCatalogIds = Object.keys(eventCatalogFromJson);

/** Canonical IDs for the active mixed-schema runtime view. */
export const eventRuntimeCatalogIds = Object.keys(loadedEventCatalogFromJson);
