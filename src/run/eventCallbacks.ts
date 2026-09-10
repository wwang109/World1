import { biomeFor } from './biome';
import type { EventCallbackSpec, EventDefV2 } from '../data/eventContentV2';
import { isEventDefV2 } from '../data/eventContentV2';
import {
  isEventDefV3,
  isQueuedCallbackEventDefV3,
  type EventBindingSlotV3,
  type EventBoundSubjectsV3,
  type EventCallbackSpecV3,
  type LoadedEventDefV3,
} from '../data/eventContentV3';
import type { EventDef } from '../data/eventTypes';
import { biomeIds } from '../data/biomes';
import { eventDefAtVersion } from '../data/eventsContent';
import { hashSeed } from '../engine/rng';
import { eventRequirementMet } from './eventEligibility';
import { eventRequirementMetV3 } from './eventEligibilityV3';
import {
  eventInstanceAt,
  recordEventInstance,
  sameEventInstance,
  type EventInstanceRecord,
} from './eventInstances';
import type {
  EventCallbackQueueEntry,
  EventCallbackQueueEntryV2,
  EventCallbackQueueEntryV3,
  RunNode,
  RunState,
} from './runState';

/** The immutable source facts a choice contributes to its callback identity. */
export interface EventCallbackSource {
  eventInstanceId: string;
  choiceId: string;
  nodeDepth: number;
  ordinal: number;
}

/** Injection seam for focused callback tests; production always uses the
 * versioned content loader below. */
export type EventDefinitionLookup<TEvent extends EventDef | LoadedEventDefV3 = EventDef> = (
  eventId: string,
  contentVersion: number,
) => TEvent | undefined;

function callbackInstanceId(state: RunState, spec: EventCallbackSpec, source: EventCallbackSource): string {
  return `callback:${hashSeed(
    'eventCallback', state.map.seed, source.eventInstanceId, source.choiceId, spec.callbackId, source.ordinal,
  )}`;
}

function copiedExpiry(spec: EventCallbackSpec): EventCallbackQueueEntryV2['expiry'] {
  return {
    expiresAfterNodes: spec.expiry.expiresAfterNodes,
    fallback: spec.expiry.fallback === 'discard'
      ? 'discard'
      : { outcome: { ...spec.expiry.fallback.outcome } },
  };
}

/** Enqueue a choice callback exactly once for its stable source identity. */
export function scheduleEventCallback(
  state: RunState,
  spec: EventCallbackSpec,
  source: EventCallbackSource,
): RunState {
  const instanceId = callbackInstanceId(state, spec, source);
  if (state.eventCallbackQueue.some((entry) => entry.callbackInstanceId === instanceId)) return state;

  const entry: EventCallbackQueueEntryV2 = {
    callbackInstanceId: instanceId,
    callbackId: spec.callbackId,
    eventId: spec.eventId,
    contentVersion: spec.contentVersion,
    scheduledDepth: source.nodeDepth,
    earliestDepth: source.nodeDepth + spec.minDepthDelay,
    minDepthDelay: spec.minDepthDelay,
    destinationThemes: [...spec.destinationThemes],
    ...(spec.destinationBiomeIds === undefined ? {} : { destinationBiomeIds: [...spec.destinationBiomeIds] }),
    priority: spec.priority,
    boundSubjects: {},
    expiry: copiedExpiry(spec),
  };
  return { ...state, eventCallbackQueue: [...state.eventCallbackQueue, entry] };
}

export type ScheduleEventCallbackV3Result =
  | { ok: true; state: RunState; entry: EventCallbackQueueEntryV3 }
  | {
    ok: false;
    state: RunState;
    reason: 'missing-subject' | 'invalid-target' | 'identity-conflict';
  };

const WEAPON_TYPES = ['sword', 'axe', 'lance', 'bow', 'beast'] as const;
const ELEMENT_TYPES = ['fire', 'frost', 'lightning', 'nature', 'holy', 'dark'] as const;
type MutableBoundSubjectsV3 = {
  -readonly [TKey in keyof EventBoundSubjectsV3]: EventBoundSubjectsV3[TKey];
};

