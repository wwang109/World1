import { describe, expect, it } from 'vitest';
import type { Element, SkillBook, SkillDef, WeaponType } from '../../src/engine/types';
import { boardAffinities, boardEffectAffinities, boardTypeIdentity, cardType, primaryIdentity } from '../../src/engine/combat/typeIdentity';
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

describe('boardEffectAffinities: each type checks the 3-card threshold independently', () => {
  it('returns every qualifying type in stable first-seen order, including ties and runner-ups', () => {
    expect(boardEffectAffinities(skills(
      'fire', 'fire', 'fire',
      'frost', 'frost', 'frost',
      'sword', 'sword', 'sword', 'sword',
      'axe', 'axe', 'axe',
    ))).toEqual([
      { kind: 'element', type: 'fire' },
      { kind: 'element', type: 'frost' },
      { kind: 'weapon', type: 'sword' },
      { kind: 'weapon', type: 'axe' },
    ]);
  });

  it('omits every type below 3', () => {
    expect(boardEffectAffinities(skills('fire', 'fire', 'frost', 'frost', 'sword', 'sword'))).toEqual([]);
  });
});

/**
 * ELEMENT AND WEAPON ARE ORTHOGONAL (user ruling 2026-09-06: "affinity are just
 * passive buffs based on the board … if they meet the requirements they should
 * have the affinity effect").
 *
 * Before this, ONE tally keyed `${kind}:${type}` held both axes, so a board of
 * 3 nature + 3 bow read as a TIE and earned nothing at all — despite each axis
 * independently clearing the threshold, and despite the combatant having two
 * separate fields for them and every consumer reading those fields separately.
 */
describe('boardAffinities: the two axes are tallied SEPARATELY', () => {
  it('3 of an element AND 3 of a weapon earns BOTH — the old merged tally called this a tie', () => {
    const board = skills('nature', 'nature', 'nature', 'bow', 'bow', 'bow');
    expect(boardAffinities(board)).toEqual({ element: 'nature', weapon: 'bow' });
    // The single merged tally this replaces returned `undefined` here.
    expect(boardTypeIdentity(board)).toEqual({ kind: 'element', type: 'nature' });
  });

  it('a weapon lean does not dilute an element lean it outnumbers', () => {
    // 3 fire + 5 sword. Under one merged tally sword was the unique top type and
    // fire earned nothing; the fire cards were "wasted" by unrelated picks.
    expect(boardAffinities(skills('fire', 'fire', 'fire', 'sword', 'sword', 'sword', 'sword', 'sword')))
      .toEqual({ element: 'fire', weapon: 'sword' });
  });

  it('a tie WITHIN an axis kills only that axis', () => {
    // 3 fire vs 3 frost is a genuine tie on the element axis → no element
    // affinity. The sword lean beside it is untouched.
    expect(boardAffinities(skills('fire', 'fire', 'fire', 'frost', 'frost', 'frost', 'sword', 'sword', 'sword')))
      .toEqual({ weapon: 'sword' });
  });

  it('each axis keeps its own threshold and its own runner-up rule', () => {
    // Element: 2 fire (short). Weapon: 4 sword vs 3 axe (unique top, >= 3).
    expect(boardAffinities(skills('fire', 'fire', 'sword', 'sword', 'sword', 'sword', 'axe', 'axe', 'axe')))
      .toEqual({ weapon: 'sword' });
  });

  it('neither axis leaning → no affinity at all', () => {
    expect(boardAffinities(skills('fire', 'frost', 'sword', 'axe'))).toEqual({});
    expect(boardTypeIdentity(skills('fire', 'frost', 'sword', 'axe'))).toBeUndefined();
  });

  it('an empty board and an untyped card yield nothing', () => {
    expect(boardAffinities([])).toEqual({});
    const untyped: SkillDef = { ...BOOK.fire!, id: 'untyped', element: undefined };
    expect(boardAffinities([untyped, untyped, untyped])).toEqual({});
  });
});

