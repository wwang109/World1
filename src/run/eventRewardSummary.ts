import { isEventDefV3 } from '../data/eventContentV3';
import type {
  EventChallengeRewardSpecV3,
  EventChoiceV3,
  EventDirectOutcomeSpecV3,
  EventOutcomeSpecV3,
  EventWeightedBranchV3,
} from '../data/eventContentV3';
import type { LoadedEventDef } from '../data/eventsContent';
import { skillBook } from '../data/skills';
import type { CardFilter } from '../data/shopTypes';
import type { EventChoiceDef, EventOutcomeSpec } from '../data/eventTypes';
import type { SkillDef } from '../engine/types';

export type EventRewardKind = 'card' | 'gem' | 'gold' | 'upgrade' | 'level' | 'intel' | 'merge' | 'battle';

/** Which of a card's own type facts the reward chip should be coloured by —
 * resolved here (pure data), coloured by the presentation layer. */
export interface CardRewardAxis {
  axis: 'element' | 'weapon' | 'archetype' | 'property';
  value: string;
}

export interface EventRewardSummary {
  /** e.g. "CARD · SCORCHING BRAND", "GEM", "GOLD" — the game's own words,
   * chosen from the single most notable reward this event can give. */
  rewardChip?: string;
  /** Which palette family `rewardChip` belongs to — the presentation layer
   * maps this to an actual colour; this stays free of any UI import. */
  rewardKind?: EventRewardKind;
  /** Set only when `rewardKind` is `'card'`: which type fact identifies it. */
  cardAxis?: CardRewardAxis;
  /** True when the event only ever draws in a listed biomeIds subset. */
  biomeExclusive: boolean;
  /** True when the event def's own `rarity` is `'rare'` — a special-event
   * callout, distinct from an ordinary reward chip. */
  rare: boolean;
}

/** A named card's own type identity, in the same priority `cardTypeBadge`
 * (`src/game/ui/cardArtPresentation.ts`) uses: element, then weapon, then the
 * property every card carries as a floor. */
function cardTypeAxis(card: SkillDef): CardRewardAxis {
  if (card.element) return { axis: 'element', value: card.element };
  if (card.weapon) return { axis: 'weapon', value: card.weapon };
  return { axis: 'property', value: card.property };
}

/** The single-axis, single-value filter clause a reward chip can honestly
 * name — "Fire", "Sword", "Offense" — or undefined when the filter names more
 * than one card-defining fact. */
function describeCardFilterAxis(filter: CardFilter | undefined): CardRewardAxis | undefined {
  if (!filter || filter.length !== 1) return undefined;
  const clause = filter[0]!;
  const candidates: Array<{ axis: CardRewardAxis['axis']; values: readonly string[] | undefined }> = [
    { axis: 'element', values: clause.elements },
    { axis: 'weapon', values: clause.weapons },
    { axis: 'archetype', values: clause.archetypes },
    { axis: 'property', values: clause.properties },
  ];
  const populated = candidates.filter((entry) => entry.values !== undefined && entry.values.length > 0);
  if (populated.length !== 1 || populated[0]!.values!.length !== 1) return undefined;
  return { axis: populated[0]!.axis, value: populated[0]!.values![0]! };
}

const REWARD_PRIORITY = [
  'challengeFight',
  'mergeCards', 'upgradeCard', 'upgradeCardTargeted', 'awardCardPoint',
  'grantCard', 'cardChoice',
  'gemChoice',
  'grantLevel', 'grantMapInfo', 'grantGold', 'sellGem',
] as const;

interface RewardCandidate {
  kind: (typeof REWARD_PRIORITY)[number];
  chip: string;
  rewardKind: EventRewardKind;
  cardAxis?: CardRewardAxis;
}

/** Recognizes exactly the outcome kinds this reward chip speaks for — every
 * other kind (grantGem, bonusDraft, loseGold, nothing, …) yields no
 * candidate, so the event's overall chip omits it rather than guessing. */
