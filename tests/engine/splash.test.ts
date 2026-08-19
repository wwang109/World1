import { describe, expect, it } from 'vitest';
import { simulate } from '../../src/engine/combat/simulate';
import { initCombatState, type CombatState, type CombatantState } from '../../src/engine/combat/state';
import { splashAnchor, splashBand } from '../../src/engine/combat/splash';
import { scanCast } from '../../src/engine/combat/castSelect';
import { applyCast, resolveTargets } from '../../src/engine/combat/interpreter';
import { NO_MODS } from '../../src/engine/combat/auras';
import { Rng } from '../../src/engine/rng';
import { EFFECT_CAPS_DECI, PRICE, powerLevelDeci, capViolations } from '../../src/engine/balance';
import { validateSkillDocument } from '../../src/data/validateSkillContent';
import { skillBook } from '../../src/data/skills';
import { gemBook } from '../../src/data/gems';
import { resolveEffectiveSkill, splashSuppressionOn } from '../../src/engine/cards';
import { gemPowerLevelDeci, isGemOnBudget, RARITY_PL_DECI } from '../../src/engine/balance';
import { isMultiTargetSkill } from '../../src/engine/types';
import type { BoardPiece, CombatConfig, Gem, SkillBook, SkillDef } from '../../src/engine/types';
import type { CombatEvent as Ev } from '../../src/engine/combat/events';
import { cfg, tc, NO_ENDGAME } from '../helpers';

/**
 * SPLASH — `slow` at CARD scope (user-locked 2026-08-18). These tests pin the
 * four things that make it a different keyword rather than a re-skinned slow:
 * the BAND (3 pieces, edge-to-edge, never wrapping), the NON-STACKING rule
 * (max, not sum), WHO consumes the tax (the piece that plays, exactly once —
 * never a speculative `scanCast`), and the fact that it is priced.
 */

const card = (id: string, over: Partial<SkillDef> = {}): SkillDef => ({
  id,
  name: id,
  archetypes: ['offense'],
  property: 'physical',
  size: 1,
  speedWeight: 10,
  rarity: 'common',
  tier: 'bronze',
  effects: [{ kind: 'damage', power: 0 }],
  text: '',
  ...over,
});

const BOOK: SkillBook = {
  // Neutral filler: deals exactly the caster's Attack, weight 10.
  jab: card('jab'),
  jab2: card('jab2'),
  jab3: card('jab3'),
  jab4: card('jab4'),
  jab5: card('jab5'),
  // Multi-slot cards — ONE piece however many slots they cover.
  wide: card('wide', { size: 3, speedWeight: 30 }),
  wide2: card('wide2', { size: 2, speedWeight: 20 }),
  // The keyword under test, with no damage line so nothing else moves.
  splash6: card('splash6', { effects: [{ kind: 'splash', weight: 6 }], archetypes: ['debuff'] }),
  splash2: card('splash2', { effects: [{ kind: 'splash', weight: 2 }], archetypes: ['debuff'] }),
  // Fires ONCE per fight (cooldowns enabled) so a consumption test sees the
  // tax spent without the caster immediately re-applying it.
  splashOnce: card('splashOnce', { effects: [{ kind: 'splash', weight: 6 }], archetypes: ['debuff'], cooldownTurns: 99 }),
  // Heavy enough that the caster must bank four turns before it fires — long
  // enough for a 3-card victim to walk its whole board and park the cursor PAST
  // the last card, which is the no-wrap anchor case.
  splashLate: card('splashLate', { effects: [{ kind: 'splash', weight: 6 }], archetypes: ['debuff'], speedWeight: 40, cooldownTurns: 99 }),
  // Both taxes from one cast, so their SUM and their different lifetimes can be
  // watched on the same victim.
  slowSplash: card('slowSplash', {
    effects: [{ kind: 'slow', weight: 4 }, { kind: 'splash', weight: 6 }],
    archetypes: ['debuff'],
    cooldownTurns: 99,
  }),
  // GEM HOSTS. `splashless` is an ordinary single-target card with no splash of
  // its own; `aoeJab` is the same card with the one multi-target mechanism the
  // game has today. Both carry a damage line so the host still fires when its
  // gem's splash is dropped.
  splashless: card('splashless'),
  aoeJab: card('aoeJab', { scope: 'all' }),
};

/** A combat state whose ENEMY board is exactly `pieces`, cursor parked at `cursor`. */
function enemyBoard(pieces: BoardPiece[], cursor: number, boardSize = 10): CombatantState {
  const config: CombatConfig = {
    playerTeam: [tc('hero', ['jab'], {}, { skillBook: BOOK })],
    enemyTeam: [tc('foe', [], {}, { pieces, boardSize, skillBook: BOOK })],
    skillBook: BOOK,
  };
  const state = initCombatState(config);
  state.enemy.castCursor = cursor;
  return state.enemy;
}

const slotsOf = (c: CombatantState): number[] => {
  const found = splashBand(c);
  return found ? found.band.map((p) => p.slot) : [];
};

const row = (skillIds: string[]): BoardPiece[] => skillIds.map((skillId, slot) => ({ skillId, slot }));

