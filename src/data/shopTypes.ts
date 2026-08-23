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
  /** Matches EVERY gem in the book, unconditionally — the "full gem book"
   * mechanism (Gemcutter only; no other shop should set this). */
  all?: boolean;
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
  /** Node wave (1-indexed) below which map-gen's theme bag will never draw
   * this shop (consumed by `src/run/runMap.ts`). Omitted = eligible from
   * wave 1. */
  minWave?: number;
  /** Per-card gold markup/discount, folded into `goldPriceOfCard` by
   * `src/run/shop.ts` (an economy-pacing knob, never a PL/balance number).
   * Omitted = 0 (today's byte-identical pricing). */
  priceDelta?: number;
  /** Declarative tier-roll bias consumed by `rollOfferedTier` in
   * `src/run/shop.ts`; `'silver'` shifts the roll to favor silver regardless
   * of node depth (the "upgrade shop" feel). Omitted = the normal
   * depth-based 70/25/5 -> 45/45/10 -> 25/55/20 split. */
  tierBias?: 'silver';
}

// Bigger shelves (2026-08-04, "shops sell more" pass): the target is ~6 card
// offers + ~5 gem offers per shelf everywhere a shop actually sells that
// item at all — `rollShopStock`/`shopPoolInfo` already cap a shelf at
// `min(shelf, pool)` (see the "pool arithmetic" section of `src/run/shop.ts`),
// so declaring the bigger number here is enough: a thin theme (an element
// stall, say) just shows its whole pool instead of an artificially truncated
// slice of it — no logic change needed, only the declared target moves.
const SHELF = { cards: 6, gems: 5 } as const;

