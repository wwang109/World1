import type {
  EventBindingSpecV3,
  EventBoundSubjectsV3,
  EventMonoTypeBindingValueV3,
  EventOwnedCardCountArgsV3,
  EventOwnedCardMatchV3,
  EventOwnedGemCountArgsV3,
  EventRequirementV3,
  EventStoryFlagArgsV3,
} from '../data/eventContentV3';
import { biomeIds } from '../data/biomes';
import { enemies } from '../data/enemies';
import { enemyDerivedAffinity } from '../data/enemyAffinity';
import { gemBook } from '../data/gems';
import { skillBook } from '../data/skills';
import { boardAffinities } from '../engine/combat/typeIdentity';
import { hashSeed } from '../engine/rng';
import { tierAtLeast } from '../engine/types';
import type { Gem } from '../engine/types';
import { biomeFor } from './biome';
import type {
  EventBindingReservation,
  RevengeFactRecord,
  SignatureFactRecord,
} from './eventV3Facts';
import type { RunNode } from './runMap';
import type { RunCard, RunState } from './runState';

export interface EventEligibilityContextV3 {
  state: RunState;
  node: RunNode;
}

export type EventBindResultV3 =
  | { ok: true; state: RunState; boundSubjects: Readonly<EventBoundSubjectsV3> }
  | { ok: false; state: RunState; reason: 'no-subject' | 'empty-biome-candidates' | 'already-reserved' };

function numericComparison(actual: number, op: 'eq' | 'gte' | 'lte', expected: number): boolean {
  if (op === 'eq') return actual === expected;
  if (op === 'gte') return actual >= expected;
  return actual <= expected;
}

function uniqueCount(values: readonly string[]): number {
  const unique: string[] = [];
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index]!;
    if (!unique.includes(value)) unique.push(value);
  }
  return unique.length;
}

function tallyValue(state: RunState, stat: Extract<EventRequirementV3, { fact: 'run.tally' }>['args']['stat']): number {
  switch (stat) {
    case 'wins': return state.wins;
    case 'losses': return state.losses;
    case 'bossesCleared': return state.bossesCleared;
    case 'goldSpent': return state.stats.goldSpent;
    case 'cardsBought': return state.stats.cardsBought;
    case 'gemsBought': return state.stats.gemsBought;
    case 'livesLost': return state.stats.livesLost;
  }
}

function storyFlagMet(state: RunState, args: EventStoryFlagArgsV3): boolean {
  const actual = state.storyStateV3[args.key];
  if (args.op === 'in') return (args.value as readonly unknown[]).includes(actual);
  return args.op === 'eq' ? actual === args.value : actual !== args.value;
}

function selectedCards(state: RunState, where: EventOwnedCardCountArgsV3['where']): RunCard[] {
  const cards: RunCard[] = [];
  const seenInstanceIds: string[] = [];
  const append = (card: RunCard | null | undefined): void => {
    if (card === null || card === undefined || seenInstanceIds.includes(card.instanceId)) return;
    seenInstanceIds.push(card.instanceId);
    cards.push(card);
  };
  if (where === 'board' || where === 'any') {
    const board = [...state.pieces].sort((left, right) => left.slot - right.slot);
    for (let index = 0; index < board.length; index += 1) append(board[index]);
  }
  if (where === 'bag' || where === 'any') {
    for (let index = 0; index < state.bagSlots.length; index += 1) append(state.bagSlots[index]);
  }
  if (where === 'held' || where === 'any') append(state.held);
  return cards;
}

function cardMatches(card: RunCard, match: EventOwnedCardMatchV3): boolean {
  if (match.cardIds !== undefined && !match.cardIds.includes(card.skillId)) return false;
  const skill = skillBook[card.skillId];
  if (match.weapons !== undefined
    && (skill?.weapon === undefined || !match.weapons.includes(skill.weapon))) return false;
  if (match.elements !== undefined
    && (skill?.element === undefined || !match.elements.includes(skill.element))) return false;
  if (match.archetypes !== undefined
    && (skill === undefined || !match.archetypes.some((value) => skill.archetypes.includes(value)))) return false;
  return true;
}

export function ownedCardsMatchingV3(
  state: RunState,
  where: EventOwnedCardCountArgsV3['where'],
  match: EventOwnedCardMatchV3,
): readonly RunCard[] {
  return selectedCards(state, where).filter((card) => cardMatches(card, match));
}

