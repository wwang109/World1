import { artManifest, manifestLoadAssets } from '../../data/artManifest';
export const EQUIPMENT_ART_ASSETS = manifestLoadAssets(Object.values(artManifest.items));
export function equipmentArtKey(itemId: string): string { return `equipment-${itemId}`; }
