import Phaser from 'phaser';
import { simulate } from '../../engine/combat/simulate';
import { applyTier } from '../../engine/cards';
import { skillBook } from '../../data/skills';
import type { CombatEvent } from '../../engine/combat/events';
import type { SkillDef } from '../../engine/types';
import { buildAutoHeroSetup, buildEnemyEncounter } from '../../run/encounter';
import { demoState } from '../demoState';
import { FONT, SCREEN, UI } from '../theme';
import { BoardColumn, type ColumnPiece } from '../ui/BoardColumn';
import { footerY, renderActionBar } from '../ui/ActionBar';
import type { ScalingStats } from '../ui/skillPresentation';

interface LogLine { tag: string; text: string; detail?: string; }
interface HpSnap { player: number; enemy: number; playerMax: number; enemyMax: number; }
interface SpeedSnap { player: string; enemy: string; }
/** One playback-FX event for a step: floating number + (for damage) a bar shake. */
interface TurnFx { side: 'player' | 'enemy'; kind: 'damage' | 'heal' | 'shield'; amount: number; source?: string; }
/** A single playback position: one IMPORTANT log line (or a turn's fallback
 * anchor line when it has no important lines) — `lineIndex` into that turn's
 * `linesByTurn` array. `this.idx` indexes `steps`, not turns. */
interface PlaybackStep { turn: number; lineIndex: number; }
/** A step record captured mid-build, before turns/fallback-steps are known —
 * folded into the final per-step arrays in turn order once the event loop ends. */
interface StepRecord { turn: number; lineIndex: number; hp: HpSnap; shield: { player: number; enemy: number }; fx: TurnFx[]; }
/** Everything a rendered HP bar hands back so FX can target it after the fact. */
interface HpBarHandles {
  fillRect: Phaser.GameObjects.Rectangle;
  shieldRect: Phaser.GameObjects.Rectangle;
  shakeTargets: Array<Phaser.GameObjects.Text | Phaser.GameObjects.Rectangle>;
  floatX: number;
  floatY: number;
}
interface CardSummaryRow {
  side: 'player' | 'enemy';
  name: string;
  damage: number;
  shield: number;
  healing: number;
  dots: number;
}
interface CombatSummary {
  playerDamage: number;
  enemyDamage: number;
  playerHealing: number;
  cards: CardSummaryRow[];
}
// Footer buttons come from the shared ActionBar template (ui/ActionBar.ts).

const TAG_COLOR: Record<string, string> = {
  PLAY: '#4f9e57', HIT: '#d05c4e', BUFF: '#5fb56a',
  DEBUFF: '#a678d8', WAIT: '#c9a15a', DOWN: '#d05c4e', RESULT: '#e8b446',
};
/** Ailment identity colors — used to tint the afflicted side's HP bar and its DoT tick numbers. */
const AILMENT_COLOR: Record<string, string> = { poison: '#8fbe5a', burn: '#e07a3a', bleed: '#d05c4e', stun: '#c9a15a', expose: '#a678d8' };
const AILMENT_TINT: Record<string, number> = { poison: 0x8fbe5a, burn: 0xe07a3a, bleed: 0xd05c4e, stun: 0xc9a15a, expose: 0xa678d8 };

/**
 * Mobile Battle — vertical: LOG dock (top, tap a HIT to expand its D: math) ·
 * HP block (bars + shield strip + ailment row) · YOUR DECK vs ENEMY boards
 * (shared BoardColumn) with a vertical event-level scrubber in the gutter
 * (major tick per turn, minor tick per event) · compact controls. Runs the
 * real simulate(); playback steps event-by-event, not turn-by-turn.
 */
export class MobileBattleScene extends Phaser.Scene {
  private W = SCREEN.width;
  private H = SCREEN.height;
  private linesByTurn = new Map<number, LogLine[]>();
  private hpByTurn = new Map<number, HpSnap>();
  private shieldByTurn = new Map<number, { player: number; enemy: number }>();
  /** Active ailment keys per side per turn — drives the HP-bar ailment tint. */
  private statusByTurn = new Map<number, { player: string[]; enemy: string[] }>();
  private speedByTurn = new Map<number, SpeedSnap>();
  /** Which board slot each side cast from, per turn — drives the gold cursor. */
  private playSlotByTurn = new Map<number, { player?: number; enemy?: number }>();
  private turns: number[] = [];
  /** Flat, event-level playback timeline — one entry per IMPORTANT log line
   * (HIT/DEBUFF/BUFF/DOWN/RESULT), plus one fallback entry for any turn that
   * had none (e.g. a turn that was only a PLAY/wait). `this.idx` indexes this,
   * not `turns` — playback now steps event-by-event, not turn-by-turn. */
  private steps: PlaybackStep[] = [];
  /** HP/shield snapshots captured at each step's exact position in the event
   * stream (not just per-turn) so the bars animate on the precise event. */
  private hpByStep: HpSnap[] = [];
  private shieldByStep: Array<{ player: number; enemy: number }> = [];
  /** Structured per-step FX (damage/heal/shield deltas) for floating numbers + shakes. */
  private fxByStep: TurnFx[][] = [];
  private idx = 0;
  /** The `idx` shown by the previous render() call — used to detect a single
   * forward step (playback tick or one scrub click) vs. a jump/rewind, which
   * gates all FX (floating numbers, shakes, bar tweens) per the no-spam rule. */
  private lastIdx = -1;
  private expanded = new Set<string>();
  private heroPieces: ColumnPiece[] = [];
  private heroSkills: SkillDef[] = [];
  private foePieces: ColumnPiece[] = [];
  private foeSkills: SkillDef[] = [];
  private heroName = 'Hero';
  private foeName = 'Foe';
  private heroStats: ScalingStats = { attack: 0, magicPower: 0 };
  private foeStats: ScalingStats = { attack: 0, magicPower: 0 };
  private outcome = '';
  private combatSummary: CombatSummary = { playerDamage: 0, enemyDamage: 0, playerHealing: 0, cards: [] };
  /** First playback step that contains the defeated unit's DOWN log. */
  private outcomeStep = -1;
  private playing = true;
  private playTimer?: Phaser.Time.TimerEvent;

