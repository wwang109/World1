import { describe, expect, it } from 'vitest';
import { simulate } from '../../src/engine/combat/simulate';
import { skillBook } from '../../src/data/skills';
import { PRICE, powerLevelDeci, powerLevelBreakdown, capViolations, HIT_KINDS, PREMIUM_HIT_KINDS, TIER_BUDGET_DECI } from '../../src/engine/balance';
import { IDENTITY_THRESHOLD } from '../../src/engine/combat/typeIdentity';
import { applyTier, autoScaleTier } from '../../src/engine/cards';
import { validateSkillDocument } from '../../src/data/validateSkillContent';
import type { CombatConfig, SkillDef, SkillTier } from '../../src/engine/types';
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
 * stat term at all: every ordinary `damage` action adds the caster's stat share,
 * and the only other flat hit in the game is gem-appended (no gems here).
 */
function flatHitsOf(landed: Landed): DamageCalculation[] {
  return landed.calcs.filter((c) => c.baseStat === 0 && c.effectiveStat === 0);
}
/** The affinity hit's printed power, read from the card rather than hardcoded. */
function affinityPower(card: SkillDef): number {
  const action = card.effects.find((a) => a.kind === 'affinityStrike');
  if (!action || action.kind !== 'affinityStrike') throw new Error(`${card.id} carries no affinityStrike`);
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
    const short = heroHits(['sworn_edge', 'sword_slash']);
    expect(short.hits.length, 'the probe must land hits').toBeGreaterThan(1);
    // Every landed hit is one of the two cards' OWN damage, so every hit carries
    // a stat term. A single flat hit here would BE the ungated affinity strike.
    expect(flatHitsOf(short), 'the extra hit must not exist below the threshold').toEqual([]);
  });

  it('fires AT the threshold, and the whole difference is the printed number', () => {
    // The SAME two cards plus one more sword: three swords, no tie, gate open.
    // `void_pierce` is a third sword; it is the only board change.
    const closed = heroHits(['sworn_edge', 'sword_slash']);
    const open = heroHits(['sworn_edge', 'sword_slash', 'void_pierce']);
    // The added card casts too, so totals are not comparable — what IS comparable
    // is whether the flat extra hit exists at all, and that it lands for exactly
    // the number the face prints.
    expect(flatHitsOf(closed)).toEqual([]);
    const fired = flatHitsOf(open);
    expect(fired.length, 'the gate must open at the threshold').toBeGreaterThan(0);
    // Asserted on `baseDamage`, the hit's own contribution, NOT on `hpDamage`:
    // these probes run long enough to reach the sudden-death ramp, which scales
    // EVERY hit in the fight and would make a final-HP assertion flap by turn.
    for (const c of fired) expect(c.baseDamage).toBe(affinityPower(SWORN));
  });

  it('a TIE at the top of the tally opens no gate', () => {
    // 3 swords vs 3 axes: `boardTypeIdentity` requires a UNIQUE top type, so a
    // tie yields no identity, no affinity, and no extra hit. This is the rule a
    // player is most likely to trip over by accident while "going wide".
    const tied = heroHits(['sworn_edge', 'sword_slash', 'void_pierce', 'hemorrhage', 'rupturing_strike', 'mortal_wound']);
    expect(tied.hits.length, 'the probe must land hits').toBeGreaterThan(1);
    expect(flatHitsOf(tied), 'a tie yields no identity, so no affinity hit').toEqual([]);
  });

  it('the WRONG type at the threshold opens no gate', () => {
    // Three axes is an identity — just not this card's. A gate keyed to "any
    // identity at all" rather than to the card's own type would pass here.
    const wrongType = heroHits(['sworn_edge', 'hemorrhage', 'rupturing_strike', 'mortal_wound']);
    expect(flatHitsOf(wrongType), 'an AXE identity must not fire a SWORD card\u2019s payoff').toEqual([]);
  });
});

