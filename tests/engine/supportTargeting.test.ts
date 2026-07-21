import { describe, expect, it } from 'vitest';
import { simulate } from '../../src/engine/combat/simulate';
import { resolveTargets, type Ctx } from '../../src/engine/combat/interpreter';
import { initCombatState, type CombatState, type CombatantState } from '../../src/engine/combat/state';
import { Rng } from '../../src/engine/rng';
import type { CombatConfig, CombatantSetup, SkillBook, SkillDef } from '../../src/engine/types';
import { tc, NO_ENDGAME } from '../helpers';

/**
 * ALLY-TARGET support auto-policies (deferred targeting). These exercise
 * `resolveTargets`'s support path directly (pure, deterministic, no RNG) plus
 * one end-to-end sim to prove the result event carries the ally `(side,unit)`.
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
    effects: [{ kind: 'damage', power: 100 }],
    text: '',
  },
  healTrue: {
    id: 'healTrue',
    name: 'Mend',
    archetypes: ['healing'],
    property: 'true',
    size: 1,
    speedWeight: 10,
    rarity: 'common',
    tier: 'bronze',
    effects: [{ kind: 'heal', power: 30 }],
    text: '',
  },
};

/** A minimal support SkillDef stub — `resolveTargets`'s support path reads only the action. */
const SUPPORT_SKILL: SkillDef = {
  id: 'support',
  name: 'Support',
  archetypes: ['support'],
  property: 'physical',
  size: 1,
  speedWeight: 10,
  rarity: 'common',
  tier: 'bronze',
  effects: [],
  text: '',
};

function unit(name: string, stats: Partial<CombatantSetup['stats']> = {}): CombatantSetup {
  return tc(name, [], stats, { skillBook: BOOK });
}

/** Build a combat state with the given player team and a single dummy enemy. */
function ctxFor(players: CombatantSetup[]): { ctx: Ctx; team: CombatantState[] } {
  const state: CombatState = initCombatState({
    playerTeam: players,
    enemyTeam: [tc('dummy', ['strike'], { speed: 1 }, { skillBook: BOOK })],
    skillBook: BOOK,
    ...NO_ENDGAME,
  });
  return { ctx: { state, rng: new Rng(1), events: [] }, team: state.playerTeam };
}

