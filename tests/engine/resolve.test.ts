import { describe, expect, it } from 'vitest';
import { simulate } from '../../src/engine/combat/simulate';
import { cfg, tc, NO_ENDGAME } from '../helpers';

type Events = ReturnType<typeof simulate>['events'];

function statusAmount(events: Events, side: 'player' | 'enemy') {
  const s = events.find((e) => e.kind === 'statusApplied' && e.side === side);
  return s ? (s as { turns: number }) : undefined;
}

describe('resolve — the effect resistance/potency check', () => {
  it('weakens incoming DoT amounts (40 resolve = 40% weaker poison)', () => {
    const c = cfg(
      tc('hero', ['venom_fang'], { attack: 10, speed: 20, maxHp: 500 }),
      tc('stoic', [], { maxHp: 500, resolve: 40 }),
      { ...NO_ENDGAME, maxTurns: 2 },
    );
    const { events } = simulate(c, 1);
    // Poison 5 -> floor(5 * 0.6) = 3 per tick.
    const tick = events.find((e) => e.kind === 'damage' && e.source === 'poison');
    expect(tick).toMatchObject({ amount: 3 });
  });

  it('fully resists a 1-turn stun past 50 resolve', () => {
    const c = cfg(
      tc('hero', ['sword_slash'], { attack: 1, speed: 5, maxHp: 500, resolve: 60 }),
      tc('smasher', ['stunning_smash'], { attack: 10, speed: 30, maxHp: 500 }),
      { ...NO_ENDGAME, maxTurns: 3 },
    );
    const { events } = simulate(c, 1);
    expect(events.find((e) => e.kind === 'resisted' && e.side === 'player' && e.status === 'stun')).toBeDefined();
    expect(events.some((e) => e.kind === 'statusApplied' && e.side === 'player' && e.status === 'stun')).toBe(false);
  });

  it('weakens hostile slows and staggers', () => {
    const c = cfg(
      tc('hero', ['hamstring'], { attack: 10, speed: 20, maxHp: 500 }),
      tc('stoic', ['sword_slash'], { attack: 1, speed: 10, maxHp: 500, resolve: 50 }),
      { ...NO_ENDGAME, maxTurns: 3 },
    );
    const { events } = simulate(c, 1);
    // Hamstring +16 weight -> floor(16 * 0.5) = 8.
    const slowed = events.find((e) => e.kind === 'slowedNext');
    expect(slowed).toMatchObject({ weight: 8 });
  });

  it('debuffing resolve below zero AMPLIFIES your effects (Expose Weakness)', () => {
    // Expose (-25 resolve) first, then venom: poison 5 -> floor(5 * 1.25) = 6.
    const c = cfg(
      tc('hero', ['expose_weakness', 'venom_fang'], { attack: 10, speed: 20, maxHp: 500 }),
      tc('wall', [], { maxHp: 500, speed: 1 }),
      { ...NO_ENDGAME, maxTurns: 3 },
    );
    const { events } = simulate(c, 1);
    const tick = events.find((e) => e.kind === 'damage' && e.source === 'poison');
    expect(tick).toMatchObject({ amount: 6 });
  });

  it('Iron Will grants temporary resolve that gates enemy debuffs', () => {
    // Hero wills up (+40 resolve, 2 turns); the foe's Crippling Strike debuff
    // (-25% attack) lands at floor(25 * 0.6) = 15%.
    const c = cfg(
      tc('hero', ['iron_will'], { attack: 10, speed: 20, maxHp: 500 }),
      tc('foe', ['crippling_strike'], { attack: 10, speed: 30, maxHp: 500 }),
      { ...NO_ENDGAME, maxTurns: 3 },
    );
    const { events, finalState } = simulate(c, 1);
    expect(events.some((e) => e.kind === 'statusApplied' && e.side === 'player' && e.status === 'buff')).toBe(true);
    const debuff = finalState.player[0]!.statuses.find((s) => s.kind === 'debuff');
    expect(debuff?.pct).toBe(15);
  });
});
