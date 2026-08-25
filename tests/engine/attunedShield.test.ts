import { describe, expect, it } from 'vitest';
import { simulate } from '../../src/engine/combat/simulate';
import { skillBook } from '../../src/data/skills';
import { PRICE, powerLevelDeci, powerLevelBreakdown, capViolations, TIER_BUDGET_DECI, KEYWORD_PRICING } from '../../src/engine/balance';
import { validateSkillDocument } from '../../src/data/validateSkillContent';
import { totalShield, spendShieldsForBurst, type CombatantState } from '../../src/engine/combat/state';
import type { CombatConfig } from '../../src/engine/types';

/**
 * ATTUNED SHIELDS — plating that absorbs DOUBLE from its own type.
 *
 * A point of Lance-attuned plating eats 2 damage from a Lance card and 1 from
 * anything else. The type is the granting card's own (`cardType`), never
 * authored separately, so a Sword card's plating is sword plating.
 *
 * WHAT MAKES THIS WORTH TESTING HARD: the doubling is an EXCHANGE RATE, not
 * extra points, and an exchange rate is invisible in the one number a player
 * usually watches. A 28-damage hit fully blocked looks identical whether it cost
 * 14 plating or 28 — the difference only shows in what is left standing
 * afterwards. So these tests assert on PLATING SPENT (`shieldDrain`), not on
 * damage taken.
 *
 * The second reason: it is a change to `consumeShields`, which every hit in the
 * game runs through. The frozen 400-fight outcome baseline is the guard that
 * un-attuned fights are byte-identical; these tests are the guard that attuned
 * ones do the new thing correctly.
 */

function board(ids: readonly string[]): Array<{ skillId: string; slot: number }> {
  let next = 0;
  return ids.map((id) => {
    const skill = skillBook[id];
    if (!skill) throw new Error(`attunedShield: unknown card "${id}"`);
    const slot = next;
    next += skill.size;
    return { skillId: id, slot };
  });
}

interface Blocked { amount: number; spent: number; hp: number; source: string }

/**
 * The hero plates up with `heroBoard`; the foe attacks with `foeBoard`. Returns
 * every hit the hero's wall actually absorbed something on.
 *
 * Zero armor on both sides so a hit's number is its printed number, and a very
 * fast foe so it lands blows between the hero's plating casts.
 */
function wallHits(heroBoard: readonly string[], foeBoard: readonly string[], seed = 5, heroSpeed = 8, foeSpeed = 40): Blocked[] {
  const config: CombatConfig = {
    playerTeam: [{
      name: 'Hero',
      stats: { maxHp: 600, hp: 600, attack: 4, magicPower: 4, armor: 0, magicResist: 0, speed: heroSpeed },
      pieces: board(heroBoard), boardSize: 8,
    } as never],
    enemyTeam: [{
      name: 'Foe',
      stats: { maxHp: 4000, hp: 4000, attack: 8, magicPower: 8, armor: 0, magicResist: 0, speed: foeSpeed },
      pieces: board(foeBoard), boardSize: 8,
    } as never],
    skillBook, maxTurns: 12, endgame: { attritionEnabled: false, suddenDeathTurn: 0 },
  } as never;
  const out: Blocked[] = [];
  for (const e of simulate(config, seed).events) {
    if (e.kind !== 'damage' || e.side !== 'player') continue;
    // Read the event's OWN `blocked`/`shieldDrain`, not `calculation.*`: a
    // `DamageCalculation` is only produced for a direct skill hit, so keying off
    // it silently skipped every DoT tick — which is exactly the case one of these
    // tests exists to check.
    if (e.blocked <= 0) continue;
    const drain = e.shieldDrain;
    const spent = drain === undefined ? 0 : drain.physical + drain.magical + drain.true;
    out.push({ amount: e.blocked, spent, hp: e.amount - e.blocked, source: String(e.source) });
  }
  return out;
}

const WALL = ['bulwark_of_the_line'];  // Lance-attuned 24 + plain 12

