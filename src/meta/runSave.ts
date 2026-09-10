// Durable persistence for the one active run. This module is pure TypeScript:
// the game layer supplies the string-only storage driver.
//
// Schema history: v1 (original), v2 (added the event-callback/story/map-intel
// containers), v3 (current — added the combat/revenge/signature fact ledgers,
// journey ledger, event-binding reservations, and per-instance
// `eventMaterializations`). `loadRun` tries the v3 key, then v2, then v1 —
// see "PRECEDENCE" below — migrating an older hit forward with
// `migrateV1RunToV2`/`migrateV2Run` before returning it.
//
// CORRUPTION SEMANTICS (mirrors `lifetimeStats.ts`'s precedent):
//   - No blob at ANY of the three keys -> `loadRun` returns `null` (nothing
//     to resume).
//   - The v3 key holds the explicit "cleared" marker (JSON `null`, written
//     by `clearRun`) -> `loadRun` returns `null`. NOT corruption — this is
//     what a deliberately-cleared save looks like on disk, and it is
//     authoritative: it blocks v2/v1 resurrection too (see PRECEDENCE).
//   - Unparseable JSON, or JSON that parses to something structurally wrong
//     (not an object; a missing/non-numeric `schemaVersion`; a `run` field
//     that isn't itself a plain object; or, for v1/v2, a `run` that fails
//     that schema's own frozen shape predicate) -> `loadRun` returns `null`
//     AND first copies the RAW bytes, untouched, to that key's own backup
//     key (`RUN_SAVE_BACKUP_KEY` / `RUN_SAVE_V2_BACKUP_KEY` /
//     `RUN_SAVE_V1_BACKUP_KEY`) — never silently destroyed, always available
//     for a future repair tool.
//   - The v3 key holds a `schemaVersion` NEWER than this build's
//     `SCHEMA_VERSION` -> `loadRun` returns `null` WITHOUT backing up: the
//     bytes are valid JSON from a format this build doesn't understand yet,
//     so nothing is touched. `saveRun`/`clearRun` enforce the write-side
//     half: both refuse to overwrite a strictly-newer stored blob, so an
//     older build can never downgrade it.
//   - MIGRATION REFUSAL: a v1/v2 envelope can pass its OWN schema's shape
//     predicate yet still produce a v3 shape that fails the current
//     `isRunStateV3` invariant — e.g. an old resolution's
//     `(eventId, contentVersion)` now names a definition a LATER content
//     change re-authored to schema 3; legacy schemas had no concept of a
//     materialization to record for it, so the migrated topology is
//     provably incomplete. When this happens, migration REFUSES exactly
//     like the paragraph above: the original v1/v2 bytes are backed up
//     UNTOUCHED under that key's own backup key, `null` is returned, and
//     NOTHING is ever written to the v3 key. This is the only sound choice
//     — writing the unvalidated blob anyway would let the save resume ONCE
//     (this load) and then become permanently unloadable, since every later
//     load hits the strict v3 key first and rejects it there instead.
//
// PRECEDENCE: presence of a value (including the `null` tombstone) at the v3
// key blocks v2/v1 entirely; presence at the v2 key blocks v1. A key is only
// consulted if every higher-precedence key is completely absent.
//
// MIGRATIONS: schema bumps so far (v1->v2, v2->v3) are each one small pure
// function (`migrateV1RunToV2`, `migrateV2Run`) called inline from
// `migrateHistoricalEnvelope` — NOT the `MIGRATIONS` table idiom
// `lifetimeStats.ts` already uses. That is now the exact ad hoc pile the
// original v1-only version of this comment warned against growing. Left
// as-is for this fix (out of scope — save/load semantics only); the day a
// fourth schema is added, refactor `loadRun` onto a real per-version
// migration table rather than adding a third inline branch.

import type { EventInstanceRecord, EventInstanceRecordV2 } from '../run/eventInstances';
import {
  isEventDefV3,
  isQueuedCallbackEventDefV3,
  type EventBoundSubjectsV3,
  type LoadedEventDefV3,
} from '../data/eventContentV3';
import { eventDefAtVersion } from '../data/eventsContent';
import { skillBook } from '../data/skills';
import { gemBook } from '../data/gems';
import type {
  EventCallbackQueueEntry,
  EventCallbackQueueEntryV2,
  EventResolution,
  RunState,
  RunStateV2,
  RunStats,
} from '../run/runState';
import {
  hasExactUnavailableChoiceReasonsV3,
  INITIAL_EVENT_STORY_STATE_V3,
  type EventMaterializationRecord,
} from '../run/eventV3Materialization';
import { biomeIds } from '../data/biomes';
import type { StorageDriver } from './lifetimeStats';

export type { StorageDriver, RunStateV2 };

export const RUN_SAVE_V1_STORAGE_KEY = 'world1:runSave:v1';
export const RUN_SAVE_V2_STORAGE_KEY = 'world1:runSave:v2';
export const RUN_SAVE_STORAGE_KEY = 'world1:runSave:v3';

export const RUN_SAVE_V1_BACKUP_KEY = `${RUN_SAVE_V1_STORAGE_KEY}:corrupt-backup`;
export const RUN_SAVE_V2_BACKUP_KEY = `${RUN_SAVE_V2_STORAGE_KEY}:corrupt-backup`;
export const RUN_SAVE_BACKUP_KEY = `${RUN_SAVE_STORAGE_KEY}:corrupt-backup`;

export const SCHEMA_VERSION = 3;

export interface RunSaveEnvelope {
  schemaVersion: number;
  run: RunState;
}

/** The only persisted event-resolution shape emitted by schema v1. */
export interface V1EventResolution {
  eventId: string;
  choiceId: string;
  pending?: boolean;
}

/**
 * Frozen schema-v1 contract. The literal Pick list prevents future RunState
 * fields from leaking backward into this historical migration input.
 */
