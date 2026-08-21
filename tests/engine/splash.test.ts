import { describe, expect, it } from 'vitest';
import { simulate } from '../../src/engine/combat/simulate';
import { initCombatState, type CombatState, type CombatantState } from '../../src/engine/combat/state';
import { cardTargetPieces, splashAnchor, splashBand } from '../../src/engine/combat/splash';
import { scanCast } from '../../src/engine/combat/castSelect';
import { applyCast, resolveTargets } from '../../src/engine/combat/interpreter';
import { NO_MODS } from '../../src/engine/combat/auras';
import { Rng } from '../../src/engine/rng';
import { CARD_TARGETING_KINDS, EFFECT_CAPS_DECI, PRICE, powerLevelDeci, powerLevelBreakdown, capViolations } from '../../src/engine/balance';
import { validateSkillDocument } from '../../src/data/validateSkillContent';
import { skillBook } from '../../src/data/skills';
import { gemBook } from '../../src/data/gems';
import { resolveEffectiveSkill, splashSuppressionOn } from '../../src/engine/cards';
import { gemPowerLevelDeci, instancePowerLevelDeci, isGemOnBudget, RARITY_PL_DECI } from '../../src/engine/balance';
import { isMultiTargetSkill } from '../../src/engine/types';
import type { Action, BoardPiece, CombatConfig, Gem, SkillBook, SkillDef } from '../../src/engine/types';
import type { CombatEvent as Ev } from '../../src/engine/combat/events';
import { cfg, tc, NO_ENDGAME } from '../helpers';

/**
 * THE CARD-TARGETING KEYWORDS AND THEIR SPREADER (user-locked 2026-08-21:
 * "splash is an effect that spread other effect. It doesn't just spread wt").
 *
 * Three keywords, one geometry:
 *   • `burden` — `slow` at CARD scope: +weight on the ANCHOR's next play.
 *   • `curse`  — the damage axis: the ANCHOR deals less for N global turns.
 *   • `splash` — PAYLOAD-LESS. It spreads whichever of the two the cast carries
 *     from the anchor to the whole BAND. Nothing else.
 *
 * What this suite pins: the BAND (3 pieces, edge-to-edge, never wrapping), the
 * ANCHOR-vs-BAND choice being the ONLY thing splash changes, the NON-STACKING
 * rules (max, not sum), WHO ends each effect (a burden is spent by the piece
 * that plays; a curse expires on a clock), the pairing/validation rules, and the
 * prices — including that the split cost the three shipped cards and both gems
 * exactly nothing.
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
  // THE KEYWORDS UNDER TEST, with no damage line so nothing else moves. Each
  // comes in an ANCHOR-ONLY form and a SPREAD form (`+ splash`), which is the
  // pair every geometry assertion below is built on.
  burden6: card('burden6', { effects: [{ kind: 'burden', weight: 6 }], archetypes: ['debuff'] }),
  burden2: card('burden2', { effects: [{ kind: 'burden', weight: 2 }], archetypes: ['debuff'] }),
  spread6: card('spread6', { effects: [{ kind: 'burden', weight: 6 }, { kind: 'splash' }], archetypes: ['debuff'] }),
  spread2: card('spread2', { effects: [{ kind: 'burden', weight: 2 }, { kind: 'splash' }], archetypes: ['debuff'] }),
  // SPLASH FIRST IN THE LIST: the spreader is cast-scoped, not positional, so
  // this must behave identically to `spread6`.
  spreadFirst6: card('spreadFirst6', { effects: [{ kind: 'splash' }, { kind: 'burden', weight: 6 }], archetypes: ['debuff'] }),
  // Fires ONCE per fight (cooldowns enabled) so a consumption test sees the
  // tax spent without the caster immediately re-applying it.
  spreadOnce: card('spreadOnce', { effects: [{ kind: 'burden', weight: 6 }, { kind: 'splash' }], archetypes: ['debuff'], cooldownTurns: 99 }),
  burdenOnce: card('burdenOnce', { effects: [{ kind: 'burden', weight: 6 }], archetypes: ['debuff'], cooldownTurns: 99 }),
  // Heavy enough that the caster must bank four turns before it fires — long
  // enough for a 3-card victim to walk its whole board and park the cursor PAST
  // the last card, which is the no-wrap anchor case.
  spreadLate: card('spreadLate', { effects: [{ kind: 'burden', weight: 6 }, { kind: 'splash' }], archetypes: ['debuff'], speedWeight: 40, cooldownTurns: 99 }),
  // Both taxes from one cast, so their SUM and their different lifetimes can be
  // watched on the same victim.
  slowSpread: card('slowSpread', {
    effects: [{ kind: 'slow', weight: 4 }, { kind: 'burden', weight: 6 }, { kind: 'splash' }],
    archetypes: ['debuff'],
    cooldownTurns: 99,
  }),
  // CURSE, in the same two forms. `curseOnce` lands exactly one application so a
  // window can be watched opening and closing.
  curse4: card('curse4', { effects: [{ kind: 'curse', amount: 4, turns: 2 }], archetypes: ['debuff'] }),
  curse9: card('curse9', { effects: [{ kind: 'curse', amount: 9, turns: 9 }], archetypes: ['debuff'] }),
  curseSpread4: card('curseSpread4', { effects: [{ kind: 'curse', amount: 4, turns: 2 }, { kind: 'splash' }], archetypes: ['debuff'] }),
  curseOnce: card('curseOnce', { effects: [{ kind: 'curse', amount: 4, turns: 1 }], archetypes: ['debuff'], cooldownTurns: 99 }),
  curseHuge: card('curseHuge', { effects: [{ kind: 'curse', amount: 99, turns: 5 }], archetypes: ['debuff'], cooldownTurns: 99 }),
  // Degenerate applications the engine must DROP outright.
  curseNoAmount: card('curseNoAmount', { effects: [{ kind: 'curse', amount: 0, turns: 3 }], archetypes: ['debuff'] }),
  curseNoTurns: card('curseNoTurns', { effects: [{ kind: 'curse', amount: 4, turns: 0 }], archetypes: ['debuff'] }),
  // GEM HOSTS. `splashless` is an ordinary single-target card with no
  // card-targeting effect of its own; `aoeJab` is the same card with the one
  // multi-target mechanism the game has today; `burdenHost` supplies a payload
  // but no spreader. All carry a damage line so the host still fires when its
  // gem's splash is dropped.
  splashless: card('splashless'),
  aoeJab: card('aoeJab', { scope: 'all' }),
  burdenHost: card('burdenHost', { effects: [{ kind: 'damage', power: 0 }, { kind: 'burden', weight: 6 }] }),
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

/**
 * THE SEAM ITSELF (`cardTargetPieces`): the ONE function that decides how far a
 * card-targeting effect reaches, and therefore the one place `splash` means
 * anything at all. Every keyword arm calls it, so a future card-scope keyword
 * inherits the pairing without inventing its own geometry.
 */
describe('cardTargetPieces: the anchor-vs-band seam', () => {
  it('spread=false is the ANCHOR ALONE; spread=true is the whole band', () => {
    const foe = enemyBoard(row(['jab', 'jab2', 'jab3', 'jab4']), 1);
    const anchorOnly = cardTargetPieces(foe, false)!;
    expect(anchorOnly.pieces.map((p) => p.slot)).toEqual([1]);
    expect(anchorOnly.anchor.slot).toBe(1);
    const banded = cardTargetPieces(foe, true)!;
    expect(banded.pieces.map((p) => p.slot)).toEqual([0, 1, 2]);
    expect(banded.anchor.slot).toBe(1);
  });

  it('the anchor is the SAME piece either way — spreading widens, it never moves the centre', () => {
    for (const cursor of [0, 2, 4, 7]) {
      const foe = enemyBoard(row(['jab', 'jab2', 'jab3', 'jab4', 'jab5']), cursor);
      expect(cardTargetPieces(foe, true)!.anchor).toBe(cardTargetPieces(foe, false)!.anchor);
    }
  });

  it('an empty board is null in BOTH modes — nothing to target is not a band of zero', () => {
    const foe = enemyBoard([], 0);
    expect(cardTargetPieces(foe, false)).toBeNull();
    expect(cardTargetPieces(foe, true)).toBeNull();
  });
});

