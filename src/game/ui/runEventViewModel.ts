import { isEventDefV2 } from '../../data/eventContentV2';
import {
  isEventDefV3,
  type EventChoiceV3,
  type EventDirectOutcomeSpecV3,
  type LoadedEventDefV3,
} from '../../data/eventContentV3';
import type { LoadedEventDef } from '../../data/eventsContent';
import { eventRuntimeCatalog } from '../../data/events';
import type {
  EventArtId,
  EventChoiceDef,
  EventOutcomeSpec,
  EventRarity,
  EventTheme,
} from '../../data/eventTypes';
import type { SkillTier } from '../../engine/types';
import {
  choiceLockReason,
  currentEventResolution,
  derivedChoiceFamily,
  eventGateMet,
  eventRecapLine,
  eventTallyMet,
} from '../../run/events';
import type {
  EventChoiceUnavailableReasonV3,
  EventDeferredOfferV3,
} from '../../run/eventV3Materialization';
import { correlatedMaterializedChoiceV3 } from '../../run/eventsV3';
import type { RunNode, RunState } from '../../run/runState';
import {
  eventChoiceOpportunityHint,
  type EventOpportunityHint,
} from '../../run/eventOpportunityHint';

type OfferOf<K extends EventDeferredOfferV3['kind']> = Extract<EventDeferredOfferV3, { kind: K }>;
type EventPickerKind = Exclude<EventDeferredOfferV3['kind'], 'grantCard' | 'grantGem'>;
export type RunEventPendingOffer = Extract<EventDeferredOfferV3, { status: 'pending'; kind: EventPickerKind }>;

type PersistedOfferHint = {
  [K in EventDeferredOfferV3['kind']]: { kind: K; offer: OfferOf<K> }
}[EventDeferredOfferV3['kind']];

type LegacyOutcomeHint =
  | { kind: 'grantCard'; legacy: true; cardId?: string; tier?: SkillTier }
  | { kind: 'grantGem'; legacy: true; gemId?: string }
  | { kind: 'cardChoice'; legacy: true; tier: 'bronze'; optionCount: 3 }
  | { kind: 'gemChoice'; legacy: true; optionCount: 3 }
  | { kind: 'bonusDraft'; legacy: true; optionCount: 5 }
  | { kind: 'upgradeCard'; legacy: true }
  | { kind: 'sellGem'; legacy: true }
  | { kind: 'mergeCards'; legacy: true }
  | { kind: 'grantGold'; amount: number }
  | { kind: 'loseGold'; amount: number }
  | { kind: 'grantLevel' }
  | { kind: 'grantMapInfo'; bandsAhead: 2 | 3 }
  | { kind: 'nothing' };

type ImmediateOutcomeHint =
  | { kind: 'grantGold'; amount: number }
  | { kind: 'loseGold'; amount: number }
  | { kind: 'grantLevel' }
  | { kind: 'grantMapInfo'; bandsAhead: 2 | 3 }
  | { kind: 'nothing' };

/** Typed gameplay information a renderer may summarize without parsing copy.
 * V3 reward offers are the exact persisted snapshots, never regenerated. */
export type RunEventOutcomeHint = (
  | PersistedOfferHint
  | LegacyOutcomeHint
  | ImmediateOutcomeHint
) & { weightedBranchId?: string };

export interface RunEventChoiceViewModel {
  id: string;
  label: string;
  cost: number;
  affordable: boolean;
  locked: boolean;
  lockReason: string | null;
  /** Legacy dynamic filters are resolved once at the committed view seam so
   * scenes can keep their historical family suffix without reading defs. */
  derivedFamily?: string;
  outcomeHint: RunEventOutcomeHint;
  /** Spoiler-safe possibility derived from authored graph edges, never state. */
  opportunityHint?: EventOpportunityHint;
}

export type RunEventPhase =
  | { kind: 'open' }
  | { kind: 'pending'; choiceId: string; offer?: RunEventPendingOffer }
  | { kind: 'terminal'; choiceId: string; selectedId?: string };

