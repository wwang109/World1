import type { RunState, BuyDestination } from '../runState';
import type { BattleRequest, BattlePreparation, BattleLog } from '../resolveBattle';
import type { Allocation, LevelStat } from '../leveling';
import type { DraftSetKey } from '../draft';
import type { EquipmentSlot } from '../../engine/equipment/types';
import type { MarketStat } from '../../data/eventTypes';
import type { EventRerollStepV3 } from '../eventReshape';
import type { GhostRecord } from '../ghost';
import type { GhostSubmissionInput, GhostValidationResult } from '../ghostValidate';
import type { SkillBook, SkillDef } from '../../engine/types';
import type { GemDef } from '../../data/gems';
import type { EquipmentDocument } from '../../engine/equipment/types';
import type { LoadedEventDef } from '../../data/eventsContent';

export type OperationId = string;
export interface RevisionKey { rulesRevision: string; contentSha: string }
export type CardSource = { kind: 'board' | 'bag' | 'held'; instanceId: string };
export type CardDestination = { kind: 'board' | 'bag'; slot: number } | { kind: 'held' };
export type DeckIntent =
  | { kind: 'moveCard'; source: CardSource; destination: CardDestination }
  | { kind: 'swapCards'; source: CardSource; other: CardSource }
  | { kind: 'attachGem'; instanceId: string; pouchIndex: number }
  | { kind: 'detachGem'; instanceId: string };
export type EventSelection =
  | { kind: 'card'; skillId: string }
  | { kind: 'upgrade' | 'awardCardPoint' | 'reshape' | 'upgradeEquipment'; instanceId: string }
  | { kind: 'gem'; gemId: string }
  | { kind: 'sellGem'; pouchIndex: number }
  | { kind: 'mergeCards'; skillId: string; consumedIds: readonly string[] }
  | { kind: 'statPick'; stat: MarketStat }
  | { kind: 'reshapeGem'; optionId: string }
  | { kind: 'reroll'; target: 'rerollCard' | 'rerollGem'; step: EventRerollStepV3 }
  | { kind: 'forgeEquipment'; itemId: string };
export type EventIntent =
  | { kind: 'eventMaterialize' }
  | { kind: 'eventChoice'; instanceId: string; contentVersion: number; choiceId: string }
  | { kind: 'eventReopen' | 'eventCancel'; instanceId: string; contentVersion: number }
  | { kind: 'eventFinalize'; instanceId: string; contentVersion: number; selection: EventSelection }
  | { kind: 'leaveEvent' };
export type RunIntent = DeckIntent | EventIntent
  | { kind: 'draftReroll' | 'draftApply' | 'shopMaterialize' | 'shopReroll' | 'leaveShop' | 'issueEncounter' | 'retire' | 'ghostLookup' | 'ghostAccept' | 'ghostDecline' | 'ghostSkip' }
  | { kind: 'draftPick'; set: DraftSetKey; skillId: string }
  | { kind: 'chooseBiome'; biomeId: string }
  | { kind: 'chooseNode'; nodeId: string }
  | { kind: 'buyCard'; index: number; destination?: BuyDestination }
  | { kind: 'buyGem'; index: number }
  | { kind: 'mergeCard'; index: number; targetInstanceId: string }
  | { kind: 'buyMergeSlot'; targetInstanceId: string }
  | { kind: 'sellCard'; source: CardSource }
  | { kind: 'sellGem'; pouchIndex: number }
  | { kind: 'allocateStats'; allocation: Allocation }
  | { kind: 'buyStat'; stat: LevelStat }
  | { kind: 'equip' | 'salvage'; instanceId: string }
  | { kind: 'unequip'; slot: EquipmentSlot }
  | { kind: 'ghostSave'; name: string };
