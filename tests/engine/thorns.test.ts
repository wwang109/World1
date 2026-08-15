import { describe, expect, it } from 'vitest';
import { simulate } from '../../src/engine/combat/simulate';
import type { CombatConfig, CombatantSetup, SkillBook, SkillDef } from '../../src/engine/types';
import type { CombatEvent } from '../../src/engine/combat/events';

/**
 * THORNS — reflect-on-hit self buff.
 *
 * Contract under test (see the Action doc in src/engine/types.ts):
 *  - a direct skill hit on a thorned unit stings the ATTACKER for the pile's
 *    current stack count as TRUE damage, then the pile loses one stack;
 *  - the pile expires (statusExpired) when it reaches 0;
 *  - DoT ticks never trigger it;
 *  - reflect damage never triggers the attacker's own thorns (non-reentrant),
 *    even when BOTH sides are thorned;
 *  - a killing blow is not reflected (first to fall loses).
 */

const book: SkillBook = {
  jab: {
    id: 'jab', name: 'Jab', archetypes: ['offense'], property: 'physical', size: 1,
    rarity: 'common', tier: 'bronze', weapon: 'sword',
    effects: [{ kind: 'damage', power: 5 }], text: 'Deal 5 (+ATK) Sword damage.',
  },
  bramble: {
    id: 'bramble', name: 'Bramble', archetypes: ['defensive'], property: 'physical', size: 1,
    rarity: 'common', tier: 'bronze', weapon: 'sword',
    // cooldown 99: cast ONCE, so each scenario tests a single pile rather than
    // the rotation re-applying thorns every 4th turn.
    cooldownTurns: 99,
    effects: [{ kind: 'thorns', stacks: 3 }], text: '{{Thorns}} 3.',
  },
  brambleQuick: {
    id: 'brambleQuick', name: 'Bramble Quick', archetypes: ['defensive'], property: 'physical', size: 1,
    rarity: 'common', tier: 'bronze', weapon: 'sword',
    cooldownTurns: 0, // recasts every rotation — exercises the merge rule
    effects: [{ kind: 'thorns', stacks: 3 }], text: '{{Thorns}} 3.',
  },
  sweep: {
    id: 'sweep', name: 'Sweep', archetypes: ['offense'], property: 'physical', size: 1,
    rarity: 'common', tier: 'bronze', weapon: 'sword', scope: 'all',
    effects: [{ kind: 'damage', power: 5 }], text: 'Deal 5 (+ATK) Sword damage to all foes.',
  },
  venom: {
    id: 'venom', name: 'Venom', archetypes: ['debuff'], property: 'magical', size: 1,
    rarity: 'common', tier: 'bronze', element: 'nature',
    effects: [{ kind: 'poison', stacks: 3 }], text: '{{Poison}} 3.',
  },
} satisfies Record<string, SkillDef>;

function unit(name: string, pieces: string[], opts: Partial<CombatantSetup> = {}): CombatantSetup {
  return {
    name,
    stats: { maxHp: 400, hp: 400, attack: 0, magicPower: 0, armor: 0, magicResist: 0, speed: 10 },
    boardSize: 10,
    pieces: pieces.map((skillId, i) => ({ skillId, slot: i })),
    ...opts,
  };
}

function run(player: CombatantSetup, enemy: CombatantSetup): readonly CombatEvent[] {
  const config: CombatConfig = { playerTeam: [player], enemyTeam: [enemy], skillBook: book };
  return simulate(config, 1).events;
}

const thornDamage = (events: readonly CombatEvent[]) =>
  events.filter((e): e is Extract<CombatEvent, { kind: 'damage' }> => e.kind === 'damage' && e.source === 'thorns');

