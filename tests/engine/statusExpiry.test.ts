import { describe, expect, it } from 'vitest';
import { simulate } from '../../src/engine/combat/simulate';
import {
  TURN_DURATIONED_STATUS_KINDS,
  isTurnDurationed,
  type StatusInstance,
} from '../../src/engine/combat/state';
import type { CombatConfig, CombatantSetup, SkillBook, SkillDef } from '../../src/engine/types';
import type { CombatEvent } from '../../src/engine/combat/events';

/**
 * STATUS EXPIRY — every kind must expire by EXACTLY ONE mechanism.
 *
 * REGRESSION: `expose` expired by NONE of them. It is documented as lasting
 * "for `turns` global turns" (types.ts) and priced `pct × turns`
 * (`exposePerPctTurnNum`, balance.ts), but `expireStatuses` decremented only a
 * hard-coded `buff`/`debuff`/`guard` chain — so an expose lasted the whole
 * fight, and (with re-application opening a fresh pile each cast) COMPOUNDED
 * multiplicatively without bound: a card printing "expose 50% for 1 turn",
 * recast on its rotation, measured 30 -> 45 -> 67 -> 100 -> 181 -> 316 -> 546
 * -> 913 -> 1531 damage on a fixed 20-power hit, with ZERO `statusExpired`
 * events. Two shipped cards carried it (`ruinous_hex` 50%/2t, `piercing_arrow`
 * 30%/2t).
 *
 * The tests below pin BOTH halves of the fix and the structural guard that
 * makes a third kind falling into the same crack a red test rather than a
 * silent infinity.
 */

const book: SkillBook = {
  // Applied once (cooldown 99) so the DURATION is measurable in isolation.
  hex: {
    id: 'hex', name: 'Hex', archetypes: ['debuff'], property: 'magical', size: 1,
    speedWeight: 10, rarity: 'common', tier: 'bronze', element: 'dark', cooldownTurns: 99,
    effects: [{ kind: 'expose', pct: 50, turns: 2 }], text: '',
  },
  // Recasts every rotation — the compounding engine of the original defect.
  hexLoop: {
    id: 'hexLoop', name: 'Hex Loop', archetypes: ['debuff'], property: 'magical', size: 1,
    speedWeight: 10, rarity: 'common', tier: 'bronze', element: 'dark', cooldownTurns: 0,
    effects: [{ kind: 'expose', pct: 50, turns: 2 }], text: '',
  },
  // Two exposes of DIFFERENT magnitude/duration in one cast: the refresh must
  // keep the stronger pct and the longer window, whichever order they arrive in.
  hexWeakThenStrong: {
    id: 'hexWeakThenStrong', name: 'Weak then Strong', archetypes: ['debuff'], property: 'magical', size: 1,
    speedWeight: 10, rarity: 'common', tier: 'bronze', element: 'dark', cooldownTurns: 99,
    effects: [{ kind: 'expose', pct: 20, turns: 1 }, { kind: 'expose', pct: 50, turns: 4 }], text: '',
  },
  hexStrongThenWeak: {
    id: 'hexStrongThenWeak', name: 'Strong then Weak', archetypes: ['debuff'], property: 'magical', size: 1,
    speedWeight: 10, rarity: 'common', tier: 'bronze', element: 'dark', cooldownTurns: 99,
    effects: [{ kind: 'expose', pct: 50, turns: 4 }, { kind: 'expose', pct: 20, turns: 1 }], text: '',
  },
  // A plain 20-power hit: with attack 10 it deals exactly 30 unexposed and
  // 30 + floor(30 * 0.5) = 45 under ONE 50% expose.
  hit: {
    id: 'hit', name: 'Hit', archetypes: ['offense'], property: 'physical', size: 1,
    speedWeight: 10, rarity: 'common', tier: 'bronze', weapon: 'sword', cooldownTurns: 0,
    effects: [{ kind: 'damage', power: 20 }], text: '',
  },
} satisfies Record<string, SkillDef>;

function hero(pieces: string[]): CombatantSetup {
  return {
    name: 'hero',
    stats: { maxHp: 5000, hp: 5000, attack: 10, magicPower: 0, armor: 0, magicResist: 0, speed: 10 },
    boardSize: 10,
    pieces: pieces.map((skillId, i) => ({ skillId, slot: i })),
  };
}

