// Headless N-fight balance sim harness.
//   npm run sim                        (hero board vs every demo enemy, 300 seeds each)
//   npm run sim -- 1000                (1000 seeds per matchup)
//   npm run sim -- 500 wolf_king        (focus one enemy, print damage-by-source breakdown)
//   npm run sim -- build <buildId> <enemyId> [n]   (pit a named board vs a named enemy)
//   npm run sim -- demo [n]            (PL-vs-PL demonstration: synergy/counter-pick beats
//                                        a higher-board-PL "fair" opponent; naive equal-PL
//                                        board does worse against the same opponent)
import { simulate1v1 } from '../src/engine/combat/simulate';
import { hashSeed } from '../src/engine/rng';
import { powerLevel } from '../src/engine/balance';
import { skillBook } from '../src/data/skills';
import { BASE_HERO_STATS, HERO_BOARD_SLOTS } from '../src/data/heroes';
import { enemies } from '../src/data/enemies';
import type { BoardPiece, CombatantSetup, CombatOutcome, Property, SkillBook } from '../src/engine/types';

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

// ---------------------------------------------------------------------------
// PL-centric build lab (scripts-only; no src/ data touched).
//
// Locked model: board PL = sum of powerLevel(card) over the board's pieces
// (board cards ONLY — stats/HP are a separate axis, reported alongside but
// never folded into the PL sum).
// ---------------------------------------------------------------------------

/**
 * A "fair" test opponent, defined here (not in src/data) so the demonstration
 * below isolates board PL as the variable: its stats/HP are set equal to the
 * hero's own base stats, but its board carries MORE / a wider kit of cards,
 * i.e. clearly HIGHER board PL. It also nails down a weapon + element
 * affinity so a counter-picking build has something concrete to punish.
 */
const FAIR_ENEMY: CombatantSetup = {
  name: 'Fair Test Enemy (higher board PL, hero-equal stats)',
  stats: { ...BASE_HERO_STATS },
  boardSize: 12,
  weaponAffinity: 'axe',
  elementAffinity: 'nature',
  pieces: [
    { skillId: 'crushing_blow', slot: 0 }, // axe, size 3 -> 0,1,2
    { skillId: 'rending_claws', slot: 3 }, // beast, size 3 -> 3,4,5
    { skillId: 'hex_of_frailty', slot: 6 },
    { skillId: 'mending_light', slot: 7 }, // size 2 -> 7,8
    { skillId: 'iron_bulwark', slot: 9 }, // size 2 -> 9,10
    { skillId: 'battle_howl', slot: 11 },
  ],
};

/**
 * The low-PL synergy + counter-pick build (~40 board PL, 4 Bronze cards):
 *   - war_banner (support aura): +25% damage to touching Offense cards.
 *     Placed in the MIDDLE of the mini-cluster so BOTH neighbors (sword_slash,
 *     follow_through) get buffed — every slot of budget pulls double duty.
 *   - sword_slash / follow_through: both `sword` weapon. FAIR_ENEMY's
 *     weaponAffinity is `axe`, and sword beats axe on the weapon triangle
 *     (WEAPON_BEATS.sword === 'axe') -> +50% weapon-triangle advantage on
 *     BOTH of them, stacked on top of the aura.
 *   - follow_through's comboBonus (+150% if the previous cast was also
 *     Offense) is set up to fire off the back of sword_slash.
 *   - fireball is `fire` element; FAIR_ENEMY's elementAffinity is `nature`,
 *     and fire beats nature on the element wheel (ELEMENT_BEATS.fire ===
 *     'nature') -> +50% elemental advantage, plus a 3-turn burn DoT that
 *     doesn't care about the enemy's shield/mitigation math.
 * Net effect: every single damage-dealing card in this 40-PL board is
 * either aura-buffed, weapon-advantaged, element-advantaged, or all three.
 */
const SYNERGY_BUILD: CombatantSetup = {
  name: 'Synergy+Counter Build (~40 PL)',
  stats: { ...BASE_HERO_STATS },
  boardSize: 10,
  pieces: [
    { skillId: 'sword_slash', slot: 0 }, // touches war_banner (edge 0-1); sword beats axe
    { skillId: 'war_banner', slot: 1 }, // aura: +25% dmg to adjacent Offense cards
    { skillId: 'follow_through', slot: 2 }, // touches war_banner (edge 1-2); sword beats axe; comboBonus
    { skillId: 'fireball', slot: 3 }, // fire beats nature (elemental advantage) + burn DoT
  ],
};

