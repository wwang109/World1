import { describe, expect, it } from 'vitest';
import { simulate } from '../../src/engine/combat/simulate';
import type { CombatConfig, CombatantSetup, SkillBook, SkillDef } from '../../src/engine/types';
import type { CombatEvent } from '../../src/engine/combat/events';

/**
 * A DEAD CASTER STOPS CASTING — in a PACK fight, not just at 1v1.
 *
 * REGRESSION: `applyCast`'s effect loop stopped on `anySideWiped(state)`, which
 * is only true when EVERY unit of a side is dead. The hero side is one unit, so
 * 1v1 was accidentally covered; the enemy side runs up to MAX_FOES = 5, so a
 * caster killed mid-cast by thorns reflect left its side standing and the loop
 * carried on applying the REST of its card from beyond the grave — riders,
 * remaining AoE hits and all. 7 of 13 shipped enemies carry a card whose damage
 * action is not last (26 cards in the book have that shape), so this was live in
 * any pack fight against a thorned hero.
 *
 * The fix is `castCutShort()` in `applyCast` — one predicate at the loop level
 * (`!caster.alive || anySideWiped(state)`), checked between actions AND inside
 * one action's fan-out, so no individual arm (and no future `Action` kind) has
 * to remember its own guard. Only shield/guard/negate/ward/taunt/lifesteal ever
 * checked `caster.alive`; every damage, DoT and control arm did not.
 */

const book: SkillBook = {
  // Thorns 5 — enough to kill a 5-HP caster on the first reflect.
  bramble: {
    id: 'bramble', name: 'Bramble', archetypes: ['defensive'], property: 'physical', size: 1,
    speedWeight: 1, rarity: 'common', tier: 'bronze', weapon: 'sword', cooldownTurns: 99,
    effects: [{ kind: 'thorns', stacks: 5 }], text: '',
  },
  // DAMAGE FIRST, RIDERS AFTER — the shipped shape (`venom_fang` is exactly
  // `[damage, poison]`). Everything after the hit must die with the caster.
  fang: {
    id: 'fang', name: 'Fang', archetypes: ['offense'], property: 'physical', size: 1,
    speedWeight: 10, rarity: 'common', tier: 'bronze', weapon: 'beast', cooldownTurns: 0,
    effects: [
      { kind: 'damage', power: 12 },
      { kind: 'poison', stacks: 5 },
      { kind: 'stun', turns: 1 },
      { kind: 'taunt', amount: 7 },
    ],
    text: '',
  },
  // AoE version: the fan-out must break at the victim whose thorns killed it.
  sweep: {
    id: 'sweep', name: 'Sweep', archetypes: ['offense'], property: 'physical', size: 1,
    speedWeight: 10, rarity: 'common', tier: 'bronze', weapon: 'sword', scope: 'all', cooldownTurns: 0,
    effects: [{ kind: 'damage', power: 6 }], text: '',
  },
  // A harmless card so the second pack member exists without perturbing anything.
  idle: {
    id: 'idle', name: 'Idle', archetypes: ['defensive'], property: 'true', size: 1,
    speedWeight: 40, rarity: 'common', tier: 'bronze', cooldownTurns: 99,
    effects: [{ kind: 'shield', power: 1 }], text: '',
  },
} satisfies Record<string, SkillDef>;

function unit(name: string, pieces: string[], hp: number, speed: number): CombatantSetup {
  return {
    name,
    stats: { maxHp: hp, hp, attack: 0, magicPower: 0, armor: 0, magicResist: 0, speed },
    boardSize: 10,
    pieces: pieces.map((skillId, i) => ({ skillId, slot: i })),
  };
}

function run(playerTeam: CombatantSetup[], enemyTeam: CombatantSetup[]): readonly CombatEvent[] {
  const config: CombatConfig = {
    playerTeam,
    enemyTeam,
    skillBook: book,
    suddenDeathRound: 999,
    fatigueTurn: 999_999,
    attritionTurn: 999_999,
    maxTurns: 6,
  };
  return simulate(config, 1).events;
}

const after = (events: readonly CombatEvent[], idx: number): CombatEvent[] => events.slice(idx + 1);
const deathOf = (events: readonly CombatEvent[], side: 'player' | 'enemy', unitIdx: number): number =>
  events.findIndex((e) => e.kind === 'died' && e.side === side && e.unit === unitIdx);