describe('splash band geometry', () => {
  it('is THREE pieces — the anchor the cursor sits on plus its immediate neighbours', () => {
    const foe = enemyBoard(row(['jab', 'jab2', 'jab3', 'jab4', 'jab5']), 2);
    expect(splashAnchor(foe)?.slot).toBe(2);
    expect(slotsOf(foe)).toEqual([1, 2, 3]);
  });

  it('DOES NOT WRAP at the left edge — a card in slot 0 has nothing to its left', () => {
    const foe = enemyBoard(row(['jab', 'jab2', 'jab3', 'jab4', 'jab5']), 0);
    // NOT [4, 0, 1]: adjacency is spatial, and the board is a line, not a ring.
    expect(slotsOf(foe)).toEqual([0, 1]);
  });

  it('DOES NOT WRAP at the right edge either', () => {
    const foe = enemyBoard(row(['jab', 'jab2', 'jab3', 'jab4', 'jab5']), 4);
    expect(slotsOf(foe)).toEqual([3, 4]);
  });

  it('a lone card is a band of ONE, and an empty board is no band at all', () => {
    expect(slotsOf(enemyBoard(row(['jab']), 0))).toEqual([0]);
    expect(splashBand(enemyBoard([], 0))).toBeNull();
    expect(splashAnchor(enemyBoard([], 0))).toBeNull();
  });

  it('measures PIECE-to-PIECE, so empty slots between cards do not break adjacency', () => {
    // Gaps at 1-2 and 4-6: the nearest piece on each side is still the neighbour.
    const foe = enemyBoard([
      { skillId: 'jab', slot: 0 },
      { skillId: 'jab2', slot: 3 },
      { skillId: 'jab3', slot: 7 },
    ], 3);
    expect(slotsOf(foe)).toEqual([0, 3, 7]);
  });

  it('counts a multi-slot card as ONE piece (edge-to-edge, not slot-to-slot)', () => {
    // `wide` covers slots 0-2. Anchored on the card at 3, its left neighbour is
    // the WHOLE size-3 card — not three separate neighbours, and not "slot 2".
    const foe = enemyBoard([
      { skillId: 'wide', slot: 0 },
      { skillId: 'jab', slot: 3 },
      { skillId: 'jab2', slot: 4 },
      { skillId: 'jab3', slot: 5 },
    ], 3);
    expect(slotsOf(foe)).toEqual([0, 3, 4]);
  });

  it('anchors INSIDE a multi-slot card from any of its slots', () => {
    const foe = enemyBoard([
      { skillId: 'jab', slot: 0 },
      { skillId: 'wide', slot: 1 },
      { skillId: 'jab2', slot: 4 },
    ], 3); // cursor on the size-3 card's THIRD slot
    expect(splashAnchor(foe)?.slot).toBe(1);
    expect(slotsOf(foe)).toEqual([0, 1, 4]);
  });

  it('a cursor parked on an EMPTY slot anchors on the card the rotation would reach next', () => {
    const foe = enemyBoard([
      { skillId: 'jab', slot: 0 },
      { skillId: 'jab2', slot: 4 },
    ], 1);
    expect(splashAnchor(foe)?.slot).toBe(4);
    expect(slotsOf(foe)).toEqual([0, 4]);
  });

  it('THE ANCHOR DOES NOT WRAP: a cursor past the last card anchors on the LAST CARD PLAYED', () => {
    // User ruling 2026-08-19. The cursor parks at `slot + 1` after a cast, so a
    // victim that just played its rightmost card sits here every rotation.
    // Wrapping made the anchor slot 0 — a piece that by definition has no left
    // neighbour, so the band was deterministically 2 wide on every wrap AND it
    // teleported to the far side of the board. Now it stays where the action
    // was: anchor 2, band [1, 2].
    const foe = enemyBoard(row(['jab', 'jab2', 'jab3']), 3);
    expect(splashAnchor(foe)?.slot).toBe(2);
    expect(slotsOf(foe)).toEqual([1, 2]);
  });

  it('holds however far past the last card the cursor is parked, and over gaps', () => {
    const foe = enemyBoard([
      { skillId: 'jab', slot: 0 },
      { skillId: 'wide', slot: 2 }, // slots 2-4
    ], 8);
    expect(splashAnchor(foe)?.slot).toBe(2); // the size-3 card, not slot 0
    expect(slotsOf(foe)).toEqual([0, 2]);
  });

  it('a card AHEAD of the cursor still wins over one behind it (forward first, then fall back)', () => {
    // Both directions have a piece: the rotation reaches slot 5 next, so that is
    // the anchor — the backward fallback is only for "nothing ahead at all".
    const foe = enemyBoard([
      { skillId: 'jab', slot: 0 },
      { skillId: 'jab2', slot: 5 },
    ], 2);
    expect(splashAnchor(foe)?.slot).toBe(5);
  });
});

/** Fire ONE `splash` cast from the hero onto the enemy, in isolation. */
function castSplashOn(state: CombatState, skill: SkillDef): Ev[] {
  const events: Ev[] = [];
  const ctx = { state, rng: new Rng(1), events };
  applyCast(ctx, state.player, skill, 0, { ...NO_MODS }, { before: 0, after: 1 });
  return events;
}

