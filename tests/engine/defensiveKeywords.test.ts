import { describe, expect, it } from 'vitest';
import { simulate } from '../../src/engine/combat/simulate';
import type { SkillBook } from '../../src/engine/types';
import { cfg, tc, NO_ENDGAME } from '../helpers';

type Events = ReturnType<typeof simulate>['events'];
type DamageEvent = Extract<Events[number], { kind: 'damage' }>;

/** Book for Magical Guard / Magical Negate scenarios. */
const KW_BOOK: SkillBook = {
  // ---- Defensive keywords (hero self-casts) ----
  guard_m: {
    id: 'guard_m',
    name: 'Magical Guard',
    archetypes: ['defensive'],
    property: 'magical',
    size: 1,
    speedWeight: 5, // casts before the enemy's weight-10 bolt on turn 1
    rarity: 'rare',
    tier: 'bronze',
    effects: [{ kind: 'guard', property: 'magical', pct: 50, turns: 5 }],
    text: '',
  },
  guard_m_double: {
    id: 'guard_m_double',
    name: 'Double Magical Guard',
    archetypes: ['defensive'],
    property: 'magical',
    size: 1,
    speedWeight: 5,
    rarity: 'epic',
    tier: 'bronze',
    effects: [
      { kind: 'guard', property: 'magical', pct: 50, turns: 5 },
      { kind: 'guard', property: 'magical', pct: 50, turns: 5 },
    ],
    text: '',
  },
  guard_m_over: {
    id: 'guard_m_over',
    name: 'Overtuned Guard',
    archetypes: ['defensive'],
    property: 'magical',
    size: 1,
    speedWeight: 5,
    rarity: 'epic',
    tier: 'bronze',
    effects: [{ kind: 'guard', property: 'magical', pct: 90, turns: 5 }], // clamps to 60
    text: '',
  },
  // ---- Negate variants ----
  negate_m3: {
    id: 'negate_m3',
    name: 'Negate (big)',
    archetypes: ['defensive'],
    property: 'magical',
    size: 3, // busies the hero 2 turns so the enemy hits twice
    speedWeight: 3,
    rarity: 'epic',
    tier: 'bronze',
    effects: [{ kind: 'negate', property: 'magical', charges: 1 }],
    text: '',
  },
  negate_m1: {
    id: 'negate_m1',
    name: 'Negate',
    archetypes: ['defensive'],
    property: 'magical',
    size: 1,
    speedWeight: 1,
    rarity: 'rare',
    tier: 'bronze',
    effects: [{ kind: 'negate', property: 'magical', charges: 1 }],
    text: '',
  },
  negate_cap: {
    id: 'negate_cap',
    name: 'Overcharged Negate',
    archetypes: ['defensive'],
    property: 'magical',
    size: 1,
    speedWeight: 1,
    rarity: 'epic',
    tier: 'bronze',
    effects: [{ kind: 'negate', property: 'magical', charges: 5 }], // clamps to 3
    text: '',
  },
  shield_negate: {
    id: 'shield_negate',
    name: 'Warded Barrier',
    archetypes: ['defensive'],
    property: 'magical',
    size: 3,
    speedWeight: 3,
    rarity: 'epic',
    tier: 'bronze',
    effects: [
      { kind: 'shield', power: 200 },
      { kind: 'negate', property: 'magical', charges: 1 },
    ],
    text: '',
  },
  // ---- Enemy attacks ----
  mbolt: {
    id: 'mbolt',
    name: 'Magic Bolt',
    archetypes: ['offense'],
    property: 'magical',
    size: 1,
    speedWeight: 10,
    rarity: 'common',
    tier: 'bronze',
    effects: [{ kind: 'damage', power: 100 }],
    text: '',
  },
  tbolt: {
    id: 'tbolt',
    name: 'True Bolt',
    archetypes: ['offense'],
    property: 'true',
    size: 1,
    speedWeight: 10,
    rarity: 'epic',
    tier: 'bronze',
    effects: [{ kind: 'damage', power: 100 }],
    text: '',
  },
  mburn: {
    id: 'mburn',
    name: 'Magic Burn',
    archetypes: ['debuff'],
    property: 'magical',
    size: 1,
    speedWeight: 10,
    rarity: 'common',
    tier: 'bronze',
    effects: [{ kind: 'burn', amount: 20, turns: 5 }],
    text: '',
  },
};

const OPT = { ...NO_ENDGAME, skillBook: KW_BOOK } as const;

function heroDamage(events: Events): DamageEvent[] {
  return events.filter((e): e is DamageEvent => e.kind === 'damage' && e.side === 'player');
}