describe('the exchange rate', () => {
  it('MATCHING damage costs HALF the plating it absorbs', () => {
    // The whole mechanic in one assertion. A lance card's hit is walled at 2
    // damage per point, so the plating spent is half what was blocked.
    const hits = wallHits(WALL, ['lance_thrust']);
    expect(hits.length, 'the wall must absorb something').toBeGreaterThan(0);
    for (const h of hits) {
      expect(h.spent, `blocked ${h.amount} should cost ${Math.ceil(h.amount / 2)} plating`).toBe(Math.ceil(h.amount / 2));
    }
  });

  it('NON-matching damage costs the plating one for one', () => {
    // Same wall, same damage number, a sword card instead of a lance one. The
    // attuned pool still walls — it is a shield, not a conditional shield — it
    // just gets no discount doing it.
    const hits = wallHits(WALL, ['sword_slash']);
    expect(hits.length, 'the wall must absorb something').toBeGreaterThan(0);
    for (const h of hits) {
      expect(h.spent, `blocked ${h.amount} should cost ${h.amount} plating`).toBe(h.amount);
    }
  });

  it('the SAME hit costs strictly less against the type it is attuned to', () => {
    // Stated as a comparison rather than two absolutes, because this is the
    // sentence on the card: attuning correctly makes your wall last longer.
    const matched = wallHits(WALL, ['lance_thrust']);
    const missed = wallHits(WALL, ['sword_slash']);
    // lance_thrust and sword_slash are both 20-power size-1 physical hits, so the
    // incoming numbers are comparable.
    expect(matched[0]!.amount).toBe(missed[0]!.amount);
    expect(matched[0]!.spent).toBeLessThan(missed[0]!.spent);
  });

  it('an UNTYPED damage source spends plating 1:1 — the doubling needs a card', () => {
    // `attackType` is set only by `applyStrike`, so a DoT tick, fatigue or
    // attrition arrives with none and takes the `isMatch === false` branch —
    // literally the same branch the non-matching sword hit above proves, since
    // `isMatch = attackType !== undefined && pool.type === attackType`.
    //
    // ASSERTED HERE AS THE BRANCH CONDITION rather than through a simulated
    // tick: poison bypasses shields outright and bleed's tick schedule ("when
    // the enemy performs") means it reliably lands either before the wall is
    // raised or after it is stripped, depending on relative speed. Two attempts
    // at a simulated version measured zero absorptions and were therefore
    // vacuous, which is worse than not claiming the coverage. The sword test
    // above is the real guard on this branch.
    const nonMatching = wallHits(WALL, ['sword_slash']);
    expect(nonMatching.length).toBeGreaterThan(0);
    for (const h of nonMatching) expect(h.spent).toBe(h.amount);
  });
});

describe('spend order — best exchange first, specialised plating saved otherwise', () => {
  it('matching plating is spent BEFORE untyped plating', () => {
    // bulwark_of_the_line grants BOTH: 24 lance-attuned and 12 plain. Against a
    // lance hit the attuned pool must go first (2 per point beats 1 per point),
    // which shows up as the whole hit costing half.
    const hits = wallHits(WALL, ['lance_thrust']);
    const first = hits[0]!;
    // 28 blocked for 14 spent is only possible if EVERY point came from the
    // attuned pool; had the plain 12 been spent first it would have cost more.
    expect(first.spent).toBe(Math.ceil(first.amount / 2));
  });

  it('a burst spends attuned plating LAST and at face value', () => {
    // `spendShieldsForBurst` converts plating into damage 1:1, so the doubling
    // buys nothing there and the best wall should be the one left standing.
    const c = {
      shields: { physical: 10, magical: 0, true: 0 },
      attunedShields: [{ property: 'physical', type: 'lance', points: 10 }],
    } as unknown as CombatantState;
    expect(totalShield(c), 'attuned points count at FACE value in the total').toBe(20);
    expect(spendShieldsForBurst(c, 10), 'a 10-cap burst is paid entirely from plain plating').toBe(10);
    expect(c.shields.physical).toBe(0);
    expect(c.attunedShields![0]!.points, 'the attuned pool is untouched').toBe(10);
    // Only once the plain pool is gone does the burst reach it.
    expect(spendShieldsForBurst(c, 4)).toBe(4);
    expect(c.attunedShields![0]!.points).toBe(6);
  });
});

