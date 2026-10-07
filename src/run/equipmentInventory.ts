import type { RunState } from './runState';
import type { EquipmentSlot, EquippedItemRef } from '../engine/equipment/types';
import { equipmentCatalog } from '../data/equipmentContent';
import { resolveEquipment } from '../engine/equipment/resolve';
import { EQUIPMENT_MAX_LEVEL } from '../engine/equipment/upgrade';

export type OwnedEquipmentItem = Omit<EquippedItemRef, 'slot'>;
export interface EquipmentRewardReceipt {
  id: string;
  sourceKind: 'fight' | 'event';
  sourceId: string;
  item: OwnedEquipmentItem | null;
  chanceBps: number;
  rolled: number;
}

export function validateRunEquipment(state: Pick<RunState, 'ownedEquipment' | 'equippedEquipment' | 'equipmentRewardReceipts' | 'spentEquipment' | 'brokenEquipment'>): boolean {
  try {
    if (state.brokenEquipment !== undefined && (!Number.isSafeInteger(state.brokenEquipment) || state.brokenEquipment < 0)) return false;
    if (state.ownedEquipment === null || state.equippedEquipment === null || state.equipmentRewardReceipts === null) return false;
    const owned = state.ownedEquipment ?? [];
    const equipped = state.equippedEquipment ?? [];
    if (!Array.isArray(owned) || !Array.isArray(equipped)) return false;
    const ids = new Set<string>();
    for (const item of owned) {
      if (!item || typeof item.instanceId !== 'string' || !item.instanceId || ids.has(item.instanceId)
        || Object.keys(item).some(key => !['instanceId', 'itemId', 'itemVersion', 'setVersion', 'level'].includes(key))
        || (item.level !== undefined && (!Number.isSafeInteger(item.level) || item.level < 1 || item.level > EQUIPMENT_MAX_LEVEL))) return false;
      ids.add(item.instanceId);
      const def = equipmentCatalog.item(item.itemId, item.itemVersion);
      resolveEquipment([{ ...item, slot: def.slot }], [], equipmentCatalog);
    }
    for (const ref of equipped) {
      if (Object.keys(ref).some(key => !['instanceId','slot','itemId','itemVersion','setVersion','level'].includes(key))) return false;
      const item = owned.find(entry => entry.instanceId === ref.instanceId);
      if (!item || item.itemId !== ref.itemId || item.itemVersion !== ref.itemVersion || item.setVersion !== ref.setVersion || item.level !== ref.level) return false;
    }
    resolveEquipment(equipped, [], equipmentCatalog);
    const spent = state.spentEquipment ?? [];
    if (!Array.isArray(spent) || new Set(spent).size !== spent.length
      || spent.some(id => typeof id !== 'string' || !id || ids.has(id))) return false;
    const receipts = state.equipmentRewardReceipts ?? [];
    if (!Array.isArray(receipts) || new Set(receipts.map(r => r.id)).size !== receipts.length) return false;
    return receipts.every(r => r && typeof r.id === 'string' && r.id.length > 0 && typeof r.sourceId === 'string'
      && ['fight', 'event'].includes(r.sourceKind) && Number.isSafeInteger(r.chanceBps) && r.chanceBps >= 0 && r.chanceBps <= 10000
      && Number.isSafeInteger(r.rolled) && r.rolled >= 0 && r.rolled < 10000
      && Object.keys(r).every(key => ['id','sourceKind','sourceId','item','chanceBps','rolled'].includes(key))
      && (r.item === null || (Object.keys(r.item).every(key => ['instanceId','itemId','itemVersion','setVersion'].includes(key)) && (spent.includes(r.item.instanceId) || owned.some(item => item.instanceId === r.item?.instanceId && item.itemId === r.item.itemId
        && item.itemVersion === r.item.itemVersion && item.setVersion === r.item.setVersion)))));
  } catch { return false; }
}

export function equipEquipment(state: RunState, instanceId: string): RunState {
  const item = (state.ownedEquipment ?? []).find(entry => entry.instanceId === instanceId);
  if (!item) return state;
  const slot = equipmentCatalog.item(item.itemId, item.itemVersion).slot;
  const refs = [...(state.equippedEquipment ?? []).filter(ref => ref.slot !== slot), { ...item, slot }];
  resolveEquipment(refs, [], equipmentCatalog);
  return { ...state, equippedEquipment: refs };
}

export function equippedInSlot(state: Pick<RunState, 'equippedEquipment'>, slot: EquipmentSlot): EquippedItemRef | undefined {
  return (state.equippedEquipment ?? []).find(ref => ref.slot === slot);
}

export function spendEquippedEquipment(state: RunState, slot: EquipmentSlot): RunState | undefined {
  const ref = equippedInSlot(state, slot);
  if (!ref) return undefined;
  return {
    ...state,
    ownedEquipment: (state.ownedEquipment ?? []).filter(item => item.instanceId !== ref.instanceId),
    equippedEquipment: (state.equippedEquipment ?? []).filter(entry => entry.instanceId !== ref.instanceId),
    spentEquipment: [...(state.spentEquipment ?? []), ref.instanceId],
  };
}

export function salvageEquipment(state: RunState, instanceId: string): RunState {
  const owned = (state.ownedEquipment ?? []).some(item => item.instanceId === instanceId);
  const equipped = (state.equippedEquipment ?? []).some(ref => ref.instanceId === instanceId);
  if (!owned || equipped) return state;
  return {
    ...state,
    ownedEquipment: (state.ownedEquipment ?? []).filter(item => item.instanceId !== instanceId),
    spentEquipment: [...(state.spentEquipment ?? []), instanceId],
    brokenEquipment: (state.brokenEquipment ?? 0) + 1,
  };
}

export function unequipEquipment(state: RunState, slot: EquipmentSlot): RunState {
  return { ...state, equippedEquipment: (state.equippedEquipment ?? []).filter(ref => ref.slot !== slot) };
}
