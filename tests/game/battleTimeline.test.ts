import { describe, expect, it } from 'vitest';
import { buildBattleTimeline, type BattleTimeline, type BattleTimelineInput } from '../../src/game/battleTimeline';
import { battleRequestOf } from '../../src/game/battleApi';
import { resolveBattle } from '../../src/run/resolveBattle';

const BASE: BattleTimelineInput = {
  pieces: [
    { instanceId: 'c1', skillId: 'sword_slash', tier: 'bronze', slot: 0 },
    { instanceId: 'c2', skillId: 'second_wind', tier: 'bronze', slot: 1 },
  ],
  heroLevel: 3,
  heroAllocation: {},
  enemyId: 'bandit_duelist',
  enemyLevel: 1,
  enemyTitle: 'elite',
  enemyRank: 2,
  seed: 7,
};

/** Stands in for the battle service: resolve the log, then fold it. */
function timeline(input: BattleTimelineInput): BattleTimeline {
  return buildBattleTimeline(input, resolveBattle(battleRequestOf(input)));
}

describe('game/battleTimeline', () => {
  it('opens with a START baseline step at full HP', () => {
    const model = timeline(BASE);
    const first = model.steps[0]!;
    const line = model.linesByTurn.get(first.turn)![first.lineIndex]!;
    expect(line.tag).toBe('START');
    const hp = model.hpByStep[0]!;
    expect(hp.player).toBe(hp.playerMax);
    expect(hp.enemy).toBe(hp.enemyMax);
  });

  it('is deterministic — same input, same timeline', () => {
    const a = timeline(BASE);
    const b = timeline(BASE);
    expect(b.steps).toEqual(a.steps);
    expect(b.hpByStep).toEqual(a.hpByStep);
    expect(b.outcome).toBe(a.outcome);
  });

  it('resolves a 2-foe team with per-unit HP arrays and foe models', () => {
    const model = timeline({
      ...BASE,
      enemyTeam: [
        { enemyId: 'bandit_duelist', level: 1, title: 'elite', rank: 2, modifiers: [] },
        { enemyId: 'giant_rat', level: 1, title: 'normal', rank: 0, modifiers: [] },
      ],
    });
    expect(model.foes).toHaveLength(2);
    expect(model.foes[1]!.name).toBe('Giant Rat');
    for (const snap of model.hpByStep) {
      expect(snap.enemies).toHaveLength(2);
      expect(snap.enemy).toBe(snap.enemies![0]);
    }
    expect(['VICTORY', 'DEFEAT', 'DRAW']).toContain(model.outcome);
    // unit-0 compatibility views stay pointed at the first foe
    expect(model.foeName).toBe(model.foes[0]!.name);
  });

  it('exposes a per-step focus foe aligned with the playback steps', () => {
    const model = timeline({
      ...BASE,
      enemyTeam: [
        { enemyId: 'bandit_duelist', level: 1, title: 'elite', rank: 2, modifiers: [] },
        { enemyId: 'giant_rat', level: 1, title: 'normal', rank: 0, modifiers: [] },
        { enemyId: 'giant_rat', level: 1, title: 'normal', rank: 0, modifiers: [] },
      ],
    });
    expect(model.focusFoeByStep).toHaveLength(model.steps.length);
    // Every defined focus points at a real enemy unit.
    for (const f of model.focusFoeByStep) {
      if (f !== undefined) {
        expect(f).toBeGreaterThanOrEqual(0);
        expect(f).toBeLessThan(model.foes.length);
      }
    }
    // A real fight involves the enemy side — at least one step must focus a foe.
    expect(model.focusFoeByStep.some((f) => f !== undefined)).toBe(true);
    // The START baseline step has no specific foe.
    expect(model.focusFoeByStep[0]).toBeUndefined();
  });

  it('a size-3 card logs its full span: cast 1/3 then WAIT lines 2/3 and 3/3', () => {
    const model = timeline({
      ...BASE,
      pieces: [{ instanceId: 'c1', skillId: 'crushing_blow', tier: 'bronze', slot: 0 }],
    });
    const lines = [...model.linesByTurn.values()].flat();
    expect(lines.some((l) => l.tag === 'PLAY' && l.text.includes('Crushing Blow · 1/3'))).toBe(true);
    // The busy turns must be visible — a span turn with no line vanishes from playback.
    expect(lines.some((l) => l.tag === 'WAIT' && l.text.includes('Crushing Blow · 2/3'))).toBe(true);
    expect(lines.some((l) => l.tag === 'WAIT' && l.text.includes('Crushing Blow · 3/3'))).toBe(true);
    // WAIT lines are playback steps, so the scrubber pauses on span turns.
    const waitStep = model.steps.find((s) =>
      model.linesByTurn.get(s.turn)![s.lineIndex]!.tag === 'WAIT');
    expect(waitStep).toBeDefined();
  });

  it('single-enemy input still resolves identically through the team path', () => {
    const single = timeline(BASE);
    const teamOfOne = timeline({
      ...BASE,
      enemyTeam: [{ enemyId: 'bandit_duelist', level: 1, title: 'elite', rank: 2, modifiers: [] }],
    });
    expect(teamOfOne.steps).toEqual(single.steps);
    expect(teamOfOne.hpByStep).toEqual(single.hpByStep);
    expect(teamOfOne.outcome).toBe(single.outcome);
  });
});
