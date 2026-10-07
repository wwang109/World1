import document from './content/equipment-loot.v1.json';
import { eventContentMeta, eventDefAtVersion } from './eventsContent';
import { isEventDefV3 } from './eventContentV3';
import { equipmentCatalog } from './equipmentContent';
import { assertEquipmentLoot } from './validateEquipmentLoot';

function fields(value: object, allowed: readonly string[]): void {
  if (Object.keys(value).some(key => !allowed.includes(key))) throw new Error('Unknown equipment loot configuration field');
}
function chance(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > 10000) throw new Error('Invalid equipment chance');
}
fields(document,['schemaVersion','status','fightChanceBps','events']);
if (document.schemaVersion !== 1 || !Array.isArray(document.events)) throw new Error('Invalid equipment loot schema');
chance(document.fightChanceBps);
const seen = new Set<string>();
for (const event of document.events) {
  fields(event,['eventId','eventVersion','choiceIds','chanceBps','pool']);
  const key = `${event.eventId}@${event.eventVersion}`;
  if (seen.has(key)) throw new Error('Duplicate equipment event source');
  seen.add(key);
  const def = eventDefAtVersion(event.eventId,event.eventVersion);
  if (!def || eventContentMeta[event.eventId]?.retired) throw new Error(`Equipment source must reference a live event: ${key}`);
  const choices = isEventDefV3(def) ? def.choiceSet.fixed ?? [] : def.choices;
  if (!event.choiceIds.length || new Set(event.choiceIds).size !== event.choiceIds.length
    || event.choiceIds.some(id => !choices.some(choice => choice.id === id))) throw new Error(`Unknown equipment event choice: ${key}`);
  chance(event.chanceBps);
  assertEquipmentLoot({pool:event.pool},equipmentCatalog,'event');
}
export const equipmentLootConfig = document;