const defs: ShopTypeDef[] = [
  {
    id: 'armory',
    name: 'Armory',
    tagline: 'Steel and shield — sword, axe, and lance work.',
    cardFilter: [{ weapons: ['sword', 'axe', 'lance'] }],
    gemFilter: [
      {
        // RETIRE (gem ruleset v1 §10, 2026-08-09): sword_slash_echo,
        // crushing_blow_echo removed (flat-damage duplicates).
        // ADD (2026-08-19, reachability curation pass): the full expose ladder
        // (vulnerability/weak_point/exposed_nerve/raw_nerve) is the same
        // "reduce enemy resilience so a hit counts for more" idea armor_break_
        // echo/enfeebling_shard already sell here, generalized from DEF-only to
        // all direct hits — and Armory was the one v1 theme with no Legendary
        // in its curated list, a gap raw_nerve_sliver now closes.
        ids: [
          'brawlers_core',
          'bulwark_core',
          'iron_bulwark_echo',
          'armor_break_echo',
          'enfeebling_shard',
          'war_banner_echo',
          'vulnerability_sliver',
          'weak_point_sliver',
          'exposed_nerve_sliver',
          'raw_nerve_sliver',
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
        // RETIRE: quickening_core, savage_bite_echo, hunter_shot_echo,
        // rending_claws_echo removed (flat-damage/slow duplicates). Backfilled
        // with stunning_shard/crippling_strike_echo (predator control/debuff
        // fits "fast, feral") to keep the pool at the standard fill target.
        ids: [
          'swift_charm',
          'quickening_sliver',
          'venom_fang_echo',
          'leeching_fang_echo',
          'stunning_shard',
          'crippling_strike_echo',
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
        // RETIRE: arcane_bolt_echo removed (flat-damage duplicate).
        ids: [
          'archmages_core',
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
        // ADD (2026-08-19, reachability curation pass): renewal_sliver
        // (cleanse + heal) is the healing/support theme's own gem — the same
        // cleanse+heal pairing the catalog already ships on `purge_the_rot`
        // (a Sanctum-eligible healing card), just as a socketable facet.
        ids: [
          'mending_light_echo',
          'second_wind_echo',
          'purify_echo',
          'restorative_core',
          'prism_barrier_echo',
          'ward_of_silence_echo',
          'renewal_sliver',
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
        // RETIRE: stunning_smash_echo, hamstring_echo removed (slow duplicates).
        // CONSOLIDATE (2026-08-21, user ruling "there should only be 1 gem to
        // give splash"): tremor_sliver/fracture_sliver (the burden+splash
        // ladder, curated here 2026-08-19) collapsed into ripple_sliver — THE
        // splash gem, whose only action is the spreader. Still a bind on the
        // enemy's next few plays, a control effect in the same family as the
        // slow/poison hexes already curated here, not a weapon mechanic.
        ids: [
          'venom_sliver',
          'venom_fang_echo',
          'stunning_shard',
          'concussive_shot_echo',
          'concussive_shard',
          'slow_hex_echo',
          'ripple_sliver',
          // ADD (2026-08-21, card-targeting gem pass): the burden ladder
          // (ballast/millstone) and the curse gem are the PAYLOADS ripple_sliver
          // spreads, and festering_sliver is the poison payoff that pairs with
          // venom_sliver's lane — all four are binds/hexes on the enemy's next
          // plays, the same control family already curated here.
          'ballast_sliver',
          'millstone_sliver',
          'blunting_sliver',
          'festering_sliver',
        ],
      },
    ],
    shelf: SHELF,
  },

  // ---- Build shops (v1.5 — docs/run-shops-design.md §3) ----
  {
    id: 'gemcutter',
    name: 'Gemcutter',
    tagline: 'Facets for every socket.',
    cardFilter: [],
    gemFilter: [{ all: true }],
    // Kept at 6 (not the standard 5-gem target, 2026-08-04) on purpose —
    // Gemcutter's whole identity is "the biggest gem shelf in the game" (it
    // rolls off the FULL gem book via the `all` clause — 46 -> 35, gem
    // ruleset v1 §10 migration, 2026-08-09), and 6 is exactly the
    // desktop/mobile gem grid's row capacity.
    shelf: { cards: 0, gems: 6 },
    minWave: 2,
  },
  {
    id: 'caravan',
    name: 'Caravan',
    tagline: 'Everything, once, at a price.',
    // Empty clause -> every field wildcards -> matches the whole card book.
    cardFilter: [{}],
    gemFilter: [
      {
        ids: [
          'swift_charm',
          'brawlers_core',
          'lightweight_core',
          'empowering_core',
          'restorative_core',
          'quickening_sliver',
        ],
      },
    ],
    shelf: { cards: 6, gems: 5 },
    priceDelta: 1,
  },
  {
    id: 'bulwark',
    name: 'Bulwark',
    tagline: 'Nothing gets through.',
    cardFilter: [
      { archetypes: ['defensive'] },
      { archetypes: ['support'] },
      { properties: ['physical'], archetypes: ['defensive'] },
    ],
    gemFilter: [
      {
        // ADD (2026-08-19, reachability curation pass): sanctuary_sliver
        // (ward + armor buff) is "nothing gets through" itself — an outright
        // ailment block plus resilience, the tank kit's own gem. provoker_
        // sliver (taunt) is the aggro-holding half of the same tank identity:
        // the enemy hits the wall instead of the squishies behind it.
        // ADD (2026-08-19, content-designer, defect fix): taunting_sliver is
        // provoker_sliver's Rare rung-2 sibling on the same taunt ladder —
        // same aggro-holding tank identity, curated alongside it.
        ids: [
          'bulwark_core',
          'iron_bulwark_echo',
          'mana_ward_echo',
          'prism_barrier_echo',
          'frost_ward_echo',
          'ward_of_silence_echo',
          'purify_echo',
          'restorative_core',
          'sanctuary_sliver',
          'provoker_sliver',
          'taunting_sliver',
        ],
      },
    ],
    shelf: { cards: 6, gems: 5 },
  },
  {
    id: 'assassins_den',
    name: "Assassins' Den",
    tagline: 'Fast, quiet, lethal.',
    cardFilter: [{ archetypes: ['offense'], weapons: ['bow', 'beast'] }, { properties: ['true'] }],
    gemFilter: [
      {
        // RETIRE: quickening_core, hunter_shot_echo, savage_bite_echo,
        // rending_claws_echo, purging_strike_echo removed (flat-damage/slow
        // duplicates). soul_rend_echo -> resonant_echo (REPLACE, gem ruleset
        // v1 §10: it became THE Echo, new id). Backfilled with
        // shield_splitter_echo/follow_through_echo (ambush/chain-attack fits
        // "fast, quiet, lethal") to keep the pool at the standard fill target.
        ids: [
          'swift_charm',
          'quickening_sliver',
          'leeching_fang_echo',
          'resonant_echo',
          'shield_splitter_echo',
          'follow_through_echo',
        ],
      },
    ],
    shelf: { cards: 6, gems: 5 },
  },
  {
    id: 'relic_vault',
    name: 'Relic Vault',
    tagline: 'Old power, honest price.',
    // Empty clause -> matches the whole card book; the "upgrade" identity
    // comes from tierBias + priceDelta, not a narrower card filter or a
    // deliberately thin shelf (2026-08-04: raised to the standard 6/5 target
    // like every other non-specialist shop — nothing locks this one thin).
    cardFilter: [{}],
    gemFilter: [
      {
        // soul_rend_echo -> resonant_echo (REPLACE, gem ruleset v1 §10).
        ids: [
          'archmages_core',
          'concussive_shard',
          'resonant_echo',
          'restorative_core',
          'bulwark_core',
          'empowering_core',
          'prism_barrier_echo',
          'enfeebling_shard',
        ],
      },
    ],
    shelf: { cards: 6, gems: 5 },
    priceDelta: 1,
    minWave: 3,
    tierBias: 'silver',
  },

  // ---- Element specialist stalls (thin-by-design — docs/run-shops-design.md
  // §2b, USER-LOCKED: a narrow theme selling 1-7 cards is a specialist stall,
  // not a bug. Each pairs an element's card filter with its matching echo
  // gems, so the elemental wheel gets a shopping identity of its own. The
  // declared `shelf` below is the same 6/5 target every other shop uses
  // (2026-08-04) — these pools are all <= 6 cards / <= 5 gems already, so
  // `rollShopStock`/`shopPoolInfo` cap the ACTUAL shelf at the pool size
  // regardless; raising the declared number here just stops artificially
  // truncating a thin pool (e.g. Reliquary's 5 gems used to cap at 2, so 3
  // of its own 5 gems could never appear at all) — the stall stays exactly
  // as thin as its pool, never bigger.) ----
  {
    id: 'emberworks',
    name: 'Emberworks',
    tagline: 'Fire answers to nobody.',
    cardFilter: [{ elements: ['fire'] }],
    gemFilter: [{ ids: ['fireball_echo'] }],
    shelf: { cards: 6, gems: 5 },
  },
  {
    id: 'frosthold',
    name: 'Frosthold',
    tagline: 'Cold patience.',
    cardFilter: [{ elements: ['frost'] }],
    gemFilter: [{ ids: ['mana_ward_echo', 'frost_ward_echo'] }],
    shelf: { cards: 6, gems: 5 },
  },
  {
    id: 'stormspire',
    name: 'Stormspire',
    tagline: 'Thunder, sold by the bolt.',
    cardFilter: [{ elements: ['lightning'] }],
    // RETIRE: arcane_bolt_echo removed (flat-damage duplicate), leaving this
    // stall's one curated gem empty. Backfilled with battle_howl_echo (a
    // charged-up ATK surge reads as "thunder", and the stall keeps its
    // one-gem thin-by-design identity per docs/history/run-shops-design.md §2b).
    gemFilter: [{ ids: ['battle_howl_echo'] }],
    shelf: { cards: 6, gems: 5 },
  },
  {
    id: 'grovekeep',
    name: 'Grovekeep',
    tagline: 'Roots outlast steel.',
    cardFilter: [{ elements: ['nature'] }],
    gemFilter: [{ ids: ['time_crystal_echo', 'second_wind_echo'] }],
    shelf: { cards: 6, gems: 5 },
  },
  {
    id: 'reliquary',
    name: 'Reliquary',
    tagline: 'Light kept in a jar.',
    cardFilter: [{ elements: ['holy'] }],
    gemFilter: [
      { ids: ['mending_light_echo', 'ward_of_silence_echo', 'purify_echo', 'judgment_light_echo', 'prism_barrier_echo'] },
    ],
    shelf: { cards: 6, gems: 5 },
  },
  {
    id: 'umbral_stall',
    name: 'Umbral Stall',
    tagline: 'Ask no questions.',
    cardFilter: [{ elements: ['dark'] }],
    // RETIRE: shadow_bolt_echo removed (flat-damage duplicate).
    // soul_rend_echo -> resonant_echo (REPLACE, gem ruleset v1 §10).
    gemFilter: [{ ids: ['hex_of_frailty_echo', 'resonant_echo'] }],
    shelf: { cards: 6, gems: 5 },
  },
];

export const shopCatalog: Record<string, ShopTypeDef> = Object.fromEntries(defs.map((d) => [d.id, d]));

/** Deterministic display/roll order. */
export const shopTypeIds: readonly string[] = defs.map((d) => d.id);
