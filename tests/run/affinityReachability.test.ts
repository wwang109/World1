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
 *   - SUPPLY is the constraint, and it WAS not even across types. Every ELEMENT
 *     had a dedicated single-element stall whose whole 6-card shelf is that
 *     element (an identity in one visit). No WEAPON type had one: the best a
 *     Lance player could find was Armory, expected 1.61 same-type offers per
 *     shelf, against 6.00 for every element.
 *
 * CLOSED ON THE SHOP SIDE (2026-08-26): `src/data/shopTypes.ts` gained the five
 * missing weapon stalls (swordwright / cleaving_yard / lancers_rest /
 * fletchers_loft / beastmoot), so every one of the eleven card types now has a
 * single-type stall and the "identity in one visit" guarantee below is asserted
 * for weapons and elements alike — measured after the change: 6.00 same-type
 * offers per shelf for all eleven types, weapons up from a 2.40 average best.
 *
 * The tests below pin the floors that make the ask keepable, so a future content
 * or filter pass cannot quietly drop one type below them.
 */

const typeKeyOf = (s: SkillDef): string => {
  const t = cardType(s);
  return t ? `${t.kind}:${t.type}` : 'none';
};
const isGated = (s: SkillDef): boolean => s.effects.some((a) => a.affinity === true);
/**
 * A gated card whose gate is open on the copy a player is FIRST offered — i.e. the
 * gated line is not itself tier-locked (`TierLocked`, engine/types.ts).
 *
 * THE DISTINCTION MATTERS FOR DENSITY (2026-08-26). The five Diamond capstones
 * (`arcane_bolt`, `hunter_shot`, `judgment_light`, `lance_thrust`, `leeching_fang`)
 * carry `{ affinity: true, minTier: 'diamond' }`, so `isGated` counts them while
 * their payoff does not exist until the top rank. Counting them as payoff supply
 * would claim reachability the Bronze/Silver/Gold shelf does not have — which is
 * exactly the over-claim the floors below exist to prevent.
 */
