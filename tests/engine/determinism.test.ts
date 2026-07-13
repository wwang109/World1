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

  it('team fixtures: identical events + finalState across two runs, all terminate', () => {
    // Fixed multi-unit shapes: 1×1 (regression), 1×3, 3×3, asymmetric 2×4.
    const team = (rng: Rng, n: number, tag: string): CombatantSetup[] =>
      Array.from({ length: n }, (_, i) => randomCombatant(rng, `${tag}${i}`));

    const shapes: Array<[number, number]> = [
      [1, 1],
      [1, 3],
      [3, 3],
      [2, 4],
    ];
    const metaRng = new Rng(0xa11ce);
    for (const [np, ne] of shapes) {
      for (let rep = 0; rep < 8; rep++) {
        const config: CombatConfig = {
          playerTeam: team(metaRng, np, 'p'),
          enemyTeam: team(metaRng, ne, 'e'),
          skillBook,
        };
        const seed = metaRng.int(2 ** 31);
        const a = simulate(structuredClone(config), seed);
        const b = simulate(structuredClone(config), seed);
        expect(a.events).toEqual(b.events);
        expect(a.result).toBe(b.result);
        expect(a.finalState).toEqual(b.finalState);
        expect(a.result === 'win' || a.result === 'loss').toBe(true);
      }
    }
  });

  it('random teams (1–4 per side) are deterministic and terminate (60 configs)', () => {
    const metaRng = new Rng(0x7ea115);
    for (let i = 0; i < 60; i++) {
      const np = 1 + metaRng.int(4);
      const ne = 1 + metaRng.int(4);
      const config: CombatConfig = {
        playerTeam: Array.from({ length: np }, (_, k) => randomCombatant(metaRng, `p${k}`)),
        enemyTeam: Array.from({ length: ne }, (_, k) => randomCombatant(metaRng, `e${k}`)),
        skillBook,
      };
      const seed = metaRng.int(2 ** 31);
      const a = simulate(structuredClone(config), seed);
      const b = simulate(structuredClone(config), seed);
      expect(a.events).toEqual(b.events);
      expect(a.finalState).toEqual(b.finalState);
      expect(a.result === 'win' || a.result === 'loss').toBe(true);
    }
  });

  it('different seeds can diverge (crit rolls consume RNG)', () => {
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
    expect(logs.size).toBeGreaterThan(1);
  });
});