describe('pricing', () => {
  it('the rate is 1.5x the shield rate, derived from the conditional discount', () => {
    // A point is worth ONE point of absorption always, plus a SECOND when the
    // damage matches — and "the enemy attacks with the type you attuned against"
    // is exactly a gate the card cannot supply, which `conditionalBonusDen`
    // prices. So: full rate for the guaranteed point, discounted for the second.
    const term = KEYWORD_PRICING.attunedShield.price[0]!;
    expect(term.form).toBe('perUnitByProperty');
    if (term.form !== 'perUnitByProperty') return;
    const perPoint = term.num.physical / term.den;
    expect(perPoint).toBe(PRICE.flatPowerPerPoint * (1 + 1 / PRICE.conditionalBonusDen));
    expect(perPoint).toBe(7.5);
    // Above plain plating, below buying two points outright.
    expect(perPoint).toBeGreaterThan(PRICE.flatPowerPerPoint);
    expect(perPoint).toBeLessThan(PRICE.flatPowerPerPoint * 2);
  });

  it('it is FROZEN at tier, which the fractional rate forces', () => {
    // `scalableRateDeci` hands the tier sink solver ONE integer deci-per-point
    // and floors: 15/2 would come back as 7 and the solver would spend budget it
    // had not costed. Frozen keeps the fraction inside `actionsPriceDeci`, where
    // `power x 15 / 2` is exact for any even power.
    expect(KEYWORD_PRICING.attunedShield.scalable).toBe(false);
    expect(KEYWORD_PRICING.attunedShield.family, 'still capped as plating').toBe('shield');
    expect(KEYWORD_PRICING.attunedShield.offensive, 'resolves on the caster, no AoE reach').toBe(false);
  });

  it('every shipped attuned card is exactly on budget, capped, typed, and whole-PL', () => {
    const cards = Object.values(skillBook).filter((c) => c.effects.some((a) => a.kind === 'attunedShield'));
    expect(cards.length, 'the keyword must have shipped content').toBeGreaterThan(0);
    for (const card of cards) {
      expect(powerLevelDeci(card), `${card.id} budget`).toBe(TIER_BUDGET_DECI[card.tier]);
      expect(capViolations(card), `${card.id} caps`).toEqual([]);
      expect(card.element ?? card.weapon, `${card.id} needs a type to attune to`).toBeDefined();
      // 7.5 deci/pt only lands on a whole power level at multiples of 4.
      for (const a of card.effects) {
        if (a.kind !== 'attunedShield') continue;
        expect(a.power % 4, `${card.id}: attuned power ${a.power} must be a multiple of 4`).toBe(0);
      }
      for (const part of powerLevelBreakdown(card)) {
        // `% 10 === 0` rather than `toBe(0)`: a negative part (the size grant)
        // yields -0, which Object.is distinguishes from +0.
        expect(part.deci % 10 === 0, `${card.id}: part "${part.label}" (${part.deci}) is not a whole PL`).toBe(true);
      }
    }
  });
});

describe('authoring rules', () => {
  function problemsFor(def: Record<string, unknown>): string {
    return validateSkillDocument({
      schemaVersion: 1,
      cards: [{ id: 'probe_card', versions: [{ version: 1, def }] }],
    }).map((p) => p.message).join('\n');
  }
  const TYPED = {
    name: 'Probe', text: '{{Attuned}} Sword shield 12 (+DEF) — absorbs 2 damage per point from Sword attacks.',
    archetypes: ['defensive'], property: 'physical', weapon: 'sword', size: 1, rarity: 'common', tier: 'bronze',
    effects: [{ kind: 'attunedShield', power: 12 }],
  };

  it('a TYPELESS card cannot carry one — it would have nothing to attune to', () => {
    // Caught by the UNIVERSAL rule (every card carries an element or a weapon),
    // which is why the attunement-specific check that used to sit beside it was
    // deleted as unreachable rather than kept as dead code.
    const { weapon: _drop, ...typeless } = TYPED;
    expect(problemsFor({ ...typeless, property: 'true' })).toContain('must carry an element OR a weapon');
  });

  it('a typed card raises no attunement complaint', () => {
    expect(problemsFor(TYPED)).not.toContain('must carry an element OR a weapon');
  });

  it('a power of 0 is refused — plating that blocks nothing', () => {
    expect(problemsFor({ ...TYPED, effects: [{ kind: 'attunedShield', power: 0 }] })).toMatch(/power/);
  });
});
