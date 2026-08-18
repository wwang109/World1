// Shop v1 — pure run-layer state transitions over the declarative themes in
// `src/data/shopTypes.ts`. No Phaser, no Date.now/Math.random — all
// randomness flows through the engine's seeded `Rng` in a fixed call order,
// so `rollShopStock(shopId, seed)` is reload-safe (same inputs, same shelf).

import { gemPowerLevelDeci } from '../engine/balance';
import { hashSeed, Rng } from '../engine/rng';
import type { Action, BuffableStat, Rarity, SkillDef, SkillTier } from '../engine/types';
import type { GemDef } from '../data/gems';
import { gemBook } from '../data/gems';
import { skillBook } from '../data/skills';
import type { CardFilter, CardFilterClause, GemFilter, GemFilterClause } from '../data/shopTypes';
import { shopCatalog } from '../data/shopTypes';
import type { EnemyTitle } from './encounter';
import { TITLE_PRESETS } from './encounter';

// ---------------------------------------------------------------------------
// Filter matching — applies the declarative clauses from shopTypes.ts.
// ---------------------------------------------------------------------------

function cardMatchesClause(skill: SkillDef, clause: CardFilterClause): boolean {
  if (clause.properties && !clause.properties.includes(skill.property)) return false;
  if (clause.weapons && (!skill.weapon || !clause.weapons.includes(skill.weapon))) return false;
  if (clause.elements && (!skill.element || !clause.elements.includes(skill.element))) return false;
  if (clause.archetypes && !skill.archetypes.some((a) => clause.archetypes!.includes(a))) return false;
  return true;
}

/** A card matches a shop's `cardFilter` iff it satisfies ANY clause (OR of ANDs). */
export function cardMatchesFilter(skill: SkillDef, filter: CardFilter): boolean {
  return filter.some((clause) => cardMatchesClause(skill, clause));
}

function gemMatchesClause(gem: GemDef, clause: GemFilterClause): boolean {
  if (clause.all) return true;
  if (clause.ids && clause.ids.includes(gem.id)) return true;
  if (clause.actionKinds && gem.kind === 'effect' && gem.actions.some((a) => clause.actionKinds!.includes(a.kind))) {
    return true;
  }
  if (clause.heroStats && gem.kind === 'stat' && gem.scope === 'hero') {
    const hero = gem.mods.hero;
    if (hero && clause.heroStats.some((stat) => hero[stat as BuffableStat] !== undefined)) return true;
  }
  return false;
}

/** A gem matches a shop's `gemFilter` iff it satisfies ANY clause. */
export function gemMatchesFilter(gem: GemDef, filter: GemFilter): boolean {
  return filter.some((clause) => gemMatchesClause(gem, clause));
}

/** Every skill matching a given shop's card filter (deterministic book order). */
export function cardPoolForShop(shopId: string): SkillDef[] {
  const shop = shopCatalog[shopId];
  if (!shop) throw new Error(`cardPoolForShop: unknown shop id "${shopId}"`);
  return Object.values(skillBook).filter((s) => cardMatchesFilter(s, shop.cardFilter));
}

/** Every gem matching a given shop's gem filter (deterministic book order). */
export function gemPoolForShop(shopId: string): GemDef[] {
  const shop = shopCatalog[shopId];
  if (!shop) throw new Error(`gemPoolForShop: unknown shop id "${shopId}"`);
  return Object.values(gemBook).filter((g) => gemMatchesFilter(g, shop.gemFilter));
}

// ---------------------------------------------------------------------------
// Pricing — ECONOMY-PACING knobs. These gold prices are NOT balance numbers;
// Power Level (src/engine/balance.ts) remains the only balance currency. Gold
// only paces how fast a run can afford to buy the cards/gems it draws.
// ---------------------------------------------------------------------------

/** Card gold price by offered tier — an economy-pacing knob, not a PL/balance number. */
export const GOLD_PRICE_BY_TIER: Record<SkillTier, number> = {
  bronze: 2,
  silver: 3,
  gold: 4,
  diamond: 5,
};

export function goldPriceOfCard(tier: SkillTier): number {
  return GOLD_PRICE_BY_TIER[tier];
}

/**
 * Card price with a shop's `priceDelta` markup/discount folded in (floored at
 * 1 gold so a discount can never make a card free). Omitted `priceDelta` ->
 * `goldPriceOfCard(tier)` byte-identically (today's behavior).
 */
