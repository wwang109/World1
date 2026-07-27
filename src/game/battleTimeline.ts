import { applyTier } from '../engine/cards';
import { skillBook } from '../data/skills';
import type { CombatEvent } from '../engine/combat/events';
import type { SkillDef } from '../engine/types';
import { buildAutoHeroSetup, buildEnemyEncounter } from '../run/encounter';
import type { EnemyTitle } from '../run/encounter';
import type { BattleLog } from '../run/resolveBattle';
import type { Allocation } from '../run/leveling';
import type { EnemyFightConfig, OwnedBoardPiece } from './demoState';
import type { ScalingStats } from './ui/skillPresentation';

/**
 * `buildBattleTimeline` folds a `BattleLog` (see `run/resolveBattle`) into a
 * renderer-agnostic playback model. Every battle scene (mobile, desktop, …) is
 * a dumb playback head over this model — no Phaser import, no combat
 * recomputation here, ever.
 *
 * This file owns PRESENTATION only: log lines, per-step snapshots, FX, and the
 * damage-math grammar. Combat is NOT here and NOT in this bundle — the log
 * arrives from the battle service (`game/battleApi`). There is deliberately no
 * local-simulation fallback: `src/game` cannot import `simulate()` or
 * `resolveBattle()` at all (enforced by `scripts/check-boundaries.mjs`).
 */

export interface LogLine { tag: string; text: string; detail?: string; }
/** HP snapshot. The singular `enemy`/`enemyMax` fields are ALWAYS enemy unit 0
 * (mobile's 1v1 view); multi-foe renderers read the parallel `enemies` arrays. */
export interface HpSnap {
  player: number; enemy: number; playerMax: number; enemyMax: number;
  enemies?: number[]; enemyMaxes?: number[];
}
export interface ShieldSnap { player: number; enemy: number; enemies?: number[]; }
export interface SpeedSnap { player: string; enemy: string; enemyUnits?: string[]; }
/** One playback-FX event for a step: floating number + (for damage) a bar
 * shake. `unit` identifies the enemy unit for multi-foe fights (0 default). */
export interface TurnFx { side: 'player' | 'enemy'; kind: 'damage' | 'heal' | 'shield'; amount: number; source?: string; unit?: number; }
/** A single playback position: one IMPORTANT log line (or a turn's fallback
 * anchor line when it has no important lines) — `lineIndex` into that turn's
 * `linesByTurn` array. A scene's playback index indexes `steps`, not turns. */
export interface PlaybackStep { turn: number; lineIndex: number; }
/** A step record captured mid-build, before turns/fallback-steps are known —
 * folded into the final per-step arrays in turn order once the event loop ends. */
interface StepRecord { turn: number; lineIndex: number; hp: HpSnap; shield: ShieldSnap; fx: TurnFx[]; focus?: number; }
export interface CardSummaryRow {
  side: 'player' | 'enemy';
  name: string;
  damage: number;
  shield: number;
  healing: number;
  dots: number;
}
export interface CombatSummary {
  playerDamage: number;
  enemyDamage: number;
  playerHealing: number;
  cards: CardSummaryRow[];
}
/** A card placed at a starting slot; a size-N card occupies N slots. Plain
 * data twin of `ui/BoardColumn`'s `ColumnPiece` (minus the render-only
 * `state` cursor field, which scenes add themselves at render time). */
export interface BattlePiece { skill: SkillDef; slot: number; }

export interface BattleTimelineInput {
  pieces: OwnedBoardPiece[];
  heroLevel: number;
  heroAllocation: Allocation;
  enemyId: string;
  enemyLevel: number;
  enemyTitle: EnemyTitle;
  enemyRank: number;
  /** Modifier ids from MODIFIER_PRESETS (rogue-like affixes); [] = none. */
  enemyModifiers?: readonly string[];
  /**
   * Multi-foe fights: when present (non-empty), OVERRIDES the single-enemy
   * fields above — one encounter per entry, in order. The singular fields
   * remain for 1v1 callers (mobile).
   */
  enemyTeam?: readonly EnemyFightConfig[];
  seed: number;
}

/** One resolved enemy unit's render data (parallel to event `unit` indexes). */
export interface FoeModel {
  name: string;
  stats: ScalingStats;
  maxHp: number;
  boardSize: number;
  pieces: BattlePiece[];
  skills: SkillDef[];
  /** Full display statline, e.g. "ATK 4 · MAG 1 · DEF 1 · RES 1 · SPD 11". */
  statLine: string;
}

