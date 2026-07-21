export interface FantasyCardAssetRules {
  framePng: { width: 420; height: 690 };
  artPng: { minWidth: 840; minHeight: 1040; preferredWidth: 1024; preferredHeight: 1536 };
  /** Every badge on the card (type + archetypes) shares one display size. */
  badgePng: { width: 40; height: 40 };
  dividerPng: { width: 300; height: 8 };
}

export const FANTASY_CARD_ASSET_RULES: FantasyCardAssetRules = {
  framePng: { width: 420, height: 690 },
  artPng: { minWidth: 840, minHeight: 1040, preferredWidth: 1024, preferredHeight: 1536 },
  badgePng: { width: 40, height: 40 },
  dividerPng: { width: 300, height: 8 },
};

export function validateFantasyCardArtSize(width: number, height: number): { ok: boolean; reason?: string } {
  if (width < FANTASY_CARD_ASSET_RULES.artPng.minWidth || height < FANTASY_CARD_ASSET_RULES.artPng.minHeight) {
    return { ok: false, reason: 'Card art must be at least 840x1040 for cover-fit cropping.' };
  }
  return { ok: true };
}
