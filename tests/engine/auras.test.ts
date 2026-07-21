import { describe, expect, it } from 'vitest';
import { auraAffectedTargetSlots, aurasOn } from '../../src/engine/combat/auras';
import { initCombatState, type CombatantState } from '../../src/engine/combat/state';
import { simulate } from '../../src/engine/combat/simulate';
import { skillBook } from '../../src/data/skills';
import type { AuraDef, BoardPiece, SkillBook, SkillDef } from '../../src/engine/types';
import { cfg, tc, NO_ENDGAME } from '../helpers';

function boardOf(pieces: BoardPiece[]): CombatantState {
  const state = initCombatState(cfg(tc('hero', [], {}, { boardSize: 10, pieces }), tc('foe', [])));
  return state.player;
}

// --- Constructed reach fixtures (independent of real card data) --------------
// A size-1 offense card carrying `aura`, plus a plain size-1 offense target.
function auraCard(id: string, aura: AuraDef): SkillDef {
  return {
    id,
    name: id,
    archetypes: ['offense'],
    property: 'physical',
    size: 1,
    speedWeight: 10,
    rarity: 'common',
    tier: 'bronze',
    effects: [],
    text: '',
    aura,
  };
}

const REACH_BOOK: SkillBook = {
  target: {
    id: 'target',
    name: 'target',
    archetypes: ['offense'],
    property: 'physical',
    size: 1,
    speedWeight: 10,
    rarity: 'common',
    tier: 'bronze',
    effects: [{ kind: 'damage', power: 100 }],
    text: '',
  },
  // reach OMITTED -> defaults to 1 (old touching-only behavior).
  adj1: auraCard('adj1', { affects: 'adjacent', mods: { damageFlat: 10 } }),
  adj2: auraCard('adj2', { affects: 'adjacent', reach: 2, mods: { damageFlat: 10 } }),
  left2: auraCard('left2', { affects: 'left', reach: 2, mods: { damageFlat: 10 } }),
  right2: auraCard('right2', { affects: 'right', reach: 2, mods: { damageFlat: 10 } }),
  all1: auraCard('all1', { affects: 'allBoard', reach: 1, mods: { damageFlat: 10 } }),
};

function reachBoardOf(pieces: BoardPiece[]): CombatantState {
  const state = initCombatState(
    cfg(tc('hero', [], {}, { boardSize: 12, pieces, skillBook: REACH_BOOK }), tc('foe', [], {}, { skillBook: REACH_BOOK }), {
      skillBook: REACH_BOOK,
    }),
  );
  return state.player;
}

function pieceAt(c: CombatantState, slot: number) {
  const piece = c.pieces.find((p) => p.slot === slot);
  if (!piece) throw new Error(`no piece at slot ${slot}`);
  return piece;
}

