import { describe, expect, it } from 'vitest';
import { simulate } from '../../src/engine/combat/simulate';
import {
  TURN_DURATIONED_STATUS_KINDS,
  isTurnDurationed,
  type StatusInstance,
} from '../../src/engine/combat/state';
import type { CombatConfig, CombatantSetup, SkillBook, SkillDef } from '../../src/engine/types';
import type { CombatEvent } from '../../src/engine/combat/events';
import { skillBook as shippedBook } from '../../src/data/skills';

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
  // Two exposes that dominate each other in NEITHER field, so both stand.
  hexSplit: {
    id: 'hexSplit', name: 'Split', archetypes: ['debuff'], property: 'magical', size: 1,
    speedWeight: 10, rarity: 'common', tier: 'bronze', element: 'dark', cooldownTurns: 99,
    effects: [{ kind: 'expose', pct: 50, turns: 1 }, { kind: 'expose', pct: 30, turns: 3 }], text: '',
  },
  // Cadence (0 cooldown) no longer than the printed duration: the shape that
  // used to hold a pile open forever.
  tinyLoop: {
    id: 'tinyLoop', name: 'Tiny Loop', archetypes: ['debuff'], property: 'magical', size: 1,
    speedWeight: 10, rarity: 'common', tier: 'bronze', element: 'dark', cooldownTurns: 0,
    effects: [{ kind: 'expose', pct: 10, turns: 1 }], text: '',
  },
  // A 0-pct expose: priced at nothing, so it must deliver nothing.
  nullExpose: {
    id: 'nullExpose', name: 'Null', archetypes: ['debuff'], property: 'magical', size: 1,
    speedWeight: 10, rarity: 'common', tier: 'bronze', element: 'dark', cooldownTurns: 0,
    effects: [{ kind: 'expose', pct: 0, turns: 1 }], text: '',
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

describe('expose applications are SEPARATE and never compound (a card delivers what it was priced for)', () => {
  /**
   * THE RULE (2026-08-18). Expose is priced per application at `pct x turns`,
   * so an application may neither borrow a stronger pile\'s pct nor weaken one:
   *  • an application some standing pile DOMINATES (>= pct AND >= turnsLeft) is
   *    ABSORBED — no pile, no refresh, no event;
   *  • an application that DOMINATES standing piles REPLACES them (each dropped
   *    with its own `statusExpired` first);
   *  • anything else COEXISTS, and a hit is amplified by the STRONGEST standing
   *    pile — never the sum, never the product.
   * The previous rule kept ONE pile at `max(pct)` with a refreshed duration,
   * which handed a weak application the strong one\'s amplification.
   */
  it('a WEAK application onto a STRONG pile is absorbed — it never borrows the strong pct', () => {
    // (50%/4t) then (20%/1t) in one cast: the weak one is fully covered, so it
    // applies nothing at all. Under the old refresh rule it emitted a SECOND
    // `statusApplied` reporting pct 50 / turns 4 — the strong card\'s value.
    const events = run(['hexStrongThenWeak', 'hit'], 10);
    const applied = exposeApplied(events);
    expect(applied, 'the dominated application must produce NO event').toHaveLength(1);
    expect(applied[0]!.pct).toBe(50);
    expect(applied[0]!.turns).toBe(4);
  });

  it('a STRONG application onto a WEAK pile supersedes it: the weak pile is dropped, not merged', () => {
    // (20%/1t) then (50%/4t): the second dominates the first in BOTH fields, so
    // the first is dropped (with its own `statusExpired`) and the second lands.
    const events = run(['hexWeakThenStrong', 'hit'], 10);
    const applied = exposeApplied(events);
    expect(applied.map((a) => [a.pct, a.turns])).toEqual([[20, 1], [50, 4]]);
    // The superseded pile is announced BEFORE the new one, so a log replay never
    // ends up holding two piles where the sim holds one.
    const supersededAt = events.findIndex((e) => e.kind === 'statusExpired' && e.status === 'expose');
    const secondAppliedAt = events.lastIndexOf(applied[1]!);
    expect(supersededAt).toBeGreaterThan(-1);
    expect(supersededAt).toBeLessThan(secondAppliedAt);
    // ...and exactly one pile stands afterwards.
    const amplified = skillHits(events).filter((h) => (h.exposed ?? 0) > 0);
    expect(amplified.length).toBeGreaterThan(0);
    for (const h of amplified) expect(h.amount).toBe(45); // 30 + floor(30 * 50%)
  });

  it('two piles that dominate each other in NEITHER field coexist, and the STRONGEST one is what amplifies (max, not sum)', () => {
    // (50%/1t) + (30%/3t): neither covers the other, so both stand. A hit while
    // both are up is amplified 50% (45), NOT 50% then 30% compounded (58) and
    // not 80% (54). Once the short strong pile expires the long weak one keeps
    // delivering its OWN 30% (39) — the value it was actually priced for.
    const events = run(['hexSplit', 'hit'], 12);
    const applied = exposeApplied(events);
    expect(applied.map((a) => [a.pct, a.turns])).toEqual([[50, 1], [30, 3]]);
    const amplified = skillHits(events).filter((h) => (h.exposed ?? 0) > 0);
    expect(amplified.length).toBeGreaterThan(1);
    for (const h of amplified) expect([45, 39]).toContain(h.amount);
    // The weak pile really does outlive the strong one at its OWN value: under
    // the old merge rule the pile stayed at 50% for the whole 3-turn window.
    expect(amplified.some((h) => h.amount === 39), 'the 30% window must be reached').toBe(true);
  });

  it('an expose on a SHORT cadence still expires: re-application does not refresh it into a permanent debuff', () => {
    // `tinyLoop` prints 10% for 1 turn on a 0-cooldown rotation — cadence <=
    // duration, the exact shape that used to hold a pile open forever (`fresh`
    // was set on every re-application, and `expireStatuses` skips a fresh pile).
    // Board is the loop card ALONE, so the cursor returns to it every single
    // turn — with a `hit` card beside it the cursor takes two turns to come
    // back round and the pile expires in the gap even under the old rule.
    const events = run(['tinyLoop'], 20);
    const applied = exposeApplied(events);
    const expired = exposeExpired(events);
    expect(applied.length, 'the loop card must actually re-apply many times').toBeGreaterThan(3);
    expect(expired.length, 'REGRESSION: 20 applications / 0 expiries').toBeGreaterThan(3);
    // Every application is worth its own printed window and no more: the pile
    // count never runs away either.
    for (const a of applied) {
      expect(a.pct).toBe(10);
      expect(a.turns).toBe(1);
    }
  });

  it('an expose of 0% (or 0 turns) applies NOTHING — it cannot prop up a standing pile, and is not a free affliction', () => {
    // A 0-pct expose is priced at 0 deci. It used to take the refresh branch and
    // re-arm whatever pile was standing, so a free action held a 50% pile open
    // indefinitely.
    const events = run(['hex', 'nullExpose', 'hit'], 12);
    const applied = exposeApplied(events);
    expect(applied.map((a) => a.pct), 'only the real hex may apply').toEqual([50]);
    const expired = exposeExpired(events);
    expect(expired, 'the hex pile must still expire on its own schedule').toHaveLength(1);
    expect(expired[0]!.turn).toBe(applied[0]!.turn + 2);
  });

  it('the pile set stays an ANTICHAIN: no standing pile is dominated by another', () => {
    const config: CombatConfig = {
      playerTeam: [hero(['hexLoop', 'hexSplit', 'tinyLoop', 'hit'])],
      enemyTeam: [dummy()],
      skillBook: book,
      suddenDeathRound: 999,
      fatigueTurn: 999_999,
      attritionTurn: 999_999,
      maxTurns: 40,
    };
    const { finalState } = simulate(config, 1);
    const piles = finalState.enemy.statuses.filter((s) => s.kind === 'expose');
    for (let i = 0; i < piles.length; i += 1) {
      for (let j = 0; j < piles.length; j += 1) {
        if (i === j) continue;
        const a = piles[i]!;
        const b = piles[j]!;
        expect((a.pct ?? 0) >= (b.pct ?? 0) && a.turnsLeft >= b.turnsLeft, 'a redundant pile survived').toBe(false);
      }
    }
  });

  it('a rotating expose card still holds its window open across casts — by paying for a new application each time', () => {
    // `hexLoop` prints turns: 2 and recasts every rotation. Its coverage is
    // continuous, but each extension is a FULL application that supersedes the
    // old pile, not a free refresh of one.
    const events = run(['hexLoop', 'hit'], 30);
    const firstApply = exposeApplied(events)[0]!.turn;
    const lastAmplified = skillHits(events).filter((h) => (h.exposed ?? 0) > 0).at(-1)!;
    expect(lastAmplified.turn).toBeGreaterThan(firstApply + 2);
    // ...and never above the single-pile value.
    for (const h of skillHits(events)) expect([30, 45]).toContain(h.amount);
  });
});

describe('SHIPPED CONTENT: piercing_arrow (30%, priced 30 deci) never delivers ruinous_hex (50%, priced 100 deci)', () => {
  /** Authored expose pct of every shipped card that has one. */
  const AUTHORED: Record<string, number> = { ruinous_hex: 50, piercing_arrow: 30 };

  it('no expose application ever reports a pct above the pct its own card printed', () => {
    const hero10 = (pieces: string[]): CombatantSetup => ({
      name: 'hero',
      stats: { maxHp: 5000, hp: 5000, attack: 20, magicPower: 20, armor: 0, magicResist: 0, speed: 10 },
      boardSize: 10,
      pieces: pieces.map((skillId, i) => ({ skillId, slot: i })),
    });
    const config: CombatConfig = {
      playerTeam: [hero10(['ruinous_hex', 'piercing_arrow'])],
      enemyTeam: [{
        name: 'dummy',
        stats: { maxHp: 1_000_000, hp: 1_000_000, attack: 0, magicPower: 0, armor: 0, magicResist: 0, speed: 1 },
        boardSize: 10,
        pieces: [],
      }],
      skillBook: shippedBook,
      suddenDeathRound: 999,
      fatigueTurn: 999_999,
      attritionTurn: 999_999,
      maxTurns: 30,
    };
    const events = simulate(config, 4242).events;
    let caster: string | undefined;
    let checked = 0;
    for (const e of events) {
      if (e.kind === 'play') caster = e.skillId;
      if (e.kind !== 'statusApplied' || e.status !== 'expose') continue;
      const authored = AUTHORED[caster ?? ''];
      expect(authored, `unexpected expose caster ${caster}`).toBeDefined();
      // THE DEFECT: every piercing_arrow cast used to emit pct=50 while the
      // hex pile stood — the strong card's value at a third of its price.
      expect(e.pct, `${caster} applied ${e.pct}% but prints ${authored}%`).toBeLessThanOrEqual(authored!);
      checked += 1;
    }
    expect(checked, 'the board must actually apply exposes').toBeGreaterThan(2);
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
