import { describe, expect, it } from 'vitest';
import { simulate } from '../../src/engine/combat/simulate';
import type { Gem, SkillBook, SkillDef } from '../../src/engine/types';
import { cfg, tc, NO_ENDGAME } from '../helpers';

/**
 * GUARD STACKING IS UNBOUNDED — user-locked 2026-08-20, verbatim: *"leave guard
 * alone let player build what they want."*
 *
 * A `MAX_GUARD_PILES = 3` apply-time cap shipped 2026-08-19 (with an at-cap
 * dominance/eviction rule and a named `statusExpired`) and was rejected the next
 * day: player freedom to build a wall beats the bound, and attrition's TRUE
 * damage — which no typed guard can touch — is the backstop against a pure
 * turtle. This suite is the REGRESSION GUARD against a cap being reintroduced:
 * every guard application must open its own pile, and every pile must compound.
 *
 * Every card here fires its whole effect list in ONE cast, so the applications
 * land back-to-back inside a single turn — the only way to script an exact pile
 * sequence without depending on cadence.
 */

type Events = ReturnType<typeof simulate>['events'];
type StatusApplied = Extract<Events[number], { kind: 'statusApplied' }>;
type StatusExpired = Extract<Events[number], { kind: 'statusExpired' }>;

/** One guard action; `p` defaults to magical so the test bolt matches it. */
const g = (pct: number, turns: number, property: 'magical' | 'physical' = 'magical') =>
  ({ kind: 'guard', property, pct, turns }) as const;

/** A self-cast card that fires `effects` in one cast and never fires again
 * (speedWeight === the caster's speed, so a turn buys exactly one cast). */
const card = (id: string, effects: ReturnType<typeof g>[]): SkillDef => ({
  id,
  name: id,
  archetypes: ['defensive'],
  property: 'magical',
  size: 1,
  speedWeight: 20,
  rarity: 'epic',
  tier: 'bronze',
  effects: effects.map((e) => ({ ...e })),
  text: '',
});

const BOOK: SkillBook = {
  // Five identical applications in one cast — all five must stand.
  five_same: card('five_same', [g(30, 2), g(30, 2), g(30, 2), g(30, 2), g(30, 2)]),
  // Three strong piles, then a strictly weaker/shorter one. The reverted cap
  // ABSORBED this fourth application (no pile, no event); it must now land.
  weak_fourth: card('weak_fourth', [g(60, 3), g(60, 3), g(60, 3), g(20, 1)]),
  // Three piles of which one is dominated by the fourth application. The
  // reverted cap REPLACED the dominated pile (emitting a named
  // `statusExpired`); nothing may be evicted now.
  dominating_fourth: card('dominating_fourth', [g(10, 1), g(60, 3), g(60, 3), g(40, 2)]),
  // Six 60% magical piles — the deep stack the cap existed to forbid.
  six_big: card('six_big', [g(60, 5), g(60, 5), g(60, 5), g(60, 5), g(60, 5), g(60, 5)]),
  // Four of each property in one cast: the two axes stay independent.
  both_properties: card('both_properties', [
    g(60, 3), g(60, 3), g(60, 3), g(60, 3),
    g(60, 3, 'physical'), g(60, 3, 'physical'), g(60, 3, 'physical'), g(60, 3, 'physical'),
  ]),
  // Gem host: three PHYSICAL piles of its own, a fourth spliced in by a gem.
  gem_host: card('gem_host', [g(60, 3, 'physical'), g(60, 3, 'physical'), g(60, 3, 'physical')]),
  mbolt: {
    id: 'mbolt',
    name: 'Magic Bolt',
    archetypes: ['offense'],
    property: 'magical',
    size: 1,
    speedWeight: 10,
    rarity: 'common',
    tier: 'bronze',
    effects: [{ kind: 'damage', power: 0 }],
    text: '',
  },
};

/** `ward_of_silence_echo` in the shipped catalog (src/data/content/gems.v1.json):
 * a physical guard rider that splices into whatever card it is socketed into. */
const aegisSliver: Gem = {
  kind: 'effect',
  id: 'ward_of_silence_echo',
  rarity: 'rare',
  actions: [{ kind: 'guard', property: 'physical', pct: 20, turns: 2 }],
};

const OPT = { ...NO_ENDGAME, skillBook: BOOK, maxTurns: 1 } as const;

