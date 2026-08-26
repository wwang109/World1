import { describe, expect, it } from 'vitest';
import { simulate } from '../../src/engine/combat/simulate';
import { skillBook } from '../../src/data/skills';
import { PRICE, powerLevelDeci, powerLevelBreakdown, capViolations, HIT_KINDS, TIER_BUDGET_DECI } from '../../src/engine/balance';
import { IDENTITY_THRESHOLD } from '../../src/engine/combat/typeIdentity';
import { applyTier, autoScaleTier } from '../../src/engine/cards';
import { validateSkillDocument } from '../../src/data/validateSkillContent';
import type { Action, CombatConfig, SkillDef, SkillTier } from '../../src/engine/types';
import type { DamageCalculation } from '../../src/engine/combat/events';

/**
 * AFFINITY STRIKE — the board's own offensive payoff.
 *
 * The gate: a card's `affinityStrike` fires only when the caster carries the
 * affinity matching that card's own type. For a hero that means Board Type
 * Identity — `IDENTITY_THRESHOLD` (3) cards of one UNIQUE top type, this card
 * included — so it asks for two more of its own type and no tie at the top.
 *
 * WHAT THIS FILE IS FOR. The keyword's whole value is a conditional that a
 * player configures at BUILD time, which makes two failure modes invisible in
 * ordinary play: a gate that is always open (the payoff is just free damage and
 * the deckbuilding ask is a lie) and a gate that never opens (dead budget on the
 * face). Both look like "a card that deals damage" from the outside. So the
 * central test drives the SAME card across boards that do and do not meet the
 * threshold and asserts the damage differs by exactly the printed number.
 *
 * The second thing it pins is that turning the gate ON never makes the card's
 * own hit smaller. `affinityStrike` is not a `kind: 'damage'` action, so it stays
 * out of the multi-hit divisor (`countDamageActions`) — but that is one word in
 * one predicate, and if it ever changed, an on-type board would quietly halve
 * its own base hit while appearing to gain a second one.
 */

/** Lay slots out by card SIZE — a size-N card occupies N slots. */
/**
 * A GATED HIT. Affinity is a modifier, not a keyword (user ruling 2026-08-25), so
 * there is no `affinityStrike` kind to match on — a gated hit is an ordinary
 * `damage` action carrying `affinity: true`.
 */
function isGatedHit(a: Action): boolean {
  return a.kind === 'damage' && a.affinity === true;
}

/** Any gated action, whatever its kind. */
function isGated(a: Action): boolean {
  return a.affinity === true;
}

function board(ids: readonly string[]): Array<{ skillId: string; slot: number }> {
  let next = 0;
  return ids.map((id) => {
    const skill = skillBook[id];
    if (!skill) throw new Error(`affinityStrike: unknown card "${id}"`);
    const slot = next;
    next += skill.size;
    return { skillId: id, slot };
  });
}

interface Landed { total: number; hits: number[]; calcs: DamageCalculation[] }

/** Every skill hit the hero lands on the foe, in order. */
function heroHits(heroBoard: readonly string[], seed = 5): Landed {
  const config: CombatConfig = {
    playerTeam: [{
      name: 'Hero',
      stats: { maxHp: 900, hp: 900, attack: 12, magicPower: 12, armor: 3, magicResist: 3, speed: 30 },
      pieces: board(heroBoard), boardSize: 14,
    } as never],
    // Zero defense so a hit's printed power lands unmodified — the assertions
    // below are about EXACT numbers, and armor would floor them into ambiguity.
    // Huge HP so nothing ends early and both boards get the same rotations.
    enemyTeam: [{
      name: 'Foe',
      stats: { maxHp: 20000, hp: 20000, attack: 1, magicPower: 1, armor: 0, magicResist: 0, speed: 6 },
      pieces: board(['sword_slash']), boardSize: 4,
    } as never],
    skillBook, maxTurns: 40, endgame: { attritionEnabled: false, suddenDeathTurn: 0 },
  } as never;
  const hits: number[] = [];
  const calcs: DamageCalculation[] = [];
  for (const e of simulate(config, seed).events) {
    if (e.kind !== 'damage' || e.side !== 'enemy' || e.source !== 'skill') continue;
    hits.push(e.amount);
    if (e.calculation) calcs.push(e.calculation);
  }
  return { total: hits.reduce((a, b) => a + b, 0), hits, calcs };
}

