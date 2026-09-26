// Challenge-fight enemy dials — the off-column battle a `challengeFight`
// event outcome starts (2026-09-25). Reuses the SAME depth-gated pools and
// title/rank package the fight column itself uses (fightSpecFor/
// titlePresetFor), keyed off the event node's own `wave` — `fightNumber ==
// wave` for every node in a wave (runMap.ts), so this is the identical depth
// measure that wave's own fight column would gate against. Its own hashSeed
// domain spends no draw off the node's `eventSeed` stream.

import type { EventChallengeDifficultyV3, EventChallengeRewardSpecV3 } from '../data/eventContentV3';
import { enemies } from '../data/enemies';
import { hashSeed, Rng } from '../engine/rng';
import { titlePresetFor, type EnemyTitle } from './encounter';
import { anchorPoolFor, computeEnemyDepthBands, type DepthBand } from './enemyDepth';
import { fightSpecFor, type RunState } from './runState';

export type ChallengeDifficulty = EventChallengeDifficultyV3;

const CHALLENGE_FIGHT_POOL: readonly string[] = Object.values(enemies)
  .filter((e) => !e.isBoss)
  .map((e) => e.id);
const CHALLENGE_FIGHT_POOL_BANDS: Readonly<Record<string, DepthBand>> = computeEnemyDepthBands(
  Object.values(enemies).filter((e) => !e.isBoss),
);

const TITLE_STEP: readonly EnemyTitle[] = ['mob', 'normal', 'elite', 'boss'];
const DIFFICULTY_STEPS: Readonly<Record<ChallengeDifficulty, number>> = { standard: 0, hard: 1, elite: 2 };

function steppedTitle(title: EnemyTitle, steps: number): EnemyTitle {
  const index = Math.min(TITLE_STEP.length - 1, TITLE_STEP.indexOf(title) + steps);
  return TITLE_STEP[index]!;
}

export interface ChallengeEnemyDials {
  enemyId: string;
  level: number;
  title: EnemyTitle;
  rank: number;
  modifiers: readonly string[];
  fightNumber: number;
  /** A challenge node is never `node.kind === 'boss'`, so any `'boss'` title
   * this rolled is always a difficulty-STEPPED bump (`BUMPED_BOSS_PRESET`),
   * never a milestone — see `encounter.ts`'s split. */
  bumped: boolean;
}

/** Deterministic solo enemy pick for a `challengeFight` choice: same
 * (runSeed, instanceId, choiceId) always resolves to the identical dials. */
export function rollChallengeFightEnemy(
  runSeed: number,
  wave: number,
  instanceId: string,
  choiceId: string,
  difficulty: ChallengeDifficulty,
): ChallengeEnemyDials {
  const base = fightSpecFor(wave);
  const steps = DIFFICULTY_STEPS[difficulty];
  const title = steppedTitle(base.title, steps);
  const bumped = title === 'boss';
  const rank = titlePresetFor(title, wave, bumped).rank;
  const level = Math.max(1, base.level + steps);
  const rng = new Rng(hashSeed('challengeFight', runSeed, instanceId, choiceId));
  const anchorPool = anchorPoolFor(CHALLENGE_FIGHT_POOL, CHALLENGE_FIGHT_POOL_BANDS, wave);
  const enemyId = anchorPool[rng.int(anchorPool.length)]!;
  return { enemyId, level, title, rank, modifiers: base.modifiers, fightNumber: wave, bumped };
}

/** The persisted off-column battle a `challengeFight` choice started — the
 * SAME "an extra fight the fight column never sees" shape as
 * `RunState.activeGhostFight`, sourced from an event choice instead of a
 * ghost roll. `reward` is the exact authored spec `recordChallengeFightResult`
 * (`eventsV3.ts`) resolves on a win; a loss drops this to null with nothing
 * granted. */
export interface ActiveChallengeFight extends ChallengeEnemyDials {
  nodeId: string;
  instanceId: string;
  choiceId: string;
  difficulty: ChallengeDifficulty;
  reward: EventChallengeRewardSpecV3;
}

/** Start the one active challenge fight this event choice rolled. Throws if
 * another challenge fight is already in progress (an event node resolves its
 * rungs once — see `resolveEventChoiceV3` — so this should be unreachable in
 * practice; guarded rather than silently overwriting an unresolved battle). */
export function startChallengeFight(
  state: RunState,
  wave: number,
  nodeId: string,
  instanceId: string,
  choiceId: string,
  difficulty: ChallengeDifficulty,
  reward: EventChallengeRewardSpecV3,
): RunState {
  if (state.activeChallengeFight) {
    throw new Error('startChallengeFight: a challenge fight is already active');
  }
  const dials = rollChallengeFightEnemy(state.map.seed, wave, instanceId, choiceId, difficulty);
  return {
    ...state,
    activeChallengeFight: { nodeId, instanceId, choiceId, difficulty, reward, ...dials },
  };
}
