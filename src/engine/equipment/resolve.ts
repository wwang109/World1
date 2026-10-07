import type { Action, CombatantStats } from '../types';
import { EQUIPMENT_EFFECT_KEYS, EQUIPMENT_EFFECT_REGISTRY, EQUIPMENT_STAT_KEYS, EQUIPMENT_STAT_REGISTRY, equipmentCardMatches } from './registry';
import { EQUIPMENT_MAX_LEVEL, equipmentUpgradeGain, equipmentUpgradeStat } from './upgrade';
import { EQUIPMENT_SLOTS, type EquipmentActiveCard, type EquipmentCatalog, type EquipmentEffectMods, type EquipmentResolution, type EquippedItemRef } from './types';

function integer(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label} must be a nonnegative safe integer`);
}

export function resolveEquipment(refs: readonly EquippedItemRef[], activeCards: readonly EquipmentActiveCard[], catalog: EquipmentCatalog): EquipmentResolution {
  const out: EquipmentResolution = { statMods: {}, effectMods: {}, sets: [], pricingStatus: 'unresolved' };
  const instances = new Set<string>();
  const slots = new Set<string>();
  for (const ref of refs) {
    if (!EQUIPMENT_SLOTS.includes(ref.slot)) throw new Error(`unknown equipment slot ${String(ref.slot)}`);
    if (typeof ref.instanceId !== 'string' || !ref.instanceId || instances.has(ref.instanceId)) throw new Error('duplicate or empty equipment instance');
    if (slots.has(ref.slot)) throw new Error(`duplicate equipment slot ${ref.slot}`);
    instances.add(ref.instanceId); slots.add(ref.slot);
  }
  const groups: { id: string; version: number; pieces: number }[] = [];
  for (const slot of EQUIPMENT_SLOTS) {
    const ref = refs.find((r) => r.slot === slot);
    if (!ref) continue;
    const item = catalog.item(ref.itemId, ref.itemVersion);
    if (item.slot !== ref.slot) throw new Error(`equipment ${ref.itemId} cannot occupy ${ref.slot}`);
    for (const key of EQUIPMENT_STAT_KEYS) {
      if (item.statMods[key] === undefined) continue;
      out.statMods[key] = (out.statMods[key] ?? 0) + (item.statMods[key] ?? 0);
      integer(out.statMods[key]!, `equipment ${key}`);
    }
    const level = ref.level ?? 0;
    integer(level, 'equipment level');
    if (level > EQUIPMENT_MAX_LEVEL) throw new Error('equipment level exceeds maximum');
    if (level > 0) {
      const stat = equipmentUpgradeStat(item);
      out.statMods[stat] = (out.statMods[stat] ?? 0) + level * equipmentUpgradeGain(stat);
      integer(out.statMods[stat]!, `equipment ${stat}`);
    }
    if (item.setId === undefined) {
      if (ref.setVersion !== undefined) throw new Error('standalone equipment cannot pin a set version');
      continue;
    }
    if (ref.setVersion === undefined) throw new Error('set equipment requires pinned setVersion');
    catalog.set(item.setId, ref.setVersion);
    const group = groups.find((g) => g.id === item.setId);
    if (group && group.version !== ref.setVersion) throw new Error('mixed set definition versions');
    if (group) group.pieces += 1;
    else groups.push({ id: item.setId, version: ref.setVersion, pieces: 1 });
  }
  out.sets = groups.map((group) => {
    const def = catalog.set(group.id, group.version);
    const matchingCards = activeCards.filter((card) => equipmentCardMatches(card, def.boardRequirement.match)).length;
    const requirementMet = matchingCards >= def.boardRequirement.minCount;
    const active = def.bonuses.filter((bonus) => requirementMet && group.pieces >= bonus.pieces);
    for (const bonus of active) {
      for (const key of EQUIPMENT_STAT_KEYS) {
        if (bonus.statMods?.[key] === undefined) continue;
        out.statMods[key] = (out.statMods[key] ?? 0) + (bonus.statMods?.[key] ?? 0);
        integer(out.statMods[key]!, `equipment ${key}`);
      }
      for (const key of EQUIPMENT_EFFECT_KEYS) {
        if (bonus.effectMods?.[key] === undefined) continue;
        out.effectMods[key] = (out.effectMods[key] ?? 0) + (bonus.effectMods?.[key] ?? 0);
        integer(out.effectMods[key]!, `equipment ${key}`);
      }
    }
    return { setId: group.id, setVersion: group.version, equippedPieces: group.pieces, matchingCards, requiredCards: def.boardRequirement.minCount, requirementMet, activeThresholds: active.map((b) => b.pieces) };
  });
  return out;
}

export function applyEquipmentStats(stats: CombatantStats, resolution: EquipmentResolution, options: { fullHpAtBattleSetup: boolean }): CombatantStats {
  const out = { ...stats };
  for (const key of EQUIPMENT_STAT_KEYS) {
    const add = resolution.statMods[key] ?? 0;
    integer(add, `equipment ${key}`);
    EQUIPMENT_STAT_REGISTRY[key].add(out, add);
    integer(out[key], key);
  }
  out.hp = options.fullHpAtBattleSetup ? out.maxHp : Math.min(out.hp, out.maxHp);
  integer(out.hp, 'hp');
  return out;
}

export function applyEquipmentDirectHeal(action: Action, resolvedAmount: number, mods: EquipmentEffectMods): number {
  integer(resolvedAmount, 'resolved heal amount');
  const pct = mods.outgoingHealPct ?? 0;
  integer(pct, 'outgoingHealPct');
  return action.kind === 'heal' && pct > 0 ? EQUIPMENT_EFFECT_REGISTRY.outgoingHealPct.apply(resolvedAmount, pct) : resolvedAmount;
}
