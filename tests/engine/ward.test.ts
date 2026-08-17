import { describe, expect, it } from 'vitest';
import { simulate } from '../../src/engine/combat/simulate';
import { MAX_WARD_CHARGES } from '../../src/engine/types';
import type { CombatConfig, CombatantSetup, SkillBook, SkillDef } from '../../src/engine/types';
import type { CombatEvent } from '../../src/engine/combat/events';
import type { CombatantState } from '../../src/engine/combat/state';

/**
 * WARD — charge-based prevention of incoming afflictions ("debuff shield").
 *
 * Contract under test (see the `ward` Action doc in src/engine/types.ts):
 *  - a charge cancels one whole affliction APPLICATION before it lands: the
 *    status never enters `statuses` and no `statusApplied` is emitted for it;
 *  - ONE charge per application regardless of stack count — a poison-5 costs
 *    one charge, not five (the negate parallel, deliberately unlike cleanse);
 *  - and regardless of APPLICATION ORDER: a MERGE into a pile the holder
 *    already carries is prevented too, at the same one-charge price. Ward
 *    PREVENTS rather than cleanses, so the standing pile survives untouched;
 *  - the prevention is announced by a `warded` event that NAMES the affliction
 *    it denied, with the holder's remaining charges;
 *  - charges decrement per prevention and the pile emits `statusExpired` at 0,
 *    after which the next affliction lands normally;
 *  - it cannot block BUFFS (guard/thorns/buffStat), and therefore cannot
 *    consume ITSELF — ward is not a cleansable affliction;
 *  - it cannot block a STUN either: ward is an ailment shield (DoTs + stat
 *    debuffs), and lockdown is out of its remit (`isWardable` vs
 *    `isCleansable` — cleanse still strips stuns);
 *  - total charges clamp to MAX_WARD_CHARGES at apply time.
 */

