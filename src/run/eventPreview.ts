import type { LoadedEventDef } from '../data/eventsContent';
import { rollEventForNode } from './events';
import type { RunNode, RunState } from './runState';

/** Preview the deterministic selection without committing its returned run state. */
export function previewEventForNode(state: RunState, node: RunNode): LoadedEventDef | null {
  if (node.kind !== 'event') return null;
  return rollEventForNode(state, node).event;
}