describe('ally-target support auto-policies', () => {
  it('heal targets the LOWEST HP FRACTION ally (fraction, not absolute)', () => {
    const { ctx, team } = ctxFor([unit('healer', { maxHp: 50, hp: 40 }), unit('ally', { maxHp: 100, hp: 60 })]);
    // healer: 40/50 = 0.80 fraction, LOWER absolute hp; ally: 60/100 = 0.60 fraction.
    const picked = resolveTargets(ctx, team[0]!, SUPPORT_SKILL, { kind: 'heal', power: 30 });
    expect(picked[0]!.index).toBe(1); // lower FRACTION wins despite higher absolute hp
  });

  it('heal ties (equal fraction) break to the lowest living index', () => {
    const { ctx, team } = ctxFor([unit('a', { maxHp: 100, hp: 50 }), unit('b', { maxHp: 200, hp: 100 })]);
    // both 0.50 fraction → lowest index.
    const picked = resolveTargets(ctx, team[0]!, SUPPORT_SKILL, { kind: 'heal', power: 30 });
    expect(picked[0]!.index).toBe(0);
  });

  it('attack buff picks the HIGHEST-attack UN-BUFFED ally, skipping an already-buffed one', () => {
    const { ctx, team } = ctxFor([
      unit('buffed', { attack: 30 }),
      unit('mid', { attack: 20 }),
      unit('top', { attack: 25 }),
    ]);
    // Unit 0 has the highest attack but already carries an attack buff → skipped.
    team[0]!.statuses.push({ kind: 'buff', stat: 'attack', pct: 50, turnsLeft: 3 });
    const picked = resolveTargets(ctx, team[0]!, SUPPORT_SKILL, { kind: 'buffStat', stat: 'attack', pct: 20, turns: 3 });
    expect(picked[0]!.index).toBe(2); // highest attack among the un-buffed (25 > 20)
  });

  it('magicPower buff picks the higher-magicPower ally', () => {
    const { ctx, team } = ctxFor([unit('a', { magicPower: 10 }), unit('b', { magicPower: 40 })]);
    const picked = resolveTargets(ctx, team[0]!, SUPPORT_SKILL, { kind: 'buffStat', stat: 'magicPower', pct: 20, turns: 3 });
    expect(picked[0]!.index).toBe(1);
  });

  it('armor buff (defensive) picks the highest-AGGRO ally, not the highest-armor one', () => {
    const { ctx, team } = ctxFor([unit('a', { armor: 100 }), unit('b', { armor: 0 })]);
    team[0]!.aggro = 5;
    team[1]!.aggro = 20; // the tank taking hits — highest aggro despite 0 armor.
    const picked = resolveTargets(ctx, team[0]!, SUPPORT_SKILL, { kind: 'buffStat', stat: 'armor', pct: 20, turns: 3 });
    expect(picked[0]!.index).toBe(1);
  });

  it('buffStat falls back to the best pick when EVERY ally already has that buff', () => {
    const { ctx, team } = ctxFor([unit('a', { attack: 20 }), unit('b', { attack: 40 })]);
    team[0]!.statuses.push({ kind: 'buff', stat: 'attack', pct: 10, turnsLeft: 3 });
    team[1]!.statuses.push({ kind: 'buff', stat: 'attack', pct: 10, turnsLeft: 3 });
    // Nobody un-buffed → refresh the highest-attack ally (index 1).
    const picked = resolveTargets(ctx, team[0]!, SUPPORT_SKILL, { kind: 'buffStat', stat: 'attack', pct: 20, turns: 3 });
    expect(picked[0]!.index).toBe(1);
  });

  it('buffStat ties (equal metric, both un-buffed) break to the lowest index', () => {
    const { ctx, team } = ctxFor([unit('a', { attack: 30 }), unit('b', { attack: 30 })]);
    const picked = resolveTargets(ctx, team[0]!, SUPPORT_SKILL, { kind: 'buffStat', stat: 'attack', pct: 20, turns: 3 });
    expect(picked[0]!.index).toBe(0);
  });

  it('cleanse targets the MOST-afflicted ally (tie → lowest index)', () => {
    const { ctx, team } = ctxFor([unit('a'), unit('b'), unit('c')]);
    team[0]!.statuses.push({ kind: 'poison', property: 'true', stacks: 5, turnsLeft: 5 });
    team[1]!.statuses.push({ kind: 'poison', property: 'true', stacks: 5, turnsLeft: 5 });
    team[1]!.statuses.push({ kind: 'stun', turnsLeft: 1 });
    // unit 1 has 2 afflictions vs unit 0's 1; unit 2 has none.
    const picked = resolveTargets(ctx, team[0]!, SUPPORT_SKILL, { kind: 'cleanse', charges: 4 });
    expect(picked[0]!.index).toBe(1);
  });

  it('cleanse falls back to SELF when nobody is afflicted', () => {
    const { ctx, team } = ctxFor([unit('a'), unit('b')]);
    const picked = resolveTargets(ctx, team[1]!, SUPPORT_SKILL, { kind: 'cleanse', charges: 4 });
    expect(picked[0]!.index).toBe(1); // caster = self, no-op
  });

  it('1v1: the only same-side candidate is the caster → support stays on self', () => {
    const { ctx, team } = ctxFor([unit('solo', { maxHp: 100, hp: 30 })]);
    expect(resolveTargets(ctx, team[0]!, SUPPORT_SKILL, { kind: 'heal', power: 30 })[0]!.index).toBe(0);
    expect(resolveTargets(ctx, team[0]!, SUPPORT_SKILL, { kind: 'cleanse', charges: 4 })[0]!.index).toBe(0);
    expect(resolveTargets(ctx, team[0]!, SUPPORT_SKILL, { kind: 'buffStat', stat: 'attack', pct: 20, turns: 3 })[0]!.index).toBe(0);
  });

  it('shield/guard/negate stay on the caster (self-protect) even with allies present', () => {
    const { ctx, team } = ctxFor([unit('a', { maxHp: 100, hp: 30 }), unit('b', { maxHp: 100, hp: 10 })]);
    // Caster is index 0; a hurt ally exists at index 1, but these are self-only.
    expect(resolveTargets(ctx, team[0]!, SUPPORT_SKILL, { kind: 'shield', power: 50 })[0]!.index).toBe(0);
    expect(resolveTargets(ctx, team[0]!, SUPPORT_SKILL, { kind: 'guard', property: 'physical', pct: 30, turns: 2 })[0]!.index).toBe(0);
    expect(resolveTargets(ctx, team[0]!, SUPPORT_SKILL, { kind: 'negate', property: 'magical', charges: 1 })[0]!.index).toBe(0);
  });

  it('end-to-end: a healthy healer heals the hurt ally; the heal event carries the ally (side,unit)', () => {
    const healer = tc('cleric', ['healTrue'], { speed: 40, maxHp: 100 }, { skillBook: BOOK }); // full HP
    const ally = tc('ally', [], { speed: 1, maxHp: 100, hp: 40 }, { skillBook: BOOK }); // hurt
    const foe = tc('foe', ['strike'], { speed: 1, attack: 1, maxHp: 500 }, { skillBook: BOOK });
    const config: CombatConfig = { playerTeam: [healer, ally], enemyTeam: [foe], skillBook: BOOK, ...NO_ENDGAME, cooldownsEnabled: false };
    const { events } = simulate(config, 1);

    const heal = events.find((e) => e.kind === 'heal') as { side: string; unit: number; amount: number; hpAfter: number };
    expect(heal).toBeDefined();
    expect(heal.side).toBe('player');
    expect(heal.unit).toBe(1); // the ally, NOT the caster (index 0)
    expect(heal.amount).toBe(30);
    expect(heal.hpAfter).toBe(70);
  });

  it('end-to-end 1v1: a hurt solo hero self-heals; the heal event is (player,0)', () => {
    const hero = tc('hero', ['healTrue'], { speed: 40, maxHp: 100, hp: 40 }, { skillBook: BOOK });
    const foe = tc('foe', ['strike'], { speed: 1, attack: 1, maxHp: 500 }, { skillBook: BOOK });
    const config: CombatConfig = { playerTeam: [hero], enemyTeam: [foe], skillBook: BOOK, ...NO_ENDGAME, cooldownsEnabled: false };
    const { events } = simulate(config, 1);
    const heal = events.find((e) => e.kind === 'heal') as { side: string; unit: number };
    expect(heal).toMatchObject({ side: 'player', unit: 0 });
  });
});
