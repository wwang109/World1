import type { Rarity } from '../../engine/types';

/** The four generated jewel families; masters remain outside public/. */
export const GEM_ART_ASSETS = (['common', 'rare', 'epic', 'legendary'] as const).map(rarity => ({
  key: `gem-rarity-${rarity}`, path: `/game-art/ui/gems/${rarity}.webp`,
}));
export const gemArtKey = (rarity: Rarity): string => `gem-rarity-${rarity}`;
