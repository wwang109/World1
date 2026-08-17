import { describe, expect, it } from 'vitest';
import { simulate } from '../../src/engine/combat/simulate';
import type { CombatConfig, CombatantSetup, SkillBook } from '../../src/engine/types';
import { tc, NO_ENDGAME } from '../helpers';

/**
 * Inline test book. A single-target strike and an explicit `scope: 'all'` AoE.
 * These are TEST cards only, priced off-budget on purpose — engine BEHAVIOR is
 * this file's subject, not PL. `scope: 'all'` IS priced (`PRICE.aoeTargetsNum/
 * Den` in `src/engine/balance.ts`, see `tests/engine/balance.test.ts` for the
 * pricing coverage); no real AoE content ships yet, so the balance audit never
 * exercises it against real cards.
 */
const BOOK: SkillBook = {
  strike: {
    id: 'strike',
    name: 'Strike',
    archetypes: ['offense'],
    property: 'physical',
    size: 1,
    speedWeight: 10,
    weapon: 'sword',
    rarity: 'common',
    tier: 'bronze',
    // power 10 flat (÷10 of the old 100%) -> 50 deci-PL, keeping the
    // highestThreat pricing assertions below intact.
    effects: [{ kind: 'damage', power: 10 }],
    text: '',
  },
  aoe: {
    id: 'aoe',
    name: 'Cleave',
    archetypes: ['offense'],
    property: 'physical',
    size: 1,
    speedWeight: 10,
    weapon: 'sword',
    rarity: 'common',
    tier: 'bronze',
    scope: 'all',
    // power 0 -> deals exactly Attack (flat model equivalent of the old 100%).
    effects: [{ kind: 'damage', power: 0 }],
    text: '',
  },
  taunt: {
    id: 'taunt',
    name: 'Taunt',
    archetypes: ['defensive'],
    property: 'physical',
    size: 1,
    speedWeight: 10,
    rarity: 'common',
    tier: 'bronze',
    effects: [{ kind: 'taunt', amount: 50 }],
    text: '',
  },
  aoeLeech: {
    id: 'aoeLeech',
    name: 'Cleaving Drain',
    archetypes: ['offense'],
    property: 'physical',
    size: 1,
    speedWeight: 10,
    weapon: 'sword',
    rarity: 'common',
    tier: 'bronze',
    scope: 'all',
    // power 0 -> deals exactly Attack (flat model equivalent of the old 100%).
    effects: [
      { kind: 'damage', power: 0 },
      { kind: 'lifesteal', pct: 50 },
    ],
    text: '',
  },
};

/** A fast single-strike attacker that performs first every turn. */
function attacker(
  card: 'strike' | 'aoe' | 'aoeLeech',
  stats: Partial<CombatantSetup['stats']> = {},
  extra: Partial<CombatantSetup> = {},
): CombatantSetup {
  return {
    ...tc('hero', [card], { speed: 40, attack: 10, maxHp: 500, ...stats }, { skillBook: BOOK }),
    ...extra,
  };
}

/** A slow foe (never wins initiative) with a given hp / board and optional aggro. */
function foe(name: string, hp: number, cards: string[] = ['strike'], baseAggro?: number): CombatantSetup {
  return { ...tc(name, cards, { speed: 1, attack: 1, maxHp: hp }, { skillBook: BOOK }), baseAggro };
}

function run(player: CombatantSetup, enemyTeam: CombatantSetup[]): ReturnType<typeof simulate> {
  const config: CombatConfig = {
    playerTeam: [player],
    enemyTeam,
    skillBook: BOOK,
    ...NO_ENDGAME,
    cooldownsEnabled: false, // byte-identical to the pre-cooldown engine
  };
  return simulate(config, 1);
}

/** Damage events emitted on the turn of the player's first cast. */
function firstCastDamage(events: ReturnType<typeof simulate>['events']) {
  const cast = events.find((e) => e.kind === 'skillCast' && e.side === 'player') as { turn: number };
  return events.filter(
    (e) => e.kind === 'damage' && e.turn === cast.turn && e.side === 'enemy',
  ) as Array<{ unit: number; amount: number }>;
}

