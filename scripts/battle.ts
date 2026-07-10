// Battle tester — run any board vs any enemy party and get the log or a sweep.
//
//   npm run battle -- --hero "war_banner,sword_slash,crippling_strike" --enemy bandit_duelist --seed 7
//   npm run battle -- --hero "bramble_coat@silver,venom_fang+assassin_mark" --enemy giant_rat,wolf_king
//   npm run battle -- --hero "..." --enemy wolf_king --runs 50        (win-rate sweep, no log)
//   npm run battle -- --hero "..." --mpw 20 --hp 200 --enemy ember_imp  (stat overrides)
//
// Card token: id[@tier][+enchant][:slot] — slots auto-pack left→right when
// omitted. Tiers use generated variants (silver/gold/diamond); enchants are
// storm_mark / assassin_mark / executioner_mark.
import { simulate } from '../src/engine/combat/simulate';
import { hashSeed } from '../src/engine/rng';
import { powerLevel } from '../src/engine/balance';
import { variantId } from '../src/engine/tierUp';
import type { BoardPiece, CombatantStats, SkillTier } from '../src/engine/types';
import { fullBook } from '../src/data/library';
import { enchantBook } from '../src/data/enchants';
import { BASE_HERO_STATS, HERO_BOARD_SLOTS } from '../src/data/heroes';
import { enemies } from '../src/data/enemies';

// ---------- args ----------

const args = process.argv.slice(2);
function flag(name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
}

const DEFAULT_HERO = 'war_banner,sword_slash,crippling_strike,iron_bulwark:5,second_wind:7';
const heroSpec = flag('hero') ?? DEFAULT_HERO;
const enemySpec = flag('enemy') ?? 'bandit_duelist';
const runs = Number(flag('runs') ?? 1);
const seed = Number(flag('seed') ?? hashSeed('battle', heroSpec + enemySpec));

function die(msg: string): never {
  console.error(`error: ${msg}`);
  process.exit(1);
}

// ---------- board parsing: id[@tier][+enchant][:slot] ----------

function parseBoard(spec: string): BoardPiece[] {
  const pieces: BoardPiece[] = [];
  let cursor = 0;
  for (const raw of spec.split(',')) {
    const token = raw.trim();
    if (!token) continue;
    const m = token.match(/^(\w+?)(?:@(bronze|silver|gold|diamond))?(?:\+(\w+))?(?::(\d+))?$/);
    if (!m) die(`bad card token '${token}' (want id[@tier][+enchant][:slot])`);
    const [, base, tier, enchant, slotStr] = m;
    const id = tier ? variantId(base!, tier as SkillTier, fullBook[base!]?.tier ?? 'bronze') : base!;
    const skill = fullBook[id];
    if (!skill) {
      if (!fullBook[base!]) die(`unknown skill '${base}'. Options: ${Object.keys(fullBook).filter((k) => !k.includes('__')).sort().join(', ')}`);
      die(`'${base}' has no ${tier} variant (no on-budget knob)`);
    }
    if (enchant && !enchantBook[enchant]) die(`unknown enchant '${enchant}'. Options: ${Object.keys(enchantBook).join(', ')}`);
    const slot = slotStr !== undefined ? Number(slotStr) : cursor;
    if (slot + skill.size > HERO_BOARD_SLOTS) die(`'${token}' does not fit at slot ${slot} (board has ${HERO_BOARD_SLOTS} slots)`);
    pieces.push({ skillId: id, slot, ...(enchant ? { enchant } : {}) });
    cursor = slot + skill.size;
  }
  if (pieces.length === 0) die('empty hero board');
  return pieces;
}

const heroPieces = parseBoard(heroSpec);

const heroStats: CombatantStats = { ...BASE_HERO_STATS };
for (const [key, stat] of [
  ['hp', 'maxHp'],
  ['atk', 'attack'],
  ['mpw', 'magicPower'],
  ['arm', 'armor'],
  ['res', 'magicResist'],
  ['spd', 'speed'],
  ['crit', 'critPct'],
] as const) {
  const v = flag(key);
  if (v !== undefined) heroStats[stat] = Number(v);
}
heroStats.hp = heroStats.maxHp;

const enemyDefs = enemySpec.split(',').map((id) => {
  const def = enemies[id.trim()];
  if (!def) die(`unknown enemy '${id}'. Options: ${Object.keys(enemies).join(', ')}`);
  return def;
});

const cfg = (s: number) => ({
  player: { name: 'Hero', stats: { ...heroStats, hp: heroStats.maxHp }, boardSize: HERO_BOARD_SLOTS, pieces: heroPieces.map((p) => ({ ...p })) },
  enemy: enemyDefs.map((def) => ({
    name: def.name,
    stats: { ...def.stats },
    boardSize: def.boardSize,
    pieces: def.pieces.map((p) => ({ ...p })),
    elementAffinity: def.elementAffinity,
    weaponAffinity: def.weaponAffinity,
  })),
  skillBook: fullBook,
  enchantBook,
});

// ---------- header ----------

const boardPl = heroPieces.reduce((n, p) => n + powerLevel(fullBook[p.skillId]!), 0);
console.log(`HERO  ${heroPieces.map((p) => `[${p.slot}]${p.skillId}${p.enchant ? `+${p.enchant}` : ''}`).join(' ')}`);
console.log(
  `      board PL ${boardPl.toFixed(1)} · HP ${heroStats.maxHp} ATK ${heroStats.attack} MPW ${heroStats.magicPower} ARM ${heroStats.armor} RES ${heroStats.magicResist} SPD ${heroStats.speed} CRIT ${heroStats.critPct}%`,
);
console.log(`ENEMY ${enemyDefs.map((d, i) => `[${i}]${d.name}`).join(' ')}\n`);