/** Fire ONE cast from the hero onto the enemy, in isolation. */
function castOn(state: CombatState, skill: SkillDef): Ev[] {
  const events: Ev[] = [];
  const ctx = { state, rng: new Rng(1), events };
  applyCast(ctx, state.player, skill, 0, { ...NO_MODS }, { before: 0, after: 1 });
  return events;
}

function boardState(pieces: BoardPiece[], cursor: number, heroCard = 'spread6'): CombatState {
  const config: CombatConfig = {
    playerTeam: [tc('hero', [heroCard], {}, { skillBook: BOOK })],
    enemyTeam: [tc('foe', [], {}, { pieces, boardSize: 10, skillBook: BOOK })],
    skillBook: BOOK,
  };
  const state = initCombatState(config);
  state.enemy.castCursor = cursor;
  return state;
}

describe('burden application: the anchor alone, or the band when a splash spreads it', () => {
  it('ALONE it taxes exactly ONE card — the anchor — and says so on the event', () => {
    const state = boardState(row(['jab', 'jab2', 'jab3', 'jab4']), 1);
    const events = castOn(state, BOOK.burden6!);
    expect(events.find((e) => e.kind === 'burdened')).toMatchObject({
      kind: 'burdened', side: 'enemy', unit: 0, weight: 6, anchorSlot: 1, slots: [1],
    });
    expect(state.enemy.pieces.map((p) => p.nextWeightPenalty)).toEqual([undefined, 6, undefined, undefined]);
  });

  it('WITH a splash it taxes the whole band, at the same weight, on ONE event', () => {
    const state = boardState(row(['jab', 'jab2', 'jab3', 'jab4']), 1);
    const events = castOn(state, BOOK.spread6!);
    // ONE band-application event, not one per piece and not a second
    // "spread" event: the slot list is what reports the reach.
    expect(events.filter((e) => e.kind === 'burdened')).toHaveLength(1);
    expect(events.find((e) => e.kind === 'burdened')).toMatchObject({
      kind: 'burdened', side: 'enemy', unit: 0, weight: 6, anchorSlot: 1, slots: [0, 1, 2],
    });
    expect(state.enemy.pieces.map((p) => p.nextWeightPenalty)).toEqual([6, 6, 6, undefined]);
  });

  it('THE SPREADER IS CAST-SCOPED, NOT POSITIONAL: splash before the burden behaves identically', () => {
    // This is what lets a gem splash (spliced AFTER the host's effects) spread a
    // host's burden — the socket the gem exists for.
    const banded = boardState(row(['jab', 'jab2', 'jab3']), 1);
    const reversed = boardState(row(['jab', 'jab2', 'jab3']), 1);
    const a = castOn(banded, BOOK.spread6!).filter((e) => e.kind === 'burdened');
    const b = castOn(reversed, BOOK.spreadFirst6!).filter((e) => e.kind === 'burdened');
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
    expect(reversed.enemy.pieces.map((p) => p.nextWeightPenalty)).toEqual([6, 6, 6]);
  });

  it('RE-BURDEN TAKES THE MAX, NEVER THE SUM (an unbounded stack would lock a card out)', () => {
    const state = boardState(row(['jab', 'jab2', 'jab3']), 1);
    castOn(state, BOOK.spread6!);
    castOn(state, BOOK.spread2!); // weaker: loses
    expect(state.enemy.pieces.map((p) => p.nextWeightPenalty)).toEqual([6, 6, 6]);
    castOn(state, BOOK.spread6!); // equal: still 6, not 12
    expect(state.enemy.pieces.map((p) => p.nextWeightPenalty)).toEqual([6, 6, 6]);
  });

  it('the max applies ACROSS reaches too: a bare burden cannot lower a spread one', () => {
    const state = boardState(row(['jab', 'jab2', 'jab3']), 1);
    castOn(state, BOOK.spread6!);
    castOn(state, BOOK.burden2!);
    expect(state.enemy.pieces.map((p) => p.nextWeightPenalty)).toEqual([6, 6, 6]);
  });

  it('is a NO-OP on a dead unit — no penalty, no event', () => {
    const state = boardState(row(['jab', 'jab2', 'jab3']), 1);
    state.enemy.alive = false;
    state.enemy.stats.hp = 0;
    const events = castOn(state, BOOK.spread6!);
    expect(events.find((e) => e.kind === 'burdened')).toBeUndefined();
    expect(state.enemy.pieces.map((p) => p.nextWeightPenalty)).toEqual([undefined, undefined, undefined]);
  });

  it('is a NO-OP on an empty board — nothing to tax, so nothing is logged', () => {
    expect(castOn(boardState([], 0), BOOK.spread6!).find((e) => e.kind === 'burdened')).toBeUndefined();
  });

  it('leaves the UNIT-scope penalty (`slow`) alone — the two scopes are independent', () => {
    const state = boardState(row(['jab', 'jab2']), 0);
    castOn(state, BOOK.spread6!);
    expect(state.enemy.nextWeightPenalty).toBe(0);
  });

  it('a lone splash with nothing to spread does nothing at all (and cannot be authored)', () => {
    // Unreachable through content — `validateSkillContent` refuses it and the gem
    // gate drops it — so this pins the ENGINE's behaviour if one is ever
    // constructed in code: the arm is empty, so the cast is inert.
    const bare = card('bareSplash', { effects: [{ kind: 'splash' }], archetypes: ['debuff'] });
    const state = boardState(row(['jab', 'jab2', 'jab3']), 1);
    const events = castOn(state, bare);
    expect(events.filter((e) => e.kind === 'burdened' || e.kind === 'cursed')).toEqual([]);
    expect(state.enemy.pieces.map((p) => p.nextWeightPenalty)).toEqual([undefined, undefined, undefined]);
  });
});

