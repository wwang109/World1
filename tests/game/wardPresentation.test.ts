import { describe, expect, it } from 'vitest';
import { buildBattleTimeline, type BattleTimeline, type BattleTimelineInput } from '../../src/game/battleTimeline';
import type { BattleLog } from '../../src/run/resolveBattle';
import type { CombatEvent } from '../../src/engine/combat/events';

/**
 * WARD in the PLAYBACK layer — regression lock for the review findings that
 * mirror the thorns fix (`tests/game/thornsPresentation.test.ts`). No shipped
 * card casts ward yet, so every case here is a crafted synthetic log (the
 * same idiom `thornsPresentation.test.ts` already uses for its wear-off
 * case) — `buildBattleTimeline` only needs `input` for hero/foe identity
 * (names/stats/boards), never to recompute combat, so a hand-built log is a
 * legitimate, deterministic way to pin the client's rendering of events the
 * engine is already contracted to emit (`src/engine/combat/events.ts`):
 *  1. a `warded` prevention prints a row naming the denied affliction and the
 *     charges left (it used to print nothing at all — `default: break`);
 *  2. the pile's wear-off (`statusExpired` for `'ward'`) prints a row (no
 *     ailment-badge clear implies it, exactly like thorns);
 *  3. a self-cast ward is tagged BUFF, never DEBUFF, and its charge count
 *     appears on the row itself (unlike a bare "Ward");
 *  4. `explainStatus` gives ward a plain-language arm naming what it does and
 *     does not cover.
 */

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

const allLines = (model: BattleTimeline) => [...model.linesByTurn.values()].flat();