describe('primaryIdentity: the lossy single-value hook', () => {
  it('collapses element-first, the same precedence cardType applies to one card', () => {
    expect(primaryIdentity({ element: 'fire', weapon: 'sword' })).toEqual({ kind: 'element', type: 'fire' });
    expect(primaryIdentity({ weapon: 'sword' })).toEqual({ kind: 'weapon', type: 'sword' });
    expect(primaryIdentity({})).toBeUndefined();
  });

  it('boardTypeIdentity IS that collapse, so the pair and the label can never disagree', () => {
    for (const board of [
      skills('fire', 'fire', 'fire'),
      skills('sword', 'sword', 'sword'),
      skills('nature', 'nature', 'nature', 'bow', 'bow', 'bow'),
      skills('fire', 'frost'),
    ]) {
      expect(boardTypeIdentity(board)).toEqual(primaryIdentity(boardAffinities(board)));
    }
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

  /**
   * INVERTED 2026-09-06. This test used to be "an authored affinity is NOT
   * overridden by a conflicting board identity" and pinned the exact rule the
   * user deleted: `setup.elementAffinity` won outright and the board was only a
   * fallback. The ruling is that the board is the ONLY source ("there should be
   * no hardcoded enemy that break the rule"), so the same fixture now asserts
   * the opposite — the authored value is ignored — and the assertion is kept
   * rather than removed precisely because it is the one that would go red if
   * the override ever came back.
   */
  it('an AUTHORED affinity is IGNORED — the board is the only source', () => {
    // Enemy authors frost affinity but places a 3-fire board. Proof it is
    // ignored: a hero fire attack into the enemy is NEUTRAL (fire vs the board's
    // own fire). Under the old override it was frost, and fire-into-frost was
    // resisted for 22 at `matchup: 'disadvantage'`.
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
    expect(finalState.enemy.elementAffinity).toBe('fire');
    const hit = events.find((e) => e.kind === 'damage' && e.side === 'enemy');
    // fire 20 + MP 10 = 30, no matchup either way.
    expect(hit).toMatchObject({ amount: 30 });
    expect((hit as { matchup?: string }).matchup).toBeUndefined();
  });

  it('an authored affinity on an axis the board does not lean into is STILL ignored', () => {
    // The board says nothing about weapons (one sword). A fallback-shaped rule —
    // "authored applies where the board is silent" — would leave the enemy on
    // weaponAffinity 'axe' and make the hero's sword hit an advantage. It must
    // not: there is no second source, silent axis or not.
    const hero = tc('hero', ['sword'], { attack: 10, speed: 20 }, { skillBook: BOOK });
    const foe = {
      ...tc('foe', ['sword'], { speed: 10, maxHp: 300 }, { skillBook: BOOK }),
      weaponAffinity: 'axe' as WeaponType,
    };
    const { events, finalState } = simulate(
      cfg(hero, foe, { ...NO_ENDGAME, maxTurns: 1, skillBook: BOOK }),
      1,
    );
    expect(finalState.enemy.weaponAffinity).toBeUndefined();
    const hit = events.find((e) => e.kind === 'damage' && e.side === 'enemy');
    expect(hit).toMatchObject({ amount: 30 }); // sword 20 + Attack 10, no ×1.5.
    expect((hit as { matchup?: string }).matchup).toBeUndefined();
  });

  it('a board leaning into BOTH axes is defended on BOTH — 3 fire + 3 sword', () => {
    // The dual-affinity case the merged tally used to call a tie and reward with
    // nothing. Hero: 3 fire + 3 sword → elementAffinity 'fire' AND
    // weaponAffinity 'sword'. Two attackers, one per axis:
    //   frost (magical) beats fire  → advantage → (20 + MP 10) × 1.5 = 45
    //   lance (physical) beats sword → advantage → (20 + ATK 10) × 1.5 = 45
    const hero = tc('hero', ['fire', 'fire', 'fire', 'sword', 'sword', 'sword'], { speed: 1, maxHp: 400 }, { skillBook: BOOK });
    const caster = tc('caster', ['frost'], { magicPower: 10, speed: 20, maxHp: 300 }, { skillBook: BOOK });
    const lancer = tc('lancer', ['lance'], { attack: 10, speed: 20, maxHp: 300 }, { skillBook: BOOK });
    const { events, finalState } = simulate(
      {
        playerTeam: [hero],
        enemyTeam: [caster, lancer],
        skillBook: BOOK,
        ...NO_ENDGAME,
        maxTurns: 1,
      },
      1,
    );
    expect(finalState.player.elementAffinity).toBe('fire');
    expect(finalState.player.weaponAffinity).toBe('sword');
    const hits = events.filter((e) => e.kind === 'damage' && e.side === 'player');
    expect(hits.length, 'both attackers must land').toBe(2);
    for (const hit of hits) expect(hit).toMatchObject({ amount: 45, matchup: 'advantage' });
  });
});

describe('affinity grants NO flat same-type damage bonus', () => {
  it('a matching-type card gets no bonus when the foe has no affinity (neutral matchup)', () => {
    // Hero board: 3 fire + 1 lightning → fire affinity. Enemy has NO affinity, so
    // the matchup is neutral — and there is no flat same-type bonus. Both cards
    // deal their plain 20 + MP 10 = 30, with zero effectBonusDamage.
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
    expect(fireHit).toMatchObject({ amount: 30 });
    expect(lightningHit).toMatchObject({ amount: 30 });
    expect((fireHit as { calculation?: { effectBonusDamage: number } }).calculation?.effectBonusDamage).toBe(0);
    expect((lightningHit as { calculation?: { effectBonusDamage: number } }).calculation?.effectBonusDamage).toBe(0);
  });

  it('no affinity (2+2 split) → plain damage, unchanged', () => {
    const hero = tc('hero', ['fire', 'lightning', 'fire', 'lightning'], { magicPower: 10, speed: 20 }, { skillBook: BOOK });
    const foe = tc('foe', [], { speed: 5, maxHp: 500 }, { skillBook: BOOK });
    const { events } = simulate(cfg(hero, foe, { ...NO_ENDGAME, maxTurns: 4, skillBook: BOOK }), 1);
    const fireHit = events.find(
      (e) => e.kind === 'damage' && e.source === 'skill' && e.sourceCard?.skillId === 'fire',
    );
    expect(fireHit).toMatchObject({ amount: 30 });
  });
});
