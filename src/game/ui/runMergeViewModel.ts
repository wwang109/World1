import { MERGE_INPUT_COUNT, type MergeCardsReceipt, type MergeInputCard, type MergeTrioRewards } from '../../run/events';
import type { RunState } from '../../run/runState';
import type { SkillDef, SkillTier } from '../../engine/types';
import { applyTier } from '../../engine/cards';
import { skillBook } from '../../data/skills';

export interface MergeSpentEntry {
  instanceId: string;
  skillId: string;
  name: string;
  tier: SkillTier;
  tierLabel: string;
  whereLabel: string;
}

export function mergeTradeLine(count: number, from: SkillTier, to: SkillTier): string {
  return `${count} ${from.toUpperCase()} → 1 ${to.toUpperCase()}`;
}

/** Where one consumed instance is sitting, in the player's own vocabulary.
 * With the full run location state, the recorded index is trusted only when
 * its instance id, skill id, and tier still match; otherwise the label says
 * MOVED FROM BOARD/BAG and can never borrow another card's current slot.
 * Legacy callers that pass only board geometry retain the older best-effort
 * BOARD label because they have no bag identity state to validate. */
type MergeLocationSource =
  | Pick<RunState, 'pieces' | 'bagSlots'>
  | readonly { slot: number }[];

function isRunLocationState(source: MergeLocationSource): source is Pick<RunState, 'pieces' | 'bagSlots'> {
  return 'pieces' in source;
}

function exactInputStillAtRecordedLocation(
  input: MergeInputCard,
  state: Pick<RunState, 'pieces' | 'bagSlots'>,
): boolean {
  const owned = input.location === 'board'
    ? state.pieces[input.index]
    : state.bagSlots[input.index];
  return owned !== null && owned !== undefined
    && owned.instanceId === input.instanceId
    && owned.skillId === input.skillId
    && owned.tier === input.tier;
}

function whereLabel(card: MergeInputCard, source?: MergeLocationSource): string {
  if (source !== undefined && isRunLocationState(source)) {
    if (!exactInputStillAtRecordedLocation(card, source)) return `MOVED FROM ${card.location.toUpperCase()}`;
    if (card.location === 'bag') return 'BAG';
    return `BOARD ${source.pieces[card.index]!.slot + 1}`;
  }
  if (card.location === 'bag') return 'BAG';
  const piece = source?.[card.index];
  return piece ? `BOARD ${piece.slot + 1}` : 'BOARD';
}

export function buildMergeSpentEntries(
  consumed: readonly MergeInputCard[],
  locations?: MergeLocationSource,
): MergeSpentEntry[] {
  const spent: MergeSpentEntry[] = [];
  for (let i = 0; i < consumed.length; i += 1) {
    const card = consumed[i]!;
    spent.push({
      instanceId: card.instanceId,
      skillId: card.skillId,
      name: skillBook[card.skillId]?.name ?? card.skillId,
      tier: card.tier,
      tierLabel: card.tier.toUpperCase(),
      whereLabel: whereLabel(card, locations),
    });
  }
  return spent;
}

export interface MergeUiState {
  ids: readonly string[];
  step: 'cards' | 'reward';
  reward: string | null;
  detail: { list: 'cards' | 'spent' | 'reward'; index: number } | null;
}

export const INITIAL_MERGE_UI: MergeUiState = { ids: [], step: 'cards', reward: null, detail: null };

export function toggleMergeCard(ui: MergeUiState, instanceId: string): MergeUiState {
  const ids = ui.ids.includes(instanceId)
    ? ui.ids.filter((id) => id !== instanceId)
    : ui.ids.length < MERGE_INPUT_COUNT ? [...ui.ids, instanceId] : ui.ids;
  return { ...ui, ids, reward: null, detail: null };
}

export interface MergePickCard {
  instanceId: string;
  skill: SkillDef;
  tier: SkillTier;
  label: string;
  selected: boolean;
  enabled: boolean;
  actionLabel: string;
}

export interface MergeSelectView {
  title: string;
  caption: string;
  hint: string;
  blocked: boolean;
  cards: readonly MergePickCard[];
  ready: boolean;
}

export interface MergeRewardCard {
  skillId: string;
  tier: SkillTier;
  skill: SkillDef;
  selected: boolean;
}

