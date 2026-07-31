import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { Rng } from '../../src/engine/rng';
import { ATTRITION_START_TURN, simulate } from '../../src/engine/combat/simulate';
import { skillBook } from '../../src/data/skills';
import type { CombatConfig, CombatantSetup, CombatantStats } from '../../src/engine/types';
import type { CombatEvent } from '../../src/engine/combat/events';
import { sweepCases } from './helpers/sweepConfigs';
import baseline from './fixtures/outcomeBaseline.json';

/** attrition disabled = every fight runs on cards alone. */
const OFF = 1_000_000;
const NO_OTHER_ENDGAME = { suddenDeathRound: 999, fatigueTurn: OFF } as const;

function bare(name: string, maxHp: number, speed: number): CombatantSetup {
  const stats: CombatantStats = {
    maxHp,
    hp: maxHp,
    attack: 0,
    magicPower: 0,
    armor: 0,
    magicResist: 0,
    speed,
  };
  // Empty board: attrition is the ONLY thing that can move HP, so every case
  // below is an exact, hand-computable attrition tick.
  return { name, stats, boardSize: 10, pieces: [] };
}

/** 1v1, empty boards, nothing but attrition. */
function attritionDuel(
  player: CombatantSetup,
  enemy: CombatantSetup,
  maxTurns = 200,
): CombatConfig {
  return { playerTeam: [player], enemyTeam: [enemy], skillBook, ...NO_OTHER_ENDGAME, maxTurns };
}

function attritionOrder(events: CombatEvent[], turn: number): string[] {
  return events
    .filter((e) => e.kind === 'damage' && e.source === 'attrition' && e.turn === turn)
    .map((e) => (e.kind === 'damage' ? `${e.side}${e.unit}` : ''));
}

function hash(v: unknown): string {
  return createHash('sha256').update(JSON.stringify(v)).digest('hex').slice(0, 32);
}

describe('attrition hits the LOWEST INITIATIVE SCORE first', () => {
  it('is keyed on the SCORE, not raw Speed: the faster unit with less banked readiness eats it first', () => {
    // Player: Speed 12 but it OWNS a card (iron_bulwark, weight 20) and keeps
    // spending its bank. Foe: Speed 9, empty board, so it banks every point.
    // Higher raw Speed, lower score -> the player is damaged first.
    const heroStats: CombatantStats = { ...bare('hero', 5000, 12).stats };
    const cfg: CombatConfig = {
      playerTeam: [{ name: 'hero', stats: heroStats, boardSize: 10, pieces: [{ skillId: 'iron_bulwark', slot: 0 }] }],
      enemyTeam: [bare('foe', 5000, 9)],
      skillBook,
      ...NO_OTHER_ENDGAME,
      maxTurns: ATTRITION_START_TURN,
    };
    const { events, finalState } = simulate(cfg, 1);
    const hero = finalState.playerTeam[0]!;
    const foe = finalState.enemyTeam[0]!;
    expect(hero.stats.speed).toBeGreaterThan(foe.stats.speed); // faster on paper
    expect(hero.readiness).toBeLessThan(foe.readiness); // but behind on tempo
    expect(attritionOrder(events, ATTRITION_START_TURN)).toEqual(['player0', 'enemy0']);
  });

  it('applies to the lower-score side first when the FOE banks more', () => {
    // Empty boards: nobody spends, so score order == Speed order.
    // hero speed 4 vs foe speed 12 — the hero banks less, so it eats it first.
    const cfg = attritionDuel(bare('hero', 500, 4), bare('foe', 500, 12), ATTRITION_START_TURN);
    const { events } = simulate(cfg, 1);
    expect(attritionOrder(events, ATTRITION_START_TURN)).toEqual(['player0', 'enemy0']);
  });

  it('applies to the lower-score side first when the HERO banks more (order flips)', () => {
    const cfg = attritionDuel(bare('hero', 500, 12), bare('foe', 500, 4), ATTRITION_START_TURN);
    const { events } = simulate(cfg, 1);
    expect(attritionOrder(events, ATTRITION_START_TURN)).toEqual(['enemy0', 'player0']);
  });

  it('interleaves both sides by score in a 2v2, exact ties keeping canonical order', () => {
    const cfg: CombatConfig = {
      // Speeds: p0 9, p1 3, e0 3, e1 20  ->  p1 & e0 tie at 3 (canonical: p1
      // before e0), then p0 at 9, then e1 at 20.
      playerTeam: [bare('p0', 500, 9), bare('p1', 500, 3)],
      enemyTeam: [bare('e0', 500, 3), bare('e1', 500, 20)],
      skillBook,
      ...NO_OTHER_ENDGAME,
      maxTurns: ATTRITION_START_TURN,
    };
    const { events } = simulate(cfg, 1);
    expect(attritionOrder(events, ATTRITION_START_TURN)).toEqual([
      'player1',
      'enemy0',
      'player0',
      'enemy1',
    ]);
  });

  it('an exact score tie falls back to canonical order (player side first)', () => {
    const cfg = attritionDuel(bare('hero', 500, 10), bare('foe', 500, 10), ATTRITION_START_TURN);
    const { events } = simulate(cfg, 1);
    // Equal bank AND equal effective Speed -> stable canonical order.
    expect(attritionOrder(events, ATTRITION_START_TURN)).toEqual(['player0', 'enemy0']);
  });
});

