import type { EventReshapeCardSpecV3, EventReshapeGemModeV3, EventReshapeGemSpecV3, EventReshapeModeV3 } from '../data/eventContentV3';
import { enemies } from '../data/enemies';
import { gemBook } from '../data/gems';
import { skillBook } from '../data/skills';
import { hashSeed } from '../engine/rng';
import { cardOfferableAtTier, type Rarity, type SkillDef, type SkillTier } from '../engine/types';
import type { EventCardOfferV3, EventDeferredOfferV3, EventReshapeGemOptionV3, EventReshapeOptionV3 } from './eventV3Materialization';
import { MAX_LEVEL, runBagHasRoomFor, tryInsertPersistedEventRunCard, type RunCard, type RunState } from './runState';
import { cardMatchesFilter, nextSkillTier, SKILL_TIER_ORDER, tierProgressFromAbsolute, TIER_WORTH, absoluteTierValue } from './shop';

type ReshapeOffer = Extract<EventDeferredOfferV3, { kind: 'reshapeCard' }>;
type ReshapeGemOffer = Extract<EventDeferredOfferV3, { kind: 'reshapeGem' }>;
type Fallback = { kind: 'grantGold'; amount: number } | { kind: 'nothing' };

export type EventReshapeSettlementV3 = {
  kind: 'cardReshaped';
  mode: EventReshapeModeV3;
  skillId: string;
  tier: SkillTier;
  resultSkillId?: string;
  resultTier?: SkillTier;
  keptTier?: SkillTier;
  reward?: { kind: 'grantGold'; amount: number } | { kind: 'grantLevel'; level: number };
};

export type EventGemReshapeSettlementV3 = {
  kind: 'gemReshaped';
  mode: EventReshapeGemModeV3;
  gemIds: readonly string[];
  resultGemId: string;
};

const GEM_RARITY_ORDER: readonly Rarity[] = ['common', 'rare', 'epic', 'legendary'];
const SCAVENGE_MAX_OPTIONS = 4;

function ownedCards(state: RunState): RunCard[] {
  return [...state.pieces, ...state.bagSlots.filter((card): card is RunCard => card !== null)];
}

function previousSkillTier(tier: SkillTier): SkillTier | null {
  const index = SKILL_TIER_ORDER.indexOf(tier);
  return index > 0 ? SKILL_TIER_ORDER[index - 1]! : null;
}

function uniqueBook(): SkillDef[] {
  return Object.values(skillBook).filter((skill, index, book) => book.findIndex((entry) => entry.id === skill.id) === index);
}

function tradeTier(from: SkillDef, tier: SkillTier, spec: EventReshapeCardSpecV3): SkillTier {
  if (spec.retypeTo === undefined || !cardMatchesFilter(from, spec.retypeTo)) return tier;
  return nextSkillTier(tier) ?? tier;
}

function resultSkillFor(
  state: RunState,
  spec: EventReshapeCardSpecV3,
  card: RunCard,
  resultTier: SkillTier,
  instanceId: string,
  choiceId: string,
): string | undefined {
  const from = skillBook[card.skillId];
  if (from === undefined) return undefined;
  const typed = spec.mode === 'retype' || spec.mode === 'trade';
  const pool = uniqueBook().filter((skill) => (
    skill.id !== from.id
    && skill.size === from.size
    && cardOfferableAtTier(skill, resultTier)
    && (!typed || spec.retypeTo === undefined || cardMatchesFilter(skill, spec.retypeTo))
    && (spec.mode !== 'retype' || spec.retypeTo === undefined || !cardMatchesFilter(from, spec.retypeTo))
  ));
  if (pool.length === 0) return undefined;
  return pool[hashSeed(state.map.seed, 'event-reshape', instanceId, choiceId, card.instanceId) % pool.length]!.id;
}