export interface RunCommand { operationId: OperationId; expectedRevision: number; intent: RunIntent }
export interface CanonicalPreparation { request: BattleRequest; preparation?: BattlePreparation }
export interface EncounterRecord {
  id: string; runId: string; key: RevisionKey; stateRevision: number;
  role: 'regular' | 'boss' | 'challenge' | 'extra'; rewardClass: 'boss' | 'none';
  status: 'pending' | 'settled'; preparation: CanonicalPreparation;
}
export interface EligibleRun {
  id: string; accountId: string; revision: number; key: RevisionKey;
  state: RunState; encounters: readonly EncounterRecord[];
}
export interface RunContentView {
  draftHud?: {heroStats:import('../../engine/types').CombatantStats;heroGemAdds:Partial<import('../../engine/types').CombatantStats>;day:number;wave:number;bankedPL:number};
  cardTiers?: Record<string, SkillDef>;
  cardFaces?: Record<string,{rows:import('../cardRulesRows').FantasyCardRulesRow[];desktop:import('../skillPresentation').EffectSegment[];mobile:import('../skillPresentation').EffectSegment[]}>;
  economy?: {
    bankedPL: number;
    statCosts: Record<import('../leveling').LevelStat, { pl: number; gain: number }>;
    shopReroll: number | null;
    mergeSlot: number | null;
    mergeSlotAvailable: boolean;
    cardSales: Record<string, number>;
    gemSales: readonly number[];
    forgeCost: number;
    upgrades: Record<string, { cost: number; maxed: boolean }>;
    salvageGains: Record<string, number>;
  };
  boardSlots?: number;
  art?: import('../../data/artManifest').ArtManifest;
  draft?: import('../draft').StartDraft | null;
  draftPicks?: Partial<Record<import('../draft').DraftSetKey, string>>;
  biomePick?: import('../biomePickViewModel').BiomePickViewModel | null;
  choices?: readonly import('../runState').RunNode[];
  currentEvent?: LoadedEventDef | null;
  legacyOffer?: import('../events').EventOutcome | null;
  event?: import('../runEventViewModel').RunEventViewModel | null;
  skills: SkillBook; gems: Record<string, GemDef>; equipment: EquipmentDocument;
  events: readonly LoadedEventDef[]; artBase: string;
  cardText: Record<string, string>; gemText: Record<string, string>;
  keywordRules: readonly { title: string; body: string }[];
}
export interface EligibleRunView extends EligibleRun { content: RunContentView }
export interface RunReceipt { operationId: string; runId: string; revision: number; view: EligibleRunView }
export interface EncounterReceipt extends RunReceipt {
  encounterId: string; log: BattleLog; points?: { entryId: string; pointsEarned: 1; balance: number };
}
export type RunEffect =
  | { kind: 'encounter'; encounter: EncounterRecord }
  | { kind: 'ghostLookup'; nodeId: string; band: number; role: 'substitute' | 'extra' }
  | { kind: 'ghostSave'; code: string; name: string; fightNumber: number }
  | { kind: 'ghostReport'; ghostId: string; won: boolean; sourceKey: string };
export interface TrustedRunInputs {
  runId: string; revision: number; encounterId: string;
  ghostLookup?: { nodeId: string; role: 'substitute' | 'extra'; ghost: GhostRecord | null };
}
export interface Transition { state: RunState; effects: readonly RunEffect[] }
export interface ResolvedTransition extends Transition { log: BattleLog; won: boolean; encounterId: string }
export interface BossCreditCandidate { accountId: string; runId: string; encounterId: string; amount: 1 }
export interface ResolvedEncounterCommit {
  accountId: string; expectedRevision: number; operationId: string; payloadHash: string;
  resolved: ResolvedTransition; bossCredit?: BossCreditCandidate;
}
export interface RunExecutor {
  key: RevisionKey; create(seed: number): RunState;
  validateGhost(input: GhostSubmissionInput): GhostValidationResult;
  apply(state: RunState, intent: RunIntent, inputs: TrustedRunInputs): Transition;
  resolve(state: RunState, encounter: EncounterRecord): ResolvedTransition;
  present(state: RunState): RunContentView;
}
