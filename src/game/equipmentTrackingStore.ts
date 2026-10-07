import type { EquipmentItemPin } from '../data/equipmentLootSources';
import { readEquipmentTracking as read, setEquipmentTracking as set, type TrackingStorage } from '../meta/equipmentTracking';

const memory = new Map<string, string>();
const dirty = new Set<string>();
const driver: TrackingStorage = {
  getItem(key) {
    if (dirty.has(key)) return memory.get(key) ?? null;
    try { const value = globalThis.localStorage.getItem(key); if (value !== null) memory.set(key, value); return value ?? memory.get(key) ?? null; }
    catch { return memory.get(key) ?? null; }
  },
  setItem(key, value) { memory.set(key, value); try { globalThis.localStorage.setItem(key, value); dirty.delete(key); } catch { dirty.add(key); } },
};
export function readEquipmentTracking() { return read(driver); }
export function setEquipmentTracking(ref: EquipmentItemPin, kind: 'enemies' | 'events', enabled: boolean) { return set(ref, kind, enabled, driver); }
