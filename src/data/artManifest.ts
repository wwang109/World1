import document from '../../art-manifest.v1.json';

export interface ArtAsset {
  readonly id: string;
  readonly key: string;
  readonly path: string;
  readonly master?: string;
  readonly category: 'card' | 'equipment' | 'gem' | 'run' | 'ui';
  readonly width?: number;
  readonly height?: number;
  readonly alpha?: 'opaque' | 'transparent' | 'any';
}
export interface ArtManifest {
  readonly schemaVersion: 1;
  readonly assets: readonly ArtAsset[];
  readonly cards: Readonly<Record<string, string>>;
  readonly cardFallbacks: readonly string[];
  readonly items: Readonly<Record<string, string>>;
  readonly gems: Readonly<Record<string, string>>;
  readonly events: Readonly<Record<string, string>>;
  readonly themes: Readonly<Record<string, string>>;
  readonly eager: readonly string[];
  readonly eagerDesktop: readonly string[];
  readonly platforms: Readonly<Record<string, { readonly desktop: string; readonly mobile: string }>>;
  readonly equipmentAliases: Readonly<Record<string, string>>;
  readonly runKeys: typeof document.runKeys;
}
export const artManifest = document as ArtManifest;
const byId = new Map(artManifest.assets.map(asset => [asset.id, asset]));
export function artAsset(id: string, platform: 'desktop' | 'mobile' = 'mobile'): ArtAsset {
  const mapped = artManifest.platforms[id]?.[platform] ?? id;
  const asset = byId.get(mapped);
  if (!asset) throw new Error(`Unknown art asset: ${id}`);
  return asset;
}
export function artUrl(asset: ArtAsset): string { return asset.path.slice('public'.length); }
export function manifestLoadAssets(ids: readonly string[]): { key: string; path: string }[] {
  return ids.map(id => { const asset = artAsset(id); return { key: asset.key, path: artUrl(asset) }; });
}