describe('a fight is ALWAYS decided (no draw) — the mutual-wipe hierarchy', () => {
  // Turn-15 attrition deals exactly 5, so any unit at 1..5 HP dies in that tick.
  it('1. lower score loses: player banks 5/turn vs a foe banking 10, both die -> loss', () => {
    const { result, turns } = simulate(attritionDuel(bare('hero', 5, 5), bare('foe', 5, 10)), 1);
    expect(turns).toBe(ATTRITION_START_TURN);
    expect(result).toBe('loss');
  });

  it('1. lower score loses (mirrored): the foe is behind -> win', () => {
    const { result, turns } = simulate(attritionDuel(bare('hero', 5, 10), bare('foe', 5, 5)), 1);
    expect(turns).toBe(ATTRITION_START_TURN);
    expect(result).toBe('win');
  });

  it('the lower-score side loses even when it has MORE hp (score outranks HP)', () => {
    // hero 5 HP / Speed 10, foe 4 HP / Speed 5: the foe is behind AND lower —
    // and the reverse case below proves the score, not HP, is the primary term.
    expect(simulate(attritionDuel(bare('hero', 5, 10), bare('foe', 4, 5)), 1).result).toBe('win');
    // hero 4 HP / Speed 5 vs foe 5 HP / Speed 10 -> hero behind -> loss.
    expect(simulate(attritionDuel(bare('hero', 4, 5), bare('foe', 5, 10)), 1).result).toBe('loss');
    // Score outranks HP: the hero has MORE hp but is behind -> still a loss.
    expect(simulate(attritionDuel(bare('hero', 5, 5), bare('foe', 4, 10)), 1).result).toBe('loss');
  });

  it('2. equal score -> lower HP entering the step loses', () => {
    // 45/48 max HP: turns 15+16 shave 5+15=20, so the units enter the turn-17
    // tick (30 damage) at exactly 25 and 28 HP and both die in it.
    const { result, turns, events } = simulate(attritionDuel(bare('hero', 45, 10), bare('foe', 48, 10)), 1);
    expect(turns).toBe(17);
    const lethal = events.filter(
      (e): e is Extract<CombatEvent, { kind: 'damage' }> =>
        e.kind === 'damage' && e.source === 'attrition' && e.turn === 17,
    );
    expect(lethal.map((e) => e.hpAfter)).toEqual([0, 0]);
    expect(lethal.map((e) => e.amount)).toEqual([30, 30]);
    expect(result).toBe('loss'); // hero entered at 25 vs the foe's 28
    // Mirrored: the foe entered lower -> win.
    expect(simulate(attritionDuel(bare('hero', 48, 10), bare('foe', 45, 10)), 1).result).toBe('win');
  });

  it('3. score AND HP exactly equal -> player wins (the one stated convention)', () => {
    const { result, events } = simulate(attritionDuel(bare('hero', 5, 10), bare('foe', 5, 10)), 1);
    expect(result).toBe('win');
    const end = events[events.length - 1]!;
    expect(end).toEqual({ turn: 15, kind: 'combatEnd', result: 'win', turns: 15 });
  });

  it('single-side wipes are untouched by the hierarchy', () => {
    // Hero survives the tick, foe does not — regardless of score ordering.
    expect(simulate(attritionDuel(bare('hero', 500, 1), bare('foe', 5, 99)), 1).result).toBe('win');
    expect(simulate(attritionDuel(bare('hero', 5, 99), bare('foe', 500, 1)), 1).result).toBe('loss');
  });

  it('the maxTurns safety net decides on remaining HP fraction, never a draw', () => {
    // Nobody can die: attrition off, empty boards. Player at 100/100, foe at
    // 100/400 -> the player holds the higher fraction and wins.
    const cfg: CombatConfig = {
      playerTeam: [bare('hero', 100, 10)],
      enemyTeam: [{ ...bare('foe', 400, 10), stats: { ...bare('foe', 400, 10).stats, hp: 100 } }],
      skillBook,
      ...NO_OTHER_ENDGAME,
      attritionTurn: OFF,
      maxTurns: 3,
    };
    expect(simulate(cfg, 1).result).toBe('win');
    const mirrored: CombatConfig = {
      ...cfg,
      playerTeam: [{ ...bare('hero', 400, 10), stats: { ...bare('hero', 400, 10).stats, hp: 100 } }],
      enemyTeam: [bare('foe', 100, 10)],
    };
    expect(simulate(mirrored, 1).result).toBe('loss');
    // Exact fraction tie -> player.
    expect(
      simulate({ ...cfg, enemyTeam: [bare('foe', 100, 10)] }, 1).result,
    ).toBe('win');
  });
});

