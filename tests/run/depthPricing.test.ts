import { describe, expect, it } from 'vitest';
import {
  GOLD_PRICE_BY_TIER,
  PRICE_RAMP_END_WAVE,
  PRICE_RAMP_START_WAVE,
  PRICE_SCALE_DEN,
  battleGoldReward,
  goldPriceOfCard,
  goldPriceOfCardForShop,
  goldPriceOfGem,
  goldPriceOfGemForShop,
  priceScaleNum,
  scaledGoldPrice,
  sellPriceOfCard,
  sellPriceOfGem,
  SKILL_TIER_ORDER,
} from '../../src/run/shop';
import { shopCatalog, shopTypeIds } from '../../src/data/shopTypes';
import { gemBook } from '../../src/data/gems';
import { DRAFT_SET_KEYS, rollStartDraft } from '../../src/run/draft';
import {
  DAILY_INCOME,
  applyDraftResult,
  availableChoices,
  buyRunCard,
  buyRunGem,
  chooseNode,
  createRun,
  ensureRunShopShelf,
  leaveEvent,
  leaveShop,
  mergeRunCard,
  recordBattleResult,
  rerollCostForNode,
  rerollRunShop,
  rollEncounter,
  runBagHasRoomFor,
  runMergeTargetFor,
  type RunState,
} from '../../src/run/runState';
import {
  applyBonusDraftPick,
  applyGemChoicePick,
  applySellGemPick,
  applyUpgradeCardPick,
  isEventChoiceAffordable,
  isEventChoiceUsable,
  resolveEventChoice,
  rollEventForNode,
} from '../../src/run/events';
import { hashSeed, Rng } from '../../src/engine/rng';
import type { BattleFoeSummary } from '../../src/run/shop';
import type { SkillTier } from '../../src/engine/types';

/**
 * DEPTH PRICE SCALING — the invariants, not the numbers.
 *
 * The defect this suite guards (measured by a playthrough audit over real
 * runs): gold stopped being a currency. Past roughly wave 15 a run's banked
 * gold covered every offer on every shelf and every reroll, so the shop — the
 * place where nearly all of a semi-auto game's decisions live — stopped asking
 * a question. `battleGoldReward` caps a fight at 4 gold, but nothing on the old
 * flat price table cost more than 6, and the surplus integrated forever.
 *
 * What is pinned here is the SHAPE the fix has to keep, at any depth:
 *   1. the base table is exactly what waves 1-5 charge (the calibrated opening);
 *   2. the curve never stops climbing — no depth exists at which the price list
 *      is effectively fixed (that is the whole reason it is a curve);
 *   3. buy price is non-decreasing in wave and sell price is constant in wave,
 *      so SELL CAN NEVER EXCEED BUY at any depth, theme, tier or rarity —
 *      including for hostile `priceDelta`s no theme ships today;
 *   4. walked over real runs, a shelf stays a CHOICE: never (nearly) always
 *      wholly affordable, never unaffordable down to the last offer.
 * Numbers themselves (2/3/4/5, x3 at wave 25, +4%/wave after) are deliberately
 * NOT pinned — they are an economy-pacing knob (see the header comment above
 * `GOLD_PRICE_BY_TIER`), and PL, not gold, is this project's balance unit
 * (docs/design-locked.md).
 */

const TIERS = SKILL_TIER_ORDER;
const GEM_IDS = Object.keys(gemBook);

// ---------------------------------------------------------------------------
// 1-2. The curve itself.
// ---------------------------------------------------------------------------