function splashState(pieces: BoardPiece[], cursor: number): CombatState {
  const config: CombatConfig = {
    playerTeam: [tc('hero', ['splash6'], {}, { skillBook: BOOK })],
    enemyTeam: [tc('foe', [], {}, { pieces, boardSize: 10, skillBook: BOOK })],
    skillBook: BOOK,
  };
  const state = initCombatState(config);
  state.enemy.castCursor = cursor;
  return state;
}

describe('splash application', () => {
  it('taxes every piece in the band and reports the band on the event', () => {
    const state = splashState(row(['jab', 'jab2', 'jab3', 'jab4']), 1);
    const events = castSplashOn(state, BOOK.splash6!);
    const splashed = events.find((e) => e.kind === 'splashed');
    expect(splashed).toMatchObject({ kind: 'splashed', side: 'enemy', unit: 0, weight: 6, anchorSlot: 1, slots: [0, 1, 2] });
    expect(state.enemy.pieces.map((p) => p.nextWeightPenalty)).toEqual([6, 6, 6, undefined]);
  });

  it('RE-SPLASH TAKES THE MAX, NEVER THE SUM (an unbounded stack would lock a card out)', () => {
    const state = splashState(row(['jab', 'jab2', 'jab3']), 1);
    castSplashOn(state, BOOK.splash6!);
    castSplashOn(state, BOOK.splash2!); // weaker: loses
    expect(state.enemy.pieces.map((p) => p.nextWeightPenalty)).toEqual([6, 6, 6]);
    castSplashOn(state, BOOK.splash6!); // equal: still 6, not 12
    expect(state.enemy.pieces.map((p) => p.nextWeightPenalty)).toEqual([6, 6, 6]);
  });

  it('is a NO-OP on a dead unit — no penalty, no event', () => {
    const state = splashState(row(['jab', 'jab2', 'jab3']), 1);
    state.enemy.alive = false;
    state.enemy.stats.hp = 0;
    const events = castSplashOn(state, BOOK.splash6!);
    expect(events.find((e) => e.kind === 'splashed')).toBeUndefined();
    expect(state.enemy.pieces.map((p) => p.nextWeightPenalty)).toEqual([undefined, undefined, undefined]);
  });

  it('is a NO-OP on an empty board — nothing to tax, so nothing is logged', () => {
    const state = splashState([], 0);
    expect(castSplashOn(state, BOOK.splash6!).find((e) => e.kind === 'splashed')).toBeUndefined();
  });

  it('leaves the UNIT-scope penalty (`slow`) alone — the two scopes are independent', () => {
    const state = splashState(row(['jab', 'jab2']), 0);
    castSplashOn(state, BOOK.splash6!);
    expect(state.enemy.nextWeightPenalty).toBe(0);
  });
});

describe('splash penalty consumption', () => {
  const scanOpts = { currentTurn: 0, cooldownsEnabled: false };

  it('a SPECULATIVE scanCast READS the penalty but never consumes it', () => {
    // scanCast runs for units that will not cast at all this turn (the
    // performer search and the `wait`/cantAfford explanation pass both call
    // it), so consuming here would make the tax vanish without being paid.
    const state = splashState(row(['jab', 'jab2', 'jab3']), 1);
    castSplashOn(state, BOOK.splash6!);
    for (let i = 0; i < 5; i += 1) {
      const scan = scanCast(state.enemy, BOOK, scanOpts);
      expect(scan.kind).toBe('choice');
      if (scan.kind !== 'choice') return;
      expect(scan.choice.weight).toBe(16); // 10 base + 6 splash, every time
    }
    expect(state.enemy.pieces[1]!.nextWeightPenalty).toBe(6);
  });

  it('is consumed EXACTLY ONCE, by the piece that plays — the next play is back to base weight', () => {
    // Hero casts splash6 on turn 1 (speed 30 vs 10 so it lands first); the foe
    // then plays its band cards. Each taxed piece pays +6 on ITS first play.
    const config: CombatConfig = {
      ...cfg(
        tc('hero', ['splashOnce'], { speed: 30, maxHp: 500 }, { skillBook: BOOK }),
        tc('foe', ['jab', 'jab2', 'jab3'], { speed: 10, attack: 1, maxHp: 500 }, { skillBook: BOOK }),
        // Cooldowns ON so the splash lands exactly ONCE (cooldownTurns 99):
        // any later re-splash would re-arm the very tax this test watches being
        // spent, and prove nothing.
        { ...NO_ENDGAME, maxTurns: 14, cooldownsEnabled: true },
      ),
      skillBook: BOOK,
    };
    const { events } = simulate(config, 1);
    expect(events.filter((e) => e.kind === 'splashed')).toHaveLength(1);
    const plays = events.filter(
      (e): e is Extract<Ev, { kind: 'play' }> => e.kind === 'play' && e.side === 'enemy',
    );
    // The foe's cursor starts at slot 0, so the band is slots 0-1 (the anchor
    // has no left neighbour — the band does not wrap). Slot 2 is untouched.
    const first = new Map<number, number>();
    const later: number[] = [];
    for (const play of plays) {
      if (first.has(play.slot)) later.push(play.weight);
      else first.set(play.slot, play.weight);
    }
    expect(first.get(0)).toBe(16); // 10 base + 6 splash
    expect(first.get(1)).toBe(16);
    expect(first.get(2)).toBe(10); // outside the band: never taxed
    // CONSUMED, not permanent: every REPLAY is back to base weight.
    expect(later.length).toBeGreaterThan(0);
    expect(later.every((weight) => weight === 10)).toBe(true);
  });

  it('a piece that was never splashed carries NO `nextWeightPenalty` key at all (baseline-hash safety)', () => {
    // The field is LAZILY WRITTEN: `undefined` is dropped by JSON.stringify but
    // `0` is not, so eager init would re-bake all 400 outcome-baseline hashes.
    const { finalState } = simulate(cfg(
      tc('hero', ['sword_slash'], { speed: 20 }),
      tc('foe', ['sword_slash'], { speed: 10 }),
      { ...NO_ENDGAME, maxTurns: 6 },
    ), 3);
    for (const piece of [...finalState.player.pieces, ...finalState.enemy.pieces]) {
      expect(Object.prototype.hasOwnProperty.call(piece, 'nextWeightPenalty')).toBe(false);
    }
  });

  it('a splashed-then-CONSUMED piece has the key DELETED, not left as undefined', () => {
    // The consumption site must `delete` (simulate.ts). `= undefined` also
    // hides from JSON.stringify, but leaves hasOwnProperty true — visible to
    // Object.keys, toStrictEqual and structured-clone, so a consumed piece
    // would no longer be byte-equal to a never-splashed one.
    const { events, finalState } = simulate(multicastFight(), 1);
    // Slots 0-1 were taxed and both played (see the multi-cast test below);
    // slot 2 was never in the band.
    expect(events.some((e) => e.kind === 'splashed')).toBe(true);
    const foe = finalState.enemyTeam[0]!;
    for (const piece of foe.pieces) {
      expect(Object.prototype.hasOwnProperty.call(piece, 'nextWeightPenalty')).toBe(false);
    }
    expect(Object.keys(foe.pieces[0]!)).not.toContain('nextWeightPenalty');
    // A consumed piece is structurally identical to an untouched one.
    expect(Object.keys(foe.pieces[0]!).sort()).toEqual(Object.keys(foe.pieces[2]!).sort());
  });
});

