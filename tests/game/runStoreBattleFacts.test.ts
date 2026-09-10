import { afterAll, describe, expect, it } from 'vitest';
import { skillBook } from '../../src/data/skills';
import { biomeFor } from '../../src/run/biome';
import { resolveBattle, type BattleLog } from '../../src/run/resolveBattle';
import type { RunNode } from '../../src/run/runState';
import type { BattleTimelineInput } from '../../src/game/battleTimeline';
import {
  clearRun,
  getActiveRun,
  installDevRunFixture,
  resolveRunBattleResult,
} from '../../src/game/runStore';
import { activeRun, installCurrentNode } from '../fixtures/eventV2';

const WIN: BattleLog = {
  result: 'win',
  turns: 2,
  events: [{
    turn: 1,
    kind: 'skillCast',
    side: 'player',
    unit: 0,
    slot: 0,
    skillId: 'sword_slash',
    span: 1,
    cursorBefore: 0,
    cursorAfter: 1,
    actionKinds: ['damage'],
  }],
};

function input(
  enemyId: string,
  enemyTeam?: BattleTimelineInput['enemyTeam'],
  pieces: BattleTimelineInput['pieces'] = [],
): BattleTimelineInput {
  return {
    pieces,
    heroLevel: 1,
    heroAllocation: {},
    enemyId,
    enemyLevel: 1,
    enemyTitle: 'normal',
    enemyRank: 0,
    enemyModifiers: [],
    ...(enemyTeam === undefined ? {} : { enemyTeam }),
    seed: 99,
  };
}

function ownedBoard(skillIds: readonly string[]): BattleTimelineInput['pieces'] {
  let slot = 0;
  return skillIds.map((skillId, index) => {
    const piece = { instanceId: `card-${index}`, skillId, slot, tier: 'bronze' as const };
    slot += skillBook[skillId]!.size;
    return piece;
  });
}

function resolvedLog(pieces: BattleTimelineInput['pieces']): BattleLog {
  return resolveBattle({
    pieces,
    heroLevel: 1,
    heroAllocation: {},
    foes: [{ enemyId: 'bandit_duelist', level: 1, title: 'normal', rank: 0 }],
    seed: 17,
  });
}

function combatNode(id: string, biomeId?: string): RunNode {
  return {
    id,
    depth: 4,
    wave: 2,
    kind: 'fight',
    fightNumber: 2,
    fightOption: 'standard',
    encounterSeed: 99,
    ...(biomeId === undefined ? {} : { biomeId }),
  };
}

afterAll(() => clearRun());

describe('game/runStore: authoritative battle fact settlement', () => {
  it('persists one fact with the exact non-empty request team roster order', () => {
    const node = combatNode('team-node', 'arrowfell');
    const before = installCurrentNode(activeRun(4), node);
    installDevRunFixture(before);
    const team = [
      { enemyId: 'wolf', level: 2, title: 'normal' as const, rank: 0, modifiers: [] },
      { enemyId: 'mage', level: 2, title: 'normal' as const, rank: 0, modifiers: [] },
      { enemyId: 'wolf', level: 2, title: 'normal' as const, rank: 0, modifiers: [] },
    ];

    resolveRunBattleResult(input('ignored-single', team), WIN);

    const after = getActiveRun()!;
    expect(after.combatFactLedger).toEqual([expect.objectContaining({
      battleId: 'battle:team-node',
      nodeId: 'team-node',
      depth: 4,
      biomeId: 'arrowfell',
      enemyIds: ['wolf', 'mage', 'wolf'],
      result: 'win',
      boss: false,
      turns: 2,
      usedCardIds: ['sword_slash'],
      actionKinds: ['damage'],
    })]);
    expect(after.currentNodeId).toBeNull();
  });

  it('falls back to the single request foe and resolves an unstamped node biome canonically', () => {
    const node = combatNode('single-node');
    const before = installCurrentNode(activeRun(2), node);
    installDevRunFixture(before);

    resolveRunBattleResult(input('solo_enemy', []), WIN);

    const after = getActiveRun()!;
    expect(after.combatFactLedger).toHaveLength(1);
    expect(after.combatFactLedger[0]).toMatchObject({
      battleId: 'battle:single-node',
      enemyIds: ['solo_enemy'],
      biomeId: biomeFor(before.map.seed, node.wave, node.biomeId).id,
    });
  });

  it('persists the exact authoritative affinity emitted by a real resolved same-type board', () => {
    const pieces = ownedBoard(['kindling_rite', 'cinder_dart', 'ember_lash']);
    const node = combatNode('affinity-node', 'emberwaste');
    installDevRunFixture(installCurrentNode({ ...activeRun(6), pieces }, node));

    const log = resolvedLog(pieces);
    expect(log.playerAffinityId).toBe('fire');
    resolveRunBattleResult(input('bandit_duelist', undefined, pieces), log);

    expect(getActiveRun()!.combatFactLedger).toEqual([
      expect.objectContaining({ battleId: 'battle:affinity-node', affinityId: 'fire' }),
    ]);
  });

  it('omits authoritative affinity for a real tied board and does not persist an invented identity', () => {
    // FIXTURE UPDATED 2026-09-06. This used to be 3 Fire + 3 Sword, which was a
    // tie only because element and weapon shared ONE tally. They are counted
    // separately now (affinity is a per-axis passive buff off the board), so
    // that board earns BOTH and is no longer a no-affinity fixture. A genuine
    // tie has to sit INSIDE one axis: 3 Fire vs 3 Frost, no weapon cards at all.
    const pieces = ownedBoard([
      'kindling_rite', 'cinder_dart', 'ember_lash',
      'frost_shackle', 'glacial_spike', 'slow_hex',
    ]);
    const node = combatNode('tied-node', 'arrowfell');
    installDevRunFixture(installCurrentNode({ ...activeRun(7), pieces }, node));

    const log = resolvedLog(pieces);
    expect(log).not.toHaveProperty('playerAffinityId');
    resolveRunBattleResult(input('bandit_duelist', undefined, pieces), log);

    expect(getActiveRun()!.combatFactLedger).toHaveLength(1);
    expect(getActiveRun()!.combatFactLedger[0]).not.toHaveProperty('affinityId');
  });
});
