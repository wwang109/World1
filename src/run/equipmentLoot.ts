import { equipmentLootConfig as config } from '../data/equipmentLootConfig';
import { enemyBookFromJson } from '../data/enemiesContent';
import { equipmentCatalog, equipmentDocument } from '../data/equipmentContent';
import { validateEquipmentLoot } from '../data/validateEquipmentLoot';
import type { EquipmentLootEntry } from '../engine/equipment/types';
import { hashSeed, Rng } from '../engine/rng';
import type { RunState } from './runState';
import type { EquipmentRewardReceipt, OwnedEquipmentItem } from './equipmentInventory';

export const equipmentLootConfig = config;
export function equipmentDropPercent(pool: readonly EquipmentLootEntry[], chanceBps: number, ref: Pick<EquipmentLootEntry, 'itemId' | 'itemVersion' | 'setVersion'>): number {
  const total = pool.reduce((sum, entry) => sum + entry.weight, 0);
  const weight = pool.filter(entry => pin(entry) === pin({ ...ref, weight: 0 })).reduce((sum, entry) => sum + entry.weight, 0);
  return total > 0 ? chanceBps / 100 * weight / total : 0;
}
export function preferredEventEquipmentPool(entries: readonly EquipmentLootEntry[], ownedEquipment: readonly Pick<OwnedEquipmentItem, 'itemId'>[]): readonly EquipmentLootEntry[] {
  const owned = new Set(ownedEquipment.map(item => item.itemId));
  const unowned = entries.filter(entry => !owned.has(entry.itemId));
  return unowned.length ? unowned : entries;
}
function pin(entry: EquipmentLootEntry): string { return `${entry.itemId}@${entry.itemVersion}:${entry.setVersion ?? '-'}`; }
export function encounterEquipmentPool(enemyIds: readonly string[]): EquipmentLootEntry[] {
  const entries = new Map<string, EquipmentLootEntry>();
  for (const id of enemyIds) {
    const enemy = enemyBookFromJson[id];
    const fallback = equipmentDocument.items.filter(item => item.versions.at(-1)!.def.dropEligibility.sourceKinds.includes('fight')).map(item => {
      const current = item.versions.at(-1)!;
      const set = equipmentDocument.sets.find(set => set.id === current.def.setId);
      return { itemId: item.id, itemVersion: current.version, weight: 1,
        ...(set ? { setVersion: set.versions.at(-1)!.version } : {}) };
    });
    for (const entry of enemy?.equipmentDrop?.pool ?? fallback) {
      const key = pin(entry);
      if (!entries.has(key) || entries.get(key)!.weight < entry.weight) entries.set(key, { ...entry });
    }
  }
  return [...entries.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([,entry]) => entry);
}
export function awardEquipment(state: RunState, sourceKind: 'fight' | 'event', sourceId: string,
  pool: readonly EquipmentLootEntry[], chanceBps: number): RunState {
  const id = `${sourceKind}:${sourceId}`;
  if ((state.equipmentRewardReceipts ?? []).some(receipt => receipt.id === id)) return state;
  if (!Number.isSafeInteger(chanceBps) || chanceBps < 0 || chanceBps > 10000) throw new Error('Invalid equipment chance');
  if (pool.length && validateEquipmentLoot({ pool }, equipmentCatalog, sourceKind).length) throw new Error('Invalid equipment loot pool');
  const rng = new Rng(hashSeed('equipmentLoot:v1', state.seed, id));
  const rolled = rng.int(10000);
  let item: OwnedEquipmentItem | null = null;
  if (rolled < chanceBps && pool.length) {
    let pick = rng.int(pool.reduce((sum, entry) => sum + entry.weight, 0));
    const chosen = pool.find(entry => { pick -= entry.weight; return pick < 0; })!;
    item = { instanceId: `equipment:${id}`, itemId: chosen.itemId, itemVersion: chosen.itemVersion,
      ...(chosen.setVersion === undefined ? {} : { setVersion: chosen.setVersion }) };
  }
  const receipt: EquipmentRewardReceipt = { id, sourceKind, sourceId, item, chanceBps, rolled };
  return { ...state, ownedEquipment: [...(state.ownedEquipment ?? []), ...(item ? [item] : [])],
    equipmentRewardReceipts: [...(state.equipmentRewardReceipts ?? []), receipt] };
}
export function awardBattleEquipment(state: RunState, battleId: string, enemyIds: readonly string[], won: boolean): RunState {
  if (!won) return state;
  return awardEquipment(state, 'fight', battleId, encounterEquipmentPool(enemyIds), config.fightChanceBps);
}
export function awardCompletedEventEquipment(previous: RunState | null, next: RunState): RunState {
  if (!previous || previous.seed !== next.seed || !previous.currentNodeId) return next;
  const instance = previous.eventInstances[previous.currentNodeId];
  if (!instance) return next;
  const resolution = next.eventResolutions?.[previous.currentNodeId];
  if (!resolution || resolution.pending || next.activeChallengeFight || resolution.instanceId !== instance.instanceId
    || resolution.eventId !== instance.eventId || resolution.contentVersion !== instance.contentVersion) return next;
  const pool = eventEquipmentPool(instance.eventId, instance.contentVersion, resolution.choiceId);
  if (!pool) return next;
  return awardEquipment(next, 'event', instance.instanceId, preferredEventEquipmentPool(pool.entries, next.ownedEquipment ?? []), pool.chanceBps);
}
export function eventEquipmentPool(eventId: string, eventVersion: number, choiceId: string): { entries: readonly EquipmentLootEntry[]; chanceBps: number } | undefined {
  const entry = config.events.find(event => event.eventId === eventId && event.eventVersion === eventVersion);
  return entry?.choiceIds.includes(choiceId) ? { entries: entry.pool, chanceBps: entry.chanceBps } : undefined;
}