export interface RunEventViewModel {
  eventId: string;
  contentVersion: number;
  instanceId: string;
  title: string;
  body: string;
  /** Legacy chain recap captured while the exact historical definition is in
   * hand. Scenes never look a definition up a second time to word history. */
  recap?: string;
  theme: EventTheme;
  art: { kind: 'event'; artId: EventArtId } | { kind: 'theme'; theme: EventTheme };
  artId?: EventArtId;
  rarity: EventRarity;
  story?: {
    storyId: string;
    stage: 'setup' | 'callback' | 'payoff' | 'capstone';
    role: 'setup' | 'callback' | 'payoff' | 'capstone';
  };
  visibility: 'visible' | 'hidden_until_eligible' | 'teased_when_due';
  isSecret: boolean;
  isDueCallback: boolean;
  phase: RunEventPhase;
  choices: readonly RunEventChoiceViewModel[];
}

function legacyHint(outcome: EventOutcomeSpec): RunEventOutcomeHint {
  switch (outcome.kind) {
    case 'grantCard': return {
      kind: 'grantCard', legacy: true,
      ...(outcome.cardId === undefined ? {} : { cardId: outcome.cardId }),
      ...(outcome.tier === undefined ? {} : { tier: outcome.tier }),
    };
    case 'grantGem': return {
      kind: 'grantGem', legacy: true,
      ...(outcome.gemId === undefined ? {} : { gemId: outcome.gemId }),
    };
    case 'cardChoice': return { kind: 'cardChoice', legacy: true, tier: 'bronze', optionCount: 3 };
    case 'gemChoice': return { kind: 'gemChoice', legacy: true, optionCount: 3 };
    case 'bonusDraft': return { kind: 'bonusDraft', legacy: true, optionCount: 5 };
    case 'upgradeCard': return { kind: 'upgradeCard', legacy: true };
    case 'sellGem': return { kind: 'sellGem', legacy: true };
    case 'mergeCards': return { kind: 'mergeCards', legacy: true };
    case 'grantGold': return { kind: 'grantGold', amount: outcome.amount };
    case 'loseGold': return { kind: 'loseGold', amount: outcome.amount };
    case 'grantLevel': return { kind: 'grantLevel' };
    case 'grantMapInfo': return { kind: 'grantMapInfo', bandsAhead: outcome.bandsAhead };
    case 'nothing': return { kind: 'nothing' };
  }
}

function persistedHint(
  outcome: EventDirectOutcomeSpecV3,
  offer: EventDeferredOfferV3 | undefined,
  weightedBranchId?: string,
): RunEventOutcomeHint | undefined {
  const weighted = weightedBranchId === undefined ? {} : { weightedBranchId };
  switch (outcome.kind) {
    case 'grantGold': return { kind: 'grantGold', amount: outcome.amount, ...weighted };
    case 'loseGold': return { kind: 'loseGold', amount: outcome.amount, ...weighted };
    case 'grantLevel': return { kind: 'grantLevel', ...weighted };
    case 'grantMapInfo': return { kind: 'grantMapInfo', bandsAhead: outcome.bandsAhead, ...weighted };
    case 'nothing': return { kind: 'nothing', ...weighted };
    case 'grantCard':
    case 'grantGem':
    case 'bonusDraft':
    case 'gemChoice':
    case 'upgradeCard':
    case 'sellGem':
    case 'mergeCards':
    case 'cardChoice':
    case 'upgradeCardTargeted':
      return offer?.kind === outcome.kind ? { kind: outcome.kind, offer, ...weighted } as RunEventOutcomeHint : undefined;
  }
}

function historicalRequiredChoice(
  state: RunState,
  eventId: string,
  choiceId: string,
  lookup: (eventId: string, contentVersion: number) => LoadedEventDef | undefined,
): EventChoiceDef | EventChoiceV3 | undefined {
  const resolvedInstances = Object.entries(state.eventResolutions ?? {}).flatMap(([nodeId, resolution]) => {
    const instance = state.eventInstances[nodeId];
    if (resolution.eventId !== eventId || instance === undefined
      || resolution.eventId !== instance.eventId
      || resolution.contentVersion !== instance.contentVersion
      || resolution.instanceId !== instance.instanceId) return [];
    return [{ nodeId, instance }];
  }).sort((left, right) => (
    right.instance.drawnDepth - left.instance.drawnDepth
    || (left.nodeId < right.nodeId ? -1 : left.nodeId > right.nodeId ? 1 : 0)
  ));

  for (const { instance } of resolvedInstances) {
    const target = lookup(instance.eventId, instance.contentVersion);
    if (target === undefined || target.id !== instance.eventId) continue;
    const targetChoices = isEventDefV3(target)
      ? [...target.choiceSet.fixed, ...(target.choiceSet.pool?.entries ?? [])]
      : target.choices;
    const targetChoice = targetChoices.find((candidate) => candidate.id === choiceId);
    if (targetChoice !== undefined) return targetChoice;
  }
  return undefined;
}