describe('aura math (size-aware adjacency, archetype/property filters)', () => {
  it('war_banner boosts only touching OFFENSE cards', () => {
    // [sword_slash@0][war_banner@1-2][mending_light@3-4] [sword_slash@6]
    const c = boardOf([
      { skillId: 'sword_slash', slot: 0 },
      { skillId: 'war_banner', slot: 1 },
      { skillId: 'mending_light', slot: 3 },
      { skillId: 'sword_slash', slot: 6 },
    ]);
    expect(aurasOn(c, pieceAt(c, 0), skillBook).damageFlat).toBe(5); // touching offense: +5 flat
    expect(aurasOn(c, pieceAt(c, 3), skillBook).damageFlat).toBe(0); // healing, filtered out
    expect(aurasOn(c, pieceAt(c, 6), skillBook).damageFlat).toBe(0); // not touching (gap)
  });

  it('time_crystal lightens only touching MAGICAL cards', () => {
    const c = boardOf([
      { skillId: 'time_crystal', slot: 0 },
      { skillId: 'arcane_bolt', slot: 1 }, // magical
      { skillId: 'sword_slash', slot: 2 }, // physical (not touching crystal anyway)
    ]);
    expect(aurasOn(c, pieceAt(c, 1), skillBook).weightDelta).toBe(-5);
    expect(aurasOn(c, pieceAt(c, 2), skillBook).weightDelta).toBe(0);
  });

  it('lucky_charm grants crit to any touching card', () => {
    const c = boardOf([
      { skillId: 'lucky_charm', slot: 0 },
      { skillId: 'mending_light', slot: 1 },
    ]);
    expect(aurasOn(c, pieceAt(c, 1), skillBook).critPctDelta).toBe(20);
  });

  it('auras stack additively across sources', () => {
    // slash touched by war_banner (left) and lucky_charm (right).
    const c = boardOf([
      { skillId: 'war_banner', slot: 0 },
      { skillId: 'sword_slash', slot: 1 },
      { skillId: 'lucky_charm', slot: 2 },
    ]);
    const mods = aurasOn(c, pieceAt(c, 1), skillBook);
    expect(mods.damageFlat).toBe(5);
    expect(mods.critPctDelta).toBe(20);
  });

  it('war_banner changes actual combat damage', () => {
    const c = cfg(
      tc('hero', [], { attack: 10, speed: 20 }, {
        boardSize: 10,
        pieces: [
          { skillId: 'war_banner', slot: 0 },
          { skillId: 'sword_slash', slot: 1 },
        ],
      }),
      tc('wall', [], { maxHp: 1000, speed: 10 }),
      { ...NO_ENDGAME, maxTurns: 1 },
    );
    const { events } = simulate(c, 1);
    // sword_slash: 20 flat + 10 Attack + 5 (war_banner flat aura) = 35.
    expect(events.find((e) => e.kind === 'damage')).toMatchObject({ amount: 35 });
  });

  it('skillCast records the aura source breakdown (war_banner +5 dmg)', () => {
    const c = cfg(
      tc('hero', [], { attack: 10, speed: 20 }, {
        boardSize: 10,
        pieces: [
          { skillId: 'war_banner', slot: 0 },
          { skillId: 'sword_slash', slot: 1 },
        ],
      }),
      tc('wall', [], { maxHp: 1000, speed: 10 }),
      { ...NO_ENDGAME, maxTurns: 1 },
    );
    const { events } = simulate(c, 1);
    const cast = events.find((e) => e.kind === 'skillCast' && e.skillId === 'sword_slash') as {
      auras?: { slot: number; skillId: string; damageFlat?: number }[];
    };
    expect(cast.auras).toEqual([{ slot: 0, skillId: 'war_banner', damageFlat: 5 }]);
  });

  it('skillCast OMITS the auras key when no board aura reaches the cast', () => {
    const c = cfg(
      tc('hero', [], { attack: 10, speed: 20 }, {
        boardSize: 10,
        pieces: [{ skillId: 'sword_slash', slot: 0 }],
      }),
      tc('wall', [], { maxHp: 1000, speed: 10 }),
      { ...NO_ENDGAME, maxTurns: 1 },
    );
    const { events } = simulate(c, 1);
    const cast = events.find((e) => e.kind === 'skillCast' && e.skillId === 'sword_slash')!;
    expect('auras' in cast).toBe(false);
  });

  it('reach omitted === reach 1: touches only, one-gap card is NOT reached', () => {
    // [adj1@0] . [target@2]  -> gap 1, out of reach at default reach 1.
    const c = reachBoardOf([
      { skillId: 'adj1', slot: 0 },
      { skillId: 'target', slot: 2 },
    ]);
    expect(aurasOn(c, pieceAt(c, 2), REACH_BOOK).damageFlat).toBe(0);
    // Touching target (slot 1) IS reached at reach 1.
    const touching = reachBoardOf([
      { skillId: 'adj1', slot: 0 },
      { skillId: 'target', slot: 1 },
    ]);
    expect(aurasOn(touching, pieceAt(touching, 1), REACH_BOOK).damageFlat).toBe(10);
  });

  it('reach 2 reaches a one-gap card that reach 1 cannot', () => {
    // [adj2@0] . [target@2]  -> gap 1 < reach 2 -> reached.
    const c = reachBoardOf([
      { skillId: 'adj2', slot: 0 },
      { skillId: 'target', slot: 2 },
    ]);
    expect(aurasOn(c, pieceAt(c, 2), REACH_BOOK).damageFlat).toBe(10);
    // But gap 2 (two empty slots) is still out of reach at reach 2.
    const far = reachBoardOf([
      { skillId: 'adj2', slot: 0 },
      { skillId: 'target', slot: 3 },
    ]);
    expect(aurasOn(far, pieceAt(far, 3), REACH_BOOK).damageFlat).toBe(0);
  });

  it('directional left/right respect reach and direction', () => {
    // right2 at slot 2: reaches right (slot 4, gap 1) but NOT left (slot 0, gap 1).
    const c = reachBoardOf([
      { skillId: 'target', slot: 0 },
      { skillId: 'right2', slot: 2 },
      { skillId: 'target', slot: 4 },
    ]);
    expect(aurasOn(c, pieceAt(c, 4), REACH_BOOK).damageFlat).toBe(10); // to the right
    expect(aurasOn(c, pieceAt(c, 0), REACH_BOOK).damageFlat).toBe(0); // to the left, ignored
    // left2 at slot 2: mirror — reaches left (slot 0) not right (slot 4).
    const c2 = reachBoardOf([
      { skillId: 'target', slot: 0 },
      { skillId: 'left2', slot: 2 },
      { skillId: 'target', slot: 4 },
    ]);
    expect(aurasOn(c2, pieceAt(c2, 0), REACH_BOOK).damageFlat).toBe(10);
    expect(aurasOn(c2, pieceAt(c2, 4), REACH_BOOK).damageFlat).toBe(0);
  });

  it('allBoard ignores reach (covers a far card)', () => {
    // all1 has reach 1 but affects allBoard -> reaches a card 5 slots away.
    const c = reachBoardOf([
      { skillId: 'all1', slot: 0 },
      { skillId: 'target', slot: 6 },
    ]);
    expect(aurasOn(c, pieceAt(c, 6), REACH_BOOK).damageFlat).toBe(10);
  });

  it('weightDelta changes the readiness cost recorded by play', () => {
    const c = cfg(
      tc('hero', [], { magicPower: 1, speed: 10, maxHp: 500 }, {
        boardSize: 10,
        pieces: [
          { skillId: 'arcane_bolt', slot: 0 },
          { skillId: 'time_crystal', slot: 1 },
        ],
      }),
      tc('foe', ['sword_slash'], { attack: 1, speed: 10, maxHp: 500 }),
      { ...NO_ENDGAME, maxTurns: 2 },
    );
    const { events } = simulate(c, 1);
    const bolt = events.find((event) => event.kind === 'play' && event.skillId === 'arcane_bolt');
    expect(bolt).toMatchObject({ side: 'player', weight: 3 });
  });
});

