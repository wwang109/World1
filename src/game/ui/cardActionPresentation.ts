import type { Action, SkillDef } from '../../engine/types';
import { CARD_ACTION_COLOR } from '../theme';
import { STAT_LONG_NAME } from './statLabels';

export interface CardActionLabel {
  verb: string;
  effect: string;
  color: number;
}

function scalingStat(skill: SkillDef): string {
  if (skill.property === 'physical') return STAT_LONG_NAME.attack;
  if (skill.property === 'magical') return STAT_LONG_NAME.magicPower;
  return 'higher power';
}

function presentAction(action: Action, skill: SkillDef): CardActionLabel {
  switch (action.kind) {
    case 'damage':
      return { verb: 'DEAL', effect: `${action.power} + ${scalingStat(skill)} damage`, color: CARD_ACTION_COLOR.attack };
    case 'heal':
      return { verb: 'RESTORE', effect: skill.property === 'true' ? `${action.power} HP` : `${action.power} + ${scalingStat(skill)} HP`, color: CARD_ACTION_COLOR.healing };
    case 'shield':
      return { verb: 'SHIELD', effect: skill.property === 'true' ? `${action.power} all-damage shield` : `${action.power} + ${scalingStat(skill)}`, color: CARD_ACTION_COLOR.defense };
    case 'poison':
      return { verb: 'POISON', effect: `${action.stacks} — ticks stacks, −1/turn`, color: CARD_ACTION_COLOR.debuff };
    case 'burn':
      return { verb: 'BURN', effect: `${action.stacks} — ticks 2× stacks, halves/turn`, color: CARD_ACTION_COLOR.attack };
    case 'bleed':
      return { verb: 'BLEED', effect: `${action.stacks} — ticks when they perform, −1/tick`, color: CARD_ACTION_COLOR.debuff };
    case 'stun':
      return { verb: 'STUN', effect: `${action.turns} performance${action.turns === 1 ? '' : 's'}`, color: CARD_ACTION_COLOR.debuff };
    case 'buffStat':
      return { verb: 'GAIN', effect: `+${action.pct}% ${STAT_LONG_NAME[action.stat]} · ${action.turns}T`, color: CARD_ACTION_COLOR.buff };
    case 'debuffStat':
      return { verb: 'REDUCE', effect: `-${action.pct}% ${STAT_LONG_NAME[action.stat]} · ${action.turns}T`, color: CARD_ACTION_COLOR.debuff };
    case 'expose':
      return { verb: 'EXPOSE', effect: `+${action.pct}% damage taken · ${action.turns}T`, color: CARD_ACTION_COLOR.debuff };
    case 'cleanse':
      return { verb: 'REMOVE', effect: `up to ${action.charges} ailment${action.charges === 1 ? '' : 's'}`, color: CARD_ACTION_COLOR.utility };
    case 'taunt':
      return { verb: 'TAUNT', effect: `+${action.amount} aggro`, color: CARD_ACTION_COLOR.defense };
    case 'slow':
      return { verb: 'SLOW', effect: `next enemy card +${action.weight} weight`, color: CARD_ACTION_COLOR.tempo };
    case 'disrupt':
      return { verb: 'DRAIN', effect: `${action.amount} enemy readiness`, color: CARD_ACTION_COLOR.tempo };
    case 'lifesteal':
      return { verb: 'STEAL', effect: `${action.pct}% of damage as HP`, color: CARD_ACTION_COLOR.healing };
    case 'shieldBreak':
      return { verb: 'SHATTER', effect: `${action.amount} enemy shield`, color: CARD_ACTION_COLOR.attack };
    case 'comboBonus':
      return { verb: 'COMBO', effect: `+${action.amount} shared-archetype damage`, color: CARD_ACTION_COLOR.buff };
    case 'guard':
      return { verb: 'GUARD', effect: `-${action.pct}% ${action.property} damage · ${action.turns}T`, color: CARD_ACTION_COLOR.defense };
    case 'negate':
      return { verb: 'NEGATE', effect: `${action.charges} ${action.property} hit${action.charges === 1 ? '' : 's'}`, color: CARD_ACTION_COLOR.defense };
  }
}

export function presentCardActions(skill: SkillDef): CardActionLabel[] {
  const actions = skill.effects.map((action) => presentAction(action, skill));
  if (skill.aura) {
    actions.push({ verb: 'AURA', effect: 'modifies cards in its reach', color: CARD_ACTION_COLOR.utility });
  }
  return actions;
}
