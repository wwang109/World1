import { EQUIPMENT_EFFECT_KEYS, EQUIPMENT_EFFECT_REGISTRY, EQUIPMENT_SELECTOR_KEYS, EQUIPMENT_SELECTOR_REGISTRY, EQUIPMENT_STAT_KEYS, EQUIPMENT_STAT_REGISTRY } from './registry';
import type { EquipmentDef, EquipmentEffectMods, EquipmentSetDef, EquipmentStatMods } from './types';

export function equipmentModifierClauses(stats: EquipmentStatMods = {}, effects: EquipmentEffectMods = {}): string[] {
  return [
    ...EQUIPMENT_STAT_KEYS.filter((key) => stats[key] !== undefined).map((key) => `${EQUIPMENT_STAT_REGISTRY[key].token} +${stats[key]}`),
    ...EQUIPMENT_EFFECT_KEYS.filter((key) => effects[key] !== undefined).map((key) => EQUIPMENT_EFFECT_REGISTRY[key].clause(effects[key]!)),
  ];
}
export function equipmentItemText(item: EquipmentDef): string {
  return equipmentModifierClauses(item.statMods).join(' · ');
}
export function equipmentSetText(set: EquipmentSetDef): { requirement: string; bonuses: readonly string[] } {
  const match = set.boardRequirement.match;
  const criteria = EQUIPMENT_SELECTOR_KEYS.filter((key) => match[key] !== undefined).map((key) => EQUIPMENT_SELECTOR_REGISTRY[key].clause(match[key]!));
  return {
    requirement: `${set.boardRequirement.minCount} ${criteria.join(' + ')} cards on board`,
    bonuses: set.bonuses.map((bonus) => `${bonus.pieces} pieces${bonus.pieces === 3 ? ' (additional)' : ''}: ${equipmentModifierClauses(bonus.statMods, bonus.effectMods).join(' · ')}`),
  };
}
