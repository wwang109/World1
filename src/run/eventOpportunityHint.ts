import { isEventDefV2 } from '../data/eventContentV2';
import {
  isEventDefV3,
  type EventRequirementV3,
} from '../data/eventContentV3';
import type { EventGate, EventRequirement } from '../data/eventTypes';
import type { LoadedEventDef } from '../data/eventsContent';

export const EVENT_CONTINUATION_HINT = 'MAY CONTINUE THIS STORY';
export const EVENT_SPECIAL_UNLOCK_HINT = 'MAY UNLOCK A SPECIAL EVENT';

export type EventOpportunityHint =
  | typeof EVENT_CONTINUATION_HINT
  | typeof EVENT_SPECIAL_UNLOCK_HINT;

type EventGraph = Readonly<Record<string, LoadedEventDef>>;

function eventChoiceIds(event: LoadedEventDef): readonly string[] {
  return isEventDefV3(event)
    ? [...event.choiceSet.fixed, ...(event.choiceSet.pool?.entries ?? [])].map((choice) => choice.id)
    : event.choices.map((choice) => choice.id);
}

function gateReferencesChoice(gate: EventGate, eventId: string, choiceId: string): boolean {
  return gate.eventId === eventId
    && (gate.choiceIds === undefined || gate.choiceIds.includes(choiceId));
}

function legacyRequirementReferencesChoice(
  requirement: EventRequirement,
  eventId: string,
  choiceId: string,
): boolean {
  return requirement.kind === 'resolution'
    && requirement.eventId === eventId
    && (requirement.choiceIds === undefined || requirement.choiceIds.includes(choiceId));
}

function v3RequirementReferencesChoice(
  requirement: EventRequirementV3,
  eventId: string,
  choiceId: string,
  positive = true,
): boolean {
  if ('not' in requirement) {
    return v3RequirementReferencesChoice(requirement.not, eventId, choiceId, !positive);
  }
  if ('all' in requirement) {
    return requirement.all.some((part) => (
      v3RequirementReferencesChoice(part, eventId, choiceId, positive)
    ));
  }
  if ('any' in requirement) {
    return requirement.any.some((part) => (
      v3RequirementReferencesChoice(part, eventId, choiceId, positive)
    ));
  }
  return positive
    && requirement.fact === 'event.choice'
    && requirement.args.eventId === eventId
    && (requirement.args.choiceIds === undefined || requirement.args.choiceIds.includes(choiceId));
}

function eventDependsOnChoice(target: LoadedEventDef, eventId: string, choiceId: string): boolean {
  if (isEventDefV3(target)) {
    return v3RequirementReferencesChoice(target.eligibility, eventId, choiceId);
  }
  return (target.requires !== undefined && gateReferencesChoice(target.requires, eventId, choiceId))
    || target.requiresAll?.some((requirement) => (
      legacyRequirementReferencesChoice(requirement, eventId, choiceId)
    )) === true;
}

function sourceChoiceCallbackState(source: LoadedEventDef, choiceId: string): boolean | undefined {
  if (isEventDefV3(source)) {
    const choice = [...source.choiceSet.fixed, ...(source.choiceSet.pool?.entries ?? [])]
      .find((candidate) => candidate.id === choiceId);
    return choice === undefined ? undefined : choice.callback !== undefined;
  }
  if (isEventDefV2(source)) {
    const choice = source.choices.find((candidate) => candidate.id === choiceId);
    return choice === undefined ? undefined : choice.callback !== undefined;
  }
  return source.choices.some((candidate) => candidate.id === choiceId) ? false : undefined;
}

/**
 * Classify one authored choice from immutable event graph facts only. This is
 * intentionally independent of run state: it exposes possibility, never
 * eligibility, timing, probability, or a hidden destination's identity.
 */
export function eventChoiceOpportunityHint(
  source: LoadedEventDef,
  choiceId: string,
  graph: EventGraph,
): EventOpportunityHint | undefined {
  const hasCallback = sourceChoiceCallbackState(source, choiceId);
  if (hasCallback === undefined) return undefined;
  if (hasCallback) return EVENT_CONTINUATION_HINT;

  return Object.values(graph).some((target) => eventDependsOnChoice(target, source.id, choiceId))
    ? EVENT_SPECIAL_UNLOCK_HINT
    : undefined;
}

/** True when at least one authored branch can advance graph content. */
export function eventIsChainStarter(source: LoadedEventDef, graph: EventGraph): boolean {
  return eventChoiceIds(source).some((choiceId) => (
    eventChoiceOpportunityHint(source, choiceId, graph) !== undefined
  ));
}

/** True when graph metadata identifies this definition as a follow-up. */
export function eventIsChainDestination(target: LoadedEventDef, graph: EventGraph): boolean {
  if ((isEventDefV3(target) || isEventDefV2(target)) && target.delivery.kind !== 'ambient') return true;
  return Object.values(graph).some((source) => (
    eventChoiceIds(source).some((choiceId) => eventDependsOnChoice(target, source.id, choiceId))
  ));
}

/** Central special/chained classification shared by selection and rewards. */
export function eventIsChainParticipant(event: LoadedEventDef, graph: EventGraph): boolean {
  return eventIsChainStarter(event, graph) || eventIsChainDestination(event, graph);
}
