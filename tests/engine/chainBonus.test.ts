import { describe, expect, it } from 'vitest';
import { simulate } from '../../src/engine/combat/simulate';
import { capViolations, KEYWORD_PRICING, PRICE, powerLevelBreakdown, powerLevelDeci, riderFeedsKind, riderReadsResource, selfSynergyPremiumDeci, TIER_BUDGET_DECI } from '../../src/engine/balance';
import { autoScaleTier } from '../../src/engine/cards';
import { validateSkillDocument } from '../../src/data/validateSkillContent';
import { skillBook } from '../../src/data/skills';
import { cardType } from '../../src/engine/combat/typeIdentity';
import type { CombatConfig, SkillBook, SkillDef } from '../../src/engine/types';
import type { CombatEvent as Ev } from '../../src/engine/combat/events';
import { cfg, tc, NO_ENDGAME } from '../helpers';

/**
 * CHAIN BONUS — `comboBonus` on the TYPE axis (user request, 2026-08-21: "if
 * previous card is sword card and this card is an axe card deal even more damage
 * for combos", generalised by the same user to magic — "it could be magic too
 * like if previous was fire magic or water").
 *
 * ONE KEYWORD COVERS BOTH AXES because the game already has exactly one notion of
 * a card's type: `cardType` = `element ?? weapon` (combat/typeIdentity.ts, the
 * same derivation deck affinity uses). So `after: 'sword'` and `after: 'fire'`
 * are the same rule reading the same field.
 *
 * What this suite pins: the GATE (matches / cold start / wrong type), both axes
 * end-to-end through `simulate`, the PRICE (the shared conditional-trigger
 * discount, no new rate), the one-bonus-per-cast spend it inherits from
 * `comboBonus`, and the three authoring refusals.
 */

const card = (id: string, over: Partial<SkillDef> = {}): SkillDef => ({
  id,
  name: id,
  archetypes: ['offense'],
  property: 'physical',
  weapon: 'axe',
  size: 1,
  speedWeight: 10,
  rarity: 'common',
  tier: 'bronze',
  effects: [{ kind: 'damage', power: 0 }],
  text: '',
  ...over,
});

const BOOK: SkillBook = {
  // A plain SWORD opener and a plain FIRE opener — the two partner types under
  // test — plus a LANCE opener that must never open either gate.
  swordOpen: card('swordOpen', { weapon: 'sword' }),
  lanceOpen: card('lanceOpen', { weapon: 'lance' }),
  fireOpen: card('fireOpen', { property: 'magical', weapon: undefined, element: 'fire' }),
  // The chain payloads: an axe card after a sword, a frost card after a fire.
  axeChain: card('axeChain', {
    effects: [{ kind: 'chainBonus', after: 'sword', amount: 8 }, { kind: 'damage', power: 10 }],
  }),
  frostChain: card('frostChain', {
    property: 'magical', weapon: undefined, element: 'frost',
    effects: [{ kind: 'chainBonus', after: 'fire', amount: 8 }, { kind: 'damage', power: 10 }],
  }),
};

/** Hero board = `heroCards` in order (slots laid out by size); one slow foe. */
function fight(heroCards: string[], turns = 6): CombatConfig {
  let next = 0;
  const pieces = heroCards.map((skillId) => {
    const slot = next;
    next += BOOK[skillId]!.size;
    return { skillId, slot };
  });
  return {
    ...cfg(
      tc('hero', [], { attack: 6, speed: 20, maxHp: 900 }, { pieces, boardSize: 8, skillBook: BOOK }),
      tc('foe', ['swordOpen'], { attack: 1, speed: 3, maxHp: 900 }, { skillBook: BOOK }),
      { ...NO_ENDGAME, maxTurns: turns },
    ),
    skillBook: BOOK,
  };
}

/** The bonus each of the hero's skill hits actually collected, in order. */
function bonuses(config: CombatConfig): number[] {
  return simulate(config, 5).events
    .filter((e): e is Extract<Ev, { kind: 'damage' }> => e.kind === 'damage' && e.side === 'enemy' && e.source === 'skill')
    .map((e) => (e as { calculation?: { effectBonusDamage: number } }).calculation?.effectBonusDamage ?? 0);
}

