// ASCII combat log for eyeballing engine behavior:
//   npm run fight                        (hero vs bandit_duelist)
//   npm run fight -- ember_imp 42        (hero vs one Ember Imp, seed 42)
//   npm run fight -- giant_rat*3 42      (hero vs a pack of three Giant Rats)
//   npm run fight -- giant_rat*2,knight 42
//
// TEAM-AWARE (2026-08-19): every line names the exact combatant it is about
// ("Giant Rat #2"), not just its side, and a cast line names the foe its
// targeting policy CHOSE plus the metric that decided it. All of that is
// already on the event log (`play`/`skillCast` carry `targetUnit` /
// `targetPolicy` / `targetValue` / `aoe` / `targets`; every `damage` carries
// the victim's `side` + `unit`) — this script previously discarded the unit
// index, so in a pack fight the reader could not tell which foe was hit.
import { simulate } from '../src/engine/combat/simulate';
import type { DamageCalculation } from '../src/engine/combat/events';
import type { CombatantSetup, Side } from '../src/engine/types';
import { hashSeed } from '../src/engine/rng';
import { skillBook } from '../src/data/skills';
import { BASE_HERO_STATS, HERO_BOARD_SLOTS } from '../src/data/heroes';
import { enemies } from '../src/data/enemies';

/**
 * Local copy of the foe cap (the shared constant lives in `src/game`, which the
 * pure layers and scripts must not import — see the layer boundary rule).
 */
const MAX_FOES = 5;

const enemySpec = process.argv[2] ?? 'bandit_duelist';

/**
 * A seed you cannot trust is worse than no seed: `Number('abc')` is NaN, and
 * `Rng`'s `seed >>> 0` turns NaN into 0 — so a typo silently reproduces a
 * DIFFERENT fight than the one asked for. Refuse instead.
 */
function parseSeed(arg: string | undefined, fallback: number): number {
  if (arg === undefined) return fallback;
  // Deliberately NOT Number(): '' and '  ' both coerce to 0, which is the same
  // silent-zero trap by another route. Plain unsigned decimal digits only.
  const value = /^[0-9]+$/.test(arg) ? Number(arg) : Number.NaN;
  if (!Number.isInteger(value) || value > 0xffffffff) {
    console.error(`Invalid seed '${arg}' — expected an integer in [0, 4294967295].`);
    process.exit(1);
  }
  return value;
}

/**
 * Enemy lineup spec: comma-separated enemy ids, each optionally `*N` repeated.
 * A bare single id is the historical 1v1 form and behaves exactly as before.
 */
function parseLineup(spec: string): string[] {
  const ids: string[] = [];
  for (const raw of spec.split(',')) {
    const part = raw.trim();
    if (part === '') continue;
    const star = part.indexOf('*');
    const id = star === -1 ? part : part.slice(0, star);
    const countArg = star === -1 ? '1' : part.slice(star + 1);
    if (!/^[0-9]+$/.test(countArg) || Number(countArg) < 1) {
      console.error(`Invalid repeat count in '${part}' — expected '<enemyId>*<positive integer>'.`);
      process.exit(1);
    }
    for (let i = 0; i < Number(countArg); i += 1) ids.push(id);
  }
  if (ids.length === 0) {
    console.error(`Empty enemy lineup '${spec}'.`);
    process.exit(1);
  }
  if (ids.length > MAX_FOES) {
    console.error(`Lineup of ${ids.length} exceeds MAX_FOES (${MAX_FOES}).`);
    process.exit(1);
  }
  return ids;
}

const seed = parseSeed(process.argv[3], hashSeed('fight', enemySpec));
const enemyIds = parseLineup(enemySpec);

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
const playerTeam: CombatantSetup[] = [
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
];
const enemyTeam: CombatantSetup[] = enemyDefs.map((enemy) => ({
  name: enemy.name,
  stats: { ...enemy.stats },
  boardSize: enemy.boardSize,
  pieces: [...enemy.pieces],
  elementAffinity: enemy.elementAffinity,
  weaponAffinity: enemy.weaponAffinity,
}));

