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
  chase_mark: {
    id: 'chase_mark',
    name: 'Chase Mark',
    icon: '🏃',
    targeting: 'aggro',
    powerPct: 60,
    chase: true,
    text: "Chase: after this card resolves, immediately perform your next card — but this card's damage is 40% weaker. Tempo bought with power.",
  },
  overload_mark: {
    id: 'overload_mark',
    name: 'Overload Mark',
    icon: '💥',
    targeting: 'aggro',
    powerPct: 150,
    uses: 1,
    text: "Overload: this card's damage is 50% STRONGER — but it can be cast only ONCE per battle. One perfect swing.",
  },
  executioner_mark: {
    id: 'executioner_mark',
    name: "Executioner's Mark",
    icon: '⚰',
    targeting: 'lowestHp',
    text: 'Hostile effects hit the enemy with the LEAST health — finish wounded targets.',
  },
};