export interface MergeConfirmView {
  title: string;
  spentCaption: string;
  spent: readonly MergePickCard[];
  pickCaption: string;
  rewards: readonly MergeRewardCard[];
  ready: boolean;
}

function skillAtTier(skillId: string, tier: SkillTier): SkillDef | undefined {
  const base = skillBook[skillId];
  if (!base) return undefined;
  return tier === base.tier ? base : applyTier(base, tier);
}

function pickCard(entry: MergeSpentEntry, selected: boolean, enabled: boolean, actionLabel: string): MergePickCard | null {
  const skill = skillAtTier(entry.skillId, entry.tier);
  if (!skill) return null;
  return {
    instanceId: entry.instanceId,
    skill,
    tier: entry.tier,
    label: `${selected ? '✓ MERGING · ' : ''}${entry.whereLabel} · ${entry.tierLabel}`,
    selected,
    enabled,
    actionLabel,
  };
}

export function buildMergeSelectView(
  owned: readonly MergeSpentEntry[],
  ui: MergeUiState,
  rewards: MergeTrioRewards | null,
): MergeSelectView {
  const chosen = owned.filter((entry) => ui.ids.includes(entry.instanceId));
  const tier = chosen[0]?.tier ?? null;
  const full = chosen.length >= MERGE_INPUT_COUNT;
  const cards: MergePickCard[] = [];
  for (const entry of owned) {
    const selected = ui.ids.includes(entry.instanceId);
    const sameTier = tier === null || entry.tier === tier;
    const enabled = selected || (!full && sameTier);
    const actionLabel = selected
      ? 'REMOVE FROM MERGE'
      : !sameTier ? `${tier!.toUpperCase()} CARDS ONLY`
        : full ? `${MERGE_INPUT_COUNT} CARDS PICKED` : 'ADD TO MERGE';
    const card = pickCard(entry, selected, enabled, actionLabel);
    if (card) cards.push(card);
  }
  const ready = full && rewards !== null && rewards.rewards.length > 0;
  const blocked = full && !ready;
  return {
    title: `PICK ${MERGE_INPUT_COUNT} CARDS TO MERGE`,
    caption: `${tier === null ? 'ALL ONE GRADE' : `${tier.toUpperCase()} ONLY`} · ${chosen.length} OF ${MERGE_INPUT_COUNT} PICKED`,
    hint: blocked ? 'NO REWARD FITS YOUR BAG — PICK OTHER CARDS' : 'TAP A CARD TO SEE IT',
    blocked,
    cards,
    ready,
  };
}

export function buildMergeConfirmView(
  owned: readonly MergeSpentEntry[],
  rewards: MergeTrioRewards,
  chosenSkillId: string | null,
): MergeConfirmView {
  const spent: MergePickCard[] = [];
  for (const input of rewards.consumed) {
    const entry = owned.find((candidate) => candidate.instanceId === input.instanceId);
    const card = entry ? pickCard(entry, false, true, '') : null;
    if (card) spent.push({ ...card, label: entry!.whereLabel });
  }
  const options: MergeRewardCard[] = [];
  for (const reward of rewards.rewards) {
    const skill = skillAtTier(reward.skillId, reward.tier);
    if (skill) options.push({ skillId: reward.skillId, tier: reward.tier, skill, selected: reward.skillId === chosenSkillId });
  }
  const chosen = options.find((option) => option.selected);
  return {
    title: mergeTradeLine(rewards.consumed.length, rewards.from, rewards.to),
    spentCaption: `THESE ${rewards.consumed.length === 3 ? 'THREE' : rewards.consumed.length} ARE SPENT`,
    spent,
    pickCaption: chosen
      ? `YOU GET ${chosen.skill.name.toUpperCase()} · ${rewards.to.toUpperCase()}`
      : `PICK ONE — IT ARRIVES AT ${rewards.to.toUpperCase()}`,
    rewards: options,
    ready: chosen !== undefined,
  };
}

export function mergeReceiptFor(rewards: MergeTrioRewards, skillId: string): MergeCardsReceipt {
  return {
    from: rewards.from,
    to: rewards.to,
    consumed: rewards.consumed,
    taken: { skillId, tier: rewards.to },
  };
}
