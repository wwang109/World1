import { hashSeed } from '../../engine/rng';
import { resolveBattle } from '../resolveBattle';
import { nodeById, recordBattleResult, rollEncounter, type RunState } from '../runState';
import { mapFightGoldReward } from '../shop';
import { battleStatsFromEvents } from '../logAnalysis';
import { battleFactFromLog } from '../eventV3Facts';
import { biomeFor } from '../biome';
import { ghostBandOf, ghostToBattlePieces } from '../ghost';
import { recordChallengeFightResult } from '../eventsV3';
import { recordExtraGhostFightResult, offerGhostSavePrompt, markGhostResultReported, ghostResultReportKey } from '../ghostMatch';
import { awardBattleEquipment, awardCompletedEventEquipment } from '../equipmentLoot';
import { recordRunHistoryTransition } from '../runHistory';
import type { EncounterRecord, RevisionKey, TrustedRunInputs, ResolvedTransition, RunEffect } from './types';

export function issueEncounter(state: RunState, key: RevisionKey, inputs: TrustedRunInputs): EncounterRecord {
  if (state.status !== 'active' || state.held || state.pieces.length === 0) throw new Error('Run is not ready for combat');
  const common = { pieces: state.pieces, heroLevel: state.heroLevel, heroAllocation: state.heroAllocation,
    heroPurchasedStats: state.purchasedStats, heroEquipment: state.equippedEquipment ?? [] };
  let role: EncounterRecord['role'], request: EncounterRecord['preparation']['request'];
  const challenge = state.activeChallengeFight;
  if (challenge) {
    role = 'challenge';
    request = { ...common, foes: [{ enemyId: challenge.enemyId, level: challenge.level, title: challenge.title, rank: challenge.rank,
      fightNumber: challenge.fightNumber, bumped: challenge.bumped, modifiers: challenge.modifiers }],
      seed: hashSeed(state.map.seed, 'challengeFight-battle', challenge.instanceId, challenge.choiceId) };
  } else {
    const ghost = state.activeGhostFight;
    const nodeId = ghost?.role === 'extra' ? ghost.nodeId : state.currentNodeId;
    const node = nodeId ? nodeById(state, nodeId) : undefined;
    if (!node || (node.kind !== 'fight' && node.kind !== 'boss')) throw new Error('No canonical encounter is pending');
    role = ghost?.role === 'extra' ? 'extra' : node.kind === 'boss' ? 'boss' : 'regular';
    const pack = rollEncounter({ ...state, currentNodeId: node.id });
    const units = role === 'extra' ? pack.units.slice(0, 1) : pack.units;
    request = { ...common, foes: units.map((unit, index) => ({ enemyId: unit.enemyId, level: unit.level,
      title: unit.title, rank: unit.baseRank, growthLevel: unit.growthLevel, fightNumber: node.fightNumber,
      bumped: unit.bumped, modifiers: unit.modifiers, ...(index === 0 && ghost ? { ghost: ghostToBattlePieces(ghost.ghost) } : { affix: unit.affix }) })), seed: node.encounterSeed! };
  }
  return { id: inputs.encounterId, runId: inputs.runId, stateRevision: inputs.revision + 1, key, role,
    rewardClass: role === 'boss' || request.foes.some(foe => foe.title === 'boss') ? 'boss' : 'none', status: 'pending',
    preparation: { request, preparation: { heroPieceRefs: state.pieces.map(piece => ({ slot: piece.slot, pieceRef: piece.instanceId })) } } };
}
export function resolveEncounter(state: RunState, encounter: EncounterRecord): ResolvedTransition {
  if (encounter.status !== 'pending') throw new Error('Encounter already settled');
  const log = resolveBattle(encounter.preparation.request, encounter.preparation.preparation);
  const won = log.result === 'win';
  const effects: RunEffect[] = [];
  const ghost = state.activeGhostFight;
  let next: RunState;
  if (encounter.role === 'challenge') {
    const fight = state.activeChallengeFight;
    if (!fight) throw new Error('Challenge is no longer active');
    next = awardBattleEquipment(recordChallengeFightResult(state, won).state, `challenge:${fight.instanceId}:${fight.choiceId}`, [fight.enemyId], won);
  } else if (encounter.role === 'extra') {
    if (!ghost || ghost.role !== 'extra') throw new Error('Extra encounter is no longer active');
    next = awardBattleEquipment(recordExtraGhostFightResult(state, won).state, `ghost:${ghost.nodeId}:extra`, ['ghost'], won);
  } else {
    const node = state.currentNodeId ? nodeById(state, state.currentNodeId) : undefined;
    if (!node) throw new Error('Run encounter is no longer active');
    const reward = mapFightGoldReward(node.fightOption, node.kind === 'boss');
    const enemyIds = encounter.preparation.request.foes.map(foe => foe.enemyId);
    const battleFact = battleFactFromLog({ battleId: `battle:${node.id}`, nodeId: node.id, depth: node.depth,
      biomeId: biomeFor(state.map.seed, node.wave, node.biomeId).id, enemyIds, boss: node.kind === 'boss',
      ...(log.playerAffinityId === undefined ? {} : { affinityId: log.playerAffinityId }) }, log);
    const result = recordBattleResult(state, { won, goldEarned: won ? reward.base + reward.winBonus : 0,
      ...battleStatsFromEvents(log.events), battleFact });
    next = awardBattleEquipment(result.state, battleFact.battleId, enemyIds, won);
    if (result.bossReward) {
      next = offerGhostSavePrompt(next, node.id, node.fightNumber!, ghostBandOf(node.fightNumber!));
      effects.push({ kind: 'ghostLookup', role: 'extra', nodeId: node.id, band: ghostBandOf(node.fightNumber!) });
    }
  }
  if (ghost) {
    const sourceKey = ghostResultReportKey(ghost.nodeId, ghost.role);
    next = markGhostResultReported(next, sourceKey);
    effects.push({ kind: 'ghostReport', ghostId: ghost.ghost.id, won: !won, sourceKey });
  }
  next = recordRunHistoryTransition(state, awardCompletedEventEquipment(state, next));
  return { state: next, effects, log, won, encounterId: encounter.id };
}