function shatterTier(card: RunCard): SkillTier | null {
  const skill = skillBook[card.skillId];
  const lower = previousSkillTier(card.tier);
  return skill !== undefined && lower !== null && cardOfferableAtTier(skill, lower) ? lower : null;
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
    const skill = skillBook[card.skillId];
    if (spec.pickFrom !== undefined && (skill === undefined || !cardMatchesFilter(skill, spec.pickFrom))) continue;
    const base = { instanceId: card.instanceId, skillId: card.skillId, tier: card.tier };
    if (spec.mode === 'transform' || spec.mode === 'retype') {
      const resultSkillId = resultSkillFor(state, spec, card, card.tier, instanceId, choiceId);
      if (resultSkillId !== undefined) options.push({ ...base, resultSkillId });
    } else if (spec.mode === 'trade') {
      if (skill === undefined) continue;
      const resultTier = tradeTier(skill, card.tier, spec);
      const resultSkillId = resultSkillFor(state, spec, card, resultTier, instanceId, choiceId);
      if (resultSkillId !== undefined) options.push({ ...base, resultSkillId, resultTier });
    } else if (spec.mode === 'shatter') {
      const resultTier = shatterTier(card);
      if (resultTier !== null && runBagHasRoomFor(state, card.skillId)) options.push({ ...base, resultTier });
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

function updateCard(state: RunState, instanceId: string, update: (card: RunCard) => RunCard): RunState {
  return {
    ...state,
    pieces: state.pieces.map((card) => (card.instanceId === instanceId ? { ...card, ...update(card) } : card)),
    bagSlots: state.bagSlots.map((card) => (card?.instanceId === instanceId ? update(card) : card)),
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

export function applyEventFallbackV3(
  state: RunState,
  fallback: Fallback,
): { state: RunState; outcome: { kind: 'grantGold'; amount: number; fellBack: true } | { kind: 'nothing'; fellBack: true } } {
  return fallback.kind === 'grantGold'
    ? { state: withGold(state, fallback.amount), outcome: { kind: 'grantGold', amount: fallback.amount, fellBack: true } }
    : { state, outcome: { kind: 'nothing', fellBack: true } };
}

export function reshapeFallbackV3(state: RunState, offer: ReshapeOffer | ReshapeGemOffer) {
  return applyEventFallbackV3(state, offer.fallback);
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
      const resultSkillId = option.resultSkillId;
      if (resultSkillId === undefined || skillBook[resultSkillId] === undefined) return undefined;
      return {
        state: updateCard(state, owned.instanceId, (card) => ({ ...card, skillId: resultSkillId, points: 0 })),
        outcome: { ...base, resultSkillId },
      };
    }
    case 'trade': {
      const resultSkillId = option.resultSkillId;
      const resultTier = option.resultTier;
      if (resultSkillId === undefined || resultTier === undefined || skillBook[resultSkillId] === undefined) return undefined;
      return {
        state: updateCard(state, owned.instanceId, (card) => ({ ...card, skillId: resultSkillId, tier: resultTier, points: 0 })),
        outcome: { ...base, resultSkillId, resultTier },
      };
    }
    case 'shatter': {
      const lower = shatterTier(owned);
      if (lower === null || lower !== option.resultTier) return undefined;
      const kept = tierProgressFromAbsolute(absoluteTierValue({ tier: owned.tier, points: owned.points ?? 0 }) - TIER_WORTH[lower]);
      const split = updateCard(state, owned.instanceId, (card) => ({ ...card, tier: kept.tier, points: kept.points }));
      const inserted = tryInsertPersistedEventRunCard(split, owned.skillId, lower);
      return inserted === null ? undefined : { state: inserted.state, outcome: { ...base, resultTier: lower, keptTier: kept.tier } };
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

function gemsOfRarity(rarity: Rarity): string[] {
  return Object.keys(gemBook).filter((id) => gemBook[id]!.rarity === rarity).sort();
}

function nextGemRarity(rarity: Rarity): Rarity | null {
  const index = GEM_RARITY_ORDER.indexOf(rarity);
  return index >= 0 && index < GEM_RARITY_ORDER.length - 1 ? GEM_RARITY_ORDER[index + 1]! : null;
}

function pickGem(pool: readonly string[], ...salt: (string | number)[]): string | undefined {
  return pool.length === 0 ? undefined : pool[hashSeed(...salt) % pool.length];
}

export function reshapeGemOfferV3(
  state: RunState,
  instanceId: string,
  choiceId: string,
  spec: EventReshapeGemSpecV3,
): Extract<ReshapeGemOffer, { status: 'pending' }> {
  const pouch = state.gemInventory;
  const options: EventReshapeGemOptionV3[] = [];
  const seen = new Set<string>();
  for (let first = 0; first < pouch.length; first += 1) {
    const firstGem = gemBook[pouch[first]!];
    if (firstGem === undefined) continue;
    if (spec.mode === 'transform') {
      if (seen.has(pouch[first]!)) continue;
      seen.add(pouch[first]!);
      const pool = gemsOfRarity(firstGem.rarity).filter((id) => id !== pouch[first]);
      const resultGemId = pickGem(pool, state.map.seed, 'event-gem-reshape', instanceId, choiceId, first);
      if (resultGemId !== undefined) options.push({ id: String(first), pouchIndexes: [first], gemIds: [pouch[first]!], resultGemId });
      continue;
    }
    const target = nextGemRarity(firstGem.rarity);
    if (target === null) continue;
    for (let second = first + 1; second < pouch.length; second += 1) {
      const secondGem = gemBook[pouch[second]!];
      if (secondGem === undefined || secondGem.rarity !== firstGem.rarity) continue;
      const key = [pouch[first]!, pouch[second]!].sort().join('+');
      if (seen.has(key)) continue;
      seen.add(key);
      const resultGemId = pickGem(gemsOfRarity(target), state.map.seed, 'event-gem-fuse', instanceId, choiceId, first, second);
      if (resultGemId !== undefined) {
        options.push({ id: `${first}+${second}`, pouchIndexes: [first, second], gemIds: [pouch[first]!, pouch[second]!], resultGemId });
      }
    }
  }
  return { kind: 'reshapeGem', status: 'pending', mode: spec.mode, options, fallback: { ...spec.fallback } };
}

export function settleReshapeGemV3(
  state: RunState,
  offer: Extract<ReshapeGemOffer, { status: 'pending' }>,
  selectedId: string,
): { state: RunState; outcome: EventGemReshapeSettlementV3 } | undefined {
  const option = offer.options.find((candidate) => candidate.id === selectedId);
  if (option === undefined || gemBook[option.resultGemId] === undefined) return undefined;
  const pouch = [...state.gemInventory];
  const taken: number[] = [];
  for (let index = 0; index < option.gemIds.length; index += 1) {
    const gemId = option.gemIds[index]!;
    const preferred = option.pouchIndexes[index]!;
    const at = pouch[preferred] === gemId && !taken.includes(preferred)
      ? preferred
      : pouch.findIndex((candidate, position) => candidate === gemId && !taken.includes(position));
    if (at < 0) return undefined;
    taken.push(at);
  }
  const gemInventory = pouch.filter((_, position) => !taken.includes(position));
  gemInventory.push(option.resultGemId);
  return {
    state: { ...state, gemInventory },
    outcome: { kind: 'gemReshaped', mode: offer.mode, gemIds: [...option.gemIds], resultGemId: option.resultGemId },
  };
}

export function scavengeOptionsV3(state: RunState): EventCardOfferV3[] {
  const lastWin = [...state.combatFactLedger].reverse().find((entry) => entry.result === 'win');
  if (lastWin === undefined) return [];
  const ids: string[] = [];
  for (const enemyId of lastWin.enemyIds) {
    for (const piece of enemies[enemyId]?.pieces ?? []) {
      const skill = skillBook[piece.skillId];
      if (skill === undefined || ids.includes(skill.id) || !cardOfferableAtTier(skill, 'bronze')) continue;
      ids.push(skill.id);
    }
  }
  return ids.slice(0, SCAVENGE_MAX_OPTIONS).map((skillId) => ({ skillId, tier: 'bronze' as const }));
}