describe('thorns', () => {
  it('reflects the CURRENT stack count per direct hit, decrementing 3 → 2 → 1, then expires', () => {
    // Player only stings (thorns, no attack); enemy only jabs. Every enemy jab
    // should draw 3, then 2, then 1 reflect damage on the enemy side, and the
    // pile should expire after the third sting.
    const events = run(unit('holder', ['bramble']), unit('attacker', ['jab']));
    const stings = thornDamage(events).filter((e) => e.side === 'enemy');
    expect(stings.length).toBe(3);
    expect(stings.map((e) => e.amount)).toEqual([3, 2, 1]);
    const expired = events.find((e) => e.kind === 'statusExpired' && e.status === 'thorns');
    expect(expired, 'the pile must announce its expiry').toBeDefined();
    // and no further reflects after expiry
    const last = events.indexOf(stings[2]!);
    expect(events.indexOf(expired!)).toBeGreaterThan(last);
  });

  it('is TRUE damage aimed at the attacker, never the holder', () => {
    const events = run(unit('holder', ['bramble']), unit('attacker', ['jab']));
    for (const sting of thornDamage(events)) {
      expect(sting.side).toBe('enemy');
      expect(sting.property).toBe('true');
    }
  });

  it('DoT ticks never trigger it: a pure poisoner draws zero reflects', () => {
    // Enemy applies poison but never lands a direct hit; the holder's thorns
    // must stay silent while poison ticks away.
    const events = run(unit('holder', ['bramble']), unit('poisoner', ['venom']));
    expect(thornDamage(events).length).toBe(0);
    // sanity: poison genuinely ticked, so the scenario is real
    expect(events.some((e) => e.kind === 'damage' && e.source === 'poison')).toBe(true);
  });

  it('is non-reentrant: both sides thorned + attacking produces reflects but no reflect-of-reflect', () => {
    const events = run(unit('a', ['bramble', 'jab']), unit('b', ['bramble', 'jab']));
    const stings = thornDamage(events);
    expect(stings.length).toBeGreaterThan(0);
    // Depth-1 rule: every reflect must be attributable to a skill hit, so the
    // count of reflects can never exceed the count of direct skill hits.
    const directHits = events.filter((e) => e.kind === 'damage' && e.source === 'skill').length;
    expect(stings.length).toBeLessThanOrEqual(directHits);
  });

  it('recasting MERGES into one pile — never two concurrent piles', () => {
    // brambleQuick recasts every rotation with nothing hitting the holder, so
    // stacks only ever accumulate: applied stacks must be 3, then 6, then 9…
    const events = run(unit('holder', ['brambleQuick']), unit('pacifist', ['venom']));
    const applied = events.filter(
      (e): e is Extract<CombatEvent, { kind: 'statusApplied' }> => e.kind === 'statusApplied' && e.status === 'thorns',
    );
    expect(applied.length).toBeGreaterThan(1);
    for (let i = 1; i < applied.length; i += 1) {
      expect(applied[i]!.stacks!, 'each recast must merge, not open a second pile').toBe(applied[i - 1]!.stacks! + 3);
    }
  });

  it('attributes the sting to the thorns-granting card, not the attacker card', () => {
    const events = run(unit('holder', ['bramble']), unit('attacker', ['jab']));
    for (const sting of thornDamage(events)) {
      expect(sting.sourceCard?.skillId, 'reflect damage must credit the thorns card').toBe('bramble');
    }
  });

  it('a reflect kill mid-AoE stops the fan-out: no hits land after the caster died', () => {
    // Two thorned foes; the frail sweeper dies to the FIRST reflect. The second
    // AoE target must never be hit — nothing later in the same step ever runs.
    const sweeper = unit('sweeper', ['sweep']);
    sweeper.stats = { ...sweeper.stats, maxHp: 2, hp: 2 };
    const foeA = unit('a', ['bramble']);
    const foeB = unit('b', ['bramble']);
    const config: CombatConfig = { playerTeam: [sweeper], enemyTeam: [foeA, foeB], skillBook: book };
    const events = simulate(config, 1).events;
    const diedAt = events.findIndex((e) => e.kind === 'died' && e.side === 'player');
    expect(diedAt, 'the sweeper must die to the reflect').toBeGreaterThan(-1);
    const lateHits = events.slice(diedAt + 1).filter((e) => e.kind === 'damage' && e.source === 'skill');
    expect(lateHits, 'a dead caster must not land its remaining AoE hits').toEqual([]);
  });

  it('a killing blow is not reflected — first to fall loses', () => {
    // Holder at 1 HP with a huge pile: the jab kills, and the dead holder's
    // thorns must not posthumously sting (the fight ended at the wipe).
    const holder = unit('holder', ['bramble']);
    holder.stats = { ...holder.stats, maxHp: 1, hp: 1 };
    const events = run(holder, unit('attacker', ['jab']));
    expect(events.some((e) => e.kind === 'died' && e.side === 'player')).toBe(true);
    expect(thornDamage(events).length).toBe(0);
  });
});
