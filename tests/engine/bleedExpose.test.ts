import { describe, expect, it } from 'vitest';
import { simulate } from '../../src/engine/combat/simulate';
import type { SkillBook } from '../../src/engine/types';
import { cfg, tc, NO_ENDGAME } from '../helpers';

type Events = ReturnType<typeof simulate>['events'];
type DamageEvent = Extract<Events[number], { kind: 'damage' }>;

// Custom book for the bleed / expose / charged-cleanse mechanics. Test books
// are not audited (no tier-budget / typing rules), so cards omit weapon/element.
const B: SkillBook = {
  // Applies a per-performance bleed to the enemy (no direct damage of its own
  // beyond the min-1 floor from attack 0).
  bleed_apply: {
    id: 'bleed_apply',
    name: 'Bleed',
    archetypes: ['debuff'],
    property: 'physical',
    size: 1,
    speedWeight: 1,
    rarity: 'common',
    tier: 'bronze',
    effects: [{ kind: 'bleed', stacks: 10 }],
    text: '',
  },
  // Enemy self-shield so we can prove bleed bypasses shields.
  shield_self: {
    id: 'shield_self',
    name: 'Shield',
    archetypes: ['defensive'],
    property: 'true',
    size: 1,
    speedWeight: 5,
    rarity: 'common',
    tier: 'bronze',
    effects: [{ kind: 'shield', power: 40 }],
    text: '',
  },
  // Expose then hit, in board order.
  expose_apply: {
    id: 'expose_apply',
    name: 'Expose',
    archetypes: ['debuff'],
    property: 'magical',
    size: 1,
    speedWeight: 1,
    rarity: 'common',
    tier: 'bronze',
    effects: [{ kind: 'expose', pct: 50, turns: 5 }],
    text: '',
  },
  expose_double: {
    id: 'expose_double',
    name: 'Double Expose',
    archetypes: ['debuff'],
    property: 'magical',
    size: 1,
    speedWeight: 1,
    rarity: 'common',
    tier: 'bronze',
    effects: [
      { kind: 'expose', pct: 50, turns: 5 },
      { kind: 'expose', pct: 50, turns: 5 },
    ],
    text: '',
  },
  hit_sword: {
    id: 'hit_sword',
    name: 'Hit',
    archetypes: ['offense'],
    property: 'physical',
    size: 1,
    speedWeight: 5,
    weapon: 'sword',
    rarity: 'common',
    tier: 'bronze',
    effects: [{ kind: 'damage', power: 20 }],
    text: '',
  },
  poison_apply: {
    id: 'poison_apply',
    name: 'Poison',
    archetypes: ['debuff'],
    property: 'physical',
    size: 1,
    speedWeight: 5,
    rarity: 'common',
    tier: 'bronze',
    effects: [{ kind: 'poison', stacks: 10 }],
    text: '',
  },
  // Cleanse charges = 1, heavy so it fires late (after afflictions land + tick).
  cleanse1: {
    id: 'cleanse1',
    name: 'Cleanse 1',
    archetypes: ['healing'],
    property: 'true',
    size: 1,
    speedWeight: 20,
    rarity: 'common',
    tier: 'bronze',
    effects: [{ kind: 'cleanse', charges: 1 }],
    text: '',
  },
  // Enemy applies two debuffs of DIFFERENT durations (armor 6t idx0, magicResist
  // 2t idx1). Neither touches Speed, so the hero's cleanse cadence stays fixed.
  afflict_mixed: {
    id: 'afflict_mixed',
    name: 'Mixed Debuffs',
    archetypes: ['debuff'],
    property: 'physical',
    size: 1,
    speedWeight: 30,
    rarity: 'common',
    tier: 'bronze',
    effects: [
      { kind: 'debuffStat', stat: 'armor', pct: 10, turns: 6 },
      { kind: 'debuffStat', stat: 'magicResist', pct: 10, turns: 2 },
    ],
    text: '',
  },
  // Enemy applies two debuffs of the SAME duration (armor idx0, magicResist idx1).
  afflict_tied: {
    id: 'afflict_tied',
    name: 'Tied Debuffs',
    archetypes: ['debuff'],
    property: 'physical',
    size: 1,
    speedWeight: 30,
    rarity: 'common',
    tier: 'bronze',
    effects: [
      { kind: 'debuffStat', stat: 'armor', pct: 10, turns: 6 },
      { kind: 'debuffStat', stat: 'magicResist', pct: 10, turns: 6 },
    ],
    text: '',
  },
};

