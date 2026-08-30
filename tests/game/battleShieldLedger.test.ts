import { describe, expect, it } from 'vitest';
import {
  buildBattleTimeline, poolsSum, shieldPointsDrained,
  type BattleTimeline, type BattleTimelineInput,
} from '../../src/game/battleTimeline';
import { battleRequestOf } from '../../src/game/battleApi';
import { resolveBattle } from '../../src/run/resolveBattle';
import type { CombatEvent } from '../../src/engine/combat/events';
import { enemies } from '../../src/data/enemies';

/**
 * THE SHIELD BAR AND THE COMBAT LOG MUST AGREE.
 *
 * The battle scenes' shield bar shows PLATING POINTS. A `damage` event reports
 * `blocked` (the DAMAGE those points stopped) and `shieldDrain` (the points that
 * actually left each pool). Those are the same number only when every pool that
 * paid traded 1:1 — and two shipped rules break that:
 *
 *   - an ATTUNED pool (`attunedShield`) eats 2 damage per point of its own type;
 *   - typed damage spilling into a TRUE pool burns 2 points per point blocked.
 *
 * `buildBattleTimeline` subtracted `blocked`, so the moment attuned plating
 * reached shipped content the bar started disagreeing with `npm run fight`, which
 * has always subtracted the drain (see the `wall` tracker in `scripts/fight.ts`).
 *
 * These tests are driven off REAL SERVED LOGS, not hand-built fixtures, and the
 * oracle is the engine's own arithmetic rather than a second copy of the rules:
 * every `shieldGain`/`shieldBroken` states `totalAfter`, so the TRUE total the
 * instant before it is `totalAfter -/+ amount`. A tracker that is right is already
 * sitting on that number when the event arrives. Re-read `blocked` here and the
 * reconciliation below goes red on real content.
 */

/** `scripts/fight.ts`'s DEFAULT_HERO_PIECES — the drafted-starter shape, so the
 * fights below are the ones `npm run fight` prints. */
const PLAIN_BOARD = [
  { instanceId: 'h0', skillId: 'war_banner', tier: 'bronze' as const, slot: 0 },
  { instanceId: 'h1', skillId: 'sword_slash', tier: 'bronze' as const, slot: 1 },
  { instanceId: 'h2', skillId: 'crushing_blow', tier: 'bronze' as const, slot: 2 },
  { instanceId: 'h3', skillId: 'iron_bulwark', tier: 'bronze' as const, slot: 5 },
  { instanceId: 'h4', skillId: 'second_wind', tier: 'bronze' as const, slot: 7 },
];
/** Same board with the plain bulwark swapped for ATTUNED plating, so the hero
 * side of the ledger is exercised too (`oathplate` grants an attuned pool). */
const ATTUNED_BOARD = [
  PLAIN_BOARD[0]!, PLAIN_BOARD[1]!, PLAIN_BOARD[2]!,
  { instanceId: 'h3', skillId: 'oathplate', tier: 'bronze' as const, slot: 5 },
  PLAIN_BOARD[4]!,
];

function inputFor(pieces: typeof PLAIN_BOARD, enemyId: string, seed: number): BattleTimelineInput {
  return {
    pieces, heroLevel: 1, heroAllocation: {},
    enemyId, enemyLevel: 1, enemyTitle: 'normal', enemyRank: 0, enemyModifiers: [], seed,
  };
}
function timeline(input: BattleTimelineInput): BattleTimeline {
  return buildBattleTimeline(input, resolveBattle(battleRequestOf(input)));
}

type DamageEvent = Extract<CombatEvent, { kind: 'damage' }>;
const wallKey = (side: string, unit: number): string => `${side}:${unit}`;

