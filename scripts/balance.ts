// Headless N-fight balance sim harness.
//   npm run sim                 (hero board vs every demo enemy, 300 seeds each)
//   npm run sim -- 1000         (1000 seeds per matchup)
//   npm run sim -- 500 wolf_king  (focus one enemy, print damage-by-source breakdown)
import { simulate } from '../src/engine/combat/simulate';
import { hashSeed } from '../src/engine/rng';
import { powerLevel } from '../src/engine/balance';
import { skillBook } from '../src/data/skills';
import { BASE_HERO_STATS, HERO_BOARD_SLOTS } from '../src/data/heroes';
import { enemies } from '../src/data/enemies';
import type { CombatantSetup, CombatOutcome, Property, SkillBook } from '../src/engine/types';

const BASE_SEED_DEFAULT = 0xba1a4ce;

/** The representative starter board fight.ts also exercises. */
const HERO_BOARD: CombatantSetup = {
  name: 'Hero',
  stats: { ...BASE_HERO_STATS },
  boardSize: HERO_BOARD_SLOTS,
  pieces: [
    { skillId: 'war_banner', slot: 0 },
    { skillId: 'sword_slash', slot: 1 },
    { skillId: 'crushing_blow', slot: 2 },
    { skillId: 'iron_bulwark', slot: 5 },
    { skillId: 'second_wind', slot: 7 },
  ],
};

type DamageSource = 'skill' | 'poison' | 'burn' | 'fatigue';

export interface MatchupStats {
  fights: number;
  wins: number;
  losses: number;
  draws: number;
  turnsTotal: number;
  turnsMin: number;
  turnsMax: number;
  playerHpLeftOnWinTotal: number;
  enemyHpLeftOnLossTotal: number;
  /** Total damage dealt TO the enemy (i.e. player's output), by property. */
  damageByProperty: Record<Property, number>;
  /** Total damage dealt TO the enemy, by source. */
  damageBySource: Record<DamageSource, number>;
}

function emptyMatchupStats(): MatchupStats {
  return {
    fights: 0,
    wins: 0,
    losses: 0,
    draws: 0,
    turnsTotal: 0,
    turnsMin: Infinity,
    turnsMax: -Infinity,
    playerHpLeftOnWinTotal: 0,
    enemyHpLeftOnLossTotal: 0,
    damageByProperty: { physical: 0, magical: 0, true: 0 },
    damageBySource: { skill: 0, poison: 0, burn: 0, fatigue: 0 },
  };
}

/**
 * Runs `simulate` once per seed and aggregates outcome/turn/damage stats.
 * Fully deterministic: caller supplies the exact seed list (see `seedsFor`).
 */
export function runMatchup(
  playerSetup: CombatantSetup,
  enemySetup: CombatantSetup,
  skillBook: SkillBook,
  seeds: number[],
): MatchupStats {
  const stats = emptyMatchupStats();

  for (const seed of seeds) {
    const { result, turns, events, finalState } = simulate(
      { player: playerSetup, enemy: enemySetup, skillBook },
      seed,
    );

    stats.fights += 1;
    stats.turnsTotal += turns;
    stats.turnsMin = Math.min(stats.turnsMin, turns);
    stats.turnsMax = Math.max(stats.turnsMax, turns);

    if (result === 'win') {
      stats.wins += 1;
      stats.playerHpLeftOnWinTotal += Math.max(0, finalState.player.stats.hp);
    } else if (result === 'loss') {
      stats.losses += 1;
      stats.enemyHpLeftOnLossTotal += Math.max(0, finalState.enemy.stats.hp);
    } else {
      stats.draws += 1;
    }

    for (const e of events) {
      if (e.kind !== 'damage') continue;
      if (e.side !== 'enemy') continue; // damage dealt TO the enemy = player's output
      stats.damageByProperty[e.property] += e.amount;
      stats.damageBySource[e.source] += e.amount;
    }
  }

  return stats;
}

export interface MatchupSummary {
  winrate: number;
  draws: number;
  avgTurns: number;
  minTurns: number;
  maxTurns: number;
  avgPlayerHpLeftOnWin: number;
  avgEnemyHpLeftOnLoss: number;
}

export function summarize(stats: MatchupStats): MatchupSummary {
  return {
    winrate: stats.fights === 0 ? 0 : (stats.wins / stats.fights) * 100,
    draws: stats.draws,
    avgTurns: stats.fights === 0 ? 0 : stats.turnsTotal / stats.fights,
    minTurns: Number.isFinite(stats.turnsMin) ? stats.turnsMin : 0,
    maxTurns: Number.isFinite(stats.turnsMax) ? stats.turnsMax : 0,
    avgPlayerHpLeftOnWin: stats.wins === 0 ? 0 : stats.playerHpLeftOnWinTotal / stats.wins,
    avgEnemyHpLeftOnLoss: stats.losses === 0 ? 0 : stats.enemyHpLeftOnLossTotal / stats.losses,
  };
}

