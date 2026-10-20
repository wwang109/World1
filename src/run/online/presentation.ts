import { skillBook } from '../../data/skills';
import { gemBook } from '../../data/gems';
import { equipmentDocument } from '../../data/equipmentContent';
import { loadedEventCatalogFromJson } from '../../data/eventsContent';
import type { RevisionKey, RunContentView } from './types';
import { applyTier } from '../../engine/cards';
import { TIER_ORDER } from '../../engine/types';
import { renderSkillText } from '../../engine/keywords/compose';
import { renderGemText } from '../../engine/keywords/gemText';
import { ACTION_KINDS, ruleEntryByKind } from '../../engine/keywords/text';
import { artManifest } from '../../data/artManifest';
import { availableChoices, currentStartDraft, startDraftPicks, rerollCostForNode, mergeSlotPriceForNode, mergeSlotAvailable, type RunState } from '../runState';
import { biomePickViewModelFor } from '../biomePickViewModel';
import { eventDefAtVersion } from '../../data/eventsContent';
import { reopenEventChoice } from '../events';
import { isEventDefV3 } from '../../data/eventContentV3';
import { buildRunEventViewModel } from '../runEventViewModel';
import { HERO_BOARD_SLOTS } from '../../data/heroes';
import { bankedPL, LEVEL_STAT_COST } from '../leveling';
import { sellPriceOfCard, sellPriceOfGem } from '../shop';
import { FORGE_COST } from '../equipmentWorkshop';
import { EQUIPMENT_MAX_LEVEL, equipmentUpgradeCost } from '../../engine/equipment/upgrade';
import { salvageEquipment } from '../equipmentInventory';

export function presentRunContent(key: RevisionKey, state: RunState): RunContentView {
  const instance = state.currentNodeId ? state.eventInstances[state.currentNodeId] : undefined;
  const currentEvent = instance ? eventDefAtVersion(instance.eventId, instance.contentVersion) ?? null : null;
  const legacyOffer = currentEvent && !isEventDefV3(currentEvent) ? reopenEventChoice(state)?.outcome ?? null : null;
  const node = state.map.depths.flat().find(node => node.id === state.currentNodeId);
  return { economy: {
    bankedPL: bankedPL(state.heroLevel, state.heroAllocation), statCosts: structuredClone(LEVEL_STAT_COST),
    shopReroll: node?.kind === 'shop' ? rerollCostForNode(state, node.id) : null,
    mergeSlot: node?.kind === 'shop' ? mergeSlotPriceForNode(state, node.id) : null,
    mergeSlotAvailable: node?.kind === 'shop' && mergeSlotAvailable(state, node.id),
    cardSales: Object.fromEntries([...state.pieces, ...state.bagSlots.filter(card => card !== null)].map(card => [card.instanceId, sellPriceOfCard(card.tier)])),
    gemSales: state.gemInventory.map(sellPriceOfGem), forgeCost: FORGE_COST,
    upgrades: Object.fromEntries((state.ownedEquipment ?? []).map(item => [item.instanceId, { cost: equipmentUpgradeCost(item.level ?? 0), maxed: (item.level ?? 0) >= EQUIPMENT_MAX_LEVEL }])),
    salvageGains: Object.fromEntries((state.ownedEquipment ?? []).map(item => [item.instanceId, (salvageEquipment(state, item.instanceId).brokenEquipment ?? 0) - (state.brokenEquipment ?? 0)])),
  }, boardSlots: HERO_BOARD_SLOTS, art: structuredClone(artManifest), draft: state.status === 'drafting' ? currentStartDraft(state) : null,
    draftPicks: state.status === 'drafting' ? startDraftPicks(state) : {}, biomePick: biomePickViewModelFor(state), choices: availableChoices(state), currentEvent, legacyOffer,
    event: currentEvent && node ? buildRunEventViewModel(state, node, currentEvent, eventDefAtVersion) ?? null : null,
    skills: structuredClone(skillBook), gems: structuredClone(gemBook), equipment: structuredClone(equipmentDocument),
    events: Object.values(loadedEventCatalogFromJson), artBase: `/content/${key.contentSha}/`,
    cardText: Object.fromEntries(Object.values(skillBook).flatMap(skill => TIER_ORDER.map(tier => [`${skill.id}:${tier}`, renderSkillText(applyTier(skill, tier))]))),
    gemText: Object.fromEntries(Object.values(gemBook).map(gem => [gem.id, renderGemText(gem)])),
    keywordRules: ACTION_KINDS.flatMap(kind => { const entry = ruleEntryByKind(kind); return entry ? [entry] : []; }) };
}
