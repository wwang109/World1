import { equipmentCatalog } from '../data/equipmentContent';
import { equipmentItemPinKey, type EquipmentItemPin } from '../data/equipmentLootSources';

export const EQUIPMENT_TRACKING_KEY = 'world1:equipment-tracking:v1';
export interface EquipmentTrackingGoal extends EquipmentItemPin { enemies: boolean; events: boolean }
export interface TrackingStorage { getItem(key: string): string | null; setItem(key: string, value: string): void }
function valid(value: unknown): value is EquipmentTrackingGoal {
  if (!value || typeof value !== 'object') return false;
  const goal = value as EquipmentTrackingGoal;
  if (typeof goal.itemId !== 'string' || !Number.isSafeInteger(goal.itemVersion)
    || typeof goal.enemies !== 'boolean' || typeof goal.events !== 'boolean') return false;
  try {
    const item = equipmentCatalog.item(goal.itemId, goal.itemVersion);
    if (item.setId) equipmentCatalog.set(item.setId, goal.setVersion!);
    else if (goal.setVersion !== undefined) return false;
    return goal.enemies || goal.events;
  } catch { return false; }
}
export function readEquipmentTracking(target?: TrackingStorage): EquipmentTrackingGoal[] {
  try {
    const raw: unknown = JSON.parse(target?.getItem(EQUIPMENT_TRACKING_KEY) ?? '[]');
    if (!Array.isArray(raw)) return [];
    const seen = new Set<string>();
    return raw.filter(valid).filter(goal => {
      const key = equipmentItemPinKey(goal);
      if (seen.has(key)) return false;
      seen.add(key); return true;
    }).map(goal => ({ itemId: goal.itemId, itemVersion: goal.itemVersion,
      ...(goal.setVersion === undefined ? {} : { setVersion: goal.setVersion }), enemies: goal.enemies, events: goal.events }));
  } catch { return []; }
}
export function setEquipmentTracking(ref: EquipmentItemPin, kind: 'enemies' | 'events', enabled: boolean, target?: TrackingStorage): EquipmentTrackingGoal[] {
  const goals = readEquipmentTracking(target), key = equipmentItemPinKey(ref);
  const current = goals.find(goal => equipmentItemPinKey(goal) === key) ?? { ...ref, enemies: false, events: false };
  const next = { ...current, [kind]: enabled };
  const updated = [...goals.filter(goal => equipmentItemPinKey(goal) !== key), ...(valid(next) ? [next] : [])];
  try { target?.setItem(EQUIPMENT_TRACKING_KEY, JSON.stringify(updated)); } catch {}
  return updated;
}