describe('the chain gate: the PREVIOUS cast decides it', () => {
  it('WEAPON AXIS — a sword ahead of the axe pays the bonus', () => {
    // The first hit is the sword itself (no bonus of its own); the axe that
    // follows finds `lastCastType === 'sword'` and collects.
    const got = bonuses(fight(['swordOpen', 'axeChain']));
    expect(got.length).toBeGreaterThanOrEqual(2);
    expect(got[0]).toBe(0);
    expect(got[1]).toBe(8);
  });

  it('ELEMENT AXIS — a fire cast ahead of the frost card pays the SAME way', () => {
    // The whole point of one keyword over two: nothing about this case differs
    // from the weapon case except which name the card wrote.
    const got = bonuses(fight(['fireOpen', 'frostChain']));
    expect(got[0]).toBe(0);
    expect(got[1]).toBe(8);
  });

  it('THE WRONG TYPE NEVER OPENS IT — a lance, or a fire, ahead of the sword-gated axe', () => {
    expect(bonuses(fight(['lanceOpen', 'axeChain']))).toEqual(expect.arrayContaining([0]));
    expect(bonuses(fight(['lanceOpen', 'axeChain'])).every((b) => b === 0)).toBe(true);
    // A magical fire card is a `fire` TYPE, not a `sword` one — the axe stays cold.
    expect(bonuses(fight(['fireOpen', 'axeChain'])).every((b) => b === 0)).toBe(true);
    // ...and symmetrically a sword does nothing for the fire-gated frost card.
    expect(bonuses(fight(['swordOpen', 'frostChain'])).every((b) => b === 0)).toBe(true);
  });

  it('THE COLD START: the first cast of a fight has no previous cast, so it never pays', () => {
    // Alone on the board the axe is also its own predecessor from cast 2 —
    // and an axe is not a sword, so it never opens its own gate either.
    expect(bonuses(fight(['axeChain'])).every((b) => b === 0)).toBe(true);
  });

  it('the gate reads the SAME type notion deck affinity does (`cardType` = element ?? weapon)', () => {
    // The pin that keeps the keyword and the type system from drifting apart.
    expect(cardType(BOOK.swordOpen!)).toEqual({ kind: 'weapon', type: 'sword' });
    expect(cardType(BOOK.fireOpen!)).toEqual({ kind: 'element', type: 'fire' });
  });
});

describe('chain pricing: the shared conditional discount, no new rate', () => {
  it('prices `amount` at strikeRate over conditionalBonusDen — the SAME denominator the rider family uses', () => {
    const term = KEYWORD_PRICING.chainBonus.price[0]!;
    expect(term.form).toBe('perUnitByProperty');
    if (term.form !== 'perUnitByProperty') return;
    expect(term.den).toBe(PRICE.conditionalBonusDen);
    expect(term.num.physical).toBe(PRICE.flatPowerPerPoint);
    // On a typed card that reproduces comboBonus's own user-locked 2.5 deci/pt.
    expect(term.num.physical / term.den).toBe(PRICE.comboPerPointNum / PRICE.comboPerPointDen);
    // 8 x 5/2 = 20 deci; the damage line is priced separately as usual.
    expect(powerLevelDeci(card('x', { effects: [{ kind: 'chainBonus', after: 'sword', amount: 8 }] }))).toBe(20);
    expect(powerLevelDeci(card('x', { effects: [{ kind: 'chainBonus', after: 'sword', amount: 16 }] }))).toBe(40);
  });

  it('is EMPOWER family and NOT offensive — mirroring comboBonus, its closest sibling', () => {
    expect(KEYWORD_PRICING.chainBonus.family).toBe('empower');
    expect(KEYWORD_PRICING.chainBonus.family).toBe(KEYWORD_PRICING.comboBonus.family);
    expect(KEYWORD_PRICING.chainBonus.offensive).toBe(false);
    expect(KEYWORD_PRICING.chainBonus.offensive).toBe(KEYWORD_PRICING.comboBonus.offensive);
    expect(KEYWORD_PRICING.chainBonus.isHit).toBe(false);
  });

  it('counts against the EMPOWER cap like every other conditional rider', () => {
    // 41 x 5/2 = 102 deci > the size-1 empower ceiling (100); 40 is legal.
    expect(capViolations(card('x', { effects: [{ kind: 'chainBonus', after: 'sword', amount: 40 }] }))).toEqual([]);
    expect(capViolations(card('x', { effects: [{ kind: 'chainBonus', after: 'sword', amount: 41 }] })).join(' '))
      .toContain('empower');
  });

  it('CAN NEVER OWE THE SELF-SYNERGY PREMIUM: no action supplies a cast history', () => {
    // `lastCastType` joins 'lowHp'/'overheal'/'cleansed' — resources no keyword
    // can manufacture — so the premium is 0 by construction, not by exception.
    const rider = { kind: 'chainBonus', after: 'sword', amount: 8 } as const;
    expect(riderReadsResource(rider)).toEqual({ resource: 'lastCastType', on: 'caster', magnitude: 8 });
    expect(riderFeedsKind(rider)).toBe('damage');
    const kit = [rider, { kind: 'damage', power: 10 }, { kind: 'poison', stacks: 3 }] as const;
    expect(selfSynergyPremiumDeci(rider, kit, 'physical')).toBe(0);
  });
});

