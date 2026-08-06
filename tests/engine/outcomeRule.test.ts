import { describe, expect, it } from 'vitest';
import { Rng } from '../../src/engine/rng';
import { ATTRITION_START_TURN, simulate } from '../../src/engine/combat/simulate';
import { skillBook } from '../../src/data/skills';
import type { CombatConfig, CombatantSetup, CombatantStats, SkillBook, SkillDef } from '../../src/engine/types';
import type { CombatEvent } from '../../src/engine/combat/events';
import { sweepCases } from './helpers/sweepConfigs';
// The ONE hash shared with the capture script, so the two can never drift.
import { outcomeHash as hash } from './helpers/outcomeHash';
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

type DamageEvent = Extract<CombatEvent, { kind: 'damage' }>;

/** Every damage application of one source, in log order, as `side/unit/turn`. */
function hitsFrom(events: CombatEvent[], source: DamageEvent['source']): string[] {
  return events
    .filter((e): e is DamageEvent => e.kind === 'damage' && e.source === source)
    .map((e) => `${e.side}${e.unit}@t${e.turn}`);
}

/** One hand-built card, so the ordering tests below are exact and content-proof. */
function card(id: string, effects: SkillDef['effects'], extra: Partial<SkillDef> = {}): SkillDef {
  return {
    id,
    name: id,
    archetypes: ['offense'],
    property: 'physical',
    size: 1,
    speedWeight: 10,
    rarity: 'common',
    tier: 'bronze',
    effects,
    text: '',
    ...extra,
  };
}

/**
 * Purpose-built book for the ORDERING tests: each card does exactly ONE thing
 * and the casters have 0 Attack / 0 Magic Power, so nothing but the named
 * application can move HP.
 */
const ORDER_BOOK: SkillBook = {
  // Heavy (weight 40) so it cannot fire on turn 1 — the foe gets to bleed first.
  finisher: card('finisher', [{ kind: 'damage', power: 100 }], { speedWeight: 40 }),
  gash: card('gash', [{ kind: 'bleed', stacks: 3 }]),
  ember: card('ember', [{ kind: 'burn', stacks: 2 }], { property: 'magical', element: 'fire' }),
  venom: card('venom', [{ kind: 'poison', stacks: 4 }], { cooldownTurns: 5 }),
  // Damage FIRST, lifesteal SECOND — the intra-cast order that "no lifesteal-back"
  // is about: if the damage wipes the foe, the rider never resolves.
  vampiric: card('vampiric', [{ kind: 'damage', power: 100 }, { kind: 'lifesteal', pct: 50 }]),
};

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

/**
 * THE LOCKED OUTCOME SPEC — "FIRST TO FALL LOSES" (user-directed 2026-08-04),
 * superseding the 2026-07-30/31 mutual-wipe tempo tiebreak.
 *
 * Every damage in this engine can be said to be dealt or taken FIRST, so the
 * fight ends at the exact APPLICATION that wipes a side and nothing later in the
 * same step ever runs. The application order these tests pin down is the one the
 * engine already defined:
 *
 *   1. a cast's full resolution, THEN the performer's bleed tick;
 *   2. the attrition sweep, in ASCENDING INITIATIVE SCORE (ties: canonical pool
 *      order = player side first, then unit index);
 *   3. burn at the START of a turn, poison at the END, fatigue after attrition —
 *      each a per-unit sweep in canonical pool order.
 *
 * Consequence: MUTUAL WIPES NO LONGER EXIST, so the old hierarchy (lower score
 * loses -> lower HP loses -> player wins) is unreachable; it survives in
 * `decideOutcome` only as a documented defensive fallback. A second consequence
 * is stated by the dead-heat test below: in a perfectly mirrored fight the
 * PLAYER's unit is first in canonical order, so it is the one that falls.
 */
