import type {
  EventBoundSubjectsV3,
  EventDefV3,
  EventDirectOutcomeSpecV3,
} from '../data/eventContentV3';
import type { EventRarity } from '../data/eventTypes';
import { skillBook } from '../data/skills';
import { hashSeed, Rng } from '../engine/rng';
import { cardOfferableAtTier, minOfferableTier, TIER_ORDER } from '../engine/types';
import type { SkillTier } from '../engine/types';
import { ownedCardsMatchingV3 } from './eventEligibilityV3';
import type { EventCardOfferV3, EventDeferredOfferV3 } from './eventV3Materialization';
import type { RunNode } from './runMap';
import { tryInsertPersistedEventRunCard } from './runState';
import type { RunCard, RunState } from './runState';
import { cardMatchesFilter, nextSkillTier } from './shop';

export const EVENT_CARD_FALLBACK_GOLD = 2;

const EVENT_CHOICE_SIZE = 3;

export interface EventRewardSourceV3 {
  eventId: string;
  rarity: EventRarity;
  story: Pick<EventDefV3['story'], 'stage' | 'role'>;
}

export function eventOfferTierCap(node: Pick<RunNode, 'depth'>): SkillTier {
  if (node.depth <= 3) return 'silver';
  if (node.depth <= 8) return 'gold';
  return 'diamond';
}

function lowerTier(left: SkillTier, right: SkillTier): SkillTier {
  return TIER_ORDER.indexOf(left) <= TIER_ORDER.indexOf(right) ? left : right;
}

function tierForRoll(roll: number): SkillTier {
  if (roll <= 54) return 'bronze';
  if (roll <= 81) return 'silver';
  if (roll <= 95) return 'gold';
  return 'diamond';
}

function clampTier(tier: SkillTier, minimum: SkillTier, maximum: SkillTier): SkillTier {
  const rank = TIER_ORDER.indexOf(tier);
  if (rank < TIER_ORDER.indexOf(minimum)) return minimum;
  if (rank > TIER_ORDER.indexOf(maximum)) return maximum;
  return tier;
}

function effectiveOfferMaximum(
  node: Pick<RunNode, 'depth'>,
  source: EventRewardSourceV3,
  spec: Extract<EventDirectOutcomeSpecV3, { kind: 'cardChoice' }>,
): SkillTier {
  if (spec.capstone !== true) return lowerTier(eventOfferTierCap(node), spec.maxTier);
  if (source.rarity !== 'secret'
    || source.story.stage !== 'capstone'
    || source.story.role !== 'capstone') {
    throw new Error(`eventCardChoiceV3: ${source.eventId} has an unauthorized capstone card offer`);
  }
  if (spec.maxTier !== 'diamond') {
    throw new Error(`eventCardChoiceV3: ${source.eventId} capstone card offer must have Diamond maxTier`);
  }
  return spec.maxTier;
}

function sampleDistinct<T>(rng: Rng, pool: readonly T[], count: number): T[] {
  const remaining = [...pool];
  const selected: T[] = [];
  for (let index = 0; index < count; index += 1) {
    const selectedIndex = rng.int(remaining.length);
    selected.push(remaining[selectedIndex]!);
    remaining.splice(selectedIndex, 1);
  }
  return selected;
}

export function eventCardChoiceV3(
  state: RunState,
  node: Pick<RunNode, 'id' | 'depth'>,
  source: EventRewardSourceV3,
  choiceId: string,
  spec: Extract<EventDirectOutcomeSpecV3, { kind: 'cardChoice' }>,
): Extract<EventDeferredOfferV3, { kind: 'cardChoice'; status: 'pending' }> {
  const maximum = effectiveOfferMaximum(node, source, spec);
  const pool = Object.values(skillBook).filter((skill, index, book) => {
    if (book.findIndex((entry) => entry.id === skill.id) !== index) return false;
    if (!cardMatchesFilter(skill, spec.filter)) return false;
    const minimum = minOfferableTier(skill);
    return minimum !== null && TIER_ORDER.indexOf(minimum) <= TIER_ORDER.indexOf(maximum);
  });
  if (pool.length < EVENT_CHOICE_SIZE) {
    throw new Error(
      `eventCardChoiceV3: filtered deliverable pool has only ${String(pool.length)} card(s), fewer than ${String(EVENT_CHOICE_SIZE)}`,
    );
  }

  const selected = sampleDistinct(
    new Rng(hashSeed(state.map.seed, 'event-offer', node.id, choiceId)),
    pool,
    EVENT_CHOICE_SIZE,
  );
  const options = selected.map((skill, optionIndex): EventCardOfferV3 => {
    const minimum = minOfferableTier(skill);
    if (minimum === null) throw new Error(`eventCardChoiceV3: selected unofferable skill ${skill.id}`);
    const desired = tierForRoll(hashSeed(
      state.map.seed,
      'event-offer-tier',
      node.id,
      choiceId,
      skill.id,
      optionIndex,
    ) % 100);
    const tier = clampTier(desired, minimum, maximum);
    if (!cardOfferableAtTier(skill, tier)) {
      throw new Error(`eventCardChoiceV3: ${skill.id} is not offerable at ${tier}`);
    }
    return { skillId: skill.id, tier };
  }) as [EventCardOfferV3, EventCardOfferV3, EventCardOfferV3];
  return { kind: 'cardChoice', status: 'pending', options };
}

