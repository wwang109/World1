import Phaser from 'phaser';
import { simulate, type CombatResult } from '../../engine/combat/simulate';
import type { CombatEvent, ComparisonSide } from '../../engine/combat/events';
import type { Side } from '../../engine/types';
import { fullBook as skillBook } from '../../data/library';
import { enemies } from '../../data/enemies';
import { BASE_HERO_STATS, HERO_BOARD_SLOTS } from '../../data/heroes';
import { demoState } from '../demoState';
import { CardView, SLOT_W } from '../ui/CardView';
import { UI, PROPERTY_COLOR, ELEMENT_ICON, WEAPON_ICON } from '../theme';

interface SideView {
  name: string;
  maxHp: number;
  hp: number;
  shield: number;
  hpBar: Phaser.GameObjects.Rectangle;
  shieldBar: Phaser.GameObjects.Rectangle;
  hpText: Phaser.GameObjects.Text;
  statusText: Phaser.GameObjects.Text;
  scoreText: Phaser.GameObjects.Text;
  statuses: { status: string; turns: number }[];
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
  cleansed: 250,
  purged: 250,
  quickenedNext: 250,
  performSkipped: 400,
  suddenDeathStart: 900,
  fatigueStart: 900,
  died: 600,
  combatEnd: 400,
  performStart: 60,
  noPerformer: 350,
};

export class BattleScene extends Phaser.Scene {
  private result!: CombatResult;
  private views!: Record<Side, SideView>;
  private eventIdx = 0;
  private speedFactor = 1;
  private skipping = false;
  private finished = false;
  private turnText!: Phaser.GameObjects.Text;
  private bannerText!: Phaser.GameObjects.Text;
  private logLines: string[] = [];
  private logText!: Phaser.GameObjects.Text;

  constructor() {
    super('Battle');
  }

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

    this.turnText = this.add
      .text(640, 300, '', { fontSize: '15px', color: UI.textDim, fontFamily: 'monospace' })
      .setOrigin(0.5);
    this.bannerText = this.add
      .text(640, 336, 'battle begins…', { fontSize: '18px', color: UI.text, fontFamily: 'monospace', align: 'center' })
      .setOrigin(0.5);
    this.add.text(24, 96, 'COMBAT LOG', { fontSize: '12px', color: UI.text, fontFamily: 'monospace', fontStyle: 'bold' });
    this.add.rectangle(24, 112, 330, 560, 0x14141c).setOrigin(0, 0).setStrokeStyle(1, 0x2a2a36);
    this.logText = this.add.text(32, 120, '', {
      fontSize: '11px',
      color: UI.textDim,
      fontFamily: 'monospace',
      lineSpacing: 3,
    });

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
    this.add.text(640 - BAR_W / 2, barY - 24, name, { fontSize: '15px', color: UI.text, fontFamily: 'monospace', fontStyle: 'bold' });
    this.add.rectangle(640, barY, BAR_W, 18, UI.hpBack);
    const hpBar = this.add.rectangle(640 - BAR_W / 2, barY, BAR_W, 18, side === 'player' ? UI.hp : 0xc05050).setOrigin(0, 0.5);
    const shieldBar = this.add.rectangle(640 - BAR_W / 2, barY - 14, 0, 6, 0xbbbbdd).setOrigin(0, 0.5);
    const hpText = this.add
      .text(640 + BAR_W / 2 + 12, barY, `${maxHp}/${maxHp}`, { fontSize: '13px', color: UI.text, fontFamily: 'monospace' })
      .setOrigin(0, 0.5);
    const statusText = this.add
      .text(640 - BAR_W / 2, barY + 18, '', { fontSize: '12px', color: UI.textDim, fontFamily: 'monospace' })
      .setOrigin(0, 0.5);
    const scoreText = this.add
      .text(640 + BAR_W / 2 + 12, barY + 18, '', { fontSize: '12px', color: '#ffd76a', fontFamily: 'monospace' })
      .setOrigin(0, 0.5);

