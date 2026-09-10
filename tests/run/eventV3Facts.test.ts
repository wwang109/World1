import { describe, expect, it } from 'vitest';
import type { CombatEvent } from '../../src/engine/combat/events';
import { biomeFor } from '../../src/run/biome';
import {
  battleFactFromLog,
  recordBattleFacts,
  type CombatFactLedgerEntry,
} from '../../src/run/eventV3Facts';
import type { BattleLog } from '../../src/run/resolveBattle';
import { leaveEvent, leaveShop, recordBattleResult, type EventCallbackQueueEntry, type RunNode, type RunState } from '../../src/run/runState';
import { activeRun, installCurrentNode } from '../fixtures/eventV2';

type SkillCast = Extract<CombatEvent, { kind: 'skillCast' }>;
type Damage = Extract<CombatEvent, { kind: 'damage' }>;

function cast(
  skillId: string,
  side: 'player' | 'enemy' = 'player',
  actionKinds?: SkillCast['actionKinds'],
): SkillCast {
  return {
    turn: 1,
    kind: 'skillCast',
    side,
    unit: 0,
    slot: 0,
    skillId,
    span: 1,
    cursorBefore: 0,
    cursorAfter: 1,
    ...(actionKinds === undefined ? {} : { actionKinds }),
  };
}

function lethalDamage(skillId: string, sourceSide: 'player' | 'enemy' = 'player'): Damage {
  return {
    turn: 2,
    kind: 'damage',
    side: 'enemy',
    unit: 0,
    amount: 9,
    property: 'physical',
    blocked: 0,
    hpAfter: 0,
    source: 'skill',
    sourceCard: { side: sourceSide, unit: 0, slot: 0, skillId },
  };
}

function fact(overrides: Partial<CombatFactLedgerEntry> = {}): CombatFactLedgerEntry {
  return {
    battleId: 'battle:base',
    nodeId: 'base',
    depth: 1,
    biomeId: 'arrowfell',
    enemyIds: ['wolf'],
    result: 'loss',
    boss: false,
    turns: 3,
    usedCardIds: [],
    statusKinds: [],
    actionKinds: [],
    ...overrides,
  };
}

describe('run/eventV3Facts: authoritative BattleLog folding', () => {
  it('folds only emitted player casts, applied enemy ailments, reached actions, and the last sourced lethal hit', () => {
    const enemyIds = ['wolf', 'wolf', 'mage'];
    const reachedKinds: Array<NonNullable<SkillCast['actionKinds']>[number]> = ['damage', 'poison', 'damage'];
    const events: CombatEvent[] = [
      cast('enemy_card', 'enemy', ['burn']),
      cast('card_a', 'player', reachedKinds),
      { turn: 1, kind: 'statusApplied', side: 'enemy', unit: 0, status: 'burn', stacks: 4, turns: 3 },
      { turn: 1, kind: 'statusApplied', side: 'player', unit: 0, status: 'poison', stacks: 2, turns: 2 },
      cast('card_a', 'player', ['shield']),
      cast('card_b', 'player', ['shield', 'poison']),
      { turn: 2, kind: 'statusApplied', side: 'enemy', unit: 1, status: 'bleed', stacks: 3, turns: 3 },
      { turn: 2, kind: 'statusApplied', side: 'enemy', unit: 1, status: 'poison', stacks: 3, turns: 3 },
      lethalDamage('old_finisher'),
      { ...lethalDamage('enemy_self_kill', 'enemy'), turn: 3 },
      { ...lethalDamage('card_b'), turn: 4 },
    ];
    const log: BattleLog = { events, result: 'win', turns: 4 };
    const source = {
      battleId: 'battle:d4-0', nodeId: 'd4-0', depth: 4, biomeId: 'arrowfell',
      enemyIds, boss: true, affinityId: 'bow',
    };
    const sourceBefore = structuredClone(source);
    const eventsBefore = structuredClone(events);

    const folded = battleFactFromLog(source, log);

    expect(folded).toEqual({
      battleId: 'battle:d4-0',
      nodeId: 'd4-0',
      depth: 4,
      biomeId: 'arrowfell',
      enemyIds: ['wolf', 'wolf', 'mage'],
      result: 'win',
      boss: true,
      turns: 4,
      affinityId: 'bow',
      usedCardIds: ['card_a', 'card_b'],
      statusKinds: ['burn', 'poison'],
      actionKinds: ['damage', 'poison', 'shield'],
      finisherCardId: 'card_b',
    });
    expect(source).toEqual(sourceBefore);
    expect(events).toEqual(eventsBefore);
    expect(folded.enemyIds).not.toBe(enemyIds);
    enemyIds[0] = 'changed';
    reachedKinds[0] = 'heal';
    expect(folded.enemyIds).toEqual(['wolf', 'wolf', 'mage']);
    expect(folded.actionKinds).toEqual(['damage', 'poison', 'shield']);
  });

  it('maps a loss authoritatively and never infers a finisher from a cast or non-player source', () => {
    const log: BattleLog = {
      result: 'loss',
      turns: 7,
      events: [cast('mere_cast'), lethalDamage('enemy_owned', 'enemy')],
    };

    const folded = battleFactFromLog({
      battleId: 'battle:loss', nodeId: 'loss', depth: 6, biomeId: 'swornhold',
      enemyIds: ['knight'], boss: false,
    }, log);
    expect(folded).toMatchObject({
      result: 'loss', turns: 7, usedCardIds: ['mere_cast'],
    });
    expect(folded).not.toHaveProperty('finisherCardId');
  });
});

