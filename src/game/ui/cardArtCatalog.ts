import { artAsset, artManifest } from '../../data/artManifest';
/**
 * Card art catalogue — skill id -> the ONE texture key and the ONE file the
 * game loads for it. Nothing else in the codebase names a card-art path.
 *
 * The files are `.webp` DERIVATIVES, produced by `scripts/encode-card-art.ts`
 * (`npm run art:encode`) from the `.png` masters in **`art-src/cards/`**:
 * max 1024 tall, WebP q68 against the masters' ~2.3 MB. The
 * masters live OUTSIDE `public/` because `vite build` copies `public/`
 * verbatim — while they sat beside their derivatives every deploy shipped
 * 179 MB of PNG nothing fetches. The `.webp` here is generated but IS
 * committed (encoding needs Chromium, which the build does not have). See
 * that script's header for why 1024 (2.4x the tallest real draw) and why the
 * masters are never modified.
 *
 * Art is NOT loaded at boot. `cardArtLoader.ts` streams each texture in on
 * first use and the card renderers show `cardArtPlaceholder.ts` until it
 * lands — so a card whose art is still in flight takes the same placeholder
 * path that covered not-yet-catalogued cards during the all-card rollout.
 */
export type CardArtEntry = {
  fileName: string;
  textureKey: string;
};

/** Directory the catalogue's `fileName`s live in, served from `public/`. */
export const CARD_ART_BASE_PATH = '/game-art/cards';

/** The URL the loader fetches for one catalogue entry. */
export function cardArtUrl(entry: CardArtEntry): string {
  return `${CARD_ART_BASE_PATH}/${entry.fileName}`;
}

export const CARD_ART_CATALOG: Record<string, CardArtEntry> = Object.fromEntries(
  Object.entries(artManifest.cards).map(([id, assetId]) => {
    const asset = artAsset(assetId);
    return [id, { textureKey: asset.key, fileName: asset.path.slice('public/game-art/cards/'.length) }];
  }),
);