describe('opening the gate ADDS a hit — it never redistributes one', () => {
  it("the card's own hit is the same size on-type and off-type", () => {
    // THE REGRESSION THIS EXISTS FOR: if `affinityStrike` ever entered the
    // multi-hit divisor, an on-type board would split its stat across two hits
    // and the base hit would SHRINK while appearing to gain a second one — a
    // strict downgrade that reads as an upgrade.
    const closed = heroHits(['sworn_edge', 'sword_slash']);
    const open = heroHits(['sworn_edge', 'sword_slash', 'void_pierce']);
    // Attack 12 + base 26 = 38, with zero foe defense, on both boards.
    const expectedBase = basePower(SWORN) + 12;
    expect(closed.hits, 'off-type: the base hit lands at full size').toContain(expectedBase);
    expect(open.hits, 'on-type: the SAME base hit, undiminished').toContain(expectedBase);
  });

  it('the extra hit is FLAT — it takes no share of the caster stat', () => {
    // Priced as flat power, so it must land as flat power. Asserted on the hit's
    // own DERIVATION rather than on its total: several cards on this board
    // legitimately land the same NUMBER (void_pierce's 20 + 12 is 32, and so is
    // sword_slash's), so matching on totals proves nothing. The affinity hit is
    // identified by `power`, and what matters is that its stat terms are ZERO —
    // if it ever picked up the caster's attack it would be worth far more than
    // the 4-deci-per-point rate charges for.
    const open = heroHits(['sworn_edge', 'sword_slash', 'void_pierce']);
    const mine = flatHitsOf(open);
    expect(mine.length, 'the affinity hit must appear in the log').toBeGreaterThan(0);
    for (const c of mine) {
      // Its base IS its printed power, and nothing was added on top of it.
      expect(c.power, 'the flat hit is the affinity hit').toBe(affinityPower(SWORN));
      expect(c.baseDamage).toBe(affinityPower(SWORN));
      expect(c.effectBonusDamage, 'affinity hit takes no aura/gem/rider bonus').toBe(0);
      // Against 0 defense the only thing that may still move it is the global
      // sudden-death ramp, which applies to every hit in a long fight alike.
      expect(c.hpDamage, 'lands for its printed power, plus only the global ramp')
        .toBe(affinityPower(SWORN) + c.suddenDeathBonusDamage);
    }
  });
});

describe('pricing', () => {
  it('the discount is 4/5 of the strike rate, strictly below the conditional ½', () => {
    expect(PRICE.affinityPayoffNum).toBe(4);
    expect(PRICE.affinityPayoffDen).toBe(5);
    // The ordering that carries the whole argument: this gate never closes once
    // met, so it must be discounted LESS than a gate that is only sometimes open.
    const affinityDiscount = 1 - PRICE.affinityPayoffNum / PRICE.affinityPayoffDen;
    const conditionalDiscount = 1 - 1 / PRICE.conditionalBonusDen;
    expect(affinityDiscount).toBeLessThan(conditionalDiscount);
    // And it must be a real discount, or nothing would ever run the card.
    expect(affinityDiscount).toBeGreaterThan(0);
  });

  it('the derivation matches the constants it claims to come from', () => {
    // The doc comment derives the fifth from "IDENTITY_THRESHOLD - 1 slots
    // dictated out of HERO_BOARD_SLOTS". Pinned here so the prose and the number
    // cannot drift apart silently — if either constant moves, this fails and the
    // derivation has to be rewritten or the rate re-solved.
    const HERO_BOARD_SLOTS = 10;
    const dictated = IDENTITY_THRESHOLD - 1;
    expect(1 - PRICE.affinityPayoffNum / PRICE.affinityPayoffDen).toBeCloseTo(dictated / HERO_BOARD_SLOTS, 10);
  });

  it('every shipped affinity card is exactly on budget and within caps', () => {
    const cards = Object.values(skillBook).filter((c) => c.effects.some((a) => a.kind === 'affinityStrike'));
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
    expect(PREMIUM_HIT_KINDS.has('affinityStrike')).toBe(false);
    expect(HIT_KINDS.has('affinityStrike'), 'still a HIT for the damage cap and the ledger').toBe(true);
    // And the exemption is worth exactly one premium, no more: a card carrying a
    // damage line plus a gated hit prices as a SINGLE-instance card.
    const probe: SkillDef = {
      id: 'premium_probe', name: 'Premium Probe',
      archetypes: ['offense'], property: 'physical', weapon: 'sword',
      size: 2, rarity: 'common', tier: 'bronze',
      effects: [{ kind: 'damage', power: 32 }, { kind: 'affinityStrike', power: 20 }],
      text: '',
    };
    const parts = powerLevelBreakdown(probe);
    expect(parts.find((x) => x.label === 'multi-hit'), 'no multi-hit part at all').toBeUndefined();
    // Two PLAIN damage lines still pay it — the exemption is scoped to the gate.
    const plainTwo = powerLevelBreakdown({ ...probe, effects: [{ kind: 'damage', power: 16 }, { kind: 'damage', power: 16 }] });
    expect(plainTwo.find((x) => x.label === 'multi-hit')?.deci).toBe(PRICE.extraHitPremium);
  });

  it('the affinity power is a multiple of 5, so its part is a whole PL', () => {
    // At 4 deci per point only multiples of 5 land on a whole power level, which
    // the project-wide "every priced part is a whole PL" audit requires. Stated
    // here so an author sees the constraint at the keyword rather than as a
    // failure in a distant suite.
    for (const card of Object.values(skillBook)) {
      for (const action of card.effects) {
        if (action.kind !== 'affinityStrike') continue;
        expect(action.power % 5, `${card.id}: affinityStrike power ${action.power} is not a multiple of 5`).toBe(0);
      }
    }
  });
});

