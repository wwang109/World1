import { describe, expect, it } from 'vitest';
import { simulate, simulate1v1 } from '../../src/engine/combat/simulate';
import { skillBook } from '../../src/data/skills';
import type { CombatConfig } from '../../src/engine/types';
import { tc } from '../helpers';

const SEED = 0x51de;

describe('Wave 2 — team config + simulate1v1 adapter', () => {
  it('legacy {player,enemy} config == team config, byte-identical events for the same 1v1 input', () => {
    const player = tc('hero', ['sword_slash', 'iron_bulwark']);
    const enemy = tc('foe', ['sword_slash']);
    const base = { skillBook, suddenDeathRound: 5, fatigueTurn: 40, maxTurns: 200 };

    const legacy: CombatConfig = { player, enemy, ...base };
    const teams: CombatConfig = { playerTeam: [player], enemyTeam: [enemy], ...base };

    const a = simulate(structuredClone(legacy), SEED);
    const b = simulate(structuredClone(teams), SEED);

    expect(a.events).toEqual(b.events);
    expect(a.result).toBe(b.result);
    expect(a.turns).toBe(b.turns);
  });

  it('simulate1v1 == a teams-of-1 config', () => {
    const player = tc('hero', ['fireball', 'second_wind']);
    const enemy = tc('foe', ['crushing_blow']);
    const base = { skillBook, suddenDeathRound: 5, fatigueTurn: 40, maxTurns: 200 };

    const viaAdapter = simulate1v1(player, enemy, base, SEED);
    const viaTeams = simulate({ playerTeam: [player], enemyTeam: [enemy], ...base }, SEED);

    expect(viaAdapter.events).toEqual(viaTeams.events);
    expect(viaAdapter.result).toBe(viaTeams.result);
  });

  it('rejects teams XOR legacy: both throws, neither throws', () => {
    const p = tc('hero', ['sword_slash']);
    const e = tc('foe', ['sword_slash']);
    expect(() => simulate({ player: p, playerTeam: [p], enemyTeam: [e], skillBook }, SEED)).toThrow(/XOR/);
    expect(() => simulate({ skillBook } as CombatConfig, SEED)).toThrow(/no combatants/);
    expect(() => simulate({ playerTeam: [], enemyTeam: [e], skillBook }, SEED)).toThrow(/at least one/);
  });

  it('1v2 config initializes (indexes assigned) and simulate() runs to termination', () => {
    const player = tc('hero', ['crushing_blow', 'iron_bulwark', 'second_wind']);
    const foeA = tc('foeA', ['sword_slash']);
    const foeB = tc('foeB', ['sword_slash']);

    const cfg: CombatConfig = {
      playerTeam: [player],
      enemyTeam: [foeA, foeB],
      skillBook,
      suddenDeathRound: 5,
      fatigueTurn: 40,
      maxTurns: 200,
    };

    const { result, finalState } = simulate(cfg, SEED);

    // Init: both enemy units present with canonical 0-based indexes.
    expect(finalState.enemyTeam.length).toBe(2);
    expect(finalState.enemyTeam.map((u) => u.index)).toEqual([0, 1]);
    expect(finalState.playerTeam[0]!.index).toBe(0);
    // Accessor refs still alias index 0 on each side.
    expect(finalState.player).toBe(finalState.playerTeam[0]);
    expect(finalState.enemy).toBe(finalState.enemyTeam[0]);
    // Runs to a decisive end (no draw) — single-target: foe[0] is hit first.
    expect(result === 'win' || result === 'loss').toBe(true);
  });

  it('1v2 is deterministic (single-target resolveTargets returns first living foe)', () => {
    const player = tc('hero', ['crushing_blow']);
    const foeA = tc('foeA', ['sword_slash']);
    const foeB = tc('foeB', ['sword_slash']);
    const cfg: CombatConfig = { playerTeam: [player], enemyTeam: [foeA, foeB], skillBook };
    const a = simulate(structuredClone(cfg), SEED);
    const b = simulate(structuredClone(cfg), SEED);
    expect(a.events).toEqual(b.events);
  });
});