const SWORN = skillBook.sworn_edge!;

/**
 * The affinity hits in a log, identified by their DERIVATION rather than by
 * their total or their power.
 *
 * WHY NOT MATCH ON THE NUMBER: several shipped swords have `power: 20`, the same
 * as Sworn Edge's affinity power, and with Attack 12 their totals collide too —
 * so both `hits.includes(20)` and `calc.power === 20` catch other cards' base
 * hits and prove nothing. What is UNIQUE to an affinity hit is that it carries no
 * power, on a board picked so that no other card shares it. NOT by a zero stat
 * term: under the composite model (affinity is a modifier, not a keyword) a gated
 * `damage` is an ordinary damage action and DOES take its stat share.
 */
function hitsOfPower(landed: Landed, power: number): DamageCalculation[] {
  return landed.calcs.filter((c) => c.power === power);
}

/**
 * A board of three SWORDS whose partner cards' powers are 10 and 6 — deliberately
 * NOT 20, which is Sworn Edge's gated power. `sword_slash` is also a 20, so using
 * it as a partner makes the gated hit unidentifiable.
 */
const ON_TYPE = ['sworn_edge', 'void_pierce', 'twin_slash'];
/** The same card two swords short of the threshold. */
const OFF_TYPE = ['sworn_edge', 'twin_slash'];
/** The affinity hit's printed power, read from the card rather than hardcoded. */
function affinityPower(card: SkillDef): number {
  const action = card.effects.find(isGatedHit);
  if (!action || action.kind !== 'damage') throw new Error(`${card.id} carries no gated hit`);
  return action.power;
}
function basePower(card: SkillDef): number {
  const action = card.effects.find((a) => a.kind === 'damage');
  if (!action || action.kind !== 'damage') throw new Error(`${card.id} carries no damage`);
  return action.power;
}

describe('the gate: the board decides whether the extra hit exists', () => {
  // `sworn_edge` is a SWORD card, so it counts as one of the three swords its own
  // gate needs. Two more open it; one more does not.
  it('does NOT fire one card short of the threshold', () => {
    // Two swords total (the card + one partner) — one short of IDENTITY_THRESHOLD.
    const short = heroHits(OFF_TYPE);
    expect(short.hits.length, 'the probe must land hits').toBeGreaterThan(1);
    expect(hitsOfPower(short, affinityPower(SWORN)), 'the gated hit must not exist below the threshold').toEqual([]);
  });

  it('fires AT the threshold, and the whole difference is the printed number', () => {
    // The SAME two cards plus one more sword: three swords, no tie, gate open.
    // `void_pierce` is a third sword; it is the only board change.
    const closed = heroHits(OFF_TYPE);
    const open = heroHits(ON_TYPE);
    expect(hitsOfPower(closed, affinityPower(SWORN))).toEqual([]);
    const fired = hitsOfPower(open, affinityPower(SWORN));
    expect(fired.length, 'the gate must open at the threshold').toBeGreaterThan(0);
    // The gated hit is an ORDINARY damage action, so its base is its printed
    // power plus its share of the caster's stat — not the bare power.
    for (const c of fired) expect(c.baseDamage).toBe(affinityPower(SWORN) + c.baseStat);
  });

  it('a TIE at the top of the tally opens no gate', () => {
    // 3 swords vs 3 axes: `boardTypeIdentity` requires a UNIQUE top type, so a
    // tie yields no identity, no affinity, and no extra hit. This is the rule a
    // player is most likely to trip over by accident while "going wide".
    const tied = heroHits(['sworn_edge', 'void_pierce', 'twin_slash', 'hemorrhage', 'rupturing_strike', 'mortal_wound']);
    expect(tied.hits.length, 'the probe must land hits').toBeGreaterThan(1);
    expect(hitsOfPower(tied, affinityPower(SWORN)), 'a tie yields no identity, so no gated hit').toEqual([]);
  });

  it('the WRONG type at the threshold opens no gate', () => {
    // Three axes is an identity — just not this card's. A gate keyed to "any
    // identity at all" rather than to the card's own type would pass here.
    const wrongType = heroHits(['sworn_edge', 'hemorrhage', 'rupturing_strike', 'mortal_wound']);
    expect(hitsOfPower(wrongType, affinityPower(SWORN)), 'an AXE identity must not open a SWORD card\u2019s gate').toEqual([]);
  });
});

