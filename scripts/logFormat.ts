// The CLI combat log's DAMAGE LEDGER renderer — extracted from scripts/fight.ts
// so it can be unit-tested.
//
// WHY IT LIVES HERE. `scripts/fight.ts` runs its fight at import time (it is a
// CLI entry point: parse argv, simulate, print), so nothing inside it can be
// imported by a test without running a fight and dumping a log. That is exactly
// how the bug below survived: the game's own math strip
// (`formatDmg`, src/game/battleTimeline.ts) is covered by
// tests/game/battleTimeline.test.ts and was FIXED when the same two terms went
// missing there, while this renderer — the one every engine-side audit and
// `npm run fight` session reads — had no test that could reach it and stayed
// wrong. Moving fourteen lines into a plain module closes that asymmetry
// permanently; tests/engine/damageLedger.test.ts now drives BOTH renderers over
// the same simulated hits.
//
// THE BUG (found 2026-08-21 by sweeping a config matrix): the term list had no
// `exposeBonus`, so on any hit amplified by an active `expose` the printed
// terms summed to LESS than the printed total — 206 of 2208 audited hits, e.g.
// `26 ... = 33 HP`. The engine's arithmetic was right in all 2208; only the
// rendering of it was short a term.
import type { DamageCalculation } from '../src/engine/combat/events';

/**
 * One direct hit's arithmetic as a closed ledger: `parts = total`.
 *
 * INVARIANT (locked by tests/engine/damageLedger.test.ts): every printed term
 * sums to the printed `hpDamage`. A math line a reader cannot add up is worse
 * than no math line — it reads as authoritative and is not.
 *
 * ORDER follows the engine's own pipeline (`applyStrike`/`dealDamage`,
 * src/engine/combat/interpreter.ts), the same order the in-game strip uses: the
 * minimum-1 floor lands right after the defense subtraction, then the matchup
 * and ramp additions, then GUARD (a % reduction) and EXPOSE (its mirror, a %
 * amplification) inside `dealDamage`, and finally what the victim's shield ate.
 */
export function fmtDamage(c: DamageCalculation): string {
  const terms = [`${c.baseDamage}`];
  const add = (label: string, value: number): void => {
    if (value !== 0) terms.push(`${value > 0 ? '+' : '-'}${label}${Math.abs(value)}`);
  };
  add('STAT', c.statBonusDamage);
  add('BONUS', c.effectBonusDamage);
  add('DEF', -c.defense);
  add('MIN', c.minimumDamageBonus);
  add('AFFINITY', c.matchupBonusDamage);
  add('RAMP', c.suddenDeathBonusDamage);
  add('GUARD', -c.guardReduction);
  add('EXPOSE', c.exposeBonus ?? 0);
  add('BLOCK', -c.shieldBlocked);
  const bonusLabel = `+${c.effectBonusDamage} aura/combo`;
  return `${terms.join(' ')} = ${c.hpDamage} HP (${c.scalingStat} ${c.baseStat}->${c.effectiveStat}, ${bonusLabel})`;
}