    const cards = new Map<number, CardView>();
    const boardX = (1280 - boardSize * SLOT_W * 0.9) / 2;
    for (let s = 0; s < boardSize; s++) {
      this.add.rectangle(boardX + s * SLOT_W * 0.9 + (SLOT_W * 0.9) / 2, boardY, SLOT_W * 0.9 - 4, 96 * 0.9 + 6, UI.slot).setStrokeStyle(1, 0x3a3a46);
    }
    for (const piece of pieces) {
      const skill = skillBook[piece.skillId];
      if (!skill) continue;
      const x = boardX + piece.slot * SLOT_W * 0.9 + (skill.size * SLOT_W * 0.9) / 2;
      const card = new CardView(this, x, boardY, skill, { mini: false });
      card.setScale(0.9);
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
    this.time.delayedCall(delay / this.speedFactor, () => {
      if (this.eventIdx >= this.result.events.length) return;
      const event = this.result.events[this.eventIdx++]!;
      this.applyEvent(event, false);
      this.scheduleNext(DELAYS[event.kind] ?? 250);
    });
  }

  private log(line: string): void {
    this.logLines.push(line);
    if (this.logLines.length > 36) this.logLines.shift();
    this.logText.setText(this.logLines.join('\n'));
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
        this.turnText.setText(`— turn ${e.turn} —`);
        const who = e.performer === 'player' ? '▶ HERO performs' : e.performer === 'enemy' ? '▶ ENEMY performs' : '▶ nobody can act';
        this.bannerText.setText(`${this.fmtSide(e.player, 'YOU')}\n${this.fmtSide(e.enemy, 'FOE')}\n${who}`);
        this.views.player.scoreText.setText(e.player.state === 'ready' ? `score ${e.player.score}` : e.player.state);
        this.views.enemy.scoreText.setText(e.enemy.state === 'ready' ? `score ${e.enemy.score}` : e.enemy.state);
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
          this.tweens.add({ targets: card, scale: 1.02, duration: 140, yoyo: true, onComplete: () => card.setHighlight(false) });
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
        this.log(`  ${e.side === 'player' ? 'YOU' : 'FOE'} −${dealt}${e.blocked ? ` (${e.blocked} blocked)` : ''}${e.crit ? ' CRIT' : ''}${label}${match}`);
        if (!instant) {
          this.floatText(view, `−${dealt}${e.crit ? '!' : ''}${e.matchup === 'advantage' ? ' ▲' : e.matchup === 'disadvantage' ? ' ▼' : ''}`, PROPERTY_COLOR[e.property]);
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
      case 'statusApplied':
        if (!view) break;
        view.statuses.push({ status: e.status, turns: e.turns });
        this.refreshStatuses(e.side as Side);
        this.log(`  ${e.side === 'player' ? 'YOU' : 'FOE'} gains ${e.status} (${e.turns}t)`);
        break;
      case 'statusExpired': {
        if (!view) break;
        const idx = view.statuses.findIndex((s) => s.status === e.status);
        if (idx >= 0) view.statuses.splice(idx, 1);
        this.refreshStatuses(e.side as Side);
        break;
      }
      case 'cleansed':
        if (!view) break;
        view.statuses = view.statuses.filter((s) => s.status === 'buff' || s.status === 'thorns' || s.status === 'regen');
        this.refreshStatuses(e.side as Side);
        this.log(`  ${e.side === 'player' ? 'YOU' : 'FOE'} cleansed ${e.removed}`);
        break;
      case 'purged':
        if (!view) break;
        view.statuses = view.statuses.filter((s) => s.status !== 'buff' && s.status !== 'thorns' && s.status !== 'regen');
        this.refreshStatuses(e.side as Side);
        this.log(`  ${e.side === 'player' ? 'YOUR' : "FOE's"} buffs purged (${e.removed})`);
        break;
      case 'performSkipped':
        this.log(`  ${e.side === 'player' ? 'YOU' : 'FOE'} stunned — performance lost`);
        break;
      case 'slowedNext':
        this.log(`  ${e.side === 'player' ? 'YOUR' : "FOE's"} next action +${e.weight} weight (slowed)`);
        break;
      case 'quickenedNext':
        this.log(`  ${e.side === 'player' ? 'YOUR' : "FOE's"} next action −${e.weight} weight (quickened)`);
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
          if (s.status !== 'stun') s.turns = Math.max(0, s.turns - (e.turn > 1 ? 1 : 0));
        }
        this.refreshStatuses(side);
      }
    }
  }

  private refreshBars(side: Side): void {
    const v = this.views[side];
    v.hpBar.width = Math.max(0, (v.hp / v.maxHp) * BAR_W);
    v.shieldBar.width = Math.max(0, Math.min(1, v.shield / v.maxHp) * BAR_W);
    v.hpText.setText(`${v.hp}/${v.maxHp}${v.shield > 0 ? ` +${v.shield}🛡` : ''}`);
  }

  private refreshStatuses(side: Side): void {
    const v = this.views[side];
    const icons: Record<string, string> = { poison: '☠', burn: '🔥', stun: '💫', buff: '▲', debuff: '▼', thorns: '🌵', regen: '💚' };
    v.statusText.setText(v.statuses.map((s) => `${icons[s.status] ?? s.status}${s.turns > 0 ? s.turns : ''}`).join(' '));
  }

  private floatText(view: SideView, text: string, color: number): void {
    const t = this.add
      .text(640 + (Math.random() * 120 - 60), view.barY + 8, text, {
        fontSize: '20px',
        color: `#${color.toString(16).padStart(6, '0')}`,
        fontFamily: 'monospace',
        fontStyle: 'bold',
      })
      .setOrigin(0.5)
      .setDepth(15);
    this.tweens.add({ targets: t, y: view.barY - 34, alpha: 0, duration: 900, onComplete: () => t.destroy() });
  }

  private banner(text: string, color: string): void {
    const b = this.add
      .text(640, 372, text, { fontSize: '20px', color, fontFamily: 'monospace', fontStyle: 'bold', align: 'center' })
      .setOrigin(0.5)
      .setDepth(15);
    if (!this.finished) this.tweens.add({ targets: b, alpha: 0, delay: 2200, duration: 600, onComplete: () => b.destroy() });
  }

  // ---------- controls ----------

  private buildControls(): void {
    let x = 1060;
    for (const factor of [1, 2, 4]) {
      const btn = this.add
        .text(x, 688, `×${factor}`, {
          fontSize: '14px',
          color: this.speedFactor === factor ? '#ffd76a' : UI.textDim,
          backgroundColor: '#24242e',
          padding: { x: 8, y: 5 },
          fontFamily: 'monospace',
        })
        .setInteractive({ useHandCursor: true });
      btn.on('pointerdown', () => {
        this.speedFactor = factor;
        this.scene.restart();
        this.skipping = false;
      });
      x += 46;
    }
    const skip = this.add
      .text(x + 8, 688, '⏭ skip', {
        fontSize: '14px',
        color: UI.textDim,
        backgroundColor: '#24242e',
        padding: { x: 8, y: 5 },
        fontFamily: 'monospace',
      })
      .setInteractive({ useHandCursor: true });
    skip.on('pointerdown', () => {
      this.skipping = true;
      while (this.eventIdx < this.result.events.length) this.applyEvent(this.result.events[this.eventIdx++]!, true);
    });
  }

  private showEndButtons(): void {
    const mk = (x: number, label: string, cb: () => void) => {
      const btn = this.add
        .text(x, 420, label, {
          fontSize: '16px',
          color: '#ffffff',
          backgroundColor: '#2a4a6a',
          padding: { x: 12, y: 8 },
          fontFamily: 'monospace',
        })
        .setOrigin(0.5)
        .setDepth(16)
        .setInteractive({ useHandCursor: true });
      btn.on('pointerdown', cb);
      return btn;
    };
    mk(500, '↩ back to prep', () => this.scene.start('Prep'));
    mk(660, '↻ replay', () => this.scene.restart());
    mk(790, '🎲 new seed', () => {
      demoState.seed = Math.floor(Math.random() * 1_000_000);
      this.scene.restart();
    });
  }
}
