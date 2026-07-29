import type { BattleLog } from '../run/resolveBattle';
import { battleGoldReward, type BattleFoeSummary } from '../run/shop';
import type { BattleTimelineInput } from './battleTimeline';
import { demoState, MAX_GOLD } from './demoState';

/**
 * Credits the gold payout for ONE fetched battle response: `base` (always) +
 * `winBonus` (only on a win), computed from the EXACT foe configs the request
 * was built from + the hero level that fought it. Callers own the "exactly
 * once per fetched response" guard (compare the `log` object identity to the
 * last one credited) — this function just does the math + the mutation.
 */
export function creditBattleGold(input: BattleTimelineInput, log: BattleLog): number {
  const foes: BattleFoeSummary[] = (input.enemyTeam && input.enemyTeam.length > 0
    ? input.enemyTeam
    : [{
      enemyId: input.enemyId, level: input.enemyLevel, title: input.enemyTitle,
      rank: input.enemyRank, modifiers: input.enemyModifiers ?? [],
    }]
  ).map((f) => ({ level: f.level, title: f.title, rank: f.rank, modifiers: f.modifiers }));
  const reward = battleGoldReward(foes, input.heroLevel);
  const payout = reward.base + (log.result === 'win' ? reward.winBonus : 0);
  demoState.gold = Math.max(0, Math.min(MAX_GOLD, demoState.gold + payout));
  return payout;
}