describe('run/shop: the depth price curve', () => {
  it('charges exactly the base table through the ramp-start wave — the opening is untouched', () => {
    for (let wave = 1; wave <= PRICE_RAMP_START_WAVE; wave += 1) {
      expect(priceScaleNum(wave), `wave ${wave} multiplier`).toBe(PRICE_SCALE_DEN);
      for (const tier of TIERS) {
        expect(goldPriceOfCardForShop(tier, 0, wave), `${tier} at wave ${wave}`).toBe(GOLD_PRICE_BY_TIER[tier]);
      }
      for (const gemId of GEM_IDS) {
        expect(goldPriceOfGemForShop(gemId, wave), `${gemId} at wave ${wave}`).toBe(goldPriceOfGem(gemId));
      }
    }
  });

  it('is the identity for a wave-less caller — the Sandbox and every unscaled test keep the base table', () => {
    for (const tier of TIERS) {
      expect(goldPriceOfCardForShop(tier)).toBe(goldPriceOfCard(tier));
      expect(scaledGoldPrice(goldPriceOfCard(tier))).toBe(goldPriceOfCard(tier));
    }
    for (const gemId of GEM_IDS) expect(goldPriceOfGemForShop(gemId)).toBe(goldPriceOfGem(gemId));
  });

  it('never decreases with depth, at any tier or rarity', () => {
    for (let wave = 1; wave < 400; wave += 1) {
      expect(priceScaleNum(wave + 1)).toBeGreaterThanOrEqual(priceScaleNum(wave));
      for (const tier of TIERS) {
        expect(goldPriceOfCardForShop(tier, 0, wave + 1), `${tier} ${wave}->${wave + 1}`)
          .toBeGreaterThanOrEqual(goldPriceOfCardForShop(tier, 0, wave));
      }
    }
  });

  it('NEVER FLATTENS INTO A FIXED TABLE — from any depth, a deeper wave costs strictly more', () => {
    // The reason the fix is a curve and not a bigger flat list: any fixed table
    // has a depth at which the run has outgrown it. This says there is no such
    // depth — pick any wave, however deep, and something later is dearer.
    for (const wave of [1, 5, 25, 50, 100, 250, 500, 1000, 5000]) {
      const here = goldPriceOfCardForShop('bronze', 0, wave);
      let found = 0;
      for (let ahead = wave + 1; ahead <= wave + 200; ahead += 1) {
        if (goldPriceOfCardForShop('bronze', 0, ahead) > here) { found = ahead; break; }
      }
      expect(found, `nothing past wave ${wave} costs more than ${here}`).toBeGreaterThan(wave);
    }
  });

  it('outgrows a whole wave of maximum income — a shelf is never one fight away', () => {
    // Derived from the EARNING side, in code, not from a walk: the most a wave
    // can pay is DAILY_INCOME on each of its (at most 4) nodes plus the fight's
    // own capped payout. Past the ramp, one Diamond offer alone already costs
    // more than that ceiling, so no single wave's income can ever clear a shelf.
    const maxFight = battleGoldReward([{ level: 999, title: 'boss', rank: 9, modifiers: ['a', 'b', 'c'] }], 1);
    const maxWaveIncome = DAILY_INCOME * 4 + maxFight.base + maxFight.winBonus;
    expect(goldPriceOfCardForShop('diamond', 0, PRICE_RAMP_END_WAVE)).toBeGreaterThan(maxWaveIncome);
  });
});

// ---------------------------------------------------------------------------
// 3. No arbitrage, at any depth.
// ---------------------------------------------------------------------------