const { result, turns, events, finalState } = simulate({ playerTeam, enemyTeam, skillBook }, seed);

// ---------------------------------------------------------------------------
// Naming. `#n` is the 1-BASED lineup position, i.e. engine unit index n−1 — the
// same 1-based convention this script already uses for board slots. A side with
// exactly one unit needs no disambiguator and prints its bare name (so a 1v1
// log reads exactly as it always has).
// ---------------------------------------------------------------------------
const nameTable: Record<Side, string[]> = {
  player: playerTeam.map((u, i) => (playerTeam.length > 1 ? `${u.name} #${i + 1}` : u.name)),
  enemy: enemyTeam.map((u, i) => (enemyTeam.length > 1 ? `${u.name} #${i + 1}` : u.name)),
};
const label = (side: Side, unit: number): string => nameTable[side][unit] ?? `${side} #${unit + 1}`;
const nameWidth = Math.max(16, ...nameTable.player.map((n) => n.length), ...nameTable.enemy.map((n) => n.length));
const tag = (side: Side, unit: number): string => label(side, unit).padEnd(nameWidth);
const other = (side: Side): Side => (side === 'player' ? 'enemy' : 'player');

const fmt = (side: { bank: number; speed: number; weight: number | null; score: number | null; state: string; queuedSkillId: string | null }) =>
  side.state === 'ready'
    ? `${side.bank}+${side.speed}-${side.weight}=${side.score} (${side.queuedSkillId})`
    : side.state;

/**
 * WHO this cast chose, and WHY — read straight off the event's recorded
 * targeting decision. Targets are always on the side opposite the caster.
 * Prints nothing for support/self casts, which record no target fields.
 */
const targetSuffix = (e: {
  side: Side;
  targetUnit?: number;
  targetPolicy?: string;
  targetValue?: number;
  aoe?: boolean;
  targets?: number[];
}): string => {
  const foeSide = other(e.side);
  if (e.aoe) return ` · targets ALL [${(e.targets ?? []).map((u) => label(foeSide, u)).join(', ')}]`;
  if (e.targetUnit === undefined) return '';
  const why =
    e.targetPolicy === undefined ? '' : ` (${e.targetPolicy}${e.targetValue === undefined ? '' : ` ${e.targetValue}`})`;
  return ` · target ${label(foeSide, e.targetUnit)}${why}`;
};

const fmtDamage = (c: DamageCalculation): string => {
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
  add('BLOCK', -c.shieldBlocked);
  const bonusLabel = `+${c.effectBonusDamage} aura/combo`;
  return `${terms.join(' ')} = ${c.hpDamage} HP (${c.scalingStat} ${c.baseStat}->${c.effectiveStat}, ${bonusLabel})`;
};

// Lineup legend, so `#n` is never a guess.
console.log(`seed ${seed} · ${enemySpec}`);
for (const side of ['player', 'enemy'] as const) {
  const team = side === 'player' ? playerTeam : enemyTeam;
  for (let i = 0; i < team.length; i += 1) {
    const u = team[i]!;
    console.log(`  ${side === 'player' ? 'you' : 'foe'} unit ${i}  ${tag(side, i)} ${u.stats.maxHp} hp`);
  }
}
console.log('');