function copiedBoundSubject(
  slot: EventBindingSlotV3,
  subjects: Readonly<EventBoundSubjectsV3>,
): EventBoundSubjectsV3[EventBindingSlotV3] | undefined {
  const value = subjects[slot];
  if (slot === 'destination_biome') {
    return typeof value === 'string' && value.length > 0 && biomeIds.includes(value)
      ? value
      : undefined;
  }
  if (slot !== 'mono_type') return typeof value === 'string' ? value : undefined;
  if (value === undefined || typeof value === 'string') return undefined;
  const keys = Object.keys(value).sort();
  if (!sameStrings(keys, ['type', 'typeKind'])) return undefined;
  if (value.typeKind === 'weapon' && WEAPON_TYPES.includes(value.type)) {
    return { typeKind: value.typeKind, type: value.type };
  }
  if (value.typeKind === 'element' && ELEMENT_TYPES.includes(value.type)) {
    return { typeKind: value.typeKind, type: value.type };
  }
  return undefined;
}

function sameStrings(left: readonly string[] | undefined, right: readonly string[] | undefined): boolean {
  if (left === undefined || right === undefined) return left === right;
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function sameStringSet(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const sortedLeft = [...left].sort();
  const sortedRight = [...right].sort();
  return sortedLeft.every((value, index) => value === sortedRight[index]);
}

function sameCallbackSubjects(
  left: EventCallbackQueueEntry['boundSubjects'],
  right: EventCallbackQueueEntryV3['boundSubjects'],
): boolean {
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  if (!sameStrings(leftKeys, rightKeys)) return false;
  for (const key of rightKeys as EventBindingSlotV3[]) {
    const leftValue = left[key as keyof typeof left];
    const rightValue = right[key];
    if (key === 'mono_type') {
      if (typeof leftValue !== 'object' || leftValue === null || rightValue === undefined
        || typeof rightValue === 'string') return false;
      const leftMono = leftValue as { typeKind?: unknown; type?: unknown };
      if (!sameStrings(Object.keys(leftMono).sort(), ['type', 'typeKind'])
        || leftMono.typeKind !== rightValue.typeKind
        || leftMono.type !== rightValue.type) return false;
    } else if (leftValue !== rightValue) return false;
  }
  return true;
}

function sameCallbackEntry(left: EventCallbackQueueEntry, right: EventCallbackQueueEntryV3): boolean {
  const leftFallback = left.expiry?.fallback;
  const rightFallback = right.expiry?.fallback;
  const sameFallback = leftFallback === 'discard' || rightFallback === 'discard'
    ? leftFallback === rightFallback
    : leftFallback === undefined || rightFallback === undefined
      ? leftFallback === rightFallback
      : leftFallback.outcome.kind === rightFallback.outcome.kind
        && leftFallback.outcome.amount === rightFallback.outcome.amount;
  return left.callbackInstanceId === right.callbackInstanceId
    && left.callbackId === right.callbackId
    && left.eventId === right.eventId
    && left.contentVersion === right.contentVersion
    && left.scheduledDepth === right.scheduledDepth
    && left.earliestDepth === right.earliestDepth
    && left.minDepthDelay === right.minDepthDelay
    && sameStrings(left.destinationThemes, right.destinationThemes)
    && sameStrings(left.destinationBiomeIds, right.destinationBiomeIds)
    && left.priority === right.priority
    && sameCallbackSubjects(left.boundSubjects, right.boundSubjects)
    && left.expiry?.expiresAfterNodes === right.expiry?.expiresAfterNodes
    && sameFallback;
}

function callbackResolutionIdForInstance(callbackInstanceId: string): string {
  return `callback-resolution:${callbackInstanceId}`;
}

function callbackIdentityIsTerminal(state: RunState, callbackInstanceId: string): boolean {
  return (state.eventCallbackResolutionIds ?? []).includes(callbackResolutionIdForInstance(callbackInstanceId));
}

function callbackIdentityIsCommitted(state: RunState, callbackInstanceId: string): boolean {
  return Object.values(state.eventInstances).some((instance) => (
    instance.callbackInstanceId === callbackInstanceId
  ));
}

/** Schedule a schema-v3 callback from subjects already bound to its source
 * event. This path never selects or reserves a source fact. */
export function scheduleEventCallbackV3(
  state: RunState,
  spec: EventCallbackSpecV3,
  source: EventCallbackSource,
  boundSubjects: Readonly<EventBoundSubjectsV3>,
  lookup: EventDefinitionLookup<EventDef | LoadedEventDefV3> = eventDefAtVersion,
): ScheduleEventCallbackV3Result {
  const instanceId = `callback:${hashSeed(
    state.map.seed,
    'event-callback-v3',
    source.eventInstanceId,
    source.choiceId,
    spec.callbackId,
    source.ordinal,
  )}`;
  const existing = state.eventCallbackQueue.filter((candidate) => (
    candidate.callbackInstanceId === instanceId
  ));
  if (existing.length > 1
    || callbackIdentityIsTerminal(state, instanceId)
    || callbackIdentityIsCommitted(state, instanceId)) {
    return { ok: false, state, reason: 'identity-conflict' };
  }

  const target = lookup(spec.eventId, spec.contentVersion);
  if (target === undefined
    || target.id !== spec.eventId
    || !isEventDefV3(target)
    || !isQueuedCallbackEventDefV3(target)
    || !sameStringSet(
      spec.bind.map((binding) => binding.as),
      [...(target.acceptsBindings ?? [])],
    )) {
    return { ok: false, state, reason: 'invalid-target' };
  }
  if (spec.destinationBiomeIds !== undefined && (
    spec.destinationBiomeIds.length === 0
    || spec.destinationBiomeIds.some((biomeId) => !biomeIds.includes(biomeId))
  )) {
    return { ok: false, state, reason: 'invalid-target' };
  }

  const copiedSubjects: MutableBoundSubjectsV3 = {};
  for (const binding of spec.bind) {
    const value = copiedBoundSubject(binding.as, boundSubjects);
    if (value === undefined) return { ok: false, state, reason: 'missing-subject' };
    if (binding.as === 'mono_type') copiedSubjects.mono_type = value as NonNullable<EventBoundSubjectsV3['mono_type']>;
    else copiedSubjects[binding.as] = value as string;
  }

  const destinationBiome = copiedSubjects.destination_biome;
  const entry: EventCallbackQueueEntryV3 = {
    callbackInstanceId: instanceId,
    callbackId: spec.callbackId,
    eventId: spec.eventId,
    contentVersion: spec.contentVersion,
    scheduledDepth: source.nodeDepth,
    earliestDepth: source.nodeDepth + spec.minDepthDelay,
    minDepthDelay: spec.minDepthDelay,
    destinationThemes: [...spec.destinationThemes],
    ...(destinationBiome !== undefined
      ? { destinationBiomeIds: [destinationBiome] }
      : spec.destinationBiomeIds === undefined
        ? {}
        : { destinationBiomeIds: [...spec.destinationBiomeIds] }),
    priority: spec.priority,
    boundSubjects: copiedSubjects,
    expiry: {
      expiresAfterNodes: spec.expiry.expiresAfterNodes,
      fallback: spec.expiry.fallback === 'discard'
        ? 'discard'
        : { outcome: { ...spec.expiry.fallback.outcome } },
    },
  };
  if (existing.length === 1) {
    return sameCallbackEntry(existing[0]!, entry)
      ? { ok: true, state, entry: existing[0] as EventCallbackQueueEntryV3 }
      : { ok: false, state, reason: 'identity-conflict' };
  }
  return {
    ok: true,
    state: { ...state, eventCallbackQueue: [...state.eventCallbackQueue, entry] },
    entry,
  };
}

function callbackFitsNode(
  state: RunState,
  entry: EventCallbackQueueEntry,
  node: RunNode,
): boolean {
  if (node.kind !== 'event' || node.depth < entry.earliestDepth) return false;
  if (node.eventTheme === undefined || !entry.destinationThemes.includes(node.eventTheme)) return false;
  const biomeId = biomeFor(state.map.seed, node.wave, node.biomeId).id;
  return entry.destinationBiomeIds === undefined
    || entry.destinationBiomeIds.includes(biomeId);
}

function compareDueCallbacks(left: EventCallbackQueueEntry, right: EventCallbackQueueEntry): number {
  if (left.priority !== right.priority) return right.priority - left.priority;
  if (left.scheduledDepth !== right.scheduledDepth) return left.scheduledDepth - right.scheduledDepth;
  return left.callbackInstanceId < right.callbackInstanceId ? -1 : left.callbackInstanceId > right.callbackInstanceId ? 1 : 0;
}

/** All compatible, due callbacks in deterministic delivery precedence order. */
export function dueEventCallbacks(
  state: RunState,
  node: RunNode,
  lookup: EventDefinitionLookup<EventDef | LoadedEventDefV3> = eventDefAtVersion,
): readonly EventCallbackQueueEntry[] {
  return state.eventCallbackQueue.filter((entry) => {
    // Keep the supplied exact-version lookup on the due-classification seam;
    // delivery performs the second lookup and decides whether to consume it.
    lookup(entry.eventId, entry.contentVersion);
    return callbackFitsNode(state, entry, node);
  }).sort(compareDueCallbacks);
}

/** The first compatible due callback, if one exists. */
export function dueEventCallback(
  state: RunState,
  node: RunNode,
  lookup: EventDefinitionLookup<EventDef | LoadedEventDefV3> = eventDefAtVersion,
): EventCallbackQueueEntry | undefined {
  return dueEventCallbacks(state, node, lookup)[0];
}

function lastDrawnDepth(state: RunState, eventId: string): number | undefined {
  let mostRecent: number | undefined;
  for (const instance of Object.values(state.eventInstances)) {
    if (instance.eventId !== eventId) continue;
    if (mostRecent === undefined || instance.drawnDepth > mostRecent) mostRecent = instance.drawnDepth;
  }
  return mostRecent;
}

/** Delivery rechecks mutable safe-delivery constraints but deliberately skips
 * rarity: a due callback has already earned its priority and is never rolled
 * through rarity again. */
function queuedEventDeliverable(state: RunState, node: RunNode, event: EventDefV2): boolean {
  const biome = biomeFor(state.map.seed, node.wave, node.biomeId);
  if (event.biomeIds !== undefined && !event.biomeIds.includes(biome.id)) return false;

  const previousDepth = lastDrawnDepth(state, event.id);
  if (event.once === 'run' && previousDepth !== undefined) return false;
  if (event.once === 'node' && state.eventInstances[node.id]?.eventId === event.id) return false;
  if (event.cooldownNodes > 0 && previousDepth !== undefined && node.depth <= previousDepth + event.cooldownNodes) return false;

  return eventRequirementMet({ state, node, event }, event.eligibility);
}

function queuedEventDeliverableV3(state: RunState, node: RunNode, event: LoadedEventDefV3): boolean {
  const biome = biomeFor(state.map.seed, node.wave, node.biomeId);
  if (event.biomeIds !== undefined && !event.biomeIds.includes(biome.id)) return false;

  const previousDepth = lastDrawnDepth(state, event.id);
  if (event.once === 'run' && previousDepth !== undefined) return false;
  if (event.once === 'node' && state.eventInstances[node.id]?.eventId === event.id) return false;
  if (event.cooldownNodes > 0 && previousDepth !== undefined && node.depth <= previousDepth + event.cooldownNodes) return false;

  return eventRequirementMetV3({ state, node }, event.eligibility);
}

function isClosedV3Subjects(subjects: EventCallbackQueueEntry['boundSubjects']): subjects is EventBoundSubjectsV3 {
  const keys = Object.keys(subjects);
  const accepted: readonly EventBindingSlotV3[] = [
    'enemy_id', 'revenge_finisher_card_id', 'signature_card_id', 'mono_type', 'destination_biome',
  ];
  if (keys.some((key) => !accepted.includes(key as EventBindingSlotV3))) return false;
  for (const key of keys as EventBindingSlotV3[]) {
    if (copiedBoundSubject(key, subjects as EventBoundSubjectsV3) === undefined) return false;
  }
  return true;
}

function targetAcceptsSubjects(
  event: LoadedEventDefV3,
  entry: Pick<EventCallbackQueueEntry, 'boundSubjects' | 'destinationBiomeIds'>,
): boolean {
  if (!isQueuedCallbackEventDefV3(event)) return false;
  const subjectKeys = Object.keys(entry.boundSubjects);
  if (!sameStringSet(subjectKeys, [...(event.acceptsBindings ?? [])])) return false;
  const destinationBiome = (entry.boundSubjects as EventBoundSubjectsV3).destination_biome;
  return destinationBiome === undefined
    || sameStrings(entry.destinationBiomeIds, [destinationBiome]);
}

function callbackDeliveryInstance(
  node: RunNode,
  entry: EventCallbackQueueEntry,
  boundSubjects?: Readonly<EventBoundSubjectsV3>,
): EventInstanceRecord {
  return {
    eventId: entry.eventId,
    contentVersion: entry.contentVersion,
    instanceId: `event:${node.id}`,
    drawnDepth: node.depth,
    callbackInstanceId: entry.callbackInstanceId,
    ...(boundSubjects === undefined ? {} : { boundSubjects }),
  };
}

function stateAfterCallbackTerminal(
  state: RunState,
  callbackInstanceId: string,
  queue: readonly EventCallbackQueueEntry[],
): RunState {
  const terminalId = callbackResolutionIdForInstance(callbackInstanceId);
  const resolutionIds = state.eventCallbackResolutionIds ?? [];
  return {
    ...state,
    eventCallbackQueue: queue,
    ...(resolutionIds.includes(terminalId)
      ? {}
      : { eventCallbackResolutionIds: [...resolutionIds, terminalId] }),
  };
}

/** Atomically deliver one queued callback. A missing or incompatible exact
 * version returns undefined without touching the queue or node memo. */
export function deliverEventCallback(
  state: RunState,
  node: RunNode,
  entry: EventCallbackQueueEntry,
  lookup?: EventDefinitionLookup<EventDef>,
): { state: RunState; event: EventDefV2 } | undefined;
export function deliverEventCallback(
  state: RunState,
  node: RunNode,
  entry: EventCallbackQueueEntry,
  lookup: EventDefinitionLookup<LoadedEventDefV3>,
): { state: RunState; event: LoadedEventDefV3 } | undefined;
export function deliverEventCallback(
  state: RunState,
  node: RunNode,
  entry: EventCallbackQueueEntry,
  lookup: EventDefinitionLookup<EventDef | LoadedEventDefV3>,
): { state: RunState; event: EventDefV2 | LoadedEventDefV3 } | undefined;
export function deliverEventCallback(
  state: RunState,
  node: RunNode,
  entry: EventCallbackQueueEntry,
  lookup: EventDefinitionLookup<EventDef | LoadedEventDefV3> = eventDefAtVersion,
): { state: RunState; event: EventDefV2 | LoadedEventDefV3 } | undefined {
  const persistedEntries = state.eventCallbackQueue.filter((candidate) => (
    candidate.callbackInstanceId === entry.callbackInstanceId
  ));
  if (persistedEntries.length !== 1
    || callbackIdentityIsTerminal(state, entry.callbackInstanceId)
    || callbackIdentityIsCommitted(state, entry.callbackInstanceId)) return undefined;
  const persistedEntry = persistedEntries[0]!;

  const definition = lookup(persistedEntry.eventId, persistedEntry.contentVersion);
  if (!definition || definition.id !== persistedEntry.eventId) return undefined;

  let boundSubjects: Readonly<EventBoundSubjectsV3> | undefined;
  if (isEventDefV3(definition)) {
    if (!callbackFitsNode(state, persistedEntry, node)
      || definition.delivery.kind !== 'queued_callback'
      || !isClosedV3Subjects(persistedEntry.boundSubjects)
      || !targetAcceptsSubjects(definition, persistedEntry)
      || !queuedEventDeliverableV3(state, node, definition)) return undefined;
    boundSubjects = persistedEntry.boundSubjects;
  } else {
    if (!callbackFitsNode(state, persistedEntry, node)
      || !isEventDefV2(definition)
      || definition.delivery.kind !== 'queued_callback'
      || !queuedEventDeliverable(state, node, definition)) return undefined;
  }

  const withInstance = recordEventInstance(
    state,
    node.id,
    callbackDeliveryInstance(node, persistedEntry, boundSubjects),
  );
  const queue = withInstance.eventCallbackQueue.filter((candidate) => (
    candidate.callbackInstanceId !== persistedEntry.callbackInstanceId
  ));
  return {
    state: stateAfterCallbackTerminal(withInstance, persistedEntry.callbackInstanceId, queue),
    event: definition,
  };
}

/** Heal the only interrupted-delivery shape that can safely be inferred: an
 * already memoized callback instance whose exact queue entry remains. */
export function repairDeliveredCallback(state: RunState, nodeOrInstance: RunNode | EventInstanceRecord): RunState {
  const instance = 'eventId' in nodeOrInstance
    ? Object.values(state.eventInstances).find((candidate) => sameEventInstance(candidate, nodeOrInstance))
    : eventInstanceAt(state, nodeOrInstance.id);
  const callbackId = instance?.callbackInstanceId;
  if (callbackId === undefined) return state;
  const queue = state.eventCallbackQueue.filter((entry) => entry.callbackInstanceId !== callbackId);
  const terminalId = callbackResolutionIdForInstance(callbackId);
  if (queue.length === state.eventCallbackQueue.length
    && (state.eventCallbackResolutionIds ?? []).includes(terminalId)) return state;
  return stateAfterCallbackTerminal(state, callbackId, queue);
}

function callbackResolutionId(entry: EventCallbackQueueEntry): string {
  return callbackResolutionIdForInstance(entry.callbackInstanceId);
}

/** Sweep callbacks only after a completed node. The expiry boundary remains
 * deliverable; grant fallbacks are immediate, typed, noninteractive, and
 * recorded exactly once. */
export function sweepExpiredEventCallbacks(state: RunState, completedDepth: number): RunState {
  const expired = state.eventCallbackQueue.filter((entry) => (
    entry.expiry !== undefined && completedDepth > entry.scheduledDepth + entry.expiry.expiresAfterNodes
  ));
  if (expired.length === 0) return state;

  let gold = state.gold;
  let goldEarned = state.stats.goldEarned;
  const resolutionIds = [...(state.eventCallbackResolutionIds ?? [])];
  const resolved = new Set(resolutionIds);
  for (const entry of expired) {
    const resolutionId = callbackResolutionId(entry);
    if (resolved.has(resolutionId)) continue;
    resolved.add(resolutionId);
    resolutionIds.push(resolutionId);
    const fallback = entry.expiry?.fallback;
    if (fallback !== 'discard' && fallback !== undefined) {
      gold += fallback.outcome.amount;
      goldEarned += fallback.outcome.amount;
    }
  }

  const expiredIds = new Set(expired.map((entry) => entry.callbackInstanceId));
  return {
    ...state,
    eventCallbackQueue: state.eventCallbackQueue.filter((entry) => !expiredIds.has(entry.callbackInstanceId)),
    eventCallbackResolutionIds: resolutionIds,
    ...(gold === state.gold ? {} : { gold, stats: { ...state.stats, goldEarned } }),
  };
}