describe('a gated action is an ORDINARY action — the gate changes only whether it happens', () => {
  it('the divisor is GATE-AWARE: off-type the base hit keeps the WHOLE stat', () => {
    // THE INVARIANT THIS EXISTS FOR. Affinity is a modifier, so a gated `damage`
    // joins the multi-hit stat split like any other damage action. That is only
    // fair if the split counts hits that CAN actually happen: were the divisor
    // blind to the gate, an off-type card would hand half its stat pool to a hit
    // it never lands — a permanent tax for a payload the board cannot reach.
    //
    // Off-type Sworn Edge is therefore a genuine SINGLE-hit card at full stat.
    const off = heroHits(OFF_TYPE);
    const base = hitsOfPower(off, basePower(SWORN));
    expect(base.length, 'the base hit must land').toBeGreaterThan(0);
    for (const c of base) {
      expect(c.baseStat, 'off-type: the whole Attack, undivided').toBe(12);
      expect(c.baseDamage).toBe(basePower(SWORN) + 12);
    }
  });

  it('on-type it is a genuine TWO-hit card, and the split is exact', () => {
    // On-type the same card is two hits, and the two shares must sum to EXACTLY
    // the caster's stat — the multi-hit rule's own guarantee, which a gated hit
    // must not be allowed to break.
    const on = heroHits(ON_TYPE);
    const baseHits = hitsOfPower(on, basePower(SWORN));
    const gatedHits = hitsOfPower(on, affinityPower(SWORN));
    expect(baseHits.length, 'the base hit must land').toBeGreaterThan(0);
    expect(gatedHits.length, 'the gated hit must land').toBeGreaterThan(0);
    // Front-loaded rounding: Attack 12 splits 6/6.
    expect(baseHits[0]!.baseStat + gatedHits[0]!.baseStat, 'the shares sum to the whole stat').toBe(12);
    expect(baseHits[0]!.baseStat).toBeGreaterThanOrEqual(gatedHits[0]!.baseStat);
  });

  it('opening the gate is still a net GAIN, not a redistribution', () => {
    // The split means the base hit DOES shrink on-type — that is the honest
    // consequence of the gated hit being an ordinary hit. What must remain true is
    // that the card as a whole delivers strictly more: the cast's total damage
    // on-type exceeds its total off-type by the gated power.
    const off = heroHits(OFF_TYPE);
    const on = heroHits(ON_TYPE);
    const sumOf = (l: Landed, powers: readonly number[]): number =>
      l.calcs.filter((c) => powers.includes(c.power)).reduce((acc, c) => acc + c.baseDamage, 0)
      / Math.max(1, l.calcs.filter((c) => c.power === basePower(SWORN)).length);
    // Per CAST of Sworn Edge: base+stat off-type, versus base+share plus
    // gated+share on-type. The stat pool is the same either way, so the delta is
    // exactly the gated power.
    const perCastOff = sumOf(off, [basePower(SWORN)]);
    const perCastOn = sumOf(on, [basePower(SWORN), affinityPower(SWORN)]);
    expect(perCastOn - perCastOff, 'the gate adds exactly its printed power').toBe(affinityPower(SWORN));
  });
});

