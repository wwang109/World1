import type { EnchantBook } from '../engine/types';

/**
 * Targeting enchantments — attach to a PLACED card (per board piece, via the
 * Card Library page). Sidegrades by design: they trade target QUALITY for raw
 * power instead of adding PL. High-aggro targeting is the engine default, so
 * it needs no enchant; taunt/lure cards will manipulate aggro itself later.
 */
export const enchantBook: EnchantBook = {
  storm_mark: {
    id: 'storm_mark',
    name: 'Storm Mark',
    icon: '🌀',
    targeting: 'all',
    aoeDamagePct: 60,
    text: 'AoE: damage strikes hit EVERY living enemy for 60% of the rolled amount. Other effects keep a single target.',
  },
  assassin_mark: {
    id: 'assassin_mark',
    name: "Assassin's Mark",
    icon: '🎯',
    targeting: 'lowAggro',
    text: 'Hostile effects hit the LOWEST-aggro enemy — snipe whoever hides behind the tank.',
  },
  executioner_mark: {
    id: 'executioner_mark',
    name: "Executioner's Mark",
    icon: '⚰',
    targeting: 'lowestHp',
    text: 'Hostile effects hit the enemy with the LEAST health — finish wounded targets.',
  },
};