function ownedCardCount(state: RunState, args: EventOwnedCardCountArgsV3): number {
  const cards = ownedCardsMatchingV3(state, args.where, args.match);
  let count = 0;
  for (let index = 0; index < cards.length; index += 1) {
    if (args.tierAtLeast === undefined || tierAtLeast(cards[index]!.tier, args.tierAtLeast)) count += 1;
  }
  return count;
}

function selectedGems(state: RunState, where: EventOwnedGemCountArgsV3['where']): Gem[] {
  const gems: Gem[] = [];
  if (where === 'pouch' || where === 'any') {
    for (let index = 0; index < state.gemInventory.length; index += 1) {
      const gem = gemBook[state.gemInventory[index]!];
      if (gem !== undefined) gems.push(gem);
    }
  }
  if (where === 'socketed' || where === 'any') {
    for (let index = 0; index < state.pieces.length; index += 1) {
      const gem = state.pieces[index]!.gem;
      if (gem !== null && gem !== undefined) gems.push(gem);
    }
  }
  return gems;
}

function gemMatches(gem: Gem, args: EventOwnedGemCountArgsV3): boolean {
  const { match } = args;
  if (match.gemIds !== undefined && !match.gemIds.includes(gem.id)) return false;
  if (match.actionKinds !== undefined
    && (gem.kind !== 'effect'
      || !match.actionKinds.some((kind) => gem.actions.some((action) => action.kind === kind)))) return false;
  if (match.heroStats !== undefined
    && (gem.kind !== 'stat'
      || gem.scope !== 'hero'
      || !match.heroStats.some((stat) => Object.prototype.hasOwnProperty.call(gem.mods.hero ?? {}, stat)))) return false;
  return true;
}

function ownedGemCount(state: RunState, args: EventOwnedGemCountArgsV3): number {
  const gems = selectedGems(state, args.where);
  let count = 0;
  for (let index = 0; index < gems.length; index += 1) {
    if (gemMatches(gems[index]!, args)) count += 1;
  }
  return count;
}

function isRequestedWin(
  fact: RunState['combatFactLedger'][number],
  result: 'win' | 'bossWin',
  biomeId?: string,
): boolean {
  return fact.result === 'win'
    && (result === 'win' || fact.boss)
    && (biomeId === undefined || fact.biomeId === biomeId);
}

function signatureReady(state: RunState, winsAtLeast: number): boolean {
  const groups: Array<{ cardId: string; wins: number; bossFinisher: boolean }> = [];
  for (let index = 0; index < state.signatureFactLedger.length; index += 1) {
    const record = state.signatureFactLedger[index]!;
    if (record.status !== 'ready') continue;
    let group = groups.find((candidate) => candidate.cardId === record.cardId);
    if (group === undefined) {
      group = { cardId: record.cardId, wins: 0, bossFinisher: false };
      groups.push(group);
    }
    group.wins += 1;
    if (record.bossFinisher) group.bossFinisher = true;
  }
  return groups.some((group) => group.wins >= winsAtLeast && group.bossFinisher);
}

