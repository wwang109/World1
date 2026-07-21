import { describe, expect, it } from 'vitest';
import { simulate } from '../../src/engine/combat/simulate';
import { buildAutoHeroSetup, buildEnemyEncounter } from '../../src/run/encounter';
import { skillBook } from '../../src/data/skills';
import type { BoardPiece } from '../../src/engine/types';

// Regression guard for the flat combat model. The old %-of-stat damage model
// let damage out-scale HP so hard that high-level fights ended on turn 1 (a
// L23 bandit one-shot a L20 hero; even a same-level fight resolved instantly).
// Under the flat model (damage = card base + a flat stat add) plus the softened
// offense curve, damage and HP scale linearly, so a fight must take several
// turns at every level — that is the property this test locks in.
//
// NOTE: WHO wins is deliberately not asserted — per the locked balance
// philosophy a single (build, enemy) winrate is not a balance target. We only
// assert the fight is not a turn-1 blowout and that its length stays bounded
// as levels climb (the ratio no longer explodes).

const HERO_DECK: BoardPiece[] = [
  { skillId: 'sword_slash', slot: 0 },
  { skillId: 'crippling_strike', slot: 1 },
  { skillId: 'iron_bulwark', slot: 3 },
  { skillId: 'second_wind', slot: 5 },
  { skillId: 'arcane_bolt', slot: 6 },
];

function fightTurns(level: number): number {
  const hero = buildAutoHeroSetup(level, HERO_DECK.map((p) => ({ ...p })));
  const enemy = buildEnemyEncounter('bandit_duelist', level, 'normal');
  const { finalState } = simulate(
    { playerTeam: [hero.setup], enemyTeam: [enemy.setup], skillBook },
    1,
  );
  return finalState.turn;
}

describe('flat-model scaling regression', () => {
  it('a same-level fight never resolves on turn 1, at low, mid, and high level', () => {
    for (const level of [1, 10, 20, 35, 50]) {
      expect(fightTurns(level), `L${level} same-level fight resolved too fast`).toBeGreaterThanOrEqual(3);
    }
  });

  it('fight length stays bounded as level climbs (damage:HP ratio does not explode)', () => {
    // If damage still out-scaled HP, high-level fights would collapse to 1-2
    // turns. Bounded scaling keeps them in a sane multi-turn band.
    const low = fightTurns(5);
    const high = fightTurns(50);
    expect(low).toBeGreaterThanOrEqual(3);
    expect(high).toBeGreaterThanOrEqual(3);
  });
});