// ---------- sweep mode ----------

if (runs > 1) {
  let w = 0, l = 0, d = 0, turns = 0, heroHpLeft = 0;
  const dealtBySource: Record<string, number> = {};
  for (let s = 1; s <= runs; s++) {
    const r = simulate(cfg(s), s);
    if (r.result === 'win') { w++; heroHpLeft += r.finalState.player[0]!.stats.hp; }
    else if (r.result === 'loss') l++;
    else d++;
    turns += r.turns;
    for (const e of r.events) {
      if (e.kind === 'damage' && e.side === 'enemy') {
        dealtBySource[e.source] = (dealtBySource[e.source] ?? 0) + (e.amount - e.blocked);
      }
    }
  }
  console.log(`${runs} runs (seeds 1..${runs}):  W${w} L${l} D${d}  (${((100 * w) / runs).toFixed(0)}% win)  avg turns ${(turns / runs).toFixed(1)}`);
  if (w > 0) console.log(`avg hero HP on win: ${(heroHpLeft / w).toFixed(0)}/${heroStats.maxHp}`);
  const total = Object.values(dealtBySource).reduce((a, b) => a + b, 0) || 1;
  console.log(
    `damage to enemy by source: ${Object.entries(dealtBySource)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `${k} ${((100 * v) / total).toFixed(0)}%`)
      .join(' · ')}`,
  );
  process.exit(0);
}

// ---------- single-seed log mode ----------

const { result, turns, events, finalState } = simulate(cfg(seed), seed);

const tag = (side: string, unit = 0) => (side === 'player' ? 'Hero' : `${enemyDefs[unit]!.name}[${unit}]`).padEnd(18);
const fmt = (s: { bank: number; speed: number; weight: number | null; score: number | null; state: string; queuedSkillId: string | null }) =>
  s.state === 'ready' ? `${s.bank}+${s.speed}-${s.weight}=${s.score} (${s.queuedSkillId})` : s.state;

for (const e of events) {
  const t = String(e.turn).padStart(3);
  const u = 'unit' in e ? e.unit : 0;
  switch (e.kind) {
    case 'comparison':
      console.log(`${t} ┌ you ${fmt(e.player)} | foe ${fmt(e.enemy)} → ${e.performer ?? 'nobody'}${e.performer === 'enemy' ? `[${e.performerUnit}]` : ''}`);
      break;
    case 'skillCast':
      console.log(`${t} │  ${tag(e.side, u)} casts [${e.slot}] ${e.skillId}${e.enchant ? ` {${e.enchant}}` : ''}${e.span > 1 ? ` (spans ${e.span})` : ''}`);
      break;
    case 'performSkipped':
      console.log(`${t} │  ${tag(e.side, u)} performance consumed (${e.reason})`);
      break;
    case 'damage':
      console.log(
        `${t} │  ${tag(e.side, u)} takes ${e.amount} ${e.property}${e.crit ? ' CRIT' : ''}${e.blocked ? ` (${e.blocked} blocked)` : ''} -> ${e.hpAfter} hp${e.source !== 'skill' ? ` [${e.source}]` : ''}`,
      );
      break;
    case 'heal':
      console.log(`${t} │  ${tag(e.side, u)} heals ${e.amount}${e.flat ? ' (flat)' : ''} -> ${e.hpAfter} hp`);
      break;
    case 'shieldGain':
      console.log(`${t} │  ${tag(e.side, u)} +${e.amount} ${e.property} shield${e.wasted ? ` (${e.wasted} wasted)` : ''} -> ${e.totalAfter} total`);
      break;
    case 'statusApplied':
      console.log(`${t} │  ${tag(e.side, u)} gains ${e.status}${e.property ? `(${e.property})` : ''} for ${e.turns}t`);
      break;
    case 'statusExpired':
      console.log(`${t} │  ${tag(e.side, u)} ${e.status} expired`);
      break;
    case 'slowedNext':
      console.log(`${t} │  ${tag(e.side, u)} next action +${e.weight} weight (slowed)`);
      break;
    case 'quickenedNext':
      console.log(`${t} │  ${tag(e.side, u)} next action −${e.weight} weight (quickened)`);
      break;
    case 'purged':
      console.log(`${t} │  ${tag(e.side, u)} purged of ${e.removed} positive status${e.removed > 1 ? 'es' : ''}`);
      break;
    case 'cleansed':
      console.log(`${t} │  ${tag(e.side, u)} cleansed ${e.removed}`);
      break;
    case 'staggered':
      console.log(`${t} │  ${tag(e.side, u)} staggered −${e.amount} bank -> ${e.bankAfter}`);
      break;
    case 'shieldBroken':
      console.log(`${t} │  ${tag(e.side, u)} shield shattered −${e.amount} -> ${e.totalAfter}`);
      break;
    case 'suddenDeathStart':
      console.log(`${t} ⚡ SUDDEN DEATH — damage ramps each turn (+10% you, +30% foe)`);
      break;
    case 'fatigueStart':
      console.log(`${t} ⚡ FATIGUE backstop sets in`);
      break;
    case 'died':
      console.log(`${t} ☠  ${tag(e.side, u)} dies`);
      break;
    case 'combatEnd':
      console.log(`${t} ═══ ${e.result.toUpperCase()} after ${e.turns} turns ═══`);
      break;
    default:
      break;
  }
}

const foeLine = finalState.enemy.map((c, i) => `${enemyDefs[i]!.name}[${i}] ${c.stats.hp}/${c.stats.maxHp}`).join(' | ');
console.log(`\nfinal: Hero ${finalState.player[0]!.stats.hp}/${finalState.player[0]!.stats.maxHp} hp | ${foeLine} | result=${result} turns=${turns} seed=${seed}`);
