import document from './content/equipment.v1.json';
import { assertEquipmentDocument } from './validateEquipmentContent';
import type { EquipmentCatalog, EquipmentDocument, EquipmentEntry } from '../engine/equipment/types';

function freeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const entry of Object.values(value)) freeze(entry);
    Object.freeze(value);
  }
  return value;
}
export function loadEquipmentContent(input: unknown): EquipmentCatalog {
  assertEquipmentDocument(input);
  const snapshot = freeze(structuredClone(input));
  function pinned<T>(entries: readonly EquipmentEntry<T>[], id: string, version: number): T {
    if (!Number.isSafeInteger(version) || version <= 0) throw new Error('equipment version must be a positive safe integer');
    const entry = entries.find((e) => e.id === id);
    const match = entry?.versions.find((v) => v.version === version);
    if (!match) throw new Error(`unknown equipment definition ${id}@${version}`);
    return match.def;
  }
  return { item: (id, version) => pinned(snapshot.items, id, version), set: (id, version) => pinned(snapshot.sets, id, version) };
}
export const equipmentCatalog = loadEquipmentContent(document);
export const equipmentDocument = freeze(structuredClone(document)) as EquipmentDocument;