describe('Magical Guard', () => {
  it('reduces a matching-property hit multiplicatively (floored)', () => {
    const c = cfg(
      tc('hero', ['guard_m'], { magicResist: 0, speed: 10, maxHp: 500 }, { skillBook: KW_BOOK }),
      tc('mage', ['mbolt'], { magicPower: 40, speed: 10 }, { skillBook: KW_BOOK }),
      { ...OPT, maxTurns: 2 },
    );
    const first = heroDamage(simulate(c, 1).events)[0]!;
    // 40 magical -> floor(40 * (100-50)/100) = 20.
    expect(first).toMatchObject({ amount: 20, property: 'magical', guarded: 20 });
  });

  it('covers a matching-property burn tick', () => {
    const c = cfg(
      tc('hero', ['guard_m'], { magicResist: 0, speed: 10, maxHp: 500 }, { skillBook: KW_BOOK }),
      tc('mage', ['mburn'], { speed: 10, maxHp: 500 }, { skillBook: KW_BOOK }),
      { ...OPT, maxTurns: 4 },
    );
    const burn = simulate(c, 1)
      .events.filter((e): e is DamageEvent => e.kind === 'damage' && e.side === 'player' && e.source === 'burn')[0]!;
    // burn 20 -> floor(20 * 0.5) = 10 through the magical guard.
    expect(burn).toMatchObject({ amount: 10, property: 'magical', guarded: 10, source: 'burn' });
  });

  it('true damage bypasses a magical guard for free', () => {
    const c = cfg(
      tc('hero', ['guard_m'], { magicResist: 0, speed: 10, maxHp: 500 }, { skillBook: KW_BOOK }),
      tc('mage', ['tbolt'], { attack: 0, magicPower: 40, speed: 10 }, { skillBook: KW_BOOK }),
      { ...OPT, maxTurns: 2 },
    );
    const first = heroDamage(simulate(c, 1).events)[0]!;
    // true damage: 100% of max(0,40) = 40, unreduced; no guarded field.
    expect(first).toMatchObject({ amount: 40, property: 'true' });
    expect(first.guarded).toBeUndefined();
  });

  it('two guards stack multiplicatively', () => {
    const c = cfg(
      tc('hero', ['guard_m_double'], { magicResist: 0, speed: 10, maxHp: 500 }, { skillBook: KW_BOOK }),
      tc('mage', ['mbolt'], { magicPower: 40, speed: 10 }, { skillBook: KW_BOOK }),
      { ...OPT, maxTurns: 2 },
    );
    const first = heroDamage(simulate(c, 1).events)[0]!;
    // 40 -> floor(40*0.5)=20 -> floor(20*0.5)=10; total reduced 30.
    expect(first).toMatchObject({ amount: 10, guarded: 30 });
  });

  it('clamps a single guard pct to 60 at apply time', () => {
    const c = cfg(
      tc('hero', ['guard_m_over'], { magicResist: 0, speed: 10, maxHp: 500 }, { skillBook: KW_BOOK }),
      tc('mage', ['mbolt'], { magicPower: 40, speed: 10 }, { skillBook: KW_BOOK }),
      { ...OPT, maxTurns: 2 },
    );
    const first = heroDamage(simulate(c, 1).events)[0]!;
    // pct 90 clamped to 60: floor(40 * 40/100) = 16, reduced 24.
    expect(first).toMatchObject({ amount: 16, guarded: 24 });
  });
});

describe('Magical Negate', () => {
  it('nullifies the next direct magical hit, spends a charge, and the following hit lands', () => {
    const c = cfg(
      tc('hero', ['negate_m3'], { magicResist: 0, speed: 10, maxHp: 500 }, { skillBook: KW_BOOK }),
      tc('mage', ['mbolt'], { magicPower: 40, speed: 10 }, { skillBook: KW_BOOK }),
      { ...OPT, maxTurns: 3 },
    );
    const { events } = simulate(c, 1);
    const negated = events.filter((e) => e.kind === 'negated');
    const hits = heroDamage(events);
    expect(negated.length).toBe(1);
    expect(negated[0]).toMatchObject({ side: 'player', property: 'magical' });
    // First enemy bolt is negated (no damage on that turn); the second lands full.
    expect(hits.length).toBe(1);
    expect(hits[0]).toMatchObject({ amount: 40, property: 'magical' });
    expect(hits[0]!.turn).toBeGreaterThan(negated[0]!.turn);
  });

  it('does NOT consume a charge on a burn tick', () => {
    const c = cfg(
      tc('hero', ['negate_m1'], { magicResist: 0, speed: 10, maxHp: 500 }, { skillBook: KW_BOOK }),
      tc('mage', ['mburn'], { speed: 10, maxHp: 500 }, { skillBook: KW_BOOK }),
      { ...OPT, maxTurns: 5 },
    );
    const { events, finalState } = simulate(c, 1);
    // The burn still ticks (was not negated) and no charge was spent.
    expect(events.some((e) => e.kind === 'damage' && e.side === 'player' && e.source === 'burn')).toBe(true);
    expect(events.some((e) => e.kind === 'negated')).toBe(false);
    const neg = finalState.player.statuses.find((s) => s.kind === 'negate');
    expect(neg && (neg.charges ?? 0) >= 1).toBe(true);
  });

  it('clamps total charges of a property to 3 at apply time', () => {
    const c = cfg(
      tc('hero', ['negate_cap'], { speed: 10, maxHp: 500 }, { skillBook: KW_BOOK }),
      tc('dummy', [], { speed: 1 }, { skillBook: KW_BOOK }),
      { ...OPT, maxTurns: 1 },
    );
    const { finalState } = simulate(c, 1);
    const neg = finalState.player.statuses.find((s) => s.kind === 'negate');
    expect(neg?.charges).toBe(3);
  });

  it('a negated hit spends no shield', () => {
    const c = cfg(
      tc('hero', ['shield_negate'], { magicPower: 20, magicResist: 0, speed: 10, maxHp: 200 }, { skillBook: KW_BOOK }),
      tc('mage', ['mbolt'], { magicPower: 40, speed: 10 }, { skillBook: KW_BOOK }),
      { ...OPT, maxTurns: 2 },
    );
    const { events, finalState } = simulate(c, 1);
    expect(events.some((e) => e.kind === 'negated' && e.side === 'player')).toBe(true);
    // Bolt was negated before shields: the magical pool (40) is untouched.
    expect(finalState.player.shields.magical).toBe(40);
    expect(heroDamage(events).length).toBe(0);
  });
});