/**
 * THROUGH `simulate()`, not `splashBand()` — the cases where the tax's LIFETIME
 * and the turn loop are the thing under test: who pays, when, how often, and
 * how it composes with the unit-scope `slow`.
 */

/** Hero splashes once (cooldown 99) on turn 1, then the fight plays out. */
function splashFight(
  hero: string,
  foe: ReturnType<typeof tc>,
  heroStats: Parameters<typeof tc>[2] = {},
  extra: Parameters<typeof cfg>[2] = {},
): CombatConfig {
  return {
    ...cfg(
      tc('hero', [hero], { speed: 30, attack: 1, maxHp: 500, ...heroStats }, { skillBook: BOOK }),
      foe,
      { ...NO_ENDGAME, maxTurns: 30, cooldownsEnabled: true, ...extra },
    ),
    skillBook: BOOK,
  };
}

const enemyPlays = (events: Ev[]): Extract<Ev, { kind: 'play' }>[] =>
  events.filter((e): e is Extract<Ev, { kind: 'play' }> => e.kind === 'play' && e.side === 'enemy');

/** First and subsequent play weights, keyed by slot. */
function payments(plays: Extract<Ev, { kind: 'play' }>[]): { first: Map<number, number>; later: Map<number, number[]> } {
  const first = new Map<number, number>();
  const later = new Map<number, number[]>();
  for (const play of plays) {
    if (first.has(play.slot)) later.set(play.slot, [...(later.get(play.slot) ?? []), play.weight]);
    else first.set(play.slot, play.weight);
  }
  return { first, later };
}

/** A foe fast enough to resolve THREE casts inside one turn, splashed first. */
const multicastFight = (): CombatConfig => ({
  ...cfg(
    tc('hero', ['splashOnce'], { speed: 100, attack: 1, maxHp: 500 }, { skillBook: BOOK }),
    tc('foe', ['jab', 'jab2', 'jab3'], { speed: 60, attack: 1, maxHp: 500 }, { skillBook: BOOK }),
    { ...NO_ENDGAME, maxTurns: 2, cooldownsEnabled: true },
  ),
  skillBook: BOOK,
});

