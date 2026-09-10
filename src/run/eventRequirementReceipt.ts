import { eventCatalog, type EventGate, type EventTallyGate } from '../data/events';
import { isEventDefV3 } from '../data/eventContentV3';
import type { LoadedEventDef } from '../data/eventsContent';
import { eventGateMet, eventRequirementsMet, eventTallyMet } from './events';
import type { RunState } from './runState';

function resolutionReceipt(state: RunState, gate: EventGate): string | undefined {
  // Legacy gates carry no content version, matching the existing recap's
  // compatibility-catalog lookup and authored choice ordering.
  const prior = eventCatalog[gate.eventId];
  if (!prior) return undefined;
  const completed = `Completed: ${prior.title}`;
  if (!gate.choiceIds) return completed;
  const choice = prior.choices.find((candidate) => (
    gate.choiceIds!.includes(candidate.id)
    && eventGateMet(state, { eventId: prior.id, choiceIds: [candidate.id] })
  ));
  if (!choice) return undefined;
  return `${completed} — ${choice.label.replace(/\s*\(\d+ gold\)$/, '')}`;
}

function tallyReceipt(state: RunState, gate: EventTallyGate): string {
  const value = gate.stat === 'wins' ? state.wins
    : gate.stat === 'losses' ? state.losses
    : gate.stat === 'bossesCleared' ? state.bossesCleared
    : state.stats[gate.stat];
  const plural = (one: string, many: string): string => value === 1 ? one : many;
  switch (gate.stat) {
    case 'goldSpent': return `Spent ${value} gold`;
    case 'cardsBought': return `Bought ${value} ${plural('card', 'cards')}`;
    case 'gemsBought': return `Bought ${value} ${plural('gem', 'gems')}`;
    case 'livesLost': return `Lost ${value} ${plural('life', 'lives')}`;
    case 'wins': return `Won ${value} ${plural('fight', 'fights')}`;
    case 'losses': return `Suffered ${value} ${plural('defeat', 'defeats')}`;
    case 'bossesCleared': return `Defeated ${value} ${plural('boss', 'bosses')}`;
  }
}

/** Earned facts for legacy gates, using the same eligibility authorities as
 * event selection. V3's eligibility AST has no receipt vocabulary here yet. */
export function eventRequirementReceipt(state: RunState, event: LoadedEventDef): readonly string[] {
  if (isEventDefV3(event)) return [];
  if (event.requires && !eventGateMet(state, event.requires)) return [];
  if (event.requiresTally && !eventTallyMet(state, event.requiresTally)) return [];
  if (!eventRequirementsMet(state, event.requiresAll)) return [];

  const lines: string[] = [];
  const appendResolution = (gate: EventGate): void => {
    const line = resolutionReceipt(state, gate);
    if (line !== undefined) lines.push(line);
  };
  if (event.requires) appendResolution(event.requires);
  if (event.requiresTally) lines.push(tallyReceipt(state, event.requiresTally));
  for (const requirement of event.requiresAll ?? []) {
    if (requirement.kind === 'resolution') appendResolution(requirement);
    else lines.push(tallyReceipt(state, requirement));
  }
  return lines;
}
