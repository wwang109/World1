import type { SkillBook, SkillDef, SkillTier } from '../engine/types';
import { buildTierVariant, TIER_ORDER, variantId } from '../engine/tierUp';
import { skillBook } from './skills';

/**
 * The full playable card library: every base card plus each achievable
 * generated tier variant (ids like `fireball__gold`). Boards and battles
 * resolve against this book; draft/pool UIs list the base `skillBook` and
 * offer tiers through `tiersOf`/`variantId`.
 */
export const fullBook: SkillBook = { ...skillBook };

for (const base of Object.values(skillBook)) {
  for (const tier of TIER_ORDER) {
    if (tier === base.tier) continue;
    const variant = buildTierVariant(base, tier);
    if (variant) fullBook[variant.id] = variant;
  }
}

/** The card (base or variant) for a base id at a tier, if it exists. */
export function cardAtTier(baseId: string, tier: SkillTier): SkillDef | undefined {
  return fullBook[variantId(baseId, tier, skillBook[baseId]?.tier ?? 'bronze')];
}

/** Tiers this base card is playable at (its own tier plus built variants). */
export function tiersOf(baseId: string): SkillTier[] {
  return TIER_ORDER.filter((t) => cardAtTier(baseId, t) !== undefined);
}
