// COMBO BONUS IS ONE BONUS PER CAST.
//
// REGRESSION (2026-08-18): `cast.bonusFlat` was accumulated by the `comboBonus`
// arm and never cleared, while the `damage` arm read `mods.damageFlat +
// cast.bonusFlat` unconditionally — so EVERY own damage action of a multi-hit
// host collected the whole bonus again. `follow_through_echo` (a Rare gem
// printing "+16", priced at 16) delivered +32 on each of the book's three
// multi-damage cards, and any base card authoring `comboBonus` beside two
// damage actions would have done the same. The bonus is now SPENT by the first
// damage action that reads it (`readsComboBonus` in combat/interpreter.ts).
import { describe, expect, it } from 'vitest';
import { simulate } from '../../src/engine/combat/simulate';
import { skillBook } from '../../src/data/skills';
import { gemBook } from '../../src/data/gems';
import type { CombatConfig, CombatantSetup, Gem, SkillBook, SkillDef } from '../../src/engine/types';
import type { CombatEvent } from '../../src/engine/combat/events';

const comboGem = gemBook['follow_through_echo'] as Gem;

/** A comboBonus card that carries TWO damage actions of its own (the base-card twin of the gem case). */
const twinCombo: SkillDef = {
  id: 'twinCombo', name: 'Twin Combo', archetypes: ['offense'], property: 'physical', weapon: 'sword',
  size: 1, speedWeight: 10, rarity: 'common', tier: 'bronze', cooldownTurns: 0,
  effects: [
    { kind: 'comboBonus', amount: 16 },
    { kind: 'damage', power: 20 },
    { kind: 'damage', power: 20 },
  ],
  text: '',
};

/** The same card, fanned out over every foe — the bonus must reach EVERY target of its one action. */
const aoeCombo: SkillDef = {
  ...twinCombo,
  id: 'aoeCombo',
  name: 'AoE Combo',
  scope: 'all',
  effects: [
    { kind: 'comboBonus', amount: 16 },
    { kind: 'damage', power: 20 },
  ],
};

const book: SkillBook = { ...skillBook, twinCombo, aoeCombo };

function hero(pieces: Array<{ skillId: string; gem?: Gem }>): CombatantSetup {
  return {
    name: 'hero',
    stats: { maxHp: 5000, hp: 5000, attack: 10, magicPower: 10, armor: 0, magicResist: 0, speed: 20 },
    boardSize: 10,
    pieces: pieces.map((p, i) => ({ skillId: p.skillId, slot: i, ...(p.gem ? { gem: p.gem } : {}) })),
  };
}

function wall(name: string): CombatantSetup {
  return {
    name,
    stats: { maxHp: 100_000, hp: 100_000, attack: 0, magicPower: 0, armor: 0, magicResist: 0, speed: 1 },
    boardSize: 10,
    pieces: [],
  };
}

/** Damage amounts of each cast, in cast order. */
function castsOf(events: readonly CombatEvent[]): number[][] {
  const casts: number[][] = [];
  for (const e of events) {
    if (e.kind === 'skillCast') casts.push([]);
    if (e.kind === 'damage' && e.side === 'enemy' && casts.length > 0) casts[casts.length - 1]!.push(e.amount);
  }
  return casts;
}

function fight(pieces: Array<{ skillId: string; gem?: Gem }>, foes = 1, maxTurns = 8): number[][] {
  const config: CombatConfig = {
    playerTeam: [hero(pieces)],
    enemyTeam: Array.from({ length: foes }, (_, i) => wall(`w${i}`)),
    skillBook: book,
    suddenDeathRound: 999,
    fatigueTurn: 999_999,
    attritionTurn: 999_999,
    maxTurns,
  };
  return castsOf(simulate(config, 1).events);
}

describe('a triggered comboBonus is spent ONCE per cast', () => {
  it('a comboBonus GEM adds its +16 to exactly one hit of a multi-hit host (was: every hit)', () => {
    // Barrage is two own damage actions. Cast 1 has nothing to combo off; cast 2
    // combos off cast 1 and must gain 16 TOTAL, not 16 per hit.
    for (const hostId of ['barrage', 'rapid_volley', 'twin_slash']) {
      const plain = fight([{ skillId: hostId }]);
      const gemmed = fight([{ skillId: hostId, gem: comboGem }]);
      expect(plain[1], `${hostId}: two own hits`).toHaveLength(2);
      expect(gemmed[1], `${hostId}: two own hits`).toHaveLength(2);
      const plainTotal = plain[1]!.reduce((a, b) => a + b, 0);
      const gemTotal = gemmed[1]!.reduce((a, b) => a + b, 0);
      expect(gemTotal - plainTotal, `${hostId}: the gem prints +16, so a cast gains 16`).toBe(16);
      // ...and the whole bonus rides on the FIRST hit (the card face shows one number).
      expect(gemmed[1]![0]! - plain[1]![0]!).toBe(16);
      expect(gemmed[1]![1]! - plain[1]![1]!).toBe(0);
    }
  });

  it('a single-hit host is unchanged: the gem still delivers its full +16', () => {
    const plain = fight([{ skillId: 'sword_slash' }]);
    const gemmed = fight([{ skillId: 'sword_slash', gem: comboGem }]);
    expect(gemmed[1]![0]! - plain[1]![0]!).toBe(16);
  });

  it('a BASE CARD authoring comboBonus beside two damage actions pays the bonus once too', () => {
    // The gem route and the authored route run the same code; fixing only one
    // would leave the identical hole in the other.
    const casts = fight([{ skillId: 'twinCombo' }]);
    expect(casts[0]).toEqual([25, 25]); // 20 power + attack 10 split two ways (5/5), no combo yet
    expect(casts[1], 'the bonus lands on the first hit only').toEqual([41, 25]);
  });

  it('an AoE cast still delivers the bonus to EVERY foe of that one damage action', () => {
    // The bonus is cleared after an ACTION finishes fanning out, not after the
    // first target — otherwise foe #2 of an AoE hit would silently lose it.
    const casts = fight([{ skillId: 'aoeCombo' }], 3);
    expect(casts[0], 'three foes, one hit each').toHaveLength(3);
    for (const amount of casts[0]!) expect(amount).toBe(30); // 20 + attack 10, no combo yet
    expect(casts[1], 'three foes, one hit each').toHaveLength(3);
    for (const amount of casts[1]!) expect(amount).toBe(46); // every foe gets the +16
  });
});
