import {
  isAmbientEventDefV3,
  isEventDefV3,
  type EventChoiceV3,
  type EventDirectOutcomeSpecV3,
  type EventMutationV3,
  type LoadedEventDefV3,
} from '../data/eventContentV3';
import type { LoadedEventDef } from '../data/eventsContent';
import { eventDefAtVersion } from '../data/eventsContent';
import { gemBook } from '../data/gems';
import { hashSeed } from '../engine/rng';
import type { SkillTier } from '../engine/types';
import { bindEventV3 } from './eventEligibilityV3';
import { eventInstanceAt } from './eventInstances';
import { applyGrantMapInfo, mapInfoRevealsAnything, mapIntelRecords } from './eventMapInfo';
import {
  hasCanonicalDynamicDestinationV3,
  hasExactUnavailableChoiceReasonsV3,
  previewEventChoicesV3,
  type EventDeferredOfferV3,
  type EventMaterializationRecord,
} from './eventV3Materialization';
import {
  EVENT_CARD_FALLBACK_GOLD,
  eventCardChoiceV3,
  settleEventCardChoiceV3,
  settleTargetedUpgradeV3,
  targetedUpgradeV3,
  type EventRewardSettlementV3,
} from './eventV3Rewards';
import type { RunNode } from './runMap';
import { bandIndexOf } from './biome';
import {
  LIVES_PER_RUN,
  MAX_LEVEL,
  runBagHasRoomFor,
  tryInsertPersistedEventRunCard,
  type EventResolution,
  type RunState,
} from './runState';
import { startChallengeFight } from './challengeFight';
import { scheduleEventCallbackV3, type EventDefinitionLookup } from './eventCallbacks';
import { resolveEventOutcomeSpec, type EventOutcome } from './events';
import {
  canBuyMarketLife,
  isMarketBuyOutcomeKind,
  MARKET_VISITS_PER_NODE,
  marketPurchasePriceGold,
  withMarketPurchaseCharged,
  withStatPurchased,
} from './market';
import type { MarketStat } from '../data/eventTypes';

type PendingEventOfferV3<K extends EventDeferredOfferV3['kind']> =
  Extract<Extract<EventDeferredOfferV3, { kind: K }>, { status: 'pending' }>;

export type EventOutcomeV3 =
  | { kind: 'grantCard'; skillId: string; tier: SkillTier }
  | { kind: 'grantGem'; gemId: string }
  | { kind: 'grantGold'; amount: number; fellBack?: boolean }
  | { kind: 'loseGold'; amount: number }
  | { kind: 'grantLevel'; level: number }
  | { kind: 'grantMapInfo'; bandsAhead: 2 | 3; revealedBands: readonly number[] }
  | { kind: 'buyLife'; price: number; lives: number }
  | { kind: 'buyStat'; stat: MarketStat; price: number }
  | { kind: 'buyStatPick'; offer: PendingEventOfferV3<'buyStatPick'> }
  | { kind: 'grantStat'; stat: MarketStat }
  | { kind: 'nothing'; fellBack?: boolean }
  | { kind: 'cardChoice'; offer: PendingEventOfferV3<'cardChoice'> }
  | { kind: 'upgradeCardTargeted'; offer: PendingEventOfferV3<'upgradeCardTargeted'> }
  | { kind: 'bonusDraft'; offer: PendingEventOfferV3<'bonusDraft'> }
  | { kind: 'gemChoice'; offer: PendingEventOfferV3<'gemChoice'> }
  | { kind: 'upgradeCard'; offer: PendingEventOfferV3<'upgradeCard'> }
  | { kind: 'sellGem'; offer: PendingEventOfferV3<'sellGem'> }
  | { kind: 'mergeCards'; offer: PendingEventOfferV3<'mergeCards'> }
  | { kind: 'challengeFight' }
  | EventRewardSettlementV3;

export type MaterializeReachedEventV3Result =
  | {
    ok: true;
    state: RunState;
    materialization: EventMaterializationRecord;
    choices: readonly EventChoiceV3[];
  }
  | {
    ok: false;
    state: RunState;
    reason: 'instance' | 'materialization' | 'choice-count' | 'binding' | 'offer';
  };

export type ResolveEventChoiceV3Result =
  | { ok: true; state: RunState; outcome: EventOutcomeV3 }
  | {
    ok: false;
    state: RunState;
    reason: 'instance' | 'version' | 'materialization' | 'choice' | 'gate' | 'cost' | 'reservation' | 'callback' | 'outcome';
  };

/** Correlate an already-persisted pending offer with the public outcome union.
 * Store/UI adapters use this on re-entry; no offer is regenerated. */
export function eventOutcomeForPendingOfferV3(
  offer: Extract<EventDeferredOfferV3, { status: 'pending' }>,
): EventOutcomeV3 {
  switch (offer.kind) {
    case 'cardChoice': return { kind: 'cardChoice', offer };
    case 'upgradeCardTargeted': return { kind: 'upgradeCardTargeted', offer };
    case 'bonusDraft': return { kind: 'bonusDraft', offer };
    case 'gemChoice': return { kind: 'gemChoice', offer };
    case 'upgradeCard': return { kind: 'upgradeCard', offer };
    case 'sellGem': return { kind: 'sellGem', offer };
    case 'mergeCards': return { kind: 'mergeCards', offer };
    case 'buyStatPick': return { kind: 'buyStatPick', offer };
    case 'grantCard':
    case 'grantGem':
      throw new Error(`eventOutcomeForPendingOfferV3: ${offer.kind} is immediate, not a picker`);
  }
}

function allChoices(event: LoadedEventDefV3): readonly EventChoiceV3[] {
  return [...event.choiceSet.fixed, ...(event.choiceSet.pool?.entries ?? [])];
}

function choicesForRecord(event: LoadedEventDefV3, record: EventMaterializationRecord): readonly EventChoiceV3[] | undefined {
  if (!hasExactUnavailableChoiceReasonsV3(event, record)) return undefined;
  const choices = allChoices(event);
  const selected: EventChoiceV3[] = [];
  for (const choiceId of record.choiceIds) {
    const choice = choices.find((candidate) => candidate.id === choiceId);
    if (choice === undefined) return undefined;
    selected.push(choice);
  }
  return selected;
}

function selectedWeightedBranchId(state: RunState, instanceId: string, choice: EventChoiceV3): string | undefined {
  if (choice.outcome.kind !== 'weighted') return undefined;
  const total = choice.outcome.branches.reduce((sum, branch) => sum + branch.weight, 0);
  let roll = hashSeed(state.map.seed, 'event-v3-weighted', instanceId, choice.id) % total;
  for (const branch of choice.outcome.branches) {
    if (roll < branch.weight) return branch.id;
    roll -= branch.weight;
  }
  return choice.outcome.branches[choice.outcome.branches.length - 1]!.id;
}

function directOutcomeFor(
  choice: EventChoiceV3,
  weightedBranchIds: Readonly<Record<string, string>>,
): EventDirectOutcomeSpecV3 | undefined {
  if (choice.outcome.kind !== 'weighted') return choice.outcome;
  const branchId = weightedBranchIds[choice.id];
  return choice.outcome.branches.find((branch) => branch.id === branchId)?.outcome;
}

export interface CorrelatedMaterializedChoiceV3 {
  choice: EventChoiceV3;
  outcome: EventDirectOutcomeSpecV3;
  offer: EventDeferredOfferV3 | undefined;
  weightedBranchId: string | undefined;
  branchMutations: readonly EventMutationV3[] | undefined;
}

/** Read one committed choice transaction without regenerating any decision.
 * The authored outcome (or persisted weighted branch) and persisted offer
 * must describe the same reward family. */