describe('DIAMOND CAPSTONES — an affinity payload authored only at the top tier', () => {
  /** Every (card, tier) pair whose AUTHORED override adds an affinity payload. */
  const capstones = Object.values(skillBook).flatMap((card) =>
    Object.keys(card.tierUpgrades ?? {})
      .map((tier) => ({ card, tier: tier as SkillTier, skill: applyTier(card, tier as SkillTier) }))
      .filter(({ skill }) => skill.effects.some((a) => a.kind === 'affinityStrike')));

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
      expect(card.effects.some((a) => a.kind === 'affinityStrike'), `${card.id} bronze`).toBe(false);
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
      const aff = skill.effects.find((a) => a.kind === 'affinityStrike');
      const dmg = skill.effects.find((a) => a.kind === 'damage');
      const affPower = aff && aff.kind === 'affinityStrike' ? aff.power : -1;
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
      const autoDmg = auto.effects.find((a) => a.kind === 'damage');
      const capDmg = skill.effects.find((a) => a.kind === 'damage');
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
    effects: [{ kind: 'damage', power: 10 }, { kind: 'affinityStrike', power: 5 }],
  };

  it('a typeless card carrying an affinityStrike is REFUSED', () => {
    // TRUE property with neither element nor weapon: nothing for the gate to key
    // off, so the payload could never fire on any board in the game.
    const { weapon: _drop, ...typeless } = TYPED;
    const messages = problemsFor({ ...typeless, property: 'true', text: 'Deal 10 damage \u00b7 hit again for 5.' });
    expect(messages).toContain('affinityStrike needs the card to HAVE a type');
  });

  it('a typed card carrying one raises no affinity complaint', () => {
    // The control for the test above: the rule must reject the typeless case
    // ONLY, not the keyword itself.
    expect(problemsFor(TYPED)).not.toContain('affinityStrike');
  });

  it('a power of 0 is refused — a hit that deals nothing', () => {
    const messages = problemsFor({ ...TYPED, effects: [{ kind: 'damage', power: 10 }, { kind: 'affinityStrike', power: 0 }] });
    expect(messages).toMatch(/power/);
  });

  it('a NEGATIVE power is refused — it would heal the target and refund budget', () => {
    const messages = problemsFor({ ...TYPED, effects: [{ kind: 'damage', power: 10 }, { kind: 'affinityStrike', power: -5 }] });
    expect(messages).toMatch(/power/);
  });
});
