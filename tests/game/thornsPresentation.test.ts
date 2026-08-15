import { describe, expect, it } from 'vitest';
import { buildBattleTimeline, type BattleTimeline, type BattleTimelineInput } from '../../src/game/battleTimeline';
import { battleRequestOf } from '../../src/game/battleApi';
import { resolveBattle } from '../../src/run/resolveBattle';
import { summarizeEffects } from '../../src/game/ui/skillPresentation';
import { skillBook } from '../../src/data/skills';

/**
 * THORNS in the PLAYBACK layer — regression lock for the review findings of
 * 2026-08-15. The engine emits thorns events correctly; these pin that the
 * client renders them correctly:
 *  1. a thorns application is tagged BUFF (it is a self buff — the old code
 *     fell through to DEBUFF, painting the player's own card as an affliction);
 *  2. the pile's wear-off prints a row (no HP-badge clears for thorns, so its
 *     end is otherwise invisible);
 *  3. reflect damage is counted in the fight's side totals (it used to vanish);
 *  4. the card face shows a THORN token (summarizeEffects used to drop the
 *     action silently, leaving bramble_ward's face reading as shield-only).
 */

const BASE: BattleTimelineInput = {
  pieces: [
    { instanceId: 'c1', skillId: 'bramble_ward', tier: 'bronze', slot: 0 },
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

function timeline(input: BattleTimelineInput): BattleTimeline {
  return buildBattleTimeline(input, resolveBattle(battleRequestOf(input)));
}

const allLines = (model: BattleTimeline) => [...model.linesByTurn.values()].flat();

describe('thorns presentation', () => {
  it('tags a thorns application BUFF, never DEBUFF', () => {
    const lines = allLines(timeline(BASE));
    const thornLines = lines.filter((l) => l.text.includes('Thorns'));
    expect(thornLines.length, 'the fight must actually apply thorns').toBeGreaterThan(0);
    const applied = thornLines.filter((l) => l.tag === 'BUFF');
    expect(applied.length, 'thorns application must be tagged BUFF').toBeGreaterThan(0);
    expect(thornLines.filter((l) => l.tag === 'DEBUFF')).toEqual([]);
  });

  it('prints a BUFF wear-off row when the pile empties', () => {
    // Merge keeps a recasting holder's pile topped up, so real fights rarely
    // drain it — a crafted log pins the row deterministically instead.
    const crafted = {
      events: [
        { turn: 1, kind: 'statusApplied', side: 'player', unit: 0, status: 'thorns', stacks: 3, turns: 3 },
        { turn: 2, kind: 'statusExpired', side: 'player', unit: 0, status: 'thorns' },
        { turn: 2, kind: 'combatEnd', result: 'loss', turns: 2 },
      ],
      result: 'loss',
      turns: 2,
    } as never;
    const lines = allLines(buildBattleTimeline(BASE, crafted));
    const woreOff = lines.filter((l) => l.text.includes('Thorns wore off'));
    expect(woreOff.length).toBe(1);
    expect(woreOff[0]!.tag).toBe('BUFF');
  });

  it('counts reflect damage in the holder side totals', () => {
    const model = timeline(BASE);
    const log = resolveBattle(battleRequestOf(BASE));
    const reflected = log.events
      .filter((e): e is Extract<typeof e, { kind: 'damage' }> => e.kind === 'damage')
      .filter((e) => e.source === 'thorns' && e.side === 'enemy')
      .reduce((sum, e) => sum + e.amount, 0);
    expect(reflected, 'the fight must actually reflect damage').toBeGreaterThan(0);
    // playerDamage must include every sting the enemy took — proven by lower
    // bound: totals with reflects >= totals of skill hits alone.
    const skillOnly = log.events
      .filter((e): e is Extract<typeof e, { kind: 'damage' }> => e.kind === 'damage')
      .filter((e) => e.source === 'skill' && e.side === 'enemy')
      .reduce((sum, e) => sum + e.amount, 0);
    const finalSummary = model.summaryByStep[model.summaryByStep.length - 1]!;
    expect(finalSummary.playerDamage).toBe(skillOnly + reflected);
  });

  it('shows a THORN token on the card face', () => {
    expect(summarizeEffects(skillBook.bramble_ward!)).toContain('THORN 5');
    expect(summarizeEffects(skillBook.nettle_lash!)).toContain('THORN 5');
  });
});