export function correlatedMaterializedChoiceV3(
  event: LoadedEventDefV3,
  materialization: EventMaterializationRecord,
  eventInstanceId: string,
  choiceId: string,
): CorrelatedMaterializedChoiceV3 | undefined {
  if (materialization.eventInstanceId !== eventInstanceId) return undefined;
  const choice = choicesForRecord(event, materialization)
    ?.find((candidate) => candidate.id === choiceId);
  if (choice === undefined) return undefined;
  const weightedBranchId = choice.outcome.kind === 'weighted'
    ? materialization.selectedWeightedBranchIds[choiceId]
    : undefined;
  const weightedBranch = choice.outcome.kind === 'weighted'
    ? choice.outcome.branches.find((branch) => branch.id === weightedBranchId)
    : undefined;
  const outcome = choice.outcome.kind === 'weighted' ? weightedBranch?.outcome : choice.outcome;
  if (outcome === undefined) return undefined;
  const offer = materialization.deferredOffersByChoiceId[choiceId];
  // `buyStatPick` is the one legacy-family kind whose offer is NEVER built at
  // materialization time (see `legacyCommitment`'s own exclusion below) — it
  // is created fresh by `applyDirectOutcome` on the FIRST choice resolve and
  // reset on every later one, so both "not yet taken" (offer undefined) and
  // "already taken at least once" (offer present, same kind) correlate.
  // `challengeFight` never has an offer at materialization (the fight has not
  // happened yet), but a WON fight whose reward is itself a further pick
  // (cardChoice/gemChoice/upgradeCardTargeted) persists one under this same
  // choiceId via `recordChallengeFightResult` — so the offer's kind is
  // compared against the reward's, not the choice's own `challengeFight` kind.
  const correlated = outcome.kind === 'grantGold' || outcome.kind === 'loseGold'
    || outcome.kind === 'grantLevel' || outcome.kind === 'grantMapInfo'
    || outcome.kind === 'nothing'
    || outcome.kind === 'buyLife' || outcome.kind === 'buyStat' || outcome.kind === 'grantStat'
    ? offer === undefined
    : outcome.kind === 'buyStatPick'
      ? offer === undefined || offer.kind === 'buyStatPick'
      : outcome.kind === 'challengeFight'
        ? offer === undefined || offer.kind === outcome.reward.kind
        : offer?.kind === outcome.kind;
  if (!correlated) return undefined;
  return {
    choice,
    outcome,
    offer,
    weightedBranchId,
    branchMutations: weightedBranch?.mutations,
  };
}

function legacyCommitment(
  state: RunState,
  node: RunNode,
  instanceId: string,
  choiceId: string,
  outcome: EventDirectOutcomeSpecV3,
  boundSubjects: EventMaterializationRecord['boundSubjects'],
): EventDeferredOfferV3 | undefined {
  if (outcome.kind === 'cardChoice' || outcome.kind === 'upgradeCardTargeted'
    || outcome.kind === 'grantGold' || outcome.kind === 'loseGold'
    || outcome.kind === 'grantLevel' || outcome.kind === 'grantMapInfo'
    || outcome.kind === 'nothing' || outcome.kind === 'challengeFight'
    || outcome.kind === 'buyLife' || outcome.kind === 'buyStat' || outcome.kind === 'buyStatPick'
    || outcome.kind === 'grantStat') return undefined;
  if (outcome.kind === 'sellGem' && state.gemInventory.length === 0) {
    return { kind: 'sellGem', status: 'unavailable' };
  }
  const previewNode: RunNode = {
    ...node,
    eventSeed: hashSeed(state.map.seed, 'event-v3-outcome', instanceId, choiceId),
  };
  const concreteOutcome = outcome.kind === 'gemChoice' && outcome.boundSubject !== undefined
    ? (() => {
      const mono = boundSubjects.mono_type;
      const selected = mono === undefined ? undefined : outcome.boundSubject.cases.find((candidate) => (
        candidate.when.typeKind === mono.typeKind && candidate.when.type === mono.type
      ));
      if (selected === undefined) throw new Error('bound gem choice has no case for persisted mono subject');
      return { kind: 'gemChoice' as const, filter: selected.filter };
    })()
    : outcome;
  const previewState = concreteOutcome.kind === 'grantCard' ? { ...state, bagSlots: [] } : state;
  let preview: EventOutcome;
  try {
    preview = resolveEventOutcomeSpec(previewState, previewNode, choiceId, concreteOutcome, instanceId).outcome as EventOutcome;
  } catch (error) {
    if (outcome.kind === 'mergeCards') return { kind: 'mergeCards', status: 'unavailable' };
    throw error;
  }
  switch (outcome.kind) {
    case 'grantCard':
      if (preview.kind !== 'grantCard') return undefined;
      return { kind: 'grantCard', status: 'pending', card: { skillId: preview.skillId, tier: preview.tier } };
    case 'grantGem':
      return preview.kind === 'grantGem'
        ? { kind: 'grantGem', status: 'pending', gemId: preview.gemId }
        : undefined;
    case 'bonusDraft':
      return preview.kind === 'bonusDraft'
        ? { kind: 'bonusDraft', status: 'pending', options: preview.cards.map((card) => ({ skillId: card.skillId, tier: card.tier })) }
        : undefined;
    case 'gemChoice':
      if (preview.kind !== 'gemChoicePick' || preview.options.length !== 3) return undefined;
      return {
        kind: 'gemChoice', status: 'pending',
        optionGemIds: [...preview.options] as [string, string, string],
      };
    case 'upgradeCard':
      return preview.kind === 'upgradeCardPick'
        ? { kind: 'upgradeCard', status: 'pending', optionInstanceIds: preview.options.map((option) => option.instanceId), fallback: { kind: 'grantGold', amount: EVENT_CARD_FALLBACK_GOLD } }
        : { kind: 'upgradeCard', status: 'pending', optionInstanceIds: [], fallback: { kind: 'grantGold', amount: EVENT_CARD_FALLBACK_GOLD } };
    case 'sellGem':
      return preview.kind === 'sellGemPick'
        ? { kind: 'sellGem', status: 'pending', options: preview.options.map((option) => ({ ...option })) }
        : undefined;
    case 'mergeCards':
      return preview.kind === 'mergeCardsPick'
        ? {
          kind: 'mergeCards', status: 'pending', from: preview.from, to: preview.to,
          consumed: preview.consumed.map((entry) => ({ ...entry })),
          candidates: preview.candidates.map((entry) => ({ ...entry })),
          fallback: { kind: 'grantGold', amount: EVENT_CARD_FALLBACK_GOLD },
        }
        : undefined;
  }
}

/** Commit every display-affecting v3 decision after the selector has committed
 * the event instance. Re-entry is a pure persisted-record read. */
