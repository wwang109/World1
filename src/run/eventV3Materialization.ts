import {
  isAmbientEventDefV3,
  type EventBoundSubjectsV3,
  type EventChoiceV3,
  type LoadedEventDefV3,
} from '../data/eventContentV3';
import { biomeIds } from '../data/biomes';
import { hashSeed } from '../engine/rng';
import type { SkillTier } from '../engine/types';

export interface EventCardOfferV3 {
  skillId: string;
  tier: SkillTier;
}

export interface EventSellGemOfferV3 {
  pouchIndex: number;
  gemId: string;
  price: number;
}

export interface EventMergeInputV3 {
  instanceId: string;
  skillId: string;
  tier: SkillTier;
  location: 'board' | 'bag';
  index: number;
}

type PendingOrSettledV3 =
  | { status: 'pending' }
  | { status: 'settled'; selectedId?: string };

export type EventDeferredOfferV3 =
  | {
    kind: 'cardChoice';
    options: readonly [EventCardOfferV3, EventCardOfferV3, EventCardOfferV3];
    status: 'pending';
  }
  | {
    kind: 'cardChoice';
    options: readonly [EventCardOfferV3, EventCardOfferV3, EventCardOfferV3];
    status: 'settled';
    selectedSkillId: string;
  }
  | {
    kind: 'upgradeCardTargeted';
    optionInstanceIds: readonly string[];
    fallback: { kind: 'grantGold'; amount: number } | { kind: 'nothing' };
    status: 'pending';
  }
  | {
    kind: 'upgradeCardTargeted';
    optionInstanceIds: readonly string[];
    fallback: { kind: 'grantGold'; amount: number } | { kind: 'nothing' };
    status: 'settled';
    selectedInstanceId?: string;
  }
  | ({ kind: 'grantCard'; card: EventCardOfferV3 } & PendingOrSettledV3)
  | ({ kind: 'grantGem'; gemId: string } & PendingOrSettledV3)
  | ({ kind: 'bonusDraft'; options: readonly EventCardOfferV3[] } & PendingOrSettledV3)
  | ({ kind: 'gemChoice'; optionGemIds: readonly [string, string, string] } & PendingOrSettledV3)
  // The market's stat picker (2026-09-25) — options are the closed
  // `MarketStat` enum, never rolled, so there is nothing to persist beyond
  // the pick itself: `selectedId` (from `PendingOrSettledV3`) carries the
  // bought `MarketStat` once settled. `src/run/eventsV3.ts`'s
  // `applyDirectOutcome` resets this to a fresh `pending` offer every time
  // the `buyStatPick` choice is taken, so a settled offer never blocks a
  // second buy at the same node.
  | ({ kind: 'buyStatPick' } & PendingOrSettledV3)
  | ({ kind: 'upgradeCard'; optionInstanceIds: readonly string[]; fallback: { kind: 'grantGold'; amount: number } } & PendingOrSettledV3)
  | { kind: 'sellGem'; status: 'unavailable' }
  | ({ kind: 'sellGem'; options: readonly EventSellGemOfferV3[] } & PendingOrSettledV3)
  | { kind: 'mergeCards'; status: 'unavailable' }
  | ({
    kind: 'mergeCards';
    from: SkillTier;
    to: SkillTier;
    consumed: readonly EventMergeInputV3[];
    candidates: readonly EventCardOfferV3[];
    fallback: { kind: 'grantGold'; amount: number };
  } & PendingOrSettledV3);

/** Closed machine reason persisted before presentation. English belongs to
 * the view model so save bytes never become UI copy. */
export type EventChoiceUnavailableReasonV3 = 'no_unvisited_biome';

export interface EventMaterializationRecord {
  eventInstanceId: string;
  choiceIds: readonly [string, string] | readonly [string, string, string];
  selectedWeightedBranchIds: Readonly<Record<string, string>>;
  unavailableChoiceReasonsByChoiceId: Readonly<Record<string, EventChoiceUnavailableReasonV3>>;
  boundSubjects: Readonly<EventBoundSubjectsV3>;
  deferredOffersByChoiceId: Readonly<Record<string, EventDeferredOfferV3>>;
}

/** Dynamic destination subjects are authored as catalog identities, never
 * free-form strings. Absence remains valid for the closed no-candidate path. */
