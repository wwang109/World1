import { describe, expect, it } from 'vitest';
import { Rng } from '../../src/engine/rng';
import { simulate } from '../../src/engine/combat/simulate';
import { skillBook } from '../../src/data/skills';
import type { BoardPiece, CombatConfig, CombatantSetup } from '../../src/engine/types';

const SKILL_IDS = Object.keys(skillBook).sort();

function randomCombatant(rng: Rng, name: string): CombatantSetup {
  const boardSize = 10;
  const pieces: BoardPiece[] = [];
  let slot = 0;
  while (slot < boardSize) {
    if (rng.pct(65)) {
      const skillId = SKILL_IDS[rng.int(SKILL_IDS.length)]!;
      const size = skillBook[skillId]!.size;
      if (slot + size <= boardSize) {
        pieces.push({ skillId, slot });
        slot += size;
        continue;
      }
    }
    slot += 1;
  }
  const maxHp = 40 + rng.int(150);
  return {
    name,
    stats: {
      maxHp,
      hp: maxHp,
      attack: 5 + rng.int(15),
      magicPower: 5 + rng.int(15),
      armor: rng.int(5),
      magicResist: rng.int(5),
      speed: 5 + rng.int(15),
      critPct: rng.int(40),
    },
    boardSize,
    pieces,
  };
}

describe('simulate determinism', () => {
  it('same config + seed yields identical event logs (100 random configs)', () => {
    const metaRng = new Rng(0xc0ffee);
    for (let i = 0; i < 100; i++) {
      const config: CombatConfig = {
        player: randomCombatant(metaRng, 'hero'),
        enemy: randomCombatant(metaRng, 'foe'),
        skillBook,
      };
      const seed = metaRng.int(2 ** 31);
      const a = simulate(structuredClone(config), seed);
      const b = simulate(structuredClone(config), seed);
      expect(a.events).toEqual(b.events);
      expect(a.result).toBe(b.result);
      expect(a.finalState).toEqual(b.finalState);
    }
  });

  it('all random matchups terminate (no draws)', () => {
    const metaRng = new Rng(0xdeadbeef);
    for (let i = 0; i < 100; i++) {
      const config: CombatConfig = {
        player: randomCombatant(metaRng, 'hero'),
        enemy: randomCombatant(metaRng, 'foe'),
        skillBook,
      };
      const { result } = simulate(config, metaRng.int(2 ** 31));
      expect(result === 'win' || result === 'loss').toBe(true);
    }
  });

  it('combat is seed-independent — crits are metered, not rolled', () => {
    const make = (): CombatantSetup => ({
      name: 'x',
      stats: { maxHp: 200, hp: 200, attack: 10, magicPower: 0, armor: 0, magicResist: 0, speed: 10, critPct: 50 },
      boardSize: 10,
      pieces: [{ skillId: 'sword_slash', slot: 0 }],
    });
    const logs = new Set<string>();
    for (let seed = 0; seed < 10; seed++) {
      const { events } = simulate({ player: make(), enemy: make(), skillBook }, seed);
      logs.add(JSON.stringify(events));
    }
    // One setup, one outcome: every seed produces the identical fight.
    expect(logs.size).toBe(1);
  });

  it('crit meter cadence is exact: 50% crit = every 2nd strike, always', () => {
    const { events } = simulate(
      {
        player: {
          name: 'critter',
          stats: { maxHp: 500, hp: 500, attack: 10, magicPower: 0, armor: 0, magicResist: 0, speed: 20, critPct: 50 },
          boardSize: 10,
          pieces: [{ skillId: 'sword_slash', slot: 0 }],
        },
        enemy: {
          name: 'wall',
          stats: { maxHp: 500, hp: 500, attack: 0, magicPower: 0, armor: 0, magicResist: 0, speed: 1, critPct: 0 },
          boardSize: 6,
          pieces: [],
        },
        skillBook,
        suddenDeathRound: 999,
        fatigueTurn: 9999,
        maxTurns: 8,
      },
      1,
    );
    const crits = events.filter((e) => e.kind === 'damage' && e.side === 'enemy').map((e) => (e as { crit: boolean }).crit);
    // Bank: 50, 100(crit), 50, 100(crit) ... -> strikes 2, 4, 6 crit.
    expect(crits).toEqual([false, true, false, true, false, true, false, true].slice(0, crits.length));
  });
});