describe('splash through the turn loop', () => {
  it('THE NO-WRAP ANCHOR, END TO END: a splash landing after the victim walked its board taxes the LAST CARD PLAYED and its left neighbour', () => {
    // The hero banks four turns (weight 40 vs speed 10) while the foe plays
    // slots 0, 1, 2 on turns 1-3. On turn 4 the foe's cursor is parked at 3 —
    // past the last card — and the hero fires.
    const config = splashFight(
      'splashLate',
      tc('foe', ['jab', 'jab2', 'jab3'], { speed: 10, attack: 1, maxHp: 500 }, { skillBook: BOOK }),
      { speed: 10 },
      { maxTurns: 6, cooldownsEnabled: false },
    );
    const { events } = simulate(config, 1);
    const splashed = events.filter((e): e is Extract<Ev, { kind: 'splashed' }> => e.kind === 'splashed');
    expect(splashed[0]).toMatchObject({ turn: 4, weight: 6, anchorSlot: 2, slots: [1, 2] });
    // WRAPPING WOULD HAVE SAID anchorSlot 0 / slots [0, 1] here.
    expect(splashed[0]!.slots).not.toContain(0);
    // And the untaxed slot 0, which the foe plays later that same turn, still
    // costs base weight — proof the band really is where the event says.
    const after = enemyPlays(events).filter((e) => e.turn === 4);
    expect(after.map((e) => [e.slot, e.weight])).toEqual([[0, 10]]);
  });

  it('a SIZE-2 and a SIZE-3 taxed piece each pay the tax exactly ONCE, on the cast that starts their span', () => {
    // wide2 (weight 20, slots 0-1) and wide (weight 30, slots 2-4). The anchor
    // is wide2; wide is its right neighbour edge-to-edge, so both are taxed.
    const config = splashFight(
      'splashOnce',
      tc('foe', [], { speed: 20, attack: 1, maxHp: 500 }, {
        pieces: [{ skillId: 'wide2', slot: 0 }, { skillId: 'wide', slot: 2 }],
        skillBook: BOOK,
      }),
    );
    const { events } = simulate(config, 1);
    expect(events.filter((e) => e.kind === 'splashed')).toHaveLength(1);
    const { first, later } = payments(enemyPlays(events));
    expect(first.get(0)).toBe(26); // 20 base + 6
    expect(first.get(2)).toBe(36); // 30 base + 6
    // Every REPLAY is back to base: a multi-slot card pays the tax on the cast
    // that opens its span, and the busy span turns that follow re-charge nothing.
    expect(later.get(0)!.length).toBeGreaterThan(0);
    expect(later.get(2)!.length).toBeGreaterThan(0);
    expect(later.get(0)!.every((w) => w === 20)).toBe(true);
    expect(later.get(2)!.every((w) => w === 30)).toBe(true);
    // One play per cast: the span rows are not extra `play` events at slot 2.
    expect(enemyPlays(events).every((e) => e.slotIndex === 1)).toBe(true);
  });

  it('SLOW AND SPLASH ON ONE VICTIM: the two taxes SUM on the anchor, then diverge — slow dies with the turn, splash rides until the piece plays', () => {
    const config = splashFight(
      'slowSplash',
      tc('foe', ['jab', 'jab2', 'jab3'], { speed: 10, attack: 1, maxHp: 500 }, { skillBook: BOOK }),
      {},
      { maxTurns: 6 },
    );
    const { events } = simulate(config, 1);
    // TURN 1 — both land, and castSelect sums them: 10 base + 4 slow + 6 splash
    // = 20, which the foe (readiness 10) cannot afford. The `wait` reports the
    // taxed weight that actually stopped it.
    expect(events.find((e) => e.kind === 'wait' && e.side === 'enemy' && e.turn === 1))
      .toMatchObject({ reason: 'cantAfford', weight: 20, slot: 0 });
    const plays = enemyPlays(events);
    // TURN 2 — the slow is gone (dropped at end of turn 1, never paid), the
    // splash is not: 10 + 6 = 16, not 20 and not 10.
    expect(plays[0]).toMatchObject({ turn: 2, slot: 0, weight: 16 });
    const { first, later } = payments(plays);
    // The other banded piece pays its 6 whenever it finally plays — turns later,
    // long after any slow could have survived.
    expect(first.get(1)).toBe(16);
    expect(first.get(2)).toBe(10); // outside the band
    expect(later.get(0)!.every((w) => w === 10)).toBe(true);
    // Exactly one application of each, so nothing above is a re-cast artefact.
    expect(events.filter((e) => e.kind === 'slowed')).toHaveLength(1);
    expect(events.filter((e) => e.kind === 'splashed')).toHaveLength(1);
  });

  it('A MULTI-CASTING UNIT pays BOTH taxed pieces in the SAME turn, each exactly once', () => {
    // Speed 60 against weight-10 cards: the foe resolves three casts in turn 1.
    // Two of them are banded, and both pay — the tax is per PIECE, so one turn
    // can spend more than one of them.
    const { events } = simulate(multicastFight(), 1);
    const turnOne = enemyPlays(events).filter((e) => e.turn === 1);
    expect(turnOne.map((e) => [e.slot, e.weight])).toEqual([[0, 16], [1, 16], [2, 10]]);
    expect(events.filter((e) => e.kind === 'splashed')).toHaveLength(1);
  });
});

