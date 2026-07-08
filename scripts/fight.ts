// ASCII combat log for eyeballing engine behavior:
//   npm run fight            (hero vs bandit_duelist)
//   npm run fight -- ember_imp 42
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
const { result, turns, events, finalState } = simulate(
  {
    player: {
      name: heroName,
      stats: { ...BASE_HERO_STATS },
      boardSize: HERO_BOARD_SLOTS,
      pieces: [
        { skillId: 'war_banner', slot: 0 },
        { skillId: 'sword_slash', slot: 1 },
        { skillId: 'crushing_blow', slot: 2 },
        { skillId: 'iron_bulwark', slot: 5 },
        { skillId: 'second_wind', slot: 7 },
      ],
    },
    enemy: {
      name: enemy.name,
      stats: { ...enemy.stats },
      boardSize: enemy.boardSize,
      pieces: [...enemy.pieces],
      elementAffinity: enemy.elementAffinity,
      weaponAffinity: enemy.weaponAffinity,
    },
    skillBook,
  },
  seed,
);

const tag = (side: string) => (side === 'player' ? heroName : enemy.name).padEnd(16);
const fmt = (side: { bank: number; speed: number; weight: number | null; score: number | null; state: string; queuedSkillId: string | null }) =>
  side.state === 'ready'
    ? `${side.bank}+${side.speed}-${side.weight}=${side.score} (${side.queuedSkillId})`
    : side.state;

for (const e of events) {
  const t = String(e.turn).padStart(3);
  switch (e.kind) {
    case 'comparison':
      console.log(`${t} ┌ you ${fmt(e.player)} | foe ${fmt(e.enemy)} → ${e.performer ?? 'nobody'}`);
      break;
    case 'skillCast':
      console.log(`${t} │  ${tag(e.side)} casts [${e.slot}] ${e.skillId}${e.span > 1 ? ` (spans ${e.span})` : ''}`);
      break;
    case 'performSkipped':
      console.log(`${t} │  ${tag(e.side)} performance consumed (${e.reason})`);
      break;
    case 'damage':
      console.log(
        `${t} │  ${tag(e.side)} takes ${e.amount} ${e.property}${e.crit ? ' CRIT' : ''}${e.blocked ? ` (${e.blocked} blocked)` : ''} -> ${e.hpAfter} hp${e.source !== 'skill' ? ` [${e.source}]` : ''}`,
      );
      break;
    case 'heal':
      console.log(`${t} │  ${tag(e.side)} heals ${e.amount}${e.flat ? ' (flat)' : ''} -> ${e.hpAfter} hp`);
      break;
    case 'shieldGain':
      console.log(`${t} │  ${tag(e.side)} +${e.amount} ${e.property} shield${e.wasted ? ` (${e.wasted} wasted)` : ''} -> ${e.totalAfter} total`);
      break;
    case 'statusApplied':
      console.log(`${t} │  ${tag(e.side)} gains ${e.status}${e.property ? `(${e.property})` : ''} for ${e.turns}t`);
      break;
    case 'statusExpired':
      console.log(`${t} │  ${tag(e.side)} ${e.status} expired`);
      break;
    case 'slowedNext':
      console.log(`${t} │  ${tag(e.side)} next action +${e.weight} weight (slowed)`);
      break;
    case 'staggered':
      console.log(`${t} │  ${tag(e.side)} staggered −${e.amount} bank -> ${e.bankAfter}`);
      break;
    case 'shieldBroken':
      console.log(`${t} │  ${tag(e.side)} shield shattered −${e.amount} -> ${e.totalAfter}`);
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
      console.log(`${t} ═══ ${e.result.toUpperCase()} after ${e.turns} turns ═══`);
      break;
    default:
      break;
  }
}

console.log(
  `\nfinal: ${heroName} ${finalState.player.stats.hp}/${finalState.player.stats.maxHp} hp | ` +
    `${enemy.name} ${finalState.enemy.stats.hp}/${finalState.enemy.stats.maxHp} hp | ` +
    `result=${result} turns=${turns} seed=${seed}`,
);
