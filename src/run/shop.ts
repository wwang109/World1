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

/** Bronze-heavy tier roll: 70% bronze / 25% silver / 5% gold. Diamond never appears in shops. */
function rollOfferedTier(rng: Rng): SkillTier {
  const roll = rng.int(100);
  if (roll < 70) return 'bronze';
  if (roll < 95) return 'silver';
  return 'gold';
}

/**
 * Seeded shelf roll for one shop: up to `shelf.cards` distinct card offers and
 * up to `shelf.gems` distinct gem offers. Same (shopId, seed) -> identical
 * shelf, forever (no wall-clock or ambient randomness). RNG call order is
 * fixed: card picks, then each picked card's tier roll, then gem picks.
 */
export function rollShopStock(shopId: string, seed: number): ShopStock {
  const shop = shopCatalog[shopId];
  if (!shop) throw new Error(`rollShopStock: unknown shop id "${shopId}"`);
  const rng = new Rng(hashSeed('shop', shopId, seed));

  const cardPool = cardPoolForShop(shopId);
  const pickedCards = sampleDistinct(rng, cardPool, shop.shelf.cards);
  const cards: CardOffer[] = pickedCards.map((skill) => {
    const tier = rollOfferedTier(rng);
    return { skillId: skill.id, tier, price: goldPriceOfCard(tier) };
  });

  const gemPool = gemPoolForShop(shopId);
  const pickedGems = sampleDistinct(rng, gemPool, shop.shelf.gems);
  const gems: GemOffer[] = pickedGems.map((gem) => ({ gemId: gem.id, price: goldPriceOfGem(gem.id) }));

  return { shopId, seed, cards, gems };
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
