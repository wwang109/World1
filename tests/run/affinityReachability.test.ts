import { describe, expect, it } from 'vitest';
import { skillBook } from '../../src/data/skills';
import { shopCatalog, shopTypeIds } from '../../src/data/shopTypes';
import {
  GOLD_PRICE_BY_TIER, cardPoolForShop, rollShopStock, battleGoldReward,
} from '../../src/run/shop';
import {
  DAILY_INCOME, createRun, applyDraftResult, availableChoices, chooseNode,
  rollEncounter, recordBattleResult, leaveEvent, leaveShop, shopStockDepthForWave,
} from '../../src/run/runState';
import { rollStartDraft, DRAFT_SET_KEYS } from '../../src/run/draft';
import { BOSS_EVERY } from '../../src/run/runMap';
import { TIER_BUDGET_DECI } from '../../src/engine/balance';
import { cardType, IDENTITY_THRESHOLD } from '../../src/engine/combat/typeIdentity';
import type { SkillDef, SkillTier } from '../../src/engine/types';

/**
 * CAN THE RUN KEEP THE PROMISE THE CONTENT MAKES?
 *
 * The affinity cards ask the player for `IDENTITY_THRESHOLD` (3) cards of ONE
 * type on a 10-slot board, or their gated half does not exist at all. That is a
 * requirement on the ACQUISITION layer, not on the engine, and
 * `tests/run/contentReachability.test.ts` deliberately only asks whether each
 * card is obtainable AT ALL ("existence, not practicality" — its own words). A
 * catalog where every affinity card is buyable but no shop ever puts three of a
 * type in front of the player would pass that audit and still ship a dead
 * keyword.
 *
 * WHAT THE AUDIT THAT MOTIVATED THIS FILE MEASURED (2026-08-26, over the real
 * draft/mapgen/shop code):
 *   - Gold is NOT the constraint. A run that wins every fight and buys nothing
 *     holds 27-30 gold at the first boss; an identity's sticker price is 6.
 *   - SUPPLY is the constraint, and it is not even across types. Every ELEMENT
 *     has a dedicated single-element stall whose whole 6-card shelf is that
 *     element (an identity in one visit). No WEAPON type has one: the best a
 *     Lance player can find is Armory, expected 1.61 same-type offers per shelf.
 * The tests below pin the floors that make the ask keepable, so a future content
 * or filter pass cannot quietly drop one type below them.
 */

const typeKeyOf = (s: SkillDef): string => {
  const t = cardType(s);
  return t ? `${t.kind}:${t.type}` : 'none';
};
const isGated = (s: SkillDef): boolean => s.effects.some((a) => a.affinity === true);
const ALL_CARDS = Object.values(skillBook);
const GATED = ALL_CARDS.filter(isGated);
const TYPES = [...new Set(ALL_CARDS.map(typeKeyOf))].sort();

/** Expected same-type offers on one full shelf at `shopId` (hypergeometric mean
 * of `min(shelf, pool)` DISTINCT draws — `rollShopStock` uses `sampleDistinct`). */
function expectedSameTypeOffers(shopId: string, type: string): number {
  const pool = cardPoolForShop(shopId);
  if (pool.length === 0) return 0;
  const ofType = pool.filter((s) => typeKeyOf(s) === type).length;
  const shelf = Math.min(shopCatalog[shopId]!.shelf.cards, pool.length);
  return (shelf * ofType) / pool.length;
}

