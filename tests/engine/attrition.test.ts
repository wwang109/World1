import { describe, expect, it } from 'vitest';
import { Rng } from '../../src/engine/rng';
import {
  ATTRITION_START_TURN,
  ATTRITION_STEP,
  attritionDamage,
  simulate,
} from '../../src/engine/combat/simulate';
import { skillBook } from '../../src/data/skills';
import type { BoardPiece, CombatConfig, CombatantSetup, CombatantStats } from '../../src/engine/types';
import type { CombatEvent } from '../../src/engine/combat/events';

/** attrition disabled = the pre-attrition engine. */
const OFF = 1_000_000;
const NO_OTHER_ENDGAME = { suddenDeathRound: 999, fatigueTurn: OFF } as const;

type DamageEvent = Extract<CombatEvent, { kind: 'damage' }>;

function attritionHits(events: CombatEvent[]): DamageEvent[] {
  return events.filter((e): e is DamageEvent => e.kind === 'damage' && e.source === 'attrition');
}

function unit(
  name: string,
  skills: string[],
  stats: Partial<CombatantStats> = {},
): CombatantSetup {
  const base: CombatantStats = {
    maxHp: 100,
    hp: 100,
    attack: 10,
    magicPower: 10,
    armor: 0,
    magicResist: 0,
    speed: 10,
    ...stats,
  };
  if (stats.maxHp !== undefined && stats.hp === undefined) base.hp = stats.maxHp;
  const pieces: BoardPiece[] = [];
  let slot = 0;
  for (const skillId of skills) {
    const def = skillBook[skillId];
    if (!def) throw new Error(`unknown skill ${skillId}`);
    pieces.push({ skillId, slot });
    slot += def.size;
  }
  return { name, stats: base, boardSize: Math.max(10, slot), pieces };
}

