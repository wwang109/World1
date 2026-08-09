// Deterministic config sweep shared by the outcome-rule regression test and the
// script that captured its pre-change baseline
// (`tests/engine/fixtures/outcomeBaseline.json`). Both sides MUST build the
// exact same configs, so this generator lives in one file and is imported by
// both — never copy it.
import { Rng } from '../../../src/engine/rng';
import { skillBook } from '../../../src/data/skills';
import type { BoardPiece, CombatConfig, CombatantSetup } from '../../../src/engine/types';
import { FROZEN_SWEEP_SKILL_IDS } from '../fixtures/frozenSweepSkillIds';

// FROZEN, not `Object.keys(skillBook).sort()` — see frozenSweepSkillIds.ts for why.
// Adding a card to skillBook must NOT change this pool or a single new card would
// turn every outcomeBaseline.json hash red. Editing/removing a card already-in-pool
// still moves the baseline exactly as before (frozenSweepSkillIds.test.ts guards
// the "removed" case).
const SKILL_IDS: readonly string[] = FROZEN_SWEEP_SKILL_IDS;

export function sweepUnit(rng: Rng, name: string): CombatantSetup {
  const boardSize = 10;
  const pieces: BoardPiece[] = [];
  let slot = 0;
  while (slot < boardSize) {
    if (rng.pct(65)) {
      const skillId = SKILL_IDS[rng.int(SKILL_IDS.length)]!;
      const size = skillBook[skillId]!.size;
      if (slot + size <= boardSize) {
        pieces.push({ skillId, slot });
        slot += size;
        continue;
      }
    }
    slot += 1;
  }
  const maxHp = 40 + rng.int(260);
  return {
    name,
    stats: {
      maxHp,
      hp: maxHp,
      attack: 5 + rng.int(15),
      magicPower: 5 + rng.int(15),
      armor: rng.int(6),
      magicResist: rng.int(6),
      speed: 5 + rng.int(15),
    },
    boardSize,
    pieces,
  };
}

export interface SweepCase {
  config: CombatConfig;
  seed: number;
}

/**
 * `count` random 1..4-vs-1..4 fights from `baseSeed`, in a fixed order.
 * `extra` is merged into every config (e.g. `{ attritionTurn: HUGE }`).
 */
export function sweepCases(
  baseSeed: number,
  count: number,
  extra: Partial<CombatConfig> = {},
): SweepCase[] {
  const rng = new Rng(baseSeed);
  const cases: SweepCase[] = [];
  for (let i = 0; i < count; i += 1) {
    const np = 1 + rng.int(4);
    const ne = 1 + rng.int(4);
    const config: CombatConfig = {
      playerTeam: Array.from({ length: np }, (_, k) => sweepUnit(rng, `p${k}`)),
      enemyTeam: Array.from({ length: ne }, (_, k) => sweepUnit(rng, `e${k}`)),
      skillBook,
      ...extra,
    };
    cases.push({ config, seed: rng.int(2 ** 31) });
  }
  return cases;
}
