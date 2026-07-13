import { describe, expect, it } from 'vitest';
import { simulate } from '../../src/engine/combat/simulate';
import { BASELINE_COOLDOWN, effectiveCooldown } from '../../src/engine/combat/castSelect';
import type { CombatConfig, SkillBook, SkillDef } from '../../src/engine/types';
import { tc, NO_ENDGAME } from '../helpers';

/**
 * Per-card reuse cooldowns — the SECOND pacing dial (weight = firing order,
 * cooldown = availability). All fights here run with `cooldownsEnabled: true`
 * (the real-play default); the 194 pre-cooldown mechanic tests keep the toggle
 * OFF via the `cfg()` helper and stay byte-identical.
 *
 * Cards deal true damage scaled off a tiny stat with critPct 0, so no matchup /
 * crit RNG divergence muddies the event stream we assert on.
 */
function card(id: string, over: Partial<SkillDef> = {}): SkillDef {
  return {
    id,
    name: id,
    archetypes: ['offense'],
    property: 'true',
    size: 1,
    speedWeight: 10,
    rarity: 'common',
    tier: 'bronze',
    effects: [{ kind: 'damage', power: 10 }],
    text: '',
    ...over,
  };
}

const BOOK: SkillBook = {
  a: card('a'),
  b: card('b'),
  c: card('c'),
  d: card('d'),
  basic: card('basic'),
  quick: card('quick', { cooldownTurns: 1 }),
  slow: card('slow', { cooldownTurns: 5 }),
};

/** Enemy that never performs (empty board) and cannot die, so the player alone paces the log. */
function dummy() {
  return tc('dummy', [], { maxHp: 100000, speed: 1 }, { skillBook: BOOK });
}

/** cooldowns ON, endgame off, small turn cap. */
function run(player: ReturnType<typeof tc>, enemy: ReturnType<typeof tc>, maxTurns: number): CombatConfig {
  return {
    playerTeam: [player],
    enemyTeam: [enemy],
    skillBook: BOOK,
    ...NO_ENDGAME,
    maxTurns,
    cooldownsEnabled: true,
  };
}

function playerCastTurns(events: ReturnType<typeof simulate>['events']): number[] {
  return events.filter((e) => e.kind === 'skillCast' && e.side === 'player').map((e) => e.turn);
}

describe('cooldowns: baseline constant + effective lookup', () => {
  it('BASELINE_COOLDOWN is 3 and is the default effective cooldown', () => {
    expect(BASELINE_COOLDOWN).toBe(3);
    expect(effectiveCooldown(BOOK.basic!)).toBe(3);
    expect(effectiveCooldown(BOOK.quick!)).toBe(1);
    expect(effectiveCooldown(BOOK.slow!)).toBe(5);
  });
});

describe('cooldowns: off-by-one availability', () => {
  it('cast on T1 → unavailable T2–T4 → eligible again at T5 (baseline 3)', () => {
    const hero = tc('hero', ['basic'], { speed: 40, attack: 1 }, { skillBook: BOOK });
    const { events } = simulate(run(hero, dummy(), 13), 1);
    // Casts land on 1, 5, 9, 13 — a 4-turn stride (1 active + 3 cooling).
    expect(playerCastTurns(events)).toEqual([1, 5, 9, 13]);

    // On the cooling turns the performer has nothing eligible.
    const cmp = (turn: number) =>
      events.find((e) => e.kind === 'comparison' && e.turn === turn) as Extract<
        ReturnType<typeof simulate>['events'][number],
        { kind: 'comparison' }
      >;
    for (const t of [2, 3, 4]) expect(cmp(t).player.state).toBe('nothingUsable');
    expect(cmp(5).player.state).toBe('ready');
  });
});