export type RunStateV1 = Pick<RunStateV2,
  | 'seed'
  | 'map'
  | 'status'
  | 'depth'
  | 'lives'
  | 'bossesCleared'
  | 'currentNodeId'
  | 'pieces'
  | 'bagSlots'
  | 'held'
  | 'draft'
  | 'gemInventory'
  | 'nextCardInstanceId'
  | 'shopShelves'
  | 'eventBag'
  | 'eventBagRefills'
  | 'eventThemeBags'
  | 'eventThemeBagRefills'
  | 'gold'
  | 'heroLevel'
  | 'heroAllocation'
  | 'wins'
  | 'losses'
  | 'stats'
> & {
  eventInstances: Record<string, string>;
  eventResolutions?: Record<string, V1EventResolution>;
};

function drawnDepthFor(run: RunStateV1, nodeId: string): number {
  if (run.map === undefined) return 0;
  for (const column of run.map.depths) {
    const node = column.find((candidate) => candidate.id === nodeId);
    if (node) return node.depth;
  }
  return 0;
}

/** Convert only the schema-v1 event ledgers and add the schema-v2 containers. */
export function migrateV1RunToV2(run: RunStateV1): RunStateV2 {
  const eventInstances: Record<string, EventInstanceRecordV2> = {};
  for (const [nodeId, eventId] of Object.entries(run.eventInstances)) {
    eventInstances[nodeId] = {
      eventId,
      contentVersion: 1,
      instanceId: `legacy:${nodeId}`,
      drawnDepth: drawnDepthFor(run, nodeId),
    };
  }

  const eventResolutions: Record<string, EventResolution> = {};
  for (const [nodeId, resolution] of Object.entries(run.eventResolutions ?? {})) {
    const instance = eventInstances[nodeId] ?? {
      eventId: resolution.eventId,
      contentVersion: 1,
      instanceId: `legacy:${nodeId}`,
      drawnDepth: drawnDepthFor(run, nodeId),
    };
    eventInstances[nodeId] = instance;
    eventResolutions[nodeId] = {
      eventId: instance.eventId,
      contentVersion: instance.contentVersion,
      instanceId: instance.instanceId,
      choiceId: resolution.choiceId,
      ...(resolution.pending ? { pending: true } : {}),
    };
  }

  const {
    eventInstances: _legacyInstances,
    eventResolutions: _legacyResolutions,
    ...v1Base
  } = run;
  return {
    ...v1Base,
    eventInstances,
    eventResolutions,
    eventCallbackQueue: [],
    completedStoryIds: [],
    eventCallbackResolutionIds: [],
    mapIntelByBand: {},
    appliedMapInfoSourceIds: [],
  };
}

/** Add only the required schema-v3 persistence defaults. */
export function migrateV2Run(run: RunStateV2): RunState {
  return {
    ...run,
    combatFactLedger: [],
    revengeFactLedger: [],
    signatureFactLedger: [],
    journeyFactLedger: { visitedBiomeIds: [] },
    eventBindingReservations: [],
    eventMaterializations: {},
    storyStateV3: { ...INITIAL_EVENT_STORY_STATE_V3 },
  };
}

/** Compatibility seam retained for callers of the former one-step migration. */
export function migrateV1Run(run: RunStateV1): RunState {
  return migrateV2Run(migrateV1RunToV2(run));
}

export type RunSaveOutcome =
  | { ok: true }
  | { ok: false; reason: 'newer-version-on-disk' | 'write-failed' };

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function hasExactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean {
  const allowed = new Set([...required, ...optional]);
  return required.every((key) => Object.prototype.hasOwnProperty.call(value, key))
    && Object.keys(value).every((key) => allowed.has(key));
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((entry) => typeof entry === 'string');
}

function isNumberRecord(value: unknown): value is Record<string, number> {
  return isRecord(value) && Object.values(value).every(isFiniteNumber);
}

function isStringArrayRecord(value: unknown): value is Record<string, string[]> {
  return isRecord(value) && Object.values(value).every(isStringArray);
}

function isRunMap(value: unknown): boolean {
  if (!isRecord(value) || !isFiniteNumber(value.seed) || !Array.isArray(value.depths)) return false;
  return value.depths.every((column) => Array.isArray(column) && column.every((node) => (
    isRecord(node)
    && typeof node.id === 'string'
    && isFiniteNumber(node.depth)
    && isFiniteNumber(node.wave)
    && typeof node.kind === 'string'
  )));
}

function isEventInstanceV2(value: unknown): value is EventInstanceRecordV2 {
  return isRecord(value)
    && hasExactKeys(value, [
      'eventId', 'contentVersion', 'instanceId', 'drawnDepth',
    ], ['callbackInstanceId'])
    && typeof value.eventId === 'string'
    && isFiniteNumber(value.contentVersion)
    && typeof value.instanceId === 'string'
    && isFiniteNumber(value.drawnDepth)
    && (value.callbackInstanceId === undefined || typeof value.callbackInstanceId === 'string');
}

function isEventInstance(value: unknown): value is EventInstanceRecord {
  if (!(isRecord(value)
    && hasExactKeys(value, [
      'eventId', 'contentVersion', 'instanceId', 'drawnDepth',
    ], ['callbackInstanceId', 'boundSubjects'])
    && typeof value.eventId === 'string'
    && isFiniteNumber(value.contentVersion)
    && typeof value.instanceId === 'string'
    && isFiniteNumber(value.drawnDepth)
    && (value.callbackInstanceId === undefined || typeof value.callbackInstanceId === 'string')
    && (value.boundSubjects === undefined || isBoundSubjects(value.boundSubjects)))) return false;
  if (value.callbackInstanceId === undefined) return true;
  const target = eventDefAtVersion(value.eventId, value.contentVersion);
  if (target === undefined) return false;
  return !isEventDefV3(target)
    || (target.delivery.kind === 'queued_callback'
      && hasExactV3TargetSubjects(target, value.boundSubjects));
}