describe('ward presentation', () => {
  it('tags a ward application BUFF, never DEBUFF, and shows the charge count on the row', () => {
    const events: CombatEvent[] = [
      { turn: 1, kind: 'statusApplied', side: 'player', unit: 0, status: 'ward', charges: 3, turns: 0 },
      { turn: 2, kind: 'combatEnd', result: 'win', turns: 2 },
    ];
    const log: BattleLog = { events, result: 'win', turns: 2 };
    const lines = allLines(buildBattleTimeline(BASE, log));
    const wardLines = lines.filter((l) => l.text.includes('Ward'));
    expect(wardLines.length).toBeGreaterThan(0);
    const applied = wardLines.filter((l) => l.tag === 'BUFF');
    expect(applied.length).toBeGreaterThan(0);
    expect(wardLines.filter((l) => l.tag === 'DEBUFF')).toEqual([]);
    // A 1-charge and a 3-charge ward must not read identically.
    expect(applied[0]!.text).toContain('3 charges');
  });

  it('prints a distinguishable row for a 1-charge ward application', () => {
    const events: CombatEvent[] = [
      { turn: 1, kind: 'statusApplied', side: 'player', unit: 0, status: 'ward', charges: 1, turns: 0 },
      { turn: 2, kind: 'combatEnd', result: 'win', turns: 2 },
    ];
    const log: BattleLog = { events, result: 'win', turns: 2 };
    const lines = allLines(buildBattleTimeline(BASE, log));
    const line = lines.find((l) => l.text.includes('Ward'))!;
    expect(line.text).toContain('1 charge');
    expect(line.text).not.toContain('1 charges');
  });

  it('explains ward in explainStatus: the charge count, what it covers, and that it does not stop stuns', () => {
    const events: CombatEvent[] = [
      { turn: 1, kind: 'statusApplied', side: 'player', unit: 0, status: 'ward', charges: 2, turns: 0 },
      { turn: 2, kind: 'combatEnd', result: 'win', turns: 2 },
    ];
    const log: BattleLog = { events, result: 'win', turns: 2 };
    const lines = allLines(buildBattleTimeline(BASE, log));
    const line = lines.find((l) => l.text.includes('Ward'))!;
    expect(line.detail).toBeDefined();
    expect(line.detail).toContain('2');
    expect(line.detail).toMatch(/poison|burn|bleed|debuff|expose/);
    expect(line.detail).toMatch(/not.*stun|stun.*not/i);
  });

  it('a warded prevention prints a row naming the denied affliction and the charges left', () => {
    // The interpreter returns BEFORE emitting the `statusApplied` the
    // affliction would otherwise have produced — without a case for
    // `warded`, the enemy's own PLAY line was followed by silence, byte-for-
    // byte the same defect `negated` was given a case for.
    const events: CombatEvent[] = [
      { turn: 1, kind: 'play', side: 'enemy', unit: 0, slot: 0, skillId: 'toxic_dart', weight: 5, size: 1, slotIndex: 1, slotCount: 1 },
      { turn: 1, kind: 'warded', side: 'player', unit: 0, status: 'poison', chargesLeft: 2 },
      { turn: 2, kind: 'combatEnd', result: 'win', turns: 2 },
    ];
    const log: BattleLog = { events, result: 'win', turns: 2 };
    const lines = allLines(buildBattleTimeline(BASE, log));
    const wardedLine = lines.find((l) => l.text.includes('prevented'));
    expect(wardedLine, 'the enemy PLAY line must not be followed by silence').toBeDefined();
    expect(wardedLine!.tag).toBe('BUFF');
    expect(wardedLine!.text).toContain('Poison');
    expect(wardedLine!.text).toContain('2 charges left');
  });

  it('singularizes "1 charge left" on the final warded prevention', () => {
    const events: CombatEvent[] = [
      { turn: 1, kind: 'warded', side: 'player', unit: 0, status: 'burn', chargesLeft: 1 },
      { turn: 2, kind: 'combatEnd', result: 'win', turns: 2 },
    ];
    const log: BattleLog = { events, result: 'win', turns: 2 };
    const lines = allLines(buildBattleTimeline(BASE, log));
    const wardedLine = lines.find((l) => l.text.includes('prevented'))!;
    expect(wardedLine.text).toContain('Burn');
    expect(wardedLine.text).toContain('1 charge left');
    expect(wardedLine.text).not.toContain('1 charges left');
  });

  it('prints a BUFF wear-off row when the ward pile empties', () => {
    // Mirrors the thorns wear-off test exactly: no HP-badge clears for ward,
    // so without this row the pile's end is invisible.
    const events: CombatEvent[] = [
      { turn: 1, kind: 'statusApplied', side: 'player', unit: 0, status: 'ward', charges: 1, turns: 0 },
      { turn: 1, kind: 'warded', side: 'player', unit: 0, status: 'poison', chargesLeft: 0 },
      { turn: 1, kind: 'statusExpired', side: 'player', unit: 0, status: 'ward' },
      { turn: 2, kind: 'combatEnd', result: 'win', turns: 2 },
    ];
    const log: BattleLog = { events, result: 'win', turns: 2 };
    const lines = allLines(buildBattleTimeline(BASE, log));
    const woreOff = lines.filter((l) => l.text.includes('Ward wore off'));
    expect(woreOff.length).toBe(1);
    expect(woreOff[0]!.tag).toBe('BUFF');
  });

  it('feeds a held ward pile into the per-unit status bucket, so the HP badge can show it', () => {
    const events: CombatEvent[] = [
      { turn: 1, kind: 'statusApplied', side: 'player', unit: 0, status: 'ward', charges: 2, turns: 0 },
      { turn: 2, kind: 'combatEnd', result: 'win', turns: 2 },
    ];
    const log: BattleLog = { events, result: 'win', turns: 2 };
    const model = buildBattleTimeline(BASE, log);
    const status = model.statusByTurn.get(1);
    expect(status?.player).toContain('ward');
  });

  it('clears the ward key from the status bucket once the pile expires', () => {
    const events: CombatEvent[] = [
      { turn: 1, kind: 'statusApplied', side: 'player', unit: 0, status: 'ward', charges: 1, turns: 0 },
      { turn: 2, kind: 'statusExpired', side: 'player', unit: 0, status: 'ward' },
      { turn: 3, kind: 'combatEnd', result: 'win', turns: 3 },
    ];
    const log: BattleLog = { events, result: 'win', turns: 3 };
    const model = buildBattleTimeline(BASE, log);
    expect(model.statusByTurn.get(1)?.player).toContain('ward');
    expect(model.statusByTurn.get(2)?.player ?? []).not.toContain('ward');
  });
});