function v3ChoiceLockReason(
  state: RunState,
  choice: EventChoiceV3,
  offer: EventDeferredOfferV3 | undefined,
  unavailableReason: EventChoiceUnavailableReasonV3 | undefined,
  lookup: (eventId: string, contentVersion: number) => LoadedEventDef | undefined,
): string | null {
  if (unavailableReason === 'no_unvisited_biome') return 'no unvisited biome remains';
  const cost = choice.cost ?? 0;
  if (cost > state.gold) return `needs ${cost} gold`;
  if (choice.requires !== undefined && !eventGateMet(state, choice.requires)) {
    if (choice.requires.choiceIds?.length === 1) {
      const targetChoice = historicalRequiredChoice(
        state,
        choice.requires.eventId,
        choice.requires.choiceIds[0]!,
        lookup,
      );
      if (targetChoice !== undefined) return `needs "${targetChoice.label.replace(/\s*\([^)]*\)$/, '')}"`;
    }
    return 'needs a past deed';
  }
  if (choice.requiresTally !== undefined && !eventTallyMet(state, choice.requiresTally)) {
    const probe: EventChoiceDef = {
      id: choice.id,
      label: choice.label,
      requiresTally: choice.requiresTally,
      outcome: { kind: 'nothing' },
    };
    return choiceLockReason(state, probe);
  }
  if (offer?.status !== 'unavailable') return null;
  // Matches the run layer's own wording for the same condition byte-for-byte
  // (`choiceLockReason`, src/run/events.ts) — a schema-v3 mergeCards rung used
  // to print a bare internal/engine-vocabulary phrase here while the legacy
  // path already worded the identical lock for a player, so the same lock
  // read two different ways depending on which schema drew it (2026-09-07
  // audit). Not delegated to a shared export: `choiceLockReason` takes a
  // legacy `EventChoiceDef` this v3 lookup never has one of, and `src/run` is
  // out of scope for this fix — see `runEventLockReasons.test.ts` for the pin
  // that catches either side drifting again (it also pins the OLD phrase's
  // literal text, which is deliberately not repeated in this comment).
  return offer.kind === 'sellGem' ? 'nothing in your pouch' : 'need 3 cards of one grade';
}

function v3Choices(
  state: RunState,
  event: LoadedEventDefV3,
  instanceId: string,
  lookup: (eventId: string, contentVersion: number) => LoadedEventDef | undefined,
): readonly RunEventChoiceViewModel[] | undefined {
  const materialization = state.eventMaterializations[instanceId];
  if (materialization?.eventInstanceId !== instanceId) return undefined;
  const authored = [...event.choiceSet.fixed, ...(event.choiceSet.pool?.entries ?? [])];
  const choices: RunEventChoiceViewModel[] = [];
  for (const choiceId of materialization.choiceIds) {
    const choice = authored.find((candidate) => candidate.id === choiceId);
    if (choice === undefined) return undefined;
    const correlated = correlatedMaterializedChoiceV3(event, materialization, instanceId, choice.id);
    if (correlated === undefined) return undefined;
    const { offer } = correlated;
    const outcomeHint = persistedHint(correlated.outcome, offer, correlated.weightedBranchId);
    if (outcomeHint === undefined) return undefined;
    const lockReason = v3ChoiceLockReason(
      state,
      choice,
      offer,
      materialization.unavailableChoiceReasonsByChoiceId?.[choice.id],
      lookup,
    );
    const cost = choice.cost ?? 0;
    const opportunityHint = eventChoiceOpportunityHint(event, choice.id, eventRuntimeCatalog);
    choices.push({
      id: choice.id,
      label: choice.label,
      cost,
      affordable: cost <= state.gold,
      locked: lockReason !== null,
      lockReason,
      outcomeHint,
      ...(opportunityHint === undefined ? {} : { opportunityHint }),
    });
  }
  return choices;
}

function selectedId(offer: EventDeferredOfferV3 | undefined): string | undefined {
  if (offer === undefined || offer.status !== 'settled') return undefined;
  if (offer.kind === 'cardChoice') return offer.selectedSkillId;
  if (offer.kind === 'upgradeCardTargeted') return offer.selectedInstanceId;
  return offer.selectedId;
}