function isEventResolution(value: unknown): value is EventResolution {
  return isRecord(value)
    && typeof value.eventId === 'string'
    && isFiniteNumber(value.contentVersion)
    && typeof value.instanceId === 'string'
    && typeof value.choiceId === 'string'
    && (value.pending === undefined || typeof value.pending === 'boolean');
}

function isMissedEventOpportunity(value: unknown): boolean {
  return isRecord(value)
    && typeof value.eventId === 'string'
    && isFiniteNumber(value.contentVersion)
    && typeof value.biomeId === 'string'
    && isFiniteNumber(value.missedDepth)
    && isFiniteNumber(value.laterOpportunities)
    && value.laterOpportunities >= 0;
}

function isEventCallbackBase(value: unknown): value is EventCallbackQueueEntry {
  if (!isRecord(value)
    || typeof value.callbackInstanceId !== 'string'
    || typeof value.callbackId !== 'string'
    || typeof value.eventId !== 'string'
    || !isFiniteNumber(value.contentVersion)
    || !isFiniteNumber(value.scheduledDepth)
    || !isFiniteNumber(value.earliestDepth)
    || !isFiniteNumber(value.minDepthDelay)
    || !isStringArray(value.destinationThemes)
    || (value.destinationBiomeIds !== undefined && (
      !isStringArray(value.destinationBiomeIds)
      || value.destinationBiomeIds.length === 0
      || value.destinationBiomeIds.some((biomeId) => !biomeIds.includes(biomeId))
    ))
    || !isFiniteNumber(value.priority)) return false;
  if (value.expiry === undefined) return true;
  if (!isRecord(value.expiry) || !isFiniteNumber(value.expiry.expiresAfterNodes)) return false;
  const fallback = value.expiry.fallback;
  return fallback === 'discard'
    || (isRecord(fallback)
      && isRecord(fallback.outcome)
      && fallback.outcome.kind === 'grantGold'
      && isFiniteNumber(fallback.outcome.amount));
}

function isEventCallbackV2(value: unknown): value is EventCallbackQueueEntryV2 {
  return isEventCallbackBase(value) && isStringRecord(value.boundSubjects);
}

function isCurrentEventCallback(value: unknown): value is EventCallbackQueueEntry {
  if (!isEventCallbackBase(value)) return false;
  const target = eventDefAtVersion(value.eventId, value.contentVersion);
  if (target === undefined) return false;
  if (!isEventDefV3(target)) return isStringRecord(value.boundSubjects);
  if (!isBoundSubjects(value.boundSubjects)) return false;
  if (!hasExactV3TargetSubjects(target, value.boundSubjects)) return false;
  const destinationBiome = (value.boundSubjects as { destination_biome?: unknown }).destination_biome;
  return destinationBiome === undefined
    || (typeof destinationBiome === 'string'
      && Array.isArray(value.destinationBiomeIds)
      && value.destinationBiomeIds.length === 1
      && value.destinationBiomeIds[0] === destinationBiome);
}

function isRunStats(value: unknown): value is RunStats {
  if (!isRecord(value)) return false;
  const keys: readonly (keyof RunStats)[] = [
    'damageDealt', 'damageTaken', 'healingDone', 'goldEarned', 'goldSpent',
    'cardsBought', 'gemsBought', 'eventsResolved', 'deepestWave', 'livesLost',
  ];
  return keys.every((key) => isFiniteNumber(value[key]));
}

function isDraft(value: unknown): boolean {
  return isRecord(value)
    && isFiniteNumber(value.rerolls)
    && isStringRecord(value.picks);
}

function hasUniqueCallbackInstanceIds(entries: readonly unknown[]): boolean {
  const callbackInstanceIds: string[] = [];
  for (const entry of entries) {
    if (!isRecord(entry) || typeof entry.callbackInstanceId !== 'string'
      || callbackInstanceIds.includes(entry.callbackInstanceId)) return false;
    callbackInstanceIds.push(entry.callbackInstanceId);
  }
  return true;
}

function isRunStateV2Shape(
  value: unknown,
  eventInstancePredicate: (instance: unknown) => boolean,
  eventCallbackPredicate: (callback: unknown) => boolean,
): boolean {
  if (!isRecord(value)) return false;
  const status = value.status;
  if (!isFiniteNumber(value.seed)
    || !isRunMap(value.map)
    || (status !== 'drafting' && status !== 'active' && status !== 'victory' && status !== 'defeat' && status !== 'retired')
    || !isFiniteNumber(value.depth)
    || !isFiniteNumber(value.lives)
    || !isFiniteNumber(value.bossesCleared)
    || (value.currentNodeId !== null && typeof value.currentNodeId !== 'string')
    || !Array.isArray(value.pieces)
    || !Array.isArray(value.bagSlots)
    || (value.held !== undefined && value.held !== null && !isRecord(value.held))
    || (value.draft !== undefined && !isDraft(value.draft))
    || !isStringArray(value.gemInventory)
    || !isFiniteNumber(value.nextCardInstanceId)
    || !isRecord(value.shopShelves)
    || !isStringArray(value.eventBag)
    || !isFiniteNumber(value.eventBagRefills)
    || (value.eventThemeBags !== undefined && !isStringArrayRecord(value.eventThemeBags))
    || (value.eventThemeBagRefills !== undefined && !isNumberRecord(value.eventThemeBagRefills))
    || !isRecord(value.eventInstances)
    || !Object.values(value.eventInstances).every(eventInstancePredicate)
    || (value.eventResolutions !== undefined && (!isRecord(value.eventResolutions)
      || !Object.values(value.eventResolutions).every(isEventResolution)))
    || !Array.isArray(value.eventCallbackQueue)
    || !value.eventCallbackQueue.every(eventCallbackPredicate)
    || !hasUniqueCallbackInstanceIds(value.eventCallbackQueue)
    || (value.completedStoryIds !== undefined && !isStringArray(value.completedStoryIds))
    || (value.eventCallbackResolutionIds !== undefined && !isStringArray(value.eventCallbackResolutionIds))
    || !isRecord(value.mapIntelByBand)
    || !Object.values(value.mapIntelByBand).every((entry) => isRecord(entry)
      && isFiniteNumber(entry.band)
      && typeof entry.sourceEventInstanceId === 'string'
      && isRecord(entry.snapshot))
    || !isStringArray(value.appliedMapInfoSourceIds)
    || !isFiniteNumber(value.gold)
    || !isFiniteNumber(value.heroLevel)
    || !isRecord(value.heroAllocation)
    || !isFiniteNumber(value.wins)
    || !isFiniteNumber(value.losses)
    || !isRunStats(value.stats)) return false;
  return true;
}

