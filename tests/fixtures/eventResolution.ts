import { eventCatalog, type EventDef } from '../../src/data/events';
import { eventInstanceAt, recordEventInstance } from '../../src/run/eventInstances';
import { resolveEventChoice } from '../../src/run/events';
import { currentEventNode, type RunState } from '../../src/run/runState';

/** Resolve a named catalog choice only after committing its exact immutable
 * event/version record, matching the precondition established by a real draw. */
export function resolveExactEventChoice(state: RunState, eventId: string, choiceId: string) {
  const node = currentEventNode(state);
  if (!node) throw new Error('direct resolver fixture requires a current event node');
  const contentVersion = 1;
  const frozenLookup = (id: string, version: number): EventDef | undefined => (
    version === 1 ? eventCatalog[id] : undefined
  );
  if (frozenLookup(eventId, contentVersion) === undefined) throw new Error(`unknown event "${eventId}"`);
  const existing = eventInstanceAt(state, node.id);
  if (existing && (existing.eventId !== eventId || existing.contentVersion !== contentVersion)) {
    throw new Error(`direct resolver fixture cannot rebind committed event node "${node.id}"`);
  }
  const committed = existing
    ? state
    : recordEventInstance(state, node.id, {
      eventId,
      contentVersion,
      instanceId: `event:${node.id}`,
      drawnDepth: node.depth,
    });
  return resolveEventChoice(committed, eventId, choiceId, frozenLookup);
}
