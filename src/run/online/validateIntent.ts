import type { RunCommand, RunIntent } from './types';

type Check = (value: unknown) => boolean;
const text: Check = value => typeof value === 'string' && value.length > 0 && value.length <= 200;
const integer: Check = value => Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= 1_000_000;
const one = (...values: string[]): Check => value => typeof value === 'string' && values.includes(value);
const object = (required: Record<string, Check>, optional: Record<string, Check> = {}): Check => value => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return Object.keys(record).every(key => Object.hasOwn(required, key) || Object.hasOwn(optional, key))
    && Object.entries(required).every(([key, check]) => Object.hasOwn(record, key) && check(record[key]))
    && Object.entries(optional).every(([key, check]) => !Object.hasOwn(record, key) || check(record[key]));
};
const stats = ['maxHp', 'attack', 'magicPower', 'armor', 'magicResist', 'speed'];
const stat = one(...stats);
const source = object({ kind: one('board', 'bag', 'held'), instanceId: text });
const destination: Check = value => object({ kind: one('board', 'bag'), slot: integer })(value) || object({ kind: one('held') })(value);
const schemas: Record<string, Check> = {};
function add(kinds: string[], fields: Record<string, Check> = {}, optional: Record<string, Check> = {}) {
  for (const kind of kinds) schemas[kind] = object({ kind: one(kind), ...fields }, optional);
}
const selectionSchemas: Record<string, Check> = {
  card: object({ kind: one('card'), skillId: text }),
  upgrade: object({ kind: one('upgrade'), instanceId: text }),
  awardCardPoint: object({ kind: one('awardCardPoint'), instanceId: text }),
  reshape: object({ kind: one('reshape'), instanceId: text }),
  upgradeEquipment: object({ kind: one('upgradeEquipment'), instanceId: text }),
  gem: object({ kind: one('gem'), gemId: text }),
  sellGem: object({ kind: one('sellGem'), pouchIndex: integer }),
  mergeCards: object({ kind: one('mergeCards'), skillId: text, consumedIds: value => Array.isArray(value) && value.length === 3 && value.every(text) && new Set(value).size === 3 }),
  statPick: object({ kind: one('statPick'), stat }),
  reshapeGem: object({ kind: one('reshapeGem'), optionId: text }),
  reroll: object({ kind: one('reroll'), target: one('rerollCard', 'rerollGem'), step: value => object({ kind: one('pick'), id: text })(value) || object({ kind: one('reroll', 'keep') })(value) }),
  forgeEquipment: object({ kind: one('forgeEquipment'), itemId: text }),
};
const selection: Check = value => !!value && typeof value === 'object' && Object.hasOwn(selectionSchemas, String((value as { kind?: unknown }).kind)) && selectionSchemas[String((value as { kind: unknown }).kind)]!(value);
add(['draftReroll', 'draftApply', 'shopMaterialize', 'shopReroll', 'leaveShop', 'issueEncounter', 'retire', 'ghostLookup', 'ghostAccept', 'ghostDecline', 'ghostSkip', 'eventMaterialize', 'leaveEvent']);
add(['draftPick'], { set: one('offense', 'defense', 'support', 'wildcard'), skillId: text });
add(['chooseBiome'], { biomeId: text }); add(['chooseNode'], { nodeId: text });
add(['buyCard'], { index: integer }, { destination: object({ where: one('board', 'bag'), slot: integer }) });
add(['buyGem'], { index: integer }); add(['mergeCard'], { index: integer, targetInstanceId: text });
add(['buyMergeSlot'], { targetInstanceId: text }); add(['sellCard'], { source });
add(['sellGem'], { pouchIndex: integer }); add(['allocateStats'], { allocation: object({}, Object.fromEntries(stats.map(key => [key, integer]))) });
add(['buyStat'], { stat }); add(['equip', 'salvage', 'detachGem'], { instanceId: text });
add(['unequip'], { slot: one('armor', 'accessory', 'charm') }); add(['ghostSave'], { name: value => text(value) && String(value).trim().length > 0 && String(value).length <= 10 });
add(['moveCard'], { source, destination }); add(['swapCards'], { source, other: source });
add(['attachGem'], { instanceId: text, pouchIndex: integer });
add(['eventChoice'], { instanceId: text, contentVersion: integer, choiceId: text });
add(['eventReopen', 'eventCancel'], { instanceId: text, contentVersion: integer });
add(['eventFinalize'], { instanceId: text, contentVersion: integer, selection });
export const RUN_INTENT_KINDS = Object.freeze(Object.keys(schemas));
export function validateIntent(value: unknown): RunIntent {
  const kind = value && typeof value === 'object' ? (value as { kind?: unknown }).kind : undefined;
  if (typeof kind !== 'string' || !Object.hasOwn(schemas, kind) || !schemas[kind]!(value)) throw new Error('Invalid run intent');
  return value as RunIntent;
}
export function validateCommand(value: unknown): RunCommand {
  if (!object({ operationId: validOperationId, expectedRevision: integer, intent: value => { try { validateIntent(value); return true; } catch { return false; } } })(value)) throw new Error('Invalid run command');
  return value as RunCommand;
}
export const validOperationId: Check = value => typeof value === 'string' && /^[A-Za-z0-9_-]{8,100}$/.test(value);
