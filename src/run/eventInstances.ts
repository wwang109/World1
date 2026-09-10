import type { EventBoundSubjectsV3 } from '../data/eventContentV3';
import type { RunState } from './runState';

/** The immutable content identity committed when an event is drawn for a node. */
export interface EventInstanceRecordV2 {
  eventId: string;
  contentVersion: number;
  instanceId: string;
  drawnDepth: number;
  callbackInstanceId?: string;
}

/** Current event identity, optionally carrying its committed closed v3 subject snapshot. */
export interface EventInstanceRecord extends EventInstanceRecordV2 {
  boundSubjects?: Readonly<EventBoundSubjectsV3>;
}

function sameBoundSubjects(
  left: Readonly<EventBoundSubjectsV3> | undefined,
  right: Readonly<EventBoundSubjectsV3> | undefined,
): boolean {
  if (left === undefined || right === undefined) return left === right;
  const leftMono = left.mono_type;
  const rightMono = right.mono_type;
  return left.enemy_id === right.enemy_id
    && left.revenge_finisher_card_id === right.revenge_finisher_card_id
    && left.signature_card_id === right.signature_card_id
    && left.destination_biome === right.destination_biome
    && (leftMono === undefined || rightMono === undefined
      ? leftMono === rightMono
      : leftMono.typeKind === rightMono.typeKind && leftMono.type === rightMono.type);
}

/** Whether two records name precisely the same immutable event instance. */
export function sameEventInstance(left: EventInstanceRecord, right: EventInstanceRecord): boolean {
  return left.eventId === right.eventId
    && left.contentVersion === right.contentVersion
    && left.instanceId === right.instanceId
    && left.drawnDepth === right.drawnDepth
    && left.callbackInstanceId === right.callbackInstanceId
    && sameBoundSubjects(left.boundSubjects, right.boundSubjects);
}

/** Returns the versioned event instance committed for one node, if any. */
export function eventInstanceAt(state: RunState, nodeId: string): EventInstanceRecord | undefined {
  return state.eventInstances[nodeId];
}

/** Returns a committed event's catalog id without exposing record storage to callers. */
export function eventIdOfInstance(state: RunState, nodeId: string): string | undefined {
  return eventInstanceAt(state, nodeId)?.eventId;
}

/** Whether this run has already drawn a catalog event at any node. */
export function hasDrawnEvent(state: RunState, eventId: string): boolean {
  return Object.values(state.eventInstances).some((instance) => instance.eventId === eventId);
}

/** Records one node's already-selected immutable event instance. */
export function recordEventInstance(
  state: RunState,
  nodeId: string,
  instance: EventInstanceRecord,
): RunState {
  const existing = eventInstanceAt(state, nodeId);
  if (existing) {
    if (sameEventInstance(existing, instance)) return state;
    throw new Error(`recordEventInstance: immutable event instance already committed for node "${nodeId}"`);
  }
  return { ...state, eventInstances: { ...state.eventInstances, [nodeId]: instance } };
}