/** One turn of the hero casting `skillId` (optionally gemmed) against a slug. */
function run(skillId: string, gem?: Gem, opts: { maxTurns?: number; enemy?: string; magicPower?: number } = {}) {
  const c = cfg(
    tc('hero', [], { speed: 20, magicResist: 0, maxHp: 500 }, {
      skillBook: BOOK,
      pieces: [{ skillId, slot: 0, ...(gem ? { gem } : {}) }],
    }),
    tc('slug', opts.enemy ? [opts.enemy] : [], { speed: 10, magicPower: opts.magicPower ?? 10, maxHp: 1000 }, { skillBook: BOOK }),
    { ...OPT, ...(opts.maxTurns ? { maxTurns: opts.maxTurns } : {}) },
  );
  return simulate(c, 1);
}

const guardPiles = (s: ReturnType<typeof simulate>['finalState']['player'], property: 'magical' | 'physical') =>
  s.statuses.filter((st) => st.kind === 'guard' && st.property === property);

const appliedGuards = (events: Events): StatusApplied[] =>
  events.filter((e): e is StatusApplied => e.kind === 'statusApplied' && e.status === 'guard');

const expiredGuards = (events: Events): StatusExpired[] =>
  events.filter((e): e is StatusExpired => e.kind === 'statusExpired' && e.status === 'guard');

describe('guard stacking: no pile-count cap', () => {
  it('five identical applications open five simultaneous piles', () => {
    const { events, finalState } = run('five_same');
    expect(guardPiles(finalState.player, 'magical').length).toBe(5);
    // Every application is announced, and nothing is dropped to make room.
    expect(appliedGuards(events).length).toBe(5);
    expect(expiredGuards(events).length).toBe(0);
  });

  it('a 4th WEAKER application still lands (the reverted cap absorbed it)', () => {
    const { events, finalState } = run('weak_fourth');
    expect(guardPiles(finalState.player, 'magical').length).toBe(4);
    expect(appliedGuards(events).map((e) => e.pct)).toEqual([60, 60, 60, 20]);
    expect(expiredGuards(events).length).toBe(0);
  });

  it('a 4th DOMINATING application evicts nothing (the reverted cap replaced a pile)', () => {
    const { events, finalState } = run('dominating_fourth');
    expect(guardPiles(finalState.player, 'magical').map((s) => s.pct)).toEqual([10, 60, 60, 40]);
    expect(appliedGuards(events).length).toBe(4);
    // No `statusExpired` — and therefore no event naming a pile: guard has no
    // early-departure path at all, which is what let `statusExpired` shed its
    // optional `property`/`pct` fields (src/engine/combat/events.ts).
    expect(expiredGuards(events).length).toBe(0);
  });

  it('the two properties stack independently — 4 magical AND 4 physical stand together', () => {
    const { finalState } = run('both_properties');
    expect(guardPiles(finalState.player, 'magical').length).toBe(4);
    expect(guardPiles(finalState.player, 'physical').length).toBe(4);
  });

  it('a gem-spliced guard opens a 4th pile on a host that already applies three', () => {
    const { finalState } = run('gem_host', aegisSliver);
    expect(guardPiles(finalState.player, 'physical').map((s) => s.pct)).toEqual([60, 60, 60, 20]);
  });
});

describe('guard stacking: what a deep stack actually mitigates', () => {
  it('six 60% piles grind a 100 hit to the min-1 floor (the cap would have left 6)', () => {
    const { events } = run('six_big', undefined, { maxTurns: 2, enemy: 'mbolt', magicPower: 100 });
    const hit = events.find((e) => e.kind === 'damage' && e.side === 'player');
    // 100 -> 40 -> 16 -> 6 -> 2 -> 1 -> 1, each step floored with a min of 1
    // remaining (dealDamage's guard loop). Under MAX_GUARD_PILES=3 only the
    // first three piles applied and the same hit landed for 6.
    expect(hit).toMatchObject({ amount: 1, guarded: 99, property: 'magical' });
  });
});

describe('guard stacking: determinism', () => {
  it('the same config produces a byte-identical log twice', () => {
    const build = () =>
      cfg(
        tc('hero', [], { speed: 20, magicResist: 0, maxHp: 500 }, {
          skillBook: BOOK,
          pieces: [{ skillId: 'dominating_fourth', slot: 0, gem: aegisSliver }],
        }),
        tc('slug', ['mbolt'], { speed: 10, magicPower: 100, maxHp: 1000 }, { skillBook: BOOK }),
        { ...NO_ENDGAME, skillBook: BOOK, maxTurns: 6 },
      );
    const a = simulate(build(), 7);
    const b = simulate(build(), 7);
    expect(JSON.stringify(a.events)).toBe(JSON.stringify(b.events));
    expect(JSON.stringify(a.finalState)).toBe(JSON.stringify(b.finalState));
  });
});