/** A pure punching bag: no board, no armor, effectively unkillable. */
function dummy(): CombatantSetup {
  return {
    name: 'dummy',
    stats: { maxHp: 1_000_000, hp: 1_000_000, attack: 0, magicPower: 0, armor: 0, magicResist: 0, speed: 1 },
    boardSize: 10,
    pieces: [],
  };
}

function run(pieces: string[], maxTurns: number): readonly CombatEvent[] {
  const config: CombatConfig = {
    playerTeam: [hero(pieces)],
    enemyTeam: [dummy()],
    skillBook: book,
    suddenDeathRound: 999,
    fatigueTurn: 999_999,
    attritionTurn: 999_999,
    maxTurns,
  };
  return simulate(config, 1).events;
}

type StatusApplied = Extract<CombatEvent, { kind: 'statusApplied' }>;
type StatusExpired = Extract<CombatEvent, { kind: 'statusExpired' }>;
type DamageEvent = Extract<CombatEvent, { kind: 'damage' }>;

const exposeApplied = (events: readonly CombatEvent[]): StatusApplied[] =>
  events.filter((e): e is StatusApplied => e.kind === 'statusApplied' && e.status === 'expose');
const exposeExpired = (events: readonly CombatEvent[]): StatusExpired[] =>
  events.filter((e): e is StatusExpired => e.kind === 'statusExpired' && e.status === 'expose');
const skillHits = (events: readonly CombatEvent[]): DamageEvent[] =>
  events.filter((e): e is DamageEvent => e.kind === 'damage' && e.source === 'skill');

describe('expose EXPIRES (it is a global-turn duration, not a permanent debuff)', () => {
  it('emits statusExpired exactly `turns` global turns after it was applied', () => {
    const events = run(['hex', 'hit'], 8);
    const applied = exposeApplied(events);
    const expired = exposeExpired(events);
    expect(applied, 'the hex must land exactly once (cooldown 99)').toHaveLength(1);
    expect(expired, 'REGRESSION: expose never expired at all').toHaveLength(1);
    // Same convention as buff/debuff/guard: a status applied on turn T is `fresh`
    // (it skips turn T's end-of-turn decrement) and then loses one per turn, so a
    // `turns: 2` pile announces its expiry at the END of turn T + 2.
    expect(expired[0]!.turn).toBe(applied[0]!.turn + 2);
  });

  it('stops amplifying once it has expired — the hits after the window are raw again', () => {
    const events = run(['hex', 'hit'], 8);
    const expiredTurn = exposeExpired(events)[0]!.turn;
    const hits = skillHits(events);
    expect(hits.length).toBeGreaterThan(2);
    for (const h of hits) {
      if (h.turn <= expiredTurn) continue;
      expect(h.exposed, `a hit on turn ${h.turn} (after expiry) must not be amplified`).toBeUndefined();
      expect(h.amount).toBe(30); // power 20 + Attack 10, nothing on top
    }
    // ...and it genuinely amplified while it was up, so the scenario is real.
    expect(hits.some((h) => (h.exposed ?? 0) > 0)).toBe(true);
  });

  it('a repeating expose card can NEVER run away: damage stays bounded at the single-pile value', () => {
    // THE ORIGINAL DEFECT, reproduced end to end. `hexLoop` re-applies every
    // rotation for many turns; every hit must be either 30 (no expose up) or 45
    // (one 50% pile up) — never the 67 / 100 / 181 / 316 ... ramp.
    const events = run(['hexLoop', 'hit'], 30);
    const applied = exposeApplied(events);
    expect(applied.length, 'the loop card must actually re-apply many times').toBeGreaterThan(3);
    const hits = skillHits(events);
    expect(hits.length).toBeGreaterThan(3);
    for (const h of hits) expect([30, 45]).toContain(h.amount);
    // Every re-application reports ONE clamped pct, never a growing pile.
    for (const a of applied) expect(a.pct).toBe(50);
  });
});