describe('splash pricing', () => {
  it('prices at 5 deci per weight — EXACTLY 2x the slow rate', () => {
    expect(PRICE.splashPerWeightNum / PRICE.splashPerWeightDen).toBe(
      2 * (PRICE.slowPerWeightNum / PRICE.slowPerWeightDen),
    );
    const splash = card('x', { effects: [{ kind: 'splash', weight: 6 }] });
    // 6 * 5 = 30 deci of effects; size 1 so no grant, weight 10 is baseline.
    expect(powerLevelDeci(splash)).toBe(30);
  });

  it('counts against the CONTROL cap, so it cannot dodge lockdown limits', () => {
    const overCap = card('x', {
      // 21 * 5 = 105 deci > the size-1 control ceiling (100).
      effects: [{ kind: 'splash', weight: 21 }],
    });
    expect(EFFECT_CAPS_DECI.control[1]).toBe(100);
    expect(capViolations(overCap).join(' ')).toContain('control');
    // One weight under the cap is legal.
    expect(capViolations(card('x', { effects: [{ kind: 'splash', weight: 20 }] }))).toEqual([]);
  });

  it('the showcase card lands EXACTLY on its tier budget', () => {
    const showcase = skillBook.shockwave_slam!;
    expect(showcase.tier).toBe('bronze');
    expect(powerLevelDeci(showcase)).toBe(100);
    expect(capViolations(showcase)).toEqual([]);
  });

  it('scope: all + splash is REJECTED by the content validator (splash is single-target at the UNIT level)', () => {
    const doc = {
      schemaVersion: 1,
      cards: [{
        id: 'aoe_splash',
        versions: [{
          version: 1,
          def: {
            name: 'AoE Splash', text: 'Deal 10 damage · splash +6 weight.',
            archetypes: ['offense'], property: 'physical', weapon: 'axe',
            size: 1, rarity: 'common', tier: 'bronze', scope: 'all',
            effects: [{ kind: 'damage', power: 10 }, { kind: 'splash', weight: 6 }],
          },
        }],
      }],
    };
    const problems = validateSkillDocument(doc).map((p) => p.message).join('\n');
    expect(problems).toContain('scope: all cannot be combined with a splash action');
  });

  /**
   * The rule is checked against the EFFECTIVE (scope, effects) pair at EVERY
   * tier, and a tier block inherits whichever half it does not declare
   * (`up.scope ?? raw.scope`, `up.effects ?? raw.effects` in
   * validateSkillContent). Both inheritance directions are live rules, so both
   * get a test: a legal base card must not be able to become AoE+splash at
   * diamond by declaring only one half of the pair.
   */
  const tieredDoc = (def: Record<string, unknown>) => ({
    schemaVersion: 1,
    cards: [{
      id: 'tiered_splash',
      versions: [{
        version: 1,
        def: {
          name: 'Tiered Splash', text: 'Deal 10 damage.',
          archetypes: ['offense'], property: 'physical', weapon: 'axe',
          size: 1, rarity: 'common', tier: 'bronze',
          ...def,
        },
      }],
    }],
  });

  it('a tier that adds `scope: all` INHERITS the base effects — and is caught carrying the base splash', () => {
    const problems = validateSkillDocument(tieredDoc({
      effects: [{ kind: 'damage', power: 10 }, { kind: 'splash', weight: 6 }],
      tierUpgrades: { silver: { scope: 'all' }, gold: { scope: 'all' }, diamond: { scope: 'all' } },
    }));
    // Bronze itself is clean (no scope); the three upgraded tiers are not.
    const where = problems.filter((p) => p.message.includes('scope: all cannot be combined with a splash action'));
    expect(where.map((p) => p.where.split('.tierUpgrades.')[1]).sort()).toEqual(['diamond', 'gold', 'silver']);
  });

  it('a tier that adds a splash INHERITS the base `scope: all` — and is caught too', () => {
    const problems = validateSkillDocument(tieredDoc({
      scope: 'all',
      effects: [{ kind: 'damage', power: 10 }],
      tierUpgrades: { silver: { effects: [{ kind: 'damage', power: 12 }, { kind: 'splash', weight: 6 }] } },
    })).map((p) => p.message).join('\n');
    expect(problems).toContain('scope: all cannot be combined with a splash action');
  });

  it('inheritance does not INVENT the pair: an AoE base with a splashless tier, and a splash base with a scopeless tier, both pass', () => {
    expect(validateSkillDocument(tieredDoc({
      scope: 'all',
      effects: [{ kind: 'damage', power: 10 }],
      tierUpgrades: { silver: { text: 'Deal 12 damage to all.', effects: [{ kind: 'damage', power: 12 }] } },
    }))).toEqual([]);
    expect(validateSkillDocument(tieredDoc({
      effects: [{ kind: 'damage', power: 10 }, { kind: 'splash', weight: 6 }],
      tierUpgrades: {
        silver: {
          text: 'Deal 12 damage · splash +6 weight.',
          effects: [{ kind: 'damage', power: 12 }, { kind: 'splash', weight: 6 }],
        },
      },
    }))).toEqual([]);
  });

  it('the same card WITHOUT the AoE scope validates clean', () => {
    const doc = {
      schemaVersion: 1,
      cards: [{
        id: 'solo_splash',
        versions: [{
          version: 1,
          def: {
            name: 'Solo Splash', text: 'Deal 10 damage · splash +6 weight.',
            archetypes: ['offense'], property: 'physical', weapon: 'axe',
            size: 1, rarity: 'common', tier: 'bronze',
            effects: [{ kind: 'damage', power: 10 }, { kind: 'splash', weight: 6 }],
          },
        }],
      }],
    };
    expect(validateSkillDocument(doc)).toEqual([]);
  });
});

/**
 * SPLASH ON A GEM — the grant the keyword was built for, and the two gates that
 * keep it honest (user ruling, 2026-08-18: "splash is supposed to be on a gem
 * that allows giving other cards this effect in the first place").
 *
 * The gem is the point: `shockwave_slam` shows the keyword off, the gem is how
 * any card gets it. Because a gem is spliced onto its host AFTER authoring,
 * `validateSkillContent` cannot see it — so the two rules that protect splash's
 * identity live at the resolver seam (`spliceGemActions`, src/engine/cards.ts)
 * and are pinned here:
 *   (a) a host that already hits MORE THAN ONE target drops the gem's splash —
 *       otherwise the offensive fan-out taxes every living foe's whole board
 *       band at a single-target price;
 *   (b) a host that ALREADY SPLASHES drops it too, host's-own-splash-wins, so a
 *       socket can never double the band tax or rewrite an audited magnitude.
 */

