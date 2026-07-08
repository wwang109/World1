// ASCII combat log for eyeballing engine behavior:
//   npm run fight            (hero vs bandit_duelist)
//   npm run fight -- goblin_thug 42
import { simulate } from '../src/engine/combat/simulate';
import { hashSeed } from '../src/engine/rng';
import { skillBook } from '../src/data/skills';
import { BASE_HERO_STATS, HERO_BOARD_SLOTS } from '../src/data/heroes';
import { enemies } from '../src/data/enemies';

const enemyId = process.argv[2] ?? 'bandit_duelist';
const seed = Number(process.argv[3] ?? hashSeed('fight', enemyId));

const enemy = enemies[enemyId];
if (!enemy) {
  console.error(`Unknown enemy '${enemyId}'. Options: ${Object.keys(enemies).join(', ')}`);
  process.exit(1);
}

// A plausible drafted starter board.
const heroName = 'Hero';
const { result, endedAt, turns, events, finalState } = simulate(
  {
    player: {
      name: heroName,
      stats: { ...BASE_HERO_STATS },
      boardSize: HERO_BOARD_SLOTS,
      pieces: [
        { skillId: 'strike', slot: 0 },
        { skillId: 'whetstone', slot: 1 },
        { skillId: 'heavy_blow', slot: 2 },
        { skillId: 'guard', slot: 4 },
        { skillId: 'mend', slot: 5 },
      ],
    },
    enemy: {
      name: enemy.name,
      stats: { ...enemy.stats },
      boardSize: enemy.boardSize,
      pieces: [...enemy.pieces],
    },
    skillBook,
  },
  seed,
);

const tag = (side: string) => (side === 'player' ? heroName : enemy.name).padEnd(16);

for (const e of events) {
  const t = String(e.time).padStart(6);
  switch (e.kind) {
    case 'turnStart':
      console.log(`${t} ── ${tag(e.side)} turn ${e.turn}`);
      break;
    case 'skillCast':
      console.log(`${t}    ${tag(e.side)} casts [${e.slot}] ${e.skillId}`);
      break;
    case 'turnSkipped':
      console.log(`${t}    ${tag(e.side)} skips (${e.reason})`);
      break;
    case 'damage':
      console.log(
        `${t}    ${tag(e.side)} takes ${e.amount}${e.crit ? ' CRIT' : ''}${e.blocked ? ` (${e.blocked} blocked)` : ''} -> ${e.hpAfter} hp${e.source === 'fatigue' ? ' [fatigue]' : ''}`,
      );
      break;
    case 'heal':
      console.log(`${t}    ${tag(e.side)} heals ${e.amount} -> ${e.hpAfter} hp`);
      break;
    case 'shieldGain':
      console.log(`${t}    ${tag(e.side)} shields +${e.amount} -> ${e.shieldAfter}`);
      break;
    case 'statusApplied':
      console.log(`${t}    ${tag(e.side)} gains ${e.status} (${e.turns}t)`);
      break;
    case 'statusTick':
      console.log(`${t}    ${tag(e.side)} suffers ${e.status} ${e.amount} -> ${e.hpAfter} hp`);
      break;
    case 'suddenDeathStart':
      console.log(`${t} ⚡ SUDDEN DEATH — damage ramps each turn (+10% you, +30% foe)`);
      break;
    case 'fatigueStart':
      console.log(`${t} ⚡ FATIGUE backstop sets in`);
      break;
    case 'died':
      console.log(`${t} ☠  ${tag(e.side)} dies`);
      break;
    case 'combatEnd':
      console.log(`${t} ═══ ${e.result.toUpperCase()} after ${turns} turns ═══`);
      break;
    default:
      break;
  }
}

console.log(
  `\nfinal: ${heroName} ${finalState.player.stats.hp}/${finalState.player.stats.maxHp} hp | ` +
    `${enemy.name} ${finalState.enemy.stats.hp}/${finalState.enemy.stats.maxHp} hp | ` +
    `result=${result} endedAt=${endedAt} seed=${seed}`,
);