export function materializeReachedEventV3(
  state: RunState,
  node: RunNode,
  event: LoadedEventDefV3,
  contentVersion = eventInstanceAt(state, node.id)?.contentVersion,
): MaterializeReachedEventV3Result {
  const instance = eventInstanceAt(state, node.id);
  if (instance === undefined || instance.eventId !== event.id || instance.instanceId !== `event:${node.id}`
    || contentVersion === undefined || instance.contentVersion !== contentVersion) {
    return { ok: false, state, reason: 'instance' };
  }
  const existing = state.eventMaterializations[instance.instanceId];
  if (existing !== undefined) {
    if (existing.eventInstanceId !== instance.instanceId) {
      return { ok: false, state, reason: 'materialization' };
    }
    const choices = choicesForRecord(event, existing);
    return choices === undefined
      ? { ok: false, state, reason: 'materialization' }
      : { ok: true, state, materialization: existing, choices };
  }

  const choices = previewEventChoicesV3(state.map.seed, instance.instanceId, event);
  if (choices.length < 2 || choices.length > 3) return { ok: false, state, reason: 'choice-count' };
  const bound = bindEventV3(
    state,
    instance.instanceId,
    isAmbientEventDefV3(event) ? (event.bindings ?? []) : [],
    node,
    event.eligibility,
  );
  if (!bound.ok) return { ok: false, state, reason: 'binding' };
  if (!hasCanonicalDynamicDestinationV3(bound.boundSubjects)) {
    return { ok: false, state, reason: 'binding' };
  }

  const weighted: Record<string, string> = {};
  for (const choice of choices) {
    const branchId = selectedWeightedBranchId(bound.state, instance.instanceId, choice);
    if (branchId !== undefined) weighted[choice.id] = branchId;
  }

  const offers: Record<string, EventDeferredOfferV3> = {};
  try {
    for (const choice of choices) {
      const outcome = directOutcomeFor(choice, weighted);
      if (outcome?.kind === 'cardChoice') {
        offers[choice.id] = eventCardChoiceV3(bound.state, node, {
          eventId: event.id, rarity: event.rarity, story: event.story,
        }, choice.id, outcome);
      } else if (outcome?.kind === 'upgradeCardTargeted') {
        offers[choice.id] = targetedUpgradeV3(bound.state, outcome, bound.boundSubjects);
      } else if (outcome !== undefined) {
        const commitment = legacyCommitment(
          bound.state, node, instance.instanceId, choice.id, outcome, bound.boundSubjects,
        );
        if (commitment !== undefined) offers[choice.id] = commitment;
      }
    }
  } catch {
    return { ok: false, state, reason: 'offer' };
  }

  const unavailableChoiceReasonsByChoiceId: Record<string, 'no_unvisited_biome'> = {};
  if (isAmbientEventDefV3(event) && (event.bindings ?? []).some((binding) => (
    binding.as === 'destination_biome'
    && binding.source === 'journey.futureBiome'
    && binding.candidates === 'unvisited_catalog'
  )) && bound.boundSubjects.destination_biome === undefined) {
    for (const choice of choices) {
      if (choice.callback?.bind.some((binding) => binding.as === 'destination_biome') === true) {
        unavailableChoiceReasonsByChoiceId[choice.id] = 'no_unvisited_biome';
      }
    }
  }

  const materialization: EventMaterializationRecord = {
    eventInstanceId: instance.instanceId,
    choiceIds: choices.map((choice) => choice.id) as [string, string] | [string, string, string],
    selectedWeightedBranchIds: weighted,
    unavailableChoiceReasonsByChoiceId,
    boundSubjects: bound.boundSubjects,
    deferredOffersByChoiceId: offers,
  };
  const nextState: RunState = {
    ...bound.state,
    eventMaterializations: {
      ...bound.state.eventMaterializations,
      [instance.instanceId]: materialization,
    },
  };
  return { ok: true, state: nextState, materialization, choices };
}

function tallyValue(state: RunState, stat: NonNullable<EventChoiceV3['requiresTally']>['stat']): number {
  return stat === 'wins' ? state.wins
    : stat === 'losses' ? state.losses
    : stat === 'bossesCleared' ? state.bossesCleared
    : state.stats[stat];
}

function choiceGateMet(state: RunState, choice: EventChoiceV3): boolean {
  if (choice.requires !== undefined) {
    const met = Object.values(state.eventResolutions ?? {}).some((resolution) => (
      resolution.eventId === choice.requires!.eventId
      && (choice.requires!.choiceIds === undefined || choice.requires!.choiceIds.includes(resolution.choiceId))
    ));
    if (!met) return false;
  }
  return choice.requiresTally === undefined || tallyValue(state, choice.requiresTally.stat) >= choice.requiresTally.atLeast;
}

function applyMutations(state: RunState, mutations: readonly EventMutationV3[] | undefined): RunState {
  if (mutations === undefined || mutations.length === 0) return state;
  let storyStateV3 = state.storyStateV3;
  let completedStoryIds = state.completedStoryIds ?? [];
  for (const mutation of mutations) {
    if (mutation.op === 'completeStory') {
      if (!completedStoryIds.includes(mutation.storyId)) completedStoryIds = [...completedStoryIds, mutation.storyId];
    } else {
      storyStateV3 = { ...storyStateV3, [mutation.key]: mutation.value } as RunState['storyStateV3'];
    }
  }
  return storyStateV3 === state.storyStateV3 && completedStoryIds === state.completedStoryIds
    ? state
    : { ...state, storyStateV3, completedStoryIds };
}

function consumeReservations(state: RunState, instanceId: string): RunState | undefined {
  const reservations = state.eventBindingReservations.filter((entry) => entry.instanceId === instanceId);
  let revengeFactLedger = state.revengeFactLedger;
  let signatureFactLedger = state.signatureFactLedger;
  for (const reservation of reservations) {
    if (reservation.source === 'revenge') {
      const index = revengeFactLedger.findIndex((record) => (
        record.battleId === reservation.sourceBattleId
        && record.enemyId === reservation.subjectId
        && record.status === 'reserved'
        && record.reservedByInstanceId === instanceId
      ));
      if (index < 0) return undefined;
      revengeFactLedger = revengeFactLedger.map((record, candidate) => candidate === index
        ? { ...record, status: 'consumed' as const, reservedByInstanceId: undefined }
        : record);
    } else {
      const index = signatureFactLedger.findIndex((record) => (
        record.battleId === reservation.sourceBattleId
        && record.cardId === reservation.subjectId
        && record.status === 'reserved'
        && record.reservedByInstanceId === instanceId
      ));
      if (index < 0) return undefined;
      signatureFactLedger = signatureFactLedger.map((record, candidate) => candidate === index
        ? { ...record, status: 'consumed' as const, reservedByInstanceId: undefined }
        : record);
    }
  }
  return revengeFactLedger === state.revengeFactLedger && signatureFactLedger === state.signatureFactLedger
    ? state
    : { ...state, revengeFactLedger, signatureFactLedger };
}

function updateOffer(
  state: RunState,
  instanceId: string,
  choiceId: string,
  offer: EventDeferredOfferV3,
): RunState {
  const materialization = state.eventMaterializations[instanceId]!;
  return {
    ...state,
    eventMaterializations: {
      ...state.eventMaterializations,
      [instanceId]: {
        ...materialization,
        deferredOffersByChoiceId: { ...materialization.deferredOffersByChoiceId, [choiceId]: offer },
      },
    },
  };
}

function settledOffer(offer: EventDeferredOfferV3, selectedId?: string): EventDeferredOfferV3 {
  if (offer.kind === 'cardChoice' || offer.kind === 'upgradeCardTargeted') return offer;
  if (offer.status === 'unavailable') return offer;
  return { ...offer, status: 'settled', ...(selectedId === undefined ? {} : { selectedId }) };
}

function fallbackGold(state: RunState, amount: number): { state: RunState; outcome: EventOutcomeV3 } {
  return {
    state: { ...state, gold: state.gold + amount, stats: { ...state.stats, goldEarned: state.stats.goldEarned + amount } },
    outcome: { kind: 'grantGold', amount, fellBack: true },
  };
}

function applyLegacyCommitment(
  state: RunState,
  instanceId: string,
  choiceId: string,
  offer: EventDeferredOfferV3,
): { state: RunState; outcome: EventOutcomeV3; pending: boolean } | undefined {
  if (offer.status !== 'pending') return undefined;
  if (offer.kind === 'grantCard') {
    const inserted = tryInsertPersistedEventRunCard(state, offer.card.skillId, offer.card.tier);
    const applied: { state: RunState; outcome: EventOutcomeV3 } = inserted === null
      ? fallbackGold(state, EVENT_CARD_FALLBACK_GOLD)
      : { state: inserted.state, outcome: { kind: 'grantCard', skillId: offer.card.skillId, tier: offer.card.tier } };
    return { state: updateOffer(applied.state, instanceId, choiceId, settledOffer(offer)), outcome: applied.outcome, pending: false };
  }
  if (offer.kind === 'grantGem') {
    const next = { ...state, gemInventory: [...state.gemInventory, offer.gemId] };
    return {
      state: updateOffer(next, instanceId, choiceId, settledOffer(offer)),
      outcome: { kind: 'grantGem', gemId: offer.gemId }, pending: false,
    };
  }
  if (offer.kind === 'upgradeCard' && offer.optionInstanceIds.length === 0) {
    const applied = fallbackGold(state, offer.fallback.amount);
    return { state: updateOffer(applied.state, instanceId, choiceId, settledOffer(offer)), outcome: applied.outcome, pending: false };
  }
  if (offer.kind === 'sellGem' && offer.options.length === 0) return undefined;
  if (offer.kind === 'mergeCards' && offer.candidates.length === 0) return undefined;
  switch (offer.kind) {
    case 'bonusDraft': return { state, outcome: { kind: 'bonusDraft', offer }, pending: true };
    case 'gemChoice': return { state, outcome: { kind: 'gemChoice', offer }, pending: true };
    case 'upgradeCard': return { state, outcome: { kind: 'upgradeCard', offer }, pending: true };
    case 'sellGem': return { state, outcome: { kind: 'sellGem', offer }, pending: true };
    case 'mergeCards': return { state, outcome: { kind: 'mergeCards', offer }, pending: true };
    case 'cardChoice':
    case 'upgradeCardTargeted':
      return undefined;
  }
}