describe('expose is ONE PILE PER VICTIM, refreshed (never a second concurrent pile)', () => {
  it('a re-application keeps the STRONGER pct and the LONGER duration, in either order', () => {
    for (const cardId of ['hexWeakThenStrong', 'hexStrongThenWeak']) {
      const events = run([cardId, 'hit'], 10);
      const applied = exposeApplied(events);
      expect(applied, `${cardId}: two expose actions, two events`).toHaveLength(2);
      // Whichever arrived second, the pile ends up at the max of both fields.
      expect(applied[1]!.pct, `${cardId}: pct must be the stronger of the two`).toBe(50);
      expect(applied[1]!.turns, `${cardId}: duration must be the longer of the two`).toBe(4);
      // ONE pile: the hit is amplified once (45), never twice (30 -> 45 -> 67).
      const amplified = skillHits(events).filter((h) => (h.exposed ?? 0) > 0);
      expect(amplified.length, `${cardId}: the window must be non-empty`).toBeGreaterThan(0);
      for (const h of amplified) expect(h.amount).toBe(45);
    }
  });

  it('the victim never carries more than one expose status at any point', () => {
    const config: CombatConfig = {
      playerTeam: [hero(['hexLoop', 'hit'])],
      enemyTeam: [dummy()],
      skillBook: book,
      suddenDeathRound: 999,
      fatigueTurn: 999_999,
      attritionTurn: 999_999,
      maxTurns: 30,
    };
    const { finalState } = simulate(config, 1);
    expect(finalState.enemy.statuses.filter((s) => s.kind === 'expose').length).toBeLessThanOrEqual(1);
  });

  it('a refresh restarts the window: the expose outlives the duration of any single application', () => {
    // `hexLoop` prints turns: 2, so a NON-refreshing pile would expire 2 turns
    // after its first application and stay expired between casts. With the
    // refresh rule the window is continuous while the card keeps rotating, which
    // is what makes "refresh" different from "ignore the recast".
    const events = run(['hexLoop', 'hit'], 30);
    const firstApply = exposeApplied(events)[0]!.turn;
    const lastAmplified = skillHits(events).filter((h) => (h.exposed ?? 0) > 0).at(-1)!;
    expect(lastAmplified.turn).toBeGreaterThan(firstApply + 2);
  });
});

describe('every status kind expires by exactly one mechanism', () => {
  /**
   * THE STRUCTURAL GUARD. `expose` was invisible precisely because the expiry
   * rule was an inline `!==` chain: a kind belonging to no mechanism looked like
   * every other kind the chain skipped. This test enumerates the union and
   * demands each kind be claimed by exactly one of the four mechanisms, so a
   * newly-added kind fails HERE instead of silently lasting forever.
   */
  const ALL_KINDS: StatusInstance['kind'][] = [
    'poison', 'burn', 'bleed', 'stun', 'buff', 'debuff', 'guard', 'negate', 'expose', 'thorns', 'ward',
  ];
  /** Decayed by stacks (tickTurnDot / tickBleed / reflectThorns). */
  const STACK_DECAYED: StatusInstance['kind'][] = ['poison', 'burn', 'bleed', 'thorns'];
  /** Decremented when a performance is consumed (the perform loop). */
  const PERFORMANCE_COUNTED: StatusInstance['kind'][] = ['stun'];
  /** Permanent until their charges are spent (dealDamage / consumeWard). */
  const CHARGE_SPENT: StatusInstance['kind'][] = ['negate', 'ward'];

  it('the four mechanisms PARTITION the kind union — no kind in two, no kind in none', () => {
    for (const kind of ALL_KINDS) {
      const claims = [
        isTurnDurationed(kind),
        STACK_DECAYED.includes(kind),
        PERFORMANCE_COUNTED.includes(kind),
        CHARGE_SPENT.includes(kind),
      ].filter(Boolean).length;
      expect(claims, `${kind} must be expired by exactly one mechanism`).toBe(1);
    }
  });

  it('expose is in the TURN-DURATIONED set (the regression, stated as a fact)', () => {
    expect(TURN_DURATIONED_STATUS_KINDS).toContain('expose');
    expect([...TURN_DURATIONED_STATUS_KINDS].sort()).toEqual(['buff', 'debuff', 'expose', 'guard']);
  });
});