export function eventRequirementMetV3(
  context: EventEligibilityContextV3,
  requirement: EventRequirementV3,
): boolean {
  const { state, node } = context;
  if ('all' in requirement) {
    return requirement.all.every((entry) => eventRequirementMetV3(context, entry));
  }
  if ('any' in requirement) {
    return requirement.any.some((entry) => eventRequirementMetV3(context, entry));
  }
  if ('not' in requirement) return !eventRequirementMetV3(context, requirement.not);

  switch (requirement.fact) {
    case 'wallet.current':
      return numericComparison(state.gold, requirement.args.op, requirement.args.value);
    case 'lives.current':
      return numericComparison(state.lives, requirement.args.op, requirement.args.value);
    case 'node.depth':
      return numericComparison(node.depth, requirement.args.op, requirement.args.value);
    case 'node.wave':
      return numericComparison(node.wave, requirement.args.op, requirement.args.value);
    case 'run.tally':
      return numericComparison(
        tallyValue(state, requirement.args.stat),
        requirement.args.op,
        requirement.args.value,
      );
    case 'event.choice':
      return Object.values(state.eventResolutions ?? {}).some((resolution) => (
        resolution.eventId === requirement.args.eventId
        && (requirement.args.choiceIds === undefined
          || requirement.args.choiceIds.includes(resolution.choiceId))
      ));
    case 'story.flag':
      return storyFlagMet(state, requirement.args);
    case 'chain.completed':
      return (state.completedStoryIds ?? []).includes(requirement.args.storyId);
    case 'biome.current':
      return requirement.args.ids.includes(biomeFor(state.map.seed, node.wave, node.biomeId).id);
    case 'board.affinity': {
      // TWO AXES, CHECKED SEPARATELY (2026-09-06 ruling: "if they meet the
      // requirements they should have the affinity effect"). A board can hold
      // BOTH an element affinity and a weapon affinity at once (3 fire + 3
      // sword), and `requirement.args.affinityId` is one id from either axis
      // (`WeaponType | Element`, disjoint string sets — no id is ever both).
      // The old `boardTypeIdentity(...)?.type ===` read only the element-first
      // COLLAPSE, so a player who earned sword via `board.affinity: sword`
      // was refused whenever the same board also carried an element lean.
      // Matching against `boardAffinities` directly checks whichever axis
      // this id belongs to, honouring both.
      const skills = state.pieces
        .map((piece) => skillBook[piece.skillId])
        .filter((skill) => skill !== undefined);
      const affinities = boardAffinities(skills);
      return affinities.element === requirement.args.affinityId || affinities.weapon === requirement.args.affinityId;
    }
    case 'board.isMonoType':
      return monoTypeBinding(state)?.typeKind === requirement.args.typeKind;
    case 'owned.card.count':
      return ownedCardCount(state, requirement.args) >= requirement.args.count;
    case 'owned.gem.count':
      return ownedGemCount(state, requirement.args) >= requirement.args.count;
    case 'combat.enemyDefeated': {
      let count = 0;
      for (let factIndex = 0; factIndex < state.combatFactLedger.length; factIndex += 1) {
        const fact = state.combatFactLedger[factIndex]!;
        if (fact.result !== 'win') continue;
        for (let enemyIndex = 0; enemyIndex < fact.enemyIds.length; enemyIndex += 1) {
          const enemyId = fact.enemyIds[enemyIndex]!;
          // `enemies[enemyId].weaponAffinity` is no longer authored (2026-09-06
          // ruling: affinity is board-derived only) — `enemyDerivedAffinity`
          // recomputes the same thing combat itself derives from the enemy's
          // own pieces.
          const defeated = enemies[enemyId];
          if ('enemyId' in requirement.args
            ? enemyId === requirement.args.enemyId
            : (defeated === undefined ? undefined : enemyDerivedAffinity(defeated).weaponAffinity) === requirement.args.weaponAffinity) count += 1;
        }
      }
      return count >= requirement.args.atLeast;
    }
    case 'combat.biomeBossDefeated':
      return state.combatFactLedger.some((fact) => (
        fact.result === 'win' && fact.boss && fact.biomeId === requirement.args.biomeId
      ));
    case 'combat.affinityWin': {
      let count = 0;
      for (let index = 0; index < state.combatFactLedger.length; index += 1) {
        const fact = state.combatFactLedger[index]!;
        if (fact.result === 'win'
          && fact.affinityId === requirement.args.affinityId
          && (requirement.args.biomeId === undefined || fact.biomeId === requirement.args.biomeId)) count += 1;
      }
      return count >= requirement.args.atLeast;
    }
    case 'combat.statusUsed':
      return state.combatFactLedger.some((fact) => (
        isRequestedWin(fact, requirement.args.result, requirement.args.biomeId)
        && fact.statusKinds.includes(requirement.args.status)
      ));
    case 'combat.actionKindUsed':
      return state.combatFactLedger.some((fact) => (
        isRequestedWin(fact, requirement.args.result, requirement.args.biomeId)
        && fact.actionKinds.includes(requirement.args.actionKind)
      ));
    case 'combat.fastWin':
      return state.combatFactLedger.some((fact) => (
        fact.result === 'win'
        && fact.turns <= requirement.args.maxTurns
        && (requirement.args.element === undefined || fact.affinityId === requirement.args.element)
      ));
    case 'combat.recentLoss':
      return state.combatFactLedger.some((fact) => (
        fact.result === 'loss'
        && fact.depth <= node.depth
        && node.depth - fact.depth <= requirement.args.withinDepth
      ));
    case 'combat.noLossesInBiome':
      return !state.combatFactLedger.some((fact) => (
        fact.result === 'loss' && fact.biomeId === requirement.args.biomeId
      ));
    case 'combat.revengeReady':
      return state.revengeFactLedger.some((record) => record.status === 'ready');
    case 'combat.signatureReady':
      return signatureReady(state, requirement.args.winsAtLeast);
    case 'journey.visitedBiomes':
      return uniqueCount(state.journeyFactLedger.visitedBiomeIds) >= requirement.args.value;
    case 'journey.completedChains':
      return uniqueCount(state.completedStoryIds ?? []) >= requirement.args.value;
    case 'callback.queued':
      return state.eventCallbackQueue.some((callback) => callback.callbackId === requirement.args.callbackId);
  }
}

