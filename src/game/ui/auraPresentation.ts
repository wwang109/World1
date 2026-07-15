import type { AuraSource } from '../../engine/combat/events';
import type { SkillBook, SkillDef } from '../../engine/types';
import { ELEMENT_COLOR, PROPERTY_COLOR } from '../theme';
import { formatAuraModifiers } from './skillPresentation';

export type AuraTone = 'positive' | 'negative' | 'mixed' | 'neutral';

export interface AuraSourcePresentation {
  slot: number;
  skillId: string;
  label: string;
  modifier: string;
  accent: number;
  tone: AuraTone;
}

export function skillAccent(skill: SkillDef): number {
  return skill.element
    ? (ELEMENT_COLOR[skill.element] ?? PROPERTY_COLOR[skill.property])
    : PROPERTY_COLOR[skill.property];
}

export function auraTone(source: AuraSource): AuraTone {
  const signs = [
    source.damageFlat ?? 0,
    source.healFlat ?? 0,
    -(source.weightDelta ?? 0),
    source.critPctDelta ?? 0,
  ]
    .filter((value) => value !== 0)
    .map(Math.sign);

  if (signs.length === 0) return 'neutral';
  if (signs.every((sign) => sign > 0)) return 'positive';
  if (signs.every((sign) => sign < 0)) return 'negative';
  return 'mixed';
}

export function presentAuraSource(source: AuraSource, book: SkillBook): AuraSourcePresentation {
  const skill = book[source.skillId];
  return {
    slot: source.slot,
    skillId: source.skillId,
    label: skill?.name ?? source.skillId,
    modifier: formatAuraModifiers(source, true),
    accent: skill ? skillAccent(skill) : PROPERTY_COLOR.true,
    tone: auraTone(source),
  };
}
