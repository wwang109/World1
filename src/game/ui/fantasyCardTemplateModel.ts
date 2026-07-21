import { weightOf, type SkillDef, type SkillTier } from '../../engine/types';
import { archetypeBadges, cardTypeBadge } from './cardArtPresentation';
import {
  FANTASY_CARD_TEMPLATE_SPEC,
  selectBodyRule,
  selectTitleRule,
  selectWtRule,
} from './fantasyCardTemplateSpec';
import { getFantasyCardTierSkin } from './fantasyCardTierSkins';

export type FantasyArtAnchor = 'center' | 'upper-center' | 'lower-center';

export interface FantasyCardTemplateModel {
  size: { width: number; height: number };
  tier: SkillTier;
  skin: ReturnType<typeof getFantasyCardTierSkin>;
  regions: typeof FANTASY_CARD_TEMPLATE_SPEC.regions;
  titleRule: ReturnType<typeof selectTitleRule>;
  bodyRule: ReturnType<typeof selectBodyRule>;
  wtRule: ReturnType<typeof selectWtRule>;
  artAnchor: FantasyArtAnchor;
  type: ReturnType<typeof cardTypeBadge>;
  archetypes: ReturnType<typeof archetypeBadges>;
  weight: number;
  slotLabel: string;
  slotBoxCount: number;
  title: string;
  body: string;
  skill: SkillDef;
}

export function buildSlotGlyphText(slotCount: number): string {
  return Array.from({ length: Math.max(0, slotCount) }, () => '□').join(' ');
}

export function buildWeightPlateText(weight: number): string {
  return String(weight);
}

export function buildFantasyCardTemplateModel(
  skill: SkillDef,
  options: {
    width?: number;
    height?: number;
    tier?: SkillTier;
    artAnchor?: FantasyArtAnchor;
  } = {},
): FantasyCardTemplateModel {
  const tier = options.tier ?? skill.tier;
  const width = options.width ?? FANTASY_CARD_TEMPLATE_SPEC.baseSize.width;
  const height = options.height ?? FANTASY_CARD_TEMPLATE_SPEC.baseSize.height;
  const weight = weightOf(skill);

  return {
    size: { width, height },
    tier,
    skin: getFantasyCardTierSkin(tier),
    regions: FANTASY_CARD_TEMPLATE_SPEC.regions,
    titleRule: selectTitleRule(skill.name),
    bodyRule: selectBodyRule(skill.text, skill.effects.length),
    wtRule: selectWtRule(weight),
    artAnchor: options.artAnchor ?? 'center',
    type: cardTypeBadge(skill),
    archetypes: archetypeBadges(skill),
    weight,
    slotLabel: 'Slot',
    slotBoxCount: skill.size,
    title: skill.name,
    body: skill.text,
    skill,
  };
}
