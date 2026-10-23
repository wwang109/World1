import { simulate } from '../engine/combat/simulate';
import { skillBook } from '../data/skills';
import { buildAutoHeroSetup } from './encounter';
import type { BattleLog } from './resolveBattle';
import {
  DESIGN_PROBE_HERO_ALLOCATION,
  DESIGN_PROBE_HERO_LEVEL,
  DESIGN_PROBE_SEED,
  DESIGN_PROBE_TURNS,
  designProbeFoeSetup,
  designProbeHeroPieces,
  designProbeSkill,
  type DesignBattleRequest,
} from './designProbe';

export type { DesignBattleRequest } from './designProbe';

export function resolveDesignBattle(request: DesignBattleRequest): BattleLog {
  const skill = designProbeSkill(request);
  const hero = buildAutoHeroSetup(
    DESIGN_PROBE_HERO_LEVEL, designProbeHeroPieces(skill, request.tier), DESIGN_PROBE_HERO_ALLOCATION,
  ).setup;
  const { events, result, turns } = simulate({
    playerTeam: [hero],
    enemyTeam: [designProbeFoeSetup()],
    skillBook: { ...skillBook, [skill.id]: skill },
    suddenDeathRound: 1_000_000,
    fatigueTurn: 1_000_000,
    attritionTurn: 1_000_000,
    maxTurns: DESIGN_PROBE_TURNS,
  }, DESIGN_PROBE_SEED);
  return { events, result, turns };
}