/**
 * THE ORACLE. Replays a served log's wall with a caller-supplied spend rule and
 * reports the ENGINE-STATED total per side/unit at the end of every turn.
 *
 * The engine states the wall outright at each `shieldGain`/`shieldBroken`
 * (`totalAfter`), so this needs no copy of the combat rules — only the spend
 * rule under test, which is the one thing the log does not restate.
 * `wrongVsEngine` counts the events where the replay was NOT already sitting on
 * the total the engine implies for the instant before them (`totalAfter -/+
 * amount`) — zero for a correct rule, non-zero for a wrong one.
 */
function replayWall(events: readonly CombatEvent[], spend: (e: DamageEvent) => number): {
  atEndOfTurn: Map<number, Map<string, number>>;
  wrongVsEngine: number;
  checks: number;
} {
  const wall = new Map<string, number>();
  const atEndOfTurn = new Map<number, Map<string, number>>();
  let wrongVsEngine = 0;
  let checks = 0;
  for (const e of events) {
    if (e.kind === 'damage' && e.blocked > 0) {
      const k = wallKey(e.side, e.unit);
      wall.set(k, Math.max(0, (wall.get(k) ?? 0) - spend(e)));
    } else if (e.kind === 'shieldGain' || e.kind === 'shieldBroken') {
      const k = wallKey(e.side, e.unit);
      const truePre = e.kind === 'shieldGain' ? e.totalAfter - e.amount : e.totalAfter + e.amount;
      checks += 1;
      if ((wall.get(k) ?? 0) !== truePre) wrongVsEngine += 1;
      wall.set(k, e.totalAfter);
    } else continue;
    atEndOfTurn.set(e.turn, new Map(wall));
  }
  return { atEndOfTurn, wrongVsEngine, checks };
}

/** The timeline's own wall at the END of `turn` — the last step it recorded for
 * that turn, which is what the scene is showing when the turn closes. */
function timelineWallAtEndOfTurn(model: BattleTimeline, turn: number): Map<string, number> | undefined {
  let idx = -1;
  for (let i = 0; i < model.steps.length; i += 1) if (model.steps[i]!.turn === turn) idx = i;
  if (idx < 0) return undefined;
  const snap = model.shieldByStep[idx]!;
  const out = new Map<string, number>([[wallKey('player', 0), snap.player]]);
  const enemies = snap.enemies ?? [snap.enemy];
  for (let u = 0; u < enemies.length; u += 1) out.set(wallKey('enemy', u), enemies[u]!);
  return out;
}

const ROSTER = Object.keys(enemies);
const SEEDS = [1, 2, 3, 4, 5];

