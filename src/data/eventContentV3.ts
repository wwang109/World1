import type {
  Action,
  Archetype,
  BuffableStat,
  Element,
  SkillTier,
  WeaponType,
} from '../engine/types';
import type { CardFilter, GemFilter } from './shopTypes';
import type {
  EventCallbackSpec as EventCallbackSpecV2,
  EventDefV2,
} from './eventContentV2';
import type { EventChoiceDef, EventDef, EventOutcomeSpec, EventRarity } from './eventTypes';

export type EventTallyStatV3 =
  | 'goldSpent'
  | 'cardsBought'
  | 'gemsBought'
  | 'livesLost'
  | 'wins'
  | 'losses'
  | 'bossesCleared';

export type BooleanStoryStateKeyV3 =
  | 'oath_mercy'
  | 'honorable_choice'
  | 'reliquary_oath'
  | 'rival_spared'
  | 'moon_quarry_released';

export type GravePathV3 = 'none' | 'opened' | 'answered';
export type OathGateV3 = 'none' | 'sworn' | 'kept' | 'released';
export type VenomBloomV3 = 'none' | 'cultivated';
export type EnumStoryStateKeyV3 = 'grave_path' | 'oath_gate' | 'venom_bloom';
export type StoryStateKeyV3 = BooleanStoryStateKeyV3 | EnumStoryStateKeyV3;

export interface StoryStateSchemaV3 {
  readonly oath_mercy: { readonly kind: 'boolean'; readonly default: false };
  readonly grave_path: {
    readonly kind: 'enum';
    readonly values: readonly ['none', 'opened', 'answered'];
    readonly default: 'none';
  };
  readonly honorable_choice: { readonly kind: 'boolean'; readonly default: false };
  readonly reliquary_oath: { readonly kind: 'boolean'; readonly default: false };
  readonly oath_gate: {
    readonly kind: 'enum';
    readonly values: readonly ['none', 'sworn', 'kept', 'released'];
    readonly default: 'none';
  };
  readonly venom_bloom: {
    readonly kind: 'enum';
    readonly values: readonly ['none', 'cultivated'];
    readonly default: 'none';
  };
  readonly rival_spared: { readonly kind: 'boolean'; readonly default: false };
  readonly moon_quarry_released: { readonly kind: 'boolean'; readonly default: false };
}

export type StoryStateFieldV3 = StoryStateSchemaV3[StoryStateKeyV3];

type EnumStoryFlagArgsV3<TKey extends EnumStoryStateKeyV3, TValue extends string> =
  | { key: TKey; op: 'eq' | 'neq'; value: TValue }
  | { key: TKey; op: 'in'; value: readonly [TValue, ...TValue[]] };

export type EventStoryFlagArgsV3 =
  | { key: BooleanStoryStateKeyV3; op: 'eq' | 'neq'; value: boolean }
  | EnumStoryFlagArgsV3<'grave_path', GravePathV3>
  | EnumStoryFlagArgsV3<'oath_gate', OathGateV3>
  | EnumStoryFlagArgsV3<'venom_bloom', VenomBloomV3>;

export interface EventOwnedCardMatchV3 {
  cardIds?: readonly string[];
  weapons?: readonly WeaponType[];
  elements?: readonly Element[];
  archetypes?: readonly Archetype[];
}

export interface EventOwnedCardCountArgsV3 {
  where: 'board' | 'bag' | 'held' | 'any';
  count: number;
  match: EventOwnedCardMatchV3;
  tierAtLeast?: SkillTier;
}

export interface EventOwnedGemMatchV3 {
  gemIds?: readonly string[];
  actionKinds?: readonly Action['kind'][];
  heroStats?: readonly BuffableStat[];
}

export interface EventOwnedGemCountArgsV3 {
  where: 'pouch' | 'socketed' | 'any';
  count: number;
  match: EventOwnedGemMatchV3;
}

