import { describe, expect, it } from 'vitest';
import { simulate } from '../../src/engine/combat/simulate';
import { skillBook } from '../../src/data/skills';
import { enchantBook } from '../../src/data/enchants';
import type { CombatConfig, SkillBook } from '../../src/engine/types';
import { cfg, tc, NO_ENDGAME } from '../helpers';

type Events = ReturnType<typeof simulate>['events'];

function hits(events: Events, side: 'player' | 'enemy') {
  return events.filter((e) => e.kind === 'damage' && e.side === side) as Extract<Events[number], { kind: 'damage' }>[];
}

describe('empower — sword-intent setup (next card +pct%)', () => {
  it('charges the NEXT cast, not the granting one, and is spent by it', () => {
    // [Gather Intent][Sword Slash][Sword Slash] at Speed 20 vs a slow wall:
    // Gather Intent grants +60% (it deals no damage of its own), the very
    // next slash rides the charge (200% of 10 = 20 -> 32), then the
    // following slash is back to base (20) once the charge is spent.
    const c = cfg(
      tc('blade', ['gather_intent', 'sword_slash', 'sword_slash'], { attack: 10, speed: 20, maxHp: 500 }),
      tc('wall', ['iron_bulwark'], { attack: 1, speed: 5, maxHp: 500 }),
      { ...NO_ENDGAME, maxTurns: 3 },
    );
    const { events } = simulate(c, 1);
    expect(events.some((e) => e.kind === 'empowered' && e.side === 'player')).toBe(true);
    const dmg = hits(events, 'enemy').map((e) => e.amount);
    expect(dmg[0]).toBe(32); // slash right after the grant rides the +60%
    expect(dmg[1]).toBe(20); // next slash back to base — charge was spent
  });

  it('does not stack — non-stacking max like weakenNext', () => {
    // Gather Intent (the only surviving empower card) has no damage of its
    // own, so a tiny test-local card (Focus Strike: same shape as the
    // culled Focused Edge — 100% Attack + empower 50%) stands in as the
    // second granting card, exactly like the original two-grant setup.
    // Two empower casts before an attack: the buff reads the max (60), not 110.
    const empowerBook: SkillBook = {
      ...skillBook,
      focus_strike: {
        id: 'focus_strike',
        name: 'Focus Strike (test)',
        archetypes: ['offense'],
        property: 'physical',
        size: 1,
        speedWeight: 10,
        tier: 'common',
        effects: [
          { kind: 'damage', power: 100 },
          { kind: 'empower', pct: 50 },
        ],
        text: '',
      },
    };
    const c = cfg(
      tc('monk', ['gather_intent', 'focus_strike', 'sword_slash'], { attack: 10, speed: 30, maxHp: 500 }, { skillBook: empowerBook }),
      tc('wall', ['iron_bulwark'], { attack: 1, speed: 5, maxHp: 500 }, { skillBook: empowerBook }),
      { ...NO_ENDGAME, skillBook: empowerBook, maxTurns: 6 },
    );
    const { events } = simulate(c, 1);
    const empowers = events.filter((e) => e.kind === 'empowered') as Extract<Events[number], { kind: 'empowered' }>[];
    for (const e of empowers) expect(e.pct).toBeLessThanOrEqual(60);
  });
});

describe('bloodCost — pay HP to cast', () => {
  it('pays the price as unblockable true damage to the caster', () => {
    const c = cfg(
      tc('cultist', ['blood_rite'], { magicPower: 10, speed: 20, maxHp: 100 }),
      tc('wall', ['iron_bulwark'], { attack: 1, speed: 5, maxHp: 500 }),
      { ...NO_ENDGAME, maxTurns: 1 },
    );
    const { events } = simulate(c, 1);
    const cost = hits(events, 'player').find((e) => e.source === 'blood');
    expect(cost).toBeDefined();
    expect(cost!.amount).toBe(16);
    expect(hits(events, 'enemy').length).toBeGreaterThanOrEqual(1);
  });

  it('a card whose blood price would kill the caster is skipped', () => {
    // 10 HP left: Blood Rite (16 HP) is uncastable; the slash still fires.
    const c = cfg(
      tc('cultist', ['blood_rite', 'sword_slash'], { attack: 10, magicPower: 10, speed: 20, maxHp: 100, hp: 10 }),
      tc('wall', ['iron_bulwark'], { attack: 1, speed: 5, maxHp: 500 }),
      { ...NO_ENDGAME, maxTurns: 2 },
    );
    const { events } = simulate(c, 1);
    const casts = events.filter((e) => e.kind === 'skillCast' && e.side === 'player') as Extract<Events[number], { kind: 'skillCast' }>[];
    expect(casts.every((e) => e.skillId === 'sword_slash')).toBe(true);
    expect(hits(events, 'player').filter((e) => e.source === 'blood')).toHaveLength(0);
  });
});

describe('Trample Mark — overkill carries into the next enemy', () => {
  it('a killing blow rolls its excess into the next foe in formation', () => {
    // Marked slash at 90%: 200% of 20 = 40 -> 36 vs a 10-HP front rat:
    // 26 overkill carries into the second rat.
    const c: CombatConfig = {
      player: {
        ...tc('boar', [], { attack: 20, speed: 20, maxHp: 500 }),
        pieces: [{ skillId: 'sword_slash', slot: 0, enchant: 'trample_mark' }],
        boardSize: 10,
      },
      enemy: [tc('rat1', [], { maxHp: 10, speed: 5 }), tc('rat2', [], { maxHp: 100, speed: 5 })],
      skillBook,
      enchantBook,
      ...NO_ENDGAME,
      maxTurns: 1,
    };
    const { events } = simulate(c, 1);
    const enemyHits = hits(events, 'enemy');
    expect(enemyHits).toHaveLength(2);
    expect(enemyHits[0]).toMatchObject({ unit: 0, amount: 36 });
    expect(enemyHits[1]).toMatchObject({ unit: 1, amount: 26 });
    expect(events.filter((e) => e.kind === 'died')).toHaveLength(1);
  });

  it('no overkill, no carry — a survivor absorbs the whole strike', () => {
    const c: CombatConfig = {
      player: {
        ...tc('boar', [], { attack: 20, speed: 20, maxHp: 500 }),
        pieces: [{ skillId: 'sword_slash', slot: 0, enchant: 'trample_mark' }],
        boardSize: 10,
      },
      enemy: [tc('tank', [], { maxHp: 200, speed: 5 }), tc('mage', [], { maxHp: 100, speed: 5 })],
      skillBook,
      enchantBook,
      ...NO_ENDGAME,
      maxTurns: 1,
    };
    const { events } = simulate(c, 1);
    expect(hits(events, 'enemy')).toHaveLength(1);
  });
});
