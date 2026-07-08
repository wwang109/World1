import { describe, expect, it } from 'vitest';
import { aurasOn, effCooldown, NO_MODS } from '../../src/engine/combat/auras';
import { initCombatState, type CombatantState } from '../../src/engine/combat/state';
import { simulate } from '../../src/engine/combat/simulate';
import { skillBook } from '../../src/data/skills';
import type { BoardPiece } from '../../src/engine/types';
import { cfg, tc } from '../helpers';

function boardOf(pieces: BoardPiece[]): CombatantState {
  const state = initCombatState(cfg(tc('hero', [], {}, { boardSize: 10, pieces }), tc('foe', [])));
  return state.player;
}

function pieceAt(c: CombatantState, slot: number) {
  const piece = c.pieces.find((p) => p.slot === slot);
  if (!piece) throw new Error(`no piece at slot ${slot}`);
  return piece;
}

describe('aura math (size-aware adjacency)', () => {
  it('whetstone boosts only skills physically touching it', () => {
    // [strike@0][whetstone@1][heavy_blow@2-3] gap [strike@5]
    const c = boardOf([
      { skillId: 'strike', slot: 0 },
      { skillId: 'whetstone', slot: 1 },
      { skillId: 'heavy_blow', slot: 2 },
      { skillId: 'strike', slot: 5 },
    ]);
    expect(aurasOn(c, pieceAt(c, 0), skillBook).damagePct).toBe(25);
    expect(aurasOn(c, pieceAt(c, 2), skillBook).damagePct).toBe(25);
    // heavy_blow ends at slot 4; strike@5 touches nothing with an aura... and
    // whetstone is two slots away.
    expect(aurasOn(c, pieceAt(c, 5), skillBook).damagePct).toBe(0);
  });

  it('tag filters exclude non-matching skills', () => {
    const c = boardOf([
      { skillId: 'whetstone', slot: 0 },
      { skillId: 'mend', slot: 1 }, // magic/holy, not attack
    ]);
    expect(aurasOn(c, pieceAt(c, 1), skillBook).damagePct).toBe(0);
  });

  it('battle_banner reaches the whole board except itself', () => {
    const c = boardOf([
      { skillId: 'strike', slot: 0 },
      { skillId: 'battle_banner', slot: 2 },
      { skillId: 'strike', slot: 6 },
    ]);
    expect(aurasOn(c, pieceAt(c, 0), skillBook).damagePct).toBe(10);
    expect(aurasOn(c, pieceAt(c, 6), skillBook).damagePct).toBe(10);
    expect(aurasOn(c, pieceAt(c, 2), skillBook).damagePct).toBe(0);
  });

  it('auras stack additively', () => {
    const c = boardOf([
      { skillId: 'whetstone', slot: 0 },
      { skillId: 'strike', slot: 1 },
      { skillId: 'battle_banner', slot: 2 },
    ]);
    expect(aurasOn(c, pieceAt(c, 1), skillBook).damagePct).toBe(35);
  });

  it('chrono_lens shortens cooldowns of touching magic, floored at 0', () => {
    const c = boardOf([
      { skillId: 'chrono_lens', slot: 0 },
      { skillId: 'fireball', slot: 1 },
    ]);
    const mods = aurasOn(c, pieceAt(c, 1), skillBook);
    expect(mods.cooldownDelta).toBe(-1);
    expect(effCooldown(skillBook['fireball']!.cooldownTurns, mods)).toBe(0);
    expect(effCooldown(0, { ...NO_MODS, cooldownDelta: -2 })).toBe(0);
  });

  it('whetstone changes actual combat damage', () => {
    const c = cfg(
      tc('hero', ['strike', 'whetstone'], { atk: 10, speed: 20 }),
      tc('wall', [], { maxHp: 1000, speed: 10 }),
      { suddenDeathRound: 999, fatigueRound: 999, maxTurns: 2 },
    );
    const { events } = simulate(c, 1);
    expect(events.find((e) => e.kind === 'damage')).toMatchObject({ amount: 12 }); // 10 * 1.25 -> 12
  });
});