describe('Wave 3 — offensive targeting', () => {
  it("policy `first` hits the lowest living index", () => {
    const { events } = run(attacker('strike', {}, { targetPolicy: 'first' }), [foe('a', 100), foe('b', 100), foe('c', 100)]);
    const dmg = firstCastDamage(events);
    expect(dmg).toHaveLength(1);
    expect(dmg[0]!.unit).toBe(0);
  });

  it('policy `lowestHp` hits the min-hp foe (tie → lowest index)', () => {
    // foe indices 0/1/2 with hp 100/20/50 → unit 1 is lowest.
    const { events } = run(attacker('strike', {}, { targetPolicy: 'lowestHp' }), [foe('a', 100), foe('b', 20), foe('c', 50)]);
    const dmg = firstCastDamage(events);
    expect(dmg).toHaveLength(1);
    expect(dmg[0]!.unit).toBe(1);
  });

  it('policy `highestThreat` hits the max board-PL foe (tie → lowest index)', () => {
    // Unit 1 carries two strike cards → double board PL of the single-card foes.
    const { events } = run(attacker('strike', {}, { targetPolicy: 'highestThreat' }), [
      foe('a', 100, ['strike']),
      foe('b', 100, ['strike', 'strike']),
      foe('c', 100, ['strike']),
    ]);
    const dmg = firstCastDamage(events);
    expect(dmg).toHaveLength(1);
    expect(dmg[0]!.unit).toBe(1);
  });

  it('explicit `focus` overrides the policy while the focused unit lives', () => {
    // lowestHp would pick unit 1 (hp 20); focus:2 wins instead.
    const { events } = run(attacker('strike', {}, { targetPolicy: 'lowestHp', focus: 2 }), [
      foe('a', 100),
      foe('b', 20),
      foe('c', 100),
    ]);
    const dmg = firstCastDamage(events);
    expect(dmg).toHaveLength(1);
    expect(dmg[0]!.unit).toBe(2);
  });

  it('`focus` falls back to the policy once the focused unit is dead', () => {
    // Focus a 1-hp unit that the AoE-less strike kills; next cast retargets by policy (first).
    const { events } = run(attacker('strike', { attack: 100 }, { targetPolicy: 'first', focus: 1 }), [
      foe('a', 500),
      foe('b', 1),
      foe('c', 500),
    ]);
    const casts = events.filter((e) => e.kind === 'skillCast' && e.side === 'player') as Array<{ turn: number }>;
    const firstDmg = events.find((e) => e.kind === 'damage' && e.turn === casts[0]!.turn) as { unit: number };
    expect(firstDmg.unit).toBe(1); // focus honored while alive
    expect(events.some((e) => e.kind === 'died' && e.side === 'enemy' && e.unit === 1)).toBe(true);
    // A later cast (after unit 1 died) retargets to the first living index (0).
    const laterDmg = events.filter(
      (e) => e.kind === 'damage' && e.side === 'enemy' && e.turn > casts[0]!.turn,
    ) as Array<{ unit: number }>;
    expect(laterDmg.length).toBeGreaterThan(0);
    expect(laterDmg[0]!.unit).toBe(0);
  });

  it('AoE hits every living foe in ascending index order, each event tagged', () => {
    const { events } = run(attacker('aoe'), [foe('a', 500), foe('b', 500), foe('c', 500)]);
    const dmg = firstCastDamage(events);
    expect(dmg.map((d) => d.unit)).toEqual([0, 1, 2]);
    // Each foe took its own 10-damage hit.
    expect(dmg.every((d) => d.amount === 10)).toBe(true);
  });

  it('lifesteal sums damage dealt across all AoE victims', () => {
    // 3 foes × 10 damage = 30 total; lifesteal 50% → 15 healed on the caster.
    const { events } = run(attacker('aoeLeech', { maxHp: 500, hp: 50 }), [foe('a', 500), foe('b', 500), foe('c', 500)]);
    const cast = events.find((e) => e.kind === 'skillCast' && e.side === 'player') as { turn: number };
    const heal = events.find(
      (e) => e.kind === 'heal' && e.side === 'player' && e.turn === cast.turn,
    ) as { amount: number } | undefined;
    expect(heal).toBeDefined();
    expect(heal!.amount).toBe(15);
  });

  it('default policy is `aggro`: hits the highest-aggro living foe', () => {
    // No explicit targetPolicy on the attacker → defaults to `aggro`.
    const { events } = run(attacker('strike'), [foe('a', 100, ['strike'], 0), foe('b', 100, ['strike'], 30), foe('c', 100, ['strike'], 10)]);
    const dmg = firstCastDamage(events);
    expect(dmg).toHaveLength(1);
    expect(dmg[0]!.unit).toBe(1);
  });

  it('aggro ties break to the lowest index (== byte-identical untaunted default)', () => {
    const { events } = run(attacker('strike'), [foe('a', 100, ['strike'], 5), foe('b', 100, ['strike'], 5), foe('c', 100, ['strike'], 5)]);
    expect(firstCastDamage(events)[0]!.unit).toBe(0);
  });

  it('a taunting tank pulls hits off a squishier ally', () => {
    // Player team: squishy index 0 (empty board), tank index 1 (fast, taunts to aggro 50).
    // Enemy attacks under the default aggro policy → after the taunt it targets the tank.
    const squishy = tc('squishy', [], { speed: 1, maxHp: 500 }, { skillBook: BOOK });
    const tank = tc('tank', ['taunt'], { speed: 30, maxHp: 500 }, { skillBook: BOOK });
    const enemyAtk = tc('foe', ['strike'], { speed: 20, attack: 20, maxHp: 500 }, { skillBook: BOOK });
    const config: CombatConfig = { playerTeam: [squishy, tank], enemyTeam: [enemyAtk], skillBook: BOOK, ...NO_ENDGAME };
    const { events } = simulate(config, 1);

    // Taunt fired and is observable.
    const aggroEvt = events.find((e) => e.kind === 'aggroChanged') as { side: string; unit: number; aggro: number };
    expect(aggroEvt).toMatchObject({ side: 'player', unit: 1, aggro: 50 });

    // The enemy's first hit lands on the tank (index 1), not the squishy (index 0).
    const firstEnemyHit = events.find((e) => e.kind === 'damage' && e.side === 'player') as { unit: number };
    expect(firstEnemyHit.unit).toBe(1);
  });

  it('skillCast records WHY: target unit, policy, and deciding value per policy', () => {
    type Cast = {
      targetUnit?: number;
      targetPolicy?: string;
      targetValue?: number;
      aoe?: boolean;
      targets?: number[];
    };
    const firstCast = (events: ReturnType<typeof simulate>['events']): Cast =>
      events.find((e) => e.kind === 'skillCast' && e.side === 'player') as unknown as Cast;

    // first → unit 0, no value.
    expect(firstCast(run(attacker('strike', {}, { targetPolicy: 'first' }), [foe('a', 100), foe('b', 100)]).events))
      .toMatchObject({ targetUnit: 0, targetPolicy: 'first' });
    expect(firstCast(run(attacker('strike', {}, { targetPolicy: 'first' }), [foe('a', 100), foe('b', 100)]).events).targetValue)
      .toBeUndefined();

    // lowestHp → unit 1, value = that unit's hp (20).
    expect(firstCast(run(attacker('strike', {}, { targetPolicy: 'lowestHp' }), [foe('a', 100), foe('b', 20), foe('c', 50)]).events))
      .toMatchObject({ targetUnit: 1, targetPolicy: 'lowestHp', targetValue: 20 });

    // highestThreat → unit 1 (two strike cards). Each strike (10 flat power) prices
    // at 10 * flatPowerPerPoint(5) = 50 deci-PL; two cards -> board value 2×50 = 100.
    expect(firstCast(run(attacker('strike', {}, { targetPolicy: 'highestThreat' }), [foe('a', 100, ['strike']), foe('b', 100, ['strike', 'strike']), foe('c', 100, ['strike'])]).events))
      .toMatchObject({ targetUnit: 1, targetPolicy: 'highestThreat', targetValue: 100 });

    // aggro (default) → unit 1, value = aggro (30).
    expect(firstCast(run(attacker('strike'), [foe('a', 100, ['strike'], 0), foe('b', 100, ['strike'], 30)]).events))
      .toMatchObject({ targetUnit: 1, targetPolicy: 'aggro', targetValue: 30 });

    // focus → unit 2, policy 'focus', no value.
    const focusCast = firstCast(run(attacker('strike', {}, { targetPolicy: 'lowestHp', focus: 2 }), [foe('a', 100), foe('b', 20), foe('c', 100)]).events);
    expect(focusCast).toMatchObject({ targetUnit: 2, targetPolicy: 'focus' });
    expect(focusCast.targetValue).toBeUndefined();
  });

  it('skillCast marks AoE with `aoe` + `targets`, and support casts carry no target fields', () => {
    type Cast = { targetUnit?: number; targetPolicy?: string; aoe?: boolean; targets?: number[] };
    const findCast = (events: ReturnType<typeof simulate>['events']): Cast =>
      events.find((e) => e.kind === 'skillCast' && e.side === 'player') as unknown as Cast;

    const aoeCast = findCast(run(attacker('aoe'), [foe('a', 500), foe('b', 500), foe('c', 500)]).events);
    expect(aoeCast).toMatchObject({ aoe: true, targets: [0, 1, 2] });
    expect(aoeCast.targetUnit).toBeUndefined();
    expect(aoeCast.targetPolicy).toBeUndefined();

    // A self-only cast (taunt) has no offensive action → no target fields.
    const tank = tc('tank', ['taunt'], { speed: 40, maxHp: 500 }, { skillBook: BOOK });
    const config: CombatConfig = { playerTeam: [tank], enemyTeam: [foe('a', 500)], skillBook: BOOK, ...NO_ENDGAME };
    const supportCast = findCast(simulate(config, 1).events);
    expect(supportCast.targetUnit).toBeUndefined();
    expect(supportCast.aoe).toBeUndefined();
    expect(supportCast.targetPolicy).toBeUndefined();
  });

  it('AoE damage events carry `unit`, and gains expose every living unit in canonical order', () => {
    const { events } = run(attacker('aoe'), [foe('a', 500), foe('b', 500)]);
    const gains = events.filter(
      (event): event is Extract<ReturnType<typeof simulate>['events'][number], { kind: 'gain' }> =>
        event.kind === 'gain' && event.turn === 1,
    );
    expect(gains.map((event) => [event.side, event.unit])).toEqual([
      ['player', 0],
      ['enemy', 0],
      ['enemy', 1],
    ]);
    expect(events.find((event) => event.kind === 'play')).toMatchObject({ side: 'player', unit: 0 });
  });
});
