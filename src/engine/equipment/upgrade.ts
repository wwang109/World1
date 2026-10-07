import { EQUIPMENT_STAT_KEYS } from './registry';
import type { EquipmentDef, EquipmentStat, EquipmentStatMods } from './types';

export const EQUIPMENT_MAX_LEVEL = 5;
const HP_UPGRADE_GAIN = 5;

export function equipmentUpgradeStat(item: EquipmentDef): EquipmentStat {
  return EQUIPMENT_STAT_KEYS.find((key) => key !== 'maxHp' && item.statMods[key] !== undefined) ?? 'maxHp';
}

export function equipmentUpgradeGain(stat: EquipmentStat): number {
  return stat === 'maxHp' ? HP_UPGRADE_GAIN : 1;
}

export function equipmentUpgradeCost(level: number): number {
  return level + 1;
}

export function leveledStatMods(item: EquipmentDef, level: number): EquipmentStatMods {
  if (level <= 0) return item.statMods;
  const stat = equipmentUpgradeStat(item);
  return { ...item.statMods, [stat]: (item.statMods[stat] ?? 0) + level * equipmentUpgradeGain(stat) };
}
