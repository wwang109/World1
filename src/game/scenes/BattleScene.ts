import { Sprite, Text, Texture } from 'pixi.js';
import { simulate, type CombatResult } from '../../engine/combat/simulate';
import type { CombatEvent, ComparisonSide } from '../../engine/combat/events';
import type { Side, Property } from '../../engine/types';
import { skillBook } from '../../data/skills';
import { enemies } from '../../data/enemies';
import { BASE_HERO_STATS, HERO_BOARD_SLOTS } from '../../data/heroes';
import { demoState } from '../demoState';
import { CardView, SLOT_W } from '../ui/CardView';
import { UI, PROPERTY_COLOR, ELEMENT_ICON, WEAPON_ICON, STATUS_ICON } from '../theme';
import { Scene } from '../pixi/Scene';
import { makeText, makeRect, TextButton } from '../pixi/ui';

interface SideView {
  name: string;
  maxHp: number;
  hp: number;
  shield: number;
  hpBar: Sprite;
  shieldBar: Sprite;
  hpText: Text;
  statusText: Text;
  scoreText: Text;
  statuses: { status: string; turns: number; property?: Property; charges?: number }[];
  cards: Map<number, CardView>;
  barY: number;
  boardY: number;
}

const BAR_W = 420;
const DELAYS: Record<string, number> = {
  comparison: 850,
  skillCast: 500,
  damage: 380,
  heal: 350,
  shieldGain: 320,
  statusApplied: 250,
  statusExpired: 160,
  negated: 380,
  cleansed: 250,
  performSkipped: 400,
  suddenDeathStart: 900,
  fatigueStart: 900,
  died: 600,
  combatEnd: 400,
  performStart: 60,
  noPerformer: 350,
};

// Survives scene restarts (each restart builds a fresh BattleScene instance).
let battleSpeed = 1;

/** Solid bar whose width can be set directly (white texture, tinted). */
function makeBar(color: number, w: number, h: number): Sprite {
  const bar = new Sprite(Texture.WHITE);
  bar.tint = color;
  bar.anchor.set(0, 0.5);
  bar.width = w;
  bar.height = h;
  return bar;
}

export class BattleScene extends Scene {
  private result!: CombatResult;
  private views!: Record<Side, SideView>;
  private eventIdx = 0;
  private speedFactor = battleSpeed;
  private skipping = false;
  private finished = false;
  private turnText!: Text;
  private bannerText!: Text;
  private logLines: string[] = [];
  private logText!: Text;

  create(): void {
    this.eventIdx = 0;
    this.skipping = false;
    this.finished = false;
    this.logLines = [];

    const enemyDef = enemies[demoState.enemyId]!;
    this.result = simulate(
      {
        player: {
          name: 'Hero',
          stats: { ...BASE_HERO_STATS },
          boardSize: HERO_BOARD_SLOTS,
          pieces: demoState.pieces.map((p) => ({ ...p })),
        },
        enemy: {
          name: enemyDef.name,
          stats: { ...enemyDef.stats },
          boardSize: enemyDef.boardSize,
          pieces: enemyDef.pieces.map((p) => ({ ...p })),
          elementAffinity: enemyDef.elementAffinity,
          weaponAffinity: enemyDef.weaponAffinity,
        },
        skillBook,
      },
      demoState.seed,
    );

    this.views = {
      enemy: this.buildSideView(enemyDef.name, enemyDef.stats.maxHp, 'enemy', 54, 150, enemyDef.pieces, enemyDef.boardSize),
      player: this.buildSideView('Hero', BASE_HERO_STATS.maxHp, 'player', 640, 520, demoState.pieces, HERO_BOARD_SLOTS),
    };

    this.turnText = makeText('', { size: 15, color: UI.textDim });
    this.turnText.anchor.set(0.5);
    this.turnText.position.set(640, 300);
    this.addChild(this.turnText);

    this.bannerText = makeText('battle begins…', { size: 18, align: 'center' });
    this.bannerText.anchor.set(0.5);
    this.bannerText.position.set(640, 336);
    this.addChild(this.bannerText);

    const logTitle = makeText('COMBAT LOG', { size: 12, bold: true });
    logTitle.position.set(24, 96);
    this.addChild(logTitle);

    const logPanel = makeRect(330, 560, 0x14141c, {
      stroke: { width: 1, color: 0x2a2a36 },
      originX: 0,
      originY: 0,
    });
    logPanel.position.set(24, 112);
    this.addChild(logPanel);

    this.logText = makeText('', { size: 11, color: UI.textDim, lineSpacing: 3 });
    this.logText.position.set(32, 120);
    this.addChild(this.logText);

    this.buildControls();
    this.scheduleNext(400);
  }