export function goldPriceOfCardForShop(tier: SkillTier, priceDelta = 0): number {
  return Math.max(1, goldPriceOfCard(tier) + priceDelta);
}

/**
 * Gem gold price, derived from the gem's own PL (`gemPowerLevelDeci`) —
 * monotonic in PL. Thresholds key off the rarity bands (Common 20 · Rare 40
 * · Epic 60 · Legendary 80 deci, `RARITY_PL_DECI` in balance.ts, zero-
 * tolerance so every gem's OWN deci lands exactly on its band): Common -> 1,
 * Rare -> 2, Epic -> 3, Legendary -> 4 — ONE rung per rarity band, each
 * exactly 20 deci-PL apart, priced 1 gold apart. (Bumped from 3, 2026-08-09
 * gem ruleset v1 §9.6 + fork 5: the 46 -> 35 migration left the catalog with
 * a genuinely build-defining Legendary category — resonant_echo/the Echo
 * among them — so the top of the price ladder should read as meaningfully
 * pricier, not one gold above Rare/Epic.)
 *
 * Epic split out of the old shared Rare/Epic rung (2026-08-18): the shared
 * rung priced Epic (60 deci) at the same 2 gold as Rare (40 deci), which
 * put Epic at 30 deci-PL/gold against a flat 20 everywhere else in the
 * economy (every card tier is exactly 50 deci-PL/gold; Common/Rare/
 * Legendary gems were all exactly 20) — Epic was the lone 1.5x outlier, an
 * unintentional auto-buy relative to its own neighbors. Giving Epic its own
 * rung restores the flat 20 deci-PL/gold across all four gem rarities:
 * Common 20/1=20, Rare 40/2=20, Epic 60/3=20, Legendary 80/4=20. Monotonic-
 * preserving and, like the Legendary bump above, exact on the rarity bands
 * (no gem's own deci falls in [60, 80) except Epic, so this re-prices Epic
 * alone and leaves Common/Rare/Legendary byte-identical).
 */
export function goldPriceOfGem(gemId: string): 1 | 2 | 3 | 4 {
  const gem = gemBook[gemId];
  if (!gem) throw new Error(`goldPriceOfGem: unknown gem id "${gemId}"`);
  const deci = gemPowerLevelDeci(gem);
  if (deci < 40) return 1;
  if (deci < 60) return 2;
  if (deci < 80) return 3;
  return 4;
}

// ---------------------------------------------------------------------------
// SELL-BACK pricing (2026-08-04) — half of the item's own shop price,
// rounded down, floored at 1 gold (never free/zero). Shared by BOTH
// `src/run/runState.ts#sellRunCard`/`sellRunGem` and their sandbox mirror
// (`src/game/shopActions.ts#sellCard`/`sellGem`) so there is exactly one
// sell-pricing table, matching the existing `goldPriceOfCard`/
// `goldPriceOfGem` idiom this economy already uses everywhere else. Gold
// remains an economy-pacing knob, not a PL/balance number (see the comment
// block above `GOLD_PRICE_BY_TIER`).
// ---------------------------------------------------------------------------

/** Sell-back price for a card at `tier` — half of `goldPriceOfCard(tier)`,
 * rounded down, floored at 1 gold. Does NOT fold a shop's `priceDelta` (a
 * sold card doesn't belong to any particular shop's markup/discount — it's
 * priced off the tier alone, the same table every shop's buy price derives
 * from before that shop's own delta is applied). */
export function sellPriceOfCard(tier: SkillTier): number {
  return Math.max(1, Math.floor(goldPriceOfCard(tier) / 2));
}

/** Sell-back price for a gem — half of its shop price (`goldPriceOfGem`,
 * itself derived from the gem's own PL/rarity), rounded down, floored at 1
 * gold. Common/Rare/Epic (buy 1, 2, or 3 since the 2026-08-18 per-rarity
 * rung split) all floor to 1 gold (1/2->1, 2/2->1, 3/2->1, still); Legendary
 * (buy 4, since the 2026-08-09 price bump) sells for 2 — the first gem
 * rarity whose sell-back is actually distinguishable from the rest. Epic's
 * OWN sell price is unchanged by the 2026-08-18 rung split (2->1 before,
 * 3->1 after — floor(2/2) and floor(3/2) are both 1) even though its BUY
 * price moved. */