const book: SkillBook = {
  // ── the wards. cooldown 99 = cast ONCE, so a scenario tests a single pile
  //    rather than the rotation topping it up every few turns.
  wardOne: {
    id: 'wardOne', name: 'Ward One', archetypes: ['defensive'], property: 'magical', size: 1,
    rarity: 'common', tier: 'bronze', element: 'holy', cooldownTurns: 99,
    effects: [{ kind: 'ward', charges: 1 }], text: '{{Ward}} 1.',
  },
  wardTwo: {
    id: 'wardTwo', name: 'Ward Two', archetypes: ['defensive'], property: 'magical', size: 1,
    rarity: 'common', tier: 'bronze', element: 'holy', cooldownTurns: 99,
    effects: [{ kind: 'ward', charges: 2 }], text: '{{Ward}} 2.',
  },
  wardThree: {
    id: 'wardThree', name: 'Ward Three', archetypes: ['defensive'], property: 'magical', size: 1,
    rarity: 'common', tier: 'bronze', element: 'holy', cooldownTurns: 99,
    effects: [{ kind: 'ward', charges: MAX_WARD_CHARGES }], text: '{{Ward}} 3.',
  },
  // cooldown 0 = recasts every rotation, which is what exercises the apply-time
  // clamp and the "a ward never wards itself" rule.
  wardOneQuick: {
    id: 'wardOneQuick', name: 'Ward Quick', archetypes: ['defensive'], property: 'magical', size: 1,
    rarity: 'common', tier: 'bronze', element: 'holy', cooldownTurns: 0,
    effects: [{ kind: 'ward', charges: 1 }], text: '{{Ward}} 1.',
  },
  wardTwoQuick: {
    id: 'wardTwoQuick', name: 'Ward Two Quick', archetypes: ['defensive'], property: 'magical', size: 1,
    rarity: 'common', tier: 'bronze', element: 'holy', cooldownTurns: 0,
    effects: [{ kind: 'ward', charges: 2 }], text: '{{Ward}} 2.',
  },

  // ── the afflictions (all offensive, so they land on the warded unit)
  venom: {
    id: 'venom', name: 'Venom', archetypes: ['debuff'], property: 'magical', size: 1,
    rarity: 'common', tier: 'bronze', element: 'nature', cooldownTurns: 99,
    effects: [{ kind: 'poison', stacks: 3 }], text: '{{Poison}} 3.',
  },
  venomFive: {
    id: 'venomFive', name: 'Venom Five', archetypes: ['debuff'], property: 'magical', size: 1,
    rarity: 'common', tier: 'bronze', element: 'nature', cooldownTurns: 99,
    effects: [{ kind: 'poison', stacks: 5 }], text: '{{Poison}} 5.',
  },
  venomQuick: {
    id: 'venomQuick', name: 'Venom Quick', archetypes: ['debuff'], property: 'magical', size: 1,
    rarity: 'common', tier: 'bronze', element: 'nature', cooldownTurns: 0,
    effects: [{ kind: 'poison', stacks: 3 }], text: '{{Poison}} 3.',
  },
  hex: {
    id: 'hex', name: 'Hex', archetypes: ['debuff'], property: 'magical', size: 1,
    rarity: 'common', tier: 'bronze', element: 'dark', cooldownTurns: 99,
    effects: [{ kind: 'debuffStat', stat: 'armor', pct: 30, turns: 3 }], text: '-30% DEF.',
  },
  bash: {
    id: 'bash', name: 'Bash', archetypes: ['debuff'], property: 'physical', size: 1,
    rarity: 'common', tier: 'bronze', weapon: 'axe', cooldownTurns: 99,
    effects: [{ kind: 'stun', turns: 1 }], text: '{{Stun}}.',
  },
  mark: {
    id: 'mark', name: 'Mark', archetypes: ['debuff'], property: 'magical', size: 1,
    rarity: 'common', tier: 'bronze', element: 'dark', cooldownTurns: 99,
    effects: [{ kind: 'expose', pct: 30, turns: 3 }], text: 'Expose 30%.',
  },

  // ── self BUFFS a warded unit casts on itself (ward must not touch these)
  bramble: {
    id: 'bramble', name: 'Bramble', archetypes: ['defensive'], property: 'physical', size: 1,
    rarity: 'common', tier: 'bronze', weapon: 'sword', cooldownTurns: 99,
    effects: [{ kind: 'thorns', stacks: 3 }], text: '{{Thorns}} 3.',
  },
  aegis: {
    id: 'aegis', name: 'Aegis', archetypes: ['defensive'], property: 'physical', size: 1,
    rarity: 'common', tier: 'bronze', weapon: 'sword', cooldownTurns: 99,
    effects: [{ kind: 'guard', property: 'physical', pct: 30, turns: 3 }], text: 'Guard 30%.',
  },
  rally: {
    id: 'rally', name: 'Rally', archetypes: ['support'], property: 'magical', size: 1,
    rarity: 'common', tier: 'bronze', element: 'holy', cooldownTurns: 99,
    effects: [{ kind: 'buffStat', stat: 'attack', pct: 20, turns: 3 }], text: '+20% ATK.',
  },

  // ── a harmless opponent: heals itself, never afflicts anything
  mend: {
    id: 'mend', name: 'Mend', archetypes: ['healing'], property: 'magical', size: 1,
    rarity: 'common', tier: 'bronze', element: 'holy', cooldownTurns: 0,
    effects: [{ kind: 'heal', power: 4 }], text: 'Restore 4 HP.',
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

function runFull(player: CombatantSetup, enemy: CombatantSetup): { events: readonly CombatEvent[]; player: CombatantState } {
  const config: CombatConfig = { playerTeam: [player], enemyTeam: [enemy], skillBook: book };
  const out = simulate(config, 1);
  return { events: out.events, player: out.finalState.playerTeam[0]! };
}

function run(player: CombatantSetup, enemy: CombatantSetup): readonly CombatEvent[] {
  return runFull(player, enemy).events;
}

type Warded = Extract<CombatEvent, { kind: 'warded' }>;
type Applied = Extract<CombatEvent, { kind: 'statusApplied' }>;

const wardedEvents = (events: readonly CombatEvent[]): Warded[] =>
  events.filter((e): e is Warded => e.kind === 'warded');
const appliedOf = (events: readonly CombatEvent[], status: Applied['status']): Applied[] =>
  events.filter((e): e is Applied => e.kind === 'statusApplied' && e.status === status);
const chargesHeld = (c: CombatantState): number =>
  c.statuses.filter((s) => s.kind === 'ward').reduce((sum, s) => sum + (s.charges ?? 0), 0);

describe('ward', () => {
  it('one charge prevents one whole poison application: no status, no statusApplied, no ticks', () => {
    // The enemy applies poison exactly once (cooldown 99). The single ward
    // charge must deny it outright — the pile never exists, so it never ticks.
    const { events, player } = runFull(unit('holder', ['wardOne']), unit('poisoner', ['venom']));
    expect(appliedOf(events, 'poison'), 'the poison must never be applied').toEqual([]);
    expect(player.statuses.some((s) => s.kind === 'poison'), 'no poison pile may exist').toBe(false);
    expect(events.some((e) => e.kind === 'damage' && e.source === 'poison'), 'a denied DoT never ticks').toBe(false);
    // and the denial is announced, naming what it denied
    const warded = wardedEvents(events);
    expect(warded.length).toBe(1);
    expect(warded[0]!.status).toBe('poison');
    expect(warded[0]!.side).toBe('player');
  });

  it('a 5-stack DoT costs exactly ONE charge, not five', () => {
    // The negate parallel: one charge = one whole thing denied, whatever its
    // magnitude. (Cleanse, by contrast, pays per stack.)
    const { events, player } = runFull(unit('holder', ['wardThree']), unit('poisoner', ['venomFive']));
    const warded = wardedEvents(events);
    expect(warded.length, 'one application = one prevention event').toBe(1);
    expect(warded[0]!.status).toBe('poison');
    expect(warded[0]!.chargesLeft, 'exactly one of the three charges is spent').toBe(MAX_WARD_CHARGES - 1);
    expect(chargesHeld(player)).toBe(MAX_WARD_CHARGES - 1);
    expect(appliedOf(events, 'poison')).toEqual([]);
  });

  it('charges decrement per prevented affliction and the pile expires at 0', () => {
    const events = run(unit('holder', ['wardTwo']), unit('poisoner', ['venomQuick']));
    const warded = wardedEvents(events);
    expect(warded.length).toBeGreaterThanOrEqual(2);
    expect(warded.slice(0, 2).map((e) => e.chargesLeft)).toEqual([1, 0]);
    // exactly two preventions ever happen — a 2-charge ward cannot deny a third
    expect(warded.length).toBe(2);
    const expired = events.findIndex((e) => e.kind === 'statusExpired' && e.status === 'ward');
    expect(expired, 'a spent ward must announce its expiry').toBeGreaterThan(-1);
    expect(expired, 'expiry comes after the charge that emptied it').toBeGreaterThan(events.indexOf(warded[1]!));
  });

  it('after the ward is spent, the next affliction lands normally', () => {
    const { events, player } = runFull(unit('holder', ['wardTwo']), unit('poisoner', ['venomQuick']));
    const lastWarded = events.indexOf(wardedEvents(events)[1]!);
    const applied = appliedOf(events, 'poison');
    expect(applied.length, 'poison must land once the charges are gone').toBeGreaterThan(0);
    expect(events.indexOf(applied[0]!)).toBeGreaterThan(lastWarded);
    expect(applied[0]!.stacks).toBe(3);
    expect(events.some((e) => e.kind === 'damage' && e.source === 'poison'), 'and it ticks').toBe(true);
    expect(chargesHeld(player), 'no charges left to hold').toBe(0);
  });

  it('does NOT block buffs — guard, thorns and buffStat still apply to a warded unit', () => {
    const { events, player } = runFull(
      unit('holder', ['wardOne', 'bramble', 'aegis', 'rally']),
      unit('pacifist', ['mend']),
    );
    expect(appliedOf(events, 'thorns').length, 'thorns must land').toBeGreaterThan(0);
    expect(appliedOf(events, 'guard').length, 'guard must land').toBeGreaterThan(0);
    expect(appliedOf(events, 'buff').length, 'buffStat must land').toBeGreaterThan(0);
    expect(wardedEvents(events), 'a buff must never spend a ward charge').toEqual([]);
    expect(chargesHeld(player), 'the charge is still there, unspent').toBe(1);
  });

  it('does not consume ITSELF: re-warding a warded unit spends no charge', () => {
    // A 1-charge ward recast every rotation. If `ward` were wardable, the second
    // cast would burn the first charge and the pile would never grow.
    const { events, player } = runFull(unit('holder', ['wardOneQuick']), unit('pacifist', ['mend']));
    const applied = appliedOf(events, 'ward');
    expect(applied.length, 'the recast must actually apply').toBeGreaterThan(1);
    expect(wardedEvents(events), 'ward is not a cleansable affliction').toEqual([]);
    expect(events.some((e) => e.kind === 'statusExpired' && e.status === 'ward')).toBe(false);
    expect(chargesHeld(player)).toBe(MAX_WARD_CHARGES);
  });

  it('charges clamp at MAX_WARD_CHARGES', () => {
    // 2 charges per cast, recast every rotation: 2 then the clamped 1, then the
    // arm short-circuits (no third application) — never more than the ceiling.
    const { events, player } = runFull(unit('holder', ['wardTwoQuick']), unit('pacifist', ['mend']));
    const applied = appliedOf(events, 'ward');
    expect(applied.map((e) => e.charges)).toEqual([2, 1]);
    expect(applied.reduce((sum, e) => sum + (e.charges ?? 0), 0)).toBe(MAX_WARD_CHARGES);
    expect(chargesHeld(player)).toBe(MAX_WARD_CHARGES);
  });

  it('a warded event NAMES the prevented affliction kind (debuff and expose, not just DoTs)', () => {
    // Every `isWardable` kind is prevented, and the event must say WHICH — a
    // bare "warded" is unrenderable. Note a `debuffStat` action lands as the
    // status kind 'debuff'. The stun in the middle of this board is deliberate:
    // it is NOT wardable, so it must pass straight through between the two that
    // are, without consuming a charge or emitting an event.
    const holder = unit('holder', ['wardThree']);
    const afflicter = unit('afflicter', ['hex', 'bash', 'mark']);
    const { events } = runFull(holder, afflicter);
    expect(wardedEvents(events).map((e) => e.status)).toEqual(['debuff', 'expose']);
    expect(appliedOf(events, 'debuff')).toEqual([]);
    expect(appliedOf(events, 'expose')).toEqual([]);
    // the stun landed instead of being warded, and cost no charge
    expect(appliedOf(events, 'stun').length).toBeGreaterThan(0);
    expect(wardedEvents(events).map((e) => e.chargesLeft)).toEqual([2, 1]);
  });

  it('does NOT block a stun — lockdown is outside an ailment shield\'s remit', () => {
    // `isWardable` is `isCleansable` minus stun (user-locked): ward covers the
    // DoT/stat-debuff family, cleanse still strips stuns.
    const { events, player } = runFull(unit('holder', ['wardThree']), unit('stunner', ['bash']));
    expect(appliedOf(events, 'stun').length, 'the stun must land').toBeGreaterThan(0);
    expect(wardedEvents(events), 'and it must not spend a charge').toEqual([]);
    expect(chargesHeld(player), 'all charges intact').toBe(MAX_WARD_CHARGES);
  });

  // ── MERGE PATH: an affliction applied onto a pile the holder ALREADY carries
  //    is a second application, and ward must tax it exactly like the first.
  //    Without this, ward half-worked depending on application ORDER — weakest
  //    precisely when a player would reach for it (already afflicted).

  it('prevents a MERGE into a standing pile, for exactly ONE charge', () => {
    // T1 the holder is still casting `mend`, so the enemy's poison-3 lands
    // unopposed. T2 the ward goes up first, then the enemy's poison-FIVE tries
    // to merge into that standing pile — and is denied for ONE charge, not five.
    const { events, player } = runFull(
      unit('holder', ['mend', 'wardThree']),
      unit('afflicter', ['venom', 'venomFive']),
    );
    const applied = appliedOf(events, 'poison');
    const warded = wardedEvents(events);
    expect(applied.length, 'only the pre-ward application ever lands').toBe(1);
    expect(applied[0]!.stacks).toBe(3);
    expect(warded.length).toBe(1);
    expect(warded[0]!.status).toBe('poison');
    expect(warded[0]!.chargesLeft, 'a 5-stack MERGE costs one charge, not five').toBe(MAX_WARD_CHARGES - 1);
    expect(events.indexOf(warded[0]!), 'the prevention follows the pile it protected').toBeGreaterThan(
      events.indexOf(applied[0]!),
    );
    expect(chargesHeld(player)).toBe(MAX_WARD_CHARGES - 1);
  });

  it('a prevented merge leaves the standing pile untouched and still ticking', () => {
    // Ward PREVENTS, it does not cleanse. The pile keeps its own 3 stacks and
    // its own schedule: a decaying 3-pile deals exactly 3+2+1 = 6 and expires.
    // Had the poison-5 merged, the pile would have been 8 and dealt 36.
    const { events } = runFull(
      unit('holder', ['mend', 'wardThree']),
      unit('afflicter', ['venom', 'venomFive']),
    );
    const ticks = events.filter(
      (e): e is Extract<CombatEvent, { kind: 'damage' }> =>
        e.kind === 'damage' && e.source === 'poison' && e.side === 'player',
    );
    expect(ticks.map((e) => e.amount)).toEqual([3, 2, 1]);
    const wardedAt = events.indexOf(wardedEvents(events)[0]!);
    expect(ticks.filter((t) => events.indexOf(t) > wardedAt).length, 'it keeps ticking after the prevention').toBeGreaterThan(0);
    expect(events.some((e) => e.kind === 'statusExpired' && e.status === 'poison'), 'and expires on its own schedule').toBe(true);
  });

  it('works when the ward is applied AFTER the first affliction — every later application is taxed', () => {
    // The order that used to defeat it entirely: poison first, ward second. Each
    // subsequent reapplication is a merge, and each must burn a charge until the
    // pile of charges is gone, after which merges land again.
    const { events } = runFull(
      unit('holder', ['mend', 'wardTwo']),
      unit('afflicter', ['venomQuick']),
    );
    const warded = wardedEvents(events);
    expect(warded.map((e) => e.chargesLeft), 'both charges spent on merges').toEqual([1, 0]);
    for (const w of warded) expect(w.status).toBe('poison');
    expect(events.some((e) => e.kind === 'statusExpired' && e.status === 'ward')).toBe(true);
    const applied = appliedOf(events, 'poison');
    const firstWard = events.indexOf(warded[0]!);
    const lastWard = events.indexOf(warded[1]!);
    expect(events.indexOf(applied[0]!), 'the pre-ward application landed').toBeLessThan(firstWard);
    expect(
      applied.some((a) => events.indexOf(a) > lastWard),
      'and merges land again once the charges are gone',
    ).toBe(true);
  });
});