// --- Shared coverage helper (UI + combat use the same rule) -----------------
describe('auraAffectedTargetSlots (UI-facing coverage)', () => {
  const book: SkillBook = {
    ...skillBook,
    // A left-projecting, reach-2 aura source for a deterministic fixture.
    beacon: {
      id: 'beacon', name: 'Beacon', archetypes: ['support'], property: 'physical', size: 1,
      rarity: 'common', tier: 'bronze', effects: [],
      aura: { affects: 'left', reach: 2, archetypeFilter: 'offense', mods: { damageFlat: 10 } },
      text: '',
    },
  };
  // Board: offense(0) offense(1) beacon(2) defensive(3)
  const pieces = [
    { slot: 0, skillId: 'sword_slash' },   // offense, left of beacon
    { slot: 1, skillId: 'sword_slash' },   // offense, touching beacon on the left
    { slot: 2, skillId: 'beacon' },
    { slot: 3, skillId: 'iron_bulwark' },  // defensive, right of beacon
  ];

  it('covers only left-side, in-range, filter-matching cards', () => {
    const hit = auraAffectedTargetSlots({ slot: 2, skillId: 'beacon' }, pieces, book);
    // left reach 2 → slots 1 (gap 0) and 0 (gap 1); slot 3 is right (excluded);
    // all left cards are offense so the filter passes both.
    expect(hit).toEqual([0, 1]);
  });

  it('matches the combat resolver exactly (same affected set)', () => {
    // Cross-check: aurasOn should boost the covered offense cards and not slot 3.
    const state = initCombatState(cfg(tc('hero', [], {}, { boardSize: 10, pieces }), tc('foe', []), { skillBook: book }));
    const covered = auraAffectedTargetSlots({ slot: 2, skillId: 'beacon' }, pieces, book);
    for (const p of state.player.pieces) {
      const boosted = aurasOn(state.player, p, book).damageFlat > 0;
      expect(boosted).toBe(covered.includes(p.slot));
    }
  });
});
