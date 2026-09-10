import type { SkillTier } from '../../../src/engine/types';

export const AFFINITY_CAPSTONE_IDS = [
  'arcane_bolt',
  'hunter_shot',
  'judgment_light',
  'lance_thrust',
  'leeching_fang',
] as const;

export type AffinityCapstoneId = (typeof AFFINITY_CAPSTONE_IDS)[number];

/** Only the Gold -> Diamond transition may trade guaranteed output for one
 * of these conditional capstones. Known IDs receive no lower-rung pass. */
export function isAllowedAffinityCapstoneRegression(id: string, toTier: SkillTier): boolean {
  return toTier === 'diamond' && AFFINITY_CAPSTONE_IDS.includes(id as AffinityCapstoneId);
}

export interface AffinityCapstoneContract {
  readonly id: AffinityCapstoneId;
  readonly gold: {
    readonly totalPlDeci: number;
    readonly guaranteedPlDeci: number;
    readonly baseHit: number;
  };
  readonly diamond: {
    readonly totalPlDeci: number;
    readonly guaranteedPlDeci: number;
    readonly baseHit: number;
    readonly gatedHit: number;
  };
  readonly gatedAction: {
    readonly affinity: true;
    readonly minTier: 'diamond';
  };
}

export const AFFINITY_CAPSTONE_CONTRACTS = [
  {
    id: 'arcane_bolt',
    gold: { totalPlDeci: 200, guaranteedPlDeci: 200, baseHit: 38 },
    diamond: { totalPlDeci: 250, guaranteedPlDeci: 130, baseHit: 24, gatedHit: 48 },
    gatedAction: { affinity: true, minTier: 'diamond' },
  },
  {
    id: 'hunter_shot',
    gold: { totalPlDeci: 200, guaranteedPlDeci: 200, baseHit: 40 },
    diamond: { totalPlDeci: 250, guaranteedPlDeci: 170, baseHit: 34, gatedHit: 32 },
    gatedAction: { affinity: true, minTier: 'diamond' },
  },
  {
    id: 'judgment_light',
    gold: { totalPlDeci: 200, guaranteedPlDeci: 200, baseHit: 32 },
    diamond: { totalPlDeci: 250, guaranteedPlDeci: 170, baseHit: 26, gatedHit: 32 },
    gatedAction: { affinity: true, minTier: 'diamond' },
  },
  {
    id: 'lance_thrust',
    gold: { totalPlDeci: 200, guaranteedPlDeci: 200, baseHit: 40 },
    diamond: { totalPlDeci: 250, guaranteedPlDeci: 130, baseHit: 26, gatedHit: 48 },
    gatedAction: { affinity: true, minTier: 'diamond' },
  },
  {
    id: 'leeching_fang',
    gold: { totalPlDeci: 200, guaranteedPlDeci: 200, baseHit: 36 },
    diamond: { totalPlDeci: 250, guaranteedPlDeci: 170, baseHit: 30, gatedHit: 32 },
    gatedAction: { affinity: true, minTier: 'diamond' },
  },
] as const satisfies readonly AffinityCapstoneContract[];
