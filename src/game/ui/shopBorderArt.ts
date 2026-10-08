export const SHOP_BORDER_ART_IDS = ['sword', 'axe', 'lance', 'bow', 'beast', 'fire', 'frost', 'lightning', 'nature', 'holy', 'dark', 'neutral'] as const;
export type ShopBorderArtId = typeof SHOP_BORDER_ART_IDS[number];

export const SHOP_BORDER_ART_ASSETS = [{
  key: 'shop-border-jointed-v3', path: '/game-art/ui/shop-borders/jointed-shop-frame-v3.webp',
}];

export const SHOP_BORDER_ART_CORNER = 84;
