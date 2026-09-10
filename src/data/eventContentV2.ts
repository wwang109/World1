import type { Element, WeaponType } from '../engine/types';
import type { EventChoiceDef, EventDef, EventTheme } from './eventTypes';

export type AffinityId = WeaponType | Element;
export type EventOwnedCardMatchV2 = { weapons: readonly [WeaponType, ...WeaponType[]] };
export type EventRequirementV2 =
  | { all: readonly EventRequirementV2[] }
  | { any: readonly EventRequirementV2[] }
  | { not: EventRequirementV2 }
  | { fact: 'biome.current'; args: { ids: readonly string[] } }
  | { fact: 'board.affinity'; args: { affinityId: AffinityId } }
  | { fact: 'owned.card.count'; args: { where: 'board' | 'bag' | 'held' | 'any'; count: number; match: EventOwnedCardMatchV2 } }
  | { fact: 'callback.queued'; args: { callbackId: string } };

export type EventDeliveryV2 = { kind: 'ambient' } | { kind: 'queued_callback' };
export type EventMutationV2 = { op: 'completeStory'; storyId: string };
export type EventCallbackExpiryFallback = 'discard' | { outcome: { kind: 'grantGold'; amount: number } };

export interface EventCallbackSpec {
  callbackId: string;
  eventId: string;
  contentVersion: number;
  minDepthDelay: number;
  destinationThemes: readonly EventTheme[];
  destinationBiomeIds?: readonly string[];
  priority: number;
  bind: readonly [];
  expiry: { expiresAfterNodes: number; fallback: EventCallbackExpiryFallback };
}

export interface EventChoiceV2 extends EventChoiceDef {
  mutations?: readonly EventMutationV2[];
  callback?: EventCallbackSpec;
}

export interface EventDefV2 extends EventDef {
  story: { storyId: string; stage: 'setup' | 'callback'; role: 'setup' | 'callback' };
  delivery: EventDeliveryV2;
  eligibility: EventRequirementV2;
  visibility: 'visible' | 'hidden_until_eligible' | 'teased_when_due';
  priority: number;
  once: 'node' | 'run';
  cooldownNodes: number;
  choices: readonly EventChoiceV2[];
}

export function isEventDefV2(event: EventDef): event is EventDefV2 {
  return 'delivery' in event;
}