/**
 * A NAIVE build at HIGHER board PL than FAIR_ENEMY (70 PL vs the enemy's
 * ~59.5 PL, 7 Bronze cards) — MORE raw budget than both the synergy build
 * (40 PL) and the opponent itself, but no aura synergy and actively
 * mismatched weapon/element choices against FAIR_ENEMY's axe/nature
 * affinities:
 *   - crippling_strike / hamstring: `lance` weapon. Axe beats lance
 *     (WEAPON_BEATS.axe === 'lance') -> these two take the −25% weapon
 *     DISADVANTAGE, not an advantage.
 *   - arcane_bolt: `lightning` element. Nature beats lightning
 *     (ELEMENT_BEATS.nature === 'lightning') -> −25% elemental disadvantage.
 *   - The rest (rending_claws, iron_bulwark, mending_light, second_wind) are
 *     plain neutral picks with no aura or combo interaction between them.
 * This proves the win in the demo below is driven by counter-picking and
 * aura placement, not merely by spending more PL.
 */
const NAIVE_BUILD: CombatantSetup = {
  name: 'Naive Higher-PL Build (70 PL, no synergy/counters)',
  stats: { ...BASE_HERO_STATS },
  boardSize: 12,
  pieces: [
    { skillId: 'crippling_strike', slot: 0 }, // lance -> disadvantage vs axe affinity; size 2 -> 0,1
    { skillId: 'hamstring', slot: 2 }, // lance -> disadvantage vs axe affinity
    { skillId: 'arcane_bolt', slot: 3 }, // lightning -> disadvantage vs nature affinity
    { skillId: 'rending_claws', slot: 4 }, // beast, size 3, neutral -> 4,5,6
    { skillId: 'iron_bulwark', slot: 7 }, // size 2 -> 7,8
    { skillId: 'mending_light', slot: 9 }, // size 2 -> 9,10
    { skillId: 'second_wind', slot: 11 },
  ],
};

type DamageSource = 'skill' | 'poison' | 'burn' | 'bleed' | 'fatigue' | 'attrition';

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
    damageBySource: { skill: 0, poison: 0, burn: 0, bleed: 0, fatigue: 0, attrition: 0 },
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
    const { result, turns, events, finalState } = simulate1v1(
      playerSetup,
      enemySetup,
      { skillBook },
      seed,
    );

    stats.fights += 1;
    stats.turnsTotal += turns;
    stats.turnsMin = Math.min(stats.turnsMin, turns);
    stats.turnsMax = Math.max(stats.turnsMax, turns);

    if (result === 'win') {
      stats.wins += 1;
      stats.playerHpLeftOnWinTotal += Math.max(0, finalState.player.stats.hp);
    } else {
      stats.losses += 1;
      stats.enemyHpLeftOnLossTotal += Math.max(0, finalState.enemy.stats.hp);
    }
    // `draws` stays 0 by construction: CombatOutcome is win|loss — a fight is
    // always decided (user-locked 2026-07-31). The column is kept so the report
    // visibly proves it.

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

/**
 * Board PL = sum of powerLevel(card) over a board's pieces. Board cards ONLY
 * — stats/HP are a separate axis and are never folded into this sum.
 */