export interface BattleTimeline {
  linesByTurn: Map<number, LogLine[]>;
  hpByTurn: Map<number, HpSnap>;
  shieldByTurn: Map<number, ShieldSnap>;
  /** Active ailment keys per side per turn — drives the HP-bar ailment tint. */
  statusByTurn: Map<number, { player: string[]; enemy: string[] }>;
  speedByTurn: Map<number, SpeedSnap>;
  /** Which board slot each side cast from, per turn — drives the gold cursor. */
  playSlotByTurn: Map<number, { player?: number; enemy?: number }>;
  turns: number[];
  /** Flat, event-level playback timeline — one entry per IMPORTANT log line
   * (HIT/DEBUFF/BUFF/DOWN/RESULT), plus one fallback entry for any turn that
   * had none. Playback steps event-by-event, not turn-by-turn. */
  steps: PlaybackStep[];
  /** HP/shield snapshots captured at each step's exact position in the event
   * stream (not just per-turn) so the bars animate on the precise event. */
  hpByStep: HpSnap[];
  shieldByStep: ShieldSnap[];
  /** Structured per-step FX (damage/heal/shield deltas) for floating numbers + shakes. */
  fxByStep: TurnFx[][];
  /** Enemy unit each step involves — the struck/buffed foe, or the acting foe
   * when the hero is the victim. Drives the battle scenes' auto-focus tab.
   * `undefined` = no specific foe (fallback steps, RESULT-only turns). */
  focusFoeByStep: Array<number | undefined>;
  outcome: string;
  /** First playback step that contains the defeated unit's DOWN log (or the
   * normal end-of-playback RESULT step for a draw / event-less log). */
  outcomeStep: number;
  combatSummary: CombatSummary;
  heroName: string;
  foeName: string;
  heroStats: ScalingStats;
  foeStats: ScalingStats;
  heroPieces: BattlePiece[];
  heroSkills: SkillDef[];
  foePieces: BattlePiece[];
  foeSkills: SkillDef[];
  /** ALL enemy units in event `unit` order. `foeName`/`foeStats`/`foePieces`/
   * `foeSkills` above remain unit 0's view for 1v1 renderers (mobile). */
  foes: FoeModel[];
  /** Hero display statline — makes the stat-sheet allocation visible in battle. */
  heroStatLine: string;
}

function skillName(id: string): string { return skillBook[id]?.name ?? id; }

/** The HIT `D:` math detail (locked grammar): base n + (n LABEL) … = total. */
export function formatDmg(c: NonNullable<Extract<CombatEvent, { kind: 'damage' }>['calculation']>): string {
  const stat = c.scalingStat === 'attack' ? 'ATK' : 'MAG';
  const def = c.scalingStat === 'attack' ? 'DEF' : 'RES';
  const terms = [`base ${c.power}`];
  const add = (label: string, v: number): void => { if (v) terms.push(`${v > 0 ? '+' : '−'} (${Math.abs(v)} ${label})`); };
  add(stat, c.baseStat);
  add('BUFF', c.statBonusDamage);
  add('SKILL', c.effectBonusDamage);
  add(def, -c.defense);
  add('AFFINITY', c.matchupBonusDamage);
  add('RAMP', c.suddenDeathBonusDamage);
  add('GUARD', -c.guardReduction);
  add('BLOCK', -c.shieldBlocked);
  return `D: ${terms.join(' ')} = ${c.hpDamage}`;
}

/**
 * Folds a battle into a renderer-agnostic playback model (log lines, per-step
 * HP/shield/status/FX snapshots, and a battle-ledger summary). Pure — no
 * Phaser, no scene state; every battle scene calls this and only renders it.
 *
 * `log` is REQUIRED and comes from the battle service — the client has no way
 * to produce one. `input` supplies only what rendering needs: hero/foe setups,
 * names, stats, and boards.
 */
