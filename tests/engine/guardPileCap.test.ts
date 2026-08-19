import { describe, expect, it } from 'vitest';
import { simulate } from '../../src/engine/combat/simulate';
import { MAX_GUARD_PILES, type Gem, type SkillBook, type SkillDef } from '../../src/engine/types';
import { cfg, tc, NO_ENDGAME } from '../helpers';

/**
 * MAX_GUARD_PILES — the apply-time cap on how many guard piles of ONE property
 * a unit may carry at once (src/engine/types.ts), enforced in the `guard` arm
 * of `applyAction` (src/engine/combat/interpreter.ts).
 *
 * Every card here fires its whole effect list in ONE cast, so the applications
 * land back-to-back inside a single turn — the only way to script an exact
 * pile sequence without depending on cadence.
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
  // Five identical applications in one cast — only 3 may stand.
  five_same: card('five_same', [g(30, 2), g(30, 2), g(30, 2), g(30, 2), g(30, 2)]),
  // One application per cast, recast every turn — the cadence case.
  one_per_turn: card('one_per_turn', [g(30, 2)]),
  // Three strong piles, then a strictly weaker one: ABSORBED.
  weak_fourth: card('weak_fourth', [g(60, 3), g(60, 3), g(60, 3), g(20, 1)]),
  // Three piles of which ONE is dominated by the fourth application: REPLACED.
  dominating_fourth: card('dominating_fourth', [g(10, 1), g(60, 3), g(60, 3), g(40, 2)]),
  // Three dominated piles — the incoming picks the WEAKEST (lowest pct, then
  // soonest-expiring): 10/1, not 10/2 and not 20/2.
  tiebreak: card('tiebreak', [g(20, 2), g(10, 2), g(10, 1), g(30, 2)]),
  // Three of each property in one cast: the cap is PER PROPERTY, so all 6 land.
  both_properties: card('both_properties', [
    g(60, 3), g(60, 3), g(60, 3),
    g(60, 3, 'physical'), g(60, 3, 'physical'), g(60, 3, 'physical'),
  ]),
  // Six 60% magical piles requested; the hit may only ever see 3.
  six_big: card('six_big', [g(60, 5), g(60, 5), g(60, 5), g(60, 5), g(60, 5), g(60, 5)]),
  // Gem host: three PHYSICAL piles of its own, a fourth spliced in by a gem.
  gem_host: card('gem_host', [g(60, 3, 'physical'), g(60, 3, 'physical'), g(60, 3, 'physical')]),
  // Gem host whose own piles are weak enough for the gem's to dominate one.
  gem_host_weak: card('gem_host_weak', [g(10, 1, 'physical'), g(60, 3, 'physical'), g(60, 3, 'physical')]),
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

describe('MAX_GUARD_PILES: the cap itself', () => {
  it('caps simultaneous same-property piles at 3', () => {
    expect(MAX_GUARD_PILES).toBe(3);
    const { events, finalState } = run('five_same');
    expect(guardPiles(finalState.player, 'magical').length).toBe(MAX_GUARD_PILES);
    // Only the applications that actually landed are announced — the two
    // absorbed ones emit nothing at all.
    expect(appliedGuards(events).length).toBe(MAX_GUARD_PILES);
    expect(expiredGuards(events).length).toBe(0);
  });

  it('a 4th WEAKER application is absorbed: no pile, no event, nothing dropped', () => {
    const { events, finalState } = run('weak_fourth');
    const piles = guardPiles(finalState.player, 'magical');
    expect(piles.map((p) => [p.pct, p.turnsLeft])).toEqual([[60, 3], [60, 3], [60, 3]]);
    expect(appliedGuards(events).map((e) => e.pct)).toEqual([60, 60, 60]);
    expect(expiredGuards(events).length).toBe(0);
  });

  it('a 4th DOMINATING application replaces the pile it dominates (expiry, then application)', () => {
    const { events, finalState } = run('dominating_fourth');
    const piles = guardPiles(finalState.player, 'magical');
    // The 10%/1t pile is gone; the two 60%/3t piles are untouched; the
    // dominating 40%/2t application stands.
    expect(piles.map((p) => [p.pct, p.turnsLeft])).toEqual([[60, 3], [60, 3], [40, 2]]);
    // Event ORDER: the dropped pile expires BEFORE the new one is applied, so a
    // replay's status set never holds four piles at once.
    const guardEvents = events.filter(
      (e) => (e.kind === 'statusApplied' || e.kind === 'statusExpired') && e.status === 'guard',
    );
    expect(guardEvents.map((e) => e.kind)).toEqual([
      'statusApplied', 'statusApplied', 'statusApplied', 'statusExpired', 'statusApplied',
    ]);
    // The early expiry NAMES the pile it dropped (property + pct) so playback
    // can remove the right one; natural expiries stay unnamed.
    expect(expiredGuards(events)[0]).toMatchObject({ status: 'guard', property: 'magical', pct: 10, side: 'player' });
  });

  it('at cap, the dominating application drops the WEAKEST dominated pile (pct, then soonest-expiring)', () => {
    const { finalState } = run('tiebreak');
    // Piles 20/2, 10/2, 10/1; incoming 30/2 dominates all three and takes the
    // lowest pct, breaking the 10-vs-10 tie on the shorter remaining duration.
    expect(guardPiles(finalState.player, 'magical').map((p) => [p.pct, p.turnsLeft]))
      .toEqual([[20, 2], [10, 2], [30, 2]]);
  });

  it('an application EQUAL to a standing pile is absorbed and refreshes nothing (piles still expire)', () => {
    // One 30%/2t application per turn for 8 turns. Once 3 piles stand, each
    // further identical application is absorbed — it may NOT evict a clone and
    // re-arm the window, or the holder would carry 3 piles forever.
    const { events, finalState } = run('one_per_turn', undefined, { maxTurns: 8 });
    let standing = 0;
    let peak = 0;
    for (const e of events) {
      if (e.kind === 'statusApplied' && e.status === 'guard') standing += 1;
      if (e.kind === 'statusExpired' && e.status === 'guard') standing -= 1;
      if (standing > peak) peak = standing;
    }
    expect(peak).toBe(MAX_GUARD_PILES);
    expect(guardPiles(finalState.player, 'magical').length).toBeLessThanOrEqual(MAX_GUARD_PILES);
    // Natural expiries DID happen (nothing was held open by re-application),
    // and none of them names a pile — only the cap's early eviction does.
    const expired = expiredGuards(events);
    expect(expired.length).toBeGreaterThan(0);
    expect(expired.every((e) => e.property === undefined && e.pct === undefined)).toBe(true);
  });

  it('different properties do NOT share the cap', () => {
    const { events, finalState } = run('both_properties');
    expect(guardPiles(finalState.player, 'magical').length).toBe(3);
    expect(guardPiles(finalState.player, 'physical').length).toBe(3);
    expect(appliedGuards(events).length).toBe(6);
    expect(expiredGuards(events).length).toBe(0);
  });
});

describe('MAX_GUARD_PILES: gem-spliced guards', () => {
  it('a gem-spliced guard counts toward the cap and is absorbed at it', () => {
    const { events, finalState } = run('gem_host', aegisSliver);
    // The host already stands at the cap, and the gem's 20%/2t dominates none
    // of its three 60%/3t piles: absorbed, exactly like a card action would be.
    expect(guardPiles(finalState.player, 'physical').map((p) => [p.pct, p.turnsLeft]))
      .toEqual([[60, 3], [60, 3], [60, 3]]);
    expect(appliedGuards(events).length).toBe(3);
  });

  it('a gem-spliced guard can still replace a pile it dominates', () => {
    const { finalState } = run('gem_host_weak', aegisSliver);
    expect(guardPiles(finalState.player, 'physical').map((p) => [p.pct, p.turnsLeft]))
      .toEqual([[60, 3], [60, 3], [20, 2]]);
  });

  it('control: the same gem on an UNCAPPED host opens a 4th pile of the other property', () => {
    // Sanity that the gem really does splice a pile in — the cap, not the
    // splice, is what stops it above.
    const { finalState } = run('five_same', aegisSliver);
    expect(guardPiles(finalState.player, 'magical').length).toBe(3);
    expect(guardPiles(finalState.player, 'physical').length).toBe(1);
  });
});

describe('MAX_GUARD_PILES: the mitigation bound it buys', () => {
  it('a 6-pile request mitigates like 3 piles, not like 6', () => {
    const { events } = run('six_big', undefined, { maxTurns: 2, enemy: 'mbolt', magicPower: 100 });
    const hit = events.find((e) => e.kind === 'damage' && e.side === 'player');
    // 3 x 60%: 100 -> 40 -> 16 -> 6. Six piles would have ground the same hit
    // down to the min-1 floor (100 -> ... -> 2 -> 1).
    expect(hit).toMatchObject({ amount: 6, guarded: 94, property: 'magical' });
  });
});

describe('MAX_GUARD_PILES: determinism', () => {
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