  private buildSideView(
    name: string,
    maxHp: number,
    side: Side,
    barY: number,
    boardY: number,
    pieces: { skillId: string; slot: number }[],
    boardSize: number,
  ): SideView {
    const nameText = makeText(name, { size: 15, bold: true });
    nameText.position.set(640 - BAR_W / 2, barY - 24);
    this.addChild(nameText);

    const hpBack = makeRect(BAR_W, 18, UI.hpBack);
    hpBack.position.set(640, barY);
    this.addChild(hpBack);

    const hpBar = makeBar(side === 'player' ? UI.hp : 0xc05050, BAR_W, 18);
    hpBar.position.set(640 - BAR_W / 2, barY);
    this.addChild(hpBar);

    const shieldBar = makeBar(0xbbbbdd, 0, 6);
    shieldBar.position.set(640 - BAR_W / 2, barY - 14);
    this.addChild(shieldBar);

    const hpText = makeText(`${maxHp}/${maxHp}`, { size: 13 });
    hpText.anchor.set(0, 0.5);
    hpText.position.set(640 + BAR_W / 2 + 12, barY);
    this.addChild(hpText);

    const statusText = makeText('', { size: 12, color: UI.textDim });
    statusText.anchor.set(0, 0.5);
    statusText.position.set(640 - BAR_W / 2, barY + 18);
    this.addChild(statusText);

    const scoreText = makeText('', { size: 12, color: '#ffd76a' });
    scoreText.anchor.set(0, 0.5);
    scoreText.position.set(640 + BAR_W / 2 + 12, barY + 18);
    this.addChild(scoreText);

    const cards = new Map<number, CardView>();
    const boardX = (1280 - boardSize * SLOT_W * 0.9) / 2;
    for (let s = 0; s < boardSize; s++) {
      const slot = makeRect(SLOT_W * 0.9 - 4, 96 * 0.9 + 6, UI.slot, { stroke: { width: 1, color: 0x3a3a46 } });
      slot.position.set(boardX + s * SLOT_W * 0.9 + (SLOT_W * 0.9) / 2, boardY);
      this.addChild(slot);
    }
    for (const piece of pieces) {
      const skill = skillBook[piece.skillId];
      if (!skill) continue;
      const x = boardX + piece.slot * SLOT_W * 0.9 + (skill.size * SLOT_W * 0.9) / 2;
      const card = new CardView(skill);
      card.scale.set(0.9);
      card.position.set(x, boardY);
      this.addChild(card);
      cards.set(piece.slot, card);
    }
    return { name, maxHp, hp: maxHp, shield: 0, hpBar, shieldBar, hpText, statusText, scoreText, statuses: [], cards, barY, boardY };
  }

  // ---------- playback ----------

  private scheduleNext(delay: number): void {
    if (this.skipping) {
      while (this.eventIdx < this.result.events.length) this.applyEvent(this.result.events[this.eventIdx++]!, true);
      return;
    }
    this.delay(delay / this.speedFactor, () => {
      if (this.eventIdx >= this.result.events.length) return;
      const event = this.result.events[this.eventIdx++]!;
      this.applyEvent(event, false);
      this.scheduleNext(DELAYS[event.kind] ?? 250);
    });
  }

  private log(line: string): void {
    this.logLines.push(line);
    if (this.logLines.length > 36) this.logLines.shift();
    this.logText.text = this.logLines.join('\n');
  }