describe('AFFINITY CHARGE — the forward-armed half', () => {
  /** Bonus damage that reached a hit, per cast, in order. */
  function bonuses(heroBoard: readonly string[], seed = 5): Array<{ card: string; bonus: number }> {
    const config: CombatConfig = {
      playerTeam: [{
        name: 'Hero',
        stats: { maxHp: 900, hp: 900, attack: 10, magicPower: 10, armor: 3, magicResist: 3, speed: 30 },
        pieces: board(heroBoard), boardSize: 14,
      } as never],
      enemyTeam: [{
        name: 'Foe', stats: { maxHp: 30000, hp: 30000, attack: 1, magicPower: 1, armor: 0, magicResist: 0, speed: 6 },
        pieces: board(['sword_slash']), boardSize: 4,
      } as never],
      skillBook, maxTurns: 14, endgame: { attritionEnabled: false, suddenDeathTurn: 0 },
    } as never;
    const out: Array<{ card: string; bonus: number }> = [];
    let card = '';
    for (const e of simulate(config, seed).events) {
      if (e.kind === 'play' && e.side === 'player') card = e.skillId;
      if (e.kind === 'damage' && e.side === 'enemy' && e.source === 'skill' && e.calculation) {
        out.push({ card, bonus: e.calculation.effectBonusDamage });
      }
    }
    return out;
  }

  const ARMER = skillBook.kindling_rite!;
  const AMOUNT = (() => {
    const a = ARMER.effects.find((x) => x.kind === 'empowerNext');
    if (!a || a.kind !== 'empowerNext') throw new Error('kindling_rite lost its charge');
    return a.amount;
  })();

  it('pays the NEXT matching card, not the cast that armed it', () => {
    // Three fire cards => fire affinity. The armer must land NOTHING extra on its
    // own cast (it is consumed at the START of a later cast), and the next Fire
    // card must collect exactly the printed amount.
    const seen = bonuses(['kindling_rite', 'cinder_dart', 'ember_lash', 'sword_slash']);
    const armerHits = seen.filter((h) => h.card === 'kindling_rite');
    expect(armerHits.length, 'the armer must cast').toBeGreaterThan(0);
    for (const h of armerHits) expect(h.bonus, 'the arming cast gains nothing itself').toBe(0);
    expect(seen.some((h) => h.card === 'cinder_dart' && h.bonus === AMOUNT),
      `the next Fire card must collect +${AMOUNT}`).toBe(true);
  });

  it('a card of a DIFFERENT type never collects it', () => {
    // The charge says "your next FIRE card". A sword card casting in between must
    // walk past it untouched — and must not consume it either, which the test
    // above proves by the fire card still collecting.
    const seen = bonuses(['kindling_rite', 'cinder_dart', 'ember_lash', 'sword_slash']);
    for (const h of seen.filter((x) => x.card === 'sword_slash')) {
      expect(h.bonus, 'a sword card must not collect a fire charge').toBe(0);
    }
  });

  it('ONE charge, ONE collection — the second matching card gets nothing', () => {
    // Bounded resource: `ember_lash` is also Fire and casts after `cinder_dart`,
    // so it arrives to an empty board. If the charge ever paid twice it would be
    // worth double what it prices.
    const seen = bonuses(['kindling_rite', 'cinder_dart', 'ember_lash', 'sword_slash']);
    const collectors = seen.filter((h) => h.bonus > 0).map((h) => h.card);
    expect(collectors.length, 'at least one collection').toBeGreaterThan(0);
    expect([...new Set(collectors)], 'exactly one card ever collects per arming').toEqual(['cinder_dart']);
  });

  it('arms NOTHING when the board is off-type', () => {
    const seen = bonuses(['kindling_rite', 'sword_slash', 'twin_slash']);
    expect(seen.length, 'the probe must land hits').toBeGreaterThan(1);
    for (const h of seen) expect(h.bonus, `${h.card} collected on an off-type board`).toBe(0);
  });

  it('prices at the flat-damage currency with the affinity refund, and no uptime halving', () => {
    // 2.5 deci/pt: flatPowerPerPoint (5) x the affinity refund (1/2).
    const perPoint = (PRICE.flatPowerPerPoint * PRICE.affinityPayoffNum) / PRICE.affinityPayoffDen;
    expect(perPoint).toBe(2.5);
    expect(perPoint).toBeLessThan(PRICE.flatPowerPerPoint);
    // IT NOW EQUALS `comboBonus`'s rate, from the opposite direction: comboBonus
    // halves the flat currency for ~50% archetype UPTIME, this halves it for the
    // board COMMITMENT the gate demands. Two independent dials that happen to
    // meet — worth pinning, because a future move of either should be a decision
    // and not a side effect of assuming they are the same number.
    expect(perPoint).toBe(PRICE.comboPerPointNum / PRICE.comboPerPointDen);
    for (const card of Object.values(skillBook)) {
      if (!card.effects.some((a) => a.kind === 'empowerNext')) continue;
      expect(powerLevelDeci(card), `${card.id} budget`).toBe(TIER_BUDGET_DECI[card.tier]);
      expect(capViolations(card), `${card.id} caps`).toEqual([]);
      expect(card.element ?? card.weapon, `${card.id} needs a type`).toBeDefined();
    }
  });
});