const OPT = { ...NO_ENDGAME, skillBook: B } as const;

function enemyDamage(events: Events): DamageEvent[] {
  return events.filter((e): e is DamageEvent => e.kind === 'damage' && e.side === 'enemy');
}

describe('bleed', () => {
  it('ticks when the victim PERFORMS (not at turn start) and bypasses shields', () => {
    const c = cfg(
      tc('hero', ['bleed_apply'], { attack: 0, speed: 20, maxHp: 500 }, { skillBook: B }),
      tc('foe', ['shield_self'], { magicPower: 0, speed: 10, maxHp: 1000 }, { skillBook: B }),
      { ...OPT, maxTurns: 4 },
    );
    const { events, finalState } = simulate(c, 1);
    const bleeds = enemyDamage(events).filter((e) => e.source === 'bleed');
    expect(bleeds.length).toBeGreaterThan(0);

    // No bleed tick on the application turn (fresh): the enemy performed on
    // turn 1 but bleed was applied that same turn.
    expect(bleeds.every((e) => e.turn >= 2)).toBe(true);

    // Every bleed tick lands on a turn the enemy PERFORMED (perform-gated, not
    // start-of-turn like poison/burn).
    const enemyPerformTurns = new Set(
      events.filter((e) => e.kind === 'performStart' && e.side === 'enemy').map((e) => e.turn),
    );
    expect(bleeds.every((e) => enemyPerformTurns.has(e.turn))).toBe(true);

    // Bypasses shields: nothing blocked, even though the enemy is shielded.
    expect(bleeds.every((e) => e.blocked === 0)).toBe(true);
    expect(finalState.enemy.shields.true).toBeGreaterThan(0);
    expect(finalState.enemy.stats.hp).toBeLessThan(finalState.enemy.stats.maxHp);
  });
});

