// ASCII combat log for eyeballing engine behavior:
//   npm run fight            (hero vs bandit_duelist)
//   npm run fight -- ember_imp 42
import { simulate1v1 } from '../src/engine/combat/simulate';
import type { DamageCalculation } from '../src/engine/combat/events';
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
const { result, turns, events, finalState } = simulate1v1(
  {
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
  {
    name: enemy.name,
    stats: { ...enemy.stats },
    boardSize: enemy.boardSize,
    pieces: [...enemy.pieces],
    elementAffinity: enemy.elementAffinity,
    weaponAffinity: enemy.weaponAffinity,
  },
  { skillBook },
  seed,
);

const tag = (side: string) => (side === 'player' ? heroName : enemy.name).padEnd(16);
const fmt = (side: { bank: number; speed: number; weight: number | null; score: number | null; state: string; queuedSkillId: string | null }) =>
  side.state === 'ready'
    ? `${side.bank}+${side.speed}-${side.weight}=${side.score} (${side.queuedSkillId})`
    : side.state;

const fmtDamage = (c: DamageCalculation): string => {
  const terms = [`${c.baseDamage}`];
  const add = (label: string, value: number): void => {
    if (value !== 0) terms.push(`${value > 0 ? '+' : '-'}${label}${Math.abs(value)}`);
  };
  add('STAT', c.statBonusDamage);
  add('BONUS', c.effectBonusDamage);
  add('DEF', -c.defense);
  add('MIN', c.minimumDamageBonus);
  add('CRIT', c.critBonusDamage);
  add('MATCH', c.matchupBonusDamage);
  add('RAMP', c.suddenDeathBonusDamage);
  add('GUARD', -c.guardReduction);
  add('BLOCK', -c.shieldBlocked);
  const identity = c.identityBonusDamage ?? 0;
  const bonusLabel = identity > 0
    ? `+${c.effectBonusDamage - identity} aura/combo, +${identity} board identity`
    : `+${c.effectBonusDamage} aura/combo`;
  return `${terms.join(' ')} = ${c.hpDamage} HP (${c.scalingStat} ${c.baseStat}->${c.effectiveStat}, ${bonusLabel})`;
};

for (const e of events) {
  const t = String(e.turn).padStart(3);
  switch (e.kind) {
    case 'gain':
      console.log(
        `${t}  gain    ${tag(e.side)} readiness ${e.readinessBefore} -> ${e.readinessAfter} (+${e.speed}${e.speedModifier === 0 ? '' : `; effect ${e.speedModifier > 0 ? '+' : ''}${e.speedModifier}`})`,
      );
      break;
    case 'play':
      console.log(
        `${t}  play    ${tag(e.side)} ${e.skillId} (slot ${e.slot + 1}${e.slotCount > 1 ? `, 1 of ${e.slotCount}` : ''}) · weight ${e.weight}${e.damage === undefined ? '' : ` -> -${e.damage} [${e.hpAfter} hp]`}`,
      );
      break;
    case 'cost':
      console.log(`${t}  cost    ${tag(e.side)} readiness ${e.readinessBefore} -> ${e.readinessAfter} (paid ${e.paid})`);
      break;
    case 'cursor':
      console.log(
        `${t}  cursor  ${tag(e.side)} -> ${e.skillId ?? 'empty'} (slot ${e.slot + 1}${e.slotCount && e.slotCount > 1 ? `, ${e.slotIndex} of ${e.slotCount}` : ''}${e.wrapped ? ', wrap' : ''})`,
      );
      break;
    case 'busy':
      console.log(`${t}  busy    ${tag(e.side)} ${e.skillId} resolving (slot ${e.slotIndex} of ${e.slotCount})`);
      break;
    case 'wait':
      if (e.reason === 'cantAfford') {
        console.log(`${t}  wait    ${tag(e.side)} readiness ${e.readiness} < ${e.skillId} weight ${e.weight}`);
      } else if (e.reason === 'cooling') {
        console.log(`${t}  wait    ${tag(e.side)} ${e.skillId} cooling · ${e.turnsLeft} turn${e.turnsLeft === 1 ? '' : 's'} left`);
      } else {
        console.log(`${t}  wait    ${tag(e.side)} ${e.reason === 'stunned' ? 'stunned' : 'no cards'}`);
      }
      break;
    case 'end':
      console.log(`${t}  end     turn over`);
      break;
    case 'comparison':
      console.log(`${t} ┌ you ${fmt(e.player)} | foe ${fmt(e.enemy)} → ${e.performer ?? 'nobody'}`);
      break;
    case 'skillCast':
      // Compatibility event; the tagged `play` line above is the readable cast record.
      break;
    case 'performSkipped':
      console.log(`${t} │  ${tag(e.side)} performance consumed (${e.reason})`);
      break;
    case 'damage':
      console.log(
        `${t} │  ${tag(e.side)} takes ${e.amount} ${e.property}${e.crit ? ' CRIT' : ''}${e.blocked ? ` (${e.blocked} blocked)` : ''} -> ${e.hpAfter} hp${e.source !== 'skill' ? ` [${e.source}]` : ''}`,
      );
      if (e.calculation) console.log(`${t} │  calc             ${fmtDamage(e.calculation)}`);
      break;
    case 'heal':
      console.log(`${t} │  ${tag(e.side)} heals ${e.amount}${e.flat ? ' (flat)' : ''} -> ${e.hpAfter} hp`);
      break;
    case 'shieldGain':
      console.log(`${t} │  ${tag(e.side)} +${e.amount} ${e.property} shield${e.wasted ? ` (${e.wasted} wasted)` : ''} -> ${e.totalAfter} total`);
      break;
    case 'statusApplied': {
      let detail = '';
      if (e.stat) {
        detail = ` ${e.stat} ${e.status === 'debuff' ? '-' : '+'}${e.pct ?? e.amount ?? 0}${e.pct !== undefined ? '%' : ''}`;
      } else if (e.status === 'expose') {
        detail = ` +${e.pct ?? 0}%`;
      } else if (e.status === 'poison' || e.status === 'burn' || e.status === 'bleed') {
        // Decaying DoTs: the pile size IS the state — duration is implied
        // (poison/bleed: stacks ticks; burn: halves each tick).
        console.log(`${t} │  ${tag(e.side)} gains ${e.status} ${e.stacks ?? 0} stacks${e.property ? ` (${e.property})` : ''}`);
        break;
      } else if (e.property) {
        detail = `(${e.property})`;
      }
      console.log(`${t} │  ${tag(e.side)} gains ${e.status}${detail} for ${e.turns}t`);
      break;
    }
    case 'statusExpired':
      console.log(`${t} │  ${tag(e.side)} ${e.status} expired`);
      break;
    case 'slowed':
      console.log(`${t} │  ${tag(e.side)} next action +${e.weight} weight (slowed)`);
      break;
    case 'disrupted':
      console.log(`${t} │  ${tag(e.side)} disrupted −${e.amount} bank -> ${e.bankAfter}`);
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
