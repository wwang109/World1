import { describe, expect, it } from 'vitest';
import { simulate } from '../../src/engine/combat/simulate';
import { skillBook } from '../../src/data/skills';
import { fmtAffinity } from '../../scripts/logFormat';
import type { CombatConfig, CombatantSetup } from '../../src/engine/types';
import type { CombatEvent } from '../../src/engine/combat/events';

/**
 * THE AFFINITY MARKER ON THE EVENT LOG.
 *
 * The rule this file pins (user ask 2026-09-11: "affinity effect should say
 * affinity affect on combat logs so its less confusing"): a hit produced by an
 * action carrying `affinity: true` carries `affinity: <its card's type>` on its
 * `damage` event, and NOTHING else does.
 *
 * WHY IT NEEDED A RULE AT ALL. 18 shipped cards are shaped "one plain hit, then
 * one gated hit". Before this, the gated payload was an ordinary second `damage`
 * event with no distinguishing field — so Kindred Flame's 28 + 39 read exactly
 * like a plain two-hit card, and the thing the player actually built their board
 * for was invisible in the log. The gate worked; the log just never said so.
 *
 * THE HALF THAT MATTERS MOST IS THE ABSENCE. `affinity` is omitted, not set to
 * `undefined`/`false`, for every ungated hit and every non-skill source. That is
 * what keeps an un-featured card's log byte-identical, so the tests below assert
 * key ABSENCE (`'affinity' in e`), not just a falsy value — a field present-and-
 * undefined would pass a truthiness check and still move a log baseline.
 */

/** Lay slots out by card SIZE — a size-N card occupies N slots. */
function board(ids: readonly string[]): Array<{ skillId: string; slot: number }> {
  let next = 0;
  return ids.map((id) => {
    const skill = skillBook[id];
    if (!skill) throw new Error(`affinity marker: unknown card "${id}"`);
    const slot = next;
    next += skill.size;
    return { skillId: id, slot };
  });
}

/**
 * The same probe shape the gate's own suite uses (tests/engine/affinity.test.ts):
 * zero foe defense so a printed power lands unmodified, and a huge HP pool so the
 * fight cannot end early and change the rotation between the two boards.
 */
function fight(heroBoard: readonly string[], seed = 5): CombatEvent[] {
  const hero: CombatantSetup = {
    name: 'Hero',
    stats: { maxHp: 900, hp: 900, attack: 12, magicPower: 12, armor: 3, magicResist: 3, speed: 30 },
    pieces: board(heroBoard),
    boardSize: 14,
  };
  const foe: CombatantSetup = {
    name: 'Foe',
    stats: { maxHp: 20000, hp: 20000, attack: 1, magicPower: 1, armor: 0, magicResist: 0, speed: 6 },
    pieces: board(['sword_slash']),
    boardSize: 4,
  };
  const config: CombatConfig = {
    playerTeam: [hero],
    enemyTeam: [foe],
    skillBook,
    maxTurns: 40,
    endgame: { attritionEnabled: false, suddenDeathTurn: 0 },
  } as CombatConfig;
  return simulate(config, seed).events;
}

type DamageEvent = Extract<CombatEvent, { kind: 'damage' }>;

function damageEvents(events: readonly CombatEvent[]): DamageEvent[] {
  return events.filter((e): e is DamageEvent => e.kind === 'damage');
}

/** Hits the HERO landed with a card (the only hits a gate can ever mark). */
function heroSkillHits(events: readonly CombatEvent[]): DamageEvent[] {
  return damageEvents(events).filter((e) => e.side === 'enemy' && e.source === 'skill');
}

/**
 * A FIRE card whose second line is gated (`kindred_flame`), on a board of three
 * fire cards — the exact configuration in the user's report. The two partners are
 * fire so the element axis reaches `IDENTITY_THRESHOLD` with no tie.
 */
const ON_TYPE_FIRE = ['kindred_flame', 'cinder_dart', 'ember_lash'];
/** The SAME card with its partners swapped off-type: two fire cards, gate shut. */
const OFF_TYPE_FIRE = ['kindred_flame', 'sword_slash', 'void_pierce'];
/** The WEAPON axis of the same rule — `sworn_edge` is a sword with a gated hit. */
const ON_TYPE_SWORD = ['sworn_edge', 'void_pierce', 'twin_slash'];
/** A board of ordinary cards: not one gated action anywhere. */
const UNGATED = ['sword_slash', 'void_pierce', 'twin_slash'];