describe('expose', () => {
  it('amplifies a direct hit by +pct% (floored)', () => {
    const c = cfg(
      tc('hero', ['expose_apply', 'hit_sword'], { attack: 10, speed: 20, maxHp: 500 }, { skillBook: B }),
      tc('foe', [], { armor: 0, speed: 1, maxHp: 1000 }, { skillBook: B }),
      { ...OPT, maxTurns: 1 },
    );
    const hit = enemyDamage(simulate(c, 1).events).find((e) => e.source === 'skill')!;
    // base 20 + Attack 10 = 30; expose 50% -> 30 + floor(30*0.5)=15 = 45.
    expect(hit).toMatchObject({ amount: 45, exposed: 15 });
  });

  // ONE PILE PER VICTIM. This test used to assert the opposite — two exposes
  // compounding to 67 damage — which was the shipped defect, not the rule: with
  // `expose` also missing from the turn-decrement set, a repeating card opened a
  // new pile every cast and the multiplier ran away (30 -> 45 -> 67 -> 100 ->
  // 181 -> ... measured, with zero `statusExpired` events). See
  // tests/engine/statusExpiry.test.ts for the duration half and the reasoning.
  it('a second expose REFRESHES the one pile instead of opening a second (no compounding)', () => {
    const c = cfg(
      tc('hero', ['expose_double', 'hit_sword'], { attack: 10, speed: 20, maxHp: 500 }, { skillBook: B }),
      tc('foe', [], { armor: 0, speed: 1, maxHp: 1000 }, { skillBook: B }),
      { ...OPT, maxTurns: 1 },
    );
    const { events, finalState } = simulate(c, 1);
    const hit = enemyDamage(events).find((e) => e.source === 'skill')!;
    // Identical to a SINGLE expose: 30 -> +floor(30*.5)=15 -> 45.
    expect(hit).toMatchObject({ amount: 45, exposed: 15 });
    expect(finalState.enemy.statuses.filter((s) => s.kind === 'expose')).toHaveLength(1);
  });

  it('applies AFTER the matchup multiplier (matchup baked first, then amplified)', () => {
    const c = cfg(
      tc('hero', ['expose_apply', 'hit_sword'], { attack: 10, speed: 20, maxHp: 500 }, { skillBook: B }),
      { ...tc('foe', [], { armor: 0, speed: 1, maxHp: 1000 }, { skillBook: B }), weaponAffinity: 'axe' },
      { ...OPT, maxTurns: 1 },
    );
    const hit = enemyDamage(simulate(c, 1).events).find((e) => e.source === 'skill')!;
    // sword beats axe (+50%): 30 -> floor(30*1.5)=45, THEN expose 50%: 45 + 22 = 67.
    expect(hit).toMatchObject({ amount: 67, exposed: 22, matchup: 'advantage' });
  });

  it('does NOT amplify DoT ticks (poison unaffected)', () => {
    const c = cfg(
      tc('hero', ['expose_apply', 'poison_apply'], { attack: 0, speed: 20, maxHp: 500 }, { skillBook: B }),
      tc('foe', [], { armor: 0, speed: 1, maxHp: 1000 }, { skillBook: B }),
      { ...OPT, maxTurns: 3 },
    );
    const poison = enemyDamage(simulate(c, 1).events).find((e) => e.source === 'poison')!;
    // Two 10-stack applications merged (turns 1+2) → first tick is the raw
    // 20-stack pile, with NO expose amplification on top.
    expect(poison.amount).toBe(20);
    expect(poison.exposed).toBeUndefined();
  });
});

describe('charged cleanse', () => {
  it('removes only `charges` effects, expiring-soonest first (partial removal)', () => {
    const c = cfg(
      tc('hero', ['cleanse1'], { speed: 10, maxHp: 5000 }, { skillBook: B }),
      tc('foe', ['afflict_mixed'], { speed: 10, maxHp: 1000 }, { skillBook: B }),
      { ...OPT, maxTurns: 4 },
    );
    const { events, finalState } = simulate(c, 1);
    const cleansed = events.filter((e) => e.kind === 'cleansed' && e.side === 'player');
    expect(cleansed.some((e) => (e as { removed: number }).removed === 1)).toBe(true);
    const debuffs = finalState.player.statuses.filter((s) => s.kind === 'debuff');
    // magicResist (2 turns) was soonest -> removed; armor (6 turns) survives —
    // even though armor was applied FIRST, soonest-to-expire wins over index.
    expect(debuffs.some((s) => s.stat === 'armor')).toBe(true);
    expect(debuffs.some((s) => s.stat === 'magicResist')).toBe(false);
  });

  it('breaks duration ties by application order (earliest-applied first)', () => {
    const c = cfg(
      tc('hero', ['cleanse1'], { speed: 10, maxHp: 5000 }, { skillBook: B }),
      tc('foe', ['afflict_tied'], { speed: 10, maxHp: 1000 }, { skillBook: B }),
      { ...OPT, maxTurns: 4 },
    );
    const { finalState } = simulate(c, 1);
    const debuffs = finalState.player.statuses.filter((s) => s.kind === 'debuff');
    // Both 6 turns; armor was applied first (index 0) -> removed on the tie;
    // magicResist (index 1) survives.
    expect(debuffs.some((s) => s.stat === 'armor')).toBe(false);
    expect(debuffs.some((s) => s.stat === 'magicResist')).toBe(true);
  });
});