function applyDirectOutcome(
  state: RunState,
  node: RunNode,
  instanceId: string,
  choiceId: string,
  outcome: EventDirectOutcomeSpecV3,
): { state: RunState; outcome: EventOutcomeV3; pending: boolean } | undefined {
  const commitment = state.eventMaterializations[instanceId]?.deferredOffersByChoiceId[choiceId];
  if (outcome.kind === 'grantCard' || outcome.kind === 'grantGem'
    || outcome.kind === 'bonusDraft' || outcome.kind === 'gemChoice'
    || outcome.kind === 'upgradeCard' || outcome.kind === 'sellGem'
    || outcome.kind === 'mergeCards') {
    return commitment?.kind === outcome.kind
      ? applyLegacyCommitment(state, instanceId, choiceId, commitment)
      : undefined;
  }
  switch (outcome.kind) {
    case 'grantGold':
      return {
        state: { ...state, gold: state.gold + outcome.amount, stats: { ...state.stats, goldEarned: state.stats.goldEarned + outcome.amount } },
        outcome: { kind: 'grantGold', amount: outcome.amount }, pending: false,
      };
    case 'loseGold': {
      const gold = Math.max(0, state.gold - outcome.amount);
      return {
        state: { ...state, gold, stats: { ...state.stats, goldSpent: state.stats.goldSpent + state.gold - gold } },
        outcome: { kind: 'loseGold', amount: outcome.amount }, pending: false,
      };
    }
    case 'grantLevel': {
      const level = Math.min(MAX_LEVEL, state.heroLevel + 1);
      return { state: { ...state, heroLevel: level }, outcome: { kind: 'grantLevel', level }, pending: false };
    }
    case 'grantMapInfo': {
      const next = applyGrantMapInfo(state, instanceId, bandIndexOf(node.wave), outcome.bandsAhead);
      return {
        state: next,
        outcome: {
          kind: 'grantMapInfo', bandsAhead: outcome.bandsAhead,
          revealedBands: mapIntelRecords(next).filter((record) => record.sourceEventInstanceId === instanceId).map((record) => record.band),
        },
        pending: false,
      };
    }
    case 'buyLife': {
      if (!canBuyMarketLife(state)) return undefined;
      const price = marketPurchasePriceGold(state);
      if (price > state.gold) return undefined;
      const charged = withMarketPurchaseCharged(state, price);
      const lives = Math.min(LIVES_PER_RUN, charged.lives + 1);
      return { state: { ...charged, lives }, outcome: { kind: 'buyLife', price, lives }, pending: false };
    }
    case 'buyStat': {
      const price = marketPurchasePriceGold(state);
      if (price > state.gold) return undefined;
      const charged = withMarketPurchaseCharged(state, price);
      return {
        state: withStatPurchased(charged, outcome.stat),
        outcome: { kind: 'buyStat', stat: outcome.stat, price },
        pending: false,
      };
    }
    case 'grantStat':
      return {
        state: withStatPurchased(state, outcome.stat),
        outcome: { kind: 'grantStat', stat: outcome.stat },
        pending: false,
      };
    case 'buyStatPick': {
      // Opens (or re-opens, for a second buy at the same node) the picker —
      // free and visit-less by itself. Reset unconditionally rather than
      // reused: a leftover `settled` offer from a prior buy at this node must
      // never block taking this choice again (`correlatedMaterializedChoiceV3`
      // accepts either shape). The actual price/charge/stat/visit-count only
      // happen at `finalizeBuyStatPickV3`.
      const pendingOffer: EventDeferredOfferV3 = { kind: 'buyStatPick', status: 'pending' };
      return {
        state: updateOffer(state, instanceId, choiceId, pendingOffer),
        outcome: { kind: 'buyStatPick', offer: pendingOffer },
        pending: true,
      };
    }
    case 'nothing':
      return { state, outcome: { kind: 'nothing' }, pending: false };
    case 'challengeFight': {
      // No persisted offer to correlate (see `correlatedMaterializedChoiceV3`'s
      // exemption above) — the enemy is rolled fresh from (instanceId,
      // choiceId) right here. `pending: false`: the CHOICE is fully resolved
      // (this rung can never be taken again); the battle itself is tracked
      // entirely off to the side via `RunState.activeChallengeFight`, the same
      // "not part of the deferred-offer ledger" shape `activeGhostFight`
      // already uses. `recordChallengeFightResult` (below) re-opens this
      // node's resolution as pending ONLY if the reward it wins is itself a
      // further pick (cardChoice/gemChoice/upgradeCardTargeted) — see its own
      // doc comment.
      const next = startChallengeFight(state, node.wave, node.id, instanceId, choiceId, outcome.difficulty, outcome.reward);
      return { state: next, outcome: { kind: 'challengeFight' }, pending: false };
    }
    case 'cardChoice': {
      const offer = state.eventMaterializations[instanceId]?.deferredOffersByChoiceId[choiceId];
      return offer?.kind === 'cardChoice' && offer.status === 'pending'
        ? { state, outcome: { kind: 'cardChoice', offer }, pending: true }
        : undefined;
    }
    case 'upgradeCardTargeted': {
      const offer = state.eventMaterializations[instanceId]?.deferredOffersByChoiceId[choiceId];
      if (offer?.kind !== 'upgradeCardTargeted' || offer.status !== 'pending') return undefined;
      const settled = settleTargetedUpgradeV3(state, offer);
      const next = updateOffer(settled.state, instanceId, choiceId, settled.offer);
      if (settled.offer.status === 'pending') {
        return {
          state: next,
          outcome: { kind: 'upgradeCardTargeted', offer: settled.offer },
          pending: true,
        };
      }
      return settled.outcome === undefined
        ? undefined
        : { state: next, outcome: settled.outcome, pending: false };
    }
  }
}

/**
 * Whether a PERSISTED legacy-family offer is a guaranteed miss right now —
 * the v3 twin of `events.ts`'s `cardOutcomeCanDeliver`/upgrade-eligibility
 * checks, reading the offer's OWN persisted candidates (never re-rolling),
 * so this can never disagree with what `applyLegacyCommitment` is about to
 * try.
 *
 * `upgradeCard`'s empty `optionInstanceIds` is the live instance of this bug
 * (`gilded_detour`'s 8-gold `buy_gold_upgrade`, `src/data/content/events.v3.json`):
 * `legacyCommitment` already persists an empty option list when nothing owned
 * is eligible, but nothing used to REFUSE the choice over it — the cost was
 * charged and `applyLegacyCommitment` fell straight to the fallback coin.
 * `grantCard`/`bonusDraft`/`cardChoice` are not reachable at a nonzero cost in
 * the catalog yet, but the same "the bag has room for NOTHING this offer
 * could hand over" failure is exactly as reachable the moment one is
 * authored, so it is closed here too, from the exact fields already on the
 * persisted offer — no new persisted state, no `Rng`.
 */
function persistedOfferCannotDeliver(state: RunState, offer: EventDeferredOfferV3): boolean {
  switch (offer.kind) {
    case 'upgradeCard':
      return offer.optionInstanceIds.length === 0;
    case 'grantCard':
      return !runBagHasRoomFor(state, offer.card.skillId);
    case 'bonusDraft':
    case 'cardChoice':
      return !offer.options.some((option) => runBagHasRoomFor(state, option.skillId));
    default:
      return false;
  }
}