/** A gem carrying exactly one splash of `weight` (id/rarity are irrelevant to the gate). */
const splashGem = (weight: number, id = 'test_splash_gem'): Gem =>
  ({ kind: 'effect', id, rarity: 'common', actions: [{ kind: 'splash', weight }] });

describe('splash gems: the catalog', () => {
  it('ships a Common and a Rare rung that land EXACTLY on their rarity bands', () => {
    // splash prices at 5 deci per weight, so a gem's whole PL is 5 x weight:
    //   weight 4 -> 20 deci = Common (20)   ·   weight 8 -> 40 deci = Rare (40)
    // (weight 3 -> 15 and weight 7 -> 35 are no band at all, which is what
    // makes each shipped magnitude MINIMAL for its band.)
    const tremor = gemBook.tremor_sliver!;
    const fracture = gemBook.fracture_sliver!;
    expect(tremor.kind).toBe('effect');
    expect(fracture.kind).toBe('effect');
    expect(gemPowerLevelDeci(tremor)).toBe(RARITY_PL_DECI.common);
    expect(gemPowerLevelDeci(fracture)).toBe(RARITY_PL_DECI.rare);
    expect(isGemOnBudget(tremor) && isGemOnBudget(fracture)).toBe(true);
    expect(gemPowerLevelDeci(splashGem(4))).toBe(20);
    expect(gemPowerLevelDeci(splashGem(8))).toBe(40);
  });

  it('GRANTS splash to a host that has none — the whole point of the gem', () => {
    // sword_slash carries no splash of its own. Socketed, the hero's cast taxes
    // the foe's band; un-socketed the same board never emits a `splashed` event.
    const foeRow = tc('foe', ['jab', 'jab2', 'jab3'], { speed: 10, attack: 1, maxHp: 500 }, { skillBook: BOOK });
    const run = (gem?: Gem) => simulate({
      ...cfg(
        tc('hero', [], { speed: 30, maxHp: 500 }, {
          pieces: [{ skillId: 'splashless', slot: 0, ...(gem ? { gem } : {}) }],
          skillBook: BOOK,
        }),
        foeRow,
        { ...NO_ENDGAME, maxTurns: 4 },
      ),
      skillBook: BOOK,
    }, 1);

    expect(run().events.some((e) => e.kind === 'splashed')).toBe(false);

    const splashed = run(gemBook.tremor_sliver!).events
      .filter((e): e is Extract<Ev, { kind: 'splashed' }> => e.kind === 'splashed');
    expect(splashed.length).toBeGreaterThan(0);
    expect(splashed[0]).toMatchObject({ side: 'enemy', weight: 4, anchorSlot: 0, slots: [0, 1] });
  });
});

describe('splash gems: GATE (a) — a host that hits more than one target', () => {
  it('drops the gem splash on an AoE host, at the RESOLVER (no splash on the effective card)', () => {
    const aoe = BOOK.aoeJab!;
    expect(isMultiTargetSkill(aoe)).toBe(true);
    const eff = resolveEffectiveSkill(aoe, { skillId: 'aoeJab', slot: 0, gem: splashGem(8) });
    expect(eff.effects.some((a) => a.kind === 'splash')).toBe(false);
    expect(splashSuppressionOn(aoe)).toBe('multiTarget');
  });

  it('applies NOTHING at runtime: not one splashed event, on any foe', () => {
    const config: CombatConfig = {
      ...cfg(
        tc('hero', [], { speed: 30, maxHp: 500 }, {
          pieces: [{ skillId: 'aoeJab', slot: 0, gem: gemBook.fracture_sliver! }],
          skillBook: BOOK,
        }),
        tc('foe', ['jab', 'jab2', 'jab3'], { speed: 10, attack: 1, maxHp: 500 }, { skillBook: BOOK }),
        { ...NO_ENDGAME, maxTurns: 4 },
      ),
      skillBook: BOOK,
    };
    // Three foes, so a fanned-out splash would be loudly visible (3 events/cast).
    config.enemyTeam = [
      tc('foe1', ['jab', 'jab2', 'jab3'], { speed: 10, attack: 1, maxHp: 500 }, { skillBook: BOOK }),
      tc('foe2', ['jab', 'jab2', 'jab3'], { speed: 10, attack: 1, maxHp: 500 }, { skillBook: BOOK }),
      tc('foe3', ['jab', 'jab2', 'jab3'], { speed: 10, attack: 1, maxHp: 500 }, { skillBook: BOOK }),
    ];
    const { events } = simulate(config, 1);
    expect(events.some((e) => e.kind === 'damage' && e.side === 'enemy')).toBe(true); // the host still fires
    expect(events.some((e) => e.kind === 'splashed')).toBe(false);
    for (const piece of simulate(config, 1).finalState.enemyTeam.flatMap((c) => c.pieces)) {
      expect(piece.nextWeightPenalty ?? 0).toBe(0);
    }
  });

  it('drops ONLY the splash — every other action the gem carries still lands', () => {
    const mixed: Gem = {
      kind: 'effect', id: 'mixed', rarity: 'rare',
      actions: [{ kind: 'splash', weight: 8 }, { kind: 'poison', stacks: 3 }],
    };
    const eff = resolveEffectiveSkill(BOOK.aoeJab!, { skillId: 'aoeJab', slot: 0, gem: mixed });
    expect(eff.effects.map((a) => a.kind)).toEqual(['damage', 'poison']);
    expect(eff.effects[1]).toMatchObject({ kind: 'poison', stacks: 3, fromGem: true });
  });
});

