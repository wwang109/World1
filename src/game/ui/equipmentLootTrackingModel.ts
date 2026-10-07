import { equipmentCatalog } from '../../data/equipmentContent';
import { equipmentItemPinKey, type EquipmentItemPin } from '../../data/equipmentLootSources';
import { equipmentLootConfig } from '../../data/equipmentLootConfig';
import { eventDefAtVersion } from '../../data/eventsContent';
import { isEventDefV3 } from '../../data/eventContentV3';
import type { EquipmentTrackingGoal } from '../../meta/equipmentTracking';
import { readEquipmentTracking } from '../equipmentTrackingStore';
import { encounterEquipmentPool, equipmentDropPercent, eventEquipmentPool, preferredEventEquipmentPool } from '../../run/equipmentLoot';
import type { RunState } from '../../run/runState';

export interface EquipmentLootChance { ref: EquipmentItemPin; name: string; percent: number; condition: string }
export function equipmentChanceText(percent: number): string {
  if (percent > 0 && percent < 0.01) return '<0.01%';
  return `${percent.toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1')}%`;
}
export function encounterLootChances(enemyIds: readonly string[]): EquipmentLootChance[] {
  const pool = encounterEquipmentPool(enemyIds);
  return pool.map(ref => ({ ref, name: equipmentCatalog.item(ref.itemId, ref.itemVersion).name,
    percent: equipmentDropPercent(pool, equipmentLootConfig.fightChanceBps, ref), condition: 'On victory' }));
}
export function eventItemChances(state: RunState, ref: EquipmentItemPin, eventId: string, version?: number): EquipmentLootChance[] {
  const source = equipmentLootConfig.events.find(event => event.eventId === eventId && (version === undefined || event.eventVersion === version));
  if (!source) return [];
  const def = eventDefAtVersion(eventId, source.eventVersion)!;
  const choices = isEventDefV3(def) ? def.choiceSet.fixed ?? [] : def.choices;
  return source.choiceIds.map(choiceId => {
    const reward = eventEquipmentPool(eventId, source.eventVersion, choiceId)!;
    const pool = preferredEventEquipmentPool(reward.entries, state.ownedEquipment ?? []);
    return { ref, name: equipmentCatalog.item(ref.itemId, ref.itemVersion).name,
      percent: equipmentDropPercent(pool, reward.chanceBps, ref),
      condition: choices.find(choice => choice.id === choiceId)?.label ?? choiceId };
  });
}
export function trackedEncounterLoot(enemyIds: readonly string[], goals = readEquipmentTracking()): EquipmentLootChance[] {
  const keys = new Set(goals.filter(goal => goal.enemies).map(equipmentItemPinKey));
  return encounterLootChances(enemyIds).filter(item => keys.has(equipmentItemPinKey(item.ref)));
}
export function trackedEventLoot(state: RunState, eventId: string, version?: number, goals: readonly EquipmentTrackingGoal[] = readEquipmentTracking()): EquipmentLootChance[] {
  return goals.filter(goal => goal.events).flatMap(goal => eventItemChances(state, goal, eventId, version)
    .filter(item => equipmentLootConfig.events.some(event => event.eventId === eventId && (version === undefined || event.eventVersion === version)
      && event.pool.some(entry => equipmentItemPinKey(entry) === equipmentItemPinKey(goal)))));
}
export function trackedLootSummary(items: readonly EquipmentLootChance[]): string {
  const first = items[0];
  if (!first) return '';
  const count = new Set(items.map(item => equipmentItemPinKey(item.ref))).size;
  return `\u25ce TRACKED \u00b7 ${first.name} ${equipmentChanceText(first.percent)}${count > 1 ? ` +${count - 1}` : ''} \u203a`;
}