  private fmtSide(side: ComparisonSide, label: string): string {
    if (side.state === 'busy') return `${label}: BUSY (finishing cast)`;
    if (side.state === 'nothingUsable') return `${label}: nothing to cast`;
    const name = side.queuedSkillId ? skillBook[side.queuedSkillId]?.name ?? side.queuedSkillId : '?';
    return `${label}: ${side.bank}+${side.speed}−${side.weight} = ${side.score}  (${name})`;
  }

  private applyEvent(e: CombatEvent, instant: boolean): void {
    const view = 'side' in e ? this.views[e.side as Side] : null;
    switch (e.kind) {
      case 'comparison': {
        this.turnText.text = `— turn ${e.turn} —`;
        const who = e.performer === 'player' ? '▶ HERO performs' : e.performer === 'enemy' ? '▶ ENEMY performs' : '▶ nobody can act';
        this.bannerText.text = `${this.fmtSide(e.player, 'YOU')}\n${this.fmtSide(e.enemy, 'FOE')}\n${who}`;
        this.views.player.scoreText.text = e.player.state === 'ready' ? `score ${e.player.score}` : e.player.state;
        this.views.enemy.scoreText.text = e.enemy.state === 'ready' ? `score ${e.enemy.score}` : e.enemy.state;
        this.log(`── turn ${e.turn} ──`);
        break;
      }
      case 'skillCast': {
        const skill = skillBook[e.skillId];
        const kindIcon = skill?.element ? ` ${ELEMENT_ICON[skill.element]}` : skill?.weapon ? ` ${WEAPON_ICON[skill.weapon]}` : '';
        this.log(`  ${e.side === 'player' ? 'YOU' : 'FOE'} cast ${skill?.name ?? e.skillId}${kindIcon}${e.span > 1 ? ` (spans ${e.span})` : ''}`);
        const card = this.views[e.side].cards.get(e.slot);
        if (card && !instant) {
          card.setHighlight(true, 0xffe27a);
          this.tweens.add({ target: card, to: { scale: 1.02 }, duration: 140, yoyo: true, onComplete: () => card.setHighlight(false) });
        }
        break;
      }
      case 'damage': {
        if (!view) break;
        view.hp = e.hpAfter;
        if (e.blocked > 0) view.shield = Math.max(0, view.shield - e.blocked);
        this.refreshBars(e.side as Side);
        const dealt = e.amount - e.blocked;
        const label = e.source === 'skill' ? '' : ` ${e.source}`;
        const match = e.matchup === 'advantage' ? ' ▲ super effective!' : e.matchup === 'disadvantage' ? ' ▼ resisted' : '';
        const guardedNote = e.guarded ? ` (${e.guarded} guarded)` : '';
        this.log(`  ${e.side === 'player' ? 'YOU' : 'FOE'} −${dealt}${e.blocked ? ` (${e.blocked} blocked)` : ''}${guardedNote}${e.crit ? ' CRIT' : ''}${label}${match}`);
        if (!instant) {
          this.floatText(
            view,
            `−${dealt}${e.crit ? '!' : ''}${e.matchup === 'advantage' ? ' ▲' : e.matchup === 'disadvantage' ? ' ▼' : ''}${e.guarded ? ` ${STATUS_ICON.guard}${e.guarded}` : ''}`,
            PROPERTY_COLOR[e.property],
          );
        }
        break;
      }
      case 'heal': {
        if (!view) break;
        view.hp = e.hpAfter;
        this.refreshBars(e.side as Side);
        this.log(`  ${e.side === 'player' ? 'YOU' : 'FOE'} +${e.amount} hp${e.flat ? ' (flat)' : ''}`);
        if (!instant) this.floatText(view, `+${e.amount}`, 0x4caf6e);
        break;
      }
      case 'shieldGain': {
        if (!view) break;
        view.shield = e.totalAfter;
        this.refreshBars(e.side as Side);
        this.log(`  ${e.side === 'player' ? 'YOU' : 'FOE'} +${e.amount} ${e.property} shield${e.wasted ? ` (${e.wasted} wasted, cap)` : ''}`);
        if (!instant) this.floatText(view, `+${e.amount}🛡`, 0xbbbbdd);
        break;
      }
      case 'statusApplied': {
        if (!view) break;
        if (e.status === 'negate') {
          // The engine now reports the exact (clamped) charge count on the
          // event itself; use it directly rather than tallying grants. Each
          // 'negated' event still decrements it, removing the indicator at 0.
          const negateCharges = e.charges ?? 1;
          const existing = view.statuses.find((s) => s.status === 'negate' && s.property === e.property);
          if (existing) existing.charges = negateCharges;
          else view.statuses.push({ status: 'negate', turns: 0, property: e.property, charges: negateCharges });
        } else {
          view.statuses.push({ status: e.status, turns: e.turns, property: e.property });
        }
        this.refreshStatuses(e.side as Side);
        const turnsLabel = e.status === 'negate' ? '' : ` (${e.turns}t)`;
        this.log(`  ${e.side === 'player' ? 'YOU' : 'FOE'} gains ${e.status}${turnsLabel}`);
        break;
      }
      case 'statusExpired': {
        if (!view) break;
        const idx = view.statuses.findIndex((s) => s.status === e.status);
        if (idx >= 0) view.statuses.splice(idx, 1);
        this.refreshStatuses(e.side as Side);
        break;
      }
      case 'negated': {
        if (!view) break;
        const entry = view.statuses.find((s) => s.status === 'negate' && s.property === e.property);
        if (entry) {
          entry.charges = Math.max(0, (entry.charges ?? 1) - 1);
          if (entry.charges <= 0) {
            const idx = view.statuses.indexOf(entry);
            if (idx >= 0) view.statuses.splice(idx, 1);
          }
        }
        this.refreshStatuses(e.side as Side);
        const victimLabel = e.side === 'player' ? 'YOU' : 'FOE';
        const attackerLabel = e.side === 'player' ? "FOE's" : 'YOUR';
        const verb = e.side === 'player' ? 'negate' : 'negates';
        this.log(`  ${victimLabel} ${verb} ${attackerLabel} ${e.property} attack`);
        if (!instant) this.floatText(view, 'NEGATED', 0x8fd6ff);
        break;
      }
      case 'cleansed':
        if (!view) break;
        view.statuses = view.statuses.filter((s) => s.status === 'buff');
        this.refreshStatuses(e.side as Side);
        this.log(`  ${e.side === 'player' ? 'YOU' : 'FOE'} cleansed ${e.removed}`);
        break;
      case 'performSkipped':
        this.log(`  ${e.side === 'player' ? 'YOU' : 'FOE'} stunned — performance lost`);
        break;
      case 'slowedNext':
        this.log(`  ${e.side === 'player' ? 'YOUR' : "FOE's"} next action +${e.weight} weight (slowed)`);
        break;
      case 'staggered':
        this.log(`  ${e.side === 'player' ? 'YOU' : 'FOE'} staggered — bank −${e.amount} → ${e.bankAfter}`);
        break;
      case 'shieldBroken': {
        if (!view) break;
        view.shield = e.totalAfter;
        this.refreshBars(e.side as Side);
        this.log(`  ${e.side === 'player' ? 'YOUR' : "FOE's"} shield shattered −${e.amount}`);
        if (!instant) this.floatText(view, `🛡−${e.amount}`, 0xcc8844);
        break;
      }
      case 'suddenDeathStart':
        this.log(`⚡ SUDDEN DEATH — damage ramps`);
        if (!instant) this.banner('⚡ SUDDEN DEATH — damage ramps: +10% you / +30% enemy per turn', '#ffd76a');
        break;
      case 'fatigueStart':
        this.log(`⚡ fatigue backstop`);
        break;
      case 'died':
        this.log(`☠ ${e.side === 'player' ? 'YOU' : 'FOE'} died`);
        break;
      case 'combatEnd': {
        this.finished = true;
        const msg = e.result === 'win' ? '🏆 VICTORY' : e.result === 'loss' ? '💀 DEFEAT' : 'DRAW';
        this.banner(`${msg} — ${e.turns} turns`, e.result === 'win' ? '#7be07b' : '#e07b7b');
        this.showEndButtons();
        break;
      }
      default:
        break;
    }

    // Countdown the visible status timers on each comparison (new global turn).
    if (e.kind === 'comparison') {
      for (const side of ['player', 'enemy'] as Side[]) {
        for (const s of this.views[side].statuses) {
          // Negate is charge-based, not turn-based — see StatusInstance.turnsLeft in the engine.
          if (s.status !== 'stun' && s.status !== 'negate') s.turns = Math.max(0, s.turns - (e.turn > 1 ? 1 : 0));
        }
        this.refreshStatuses(side);
      }
    }
  }