export function hasCanonicalDynamicDestinationV3(
  subjects: Pick<EventBoundSubjectsV3, 'destination_biome'>,
): boolean {
  const destinationBiome = subjects.destination_biome;
  return destinationBiome === undefined
    || (destinationBiome.length > 0 && biomeIds.includes(destinationBiome));
}

/** Syntactic guard for the persisted reason-map envelope. Event-aware callers
 * must additionally use hasExactUnavailableChoiceReasonsV3. An absent field is
 * the one supported pre-field development-save shape; a present field must be
 * a closed map over committed choices. */
export function hasClosedUnavailableChoiceReasonsV3(
  materialization: Pick<EventMaterializationRecord, 'choiceIds'> & {
    unavailableChoiceReasonsByChoiceId?: unknown;
  },
): boolean {
  const reasons = materialization.unavailableChoiceReasonsByChoiceId;
  if (reasons === undefined) return true;
  if (reasons === null || typeof reasons !== 'object' || Array.isArray(reasons)) return false;
  for (const [choiceId, reason] of Object.entries(reasons)) {
    if (!materialization.choiceIds.includes(choiceId) || reason !== 'no_unvisited_biome') return false;
  }
  return true;
}

/** Validate the semantic reason map against the authored producer/consumer
 * topology and this materialization's persisted subject. The map is the full
 * expected set: no missing lock and no fabricated lock is accepted. */
export function hasExactUnavailableChoiceReasonsV3(
  event: LoadedEventDefV3,
  materialization: Pick<EventMaterializationRecord, 'choiceIds' | 'boundSubjects'> & {
    unavailableChoiceReasonsByChoiceId?: unknown;
  },
): boolean {
  if (!hasClosedUnavailableChoiceReasonsV3(materialization)) return false;
  if (!hasCanonicalDynamicDestinationV3(materialization.boundSubjects)) return false;
  const allChoices = [...event.choiceSet.fixed, ...(event.choiceSet.pool?.entries ?? [])];
  const committedChoices: EventChoiceV3[] = [];
  for (const choiceId of materialization.choiceIds) {
    const choice = allChoices.find((candidate) => candidate.id === choiceId);
    if (choice === undefined) return false;
    committedChoices.push(choice);
  }

  const hasFutureBiomeProducer = isAmbientEventDefV3(event)
    && (event.bindings ?? []).some((binding) => (
      binding.as === 'destination_biome'
      && binding.source === 'journey.futureBiome'
      && binding.candidates === 'unvisited_catalog'
    ));
  const expected = new Set<string>();
  if (hasFutureBiomeProducer && materialization.boundSubjects.destination_biome === undefined) {
    for (const choice of committedChoices) {
      if (choice.callback?.bind.some((binding) => binding.as === 'destination_biome') === true) {
        expected.add(choice.id);
      }
    }
  }

  const reasons = materialization.unavailableChoiceReasonsByChoiceId;
  const actual = reasons === undefined ? [] : Object.keys(reasons as Record<string, unknown>);
  return actual.length === expected.size && actual.every((choiceId) => expected.has(choiceId));
}

/** Pure preview of the exact authored choices a reached instance will display.
 * Selection and materialization share this authority; it consumes no RNG or
 * mutable bag state. */
export function previewEventChoicesV3(
  mapSeed: number,
  instanceId: string,
  event: LoadedEventDefV3,
): readonly EventChoiceV3[] {
  const fixed = [...event.choiceSet.fixed];
  const pool = event.choiceSet.pool?.entries ?? [];
  if (pool.length === 0) return fixed;
  const selectedIndex = hashSeed(mapSeed, 'event-v3-choice-pool', instanceId) % pool.length;
  return [...fixed, pool[selectedIndex]!];
}

export interface EventStoryStateV3 {
  oath_mercy: boolean;
  grave_path: 'none' | 'opened' | 'answered';
  honorable_choice: boolean;
  reliquary_oath: boolean;
  oath_gate: 'none' | 'sworn' | 'kept' | 'released';
  venom_bloom: 'none' | 'cultivated';
  rival_spared: boolean;
  moon_quarry_released: boolean;
}

export const INITIAL_EVENT_STORY_STATE_V3: EventStoryStateV3 = {
  oath_mercy: false,
  grave_path: 'none',
  honorable_choice: false,
  reliquary_oath: false,
  oath_gate: 'none',
  venom_bloom: 'none',
  rival_spared: false,
  moon_quarry_released: false,
};
