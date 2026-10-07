import { STAT_KEYS, STAT_LONG_NAME, STAT_RULE, STAT_TOKEN } from '../keywords/text';
import type { Archetype, CombatantStats, Property, WeaponType } from '../types';
import type { EquipmentActiveCard, EquipmentEffectMods, EquipmentMatch, EquipmentStat } from './types';

export const EQUIPMENT_STAT_REGISTRY = Object.fromEntries(STAT_KEYS.map((key) => [key, {
  token: STAT_TOKEN[key], title: STAT_LONG_NAME[key], rule: STAT_RULE[key].body,
  add: (stats: CombatantStats, amount: number) => { stats[key] += amount; },
}])) as Record<EquipmentStat, { token: string; title: string; rule: string; add: (s: CombatantStats, n: number) => void }>;
export const EQUIPMENT_STAT_KEYS: readonly EquipmentStat[] = STAT_KEYS;

export const EQUIPMENT_EFFECT_REGISTRY = {
  outgoingHealPct: {
    title: 'Outgoing Healing',
    rule: 'Increases direct healing. Excludes drain, lifesteal, regeneration, and other healing sources. Active percentages add before one integer floor.',
    clause: (n: number) => `HEAL +${n}%`,
    apply: (amount: number, n: number) => {
      const product = amount * (100 + n);
      if (!Number.isSafeInteger(product)) throw new Error('equipment healing exceeds safe integer range');
      return Math.floor(product / 100);
    },
  },
} satisfies Record<keyof EquipmentEffectMods, { title: string; rule: string; clause: (n: number) => string; apply: (amount: number, n: number) => number }>;
export const EQUIPMENT_EFFECT_KEYS = Object.keys(EQUIPMENT_EFFECT_REGISTRY) as (keyof EquipmentEffectMods)[];

export const EQUIPMENT_SELECTOR_REGISTRY = {
  weapon: {
    values: ['sword', 'axe', 'lance', 'bow', 'beast'] as readonly WeaponType[],
    rule: 'Counts active board card instances with the selected weapon.',
    matches: (card: EquipmentActiveCard, value: string) => card.weapon === value,
    clause: (value: string) => value.toUpperCase(),
  },
  property: {
    values: ['physical', 'magical', 'true'] as readonly Property[],
    rule: 'Counts active board card instances with the selected property.',
    matches: (card: EquipmentActiveCard, value: string) => card.property === value,
    clause: (value: string) => value.toUpperCase(),
  },
  archetypesIncludes: {
    values: ['offense', 'defensive', 'healing', 'support', 'debuff'] as readonly Archetype[],
    rule: 'Counts active board card instances whose archetypes include the selected archetype.',
    matches: (card: EquipmentActiveCard, value: string) => card.archetypes.some((a) => a === value),
    clause: (value: string) => value.toUpperCase(),
  },
} satisfies Record<keyof EquipmentMatch, { values: readonly string[]; rule: string; matches: (card: EquipmentActiveCard, value: string) => boolean; clause: (value: string) => string }>;
export const EQUIPMENT_SELECTOR_KEYS = Object.keys(EQUIPMENT_SELECTOR_REGISTRY) as (keyof EquipmentMatch)[];

export function equipmentCardMatches(card: EquipmentActiveCard, match: EquipmentMatch): boolean {
  return EQUIPMENT_SELECTOR_KEYS.every((key) => {
    const value = match[key];
    return value === undefined || EQUIPMENT_SELECTOR_REGISTRY[key].matches(card, value);
  });
}