/** Explicit runtime enumeration of the frozen schema-v2 top-level contract. */
function isRunStateV2(value: unknown): value is RunStateV2 {
  return isRunStateV2Shape(value, isEventInstanceV2, isEventCallbackV2);
}

function isV1EventResolution(value: unknown): value is V1EventResolution {
  return isRecord(value)
    && hasExactKeys(value, ['eventId', 'choiceId'], ['pending'])
    && typeof value.eventId === 'string'
    && typeof value.choiceId === 'string'
    && (value.pending === undefined || typeof value.pending === 'boolean');
}

/** Validate the complete frozen schema-v1 shape before migrating any bytes. */
function isMigrateableV1Run(value: unknown): value is RunStateV1 {
  if (!isRecord(value)
    || !hasExactKeys(value, [
      'seed', 'map', 'status', 'depth', 'lives', 'bossesCleared', 'currentNodeId',
      'pieces', 'bagSlots', 'gemInventory', 'nextCardInstanceId', 'shopShelves',
      'eventBag', 'eventBagRefills', 'eventInstances', 'gold', 'heroLevel',
      'heroAllocation', 'wins', 'losses', 'stats',
    ], [
      'held', 'draft', 'eventThemeBags', 'eventThemeBagRefills', 'eventResolutions',
    ])
    || !isFiniteNumber(value.seed)
    || !isRunMap(value.map)
    || (value.status !== 'drafting' && value.status !== 'active' && value.status !== 'victory'
      && value.status !== 'defeat' && value.status !== 'retired')
    || !isFiniteNumber(value.depth)
    || !isFiniteNumber(value.lives)
    || !isFiniteNumber(value.bossesCleared)
    || (value.currentNodeId !== null && typeof value.currentNodeId !== 'string')
    || !Array.isArray(value.pieces)
    || !Array.isArray(value.bagSlots)
    || (value.held !== undefined && value.held !== null && !isRecord(value.held))
    || (value.draft !== undefined && !isDraft(value.draft))
    || !isStringArray(value.gemInventory)
    || !isFiniteNumber(value.nextCardInstanceId)
    || !isRecord(value.shopShelves)
    || !isStringArray(value.eventBag)
    || !isFiniteNumber(value.eventBagRefills)
    || (value.eventThemeBags !== undefined && !isStringArrayRecord(value.eventThemeBags))
    || (value.eventThemeBagRefills !== undefined && !isNumberRecord(value.eventThemeBagRefills))
    || !isRecord(value.eventInstances)
    || !Object.values(value.eventInstances).every((eventId) => typeof eventId === 'string')
    || (value.eventResolutions !== undefined && (!isRecord(value.eventResolutions)
      || !Object.values(value.eventResolutions).every(isV1EventResolution)))
    || !isFiniteNumber(value.gold)
    || !isFiniteNumber(value.heroLevel)
    || !isRecord(value.heroAllocation)
    || !isFiniteNumber(value.wins)
    || !isFiniteNumber(value.losses)
    || !isRunStats(value.stats)) return false;
  return true;
}

function isStoryStateV3(value: unknown): boolean {
  return isRecord(value)
    && hasExactKeys(value, [
      'oath_mercy', 'grave_path', 'honorable_choice', 'reliquary_oath',
      'oath_gate', 'venom_bloom', 'rival_spared', 'moon_quarry_released',
    ])
    && typeof value.oath_mercy === 'boolean'
    && (value.grave_path === 'none' || value.grave_path === 'opened' || value.grave_path === 'answered')
    && typeof value.honorable_choice === 'boolean'
    && typeof value.reliquary_oath === 'boolean'
    && (value.oath_gate === 'none' || value.oath_gate === 'sworn' || value.oath_gate === 'kept' || value.oath_gate === 'released')
    && (value.venom_bloom === 'none' || value.venom_bloom === 'cultivated')
    && typeof value.rival_spared === 'boolean'
    && typeof value.moon_quarry_released === 'boolean';
}

function isEventCardOffer(value: unknown): boolean {
  return isRecord(value)
    && hasExactKeys(value, ['skillId', 'tier'])
    && typeof value.skillId === 'string'
    && (value.tier === 'bronze' || value.tier === 'silver' || value.tier === 'gold' || value.tier === 'diamond');
}

function eventCardOffers(value: unknown, min: number, max: number): value is Array<{ skillId: string; tier: string }> {
  if (!Array.isArray(value) || value.length < min || value.length > max || !value.every(isEventCardOffer)) return false;
  const ids = value.map((entry) => (entry as { skillId: string }).skillId);
  return ids.every((id, index) => skillBook[id] !== undefined && ids.indexOf(id) === index);
}

