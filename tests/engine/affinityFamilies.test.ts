import { describe, expect, it } from 'vitest';
import { simulate } from '../../src/engine/combat/simulate';
import { skillBook } from '../../src/data/skills';
import { boardTypeIdentity, cardType, IDENTITY_THRESHOLD } from '../../src/engine/combat/typeIdentity';
import { HERO_BOARD_SLOTS } from '../../src/data/heroes';
import type { Action, SkillDef } from '../../src/engine/types';
import { cfg, tc, NO_ENDGAME } from '../helpers';

/**
 * THE SHIPPED GATED FAMILIES, driven in real combat.
 *
 * The point of expressing affinity as a MODIFIER rather than a family of
 * keywords is that one gate check covers every keyword in the game. That claim
 * is proved in `affinity.test.ts` — but only on a SYNTHETIC probe card assembled
 * inside the test file. The three cards the catalog actually ships to make the
 * claim in front of a player — `wildfire_rite` (gated DoT), `hallowed_toll`
 * (gated control), `grove_communion` (gated heal) — had no behavioural test at
 * all: nothing ran them through `simulate`, on-type or off.
 *
 * A synthetic probe cannot catch a content defect. A shipped card whose gated
 * line was authored with the flag dropped, or attached to an action the
 * interpreter routes before the gate, would be a free unconditional effect
 * priced as a conditional one, and every existing test would stay green.
 *
 * SHAPE: two boards per card, differing ONLY in the two partner cards, and the
 * partners are chosen so the card under test is the ONLY source of the effect
 * being counted. Each assertion also proves the card CAST on both boards, so an
 * absent effect can never be "it never played".
 */

interface Seen {
  casts: number;
  statuses: string[];
  heals: number;
}

/** Hero runs `heroBoard` against a passive dummy; `heroHp` below max so a heal shows. */
function play(heroBoard: readonly string[], card: string, heroHp = 200): Seen {
  const hero = tc('Hero', [...heroBoard], { maxHp: 900, hp: heroHp, speed: 30 }, { boardSize: HERO_BOARD_SLOTS });
  const foe = tc('Foe', ['sword_slash'], { maxHp: 40000, hp: 40000, attack: 1, magicPower: 1, speed: 6 });
  // Long enough for every board here to complete several rotations: a size-2
  // card busies its caster after firing, so a three-card board of them needs
  // considerably more turns than the number of cards on it.
  const config = cfg(hero, foe, { ...NO_ENDGAME, maxTurns: 40 });
  let casts = 0;
  let heals = 0;
  const statuses: string[] = [];
  for (const e of simulate(config, 5).events) {
    if (e.kind === 'play' && e.side === 'player' && e.skillId === card) casts += 1;
    if (e.kind === 'statusApplied' && e.side === 'enemy') statuses.push((e as never as { status: string }).status);
    if (e.kind === 'heal' && e.side === 'player') heals += e.amount;
  }
  return { casts, statuses, heals };
}

/**
 * One row per shipped gated family. `on`/`off` differ only in the partners; the
 * partners never produce the counted effect themselves (checked below).
 */
const CASES = [
  {
    card: 'wildfire_rite', family: 'DoT', type: 'element:fire',
    on: ['wildfire_rite', 'kindling_rite', 'cinder_skin'],   // 3 Fire, neither partner burns
    off: ['wildfire_rite', 'sword_slash', 'twin_slash'],     // 1 Fire, 2 Sword -> no identity
    count: (s: Seen) => s.statuses.filter((x) => x === 'burn').length,
    what: 'burn',
  },
  {
    card: 'hallowed_toll', family: 'control', type: 'element:holy',
    on: ['hallowed_toll', 'purging_strike', 'judgment_light'], // 3 Holy, neither partner stuns
    off: ['hallowed_toll', 'sword_slash', 'twin_slash'],
    count: (s: Seen) => s.statuses.filter((x) => x === 'stun').length,
    what: 'stun',
  },
  {
    card: 'grove_communion', family: 'heal', type: 'element:nature',
    on: ['grove_communion', 'thorn_bite', 'blooming_vine'],   // 3 Nature, neither partner heals
    off: ['grove_communion', 'sword_slash', 'twin_slash'],
    count: (s: Seen) => s.heals,
    what: 'healing',
  },
] as const;

const isGated = (a: Action): boolean => a.affinity === true;
const typeKey = (s: SkillDef): string => {
  const t = cardType(s);
  return t ? `${t.kind}:${t.type}` : 'none';
};