describe('run/shop: sell-back can never beat the buy price', () => {
  const WAVES = [1, 2, 5, 6, 10, 24, 25, 26, 40, 60, 100, 200, 500, 2000];

  it('holds for every shipped theme × tier × depth', () => {
    for (const shopId of shopTypeIds) {
      const delta = shopCatalog[shopId]!.priceDelta ?? 0;
      for (const tier of TIERS) {
        for (const wave of WAVES) {
          const buy = goldPriceOfCardForShop(tier, delta, wave);
          expect(sellPriceOfCard(tier), `${shopId} ${tier} @w${wave}`).toBeLessThanOrEqual(buy);
        }
      }
      for (const gemId of GEM_IDS) {
        for (const wave of WAVES) {
          expect(sellPriceOfGem(gemId), `${shopId} ${gemId} @w${wave}`)
            .toBeLessThanOrEqual(goldPriceOfGemForShop(gemId, wave));
        }
      }
    }
  });

  it('holds for HOSTILE priceDeltas no theme ships today — the floor is structural', () => {
    // `d1ac673` closed the clamped-tier price hole; this is the discount-side
    // twin an auditor flagged as latent: a -2 or worse delta used to floor a
    // Gold/Diamond buy price at 1 gold, under its own 2-gold sell-back.
    for (let delta = -8; delta <= 8; delta += 1) {
      for (const tier of TIERS) {
        for (const wave of WAVES) {
          expect(goldPriceOfCardForShop(tier, delta, wave), `delta ${delta} ${tier} @w${wave}`)
            .toBeGreaterThanOrEqual(sellPriceOfCard(tier));
        }
      }
    }
  });

  it('sell-back does not move with depth — gold can never be minted by holding inventory', () => {
    // The buy-low-at-wave-20/sell-high-at-wave-100 pump, closed by construction.
    // The gem pouch is UNCAPPED, so a depth-scaled sell price would be an
    // unbounded money printer, not a rounding wrinkle.
    for (const tier of TIERS) {
      const at1 = sellPriceOfCard(tier);
      for (const wave of WAVES) expect(sellPriceOfCard(tier), `${tier} @w${wave}`).toBe(at1);
    }
    for (const gemId of GEM_IDS.slice(0, 12)) {
      const at1 = sellPriceOfGem(gemId);
      for (const wave of WAVES) expect(sellPriceOfGem(gemId), `${gemId} @w${wave}`).toBe(at1);
    }
    // …and buying at ANY depth and selling at ANY later depth is still a loss.
    for (const tier of TIERS) {
      for (const buyWave of WAVES) {
        for (const sellWave of WAVES) {
          if (sellWave < buyWave) continue;
          expect(sellPriceOfCard(tier), `buy w${buyWave} sell w${sellWave}`)
            .toBeLessThanOrEqual(goldPriceOfCardForShop(tier, 0, buyWave));
        }
      }
    }
  });

  it('the REROLL toll rides the same curve as the shelf it rerolls', () => {
    // A 1-gold reroll against a six-times-base shelf is the free action the
    // shelf stopped being — the audit's wave-41 run held 382 gold against it.
    const at = walkToShop(11);
    expect(at, 'seed 11 never reached a shop node').toBeTruthy();
    expect(rerollCostForNode(at!.state, at!.nodeId)).toBe(scaledGoldPrice(1, at!.wave));
    // …and it keeps riding it as the per-node escalation climbs.
    const funded: RunState = { ...at!.state, gold: 9999 };
    const rerolled = rerollRunShop(funded, at!.nodeId);
    expect(rerollCostForNode(rerolled, at!.nodeId)).toBe(scaledGoldPrice(2, at!.wave));
    expect(funded.gold - rerolled.gold).toBe(scaledGoldPrice(1, at!.wave));
  });
});

// ---------------------------------------------------------------------------
// 4. Walked over real runs: a shelf stays a choice.
// ---------------------------------------------------------------------------

/** How many of a shelf's offers a wallet clears, cheapest-first. */
function affordableCount(prices: readonly number[], gold: number): number {
  let left = gold;
  let n = 0;
  for (const p of [...prices].sort((a, b) => a - b)) {
    if (left < p) break;
    left -= p;
    n += 1;
  }
  return n;
}

function walkableRun(seed: number): RunState {
  const draft = rollStartDraft(seed);
  const picks: Partial<Record<(typeof DRAFT_SET_KEYS)[number], string>> = {};
  for (const key of DRAFT_SET_KEYS) {
    const card = draft[key][0];
    if (card) picks[key] = card.skillId;
  }
  return applyDraftResult(createRun(seed), picks);
}