function nodeAndInstance(state: RunState, instanceId: string): { node: RunNode; nodeId: string } | undefined {
  for (const [nodeId, instance] of Object.entries(state.eventInstances)) {
    if (instance.instanceId !== instanceId) continue;
    for (const column of state.map.depths) {
      const node = column.find((candidate) => candidate.id === nodeId);
      if (node !== undefined) return { node, nodeId };
    }
  }
  return undefined;
}

/** Resolve a committed schema-v3 choice entirely from persisted selection,
 * binding, branch, and offer facts. No random source is consulted here. */
export function resolveEventChoiceV3(
  state: RunState,
  instanceId: string,
  choiceId: string,
  lookup: EventDefinitionLookup<LoadedEventDef> = eventDefAtVersion,
): ResolveEventChoiceV3Result {
  const located = nodeAndInstance(state, instanceId);
  if (located === undefined) return { ok: false, state, reason: 'instance' };
  const instance = state.eventInstances[located.nodeId]!;
  const event = lookup(instance.eventId, instance.contentVersion);
  if (event === undefined || event.id !== instance.eventId || !isEventDefV3(event)) {
    return { ok: false, state, reason: 'version' };
  }
  const materialization = state.eventMaterializations[instanceId];
  if (materialization === undefined || materialization.eventInstanceId !== instanceId) {
    return { ok: false, state, reason: 'materialization' };
  }
  const correlated = correlatedMaterializedChoiceV3(event, materialization, instanceId, choiceId);
  if (correlated === undefined) return { ok: false, state, reason: 'materialization' };
  const { choice, outcome: direct, branchMutations } = correlated;
  if (materialization.unavailableChoiceReasonsByChoiceId?.[choiceId] !== undefined) {
    return { ok: false, state, reason: 'gate' };
  }
  const existingResolution = state.eventResolutions?.[located.nodeId];
  if (existingResolution !== undefined) {
    // The gold market's stay-open flow (2026-09-25): a rung normally resolves
    // exactly once forever, but a market visit buys up to
    // `MARKET_VISITS_PER_NODE` times before it locks — allowed only while the
    // PREVIOUS rung taken here was itself a market buy (a `leave`/`nothing`
    // exit, or hitting the cap, closes the node for good, same as before).
    const previousChoice = allChoices(event).find((candidate) => candidate.id === existingResolution.choiceId);
    const previousWasMarketBuy = previousChoice !== undefined && isMarketBuyOutcomeKind(previousChoice.outcome.kind);
    const visits = existingResolution.marketVisits ?? 1;
    if (!previousWasMarketBuy || visits >= MARKET_VISITS_PER_NODE) {
      return { ok: false, state, reason: 'choice' };
    }
  }
  if (!choiceGateMet(state, choice)) return { ok: false, state, reason: 'gate' };
  const cost = choice.cost ?? 0;
  if (cost > state.gold) return { ok: false, state, reason: 'cost' };

  const persistedOffer = correlated.offer;
  if ((direct.kind === 'sellGem' || direct.kind === 'mergeCards')
    && persistedOffer?.kind === direct.kind && persistedOffer.status === 'unavailable') {
    return { ok: false, state, reason: 'gate' };
  }
  // A paid rung must not charge for a card/upgrade the persisted offer can
  // already prove it cannot deliver (2026-09-06 — see
  // `persistedOfferCannotDeliver`'s doc comment for the live `gilded_detour`
  // instance this closes). Checked against the OFFER already computed at
  // materialization, never a fresh roll, so this spends no `Rng`.
  if (persistedOffer?.kind === direct.kind && persistedOfferCannotDeliver(state, persistedOffer)) {
    return { ok: false, state, reason: 'gate' };
  }
  if (direct.kind === 'grantMapInfo'
    && !mapInfoRevealsAnything(state, bandIndexOf(located.node.wave), direct.bandsAhead)) {
    return { ok: false, state, reason: 'gate' };
  }

  let working: RunState = cost === 0 ? state : {
    ...state,
    gold: state.gold - cost,
    stats: { ...state.stats, goldSpent: state.stats.goldSpent + cost },
  };
  const applied = applyDirectOutcome(working, located.node, instanceId, choiceId, direct);
  if (applied === undefined) return { ok: false, state, reason: 'outcome' };
  working = applyMutations(applyMutations(applied.state, choice.mutations), branchMutations);
  const consumed = consumeReservations(working, instanceId);
  if (consumed === undefined) return { ok: false, state, reason: 'reservation' };
  working = consumed;

  if (choice.callback !== undefined) {
    const scheduled = scheduleEventCallbackV3(working, choice.callback, {
      eventInstanceId: instanceId,
      choiceId,
      nodeDepth: located.node.depth,
      ordinal: 0,
    }, materialization.boundSubjects, lookup);
    if (!scheduled.ok) return { ok: false, state, reason: 'callback' };
    working = scheduled.state;
  }

  // `buyStatPick` spends no visit merely by being opened/reopened — only
  // `finalizeBuyStatPickV3` bumps it (2026-09-25). Its resolve here must
  // still CARRY FORWARD whatever count `finalizeBuyStatPickV3` already
  // wrote, rather than dropping it: `existingResolution?.marketVisits` (not
  // `undefined`) preserves a completed first buy across the second
  // `buy_stat_pick` reselect this same function call handles.
  const marketVisits = isMarketBuyOutcomeKind(direct.kind) && direct.kind !== 'buyStatPick'
    ? (existingResolution?.marketVisits ?? 0) + 1
    : existingResolution?.marketVisits;
  const resolution: EventResolution = {
    eventId: instance.eventId,
    contentVersion: instance.contentVersion,
    instanceId,
    choiceId,
    ...(applied.pending ? { pending: true } : {}),
    ...(marketVisits !== undefined ? { marketVisits } : {}),
  };
  return {
    ok: true,
    state: {
      ...working,
      stats: { ...working.stats, eventsResolved: working.stats.eventsResolved + 1 },
      eventResolutions: { ...(working.eventResolutions ?? {}), [located.nodeId]: resolution },
    },
    outcome: applied.outcome,
  };
}

export function reopenEventChoiceV3(
  state: RunState,
  instanceId: string,
  lookup: EventDefinitionLookup<LoadedEventDef> = eventDefAtVersion,
): { choiceId: string; offer: EventDeferredOfferV3 } | undefined {
  const located = nodeAndInstance(state, instanceId);
  if (located === undefined) return undefined;
  const instance = state.eventInstances[located.nodeId];
  const resolution = state.eventResolutions?.[located.nodeId];
  if (instance === undefined
    || resolution?.instanceId !== instanceId
    || resolution.eventId !== instance.eventId
    || resolution.contentVersion !== instance.contentVersion
    || resolution.pending !== true) return undefined;
  const event = lookup(instance.eventId, instance.contentVersion);
  if (event === undefined || event.id !== instance.eventId || !isEventDefV3(event)) return undefined;
  const materialization = state.eventMaterializations[instanceId];
  if (materialization === undefined
    || materialization.eventInstanceId !== instanceId
    || !hasExactUnavailableChoiceReasonsV3(event, materialization)) return undefined;
  if (materialization.unavailableChoiceReasonsByChoiceId?.[resolution.choiceId] !== undefined) return undefined;
  const offer = materialization.deferredOffersByChoiceId[resolution.choiceId];
  return offer?.status === 'pending' ? { choiceId: resolution.choiceId, offer } : undefined;
}

/** Backs out of an open `buyStatPick` picker for free — no gold charged, no
 * purchase-ladder bump, and `marketVisits` untouched (a completed buy earlier
 * this same node visit, if any, survives), so cancelling reads exactly like
 * never having taken the `buy_stat_pick` rung. A no-op unless that picker is
 * genuinely open right now. */
export function cancelBuyStatPickV3(state: RunState, instanceId: string): RunState {
  const located = nodeAndInstance(state, instanceId);
  if (located === undefined) return state;
  const resolution = state.eventResolutions?.[located.nodeId];
  if (resolution?.instanceId !== instanceId || resolution.pending !== true) return state;
  const offer = state.eventMaterializations[instanceId]?.deferredOffersByChoiceId[resolution.choiceId];
  if (offer?.kind !== 'buyStatPick' || offer.status !== 'pending') return state;
  return clearPending(state, instanceId);
}