  constructor() { super('MobileBattle'); }

  create(): void {
    this.W = SCREEN.width; this.H = SCREEN.height;
    this.cameras.main.setBackgroundColor(0x0b1420);
    this.buildFight();
    this.idx = 0;
    this.render();
    this.startPlayback();
  }

  /** Auto-advance the scrubber through the fight, one event-step at a time; stops at the end. */
  private startPlayback(): void {
    if (this.steps.length <= 1) return;
    this.playing = true;
    this.schedulePlaybackStep();
  }

  /** Use a short death beat so DOWN reads before the result banner takes over. */
  private schedulePlaybackStep(): void {
    if (!this.playing) return;
    const current = this.steps[this.idx];
    const line = current ? this.linesByTurn.get(current.turn)?.[current.lineIndex] : undefined;
    const delay = line?.tag === 'DOWN' ? 160 : 450;
    this.playTimer = this.time.delayedCall(delay, () => {
      if (this.idx < this.steps.length - 1) {
        this.idx += 1;
        this.render();
        this.schedulePlaybackStep();
      } else {
        this.stopPlayback();
      }
    });
  }

  /** Halt playback (called when the user grabs the scrubber). */
  private stopPlayback(): void {
    this.playing = false;
    this.playTimer?.remove();
    this.playTimer = undefined;
  }

  /** Add a single-line text clamped to `maxW`; overflow is cut with an ellipsis. */
  private boundedText(
    x: number, y: number, str: string,
    style: Phaser.Types.GameObjects.Text.TextStyle, maxW: number,
    originX = 0, originY = 0,
  ): Phaser.GameObjects.Text {
    const t = this.add.text(x, y, str, style).setOrigin(originX, originY);
    if (t.width > maxW && str.length > 1) {
      let s = str;
      while (s.length > 1 && t.width > maxW) { s = s.slice(0, -1); t.setText(`${s}…`); }
    }
    return t;
  }

  private skillName(id: string): string { return skillBook[id]?.name ?? id; }