describe('attrition: the global stalemate breaker', () => {
  it('ACCELERATING formula: 5 × T × (T+1) / 2, zero before the threshold', () => {
    expect(ATTRITION_START_TURN).toBe(15);
    expect(ATTRITION_STEP).toBe(5);
    expect(attritionDamage(1)).toBe(0);
    expect(attritionDamage(14)).toBe(0);
    // Turns 15..22 — the per-turn INCREASE itself grows (+5, +10, +15, +20…).
    expect([15, 16, 17, 18, 19, 20, 21, 22].map((t) => attritionDamage(t))).toEqual([
      5, 15, 30, 50, 75, 105, 140, 180,
    ]);
    expect(attritionDamage(30)).toBe(680); // T=16 -> 5 × 16 × 17 / 2
    // Always integral, and the increment strictly grows.
    let prevStep = 0;
    for (let turn = 15; turn <= 60; turn += 1) {
      const d = attritionDamage(turn);
      expect(Number.isInteger(d)).toBe(true);
      const step = d - attritionDamage(turn - 1);
      expect(step).toBeGreaterThan(prevStep);
      prevStep = step;
    }
    // The override shifts the whole curve without changing its shape.
    expect(attritionDamage(30, 30)).toBe(5);
    expect(attritionDamage(31, 30)).toBe(15);
  });

  it('pre-threshold logs are BYTE-IDENTICAL to the pre-attrition engine (120 random configs)', () => {
    const ids = Object.keys(skillBook).sort();
    const rng = new Rng(0xa77121);
    const randomUnit = (name: string): CombatantSetup => {
      const pieces: BoardPiece[] = [];
      let slot = 0;
      while (slot < 10) {
        if (rng.pct(65)) {
          const id = ids[rng.int(ids.length)]!;
          const size = skillBook[id]!.size;
          if (slot + size <= 10) {
            pieces.push({ skillId: id, slot });
            slot += size;
            continue;
          }
        }
        slot += 1;
      }
      const maxHp = 40 + rng.int(150);
      return {
        name,
        stats: {
          maxHp,
          hp: maxHp,
          attack: 5 + rng.int(15),
          magicPower: 5 + rng.int(15),
          armor: rng.int(5),
          magicResist: rng.int(5),
          speed: 5 + rng.int(15),
        },
        boardSize: 10,
        pieces,
      };
    };

    let capped = 0;
    for (let i = 0; i < 120; i += 1) {
      const np = 1 + rng.int(3);
      const ne = 1 + rng.int(3);
      const base = {
        playerTeam: Array.from({ length: np }, (_, k) => randomUnit(`p${k}`)),
        enemyTeam: Array.from({ length: ne }, (_, k) => randomUnit(`e${k}`)),
        skillBook,
        // Hard-stop one turn BEFORE the threshold: every one of these fights is
        // entirely inside the untouched region.
        maxTurns: ATTRITION_START_TURN - 1,
      };
      const seed = rng.int(2 ** 31);
      const withAttrition = simulate(structuredClone(base) as CombatConfig, seed);
      const before = simulate({ ...(structuredClone(base) as CombatConfig), attritionTurn: OFF }, seed);
      expect(withAttrition.events).toEqual(before.events);
      expect(withAttrition.finalState).toEqual(before.finalState);
      expect(withAttrition.result).toBe(before.result);
      expect(attritionHits(withAttrition.events)).toHaveLength(0);
      expect(withAttrition.events.some((e) => e.kind === 'attritionStart')).toBe(false);
      if (withAttrition.turns === ATTRITION_START_TURN - 1) capped += 1;
    }
    // Sanity: some of those fights really did run all the way to turn 14.
    expect(capped).toBeGreaterThan(0);
  });

  it('full-length fights that end before turn 15 are byte-identical too', () => {
    const rng = new Rng(0x5eed15);
    let checked = 0;
    for (let i = 0; i < 60; i += 1) {
      const cfg: CombatConfig = {
        playerTeam: [unit('hero', ['sword_slash'], { maxHp: 60, attack: 12 + rng.int(8) })],
        enemyTeam: [unit('foe', ['savage_bite'], { maxHp: 50 + rng.int(20), attack: 10 })],
        skillBook,
      };
      const seed = rng.int(2 ** 31);
      const a = simulate(structuredClone(cfg), seed);
      if (a.turns >= ATTRITION_START_TURN) continue;
      const b = simulate({ ...structuredClone(cfg), attritionTurn: OFF }, seed);
      expect(a.events).toEqual(b.events);
      checked += 1;
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('ramps 5 / 15 / 105 at turns 15 / 16 / 20 on EVERY living combatant (2v2)', () => {
    const cfg: CombatConfig = {
      // Empty boards: nothing but attrition can move HP.
      playerTeam: [unit('p0', [], { maxHp: 1000 }), unit('p1', [], { maxHp: 1000 })],
      enemyTeam: [unit('e0', [], { maxHp: 1000 }), unit('e1', [], { maxHp: 1000 })],
      skillBook,
      ...NO_OTHER_ENDGAME,
      maxTurns: 20,
    };
    const { events, finalState, result } = simulate(cfg, 7);

    expect(events.filter((e) => e.kind === 'attritionStart')).toEqual([
      { turn: 15, kind: 'attritionStart', amount: 5 },
    ]);

    for (const [turn, amount] of [
      [15, 5],
      [16, 15],
      [17, 30],
      [20, 105],
    ] as const) {
      const hits = attritionHits(events).filter((e) => e.turn === turn);
      // All four combatants, canonical order: player side first, then by index.
      expect(hits.map((e) => `${e.side}${e.unit}`)).toEqual(['player0', 'player1', 'enemy0', 'enemy1']);
      for (const hit of hits) {
        expect(hit.amount).toBe(amount);
        expect(hit.property).toBe('true');
      }
    }

    // Nothing happens before the threshold.
    expect(attritionHits(events).filter((e) => e.turn < ATTRITION_START_TURN)).toHaveLength(0);
    // Cumulative through turn 20: 5+15+30+50+75+105 = 280 on everyone.
    for (const c of [...finalState.playerTeam, ...finalState.enemyTeam]) {
      expect(c.stats.hp).toBe(1000 - 280);
    }
    // maxTurns cap with 1000 HP left on both sides: decided on remaining HP
    // fraction, exact tie -> player (there is no draw).
    expect(result).toBe('win');
  });

  it('is NOT absorbed by typed shield pools (unblockable, by design)', () => {
    // mana_ward stacks a magical shield every turn; attrition must still bite.
    const cfg: CombatConfig = {
      playerTeam: [unit('hero', ['mana_ward'], { maxHp: 200 })],
      enemyTeam: [unit('foe', [], { maxHp: 200 })],
      skillBook,
      ...NO_OTHER_ENDGAME,
      maxTurns: 16,
    };
    const { events, finalState } = simulate(cfg, 1);
    const shielded = finalState.playerTeam[0]!;
    expect(shielded.shields.magical).toBeGreaterThan(0); // a real pool was standing

    const hits = attritionHits(events).filter((e) => e.side === 'player');
    expect(hits.length).toBe(2); // turns 15 and 16
    for (const hit of hits) expect(hit.blocked).toBe(0);
    expect(hits[0]!.hpAfter).toBe(200 - 5);
    expect(hits[1]!.hpAfter).toBe(200 - 5 - 15);
    expect(shielded.stats.hp).toBe(200 - 20);
  });

  it('breaks a genuine stalemate that used to run to the 200-turn cap', () => {
    // Two mutually-unkillable sustain boards: shield + heal only, no offense.
    const board = ['mana_ward', 'second_wind', 'iron_bulwark'];
    const make = (): CombatConfig => ({
      playerTeam: [unit('turtle', board, { maxHp: 300 })],
      enemyTeam: [unit('rock', board, { maxHp: 300 })],
      skillBook,
      ...NO_OTHER_ENDGAME,
      maxTurns: 200,
    });

    // Without attrition the stalemate is real: nobody EVER dies, and the fight
    // only stops because it slams into the 200-turn cap (now decided on HP
    // fraction rather than returning a draw, which no longer exists).
    const before = simulate({ ...make(), attritionTurn: OFF }, 3);
    expect(before.turns).toBe(200);
    expect(before.events.some((e) => e.kind === 'died')).toBe(false);
    expect(before.result).toBe('win'); // mirrored boards -> exact fraction tie -> player

    const after = simulate(make(), 3);
    expect(after.result === 'win' || after.result === 'loss').toBe(true);
    expect(after.turns).toBeLessThan(200);
    // Ends decisively, and the ACCELERATING ramp ends it fast: turn 21 (it was
    // turn 27 under the old linear ramp).
    expect(after.turns).toBe(21);
    expect(after.events.some((e) => e.kind === 'attritionStart')).toBe(true);
    expect(after.events.some((e) => e.kind === 'died')).toBe(true);
  });

  it('a mirrored duel is decided by the APPLICATION ORDER: the player is hit first, falls first, and the sweep stops', () => {
    // FIRST TO FALL LOSES (user-locked 2026-08-04). Equal score and equal HP used
    // to be a "dead heat" resolved by the player-wins tie convention; there is no
    // heat left to split — the score tie falls back to canonical order (player side
    // first), so the player's unit takes the killing tick and the foe's tick never
    // happens. The mirror-match convention is therefore INVERTED vs 2026-07-31.
    const cfg: CombatConfig = {
      playerTeam: [unit('hero', [], { maxHp: 5 })],
      enemyTeam: [unit('foe', [], { maxHp: 5 })],
      skillBook,
      ...NO_OTHER_ENDGAME,
      maxTurns: 200,
    };
    const { events, result, turns, finalState } = simulate(cfg, 11);
    expect(turns).toBe(15);
    expect(result).toBe('loss');
    // ONE tick, ONE death: the enemy is never reached.
    expect(attritionHits(events).map((e) => `${e.side}${e.unit}`)).toEqual(['player0']);
    const deaths = events.filter((e): e is Extract<CombatEvent, { kind: 'died' }> => e.kind === 'died');
    expect(deaths.map((e) => [e.turn, e.side, e.unit])).toEqual([[15, 'player', 0]]);
    expect(finalState.enemyTeam[0]!.alive).toBe(true);
    expect(finalState.enemyTeam[0]!.stats.hp).toBe(5);
    const end = events[events.length - 1]!;
    expect(end).toEqual({ turn: 15, kind: 'combatEnd', result: 'loss', turns: 15 });
  });

  it('a whole team wiped by attrition ends the fight (multi-unit death path)', () => {
    const cfg: CombatConfig = {
      playerTeam: [unit('hero', [], { maxHp: 500 })],
      enemyTeam: [unit('e0', [], { maxHp: 5 }), unit('e1', [], { maxHp: 5 })],
      skillBook,
      ...NO_OTHER_ENDGAME,
      maxTurns: 200,
    };
    const { result, turns, finalState } = simulate(cfg, 2);
    expect(result).toBe('win');
    expect(turns).toBe(15);
    expect(finalState.enemyTeam.every((u) => !u.alive)).toBe(true);
    expect(finalState.playerTeam[0]!.alive).toBe(true);
  });

  it('credits no card and triggers no rider: no lifesteal, no combo, no expose, no negate', () => {
    const cfg: CombatConfig = {
      // leeching_fang carries lifesteal; ward_of_silence-free board keeps it simple.
      playerTeam: [unit('hero', ['leeching_fang'], { maxHp: 400, attack: 1 })],
      enemyTeam: [unit('foe', ['mending_light'], { maxHp: 400, magicPower: 1 })],
      skillBook,
      ...NO_OTHER_ENDGAME,
      maxTurns: 17,
    };
    const { events } = simulate(cfg, 5);
    const hits = attritionHits(events);
    expect(hits.length).toBeGreaterThan(0);
    for (const hit of hits) {
      expect(hit.sourceCard).toBeUndefined(); // attributable to no card
      expect(hit.calculation).toBeUndefined(); // no cast formula
      expect(hit.guarded).toBeUndefined();
      expect(hit.exposed).toBeUndefined();
      expect(hit.matchup).toBeUndefined();
    }
    // No heal (lifesteal) and no negate consumption occurs in the attrition step:
    // the events between attritionStart and the following `end` are damage/died only.
    const start = events.findIndex((e) => e.kind === 'attritionStart');
    expect(start).toBeGreaterThan(-1);
    const endIdx = events.findIndex((e, i) => i > start && e.kind === 'end');
    for (const e of events.slice(start, endIdx)) {
      expect(['attritionStart', 'damage', 'died']).toContain(e.kind);
      if (e.kind === 'damage') expect(e.source).toBe('attrition');
    }
  });

  it('consumes no RNG: identical logs for every seed', () => {
    const logs = new Set<string>();
    for (let seed = 0; seed < 12; seed += 1) {
      const cfg: CombatConfig = {
        playerTeam: [unit('hero', ['mana_ward'], { maxHp: 300 })],
        enemyTeam: [unit('foe', ['iron_bulwark'], { maxHp: 300 })],
        skillBook,
        ...NO_OTHER_ENDGAME,
        maxTurns: 200,
      };
      logs.add(JSON.stringify(simulate(cfg, seed).events));
    }
    expect(logs.size).toBe(1);
  });
});