describe('a fight is ALWAYS decided (no draw) — FIRST TO FALL LOSES', () => {
  // Turn-15 attrition deals exactly 5, so any unit at 1..5 HP dies in that tick.
  it('the lower-score side takes the killing tick FIRST and loses: player banks 5/turn vs a foe banking 10 -> loss', () => {
    const { result, turns, events } = simulate(attritionDuel(bare('hero', 5, 5), bare('foe', 5, 10)), 1);
    expect(turns).toBe(ATTRITION_START_TURN);
    expect(result).toBe('loss');
    // The sweep STOPPED: the foe (ahead on tempo, later in the order) is never hit.
    expect(hitsFrom(events, 'attrition')).toEqual(['player0@t15']);
  });

  it('mirrored: the foe is behind, is hit first, and dies first -> win (the foe never gets to trade)', () => {
    const { result, turns, events } = simulate(attritionDuel(bare('hero', 5, 10), bare('foe', 5, 5)), 1);
    expect(turns).toBe(ATTRITION_START_TURN);
    expect(result).toBe('win');
    expect(hitsFrom(events, 'attrition')).toEqual(['enemy0@t15']);
  });

  it('the lower-score side loses even when it has MORE hp (the ORDER decides, not HP)', () => {
    // hero 5 HP / Speed 10, foe 4 HP / Speed 5: the foe is behind, so it is hit first.
    expect(simulate(attritionDuel(bare('hero', 5, 10), bare('foe', 4, 5)), 1).result).toBe('win');
    // hero 4 HP / Speed 5 vs foe 5 HP / Speed 10 -> hero behind -> loss.
    expect(simulate(attritionDuel(bare('hero', 4, 5), bare('foe', 5, 10)), 1).result).toBe('loss');
    // The hero has MORE hp but is behind on tempo -> still hit first -> still a loss.
    expect(simulate(attritionDuel(bare('hero', 5, 5), bare('foe', 4, 10)), 1).result).toBe('loss');
  });

  it('EQUAL score: HP no longer matters at all — whoever is hit first falls, and that is the player', () => {
    // 45/48 max HP: turns 15+16 shave 5+15=20, so the units enter the turn-17
    // tick (30 damage) at exactly 25 and 28 HP — both WOULD die in it. Equal score
    // means the tie falls back to canonical order, so the player is hit first, dies
    // first, and the sweep stops before the foe's tick.
    const { result, turns, events } = simulate(attritionDuel(bare('hero', 45, 10), bare('foe', 48, 10)), 1);
    expect(turns).toBe(17);
    const lethal = events.filter(
      (e): e is DamageEvent => e.kind === 'damage' && e.source === 'attrition' && e.turn === 17,
    );
    expect(lethal.map((e) => `${e.side}${e.unit}`)).toEqual(['player0']); // ONE tick, not two
    expect(lethal.map((e) => e.hpAfter)).toEqual([0]);
    expect(result).toBe('loss');
    // MIRRORING THE HP NO LONGER FLIPS THE RESULT (it used to: "lower HP loses").
    // The player is hit first either way, so it loses either way.
    expect(simulate(attritionDuel(bare('hero', 48, 10), bare('foe', 45, 10)), 1).result).toBe('loss');
  });

  it('an exact DEAD HEAT now goes to the ENEMY: the player is first in canonical order, so it falls first', () => {
    const { result, events, finalState } = simulate(attritionDuel(bare('hero', 5, 10), bare('foe', 5, 10)), 1);
    // Was a player win under the 2026-07-31 tie convention; the tie no longer
    // exists — the player's unit simply takes the killing tick first.
    expect(result).toBe('loss');
    expect(hitsFrom(events, 'attrition')).toEqual(['player0@t15']);
    expect(events.filter((e) => e.kind === 'died')).toHaveLength(1);
    expect(finalState.enemyTeam[0]!.alive).toBe(true);
    expect(finalState.enemyTeam[0]!.stats.hp).toBe(5); // untouched: its tick never ran
    const end = events[events.length - 1]!;
    expect(end).toEqual({ turn: 15, kind: 'combatEnd', result: 'loss', turns: 15 });
  });

  it('single-side wipes are unchanged', () => {
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

/**
 * THE CHECK POINTS. One test per potentially-lethal application in the engine,
 * each proving that the application AFTER the killing one never runs.
 */
describe('combat ends at the exact application that wipes a side', () => {
  const orderDuel = (
    player: { hp: number; speed: number; skills: string[] },
    enemy: { hp: number; speed: number; skills: string[] },
    extra: Partial<CombatConfig> = {},
  ): CombatConfig => {
    const unit = (name: string, u: { hp: number; speed: number; skills: string[] }): CombatantSetup => ({
      name,
      stats: { maxHp: u.hp, hp: u.hp, attack: 0, magicPower: 0, armor: 0, magicResist: 0, speed: u.speed },
      boardSize: 10,
      pieces: u.skills.map((skillId, i) => ({ skillId, slot: i })),
    });
    return {
      playerTeam: [unit('hero', player)],
      enemyTeam: [unit('foe', enemy)],
      skillBook: ORDER_BOOK,
      ...NO_OTHER_ENDGAME,
      attritionTurn: OFF,
      maxTurns: 20,
    // Default cooldowns ON: every card below fires once and then sits out, so the
    // timeline is exactly the one described in each test.
      ...extra,
    };
  };

  // ORDER 1 — a cast resolves BEFORE the performer's bleed tick, so a killing
  // cast means the bleed never draws blood. Timeline: turn 1 the foe casts `gash`
  // (bleed 3, fresh); turn 2 the hero (Speed 20, weight-40 `finisher`) can finally
  // afford its card and hits for 100.
  it('a killing CAST cancels the performer\'s own bleed tick (the caster survives at 3 HP)', () => {
    const { result, turns, events, finalState } = simulate(
      orderDuel({ hp: 3, speed: 20, skills: ['finisher'] }, { hp: 50, speed: 10, skills: ['gash'] }),
      1,
    );
    expect(turns).toBe(2);
    expect(result).toBe('win');
    expect(hitsFrom(events, 'bleed')).toEqual([]); // the lethal bleed never ticked
    const hero = finalState.playerTeam[0]!;
    expect(hero.alive).toBe(true);
    expect(hero.stats.hp).toBe(3);
    // The pile is still standing at full stacks — it was skipped, not consumed.
    expect(hero.statuses.filter((s) => s.kind === 'bleed').map((s) => s.stacks)).toEqual([3]);
    // Bookkeeping after the killing cast is untouched (cost/cursor still emit).
    expect(events.map((e) => e.kind).slice(-3)).toEqual(['cost', 'cursor', 'combatEnd']);
  });

  it('CONTROL: the same fight where the cast does NOT kill — the bleed ticks and kills the caster', () => {
    const { result, events, finalState } = simulate(
      orderDuel({ hp: 3, speed: 20, skills: ['finisher'] }, { hp: 500, speed: 10, skills: ['gash'] }),
      1,
    );
    expect(hitsFrom(events, 'bleed')).toEqual(['player0@t2']);
    expect(result).toBe('loss');
    expect(finalState.playerTeam[0]!.alive).toBe(false);
    expect(finalState.enemyTeam[0]!.stats.hp).toBe(400);
  });

  // ORDER 0 — INSIDE a cast, effects resolve in authored order, so a killing
  // damage action ends the fight before the rider behind it: NO LIFESTEAL-BACK.
  it('a killing blow pays NO lifesteal (the rider behind it never resolves)', () => {
    const wounded = (hp: number, maxHp: number, speed: number, skills: string[]): CombatantSetup => ({
      name: 'u',
      stats: { maxHp, hp, attack: 0, magicPower: 0, armor: 0, magicResist: 0, speed },
      boardSize: 10,
      pieces: skills.map((skillId, i) => ({ skillId, slot: i })),
    });
    const duel = (foeHp: number): CombatConfig => ({
      playerTeam: [wounded(10, 100, 20, ['vampiric'])],
      enemyTeam: [wounded(foeHp, foeHp, 5, [])],
      skillBook: ORDER_BOOK,
      ...NO_OTHER_ENDGAME,
      attritionTurn: OFF,
      maxTurns: 1, // exactly ONE cast, so the heal accounting is exact
    });
    // Kill: 100 damage on a 50 HP foe. 50 HP was dealt, so the rider would have
    // healed 25 — it does not run at all.
    const killed = simulate(duel(50), 1);
    expect(killed.result).toBe('win');
    expect(killed.events.filter((e) => e.kind === 'heal')).toEqual([]);
    expect(killed.finalState.playerTeam[0]!.stats.hp).toBe(10); // not 35
    // CONTROL: same card on a foe that survives -> the rider resolves normally
    // (100 dealt, 50% stolen).
    const survived = simulate(duel(500), 1);
    expect(survived.events.filter((e) => e.kind === 'heal')).toHaveLength(1);
    expect(survived.finalState.playerTeam[0]!.stats.hp).toBe(60);
  });

  // ORDER 2 — the START-OF-TURN burn sweep, canonical order (player side first).
  // Both units enter turn 2 burning for a lethal 4; only the first tick happens.
  it('the BURN sweep stops at the tick that wipes a side (the foe keeps its full pile)', () => {
    const { result, turns, events, finalState } = simulate(
      orderDuel({ hp: 4, speed: 10, skills: ['ember'] }, { hp: 4, speed: 10, skills: ['ember'] }),
      1,
    );
    expect(turns).toBe(2);
    expect(hitsFrom(events, 'burn')).toEqual(['player0@t2']);
    expect(result).toBe('loss');
    const foe = finalState.enemyTeam[0]!;
    expect(foe.alive).toBe(true);
    expect(foe.stats.hp).toBe(4);
    expect(foe.statuses.filter((s) => s.kind === 'burn').map((s) => s.stacks)).toEqual([2]); // never halved
  });

  // ORDER 3 — the END-OF-TURN poison sweep, same shape.
  it('the POISON sweep stops at the tick that wipes a side', () => {
    const { result, turns, events, finalState } = simulate(
      orderDuel({ hp: 4, speed: 10, skills: ['venom'] }, { hp: 4, speed: 10, skills: ['venom'] }),
      1,
    );
    expect(turns).toBe(2);
    expect(hitsFrom(events, 'poison')).toEqual(['player0@t2']);
    expect(result).toBe('loss');
    const foe = finalState.enemyTeam[0]!;
    expect(foe.alive).toBe(true);
    expect(foe.stats.hp).toBe(4);
    expect(foe.statuses.filter((s) => s.kind === 'poison').map((s) => s.stacks)).toEqual([4]); // never decayed
  });

  // ORDER 4 — the FATIGUE backstop, canonical order.
  it('the FATIGUE sweep stops at the tick that wipes a side (no "both die, player wins" any more)', () => {
    const cfg: CombatConfig = {
      playerTeam: [bare('hero', 5, 10)],
      enemyTeam: [bare('foe', 5, 10)],
      skillBook,
      suddenDeathRound: 999,
      fatigueTurn: 1,
      attritionTurn: OFF,
      maxTurns: 10,
    };
    const { result, turns, events, finalState } = simulate(cfg, 1);
    expect(turns).toBe(1);
    expect(hitsFrom(events, 'fatigue')).toEqual(['player0@t1']);
    expect(result).toBe('loss');
    expect(finalState.enemyTeam[0]!.stats.hp).toBe(5);
  });

  // ORDER 5 — the sweep truncates MID-TEAM too, not just between sides.
  it('the ATTRITION sweep truncates mid-sweep in a 1v2: the two foes later in the order are never reached', () => {
    const cfg: CombatConfig = {
      playerTeam: [bare('hero', 5, 1)], // lowest score -> hit first
      enemyTeam: [bare('e0', 5, 5), bare('e1', 5, 12)],
      skillBook,
      ...NO_OTHER_ENDGAME,
      maxTurns: 200,
    };
    const { result, turns, events, finalState } = simulate(cfg, 1);
    expect(turns).toBe(ATTRITION_START_TURN);
    expect(hitsFrom(events, 'attrition')).toEqual(['player0@t15']);
    expect(result).toBe('loss');
    expect(finalState.enemyTeam.map((u) => u.stats.hp)).toEqual([5, 5]);
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
      const playerWiped = finalState.playerTeam.every((u) => !u.alive);
      const enemyWiped = finalState.enemyTeam.every((u) => !u.alive);
      expect(playerWiped || enemyWiped).toBe(true);
      // FIRST TO FALL LOSES: a mutual wipe is now IMPOSSIBLE (one application can
      // only ever damage one victim, and the fight stops there), so exactly one
      // side is wiped and the loser is always the side that fell.
      expect(playerWiped && enemyWiped).toBe(false);
      expect(result).toBe(playerWiped ? 'loss' : 'win');
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
  // regenerated (last regeneration: 2026-08-05, for DEFENSIVE-STAT SCALING of shields
  // and heals — a real, reviewed rule change whose blast radius was enumerated before
  // regenerating: 153/200 logs moved in EACH sweep, with 2 winner flips (#9, #138) and
  // 13 turn changes. Containment was proven by exhaustion rather than by inspecting
  // each log: NOT ONE moved log lacks a shieldGain/heal event, and all 15 logs that
  // have one but did not move are accounted for (12 carry only a zero stat term —
  // TRUE, flat by identity; 3 carry only a `leeching_fang` lifesteal heal, which
  // scales off damage dealt, never off a stat). Earlier regens: FIRST-TO-FALL
  // (1/200 attritionOff, 2/200 attritionOn — each a POST-WIPE application that no
  // longer runs; 0 winner flips, 0 turn changes), the
  // anti-heal world rule (75/200), the TRUE-heal re-price, "bleed ticks at most once
  // per global turn" (8/200), and additive shield event metadata. Hashing goes
  // through the shared `outcomeHash` normalizer, which strips presentation-only card
  // fields (`text` anywhere, SkillDef `name`) that the sim never reads, so a content
  // copy-edit can no longer force a regen; everything the engine consumes is still
  // compared byte-for-byte.)
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

  it('with attrition OFF, all 200 logs are BYTE-IDENTICAL to the baseline and NOT ONE ends in a mutual wipe', () => {
    const cases = sweepCases(0xba5e11, 200, { attritionTurn: OFF, maxTurns: 200 });
    let mutual = 0;
    cases.forEach(({ config, seed }, i) => {
      const base = baseline.attritionOff[i]!;
      const r = simulate(structuredClone(config), seed);
      // FIRST TO FALL LOSES (2026-08-04): the both-sides-wiped case the old
      // hierarchy governed cannot happen any more, so there is no exemption branch
      // left here — every log is compared byte-for-byte.
      if (r.finalState.playerTeam.every((u) => !u.alive) && r.finalState.enemyTeam.every((u) => !u.alive)) mutual += 1;
      expect(r.result).toBe(base.result);
      expect(r.turns).toBe(base.turns);
      expect(hash({ events: r.events, finalState: r.finalState, result: r.result })).toBe(base.hash);
    });
    expect(mutual).toBe(0);
  });

  it('NOTHING is applied after the killing blow: no damage and no death follows the wipe, in 340 fights', () => {
    const cases = [...sweepCases(0x5117e5, 300, { maxTurns: 200 }), ...sweepCases(0xd0d0, 40, {})];
    let checked = 0;
    for (const { config, seed } of cases) {
      const np = config.playerTeam!.length;
      const ne = config.enemyTeam!.length;
      const { events } = simulate(structuredClone(config), seed);
      // Replay the deaths to find the application that first wiped a side.
      const dead = { player: new Set<number>(), enemy: new Set<number>() };
      let wipeAt = -1;
      for (let i = 0; i < events.length && wipeAt < 0; i += 1) {
        const e = events[i]!;
        if (e.kind !== 'died') continue;
        dead[e.side].add(e.unit);
        if (dead.player.size >= np || dead.enemy.size >= ne) wipeAt = i;
      }
      expect(wipeAt).toBeGreaterThan(-1); // every fight in this sweep is decided by a wipe
      // Everything after it must be bookkeeping only (cost/cursor/combatEnd).
      const after = events.slice(wipeAt + 1).map((e) => e.kind);
      expect(after).not.toContain('damage');
      expect(after).not.toContain('died');
      expect(after).not.toContain('heal');
      checked += 1;
    }
    expect(checked).toBe(340);
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
