import type { EquipmentCatalog, EquipmentSlot } from './types';
import { equipmentItemText, equipmentSetText } from './text';
import type { EquipmentItemPin, EquipmentLootEnemy, EquipmentLootEvent, EquipmentLootLocation, EquipmentLootSourceIndex } from '../../data/equipmentLootSources';

export interface EquipmentDetailsModel {
  name: string;
  slot: EquipmentSlot;
  baseText: string;
  set?: { id: string; version: number; name: string; requirement: string; bonuses: readonly string[] };
  lootFrom: {
    title: 'Loot From';
    locationCaption: 'Often found in';
    locations: readonly EquipmentLootLocation[];
    enemies: readonly EquipmentLootEnemy[];
    events: readonly EquipmentLootEvent[];
    eventEmptyText?: string;
    locationNote: string;
  };
}
export function equipmentDetailsModel(ref: EquipmentItemPin, catalog: EquipmentCatalog, sources: EquipmentLootSourceIndex): EquipmentDetailsModel {
  const item = catalog.item(ref.itemId, ref.itemVersion);
  const source = sources.sources.find((entry) => entry.ref.itemId === ref.itemId && entry.ref.itemVersion === ref.itemVersion && entry.ref.setVersion === ref.setVersion);
  if (item.setId !== undefined && ref.setVersion === undefined) throw new Error('equipment details require pinned setVersion');
  if (item.setId === undefined && ref.setVersion !== undefined) throw new Error('standalone equipment details cannot pin a set version');
  const set = item.setId === undefined ? undefined : catalog.set(item.setId, ref.setVersion!);
  const events = source?.events ?? [];
  return {
    name: item.name, slot: item.slot, baseText: equipmentItemText(item),
    ...(set === undefined ? {} : { set: { id: item.setId!, version: ref.setVersion!, name: set.name, ...equipmentSetText(set) } }),
    lootFrom: {
      title: 'Loot From',
      locationCaption: 'Often found in', locations: structuredClone(source?.locations ?? []), enemies: structuredClone(source?.enemies ?? []), events: structuredClone(events),
      ...(events.length ? {} : { eventEmptyText: 'No event sources.' }),
      locationNote: source?.locations.length ? 'These enemies can also appear elsewhere.' : 'No known locations.',
    },
  };
}
