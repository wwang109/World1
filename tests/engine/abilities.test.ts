import { describe, expect, it } from 'vitest';
import { simulate } from '../../src/engine/combat/simulate';
import { cfg, tc, NO_ENDGAME } from '../helpers';

type Events = ReturnType<typeof simulate>['events'];

function comparisons(events: Events) {
  return events.filter((e) => e.kind === 'comparison') as Extract<Events[number], { kind: 'comparison' }>[];
}

function damageEvents(events: Events) {
  return events.filter((e) => e.kind === 'damage') as Extract<Events[number], { kind: 'damage' }>[];
}

describe('ability catalog wave 2', () => {
  it('execute adds its bonus only while the enemy is below the HP window', () => {
    // Chop: 120% + 60% below half. Attack 10 -> 12 normally, 19 in the window.
    const above = simulate(
      cfg(
        tc('hero', ['executioners_chop'], { attack: 10, speed: 20, maxHp: 500 }),
        tc('wall', [], { maxHp: 100, speed: 1 }),
        { ...NO_ENDGAME, maxTurns: 1 },
      ),
      1,
    );
    expect(damageEvents(above.events)[0]!.amount).toBe(12);

    const below = simulate(
      cfg(
        tc('hero', ['executioners_chop'], { attack: 10, speed: 20, maxHp: 500 }),
        tc('wall', [], { maxHp: 100, hp: 40, speed: 1 }),
        { ...NO_ENDGAME, maxTurns: 1 },
      ),
      1,
    );
    // floor(12 * 1.6) = 19
    expect(damageEvents(below.events)[0]!.amount).toBe(19);
  });

  it('quicken lightens the caster next action', () => {
    // Windstep Jab is w10 and quickens by 12 -> next action weighs max(1, 10-12) = 1.
    const c = cfg(
      tc('hero', ['windstep_jab'], { attack: 10, speed: 20, maxHp: 500 }),
      tc('wall', [], { maxHp: 500, speed: 1 }),
      { ...NO_ENDGAME, maxTurns: 4 },
    );
    const { events } = simulate(c, 1);
    const ready = comparisons(events).filter((e) => e.player.state === 'ready');
    expect(ready[0]!.player.weight).toBe(10); // nothing pending yet
    expect(ready[1]!.player.weight).toBe(1); // quickened
  });

  it('thorns reflects a cut of skill hits as TRUE damage to the attacker', () => {
    // Turn 1 foe slashes (no thorns yet), turn 2 hero coats, turn 3 the foe's
    // second consecutive slash (stale −10%: 20 -> 18) pays 25% -> 4 TRUE back.
    const c = cfg(
      tc('hero', ['bramble_coat'], { magicPower: 10, speed: 12, maxHp: 500 }),
      tc('foe', ['sword_slash'], { attack: 10, speed: 14, maxHp: 500 }),
      { ...NO_ENDGAME, maxTurns: 3 },
    );
    const { events } = simulate(c, 1);
    const reflected = damageEvents(events).find((e) => e.source === 'thorns');
    expect(reflected).toMatchObject({ side: 'enemy', amount: 4, property: 'true' });
  });

  it('staleness: spamming one skill decays −10% per re-cast (cap −30%), variety resets', () => {
    // A one-card board recasting Sword Slash into a wall: 20, 18, 16, 14, 14…
    const spam = simulate(
      cfg(tc('hero', ['sword_slash'], { attack: 10, speed: 20, maxHp: 500 }), tc('wall', [], { maxHp: 500, speed: 1 }), {
        ...NO_ENDGAME,
        maxTurns: 5,
      }),
      1,
    );
    expect(damageEvents(spam.events).map((e) => e.amount)).toEqual([20, 18, 16, 14, 14]);

    // Alternating two attacks never goes stale: full damage every cast.
    const varied = simulate(
      cfg(tc('hero', ['sword_slash', 'hunter_shot'], { attack: 10, speed: 20, maxHp: 500 }), tc('wall', [], { maxHp: 500, speed: 1 }), {
        ...NO_ENDGAME,
        maxTurns: 4,
      }),
      1,
    );
    expect(damageEvents(varied.events).map((e) => e.amount)).toEqual([20, 20, 20, 20]);
  });

  it('thorns expires after its duration like other timed statuses', () => {
    const c = cfg(
      tc('hero', ['bramble_coat'], { magicPower: 10, speed: 30, maxHp: 500 }),
      tc('wall', [], { maxHp: 500, speed: 1 }),
      { ...NO_ENDGAME, maxTurns: 8 },
    );
    const { events } = simulate(c, 1);
    expect(events.find((e) => e.kind === 'statusExpired' && e.status === 'thorns')).toBeDefined();
  });

  it('multiHit rolls each strike separately, so armor mitigates every hit', () => {
    // Flurry: 3 x 50% of attack 10 = 3 hits of 5 vs no armor...
    const bare = simulate(
      cfg(
        tc('hero', ['flurry_of_knives'], { attack: 10, speed: 20, maxHp: 500 }),
        tc('wall', [], { maxHp: 500, speed: 1 }),
        { ...NO_ENDGAME, maxTurns: 1 },
      ),
      1,
    );
    expect(damageEvents(bare.events).map((e) => e.amount)).toEqual([5, 5, 5]);

    // ...but armor 3 bites every strike: 3 hits of 2.
    const armored = simulate(
      cfg(
        tc('hero', ['flurry_of_knives'], { attack: 10, speed: 20, maxHp: 500 }),
        tc('wall', [], { maxHp: 500, speed: 1, armor: 3 }),
        { ...NO_ENDGAME, maxTurns: 1 },
      ),
      1,
    );
    expect(damageEvents(armored.events).map((e) => e.amount)).toEqual([2, 2, 2]);
  });

  it('purge strips the enemy positive statuses before the arrow lands', () => {
    // Fast foe howls (+50% attack buff), then the hero's arrow purges it.
    const c = cfg(
      tc('hero', ['dispelling_arrow'], { attack: 10, speed: 10, maxHp: 500 }),
      tc('foe', ['battle_howl', 'sword_slash'], { attack: 10, speed: 30, maxHp: 500 }),
      { ...NO_ENDGAME, maxTurns: 3 },
    );
    const { events, finalState } = simulate(c, 1);
    const purged = events.find((e) => e.kind === 'purged');
    expect(purged).toMatchObject({ side: 'enemy' });
    expect((purged as { removed: number }).removed).toBeGreaterThanOrEqual(1);
    expect(finalState.enemy[0]!.statuses.some((s) => s.kind === 'buff')).toBe(false);
  });

  it('cleanse keeps its own thorns (positive status), stripping only harm', () => {
    // Foe poisons t1, hero coats t2 (thorns 3t), foe poisons t3, hero
    // purifies t4 — poison goes, thorns survives to expire naturally on t5.
    const c = cfg(
      tc('hero', ['bramble_coat', 'purify'], { magicPower: 10, speed: 30, maxHp: 500 }),
      tc('foe', ['venom_fang'], { attack: 10, speed: 35, maxHp: 500 }),
      { ...NO_ENDGAME, maxTurns: 5 },
    );
    const { events } = simulate(c, 1);
    const cleansed = events.find((e) => e.kind === 'cleansed');
    expect(cleansed).toBeDefined();
    // Thorns was never cleansed away: its natural expiry still fires later.
    const expiry = events.find((e) => e.kind === 'statusExpired' && e.status === 'thorns' && e.side === 'player');
    expect(expiry).toBeDefined();
    expect(expiry!.turn).toBeGreaterThan((cleansed as { turn: number }).turn);
  });

  it('regen heals a flat tick at the start of each global turn', () => {
    // Spores: heal 120% of 10 = 12 up front, then 5/turn for 3 turns. The
    // size-3 barrier keeps the hero busy so spores isn't simply recast.
    const c = cfg(
      tc('hero', ['soothing_spores', 'prism_barrier'], { magicPower: 10, speed: 20, maxHp: 100, hp: 50 }),
      tc('wall', [], { maxHp: 500, speed: 1 }),
      { ...NO_ENDGAME, maxTurns: 4 },
    );
    const { events } = simulate(c, 1);
    const heals = events.filter((e) => e.kind === 'heal' && e.side === 'player') as Extract<Events[number], { kind: 'heal' }>[];
    expect(heals[0]).toMatchObject({ amount: 12, flat: false });
    expect(heals.slice(1, 4).map((e) => ({ amount: e.amount, flat: e.flat }))).toEqual([
      { amount: 5, flat: true },
      { amount: 5, flat: true },
      { amount: 5, flat: true },
    ]);
  });
});