export type EventEnemyDefeatedArgsV3 =
  | { enemyId: string; atLeast: number }
  | { weaponAffinity: WeaponType; atLeast: number };

export interface EventAffinityWinArgsV3 {
  affinityId: WeaponType | Element;
  atLeast: number;
  biomeId?: string;
}

export interface EventStatusUsedArgsV3 {
  status: 'burn' | 'poison';
  result: 'win' | 'bossWin';
  biomeId?: string;
}

export interface EventActionKindUsedArgsV3 {
  actionKind: Action['kind'];
  result: 'win' | 'bossWin';
  biomeId?: string;
}

export interface EventFastWinArgsV3 {
  maxTurns: number;
  element?: Element;
}

export type EventRequirementV3 =
  | { all: readonly EventRequirementV3[] }
  | { any: readonly EventRequirementV3[] }
  | { not: EventRequirementV3 }
  | { fact: 'wallet.current' | 'lives.current' | 'node.depth' | 'node.wave'; args: { op: 'eq' | 'gte' | 'lte'; value: number } }
  | { fact: 'run.tally'; args: { stat: EventTallyStatV3; op: 'eq' | 'gte' | 'lte'; value: number } }
  | { fact: 'event.choice'; args: { eventId: string; choiceIds?: readonly string[] } }
  | { fact: 'story.flag'; args: EventStoryFlagArgsV3 }
  | { fact: 'chain.completed'; args: { storyId: string } }
  | { fact: 'biome.current'; args: { ids: readonly string[] } }
  | { fact: 'board.affinity'; args: { affinityId: WeaponType | Element } }
  | { fact: 'board.isMonoType'; args: { typeKind: 'weapon' | 'element' } }
  | { fact: 'owned.card.count'; args: EventOwnedCardCountArgsV3 }
  | { fact: 'owned.gem.count'; args: EventOwnedGemCountArgsV3 }
  | { fact: 'combat.enemyDefeated'; args: EventEnemyDefeatedArgsV3 }
  | { fact: 'combat.biomeBossDefeated'; args: { biomeId: string } }
  | { fact: 'combat.affinityWin'; args: EventAffinityWinArgsV3 }
  | { fact: 'combat.statusUsed'; args: EventStatusUsedArgsV3 }
  | { fact: 'combat.actionKindUsed'; args: EventActionKindUsedArgsV3 }
  | { fact: 'combat.fastWin'; args: EventFastWinArgsV3 }
  | { fact: 'combat.recentLoss'; args: { withinDepth: number } }
  | { fact: 'combat.noLossesInBiome'; args: { biomeId: string } }
  | { fact: 'combat.revengeReady'; args: Record<string, never> }
  | { fact: 'combat.signatureReady'; args: { winsAtLeast: number; bossFinisher: true } }
  | { fact: 'journey.visitedBiomes'; args: { op: 'gte'; value: number } }
  | { fact: 'journey.completedChains'; args: { op: 'gte'; value: number } }
  | { fact: 'callback.queued'; args: { callbackId: string } };

export type EventBindingSpecV3 =
  | { as: 'enemy_id'; source: 'revenge.enemyId' }
  | { as: 'revenge_finisher_card_id'; source: 'revenge.finisherCardId'; optional?: true }
  | { as: 'signature_card_id'; source: 'signature.cardId' }
  | { as: 'mono_type'; source: 'board.monoType' }
  | { as: 'destination_biome'; source: 'journey.futureBiome'; candidates: 'unvisited_catalog' };

/** Callback copies are always required. Ambient revenge binding alone may
 * opt into its authored fallback when the finisher card was not recorded. */
export type EventCallbackBindingSpecV3 =
  | Exclude<EventBindingSpecV3, { as: 'revenge_finisher_card_id' }>
  | { as: 'revenge_finisher_card_id'; source: 'revenge.finisherCardId' };

export type EventBindingSlotV3 = EventBindingSpecV3['as'];

