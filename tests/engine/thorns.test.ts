import { describe, expect, it } from 'vitest';
import { simulate } from '../../src/engine/combat/simulate';
import type { CombatConfig, CombatantSetup, SkillBook, SkillDef } from '../../src/engine/types';
import type { CombatEvent } from '../../src/engine/combat/events';

/**
 * THORNS — reflect-on-hit self buff.
 *
 * Contract under test (see the Action doc in src/engine/types.ts):
 *  - a direct skill hit on a thorned unit stings the ATTACKER for the pile's
 *    current stack count as PHYSICAL damage — ARMOR FIRST, min 1 — then the pile
 *    loses one stack (user-locked 2026-08-21: "its just a reflect — if either
 *    side has the thorn buff and either side has armor it should hit armor
 *    first"; it was TRUE from the keyword's first commit until then);
 *  - being physical, it meets a physical `guard` and a physical shield pool like
 *    any other physical hit, and the TRUE pool no longer blocks it 1:1;
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
  // Self negate, ONE physical charge — cancels exactly the first `jab`.
  silence: {
    id: 'silence', name: 'Silence', archetypes: ['defensive'], property: 'physical', size: 1,
    rarity: 'common', tier: 'bronze', weapon: 'sword', cooldownTurns: 99,
    effects: [{ kind: 'negate', property: 'physical', charges: 1 }], text: '{{Negate}} 1 physical.',
  },
  // Self shield big enough to fully absorb a jab — the contrast case for negate.
  plate: {
    id: 'plate', name: 'Plate', archetypes: ['defensive'], property: 'true', size: 1,
    rarity: 'common', tier: 'bronze', cooldownTurns: 99,
    effects: [{ kind: 'shield', power: 50 }], text: 'Gain 50 TRUE shield.',
  },
  // --- the PHYSICAL-reflect fixtures (2026-08-21) ---
  // A big pile, cast once: 10/9/8… gives armor and guard something to bite that
  // the 3/2/1 ladder above would floor away.
  thicket: {
    id: 'thicket', name: 'Thicket', archetypes: ['defensive'], property: 'physical', size: 1,
    rarity: 'common', tier: 'bronze', weapon: 'sword', cooldownTurns: 99,
    effects: [{ kind: 'thorns', stacks: 10 }], text: '{{Thorns}} 10.',
  },
  // Self PHYSICAL guard, 50%, long window — the attacker-side answer to a sting.
  bulwark: {
    id: 'bulwark', name: 'Bulwark', archetypes: ['defensive'], property: 'physical', size: 1,
    rarity: 'common', tier: 'bronze', weapon: 'sword', cooldownTurns: 99,
    effects: [{ kind: 'guard', property: 'physical', pct: 50, turns: 9 }], text: '{{Guard}} 50% physical.',
  },
  // Self PHYSICAL shield pool, big enough to eat a whole sting.
  platePhys: {
    id: 'platePhys', name: 'Plate (Physical)', archetypes: ['defensive'], property: 'physical', size: 1,
    rarity: 'common', tier: 'bronze', weapon: 'sword', cooldownTurns: 99,
    effects: [{ kind: 'shield', power: 40 }], text: 'Gain 40 physical shield.',
  },
  // Self TRUE shield pool of exactly 5 — the 2:1 spill discriminator.
  plateTrue5: {
    id: 'plateTrue5', name: 'Plate (True 5)', archetypes: ['defensive'], property: 'true', size: 1,
    rarity: 'common', tier: 'bronze', cooldownTurns: 99,
    effects: [{ kind: 'shield', power: 5 }], text: 'Gain 5 TRUE shield.',
  },
} satisfies Record<string, SkillDef>;

/** Stats helper: the `unit` default sheet with named overrides. */
function stats(over: Partial<CombatantSetup['stats']> = {}): CombatantSetup['stats'] {
  return { maxHp: 400, hp: 400, attack: 0, magicPower: 0, armor: 0, magicResist: 0, speed: 10, ...over };
}

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

  it('is PHYSICAL damage aimed at the attacker, never the holder', () => {
    const events = run(unit('holder', ['bramble']), unit('attacker', ['jab']));
    expect(thornDamage(events).length).toBeGreaterThan(0);
    for (const sting of thornDamage(events)) {
      expect(sting.side).toBe('enemy');
      // USER RULING 2026-08-21: a reflect is an ordinary physical hit, not TRUE.
      expect(sting.property).toBe('physical');
    }
  });

  it('subtracts the ATTACKER\'S ARMOR from every sting', () => {
    // Pile of 10 → stings 10, 9, 8… ; the attacker wears 4 armor, so the ladder
    // lands 6, 5, 4… — `applyStrike`'s physical arithmetic, mirrored.
    const attacker = unit('attacker', ['jab'], { stats: stats({ armor: 4 }) });
    const events = run(unit('holder', ['thicket']), attacker);
    const stings = thornDamage(events).filter((e) => e.side === 'enemy').map((e) => e.amount);
    expect(stings.length).toBeGreaterThan(2);
    expect(stings.slice(0, 3)).toEqual([6, 5, 4]);
  });

  it('floors an over-armored sting at 1 — never 0, never negative', () => {
    // 20 armor against a pile of 10: every sting is fully eaten, and the min-1
    // floor (the same `Math.max(1, ...)` the strike path uses) leaves exactly 1.
    const attacker = unit('attacker', ['jab'], { stats: stats({ armor: 20 }) });
    const events = run(unit('holder', ['thicket']), attacker);
    const stings = thornDamage(events).filter((e) => e.side === 'enemy');
    expect(stings.length).toBeGreaterThan(2);
    for (const s of stings) expect(s.amount).toBe(1);
  });

  it('is reduced by the attacker\'s PHYSICAL GUARD (it never was, as TRUE)', () => {
    // Speed 30 so the guard is standing before the first jab resolves. Sting 10,
    // no armor, guard 50% → 5 through, 5 reported as `guarded`.
    const attacker = unit('attacker', ['bulwark', 'jab'], { stats: stats({ speed: 30 }) });
    const events = run(unit('holder', ['thicket']), attacker);
    const first = thornDamage(events).filter((e) => e.side === 'enemy')[0]!;
    expect(first.amount).toBe(5);
    expect(first.guarded).toBe(5);
  });

  it('is absorbed by the attacker\'s PHYSICAL SHIELD pool', () => {
    const attacker = unit('attacker', ['platePhys', 'jab'], { stats: stats({ speed: 30 }) });
    const events = run(unit('holder', ['thicket']), attacker);
    const first = thornDamage(events).filter((e) => e.side === 'enemy')[0]!;
    expect(first.amount).toBe(10);
    expect(first.blocked, 'the physical pool must eat the whole sting').toBe(10);
    expect(first.shieldDrain?.physical).toBe(10);
    expect(first.shieldDrain?.true).toBe(0);
    expect(first.hpAfter).toBe(400);
  });

  it('the TRUE pool no longer eats a reflect 1:1 — it spills at 2:1 like any typed hit', () => {
    // THE DISCRIMINATOR for the property change. A 5-point TRUE pool against a
    // sting of 10: as TRUE damage it blocked 5 (1:1, 5 HP through); as PHYSICAL
    // damage it drains all 5 to block only floor(5/2) = 2, so 8 HP lands.
    const attacker = unit('attacker', ['plateTrue5', 'jab'], { stats: stats({ speed: 30 }) });
    const events = run(unit('holder', ['thicket']), attacker);
    const first = thornDamage(events).filter((e) => e.side === 'enemy')[0]!;
    expect(first.amount).toBe(10);
    expect(first.blocked).toBe(2);
    expect(first.shieldDrain?.true).toBe(5);
    expect(first.hpAfter).toBe(400 - 8);
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

  /**
   * THE LOOP GATE IS THE CALL SITE, NOT THE PROPERTY OR THE SOURCE TAG.
   * `reflectThorns` is called from exactly one place (`applyStrike`) and
   * `dealDamage` never calls it back, so a reflect cannot trigger the RECIPIENT's
   * own thorns whatever it is made of. This pins that directly rather than by the
   * count bound above: the ONLY attacker is thorned too, so a reflect-of-reflect
   * would show up as a `thorns`-sourced hit on the passive holder's side.
   */
  it('no thorns-on-thorns: a reflect landing on a THORNED attacker stings nobody back', () => {
    // The holder never attacks (one card, cooldown 99). The attacker holds its
    // own pile of 10 AND jabs, so every reflect it takes lands on a thorned unit.
    const holder = unit('holder', ['thicket']);
    const attacker = unit('attacker', ['thicket', 'jab'], { stats: stats({ speed: 30 }) });
    const events = run(holder, attacker);
    const stings = thornDamage(events);
    expect(stings.length, 'the scenario must actually reflect').toBeGreaterThan(0);
    expect(
      stings.filter((e) => e.side === 'player'),
      'REGRESSION: a reflect triggered the recipient\'s own thorns (loop)',
    ).toEqual([]);
    // And the attacker's own pile was never spent by taking reflects: it is
    // untouched (no thorns expiry on the enemy side) while the holder's drains.
    expect(events.some((e) => e.kind === 'statusExpired' && e.status === 'thorns' && e.side === 'enemy')).toBe(false);
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

  /**
   * A HIT THAT DID NOT TAKE EFFECT DOES NOT REFLECT.
   *
   * REGRESSION: `applyStrike` called `dealDamage(...)` and then
   * `reflectThorns(...)` unconditionally. `dealDamage`'s negate arm returns EARLY
   * after emitting `negated`, so zero damage landed — but control returned and
   * the reflect fired anyway, spending one of the holder's thorn stacks on a hit
   * that never happened. Both docstrings said otherwise: thorns fires when a hit
   * LANDS (types.ts), negate FULLY nullifies one (types.ts). `dealDamage` now
   * reports whether the application took effect and `applyStrike` reflects only
   * then — the same idea `reflectThorns` already applied to the killing blow.
   */
  it('a NEGATED hit spends no thorn stack: the pile is untouched and stings the NEXT, real hit at full value', () => {
    // Speed 30 so the holder gets BOTH defensive cards up on turn 1, before the
    // attacker's first jab resolves.
    const holder = unit('holder', ['bramble', 'silence'], { stats: { maxHp: 400, hp: 400, attack: 0, magicPower: 0, armor: 0, magicResist: 0, speed: 30 } });
    const events = run(holder, unit('attacker', ['jab']));
    const negated = events.filter((e) => e.kind === 'negated');
    expect(negated, 'the scenario must actually negate a hit').toHaveLength(1);
    const negatedTurn = negated[0]!.turn;
    const stings = thornDamage(events).filter((e) => e.side === 'enemy');
    // THE DISCRIMINATOR: nothing reflected on the negated hit's own turn. (Under
    // the defect a sting of 3 fired right after the `negated` event, so the
    // ladder still READ 3-2-1 — it was just one hit early and one stack poorer.)
    expect(
      stings.filter((e) => e.turn === negatedTurn),
      'REGRESSION: a fully-negated hit still paid the victim\'s thorns',
    ).toEqual([]);
    // The holder took no damage on that turn either — the hit truly did not happen.
    const hitsOnHolder = events.filter(
      (e) => e.kind === 'damage' && e.source === 'skill' && e.side === 'player' && e.turn === negatedTurn,
    );
    expect(hitsOnHolder).toEqual([]);
    // The pile is intact for the NEXT, real jab: the full 3, 2, 1 ladder, all of
    // it strictly after the negated turn.
    expect(stings.map((e) => e.amount)).toEqual([3, 2, 1]);
    for (const s of stings) expect(s.turn).toBeGreaterThan(negatedTurn);
  });

  it('a SHIELD-absorbed hit still reflects — only negate makes a hit not happen at all', () => {
    // The contrast that keeps the rule narrow: a hit soaked by plating LANDED on
    // the unit and spent its shield, so the thorns still sting. `dealDamage`
    // reports it as taken effect; only a negate charge cancels the hit itself.
    const holder = unit('holder', ['bramble', 'plate'], { stats: { maxHp: 400, hp: 400, attack: 0, magicPower: 0, armor: 0, magicResist: 0, speed: 30 } });
    const events = run(holder, unit('attacker', ['jab']));
    const firstJab = events.find(
      (e): e is Extract<CombatEvent, { kind: 'damage' }> =>
        e.kind === 'damage' && e.source === 'skill' && e.side === 'player',
    )!;
    expect(firstJab.blocked, 'the jab must be fully absorbed by the plating').toBe(firstJab.amount);
    expect(firstJab.hpAfter).toBe(400);
    // The full 3-2-1 ladder still runs: absorption is not nullification.
    expect(thornDamage(events).filter((e) => e.side === 'enemy').map((e) => e.amount)).toEqual([3, 2, 1]);
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