export function monoTypeBinding(state: RunState): EventMonoTypeBindingValueV3 | undefined {
  if (state.pieces.length === 0) return undefined;
  let weapon: EventMonoTypeBindingValueV3 & { typeKind: 'weapon' } | undefined;
  let element: EventMonoTypeBindingValueV3 & { typeKind: 'element' } | undefined;
  let weaponQualifies = true;
  let elementQualifies = true;
  for (let index = 0; index < state.pieces.length; index += 1) {
    const skill = skillBook[state.pieces[index]!.skillId];
    if (skill?.weapon === undefined) {
      weaponQualifies = false;
    } else if (weapon === undefined) {
      weapon = { typeKind: 'weapon', type: skill.weapon };
    } else if (weapon.type !== skill.weapon) {
      weaponQualifies = false;
    }
    if (skill?.element === undefined) {
      elementQualifies = false;
    } else if (element === undefined) {
      element = { typeKind: 'element', type: skill.element };
    } else if (element.type !== skill.element) {
      elementQualifies = false;
    }
  }
  if (weaponQualifies && weapon !== undefined) return weapon;
  if (elementQualifies && element !== undefined) return element;
  return undefined;
}

function revengeBefore(left: RevengeFactRecord, right: RevengeFactRecord): boolean {
  if (left.achievedDepth !== right.achievedDepth) return left.achievedDepth < right.achievedDepth;
  if (left.enemyId !== right.enemyId) return left.enemyId < right.enemyId;
  return left.battleId < right.battleId;
}

function signatureBefore(left: SignatureFactRecord, right: SignatureFactRecord): boolean {
  if (left.achievedDepth !== right.achievedDepth) return left.achievedDepth < right.achievedDepth;
  if (left.cardId !== right.cardId) return left.cardId < right.cardId;
  return left.battleId < right.battleId;
}

function reservationMatches(
  reservation: EventBindingReservation,
  source: EventBindingReservation['source'],
  battleId: string,
  subjectId: string,
): boolean {
  return reservation.source === source
    && reservation.sourceBattleId === battleId
    && reservation.subjectId === subjectId;
}

function selectedRevengeIndex(state: RunState): number {
  let selected = -1;
  for (let index = 0; index < state.revengeFactLedger.length; index += 1) {
    const record = state.revengeFactLedger[index]!;
    if (record.status !== 'ready'
      || state.eventBindingReservations.some((reservation) => (
        reservationMatches(reservation, 'revenge', record.battleId, record.enemyId)
      ))) continue;
    if (selected === -1 || revengeBefore(record, state.revengeFactLedger[selected]!)) selected = index;
  }
  return selected;
}