describe('burden consumption', () => {
  const scanOpts = { currentTurn: 0, cooldownsEnabled: false };

  it('a SPECULATIVE scanCast READS the penalty but never consumes it', () => {
    // scanCast runs for units that will not cast at all this turn (the
    // performer search and the `wait`/cantAfford explanation pass both call
    // it), so consuming here would make the tax vanish without being paid.
    const state = boardState(row(['jab', 'jab2', 'jab3']), 1);
    castOn(state, BOOK.spread6!);
    for (let i = 0; i < 5; i += 1) {
      const scan = scanCast(state.enemy, BOOK, scanOpts);
      expect(scan.kind).toBe('choice');
      if (scan.kind !== 'choice') return;
      expect(scan.choice.weight).toBe(16); // 10 base + 6 burden, every time
    }
    expect(state.enemy.pieces[1]!.nextWeightPenalty).toBe(6);
  });

  it('is consumed EXACTLY ONCE, by the piece that plays — the next play is back to base weight', () => {
    // Hero casts on turn 1 (speed 30 vs 10 so it lands first); the foe then
    // plays its band cards. Each taxed piece pays +6 on ITS first play.
    const config: CombatConfig = {
      ...cfg(
        tc('hero', ['spreadOnce'], { speed: 30, maxHp: 500 }, { skillBook: BOOK }),
        tc('foe', ['jab', 'jab2', 'jab3'], { speed: 10, attack: 1, maxHp: 500 }, { skillBook: BOOK }),
        // Cooldowns ON so the burden lands exactly ONCE (cooldownTurns 99):
        // any later re-application would re-arm the very tax this test watches
        // being spent, and prove nothing.
        { ...NO_ENDGAME, maxTurns: 14, cooldownsEnabled: true },
      ),
      skillBook: BOOK,
    };
    const { events } = simulate(config, 1);
    expect(events.filter((e) => e.kind === 'burdened')).toHaveLength(1);
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
    expect(first.get(0)).toBe(16); // 10 base + 6 burden
    expect(first.get(1)).toBe(16);
    expect(first.get(2)).toBe(10); // outside the band: never taxed
    // CONSUMED, not permanent: every REPLAY is back to base weight.
    expect(later.length).toBeGreaterThan(0);
    expect(later.every((weight) => weight === 10)).toBe(true);
  });

  it('a bare burden is consumed the same way, on the ONE card it landed on', () => {
    const config: CombatConfig = {
      ...cfg(
        tc('hero', ['burdenOnce'], { speed: 30, maxHp: 500 }, { skillBook: BOOK }),
        tc('foe', ['jab', 'jab2', 'jab3'], { speed: 10, attack: 1, maxHp: 500 }, { skillBook: BOOK }),
        { ...NO_ENDGAME, maxTurns: 14, cooldownsEnabled: true },
      ),
      skillBook: BOOK,
    };
    const { events } = simulate(config, 1);
    expect(events.filter((e) => e.kind === 'burdened')).toHaveLength(1);
    const { first, later } = payments(enemyPlays(events));
    expect(first.get(0)).toBe(16); // the anchor pays
    expect(first.get(1)).toBe(10); // its neighbour never did — no splash, no spread
    expect(first.get(2)).toBe(10);
    expect(later.get(0)!.every((w) => w === 10)).toBe(true);
  });

  it('a piece that was never burdened carries NO `nextWeightPenalty` key at all (baseline-hash safety)', () => {
    // The field is LAZILY WRITTEN: `undefined` is dropped by JSON.stringify but
    // `0` is not, so eager init would re-bake all 400 outcome-baseline hashes.
    const { finalState } = simulate(cfg(
      tc('hero', ['sword_slash'], { speed: 20 }),
      tc('foe', ['sword_slash'], { speed: 10 }),
      { ...NO_ENDGAME, maxTurns: 6 },
    ), 3);
    for (const piece of [...finalState.player.pieces, ...finalState.enemy.pieces]) {
      expect(Object.prototype.hasOwnProperty.call(piece, 'nextWeightPenalty')).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(piece, 'curse')).toBe(false);
    }
  });

  it('a burdened-then-CONSUMED piece has the key DELETED, not left as undefined', () => {
    // The consumption site must `delete` (simulate.ts). `= undefined` also
    // hides from JSON.stringify, but leaves hasOwnProperty true — visible to
    // Object.keys, toStrictEqual and structured-clone, so a consumed piece
    // would no longer be byte-equal to a never-burdened one.
    const { events, finalState } = simulate(multicastFight(), 1);
    // Slots 0-1 were taxed and both played (see the multi-cast test below);
    // slot 2 was never in the band.
    expect(events.some((e) => e.kind === 'burdened')).toBe(true);
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
 * CURSE — the second card-targeting keyword. Same geometry, same spreader, same
 * non-stacking rule; what differs is the payload (damage, not weight) and the
 * ending (a clock, not a play).
 */
describe('curse application', () => {
  it('ALONE it curses exactly ONE card — the anchor — and reports the window', () => {
    const state = boardState(row(['jab', 'jab2', 'jab3', 'jab4']), 1, 'curse4');
    const events = castOn(state, BOOK.curse4!);
    expect(events.find((e) => e.kind === 'cursed')).toMatchObject({
      kind: 'cursed', side: 'enemy', unit: 0, amount: 4, turns: 2, anchorSlot: 1, slots: [1],
    });
    expect(state.enemy.pieces.map((p) => p.curse)).toEqual([
      undefined, { amount: 4, expiresAtTurn: state.turn + 2 }, undefined, undefined,
    ]);
  });

  it('WITH a splash it curses the whole band — the spreader means the same thing for both keywords', () => {
    const state = boardState(row(['jab', 'jab2', 'jab3', 'jab4']), 1, 'curseSpread4');
    const events = castOn(state, BOOK.curseSpread4!);
    expect(events.filter((e) => e.kind === 'cursed')).toHaveLength(1);
    expect(events.find((e) => e.kind === 'cursed')).toMatchObject({ slots: [0, 1, 2], anchorSlot: 1 });
    expect(state.enemy.pieces.map((p) => p.curse?.amount)).toEqual([4, 4, 4, undefined]);
  });

  it('NON-STACKING, the `expose` rule: the STRONGER amount AND the LATER expiry, independently', () => {
    const state = boardState(row(['jab', 'jab2']), 0, 'curse4');
    castOn(state, BOOK.curse9!); // amount 9, expires turn+9
    castOn(state, BOOK.curse4!); // weaker amount, shorter window: both lose
    expect(state.enemy.pieces[0]!.curse).toEqual({ amount: 9, expiresAtTurn: state.turn + 9 });
    // A STRONGER-but-SHORTER application raises the amount and must NOT shorten
    // the standing window; the two fields are maxed separately.
    const other = boardState(row(['jab', 'jab2']), 0, 'curse4');
    castOn(other, BOOK.curse4!); // amount 4, expires turn+2
    castOn(other, card('big1', { effects: [{ kind: 'curse', amount: 20, turns: 1 }] }));
    // amount 20 (the stronger) with the LONGER window of the two: turn + 2 from
    // the first application, NOT the turn + 1 the second one asked for.
    expect(other.enemy.pieces[0]!.curse).toEqual({ amount: 20, expiresAtTurn: other.turn + 2 });
  });

  it('a 0-amount or 0-turn curse is DROPPED OUTRIGHT — no state, no event (the `expose` rule)', () => {
    for (const id of ['curseNoAmount', 'curseNoTurns'] as const) {
      const state = boardState(row(['jab', 'jab2']), 0, 'curse4');
      const events = castOn(state, BOOK[id]!);
      expect(events.filter((e) => e.kind === 'cursed'), id).toEqual([]);
      expect(state.enemy.pieces.map((p) => p.curse), id).toEqual([undefined, undefined]);
    }
  });

  it('is a NO-OP on a dead unit and on an empty board', () => {
    const dead = boardState(row(['jab']), 0, 'curse4');
    dead.enemy.alive = false;
    expect(castOn(dead, BOOK.curse4!).filter((e) => e.kind === 'cursed')).toEqual([]);
    expect(castOn(boardState([], 0, 'curse4'), BOOK.curse4!).filter((e) => e.kind === 'cursed')).toEqual([]);
  });
});

/**
 * A fight where the hero curses ONCE inside the window under test and the foe's
 * damage can be watched turn by turn.
 *
 * THE HERO IS DELIBERATELY SLOW (speed 3 against a weight-10 card): it banks
 * four turns, casts on TURN 4, and cannot afford a second cast until turn 7. That
 * is what makes the before/during/after pattern readable — cooldowns are OFF (so
 * the foe plays every single turn) and a fast curser would simply re-apply its
 * window every turn and prove nothing about expiry.
 */
function curseFight(hero: string, foeCards: string[], turns: number): CombatConfig {
  return {
    ...cfg(
      tc('hero', [hero], { speed: 3, attack: 1, maxHp: 2000 }, { skillBook: BOOK }),
      // `jab` has no flat base, so a foe hit IS the foe's Attack (10) — a curse
      // of 4 must land it at exactly 6.
      tc('foe', foeCards, { speed: 10, attack: 10, maxHp: 2000 }, { skillBook: BOOK }),
      { ...NO_ENDGAME, maxTurns: turns, cooldownsEnabled: false },
    ),
    skillBook: BOOK,
  };
}

/** Enemy skill-hit amounts, keyed by the turn they landed on. */
function enemyHitsByTurn(events: Ev[]): Map<number, number[]> {
  const byTurn = new Map<number, number[]>();
  for (const e of events) {
    if (e.kind !== 'damage' || e.side !== 'player' || e.source !== 'skill') continue;
    byTurn.set(e.turn, [...(byTurn.get(e.turn) ?? []), e.amount]);
  }
  return byTurn;
}

describe('curse through the turn loop: the cursed card really hits softer, then recovers', () => {
  it('reduces the cursed card\u2019s damage while the window stands, and it RECOVERS at expiry', () => {
    // curseOnce: amount 4, turns 1. Cast on turn 4 → covers the REST of turn 4
    // and all of turn 5, closed at the END of turn 5 (the same window a `fresh`
    // 1-turn status gets from addStatus + expireStatuses).
    const { events } = simulate(curseFight('curseOnce', ['jab'], 6), 1);
    expect(events.find((e) => e.kind === 'cursed')).toMatchObject({ turn: 4, amount: 4, turns: 1, anchorSlot: 0, slots: [0] });
    expect(events.find((e) => e.kind === 'curseExpired'))
      .toMatchObject({ turn: 5, kind: 'curseExpired', side: 'enemy', unit: 0, slots: [0] });
    const byTurn = enemyHitsByTurn(events);
    // BEFORE: full damage. DURING: 10 − 4 = 6. AFTER: full damage again.
    expect(byTurn.get(1)).toEqual([10]);
    expect(byTurn.get(3)).toEqual([10]);
    expect(byTurn.get(4)).toEqual([6]);
    expect(byTurn.get(5)).toEqual([6]);
    expect(byTurn.get(6)).toEqual([10]);
    // The piece is structurally clean again — `delete`, not `= undefined`.
    const foe = simulate(curseFight('curseOnce', ['jab'], 6), 1).finalState.enemyTeam[0]!;
    expect(Object.prototype.hasOwnProperty.call(foe.pieces[0]!, 'curse')).toBe(false);
  });

  it('NEVER below 1 damage: a curse bigger than the whole hit floors, it does not heal', () => {
    // curseHuge: amount 99 against a 10-damage jab. The min-1 floor lives
    // downstream in `applyStrike`, which is exactly why the curse folds into
    // `mods.damageFlat` instead of doing its own arithmetic.
    const byTurn = enemyHitsByTurn(simulate(curseFight('curseHuge', ['jab'], 6), 1).events);
    expect(byTurn.get(3)).toEqual([10]); // before the curse lands
    for (const turn of [4, 5, 6]) expect(byTurn.get(turn), `turn ${turn}`).toEqual([1]);
  });

  it('lands PER CARD: a spread curse weakens the banded cards and leaves the rest alone', () => {
    // The foe rotates three cards, so the curse's effect is visible as a
    // per-piece thing rather than a per-unit one. On turn 4 the foe's cursor is
    // parked past its last card, so the anchor is the LAST CARD PLAYED (slot 2)
    // and the band is [1, 2] — slot 0 is outside it.
    const { events } = simulate(curseFight('curseSpread4', ['jab', 'jab2', 'jab3'], 6), 1);
    expect(events.find((e) => e.kind === 'cursed')).toMatchObject({ turn: 4, anchorSlot: 2, slots: [1, 2] });
    const byTurn = enemyHitsByTurn(events);
    // Turn 4 the foe plays slot 0 — outside the band, so full damage even though
    // the curse just landed. Turns 5-6 it plays the banded slots: 6 each.
    expect(byTurn.get(4)).toEqual([10]);
    expect(byTurn.get(5)).toEqual([6]);
    expect(byTurn.get(6)).toEqual([6]);
  });

  it('emits exactly ONE `curseExpired` per unit per turn, listing every slot that lapsed', () => {
    // A spread curse opens its windows on one tick, so they close on one tick:
    // one event, both slots, ascending.
    const { events } = simulate(curseFight('curseSpread4', ['jab', 'jab2', 'jab3'], 7), 1);
    const expiries = events.filter((e): e is Extract<Ev, { kind: 'curseExpired' }> => e.kind === 'curseExpired');
    expect(expiries).toHaveLength(1);
    expect(expiries[0]).toMatchObject({ turn: 6, slots: [1, 2] });
  });

  it('a curse is NOT spent by the cast it weakens — only by its clock', () => {
    // Slot 2 is cursed on turn 4 and plays on turn 6; it is STILL weakened on
    // turn 6 (a burden would have been paid off by that play). Proven by the
    // expiry arriving at the end of turn 6 rather than the play ending it.
    const { events } = simulate(curseFight('curseSpread4', ['jab', 'jab2', 'jab3'], 7), 1);
    const plays = enemyPlays(events).filter((e) => e.turn >= 5 && e.turn <= 6);
    expect(plays.map((e) => e.slot)).toEqual([1, 2]);
    expect(enemyHitsByTurn(events).get(6)).toEqual([6]);
    expect(events.find((e) => e.kind === 'curseExpired')!.turn).toBe(6);
  });
});

/**
 * THROUGH `simulate()`, not `splashBand()` — the cases where the tax's LIFETIME
 * and the turn loop are the thing under test: who pays, when, how often, and
 * how it composes with the unit-scope `slow`.
 */

/** Hero casts once (cooldown 99) on turn 1, then the fight plays out. */
function spreadFight(
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

/** A foe fast enough to resolve THREE casts inside one turn, burdened first. */
const multicastFight = (): CombatConfig => ({
  ...cfg(
    tc('hero', ['spreadOnce'], { speed: 100, attack: 1, maxHp: 500 }, { skillBook: BOOK }),
    tc('foe', ['jab', 'jab2', 'jab3'], { speed: 60, attack: 1, maxHp: 500 }, { skillBook: BOOK }),
    { ...NO_ENDGAME, maxTurns: 2, cooldownsEnabled: true },
  ),
  skillBook: BOOK,
});

describe('the spread burden through the turn loop', () => {
  it('THE NO-WRAP ANCHOR, END TO END: a spread landing after the victim walked its board taxes the LAST CARD PLAYED and its left neighbour', () => {
    // The hero banks four turns (weight 40 vs speed 10) while the foe plays
    // slots 0, 1, 2 on turns 1-3. On turn 4 the foe's cursor is parked at 3 —
    // past the last card — and the hero fires.
    const config = spreadFight(
      'spreadLate',
      tc('foe', ['jab', 'jab2', 'jab3'], { speed: 10, attack: 1, maxHp: 500 }, { skillBook: BOOK }),
      { speed: 10 },
      { maxTurns: 6, cooldownsEnabled: false },
    );
    const { events } = simulate(config, 1);
    const burdened = events.filter((e): e is Extract<Ev, { kind: 'burdened' }> => e.kind === 'burdened');
    expect(burdened[0]).toMatchObject({ turn: 4, weight: 6, anchorSlot: 2, slots: [1, 2] });
    // WRAPPING WOULD HAVE SAID anchorSlot 0 / slots [0, 1] here.
    expect(burdened[0]!.slots).not.toContain(0);
    // And the untaxed slot 0, which the foe plays later that same turn, still
    // costs base weight — proof the band really is where the event says.
    const after = enemyPlays(events).filter((e) => e.turn === 4);
    expect(after.map((e) => [e.slot, e.weight])).toEqual([[0, 10]]);
  });

  it('a SIZE-2 and a SIZE-3 taxed piece each pay the tax exactly ONCE, on the cast that starts their span', () => {
    // wide2 (weight 20, slots 0-1) and wide (weight 30, slots 2-4). The anchor
    // is wide2; wide is its right neighbour edge-to-edge, so both are taxed.
    const config = spreadFight(
      'spreadOnce',
      tc('foe', [], { speed: 20, attack: 1, maxHp: 500 }, {
        pieces: [{ skillId: 'wide2', slot: 0 }, { skillId: 'wide', slot: 2 }],
        skillBook: BOOK,
      }),
    );
    const { events } = simulate(config, 1);
    expect(events.filter((e) => e.kind === 'burdened')).toHaveLength(1);
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

  it('SLOW AND BURDEN ON ONE VICTIM: the two taxes SUM on the anchor, then diverge — slow dies with the turn, the burden rides until the piece plays', () => {
    const config = spreadFight(
      'slowSpread',
      tc('foe', ['jab', 'jab2', 'jab3'], { speed: 10, attack: 1, maxHp: 500 }, { skillBook: BOOK }),
      {},
      { maxTurns: 6 },
    );
    const { events } = simulate(config, 1);
    // TURN 1 — both land, and castSelect sums them: 10 base + 4 slow + 6 burden
    // = 20, which the foe (readiness 10) cannot afford. The `wait` reports the
    // taxed weight that actually stopped it.
    expect(events.find((e) => e.kind === 'wait' && e.side === 'enemy' && e.turn === 1))
      .toMatchObject({ reason: 'cantAfford', weight: 20, slot: 0 });
    const plays = enemyPlays(events);
    // TURN 2 — the slow is gone (dropped at end of turn 1, never paid), the
    // burden is not: 10 + 6 = 16, not 20 and not 10.
    expect(plays[0]).toMatchObject({ turn: 2, slot: 0, weight: 16 });
    const { first, later } = payments(plays);
    // The other banded piece pays its 6 whenever it finally plays — turns later,
    // long after any slow could have survived.
    expect(first.get(1)).toBe(16);
    expect(first.get(2)).toBe(10); // outside the band
    expect(later.get(0)!.every((w) => w === 10)).toBe(true);
    // Exactly one application of each, so nothing above is a re-cast artefact.
    expect(events.filter((e) => e.kind === 'slowed')).toHaveLength(1);
    expect(events.filter((e) => e.kind === 'burdened')).toHaveLength(1);
  });

  it('A MULTI-CASTING UNIT pays BOTH taxed pieces in the SAME turn, each exactly once', () => {
    // Speed 60 against weight-10 cards: the foe resolves three casts in turn 1.
    // Two of them are banded, and both pay — the tax is per PIECE, so one turn
    // can spend more than one of them.
    const { events } = simulate(multicastFight(), 1);
    const turnOne = enemyPlays(events).filter((e) => e.turn === 1);
    expect(turnOne.map((e) => [e.slot, e.weight])).toEqual([[0, 16], [1, 16], [2, 10]]);
    expect(events.filter((e) => e.kind === 'burdened')).toHaveLength(1);
  });
});

describe('pricing: the honest split', () => {
  it('CARD_TARGETING_KINDS is exactly the two payload keywords — the spreader is not one', () => {
    expect([...CARD_TARGETING_KINDS].sort()).toEqual(['burden', 'curse']);
    expect(CARD_TARGETING_KINDS.has('splash')).toBe(false);
    expect(CARD_TARGETING_KINDS.has('slow')).toBe(false);
  });

  it('burden prices at SLOW’S OWN RATE — one card taxed, one card’s worth of tempo', () => {
    expect(PRICE.burdenPerWeightNum / PRICE.burdenPerWeightDen).toBe(
      PRICE.slowPerWeightNum / PRICE.slowPerWeightDen,
    );
    // 6 * 5/2 = 15 deci; size 1 so no grant, weight 10 is baseline.
    expect(powerLevelDeci(card('x', { effects: [{ kind: 'burden', weight: 6 }] }))).toBe(15);
    // ...and the identical number a `slow` of the same weight costs.
    expect(powerLevelDeci(card('y', { effects: [{ kind: 'slow', weight: 6 }] }))).toBe(15);
  });

  it('splash prices as a COVERAGE MULTIPLIER on what it spreads, not per point of its own', () => {
    expect(PRICE.splashBandFloorNum / PRICE.splashBandFloorDen).toBe(2);
    const spread = card('x', { effects: [{ kind: 'burden', weight: 6 }, { kind: 'splash' }] });
    expect(powerLevelDeci(spread)).toBe(30); // 15 x 2
    // ...and it multiplies a CURSE exactly the same way, which is the whole
    // point of pricing the spreader as coverage rather than as weight.
    const curse = card('y', { effects: [{ kind: 'curse', amount: 4, turns: 2 }] });
    const cursed = card('z', { effects: [{ kind: 'curse', amount: 4, turns: 2 }, { kind: 'splash' }] });
    expect(powerLevelDeci(curse)).toBe(20);
    expect(powerLevelDeci(cursed)).toBe(40);
    // A splash with NOTHING to spread multiplies nothing — it cannot be authored
    // (validateSkillContent) or spliced (the gem gate), and if it were it would
    // be free BECAUSE it does nothing.
    expect(powerLevelDeci(card('w', { effects: [{ kind: 'splash' }] }))).toBe(0);
  });

  it('THE SPLIT COST THE OLD RATE NOTHING: burden N + splash == the old `splash weight N`', () => {
    // The retired rate was 5 deci per weight (`splashPerWeightNum/Den` = 5/1),
    // which is exactly burden's 5/2 times the x2 band floor. Every even weight
    // therefore prices to the deci as it did before the split.
    const OLD_RATE_DECI_PER_WEIGHT = 5;
    for (const weight of [2, 4, 6, 8, 10, 12, 16, 20]) {
      const spread = card('x', { effects: [{ kind: 'burden', weight }, { kind: 'splash' }] });
      expect(powerLevelDeci(spread), `weight ${weight}`).toBe(weight * OLD_RATE_DECI_PER_WEIGHT);
    }
  });

  it('curse prices its FIRST denial plus its REPEATS, both derived from the flat-damage rate', () => {
    // first  = amount x flatPowerPerPoint / conditionalBonusDen
    // repeat = amount x turns x flatPowerPerPoint / (BASELINE_COOLDOWN + 1)
    expect(PRICE.cursePerAmountNum / PRICE.cursePerAmountDen).toBe(PRICE.flatPowerPerPoint / PRICE.conditionalBonusDen);
    expect(PRICE.cursePerAmountTurnNum).toBe(PRICE.flatPowerPerPoint);
    expect(PRICE.cursePerAmountTurnDen).toBe(4); // BASELINE_COOLDOWN + 1
    for (const [amount, turns, deci] of [[8, 2, 40], [4, 2, 20], [8, 3, 50], [20, 2, 100]] as const) {
      expect(powerLevelDeci(card('x', { effects: [{ kind: 'curse', amount, turns }] })), `${amount}/${turns}`).toBe(deci);
    }
  });

  it('both keywords count against the CONTROL cap, and the SPREAD counts too', () => {
    expect(EFFECT_CAPS_DECI.control[1]).toBe(100);
    // 41 * 5/2 = 102 deci > the size-1 control ceiling (100); 40 is legal.
    expect(capViolations(card('x', { effects: [{ kind: 'burden', weight: 41 }] })).join(' ')).toContain('control');
    expect(capViolations(card('x', { effects: [{ kind: 'burden', weight: 40 }] }))).toEqual([]);
    // With the spreader the same card only affords HALF the weight — the
    // multiplier grows the cap-family spend in lockstep with the budget spend,
    // so reach cannot be bought past the lockdown ceiling.
    expect(capViolations(card('x', { effects: [{ kind: 'burden', weight: 22 }, { kind: 'splash' }] })).join(' ')).toContain('control');
    expect(capViolations(card('x', { effects: [{ kind: 'burden', weight: 20 }, { kind: 'splash' }] }))).toEqual([]);
    // Same for curse: 20 x 2 turns = 100 = the whole ceiling; spread, it halves.
    expect(capViolations(card('x', { effects: [{ kind: 'curse', amount: 20, turns: 2 }] }))).toEqual([]);
    expect(capViolations(card('x', { effects: [{ kind: 'curse', amount: 20, turns: 2 }, { kind: 'splash' }] })).join(' ')).toContain('control');
  });

  it('the breakdown reports a spread line as ONE whole-PL part, not a half plus a half', () => {
    const parts = powerLevelBreakdown(skillBook.shockwave_slam!);
    expect(parts.map((p) => p.label)).toContain('burden + splash');
    expect(parts.find((p) => p.label === 'burden + splash')!.deci).toBe(30);
    // The invariant that matters (also pinned globally in balance.test.ts).
    expect(parts.reduce((sum, p) => sum + p.deci, 0)).toBe(powerLevelDeci(skillBook.shockwave_slam!));
  });

  it('EVERY SHIPPED CARD OF THE FAMILY still lands EXACTLY on its tier budget', () => {
    for (const id of ['shockwave_slam', 'arc_cascade', 'line_breaker', 'dulling_hex', 'sapping_arc']) {
      const skill = skillBook[id]!;
      expect(skill.tier, id).toBe('bronze');
      expect(powerLevelDeci(skill), id).toBe(100);
      expect(capViolations(skill), id).toEqual([]);
    }
  });
});

describe('the pairing rule: a spreader needs something to spread', () => {
  const doc = (def: Record<string, unknown>) => ({
    schemaVersion: 1,
    cards: [{
      id: 'spread_probe',
      versions: [{
        version: 1,
        def: {
          name: 'Spread Probe', text: 'Deal 10 damage.',
          archetypes: ['offense'], property: 'physical', weapon: 'axe',
          size: 1, rarity: 'common', tier: 'bronze',
          ...def,
        },
      }],
    }],
  });
  const problemsOf = (def: Record<string, unknown>): string =>
    validateSkillDocument(doc(def)).map((p) => p.message).join('\n');

  it('REJECTS a splash with no card-targeting effect on the card', () => {
    expect(problemsOf({ effects: [{ kind: 'damage', power: 10 }, { kind: 'splash' }] }))
      .toContain('a splash action needs something to spread');
  });

  it('ACCEPTS it paired with either payload', () => {
    expect(problemsOf({
      text: 'Deal 10 damage · burden +6 weight · splash.',
      effects: [{ kind: 'damage', power: 10 }, { kind: 'burden', weight: 6 }, { kind: 'splash' }],
    })).toBe('');
    expect(problemsOf({
      text: 'Deal 10 damage · curse 4 for 2 turns · splash.',
      effects: [{ kind: 'damage', power: 10 }, { kind: 'curse', amount: 4, turns: 2 }, { kind: 'splash' }],
    })).toBe('');
  });

  it('checks EVERY TIER: a tier that drops the payload and keeps the spreader is caught', () => {
    expect(problemsOf({
      text: 'Deal 10 damage · burden +6 weight · splash.',
      effects: [{ kind: 'damage', power: 10 }, { kind: 'burden', weight: 6 }, { kind: 'splash' }],
      tierUpgrades: { silver: { text: 'Deal 14 damage · splash.', effects: [{ kind: 'damage', power: 14 }, { kind: 'splash' }] } },
    })).toContain('a splash action needs something to spread');
  });

  it('THE SPREADER CARRIES NO PAYLOAD: the pre-split `splash weight N` shape is now a loud failure', () => {
    expect(problemsOf({ effects: [{ kind: 'damage', power: 10 }, { kind: 'splash', weight: 6 }] }))
      .toContain('unknown field weight on a splash action');
  });

  it('a 0-amount or 0-turn curse is refused at authoring (the engine drops it)', () => {
    expect(problemsOf({ effects: [{ kind: 'damage', power: 10 }, { kind: 'curse', amount: 0, turns: 2 }] }))
      .toContain('amount must be an integer 1..999');
    expect(problemsOf({ effects: [{ kind: 'damage', power: 10 }, { kind: 'curse', amount: 4, turns: 0 }] }))
      .toContain('turns must be an integer 1..99 turns');
  });

  it('scope: all + splash is REJECTED — but an AoE card may still carry a bare payload', () => {
    expect(problemsOf({
      scope: 'all',
      text: 'Deal 10 damage · burden +6 weight · splash.',
      effects: [{ kind: 'damage', power: 10 }, { kind: 'burden', weight: 6 }, { kind: 'splash' }],
    })).toContain('scope: all cannot be combined with a splash action');
    // One taxed card per foe is `slow`'s own linear reach, priced by the AoE
    // multiplier; it is band x foes that the rule refuses.
    expect(problemsOf({
      scope: 'all',
      text: 'Deal 10 damage · burden +6 weight.',
      effects: [{ kind: 'damage', power: 10 }, { kind: 'burden', weight: 6 }],
    })).toBe('');
  });

  it('the AoE rule is checked at every tier, in both inheritance directions', () => {
    // A tier that adds `scope: all` inherits the base effects (and their splash)…
    expect(problemsOf({
      text: 'Deal 10 damage · burden +6 weight · splash.',
      effects: [{ kind: 'damage', power: 10 }, { kind: 'burden', weight: 6 }, { kind: 'splash' }],
      tierUpgrades: { silver: { scope: 'all' }, gold: { scope: 'all' }, diamond: { scope: 'all' } },
    })).toContain('scope: all cannot be combined with a splash action');
    // …and a tier that adds a splash inherits the base `scope: all`.
    expect(problemsOf({
      scope: 'all',
      effects: [{ kind: 'damage', power: 10 }],
      tierUpgrades: {
        silver: {
          text: 'Deal 12 damage · burden +6 weight · splash.',
          effects: [{ kind: 'damage', power: 12 }, { kind: 'burden', weight: 6 }, { kind: 'splash' }],
        },
      },
    })).toContain('scope: all cannot be combined with a splash action');
  });
});

/**
 * SPLASH ON A GEM — the grant the keyword was built for, and the three gates
 * that keep it honest (user ruling, 2026-08-18: "splash is supposed to be on a
 * gem that allows giving other cards this effect in the first place").
 *
 * The gem is the point: `shockwave_slam` shows the pairing off, the gem is how
 * any card gets it. Because a gem is spliced onto its host AFTER authoring,
 * `validateSkillContent` cannot see it — so the rules that protect the
 * spreader's identity live at the resolver seam (`spliceGemActions`,
 * src/engine/cards.ts) and are pinned here:
 *   (a) a host that already hits MORE THAN ONE target drops the gem's SPREADER —
 *       otherwise the fan-out spreads across every living foe's whole board at a
 *       single-target price;
 *   (b) a host that ALREADY SPLASHES drops it too (at most one spreader per
 *       effective card, so a replay never shows a keyword that changed nothing);
 *   (c) NOTHING TO SPREAD — neither host nor gem supplies a payload.
 */

/** A gem carrying the shipped shape: a burden and the spreader that widens it. */
const spreadGem = (weight: number, id = 'test_spread_gem'): Gem =>
  ({ kind: 'effect', id, rarity: 'common', actions: [{ kind: 'burden', weight }, { kind: 'splash' }] });
/** A gem carrying ONLY the spreader — nothing of its own to spread. */
const bareSplashGem = (id = 'test_bare_splash'): Gem =>
  ({ kind: 'effect', id, rarity: 'common', actions: [{ kind: 'splash' }] });

describe('splash gems: the catalog', () => {
  it('ships a Common and a Rare rung that land EXACTLY on their rarity bands — unmoved by the split', () => {
    // burden N x2 (the spread) is 5 deci per weight, the same number the retired
    // `splash weight N` priced at:
    //   weight 4 -> 20 deci = Common (20)   ·   weight 8 -> 40 deci = Rare (40)
    // (weight 3 -> 14 and weight 7 -> 34 are no band at all, which is what
    // makes each shipped magnitude MINIMAL for its band.)
    const tremor = gemBook.tremor_sliver!;
    const fracture = gemBook.fracture_sliver!;
    expect(tremor.kind).toBe('effect');
    expect(fracture.kind).toBe('effect');
    expect(gemPowerLevelDeci(tremor)).toBe(RARITY_PL_DECI.common);
    expect(gemPowerLevelDeci(fracture)).toBe(RARITY_PL_DECI.rare);
    expect(isGemOnBudget(tremor) && isGemOnBudget(fracture)).toBe(true);
    expect(gemPowerLevelDeci(spreadGem(4))).toBe(20);
    expect(gemPowerLevelDeci(spreadGem(8))).toBe(40);
    // Both shipped rungs are TWO-ACTION gems now: the payload and its spreader.
    for (const gem of [tremor, fracture]) {
      if (gem.kind !== 'effect') continue;
      expect(gem.actions.map((a) => a.kind)).toEqual(['burden', 'splash']);
    }
  });

  it('GRANTS the spread band to a host that has neither — the whole point of the gem', () => {
    // sword_slash carries no card-targeting effect at all. Socketed, the hero's
    // cast taxes the foe's whole band; un-socketed the same board emits nothing.
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

    expect(run().events.some((e) => e.kind === 'burdened')).toBe(false);

    const burdened = run(gemBook.tremor_sliver!).events
      .filter((e): e is Extract<Ev, { kind: 'burdened' }> => e.kind === 'burdened');
    expect(burdened.length).toBeGreaterThan(0);
    expect(burdened[0]).toMatchObject({ side: 'enemy', weight: 4, anchorSlot: 0, slots: [0, 1] });
  });

  it('a gem SPLASH spreads the HOST’s own burden — the spreader is cast-scoped, so splice order cannot break it', () => {
    // `burdenHost` carries a burden and no spreader; the gem carries only the
    // spreader. Gem actions splice AFTER the host's, so a positional reading of
    // the keyword would spread nothing here.
    const eff = resolveEffectiveSkill(BOOK.burdenHost!, { skillId: 'burdenHost', slot: 0, gem: bareSplashGem() });
    expect(eff.effects.map((a) => a.kind)).toEqual(['damage', 'burden', 'splash']);
    const state = boardState(row(['jab', 'jab2', 'jab3']), 1);
    const events = castOn(state, eff);
    expect(events.find((e) => e.kind === 'burdened')).toMatchObject({ slots: [0, 1, 2], weight: 6 });
  });
});

describe('splash gems: GATE (a) — a host that hits more than one target', () => {
  it('drops the gem SPREADER on an AoE host, at the RESOLVER — while its payload still lands', () => {
    const aoe = BOOK.aoeJab!;
    expect(isMultiTargetSkill(aoe)).toBe(true);
    const gem = spreadGem(8);
    const eff = resolveEffectiveSkill(aoe, { skillId: 'aoeJab', slot: 0, gem });
    // The BURDEN survives (one taxed card per foe is `slow`'s linear reach); the
    // SPREADER — which would make it band x foes — does not.
    expect(eff.effects.map((a) => a.kind)).toEqual(['damage', 'burden']);
    expect(splashSuppressionOn(aoe, gem.kind === 'effect' ? gem.actions : [])).toBe('multiTarget');
  });

  it('applies to ONE piece per foe at runtime, never a band', () => {
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
    // Three foes, so a spread would be loudly visible (2-3 slots per foe).
    config.enemyTeam = [
      tc('foe1', ['jab', 'jab2', 'jab3'], { speed: 10, attack: 1, maxHp: 500 }, { skillBook: BOOK }),
      tc('foe2', ['jab', 'jab2', 'jab3'], { speed: 10, attack: 1, maxHp: 500 }, { skillBook: BOOK }),
      tc('foe3', ['jab', 'jab2', 'jab3'], { speed: 10, attack: 1, maxHp: 500 }, { skillBook: BOOK }),
    ];
    const { events } = simulate(config, 1);
    expect(events.some((e) => e.kind === 'damage' && e.side === 'enemy')).toBe(true); // the host still fires
    const burdened = events.filter((e): e is Extract<Ev, { kind: 'burdened' }> => e.kind === 'burdened');
    expect(burdened.length).toBeGreaterThan(0);
    // EVERY application is a single slot: the spreader was dropped.
    expect(burdened.every((e) => e.slots.length === 1)).toBe(true);
  });

  it('drops ONLY the spreader — every other action the gem carries still lands', () => {
    const mixed: Gem = {
      kind: 'effect', id: 'mixed', rarity: 'rare',
      actions: [{ kind: 'splash' }, { kind: 'poison', stacks: 3 }, { kind: 'burden', weight: 8 }],
    };
    const eff = resolveEffectiveSkill(BOOK.aoeJab!, { skillId: 'aoeJab', slot: 0, gem: mixed });
    expect(eff.effects.map((a) => a.kind)).toEqual(['damage', 'poison', 'burden']);
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

  it('AT MOST ONE SPREADER on the effective card, whatever the gem brings', () => {
    for (const gem of [gemBook.tremor_sliver!, gemBook.fracture_sliver!, spreadGem(16), bareSplashGem()]) {
      const eff = resolveEffectiveSkill(showcase, { skillId: 'shockwave_slam', slot: 0, gem });
      expect(eff.effects.filter((a) => a.kind === 'splash')).toHaveLength(1);
      // ...and the one that survived is the HOST's (provenance, not position).
      expect(eff.effects.find((a) => a.kind === 'splash')).not.toHaveProperty('fromGem');
    }
    expect(splashSuppressionOn(showcase)).toBe('hostAlreadySplashes');
  });

  it('a WEAKER gem burden changes NO STATE (Math.max) — the band still owes the host\u2019s 6', () => {
    // tremor_sliver's burden is 4 against the host's authored 6, so the socket
    // cannot raise the tax. It DOES add a second application, and therefore a
    // second `burdened` event — exactly what a `slow 4` gem on a `slow 6` card
    // has always done. The log is honest about two applications; the STATE is
    // what must be unchanged, and it is.
    const bare = simulate(shockwaveFight(), 7);
    const gemmed = simulate(shockwaveFight(gemBook.tremor_sliver!), 7);
    const weightsOf = (r: typeof bare): number[] => r.events
      .filter((e): e is Extract<Ev, { kind: 'burdened' }> => e.kind === 'burdened')
      .map((e) => e.weight);
    expect(weightsOf(bare).every((w) => w === 6)).toBe(true);
    // The gem's weaker application is visible in the log...
    expect(weightsOf(gemmed)).toContain(4);
    // ...and changes nothing: every taxed piece still owes 6, and the fight ends
    // the same way, on the same turn, with the same HP.
    expect(gemmed.result).toBe(bare.result);
    expect(gemmed.turns).toBe(bare.turns);
    // Same final HP on both sides. (The resolved SKILL differs — it carries the
    // gem's appended action, as every socket does — so the comparison is of the
    // fight's outcome, not of the card definition.)
    expect(gemmed.finalState.enemy.stats.hp).toBe(bare.finalState.enemy.stats.hp);
    expect(gemmed.finalState.player.stats.hp).toBe(bare.finalState.player.stats.hp);
    expect(gemmed.finalState.enemy.pieces.map((p) => p.nextWeightPenalty))
      .toEqual(bare.finalState.enemy.pieces.map((p) => p.nextWeightPenalty));
    const paid = (r: typeof bare): number[] => r.events
      .filter((e): e is Extract<Ev, { kind: 'play' }> => e.kind === 'play' && e.side === 'enemy')
      .map((e) => e.weight);
    expect(paid(gemmed)).toEqual(paid(bare));
  });

  it('a STRONGER gem burden DOES raise the tax — the payload is an ordinary action, only the spreader is gated', () => {
    // The one honest behaviour change of the split, and it is the same rule a
    // `slow 8` gem on a `slow 4` card has always had: two non-stacking taxes on
    // one victim resolve by `Math.max`. The gem does not rewrite the host's
    // authored action — it adds its own, which happens to win.
    const bare = simulate(shockwaveFight(), 7);
    const gemmed = simulate(shockwaveFight(gemBook.fracture_sliver!), 7);
    const weights = gemmed.events
      .filter((e): e is Extract<Ev, { kind: 'burdened' }> => e.kind === 'burdened')
      .map((e) => e.weight);
    // The host's own 6 lands, then the gem's 8 maxes over it on the same band.
    expect(weights).toContain(6);
    expect(weights).toContain(8);
    // And the victim really pays the higher number: some play costs 8 more than
    // the same play did on the bare card.
    const maxPaid = (r: typeof bare): number => Math.max(...r.events
      .filter((e): e is Extract<Ev, { kind: 'play' }> => e.kind === 'play' && e.side === 'enemy')
      .map((e) => e.weight));
    expect(maxPaid(gemmed)).toBeGreaterThan(maxPaid(bare));
  });
});

describe('splash gems: GATE (c) — nothing to spread', () => {
  it('drops a BARE splash gem on a host with no card-targeting effect', () => {
    const host = BOOK.splashless!;
    const gem = bareSplashGem();
    expect(splashSuppressionOn(host, gem.kind === 'effect' ? gem.actions : [])).toBe('nothingToSpread');
    const eff = resolveEffectiveSkill(host, { skillId: 'splashless', slot: 0, gem });
    expect(eff.effects.map((a) => a.kind)).toEqual(['damage']);
  });

  it('does NOT drop it when the GEM supplies the payload — the shipped rungs are exactly that shape', () => {
    const host = BOOK.splashless!;
    const gem = spreadGem(8);
    expect(splashSuppressionOn(host, gem.kind === 'effect' ? gem.actions : [])).toBeNull();
    const eff = resolveEffectiveSkill(host, { skillId: 'splashless', slot: 0, gem });
    expect(eff.effects.map((a) => a.kind)).toEqual(['damage', 'burden', 'splash']);
    expect(eff.effects[2]).toMatchObject({ kind: 'splash', fromGem: true });
  });

  it('does NOT drop it when the HOST supplies the payload', () => {
    const host = BOOK.burdenHost!;
    const gem = bareSplashGem();
    expect(splashSuppressionOn(host, gem.kind === 'effect' ? gem.actions : [])).toBeNull();
    expect(resolveEffectiveSkill(host, { skillId: 'burdenHost', slot: 0, gem }).effects.map((a) => a.kind))
      .toEqual(['damage', 'burden', 'splash']);
  });

  it('a CURSE payload counts too — the gate asks the keyword FACET, not a hard-coded list', () => {
    const curseHost = card('curseHost', { effects: [{ kind: 'damage', power: 0 }, { kind: 'curse', amount: 4, turns: 2 }] });
    const gem = bareSplashGem();
    expect(splashSuppressionOn(curseHost, gem.kind === 'effect' ? gem.actions : [])).toBeNull();
  });

  it('asked of a HOST ALONE it answers the narrower question, which is what a bare splash gem needs', () => {
    // The default empty `gemActions` means "would this host alone give a
    // spreader anything to spread" — `null` only when the host itself supplies a
    // payload. That is the correct question for a socket UI holding a bare
    // splash gem, and the reason the parameter is explicit.
    expect(splashSuppressionOn(BOOK.splashless!)).toBe('nothingToSpread');
    expect(splashSuppressionOn(BOOK.burdenHost!)).toBeNull();
  });

  it('a gem carrying TWO splashes keeps exactly ONE (one spread per cast)', () => {
    const doubled: Gem = {
      kind: 'effect', id: 'doubled', rarity: 'rare',
      actions: [{ kind: 'burden', weight: 8 }, { kind: 'splash' }, { kind: 'splash' }],
    };
    const eff = resolveEffectiveSkill(BOOK.splashless!, { skillId: 'splashless', slot: 0, gem: doubled });
    expect(eff.effects.filter((a) => a.kind === 'splash')).toHaveLength(1);
  });
});

describe('splash gates: the multi-target CONCEPT, not a scope literal', () => {
  it('the gate and the fan-out ask the SAME question (`isMultiTargetSkill`)', () => {
    // If a future mechanism makes a card multi-target without `scope: 'all'`,
    // this pairing is what forces both sides to move together: the fan-out
    // reaches every living foe exactly when the gate suppresses the spreader.
    const foes = ['a', 'b', 'c'].map((n) => tc('foe' + n, ['jab'], { speed: 1, maxHp: 500 }, { skillBook: BOOK }));
    const payload: Action[] = [{ kind: 'burden', weight: 4 }, { kind: 'splash' }];
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
      expect(splashSuppressionOn(skill, payload) === 'multiTarget').toBe(isMultiTargetSkill(skill));
    }
  });
});

/**
 * INSTANCE PL, HOST-AWARE (balance-designer pass, 2026-08-19 — closes a
 * flagged loose end from the splash-gem pass). `instancePowerLevelDeci` is
 * the ONE gem-PL surface that knows the host; a gem action THE SPLASH GATE
 * drops must contribute ZERO instance PL there, and — under the spreader model —
 * dropping the spreader must also drop the COVERAGE MULTIPLIER it would have put
 * on the gem's own payload.
 *
 * It also re-derives the gate itself (`hostSuppressesSplash`, balance.ts, which
 * cannot import cards.ts without closing a layering cycle), so these cases are
 * the regression pin that the two copies agree.
 */
describe('instancePowerLevelDeci: a gem spreader SUPPRESSED by the gate prices at ZERO', () => {
  it('GATE (a) multiTarget — the spread premium is gone, the payload still prices', () => {
    const aoe = BOOK.aoeJab!;
    const gem = spreadGem(8);
    const base = powerLevelDeci(aoe);
    // burden 8 alone = 20 deci (what it still delivers there), NOT the 40 the
    // host-blind gem is worth with its own spreader.
    expect(instancePowerLevelDeci(aoe, { gem })).toBe(base + 20);
    expect(instancePowerLevelDeci(aoe, { gem })).not.toBe(base + gemPowerLevelDeci(gem, aoe));
  });

  it('GATE (b) hostAlreadySplashes — same: the gem is priced for the anchor it still taxes', () => {
    const host = skillBook.shockwave_slam!;
    const gem = spreadGem(16);
    expect(instancePowerLevelDeci(host, { gem })).toBe(powerLevelDeci(host) + 40); // burden 16 alone
    expect(instancePowerLevelDeci(host, { gem })).not.toBe(powerLevelDeci(host) + gemPowerLevelDeci(gem, host));
  });

  it('GATE (c) nothingToSpread — a BARE splash gem contributes exactly nothing', () => {
    const host = BOOK.splashless!;
    const gem = bareSplashGem();
    expect(instancePowerLevelDeci(host, { gem })).toBe(powerLevelDeci(host));
  });

  it('suppression zeroes ONLY the spreader — every other action on the same gem still prices', () => {
    const mixed: Gem = {
      kind: 'effect', id: 'mixed', rarity: 'rare',
      actions: [{ kind: 'splash' }, { kind: 'poison', stacks: 3 }],
    };
    const aoe = BOOK.aoeJab!;
    // poison 3 stacks * dotPerStack(10) = 30 deci; the spreader contributes 0.
    expect(instancePowerLevelDeci(aoe, { gem: mixed })).toBe(powerLevelDeci(aoe) + 30);
  });

  it('an UNSUPPRESSED host still gets the gem’s full spread price (the fix is host-aware, not a blanket zero)', () => {
    const host = BOOK.splashless!;
    const gem = spreadGem(8);
    expect(instancePowerLevelDeci(host, { gem })).toBe(powerLevelDeci(host) + gemPowerLevelDeci(gem, host));
    expect(instancePowerLevelDeci(host, { gem })).toBe(powerLevelDeci(host) + 40); // 20 x 2
  });
});
