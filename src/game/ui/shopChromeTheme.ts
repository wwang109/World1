import { shopCatalog } from '../../data/shopTypes';
import type { Element, WeaponType } from '../../engine/types';

export type ShopChromeThemeId = WeaponType | Element | 'neutral' | 'forged' | 'wild' | 'arcane';
type ShopChromeMotif = 'bevel' | 'notch' | 'point' | 'grain' | 'claw' | 'flame' | 'crystal' | 'bolt' | 'vine' | 'halo' | 'shadow' | 'rivet' | 'rune' | 'painted';

export interface ShopChromeTheme {
  id: ShopChromeThemeId;
  material: string;
  motif: ShopChromeMotif;
  rim: number;
  shade: number;
  highlight: number;
  tint: number;
}

export const SHOP_CHROME_THEMES = {
  sword: { id: 'sword', material: 'Tempered steel', motif: 'bevel', rim: 0x809bab, shade: 0x344954, highlight: 0xe3f1f6, tint: 0xd9e8f5 },
  axe: { id: 'axe', material: 'Hammered bronze', motif: 'notch', rim: 0xc68a55, shade: 0x613922, highlight: 0xffd5a0, tint: 0xffc994 },
  lance: { id: 'lance', material: 'Polished brass', motif: 'point', rim: 0xb5af78, shade: 0x52543d, highlight: 0xf7edb6, tint: 0xf3efc3 },
  bow: { id: 'bow', material: 'Carved yew', motif: 'grain', rim: 0xae8454, shade: 0x533e2b, highlight: 0xe3c28d, tint: 0xe9c295 },
  beast: { id: 'beast', material: 'Bone and hide', motif: 'claw', rim: 0xb7a88c, shade: 0x504639, highlight: 0xf2e4c5, tint: 0xf1dfba },
  fire: { id: 'fire', material: 'Ember copper', motif: 'flame', rim: 0xd6793d, shade: 0x6c3025, highlight: 0xffd271, tint: 0xffa778 },
  frost: { id: 'frost', material: 'Cut ice', motif: 'crystal', rim: 0x82c6d9, shade: 0x345e79, highlight: 0xe4fbff, tint: 0xbcecff },
  lightning: { id: 'lightning', material: 'Charged electrum', motif: 'bolt', rim: 0xb1a1ef, shade: 0x57416f, highlight: 0xffeda8, tint: 0xe4d7ff },
  nature: { id: 'nature', material: 'Living vine', motif: 'vine', rim: 0x83ad72, shade: 0x3b5940, highlight: 0xd8e9a8, tint: 0xc5e9a7 },
  holy: { id: 'holy', material: 'Ivory and light', motif: 'halo', rim: 0xd5c78d, shade: 0x796744, highlight: 0xfff8d5, tint: 0xfff5cd },
  dark: { id: 'dark', material: 'Obsidian silver', motif: 'shadow', rim: 0x9982b4, shade: 0x42324f, highlight: 0xdac1ef, tint: 0xc7a5ec },
  forged: { id: 'forged', material: 'Forged metal', motif: 'rivet', rim: 0x99a0a1, shade: 0x454b4d, highlight: 0xd4dadd, tint: 0xe0e2e1 },
  wild: { id: 'wild', material: 'Wood and hide', motif: 'grain', rim: 0xa88f68, shade: 0x514333, highlight: 0xe3d1aa, tint: 0xdccca2 },
  arcane: { id: 'arcane', material: 'Runed silver', motif: 'rune', rim: 0x9e9bc7, shade: 0x494660, highlight: 0xe1d9f4, tint: 0xd8d3ef },
  neutral: { id: 'neutral', material: 'Painted gold', motif: 'painted', rim: 0xb78e45, shade: 0x5d4326, highlight: 0xe9d291, tint: 0xffffff },
} as const satisfies Record<ShopChromeThemeId, ShopChromeTheme>;

export function resolveShopChromeTheme(shopId?: string | null): ShopChromeTheme {
  const clauses = shopId ? shopCatalog[shopId]?.cardFilter ?? [] : [];
  const weapons = [...new Set(clauses.flatMap(clause => clause.weapons ?? []))];
  const elements = [...new Set(clauses.flatMap(clause => clause.elements ?? []))];
  if (elements.length === 1 && clauses.every(clause => clause.elements?.length)) return SHOP_CHROME_THEMES[elements[0]!];
  if (weapons.length === 1 && clauses.every(clause => clause.weapons?.length)) return SHOP_CHROME_THEMES[weapons[0]!];
  if (weapons.length && weapons.every(weapon => weapon === 'sword' || weapon === 'axe' || weapon === 'lance')) return SHOP_CHROME_THEMES.forged;
  if (weapons.length && weapons.every(weapon => weapon === 'bow' || weapon === 'beast')) return SHOP_CHROME_THEMES.wild;
  if (elements.length || clauses.some(clause => clause.properties?.includes('magical'))) return SHOP_CHROME_THEMES.arcane;
  return SHOP_CHROME_THEMES.neutral;
}
