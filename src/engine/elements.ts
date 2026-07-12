import type { Element, WeaponType } from './types';

/**
 * Elemental wheel (element-tagged cards, any property):
 *   Fire → Nature → Lightning → Frost → Fire
 * plus Holy ↔ Dark, mutually strong against each other.
 */
export const ELEMENT_BEATS: Record<Element, Element> = {
  fire: 'nature',
  nature: 'lightning',
  lightning: 'frost',
  frost: 'fire',
  holy: 'dark',
  dark: 'holy',
};

/**
 * Weapon triangle (weapon-tagged cards; weapon tags are always physical):
 *   Sword → Axe → Lance → Sword
 * Beast (fangs/claws/monster attacks) and Bow sit outside the triangle,
 * but Bow beats Beast — the hunter's niche.
 */
export const WEAPON_BEATS: Partial<Record<WeaponType, WeaponType>> = {
  sword: 'axe',
  axe: 'lance',
  lance: 'sword',
  bow: 'beast',
};

export type Matchup = 'advantage' | 'disadvantage' | 'neutral';

/** Attacker's card element (tag) vs the defender's elemental affinity. */
export function elementMatchup(attack: Element | undefined, affinity: Element | undefined): Matchup {
  if (!attack || !affinity) return 'neutral';
  if (ELEMENT_BEATS[attack] === affinity) return 'advantage';
  if (ELEMENT_BEATS[affinity] === attack) return 'disadvantage';
  return 'neutral';
}

/** Attacker's weapon type (tag) vs the defender's weapon affinity. Bows are always neutral. */
export function weaponMatchup(attack: WeaponType | undefined, affinity: WeaponType | undefined): Matchup {
  if (!attack || !affinity) return 'neutral';
  if (WEAPON_BEATS[attack] === affinity) return 'advantage';
  if (WEAPON_BEATS[affinity] === attack) return 'disadvantage';
  return 'neutral';
}

/** Damage multiplier in percent: advantage +50%, disadvantage −25%. */
export function matchupPct(m: Matchup): number {
  return m === 'advantage' ? 150 : m === 'disadvantage' ? 75 : 100;
}
