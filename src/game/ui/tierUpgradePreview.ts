import { skillBook } from '../../data/skills';
import { guaranteedPowerLevelDeci, powerLevelDeci } from '../../engine/balance';
import { applyTier } from '../../engine/cards';
import type { SkillDef, SkillTier } from '../../engine/types';

/**
 * THREE STATES `guaranteedDeltaDeci` (`guaranteedPowerLevelDeci(to) -
 * guaranteedPowerLevelDeci(from)`, `engine/balance.ts`) can report, mutually
 * exclusive:
 *   delta > 0  plain improvement — no flag set.
 *   delta = 0  `conditionalGain` — the whole gain sits behind an affinity
 *              gate; guaranteed (worst-board) value is unchanged, nothing
 *              surrendered. Requires the RAW budget to have grown too
 *              (`powerLevelDeci` delta > 0), so a no-op step can never read
 *              as a gain.
 *   delta < 0  `conditionalTrade` — guaranteed value itself SHRANK, a real
 *              trade. Keep reading this as "surrendered value", never as a
 *              catch-all for "weak upgrade".
 */
export interface AvailableTierUpgradePreview {
  available: true;
  skillId: string;
  from: SkillTier;
  to: SkillTier;
  fromSkill: SkillDef;
  toSkill: SkillDef;
  guaranteedDeltaDeci: number;
  conditionalTrade: boolean;
  conditionalGain: boolean;
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
  const rawDeltaDeci = powerLevelDeci(toSkill) - powerLevelDeci(fromSkill);
  return {
    available: true,
    skillId,
    from,
    to,
    fromSkill,
    toSkill,
    guaranteedDeltaDeci,
    conditionalTrade: guaranteedDeltaDeci < 0,
    conditionalGain: guaranteedDeltaDeci === 0 && rawDeltaDeci > 0,
  };
}