describe('a caster killed mid-cast lands NOTHING further (pack fight)', () => {
  it('an ENEMY caster killed by thorns applies no poison, no stun and no taunt — its side is NOT wiped', () => {
    // hero: thorns 5, no attack at all. e0: 5 HP, casts `fang` and dies to the
    // reflect. e1: alive and untouched, so `anySideWiped` is FALSE at the moment
    // e0 dies — exactly the case the old guard missed.
    const events = run(
      [unit('hero', ['bramble'], 500, 20)],
      [unit('e0', ['fang'], 5, 10), unit('e1', ['idle'], 500, 10)],
    );
    const died = deathOf(events, 'enemy', 0);
    expect(died, 'e0 must die to its own victim\'s thorns').toBeGreaterThan(-1);
    // The side is genuinely NOT wiped — otherwise this test proves nothing new.
    const e1Died = events.some((e) => e.kind === 'died' && e.side === 'enemy' && e.unit === 1);
    expect(e1Died, 'e1 must still be standing when e0 dies').toBe(false);

    const applied = events.filter((e) => e.kind === 'statusApplied');
    expect(
      applied.filter((e) => e.kind === 'statusApplied' && e.status === 'poison'),
      'REGRESSION: a corpse applied its poison rider',
    ).toEqual([]);
    expect(
      applied.filter((e) => e.kind === 'statusApplied' && e.status === 'stun'),
      'a corpse must not stun',
    ).toEqual([]);
    expect(
      events.filter((e) => e.kind === 'aggroChanged'),
      'a corpse must not taunt',
    ).toEqual([]);
  });

  it('CONTROL: the same cast from a caster that SURVIVES the reflect applies every rider', () => {
    const events = run(
      [unit('hero', ['bramble'], 500, 20)],
      [unit('e0', ['fang'], 500, 10), unit('e1', ['idle'], 500, 10)],
    );
    expect(events.some((e) => e.kind === 'died' && e.side === 'enemy')).toBe(false);
    expect(events.some((e) => e.kind === 'statusApplied' && e.status === 'poison')).toBe(true);
    expect(events.some((e) => e.kind === 'statusApplied' && e.status === 'stun')).toBe(true);
    expect(events.some((e) => e.kind === 'aggroChanged')).toBe(true);
  });

  it('an AoE fan-out breaks at the reflect that kills the caster: later targets are never hit', () => {
    // Two thorned heroes, a 5 HP enemy sweeper and a live pack-mate. The FIRST
    // hero's thorns kill the sweeper, so the SECOND hero must never be hit.
    const events = run(
      [unit('h0', ['bramble'], 500, 20), unit('h1', ['bramble'], 500, 20)],
      [unit('e0', ['sweep'], 5, 10), unit('e1', ['idle'], 500, 10)],
    );
    const died = deathOf(events, 'enemy', 0);
    expect(died, 'the sweeper must die to the first target\'s thorns').toBeGreaterThan(-1);
    expect(events.some((e) => e.kind === 'died' && e.side === 'enemy' && e.unit === 1)).toBe(false);
    const lateSkillHits = after(events, died).filter((e) => e.kind === 'damage' && e.source === 'skill');
    expect(lateSkillHits, 'a dead caster must not land its remaining AoE hits').toEqual([]);
    // Concretely: h1 took no skill damage at all this fight.
    const h1Hits = events.filter(
      (e) => e.kind === 'damage' && e.source === 'skill' && e.side === 'player' && e.unit === 1,
    );
    expect(h1Hits).toEqual([]);
  });

  it('the caster\'s death is the LAST thing its cast does: no damage, heal or status follows it', () => {
    const events = run(
      [unit('hero', ['bramble'], 500, 20)],
      [unit('e0', ['fang'], 5, 10), unit('e1', ['idle'], 500, 10)],
    );
    const died = deathOf(events, 'enemy', 0);
    const kinds = after(events, died)
      .filter((e) => e.turn === events[died]!.turn)
      .map((e) => e.kind);
    // Bookkeeping (cost/cursor/wait/end...) may follow; APPLICATIONS may not.
    for (const forbidden of ['heal', 'statusApplied', 'shieldGain', 'aggroChanged', 'slowed', 'disrupted']) {
      expect(kinds, `${forbidden} must not follow the caster's death`).not.toContain(forbidden);
    }
  });

  it('1v1 is byte-identical: the caster dying IS its side being wiped, so nothing changed there', () => {
    // The old `anySideWiped` guard was accidentally correct at 1v1. Proven here
    // by the observable outcome: the solo caster dies and applies no rider,
    // exactly as it did before the fix.
    const events = run([unit('hero', ['bramble'], 500, 20)], [unit('e0', ['fang'], 5, 10)]);
    expect(events.some((e) => e.kind === 'died' && e.side === 'enemy' && e.unit === 0)).toBe(true);
    expect(events.some((e) => e.kind === 'statusApplied' && e.status === 'poison')).toBe(false);
    const end = events[events.length - 1]!;
    expect(end).toMatchObject({ kind: 'combatEnd', result: 'win' });
  });
});