export function boardPL(pieces: BoardPiece[], book: SkillBook): number {
  let total = 0;
  for (const piece of pieces) {
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

/** All named builds available to `build <buildId> <enemyId>`. */
const BUILDS: Record<string, CombatantSetup> = {
  demo_hero: HERO_BOARD,
  synergy_40: SYNERGY_BUILD,
  naive_70: NAIVE_BUILD,
};

/** Named custom enemies (defined here, alongside the real src/data/enemies.ts roster). */
const CUSTOM_ENEMIES: Record<string, CombatantSetup> = {
  fair_test: FAIR_ENEMY,
};

function enemySetupFor(id: string): CombatantSetup | undefined {
  if (CUSTOM_ENEMIES[id]) return CUSTOM_ENEMIES[id];
  const enemy = enemies[id];
  if (!enemy) return undefined;
  return {
    name: enemy.name,
    stats: { ...enemy.stats },
    boardSize: enemy.boardSize,
    pieces: [...enemy.pieces],
    elementAffinity: enemy.elementAffinity,
    weaponAffinity: enemy.weaponAffinity,
  };
}

/** Runs one arbitrary hero build against one arbitrary enemy setup and prints a summary. */
function runBuildVsEnemy(
  label: string,
  heroSetup: CombatantSetup,
  enemyLabel: string,
  enemySetup: CombatantSetup,
  n: number,
  baseSeed: number,
): MatchupSummary {
  const heroPl = boardPL(heroSetup.pieces, skillBook);
  const enemyPl = boardPL(enemySetup.pieces, skillBook);
  const seeds = seedsFor(baseSeed, `${label}__vs__${enemyLabel}`, n);
  const stats = runMatchup(heroSetup, enemySetup, skillBook, seeds);
  const summary = summarize(stats);

  console.log(`${label} (heroPL ${fmt1(heroPl)}) vs ${enemyLabel} (enemyPL ${fmt1(enemyPl)})`);
  console.log(
    `  winrate ${fmt1(summary.winrate)}%  avgTurns ${fmt1(summary.avgTurns)}  ` +
      `draws ${summary.draws}  minT ${summary.minTurns}  maxT ${summary.maxTurns}  ${notesFor(summary)}`,
  );
  return summary;
}

function runDemoMode(n: number, baseSeed: number): void {
  console.log('=== PL-vs-PL demonstration: lower board PL + synergy/counter-picking vs a higher board-PL opponent ===\n');

  const heroPl = boardPL(SYNERGY_BUILD.pieces, skillBook);
  const naivePl = boardPL(NAIVE_BUILD.pieces, skillBook);
  const enemyPl = boardPL(FAIR_ENEMY.pieces, skillBook);

  console.log(`FAIR_ENEMY board PL: ${fmt1(enemyPl)} (${FAIR_ENEMY.pieces.map((p) => p.skillId).join(', ')})`);
  console.log(`  stats: hp ${FAIR_ENEMY.stats.maxHp}, attack ${FAIR_ENEMY.stats.attack}, magicPower ${FAIR_ENEMY.stats.magicPower} ` +
    `(identical to hero base stats — HP is NOT the variable here)`);
  console.log(`  weaponAffinity=${FAIR_ENEMY.weaponAffinity}, elementAffinity=${FAIR_ENEMY.elementAffinity}\n`);

  console.log(`SYNERGY_BUILD board PL: ${fmt1(heroPl)} (${SYNERGY_BUILD.pieces.map((p) => p.skillId).join(', ')})`);
  console.log(`  counters: sword_slash + follow_through (sword beats axe affinity, +50%), ` +
    `both aura-buffed +25% dmg by war_banner; fireball (fire beats nature affinity, +50%) + burn DoT\n`);

  console.log(`NAIVE_BUILD board PL: ${fmt1(naivePl)} (${NAIVE_BUILD.pieces.map((p) => p.skillId).join(', ')})`);
  console.log(`  no aura synergy; crippling_strike/hamstring (lance, −25% vs axe affinity), ` +
    `arcane_bolt (lightning, −25% vs nature affinity)\n`);

  console.log(`--- Results (${n} seeds each) ---`);
  const synergyResult = runBuildVsEnemy('SYNERGY_BUILD (low PL)', SYNERGY_BUILD, 'FAIR_ENEMY (higher PL)', FAIR_ENEMY, n, baseSeed);
  const naiveResult = runBuildVsEnemy('NAIVE_BUILD (higher PL, no synergy)', NAIVE_BUILD, 'FAIR_ENEMY (higher PL)', FAIR_ENEMY, n, baseSeed);

  console.log(
    `\nFinding: SYNERGY_BUILD spends ${fmt1(heroPl)} board PL (${fmt1(enemyPl - heroPl)} LESS than the ` +
      `${fmt1(enemyPl)}-PL opponent) and wins ${fmt1(synergyResult.winrate)}% of fights, ` +
      `while NAIVE_BUILD spends ${fmt1(naivePl)} board PL — MORE than both the synergy build AND the ` +
      `opponent itself (no PL deficit at all, a ${fmt1(naivePl - enemyPl)}-PL surplus) — ` +
      `and only wins ${fmt1(naiveResult.winrate)}%. The win is driven by aura placement + weapon/element ` +
      `counter-picking, not by raw PL spend.`,
  );
}

function main(): void {
  const args = process.argv.slice(2);
  const baseSeed = BASE_SEED_DEFAULT;

  if (args[0] === 'build') {
    const buildId = args[1];
    const enemyId = args[2];
    const n = args[3] ? Number(args[3]) : 300;
    if (!buildId || !BUILDS[buildId]) {
      console.error(`Unknown build '${buildId}'. Options: ${Object.keys(BUILDS).join(', ')}`);
      process.exit(1);
    }
    if (!enemyId) {
      console.error(`Missing enemyId. Options: ${[...Object.keys(CUSTOM_ENEMIES), ...Object.keys(enemies)].join(', ')}`);
      process.exit(1);
    }
    const enemySetup = enemySetupFor(enemyId);
    if (!enemySetup) {
      console.error(`Unknown enemy '${enemyId}'. Options: ${[...Object.keys(CUSTOM_ENEMIES), ...Object.keys(enemies)].join(', ')}`);
      process.exit(1);
    }
    if (!Number.isFinite(n) || n <= 0) {
      console.error(`Invalid seed count: ${args[3]}`);
      process.exit(1);
    }
    runBuildVsEnemy(buildId, BUILDS[buildId]!, enemyId, enemySetup, n, baseSeed);
    return;
  }

  if (args[0] === 'demo') {
    const n = args[1] ? Number(args[1]) : 300;
    if (!Number.isFinite(n) || n <= 0) {
      console.error(`Invalid seed count: ${args[1]}`);
      process.exit(1);
    }
    runDemoMode(n, baseSeed);
    return;
  }

  const n = args[0] ? Number(args[0]) : 300;
  const focusEnemyId = args[1];

  if (!Number.isFinite(n) || n <= 0) {
    console.error(`Invalid seed count: ${args[0]}`);
    process.exit(1);
  }

  const heroPl = boardPL(HERO_BOARD.pieces, skillBook);
  console.log(`Hero board total PL: ${fmt1(heroPl)} (${HERO_BOARD.pieces.map((p) => p.skillId).join(', ')})\n`);

  const enemyIds = focusEnemyId ? [focusEnemyId] : Object.keys(enemies);
  for (const id of enemyIds) {
    if (!enemies[id]) {
      console.error(`Unknown enemy '${id}'. Options: ${Object.keys(enemies).join(', ')}`);
      process.exit(1);
    }
  }

  const rows: { id: string; enemyPl: number; hp: number; attack: number; summary: MatchupSummary; stats: MatchupStats }[] = [];
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
    const enemyPl = boardPL(enemy.pieces, skillBook);
    const seeds = seedsFor(baseSeed, id, n);
    const stats = runMatchup(HERO_BOARD, enemySetup, skillBook, seeds);
    rows.push({ id, enemyPl, hp: enemy.stats.maxHp, attack: enemy.stats.attack, summary: summarize(stats), stats });
  }

  const header =
    `${pad('enemy', 16)} ${padNum('enemyPL', 8)} ${padNum('hp', 5)} ${padNum('atk', 5)} ${padNum('winrate', 8)} ` +
    `${padNum('draws', 6)} ${padNum('avgTurns', 9)} ${padNum('minT', 5)} ${padNum('maxT', 5)} ${padNum('avgPHpLeft', 11)} notes`;
  console.log(header);
  console.log('-'.repeat(header.length));
  for (const { id, enemyPl, hp, attack, summary } of rows) {
    console.log(
      `${pad(id, 16)} ${padNum(fmt1(enemyPl), 8)} ${padNum(String(hp), 5)} ${padNum(String(attack), 5)} ` +
        `${padNum(fmt1(summary.winrate) + '%', 8)} ${padNum(String(summary.draws), 6)} ` +
        `${padNum(fmt1(summary.avgTurns), 9)} ${padNum(String(summary.minTurns), 5)} ${padNum(String(summary.maxTurns), 5)} ` +
        `${padNum(fmt1(summary.avgPlayerHpLeftOnWin), 11)} ${notesFor(summary)}`,
    );
  }

  console.log(
    `\n(HP-driven vs PL-driven check: enemyPL is the sum of board card PL only, independent of HP. ` +
      `Compare e.g. wolf_king's board PL above to its 280 HP — see the note printed with 'npm run sim -- demo'.)`,
  );

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
