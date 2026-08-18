import { describe, expect, it } from 'vitest';
import { simulate } from '../../src/engine/combat/simulate';
import { cfg, tc, NO_ENDGAME } from '../helpers';
import type { SkillBook, SkillDef } from '../../src/engine/types';
import type { CombatEvent } from '../../src/engine/combat/events';

/**
 * SLOW LIVES EXACTLY ONE TURN (user-locked 2026-08-18).
 *
 * "A slow is only applied to that 1 card and doesn't stay — after the turn it
 * was applied on, the slow effect is removed."
 *
 * So the unit-scope tax (`CombatantState.nextWeightPenalty`) has TWO exits and
 * takes whichever comes first:
 *  - the victim's next resolved cast THIS TURN, which pays the inflated weight;
 *  - the end of that same global turn, which drops it UNPAID.
 *
 * The second exit is the new one. Before it existed the lifetime was "until you
 * next act", so a victim too poor (or too stunned, or too busy) to pay carried
 * the tax indefinitely and every fresh slow `Math.max`ed on top of a debt never
 * discharged — an observed lockout of 5 performances across 40 turns. With the
 * turn-scoped exit, accumulation across turns is impossible BY CONSTRUCTION, so
 * the engine deliberately carries no clamp or ceiling.
 *
 * Every fight below uses a purpose-built book (exact weights, zero damage,
 * endgame disabled) so each assertion is an exact hand-computable number and
 * cannot be moved by a content edit.
 */

function card(id: string, effects: SkillDef['effects'], speedWeight: number): SkillDef {
  return {
    id,
    name: id,
    archetypes: ['offense'],
    property: 'physical',
    size: 1,
    speedWeight,
    rarity: 'common',
    tier: 'bronze',
    effects,
    text: '',
  };
}

const BOOK: SkillBook = {
  // Heavy slow: weight 30, so at Speed 15 its holder banks one turn and fires
  // the next — it cannot re-slow the victim on the turn we watch a slow expire.
  hexHeavy: card('hexHeavy', [{ kind: 'slow', weight: 20 }], 30),
  hex6: card('hex6', [{ kind: 'slow', weight: 6 }], 10),
  hex14: card('hex14', [{ kind: 'slow', weight: 14 }], 10),
  stunbolt: card('stunbolt', [{ kind: 'stun', turns: 1 }], 30),
  // The victim's only card. Zero power AND zero Attack on its holder, so no HP
  // ever moves and no fight can end early.
  swing: card('swing', [{ kind: 'damage', power: 0 }], 10),
};

const HARMLESS = { attack: 0, magicPower: 0, maxHp: 500 };

type Play = Extract<CombatEvent, { kind: 'play' }>;
type Wait = Extract<CombatEvent, { kind: 'wait' }>;

const plays = (events: CombatEvent[], side: 'player' | 'enemy'): Play[] =>
  events.filter((e): e is Play => e.kind === 'play' && e.side === side);
const waits = (events: CombatEvent[], side: 'player' | 'enemy'): Wait[] =>
  events.filter((e): e is Wait => e.kind === 'wait' && e.side === side);