export function sellPriceOfGem(gemId: string): number {
  return Math.max(1, Math.floor(goldPriceOfGem(gemId) / 2));
}

// ---------------------------------------------------------------------------
// Stocking — seeded, deterministic, reload-safe.
// ---------------------------------------------------------------------------

export interface CardOffer {
  skillId: string;
  tier: SkillTier;
  price: number;
}

export interface GemOffer {
  gemId: string;
  price: number;
}

export interface ShopStock {
  shopId: string;
  seed: number;
  cards: CardOffer[];
  gems: GemOffer[];
}

/** Draw `count` DISTINCT items from `pool`, consuming one `rng.int` call per draw (fixed order). */
function sampleDistinct<T>(rng: Rng, pool: readonly T[], count: number): T[] {
  const remaining = [...pool];
  const result: T[] = [];
  const n = Math.min(count, remaining.length);
  for (let i = 0; i < n; i++) {
    const idx = rng.int(remaining.length);
    result.push(remaining[idx]!);
    remaining.splice(idx, 1);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Gem rarity distribution — run-layer scarcity, NOT pricing (gem ruleset v1
// §9.6 + fork 5 default, 2026-08-09). PL stays the one balance currency
// (src/engine/balance.ts); the numbers below tune how OFTEN a shelf shows a
// rarity, never what it's worth in a fight.
// ---------------------------------------------------------------------------

/**
 * Per-rarity draw weight for a shop's gem shelf, replacing the old uniform
 * `sampleDistinct` draw for gems (cards are untouched — still uniform). The
 * weight is PER RARITY BAND, not per gem: every Common candidate in a pool
 * shares this same weight, so a themed shelf's own rarity MIX still matters
 * (a pool with 2 curated Legendaries offers roughly double the Legendary
 * chance of a pool with 1) while the band itself reads as rare everywhere.
 *
 * CHOSEN SHAPE — 60 / 25 / 10 / 5 (sums to 100, so each number doubles as a
 * "percent of a same-mix pool"), derived like this:
 *   - Common carries the shelf (60): most of what a run buys is filler power,
 *     by design — a shop that mostly sold Rares+ would trivialize its own
 *     gold economy long before the Legendary problem this task is about.
 *   - Rare at 25 keeps it a real, frequent upgrade (roughly 1 in 4 of a
 *     same-mix pool's picks) without competing with Common for "default".
 *   - Epic at 10 and Legendary at 5 are a 2x step down each rung — the same
 *     halving cadence as the Rare->Common gap is more than double (25->60
 *     is +140%), so the top of the ladder thins out FASTER than the bottom,
 *     which is the "rare things should feel rare" shape a roguelite shop
 *     wants, not a linear ramp.
 *
 * EXPECTED LEGENDARY SIGHTINGS PER RUN — measured (not guessed) against the
 * ACTUAL 2026-08-09 catalog (14 Common/13 Rare/4 Epic/4 Legendary, 35 gems),
 * by running this module's own `rollShopStock`/`generateRunMap` at scale
 * (200k-shelf and 20k-run Monte Carlo sweeps; see the "weighted gem
 * distribution" describe block in tests/run/shop.test.ts for the harness
 * these numbers are cross-checked against, run at a smaller N there so CI
 * stays fast):
 *   - Gemcutter (the only whole-book shop, `gemFilter: [{ all: true }]`,
 *     `shelf.gems: 6`, `minWave: 2` so it also clears the depth gate below by
 *     construction): E[Legendaries per shelf] ~= 0.105 (~1 in 9.5 visits
 *     shows exactly one — the one-per-shelf cap below means it's never two).
 *   - A themed 5-6-gem curated pool with exactly one Legendary in it lands
 *     in the 0.11-0.41 range depending on how many OTHER items its own pool
 *     has to dilute against (Bulwark 0.20, Assassins' Den 0.22, Alchemist
 *     0.26, Sanctum/Caravan 0.41) — averaging ~0.11 across every themed shop
 *     EXCEPT the 3 flagged below, i.e. roughly 1 in 9 visits.
 *   - THREE curated pools are pigeonhole-SATURATED regardless of any weight
 *     choice and sit outside the shape above — though for Arcanum and Umbral
 *     Stall the DEPTH GATE above still governs: below LEGENDARY_GATE_DEPTH
 *     their Legendary is stripped from the eligible pool before the
 *     "thin shop shows its full pool" rule runs, so "every visit" means
 *     "every visit once depth >= LEGENDARY_GATE_DEPTH" for them (Relic
 *     Vault's minWave: 3 floor guarantees it always clears the gate).
 *     Arcanum (`gemFilter` pool == its own 5-gem shelf size, so the shelf
 *     shows its WHOLE pool, including its one Legendary — the existing
 *     "thin shop shows its full pool" rule, unrelated to this feature),
 *     Umbral Stall (2-gem pool < 5-gem shelf, same full-pool rule, shows
 *     its one Legendary), and Relic Vault (an 8-gem pool that happens to be 4
 *     Legendary + 4 Epic with NO Common/Rare at all diluting it — its 5-gem
 *     shelf exceeds the 4-item non-Legendary complement, so plain pigeonhole
 *     forces >=1 Legendary onto every shelf regardless of weighting; the
 *     one-per-shelf cap below turns that into an exact "always exactly 1").
 *     Fixing these 3 requires touching `shopTypes.ts` pool curation or
 *     shelf-size declarations (content, out of this task's scope) — flagged
 *     for content-designer/balance-designer, not silently worked around here.
 *   - RUN-LEVEL (20k simulated runs through wave 10, "visits every shop node
 *     the map ever offers" as the upper-bound player policy — map-gen offers
 *     ~5.0 shop opportunities by wave 10 at the existing ~0.5-shop/wave
 *     rate): averaging over ALL 16 shop themes (including the 3 saturated
 *     ones above) gives ~0.264 Legendary sightings per shop opportunity,
 *     ~1.32 per 10-wave run, and a ~79% chance of seeing at least one
 *     Legendary SOMEWHERE by wave 10. Restricted to the 13 non-saturated
 *     themes alone (the number this weight table actually controls), that
 *     drops to ~0.112 per shop opportunity — the "rare, not routine" feel
 *     the weights were chosen for.
 */
const GEM_RARITY_WEIGHT: Record<Rarity, number> = {
  common: 60,
  rare: 25,
  epic: 10,
  legendary: 5,
};

/**
 * DEPTH GATE — Legendary gems never appear before `LEGENDARY_GATE_DEPTH`.
 * `depth` here is the SAME depth band `rollShopStock` already threads for
 * the card bronze/silver/gold split (`shopStockDepthForWave` in
 * runState.ts: wave 1 -> depth 2, waves 2-3 -> depth 5, wave 4+ -> depth 8)
 * — this is a second consumer of a number that already flows through, not a
 * new seam. Gating at `depth >= 5` therefore means exactly "wave 2 or
 * later": a run's very first wave (depth 2) never offers a Legendary gem
 * anywhere, no matter how the rarity dice land.
 *
 * Epic is left UNGATED (eligible from depth 2, i.e. a run's very first
 * shop). The band resolution available at this seam is per-WAVE, not finer
 * — there is no "mid-wave-1" depth value to gate against — and Epic's own
 * PL (6, one band under Legendary's 8) doesn't carry the same "build-
 * defining" risk that motivated this feature (resonant_echo and its 3
 * Legendary siblings specifically). Gating Epic too would be belt-and-
 * suspenders on top of its already-low draw weight (10, half of Rare's),
 * not a meaningfully different economy.
 */
const LEGENDARY_GATE_DEPTH = 5;

export function gemRarityEligible(rarity: Rarity, depth: number): boolean {
  if (rarity === 'legendary') return depth >= LEGENDARY_GATE_DEPTH;
  return true;
}

/**
 * Draw `count` DISTINCT gems from `pool`, weighted by `GEM_RARITY_WEIGHT`
 * (Commons far more likely than Legendaries). One `rng.int(totalWeight)`
 * call per pick — same fixed-one-draw-per-slot shape as `sampleDistinct`,
 * just weighted instead of uniform, so the RNG call COUNT and ORDER downstream
 * callers rely on is unchanged; only the value each call resolves to differs.
 * Arrays only, iterated by index — never a Map/Set (determinism invariant).
 *
 * ONE-LEGENDARY-PER-SHELF CAP: once a Legendary has been picked, every OTHER
 * remaining Legendary candidate is removed from the pool before the next
 * slot draws (`.filter`, still array/index-based — no Map/Set). This is a
 * measured addition, not a request in the original spec: `relic_vault`'s
 * OWN curated pool is 4 Legendary + 4 Epic with zero Common/Rare, and its
 * 5-gem shelf exceeds that pool's 4-item non-Legendary complement — plain
 * pigeonhole forces at least 1 Legendary onto that shelf EVERY visit
 * regardless of weight, and measurement (200k shelves, no cap) showed it
 * landing 2 Legendaries about as often as 1 (mean ~1.99/shelf) — the exact
 * "trivializes the economy" outcome this whole feature exists to prevent.
 * The cap doesn't touch shopTypes.ts content (out of scope here); it's a
 * pure run-layer rule and, on relic_vault specifically, becomes a hard
 * "always exactly 1" (pigeonhole plus the cap now agree on the same slot).
 */
export function sampleGemsWeighted(rng: Rng, pool: readonly GemDef[], count: number): GemDef[] {
  let remaining = [...pool];
  const result: GemDef[] = [];
  const n = Math.min(count, remaining.length);
  for (let i = 0; i < n; i++) {
    let total = 0;
    for (let j = 0; j < remaining.length; j++) total += GEM_RARITY_WEIGHT[remaining[j]!.rarity];
    let roll = rng.int(total);
    let idx = 0;
    for (; idx < remaining.length - 1; idx++) {
      const weight = GEM_RARITY_WEIGHT[remaining[idx]!.rarity];
      if (roll < weight) break;
      roll -= weight;
    }
    const picked = remaining[idx]!;
    result.push(picked);
    remaining.splice(idx, 1);
    if (picked.rarity === 'legendary') {
      remaining = remaining.filter((g) => g.rarity !== 'legendary');
    }
  }
  return result;
}

/**
 * ONE depth-gated, rarity-weighted gem pick from `pool` — the shared draw
 * both the shop shelf (`rollShopStock`, via `sampleGemsWeighted` above) and
 * event `grantGem` grants (`src/run/events.ts#grantGemOutcome`) now route
 * through, so a run's gem-rarity discipline (`GEM_RARITY_WEIGHT` +
 * `LEGENDARY_GATE_DEPTH`) applies identically no matter which system handed
 * out the gem. Deliberately a THIN wrapper around `sampleGemsWeighted` (one
 * pick, `count: 1`) rather than a reimplementation — a mirrored copy of the
 * weight table or the gate constant is exactly the kind of duplication that
 * caused a live bug elsewhere in this codebase.
 *
 * Falls back to the UNGATED `pool` if depth-gating a narrow (e.g.
 * filter-restricted) pool would leave nothing eligible — defensive only:
 * every real caller's pool has non-Legendary members, so the fallback should
 * never actually trigger, but an empty draw pool must never throw over a
 * content edge case.
 */
export function pickWeightedGem(rng: Rng, pool: readonly GemDef[], depth: number): GemDef {
  const eligible = pool.filter((g) => gemRarityEligible(g.rarity, depth));
  const drawPool = eligible.length > 0 ? eligible : pool;
  const [picked] = sampleGemsWeighted(rng, drawPool, 1);
  if (!picked) throw new Error('pickWeightedGem: empty gem pool');
  return picked;
}

/**
 * `count` depth-gated, rarity-weighted, DISTINCT gem picks from `pool` — the
 * multi-pick sibling of `pickWeightedGem` above (same eligibility gate/
 * fallback, same underlying `sampleGemsWeighted`, just `count` instead of a
 * fixed 1), added for the event catalog's `gemChoice` outcome
 * (`src/run/events.ts#gemChoiceOutcome`): a player picking 1-of-3 gems still
 * draws from the SAME depth-gated, one-Legendary-capped pool a same-depth
 * shop shelf or a single `grantGem` grant would. `pickWeightedGem` itself is
 * left untouched (still its own thin `count: 1` wrapper) rather than
 * refactored to call this — no behavior change to any existing caller.
 */
export function pickWeightedGems(rng: Rng, pool: readonly GemDef[], depth: number, count: number): GemDef[] {
  const eligible = pool.filter((g) => gemRarityEligible(g.rarity, depth));
  const drawPool = eligible.length > 0 ? eligible : pool;
  return sampleGemsWeighted(rng, drawPool, count);
}

/**
 * Bronze/silver/gold split by node depth (see docs/run-shops-design.md §1):
 * depths 1-3 -> 70/25/5 (today's byte-identical behavior, the sandbox
 * default), 4-6 -> 45/45/10, 7-9 -> 25/55/20. Diamond never appears in shops.
 * A `tierBias: 'silver'` shop (Relic Vault) overrides the depth split
 * entirely with a fixed silver-heavy roll (see `ShopTypeDef.tierBias`).
 */
function tierThresholds(depth: number, tierBias?: 'silver'): { bronze: number; silver: number } {
  if (tierBias === 'silver') return { bronze: 20, silver: 85 };
  if (depth <= 3) return { bronze: 70, silver: 95 };
  if (depth <= 6) return { bronze: 45, silver: 90 };
  return { bronze: 25, silver: 80 };
}

function rollOfferedTier(rng: Rng, depth: number, tierBias?: 'silver'): SkillTier {
  const { bronze, silver } = tierThresholds(depth, tierBias);
  const roll = rng.int(100);
  if (roll < bronze) return 'bronze';
  if (roll < silver) return 'silver';
  return 'gold';
}

/**
 * Seeded shelf roll for one shop: up to `shelf.cards` distinct card offers and
 * up to `shelf.gems` distinct gem offers. Same (shopId, seed, depth,
 * rarityGated) -> identical shelf, forever (no wall-clock or ambient
 * randomness). RNG call order is fixed: card picks, then each picked card's
 * tier roll, then gem picks (weighted — one `rng.int` draw per gem slot,
 * same as before, see `sampleGemsWeighted`). `depth` (1-indexed run depth)
 * shifts the card tier split AND (via `gemRarityEligible`) which gem
 * rarities are even in the draw pool; every non-run caller omits it and gets
 * today's 70/25/5 tier behavior + the depth-2 rarity gate byte-identical.
 *
 * `rarityGated` (default `true`) is the Sandbox escape hatch: the sandbox
 * (`src/game/shopActions.ts`) has no run/depth concept at all and is the
 * balance/deck-idea playground (USER-LOCKED: unlimited wallet) — it needs
 * every rarity visible unconditionally, so it's the one caller that passes
 * `false` explicitly. Every real run call (`src/run/runState.ts`) always
 * passes an explicit `depth` and leaves `rarityGated` at its gated default.
 */
export function rollShopStock(shopId: string, seed: number, depth = 1, rarityGated = true): ShopStock {
  const shop = shopCatalog[shopId];
  if (!shop) throw new Error(`rollShopStock: unknown shop id "${shopId}"`);
  const rng = new Rng(hashSeed('shop', shopId, seed));

  const cardPool = cardPoolForShop(shopId);
  const pickedCards = sampleDistinct(rng, cardPool, shop.shelf.cards);
  const cards: CardOffer[] = pickedCards.map((skill) => {
    const tier = rollOfferedTier(rng, depth, shop.tierBias);
    return { skillId: skill.id, tier, price: goldPriceOfCardForShop(tier, shop.priceDelta) };
  });

  const gemPoolFull = gemPoolForShop(shopId);
  const gemPool = rarityGated ? gemPoolFull.filter((g) => gemRarityEligible(g.rarity, depth)) : gemPoolFull;
  const pickedGems = sampleGemsWeighted(rng, gemPool, shop.shelf.gems);
  const gems: GemOffer[] = pickedGems.map((gem) => ({ gemId: gem.id, price: goldPriceOfGem(gem.id) }));

  return { shopId, seed, cards, gems };
}

// ---------------------------------------------------------------------------
// Pool arithmetic — the "thin shops are fine" rule (docs/run-shops-design.md
// §2b, USER-LOCKED): a theme's card/gem pool may be smaller than its declared
// shelf size (`ShopTypeDef.shelf`); `rollShopStock` already caps a shelf at
// `min(shelf, pool)` via `sampleDistinct`. This is the pure helper the shop
// SCENES read to lay out 1-6 offers without dead "gap" slots and to know
// when REROLL is pointless (the whole pool already fits the shelf, so a
// reroll can only reshuffle order/tiers, never reveal something new).
// ---------------------------------------------------------------------------

export interface ShopPoolInfo {
  cardPoolSize: number;
  gemPoolSize: number;
  /** How many card/gem SLOTS this shop can ever fill, capped by its declared
   * shelf size — the number the UI should lay out columns/rows for (NOT the
   * declared shelf size itself, which may exceed a thin theme's whole pool). */
  cardSlots: number;
  gemSlots: number;
  /** True when the whole pool already fits the shelf on that axis — REROLL
   * can only reshuffle order/tiers there, never reveal a new offer. */
  cardsFull: boolean;
  gemsFull: boolean;
  /** True when BOTH axes are full — REROLL is pointless shop-wide (hide/
   * disable it and label the shelf "FULL STOCK"). */
  fullStock: boolean;
}

/** Pool-size/fullness info for a shop theme — pure, no RNG (pool membership
 * doesn't depend on a seed, only on the card/gem book + the theme's filter). */
export function shopPoolInfo(shopId: string): ShopPoolInfo {
  const shop = shopCatalog[shopId];
  if (!shop) throw new Error(`shopPoolInfo: unknown shop id "${shopId}"`);
  const cardPoolSize = cardPoolForShop(shopId).length;
  const gemPoolSize = gemPoolForShop(shopId).length;
  const cardsFull = cardPoolSize <= shop.shelf.cards;
  const gemsFull = gemPoolSize <= shop.shelf.gems;
  return {
    cardPoolSize,
    gemPoolSize,
    cardSlots: Math.min(shop.shelf.cards, cardPoolSize),
    gemSlots: Math.min(shop.shelf.gems, gemPoolSize),
    cardsFull,
    gemsFull,
    fullStock: cardsFull && gemsFull,
  };
}

// ---------------------------------------------------------------------------
// Duplicate merging — "shopping for a card you already own upgrades it one
// tier instead of adding a copy" (v1, USER-LOCKED 2026-08-04). Pure, and
// generic over any {instanceId, skillId, tier}-shaped piece/slot so BOTH
// `src/run/runState.ts` (RunBoardPiece/RunBagSlot) and `src/game/demoState.ts`
// (OwnedBoardPiece/InventorySlot, the sandbox's mirror shape) can share this
// ONE targeting rule without `src/run` importing `src/game` or the rule being
// duplicated. No RNG, no gold math here — callers (buyRunCard's merge
// sibling, shopActions.ts) own the price/shelf-consumption side.
// ---------------------------------------------------------------------------

/** Low -> high tier order a merge climbs. Mirrors the identically-named local
 * constant in `encounter.ts` (kept separate on purpose — that one is a rank
 * dial, this one is a shop-purchase dial; both must independently track
 * `SkillTier`'s 4 members, which the exhaustiveness of `MERGEABLE_TIERS`
 * below plus `tests/run/shop.test.ts` keep honest). */
export const SKILL_TIER_ORDER: readonly SkillTier[] = ['bronze', 'silver', 'gold', 'diamond'];

/** Every tier a merge can originate FROM — every tier except the ceiling
 * (diamond can never merge further). */
const MERGEABLE_TIERS: readonly SkillTier[] = SKILL_TIER_ORDER.slice(0, -1);

/** The tier directly above `tier`, or `null` if `tier` is already the ceiling
 * (`'diamond'`) — a diamond instance has nowhere left to merge to. */
export function nextSkillTier(tier: SkillTier): SkillTier | null {
  const idx = SKILL_TIER_ORDER.indexOf(tier);
  if (idx < 0 || idx >= SKILL_TIER_ORDER.length - 1) return null;
  return SKILL_TIER_ORDER[idx + 1]!;
}

/** A structural (instanceId/skillId/tier)-shaped owned card/piece — the
 * minimum shape `findMergeTarget` needs, satisfied by both `RunBoardPiece`/
 * `RunBagSlot` (src/run) and `OwnedBoardPiece`/`InventorySlot` (src/game). */
export interface MergeableCard {
  instanceId: string;
  skillId: string;
  tier: SkillTier;
}

export interface MergeTarget {
  /** Where the merge target instance lives — the board's `pieces` array or
   * the `bag`/`bagSlots` array, at `index` in whichever one. */
  location: 'board' | 'bag';
  index: number;
  instanceId: string;
  fromTier: SkillTier;
  toTier: SkillTier;
}

/**
 * The merge target for a shop offer of `skillId`: the LOWEST-tier owned
 * instance of that skill across BOTH `board` and `bag` — on a tier tie, the
 * board copy wins (it's the live one). Returns `null` if the player owns no
 * mergeable (non-diamond) instance of `skillId` (including owning none at
 * all). Deterministic: within a tier, `board` is always checked before `bag`,
 * and `Array#findIndex` always returns the first (lowest-index) match, so the
 * same owned collection always yields the same target.
 */
export function findMergeTarget<P extends MergeableCard>(
  skillId: string,
  board: readonly P[],
  bag: readonly (P | null)[],
): MergeTarget | null {
  for (const tier of MERGEABLE_TIERS) {
    const boardIndex = board.findIndex((p) => p.skillId === skillId && p.tier === tier);
    if (boardIndex >= 0) {
      const piece = board[boardIndex]!;
      return { location: 'board', index: boardIndex, instanceId: piece.instanceId, fromTier: tier, toTier: nextSkillTier(tier)! };
    }
    const bagIndex = bag.findIndex((c) => c != null && c.skillId === skillId && c.tier === tier);
    if (bagIndex >= 0) {
      const card = bag[bagIndex]!;
      return { location: 'bag', index: bagIndex, instanceId: card.instanceId, fromTier: tier, toTier: nextSkillTier(tier)! };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Battle gold reward.
// ---------------------------------------------------------------------------

/** Named difficulty weight per title (mob < normal < elite < boss), mirroring TITLE_PRESETS ordering. */
const TITLE_WEIGHT: Record<EnemyTitle, number> = {
  mob: 0,
  normal: 1,
  elite: 2,
  boss: 3,
};

export interface BattleFoeSummary {
  level: number;
  title: EnemyTitle;
  rank: number;
  modifiers?: readonly string[];
}

export interface BattleGoldReward {
  base: 1;
  winBonus: 1 | 2 | 3;
}

/**
 * Gold reward for a fight — CALLER-AGNOSTIC: this function only computes the
 * `{base, winBonus}` pair; it never decides what a loss pays, and its TWO
 * callers deliberately differ on that:
 *   - `resolveRunBattleResult` (`src/game/runStore.ts`) — RUN MODE: pays
 *     `base + winBonus` on a win, `0` on a loss (feeds `recordBattleResult`
 *     in `runState.ts`, which credits no gold for a loss).
 *   - `creditBattleGold` (`src/game/battleGold.ts`) — SANDBOX: pays `base`
 *     unconditionally and adds `winBonus` only on a win, so a loss still
 *     credits `base`. This is DELIBERATE and USER-LOCKED — see
 *     `docs/run-structure.md` and `docs/feature-inventory.md` ("the
 *     Sandbox's loss-still-pays-base behavior is unchanged"). Do NOT
 *     "fix" `battleGold.ts` to match the run-mode caller.
 * `winBonus` is derived from a `difficulty` score, summed per foe (integer
 * math throughout):
 *   - `TITLE_WEIGHT[title]` (0-3): mob/normal/elite/boss, mirrors TITLE_PRESETS.
 *   - `max(0, foe.level - heroLevel)`: how far above the hero's level the foe is.
 *   - `foe.modifiers.length`: rogue-like affixes stack difficulty 1-for-1.
 * Plus `foes.length - 1` (floored at 0) for facing more than one foe at once.
 * `winBonus = clamp(1 + floor(difficulty / 3), 1, 3)`.
 */
export function battleGoldReward(foes: readonly BattleFoeSummary[], heroLevel: number): BattleGoldReward {
  let difficulty = 0;
  for (const foe of foes) {
    difficulty += TITLE_WEIGHT[foe.title];
    difficulty += Math.max(0, Math.floor(foe.level) - Math.floor(heroLevel));
    difficulty += foe.modifiers?.length ?? 0;
  }
  difficulty += Math.max(0, foes.length - 1);

  const winBonus = Math.min(3, Math.max(1, 1 + Math.floor(difficulty / 3))) as 1 | 2 | 3;
  return { base: 1, winBonus };
}

// Re-exported so callers building fight summaries can read the preset table
// without a second import if they only need this module.
export { TITLE_PRESETS };
