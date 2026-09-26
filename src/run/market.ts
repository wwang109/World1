// The gold market — a recurring event that sells lives (refill only) and
// permanent hero stat buys, both priced off ONE shared per-run counter
// (USER DECISIONS 2026-09-25). Pure state transitions; no Rng, no Phaser.

import type { MarketStat } from '../data/eventTypes';
import { LEVEL_STAT_COST, type Allocation } from './leveling';
import { LIVES_PER_RUN, type RunState } from './runState';

/** Every market purchase — life or stat — shares this ONE ladder: the first
 * costs `MARKET_BASE_PRICE_GOLD`, and each purchase (ever, this run) raises
 * the next by 1. It never resets during a run. */
export const MARKET_BASE_PRICE_GOLD = 2;

/** Purchases allowed per event VISIT before the node closes for good. */
export const MARKET_VISITS_PER_NODE = 2;

/** `state.marketPurchases`, normalized: absent means 0 (no purchases yet,
 * including every save from before the market existed). */
export function marketPurchaseCount(state: RunState): number {
  return state.marketPurchases ?? 0;
}

/** The price of the NEXT market purchase, life or stat alike. */
export function marketPurchasePriceGold(state: RunState): number {
  return MARKET_BASE_PRICE_GOLD + marketPurchaseCount(state);
}

/** Whether a life refill is possible right now — refill only, never above
 * `LIVES_PER_RUN`. */
export function canBuyMarketLife(state: RunState): boolean {
  return state.lives < LIVES_PER_RUN;
}

/** Charges `price` and bumps the lifetime counter — the half of a purchase
 * common to `buyLife` and every `buyStat`. Never call for `grantStat`, which
 * is free and must not touch this counter. */
export function withMarketPurchaseCharged(state: RunState, price: number): RunState {
  return {
    ...state,
    gold: state.gold - price,
    marketPurchases: marketPurchaseCount(state) + 1,
    stats: { ...state.stats, goldSpent: state.stats.goldSpent + price },
  };
}

/** Folds one stat buy into `state.purchasedStats` — the same buy-count shape
 * `heroAllocation` uses, folded into combat separately (`buildAutoHeroSetup`,
 * `src/run/encounter.ts`) via the unguarded `applyLevelAllocation`. Shared by
 * the paid `buyStat` and the free `grantStat` outcomes. */
export function withStatPurchased(state: RunState, stat: MarketStat): RunState {
  const purchasedStats: Allocation = {
    ...(state.purchasedStats ?? {}),
    [stat]: (state.purchasedStats?.[stat] ?? 0) + 1,
  };
  return { ...state, purchasedStats };
}

/** Whether an outcome kind is one of the market's stay-open purchases — the
 * one predicate both `resolveEventChoice`/`resolveEventChoiceV3` (the reopen
 * guard) and the view model (the phase gate) key off of. `buyStatPick`
 * included: the picker's price is the SAME stat-independent ladder value
 * (`marketPurchasePriceGold` takes no stat argument), so pricing/locking the
 * outer "Buy a stat" row and reopening the node after a settled pick both
 * read correctly off this one predicate. `eventsV3.ts`'s CHOICE-time
 * marketVisits bump is the one caller that must NOT key off this for
 * `buyStatPick` — opening/cancelling the picker spends no visit, only
 * `finalizeBuyStatPickV3` does, so that one call site checks the kind
 * directly instead. */
export function isMarketBuyOutcomeKind(kind: string): boolean {
  return kind === 'buyLife' || kind === 'buyStat' || kind === 'buyStatPick';
}

/** Flat stat gain per buy — the SAME `LEVEL_STAT_COST[stat].gain` a level-up
 * buy pays for (1 for attack/armor, 5 for maxHp): "+1 Attack, +1 Armor, or +5
 * Max HP per purchase" is this table, not a separate number. */
export function marketStatGain(stat: MarketStat): number {
  return LEVEL_STAT_COST[stat].gain;
}

const MARKET_STATS: readonly MarketStat[] = ['attack', 'armor', 'maxHp'];

export interface MarketStatPickOption {
  stat: MarketStat;
  gain: number;
  price: number;
  affordable: boolean;
}

/** The market stat picker's three rows, priced live off THIS state — the
 * same shared ladder every stat buy shares (`marketPurchasePriceGold`), so
 * all three read the identical price. Pure; a view model calls this rather
 * than re-deriving the price/affordability pair by hand. */
export function marketStatPickOptions(state: RunState): readonly MarketStatPickOption[] {
  const price = marketPurchasePriceGold(state);
  return MARKET_STATS.map((stat) => ({
    stat, gain: marketStatGain(stat), price, affordable: price <= state.gold,
  }));
}
