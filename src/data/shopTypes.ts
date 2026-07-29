// Shop theme catalog — DECLARATIVE content only (no logic). Each shop is a
// pair of filters over card/gem attributes plus a shelf size. The matching
// predicates that APPLY these filters (`cardMatchesFilter`/`gemMatchesFilter`)
// and the actual seeded stocking logic live in `src/run/shop.ts` (pure logic,
// not content) — this module only declares WHAT each shop is willing to sell.
//
// Card filter shape: an ARRAY of clauses, OR'd together — a shop matches a
// card if ANY clause matches. Within one clause every specified field is
// AND'd: the card's own value must be a member of that field's list
// (`archetypes` uses ANY-overlap since a card can carry multiple archetypes).
// Omitted fields are wildcards (always match). This gives natural overlap
// between shops (e.g. a holy/dark debuff card can show up in both Sanctum and
// Alchemist) which is intentional — shop themes are guidelines, not silos.
//
// Gem filter shape: gems don't carry property/weapon/element/archetype
// fields (see `Gem` in engine/types), so gem clauses match on a different
// axis — an explicit curated id list, OR the effect's action kinds, OR which
// hero stat a stat-gem touches. A gem matches if it satisfies ANY clause.

import type { Action, Archetype, BuffableStat, Element, Property, WeaponType } from '../engine/types';

export interface CardFilterClause {
  properties?: readonly Property[];
  weapons?: readonly WeaponType[];
  elements?: readonly Element[];
  /** Card matches if it carries ANY of these archetypes. */
  archetypes?: readonly Archetype[];
}

/** OR of AND-clauses. */
export type CardFilter = readonly CardFilterClause[];

export interface GemFilterClause {
  /** Curated explicit gem ids (the primary mechanism — gems have no theme-bearing fields). */
  ids?: readonly string[];
  /** Effect gem matches if any of its actions has one of these kinds. */
  actionKinds?: readonly Action['kind'][];
  /** Hero-scope stat gem matches if it touches any of these stats. */
  heroStats?: readonly BuffableStat[];
}

/** OR of clauses (each clause itself is a single-axis match, not AND'd). */
export type GemFilter = readonly GemFilterClause[];

export interface ShopTypeDef {
  id: string;
  name: string;
  tagline: string;
  cardFilter: CardFilter;
  gemFilter: GemFilter;
  shelf: { cards: number; gems: number };
}

const SHELF = { cards: 4, gems: 3 } as const;

const defs: ShopTypeDef[] = [
  {
    id: 'armory',
    name: 'Armory',
    tagline: 'Steel and shield — sword, axe, and lance work.',
    cardFilter: [{ weapons: ['sword', 'axe', 'lance'] }],
    gemFilter: [
      {
        ids: [
          'brawlers_core',
          'bulwark_core',
          'iron_bulwark_echo',
          'armor_break_echo',
          'enfeebling_shard',
          'sword_slash_echo',
          'crushing_blow_echo',
          'war_banner_echo',
        ],
      },
    ],
    shelf: SHELF,
  },
  {
    id: 'wildworks',
    name: 'Wildworks',
    tagline: 'Bow and beast — fast, feral, and far-reaching.',
    cardFilter: [{ weapons: ['bow', 'beast'] }],
    gemFilter: [
      {
        ids: [
          'swift_charm',
          'quickening_sliver',
          'quickening_core',
          'savage_bite_echo',
          'hunter_shot_echo',
          'venom_fang_echo',
          'leeching_fang_echo',
          'rending_claws_echo',
        ],
      },
    ],
    shelf: SHELF,
  },
  {
    id: 'arcanum',
    name: 'Arcanum',
    tagline: 'Fire, frost, lightning, nature — the elemental wheel.',
    cardFilter: [{ properties: ['magical'], elements: ['fire', 'frost', 'lightning', 'nature'] }],
    gemFilter: [
      {
        ids: [
          'archmages_core',
          'arcane_bolt_echo',
          'fireball_echo',
          'mana_ward_echo',
          'frost_ward_echo',
          'time_crystal_echo',
        ],
      },
    ],
    shelf: SHELF,
  },
  {
    id: 'sanctum',
    name: 'Sanctum',
    tagline: 'Holy and dark rites — healing and support.',
    cardFilter: [{ elements: ['holy', 'dark'] }, { archetypes: ['healing', 'support'] }],
    gemFilter: [
      {
        ids: [
          'mending_light_echo',
          'second_wind_echo',
          'purify_echo',
          'restorative_core',
          'prism_barrier_echo',
          'ward_of_silence_echo',
        ],
      },
    ],
    shelf: SHELF,
  },
  {
    id: 'alchemist',
    name: 'Alchemist',
    tagline: 'Poisons, hexes, and binds — debuff and control.',
    cardFilter: [{ archetypes: ['debuff'] }],
    gemFilter: [
      {
        ids: [
          'venom_sliver',
          'venom_fang_echo',
          'stunning_shard',
          'stunning_smash_echo',
          'concussive_shot_echo',
          'concussive_shard',
          'hamstring_echo',
          'slow_hex_echo',
        ],
      },
    ],
    shelf: SHELF,
  },
];

export const shopCatalog: Record<string, ShopTypeDef> = Object.fromEntries(defs.map((d) => [d.id, d]));

/** Deterministic display/roll order. */
export const shopTypeIds: readonly string[] = defs.map((d) => d.id);