describe('run/eventV3Facts: immutable one-way fact ledgers', () => {
  it('returns the identical state for a duplicate battle id even when the second fact differs', () => {
    const base = activeRun();
    const first = recordBattleFacts(base, fact());
    const firstSnapshot = structuredClone(first);
    const duplicate = recordBattleFacts(first, fact({ result: 'win', enemyIds: ['different'], usedCardIds: ['other'] }));

    expect(duplicate).toBe(first);
    expect(first).toEqual(firstSnapshot);
    expect(base.combatFactLedger).toEqual([]);
  });

  it('creates ready revenge records once per distinct winning-roster enemy with an earlier loss', () => {
    const reserved = {
      battleId: 'battle:reserved', enemyId: 'kept', achievedDepth: 1,
      status: 'reserved' as const, reservedByInstanceId: 'event:1',
    };
    let state: RunState = { ...activeRun(), revengeFactLedger: [reserved] };
    state = recordBattleFacts(state, fact({ battleId: 'battle:l1', enemyIds: ['wolf', 'mage'] }));
    state = recordBattleFacts(state, fact({ battleId: 'battle:l2', enemyIds: ['wolf'] }));
    state = recordBattleFacts(state, fact({
      battleId: 'battle:win', nodeId: 'win', result: 'win', depth: 9,
      enemyIds: ['mage', 'new_enemy', 'wolf', 'mage'], finisherCardId: 'finisher',
    }));

    expect(state.revengeFactLedger[0]).toBe(reserved);
    expect(state.revengeFactLedger.slice(1)).toEqual([
      { battleId: 'battle:win', enemyId: 'mage', finisherCardId: 'finisher', achievedDepth: 9, status: 'ready' },
      { battleId: 'battle:win', enemyId: 'wolf', finisherCardId: 'finisher', achievedDepth: 9, status: 'ready' },
    ]);
  });

  it('creates separate per-win signature records and marks only the actual boss finisher card', () => {
    let state = activeRun();
    state = recordBattleFacts(state, fact({ battleId: 'battle:loss', usedCardIds: ['card_a'] }));
    expect(state.signatureFactLedger).toEqual([]);

    state = recordBattleFacts(state, fact({
      battleId: 'battle:boss', result: 'win', boss: true, depth: 10,
      usedCardIds: ['card_a', 'card_b', 'card_a'], finisherCardId: 'card_b',
    }));
    state = recordBattleFacts(state, fact({
      battleId: 'battle:later', result: 'win', boss: false, depth: 12,
      usedCardIds: ['card_a', 'card_b'], finisherCardId: 'card_a',
    }));

    expect(state.signatureFactLedger).toEqual([
      { battleId: 'battle:boss', cardId: 'card_a', achievedDepth: 10, bossFinisher: false, status: 'ready' },
      { battleId: 'battle:boss', cardId: 'card_b', achievedDepth: 10, bossFinisher: true, status: 'ready' },
      { battleId: 'battle:later', cardId: 'card_a', achievedDepth: 12, bossFinisher: false, status: 'ready' },
      { battleId: 'battle:later', cardId: 'card_b', achievedDepth: 12, bossFinisher: false, status: 'ready' },
    ]);
  });
});

describe('run/runState: shared committed-node facts', () => {
  const nodes: RunNode[] = [
    { id: 'visit-fight', depth: 4, wave: 2, kind: 'fight', fightNumber: 2, fightOption: 'standard', encounterSeed: 1, biomeId: 'arrowfell' },
    { id: 'visit-shop', depth: 5, wave: 3, kind: 'shop', shopId: 'shelter', shopSeed: 2, biomeId: 'swornhold' },
    { id: 'visit-event', depth: 6, wave: 3, kind: 'event', eventSeed: 3, eventTheme: 'cache', biomeId: 'emberwaste' },
    { id: 'visit-repeat', depth: 7, wave: 4, kind: 'shop', shopId: 'shelter', shopSeed: 4, biomeId: 'arrowfell' },
  ];

  it('records first canonical biome visits for battle, shop, and event before preserving callback sweep behavior', () => {
    const expired: EventCallbackQueueEntry = {
      callbackInstanceId: 'callback:expired', callbackId: 'expired', eventId: 'expired', contentVersion: 1,
      scheduledDepth: 1, earliestDepth: 1, minDepthDelay: 0, destinationThemes: ['cache'], priority: 1,
      boundSubjects: {}, expiry: { expiresAfterNodes: 0, fallback: 'discard' },
    };
    let state = activeRun();
    state = recordBattleResult(installCurrentNode(state, nodes[0]!), { won: true, goldEarned: 0 });
    state = leaveShop(installCurrentNode(state, nodes[1]!));
    state = leaveEvent(installCurrentNode({ ...state, eventCallbackQueue: [expired] }, nodes[2]!));
    state = leaveShop(installCurrentNode(state, nodes[3]!));

    expect(state.journeyFactLedger.visitedBiomeIds).toEqual(['arrowfell', 'swornhold', 'emberwaste']);
    expect(state.eventCallbackQueue).toEqual([]);
    expect(state.currentNodeId).toBeNull();
    expect(biomeFor(state.map.seed, nodes[0]!.wave, nodes[0]!.biomeId).id).toBe('arrowfell');
  });

  it('rejects a contradictory battle outcome and fact before mutating settlement state', () => {
    const before = installCurrentNode(activeRun(), nodes[0]!);
    const snapshot = structuredClone(before);

    expect(() => recordBattleResult(before, {
      won: true,
      goldEarned: 3,
      battleFact: fact({ battleId: 'battle:visit-fight', result: 'loss' }),
    })).toThrow(/battle fact result/i);
    expect(before).toEqual(snapshot);
  });
});
