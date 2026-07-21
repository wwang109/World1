import type { SkillTier } from '../../engine/types';

export interface FantasyCardTierSkin {
  tier: SkillTier;
  frameColor: number;
  trimColor: number;
  accentColor: number;
  dividerColor: number;
  wtPlateKey?: string;
  frameTextureKey?: string;
}

export const FANTASY_CARD_TIER_SKINS: Record<SkillTier, FantasyCardTierSkin> = {
  bronze: { tier: 'bronze', frameColor: 0xc78338, trimColor: 0xd4984d, accentColor: 0xf0c37a, dividerColor: 0xe3c38a },
  silver: { tier: 'silver', frameColor: 0x6c7ea0, trimColor: 0xc8d3de, accentColor: 0xf5f8fb, dividerColor: 0xd9e2eb },
  gold: { tier: 'gold', frameColor: 0xd7b346, trimColor: 0xf0ca5c, accentColor: 0xffeb9b, dividerColor: 0xf1dd98 },
  diamond: { tier: 'diamond', frameColor: 0x5bb1f2, trimColor: 0x58d7f4, accentColor: 0xc7f7ff, dividerColor: 0xb8ecf8 },
};

export function getFantasyCardTierSkin(tier: SkillTier): FantasyCardTierSkin {
  return FANTASY_CARD_TIER_SKINS[tier];
}