export type EventRewardSettlementV3 =
  | { kind: 'cardGranted'; skillId: string; tier: SkillTier; instanceId: string }
  | { kind: 'cardUpgraded'; instanceId: string; skillId: string; from: SkillTier; to: SkillTier }
  | { kind: 'grantGold'; amount: number; fellBack: true }
  | { kind: 'nothing'; fellBack: true }
  | { kind: 'alreadySettled' };

export type EventRewardFinalizeResultV3 =
  | { ok: true; state: RunState; offer: EventDeferredOfferV3; outcome: EventRewardSettlementV3 }
  | { ok: false; state: RunState; offer: EventDeferredOfferV3; reason: 'unoffered-card' };

export function settleEventCardChoiceV3(
  state: RunState,
  offer: Extract<EventDeferredOfferV3, { kind: 'cardChoice' }>,
  selectedSkillId: string,
): EventRewardFinalizeResultV3 {
  if (offer.status === 'settled') {
    return { ok: true, state, offer, outcome: { kind: 'alreadySettled' } };
  }
  if (offer.options.length !== EVENT_CHOICE_SIZE) {
    throw new Error('settleEventCardChoiceV3: malformed persisted card offer');
  }
  const seenSkillIds: string[] = [];
  for (let index = 0; index < offer.options.length; index += 1) {
    const option = offer.options[index]!;
    if (skillBook[option.skillId] === undefined
      || !TIER_ORDER.includes(option.tier)
      || seenSkillIds.includes(option.skillId)) {
      throw new Error('settleEventCardChoiceV3: malformed persisted card offer');
    }
    seenSkillIds.push(option.skillId);
  }
  const selected = offer.options.find((option) => option.skillId === selectedSkillId);
  if (selected === undefined) return { ok: false, state, offer, reason: 'unoffered-card' };

  const settledOffer: Extract<EventDeferredOfferV3, { kind: 'cardChoice'; status: 'settled' }> = {
    ...offer,
    status: 'settled',
    selectedSkillId,
  };
  const inserted = tryInsertPersistedEventRunCard(state, selected.skillId, selected.tier);
  if (inserted !== null) {
    return {
      ok: true,
      state: inserted.state,
      offer: settledOffer,
      outcome: {
        kind: 'cardGranted', skillId: selected.skillId, tier: selected.tier, instanceId: inserted.instanceId,
      },
    };
  }
  return {
    ok: true,
    state: {
      ...state,
      gold: state.gold + EVENT_CARD_FALLBACK_GOLD,
      stats: { ...state.stats, goldEarned: state.stats.goldEarned + EVENT_CARD_FALLBACK_GOLD },
    },
    offer: settledOffer,
    outcome: { kind: 'grantGold', amount: EVENT_CARD_FALLBACK_GOLD, fellBack: true },
  };
}

function targetCards(
  state: RunState,
  spec: Extract<EventDirectOutcomeSpecV3, { kind: 'upgradeCardTargeted' }>,
  boundSubjects: Readonly<EventBoundSubjectsV3>,
): readonly RunCard[] {
  if ('filter' in spec.target) {
    return ownedCardsMatchingV3(state, spec.target.filter.where, spec.target.filter.match);
  }
  const binding = spec.target.boundSubject;
  if (binding.slot === 'revenge_finisher_card_id') {
    const skillId = boundSubjects[binding.slot];
    return skillId === undefined ? [] : ownedCardsMatchingV3(state, 'any', { cardIds: [skillId] });
  }
  if (binding.slot === 'signature_card_id') {
    const skillId = boundSubjects[binding.slot];
    return skillId === undefined ? [] : ownedCardsMatchingV3(state, 'any', { cardIds: [skillId] });
  }
  if (binding.slot !== 'mono_type') return [];
  const mono = boundSubjects.mono_type;
  if (mono === undefined || (binding.typeKind !== undefined && mono.typeKind !== binding.typeKind)) return [];
  return ownedCardsMatchingV3(state, 'any', {}).filter((card) => {
    const skill = skillBook[card.skillId];
    return mono.typeKind === 'weapon' ? skill?.weapon === mono.type : skill?.element === mono.type;
  });
}