export type EventMonoTypeBindingValueV3 =
  | { readonly typeKind: 'weapon'; readonly type: WeaponType }
  | { readonly typeKind: 'element'; readonly type: Element };

/** Runtime values are closed by slot; mono-type identity is structured rather than stringly typed. */
export interface EventBoundSubjectsV3 {
  readonly enemy_id?: string;
  readonly revenge_finisher_card_id?: string;
  readonly signature_card_id?: string;
  readonly mono_type?: EventMonoTypeBindingValueV3;
  readonly destination_biome?: string;
}

export type EventCallbackExpiryFallbackV3 =
  | 'discard'
  | { outcome: { kind: 'grantGold'; amount: number } };

export interface EventCallbackSpecV3 extends Omit<EventCallbackSpecV2, 'bind' | 'expiry'> {
  bind: readonly EventCallbackBindingSpecV3[];
  expiry: { expiresAfterNodes: number; fallback: EventCallbackExpiryFallbackV3 };
}

export type EventMutationV3 =
  | { op: 'completeStory'; storyId: string }
  | { op: 'set'; key: 'oath_mercy' | 'honorable_choice' | 'reliquary_oath' | 'rival_spared' | 'moon_quarry_released'; value: boolean }
  | { op: 'set'; key: 'grave_path'; value: 'none' | 'opened' | 'answered' }
  | { op: 'set'; key: 'oath_gate'; value: 'none' | 'sworn' | 'kept' | 'released' }
  | { op: 'set'; key: 'venom_bloom'; value: 'none' | 'cultivated' };

export type EventUpgradeTargetV3 =
  | { filter: { where: 'board' | 'bag' | 'held' | 'any'; match: EventOwnedCardMatchV3 } }
  | { boundSubject: { slot: 'revenge_finisher_card_id' | 'signature_card_id' } }
  | { boundSubject: { slot: 'mono_type'; typeKind?: 'weapon' | 'element' } };

export interface EventBoundGemChoiceCaseV3 {
  readonly when: EventMonoTypeBindingValueV3;
  readonly filter: GemFilter;
}

export type EventGemChoiceSpecV3 =
  | { kind: 'gemChoice'; filter?: GemFilter; boundSubject?: never }
  | {
    kind: 'gemChoice';
    filter?: never;
    boundSubject: {
      slot: 'mono_type';
      cases: readonly EventBoundGemChoiceCaseV3[];
    };
  };

export type EventDirectOutcomeSpecV3 =
  | Exclude<EventOutcomeSpec, { kind: 'cardChoice' } | { kind: 'gemChoice' }>
  | { kind: 'cardChoice'; filter: CardFilter; maxTier: SkillTier; capstone?: true }
  | EventGemChoiceSpecV3
  | {
    kind: 'upgradeCardTargeted';
    target: EventUpgradeTargetV3;
    fallback: { kind: 'grantGold'; amount: number } | { kind: 'nothing' };
  };

export interface EventWeightedBranchV3 {
  id: string;
  label: string;
  weight: number;
  outcome: EventDirectOutcomeSpecV3;
  mutations?: readonly EventMutationV3[];
}

export type EventOutcomeSpecV3 =
  | EventDirectOutcomeSpecV3
  | { kind: 'weighted'; branches: readonly EventWeightedBranchV3[] };

export interface EventChoiceV3 extends Omit<EventChoiceDef, 'outcome'> {
  outcome: EventOutcomeSpecV3;
  mutations?: readonly EventMutationV3[];
  callback?: EventCallbackSpecV3;
}

export interface EventChoiceSetV3 {
  fixed: readonly EventChoiceV3[];
  pool?: { draw: 1; entries: readonly EventChoiceV3[] };
}