describe('cooldowns: deck-size pacing', () => {
  it('a 1-card deck idles between casts instead of spamming every turn', () => {
    const hero = tc('hero', ['basic'], { speed: 40, attack: 1 }, { skillBook: BOOK });
    const { events } = simulate(run(hero, dummy(), 10), 1);
    // NOT one cast per turn: 4-turn stride from the baseline cooldown.
    expect(playerCastTurns(events)).toEqual([1, 5, 9]);
  });

  it('a diverse 4-card deck is unaffected — it fires every single turn', () => {
    // 4 distinct cards: by the time the cursor loops back to card `a` (turn 5)
    // its baseline-3 cooldown (cast T1) has elapsed, so nothing ever idles.
    const hero = tc('hero', ['a', 'b', 'c', 'd'], { speed: 40, attack: 1 }, { skillBook: BOOK });
    const { events } = simulate(run(hero, dummy(), 8), 1);
    expect(playerCastTurns(events)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });
});

describe('cooldowns: per-card override', () => {
  it('a shorter cooldown (1) fires every other turn', () => {
    const hero = tc('hero', ['quick'], { speed: 40, attack: 1 }, { skillBook: BOOK });
    const { events } = simulate(run(hero, dummy(), 9), 1);
    // Cast T1 → unavailable T2 → eligible T3: a 2-turn stride.
    expect(playerCastTurns(events)).toEqual([1, 3, 5, 7, 9]);
  });

  it('a longer cooldown (5) stretches the stride to 6 turns', () => {
    const hero = tc('hero', ['slow'], { speed: 40, attack: 1 }, { skillBook: BOOK });
    const { events } = simulate(run(hero, dummy(), 13), 1);
    // Cast T1 → unavailable T2–T6 → eligible T7.
    expect(playerCastTurns(events)).toEqual([1, 7, 13]);
  });
});

describe('cooldowns: skillCast cursor fields', () => {
  it('cursorBefore/cursorAfter track the rotation across a multi-card deck', () => {
    const hero = tc('hero', ['a', 'b', 'c', 'd'], { speed: 40, attack: 1 }, { skillBook: BOOK });
    const { events } = simulate(run(hero, dummy(), 5), 1);
    const casts = events.filter((e) => e.kind === 'skillCast' && e.side === 'player') as Extract<
      ReturnType<typeof simulate>['events'][number],
      { kind: 'skillCast' }
    >[];
    // cursorBefore is the RAW rotation pointer (`slot + size` of the prior cast),
    // which can point past the last card — the scan then wraps to the first card.
    // After the 4th cast the pointer is 4 (no card at slot >= 4), so turn 5 wraps
    // to card `a` at slot 0: cursorBefore 4, resolved slot 0, cursorAfter 1.
    expect(casts.map((c) => c.cursorBefore)).toEqual([0, 1, 2, 3, 4]);
    expect(casts.map((c) => c.cursorAfter)).toEqual([1, 2, 3, 4, 1]);
    expect(casts.map((c) => c.slot)).toEqual([0, 1, 2, 3, 0]);
  });
});

describe('cooldowns: banking during downtime', () => {
  it('a combatant idling on cooldown gains NO bank; a ready-but-lost combatant still banks', () => {
    // Ready-but-lost: a fast winner (diverse deck, always fires) vs a slow loser
    // with a diverse deck — the loser is always `ready` yet never wins, so it
    // banks its Speed each turn.
    const winner = tc('W', ['a', 'b', 'c', 'd'], { speed: 100, attack: 1 }, { skillBook: BOOK });
    const loser = tc('L', ['a', 'b', 'c', 'd'], { speed: 7, attack: 1 }, { skillBook: BOOK });
    const cfgLose: CombatConfig = { playerTeam: [winner], enemyTeam: [loser], skillBook: BOOK, ...NO_ENDGAME, maxTurns: 5, cooldownsEnabled: true };
    const evLose = simulate(cfgLose, 1).events;
    const enemyBanks = (evLose.filter((e) => e.kind === 'comparison') as Extract<
      ReturnType<typeof simulate>['events'][number],
      { kind: 'comparison' }
    >[]).map((e) => e.enemy.bank);
    // Loser (speed 7) banks every turn: 0, 7, 14, 21, 28.
    expect(enemyBanks).toEqual([0, 7, 14, 21, 28]);

    // Cooldown-idle: a single-card hero idling on cooldown does NOT bank —
    // its bank stays flat at 0 across the idle turns and on the re-eligible turn.
    const hero = tc('hero', ['basic'], { speed: 40, attack: 1 }, { skillBook: BOOK });
    const evIdle = simulate(run(hero, dummy(), 5), 1).events;
    const heroBanks = (evIdle.filter((e) => e.kind === 'comparison') as Extract<
      ReturnType<typeof simulate>['events'][number],
      { kind: 'comparison' }
    >[]).map((e) => e.player.bank);
    // Cast T1 (bank reset 0), idle T2–T4 (no bank), re-eligible T5 still at 0.
    expect(heroBanks).toEqual([0, 0, 0, 0, 0]);
  });
});

describe('cooldowns: determinism', () => {
  it('cooldowns ON: same config + seed → identical event logs', () => {
    const hero = tc('hero', ['a', 'b', 'c', 'd', 'basic'], { speed: 20, attack: 6, critPct: 35 }, { skillBook: BOOK });
    const foe = tc('foe', ['a', 'b', 'basic'], { speed: 18, attack: 5, critPct: 25, maxHp: 300 }, { skillBook: BOOK });
    const cfgOn: CombatConfig = { playerTeam: [hero], enemyTeam: [foe], skillBook: BOOK, maxTurns: 80, cooldownsEnabled: true };
    const a = simulate(structuredClone(cfgOn), 12345);
    const b = simulate(structuredClone(cfgOn), 12345);
    expect(a.events).toEqual(b.events);
    expect(a.finalState).toEqual(b.finalState);
  });
});