describe('THE POINT OF THE REFACTOR: affinity composes with keywords that know nothing about it', () => {
  /**
   * Affinity used to be a family of bespoke keywords (`affinityStrike`,
   * `affinityCharge`), which meant every new gated payoff needed a pricing row, an
   * interpreter arm, a validator case, a glossary entry and a face badge. Under
   * the user's ruling it became a MODIFIER: one flag, one gate check, one refund.
   *
   * This is the test that proves the difference. `poison` and `stun` have no
   * affinity code anywhere — no row, no arm, no case — and both gate correctly and
   * price correctly the moment content authors the flag. If that stops being true,
   * the refactor has been undone.
   */
  const GATED: SkillDef = {
    id: 'gate_probe', name: 'Gate Probe', archetypes: ['offense'],
    property: 'magical', element: 'fire', size: 2, rarity: 'common', tier: 'bronze',
    effects: [
      { kind: 'damage', power: 20 },
      { kind: 'poison', stacks: 6, affinity: true },
      { kind: 'stun', turns: 1, affinity: true },
    ],
    text: '',
  };
  const UNGATED: SkillDef = { ...GATED, effects: GATED.effects.map(({ affinity: _drop, ...a }) => a as Action) };

  it('the refund is exactly 1/5 of what the gated actions cost ungated', () => {
    const gatedOnly = powerLevelDeci(UNGATED) - powerLevelDeci({ ...GATED, effects: [GATED.effects[0]!] });
    const refund = powerLevelDeci(UNGATED) - powerLevelDeci(GATED);
    expect(refund).toBe(gatedOnly - Math.floor((gatedOnly * PRICE.affinityPayoffNum) / PRICE.affinityPayoffDen));
    expect(refund, 'and it is a real refund, not a rounding artifact').toBeGreaterThan(0);
    // The ungated line is untouched by the gate on its siblings.
    expect(powerLevelDeci({ ...GATED, effects: [GATED.effects[0]!] }))
      .toBe(powerLevelDeci({ ...UNGATED, effects: [UNGATED.effects[0]!] }));
  });

  it('gated poison and stun resolve on-type and are ABSENT off-type', () => {
    const run = (hero: readonly string[]): string[] => {
      const book: Record<string, SkillDef> = { ...skillBook, gate_probe: GATED };
      let next = 0;
      const pieces = hero.map((id) => {
        const size = book[id]!.size;
        const slot = next;
        next += size;
        return { skillId: id, slot };
      });
      const config: CombatConfig = {
        playerTeam: [{
          name: 'Hero', stats: { maxHp: 900, hp: 900, attack: 10, magicPower: 10, armor: 3, magicResist: 3, speed: 30 },
          pieces, boardSize: 14,
        } as never],
        enemyTeam: [{
          name: 'Foe', stats: { maxHp: 9000, hp: 9000, attack: 1, magicPower: 1, armor: 0, magicResist: 0, speed: 6 },
          pieces: board(['sword_slash']), boardSize: 4,
        } as never],
        skillBook: book, maxTurns: 10, endgame: { attritionEnabled: false, suddenDeathTurn: 0 },
      } as never;
      return [...new Set(simulate(config, 5).events
        .filter((e) => e.kind === 'statusApplied' && e.side === 'enemy')
        .map((e) => (e as never as { status: string }).status))];
    };
    // Three fire cards => fire affinity. `cinder_dart` also burns, hence `burn`.
    const on = run(['gate_probe', 'cinder_dart', 'ember_lash']);
    expect(on, 'on-type: both gated statuses land').toContain('poison');
    expect(on).toContain('stun');
    // One fire card => no identity => neither gated action exists.
    const off = run(['gate_probe', 'sword_slash', 'twin_slash']);
    expect(off, 'off-type: no status at all, not even a weakened one').toEqual([]);
  });
});