const isGatedFromBronze = (s: SkillDef): boolean =>
  s.effects.some((a) => a.affinity === true && a.minTier === undefined);
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

  it('every TYPE a gated card is typed to has its own single-type stall, and each shelf hands over a whole identity', () => {
    // The strongest supply guarantee in the run, and the reason the affinity
    // cards are reachable at all: these pools are single-type, so the shelf is
    // `min(6, pool)` cards of that one type every time. Rolled through the REAL
    // `rollShopStock` at the three real depth bands (`shopStockDepthForWave`),
    // not asserted from the filter.
    //
    // ASSERTED PER TYPE, not over "whatever stalls happen to exist": a dilution
    // pass that widened one stall's filter would otherwise just drop it out of
    // the set being measured and the suite would report nothing.
    //
    // WIDENED FROM ELEMENTS TO EVERY TYPE (2026-08-26). This used to audit
    // `c.element !== undefined` only, and its own comment recorded why: the five
    // WEAPON types had no equivalent stall, so the >= 1 floor above was the only
    // bar they cleared (Lance's best was Armory at 1.61 offers/shelf). Five
    // weapon stalls closed that, and the guarantee is now asserted for the
    // weapon-typed gated cards too — `sworn_edge`, `whetstone_vow`,
    // `warband_cleave`, `phalanx_thrust`, `massed_volley`, `pack_instinct`,
    // `oathplate`, `pikewall_oath`, `rustbind_hex`, `blooded_fang` — which were
    // effectively unbuildable before it.
    const gatedTypes = [...new Set(GATED.map(typeKeyOf))].sort();
    expect(gatedTypes.length, 'no gated cards to audit').toBeGreaterThan(0);
    // Non-vacuity on the half this test was blind to: weapon-typed gated cards
    // must actually be in the set, or widening the audit proved nothing.
    expect(
      gatedTypes.filter((t) => t.startsWith('weapon:')).length,
      `no weapon-typed gated card to audit — gated types: ${gatedTypes.join(', ')}`,
    ).toBeGreaterThan(0);
    const depths = [1, 2, 4, 7].map(shopStockDepthForWave);
    let shelvesChecked = 0;
    for (const type of gatedTypes) {
      const stall = shopTypeIds.find((id) => {
        const pool = cardPoolForShop(id);
        return pool.length > 0 && pool.every((s) => typeKeyOf(s) === type);
      });
      expect(stall, `${type} has no single-type stall`).toBeDefined();
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

  it('a gated card exists for the DEFENSIVE, DEBUFF and SUPPORT shelves, not just the offensive ones', () => {
    // THE OTHER HALF OF THE SAME REACHABILITY QUESTION (2026-08-26). Supply per
    // TYPE was measured above; this is supply per ARCHETYPE, and it was the
    // worse of the two: 16 of the 17 gated cards were `offense` and one was
    // `healing`, so the Alchemist (`archetypes: ['debuff']`) and Bulwark
    // (`defensive` / `support`) shelves offered a gated card 0.0% of the time
    // over 500 rolled shelves each. A defensive or debuff build could play a
    // whole run and never learn the keyword exists.
    //
    // Asserted through the REAL shop filters, per shop, so a future filter or
    // content pass cannot take either shelf back to zero.
    const ARCHETYPE_SHELVES = ['alchemist', 'bulwark', 'sanctum'] as const;
    for (const shopId of ARCHETYPE_SHELVES) {
      const gatedInPool = cardPoolForShop(shopId).filter(isGated);
      expect(
        gatedInPool.length,
        `${shopId} stocks no affinity-gated card at all — the keyword does not exist for that build`,
      ).toBeGreaterThanOrEqual(3);
    }
    // And it is really rolled, not merely pool-eligible: at least one shelf in a
    // fixed seed range must actually offer one, at every real depth band.
    for (const shopId of ARCHETYPE_SHELVES) {
      for (const depth of [1, 2, 4, 7].map(shopStockDepthForWave)) {
        let offered = 0;
        for (let seed = 1; seed <= 60; seed += 1) {
          if (rollShopStock(shopId, seed, depth).cards.some((o) => isGated(skillBook[o.skillId]!))) offered += 1;
        }
        expect(offered, `${shopId} @depth ${depth}: 0 of 60 shelves offered a gated card`).toBeGreaterThan(0);
      }
    }
  });
});

/**
 * PAYOFF-TO-ENABLER DENSITY, PER TYPE — the half of reachability nothing measured.
 *
 * WHAT WAS MISSING. Everything above measures SUPPLY: does a shelf exist that
 * hands over three of a type, is a gated card sold beside its own identity, can
 * the draft commit. None of it asks the prior question — does the type have
 * enough PAYOFFS to be worth committing to, and enough ENABLERS to reach them?
 * A type with 22 cards and one gated card passes every test above and is still a
 * dead archetype: the commitment has one reward, so "go three Axe" is a
 * single-card lottery rather than a build.
 *
 * MEASURED 2026-08-26, over the real book, BRONZE-REACHABLE gated cards per type:
 *   bow 1 · frost 2 · lightning 2 · dark 2 · beast 2 · nature 2 · lance 2 ·
 *   axe 2 · fire 3 · holy 3 · sword 3
 * against enabler pools (all on-type cards) of bow 10 · frost 10 · lightning 11 ·
 * fire 12 · dark 12 · beast 13 · nature 13 · holy 16 · lance 16 · sword 21 · axe 22.
 * So the payoff the game offered a Bow board was ONE card, drawn from the
 * joint-thinnest pool in the book. The Q3 pass added nine gated cards to take
 * every type to the floor below.
 *
 * THE TWO FLOORS, and why each is the number it is:
 *
 *  1. PAYOFFS >= MIN_PAYOFFS_PER_TYPE (3). One payoff is a lottery and two is a
 *     coin flip on which one the shop rolls; three is the point at which a type's
 *     reward is a CHOICE. It is deliberately the same number as
 *     `IDENTITY_THRESHOLD` — the ask and the answer are the same size.
 *
 *  2. NON-PAYOFF ON-TYPE CARDS >= (IDENTITY_THRESHOLD - 1) * PAYOFFS. Every payoff
 *     needs `IDENTITY_THRESHOLD - 1` OTHER cards of its type on the board to switch
 *     on, and they cannot all be the same two cards if the payoffs are to be
 *     playable as alternatives. This is the ratio the rot would show up in: a
 *     future pass that keeps adding gated cards to a thin type raises the payoff
 *     count without adding anything that can open the gate, and this is the
 *     assertion that catches it. Held with room today (the tightest is bow at 9
 *     non-payoff cards against a required 6) — the floor is a tripwire, not a fit.
 */
describe('a payoff family never outruns the enablers that switch it on', () => {
  const MIN_PAYOFFS_PER_TYPE = 3;
  /** Per type: every on-type card, and which of them are bronze-reachable payoffs. */
  const byType = new Map<string, { all: SkillDef[]; payoffs: SkillDef[] }>();
  for (const card of ALL_CARDS) {
    const key = typeKeyOf(card);
    const row = byType.get(key) ?? { all: [], payoffs: [] };
    row.all.push(card);
    if (isGatedFromBronze(card)) row.payoffs.push(card);
    byType.set(key, row);
  }

  it('the measurement covers every type in the book — otherwise the floors below are partial', () => {
    expect([...byType.keys()].sort()).toEqual(TYPES);
    expect(TYPES.length, 'the game claims eleven card types').toBe(11);
    expect(MIN_PAYOFFS_PER_TYPE, 'the payoff floor is the identity threshold').toBe(IDENTITY_THRESHOLD);
  });

  it('every type has at least MIN_PAYOFFS_PER_TYPE bronze-reachable affinity payoffs', () => {
    const thin: string[] = [];
    for (const type of TYPES) {
      const { payoffs } = byType.get(type)!;
      if (payoffs.length < MIN_PAYOFFS_PER_TYPE) {
        thin.push(`${type}: ${payoffs.length} payoff(s) — ${payoffs.map((s) => s.id).join(', ') || 'none'}`);
      }
    }
    expect(
      thin,
      'a type whose commitment has fewer than three rewards is a trap, not an archetype. '
      + 'Author gated cards for it (it is PL-neutral — the gate carries its own refund): '
      + thin.join(' | '),
    ).toEqual([]);
  });

  it('and every payoff has its own pair of non-payoff on-type cards to switch it on', () => {
    const starved: string[] = [];
    for (const type of TYPES) {
      const { all, payoffs } = byType.get(type)!;
      const enablers = all.length - payoffs.length;
      const need = (IDENTITY_THRESHOLD - 1) * payoffs.length;
      if (enablers < need) {
        starved.push(`${type}: ${payoffs.length} payoffs need ${need} non-payoff on-type cards, has ${enablers}`);
      }
    }
    expect(
      starved,
      'a payoff family outrunning its enablers — add ON-TYPE cards, not more gated ones: '
      + starved.join(' | '),
    ).toEqual([]);
  });

  it('the capstone payoffs are counted separately, and are NOT what clears the floor', () => {
    // The honesty check on the measurement itself. A Diamond-locked gated hit is a
    // real payoff at Diamond and no payoff at all on the shelf a Bronze board is
    // shopping from, so it must not be able to lift a type over the floor. Proven
    // by re-running the floor against the LOOSER predicate and showing the strict
    // one is what the assertion above used.
    const capstones = ALL_CARDS.filter((s) => isGated(s) && !isGatedFromBronze(s));
    expect(capstones.length, 'no tier-locked gated card — this check has nothing to separate').toBe(5);
    for (const card of capstones) {
      expect(card.effects.some((a) => a.affinity === true && a.minTier === 'diamond'), card.id).toBe(true);
    }
    for (const type of TYPES) {
      const strict = byType.get(type)!.payoffs.length;
      expect(strict, `${type} must clear the floor on bronze-reachable payoffs alone`).toBeGreaterThanOrEqual(MIN_PAYOFFS_PER_TYPE);
    }
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