describe('a gated hit says so on the event log', () => {
  it('marks the gated hit with the card type that opened it, and only that hit', () => {
    const hits = heroSkillHits(fight(ON_TYPE_FIRE));
    const marked = hits.filter((e) => e.affinity !== undefined);
    expect(marked.length, 'the on-type board must land gated hits').toBeGreaterThan(0);
    // Every marked hit names the CARD's own type — fire, not the foe's, not the
    // board's headline identity computed some other way.
    for (const e of marked) expect(e.affinity).toBe('fire');
    // ...and it is a strict subset: the card's plain 28 is still unmarked, so the
    // marker distinguishes the two lines of one cast rather than tagging the cast.
    expect(hits.length).toBeGreaterThan(marked.length);
  });

  it('marks on the WEAPON axis too, with the weapon name', () => {
    const marked = heroSkillHits(fight(ON_TYPE_SWORD)).filter((e) => e.affinity !== undefined);
    expect(marked.length).toBeGreaterThan(0);
    for (const e of marked) expect(e.affinity).toBe('sword');
  });

  it('marks NOTHING when the gate is shut — the same card, two fire cards short', () => {
    const hits = heroSkillHits(fight(OFF_TYPE_FIRE));
    expect(hits.length, 'the probe must still land its plain hits').toBeGreaterThan(0);
    // A shut gate skips the action entirely, so there is no hit to mark. The
    // control for the test above: the marker tracks the GATE, not the card.
    expect(hits.filter((e) => 'affinity' in e)).toEqual([]);
  });
});

describe('un-featured input is untouched', () => {
  it('omits the KEY (not merely the value) on every hit of an ungated board', () => {
    const all = damageEvents(fight(UNGATED));
    expect(all.length).toBeGreaterThan(0);
    // `'affinity' in e` — a key present with value `undefined` would still change
    // the shape of a serialised log, and the outcome baseline hashes that shape.
    expect(all.filter((e) => 'affinity' in e)).toEqual([]);
  });

  it('never marks a non-skill source, even on a board whose gate is wide open', () => {
    const nonSkill = damageEvents(fight(ON_TYPE_FIRE)).filter((e) => e.source !== 'skill');
    // Burn/poison/bleed ticks, thorns, fatigue and attrition are owned by no cast,
    // so no gate decided them. `dealDamage` only receives the marker from
    // `applyStrike`, which is the one thing that can reach it.
    expect(nonSkill.filter((e) => 'affinity' in e)).toEqual([]);
  });

  it('leaves the foe\'s own hits unmarked (its board holds no fire identity)', () => {
    const foeHits = damageEvents(fight(ON_TYPE_FIRE)).filter((e) => e.side === 'player');
    expect(foeHits.length).toBeGreaterThan(0);
    expect(foeHits.filter((e) => 'affinity' in e)).toEqual([]);
  });
});

describe('the log line the marker renders', () => {
  // `scripts/fight.ts` runs its fight at import time, so the tag it prints lives
  // in `scripts/logFormat.ts` where a test can reach it — the same reason
  // `fmtDamage` was moved there. This is the ONE renderer; narrow mode reflows
  // its output rather than re-formatting the event.
  it('is empty for an ungated hit, so the ungated line is unchanged', () => {
    expect(fmtAffinity(undefined)).toBe('');
  });

  it('is BRACKETED, which is what gives mobile mode its own line for free', () => {
    // Narrow mode (`FIGHT_NARROW=1`) breaks the body on `[` and `]`, exactly as it
    // already does for the `[burn]` source tag — so this suffix becomes a bare
    // `affinity fire` row under the hp row with no narrow-specific format string.
    expect(fmtAffinity('fire')).toBe(' [affinity fire]');
    expect(fmtAffinity('sword')).toBe(' [affinity sword]');
  });

  it('says "affinity" — the same word the card face prints', () => {
    // `affinityWrap` (src/engine/keywords/compose.ts) renders a gated clause as
    // "{{Affinity}} Fire — ...". The face and the log must not use two different
    // words for one gate.
    expect(fmtAffinity('frost').toLowerCase()).toContain('affinity');
  });
});