function selectedSignatureIndex(state: RunState, winsAtLeast?: number): number {
  const qualifiedCardIds: string[] = [];
  if (winsAtLeast !== undefined) {
    const groups: Array<{ cardId: string; wins: number; bossFinisher: boolean }> = [];
    for (let index = 0; index < state.signatureFactLedger.length; index += 1) {
      const record = state.signatureFactLedger[index]!;
      if (record.status !== 'ready') continue;
      let group = groups.find((candidate) => candidate.cardId === record.cardId);
      if (group === undefined) {
        group = { cardId: record.cardId, wins: 0, bossFinisher: false };
        groups.push(group);
      }
      group.wins += 1;
      if (record.bossFinisher) group.bossFinisher = true;
    }
    for (const group of groups) {
      if (group.wins >= winsAtLeast && group.bossFinisher) qualifiedCardIds.push(group.cardId);
    }
  }
  let selected = -1;
  for (let index = 0; index < state.signatureFactLedger.length; index += 1) {
    const record = state.signatureFactLedger[index]!;
    if (record.status !== 'ready'
      || (winsAtLeast !== undefined && !qualifiedCardIds.includes(record.cardId))
      || state.eventBindingReservations.some((reservation) => (
        reservationMatches(reservation, 'signature', record.battleId, record.cardId)
      ))) continue;
    if (selected === -1 || signatureBefore(record, state.signatureFactLedger[selected]!)) selected = index;
  }
  return selected;
}

interface SignatureGateAnalysis {
  readonly winsAtLeast: readonly number[];
  readonly branchOnly: boolean;
}

function analyzeSignatureGate(
  requirement: EventRequirementV3,
  underNot = false,
  underAny = false,
): SignatureGateAnalysis {
  if ('fact' in requirement) {
    return requirement.fact === 'combat.signatureReady' && !underNot
      ? { winsAtLeast: [requirement.args.winsAtLeast], branchOnly: underAny }
      : { winsAtLeast: [], branchOnly: false };
  }
  if ('not' in requirement) return analyzeSignatureGate(requirement.not, true, underAny);
  const isAny = 'any' in requirement;
  const children = isAny ? requirement.any : requirement.all;
  return children.reduce<SignatureGateAnalysis>((result, child) => {
    const analysis = analyzeSignatureGate(child, underNot, underAny || isAny);
    return {
      winsAtLeast: [...result.winsAtLeast, ...analysis.winsAtLeast],
      branchOnly: result.branchOnly || analysis.branchOnly,
    };
  }, { winsAtLeast: [], branchOnly: false });
}

function signatureWinsAtLeastFromRequirement(requirement: EventRequirementV3): number | undefined {
  const analysis = analyzeSignatureGate(requirement);
  return analysis.winsAtLeast.length === 1 && !analysis.branchOnly
    ? analysis.winsAtLeast[0]
    : undefined;
}

function reservationId(
  instanceId: string,
  source: EventBindingReservation['source'],
  sourceBattleId: string,
  subjectId: string,
): string {
  return `event-binding-reservation:${JSON.stringify([instanceId, source, sourceBattleId, subjectId])}`;
}

type MutableBoundSubjectsV3 = {
  -readonly [TKey in keyof EventBoundSubjectsV3]: EventBoundSubjectsV3[TKey];
};