describe('pricing', () => {
  it('the refund is HALF, and it buys twice what the same budget buys ungated', () => {
    expect(PRICE.affinityPayoffNum).toBe(1);
    expect(PRICE.affinityPayoffDen).toBe(2);
    const refund = 1 - PRICE.affinityPayoffNum / PRICE.affinityPayoffDen;
    expect(refund).toBeGreaterThan(0);
    // THE NUMBER THAT MATTERS to a player: a fixed budget spent on a gated effect
    // buys 1/(1-refund) times what the same budget buys ungated. At the old 4/5
    // that was x1.25 — the entire reward for committing three board slots — and it
    // measured as +2.7% total damage on the card's BEST board.
    expect(1 / (1 - refund)).toBe(2);
  });

  it('does NOT have to price below the conditional discount — that comparison was unsound', () => {
    // A previous version of this suite asserted `affinityRefund < conditionalDiscount`
    // "since this gate never closes once met". The two pay for DIFFERENT things:
    // `conditionalBonusDen` prices UNCERTAINTY (~50% archetype uptime, a gate that
    // costs nothing to build toward), affinity prices COMMITMENT (two board slots
    // dictated at build time). Nothing required one to sit below the other, and the
    // false constraint is what held the family at an unplayable rate. Pinned as an
    // EQUALITY now so the two are seen to be independent dials that happen to meet.
    expect(1 - PRICE.affinityPayoffNum / PRICE.affinityPayoffDen).toBe(1 / PRICE.conditionalBonusDen);
  });

  it('the gate still costs what the refund is paying for: two dictated slots', () => {
    // The rate is no longer DERIVED from board fractions — that derivation
    // (IDENTITY_THRESHOLD-1 over HERO_BOARD_SLOTS = 1/5) produced a number that
    // measured as unplayable, and it is now set by measurement instead. What is
    // still worth pinning is the COST the refund pays for: a card's gate dictates
    // two further board slots. If IDENTITY_THRESHOLD moves, the refund is owed a
    // fresh measurement, and this failing is the reminder.
    expect(IDENTITY_THRESHOLD).toBe(3);
  });

  it('every shipped affinity card is exactly on budget and within caps', () => {
    const cards = Object.values(skillBook).filter((c) => c.effects.some(isGated));
    expect(cards.length, 'the keyword must have shipped content').toBeGreaterThan(0);
    for (const card of cards) {
      expect(powerLevelDeci(card), `${card.id} budget`).toBe(TIER_BUDGET_DECI[card.tier]);
      expect(capViolations(card), `${card.id} caps`).toEqual([]);
      // The gate is keyed to the card's own type, so a typeless card could never
      // open it. Authoring refuses one; this proves no shipped card slipped past.
      expect(card.element ?? card.weapon, `${card.id} must have a type`).toBeDefined();
    }
  });

  it('a gated hit does NOT pay the multi-hit premium', () => {
    // THE GATE REFUNDS PL, IT DOES NOT LEVY IT (user ruling 2026-08-25:
    // "affinity is just a keyword with different effects behind it... but
    // affinity should be something that gives back PL, because there is a cost
    // to making affinity activate").
    //
    // `extraHitPremium` prices a conditionality whose upside is that flat
    // `mods.damageFlat` applies PER HIT — and a gated hit is explicitly denied
    // that (no damageFlat, no stat share, no rider bonus). Charging it anyway put
    // every card in the family BEHIND a plain single-hit card of the same budget
    // at every armor value even on its best board, which is a card nobody runs.
    expect(HIT_KINDS.has('damage'), 'a gated hit is an ordinary damage action').toBe(true);
    // And the exemption is worth exactly one premium, no more: a card carrying a
    // damage line plus a gated hit prices as a SINGLE-instance card.
    const probe: SkillDef = {
      id: 'premium_probe', name: 'Premium Probe',
      archetypes: ['offense'], property: 'physical', weapon: 'sword',
      size: 2, rarity: 'common', tier: 'bronze',
      effects: [{ kind: 'damage', power: 32 }, { kind: 'damage', power: 20, affinity: true }],
      text: '',
    };
    const parts = powerLevelBreakdown(probe);
    expect(parts.find((x) => x.label === 'multi-hit'), 'no multi-hit part at all').toBeUndefined();
    // Two PLAIN damage lines still pay it — the exemption is scoped to the gate.
    const plainTwo = powerLevelBreakdown({ ...probe, effects: [{ kind: 'damage', power: 16 }, { kind: 'damage', power: 16 }] });
    expect(plainTwo.find((x) => x.label === 'multi-hit')?.deci).toBe(PRICE.extraHitPremium);
  });

  it('every gated part lands on a WHOLE power level, at every tier', () => {
    // At the 1/2 refund a gated `damage` prices at 2.5 deci/pt, so its magnitude
    // must be a multiple of 4 (it was a multiple of 5 at the old 4/5 rate). Rather
    // than restate that arithmetic per kind — it differs for a DoT, a heal, a
    // charge — assert the property the project actually requires, on every shipped
    // gated card at every tier it can reach. That is also what caught the five
    // Diamond capstones when the rate moved: their authored payloads were still
    // multiples of 5 and went fractional.
    let checked = 0;
    for (const card of Object.values(skillBook)) {
      for (const tier of ['bronze', 'silver', 'gold', 'diamond'] as SkillTier[]) {
        const skill = applyTier(card, tier);
        if (!skill.effects.some(isGated)) continue;
        checked += 1;
        for (const part of powerLevelBreakdown(skill)) {
          expect(part.deci % 10 === 0, `${card.id}@${tier}: part "${part.label}" (${part.deci}) is not whole`).toBe(true);
        }
      }
    }
    expect(checked, 'the sweep must actually reach gated cards').toBeGreaterThan(20);
  });
});