describe('splash gems: GATE (b) — a host that already splashes', () => {
  const showcase = skillBook.shockwave_slam!;

  const shockwaveFight = (gem?: Gem): CombatConfig => cfg(
    tc('hero', [], { attack: 12, speed: 24, maxHp: 500 }, {
      pieces: [{ skillId: 'shockwave_slam', slot: 0, ...(gem ? { gem } : {}) }],
    }),
    tc('foe', ['sword_slash', 'fireball', 'armor_break'], { speed: 10, maxHp: 500 }),
    { ...NO_ENDGAME, maxTurns: 10 },
  );

  it('the HOST’s splash wins: socketing a splash gem is BYTE-IDENTICAL to the bare card', () => {
    const bare = simulate(shockwaveFight(), 7);
    for (const gem of [gemBook.tremor_sliver!, gemBook.fracture_sliver!, splashGem(16)]) {
      const gemmed = simulate(shockwaveFight(gem), 7);
      expect(JSON.stringify(gemmed.events)).toBe(JSON.stringify(bare.events));
      expect(JSON.stringify(gemmed.finalState)).toBe(JSON.stringify(bare.finalState));
      expect(gemmed.result).toEqual(bare.result);
    }
    // ...and the card still splashes at ITS authored 6, exactly once per cast.
    const splashes = bare.events.filter((e): e is Extract<Ev, { kind: 'splashed' }> => e.kind === 'splashed');
    expect(splashes.length).toBeGreaterThan(0);
    expect(splashes.every((e) => e.weight === 6)).toBe(true);
  });

  it('precedence is PROVENANCE, not magnitude and not list order', () => {
    // A HEAVIER gem splash does not win (that would rewrite an audited card),
    // and a gem whose splash sits first in its own action list does not either.
    expect(splashSuppressionOn(showcase)).toBe('hostAlreadySplashes');
    const heavy = resolveEffectiveSkill(showcase, { skillId: 'shockwave_slam', slot: 0, gem: splashGem(16) });
    const splashActions = heavy.effects.filter((a) => a.kind === 'splash');
    expect(splashActions).toHaveLength(1);
    expect(splashActions[0]).toMatchObject({ weight: 6 });
    expect(splashActions[0]).not.toHaveProperty('fromGem');
  });

  it('a gem carrying TWO splashes keeps exactly ONE (one band tax, one event per cast)', () => {
    const doubled: Gem = {
      kind: 'effect', id: 'doubled', rarity: 'rare',
      actions: [{ kind: 'splash', weight: 8 }, { kind: 'splash', weight: 2 }],
    };
    const eff = resolveEffectiveSkill(BOOK.splashless!, { skillId: 'splashless', slot: 0, gem: doubled });
    const kept = eff.effects.filter((a) => a.kind === 'splash');
    expect(kept).toHaveLength(1);
    expect(kept[0]).toMatchObject({ kind: 'splash', weight: 8, fromGem: true });
  });

  it('an ORDINARY single-target host with no splash is untouched by the gate', () => {
    const host = BOOK.splashless!;
    expect(splashSuppressionOn(host)).toBeNull();
    const eff = resolveEffectiveSkill(host, { skillId: 'splashless', slot: 0, gem: gemBook.fracture_sliver! });
    expect(eff.effects.map((a) => a.kind)).toEqual(['damage', 'splash']);
    expect(eff.effects[1]).toMatchObject({ kind: 'splash', weight: 8, fromGem: true });
  });
});

describe('splash gates: the multi-target CONCEPT, not a scope literal', () => {
  it('the gate and the fan-out ask the SAME question (`isMultiTargetSkill`)', () => {
    // If a future mechanism makes a card multi-target without `scope: 'all'`,
    // this pairing is what forces both sides to move together: the fan-out
    // reaches every living foe exactly when the gate suppresses splash.
    const foes = ['a', 'b', 'c'].map((n) => tc('foe' + n, ['jab'], { speed: 1, maxHp: 500 }, { skillBook: BOOK }));
    for (const id of ['aoeJab', 'splashless'] as const) {
      const state = initCombatState({
        playerTeam: [tc('hero', [], { speed: 30, maxHp: 500 }, { pieces: [{ skillId: id, slot: 0 }], skillBook: BOOK })],
        enemyTeam: foes,
        skillBook: BOOK,
      });
      const skill = BOOK[id]!;
      const targets = resolveTargets(
        { state, rng: new Rng(1), events: [] },
        state.playerTeam[0]!,
        skill,
        { kind: 'damage', power: 1 },
      );
      expect(targets.length > 1).toBe(isMultiTargetSkill(skill));
      expect(splashSuppressionOn(skill) === 'multiTarget').toBe(isMultiTargetSkill(skill));
    }
  });
});