  private refreshBars(side: Side): void {
    const v = this.views[side];
    v.hpBar.width = Math.max(0, (v.hp / v.maxHp) * BAR_W);
    v.shieldBar.width = Math.max(0, Math.min(1, v.shield / v.maxHp) * BAR_W);
    v.hpText.text = `${v.hp}/${v.maxHp}${v.shield > 0 ? ` +${v.shield}🛡` : ''}`;
  }

  private refreshStatuses(side: Side): void {
    const v = this.views[side];
    v.statusText.text = v.statuses
      .map((s) => {
        const icon = STATUS_ICON[s.status] ?? s.status;
        if (s.status === 'negate') return `${icon}×${s.charges ?? 0}`;
        return `${icon}${s.turns > 0 ? s.turns : ''}`;
      })
      .join(' ');
  }

  private floatText(view: SideView, text: string, color: number): void {
    const t = makeText(text, { size: 20, color: `#${color.toString(16).padStart(6, '0')}`, bold: true });
    t.anchor.set(0.5);
    t.position.set(640 + (Math.random() * 120 - 60), view.barY + 8);
    t.zIndex = 15;
    this.addChild(t);
    this.tweens.add({ target: t, to: { y: view.barY - 34, alpha: 0 }, duration: 900, onComplete: () => t.destroy() });
  }

