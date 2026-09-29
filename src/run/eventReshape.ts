import type { EventReshapeCardSpecV3, EventReshapeModeV3 } from '../data/eventContentV3';
import { skillBook } from '../data/skills';
import { hashSeed } from '../engine/rng';
import { cardOfferableAtTier, type SkillTier } from '../engine/types';
import type { EventDeferredOfferV3, EventReshapeOptionV3 } from './eventV3Materialization';
import { MAX_LEVEL, tryInsertPersistedEventRunCard, type RunCard, type RunState } from './runState';
import { cardMatchesFilter } from './shop';

type ReshapeOffer = Extract<EventDeferredOfferV3, { kind: 'reshapeCard' }>;

export type EventReshapeSettlementV3 = {
  kind: 'cardReshaped';
  mode: EventReshapeModeV3;
  skillId: string;
  tier: SkillTier;
  resultSkillId?: string;
  reward?: { kind: 'grantGold'; amount: number } | { kind: 'grantLevel'; level: number };
};

function ownedCards(state: RunState): RunCard[] {
  return [...state.pieces, ...state.bagSlots.filter((card): card is RunCard => card !== null)];
}

function resultSkillFor(
  state: RunState,
  spec: EventReshapeCardSpecV3,
  card: RunCard,
  instanceId: string,
  choiceId: string,
): string | undefined {
  const from = skillBook[card.skillId];
  if (from === undefined) return undefined;
  const pool = Object.values(skillBook).filter((skill, index, book) => (
    book.findIndex((entry) => entry.id === skill.id) === index
    && skill.id !== from.id
    && skill.size === from.size
    && cardOfferableAtTier(skill, card.tier)
    && (spec.mode !== 'retype' || spec.retypeTo === undefined || cardMatchesFilter(skill, spec.retypeTo))
    && (spec.mode !== 'retype' || spec.retypeTo === undefined || !cardMatchesFilter(from, spec.retypeTo))
  ));
  if (pool.length === 0) return undefined;
  return pool[hashSeed(state.map.seed, 'event-reshape', instanceId, choiceId, card.instanceId) % pool.length]!.id;
}

export function reshapeOfferV3(
  state: RunState,
  instanceId: string,
  choiceId: string,
  spec: EventReshapeCardSpecV3,
): Extract<ReshapeOffer, { status: 'pending' }> {
  const cards = ownedCards(state);
  const options: EventReshapeOptionV3[] = [];
  for (const card of cards) {
    if (spec.mode === 'sacrifice' && cards.length <= 1) continue;
    const base = { instanceId: card.instanceId, skillId: card.skillId, tier: card.tier };
    if (spec.mode === 'transform' || spec.mode === 'retype') {
      const resultSkillId = resultSkillFor(state, spec, card, instanceId, choiceId);
      if (resultSkillId !== undefined) options.push({ ...base, resultSkillId });
    } else {
      options.push(base);
    }
  }
  return {
    kind: 'reshapeCard',
    status: 'pending',
    mode: spec.mode,
    options,
    ...(spec.reward === undefined ? {} : { reward: { ...spec.reward } }),
    fallback: { ...spec.fallback },
  };
}

function replaceSkill(state: RunState, instanceId: string, skillId: string): RunState {
  return {
    ...state,
    pieces: state.pieces.map((card) => (card.instanceId === instanceId ? { ...card, skillId, points: 0 } : card)),
    bagSlots: state.bagSlots.map((card) => (card?.instanceId === instanceId ? { ...card, skillId, points: 0 } : card)),
  };
}

function removeCard(state: RunState, instanceId: string): RunState {
  return {
    ...state,
    pieces: state.pieces.filter((card) => card.instanceId !== instanceId),
    bagSlots: state.bagSlots.map((card) => (card?.instanceId === instanceId ? null : card)),
  };
}

function withGold(state: RunState, amount: number): RunState {
  return { ...state, gold: state.gold + amount, stats: { ...state.stats, goldEarned: state.stats.goldEarned + amount } };
}

export function reshapeFallbackV3(
  state: RunState,
  offer: ReshapeOffer,
): { state: RunState; outcome: { kind: 'grantGold'; amount: number; fellBack: true } | { kind: 'nothing'; fellBack: true } } {
  return offer.fallback.kind === 'grantGold'
    ? { state: withGold(state, offer.fallback.amount), outcome: { kind: 'grantGold', amount: offer.fallback.amount, fellBack: true } }
    : { state, outcome: { kind: 'nothing', fellBack: true } };
}

export function settleReshapeV3(
  state: RunState,
  offer: Extract<ReshapeOffer, { status: 'pending' }>,
  selectedInstanceId: string,
): { state: RunState; outcome: EventReshapeSettlementV3 } | undefined {
  const option = offer.options.find((candidate) => candidate.instanceId === selectedInstanceId);
  const owned = ownedCards(state).find((card) => card.instanceId === selectedInstanceId);
  if (option === undefined || owned === undefined || owned.skillId !== option.skillId) return undefined;
  const base = { kind: 'cardReshaped' as const, mode: offer.mode, skillId: owned.skillId, tier: owned.tier };
  switch (offer.mode) {
    case 'transform':
    case 'retype': {
      if (option.resultSkillId === undefined || skillBook[option.resultSkillId] === undefined) return undefined;
      return {
        state: replaceSkill(state, owned.instanceId, option.resultSkillId),
        outcome: { ...base, resultSkillId: option.resultSkillId },
      };
    }
    case 'duplicate': {
      const inserted = tryInsertPersistedEventRunCard(state, owned.skillId, owned.tier);
      return inserted === null ? undefined : { state: inserted.state, outcome: base };
    }
    case 'sacrifice': {
      const removed = removeCard(state, owned.instanceId);
      if (offer.reward === undefined) return { state: removed, outcome: base };
      if (offer.reward.kind === 'grantGold') {
        return { state: withGold(removed, offer.reward.amount), outcome: { ...base, reward: { ...offer.reward } } };
      }
      const level = Math.min(MAX_LEVEL, removed.heroLevel + 1);
      return { state: { ...removed, heroLevel: level }, outcome: { ...base, reward: { kind: 'grantLevel', level } } };
    }
  }
}