describe('the shop layer can actually supply an identity', () => {
  it('the catalog has affinity cards and more than one type — otherwise this file measures nothing', () => {
    expect(GATED.length, 'no affinity-gated card in the catalog').toBeGreaterThan(0);
    expect(TYPES.length, 'the catalog collapsed to one type').toBeGreaterThan(1);
    expect(TYPES).not.toContain('none'); // every card is typed; a typeless card can never open a gate
  });

  it('EVERY card type has a shop where a full shelf is expected to show at least one of it', () => {
    // The floor that stops a type from becoming unbuildable by dilution: adding
    // a pile of generic cards to the only shop that carries a weapon type would
    // push its density down without failing any other audit. Today the weakest
    // type is Lance at Armory (1.61); the elements sit at 6.00 in their own
    // stalls.
    const starved: string[] = [];
    for (const type of TYPES) {
      let best = 0;
      let bestShop = '';
      for (const shopId of shopTypeIds) {
        const e = expectedSameTypeOffers(shopId, type);
        if (e > best) { best = e; bestShop = shopId; }
      }
      if (best < 1) starved.push(`${type}: best is ${bestShop || 'no shop'} at ${best.toFixed(2)} offers/shelf`);
    }
    expect(starved, starved.join('\n')).toEqual([]);
  });

  it('every gated card can be bought at a counter that also stocks enough of its own type to switch it on', () => {
    // "Reachable" is not the same as "usable". A gated card sold only where
    // nothing else of its type is sold is a card the player can own and never
    // turn on at that shop — the ask and the answer have to be available in the
    // same place at least once.
    const orphans: string[] = [];
    for (const card of GATED) {
      const type = typeKeyOf(card);
      const ok = shopTypeIds.some((shopId) => {
        const pool = cardPoolForShop(shopId);
        return pool.some((s) => s.id === card.id)
          && pool.filter((s) => typeKeyOf(s) === type).length >= IDENTITY_THRESHOLD;
      });
      if (!ok) orphans.push(`${card.id} (${type})`);
    }
    expect(orphans, `gated cards with no counter that also sells their identity: ${orphans.join(', ')}`).toEqual([]);
  });

  it('every ELEMENT a gated card is typed to has its own single-element stall, and each shelf hands over a whole identity', () => {
    // The strongest supply guarantee in the run, and the reason the element
    // affinity cards are reachable at all: these pools are single-element, so
    // the shelf is `min(6, pool)` cards of that one element every time. Rolled
    // through the REAL `rollShopStock` at the three real depth bands
    // (`shopStockDepthForWave`), not asserted from the filter.
    //
    // ASSERTED PER ELEMENT, not over "whatever stalls happen to exist": a
    // dilution pass that widened one stall's filter would otherwise just drop it
    // out of the set being measured and the suite would report nothing. THE
    // ASYMMETRY THIS DOCUMENTS: the five WEAPON types have no equivalent — the
    // best a Lance player can find is Armory at 1.61 same-type offers per shelf
    // (see the >= 1 floor above, which is the only bar weapons clear).
    const gatedElementTypes = [...new Set(GATED.filter((c) => c.element !== undefined).map(typeKeyOf))].sort();
    expect(gatedElementTypes.length, 'no element-typed gated cards to audit').toBeGreaterThan(0);
    const depths = [1, 2, 4, 7].map(shopStockDepthForWave);
    let shelvesChecked = 0;
    for (const type of gatedElementTypes) {
      const stall = shopTypeIds.find((id) => {
        const pool = cardPoolForShop(id);
        return pool.length > 0 && pool.every((s) => typeKeyOf(s) === type);
      });
      expect(stall, `${type} has no single-element stall`).toBeDefined();
      for (const depth of depths) {
        for (let seed = 1; seed <= 20; seed += 1) {
          const stock = rollShopStock(stall!, seed, depth);
          const sameType = stock.cards.filter((o) => typeKeyOf(skillBook[o.skillId]!) === type).length;
          expect(sameType, `${stall} @depth ${depth} seed ${seed}: only ${sameType} of ${type}`)
            .toBeGreaterThanOrEqual(IDENTITY_THRESHOLD);
          shelvesChecked += 1;
        }
      }
    }
    expect(shelvesChecked, 'no shelves were actually rolled').toBeGreaterThan(100);
  });
});

describe('the start draft can commit to a type on turn one', () => {
  /**
   * The draft is the ONLY acquisition surface that is guaranteed to happen, and
   * it hands out exactly 4 cards — one from each of 4 sets of 5. Whether a
   * player can even START down an identity depends on those 20 cards containing
   * three of one type among LEGAL picks (one per set), which is a property of
   * the archetype pools in `draft.ts`, not of any single card.
   *
   * Fixed seed range, so this is a deterministic measurement, not a sample.
   */
  const SEEDS = 200;
  const stats = (() => {
    let reachable = 0;
    let drafted = 0;
    for (let seed = 1; seed <= SEEDS; seed += 1) {
      const draft = rollStartDraft(seed);
      const sets = DRAFT_SET_KEYS.map((k) => draft[k].map((c) => skillBook[c.skillId]!));
      if (sets.every((s) => s.length === 5)) drafted += 1;
      let found = false;
      for (const a of sets[0]!) for (const b of sets[1]!) for (const c of sets[2]!) for (const d of sets[3]!) {
        if (found) break;
        const counts = new Map<string, number>();
        for (const pick of [a, b, c, d]) counts.set(typeKeyOf(pick), (counts.get(typeKeyOf(pick)) ?? 0) + 1);
        let top = 0;
        let tied = false;
        for (const n of counts.values()) {
          if (n > top) { top = n; tied = false; } else if (n === top) tied = true;
        }
        if (!tied && top >= IDENTITY_THRESHOLD) found = true;
      }
      if (found) reachable += 1;
    }
    return { reachable, drafted };
  })();

  it('every seed rolls a complete 4x5 draft — the measurement below is over real drafts', () => {
    expect(stats.drafted).toBe(SEEDS);
  });

  it('most seeds offer a legal pick-set that already forms a UNIQUE identity', () => {
    // Measured 178/200 (89%) on 2026-08-26. The bar is set well below that: the
    // failure this guards against is a structural one — a draft change that
    // spreads the four sets across so many types that committing to one becomes
    // luck rather than a choice.
    const pct = (100 * stats.reachable) / SEEDS;
    expect(pct, `only ${stats.reachable}/${SEEDS} seeds can reach an identity from the draft alone`)
      .toBeGreaterThanOrEqual(70);
  });
});