/** Walk a fresh run forward (always taking a shop when one is on offer) until
 * it is standing on a shop node — a map's early columns are not guaranteed to
 * contain one, so "the first shop this seed reaches" is the honest probe. */
function walkToShop(seed: number): { state: RunState; nodeId: string; wave: number } | null {
  let s = walkableRun(seed);
  for (let guard = 0; guard < 40; guard += 1) {
    const choices = availableChoices(s);
    if (choices.length === 0) return null;
    const node = choices.find((n) => n.kind === 'shop') ?? choices[0]!;
    s = chooseNode(s, node.id);
    if (node.kind === 'shop') return { state: ensureRunShopShelf(s, node.id), nodeId: node.id, wave: node.wave };
    if (node.kind === 'event') { s = leaveEvent(s); continue; }
    s = recordBattleResult(s, { won: true, goldEarned: 4 });
  }
  return null;
}

interface Visit { wave: number; offers: number; afford: number }

/**
 * One real run, walked to `maxWave` through the SHIPPING run layer — the same
 * `ensureRunShopShelf`/`buyRunCard`/`rerollRunShop`/`rollEncounter` a player
 * drives. The buyer is deliberately GREEDY (every affordable offer, cheapest
 * first, merging once the bag is full, then rerolling while it can still
 * afford one) so the surplus it banks is a LOWER bound on a real player's:
 * if even a shopaholic ends up able to clear whole shelves, everyone can.
 * Fights are always won, so the walk reaches depth without the run dying.
 */
function walk(seed: number, maxWave: number): Visit[] {
  let s = walkableRun(seed);
  const rng = new Rng(hashSeed('depthPricing', seed));
  const visits: Visit[] = [];

  while (s.status === 'active') {
    const choices = availableChoices(s);
    if (choices.length === 0) break;
    const node = choices[rng.int(choices.length)]!;
    if (node.wave > maxWave) break;
    s = chooseNode(s, node.id);

    if (node.kind === 'shop') {
      s = ensureRunShopShelf(s, node.id);
      const shelf = s.shopShelves[node.id]!;
      const prices = [...shelf.cards.map((c) => c.price), ...shelf.gems.map((g) => g.price)];
      visits.push({ wave: node.wave, offers: prices.length, afford: affordableCount(prices, s.gold) });
      for (let round = 0; round < 3; round += 1) {
        for (;;) {
          const live = s.shopShelves[node.id];
          if (!live) break;
          const opts = [
            ...live.cards.map((c, i) => ({ gem: false, i, price: c.price, skillId: c.skillId })),
            ...live.gems.map((g, i) => ({ gem: true, i, price: g.price, skillId: '' })),
          ].sort((a, b) => a.price - b.price);
          let bought = false;
          for (const o of opts) {
            if (s.gold < o.price) continue;
            if (o.gem) {
              const r = buyRunGem(s, node.id, o.i);
              if (r.ok) { s = r.state; bought = true; break; }
              continue;
            }
            if (runMergeTargetFor(s, o.skillId)) {
              const r = mergeRunCard(s, node.id, o.i);
              if (r.ok) { s = r.state; bought = true; break; }
            }
            if (runBagHasRoomFor(s, o.skillId)) {
              const r = buyRunCard(s, node.id, o.i);
              if (r.ok) { s = r.state; bought = true; break; }
            }
          }
          if (!bought) break;
        }
        if (s.gold < rerollCostForNode(s, node.id) + 2) break;
        const next = rerollRunShop(s, node.id);
        if (next === s) break;
        s = next;
      }
      s = leaveShop(s);
    } else if (node.kind === 'event') {
      const rolled = rollEventForNode(s, node);
      s = rolled.state;
      const ev = rolled.event;
      const open = ev.choices.filter((c) => isEventChoiceUsable(s, c) && isEventChoiceAffordable(s, c));
      const pick = open.length > 0
        ? open.reduce((best, c) => ((c.cost ?? 0) > (best.cost ?? 0) ? c : best), open[0]!)
        : ev.choices[0]!;
      const res = resolveEventChoice(s, ev.id, pick.id);
      s = res.state;
      const out = res.outcome;
      if (out.kind === 'bonusDraft' && out.cards.length > 0) s = applyBonusDraftPick(s, out.cards[0]!).state;
      else if (out.kind === 'upgradeCardPick' && out.options.length > 0) s = applyUpgradeCardPick(s, out.options[0]!.instanceId).state;
      else if (out.kind === 'gemChoicePick' && out.options.length > 0) s = applyGemChoicePick(s, out.options[0]!).state;
      else if (out.kind === 'sellGemPick' && out.options.length > 0) s = applySellGemPick(s, out.options[0]!.pouchIndex).state;
      s = leaveEvent(s);
    } else {
      const pack = rollEncounter(s);
      const foes: BattleFoeSummary[] = pack.units.map((u) => ({
        level: u.level, title: u.title, rank: u.rank, modifiers: u.modifiers,
      }));
      const reward = battleGoldReward(foes, s.heroLevel);
      s = recordBattleResult(s, { won: true, goldEarned: reward.base + reward.winBonus });
    }
  }
  return visits;
}

