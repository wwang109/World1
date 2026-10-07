import type { EventReshapeModeV3 } from '../../data/eventContentV3';
import { skillBook } from '../../data/skills';
import { applyTier } from '../../engine/cards';
import type { SkillDef, SkillTier } from '../../engine/types';

export interface ReshapeUiState {
  pick: string | null;
  step: 'cards' | 'confirm';
  detail: number | null;
}

export const INITIAL_RESHAPE_UI: ReshapeUiState = { pick: null, step: 'cards', detail: null };

export interface ReshapePickOption {
  instanceId: string;
  skillId: string;
  tier: SkillTier;
  resultSkillId?: string;
  resultTier?: SkillTier;
  where?: string;
}

export type ReshapeReward = { kind: 'grantGold'; amount: number } | { kind: 'grantLevel' };

export interface ReshapePickCard {
  instanceId: string;
  skill: SkillDef;
  label: string;
}

export interface ReshapeConfirmView {
  title: string;
  loseCaption: string;
  lose: ReshapePickCard;
  gainCaption: string;
  gain:
    | { kind: 'card'; skill: SkillDef; badge?: string }
    | { kind: 'mystery'; tier: SkillTier; line: string }
    | { kind: 'text'; big: string; line: string };
  confirmLabel: string;
}

const LOWER_TIER: Record<SkillTier, SkillTier> = { bronze: 'bronze', silver: 'bronze', gold: 'silver', diamond: 'gold' };

function skillAt(skillId: string, tier: SkillTier): SkillDef | undefined {
  const base = skillBook[skillId];
  if (!base) return undefined;
  return tier === base.tier ? base : applyTier(base, tier);
}

function newTypeLabel(option: ReshapePickOption): string | null {
  const from = skillBook[option.skillId];
  const to = option.resultSkillId === undefined ? undefined : skillBook[option.resultSkillId];
  if (!from || !to) return null;
  if (to.element !== undefined && to.element !== from.element) return to.element.toUpperCase();
  if (to.weapon !== undefined && to.weapon !== from.weapon) return to.weapon.toUpperCase();
  return null;
}

export function reshapePickCards(options: readonly ReshapePickOption[]): ReshapePickCard[] {
  const cards: ReshapePickCard[] = [];
  for (const option of options) {
    const skill = skillAt(option.skillId, option.tier);
    if (skill) cards.push({ instanceId: option.instanceId, skill, label: `${option.where ?? 'OWNED'} · ${option.tier.toUpperCase()}` });
  }
  return cards;
}

export function buildReshapeConfirmView(
  mode: EventReshapeModeV3,
  option: ReshapePickOption,
  reward?: ReshapeReward,
): ReshapeConfirmView | null {
  const lose = reshapePickCards([option])[0];
  if (!lose) return null;
  const tier = option.tier.toUpperCase();
  switch (mode) {
    case 'transform':
      return {
        title: 'TRANSFORM THIS CARD?', loseCaption: 'THIS CARD IS REPLACED', lose, gainCaption: 'YOU GET',
        gain: { kind: 'mystery', tier: option.tier, line: `Random ${tier} card, same size` }, confirmLabel: 'TRANSFORM',
      };
    case 'retype': {
      const type = newTypeLabel(option);
      return {
        title: 'CHANGE THIS CARD\'S TYPE?', loseCaption: 'THIS CARD IS REPLACED', lose, gainCaption: 'YOU GET',
        gain: { kind: 'mystery', tier: option.tier, line: type === null ? `Random ${tier} card of the new type, same size` : `Random ${tier} ${type} card, same size` },
        confirmLabel: 'CHANGE TYPE',
      };
    }
    case 'duplicate':
      return {
        title: 'COPY THIS CARD?', loseCaption: 'YOU KEEP THIS CARD', lose, gainCaption: 'A COPY GOES TO YOUR BAG',
        gain: { kind: 'card', skill: lose.skill, badge: 'COPY' }, confirmLabel: 'COPY',
      };
    case 'sacrifice':
      return {
        title: 'SACRIFICE THIS CARD?', loseCaption: 'THIS CARD IS DESTROYED', lose, gainCaption: 'YOU GET',
        gain: reward === undefined
          ? { kind: 'text', big: '—', line: 'Nothing' }
          : reward.kind === 'grantGold'
            ? { kind: 'text', big: `+${reward.amount}`, line: 'Gold' }
            : { kind: 'text', big: '+1', line: 'Hero level' },
        confirmLabel: 'SACRIFICE',
      };
    case 'shatter': {
      const lower = option.resultTier ?? LOWER_TIER[option.tier];
      const skill = skillAt(option.skillId, lower);
      return {
        title: 'SHATTER THIS CARD?', loseCaption: 'THIS CARD BREAKS', lose, gainCaption: `INTO TWO ${lower.toUpperCase()} COPIES`,
        gain: skill ? { kind: 'card', skill, badge: '×2' } : { kind: 'text', big: '×2', line: `${lower.toUpperCase()} copies` }, confirmLabel: 'SHATTER',
      };
    }
    case 'trade':
      return null;
  }
}
