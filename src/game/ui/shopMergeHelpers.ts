import { listOwnedDuplicates, type OwnedDuplicate } from '../../run/shop';
import { demoState } from '../demoState';
import {
  buyCurrentShopMergeSlotPoint,
  currentShopMergeSlotAvailable,
  currentShopMergeSlotPrice,
  currentShopMergeSlotTargets,
  currentShopMergeableDuplicates,
  type ShopMergeSlotResult,
} from '../runStore';
import {
  buyMergeSlotPoint as sandboxBuyMergeSlotPoint,
  mergeSlotAvailable as sandboxMergeSlotAvailable,
  mergeSlotPrice as sandboxMergeSlotPrice,
  type MergeSlotResult,
} from '../shopActions';

/** Every owned copy of `skillId` — Run Mode reads the active run, the
 * sandbox reads `demoState` directly (`shopActions.ts` has no by-skillId
 * lookup, only by-instance). Powers the MERGE copy chooser. */
export function shopMergeableDuplicatesForSkill(runMode: boolean, skillId: string): OwnedDuplicate[] {
  if (runMode) return currentShopMergeableDuplicates(skillId);
  return listOwnedDuplicates(skillId, demoState.pieces, demoState.bagSlots);
}

/** Every owned non-Diamond card the shop's merge slot can target. */
export function shopMergeSlotTargets(runMode: boolean): OwnedDuplicate[] {
  if (runMode) return currentShopMergeSlotTargets();
  const result: OwnedDuplicate[] = [];
  demoState.pieces.forEach((p, index) => {
    if (p.tier !== 'diamond') result.push({ location: 'board', index, instanceId: p.instanceId, tier: p.tier, points: p.points ?? 0 });
  });
  demoState.bagSlots.forEach((c, index) => {
    if (c && c.tier !== 'diamond') result.push({ location: 'bag', index, instanceId: c.instanceId, tier: c.tier, points: c.points ?? 0 });
  });
  return result;
}

export function shopMergeSlotPrice(runMode: boolean): number {
  return runMode ? currentShopMergeSlotPrice() : sandboxMergeSlotPrice();
}

export function shopMergeSlotAvailable(runMode: boolean, shopId: string): boolean {
  return runMode ? currentShopMergeSlotAvailable() : sandboxMergeSlotAvailable(shopId);
}

export function shopBuyMergeSlotPoint(runMode: boolean, shopId: string, targetInstanceId: string): ShopMergeSlotResult | MergeSlotResult {
  return runMode ? buyCurrentShopMergeSlotPoint(targetInstanceId) : sandboxBuyMergeSlotPoint(shopId, targetInstanceId);
}