type FinalizerTransactionV3<K extends EventDeferredOfferV3['kind']> =
  | { status: 'pending'; offer: Extract<Extract<EventDeferredOfferV3, { kind: K }>, { status: 'pending' }> }
  | { status: 'settled'; offer: Extract<Extract<EventDeferredOfferV3, { kind: K }>, { status: 'settled' }> }
  | { status: 'invalid' };

/** Classify a finalizer call against the exact persisted transaction. Missing
 * and mismatched requests are never conflated with a settled replay. */
function finalizerTransactionV3<K extends EventDeferredOfferV3['kind']>(
  state: RunState,
  instanceId: string,
  choiceId: string,
  kind: K,
  lookup: EventDefinitionLookup<LoadedEventDef>,
): FinalizerTransactionV3<K> {
  const located = nodeAndInstance(state, instanceId);
  if (located === undefined) return { status: 'invalid' };
  const instance = state.eventInstances[located.nodeId];
  const resolution = state.eventResolutions?.[located.nodeId];
  const materialization = state.eventMaterializations[instanceId];
  const event = instance === undefined
    ? undefined
    : lookup(instance.eventId, instance.contentVersion);
  if (instance === undefined || resolution === undefined || materialization === undefined
    || event === undefined
    || event.id !== instance.eventId
    || !isEventDefV3(event)
    || instance.eventId !== resolution.eventId
    || instance.contentVersion !== resolution.contentVersion
    || instance.instanceId !== resolution.instanceId
    || materialization.eventInstanceId !== instanceId
    || resolution.choiceId !== choiceId
    || !materialization.choiceIds.includes(choiceId)
    || !hasExactUnavailableChoiceReasonsV3(event, materialization)
    || materialization.unavailableChoiceReasonsByChoiceId?.[choiceId] !== undefined) {
    return { status: 'invalid' };
  }
  const offer = materialization.deferredOffersByChoiceId[choiceId];
  if (offer?.kind !== kind || offer.status === 'unavailable') return { status: 'invalid' };
  if (resolution.pending === true && offer.status === 'pending') {
    return { status: 'pending', offer } as FinalizerTransactionV3<K>;
  }
  if (resolution.pending !== true && offer.status === 'settled') {
    return { status: 'settled', offer } as FinalizerTransactionV3<K>;
  }
  return { status: 'invalid' };
}

function clearPending(state: RunState, instanceId: string): RunState {
  const located = nodeAndInstance(state, instanceId);
  if (located === undefined) return state;
  const resolution = state.eventResolutions?.[located.nodeId];
  if (resolution?.instanceId !== instanceId || resolution.pending !== true) return state;
  const { pending: _pending, ...settled } = resolution;
  return { ...state, eventResolutions: { ...(state.eventResolutions ?? {}), [located.nodeId]: settled } };
}

/** The inverse of `clearPending` — flips an already-settled resolution back
 * to `pending: true`. `recordChallengeFightResult`'s ONLY caller: a won
 * `challengeFight` choice resolves to `pending: false` at commit time (see
 * `applyDirectOutcome`'s `challengeFight` case), then re-opens here IF AND
 * ONLY IF its reward is itself a further pick — in the SAME state update that
 * persists the offer, so `isV3EventTopology`'s "pending resolution needs a
 * pending offer" invariant never observes one without the other. */
function reopenAsPending(state: RunState, instanceId: string): RunState {
  const located = nodeAndInstance(state, instanceId);
  if (located === undefined) return state;
  const resolution = state.eventResolutions?.[located.nodeId];
  if (resolution?.instanceId !== instanceId || resolution.pending === true) return state;
  return {
    ...state,
    eventResolutions: { ...(state.eventResolutions ?? {}), [located.nodeId]: { ...resolution, pending: true } },
  };
}

export function finalizeEventCardChoiceV3(
  state: RunState,
  instanceId: string,
  choiceId: string,
  selectedSkillId: string,
  lookup: EventDefinitionLookup<LoadedEventDef> = eventDefAtVersion,
): { ok: true; state: RunState; outcome: EventOutcomeV3 } | { ok: false; state: RunState; reason: 'offer' | 'choice' } {
  const transaction = finalizerTransactionV3(state, instanceId, choiceId, 'cardChoice', lookup);
  if (transaction.status === 'invalid') return { ok: false, state, reason: 'choice' };
  if (transaction.status === 'settled') {
    return transaction.offer.selectedSkillId === selectedSkillId
      ? { ok: true, state, outcome: { kind: 'alreadySettled' } }
      : { ok: false, state, reason: 'offer' };
  }
  const settled = settleEventCardChoiceV3(state, transaction.offer, selectedSkillId);
  if (!settled.ok) return { ok: false, state, reason: 'offer' };
  return {
    ok: true,
    state: clearPending(updateOffer(settled.state, instanceId, choiceId, settled.offer), instanceId),
    outcome: settled.outcome,
  };
}

export function finalizeTargetedUpgradeV3(
  state: RunState,
  instanceId: string,
  choiceId: string,
  selectedInstanceId?: string,
  lookup: EventDefinitionLookup<LoadedEventDef> = eventDefAtVersion,
): { ok: true; state: RunState; outcome: EventOutcomeV3 } | { ok: false; state: RunState; reason: 'choice' | 'offer' } {
  const transaction = finalizerTransactionV3(state, instanceId, choiceId, 'upgradeCardTargeted', lookup);
  if (transaction.status === 'invalid') return { ok: false, state, reason: 'choice' };
  if (transaction.status === 'settled') {
    return transaction.offer.selectedInstanceId === selectedInstanceId
      ? { ok: true, state, outcome: { kind: 'alreadySettled' } }
      : { ok: false, state, reason: 'offer' };
  }
  if (selectedInstanceId === undefined || !transaction.offer.optionInstanceIds.includes(selectedInstanceId)) {
    return { ok: false, state, reason: 'offer' };
  }
  const settled = settleTargetedUpgradeV3(state, transaction.offer, selectedInstanceId);
  const persistedOffer = settled.offer.status === 'settled'
    ? { ...settled.offer, selectedInstanceId }
    : settled.offer;
  const next = updateOffer(settled.state, instanceId, choiceId, persistedOffer);
  if (settled.offer.status === 'pending') {
    return { ok: true, state: next, outcome: { kind: 'upgradeCardTargeted', offer: settled.offer } };
  }
  return { ok: true, state: clearPending(next, instanceId), outcome: settled.outcome ?? { kind: 'nothing' } };
}

type LegacyFinalizeResultV3 =
  | { ok: true; state: RunState; outcome: EventOutcomeV3 }
  | { ok: false; state: RunState; reason: 'choice' | 'offer' };

function finishLegacy(
  state: RunState,
  instanceId: string,
  choiceId: string,
  offer: EventDeferredOfferV3,
  outcome: EventOutcomeV3,
  selectedId?: string,
): LegacyFinalizeResultV3 {
  return {
    ok: true,
    state: clearPending(updateOffer(state, instanceId, choiceId, settledOffer(offer, selectedId)), instanceId),
    outcome,
  };
}

export function finalizeBonusDraftV3(
  state: RunState, instanceId: string, choiceId: string, selectedSkillId: string,
  lookup: EventDefinitionLookup<LoadedEventDef> = eventDefAtVersion,
): LegacyFinalizeResultV3 {
  const transaction = finalizerTransactionV3(state, instanceId, choiceId, 'bonusDraft', lookup);
  if (transaction.status === 'invalid') return { ok: false, state, reason: 'choice' };
  if (transaction.status === 'settled') return transaction.offer.selectedId === selectedSkillId
    ? { ok: true, state, outcome: { kind: 'alreadySettled' } }
    : { ok: false, state, reason: 'offer' };
  const offer = transaction.offer;
  const selected = offer.options.find((option) => option.skillId === selectedSkillId);
  if (selected === undefined) return { ok: false, state, reason: 'offer' };
  const inserted = tryInsertPersistedEventRunCard(state, selected.skillId, selected.tier);
  if (inserted === null) {
    const fallback = fallbackGold(state, EVENT_CARD_FALLBACK_GOLD);
    return finishLegacy(fallback.state, instanceId, choiceId, offer, fallback.outcome, selectedSkillId);
  }
  return finishLegacy(inserted.state, instanceId, choiceId, offer,
    { kind: 'grantCard', skillId: selected.skillId, tier: selected.tier }, selectedSkillId);
}

