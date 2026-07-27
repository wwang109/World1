import { describe, expect, it } from 'vitest';
import { resolveBattle, type BattleRequest } from '../../src/run/resolveBattle';
import { buildBattleTimeline, type BattleTimelineInput } from '../../src/game/battleTimeline';
import { battleRequestOf } from '../../src/game/battleApi';

const PIECES = [
  { instanceId: 'c1', skillId: 'sword_slash', tier: 'bronze', slot: 0 },
  { instanceId: 'c2', skillId: 'second_wind', tier: 'bronze', slot: 1 },
] as const;

const REQUEST: BattleRequest = {
  pieces: PIECES.map((p) => ({ ...p })),
  heroLevel: 3,
  heroAllocation: {},
  foes: [{ enemyId: 'bandit_duelist', level: 1, title: 'elite', rank: 2 }],
  seed: 7,
};

const TIMELINE_INPUT: BattleTimelineInput = {
  pieces: PIECES.map((p) => ({ ...p })),
  heroLevel: 3,
  heroAllocation: {},
  enemyId: 'bandit_duelist',
  enemyLevel: 1,
  enemyTitle: 'elite',
  enemyRank: 2,
  seed: 7,
};

describe('run/resolveBattle', () => {
  it('is a pure function of the request — same request, same log', () => {
    const a = resolveBattle(REQUEST);
    const b = resolveBattle(REQUEST);
    expect(b.result).toBe(a.result);
    expect(b.turns).toBe(a.turns);
    expect(b.events).toEqual(a.events);
  });

  it('returns a non-empty event log carrying damage calculations', () => {
    const log = resolveBattle(REQUEST);
    expect(log.events.length).toBeGreaterThan(0);
    const hit = log.events.find((e) => e.kind === 'damage' && e.source === 'skill');
    expect(hit).toBeDefined();
    // The calculation numbers are what let a thin client render damage math it
    // never computed — if these stop shipping, the client cannot show `D:` lines.
    expect((hit as { calculation?: unknown }).calculation).toBeDefined();
  });

  it('omits finalState so the response stays proportional to the events', () => {
    expect(Object.keys(resolveBattle(REQUEST)).sort()).toEqual(['events', 'result', 'turns']);
  });

  it('the request the client would send matches a hand-built one', () => {
    // battleRequestOf is what the client POSTs; if it drifts from the request
    // shape the service expects, every battle silently resolves differently.
    expect(battleRequestOf(TIMELINE_INPUT)).toEqual({ ...REQUEST, foes: [{ ...REQUEST.foes[0], modifiers: [] }] });
  });

  it('a served log folds into a complete playback model', () => {
    const model = buildBattleTimeline(TIMELINE_INPUT, resolveBattle(battleRequestOf(TIMELINE_INPUT)));
    expect(model.steps.length).toBeGreaterThan(1);
    expect(model.hpByStep).toHaveLength(model.steps.length);
    expect(model.fxByStep).toHaveLength(model.steps.length);
    expect(['VICTORY', 'DEFEAT', 'DRAW']).toContain(model.outcome);
    // The damage math survives the wire — a `D:` detail line must be present.
    const details = [...model.linesByTurn.values()].flat().filter((l) => l.detail?.startsWith('D:'));
    expect(details.length).toBeGreaterThan(0);
  });

  it('resolves a multi-foe request in unit order', () => {
    const log = resolveBattle({
      ...REQUEST,
      foes: [
        { enemyId: 'giant_rat', level: 1, title: 'mob', rank: 0 },
        { enemyId: 'ember_imp', level: 1, title: 'normal', rank: 0 },
      ],
    });
    const units = new Set(
      log.events.filter((e) => (e as { side?: string }).side === 'enemy').map((e) => (e as { unit?: number }).unit ?? 0),
    );
    expect(units.has(0)).toBe(true);
    expect(units.has(1)).toBe(true);
  });
});