export function bindEventV3(
  state: RunState,
  instanceId: string,
  bindings: readonly EventBindingSpecV3[],
  node: RunNode,
  eligibility?: EventRequirementV3,
): EventBindResultV3 {
  const committed = state.eventInstances[node.id];
  if (committed === undefined || committed.instanceId !== instanceId) {
    return { ok: false, state, reason: 'no-subject' };
  }
  if (committed.boundSubjects !== undefined) {
    return { ok: true, state, boundSubjects: committed.boundSubjects };
  }
  const materialization = state.eventMaterializations[instanceId];
  if (materialization?.eventInstanceId === instanceId) {
    return { ok: true, state, boundSubjects: materialization.boundSubjects };
  }
  if (state.eventBindingReservations.some((reservation) => reservation.instanceId === instanceId)
    || state.revengeFactLedger.some((record) => record.reservedByInstanceId === instanceId)
    || state.signatureFactLedger.some((record) => record.reservedByInstanceId === instanceId)) {
    return { ok: false, state, reason: 'already-reserved' };
  }

  const needsRevenge = bindings.some((binding) => binding.source === 'revenge.enemyId'
    || binding.source === 'revenge.finisherCardId');
  const needsRequiredRevengeFinisher = bindings.some((binding) => (
    binding.source === 'revenge.finisherCardId' && binding.optional !== true
  ));
  const needsSignature = bindings.some((binding) => binding.source === 'signature.cardId');
  const needsMonoType = bindings.some((binding) => binding.source === 'board.monoType');
  const needsFutureBiome = bindings.some((binding) => binding.source === 'journey.futureBiome');

  const revengeIndex = needsRevenge ? selectedRevengeIndex(state) : -1;
  if (needsRevenge && revengeIndex === -1) return { ok: false, state, reason: 'no-subject' };
  const revenge = revengeIndex === -1 ? undefined : state.revengeFactLedger[revengeIndex]!;
  if (needsRequiredRevengeFinisher && revenge?.finisherCardId === undefined) {
    return { ok: false, state, reason: 'no-subject' };
  }

  const signatureWinsAtLeast = needsSignature && eligibility !== undefined
    ? signatureWinsAtLeastFromRequirement(eligibility)
    : undefined;
  if (needsSignature && signatureWinsAtLeast === undefined) {
    return { ok: false, state, reason: 'no-subject' };
  }
  const signatureIndex = needsSignature ? selectedSignatureIndex(state, signatureWinsAtLeast) : -1;
  if (needsSignature && signatureIndex === -1) return { ok: false, state, reason: 'no-subject' };
  const signature = signatureIndex === -1 ? undefined : state.signatureFactLedger[signatureIndex]!;

  const monoType = needsMonoType ? monoTypeBinding(state) : undefined;
  if (needsMonoType && monoType === undefined) return { ok: false, state, reason: 'no-subject' };

  let destinationBiome: string | undefined;
  if (needsFutureBiome) {
    const currentBiomeId = biomeFor(state.map.seed, node.wave, node.biomeId).id;
    const candidates: string[] = [];
    for (let index = 0; index < biomeIds.length; index += 1) {
      const biomeId = biomeIds[index]!;
      if (biomeId === currentBiomeId
        || state.journeyFactLedger.visitedBiomeIds.includes(biomeId)
        || candidates.includes(biomeId)) continue;
      candidates.push(biomeId);
    }
    candidates.sort((left, right) => left < right ? -1 : left > right ? 1 : 0);
    if (candidates.length > 0) {
      const index = hashSeed(
        state.map.seed,
        'event-binding',
        instanceId,
        'journey.futureBiome',
      ) % candidates.length;
      destinationBiome = candidates[index]!;
    }
  }

  const boundSubjects: MutableBoundSubjectsV3 = {};
  for (let index = 0; index < bindings.length; index += 1) {
    const binding = bindings[index]!;
    switch (binding.source) {
      case 'revenge.enemyId': boundSubjects.enemy_id = revenge!.enemyId; break;
      case 'revenge.finisherCardId':
        if (revenge!.finisherCardId !== undefined) {
          boundSubjects.revenge_finisher_card_id = revenge!.finisherCardId;
        }
        break;
      case 'signature.cardId': boundSubjects.signature_card_id = signature!.cardId; break;
      case 'board.monoType': boundSubjects.mono_type = monoType!; break;
      case 'journey.futureBiome':
        if (destinationBiome !== undefined) boundSubjects.destination_biome = destinationBiome;
        break;
    }
  }

  let revengeFactLedger = state.revengeFactLedger;
  let signatureFactLedger = state.signatureFactLedger;
  const reservations: EventBindingReservation[] = [];
  if (revenge !== undefined) {
    revengeFactLedger = state.revengeFactLedger.map((record, index) => index === revengeIndex
      ? { ...record, status: 'reserved', reservedByInstanceId: instanceId }
      : record);
    reservations.push({
      reservationId: reservationId(instanceId, 'revenge', revenge.battleId, revenge.enemyId),
      instanceId,
      source: 'revenge',
      sourceBattleId: revenge.battleId,
      subjectId: revenge.enemyId,
    });
  }
  if (signature !== undefined) {
    signatureFactLedger = state.signatureFactLedger.map((record, index) => index === signatureIndex
      ? { ...record, status: 'reserved', reservedByInstanceId: instanceId }
      : record);
    reservations.push({
      reservationId: reservationId(instanceId, 'signature', signature.battleId, signature.cardId),
      instanceId,
      source: 'signature',
      sourceBattleId: signature.battleId,
      subjectId: signature.cardId,
    });
  }

  const nextState: RunState = {
    ...state,
    revengeFactLedger,
    signatureFactLedger,
    eventBindingReservations: [...state.eventBindingReservations, ...reservations],
    eventInstances: {
      ...state.eventInstances,
      [node.id]: { ...committed, boundSubjects },
    },
  };
  return { ok: true, state: nextState, boundSubjects };
}