interface EventDefV3Common extends Omit<EventDef, 'choices' | 'rarity' | 'requires' | 'requiresTally' | 'requiresAll'> {
  rarity: EventRarity;
  story: {
    storyId: string;
    stage: 'setup' | 'callback' | 'payoff' | 'capstone';
    role: 'setup' | 'callback' | 'payoff' | 'capstone';
  };
  eligibility: EventRequirementV3;
  visibility: 'visible' | 'hidden_until_eligible' | 'teased_when_due';
  priority: number;
  once: 'node' | 'run';
  cooldownNodes: number;
  choiceSet: EventChoiceSetV3;
}

/** Ambient definitions produce bindings from run facts. Callback definitions
 * receive an exact subject-slot contract from their queued producer. Keeping
 * the two ownership models disjoint makes invalid delivery shapes
 * unrepresentable to typed consumers. */
export interface AmbientEventDefV3 extends EventDefV3Common {
  delivery: { kind: 'ambient' };
  bindings?: readonly EventBindingSpecV3[];
  acceptsBindings?: never;
}

export interface QueuedCallbackEventDefV3 extends EventDefV3Common {
  delivery: { kind: 'queued_callback' };
  acceptsBindings?: readonly EventBindingSlotV3[];
  bindings?: never;
}

export type EventDefV3 = AmbientEventDefV3 | QueuedCallbackEventDefV3;

export function isAmbientEventDefV3(event: EventDefV3): event is AmbientEventDefV3 {
  return event.delivery.kind === 'ambient';
}

export function isQueuedCallbackEventDefV3(event: EventDefV3): event is QueuedCallbackEventDefV3 {
  return event.delivery.kind === 'queued_callback';
}

export type EventDefinitionPayloadV1 = Omit<EventDef, 'id'> & { readonly notes?: readonly string[] };
export type EventDefinitionPayloadV2 = Omit<EventDefV2, 'id'>;
type DefinitionWithoutId<TDefinition> = TDefinition extends unknown ? Omit<TDefinition, 'id'> : never;
export type EventDefinitionPayloadV3 = DefinitionWithoutId<EventDefV3>;

export interface ResolvedEventVersionWrapperV1 {
  version: number;
  schemaVersion: 1;
  def: EventDefinitionPayloadV1;
}

export interface ResolvedEventVersionWrapperV2 {
  version: number;
  schemaVersion: 2;
  def: EventDefinitionPayloadV2;
}

export interface ResolvedEventVersionWrapperV3 {
  version: number;
  schemaVersion: 3;
  def: EventDefinitionPayloadV3;
}

export type ResolvedEventVersionWrapper =
  | ResolvedEventVersionWrapperV1
  | ResolvedEventVersionWrapperV2
  | ResolvedEventVersionWrapperV3;

interface InheritedEventVersionWrapper<TDefinition> {
  version: number;
  schemaVersion?: undefined;
  def: TDefinition;
}

export type EventVersionWrapperV1 =
  | InheritedEventVersionWrapper<EventDefinitionPayloadV1>
  | ResolvedEventVersionWrapperV1;
export type EventVersionWrapperV2 =
  | InheritedEventVersionWrapper<EventDefinitionPayloadV2>
  | ResolvedEventVersionWrapperV2;
export type EventVersionWrapperV3 =
  | InheritedEventVersionWrapper<EventDefinitionPayloadV3>
  | ResolvedEventVersionWrapperV3;

export type EventVersionWrapperForDocumentV1 =
  | EventVersionWrapperV1
  | ResolvedEventVersionWrapperV2
  | ResolvedEventVersionWrapperV3;
export type EventVersionWrapperForDocumentV2 =
  | ResolvedEventVersionWrapperV1
  | EventVersionWrapperV2
  | ResolvedEventVersionWrapperV3;
export type EventVersionWrapperForDocumentV3 =
  | ResolvedEventVersionWrapperV1
  | ResolvedEventVersionWrapperV2
  | EventVersionWrapperV3;

export interface EventContentDocumentV1 {
  schemaVersion: 1;
  notes?: readonly string[];
  events: readonly { id: string; versions: readonly EventVersionWrapperForDocumentV1[] }[];
}

