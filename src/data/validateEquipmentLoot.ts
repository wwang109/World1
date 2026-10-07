import type { EquipmentCatalog, EquipmentLootPool } from '../engine/equipment/types';
import type { EquipmentContentProblem } from './validateEquipmentContent';

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function validate(input: unknown, catalog: EquipmentCatalog | undefined, sourceKind: 'fight' | 'event'): EquipmentContentProblem[] {
  const problems: EquipmentContentProblem[] = [];
  const fail = (where: string, message: string) => { problems.push({ where, message }); };
  if (!object(input)) return [{ where: '$', message: 'expected equipment loot object' }];
  for (const key of Object.keys(input)) if (key !== 'pool') fail(key, 'unknown field');
  if (!Array.isArray(input.pool) || input.pool.length === 0) return [...problems, { where: 'pool', message: 'expected nonempty equipment pool' }];
  const seen = new Set<string>();
  const setVersions = new Map<string, number>();
  let total = 0;
  input.pool.forEach((entry: unknown, index) => {
    const at = `pool[${index}]`;
    if (!object(entry)) { fail(at, 'expected entry object'); return; }
    for (const key of Object.keys(entry)) if (!['itemId', 'itemVersion', 'setVersion', 'weight'].includes(key)) fail(`${at}.${key}`, 'unknown field');
    if (typeof entry.itemId !== 'string' || !entry.itemId) fail(`${at}.itemId`, 'expected nonempty item id');
    for (const key of ['itemVersion', 'weight'] as const) if (!Number.isSafeInteger(entry[key]) || (entry[key] as number) <= 0) fail(`${at}.${key}`, 'expected positive safe integer');
    if (entry.setVersion !== undefined && (!Number.isSafeInteger(entry.setVersion) || (entry.setVersion as number) <= 0)) fail(`${at}.setVersion`, 'expected positive safe integer');
    if (Number.isSafeInteger(entry.weight) && (entry.weight as number) > 0) {
      total += entry.weight as number;
      if (!Number.isSafeInteger(total)) fail('pool', 'weight sum exceeds safe integer range');
    }
    const identity = JSON.stringify([entry.itemId, entry.itemVersion, entry.setVersion ?? null]);
    if (seen.has(identity)) fail(at, 'duplicate pinned item reference');
    seen.add(identity);
    if (catalog === undefined) return;
    if (typeof entry.itemId !== 'string' || typeof entry.itemVersion !== 'number') return;
    try {
      const item = catalog.item(entry.itemId, entry.itemVersion);
      if (!item.dropEligibility.sourceKinds.includes(sourceKind)) fail(at, `item is not eligible for ${sourceKind} sources`);
      if (item.setId !== undefined) {
        if (typeof entry.setVersion !== 'number') fail(`${at}.setVersion`, 'set item requires pinned set version');
        else {
          catalog.set(item.setId, entry.setVersion);
          const pinned = setVersions.get(item.setId);
          if (pinned !== undefined && pinned !== entry.setVersion) fail(`${at}.setVersion`, 'mixed versions of the same set in one pool');
          setVersions.set(item.setId, entry.setVersion);
        }
      } else if (entry.setVersion !== undefined) fail(`${at}.setVersion`, 'standalone item cannot pin a set version');
    } catch (error) { fail(at, error instanceof Error ? error.message : String(error)); }
  });
  return problems;
}
export function validateEquipmentLootPool(input: unknown): EquipmentContentProblem[] {
  return validate(input, undefined, 'fight');
}
export function validateEquipmentLoot(input: unknown, catalog: EquipmentCatalog, sourceKind: 'fight' | 'event' = 'fight'): EquipmentContentProblem[] {
  return validate(input, catalog, sourceKind);
}
export function assertEquipmentLoot(input: unknown, catalog: EquipmentCatalog, sourceKind: 'fight' | 'event' = 'fight'): asserts input is EquipmentLootPool {
  const problems = validateEquipmentLoot(input, catalog, sourceKind);
  if (problems.length) throw new Error(problems.map((p) => `${p.where}: ${p.message}`).join('\n'));
}