describe('slow expires at the end of the turn it was applied on', () => {
  it('EXPIRES UNPAID: a victim that cannot afford the taxed weight carries nothing into the next turn', () => {
    // Player: Speed 15, one weight-30 slow card -> banks one turn, fires the
    // next, so it slows on EVEN turns only. Enemy: Speed 10, one weight-10 card.
    //
    // t1: player 15 < 30, waits. Enemy 10 >= 10, plays swing (readiness -> 0).
    // t2: player 30 >= 30, plays hexHeavy -> slow 20 on the enemy. The enemy now
    //     has readiness 10 against a taxed weight of 30 -> `cantAfford`, no cast,
    //     nothing paid. END OF TURN 2 DROPS THE TAX.
    // t3: NO new slow lands (the player is banking again) and the enemy, with 20
    //     banked, plays at its UNTAXED weight 10. Measured against the old
    //     "until you next act" lifetime on this exact fight: the tax was still
    //     pending, the enemy needed 30, and it emitted a SECOND `cantAfford` at
    //     weight 30 on a turn nothing had slowed it.
    const c = cfg(
      tc('hero', ['hexHeavy'], { ...HARMLESS, speed: 15 }, { skillBook: BOOK }),
      tc('foe', ['swing'], { ...HARMLESS, speed: 10 }, { skillBook: BOOK }),
      { ...NO_ENDGAME, skillBook: BOOK, maxTurns: 3 },
    );
    const { events, finalState } = simulate(c, 1);

    const slowed = events.filter((e) => e.kind === 'slowed');
    expect(slowed).toHaveLength(1);
    expect(slowed[0]).toMatchObject({ turn: 2, side: 'enemy', weight: 20 });

    // Turn 2: the tax is real and it is what stopped the victim.
    expect(waits(events, 'enemy').filter((w) => w.turn === 2)).toMatchObject([
      { reason: 'cantAfford', readiness: 10, weight: 30 },
    ]);
    expect(plays(events, 'enemy').filter((p) => p.turn === 2)).toHaveLength(0);

    // Turn 3: gone. The card costs its printed weight again.
    expect(plays(events, 'enemy').filter((p) => p.turn === 3)).toMatchObject([{ weight: 10 }]);

    // It was never paid: no cost event anywhere charged the taxed 30.
    expect(events.filter((e) => e.kind === 'cost' && e.side === 'enemy' && e.paid !== 10)).toHaveLength(0);
    expect(finalState.enemy.nextWeightPenalty).toBe(0);
  });

  it('STILL PAID: a slow applied and paid inside the same turn taxes that one card', () => {
    // Both at Speed 20, both weight 10. The player wins the tie (canonical order
    // + strict-greater incumbent rule) and slows for 6 BEFORE the enemy performs,
    // so the enemy's very next card costs 10 + 6 = 16 out of its banked 20.
    const c = cfg(
      tc('hero', ['hex6'], { ...HARMLESS, speed: 20 }, { skillBook: BOOK }),
      tc('foe', ['swing'], { ...HARMLESS, speed: 20 }, { skillBook: BOOK }),
      { ...NO_ENDGAME, skillBook: BOOK, maxTurns: 1 },
    );
    const { events, finalState } = simulate(c, 1);

    expect(plays(events, 'enemy')).toMatchObject([{ turn: 1, weight: 16 }]);
    expect(events.filter((e) => e.kind === 'cost' && e.side === 'enemy')).toMatchObject([
      { turn: 1, paid: 16, readinessBefore: 20, readinessAfter: 4 },
    ]);
    // Consumed by the cast, not carried anywhere.
    expect(finalState.enemy.nextWeightPenalty).toBe(0);
  });

  it('TWO IN ONE TURN: re-application still takes Math.max, never a sum', () => {
    // Player Speed 40, two weight-10 slow cards (6 then 14) -> both fire in turn
    // 1 before the enemy (Speed 30) can act. Sum would be 6 + 14 = 20 (weight
    // 30); max is 14 (weight 24), and 24 is what the enemy must pay.
    const c = cfg(
      tc('hero', ['hex6', 'hex14'], { ...HARMLESS, speed: 40 }, { skillBook: BOOK }),
      tc('foe', ['swing'], { ...HARMLESS, speed: 30 }, { skillBook: BOOK }),
      { ...NO_ENDGAME, skillBook: BOOK, maxTurns: 1 },
    );
    const { events } = simulate(c, 1);

    expect(events.filter((e) => e.kind === 'slowed').map((e) => (e.kind === 'slowed' ? e.weight : 0))).toEqual([6, 14]);
    expect(plays(events, 'enemy')).toMatchObject([{ turn: 1, weight: 24 }]);
  });

  it('STUNNED VICTIM: a slow landing on a stun-skipped unit does not follow it into the next turn', () => {
    // Player: Speed 35, stunbolt then hexHeavy (both weight 30) -> one cast per
    // turn. Enemy: Speed 40, one weight-10 card.
    //
    // t1: player stuns (the pile is `fresh`, so it does not eat this turn's
    //     performance); the enemy still plays swing normally.
    // t2: the enemy is ahead on readiness and takes its performance FIRST — the
    //     now-unfresh stun consumes it (`performSkipped`, readiness zeroed, no
    //     cast, nothing paid). The player then lands slow 20 on a unit that is
    //     already locked out of the turn. END OF TURN 2 DROPS THE TAX.
    // t3: the enemy plays at its printed weight 10. Under the old lifetime the
    //     stun and the slow would have compounded: the victim would owe 30 on a
    //     turn it had already lost to the stun.
    const c = cfg(
      tc('hero', ['stunbolt', 'hexHeavy'], { ...HARMLESS, speed: 35 }, { skillBook: BOOK }),
      tc('foe', ['swing'], { ...HARMLESS, speed: 40 }, { skillBook: BOOK }),
      { ...NO_ENDGAME, skillBook: BOOK, maxTurns: 3 },
    );
    const { events, finalState } = simulate(c, 1);

    const skipped = events.filter((e) => e.kind === 'performSkipped');
    expect(skipped).toMatchObject([{ turn: 2, side: 'enemy', reason: 'stunned' }]);
    expect(events.filter((e) => e.kind === 'slowed')).toMatchObject([{ turn: 2, side: 'enemy', weight: 20 }]);
    expect(plays(events, 'enemy').filter((p) => p.turn === 2)).toHaveLength(0);

    expect(plays(events, 'enemy').filter((p) => p.turn === 3)).toMatchObject([{ weight: 10 }]);
    expect(events.filter((e) => e.kind === 'cost' && e.side === 'enemy' && e.paid !== 10)).toHaveLength(0);
    expect(finalState.enemy.nextWeightPenalty).toBe(0);
  });

  it('the tax cannot accumulate across turns: repeated slows on a locked-out victim stay at ONE application', () => {
    // The lockout the rule change exists to kill. Player Speed 15 / weight-30
    // slow card fires on every even turn; enemy Speed 10 / weight 10. Over 9
    // turns the enemy eats four separate slow-20 applications, and every one of
    // them dies with its own turn instead of piling onto the last.
    const c = cfg(
      tc('hero', ['hexHeavy'], { ...HARMLESS, speed: 15 }, { skillBook: BOOK }),
      tc('foe', ['swing'], { ...HARMLESS, speed: 10 }, { skillBook: BOOK }),
      { ...NO_ENDGAME, skillBook: BOOK, maxTurns: 9 },
    );
    const { events, finalState } = simulate(c, 9);

    expect(events.filter((e) => e.kind === 'slowed')).toHaveLength(4); // turns 2, 4, 6, 8
    // No cast ever pays more than base 10 + ONE application (20). A compounding
    // tax would show 50, 70, 90... here; it never does.
    const paid = events.filter((e) => e.kind === 'cost' && e.side === 'enemy').map((e) => (e.kind === 'cost' ? e.paid : 0));
    expect(paid.every((p) => p === 10 || p === 30)).toBe(true);
    // And no QUOTED weight ever exceeds one application either — this is the
    // assertion that would fail the instant two applications could coexist.
    const taxed = waits(events, 'enemy').filter((w) => w.reason === 'cantAfford').map((w) => w.weight);
    expect(Math.max(...taxed)).toBe(30);
    // Six casts in nine turns. The same fight on the old lifetime gave five,
    // because the enemy also lost turns 3 and 7 to a tax nobody applied then.
    expect(plays(events, 'enemy')).toHaveLength(6);
    expect(plays(events, 'enemy').filter((p) => p.turn === 3 || p.turn === 7)).toHaveLength(2);
    expect(finalState.enemy.nextWeightPenalty).toBe(0);
  });
});