function pendingOrSettled(
  value: Record<string, unknown>,
  required: readonly string[],
  selectionIds?: readonly string[],
): boolean {
  if (value.status === 'pending') return hasExactKeys(value, [...required, 'status']);
  if (value.status !== 'settled') return false;
  if (selectionIds === undefined) return hasExactKeys(value, [...required, 'status']);
  if (selectionIds.length === 0) return hasExactKeys(value, [...required, 'status']);
  return hasExactKeys(value, [...required, 'status', 'selectedId'])
    && typeof value.selectedId === 'string'
    && selectionIds.includes(value.selectedId);
}

function isDeferredOffer(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (value.kind === 'cardChoice') {
    if (!Array.isArray(value.options) || value.options.length !== 3 || !value.options.every(isEventCardOffer)) return false;
    const skillIds = value.options.map((option) => (option as { skillId: string }).skillId);
    if (skillIds.some((skillId, index) => (
      skillBook[skillId] === undefined || skillIds.indexOf(skillId) !== index
    ))) return false;
    return value.status === 'pending'
      ? hasExactKeys(value, ['kind', 'options', 'status'])
      : value.status === 'settled'
        && hasExactKeys(value, ['kind', 'options', 'status', 'selectedSkillId'])
        && typeof value.selectedSkillId === 'string'
        && skillIds.includes(value.selectedSkillId);
  }
  if (value.kind === 'grantCard') {
    return isEventCardOffer(value.card)
      && skillBook[(value.card as { skillId: string }).skillId] !== undefined
      && pendingOrSettled(value, ['kind', 'card']);
  }
  if (value.kind === 'grantGem') {
    return typeof value.gemId === 'string'
      && gemBook[value.gemId] !== undefined
      && pendingOrSettled(value, ['kind', 'gemId']);
  }
  if (value.kind === 'bonusDraft') {
    const options = value.options;
    if (!eventCardOffers(options, 5, 5)) return false;
    return pendingOrSettled(value, ['kind', 'options'], options.map((entry) => entry.skillId));
  }
  if (value.kind === 'gemChoice') {
    if (!isStringArray(value.optionGemIds) || value.optionGemIds.length !== 3) return false;
    const ids = value.optionGemIds;
    if (ids.some((id, index) => gemBook[id] === undefined || ids.indexOf(id) !== index)) return false;
    return pendingOrSettled(value, ['kind', 'optionGemIds'], ids);
  }
  if (value.kind === 'upgradeCard') {
    const optionInstanceIds = value.optionInstanceIds;
    if (!isStringArray(optionInstanceIds)
      || optionInstanceIds.some((id, index) => optionInstanceIds.indexOf(id) !== index)
      || !isRecord(value.fallback)
      || !hasExactKeys(value.fallback, ['kind', 'amount'])
      || value.fallback.kind !== 'grantGold'
      || !isPositiveInteger(value.fallback.amount)) return false;
    return pendingOrSettled(value, ['kind', 'optionInstanceIds', 'fallback'], optionInstanceIds);
  }
  if (value.kind === 'sellGem') {
    if (value.status === 'unavailable') return hasExactKeys(value, ['kind', 'status']);
    if (!Array.isArray(value.options) || value.options.length === 0) return false;
    const ids: string[] = [];
    const indexes: number[] = [];
    for (const option of value.options) {
      if (!isRecord(option) || !hasExactKeys(option, ['pouchIndex', 'gemId', 'price'])
        || !isNonNegativeInteger(option.pouchIndex)
        || typeof option.gemId !== 'string' || gemBook[option.gemId] === undefined
        || !isPositiveInteger(option.price)
        || indexes.includes(option.pouchIndex)) return false;
      indexes.push(option.pouchIndex);
      ids.push(String(option.pouchIndex));
    }
    return pendingOrSettled(value, ['kind', 'options'], ids);
  }
  if (value.kind === 'mergeCards') {
    if (value.status === 'unavailable') return hasExactKeys(value, ['kind', 'status']);
    if (!['bronze', 'silver', 'gold'].includes(String(value.from))
      || !['silver', 'gold', 'diamond'].includes(String(value.to))
      || ({ bronze: 'silver', silver: 'gold', gold: 'diamond' } as const)[value.from as 'bronze' | 'silver' | 'gold'] !== value.to
      || !Array.isArray(value.consumed) || value.consumed.length !== 3
      || !eventCardOffers(value.candidates, 1, 3)
      || value.candidates.some((candidate) => candidate.tier !== value.to)
      || !isRecord(value.fallback) || !hasExactKeys(value.fallback, ['kind', 'amount'])
      || value.fallback.kind !== 'grantGold' || !isPositiveInteger(value.fallback.amount)) return false;
    const consumedIds: string[] = [];
    const consumedLocations: string[] = [];
    for (const input of value.consumed) {
      if (!isRecord(input) || !hasExactKeys(input, ['instanceId', 'skillId', 'tier', 'location', 'index'])
        || typeof input.instanceId !== 'string' || consumedIds.includes(input.instanceId)
        || typeof input.skillId !== 'string' || skillBook[input.skillId] === undefined
        || input.tier !== value.from || (input.location !== 'board' && input.location !== 'bag')
        || !isNonNegativeInteger(input.index)) return false;
      const locationKey = `${input.location}:${String(input.index)}`;
      if (consumedLocations.includes(locationKey)) return false;
      consumedIds.push(input.instanceId);
      consumedLocations.push(locationKey);
    }
    return pendingOrSettled(value, ['kind', 'from', 'to', 'consumed', 'candidates', 'fallback'],
      value.candidates.map((entry) => entry.skillId));
  }
  if (value.kind !== 'upgradeCardTargeted'
    || !isStringArray(value.optionInstanceIds)
    || !isRecord(value.fallback)) return false;
  const targetedOptionIds = value.optionInstanceIds;
  if (targetedOptionIds.some((id, index) => targetedOptionIds.indexOf(id) !== index)) return false;
  const fallback = value.fallback.kind === 'nothing'
    ? hasExactKeys(value.fallback, ['kind'])
    : value.fallback.kind === 'grantGold'
      && hasExactKeys(value.fallback, ['kind', 'amount'])
      && isPositiveInteger(value.fallback.amount);
  if (!fallback) return false;
  return value.status === 'pending'
    ? hasExactKeys(value, ['kind', 'optionInstanceIds', 'fallback', 'status'])
    : value.status === 'settled'
      && hasExactKeys(value, ['kind', 'optionInstanceIds', 'fallback', 'status'], ['selectedInstanceId'])
      && (value.selectedInstanceId === undefined
        || (typeof value.selectedInstanceId === 'string' && targetedOptionIds.includes(value.selectedInstanceId)));
}

