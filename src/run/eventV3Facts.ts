import type { Action } from '../engine/types';
import type { BattleLog } from './resolveBattle';
import type { RunState } from './runState';

/** One authoritative battle summary persisted for later v3 event eligibility. */
export interface CombatFactLedgerEntry {
  battleId: string;
  nodeId: string;
  depth: number;
  biomeId: string;
  enemyIds: readonly string[];
  result: 'win' | 'loss';
  boss: boolean;
  turns: number;
  affinityId?: string;
  usedCardIds: readonly string[];
  statusKinds: readonly ('burn' | 'poison')[];
  actionKinds: readonly Action['kind'][];
  finisherCardId?: string;
}

export interface RevengeFactRecord {
  battleId: string;
  enemyId: string;
  finisherCardId?: string;
  achievedDepth: number;
  status: 'ready' | 'reserved' | 'consumed';
  reservedByInstanceId?: string;
}

export interface SignatureFactRecord {
  battleId: string;
  cardId: string;
  achievedDepth: number;
  bossFinisher: boolean;
  status: 'ready' | 'reserved' | 'consumed';
  reservedByInstanceId?: string;
}

export interface JourneyFactLedger {
  visitedBiomeIds: readonly string[];
}

export interface EventBindingReservation {
  reservationId: string;
  instanceId: string;
  source: 'revenge' | 'signature';
  sourceBattleId: string;
  subjectId: string;
}

export interface BattleFactSource {
  battleId: string;
  nodeId: string;
  depth: number;
  biomeId: string;
  enemyIds: readonly string[];
  boss: boolean;
  affinityId?: string;
}

function appendUnique<T>(values: T[], value: T): void {
  if (!values.includes(value)) values.push(value);
}

/** Fold one already-resolved authoritative battle log into durable facts. */
export function battleFactFromLog(
  source: BattleFactSource,
  log: BattleLog,
): CombatFactLedgerEntry {
  const usedCardIds: string[] = [];
  const statusKinds: Array<'burn' | 'poison'> = [];
  const actionKinds: Action['kind'][] = [];
  let finisherCardId: string | undefined;

  for (const event of log.events) {
    if (event.kind === 'skillCast' && event.side === 'player') {
      appendUnique(usedCardIds, event.skillId);
      for (const kind of event.actionKinds ?? []) appendUnique(actionKinds, kind);
      continue;
    }
    if (
      event.kind === 'statusApplied'
      && event.side === 'enemy'
      && (event.status === 'burn' || event.status === 'poison')
    ) {
      appendUnique(statusKinds, event.status);
      continue;
    }
    if (
      event.kind === 'damage'
      && event.side === 'enemy'
      && event.hpAfter === 0
      && event.sourceCard?.side === 'player'
    ) {
      finisherCardId = event.sourceCard.skillId;
    }
  }

  return {
    battleId: source.battleId,
    nodeId: source.nodeId,
    depth: source.depth,
    biomeId: source.biomeId,
    enemyIds: [...source.enemyIds],
    result: log.result === 'win' ? 'win' : 'loss',
    boss: source.boss,
    turns: log.turns,
    ...(source.affinityId === undefined ? {} : { affinityId: source.affinityId }),
    usedCardIds,
    statusKinds,
    actionKinds,
    ...(finisherCardId === undefined ? {} : { finisherCardId }),
  };
}

/** Append one battle fact and its win-derived ready facts exactly once. */
export function recordBattleFacts(state: RunState, fact: CombatFactLedgerEntry): RunState {
  if (state.combatFactLedger.some((entry) => entry.battleId === fact.battleId)) return state;

  let revengeFactLedger = state.revengeFactLedger;
  let signatureFactLedger = state.signatureFactLedger;
  if (fact.result === 'win') {
    const revenge: RevengeFactRecord[] = [];
    const seenEnemies: string[] = [];
    for (const enemyId of fact.enemyIds) {
      if (seenEnemies.includes(enemyId)) continue;
      seenEnemies.push(enemyId);
      const avengesLoss = state.combatFactLedger.some(
        (entry) => entry.result === 'loss' && entry.enemyIds.includes(enemyId),
      );
      if (!avengesLoss) continue;
      revenge.push({
        battleId: fact.battleId,
        enemyId,
        ...(fact.finisherCardId === undefined ? {} : { finisherCardId: fact.finisherCardId }),
        achievedDepth: fact.depth,
        status: 'ready',
      });
    }
    if (revenge.length > 0) revengeFactLedger = [...state.revengeFactLedger, ...revenge];

    const signatures: SignatureFactRecord[] = [];
    const seenCards: string[] = [];
    for (const cardId of fact.usedCardIds) {
      if (seenCards.includes(cardId)) continue;
      seenCards.push(cardId);
      signatures.push({
        battleId: fact.battleId,
        cardId,
        achievedDepth: fact.depth,
        bossFinisher: fact.boss && fact.finisherCardId === cardId,
        status: 'ready',
      });
    }
    if (signatures.length > 0) signatureFactLedger = [...state.signatureFactLedger, ...signatures];
  }

  return {
    ...state,
    combatFactLedger: [...state.combatFactLedger, fact],
    revengeFactLedger,
    signatureFactLedger,
  };
}
