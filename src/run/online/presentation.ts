import { skillBook } from '../../data/skills';
import { gemBook } from '../../data/gems';
import { equipmentDocument, equipmentCatalog } from '../../data/equipmentContent';
import { loadedEventCatalogFromJson } from '../../data/eventsContent';
import type { RevisionKey, RunContentView } from './types';
import { applyTier,gemHeroStats,resolveDisplayHeroStats } from '../../engine/cards';
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
import {summarizeEffectSegments} from '../skillPresentation';
import {fantasyCardRulesRows} from '../cardRulesRows';
import {buildAutoHeroSetup} from '../encounter';
import {resolveEquipment,applyEquipmentStats} from '../../engine/equipment/resolve';
import {runCalendar} from '../runCalendar';

export function presentRunContent(key: RevisionKey, state: RunState): RunContentView {
  const instance = state.currentNodeId ? state.eventInstances[state.currentNodeId] : undefined;
  const currentEvent = instance ? eventDefAtVersion(instance.eventId, instance.contentVersion) ?? null : null;
  const legacyOffer = currentEvent && !isEventDefV3(currentEvent) ? reopenEventChoice(state)?.outcome ?? null : null;
  const node = state.map.depths.flat().find(node => node.id === state.currentNodeId);
  const draft=state.status==='drafting'?currentStartDraft(state):null;
  const draftIds=new Set(Object.values(draft??{}).flatMap(cards=>cards.map((card:{skillId:string})=>card.skillId)));
  const displayed=Object.values(skillBook).filter(skill=>draftIds.has(skill.id));
  const hero=state.status==='drafting'?buildAutoHeroSetup(state.heroLevel,state.pieces,state.heroAllocation,state.purchasedStats).setup:null;
  const equipment=hero?resolveEquipment(state.equippedEquipment??[],state.pieces.map(piece=>skillBook[piece.skillId]!),equipmentCatalog):null;
  const calendar=runCalendar(state);
  return {draftHud:hero?{heroStats:resolveDisplayHeroStats(applyEquipmentStats(hero.stats,equipment!,{fullHpAtBattleSetup:true}),state.pieces),heroGemAdds:gemHeroStats(state.pieces),day:calendar.stop,wave:calendar.absoluteDay,bankedPL:bankedPL(state.heroLevel,state.heroAllocation)}:undefined, economy: {
    bankedPL: bankedPL(state.heroLevel, state.heroAllocation), statCosts: structuredClone(LEVEL_STAT_COST),
    shopReroll: node?.kind === 'shop' ? rerollCostForNode(state, node.id) : null,
    mergeSlot: node?.kind === 'shop' ? mergeSlotPriceForNode(state, node.id) : null,
    mergeSlotAvailable: node?.kind === 'shop' && mergeSlotAvailable(state, node.id),
    cardSales: Object.fromEntries([...state.pieces, ...state.bagSlots.filter(card => card !== null)].map(card => [card.instanceId, sellPriceOfCard(card.tier)])),
    gemSales: state.gemInventory.map(sellPriceOfGem), forgeCost: FORGE_COST,
    upgrades: Object.fromEntries((state.ownedEquipment ?? []).map(item => [item.instanceId, { cost: equipmentUpgradeCost(item.level ?? 0), maxed: (item.level ?? 0) >= EQUIPMENT_MAX_LEVEL }])),
    salvageGains: Object.fromEntries((state.ownedEquipment ?? []).map(item => [item.instanceId, (salvageEquipment(state, item.instanceId).brokenEquipment ?? 0) - (state.brokenEquipment ?? 0)])),
  }, boardSlots: HERO_BOARD_SLOTS, art: structuredClone(artManifest), draft,
    draftPicks: state.status === 'drafting' ? startDraftPicks(state) : {}, biomePick: biomePickViewModelFor(state), choices: availableChoices(state), currentEvent, legacyOffer,
    event: currentEvent && node ? buildRunEventViewModel(state, node, currentEvent, eventDefAtVersion) ?? null : null,
    skills: structuredClone(skillBook), cardTiers: Object.fromEntries(displayed.flatMap(skill => TIER_ORDER.filter(tier => TIER_ORDER.indexOf(tier) >= TIER_ORDER.indexOf(skill.tier)).map(tier => [`${skill.id}:${tier}`, applyTier(skill, tier)]))),
    cardFaces:Object.fromEntries(displayed.flatMap(skill=>TIER_ORDER.filter(tier=>TIER_ORDER.indexOf(tier)>=TIER_ORDER.indexOf(skill.tier)).map(tier=>{const shown=applyTier(skill,tier);return [`${skill.id}:${tier}`,{rows:fantasyCardRulesRows(shown),desktop:summarizeEffectSegments(shown,undefined,'composition'),mobile:summarizeEffectSegments(shown,undefined,'summed')}];}))),
    gems: structuredClone(gemBook), equipment: structuredClone(equipmentDocument),
    events: Object.values(loadedEventCatalogFromJson), artBase: `/content/${key.contentSha}/`,
    cardText: Object.fromEntries(Object.values(skillBook).flatMap(skill => TIER_ORDER.map(tier => [`${skill.id}:${tier}`, renderSkillText(applyTier(skill, tier))]))),
    gemText: Object.fromEntries(Object.values(gemBook).map(gem => [gem.id, renderGemText(gem)])),
    keywordRules: ACTION_KINDS.flatMap(kind => { const entry = ruleEntryByKind(kind); return entry ? [entry] : []; }) };
}
