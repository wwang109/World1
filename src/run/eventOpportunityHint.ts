import { isEventDefV2 } from '../data/eventContentV2';
import {
  isEventDefV3,
  type EventRequirementV3,
} from '../data/eventContentV3';
import { eventRuntimeCatalog } from '../data/events';
import type { EventGate, EventRequirement } from '../data/eventTypes';
import type { LoadedEventDef } from '../data/eventsContent';
import { hashSeed } from '../engine/rng';
import type { RunNode } from './runMap';

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

// ---------------------------------------------------------------------------
// Rarity lottery — lives here (not events.ts) because it consumes
// `eventIsChainStarter` above, and `eventEligibility.ts` needs to call it
// without importing `events.ts` (which itself imports `eventEligibility.ts`'s
// `eventRequirementMet` — a two-file cycle that used to resolve only by
// accident, both sides being hoisted `function` declarations with no
// cross-seam top-level call). This module already has zero run-layer
// imports, which is what makes it a safe cycle-free host for both.

/** Fixed resolution the rarity lottery rolls against — high enough that the
 * chain-starter bonus below has room to move the needle without ever being
 * able to reach the ceiling (see `RARITY_LOTTERY_BASE_TICKETS`). */
const RARITY_LOTTERY_DENOMINATOR = 8;

/** Base out-of-`RARITY_LOTTERY_DENOMINATOR` winning tickets per rollable
 * rarity. `common`/`secret` never consult this table (no lottery at all).
 * `rare` is intentionally half of `uncommon` so the two rarities stay
 * strictly ordered at every boost level (see the invariant test in
 * `tests/run/events.test.ts`). */
const RARITY_LOTTERY_BASE_TICKETS: Readonly<Record<'uncommon' | 'rare', number>> = {
  uncommon: 4, // 4/8 = 50%
  rare: 2, // 2/8 = 25%
};

/** Flat ticket bump a chain-starter earns on top of its rarity's base — an
 * ADDITIVE bonus, not a multiplier, specifically so it can never scale a base
 * count up to (or past) the denominator no matter how the base table above is
 * retuned later. Combined with the two-sided clamp below, this is what makes
 * "some rarity/boost combination reaches 100% (or 0%)" structurally
 * impossible rather than merely untrue for today's numbers: even if a future
 * rarity shipped with a base of, say, 20 tickets, the ceiling clamp still
 * leaves at least one losing ticket; even if a future base shipped as 0 (or a
 * negative bonus made the total go negative), the floor clamp still leaves at
 * least one winning ticket. */
const RARITY_LOTTERY_CHAIN_STARTER_BONUS_TICKETS = 2;

/** Isolated appearance roll for conditional events. Common and secret content
 * has no lottery; uncommon/rare use a dedicated hash domain and consume no
 * `Rng`, bag counter, or mutable state.
 *
 * Chain-starters (an authored branch that can advance graph content) get a
 * flat ticket bump, making them strictly MORE likely to appear than a
 * same-rarity non-starter — but `winningTickets` is clamped on BOTH sides:
 * to at most `RARITY_LOTTERY_DENOMINATOR - 1`, one short of the full
 * resolution, so no rarity/boost combination — present or future — can ever
 * reach a 100% pass rate (the prior bug clamped only the ceiling, which for
 * uncommon(2) + starter-multiplier(2) collapsed to "2 tickets out of 2" —
 * always true); and to at least 1, so a future base-ticket entry of 0 (or a
 * negative bonus) can never make an event permanently unreachable at every
 * seed instead. */
export function eventRarityEligible(
  event: LoadedEventDef,
  node: RunNode,
  graph: Readonly<Record<string, LoadedEventDef>> = eventRuntimeCatalog,
): boolean {
  const rarity = event.rarity ?? 'common';
  if (rarity === 'common' || rarity === 'secret') return true;
  const baseTickets = RARITY_LOTTERY_BASE_TICKETS[rarity];
  const tickets = baseTickets + (
    eventIsChainStarter(event, graph) ? RARITY_LOTTERY_CHAIN_STARTER_BONUS_TICKETS : 0
  );
  const winningTickets = Math.max(1, Math.min(RARITY_LOTTERY_DENOMINATOR - 1, tickets));
  return hashSeed('eventRarity', node.eventSeed ?? 0, event.id) % RARITY_LOTTERY_DENOMINATOR < winningTickets;
}
