import { weightOf, type SkillDef, type SkillTier } from '../../engine/types';
import { renderSkillClauses, renderSkillText } from '../../engine/keywords/compose';
import type { TierProgress } from '../../run/shop';
import { archetypeBadges, cardTypeBadge } from './cardArtPresentation';
import {
  FANTASY_CARD_TEMPLATE_SPEC,
  selectBodyRule,
  selectTitleRule,
  selectWtRule,
} from './fantasyCardTemplateSpec';
import { getFantasyCardTierSkin } from './fantasyCardTierSkins';
import { tierProgressPips } from './tierProgressDisplay';

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
  /** Filled/open pip string toward the next tier (e.g. "●○"), or `null` when
   * no `progress` was supplied or the tier is Diamond. Shop offer faces and
   * catalog previews pass no `progress` and get `null`. */
  progressPips: string | null;
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
    progress?: TierProgress;
  } = {},
): FantasyCardTemplateModel {
  const tier = options.tier ?? skill.tier;
  const width = options.width ?? FANTASY_CARD_TEMPLATE_SPEC.baseSize.width;
  const height = options.height ?? FANTASY_CARD_TEMPLATE_SPEC.baseSize.height;
  const weight = weightOf(skill);
  // THE FACE BODY IS GENERATED from `effects` (`renderSkillText`) — there is
  // no authored `text` field any more.
  const body = renderSkillText(skill);
  // DENSITY reads the POST-MERGE CLAUSE COUNT, not `effects.length`. The
  // generator collapses the piles the engine itself merges (four `thorns`
  // lines into one) and folds a multi-hit into a single counted clause, so the
  // raw action count would over-penalise exactly the cards the merge rule
  // exists to help — `rimebarb_vigil@diamond` prints 2 clauses from 5 actions.
  const clauseCount = renderSkillClauses(skill).length;

  return {
    size: { width, height },
    tier,
    skin: getFantasyCardTierSkin(tier),
    regions: FANTASY_CARD_TEMPLATE_SPEC.regions,
    titleRule: selectTitleRule(skill.name),
    bodyRule: selectBodyRule(body, clauseCount),
    wtRule: selectWtRule(weight),
    artAnchor: options.artAnchor ?? 'center',
    type: cardTypeBadge(skill),
    archetypes: archetypeBadges(skill),
    weight,
    slotLabel: 'Slot',
    slotBoxCount: skill.size,
    title: skill.name,
    body,
    skill,
    progressPips: options.progress ? tierProgressPips(options.progress) : null,
  };
}