  /** The HIT `D:` math detail (locked grammar): base n + (n LABEL) … = total. */
  private formatDmg(c: NonNullable<Extract<CombatEvent, { kind: 'damage' }>['calculation']>): string {
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

  private buildFight(): void {
    const heroEncounter = buildAutoHeroSetup(demoState.heroLevel, demoState.pieces.map((p) => ({ ...p })), demoState.heroAllocation);
    const hero = heroEncounter.setup;
    const enc = buildEnemyEncounter(demoState.enemyId, demoState.enemyLevel, demoState.enemyTitle, demoState.enemyRank);
    const foe = enc.setup;
    this.heroName = hero.name;
    this.foeName = foe.name;
    this.heroStats = { attack: hero.stats.attack, magicPower: hero.stats.magicPower };
    this.foeStats = { attack: foe.stats.attack, magicPower: foe.stats.magicPower };

    for (const p of demoState.pieces) {
      const s = skillBook[p.skillId]; if (!s) continue;
      this.heroPieces.push({ skill: s, slot: p.slot }); this.heroSkills.push(s);
    }
    for (const p of foe.pieces) {
      const base = skillBook[p.skillId]; if (!base) continue;
      const s = p.tier ? applyTier(base, p.tier) : base;
      this.foePieces.push({ skill: s, slot: p.slot }); this.foeSkills.push(s);
    }

    const result = simulate({ playerTeam: [hero], enemyTeam: [foe], skillBook }, demoState.seed);
    this.outcome = result.result === 'win' ? 'VICTORY' : result.result === 'loss' ? 'DEFEAT' : 'DRAW';

    const cur: HpSnap = { player: hero.stats.maxHp, enemy: foe.stats.maxHp, playerMax: hero.stats.maxHp, enemyMax: foe.stats.maxHp };
    const shield = { player: 0, enemy: 0 };
    const speed: SpeedSnap = { player: '', enemy: '' };
    const dots: Record<'player' | 'enemy', Map<string, number>> = { player: new Map(), enemy: new Map() };
    const activeCardByTurn = new Map<number, CardSummaryRow>();
    const cardSummaries = new Map<string, CardSummaryRow>();
    let playerDamage = 0;
    let enemyDamage = 0;
    let playerHealing = 0;
    const label = (e: Extract<CombatEvent, { side: 'player' | 'enemy' }>): string => (e.side === 'player' ? this.heroName : this.foeName);
    // Every IMPORTANT line (anything but PLAY) becomes its own playback step,
    // captured here in event order; folded into per-turn-ordered final arrays
    // (with fallback steps for import-less turns) once the loop below ends.
    const stepRecords: StepRecord[] = [];
    const push = (turn: number, tag: string, text: string, detail?: string): void => {
      const arr = this.linesByTurn.get(turn) ?? [];
      arr.push({ tag, text, detail });
      this.linesByTurn.set(turn, arr);
      if (tag !== 'PLAY') {
        stepRecords.push({ turn, lineIndex: arr.length - 1, hp: { ...cur }, shield: { ...shield }, fx: [] });
      }
    };
    const pushFx = (side: 'player' | 'enemy', kind: TurnFx['kind'], amount: number, source?: string): void => {
      if (amount <= 0) return;
      const last = stepRecords[stepRecords.length - 1];
      if (last) last.fx.push({ side, kind, amount, source });
    };

    for (const e of result.events) {
      switch (e.kind) {
        // Readiness gain — mockup turnline: "Hero 18 · SPD +16 · Bandit 25 · SPD +15".
        case 'gain': speed[e.side] = `${e.readinessAfter} · SPD +${e.speed}`; break;
        case 'play': {
          push(e.turn, 'PLAY', `${label(e)} · ${this.skillName(e.skillId)}`);
          const slots = this.playSlotByTurn.get(e.turn) ?? {};
          slots[e.side] = e.slot;
          this.playSlotByTurn.set(e.turn, slots);
          const key = `${e.side}:${e.skillId}`;
          const card = cardSummaries.get(key) ?? {
            side: e.side,
            name: this.skillName(e.skillId),
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
          if (e.side === 'player') cur.player = e.hpAfter; else cur.enemy = e.hpAfter;
          if (e.blocked > 0) shield[e.side] = Math.max(0, shield[e.side] - e.blocked);
          const hp = e.side === 'player' ? `${e.hpAfter}/${cur.playerMax}` : `${e.hpAfter}/${cur.enemyMax}`;
          if (e.source === 'skill') {
            push(e.turn, 'HIT', `${label(e)} −${dealt} · ${hp}`, e.calculation ? this.formatDmg(e.calculation) : undefined);
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
          pushFx(e.side, 'damage', dealt, e.source !== 'skill' ? e.source : undefined);
          break;
        }
        case 'heal': {
          if (e.side === 'player') cur.player = e.hpAfter; else cur.enemy = e.hpAfter;
          if (e.side === 'player') playerHealing += e.amount;
          const activeCard = activeCardByTurn.get(e.turn);
          if (activeCard) activeCard.healing += e.amount;
          const max = e.side === 'player' ? cur.playerMax : cur.enemyMax;
          push(e.turn, 'BUFF', `${label(e)} +${e.amount} HP · ${e.hpAfter}/${max}`);
          pushFx(e.side, 'heal', e.amount);
          break;
        }
        case 'shieldGain':
          shield[e.side] = e.totalAfter;
          const shieldCard = activeCardByTurn.get(e.turn);
          if (shieldCard) shieldCard.shield += e.amount;
          push(e.turn, 'BUFF', `${label(e)} +${e.amount} shield`);
          pushFx(e.side, 'shield', e.amount);
          break;
        case 'shieldBroken': shield[e.side] = e.totalAfter; push(e.turn, 'DEBUFF', `${label(e)} · shield −${e.amount}`); break;
        case 'statusApplied': {
          const buff = e.status === 'buff' || e.status === 'guard' || e.status === 'negate';
          const cap = e.status.charAt(0).toUpperCase() + e.status.slice(1);
          push(e.turn, buff ? 'BUFF' : 'DEBUFF', `${label(e)} · ${cap}${e.stacks ? ` ${e.stacks}` : ''}`);
          if (e.status === 'poison' || e.status === 'burn' || e.status === 'bleed') {
            const dotCard = activeCardByTurn.get(e.turn);
            if (dotCard) dotCard.dots += e.stacks ?? 1;
          }
          if (e.status === 'poison' || e.status === 'burn' || e.status === 'bleed') dots[e.side].set(e.status, e.stacks ?? 0);
          else if (e.status === 'stun') dots[e.side].set('stun', e.turns);
          else if (e.status === 'expose') dots[e.side].set('expose', e.pct ?? 0);
          break;
        }
        case 'statusExpired': dots[e.side].delete(e.status); break;
        case 'died': push(e.turn, 'DOWN', `${label(e)} falls`); break;
        case 'combatEnd': push(e.turn, 'RESULT', `${this.outcome} · ${e.turns} turns`); break;
        default: break;
      }
      this.hpByTurn.set(e.turn, { ...cur });
      this.shieldByTurn.set(e.turn, { ...shield });
      this.statusByTurn.set(e.turn, { player: [...dots.player.keys()], enemy: [...dots.enemy.keys()] });
      this.speedByTurn.set(e.turn, { ...speed });
    }
    const cards = [...cardSummaries.values()]
      .sort((a, b) => (a.side === b.side ? b.damage - a.damage : a.side === 'player' ? -1 : 1));
    this.combatSummary = { playerDamage, enemyDamage, playerHealing, cards };
    this.turns = [...this.linesByTurn.keys()].sort((a, b) => a - b);
    if (this.turns.length === 0) this.turns = [1];

    // Fold stepRecords (already in chronological/event order) into the final
    // per-step arrays, walking turns in order and inserting a fallback step
    // (the turn's last known line) for any turn that had no important lines.
    const recordsByTurn = new Map<number, StepRecord[]>();
    for (const r of stepRecords) {
      const arr = recordsByTurn.get(r.turn) ?? [];
      arr.push(r);
      recordsByTurn.set(r.turn, arr);
    }
    for (const t of this.turns) {
      const recs = recordsByTurn.get(t);
      if (recs && recs.length > 0) {
        for (const r of recs) {
          this.steps.push({ turn: r.turn, lineIndex: r.lineIndex });
          this.hpByStep.push(r.hp);
          this.shieldByStep.push(r.shield);
          this.fxByStep.push(r.fx);
        }
      } else {
        const lines = this.linesByTurn.get(t) ?? [];
        this.steps.push({ turn: t, lineIndex: Math.max(0, lines.length - 1) });
        this.hpByStep.push(this.hpByTurn.get(t) ?? cur);
        this.shieldByStep.push(this.shieldByTurn.get(t) ?? shield);
        this.fxByStep.push([]);
      }
    }
    if (this.steps.length === 0) {
      this.steps = [{ turn: this.turns[0] ?? 1, lineIndex: 0 }];
      this.hpByStep = [cur];
      this.shieldByStep = [shield];
      this.fxByStep = [[]];
    }
    // A lethal damage event is the meaningful end of playback. Do not force
    // the player through separate DOWN/RESULT ticks after HP has already hit 0.
    const lethalStep = this.hpByStep.findIndex((snapshot) => snapshot.player <= 0 || snapshot.enemy <= 0);
    if (lethalStep >= 0) {
      this.steps = this.steps.slice(0, lethalStep + 1);
      this.hpByStep = this.hpByStep.slice(0, lethalStep + 1);
      this.shieldByStep = this.shieldByStep.slice(0, lethalStep + 1);
      this.fxByStep = this.fxByStep.slice(0, lethalStep + 1);
    }
    const resultStep = this.steps.findIndex((step) => {
      const line = this.linesByTurn.get(step.turn)?.[step.lineIndex];
      return line?.tag === 'RESULT';
    });
    // Draws or unusual empty logs have no DOWN event; preserve their normal
    // end-of-playback result banner.
    this.outcomeStep = lethalStep >= 0 ? lethalStep : resultStep >= 0 ? resultStep : this.steps.length - 1;
  }

  private render(): void {
    // Kill any in-flight FX tweens before the full redraw so fast scrubbing
    // never leaves an orphaned tween chasing a destroyed object.
    this.tweens.killAll();
    this.children.removeAll();
    this.cameras.main.setBackgroundColor(0x0b1420);
    const step = this.steps[this.idx] ?? this.steps[0] ?? { turn: this.turns[0] ?? 1, lineIndex: 0 };
    const turn = step.turn;
    const hp = this.hpByStep[this.idx] ?? this.hpByTurn.get(turn) ?? { player: 0, enemy: 0, playerMax: 1, enemyMax: 1 };
    const shield = this.shieldByStep[this.idx] ?? this.shieldByTurn.get(turn) ?? { player: 0, enemy: 0 };
    const status = this.statusByTurn.get(turn) ?? { player: [], enemy: [] };
    // FX (floating numbers, shakes, bar tweens, card pulse) only fire on a
    // single forward step — playback tick or one scrub click — never on a
    // jump/rewind, which would otherwise replay every step's FX in a burst.
    const prevIdx = this.lastIdx;
    this.lastIdx = this.idx;
    const forwardStep = prevIdx >= 0 && this.idx === prevIdx + 1;
    const prevHp = forwardStep ? this.hpByStep[prevIdx] : undefined;
    const prevShield = forwardStep ? this.shieldByStep[prevIdx] : undefined;
    // The RESULT step follows DOWN with a short death beat, rather than the
    // normal event-level delay. This gives the fall a readable moment without
    // making the victory/defeat animation feel late.
    const isOutcomeStep = this.outcomeStep >= 0 && this.idx >= this.outcomeStep;

    // ---- LOG dock (top) — small, ~4-5 rows like the mockup; the boards below
    // take the majority of the screen. Tap a HIT to expand its D: math. ----
    const dockH = 158;
    this.add.rectangle(0, 0, this.W, dockH, 0x101a2a).setOrigin(0, 0).setStrokeStyle(2, 0xb78a46, 0.9);
    // Turnline (mockup): "T3   Hero 18 · SPD +16  ·  Bandit 25 · SPD +15"
    const spd = this.speedByTurn.get(turn) ?? { player: '', enemy: '' };
    this.add.text(12, 8, `T${turn}${!isOutcomeStep && this.playing ? ' ▶' : ''}`, { fontSize: '13px', color: '#b78a46', fontFamily: FONT.body, fontStyle: 'bold' });
    const turnStats = [spd.player && `${this.heroName} ${spd.player}`, spd.enemy && `${this.foeName} ${spd.enemy}`].filter(Boolean).join('   ·   ');
    if (turnStats) this.boundedText(66, 9, turnStats, { fontSize: '11px', color: '#cdd4de', fontFamily: FONT.body }, this.W - 78);

    // Rolling transcript: every line up through the current step's line —
    // earlier turns show all their lines; the current turn only shows up to
    // (and including) the line this step anchors. Newest at the bottom.
    const feed: Array<{ t: number; local: number; line: LogLine }> = [];
    for (const t of this.turns) {
      if (t > turn) break;
      const lines = this.linesByTurn.get(t) ?? [];
      const limit = t === turn ? step.lineIndex : lines.length - 1;
      lines.forEach((line, local) => { if (local <= limit) feed.push({ t, local, line }); });
    }
    // Fixed columns (mockup): turn gutter · 56px tag column · text. A hairline
    // separates rows. Overflow is clipped with an ellipsis, never crowded.
    const rowH = 21;
    const headerBottom = 30;
    const turnX = 12;   // dim "T3" marker where the turn changes
    const tagX = 36;    // tag column start
    const textX = 98;   // text column start — clear of the widest tag (RESULT)
    const maxRows = Math.max(1, Math.floor((dockH - headerBottom - 6) / rowH));
    const visible = feed.slice(-maxRows);
    let ly = headerBottom;
    let prevTurn = -1;
    for (const { t, local, line } of visible) {
      if (ly > dockH - 16) break;
      const key = `${t}:${local}`;
      this.add.rectangle(12, ly - 3, this.W - 24, 1, 0x1c2940).setOrigin(0, 0);
      if (t !== prevTurn) this.add.text(turnX, ly + 2, `T${t}`, { fontSize: '9px', color: '#5a6a82', fontFamily: FONT.body, fontStyle: 'bold' });
      prevTurn = t;
      this.boundedText(tagX, ly, line.tag, { fontSize: '11px', color: TAG_COLOR[line.tag] ?? UI.textDim, fontFamily: FONT.body, fontStyle: 'bold' }, textX - tagX - 6);
      const textMaxW = this.W - textX - (line.detail ? 26 : 14);
      this.boundedText(textX, ly, line.text, { fontSize: '12px', color: '#e8e0c8', fontFamily: FONT.body }, textMaxW);
      if (line.detail) {
        this.add.text(this.W - 12, ly, this.expanded.has(key) ? '▲' : '▾', { fontSize: '10px', color: '#8a94a6', fontFamily: FONT.body }).setOrigin(1, 0);
        const zone = this.add.rectangle(0, ly - 3, this.W, rowH, 0xffffff, 0.001).setOrigin(0, 0).setInteractive({ useHandCursor: true });
        zone.on('pointerdown', () => { if (this.expanded.has(key)) this.expanded.delete(key); else this.expanded.add(key); this.render(); });
      }
      ly += rowH;
      if (line.detail && this.expanded.has(key) && ly < dockH - 12) {
        const d = this.boundedText(textX, ly, line.detail, { fontSize: '10px', color: '#8a94a6', fontFamily: FONT.body }, this.W - textX - 14);
        ly += d.height + 4;
      }
    }

    // ---- HP block: bars + shield strip. Ailments live ON the bar (tint +
    // colored pips), not in a text row — the log already narrates them. ----
    const hpY = dockH + 10;
    const heroBar = this.hpBar(
      hpY, this.heroName, hp.player, hp.playerMax, shield.player, UI.good ?? 0x4f9e57, status.player,
      forwardStep ? { hp: prevHp?.player ?? hp.player, shield: prevShield?.player ?? shield.player } : undefined,
    );
    const foeBar = this.hpBar(
      hpY + 26, this.foeName, hp.enemy, hp.enemyMax, shield.enemy, UI.bad ?? 0xb0483c, status.enemy,
      forwardStep ? { hp: prevHp?.enemy ?? hp.enemy, shield: prevShield?.enemy ?? shield.enemy } : undefined,
    );

    // ---- floating numbers + defender shake for this step's damage/heal/shield ----
    if (forwardStep) {
      for (const fx of this.fxByStep[this.idx] ?? []) {
        const bar = fx.side === 'player' ? heroBar : foeBar;
        if (fx.kind === 'damage') {
          this.shakeBar(bar.shakeTargets);
          // DoT ticks float in their ailment's color (poison green, burn orange…)
          const dmgColor = fx.source ? (AILMENT_COLOR[fx.source] ?? '#d05c4e') : '#d05c4e';
          this.spawnFloat(bar.floatX, bar.floatY, `−${fx.amount}`, dmgColor);
        } else if (fx.kind === 'heal') {
          this.spawnFloat(bar.floatX, bar.floatY, `+${fx.amount}`, '#5fb56a');
        } else if (fx.kind === 'shield') {
          this.spawnFloat(bar.floatX, bar.floatY, `+${fx.amount}`, '#5fa8d3');
        }
      }
    }

    // ---- boards + gutter scrubber ----
    const top = hpY + 58;
    const colH = footerY(this.H) - top - 8;
    const gutterW = 24;
    const colW = (this.W - 20 - gutterW) / 2;
    const deckX = 10; const gutterX = 10 + colW; const bagX = 10 + colW + gutterW;
    // Gold cursor on the card each side cast this turn (a size-N piece owns its span).
    const slots = this.playSlotByTurn.get(turn) ?? {};
    const mark = (pieces: ColumnPiece[], slot?: number): ColumnPiece[] => pieces.map((p) => ({
      ...p,
      state: slot !== undefined && slot >= p.slot && slot < p.slot + Math.max(1, p.skill.size) ? 'cursor' as const : p.state,
    }));
    const heroCol = new BoardColumn(this, { x: deckX, y: top, width: colW, height: colH, side: 'left', pieces: mark(this.heroPieces, slots.player), deck: this.heroSkills, stats: this.heroStats });
    const foeCol = new BoardColumn(this, { x: bagX, y: top, width: colW, height: colH, side: 'right', pieces: mark(this.foePieces, slots.enemy), deck: this.foeSkills, stats: this.foeStats });
    // Quick scale pulse on the card that just played this turn (forward step only).
    if (forwardStep) {
      if (slots.player !== undefined) this.pulseTokenAt(heroCol, this.heroPieces, slots.player);
      if (slots.enemy !== undefined) this.pulseTokenAt(foeCol, this.foePieces, slots.enemy);
    }
    this.renderScrubber(gutterX + gutterW / 2, top, colH);
    renderActionBar(this, this.W, this.H, [
      { label: 'PREP', onPress: () => this.scene.start('MobilePrep') },
      { label: 'REPLAY', onPress: () => { this.stopPlayback(); this.idx = 0; this.render(); this.startPlayback(); } },
      { label: 'END', primary: true, onPress: () => { this.stopPlayback(); this.idx = this.steps.length - 1; this.render(); } },
    ]);

    if (isOutcomeStep) {
      const good = this.outcome === 'VICTORY';
      const by = top + colH / 2 - 26;
      const summaryRows = this.combatSummary.cards.filter((row) => row.damage > 0 || row.shield > 0 || row.healing > 0 || row.dots > 0);
      const summaryColumns = 2;
      const summaryRowH = 34;
      const summaryH = 74 + Math.max(1, Math.ceil(summaryRows.length / summaryColumns)) * summaryRowH;
      const summaryBy = by - summaryH - 8;
      this.add.rectangle(deckX, summaryBy, this.W - 20, summaryH, 0x101a2a, 0.96)
        .setOrigin(0, 0).setStrokeStyle(1, 0xb78a46, 0.8);
      this.add.text(deckX + 12, summaryBy + 8, 'BATTLE LEDGER', { fontSize: '11px', color: '#e8b446', fontFamily: FONT.body, fontStyle: 'bold' });
      this.add.text(this.W - 30, summaryBy + 8, `${summaryRows.length} EFFECTIVE CARDS`, { fontSize: '9px', color: '#8a94a6', fontFamily: FONT.body, fontStyle: 'bold' }).setOrigin(1, 0);
      this.add.rectangle(deckX + 10, summaryBy + 27, this.W - 40, 1, 0x2a3a52).setOrigin(0, 0);
      const totalMetrics = [
        this.combatSummary.playerDamage > 0 ? `YOU DMG ${this.combatSummary.playerDamage}` : '',
        this.combatSummary.enemyDamage > 0 ? `FOE DMG ${this.combatSummary.enemyDamage}` : '',
        this.combatSummary.playerHealing > 0 ? `HEAL ${this.combatSummary.playerHealing}` : '',
      ].filter(Boolean).join('  ·  ');
      this.boundedText(deckX + 12, summaryBy + 33, totalMetrics || 'No measurable output', { fontSize: '10px', color: '#cdd4de', fontFamily: FONT.body, fontStyle: 'bold' }, this.W - 44);
      this.add.text(deckX + 12, summaryBy + 52, 'CARD OUTPUT', { fontSize: '9px', color: '#8a94a6', fontFamily: FONT.body, fontStyle: 'bold' });
      summaryRows.forEach((row, index) => {
        const col = index % summaryColumns;
        const rowIndex = Math.floor(index / summaryColumns);
        const cellW = (this.W - 40) / summaryColumns;
        const cellX = deckX + 10 + col * cellW;
        const y = summaryBy + 66 + rowIndex * summaryRowH;
        const prefix = row.side === 'player' ? 'YOU' : 'FOE';
        const accent = row.side === 'player' ? 0x315f43 : 0x6c3838;
        this.add.rectangle(cellX, y, cellW - 6, 27, accent, 0.42).setOrigin(0, 0).setStrokeStyle(1, row.side === 'player' ? 0x4f9e57 : 0xb0483c, 0.55);
        this.boundedText(cellX + 6, y + 3, `${prefix} · ${row.name}`, { fontSize: '9px', color: '#e8e0c8', fontFamily: FONT.body, fontStyle: 'bold' }, cellW - 18);
        const metrics = [
          row.damage > 0 ? `DMG ${row.damage}` : '',
          row.shield > 0 ? `SHD ${row.shield}` : '',
          row.healing > 0 ? `HEAL ${row.healing}` : '',
          row.dots > 0 ? `DOT ${row.dots}` : '',
        ].filter(Boolean).join('  ·  ');
        this.boundedText(cellX + 6, y + 15, metrics, { fontSize: '8px', color: '#e8b446', fontFamily: FONT.body }, cellW - 18);
      });
      this.add.rectangle(deckX, by, this.W - 20, 52, good ? 0x143a1a : 0x3a1414, 0.92).setOrigin(0, 0).setStrokeStyle(2, good ? 0x4f9e57 : 0xb0483c);
      this.add.text(this.W / 2, by + 26, this.outcome, { fontSize: '26px', color: good ? '#7fe08a' : '#f08a7a', fontFamily: FONT.display, fontStyle: 'bold' }).setOrigin(0.5);
    }
  }

  /**
   * Vertical scrubber over `steps` (event-level, not turn-level): a MAJOR tick
   * (14×3, gold once passed) at each turn's first step, a MINI tick (7×2,
   * dimmer gold once passed) for every other step — matches the
   * `.vtick`/`.vmini` mockup (docs/mockups/mobile-battle-final.html).
   */
  private renderScrubber(cx: number, top: number, height: number): void {
    const n = this.steps.length;
    const gap = n <= 1 ? 0 : Math.min(18, height / (n - 1));
    const railLen = gap * (n - 1);
    const yFor = (i: number): number => top + i * gap;
    this.add.rectangle(cx, top, 8, railLen, 0x16233a).setOrigin(0.5, 0).setStrokeStyle(1, 0x2a3a52, 1);
    this.add.rectangle(cx, top, 8, yFor(this.idx) - top, 0xb78a46).setOrigin(0.5, 0);
    for (let i = 0; i < n; i++) {
      const passed = i <= this.idx;
      const isMajor = i === 0 || this.steps[i]!.turn !== this.steps[i - 1]!.turn;
      if (isMajor) this.add.rectangle(cx, yFor(i), 14, 3, passed ? 0xb78a46 : 0x3a4a62).setOrigin(0.5, 0.5);
      else this.add.rectangle(cx, yFor(i), 7, 2, passed ? 0x8a6a34 : 0x2c3e58).setOrigin(0.5, 0.5);
    }
    this.add.circle(cx, yFor(this.idx), 11, 0xe8b446).setStrokeStyle(2, 0x1a1208);
    this.add.text(cx, yFor(this.idx) + 15, `T${this.steps[this.idx]?.turn ?? this.turns[0] ?? 1}`, { fontSize: '9px', color: '#e8b446', fontFamily: FONT.body, fontStyle: 'bold' }).setOrigin(0.5, 0);
    const zone = this.add.rectangle(cx, top, 40, railLen || 20, 0xffffff, 0.001).setOrigin(0.5, 0).setInteractive({ useHandCursor: true });
    const setFromY = (y: number): void => {
      const i = railLen <= 0 ? 0 : Math.round(Math.max(0, Math.min(1, (y - top) / railLen)) * (n - 1));
      if (i !== this.idx) { this.idx = i; this.render(); }
    };
    zone.on('pointerdown', (p: Phaser.Input.Pointer) => { this.stopPlayback(); setFromY(p.y); });
    zone.on('pointermove', (p: Phaser.Input.Pointer) => { if (p.isDown) setFromY(p.y); });
  }

  /**
   * `prev`, when given (forward-step only), makes the fill/shield rects tween
   * from the previous turn's fraction to the current one instead of snapping.
   */
  private hpBar(
    y: number, name: string, hp: number, max: number, shield: number, color: number,
    ailments: string[],
    prev?: { hp: number; shield: number },
  ): HpBarHandles {
    const barX = 120; const barW = this.W - barX - 84;
    const frac = (v: number): number => barW * Math.max(0, Math.min(1, v / max));
    const nameText = this.boundedText(12, y, name.toUpperCase(), { fontSize: '12px', color: '#e8e0c8', fontFamily: FONT.body, fontStyle: 'bold' }, barX - 20);
    // Afflicted bars shift color toward their ailment (poison → green cast…)
    // and carry a colored border + one pip per ailment under the bar's end.
    const firstAilment = ailments.find((a) => AILMENT_TINT[a] !== undefined);
    const fillColor = firstAilment ? this.blendColor(color, AILMENT_TINT[firstAilment]!, 45) : color;
    const border = this.add.rectangle(barX, y + 7, barW, 12, 0x1b2431).setOrigin(0, 0.5);
    border.setStrokeStyle(1, firstAilment ? AILMENT_TINT[firstAilment]! : 0x3a4a62, firstAilment ? 1 : 0.7);
    ailments.forEach((a, i) => {
      const tint = AILMENT_TINT[a];
      if (tint !== undefined) this.add.rectangle(barX + barW - 4 - i * 10, y + 16, 6, 3, tint).setOrigin(1, 0.5);
    });

    const hpTarget = frac(hp);
    const hpStart = prev ? frac(prev.hp) : hpTarget;
    const fillRect = this.add.rectangle(barX, y + 7, hpStart, 12, fillColor).setOrigin(0, 0.5);
    if (prev && hpStart !== hpTarget) {
      this.tweens.add({ targets: fillRect, width: hpTarget, duration: 400, ease: 'Cubic.Out' });
    }

    const shieldTarget = frac(shield);
    const shieldStart = prev ? frac(prev.shield) : shieldTarget;
    const shieldVisible = shield > 0 || (prev?.shield ?? 0) > 0;
    const shieldRect = this.add.rectangle(barX, y + 1, shieldStart, 4, 0x5fa8d3).setOrigin(0, 0.5).setVisible(shieldVisible);
    if (prev && shieldStart !== shieldTarget) {
      this.tweens.add({ targets: shieldRect, width: shieldTarget, duration: 400, ease: 'Cubic.Out' });
    }

    const hpText = this.add.text(this.W - 12, y, `${hp}/${max}`, { fontSize: '12px', color: '#e8e0c8', fontFamily: FONT.body, fontStyle: 'bold' }).setOrigin(1, 0);
    // Shield as a floating number in the strip's blue — no emoji (tofu in canvas fonts).
    const shieldText = shield > 0 ? this.add.text(hpText.x - hpText.width - 6, y, `+${shield}`, { fontSize: '11px', color: '#5fa8d3', fontFamily: FONT.body, fontStyle: 'bold' }).setOrigin(1, 0) : undefined;

    return {
      fillRect,
      shieldRect,
      shakeTargets: [nameText, fillRect, hpText, ...(shieldText ? [shieldText] : [])],
      floatX: barX + barW / 2,
      floatY: y + 7,
    };
  }

  /** Integer-channel lerp between two 0xRRGGBB colors; `pct` is 0–100 toward `b`. */
  private blendColor(a: number, b: number, pct: number): number {
    const ch = (av: number, bv: number): number => Math.round(av + ((bv - av) * pct) / 100);
    return (ch((a >> 16) & 255, (b >> 16) & 255) << 16)
      | (ch((a >> 8) & 255, (b >> 8) & 255) << 8)
      | ch(a & 255, b & 255);
  }

  /** Floating "-N"/"+N" text over an HP bar — tweens up + fades, then destroys. */
  private spawnFloat(x: number, y: number, text: string, color: string, big = false): void {
    const t = this.add
      .text(x + (Math.random() * 24 - 12), y - 4, text, {
        fontSize: big ? '18px' : '14px',
        color,
        fontFamily: FONT.body,
        fontStyle: 'bold',
      })
      .setOrigin(0.5)
      .setDepth(30);
    this.tweens.add({
      targets: t,
      y: t.y - 28,
      alpha: 0,
      duration: 700,
      ease: 'Cubic.Out',
      onComplete: () => t.destroy(),
    });
  }

  /** Small ±3px x-offset shake on the struck side's HP bar row. */
  private shakeBar(targets: Array<Phaser.GameObjects.Text | Phaser.GameObjects.Rectangle>): void {
    if (targets.length === 0) return;
    const origins = targets.map((t) => ({ t, x: t.x }));
    for (const o of origins) o.t.x = o.x - 3;
    this.tweens.add({
      targets,
      x: '+=3',
      duration: 33,
      ease: 'Sine.InOut',
      yoyo: true,
      repeat: 2,
      onComplete: () => { for (const o of origins) o.t.setPosition(o.x, o.t.y); },
    });
  }

  /**
   * Scale-pulse (1.0 → 1.04 → 1.0) the CardToken at `slot` in `col`. Replicates
   * BoardColumn's own row-consumption loop (a size-N piece occupies N rows but
   * renders exactly one token) to find that piece's token without BoardColumn
   * needing to expose one — battle scene stays a pure playback head over data
   * it already owns (`pieces`), not a peek into BoardColumn internals.
   */
  private pulseTokenAt(col: BoardColumn, pieces: ColumnPiece[], slot: number, slotCount = 10): void {
    const bySlot = new Map<number, ColumnPiece>();
    for (const p of pieces) bySlot.set(p.slot, p);
    let row = 0; let tokenIdx = 0;
    while (row < slotCount) {
      const piece = bySlot.get(row);
      const span = piece ? Math.max(1, piece.skill.size) : 1;
      if (piece && row === slot) {
        const token = col.tokens[tokenIdx];
        if (token) {
          token.setScale(1);
          this.tweens.add({ targets: token, scale: 1.04, duration: 125, yoyo: true, ease: 'Sine.InOut' });
        }
        return;
      }
      tokenIdx += 1;
      row += span;
    }
  }
}
