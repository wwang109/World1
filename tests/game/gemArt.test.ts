import { describe, expect, it } from 'vitest';
import { GEM_ART_ASSETS, gemArtKey } from '../../src/game/ui/gemArt';
describe('generated rarity jewel contract', () => {
  it('maps all four rarity families to individual encoded assets', () => {
    expect(GEM_ART_ASSETS).toEqual(['common', 'rare', 'epic', 'legendary'].map(rarity => ({
      key: `gem-rarity-${rarity}`, path: `/game-art/ui/gems/${rarity}.webp`,
    })));
    expect(gemArtKey('epic')).toBe('gem-rarity-epic');
  });
});
