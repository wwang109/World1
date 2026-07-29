import { describe, expect, it } from 'vitest';
import {
  applyDraftResult,
  createRun,
  isTutorialSkipped,
  isTutorialStepSeen,
  markTutorialSeen,
  markTutorialSkipped,
  type RunState,
} from '../../src/run/runState';
import { rollStartDraft, DRAFT_SET_KEYS, type DraftSetKey } from '../../src/run/draft';
import { resolveBattle, type BattleRequest } from '../../src/run/resolveBattle';

function draftPicksFor(seed: number): Partial<Record<DraftSetKey, string>> {
  const draft = rollStartDraft(seed);
  const picks: Partial<Record<DraftSetKey, string>> = {};
  for (const key of DRAFT_SET_KEYS) picks[key] = draft[key][0]!.skillId;
  return picks;
}

function startedRun(seed: number): RunState {
  return applyDraftResult(createRun(seed), draftPicksFor(seed));
}

describe('run tutorial progress (src/run/runState)', () => {
  it('markTutorialSeen is pure and returns a NEW state with the id recorded', () => {
    const run = startedRun(1);
    const next = markTutorialSeen(run, 'stats_damage_1');
    expect(run.tutorialSeen ?? []).not.toContain('stats_damage_1');
    expect(next).not.toBe(run);
    expect(next.tutorialSeen).toContain('stats_damage_1');
    expect(isTutorialStepSeen(next, 'stats_damage_1')).toBe(true);
    expect(isTutorialStepSeen(run, 'stats_damage_1')).toBe(false);
  });

  it('markTutorialSeen is idempotent: marking the same id twice is a no-op the second time', () => {
    const run = startedRun(2);
    const once = markTutorialSeen(run, 'speed_turnline');
    const twice = markTutorialSeen(once, 'speed_turnline');
    expect(twice).toBe(once); // same reference — no new state produced.
    expect(twice.tutorialSeen).toEqual(['speed_turnline']);
  });

  it('a fresh run starts unskipped with no steps seen', () => {
    const run = startedRun(3);
    expect(isTutorialSkipped(run)).toBe(false);
    expect(run.tutorialSeen).toEqual([]);
  });

  it('is inert when the fields are absent (a run predating the tutorial)', () => {
    const run = startedRun(4);
    // Simulate a pre-tutorial persisted run: strip the fields entirely.
    const legacy: RunState = { ...run };
    delete (legacy as { tutorialSeen?: string[] }).tutorialSeen;
    delete (legacy as { tutorialSkipped?: boolean }).tutorialSkipped;
    expect(isTutorialSkipped(legacy)).toBe(false);
    expect(isTutorialStepSeen(legacy, 'pl_levelup')).toBe(false);
    const next = markTutorialSeen(legacy, 'pl_levelup');
    expect(next.tutorialSeen).toEqual(['pl_levelup']);
  });

  it('markTutorialSkipped is pure/idempotent and a skipped run never re-arms a step', () => {
    const run = startedRun(5);
    const skipped = markTutorialSkipped(run);
    expect(skipped).not.toBe(run);
    expect(isTutorialSkipped(skipped)).toBe(true);
    // Skipping again is a no-op (same reference).
    expect(markTutorialSkipped(skipped)).toBe(skipped);
    // markTutorialSeen never arms anything once skipped — pure no-op.
    const attempt = markTutorialSeen(skipped, 'pl_grid');
    expect(attempt).toBe(skipped);
    expect(isTutorialStepSeen(attempt, 'pl_grid')).toBe(false);
  });

  it('never mutates the input state (pieces/allocation/gold untouched)', () => {
    const run = startedRun(6);
    const before = JSON.stringify({ pieces: run.pieces, heroAllocation: run.heroAllocation, gold: run.gold, heroLevel: run.heroLevel });
    markTutorialSeen(run, 'stats_damage_1');
    markTutorialSkipped(run);
    const after = JSON.stringify({ pieces: run.pieces, heroAllocation: run.heroAllocation, gold: run.gold, heroLevel: run.heroLevel });
    expect(after).toBe(before);
  });
});

describe('run tutorial determinism: tutorial progress never touches battle input', () => {
  it('an identical fight resolves to a byte-identical event log whether the tutorial is on, mid-way through, or fully skipped', () => {
    const baseRun = startedRun(7);
    const seenRun = markTutorialSeen(markTutorialSeen(baseRun, 'stats_damage_1'), 'speed_turnline');
    const skippedRun = markTutorialSkipped(seenRun);

    const requestFor = (run: RunState): BattleRequest => ({
      pieces: run.pieces,
      heroLevel: run.heroLevel,
      heroAllocation: run.heroAllocation,
      foes: [{ enemyId: 'giant_rat', level: 1, title: 'normal', rank: 3 }],
      seed: 12345,
    });

    const baseLog = resolveBattle(requestFor(baseRun));
    const seenLog = resolveBattle(requestFor(seenRun));
    const skippedLog = resolveBattle(requestFor(skippedRun));

    expect(JSON.stringify(seenLog)).toBe(JSON.stringify(baseLog));
    expect(JSON.stringify(skippedLog)).toBe(JSON.stringify(baseLog));
  });
});