describe('the authoring rules', () => {
  const doc = (def: Record<string, unknown>) => ({
    schemaVersion: 1,
    cards: [{
      id: 'chain_probe',
      versions: [{
        version: 1,
        def: {
          name: 'Chain Probe', text: 'Deal 10 damage.',
          archetypes: ['offense'], property: 'physical', weapon: 'axe',
          size: 1, rarity: 'common', tier: 'bronze',
          ...def,
        },
      }],
    }],
  });
  const problemsOf = (def: Record<string, unknown>): string =>
    validateSkillDocument(doc(def)).map((p) => p.message).join('\n');

  const chain = (after: string, amount = 8) => ({ kind: 'chainBonus', after, amount });

  it('ACCEPTS a cross-type pairing, on either axis', () => {
    expect(problemsOf({
      text: 'Chain +8 after a Sword · deal 10 damage.',
      effects: [chain('sword'), { kind: 'damage', power: 10 }],
    })).toBe('');
    expect(problemsOf({
      property: 'magical', weapon: undefined, element: 'frost',
      text: 'Chain +8 after a Fire card · deal 10 damage.',
      effects: [chain('fire'), { kind: 'damage', power: 10 }],
    })).toBe('');
  });

  it('REFUSES a card that names its OWN type — that gate is self-fed from cast 2', () => {
    expect(problemsOf({ effects: [chain('axe'), { kind: 'damage', power: 10 }] }))
      .toContain('cannot name its own card type (axe)');
    // Same rule on the element axis.
    expect(problemsOf({
      property: 'magical', weapon: undefined, element: 'frost',
      effects: [chain('frost'), { kind: 'damage', power: 10 }],
    })).toContain('cannot name its own card type (frost)');
  });

  it('REFUSES a type that does not exist — an unopenable gate is a priced no-op', () => {
    expect(problemsOf({ effects: [chain('wand'), { kind: 'damage', power: 10 }] }))
      .toContain('after must be one card type');
  });

  it('REFUSES the rider placed AFTER the damage it feeds (the ordering rule)', () => {
    expect(problemsOf({ effects: [{ kind: 'damage', power: 10 }, chain('sword')] }))
      .toContain('must be placed BEFORE a damage action');
  });

  it('checks the self-gate at EVERY TIER, not just the base card', () => {
    expect(problemsOf({
      text: 'Chain +8 after a Sword · deal 10 damage.',
      effects: [chain('sword'), { kind: 'damage', power: 10 }],
      tierUpgrades: { silver: { effects: [chain('axe'), { kind: 'damage', power: 14 }] } },
    })).toContain('cannot name its own card type (axe)');
  });
});

describe('the shipped chain cards', () => {
  it('both land EXACTLY on every tier budget, with whole-PL parts and no cap violations', () => {
    for (const id of ['finishing_cleave', 'thermal_shock']) {
      const base = skillBook[id]!;
      expect(base.tier, id).toBe('bronze');
      for (const part of powerLevelBreakdown(base)) {
        expect(Math.abs(part.deci % 10), `${id}: ${part.label} must be a whole PL`).toBe(0);
      }
      for (const tier of ['bronze', 'silver', 'gold', 'diamond'] as const) {
        const scaled = autoScaleTier(base, tier);
        expect(powerLevelDeci(scaled), `${id} @ ${tier}`).toBe(TIER_BUDGET_DECI[tier]);
        expect(capViolations(scaled), `${id} @ ${tier}`).toEqual([]);
      }
    }
  });

  it('cover BOTH axes and neither names its own type', () => {
    const cleave = skillBook.finishing_cleave!;
    const shock = skillBook.thermal_shock!;
    expect(cardType(cleave)).toEqual({ kind: 'weapon', type: 'axe' });
    expect(cardType(shock)).toEqual({ kind: 'element', type: 'frost' });
    const riderOf = (s: SkillDef) => s.effects.find((a) => a.kind === 'chainBonus');
    const a = riderOf(cleave);
    const b = riderOf(shock);
    expect(a && a.kind === 'chainBonus' ? a.after : null).toBe('sword');
    expect(b && b.kind === 'chainBonus' ? b.after : null).toBe('fire');
    // The rider precedes the damage it feeds on both.
    for (const s of [cleave, shock]) {
      expect(s.effects.findIndex((x) => x.kind === 'chainBonus'))
        .toBeLessThan(s.effects.findIndex((x) => x.kind === 'damage'));
    }
  });
});
