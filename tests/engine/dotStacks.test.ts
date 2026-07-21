import { describe, expect, it } from 'vitest';
import { simulate } from '../../src/engine/combat/simulate';
import type { SkillBook } from '../../src/engine/types';
import { cfg, tc, NO_ENDGAME } from '../helpers';

type Events = ReturnType<typeof simulate>['events'];
type DamageEvent = Extract<Events[number], { kind: 'damage' }>;

// Decaying DoT model (user-locked 2026-07-20):
//   a tick deals damage EQUAL to the current stack count, then one stack
//   falls off — N stacks total N×(N+1)/2. Exact printed numbers: no stat
//   scaling, no matchup. New applications MERGE into the existing pile.
// Test books are not budget-audited (no tier/typing rules).

const B: SkillBook = {
  // Physical poison, 3 stacks. weight 1 so it fires first each turn.
  pois: {
    id: 'pois',
    name: 'Poison',
    archetypes: ['debuff'],
    property: 'physical',
    size: 1,
    speedWeight: 1,
    cooldownTurns: 20, // fire once early, don't reapply within the window
    rarity: 'common',
    tier: 'bronze',
    effects: [{ kind: 'poison', stacks: 3 }],
    text: '',
  },
  // Physical poison with a weapon, for the matchup-is-ignored proof.
  pois_sword: {
    id: 'pois_sword',
    name: 'Sword Poison',
    archetypes: ['debuff'],
    property: 'physical',
    weapon: 'sword',
    size: 1,
    speedWeight: 1,
    cooldownTurns: 20,
    rarity: 'common',
    tier: 'bronze',
    effects: [{ kind: 'poison', stacks: 4 }],
    text: '',
  },
  // Absorbing wall for the burn-vs-shield / poison-bypass proofs.
  wall_true: {
    id: 'wall_true',
    name: 'True Wall',
    archetypes: ['defensive'],
    property: 'true',
    size: 1,
    speedWeight: 5,
    rarity: 'common',
    tier: 'bronze',
    effects: [{ kind: 'shield', power: 500 }],
    text: '',
  },
  burn_apply: {
    id: 'burn_apply',
    name: 'Burn',
    archetypes: ['debuff'],
    property: 'physical',
    size: 1,
    speedWeight: 1,
    cooldownTurns: 20,
    rarity: 'common',
    tier: 'bronze',
    effects: [{ kind: 'burn', stacks: 3 }],
    text: '',
  },
};

const OPT = { ...NO_ENDGAME, skillBook: B } as const;

function enemyDots(events: Events, source: 'poison' | 'burn'): DamageEvent[] {
  return events.filter((e): e is DamageEvent => e.kind === 'damage' && e.side === 'enemy' && e.source === source);
}