function isPendingPickerOffer(offer: EventDeferredOfferV3 | undefined): offer is RunEventPendingOffer {
  return offer?.status === 'pending' && offer.kind !== 'grantCard' && offer.kind !== 'grantGem';
}

function phaseFor(
  state: RunState,
  node: RunNode,
  instanceId: string,
  contentVersion: number,
  v3: boolean,
): RunEventPhase | undefined {
  const resolution = currentEventResolution(state);
  if (resolution === undefined) return { kind: 'open' };
  if (resolution.instanceId !== instanceId
    || resolution.contentVersion !== contentVersion
    || state.eventInstances[node.id]?.eventId !== resolution.eventId) {
    return undefined;
  }
  if (v3 && !state.eventMaterializations[instanceId]?.choiceIds.includes(resolution.choiceId)) {
    return undefined;
  }
  if (resolution.pending === true) {
    if (!v3) return { kind: 'pending', choiceId: resolution.choiceId };
    const offer = state.eventMaterializations[instanceId]?.deferredOffersByChoiceId[resolution.choiceId];
    return isPendingPickerOffer(offer)
      ? { kind: 'pending', choiceId: resolution.choiceId, offer }
      : undefined;
  }
  const offer = v3
    ? state.eventMaterializations[instanceId]?.deferredOffersByChoiceId[resolution.choiceId]
    : undefined;
  if (v3 && offer !== undefined && offer.status !== 'settled') return undefined;
  const persistedSelectedId = selectedId(offer);
  return {
    kind: 'terminal',
    choiceId: resolution.choiceId,
    ...(persistedSelectedId === undefined ? {} : { selectedId: persistedSelectedId }),
  };
}

/** Build the sole event renderer input from the exact committed instance.
 * Schema-v3 choice membership/order/branches/offers come exclusively from
 * `eventMaterializations`; current state is consulted only for live locks. */
export function buildRunEventViewModel(
  state: RunState,
  node: RunNode,
  event: LoadedEventDef,
  lookup: (eventId: string, contentVersion: number) => LoadedEventDef | undefined = () => undefined,
): RunEventViewModel | undefined {
  const instance = state.eventInstances[node.id];
  if (node.kind !== 'event' || instance === undefined || instance.eventId !== event.id) return undefined;
  const phase = phaseFor(state, node, instance.instanceId, instance.contentVersion, isEventDefV3(event));
  if (phase === undefined) return undefined;

  const choices = isEventDefV3(event)
    ? v3Choices(state, event, instance.instanceId, lookup)
    : event.choices.map((choice) => {
      const lockReason = choiceLockReason(state, choice);
      const cost = choice.cost ?? 0;
      const derivedFamily = derivedChoiceFamily(state, choice);
      const opportunityHint = eventChoiceOpportunityHint(event, choice.id, eventRuntimeCatalog);
      return {
        id: choice.id,
        label: choice.label,
        cost,
        affordable: cost <= state.gold,
        locked: lockReason !== null,
        lockReason,
        ...(derivedFamily === undefined ? {} : { derivedFamily }),
        outcomeHint: legacyHint(choice.outcome),
        ...(opportunityHint === undefined ? {} : { opportunityHint }),
      };
    });
  if (choices === undefined) return undefined;

  const rarity = event.rarity ?? 'common';
  const recap = isEventDefV3(event) ? null : eventRecapLine(state, event);
  let story: RunEventViewModel['story'];
  let visibility: RunEventViewModel['visibility'] = 'visible';
  if (isEventDefV3(event)) {
    story = event.story;
    visibility = event.visibility;
  } else if (isEventDefV2(event)) {
    story = event.story;
    visibility = event.visibility;
  }
  return {
    eventId: event.id,
    contentVersion: instance.contentVersion,
    instanceId: instance.instanceId,
    title: event.title,
    body: event.body,
    ...(recap === null ? {} : { recap }),
    theme: event.theme,
    art: event.artId === undefined
      ? { kind: 'theme', theme: event.theme }
      : { kind: 'event', artId: event.artId },
    ...(event.artId === undefined ? {} : { artId: event.artId }),
    rarity,
    ...(story === undefined ? {} : { story }),
    visibility,
    isSecret: rarity === 'secret',
    isDueCallback: instance.callbackInstanceId !== undefined,
    phase,
    choices,
  };
}
