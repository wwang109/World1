import { describe, expect, it } from 'vitest';
import { simulate } from '../../src/engine/combat/simulate';
import { initCombatState, type CombatState, type CombatantState } from '../../src/engine/combat/state';
import { splashAnchor, splashBand } from '../../src/engine/combat/splash';
import { scanCast } from '../../src/engine/combat/castSelect';
import { applyCast } from '../../src/engine/combat/interpreter';
import { NO_MODS } from '../../src/engine/combat/auras';
import { Rng } from '../../src/engine/rng';
import { EFFECT_CAPS_DECI, PRICE, powerLevelDeci, capViolations } from '../../src/engine/balance';
import { validateSkillDocument } from '../../src/data/validateSkillContent';
import { skillBook } from '../../src/data/skills';
import type { BoardPiece, CombatConfig, SkillBook, SkillDef } from '../../src/engine/types';
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
  // A size-3 card — ONE piece however many slots it covers.
  wide: card('wide', { size: 3, speedWeight: 30 }),
  // The keyword under test, with no damage line so nothing else moves.
  splash6: card('splash6', { effects: [{ kind: 'splash', weight: 6 }], archetypes: ['debuff'] }),
  splash2: card('splash2', { effects: [{ kind: 'splash', weight: 2 }], archetypes: ['debuff'] }),
  // Fires ONCE per fight (cooldowns enabled) so a consumption test sees the
  // tax spent without the caster immediately re-applying it.
  splashOnce: card('splashOnce', { effects: [{ kind: 'splash', weight: 6 }], archetypes: ['debuff'], cooldownTurns: 99 }),
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

  it('a weaker splash cannot LOWER a standing penalty either', () => {
    const state = splashState(row(['jab', 'jab2', 'jab3']), 1);
    castSplashOn(state, BOOK.splash6!);
    castSplashOn(state, BOOK.splash2!);
    expect(state.enemy.pieces[1]!.nextWeightPenalty).toBe(6);
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