export interface EventContentDocumentV2 {
  schemaVersion: 2;
  storyStateSchema: Readonly<Record<string, never>>;
  events: readonly { id: string; versions: readonly EventVersionWrapperForDocumentV2[] }[];
}

export interface EventContentDocumentV3 {
  schemaVersion: 3;
  storyStateSchema: StoryStateSchemaV3;
  events: readonly { id: string; versions: readonly EventVersionWrapperForDocumentV3[] }[];
}

export type EventContentDocument = EventContentDocumentV1 | EventContentDocumentV2 | EventContentDocumentV3;

/** A document type that proves every inherited or explicit wrapper resolves to v3. */
export interface AllV3EventContentDocument extends Omit<EventContentDocumentV3, 'events'> {
  events: readonly { id: string; versions: readonly EventVersionWrapperV3[] }[];
}

type WithContentSchemaV3<TDefinition> = TDefinition extends unknown
  ? TDefinition & { readonly contentSchemaVersion: 3 }
  : never;
export type LoadedEventDefV3 = WithContentSchemaV3<EventDefV3>;

/** Largest-remainder normalization; equal remainders are awarded in authored order. */
export function normalizedIntegerPercentagesV3(weights: readonly number[]): readonly number[] {
  if (weights.length === 0 || weights.some((weight) => !Number.isSafeInteger(weight) || weight <= 0)) {
    throw new RangeError('weights must be a non-empty list of positive safe integers');
  }
  const exact = weights.map((weight) => BigInt(weight) * 100n);
  const total = weights.reduce((sum, weight) => sum + BigInt(weight), 0n);
  const percentages = exact.map((scaled) => Number(scaled / total));
  const remainders = exact.map((scaled) => scaled % total);
  let remaining = 100 - percentages.reduce((sum, percentage) => sum + percentage, 0);
  const authoredByRemainder = remainders
    .map((remainder, index) => ({ remainder, index }))
    .sort((left, right) => left.remainder === right.remainder
      ? left.index - right.index
      : left.remainder > right.remainder ? -1 : 1);
  for (let index = 0; index < remaining; index += 1) {
    const authoredIndex = authoredByRemainder[index]!.index;
    percentages[authoredIndex] = percentages[authoredIndex]! + 1;
  }
  return percentages;
}

/** Project only runtime v3 fields after the owning document has passed validation. */
export function eventDefV3OfDocument(
  id: string,
  wrapper: ResolvedEventVersionWrapperV3,
): LoadedEventDefV3 {
  const def = wrapper.def;
  const common = {
    id,
    title: def.title,
    body: def.body,
    theme: def.theme,
    ...(def.artId !== undefined ? { artId: def.artId } : {}),
    rarity: def.rarity,
    ...(def.biomeIds !== undefined ? { biomeIds: def.biomeIds } : {}),
    story: def.story,
    eligibility: def.eligibility,
    visibility: def.visibility,
    priority: def.priority,
    once: def.once,
    cooldownNodes: def.cooldownNodes,
    choiceSet: def.choiceSet,
    contentSchemaVersion: 3 as const,
  };
  if (def.delivery.kind === 'ambient') {
    const ambient = def as DefinitionWithoutId<AmbientEventDefV3>;
    return {
      ...common,
      delivery: ambient.delivery,
      ...(ambient.bindings !== undefined ? { bindings: ambient.bindings } : {}),
    };
  }
  const queued = def as DefinitionWithoutId<QueuedCallbackEventDefV3>;
  return {
    ...common,
    delivery: queued.delivery,
    ...(queued.acceptsBindings !== undefined ? { acceptsBindings: queued.acceptsBindings } : {}),
  };
}

export function isEventDefV3(event: EventDef | LoadedEventDefV3): event is LoadedEventDefV3 {
  return 'contentSchemaVersion' in event && event.contentSchemaVersion === 3;
}
