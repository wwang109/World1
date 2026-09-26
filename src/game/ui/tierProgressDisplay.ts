import { tierUpgradeCost, tierWorth, type TierProgress } from '../../run/shop';
import { type SkillTier } from '../../engine/types';

const TIER_NAME: Record<SkillTier, string> = {
  bronze: 'Bronze', silver: 'Silver', gold: 'Gold', diamond: 'Diamond',
};

const NEXT_TIER: Record<SkillTier, SkillTier | null> = {
  bronze: 'silver', silver: 'gold', gold: 'diamond', diamond: null,
};

/** Filled/open pip string toward the next tier, or `null` for Diamond (no
 * progress to show). One pip per point of `tierUpgradeCost` for this tier. */
export function tierProgressPips(progress: TierProgress): string | null {
  const cost = tierUpgradeCost(progress.tier);
  if (cost === null) return null;
  const filled = Math.max(0, Math.min(cost, progress.points));
  return '●'.repeat(filled) + '○'.repeat(cost - filled);
}

/** "1/2 to Gold"-style line, or `null` for Diamond. */
export function tierProgressLine(progress: TierProgress): string | null {
  const cost = tierUpgradeCost(progress.tier);
  const next = NEXT_TIER[progress.tier];
  if (cost === null || next === null) return null;
  return `${progress.points}/${cost} to ${TIER_NAME[next]}`;
}

/** "Silver 1/2 -> Gold 0/3"-style from/to line for a merge preview, or the
 * plain tier names when the merge doesn't change tier. */
export function tierProgressMergeLine(from: TierProgress, to: TierProgress): string {
  const fromCost = tierUpgradeCost(from.tier);
  const toCost = tierUpgradeCost(to.tier);
  const fromLabel = fromCost === null ? TIER_NAME[from.tier] : `${TIER_NAME[from.tier]} ${from.points}/${fromCost}`;
  const toLabel = toCost === null ? TIER_NAME[to.tier] : `${TIER_NAME[to.tier]} ${to.points}/${toCost}`;
  return `${fromLabel} -> ${toLabel}`;
}

export function tierWorthLabel(tier: SkillTier): string {
  return `Worth ${tierWorth(tier)}`;
}

/** Board-token accessory rail badge for merge progress, or `null` for
 * Diamond. One rail slot carries the whole pip string. */
export function tierProgressAccessory(progress: TierProgress): { label: string; textColor: string } | null {
  const pips = tierProgressPips(progress);
  if (!pips) return null;
  return { label: pips, textColor: '#e8b446' };
}