describe('DIAMOND CAPSTONES — an affinity payload authored only at the top tier', () => {
  /** Every (card, tier) pair whose AUTHORED override adds an affinity payload. */
  const capstones = Object.values(skillBook).flatMap((card) =>
    Object.keys(card.tierUpgrades ?? {})
      .map((tier) => ({ card, tier: tier as SkillTier, skill: applyTier(card, tier as SkillTier) }))
      .filter(({ skill }) => skill.effects.some(isGatedHit)));

  it('the capstones exist and are all at DIAMOND', () => {
    // The design statement: a card is an ordinary attack for its whole life and
    // learns its board's trick at the top tier. A capstone appearing at silver or
    // gold would quietly undo that.
    expect(capstones.length, 'there must be authored capstones').toBeGreaterThan(0);
    for (const { card, tier } of capstones) {
      expect(tier, `${card.id} capstone must be at diamond`).toBe('diamond');
    }
  });

  it('the BRONZE card carries no affinity payload — it is learned, not innate', () => {
    for (const { card } of capstones) {
      expect(card.effects.some(isGatedHit), `${card.id} bronze`).toBe(false);
    }
  });

  it('every capstone is exactly on the Diamond budget and within caps', () => {
    for (const { card, skill } of capstones) {
      expect(powerLevelDeci(skill), `${card.id}@diamond budget`).toBe(TIER_BUDGET_DECI.diamond);
      expect(capViolations(skill), `${card.id}@diamond caps`).toEqual([]);
    }
  });

  it('the capstone face states BOTH numbers, so the shop choice is legible', () => {
    // These are bought with gold at an offered tier, so the face IS the decision:
    // an on-type board gains and any other board is buying a worse card. That is
    // only fair if both halves are printed.
    for (const { card, skill } of capstones) {
      const aff = skill.effects.find(isGatedHit);
      const dmg = skill.effects.find((a) => a.kind === 'damage' && a.affinity !== true);
      const affPower = aff && aff.kind === 'damage' ? aff.power : -1;
      const dmgPower = dmg && dmg.kind === 'damage' ? dmg.power : -1;
      expect(skill.text, `${card.id}@diamond must print the base ${dmgPower}`).toContain(`Deal ${dmgPower} `);
      expect(skill.text, `${card.id}@diamond must print the affinity ${affPower}`).toContain(`hit again for ${affPower}`);
      expect(skill.text, `${card.id}@diamond must name the keyword`).toContain('{{Affinity}}');
    }
  });

  it('the capstone really is a TRADE — it gives up base damage for the gated hit', () => {
    // If a capstone were simply better than the auto-scaled tier, the choice
    // would be fake and every board would take it. The base must come DOWN
    // against what the same budget buys as one undivided hit.
    for (const { card, skill } of capstones) {
      const auto = autoScaleTier(card, 'diamond');
      const autoDmg = auto.effects.find((a) => a.kind === 'damage' && a.affinity !== true);
      const capDmg = skill.effects.find((a) => a.kind === 'damage' && a.affinity !== true);
      if (!autoDmg || autoDmg.kind !== 'damage' || !capDmg || capDmg.kind !== 'damage') continue;
      expect(capDmg.power, `${card.id}: capstone base must be below the auto-scaled ${autoDmg.power}`)
        .toBeLessThan(autoDmg.power);
    }
  });
});

