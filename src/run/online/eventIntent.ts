import { eventDefAtVersion, type LoadedEventDef } from '../../data/eventsContent';
import { isEventDefV3 } from '../../data/eventContentV3';
import type { EventDef } from '../../data/events';
import type { RunState } from '../runState';
import { leaveEvent, nodeById } from '../runState';
import * as legacy from '../events';
import * as v3 from '../eventsV3';
import { isMarketBuyOutcomeKind, MARKET_VISITS_PER_NODE } from '../market';
import type { EventIntent, EventSelection } from './types';

const legacyLookup = (id: string, version: number): EventDef | undefined => {
  const event = eventDefAtVersion(id, version);
  return event && !isEventDefV3(event) ? event : undefined;
};
function repeatedChoiceAllowed(state: RunState, event: LoadedEventDef): boolean {
  const resolution = legacy.currentEventResolution(state);
  if (!resolution) return true;
  if (resolution.pending) return false;
  const choices = isEventDefV3(event) ? [...event.choiceSet.fixed, ...(event.choiceSet.pool?.entries ?? [])] : event.choices;
  const choice = choices.find(choice => choice.id === resolution.choiceId);
  return !!choice && (v3.isWorkshopOutcomeKind(choice.outcome.kind)
    || (isMarketBuyOutcomeKind(choice.outcome.kind) && (resolution.marketVisits ?? 0) < MARKET_VISITS_PER_NODE));
}
export function applyEventIntent(state: RunState, intent: EventIntent): RunState {
  const node = state.currentNodeId ? nodeById(state, state.currentNodeId) : undefined;
  if (state.status !== 'active' || node?.kind !== 'event' || state.activeChallengeFight) throw new Error('No available current event');
  if (intent.kind === 'eventMaterialize') return legacy.rollEventForNode(state, node, eventDefAtVersion).state;
  const instance = state.eventInstances[node.id];
  if (!instance) throw new Error('Materialize the current event first');
  const event = eventDefAtVersion(instance.eventId, instance.contentVersion);
  if (!event) throw new Error('Event content is unavailable');
  if (intent.kind === 'leaveEvent') {
    if (!legacy.currentEventResolution(state) || legacy.currentEventResolution(state)?.pending) throw new Error('Event has not finished');
    return leaveEvent(state);
  }
  if (intent.instanceId !== instance.instanceId || intent.contentVersion !== instance.contentVersion) throw new Error('Event instance or version changed');
  if (intent.kind === 'eventChoice') {
    if (!repeatedChoiceAllowed(state, event)) throw new Error('Event choice already committed');
    if (isEventDefV3(event)) {
      const result = v3.resolveEventChoiceV3(state, instance.instanceId, intent.choiceId, eventDefAtVersion);
      if (!result.ok) throw new Error('Invalid event choice');
      return result.state;
    }
    return legacy.resolveEventChoice(state, event.id, intent.choiceId, legacyLookup).state;
  }
  if (intent.kind === 'eventCancel') {
    if (!isEventDefV3(event)) throw new Error('Legacy event does not support cancellation');
    return v3.cancelBuyStatPickV3(state, instance.instanceId);
  }
  if (intent.kind === 'eventReopen') {
    if (isEventDefV3(event)) {
      const result = v3.reopenEventChoiceV3(state, instance.instanceId, eventDefAtVersion);
      if (!result || result.offer.status !== 'pending') throw new Error('No pending event offer');
      return state;
    }
    const result = legacy.reopenEventChoice(state, legacyLookup);
    if (!result) throw new Error('No pending event offer');
    return result.state;
  }
  if (intent.kind !== 'eventFinalize') throw new Error('Invalid event operation');
  if (!isEventDefV3(event)) return finalizeLegacy(state, intent.selection);
  const resolution = legacy.currentEventResolution(state);
  const materialization = state.eventMaterializations[instance.instanceId];
  if (!resolution || resolution.instanceId !== instance.instanceId || !materialization) throw new Error('No matching event transaction');
  const offer = v3.correlatedMaterializedChoiceV3(event, materialization, instance.instanceId, resolution.choiceId)?.offer;
  if (!offer || offer.status !== 'pending') throw new Error('No pending offer');
  const s = intent.selection, id = instance.instanceId, choice = resolution.choiceId, lookup = eventDefAtVersion;
  const result = s.kind === 'card' && offer.kind === 'cardChoice' ? v3.finalizeEventCardChoiceV3(state, id, choice, s.skillId, lookup)
    : s.kind === 'card' && offer.kind === 'bonusDraft' ? v3.finalizeBonusDraftV3(state, id, choice, s.skillId, lookup)
    : s.kind === 'upgrade' && offer.kind === 'upgradeCardTargeted' ? v3.finalizeTargetedUpgradeV3(state, id, choice, s.instanceId, lookup)
    : s.kind === 'upgrade' && offer.kind === 'upgradeCard' ? v3.finalizeUpgradeCardV3(state, id, choice, s.instanceId, lookup)
    : s.kind === 'gem' && offer.kind === 'gemChoice' ? v3.finalizeGemChoiceV3(state, id, choice, s.gemId, lookup)
    : s.kind === 'sellGem' && offer.kind === 'sellGem' ? v3.finalizeSellGemV3(state, id, choice, s.pouchIndex, lookup)
    : s.kind === 'mergeCards' && offer.kind === 'mergeCards' ? v3.finalizeMergeCardsV3(state, id, choice, s.skillId, lookup, s.consumedIds)
    : s.kind === 'statPick' && offer.kind === 'buyStatPick' ? v3.finalizeBuyStatPickV3(state, id, choice, s.stat, lookup)
    : s.kind === 'reshape' && offer.kind === 'reshapeCard' ? v3.finalizeReshapeCardV3(state, id, choice, s.instanceId, lookup)
    : s.kind === 'reshapeGem' && offer.kind === 'reshapeGem' ? v3.finalizeReshapeGemV3(state, id, choice, s.optionId, lookup)
    : s.kind === 'reroll' && offer.kind === s.target ? v3.finalizeRerollV3(state, id, choice, s.target, s.step, lookup)
    : s.kind === 'forgeEquipment' && offer.kind === 'forgeEquipment' ? v3.finalizeForgeEquipmentV3(state, id, choice, s.itemId, lookup)
    : s.kind === 'upgradeEquipment' && offer.kind === 'upgradeEquipment' ? v3.finalizeUpgradeEquipmentV3(state, id, choice, s.instanceId, lookup)
    : undefined;
  if (!result?.ok) throw new Error('Invalid event selection');
  return result.state;
}
function finalizeLegacy(state: RunState, selection: EventSelection): RunState {
  const reopened = legacy.reopenEventChoice(state, legacyLookup);
  if (!reopened) throw new Error('No pending legacy offer');
  const outcome = reopened.outcome;
  if (outcome.kind === 'bonusDraft' && selection.kind === 'card') {
    const pick = outcome.cards.find(card => card.skillId === selection.skillId);
    if (pick) return legacy.applyBonusDraftPick(reopened.state, pick).state;
  }
  if (outcome.kind === 'upgradeCardPick' && selection.kind === 'upgrade' && outcome.options.some(option => option.instanceId === selection.instanceId)) return legacy.applyUpgradeCardPick(reopened.state, selection.instanceId).state;
  if (outcome.kind === 'awardCardPointPick' && selection.kind === 'awardCardPoint' && outcome.options.some(option => option.instanceId === selection.instanceId)) return legacy.applyAwardCardPointPick(reopened.state, selection.instanceId).state;
  if (outcome.kind === 'gemChoicePick' && selection.kind === 'gem' && outcome.options.includes(selection.gemId)) return legacy.applyGemChoicePick(reopened.state, selection.gemId).state;
  if (outcome.kind === 'sellGemPick' && selection.kind === 'sellGem' && outcome.options.some(option => option.pouchIndex === selection.pouchIndex)) return legacy.applySellGemPick(reopened.state, selection.pouchIndex).state;
  if (outcome.kind === 'mergeCardsPick' && selection.kind === 'mergeCards' && outcome.candidates.some(option => option.skillId === selection.skillId)) return legacy.applyMergeCardsPick(reopened.state, selection.skillId, selection.consumedIds).state;
  throw new Error('Invalid legacy event selection');
}