describe('run economy: a shelf stays a choice at every depth', () => {
  const MAX_WAVE = 60;
  const visits: Visit[] = [];
  for (let seed = 1; seed <= 10; seed += 1) visits.push(...walk(seed * 4177, MAX_WAVE));

  const band = (lo: number, hi: number) => visits.filter((v) => v.wave >= lo && v.wave <= hi);
  const wholeRate = (vs: Visit[]) => vs.filter((v) => v.afford >= v.offers).length / Math.max(1, vs.length);
  const meanFrac = (vs: Visit[]) => vs.reduce((a, v) => a + v.afford / Math.max(1, v.offers), 0) / Math.max(1, vs.length);

  const BANDS: readonly (readonly [number, number])[] = [[1, 10], [11, 25], [26, 40], [41, 60]];

  it('the walk actually reached depth and browsed shelves the whole way', () => {
    expect(visits.length, 'no shop visits — the walk proved nothing').toBeGreaterThan(40);
    for (const [lo, hi] of BANDS) {
      expect(band(lo, hi).length, `no shelves browsed in waves ${lo}-${hi}`).toBeGreaterThan(4);
    }
  });

  it('NOT ALL OF IT — a whole shelf is rarely clearable, and never routinely, at any depth', () => {
    // The defect, stated: pre-fix this rate ran 69% by wave 20 and 88-100%
    // from wave 40 on, over these same seeds and this same greedy buyer.
    for (const [lo, hi] of BANDS) {
      expect(wholeRate(band(lo, hi)), `waves ${lo}-${hi}: whole shelf cleared too often`).toBeLessThan(0.35);
    }
    expect(wholeRate(band(26, MAX_WAVE)), 'deep shelves clear as a matter of course').toBeLessThan(0.25);
  });

  it('NOR NONE OF IT — every depth band still buys a real slice of the shelf', () => {
    for (const [lo, hi] of BANDS) {
      const frac = meanFrac(band(lo, hi));
      expect(frac, `waves ${lo}-${hi}: shelf unaffordable`).toBeGreaterThan(0.15);
      expect(frac, `waves ${lo}-${hi}: shelf is a shopping list`).toBeLessThan(0.8);
    }
  });

  it('depth never turns the shelf into a shopping list — the deep band is no freer than the opening', () => {
    // The property the endless ladder needs: purchasing power must not TREND
    // to 1. Pre-fix it did exactly that (46% -> 100% between waves 5 and 100).
    expect(meanFrac(band(41, MAX_WAVE))).toBeLessThanOrEqual(meanFrac(band(1, 10)) + 0.25);
  });
});
