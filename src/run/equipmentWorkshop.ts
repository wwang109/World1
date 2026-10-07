import { equipmentCatalog, equipmentDocument } from '../data/equipmentContent';
import type { EquipmentLootEntry } from '../engine/equipment/types';
import { EQUIPMENT_MAX_LEVEL, equipmentUpgradeCost } from '../engine/equipment/upgrade';
import type { OwnedEquipmentItem } from './equipmentInventory';
import type { RunState } from './runState';

export const FORGE_COST = 3;

export interface EquipmentWorkshopSpec { sets: readonly string[]; items?: readonly string[] }
export type EquipmentForgeOption = Omit<EquipmentLootEntry, 'weight'>;
export interface EquipmentUpgradeOption {
  instanceId: string;
  itemId: string;
  itemVersion: number;
  level: number;
  cost: number;
  affordable: boolean;
}

function inWorkshop(spec: EquipmentWorkshopSpec, itemId: string, itemVersion: number): boolean {
  const def = equipmentCatalog.item(itemId, itemVersion);
  return (def.setId !== undefined && spec.sets.includes(def.setId)) || (spec.items ?? []).includes(itemId);
}

export function brokenPieces(state: Pick<RunState, 'brokenEquipment'>): number {
  return state.brokenEquipment ?? 0;
}

export function forgeOptions(spec: EquipmentWorkshopSpec): EquipmentForgeOption[] {
  return equipmentDocument.items.flatMap((item) => {
    const current = item.versions.at(-1)!;
    if (!inWorkshop(spec, item.id, current.version)) return [];
    const set = current.def.setId === undefined ? undefined : equipmentDocument.sets.find((entry) => entry.id === current.def.setId);
    return [{ itemId: item.id, itemVersion: current.version, ...(set ? { setVersion: set.versions.at(-1)!.version } : {}) }];
  });
}

export function upgradeOptions(state: RunState, spec: EquipmentWorkshopSpec): EquipmentUpgradeOption[] {
  return (state.ownedEquipment ?? []).flatMap((item) => {
    if (!inWorkshop(spec, item.itemId, item.itemVersion)) return [];
    const level = item.level ?? 0;
    if (level >= EQUIPMENT_MAX_LEVEL) return [];
    const cost = equipmentUpgradeCost(level);
    return [{ instanceId: item.instanceId, itemId: item.itemId, itemVersion: item.itemVersion, level, cost, affordable: cost <= brokenPieces(state) }];
  });
}

export function canForge(state: RunState, spec: EquipmentWorkshopSpec): boolean {
  return brokenPieces(state) >= FORGE_COST && forgeOptions(spec).length > 0;
}

export function canUpgrade(state: RunState, spec: EquipmentWorkshopSpec): boolean {
  return upgradeOptions(state, spec).some((option) => option.affordable);
}

export function forgeEquipment(state: RunState, spec: EquipmentWorkshopSpec, itemId: string, sourceId: string): { state: RunState; item: OwnedEquipmentItem } | undefined {
  const option = forgeOptions(spec).find((entry) => entry.itemId === itemId);
  if (option === undefined || brokenPieces(state) < FORGE_COST) return undefined;
  const taken = new Set([...(state.ownedEquipment ?? []).map((item) => item.instanceId), ...(state.spentEquipment ?? [])]);
  let ordinal = 1;
  while (taken.has(`forge:${sourceId}:${ordinal}`)) ordinal += 1;
  const item: OwnedEquipmentItem = { instanceId: `forge:${sourceId}:${ordinal}`, ...option };
  return {
    state: { ...state, ownedEquipment: [...(state.ownedEquipment ?? []), item], brokenEquipment: brokenPieces(state) - FORGE_COST },
    item,
  };
}

export function upgradeEquipment(state: RunState, spec: EquipmentWorkshopSpec, instanceId: string): { state: RunState; level: number; itemId: string; itemVersion: number } | undefined {
  const option = upgradeOptions(state, spec).find((entry) => entry.instanceId === instanceId);
  if (option === undefined || !option.affordable) return undefined;
  const level = option.level + 1;
  return {
    state: {
      ...state,
      brokenEquipment: brokenPieces(state) - option.cost,
      ownedEquipment: (state.ownedEquipment ?? []).map((item) => (item.instanceId === instanceId ? { ...item, level } : item)),
      equippedEquipment: (state.equippedEquipment ?? []).map((ref) => (ref.instanceId === instanceId ? { ...ref, level } : ref)),
    },
    level,
    itemId: option.itemId,
    itemVersion: option.itemVersion,
  };
}
