export interface ContentManifest {
  readonly schemaVersion: 1;
  readonly gameContentApiVersion: 1;
  readonly files: readonly { readonly path: string; readonly sha256: string; readonly bytes: number }[];
}
export interface ContentSource { readonly owner: 'wwang109'; readonly repo: 'wandering-hand-content'; readonly ref: 'main' }