export function buildBattleTimeline(input: BattleTimelineInput, log: BattleLog): BattleTimeline {
  const heroEncounter = buildAutoHeroSetup(input.heroLevel, input.pieces.map((p) => ({ ...p })), input.heroAllocation);
  const hero = heroEncounter.setup;
  const teamConfigs: readonly EnemyFightConfig[] = input.enemyTeam && input.enemyTeam.length > 0
    ? input.enemyTeam
    : [{ enemyId: input.enemyId, level: input.enemyLevel, title: input.enemyTitle, rank: input.enemyRank, modifiers: [...(input.enemyModifiers ?? [])] }];
  const encs = teamConfigs.map((cfg) => buildEnemyEncounter(cfg.enemyId, cfg.level, cfg.title, cfg.rank, cfg.modifiers));
  const foeSetups = encs.map((e) => e.setup);
  const heroName = hero.name;
  const heroStats: ScalingStats = { attack: hero.stats.attack, magicPower: hero.stats.magicPower };

  const heroPieces: BattlePiece[] = [];
  const heroSkills: SkillDef[] = [];
  for (const p of input.pieces) {
    const s = skillBook[p.skillId]; if (!s) continue;
    heroPieces.push({ skill: s, slot: p.slot }); heroSkills.push(s);
  }
  const statLineOf = (s: { attack: number; magicPower: number; armor: number; magicResist: number; speed: number }): string =>
    `ATK ${s.attack} · MAG ${s.magicPower} · DEF ${s.armor} · RES ${s.magicResist} · SPD ${s.speed}`;
  const foes: FoeModel[] = foeSetups.map((setup) => {
    const pieces: BattlePiece[] = [];
    const skills: SkillDef[] = [];
    for (const p of setup.pieces) {
      const base = skillBook[p.skillId]; if (!base) continue;
      const s = p.tier ? applyTier(base, p.tier) : base;
      pieces.push({ skill: s, slot: p.slot }); skills.push(s);
    }
    return {
      name: setup.name,
      stats: { attack: setup.stats.attack, magicPower: setup.stats.magicPower },
      maxHp: setup.stats.maxHp,
      boardSize: setup.boardSize,
      pieces,
      skills,
      statLine: statLineOf(setup.stats),
    };
  });
  const foeName = foes[0]!.name;
  const foeStats = foes[0]!.stats;
  const foePieces = foes[0]!.pieces;
  const foeSkills = foes[0]!.skills;

  // The setups built above are for RENDERING ONLY (names, stats, boards). The
  // authoritative combat result is the served log.
  const battle: BattleLog = log;
  const outcome = battle.result === 'win' ? 'VICTORY' : battle.result === 'loss' ? 'DEFEAT' : 'DRAW';

  const linesByTurn = new Map<number, LogLine[]>();
  const hpByTurn = new Map<number, HpSnap>();
  const shieldByTurn = new Map<number, ShieldSnap>();
  const statusByTurn = new Map<number, { player: string[]; enemy: string[]; enemyUnits?: string[][] }>();
  const speedByTurn = new Map<number, SpeedSnap>();
  const playSlotByTurn = new Map<number, { player?: number; enemy?: number; enemyUnits?: Array<number | undefined> }>();

  // Per-unit live state — enemy-side values are ARRAYS indexed by event `unit`.
  const playerMax = hero.stats.maxHp;
  let curPlayer = playerMax;
  const enemyMaxes = foes.map((f) => f.maxHp);
  const curEnemies = [...enemyMaxes];
  let shieldPlayer = 0;
  const shieldEnemies = foes.map(() => 0);
  const speed: SpeedSnap = { player: '', enemy: '', enemyUnits: foes.map(() => '') };
  const dotsPlayer = new Map<string, number>();
  const dotsEnemies = foes.map(() => new Map<string, number>());
  const snapHp = (): HpSnap => ({
    player: curPlayer, enemy: curEnemies[0]!, playerMax, enemyMax: enemyMaxes[0]!,
    enemies: [...curEnemies], enemyMaxes: [...enemyMaxes],
  });
  const snapShield = (): ShieldSnap => ({ player: shieldPlayer, enemy: shieldEnemies[0]!, enemies: [...shieldEnemies] });
  const activeCardByTurn = new Map<number, CardSummaryRow>();
  const cardSummaries = new Map<string, CardSummaryRow>();
  let playerDamage = 0;
  let enemyDamage = 0;
  let playerHealing = 0;
  const unitOf = (e: { unit?: number }): number => e.unit ?? 0;
  const label = (e: Extract<CombatEvent, { side: 'player' | 'enemy' }>): string =>
    (e.side === 'player' ? heroName : (foes[unitOf(e as { unit?: number })]?.name ?? foeName));
  // Every IMPORTANT line (anything but PLAY) becomes its own playback step,
  // captured here in event order; folded into per-turn-ordered final arrays
  // (with fallback steps for import-less turns) once the loop below ends.
  const stepRecords: StepRecord[] = [];
  // The enemy unit the CURRENT event involves (victim/beneficiary on the enemy
  // side, or the acting enemy when the hero is the victim) — captured onto each
  // step record so renderers can auto-focus that foe's tab during playback.
  let curActor: { side: 'player' | 'enemy'; unit: number } | undefined;
  let curFocus: number | undefined;
  const push = (turn: number, tag: string, text: string, detail?: string): void => {
    const arr = linesByTurn.get(turn) ?? [];
    arr.push({ tag, text, detail });
    linesByTurn.set(turn, arr);
    if (tag !== 'PLAY') {
      stepRecords.push({ turn, lineIndex: arr.length - 1, hp: snapHp(), shield: snapShield(), fx: [], focus: curFocus });
    }
  };
  const pushFx = (side: 'player' | 'enemy', kind: TurnFx['kind'], amount: number, unit: number, source?: string): void => {
    if (amount <= 0) return;
    const last = stepRecords[stepRecords.length - 1];
    if (last) last.fx.push({ side, kind, amount, source, unit });
  };

  // Step 0 — the pre-battle baseline. Without it, playback would open on the
  // first HIT with its damage already applied to the HP snapshot; this line
  // shows both sides at full HP before any event resolves.
  const foesLabel = foes.map((f, i) => `${f.name} ${curEnemies[i]}/${enemyMaxes[i]}`).join(' + ');
  push(battle.events[0]?.turn ?? 1, 'START', `${heroName} ${curPlayer}/${playerMax} vs ${foesLabel}`);

  for (const e of battle.events) {
    const sided = e as { side?: 'player' | 'enemy'; unit?: number };
    if (e.kind === 'play') curActor = { side: e.side, unit: unitOf(e) };
    if (sided.side === 'enemy') curFocus = sided.unit ?? 0;
    else if (sided.side === 'player') curFocus = curActor?.side === 'enemy' ? curActor.unit : undefined;
    switch (e.kind) {
      // Readiness gain — mockup turnline: "Hero 18 · SPD +16 · Bandit 25 · SPD +15".
      case 'gain': {
        const line = `${e.readinessAfter} · SPD +${e.speed}`;
        if (e.side === 'player') speed.player = line;
        else { speed.enemyUnits![unitOf(e)] = line; if (unitOf(e) === 0) speed.enemy = line; }
        break;
      }
      case 'play': {
        // Multi-slot cards carry their span progress: the cast turn is 1/N,
        // the busy turns below continue 2/N … N/N.
        const progress = e.slotCount > 1 ? ` · ${e.slotIndex}/${e.slotCount}` : '';
        push(e.turn, 'PLAY', `${label(e)} · ${skillName(e.skillId)}${progress}`);
        const slots = playSlotByTurn.get(e.turn) ?? {};
        if (e.side === 'player') slots.player = e.slot;
        else {
          slots.enemyUnits = slots.enemyUnits ?? foes.map(() => undefined);
          slots.enemyUnits[unitOf(e)] = e.slot;
          if (unitOf(e) === 0) slots.enemy = e.slot;
        }
        playSlotByTurn.set(e.turn, slots);
        const key = `${e.side}:${e.side === 'enemy' ? unitOf(e) : 0}:${e.skillId}`;
        const card = cardSummaries.get(key) ?? {
          side: e.side,
          name: skillName(e.skillId),
          damage: 0,
          shield: 0,
          healing: 0,
          dots: 0,
        };
        cardSummaries.set(key, card);
        activeCardByTurn.set(e.turn, card);
        break;
      }
      case 'damage': {
        const dealt = Math.max(0, e.amount - e.blocked);
        const u = unitOf(e);
        if (e.side === 'player') curPlayer = e.hpAfter; else curEnemies[u] = e.hpAfter;
        if (e.blocked > 0) {
          if (e.side === 'player') shieldPlayer = Math.max(0, shieldPlayer - e.blocked);
          else shieldEnemies[u] = Math.max(0, (shieldEnemies[u] ?? 0) - e.blocked);
        }
        const hp = e.side === 'player' ? `${e.hpAfter}/${playerMax}` : `${e.hpAfter}/${enemyMaxes[u]}`;
        if (e.source === 'skill') {
          push(e.turn, 'HIT', `${label(e)} −${dealt} · ${hp}`, e.calculation ? formatDmg(e.calculation) : undefined);
        } else {
          const cap = e.source.charAt(0).toUpperCase() + e.source.slice(1);
          push(e.turn, 'DEBUFF', `${cap} · ${label(e)} −${dealt} · ${hp}`);
        }
        const activeCard = activeCardByTurn.get(e.turn);
        if (e.source === 'skill' && activeCard) {
          activeCard.damage += dealt;
        }
        if (e.source === 'skill' && activeCard?.side === 'player' && e.side === 'enemy') {
          playerDamage += dealt;
        } else if (e.source === 'skill' && activeCard?.side === 'enemy' && e.side === 'player') {
          enemyDamage += dealt;
        }
        pushFx(e.side, 'damage', dealt, u, e.source !== 'skill' ? e.source : undefined);
        break;
      }
      case 'heal': {
        const u = unitOf(e);
        if (e.side === 'player') curPlayer = e.hpAfter; else curEnemies[u] = e.hpAfter;
        if (e.side === 'player') playerHealing += e.amount;
        const activeCard = activeCardByTurn.get(e.turn);
        if (activeCard) activeCard.healing += e.amount;
        const max = e.side === 'player' ? playerMax : enemyMaxes[u];
        push(e.turn, 'BUFF', `${label(e)} +${e.amount} HP · ${e.hpAfter}/${max}`);
        pushFx(e.side, 'heal', e.amount, u);
        break;
      }
      case 'shieldGain': {
        const u = unitOf(e);
        if (e.side === 'player') shieldPlayer = e.totalAfter; else shieldEnemies[u] = e.totalAfter;
        const shieldCard = activeCardByTurn.get(e.turn);
        if (shieldCard) shieldCard.shield += e.amount;
        push(e.turn, 'BUFF', `${label(e)} +${e.amount} shield`);
        pushFx(e.side, 'shield', e.amount, u);
        break;
      }
      case 'shieldBroken': {
        const u = unitOf(e);
        if (e.side === 'player') shieldPlayer = e.totalAfter; else shieldEnemies[u] = e.totalAfter;
        push(e.turn, 'DEBUFF', `${label(e)} · shield −${e.amount}`);
        break;
      }
      case 'statusApplied': {
        const buff = e.status === 'buff' || e.status === 'guard' || e.status === 'negate';
        const cap = e.status.charAt(0).toUpperCase() + e.status.slice(1);
        push(e.turn, buff ? 'BUFF' : 'DEBUFF', `${label(e)} · ${cap}${e.stacks ? ` ${e.stacks}` : ''}`);
        if (e.status === 'poison' || e.status === 'burn' || e.status === 'bleed') {
          const dotCard = activeCardByTurn.get(e.turn);
          if (dotCard) dotCard.dots += e.stacks ?? 1;
        }
        const bucket = e.side === 'player' ? dotsPlayer : dotsEnemies[unitOf(e)]!;
        if (e.status === 'poison' || e.status === 'burn' || e.status === 'bleed') bucket.set(e.status, e.stacks ?? 0);
        else if (e.status === 'stun') bucket.set('stun', e.turns);
        else if (e.status === 'expose') bucket.set('expose', e.pct ?? 0);
        break;
      }
      case 'statusExpired': {
        const bucket = e.side === 'player' ? dotsPlayer : dotsEnemies[unitOf(e)]!;
        bucket.delete(e.status);
        break;
      }
      // A size-N card busies its caster N−1 further turns; each one gets a
      // WAIT line ("Meteor · 2/3") so span turns don't vanish from the log,
      // and the gold board cursor tracks the occupied slot being worked off.
      case 'busy': {
        push(e.turn, 'WAIT', `${label(e)} · ${skillName(e.skillId)} · ${e.slotIndex}/${e.slotCount}`);
        const slots = playSlotByTurn.get(e.turn) ?? {};
        if (e.side === 'player') slots.player = e.slot;
        else {
          slots.enemyUnits = slots.enemyUnits ?? foes.map(() => undefined);
          slots.enemyUnits[unitOf(e)] = e.slot;
          if (unitOf(e) === 0) slots.enemy = e.slot;
        }
        playSlotByTurn.set(e.turn, slots);
        break;
      }
      case 'died': push(e.turn, 'DOWN', `${label(e)} falls`); break;
      case 'combatEnd': push(e.turn, 'RESULT', `${outcome} · ${e.turns} turns`); break;
      default: break;
    }
    hpByTurn.set(e.turn, snapHp());
    shieldByTurn.set(e.turn, snapShield());
    statusByTurn.set(e.turn, {
      player: [...dotsPlayer.keys()],
      enemy: [...dotsEnemies[0]!.keys()],
      enemyUnits: dotsEnemies.map((m) => [...m.keys()]),
    });
    speedByTurn.set(e.turn, { ...speed, enemyUnits: [...speed.enemyUnits!] });
  }
  const cards = [...cardSummaries.values()]
    .sort((a, b) => (a.side === b.side ? b.damage - a.damage : a.side === 'player' ? -1 : 1));
  const combatSummary: CombatSummary = { playerDamage, enemyDamage, playerHealing, cards };
  let turns = [...linesByTurn.keys()].sort((a, b) => a - b);
  if (turns.length === 0) turns = [1];

  // Fold stepRecords (already in chronological/event order) into the final
  // per-step arrays, walking turns in order and inserting a fallback step
  // (the turn's last known line) for any turn that had no important lines.
  let steps: PlaybackStep[] = [];
  let hpByStep: HpSnap[] = [];
  let shieldByStep: ShieldSnap[] = [];
  let fxByStep: TurnFx[][] = [];
  let focusFoeByStep: Array<number | undefined> = [];
  const recordsByTurn = new Map<number, StepRecord[]>();
  for (const r of stepRecords) {
    const arr = recordsByTurn.get(r.turn) ?? [];
    arr.push(r);
    recordsByTurn.set(r.turn, arr);
  }
  for (const t of turns) {
    const recs = recordsByTurn.get(t);
    if (recs && recs.length > 0) {
      for (const r of recs) {
        steps.push({ turn: r.turn, lineIndex: r.lineIndex });
        hpByStep.push(r.hp);
        shieldByStep.push(r.shield);
        fxByStep.push(r.fx);
        focusFoeByStep.push(r.focus);
      }
    } else {
      const lines = linesByTurn.get(t) ?? [];
      steps.push({ turn: t, lineIndex: Math.max(0, lines.length - 1) });
      hpByStep.push(hpByTurn.get(t) ?? snapHp());
      shieldByStep.push(shieldByTurn.get(t) ?? snapShield());
      fxByStep.push([]);
      focusFoeByStep.push(undefined);
    }
  }
  if (steps.length === 0) {
    steps = [{ turn: turns[0] ?? 1, lineIndex: 0 }];
    hpByStep = [snapHp()];
    shieldByStep = [snapShield()];
    fxByStep = [[]];
    focusFoeByStep = [undefined];
  }
  // A lethal damage event is the meaningful end of playback. Do not force
  // the player through separate DOWN/RESULT ticks after HP has already hit 0.
  // Multi-foe: the fight only ends when the player OR every enemy is down.
  const lethalStep = hpByStep.findIndex((snapshot) =>
    snapshot.player <= 0 || (snapshot.enemies ?? [snapshot.enemy]).every((v) => v <= 0));
  if (lethalStep >= 0) {
    steps = steps.slice(0, lethalStep + 1);
    hpByStep = hpByStep.slice(0, lethalStep + 1);
    shieldByStep = shieldByStep.slice(0, lethalStep + 1);
    fxByStep = fxByStep.slice(0, lethalStep + 1);
    focusFoeByStep = focusFoeByStep.slice(0, lethalStep + 1);
  }
  const resultStep = steps.findIndex((step) => {
    const line = linesByTurn.get(step.turn)?.[step.lineIndex];
    return line?.tag === 'RESULT';
  });
  // Draws or unusual empty logs have no DOWN event; preserve their normal
  // end-of-playback result banner.
  const outcomeStep = lethalStep >= 0 ? lethalStep : resultStep >= 0 ? resultStep : steps.length - 1;

  return {
    linesByTurn,
    hpByTurn,
    shieldByTurn,
    statusByTurn,
    speedByTurn,
    playSlotByTurn,
    turns,
    steps,
    hpByStep,
    shieldByStep,
    fxByStep,
    focusFoeByStep,
    outcome,
    outcomeStep,
    combatSummary,
    heroName,
    foeName,
    heroStats,
    foeStats,
    heroPieces,
    heroSkills,
    foePieces,
    foeSkills,
    foes,
    heroStatLine: statLineOf(hero.stats),
  };
}