  private banner(text: string, color: string): void {
    const b = makeText(text, { size: 20, color, bold: true, align: 'center' });
    b.anchor.set(0.5);
    b.position.set(640, 372);
    b.zIndex = 15;
    this.addChild(b);
    if (!this.finished) this.tweens.add({ target: b, to: { alpha: 0 }, delay: 2200, duration: 600, onComplete: () => b.destroy() });
  }

  // ---------- controls ----------

  private buildControls(): void {
    let x = 1060;
    for (const factor of [1, 2, 4]) {
      const btn = new TextButton(`×${factor}`, {
        size: 14,
        color: this.speedFactor === factor ? '#ffd76a' : UI.textDim,
        bg: 0x24242e,
      });
      btn.position.set(x, 688);
      this.addChild(btn);
      btn.on('pointerdown', () => {
        battleSpeed = factor;
        this.mgr.restart();
      });
      x += 46;
    }
    const skip = new TextButton('⏭ skip', { size: 14, color: UI.textDim, bg: 0x24242e });
    skip.position.set(x + 8, 688);
    this.addChild(skip);
    skip.on('pointerdown', () => {
      this.skipping = true;
      while (this.eventIdx < this.result.events.length) this.applyEvent(this.result.events[this.eventIdx++]!, true);
    });
  }

  private showEndButtons(): void {
    const mk = (x: number, label: string, cb: () => void) => {
      const btn = new TextButton(label, { size: 16, color: '#ffffff', bg: 0x2a4a6a, padX: 12, padY: 8 }).center();
      btn.position.set(x, 420);
      btn.zIndex = 16;
      this.addChild(btn);
      btn.on('pointerdown', cb);
      return btn;
    };
    mk(500, '↩ back to prep', () => this.mgr.start('Prep'));
    mk(660, '↻ replay', () => this.mgr.restart());
    mk(790, '🎲 new seed', () => {
      demoState.seed = Math.floor(Math.random() * 1_000_000);
      this.mgr.restart();
    });
  }
}