function isBoundSubjects(value: unknown): value is EventBoundSubjectsV3 {
  if (!isRecord(value)) return false;
  const allowed = new Set([
    'enemy_id', 'revenge_finisher_card_id', 'signature_card_id', 'mono_type', 'destination_biome',
  ]);
  if (Object.keys(value).some((key) => !allowed.has(key))) return false;
  for (const key of ['enemy_id', 'revenge_finisher_card_id', 'signature_card_id', 'destination_biome'] as const) {
    if (value[key] !== undefined && typeof value[key] !== 'string') return false;
  }
  const destinationBiome = value.destination_biome;
  if (destinationBiome !== undefined
    && (typeof destinationBiome !== 'string'
      || destinationBiome.length === 0
      || !biomeIds.includes(destinationBiome))) return false;
  if (value.mono_type !== undefined) {
    if (!isRecord(value.mono_type) || !hasExactKeys(value.mono_type, ['typeKind', 'type'])) return false;
    if (typeof value.mono_type.type !== 'string') return false;
    if (value.mono_type.typeKind === 'weapon') {
      if (!['sword', 'axe', 'lance', 'bow', 'beast'].includes(value.mono_type.type)) return false;
    } else if (value.mono_type.typeKind === 'element') {
      if (!['fire', 'frost', 'lightning', 'nature', 'holy', 'dark'].includes(value.mono_type.type)) return false;
    } else return false;
  }
  return true;
}

function hasExactV3TargetSubjects(target: LoadedEventDefV3, subjects: unknown): boolean {
  if (!isQueuedCallbackEventDefV3(target) || !isBoundSubjects(subjects)) return false;
  const requiredSlots = [...(target.acceptsBindings ?? [])].sort();
  const subjectSlots = Object.keys(subjects).sort();
  return requiredSlots.length === subjectSlots.length
    && requiredSlots.every((slot, index) => slot === subjectSlots[index]);
}

function isEventMaterialization(value: unknown): boolean {
  if (!isRecord(value)
    || !hasExactKeys(value, [
      'eventInstanceId', 'choiceIds', 'selectedWeightedBranchIds', 'boundSubjects',
      'deferredOffersByChoiceId', 'unavailableChoiceReasonsByChoiceId',
    ])
    || typeof value.eventInstanceId !== 'string'
    || !Array.isArray(value.choiceIds)
    || (value.choiceIds.length !== 2 && value.choiceIds.length !== 3)
    || value.choiceIds.some((choiceId, index) => (
      typeof choiceId !== 'string' || choiceId.length === 0
      || (value.choiceIds as unknown[]).indexOf(choiceId) !== index
    ))
    || !isStringRecord(value.selectedWeightedBranchIds)
    || !isRecord(value.unavailableChoiceReasonsByChoiceId)
    || Object.values(value.unavailableChoiceReasonsByChoiceId).some((reason) => (
      reason !== 'no_unvisited_biome'
    ))
    || !isBoundSubjects(value.boundSubjects)
    || !isRecord(value.deferredOffersByChoiceId)
    || !Object.values(value.deferredOffersByChoiceId).every(isDeferredOffer)) return false;
  const choiceIds = value.choiceIds as string[];
  return Object.keys(value.selectedWeightedBranchIds).every((choiceId) => choiceIds.includes(choiceId))
    && Object.keys(value.unavailableChoiceReasonsByChoiceId).every((choiceId) => choiceIds.includes(choiceId))
    && Object.keys(value.deferredOffersByChoiceId).every((choiceId) => choiceIds.includes(choiceId));
}

function isCombatFact(value: unknown): boolean {
  return isRecord(value)
    && hasExactKeys(value, [
      'battleId', 'nodeId', 'depth', 'biomeId', 'enemyIds', 'result', 'boss', 'turns',
      'usedCardIds', 'statusKinds', 'actionKinds',
    ], ['affinityId', 'finisherCardId'])
    && typeof value.battleId === 'string'
    && typeof value.nodeId === 'string'
    && isNonNegativeInteger(value.depth)
    && typeof value.biomeId === 'string'
    && isStringArray(value.enemyIds)
    && (value.result === 'win' || value.result === 'loss')
    && typeof value.boss === 'boolean'
    && isNonNegativeInteger(value.turns)
    && (value.affinityId === undefined || typeof value.affinityId === 'string')
    && isStringArray(value.usedCardIds)
    && Array.isArray(value.statusKinds)
    && value.statusKinds.every((kind) => kind === 'burn' || kind === 'poison')
    && isStringArray(value.actionKinds)
    && (value.finisherCardId === undefined || typeof value.finisherCardId === 'string');
}

function isRevengeFact(value: unknown): boolean {
  return isRecord(value)
    && hasExactKeys(value, ['battleId', 'enemyId', 'achievedDepth', 'status'], [
      'finisherCardId', 'reservedByInstanceId',
    ])
    && typeof value.battleId === 'string'
    && typeof value.enemyId === 'string'
    && (value.finisherCardId === undefined || typeof value.finisherCardId === 'string')
    && isNonNegativeInteger(value.achievedDepth)
    && (value.status === 'ready' || value.status === 'reserved' || value.status === 'consumed')
    && (value.reservedByInstanceId === undefined || typeof value.reservedByInstanceId === 'string');
}

