import type { Archetype, CombatantStats, Property, SkillDef, WeaponType } from '../types';

export const EQUIPMENT_SLOTS = ['armor', 'accessory', 'charm'] as const;
export type EquipmentSlot = typeof EQUIPMENT_SLOTS[number];
export type EquipmentStat = Exclude<keyof CombatantStats, 'hp'>;
export type EquipmentStatMods = Partial<Record<EquipmentStat, number>>;
export interface EquipmentEffectMods { outgoingHealPct?: number }
export interface EquipmentMatch { weapon?: WeaponType; property?: Property; archetypesIncludes?: Archetype }
export interface EquipmentDef {
  name: string;
  slot: EquipmentSlot;
  setId?: string;
  statMods: EquipmentStatMods;
  dropEligibility: { sourceKinds: readonly ('fight' | 'event')[] };
}
export interface EquipmentSetBonus {
  pieces: 2 | 3;
  statMods?: EquipmentStatMods;
  effectMods?: EquipmentEffectMods;
}
export interface EquipmentSetDef {
  name: string;
  boardRequirement: { source: 'active_equipped_board_card_instances'; minCount: number; match: EquipmentMatch };
  bonuses: readonly EquipmentSetBonus[];
}
export interface EquipmentEntry<T> { id: string; versions: readonly { version: number; def: T }[] }
export interface EquipmentDocument {
  schemaVersion: 1;
  status: string;
  notes: readonly string[];
  items: readonly EquipmentEntry<EquipmentDef>[];
  sets: readonly EquipmentEntry<EquipmentSetDef>[];
}
export interface EquipmentCatalog {
  item(id: string, version: number): EquipmentDef;
  set(id: string, version: number): EquipmentSetDef;
}
export interface EquippedItemRef {
  instanceId: string;
  slot: EquipmentSlot;
  itemId: string;
  itemVersion: number;
  setVersion?: number;
  level?: number;
}
export interface EquipmentSetProgress {
  setId: string;
  setVersion: number;
  equippedPieces: number;
  matchingCards: number;
  requiredCards: number;
  requirementMet: boolean;
  activeThresholds: readonly number[];
}
export interface EquipmentResolution {
  statMods: EquipmentStatMods;
  effectMods: EquipmentEffectMods;
  sets: readonly EquipmentSetProgress[];
  pricingStatus: 'unresolved';
}
export interface PreparedEquipment extends EquipmentResolution {
  items: readonly EquippedItemRef[];
  statsBefore: CombatantStats;
  statsAfter: CombatantStats;
}
export type EquipmentActiveCard = Pick<SkillDef, 'archetypes' | 'property' | 'weapon' | 'size'>;

export interface EquipmentLootEntry {
  itemId: string;
  itemVersion: number;
  setVersion?: number;
  weight: number;
}
export interface EquipmentLootPool { pool: readonly EquipmentLootEntry[] }