describe('no fight ever reaches the turn cap, and decisive fights are unchanged', () => {
  it('a broad random sweep (300 fights, up to 4v4, HP to 300) never reaches maxTurns', () => {
    const cases = sweepCases(0x5117e5, 300, { maxTurns: 200 });
    let maxSeen = 0;
    for (const { config, seed } of cases) {
      const { turns, result, finalState } = simulate(structuredClone(config), seed);
      expect(turns).toBeLessThan(200);
      expect(result === 'win' || result === 'loss').toBe(true);
      // Something actually died — the fight was decided, not timed out.
      const wiped =
        finalState.playerTeam.every((u) => !u.alive) || finalState.enemyTeam.every((u) => !u.alive);
      expect(wiped).toBe(true);
      maxSeen = Math.max(maxSeen, turns);
    }
    // The accelerating ramp bounds every fight far inside the cap.
    expect(maxSeen).toBeLessThan(40);
  });

  it('even a 100k-HP mutual turtle stack ends long before the cap', () => {
    const board = ['mana_ward', 'second_wind', 'iron_bulwark'];
    const turtle = (name: string, speed: number): CombatantSetup => {
      let slot = 0;
      const pieces = board.map((skillId) => {
        const piece = { skillId, slot };
        slot += skillBook[skillId]!.size;
        return piece;
      });
      return {
        name,
        stats: { maxHp: 100_000, hp: 100_000, attack: 0, magicPower: 20, armor: 0, magicResist: 0, speed },
        boardSize: 10,
        pieces,
      };
    };
    const { turns, result } = simulate(
      {
        playerTeam: [turtle('turtle', 10)],
        enemyTeam: [turtle('rock', 10)],
        skillBook,
        ...NO_OTHER_ENDGAME,
        maxTurns: 200,
      },
      3,
    );
    expect(turns).toBeLessThan(100);
    expect(result === 'win' || result === 'loss').toBe(true);
  });

  // GUARDS THE ATTRITION THRESHOLD BOUNDARY — nothing else. The fixture is a
  // captured regression lock (see tests/engine/fixtures/captureOutcomeBaseline.ts),
  // NOT a spec for any individual mechanic: it says "attrition work must not reach
  // fights decided before ATTRITION_START_TURN". A deliberate, reviewed rule change
  // elsewhere in the engine legitimately moves these logs and the fixture is then
  // regenerated (last regeneration: the 2026-07-31 "bleed ticks at most once per
  // global turn" fix, which changed 8/200 sweep logs — every one of them a fight
  // where a bleeding unit multi-cast in a turn — plus 15 whose logs are identical
  // and only carry the new `lastBleedTurn` stamp in finalState).
  it('fights that end BEFORE the attrition threshold are BYTE-IDENTICAL to the captured baseline (attrition-boundary guard; proves nothing about turn-15+ fights, whose tick ORDER intentionally changed)', () => {
    const cases = sweepCases(0xba5e11, 200, { maxTurns: 200 });
    let checked = 0;
    cases.forEach(({ config, seed }, i) => {
      const base = baseline.attritionOn[i]!;
      if (base.turns >= ATTRITION_START_TURN) return; // ramp + tick order changed on purpose
      const r = simulate(structuredClone(config), seed);
      expect(r.result).toBe(base.result);
      expect(r.turns).toBe(base.turns);
      expect(hash({ events: r.events, finalState: r.finalState, result: r.result })).toBe(base.hash);
      checked += 1;
    });
    expect(checked).toBeGreaterThan(150);
  });

  it('with attrition OFF, the outcome-rule refactor changes nothing for any fight decided by a single-side wipe (200 configs)', () => {
    const cases = sweepCases(0xba5e11, 200, { attritionTurn: OFF, maxTurns: 200 });
    let mutual = 0;
    cases.forEach(({ config, seed }, i) => {
      const base = baseline.attritionOff[i]!;
      const r = simulate(structuredClone(config), seed);
      const bothWiped =
        r.finalState.playerTeam.every((u) => !u.alive) &&
        r.finalState.enemyTeam.every((u) => !u.alive);
      if (bothWiped) {
        // A same-step mutual wipe is exactly the case the new hierarchy governs;
        // the log is still identical, only the reported winner may differ.
        mutual += 1;
        expect(r.turns).toBe(base.turns);
        return;
      }
      expect(r.result).toBe(base.result);
      expect(r.turns).toBe(base.turns);
      expect(hash({ events: r.events, finalState: r.finalState, result: r.result })).toBe(base.hash);
    });
    expect(mutual).toBeLessThan(10); // mutual wipes are rare; the rest are byte-identical
  });

  it('no draw survives anywhere: every result in the sweep is win or loss', () => {
    for (const entry of [...baseline.attritionOff, ...baseline.attritionOn]) {
      expect(entry.result === 'win' || entry.result === 'loss').toBe(true);
    }
    const cases = sweepCases(0xd0d0, 40, {});
    for (const { config, seed } of cases) {
      const { events } = simulate(structuredClone(config), seed);
      const end = events[events.length - 1]!;
      expect(end.kind).toBe('combatEnd');
      if (end.kind === 'combatEnd') expect(['win', 'loss']).toContain(end.result);
    }
  });

  it('the lowest-score-first ordering is deterministic across seeds and repeated runs', () => {
    const cfg = (): CombatConfig => ({
      playerTeam: [bare('p0', 400, 7), bare('p1', 400, 11)],
      enemyTeam: [bare('e0', 400, 11), bare('e1', 400, 7)],
      skillBook,
      ...NO_OTHER_ENDGAME,
      maxTurns: 18,
    });
    const logs = new Set<string>();
    for (let seed = 0; seed < 8; seed += 1) logs.add(JSON.stringify(simulate(cfg(), seed).events));
    expect(logs.size).toBe(1);
    const { events } = simulate(cfg(), 0);
    for (const turn of [15, 16, 17, 18]) {
      expect(attritionOrder(events, turn)).toEqual(['player0', 'enemy1', 'player1', 'enemy0']);
    }
  });

  it('sanity: the sweep generator is itself deterministic', () => {
    const rngProbe = new Rng(0xba5e11);
    expect(rngProbe.int(4)).toBe(new Rng(0xba5e11).int(4));
    expect(JSON.stringify(sweepCases(0xba5e11, 5))).toBe(JSON.stringify(sweepCases(0xba5e11, 5)));
  });
});