for (const e of events) {
  const t = String(e.turn).padStart(3);
  switch (e.kind) {
    case 'gain':
      console.log(
        `${t}  gain    ${tag(e.side, e.unit)} readiness ${e.readinessBefore} -> ${e.readinessAfter} (+${e.speed}${e.speedModifier === 0 ? '' : `; effect ${e.speedModifier > 0 ? '+' : ''}${e.speedModifier}`})`,
      );
      break;
    case 'play':
      // The readable cast record: caster, card, cost, and the foe the cast's
      // targeting policy picked (plus the metric that decided it).
      console.log(
        `${t}  play    ${tag(e.side, e.unit)} ${e.skillId} (slot ${e.slot + 1}${e.slotCount > 1 ? `, 1 of ${e.slotCount}` : ''}) · weight ${e.weight}${targetSuffix(e)}${e.damage === undefined ? '' : ` -> -${e.damage} [${e.hpAfter} hp]`}`,
      );
      break;
    case 'cost':
      console.log(`${t}  cost    ${tag(e.side, e.unit)} readiness ${e.readinessBefore} -> ${e.readinessAfter} (paid ${e.paid})`);
      break;
    case 'cursor':
      console.log(
        `${t}  cursor  ${tag(e.side, e.unit)} -> ${e.skillId ?? 'empty'} (slot ${e.slot + 1}${e.slotCount && e.slotCount > 1 ? `, ${e.slotIndex} of ${e.slotCount}` : ''}${e.wrapped ? ', wrap' : ''})`,
      );
      break;
    case 'busy':
      console.log(`${t}  busy    ${tag(e.side, e.unit)} ${e.skillId} resolving (slot ${e.slotIndex} of ${e.slotCount})`);
      break;
    case 'wait':
      if (e.reason === 'cantAfford') {
        console.log(`${t}  wait    ${tag(e.side, e.unit)} readiness ${e.readiness} < ${e.skillId} weight ${e.weight}`);
      } else if (e.reason === 'cooling') {
        console.log(`${t}  wait    ${tag(e.side, e.unit)} ${e.skillId} cooling · ${e.turnsLeft} turn${e.turnsLeft === 1 ? '' : 's'} left`);
      } else {
        console.log(`${t}  wait    ${tag(e.side, e.unit)} ${e.reason === 'stunned' ? 'stunned' : 'no cards'}`);
      }
      break;
    case 'end':
      console.log(`${t}  end     turn over`);
      break;
    case 'comparison':
      // `entries` is the team-aware source of truth (the legacy `player`/
      // `enemy` fields only describe each side's index-0 unit, which in a pack
      // silently hides four of five foes).
      console.log(
        `${t} ┌ ${e.entries.map((x) => `${label(x.side, x.unit)} ${fmt(x)}`).join(' | ')} → ` +
          `${e.performer === null ? 'nobody' : label(e.performer, e.performerUnit ?? 0)}`,
      );
      break;
    case 'skillCast':
      // Compatibility event; the tagged `play` line above is the readable cast
      // record and carries the identical targeting decision.
      break;
    case 'performSkipped':
      console.log(`${t} │  ${tag(e.side, e.unit)} performance consumed (${e.reason})`);
      break;
    case 'damage':
      console.log(
        `${t} │  ${tag(e.side, e.unit)} takes ${e.amount} ${e.property}${e.blocked ? ` (${e.blocked} blocked)` : ''} -> ${e.hpAfter} hp${e.source !== 'skill' ? ` [${e.source}]` : ''}`,
      );
      if (e.calculation) console.log(`${t} │  calc             ${fmtDamage(e.calculation)}`);
      break;
    case 'heal': {
      console.log(
        `${t} │  ${tag(e.side, e.unit)} heals ${e.amount}${e.flat ? ' (flat)' : ''}${
          e.antiHeal ? ` [anti-heal -${e.antiHeal.pct}%: -${e.antiHeal.reduced} from ${e.antiHeal.categories.join('+')}]` : ''
        } -> ${e.hpAfter} hp`,
      );
      // Same `calc` line the damage case prints. A LIFESTEAL heal carries no
      // calculation (percentage of damage dealt — no base to split), so this
      // line simply doesn't appear for one.
      const hc = e.calculation;
      if (hc) {
        const terms = [`${hc.power}`];
        const add = (label: string, value: number): void => {
          if (value !== 0) terms.push(`${value > 0 ? '+' : '-'}${label}${Math.abs(value)}`);
        };
        add(hc.property === 'physical' ? 'ARMOR' : 'MRES', hc.statBonus);
        add('AURA', hc.healFlat);
        add('ANTIHEAL', -(e.antiHeal?.reduced ?? 0));
        add('OVERHEAL', -e.overheal);
        console.log(`${t} │  calc             ${terms.join(' ')} = ${e.amount} HP`);
      }
      break;
    }
    case 'shieldGain':
      console.log(`${t} │  ${tag(e.side, e.unit)} +${e.amount} ${e.property} shield${e.wasted ? ` (${e.wasted} wasted)` : ''} -> ${e.totalAfter} total`);
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
        console.log(`${t} │  ${tag(e.side, e.unit)} gains ${e.status} ${e.stacks ?? 0} stacks${e.property ? ` (${e.property})` : ''}`);
        break;
      } else if (e.property) {
        detail = `(${e.property})`;
      }
      console.log(`${t} │  ${tag(e.side, e.unit)} gains ${e.status}${detail} for ${e.turns}t`);
      break;
    }
    case 'statusExpired':
      console.log(`${t} │  ${tag(e.side, e.unit)} ${e.status} expired`);
      break;
    case 'cleansed':
      console.log(`${t} │  ${tag(e.side, e.unit)} cleansed ${e.removed} effect${e.removed === 1 ? '' : 's'}`);
      break;
    case 'aggroChanged':
      // Worth printing: `aggro` is the metric the default target policy reads,
      // so this line explains WHY later casts pick the foe they pick.
      console.log(`${t} │  ${tag(e.side, e.unit)} aggro -> ${e.aggro}`);
      break;
    case 'negated':
      console.log(`${t} │  ${tag(e.side, e.unit)} negated a ${e.property} hit`);
      break;
    case 'slowed':
      console.log(`${t} │  ${tag(e.side, e.unit)} next action +${e.weight} weight (slowed)`);
      break;
    case 'splashed':
      console.log(
        `${t} │  ${tag(e.side, e.unit)} splash +${e.weight} weight on slot${e.slots.length === 1 ? '' : 's'} `
        + `${e.slots.map((slot) => (slot === e.anchorSlot ? `[${slot + 1}]` : String(slot + 1))).join(' ')} `
        + `(anchor in brackets)`,
      );
      break;
    case 'disrupted':
      console.log(`${t} │  ${tag(e.side, e.unit)} disrupted −${e.amount} bank -> ${e.bankAfter}`);
      break;
    case 'shieldBroken':
      // `burst: true` means the unit SPENT ITS OWN plating as damage
      // (`shieldBurst`) rather than having it shattered by a foe's `shieldBreak`
      // — same two numbers, opposite owner, so the line says which.
      console.log(
        e.burst
          ? `${t} │  ${tag(e.side, e.unit)} spends its own shield −${e.amount} -> ${e.totalAfter} (burst into the hit)`
          : `${t} │  ${tag(e.side, e.unit)} shield shattered −${e.amount} -> ${e.totalAfter}`,
      );
      break;
    case 'warded':
      console.log(`${t} │  ${tag(e.side, e.unit)} ward prevented ${e.status} -> ${e.chargesLeft} charge${e.chargesLeft === 1 ? '' : 's'} left`);
      break;
    case 'suddenDeathStart':
      console.log(`${t} ⚡ SUDDEN DEATH — damage ramps each turn (+10% you, +30% foe)`);
      break;
    case 'attritionStart':
      console.log(`${t} ⚡ ATTRITION — every combatant now takes ${e.amount} true damage per turn (growing)`);
      break;
    case 'fatigueStart':
      console.log(`${t} ⚡ FATIGUE backstop sets in`);
      break;
    case 'died':
      console.log(`${t} ☠  ${tag(e.side, e.unit)} dies`);
      break;
    case 'combatEnd':
      console.log(`${t} ═══ ${e.result.toUpperCase()} after ${e.turns} turns ═══`);
      break;
    default:
      break;
  }
}

const finalLine = (side: Side): string =>
  (side === 'player' ? finalState.playerTeam : finalState.enemyTeam)
    .map((u, i) => `${label(side, i)} ${u.stats.hp}/${u.stats.maxHp} hp${u.alive ? '' : ' ☠'}`)
    .join(', ');

console.log(`\nfinal: ${finalLine('player')} | ${finalLine('enemy')} | result=${result} turns=${turns} seed=${seed}`);