/**
 * Settle the market's stat picker: charge the CURRENT ladder price (read
 * fresh here, never carried from when the picker opened — a second buy in
 * the same visit charges the incremented price), bump the shared
 * `marketPurchases` counter, apply the stat, and bump THIS node's
 * `marketVisits` (`src/run/market.ts`) — deferred from the choice-open in
 * `applyDirectOutcome` to here, so opening/cancelling the picker is free.
 * Resolves to the SAME `buyStat` outcome kind a direct (non-picker) stat buy
 * already produces (`eventOutcomeText.ts`'s `marketPurchaseConfirmText`/
 * `outcomeHeadline` already read either origin identically) — the picker
 * only changes HOW the stat is chosen, never what buying one means.
 */
export function finalizeBuyStatPickV3(
  state: RunState, instanceId: string, choiceId: string, stat: MarketStat,
  lookup: EventDefinitionLookup<LoadedEventDef> = eventDefAtVersion,
): { ok: true; state: RunState; outcome: EventOutcomeV3 } | { ok: false; state: RunState; reason: 'choice' | 'offer' | 'cost' } {
  const transaction = finalizerTransactionV3(state, instanceId, choiceId, 'buyStatPick', lookup);
  if (transaction.status === 'invalid') return { ok: false, state, reason: 'choice' };
  if (transaction.status === 'settled') {
    return transaction.offer.selectedId === stat
      ? { ok: true, state, outcome: { kind: 'alreadySettled' } }
      : { ok: false, state, reason: 'offer' };
  }
  const price = marketPurchasePriceGold(state);
  if (price > state.gold) return { ok: false, state, reason: 'cost' };
  const located = nodeAndInstance(state, instanceId);
  if (located === undefined) return { ok: false, state, reason: 'choice' };
  const resolution = state.eventResolutions?.[located.nodeId];
  if (resolution === undefined) return { ok: false, state, reason: 'choice' };
  const charged = withStatPurchased(withMarketPurchaseCharged(state, price), stat);
  const { pending: _pending, ...settled } = resolution;
  const next: RunState = {
    ...charged,
    eventResolutions: {
      ...(charged.eventResolutions ?? {}),
      [located.nodeId]: { ...settled, marketVisits: (resolution.marketVisits ?? 0) + 1 },
    },
  };
  return {
    ok: true,
    state: updateOffer(next, instanceId, choiceId, { kind: 'buyStatPick', status: 'settled', selectedId: stat }),
    outcome: { kind: 'buyStat', stat, price },
  };
}

export function finalizeGemChoiceV3(
  state: RunState, instanceId: string, choiceId: string, selectedGemId: string,
  lookup: EventDefinitionLookup<LoadedEventDef> = eventDefAtVersion,
): LegacyFinalizeResultV3 {
  const transaction = finalizerTransactionV3(state, instanceId, choiceId, 'gemChoice', lookup);
  if (transaction.status === 'invalid') return { ok: false, state, reason: 'choice' };
  if (transaction.status === 'settled') return transaction.offer.selectedId === selectedGemId
    ? { ok: true, state, outcome: { kind: 'alreadySettled' } }
    : { ok: false, state, reason: 'offer' };
  const offer = transaction.offer;
  if (!offer.optionGemIds.includes(selectedGemId) || gemBook[selectedGemId] === undefined) {
    return { ok: false, state, reason: 'offer' };
  }
  const next = { ...state, gemInventory: [...state.gemInventory, selectedGemId] };
  return finishLegacy(next, instanceId, choiceId, offer, { kind: 'grantGem', gemId: selectedGemId }, selectedGemId);
}

export function finalizeUpgradeCardV3(
  state: RunState, instanceId: string, choiceId: string, selectedInstanceId?: string,
  lookup: EventDefinitionLookup<LoadedEventDef> = eventDefAtVersion,
): LegacyFinalizeResultV3 {
  const transaction = finalizerTransactionV3(state, instanceId, choiceId, 'upgradeCard', lookup);
  if (transaction.status === 'invalid') return { ok: false, state, reason: 'choice' };
  if (transaction.status === 'settled') return transaction.offer.selectedId === selectedInstanceId
    ? { ok: true, state, outcome: { kind: 'alreadySettled' } }
    : { ok: false, state, reason: 'offer' };
  const offer = transaction.offer;
  if (selectedInstanceId === undefined) return { ok: false, state, reason: 'offer' };
  if (!offer.optionInstanceIds.includes(selectedInstanceId)) return { ok: false, state, reason: 'offer' };
  const settled = settleTargetedUpgradeV3(state, {
    kind: 'upgradeCardTargeted', status: 'pending', optionInstanceIds: offer.optionInstanceIds,
    fallback: offer.fallback,
  }, selectedInstanceId);
  return finishLegacy(settled.state, instanceId, choiceId, offer,
    settled.outcome ?? { kind: 'nothing' }, selectedInstanceId);
}

export function finalizeSellGemV3(
  state: RunState, instanceId: string, choiceId: string, pouchIndex: number,
  lookup: EventDefinitionLookup<LoadedEventDef> = eventDefAtVersion,
): LegacyFinalizeResultV3 {
  const transaction = finalizerTransactionV3(state, instanceId, choiceId, 'sellGem', lookup);
  if (transaction.status === 'invalid') return { ok: false, state, reason: 'choice' };
  const selectedId = String(pouchIndex);
  if (transaction.status === 'settled') return transaction.offer.selectedId === selectedId
    ? { ok: true, state, outcome: { kind: 'alreadySettled' } }
    : { ok: false, state, reason: 'offer' };
  const offer = transaction.offer;
  const selected = offer.options.find((option) => option.pouchIndex === pouchIndex);
  if (selected === undefined) return { ok: false, state, reason: 'offer' };
  if (state.gemInventory[pouchIndex] !== selected.gemId) return { ok: false, state, reason: 'offer' };
  const gems = [...state.gemInventory];
  gems.splice(pouchIndex, 1);
  const next = {
    ...state, gemInventory: gems, gold: state.gold + selected.price,
    stats: { ...state.stats, goldEarned: state.stats.goldEarned + selected.price },
  };
  return finishLegacy(next, instanceId, choiceId, offer,
    { kind: 'grantGold', amount: selected.price }, selectedId);
}

function removePersistedMergeInputs(
  state: RunState,
  offer: Extract<Extract<EventDeferredOfferV3, { kind: 'mergeCards' }>, { status: 'pending' | 'settled' }>,
): RunState | undefined {
  for (const input of offer.consumed) {
    const card = input.location === 'board' ? state.pieces[input.index] : state.bagSlots[input.index];
    if (card === null || card === undefined || card.instanceId !== input.instanceId
      || card.skillId !== input.skillId || card.tier !== input.tier) return undefined;
  }
  const boardIndexes = offer.consumed.filter((input) => input.location === 'board').map((input) => input.index);
  const bagIndexes = offer.consumed.filter((input) => input.location === 'bag').map((input) => input.index);
  const returnedGems = state.pieces
    .filter((_card, index) => boardIndexes.includes(index))
    .flatMap((card) => card.gem === null || card.gem === undefined ? [] : [card.gem.id]);
  return {
    ...state,
    pieces: state.pieces.filter((_card, index) => !boardIndexes.includes(index)),
    bagSlots: state.bagSlots.map((card, index) => bagIndexes.includes(index) ? null : card),
    gemInventory: [...state.gemInventory, ...returnedGems],
  };
}

export type MergeCardsOfferAvailabilityV3 =
  | { kind: 'ready' }
  | { kind: 'paused'; reason: 'inputs_changed' | 'output_blocked' };

