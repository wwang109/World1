import { describe, expect, it } from 'vitest';
import type { Element, SkillBook, SkillDef, WeaponType } from '../../src/engine/types';
import { boardTypeIdentity, cardType } from '../../src/engine/combat/typeIdentity';
import { simulate } from '../../src/engine/combat/simulate';
import { cfg, tc, NO_ENDGAME } from '../helpers';

// A magical damage card typed by `element`.
function elem(id: string, element: Element, power = 20): SkillDef {
  return {
    id,
    name: id,
    archetypes: ['offense'],
    property: 'magical',
    size: 1,
    speedWeight: 10,
    rarity: 'common',
    tier: 'bronze',
    element,
    effects: [{ kind: 'damage', power }],
    text: '',
  };
}

// A physical damage card typed by `weapon`.
function wep(id: string, weapon: WeaponType, power = 20): SkillDef {
  return {
    id,
    name: id,
    archetypes: ['offense'],
    property: 'physical',
    size: 1,
    speedWeight: 10,
    rarity: 'common',
    tier: 'bronze',
    weapon,
    effects: [{ kind: 'damage', power }],
    text: '',
  };
}

const BOOK: SkillBook = {
  // Elements (real wheel: Fire→Nature→Lightning→Frost→Fire; Holy↔Dark).
  fire: elem('fire', 'fire'),
  frost: elem('frost', 'frost'),
  lightning: elem('lightning', 'lightning'),
  nature: elem('nature', 'nature'),
  // Weapons (Sword→Axe→Lance→Sword; Bow beats Beast).
  sword: wep('sword', 'sword'),
  axe: wep('axe', 'axe'),
  lance: wep('lance', 'lance'),
  bow: wep('bow', 'bow'),
  beast: wep('beast', 'beast'),
};

const skills = (...ids: string[]): SkillDef[] => ids.map((id) => BOOK[id]!);

describe('cardType', () => {
  it('types by element when present, else by weapon', () => {
    expect(cardType(BOOK.fire!)).toEqual({ kind: 'element', type: 'fire' });
    expect(cardType(BOOK.sword!)).toEqual({ kind: 'weapon', type: 'sword' });
  });
});

describe('boardTypeIdentity threshold', () => {
  it('2 of a type is below threshold → no identity', () => {
    expect(boardTypeIdentity(skills('fire', 'fire', 'lightning'))).toBeUndefined();
  });

  it('3 of a type is the identity', () => {
    expect(boardTypeIdentity(skills('fire', 'fire', 'fire'))).toEqual({ kind: 'element', type: 'fire' });
    expect(boardTypeIdentity(skills('fire', 'fire', 'fire', 'lightning'))).toEqual({ kind: 'element', type: 'fire' });
  });

  it('exact tie for the top count → no identity', () => {
    expect(boardTypeIdentity(skills('fire', 'fire', 'fire', 'lightning', 'lightning', 'lightning'))).toBeUndefined();
  });

  it('highest count wins over a 3+ runner-up', () => {
    expect(boardTypeIdentity(skills('fire', 'fire', 'fire', 'fire', 'lightning', 'lightning', 'lightning'))).toEqual({
      kind: 'element',
      type: 'fire',
    });
  });

  it('weapon boards derive a weapon identity', () => {
    expect(boardTypeIdentity(skills('sword', 'sword', 'sword', 'axe'))).toEqual({ kind: 'weapon', type: 'sword' });
  });
});