describe('game/battleTimeline — the shield ledger', () => {
  it('shieldPointsDrained reports POINTS, and a real fight has hits where that is not `blocked`', () => {
    const log = resolveBattle(battleRequestOf(inputFor(PLAIN_BOARD, 'sworn_colossus', 3)));
    const uneven = log.events.filter(
      (e): e is Extract<CombatEvent, { kind: 'damage' }> => e.kind === 'damage' && e.blocked > 0 && shieldPointsDrained(e) !== e.blocked,
    );
    // The fixture itself must contain the case, or the assertion below is vacuous.
    expect(uneven.length).toBeGreaterThan(0);
    for (const e of uneven) {
      const d = e.shieldDrain!;
      expect(shieldPointsDrained(e)).toBe(d.physical + d.magical + d.true);
      expect(shieldPointsDrained(e)).not.toBe(e.blocked);
    }
    // `npm run fight -- sworn_colossus 3`, turn 2:
    //   "takes 30 physical (30 blocked, 21 shield spent; 3 shield left)"
    const turn2 = uneven.find((e) => e.turn === 2)!;
    expect(turn2.blocked).toBe(30);
    expect(shieldPointsDrained(turn2)).toBe(21);
  });

  it('the bar the scenes render matches the engine-stated wall, turn for turn, across the roster', () => {
    let checks = 0;
    let blockedRuleWrong = 0;
    for (const board of [PLAIN_BOARD, ATTUNED_BOARD]) {
      for (const enemyId of ROSTER) {
        for (const seed of SEEDS) {
          const input = inputFor(board, enemyId, seed);
          const log = resolveBattle(battleRequestOf(input));
          const model = buildBattleTimeline(input, log);
          const truth = replayWall(log.events, shieldPointsDrained);
          expect(truth.wrongVsEngine).toBe(0); // the oracle agrees with the engine
          checks += truth.checks;
          // THE SEAM: what the scene draws vs what the engine says is standing.
          for (const [turn, walls] of truth.atEndOfTurn) {
            const shown = timelineWallAtEndOfTurn(model, turn);
            if (!shown) continue;
            for (const [k, points] of walls) expect(shown.get(k)).toBe(points);
          }
          // ...and the pre-fix rule must be demonstrably wrong on this same
          // content, or the assertion above proves nothing.
          blockedRuleWrong += replayWall(log.events, (e) => e.blocked).wrongVsEngine;
        }
      }
    }
    expect(checks).toBeGreaterThan(400);
    expect(blockedRuleWrong).toBeGreaterThan(0);
  });

  it('the P/M/T strip always sums to the number on the bar beside it', () => {
    for (const board of [PLAIN_BOARD, ATTUNED_BOARD]) {
      for (const enemyId of ROSTER) {
        for (const seed of SEEDS) {
          const model = timeline(inputFor(board, enemyId, seed));
          for (const snap of model.shieldByStep) {
            if (snap.playerPools) expect(poolsSum(snap.playerPools)).toBe(snap.player);
            const pools = snap.enemiesPools ?? [];
            const totals = snap.enemies ?? [snap.enemy];
            for (let u = 0; u < pools.length; u += 1) {
              const p = pools[u];
              if (p) expect(poolsSum(p)).toBe(totals[u]);
            }
          }
        }
      }
    }
  });

  it('an attuned block leaves the wall the log says it leaves (sworn_colossus, seed 3)', () => {
    // `npm run fight -- sworn_colossus 3`:
    //   t1  +15 physical shield -> 15 total     (untyped plating)
    //   t1  +9  physical shield -> 24 total     (ATTUNED plating — not in `poolsAfter`)
    //   t2  takes 30 physical (30 blocked, 21 shield spent; 3 shield left)
    const model = timeline(inputFor(PLAIN_BOARD, 'sworn_colossus', 3));
    const at = (turn: number, needle: string): number => {
      for (let i = model.steps.length - 1; i >= 0; i -= 1) {
        const s = model.steps[i]!;
        if (s.turn !== turn) continue;
        if (model.linesByTurn.get(s.turn)![s.lineIndex]!.text.includes(needle)) return i;
      }
      throw new Error(`no step on turn ${turn} matching "${needle}"`);
    };

    // The wall standing after the two oathplate grants: 24 points, all physical
    // — 15 of them untyped and 9 attuned, which `shieldGain.poolsAfter` (untyped
    // only) reports as 15. Seeding the strip from that made it disagree with its
    // own bar by exactly the attuned points.
    const banked = model.shieldByStep[at(1, '+9 P.SHIELD')]!;
    expect(banked.enemy).toBe(24);
    expect(banked.enemiesPools![0]).toEqual({ physical: 24, magical: 0, true: 0 });

    // 30 damage eaten for 21 points. Subtracting `blocked` here emptied the wall
    // outright (24 − 30, clamped to 0) and the next grant's own cap arithmetic
    // (+97 -> 100 total) proves 3 was standing, not 0.
    const blocked = model.shieldByStep[at(2, 'BLOCKED 30')]!;
    expect(blocked.enemy).toBe(3);
    expect(blocked.enemiesPools![0]).toEqual({ physical: 3, magical: 0, true: 0 });

    const refilled = model.shieldByStep[at(4, '+97 P.SHIELD')]!;
    expect(refilled.enemy).toBe(100);
    expect(refilled.enemy).toBe(3 + 97);
  });
});