function isSignatureFact(value: unknown): boolean {
  return isRecord(value)
    && hasExactKeys(value, ['battleId', 'cardId', 'achievedDepth', 'bossFinisher', 'status'], [
      'reservedByInstanceId',
    ])
    && typeof value.battleId === 'string'
    && typeof value.cardId === 'string'
    && isNonNegativeInteger(value.achievedDepth)
    && typeof value.bossFinisher === 'boolean'
    && (value.status === 'ready' || value.status === 'reserved' || value.status === 'consumed')
    && (value.reservedByInstanceId === undefined || typeof value.reservedByInstanceId === 'string');
}

function isJourneyFactLedger(value: unknown): boolean {
  return isRecord(value)
    && hasExactKeys(value, ['visitedBiomeIds'])
    && isStringArray(value.visitedBiomeIds);
}

function isEventBindingReservation(value: unknown): boolean {
  return isRecord(value)
    && hasExactKeys(value, ['reservationId', 'instanceId', 'source', 'sourceBattleId', 'subjectId'])
    && typeof value.reservationId === 'string'
    && typeof value.instanceId === 'string'
    && (value.source === 'revenge' || value.source === 'signature')
    && typeof value.sourceBattleId === 'string'
    && typeof value.subjectId === 'string';
}

function isV3EventTopology(candidate: Record<string, unknown>): boolean {
  const instances = candidate.eventInstances as Record<string, EventInstanceRecord>;
  const materializations = candidate.eventMaterializations as Record<string, EventMaterializationRecord>;
  const resolutions = (candidate.eventResolutions ?? {}) as Record<string, EventResolution>;
  for (const [instanceId, materialization] of Object.entries(materializations)) {
    const owners = Object.entries(instances).filter(([, instance]) => instance.instanceId === instanceId);
    if (owners.length !== 1 || materialization.eventInstanceId !== instanceId) return false;
    const [ownerNodeId, ownerInstance] = owners[0]!;
    const ownerDefinition = eventDefAtVersion(ownerInstance.eventId, ownerInstance.contentVersion);
    const reasonKeys = Object.keys(materialization.unavailableChoiceReasonsByChoiceId);
    if (ownerDefinition !== undefined && isEventDefV3(ownerDefinition)) {
      if (!hasExactUnavailableChoiceReasonsV3(ownerDefinition, materialization)) return false;
    } else if (reasonKeys.length > 0) {
      return false;
    }
    const resolution = resolutions[ownerNodeId];
    for (const [choiceId, offer] of Object.entries(materialization.deferredOffersByChoiceId)) {
      if (offer.status !== 'settled') continue;
      if (resolution === undefined
        || resolution.pending === true
        || resolution.eventId !== ownerInstance.eventId
        || resolution.contentVersion !== ownerInstance.contentVersion
        || resolution.instanceId !== instanceId
        || resolution.choiceId !== choiceId) return false;
    }
  }

  for (const [nodeId, resolution] of Object.entries(resolutions)) {
    const instance = instances[nodeId];
    const materialization = materializations[resolution.instanceId];
    const instanceMaterialization = instance === undefined
      ? undefined
      : materializations[instance.instanceId];
    const definition = eventDefAtVersion(resolution.eventId, resolution.contentVersion);
    const isV3Resolution = materialization !== undefined || instanceMaterialization !== undefined
      || (definition !== undefined && isEventDefV3(definition));
    if (!isV3Resolution) continue;
    if (instance === undefined
      || instance.eventId !== resolution.eventId
      || instance.contentVersion !== resolution.contentVersion
      || instance.instanceId !== resolution.instanceId
      || materialization === undefined
      || !materialization.choiceIds.includes(resolution.choiceId)) return false;
    const offer = materialization.deferredOffersByChoiceId[resolution.choiceId];
    if (resolution.pending === true) {
      if (offer?.status !== 'pending') return false;
    } else if (offer !== undefined && offer.status !== 'settled') {
      return false;
    }
  }
  return true;
}

function isRunStateV3(value: unknown): value is RunState {
  if (!isRunStateV2Shape(value, isEventInstance, isCurrentEventCallback)) return false;
  const candidate = value as unknown as Record<string, unknown>;
  const shapeValid = Array.isArray(candidate.combatFactLedger)
    && candidate.combatFactLedger.every(isCombatFact)
    && Array.isArray(candidate.revengeFactLedger)
    && candidate.revengeFactLedger.every(isRevengeFact)
    && Array.isArray(candidate.signatureFactLedger)
    && candidate.signatureFactLedger.every(isSignatureFact)
    && isJourneyFactLedger(candidate.journeyFactLedger)
    && Array.isArray(candidate.eventBindingReservations)
    && candidate.eventBindingReservations.every(isEventBindingReservation)
    && isRecord(candidate.eventMaterializations)
    && Object.entries(candidate.eventMaterializations).every(([instanceId, materialization]) => (
      isEventMaterialization(materialization)
      && (materialization as { eventInstanceId: string }).eventInstanceId === instanceId
    ))
    && isStoryStateV3(candidate.storyStateV3)
    && (candidate.missedEventOpportunities === undefined
      || (Array.isArray(candidate.missedEventOpportunities)
        && candidate.missedEventOpportunities.every(isMissedEventOpportunity)))
    && (candidate.eventComebackUsedIds === undefined || isStringArray(candidate.eventComebackUsedIds));
  return shapeValid && isV3EventTopology(candidate);
}

type ParsedEnvelope =
  | { kind: 'cleared' | 'invalid' | 'future' }
  | { kind: 'run'; schemaVersion: number; run: unknown };