/** Deterministic per-fight seeds derived from a base seed — no Math.random/Date.now. */
export function seedsFor(baseSeed: number, matchupTag: string, n: number): number[] {
  const seeds: number[] = [];
  for (let i = 0; i < n; i++) {
    seeds.push(hashSeed(baseSeed, matchupTag, i));
  }
  return seeds;
}

function boardPowerLevel(setup: CombatantSetup, book: SkillBook): number {
  let total = 0;
  for (const piece of setup.pieces) {
    const def = book[piece.skillId];
    if (def) total += powerLevel(def);
  }
  return total;
}

function pad(s: string, n: number): string {
  return s.length >= n ? s : s + ' '.repeat(n - s.length);
}

function padNum(s: string, n: number): string {
  return s.length >= n ? s : ' '.repeat(n - s.length) + s;
}

function fmt1(n: number): string {
  return n.toFixed(1);
}

function notesFor(summary: MatchupSummary): string {
  if (summary.winrate >= 90) return 'lopsided (player)';
  if (summary.winrate <= 10) return 'lopsided (enemy)';
  if (summary.winrate >= 40 && summary.winrate <= 60) return 'even';
  return '';
}

function main(): void {
  const args = process.argv.slice(2);
  const baseSeed = BASE_SEED_DEFAULT;
  const n = args[0] ? Number(args[0]) : 300;
  const focusEnemyId = args[1];

  if (!Number.isFinite(n) || n <= 0) {
    console.error(`Invalid seed count: ${args[0]}`);
    process.exit(1);
  }

  const heroPl = boardPowerLevel(HERO_BOARD, skillBook);
  console.log(`Hero board total PL: ${fmt1(heroPl)} (${HERO_BOARD.pieces.map((p) => p.skillId).join(', ')})\n`);

  const enemyIds = focusEnemyId ? [focusEnemyId] : Object.keys(enemies);
  for (const id of enemyIds) {
    if (!enemies[id]) {
      console.error(`Unknown enemy '${id}'. Options: ${Object.keys(enemies).join(', ')}`);
      process.exit(1);
    }
  }

  const rows: { id: string; summary: MatchupSummary; stats: MatchupStats }[] = [];
  for (const id of enemyIds) {
    const enemy = enemies[id]!;
    const enemySetup: CombatantSetup = {
      name: enemy.name,
      stats: { ...enemy.stats },
      boardSize: enemy.boardSize,
      pieces: [...enemy.pieces],
      elementAffinity: enemy.elementAffinity,
      weaponAffinity: enemy.weaponAffinity,
    };
    const seeds = seedsFor(baseSeed, id, n);
    const stats = runMatchup(HERO_BOARD, enemySetup, skillBook, seeds);
    rows.push({ id, summary: summarize(stats), stats });
  }

  const header = `${pad('enemy', 16)} ${padNum('winrate', 8)} ${padNum('draws', 6)} ${padNum('avgTurns', 9)} ${padNum('minT', 5)} ${padNum('maxT', 5)} ${padNum('avgPHpLeft', 11)} notes`;
  console.log(header);
  console.log('-'.repeat(header.length));
  for (const { id, summary } of rows) {
    console.log(
      `${pad(id, 16)} ${padNum(fmt1(summary.winrate) + '%', 8)} ${padNum(String(summary.draws), 6)} ` +
        `${padNum(fmt1(summary.avgTurns), 9)} ${padNum(String(summary.minTurns), 5)} ${padNum(String(summary.maxTurns), 5)} ` +
        `${padNum(fmt1(summary.avgPlayerHpLeftOnWin), 11)} ${notesFor(summary)}`,
    );
  }

  if (focusEnemyId) {
    const { stats } = rows[0]!;
    console.log(`\nDamage-by-source breakdown vs ${focusEnemyId} (${n} seeds, total damage dealt to enemy):`);
    const totalDamage = Object.values(stats.damageBySource).reduce((a, b) => a + b, 0);
    for (const [source, amount] of Object.entries(stats.damageBySource)) {
      const pct = totalDamage === 0 ? 0 : (amount / totalDamage) * 100;
      console.log(`  ${pad(source, 10)} ${padNum(String(amount), 8)} (${fmt1(pct)}%)`);
    }
    console.log(`\nDamage-by-property breakdown vs ${focusEnemyId}:`);
    const totalByProp = Object.values(stats.damageByProperty).reduce((a, b) => a + b, 0);
    for (const [prop, amount] of Object.entries(stats.damageByProperty)) {
      const pct = totalByProp === 0 ? 0 : (amount / totalByProp) * 100;
      console.log(`  ${pad(prop, 10)} ${padNum(String(amount), 8)} (${fmt1(pct)}%)`);
    }
  }
}

// Only run the CLI when this file is executed directly (e.g. `tsx scripts/balance.ts`),
// not when imported by tests.
const isMain = process.argv[1] && /balance\.(ts|js)$/.test(process.argv[1].replace(/\\/g, '/'));
if (isMain) main();