describe('decaying DoT model', () => {
  it('ticks the current stack count, then one stack falls off: 3 → 3,2,1 then expires', () => {
    const c = cfg(
      tc('hero', ['pois'], { attack: 20, speed: 20, maxHp: 500 }, { skillBook: B }),
      tc('foe', [], { armor: 99, speed: 1, maxHp: 5000 }, { skillBook: B }),
      { ...OPT, maxTurns: 6, cooldownsEnabled: true },
    );
    const { events } = simulate(c, 1);
    const ticks = enemyDots(events, 'poison');
    expect(ticks.map((t) => t.amount)).toEqual([3, 2, 1]);
    const expired = events.some((e) => e.kind === 'statusExpired' && e.status === 'poison');
    expect(expired).toBe(true);
  });

  it('ticks are exact printed numbers — the caster stat does not scale them', () => {
    const low = cfg(
      tc('hero', ['pois'], { attack: 3, speed: 20, maxHp: 500 }, { skillBook: B }),
      tc('foe', [], { armor: 99, speed: 1, maxHp: 5000 }, { skillBook: B }),
      { ...OPT, maxTurns: 6, cooldownsEnabled: true },
    );
    const high = cfg(
      tc('hero', ['pois'], { attack: 200, speed: 20, maxHp: 500 }, { skillBook: B }),
      tc('foe', [], { armor: 99, speed: 1, maxHp: 5000 }, { skillBook: B }),
      { ...OPT, maxTurns: 6, cooldownsEnabled: true },
    );
    expect(enemyDots(simulate(low, 1).events, 'poison').map((t) => t.amount)).toEqual([3, 2, 1]);
    expect(enemyDots(simulate(high, 1).events, 'poison').map((t) => t.amount)).toEqual([3, 2, 1]);
  });

  it('matchup does not modify ticks (sword poison vs axe-affinity foe stays 4,3,2,1)', () => {
    const c = cfg(
      tc('hero', ['pois_sword'], { attack: 10, speed: 20, maxHp: 500 }, { skillBook: B }),
      { ...tc('foe', [], { armor: 99, speed: 1, maxHp: 5000 }, { skillBook: B }), weaponAffinity: 'axe' },
      { ...OPT, maxTurns: 7, cooldownsEnabled: true },
    );
    expect(enemyDots(simulate(c, 1).events, 'poison').map((t) => t.amount)).toEqual([4, 3, 2, 1]);
  });

  it('new applications MERGE into the existing pile (3 + 4 the same turn → one pile ticking 7,6,5…)', () => {
    const c = cfg(
      tc('hero', ['pois', 'pois_sword'], { attack: 20, speed: 40, maxHp: 500 }, { skillBook: B }),
      tc('foe', [], { armor: 99, speed: 1, maxHp: 5000 }, { skillBook: B }),
      { ...OPT, maxTurns: 5, cooldownsEnabled: true },
    );
    const { events, finalState } = simulate(c, 1);
    const ticks = enemyDots(events, 'poison');
    expect(ticks.slice(0, 3).map((t) => t.amount)).toEqual([7, 6, 5]);
    // One pile, not two: at most a single poison status on the victim.
    expect(finalState.enemy.statuses.filter((s) => s.kind === 'poison').length).toBeLessThanOrEqual(1);
  });

  it('poison bypasses shields; burn is absorbed by them', () => {
    // Foe self-shields (true, blocks all). Poison ticks unblocked; burn blocked.
    const poisonRun = cfg(
      tc('hero', ['pois'], { attack: 20, speed: 20, maxHp: 500 }, { skillBook: B }),
      tc('foe', ['wall_true'], { speed: 10, maxHp: 5000 }, { skillBook: B }),
      { ...OPT, maxTurns: 4, cooldownsEnabled: true },
    );
    const poison = enemyDots(simulate(poisonRun, 1).events, 'poison');
    expect(poison.length).toBeGreaterThan(0);
    for (const t of poison) expect(t.blocked).toBe(0);

    const burnRun = cfg(
      tc('hero', ['burn_apply'], { attack: 20, speed: 20, maxHp: 500 }, { skillBook: B }),
      tc('foe', ['wall_true'], { speed: 30, maxHp: 5000 }, { skillBook: B }),
      { ...OPT, maxTurns: 4, cooldownsEnabled: true },
    );
    const burn = enemyDots(simulate(burnRun, 1).events, 'burn');
    expect(burn.length).toBeGreaterThan(0);
    // Each decaying tick (3, then 2, …) is fully absorbed by the 500 wall.
    for (const t of burn) expect(t.blocked).toBe(t.amount);
  });
});

describe('cleanse removes one stack per charge', () => {
  const CB: SkillBook = {
    // Enemy applies a fat poison pile (5 stacks) to the hero.
    pile: {
      id: 'pile',
      name: 'Pile',
      archetypes: ['debuff'],
      property: 'physical',
      size: 1,
      speedWeight: 1,
      cooldownTurns: 50,
      rarity: 'common',
      tier: 'bronze',
      effects: [{ kind: 'poison', stacks: 5 }],
      text: '',
    },
    // Hero cleanses 2 charges, heavy so it fires after the pile has landed.
    cleanse2: {
      id: 'cleanse2',
      name: 'Cleanse 2',
      archetypes: ['healing'],
      property: 'true',
      size: 1,
      speedWeight: 40,
      cooldownTurns: 50,
      rarity: 'common',
      tier: 'bronze',
      effects: [{ kind: 'cleanse', charges: 2 }],
      text: '',
    },
  };
  const CBOPT = { ...NO_ENDGAME, skillBook: CB } as const;

  it('decrements a stacking pile by one stack per charge (partial removal, not whole)', () => {
    // Turn 1: foe applies the 5-stack pile (fresh, no tick). Turn 2: the hero
    // affords the weight-40 cleanse (speed 20 × 2), strips 2 stacks → 3, then
    // the end-of-turn tick deals 3 and decays the pile to 2.
    const c = cfg(
      tc('hero', ['cleanse2'], { attack: 0, speed: 20, maxHp: 5000 }, { skillBook: CB }),
      tc('foe', ['pile'], { attack: 10, speed: 10, maxHp: 5000 }, { skillBook: CB }),
      { ...CBOPT, maxTurns: 2, cooldownsEnabled: true },
    );
    const { events, finalState } = simulate(c, 1);
    const cleansed = events.find((e) => e.kind === 'cleansed' && e.side === 'player');
    // 2 charges strip 2 stacks from the 5-stack pile -> `removed` counts STACKS.
    expect(cleansed).toMatchObject({ removed: 2 });
    const poison = finalState.player.statuses.find((s) => s.kind === 'poison');
    expect(poison).toBeDefined();
    expect(poison!.stacks).toBe(2);
  });
});