/**
 * Whether the exact persisted V3 merge can still honour every choice it shows.
 * Deck Build remains available while an event picker is pending, so neither
 * input indexes nor bag room may be assumed to match materialization time.
 * A paused offer stays pending: restoring the recorded arrangement makes the
 * same deterministic offer ready again without rerolling or compensating it.
 */
export function mergeCardsOfferAvailabilityV3(
  state: RunState,
  offer: PendingEventOfferV3<'mergeCards'>,
): MergeCardsOfferAvailabilityV3 {
  const removed = removePersistedMergeInputs(state, offer);
  if (removed === undefined) return { kind: 'paused', reason: 'inputs_changed' };
  if (offer.candidates.some((candidate) => (
    tryInsertPersistedEventRunCard(removed, candidate.skillId, candidate.tier) === null
  ))) return { kind: 'paused', reason: 'output_blocked' };
  return { kind: 'ready' };
}

export function finalizeMergeCardsV3(
  state: RunState, instanceId: string, choiceId: string, selectedSkillId: string,
  lookup: EventDefinitionLookup<LoadedEventDef> = eventDefAtVersion,
): LegacyFinalizeResultV3 {
  const transaction = finalizerTransactionV3(state, instanceId, choiceId, 'mergeCards', lookup);
  if (transaction.status === 'invalid') return { ok: false, state, reason: 'choice' };
  if (transaction.status === 'settled') return transaction.offer.selectedId === selectedSkillId
    ? { ok: true, state, outcome: { kind: 'alreadySettled' } }
    : { ok: false, state, reason: 'offer' };
  const offer = transaction.offer;
  const selected = offer.candidates.find((candidate) => candidate.skillId === selectedSkillId);
  if (selected === undefined) return { ok: false, state, reason: 'offer' };
  if (mergeCardsOfferAvailabilityV3(state, offer).kind !== 'ready') {
    return { ok: false, state, reason: 'offer' };
  }
  const removed = removePersistedMergeInputs(state, offer);
  const inserted = removed === undefined ? null : tryInsertPersistedEventRunCard(removed, selected.skillId, selected.tier);
  if (inserted === null) return { ok: false, state, reason: 'offer' };
  return finishLegacy(inserted.state, instanceId, choiceId, offer,
    { kind: 'grantCard', skillId: selected.skillId, tier: selected.tier }, selectedSkillId);
}

/**
 * Settle the run's ONE active `challengeFight` off-column battle
 * (`RunState.activeChallengeFight`, `challengeFight.ts`) — a LOSS costs
 * exactly one life, the same floor-at-0/`'defeat'` rule
 * `recordBattleResult` (runState.ts) applies to a fight-column loss, but
 * neither `wins`/`losses`/`bossesCleared` nor `heroLevel` move: this is not a
 * fight-column node (`recordBattleResult` itself refuses one), so it is
 * tallied on its own `challengeFights` counter instead — the SAME carve-out
 * `recordExtraGhostFightResult` (`ghostMatch.ts`) already uses for the ghost
 * boss's extra off-column fight.
 *
 * A WIN resolves the choice's authored `reward` through the SAME reward
 * machinery an ordinary event choice uses — `eventCardChoiceV3`/
 * `targetedUpgradeV3` for the V3-native kinds, the legacy `gemChoice` roll via
 * `resolveEventOutcomeSpec` for gems (mirroring `legacyCommitment`'s own
 * split) — and, for the three kinds that need a further pick, PERSISTS the
 * offer under the exact (instanceId, choiceId) the challenge choice already
 * owns. That is what lets the existing pending-picker finalizers
 * (`finalizeEventCardChoiceV3`/`finalizeGemChoiceV3`/`finalizeTargetedUpgradeV3`)
 * apply completely unmodified — this function never re-implements a picker,
 * it only seeds the ONE persisted fact (the offer) they already read.
 */
export function recordChallengeFightResult(
  state: RunState,
  won: boolean,
  lookup: EventDefinitionLookup<LoadedEventDef> = eventDefAtVersion,
): { state: RunState } {
  const active = state.activeChallengeFight;
  if (!active) throw new Error('recordChallengeFightResult: no challenge fight is active');
  const { nodeId, instanceId, choiceId, reward } = active;
  const lives = won ? state.lives : Math.max(0, state.lives - 1);
  const settled: RunState = {
    ...state,
    status: lives <= 0 ? 'defeat' : state.status,
    lives,
    activeChallengeFight: null,
    challengeFights: {
      won: (state.challengeFights?.won ?? 0) + (won ? 1 : 0),
      lost: (state.challengeFights?.lost ?? 0) + (won ? 0 : 1),
    },
    stats: { ...state.stats, livesLost: state.stats.livesLost + (state.lives - lives) },
  };
  if (!won) return { state: clearPending(settled, instanceId) };

  const located = nodeAndInstance(settled, instanceId);
  const instance = settled.eventInstances[nodeId];
  const event = instance !== undefined ? lookup(instance.eventId, instance.contentVersion) : undefined;

  switch (reward.kind) {
    case 'grantGold': {
      const next = {
        ...settled,
        gold: settled.gold + reward.amount,
        stats: { ...settled.stats, goldEarned: settled.stats.goldEarned + reward.amount },
      };
      return { state: clearPending(next, instanceId) };
    }
    case 'grantLevel': {
      const level = Math.min(MAX_LEVEL, settled.heroLevel + 1);
      return { state: clearPending({ ...settled, heroLevel: level }, instanceId) };
    }
    case 'cardChoice': {
      if (located === undefined || event === undefined || !isEventDefV3(event)) {
        // Unreachable for catalog content (the node/event that started this
        // fight cannot vanish mid-run) — fall back to the fallback coin
        // rather than lose the reward outright.
        const next = {
          ...settled,
          gold: settled.gold + EVENT_CARD_FALLBACK_GOLD,
          stats: { ...settled.stats, goldEarned: settled.stats.goldEarned + EVENT_CARD_FALLBACK_GOLD },
        };
        return { state: clearPending(next, instanceId) };
      }
      const offer = eventCardChoiceV3(
        settled,
        located.node,
        { eventId: event.id, rarity: event.rarity, story: event.story },
        choiceId,
        { kind: 'cardChoice', filter: reward.filter, maxTier: reward.maxTier },
      );
      return { state: reopenAsPending(updateOffer(settled, instanceId, choiceId, offer), instanceId) };
    }
    case 'gemChoice': {
      const wave = located?.node.wave ?? 1;
      const previewNode: RunNode = {
        id: nodeId, depth: located?.node.depth ?? 0, wave, kind: 'event', biomeId: located?.node.biomeId ?? 'unknown',
        eventSeed: hashSeed(settled.map.seed, 'challenge-reward', instanceId, choiceId),
      };
      const preview = resolveEventOutcomeSpec(
        settled, previewNode, choiceId, { kind: 'gemChoice', filter: reward.filter }, instanceId,
      ).outcome;
      // Same width guard `legacyCommitment`'s own `gemChoice` case applies at
      // materialization time: depth-gating (`pickWeightedGems`, shop.ts) can
      // narrow an already-filtered pool below `EVENT_CHOICE_SIZE` (a single
      // legendary in the pool excludes itself below its gate depth), which a
      // won challenge fight cannot re-roll around — fall back to gold, the
      // same "reward undeliverable" degrade `applyLegacyCommitment` uses.
      if (preview.kind !== 'gemChoicePick' || preview.options.length !== 3) {
        return { state: clearPending(fallbackGold(settled, EVENT_CARD_FALLBACK_GOLD).state, instanceId) };
      }
      return {
        state: reopenAsPending(updateOffer(settled, instanceId, choiceId, {
          kind: 'gemChoice', status: 'pending', optionGemIds: preview.options as [string, string, string],
        }), instanceId),
      };
    }
    case 'upgradeCardTargeted': {
      const offer = targetedUpgradeV3(
        settled,
        { kind: 'upgradeCardTargeted', target: reward.target, fallback: reward.fallback },
        {},
      );
      return { state: reopenAsPending(updateOffer(settled, instanceId, choiceId, offer), instanceId) };
    }
  }
}
