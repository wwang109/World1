import { equipmentLootConfig } from '../../data/equipmentLootConfig';
import { eventContentMeta, eventDefAtVersion } from '../../data/eventsContent';
import { isEventDefV3 } from '../../data/eventContentV3';

export function isEquipmentEvent(eventId: string | undefined, contentVersion?: number): boolean {
  if (!eventId) return false;
  const version = contentVersion ?? eventContentMeta[eventId]?.version;
  if (version === undefined) return false;
  if (equipmentLootConfig.events.some(source => source.eventId === eventId && source.eventVersion === version)) return true;
  const event = eventDefAtVersion(eventId, version);
  return !!event && isEventDefV3(event) && [...event.choiceSet.fixed, ...(event.choiceSet.pool?.entries ?? [])]
    .some(choice => choice.equipmentCost !== undefined);
}
