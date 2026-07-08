import { describe, expect, it } from 'vitest';
import { aurasOn } from '../../src/engine/combat/auras';
import { initCombatState, type CombatantState } from '../../src/engine/combat/state';
import { simulate } from '../../src/engine/combat/simulate';
import { skillBook } from '../../src/data/skills';
import type { BoardPiece } from '../../src/engine/types';
import { cfg, tc, NO_ENDGAME } from '../helpers';

function boardOf(pieces: BoardPiece[]): CombatantState {
  const state = initCombatState(cfg(tc('hero', [], {}, { boardSize: 10, pieces }), tc('foe', [])));
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
    expect(aurasOn(c, pieceAt(c, 0), skillBook).damagePct).toBe(25); // touching offense
    expect(aurasOn(c, pieceAt(c, 3), skillBook).damagePct).toBe(0); // healing, filtered out
    expect(aurasOn(c, pieceAt(c, 6), skillBook).damagePct).toBe(0); // not touching (gap)
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
    expect(aurasOn(c, pieceAt(c, 1), skillBook).critPctDelta).toBe(15);
  });

  it('auras stack additively across sources', () => {
    // slash touched by war_banner (left) and lucky_charm (right).
    const c = boardOf([
      { skillId: 'war_banner', slot: 0 },
      { skillId: 'sword_slash', slot: 2 },
      { skillId: 'lucky_charm', slot: 3 },
    ]);
    const mods = aurasOn(c, pieceAt(c, 2), skillBook);
    expect(mods.damagePct).toBe(25);
    expect(mods.critPctDelta).toBe(15);
  });

  it('war_banner changes actual combat damage', () => {
    const c = cfg(
      tc('hero', [], { attack: 10, speed: 20 }, {
        boardSize: 10,
        pieces: [
          { skillId: 'war_banner', slot: 0 },
          { skillId: 'sword_slash', slot: 2 },
        ],
      }),
      tc('wall', [], { maxHp: 1000, speed: 10 }),
      { ...NO_ENDGAME, maxTurns: 1 },
    );
    const { events } = simulate(c, 1);
    expect(events.find((e) => e.kind === 'damage')).toMatchObject({ amount: 12 }); // 10 * 1.25
  });

  it('weightDelta changes the initiative comparison', () => {
    // arcane_bolt (w10) next to time_crystal -> effective weight 5:
    // hero speed 10: score 10−5=5 beats enemy 10−10=0 every turn.
    const c = cfg(
      tc('hero', [], { magicPower: 1, speed: 10, maxHp: 500 }, {
        boardSize: 10,
        pieces: [
          { skillId: 'time_crystal', slot: 0 },
          { skillId: 'arcane_bolt', slot: 1 },
        ],
      }),
      tc('foe', ['sword_slash'], { attack: 1, speed: 10, maxHp: 500 }),
      { ...NO_ENDGAME, maxTurns: 2 },
    );
    const { events } = simulate(c, 1);
    const first = events.find((e) => e.kind === 'comparison') as { performer: string };
    expect(first.performer).toBe('player');
  });
});