describe('defensive attunement (Effect 1)', () => {
  it('a fire-identity hero gains fire affinity and takes +50% from a frost attack', () => {
    // Hero board: 3 fire cards → fire identity → elementAffinity 'fire'.
    // Enemy performs first (speed 20 vs 10) and hits the hero with frost.
    // Frost BEATS fire (wheel) → advantage → +50%.
    // frost 20 + MP 10 = 30, ×1.5 = 45.
    const hero = { ...tc('hero', ['fire', 'fire', 'fire'], { speed: 10 }, { skillBook: BOOK }) };
    const foe = tc('foe', ['frost'], { magicPower: 10, speed: 20, maxHp: 300 }, { skillBook: BOOK });
    const { events, finalState } = simulate(
      cfg(hero, foe, { ...NO_ENDGAME, maxTurns: 1, skillBook: BOOK }),
      1,
    );
    expect(finalState.player.boardIdentity).toEqual({ kind: 'element', type: 'fire' });
    expect(finalState.player.elementAffinity).toBe('fire');
    const hit = events.find((e) => e.kind === 'damage' && e.side === 'player');
    expect(hit).toMatchObject({ amount: 45, matchup: 'advantage' });
  });

  it('a sword-identity hero takes +50% from a lance attack', () => {
    // Lance BEATS sword (triangle) → advantage.
    // lance 20 + Attack 10 = 30, ×1.5 = 45.
    const hero = tc('hero', ['sword', 'sword', 'sword'], { speed: 10 }, { skillBook: BOOK });
    const foe = tc('foe', ['lance'], { attack: 10, speed: 20, maxHp: 300 }, { skillBook: BOOK });
    const { events, finalState } = simulate(
      cfg(hero, foe, { ...NO_ENDGAME, maxTurns: 1, skillBook: BOOK }),
      1,
    );
    expect(finalState.player.weaponAffinity).toBe('sword');
    const hit = events.find((e) => e.kind === 'damage' && e.side === 'player');
    expect(hit).toMatchObject({ amount: 45, matchup: 'advantage' });
  });

  it('the type the identity beats deals −25% (fire identity vs a nature attack)', () => {
    // Fire BEATS nature → the nature attacker is at disadvantage → −25%.
    // nature 20 + MP 10 = 30, ×0.75 = 22 (floored).
    const hero = tc('hero', ['fire', 'fire', 'fire'], { speed: 10 }, { skillBook: BOOK });
    const foe = tc('foe', ['nature'], { magicPower: 10, speed: 20, maxHp: 300 }, { skillBook: BOOK });
    const { events } = simulate(cfg(hero, foe, { ...NO_ENDGAME, maxTurns: 1, skillBook: BOOK }), 1);
    const hit = events.find((e) => e.kind === 'damage' && e.side === 'player');
    expect(hit).toMatchObject({ amount: 22, matchup: 'disadvantage' });
  });

  it('no identity (2 fire) → no affinity → incoming attack is neutral', () => {
    const hero = tc('hero', ['fire', 'fire', 'lightning'], { speed: 10 }, { skillBook: BOOK });
    const foe = tc('foe', ['frost'], { magicPower: 10, speed: 20, maxHp: 300 }, { skillBook: BOOK });
    const { events, finalState } = simulate(
      cfg(hero, foe, { ...NO_ENDGAME, maxTurns: 1, skillBook: BOOK }),
      1,
    );
    expect(finalState.player.boardIdentity).toBeUndefined();
    expect(finalState.player.elementAffinity).toBeUndefined();
    const hit = events.find((e) => e.kind === 'damage' && e.side === 'player');
    expect(hit).toMatchObject({ amount: 30 });
    expect((hit as { matchup?: string }).matchup).toBeUndefined();
  });

  it('an authored affinity is NOT overridden by a conflicting board identity', () => {
    // Enemy authored frost affinity but a fire-identity board. The identity must
    // not overwrite the authored value. Proof: a hero fire attack into the enemy
    // is resisted (fire vs frost = disadvantage); had the identity overridden it
    // to 'fire', fire-vs-fire would be neutral.
    const hero = tc('hero', ['fire'], { magicPower: 10, speed: 20 }, { skillBook: BOOK });
    const foe = {
      ...tc('foe', ['fire', 'fire', 'fire'], { speed: 10, maxHp: 300 }, { skillBook: BOOK }),
      elementAffinity: 'frost' as Element,
    };
    const { events, finalState } = simulate(
      cfg(hero, foe, { ...NO_ENDGAME, maxTurns: 1, skillBook: BOOK }),
      1,
    );
    expect(finalState.enemy.boardIdentity).toEqual({ kind: 'element', type: 'fire' });
    expect(finalState.enemy.elementAffinity).toBe('frost');
    const hit = events.find((e) => e.kind === 'damage' && e.side === 'enemy');
    // fire 20 + MP 10 = 30, ×0.75 = 22.
    expect(hit).toMatchObject({ amount: 22, matchup: 'disadvantage' });
  });
});

describe('same-type damage bonus (Effect 2)', () => {
  it('matching-type cards get +20% (floored); off-type cards on the same board do not', () => {
    // Hero board: 3 fire + 1 lightning → fire identity. Enemy has NO affinity, so
    // matchup is neutral and the only multiplier is the +20% identity bonus.
    // Fire card:      20 + MP 10 = 30, +20% = floor(30 × 1.2) = 36.
    // Lightning card: 20 + MP 10 = 30, no bonus                = 30.
    const hero = tc('hero', ['fire', 'fire', 'fire', 'lightning'], { magicPower: 10, speed: 20 }, { skillBook: BOOK });
    const foe = tc('foe', [], { speed: 5, maxHp: 500 }, { skillBook: BOOK });
    const { events, finalState } = simulate(
      cfg(hero, foe, { ...NO_ENDGAME, maxTurns: 8, skillBook: BOOK }),
      1,
    );
    expect(finalState.player.boardIdentity).toEqual({ kind: 'element', type: 'fire' });
    const fireHit = events.find(
      (e) => e.kind === 'damage' && e.source === 'skill' && e.sourceCard?.skillId === 'fire',
    );
    const lightningHit = events.find(
      (e) => e.kind === 'damage' && e.source === 'skill' && e.sourceCard?.skillId === 'lightning',
    );
    expect(fireHit).toMatchObject({ amount: 36 });
    expect(lightningHit).toMatchObject({ amount: 30 });
    // The +20% is attributed through effectBonusDamage so the math strip sums.
    expect((fireHit as { calculation?: { effectBonusDamage: number } }).calculation?.effectBonusDamage).toBe(6);
    expect((lightningHit as { calculation?: { effectBonusDamage: number } }).calculation?.effectBonusDamage).toBe(0);
  });

  it('no identity → no same-type bonus (byte-identical damage)', () => {
    // 2 fire + 2 lightning: no identity, so the fire card deals its plain 30.
    const hero = tc('hero', ['fire', 'lightning', 'fire', 'lightning'], { magicPower: 10, speed: 20 }, { skillBook: BOOK });
    const foe = tc('foe', [], { speed: 5, maxHp: 500 }, { skillBook: BOOK });
    const { events } = simulate(cfg(hero, foe, { ...NO_ENDGAME, maxTurns: 4, skillBook: BOOK }), 1);
    const fireHit = events.find(
      (e) => e.kind === 'damage' && e.source === 'skill' && e.sourceCard?.skillId === 'fire',
    );
    expect(fireHit).toMatchObject({ amount: 30 });
  });
});
