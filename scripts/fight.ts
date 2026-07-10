// ASCII combat log for eyeballing engine behavior:
//   npm run fight                              (hero vs bandit_duelist)
//   npm run fight -- ember_imp 42
//   npm run fight -- giant_rat,ember_imp,wolf_king   (hero vs a party)
import { simulate } from '../src/engine/combat/simulate';
import { hashSeed } from '../src/engine/rng';
import { skillBook } from '../src/data/skills';
import { BASE_HERO_STATS, HERO_BOARD_SLOTS } from '../src/data/heroes';
import { enemies } from '../src/data/enemies';

const enemyArg = process.argv[2] ?? 'bandit_duelist';
const seed = Number(process.argv[3] ?? hashSeed('fight', enemyArg));

const enemyIds = enemyArg.split(',');
const enemyDefs = enemyIds.map((id) => {
  const def = enemies[id];
  if (!def) {
    console.error(`Unknown enemy '${id}'. Options: ${Object.keys(enemies).join(', ')}`);
    process.exit(1);
  }
  return def;
});

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
    enemy: enemyDefs.map((def) => ({
      name: def.name,
      stats: { ...def.stats },
      boardSize: def.boardSize,
      pieces: [...def.pieces],
      elementAffinity: def.elementAffinity,
      weaponAffinity: def.weaponAffinity,
    })),
    skillBook,
  },
  seed,
);

const tag = (side: string, unit = 0) => (side === 'player' ? heroName : `${enemyDefs[unit]!.name}[${unit}]`).padEnd(18);
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
      console.log(
        `${t} │  ${tag(e.side, 'unit' in e ? e.unit : 0)} casts [${e.slot}] ${e.skillId}${e.enchant ? ` {${e.enchant}}` : ''}${e.span > 1 ? ` (spans ${e.span})` : ''}`,
      );
      break;
    case 'performSkipped':
      console.log(`${t} │  ${tag(e.side, 'unit' in e ? e.unit : 0)} performance consumed (${e.reason})`);
      break;
    case 'damage':
      console.log(
        `${t} │  ${tag(e.side, 'unit' in e ? e.unit : 0)} takes ${e.amount} ${e.property}${e.crit ? ' CRIT' : ''}${e.blocked ? ` (${e.blocked} blocked)` : ''} -> ${e.hpAfter} hp${e.source !== 'skill' ? ` [${e.source}]` : ''}`,
      );
      break;
    case 'heal':
      console.log(`${t} │  ${tag(e.side, 'unit' in e ? e.unit : 0)} heals ${e.amount}${e.flat ? ' (flat)' : ''} -> ${e.hpAfter} hp`);
      break;
    case 'shieldGain':
      console.log(`${t} │  ${tag(e.side, 'unit' in e ? e.unit : 0)} +${e.amount} ${e.property} shield${e.wasted ? ` (${e.wasted} wasted)` : ''} -> ${e.totalAfter} total`);
      break;
    case 'statusApplied':
      console.log(`${t} │  ${tag(e.side, 'unit' in e ? e.unit : 0)} gains ${e.status}${e.property ? `(${e.property})` : ''} for ${e.turns}t`);
      break;
    case 'statusExpired':
      console.log(`${t} │  ${tag(e.side, 'unit' in e ? e.unit : 0)} ${e.status} expired`);
      break;
    case 'slowedNext':
      console.log(`${t} │  ${tag(e.side, 'unit' in e ? e.unit : 0)} next action +${e.weight} weight (slowed)`);
      break;
    case 'quickenedNext':
      console.log(`${t} │  ${tag(e.side, 'unit' in e ? e.unit : 0)} next action −${e.weight} weight (quickened)`);
      break;
    case 'purged':
      console.log(`${t} │  ${tag(e.side, 'unit' in e ? e.unit : 0)} purged of ${e.removed} positive status${e.removed > 1 ? 'es' : ''}`);
      break;
    case 'staggered':
      console.log(`${t} │  ${tag(e.side, 'unit' in e ? e.unit : 0)} staggered −${e.amount} bank -> ${e.bankAfter}`);
      break;
    case 'shieldBroken':
      console.log(`${t} │  ${tag(e.side, 'unit' in e ? e.unit : 0)} shield shattered −${e.amount} -> ${e.totalAfter}`);
      break;
    case 'suddenDeathStart':
      console.log(`${t} ⚡ SUDDEN DEATH — damage ramps each turn (+10% you, +30% foe)`);
      break;
    case 'fatigueStart':
      console.log(`${t} ⚡ FATIGUE backstop sets in`);
      break;
    case 'died':
      console.log(`${t} ☠  ${tag(e.side, 'unit' in e ? e.unit : 0)} dies`);
      break;
    case 'combatEnd':
      console.log(`${t} ═══ ${e.result.toUpperCase()} after ${e.turns} turns ═══`);
      break;
    default:
      break;
  }
}

const foeLine = finalState.enemy.map((u, i) => `${enemyDefs[i]!.name}[${i}] ${u.stats.hp}/${u.stats.maxHp}`).join(' | ');
console.log(
  `\nfinal: ${heroName} ${finalState.player[0]!.stats.hp}/${finalState.player[0]!.stats.maxHp} hp | ` +
    `${foeLine} | result=${result} turns=${turns} seed=${seed}`,
);
