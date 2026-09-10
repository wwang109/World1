import { skillBook } from '../../data/skills';
import { guaranteedPowerLevelDeci } from '../../engine/balance';
import { applyTier } from '../../engine/cards';
import type { SkillDef, SkillTier } from '../../engine/types';

export interface AvailableTierUpgradePreview {
  available: true;
  skillId: string;
  from: SkillTier;
  to: SkillTier;
  fromSkill: SkillDef;
  toSkill: SkillDef;
  guaranteedDeltaDeci: number;
  conditionalTrade: boolean;
}

export interface UnavailableTierUpgradePreview {
  available: false;
  skillId: string;
  from: SkillTier;
  to: SkillTier;
}

export type TierUpgradePreview = AvailableTierUpgradePreview | UnavailableTierUpgradePreview;

/** Resolves both faces of one prospective tier change through the canonical
 * tier resolver. UI callers consume the resolved destination and this single
 * guaranteed-PL comparison; they never duplicate balance rules or capstone IDs. */
export function tierUpgradePreview(
  skillId: string,
  from: SkillTier,
  to: SkillTier,
): TierUpgradePreview {
  const base = skillBook[skillId];
  if (!base) return { available: false, skillId, from, to };

  const fromSkill = applyTier(base, from);
  const toSkill = applyTier(base, to);
  const guaranteedDeltaDeci = guaranteedPowerLevelDeci(toSkill) - guaranteedPowerLevelDeci(fromSkill);
  return {
    available: true,
    skillId,
    from,
    to,
    fromSkill,
    toSkill,
    guaranteedDeltaDeci,
    conditionalTrade: guaranteedDeltaDeci < 0,
  };
}
