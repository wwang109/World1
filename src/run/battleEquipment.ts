import type { CombatantSetup, CombatantStats } from '../engine/types';
import { equipmentCatalog } from '../data/equipmentContent';
import { applyEquipmentStats, resolveEquipment } from '../engine/equipment/resolve';
import { EQUIPMENT_SLOTS, type EquippedItemRef } from '../engine/equipment/types';
import { EQUIPMENT_MAX_LEVEL } from '../engine/equipment/upgrade';
import { skillBook } from '../data/skills';

export function requestEquipment(value: unknown): EquippedItemRef[] {
  if (!Array.isArray(value) || value.length > EQUIPMENT_SLOTS.length) throw new Error('equipment must be an array of at most three item references');
  const allowed = ['instanceId', 'slot', 'itemId', 'itemVersion', 'setVersion', 'level'];
  return value.map((entry: unknown) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)
      || Object.getPrototypeOf(entry) !== Object.prototype
      || Reflect.ownKeys(entry).some(key => typeof key !== 'string' || !allowed.includes(key))) throw new Error('equipment accepts item references only');
    const descriptors = Object.getOwnPropertyDescriptors(entry);
    if (Object.values(descriptors).some(field => !('value' in field))) throw new Error('equipment references must be plain values');
    const ref = entry as EquippedItemRef;
    if (typeof ref.instanceId !== 'string' || !ref.instanceId.trim()
      || typeof ref.itemId !== 'string' || !ref.itemId.trim()
      || !EQUIPMENT_SLOTS.includes(ref.slot)
      || !Number.isSafeInteger(ref.itemVersion) || ref.itemVersion < 1
      || (Object.hasOwn(ref, 'setVersion') && (!Number.isSafeInteger(ref.setVersion) || ref.setVersion! < 1))
      || (Object.hasOwn(ref, 'level') && (!Number.isSafeInteger(ref.level) || ref.level! < 1 || ref.level! > EQUIPMENT_MAX_LEVEL))) throw new Error('invalid equipment reference');
    return { instanceId: ref.instanceId, slot: ref.slot, itemId: ref.itemId, itemVersion: ref.itemVersion,
      ...(ref.setVersion === undefined ? {} : { setVersion: ref.setVersion }),
      ...(ref.level === undefined ? {} : { level: ref.level }) };
  });
}

export function applyBattleEquipment(setup: CombatantSetup, value: unknown): CombatantSetup {
  const references = requestEquipment(value);
  const items = EQUIPMENT_SLOTS.flatMap(slot => references.filter(ref => ref.slot === slot));
  if (items.length === 0) return setup;
  const cards = setup.pieces.map(piece => {
    const card = skillBook[piece.skillId];
    if (!card) throw new Error(`unknown equipment board card ${piece.skillId}`);
    return card;
  });
  const resolution = resolveEquipment(items, cards, equipmentCatalog);
  const statsBefore: CombatantStats = { ...setup.stats };
  const stats = applyEquipmentStats(statsBefore, resolution, { fullHpAtBattleSetup: true });
  return { ...setup, stats, equipment: { ...resolution, items, statsBefore, statsAfter: { ...stats } } };
}
