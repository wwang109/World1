import type { Rarity } from '../../engine/types';
import { artAsset, artManifest, manifestLoadAssets } from '../../data/artManifest';
export const GEM_ART_ASSETS = manifestLoadAssets(Object.values(artManifest.gems));
export const gemArtKey = (rarity: Rarity): string => artAsset(artManifest.gems[rarity]!).key;