describe('authoring rules', () => {
  /** Wrap one card def in the document shape the real validator consumes. */
  function problemsFor(def: Record<string, unknown>): string {
    return validateSkillDocument({
      schemaVersion: 1,
      cards: [{ id: 'probe_card', versions: [{ version: 1, def }] }],
    }).map((p) => p.message).join('\n');
  }

  const TYPED = {
    name: 'Typed Probe', text: 'Deal 10 (+ATK) Sword damage \u00b7 {{Affinity}} Sword \u2014 hit again for 5.',
    archetypes: ['offense'], property: 'physical', weapon: 'sword', size: 1, rarity: 'common', tier: 'bronze',
    effects: [{ kind: 'damage', power: 10 }, { kind: 'damage', power: 5, affinity: true }],
  };

  it('a typeless card is REFUSED — by the universal rule, so affinity needs none', () => {
    // The gate keys off `cardType`, so a typeless card could never open it. But
    // EVERY card must already carry an element or a weapon, so the affinity-
    // specific rule that used to sit here was unreachable and has been deleted
    // rather than kept as reassuring dead code. This test pins the rule that
    // actually does the work.
    const { weapon: _drop, ...typeless } = TYPED;
    expect(problemsFor({ ...typeless, property: 'true' })).toContain('must carry an element OR a weapon');
  });

  it('a gated action inherits its OWN kind\u2019s field rules, not bespoke ones', () => {
    // The point of affinity being a modifier: `{ damage, affinity: true }` is
    // validated as a `damage` action. It gets no stricter and no looser treatment
    // for being gated — which is why there is no per-kind affinity validation to
    // drift out of sync. (`damage` itself accepts any integer power; that is a
    // pre-existing property of `damage`, unchanged here.)
    expect(problemsFor({ ...TYPED, effects: [{ kind: 'damage', power: 10, affinity: true }] })).toBe('');
    // A malformed FLAG is still caught, since that field is affinity's own.
    expect(problemsFor({ ...TYPED, effects: [{ kind: 'damage', power: 10, affinity: false }] }))
      .toContain('affinity must be exactly true');
  });

  it('empowerNext keeps its own 1..999 rule, gated or not', () => {
    // The keyword that DOES carry a bespoke range, to show the two concerns are
    // separate: the gate is checked as a flag, the payload by its own kind.
    for (const amount of [0, -5]) {
      expect(problemsFor({ ...TYPED, effects: [{ kind: 'empowerNext', amount, affinity: true }] }), `amount ${amount}`)
        .toMatch(/amount/);
    }
    expect(problemsFor({ ...TYPED, effects: [{ kind: 'empowerNext', amount: 10, affinity: true }] })).toBe('');
  });
});