describe('the shipped gated cards, one per family', () => {
  it('all three exist, carry a gated line, and cover three DIFFERENT keyword families', () => {
    const families = new Set<string>();
    for (const c of CASES) {
      const card = skillBook[c.card];
      expect(card, `${c.card} missing from the catalog`).toBeDefined();
      const gated = card!.effects.filter(isGated);
      expect(gated.length, `${c.card} carries no gated action`).toBeGreaterThan(0);
      expect(typeKey(card!), `${c.card} changed type`).toBe(c.type);
      for (const a of gated) families.add(a.kind);
    }
    // If two of these ever collapse onto the same keyword the suite stops
    // proving "affinity composes across families" and quietly becomes one test.
    expect(families.size, `gated kinds covered: ${[...families].join(', ')}`).toBe(CASES.length);
  });

  for (const c of CASES) {
    it(`${c.card} (${c.family}): its ${c.what} lands on-type and does not exist off-type`, () => {
      const on = play(c.on, c.card);
      const off = play(c.off, c.card);

      // The two boards must genuinely differ in identity, or the comparison is
      // between two identical situations.
      expect(boardTypeIdentity(c.on.map((id) => skillBook[id]!)), `${c.card}: on-type board must take its own identity`)
        .toEqual(cardType(skillBook[c.card]!));
      expect(boardTypeIdentity(c.off.map((id) => skillBook[id]!)), `${c.card}: off-type board must have NO identity`)
        .toBeUndefined();

      // NON-VACUITY: the card cast on both boards, so "no effect" means the gate
      // was shut, not that the card sat idle.
      expect(on.casts, `${c.card} never cast on the on-type board`).toBeGreaterThan(0);
      expect(off.casts, `${c.card} never cast on the off-type board`).toBeGreaterThan(0);

      expect(c.count(on), `${c.card} on-type: the gated ${c.what} must happen`).toBeGreaterThan(0);
      expect(c.count(off), `${c.card} off-type: the gated ${c.what} must not happen at all`).toBe(0);
    });

    it(`${c.card}: the PARTNERS produce no ${c.what} of their own — the count is the card's`, () => {
      // Without this, an on-type board whose partner happens to burn/stun/heal
      // would read as a passing gate no matter what the card under test did.
      const partnersOnly = c.on.filter((id) => id !== c.card);
      const seen = play(partnersOnly, c.card);
      expect(seen.casts, 'the card under test must be absent from this control board').toBe(0);
      expect(c.count(seen), `a partner of ${c.card} produces ${c.what} on its own`).toBe(0);
    });
  }
});

describe('the board a gated card asks for is one a 10-slot board can hold', () => {
  it('a size-N card counts ONCE toward the identity, so footprint and tally are different things', () => {
    // Every probe in `typeIdentity.test.ts` is size 1, so "a size-N card still
    // counts once" (the module's own doc) had no test with a real multi-slot
    // card in it. Three size-2 Fire cards are 6 slots and ONE identity, not
    // three types' worth of tally.
    const wide = ['wildfire_rite', 'kindred_flame', 'fireball'].map((id) => skillBook[id]!);
    expect(wide.every((s) => s.size > 1), 'the probe must use multi-slot cards').toBe(true);
    expect(wide.reduce((a, s) => a + s.size, 0), 'and they must really occupy more slots than cards').toBeGreaterThan(wide.length);
    expect(boardTypeIdentity(wide)).toEqual({ kind: 'element', type: 'fire' });
    // One short is still one short, however many slots it eats.
    expect(boardTypeIdentity(wide.slice(0, IDENTITY_THRESHOLD - 1))).toBeUndefined();
  });

  it('every gated card can reach its own threshold inside HERO_BOARD_SLOTS, with room to spare', () => {
    // The design ask is `IDENTITY_THRESHOLD` cards of one type on a
    // `HERO_BOARD_SLOTS` board. That is a claim about FOOTPRINT, and content
    // could break it without breaking any pricing rule — a type whose cheapest
    // three cards are all size-3 leaves one slot for the other seven picks, and
    // a type whose cheapest three summed past 10 would be flatly impossible.
    const gatedCards = Object.values(skillBook).filter((c) => c.effects.some(isGated));
    expect(gatedCards.length, 'no gated cards to audit').toBeGreaterThan(0);
    const tight: string[] = [];
    for (const card of gatedCards) {
      const sameType = Object.values(skillBook)
        .filter((s) => s.id !== card.id && typeKey(s) === typeKey(card))
        .map((s) => s.size)
        .sort((a, b) => a - b);
      expect(sameType.length, `${card.id}: fewer than ${IDENTITY_THRESHOLD} cards share its type`)
        .toBeGreaterThanOrEqual(IDENTITY_THRESHOLD - 1);
      const footprint = card.size + sameType.slice(0, IDENTITY_THRESHOLD - 1).reduce((a, b) => a + b, 0);
      // Strictly LESS than the whole board: an identity that consumed all ten
      // slots would be a board with no room for anything else, which is not a
      // build, it is a requirement.
      if (footprint >= HERO_BOARD_SLOTS) tight.push(`${card.id}: ${footprint}/${HERO_BOARD_SLOTS} slots`);
    }
    expect(tight, tight.join('\n')).toEqual([]);
  });
});