function candidateOf(outcome: EventOutcomeSpec | EventDirectOutcomeSpecV3): RewardCandidate | undefined {
  switch (outcome.kind) {
    case 'grantCard': {
      const card = outcome.cardId ? skillBook[outcome.cardId] : undefined;
      const name = card?.name ?? outcome.cardId;
      const axis = card ? cardTypeAxis(card) : describeCardFilterAxis(outcome.filter);
      const chip = name ? `CARD · ${name.toUpperCase()}` : axis ? `CARD · ${axis.value.toUpperCase()}` : 'CARD';
      return { kind: 'grantCard', chip, rewardKind: 'card', cardAxis: axis };
    }
    case 'cardChoice': {
      const axis = describeCardFilterAxis(outcome.filter);
      const chip = axis ? `CARD · ${axis.value.toUpperCase()}` : 'CARD';
      return { kind: 'cardChoice', chip, rewardKind: 'card', cardAxis: axis };
    }
    case 'gemChoice':
      return { kind: 'gemChoice', chip: 'GEM', rewardKind: 'gem' };
    case 'grantGold':
      return { kind: 'grantGold', chip: 'GOLD', rewardKind: 'gold' };
    case 'upgradeCard':
      return { kind: 'upgradeCard', chip: 'UPGRADE', rewardKind: 'upgrade' };
    case 'upgradeCardTargeted':
      return { kind: 'upgradeCardTargeted', chip: 'UPGRADE', rewardKind: 'upgrade' };
    case 'awardCardPoint':
      return { kind: 'awardCardPoint', chip: 'ADVANCE', rewardKind: 'upgrade' };
    case 'grantLevel':
      return { kind: 'grantLevel', chip: 'LEVEL', rewardKind: 'level' };
    case 'grantMapInfo':
      return { kind: 'grantMapInfo', chip: 'INTEL', rewardKind: 'intel' };
    case 'mergeCards':
      return { kind: 'mergeCards', chip: 'MERGE', rewardKind: 'merge' };
    case 'sellGem':
      return { kind: 'sellGem', chip: 'GOLD', rewardKind: 'gold' };
    case 'challengeFight': {
      const inner = candidateOf(outcome.reward as EventDirectOutcomeSpecV3);
      return {
        kind: 'challengeFight',
        chip: inner ? `BATTLE · ${inner.chip}` : 'BATTLE',
        rewardKind: 'battle',
        ...(inner?.cardAxis !== undefined ? { cardAxis: inner.cardAxis } : {}),
      };
    }
    default:
      return undefined;
  }
}

function candidatesOfOutcome(outcome: EventOutcomeSpec | EventOutcomeSpecV3): readonly RewardCandidate[] {
  if (outcome.kind === 'weighted') {
    return (outcome.branches as readonly EventWeightedBranchV3[]).flatMap((branch) => candidatesOfOutcome(branch.outcome));
  }
  const candidate = candidateOf(outcome);
  return candidate ? [candidate] : [];
}

function bestCandidate(candidates: readonly RewardCandidate[]): RewardCandidate | undefined {
  let best: RewardCandidate | undefined;
  let bestRank = Infinity;
  for (const candidate of candidates) {
    const rank = REWARD_PRIORITY.indexOf(candidate.kind);
    if (rank < bestRank) { best = candidate; bestRank = rank; }
  }
  return best;
}

function candidatesOfLegacyEvent(choices: readonly EventChoiceDef[]): readonly RewardCandidate[] {
  return choices.flatMap((choice) => candidatesOfOutcome(choice.outcome));
}

function candidatesOfV3Event(fixed: readonly EventChoiceV3[], pool: readonly EventChoiceV3[]): readonly RewardCandidate[] {
  return [...fixed, ...pool].flatMap((choice) => candidatesOfOutcome(choice.outcome));
}

/** The reward-only chip a `challengeFight` choice's own reward resolves to —
 * "CARD · SCORCHING BRAND", "GEM", "GOLD" — the same wording `candidateOf`
 * gives that reward kind as an ordinary event outcome, minus the "BATTLE ·"
 * prefix the choice row adds itself alongside the difficulty. */
export function challengeFightRewardChip(reward: EventChallengeRewardSpecV3): string {
  return candidateOf(reward as EventDirectOutcomeSpecV3)?.chip ?? 'REWARD';
}

/** Pure, Phaser-free preview summary of what an event can give — read off its
 * authored choices, never the run's resolved outcome. Reveal is a caller
 * concern (the map only ever previews next-column nodes); this only reads
 * whatever `LoadedEventDef` it is handed. */
export function summarizeEventReward(event: LoadedEventDef): EventRewardSummary {
  const biomeExclusive = event.biomeIds !== undefined && event.biomeIds.length > 0;
  const candidates = isEventDefV3(event)
    ? candidatesOfV3Event(event.choiceSet.fixed, event.choiceSet.pool?.entries ?? [])
    : candidatesOfLegacyEvent(event.choices);
  const best = bestCandidate(candidates);
  return {
    rewardChip: best?.chip,
    rewardKind: best?.rewardKind,
    cardAxis: best?.cardAxis,
    biomeExclusive,
    rare: event.rarity === 'rare',
  };
}
