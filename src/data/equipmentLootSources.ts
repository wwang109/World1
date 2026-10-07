import { biomeCatalog } from './biomes';
import { enemyBookFromJson } from './enemiesContent';
import { equipmentCatalog } from './equipmentContent';
import { equipmentLootConfig as lootConfig } from './equipmentLootConfig';
import { eventDefAtVersion } from './eventsContent';
import { assertEquipmentLoot } from './validateEquipmentLoot';
import type { EquipmentCatalog, EquipmentLootEntry, EquipmentLootPool } from '../engine/equipment/types';

export type EquipmentItemPin = Pick<EquipmentLootEntry, 'itemId' | 'itemVersion' | 'setVersion'>;
export interface EquipmentEnemySource { id: string; name: string; equipmentDrop?: EquipmentLootPool }
export interface EquipmentBiomeSource { id: string; name: string; mobs: readonly string[]; bosses: readonly string[] }
export interface EquipmentEventGrantSource { id: string; name: string; equipmentGrant?: EquipmentItemPin; equipmentPool?: readonly EquipmentLootEntry[] }
export interface EquipmentLootEnemy { id: string; name: string; inEnemyPool: true; preferredBiomeIds: readonly string[] }
export interface EquipmentLootLocation { id: string; name: string; preferred: true; exclusive: false }
export interface EquipmentLootEvent { id: string; name: string; authored: true }
export interface EquipmentLootSourceRecord {
  ref: EquipmentItemPin;
  enemies: readonly EquipmentLootEnemy[];
  locations: readonly EquipmentLootLocation[];
  events: readonly EquipmentLootEvent[];
}
export interface EquipmentLootSourceIndex { sources: readonly EquipmentLootSourceRecord[] }

function compareId(a: { id: string }, b: { id: string }): number { return a.id < b.id ? -1 : a.id > b.id ? 1 : 0; }
export function equipmentItemPinKey(ref: EquipmentItemPin): string {
  return JSON.stringify([ref.itemId, ref.itemVersion, ref.setVersion ?? null]);
}
function uniqueSources<T extends { id: string }>(entries: readonly T[], kind: string): T[] {
  const sorted = [...entries].sort(compareId);
  const out: T[] = [];
  for (const entry of sorted) {
    const previous = out[out.length - 1];
    if (previous?.id === entry.id) {
      if (JSON.stringify(previous) !== JSON.stringify(entry)) throw new Error(`conflicting ${kind} source ${entry.id}`);
      continue;
    }
    out.push(entry);
  }
  return out;
}
export function buildEquipmentLootSources(
  enemies: readonly EquipmentEnemySource[],
  biomes: readonly EquipmentBiomeSource[],
  events: readonly EquipmentEventGrantSource[],
  catalog: EquipmentCatalog,
): EquipmentLootSourceIndex {
  const locations = uniqueSources(biomes, 'biome');
  const index = new Map<string, EquipmentLootSourceRecord>();
  function source(ref: EquipmentItemPin): EquipmentLootSourceRecord {
    const key = equipmentItemPinKey(ref);
    const existing = index.get(key);
    if (existing) return existing;
    const created: EquipmentLootSourceRecord = { ref: { itemId: ref.itemId, itemVersion: ref.itemVersion, ...(ref.setVersion === undefined ? {} : { setVersion: ref.setVersion }) }, enemies: [], locations: [], events: [] };
    index.set(key, created);
    return created;
  }
  for (const enemy of uniqueSources(enemies, 'enemy')) {
    if (!enemy.equipmentDrop) continue;
    assertEquipmentLoot(enemy.equipmentDrop, catalog, 'fight');
    const preferred = locations.filter((biome) => biome.mobs.includes(enemy.id) || biome.bosses.includes(enemy.id));
    for (const entry of enemy.equipmentDrop.pool) {
      const result = source(entry);
      result.enemies = [...result.enemies, { id: enemy.id, name: enemy.name, inEnemyPool: true, preferredBiomeIds: preferred.map((b) => b.id) }];
      result.locations = uniqueSources([...result.locations, ...preferred.map((b) => ({ id: b.id, name: b.name, preferred: true as const, exclusive: false as const }))], 'location');
    }
  }
  for (const event of uniqueSources(events, 'event')) {
    const pool = event.equipmentPool ?? (event.equipmentGrant ? [{ ...event.equipmentGrant, weight: 1 }] : []);
    assertEquipmentLoot({ pool }, catalog, 'event');
    for (const entry of pool) {
      const result = source(entry);
      result.events = [...result.events, { id: event.id, name: event.name, authored: true }];
    }
  }
  return { sources: [...index.values()].sort((a, b) => {
    const left = equipmentItemPinKey(a.ref), right = equipmentItemPinKey(b.ref);
    return left < right ? -1 : left > right ? 1 : 0;
  }) };
}

export function equipmentLootSourcesFromJson(): EquipmentLootSourceIndex {
  return buildEquipmentLootSources(Object.values(enemyBookFromJson), Object.values(biomeCatalog), lootConfig.events.map(event => ({
    id: event.eventId, name: eventDefAtVersion(event.eventId, event.eventVersion)!.title, equipmentPool: event.pool,
  })), equipmentCatalog);
}