function parseEnvelopeAtKey(
  storage: StorageDriver,
  raw: string,
  backupKey: string,
  acceptedVersions: readonly number[],
  newestVersionAtKey: number,
): ParsedEnvelope {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    storage.set(backupKey, raw);
    return { kind: 'invalid' };
  }
  if (parsed === null) return { kind: 'cleared' };
  if (!isRecord(parsed) || !isFiniteNumber(parsed.schemaVersion)) {
    storage.set(backupKey, raw);
    return { kind: 'invalid' };
  }
  if (parsed.schemaVersion > newestVersionAtKey) return { kind: 'future' };
  if (!acceptedVersions.includes(parsed.schemaVersion)
    || !isRecord(parsed.run)) {
    storage.set(backupKey, raw);
    return { kind: 'invalid' };
  }
  return { kind: 'run', schemaVersion: parsed.schemaVersion, run: parsed.run };
}

function writeMigratedRun(storage: StorageDriver, run: RunState): void {
  storage.set(RUN_SAVE_STORAGE_KEY, JSON.stringify({ schemaVersion: SCHEMA_VERSION, run }));
}

/** Task-6 development saves predate persisted per-choice unavailability.
 * Add the closed empty default without mutating parsed caller-owned bytes;
 * present (including malformed) values remain untouched for strict validation. */
function normalizeUnavailableChoiceReasons(value: unknown): unknown {
  if (!isRecord(value) || !isRecord(value.eventMaterializations)) return value;
  let changed = false;
  const eventMaterializations: Record<string, unknown> = {};
  for (const [instanceId, materialization] of Object.entries(value.eventMaterializations)) {
    if (isRecord(materialization)
      && !Object.hasOwn(materialization, 'unavailableChoiceReasonsByChoiceId')) {
      eventMaterializations[instanceId] = {
        ...materialization,
        unavailableChoiceReasonsByChoiceId: {},
      };
      changed = true;
    } else {
      eventMaterializations[instanceId] = materialization;
    }
  }
  return changed ? { ...value, eventMaterializations } : value;
}

function migrateHistoricalEnvelope(
  storage: StorageDriver,
  raw: string,
  backupKey: string,
): RunState | null {
  const loaded = parseEnvelopeAtKey(storage, raw, backupKey, [1, 2], 2);
  if (loaded.kind !== 'run') return null;
  let v2: RunStateV2;
  if (loaded.schemaVersion === 1) {
    if (!isMigrateableV1Run(loaded.run)) {
      storage.set(backupKey, raw);
      return null;
    }
    v2 = migrateV1RunToV2(loaded.run);
  } else {
    if (!isRunStateV2(loaded.run)) {
      storage.set(backupKey, raw);
      return null;
    }
    v2 = loaded.run;
  }
  const v3 = migrateV2Run(v2);
  // Fail closed: a v1/v2 resolution can name an (eventId, contentVersion)
  // that a LATER content change re-authored as a schema-3 event. Legacy
  // schemas never recorded a materialization for it (that concept didn't
  // exist yet), so `isRunStateV3`'s topology check — correctly — rejects
  // the migrated shape. Refusing HERE, on this first load, matches the
  // ordinary v3 load path's own rule below and is the only sound choice:
  // writing the unvalidated blob anyway would let this load resume once and
  // then make the save permanently unloadable, since every future load goes
  // through the strict v3 key first. See the module doc comment.
  if (!isRunStateV3(v3)) {
    storage.set(backupKey, raw);
    return null;
  }
  writeMigratedRun(storage, v3);
  return v3;
}

/** Strict precedence: presence of v3 blocks v2/v1; presence of v2 blocks v1. */
export function loadRun(storage: StorageDriver): RunState | null {
  const v3Raw = storage.get(RUN_SAVE_STORAGE_KEY);
  if (v3Raw !== null) {
    const loaded = parseEnvelopeAtKey(storage, v3Raw, RUN_SAVE_BACKUP_KEY, [3], 3);
    if (loaded.kind !== 'run') return null;
    const normalized = normalizeUnavailableChoiceReasons(loaded.run);
    if (!isRunStateV3(normalized)) {
      storage.set(RUN_SAVE_BACKUP_KEY, v3Raw);
      return null;
    }
    return normalized;
  }

  const v2Raw = storage.get(RUN_SAVE_V2_STORAGE_KEY);
  if (v2Raw !== null) return migrateHistoricalEnvelope(storage, v2Raw, RUN_SAVE_V2_BACKUP_KEY);

  const v1Raw = storage.get(RUN_SAVE_V1_STORAGE_KEY);
  if (v1Raw === null) return null;
  return migrateHistoricalEnvelope(storage, v1Raw, RUN_SAVE_V1_BACKUP_KEY);
}

function peekStoredSchemaVersion(storage: StorageDriver): number | null {
  const raw = storage.get(RUN_SAVE_STORAGE_KEY);
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return isRecord(parsed) && isFiniteNumber(parsed.schemaVersion) ? parsed.schemaVersion : null;
  } catch {
    return null;
  }
}

export function saveRun(storage: StorageDriver, run: RunState): RunSaveOutcome {
  const storedVersion = peekStoredSchemaVersion(storage);
  if (storedVersion !== null && storedVersion > SCHEMA_VERSION) {
    return { ok: false, reason: 'newer-version-on-disk' };
  }
  const envelope: RunSaveEnvelope = {
    schemaVersion: SCHEMA_VERSION,
    run: normalizeUnavailableChoiceReasons(run) as RunState,
  };
  return storage.set(RUN_SAVE_STORAGE_KEY, JSON.stringify(envelope))
    ? { ok: true }
    : { ok: false, reason: 'write-failed' };
}

export function clearRun(storage: StorageDriver): RunSaveOutcome {
  const storedVersion = peekStoredSchemaVersion(storage);
  if (storedVersion !== null && storedVersion > SCHEMA_VERSION) {
    return { ok: false, reason: 'newer-version-on-disk' };
  }
  return storage.set(RUN_SAVE_STORAGE_KEY, JSON.stringify(null))
    ? { ok: true }
    : { ok: false, reason: 'write-failed' };
}