describe('gold paces the deckbuilding ask: affordable, but not free', () => {
  /** Sticker price of the cheapest possible identity. */
  const IDENTITY_COST = IDENTITY_THRESHOLD * GOLD_PRICE_BY_TIER.bronze;

  it('every card tier costs exactly the same PL per gold — the ladder is a pacing knob, not a power spike', () => {
    // `src/run/shop.ts` states this in prose ("every card tier is exactly 50
    // deci-PL/gold") and derives the whole gem price ladder from it, but the
    // relation spans a run table and an engine table and was asserted nowhere.
    const rates = (['bronze', 'silver', 'gold', 'diamond'] as SkillTier[])
      .map((t) => TIER_BUDGET_DECI[t] / GOLD_PRICE_BY_TIER[t]);
    expect(new Set(rates).size, `deci-PL per gold by tier: ${rates.join(', ')}`).toBe(1);
    expect(Number.isInteger(rates[0]!), 'and the rate is a whole number of deci-PL').toBe(true);
  });

  it('an identity costs more than a whole wave of daily income — it is a real purchase', () => {
    // A wave is at most 3 stop columns plus its fight column, and `chooseNode`
    // pays `DAILY_INCOME` per node committed. If the identity ever became
    // cheaper than that, "go three of a type" would stop being a decision.
    const maxNodesPerWave = 4;
    expect(IDENTITY_COST).toBeGreaterThan(DAILY_INCOME * maxNodesPerWave);
  });

  it('and a run that wins its way to the first boss can always afford one', () => {
    // Walked through the REAL run layer (map gen, node commit, encounter roll,
    // gold reward), buying nothing, winning everything — the optimistic income
    // ceiling, which is the right side to test an AFFORDABILITY floor from.
    const shortfalls: string[] = [];
    let fightsFought = 0;
    let seedsWalked = 0;
    for (let seed = 1; seed <= 40; seed += 1) {
      const draft = rollStartDraft(seed);
      const picks = Object.fromEntries(DRAFT_SET_KEYS.map((k) => [k, draft[k][0]!.skillId]));
      let state = applyDraftResult(createRun(seed), picks as never);
      let reachedBoss = false;
      for (let step = 0; step < 300; step += 1) {
        const choices = availableChoices(state);
        if (choices.length === 0) break;
        if (choices[0]!.wave > BOSS_EVERY) { reachedBoss = true; break; }
        const node = choices.find((n) => n.kind === 'event') ?? choices[0]!;
        state = chooseNode(state, node.id);
        if (node.kind === 'shop') state = leaveShop(state);
        else if (node.kind === 'event') state = leaveEvent(state);
        else {
          const pack = rollEncounter(state);
          const reward = battleGoldReward(
            pack.units.map((u) => ({ level: u.level, title: u.title, rank: u.rank, modifiers: u.modifiers })),
            state.heroLevel,
          );
          state = recordBattleResult(state, { won: true, goldEarned: reward.base + reward.winBonus });
          fightsFought += 1;
        }
        if (state.status !== 'active') break;
      }
      if (reachedBoss) seedsWalked += 1;
      if (state.gold < IDENTITY_COST) shortfalls.push(`seed ${seed}: ${state.gold} gold, identity costs ${IDENTITY_COST}`);
    }
    // NON-VACUITY: the walk has to have actually walked. A broken policy that
    // fell out on the first column would leave `gold` untested and every seed
    // "passing" for want of a comparison.
    expect(seedsWalked, 'no seed walked a full boss cadence').toBe(40);
    expect(fightsFought, 'no fights were resolved, so no fight gold was exercised').toBeGreaterThan(40);
    expect(shortfalls, shortfalls.join('\n')).toEqual([]);
  });
});
