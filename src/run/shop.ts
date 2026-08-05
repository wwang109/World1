// Shop v1 — pure run-layer state transitions over the declarative themes in
// `src/data/shopTypes.ts`. No Phaser, no Date.now/Math.random — all
// randomness flows through the engine's seeded `Rng` in a fixed call order,
// so `rollShopStock(shopId, seed)` is reload-safe (same inputs, same shelf).

import { gemPowerLevelDeci } from '../engine/balance';
import { hashSeed, Rng } from '../engine/rng';
import type { Action, BuffableStat, SkillDef, SkillTier } from '../engine/types';
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
 * Gem gold price, 1-3, derived from the gem's own PL (`gemPowerLevelDeci`) —
 * monotonic in PL. Thresholds are picked to spread the 46-gem catalog
 * sensibly across the three bands (rarity bands are Common 20 · Rare 40 ·
 * Epic 60 · Legendary 80 deci): Common -> 1, Rare/Epic -> 2, Legendary -> 3.
 */
export function goldPriceOfGem(gemId: string): 1 | 2 | 3 {
  const gem = gemBook[gemId];
  if (!gem) throw new Error(`goldPriceOfGem: unknown gem id "${gemId}"`);
  const deci = gemPowerLevelDeci(gem);
  if (deci < 40) return 1;
  if (deci < 80) return 2;
  return 3;
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
 * gold. Given `goldPriceOfGem`'s 1-3 range this floors to 1 gold for every
 * gem today (1/2->1, 2/2->1, 3/2->1) — an emergent property of that existing
 * 3-band table, not a new distinction being introduced here. */
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
 * up to `shelf.gems` distinct gem offers. Same (shopId, seed, depth) ->
 * identical shelf, forever (no wall-clock or ambient randomness). RNG call
 * order is fixed: card picks, then each picked card's tier roll, then gem
 * picks. `depth` (1-indexed run depth) shifts the tier split — every non-run
 * caller omits it and gets today's 70/25/5 behavior byte-identical.
 */
export function rollShopStock(shopId: string, seed: number, depth = 1): ShopStock {
  const shop = shopCatalog[shopId];
  if (!shop) throw new Error(`rollShopStock: unknown shop id "${shopId}"`);
  const rng = new Rng(hashSeed('shop', shopId, seed));

  const cardPool = cardPoolForShop(shopId);
  const pickedCards = sampleDistinct(rng, cardPool, shop.shelf.cards);
  const cards: CardOffer[] = pickedCards.map((skill) => {
    const tier = rollOfferedTier(rng, depth, shop.tierBias);
    return { skillId: skill.id, tier, price: goldPriceOfCardForShop(tier, shop.priceDelta) };
  });

  const gemPool = gemPoolForShop(shopId);
  const pickedGems = sampleDistinct(rng, gemPool, shop.shelf.gems);
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
 * Gold reward for a fight: `base` always pays out (win or lose); `winBonus`
 * only pays on a win. `winBonus` is derived from a `difficulty` score, summed
 * per foe (integer math throughout):
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