export function targetedUpgradeV3(
  state: RunState,
  spec: Extract<EventDirectOutcomeSpecV3, { kind: 'upgradeCardTargeted' }>,
  boundSubjects: Readonly<EventBoundSubjectsV3>,
): Extract<EventDeferredOfferV3, { kind: 'upgradeCardTargeted'; status: 'pending' }> {
  const optionInstanceIds = targetCards(state, spec, boundSubjects)
    .filter((card) => nextSkillTier(card.tier) !== null)
    .map((card) => card.instanceId);
  return {
    kind: 'upgradeCardTargeted',
    status: 'pending',
    optionInstanceIds,
    fallback: { ...spec.fallback },
  };
}

export interface TargetedUpgradeSettlementResultV3 {
  state: RunState;
  offer: Extract<EventDeferredOfferV3, { kind: 'upgradeCardTargeted' }>;
  outcome?: EventRewardSettlementV3;
}

function settleUpgradeFallback(
  state: RunState,
  offer: Extract<EventDeferredOfferV3, { kind: 'upgradeCardTargeted'; status: 'pending' }>,
): TargetedUpgradeSettlementResultV3 {
  const settledOffer: Extract<EventDeferredOfferV3, { kind: 'upgradeCardTargeted'; status: 'settled' }> = {
    ...offer,
    status: 'settled',
  };
  if (offer.fallback.kind === 'nothing') {
    return { state, offer: settledOffer, outcome: { kind: 'nothing', fellBack: true } };
  }
  return {
    state: {
      ...state,
      gold: state.gold + offer.fallback.amount,
      stats: { ...state.stats, goldEarned: state.stats.goldEarned + offer.fallback.amount },
    },
    offer: settledOffer,
    outcome: { kind: 'grantGold', amount: offer.fallback.amount, fellBack: true },
  };
}

function ownedCardByInstance(state: RunState, instanceId: string): RunCard | undefined {
  return ownedCardsMatchingV3(state, 'any', {}).find((card) => card.instanceId === instanceId);
}

function upgradeOwnedInstance(state: RunState, instanceId: string, to: SkillTier): RunState {
  const boardIndex = state.pieces.findIndex((card) => card.instanceId === instanceId);
  if (boardIndex >= 0) {
    return {
      ...state,
      pieces: state.pieces.map((card, index) => (index === boardIndex ? { ...card, tier: to } : card)),
    };
  }
  const bagIndex = state.bagSlots.findIndex((card) => card?.instanceId === instanceId);
  if (bagIndex >= 0) {
    return {
      ...state,
      bagSlots: state.bagSlots.map((card, index) => (
        index === bagIndex && card !== null ? { ...card, tier: to } : card
      )),
    };
  }
  if (state.held?.instanceId === instanceId) return { ...state, held: { ...state.held, tier: to } };
  return state;
}

export function settleTargetedUpgradeV3(
  state: RunState,
  offer: Extract<EventDeferredOfferV3, { kind: 'upgradeCardTargeted' }>,
  selectedInstanceId?: string,
): TargetedUpgradeSettlementResultV3 {
  if (offer.status === 'settled') {
    return { state, offer, outcome: { kind: 'alreadySettled' } };
  }
  let selected = selectedInstanceId;
  if (selected === undefined) {
    if (offer.optionInstanceIds.length === 0) return settleUpgradeFallback(state, offer);
    if (offer.optionInstanceIds.length > 1) return { state, offer };
    selected = offer.optionInstanceIds[0]!;
  }
  if (!offer.optionInstanceIds.includes(selected)) return settleUpgradeFallback(state, offer);
  const card = ownedCardByInstance(state, selected);
  const to = card === undefined ? null : nextSkillTier(card.tier);
  if (card === undefined || to === null) return settleUpgradeFallback(state, offer);
  const settledOffer: Extract<EventDeferredOfferV3, { kind: 'upgradeCardTargeted'; status: 'settled' }> = {
    ...offer,
    status: 'settled',
    selectedInstanceId: selected,
  };
  return {
    state: upgradeOwnedInstance(state, selected, to),
    offer: settledOffer,
    outcome: {
      kind: 'cardUpgraded', instanceId: selected, skillId: card.skillId, from: card.tier, to,
    },
  };
}
