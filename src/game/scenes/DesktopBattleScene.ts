import Phaser from 'phaser';
import type { SkillDef } from '../../engine/types';
import { demoState } from '../demoState';
import {
  buildBattleTimeline,
  type BattleTimelineInput,
  type CombatSummary, type FoeModel, type HpSnap, type LogLine, type PlaybackStep, type ShieldSnap, type SpeedSnap, type TurnFx,
} from '../battleTimeline';
import { fetchBattleLog } from '../battleApi';
import type { BattleLog } from '../../run/resolveBattle';
import { DESKTOP_PROFILE } from '../layoutProfile';
import { FONT, SCREEN, UI } from '../theme';
import { renderDesktopBackground } from '../ui/DesktopNav';
import { BoardColumn, type ColumnPiece } from '../ui/BoardColumn';
import type { ScalingStats } from '../ui/skillPresentation';

const F = DESKTOP_PROFILE.font;

/** Everything a rendered HP bar hands back so FX can target it after the fact. */
interface HpBarHandles {
  fillRect: Phaser.GameObjects.Rectangle;
  shieldRect: Phaser.GameObjects.Rectangle;
  shakeTargets: Array<Phaser.GameObjects.Text | Phaser.GameObjects.Rectangle>;
  floatX: number;
  floatY: number;
}

const TAG_COLOR: Record<string, string> = {
  START: '#e8b446', PLAY: '#4f9e57', HIT: '#d05c4e', BUFF: '#5fb56a',
  DEBUFF: '#a678d8', WAIT: '#c9a15a', DOWN: '#d05c4e', RESULT: '#e8b446',
};
/** Ailment identity colors — used to tint the afflicted side's HP bar and its DoT tick numbers. */
const AILMENT_COLOR: Record<string, string> = { poison: '#8fbe5a', burn: '#e07a3a', bleed: '#d05c4e', stun: '#c9a15a', expose: '#a678d8' };
const AILMENT_TINT: Record<string, number> = { poison: 0x8fbe5a, burn: 0xe07a3a, bleed: 0xd05c4e, stun: 0xc9a15a, expose: 0xa678d8 };

/** Shared landscape geometry — computed once from the desktop canvas so the
 * board/log/footer regions never overlap and nothing draws past y=876. */
const GUTTER = 32;
const GAP = 12;
const TOP_MARGIN = 24;
const FOOTER_H = 44;
const FOOTER_BOTTOM = 24;
const SCRUBBER_H = 28;
const PANEL_W = 380;
const HP_BLOCK_H = 76;

/**
 * Desktop Battle — landscape: player board panel LEFT · enemy board panel
 * RIGHT · wide combat LOG in the CENTER column (tap a HIT to expand its D:
 * math) · HP bars atop each side panel · a horizontal event-level scrubber +
 * playback controls along the bottom. A dumb playback head over the shared
 * `buildBattleTimeline` model (same transform MobileBattleScene uses) — no
 * combat recomputation here.
 */
export class DesktopBattleScene extends Phaser.Scene {
  private W = SCREEN.width;
  private H = SCREEN.height;
  private linesByTurn = new Map<number, LogLine[]>();
  private hpByTurn = new Map<number, HpSnap>();
  private shieldByTurn = new Map<number, ShieldSnap>();
  private statusByTurn = new Map<number, { player: string[]; enemy: string[]; enemyUnits?: string[][] }>();
  private speedByTurn = new Map<number, SpeedSnap>();
  private playSlotByTurn = new Map<number, { player?: number; enemy?: number; enemyUnits?: Array<number | undefined> }>();
  private turns: number[] = [];
  private steps: PlaybackStep[] = [];
  private hpByStep: HpSnap[] = [];
  private shieldByStep: ShieldSnap[] = [];
  private fxByStep: TurnFx[][] = [];
  private focusFoeByStep: Array<number | undefined> = [];
  private idx = 0;
  private lastIdx = -1;
  /** Which foe the tabbed enemy panel (3+ foes) is showing. */
  private focusedFoe = 0;
  /** Auto-switch the focused tab to the foe involved in the current event;
   *  clicking a tab pins it (turns this off) until AUTO is tapped again. */
  private autoFollow = true;
  private lastFocusedFoe = -1;
  private expanded = new Set<string>();
  private heroPieces: ColumnPiece[] = [];
  private heroSkills: SkillDef[] = [];
  private foes: FoeModel[] = [];
  private heroName = 'Hero';
  private heroStats: ScalingStats = { attack: 0, magicPower: 0 };
  private heroStatLine = '';
  private outcome = '';
  private combatSummary: CombatSummary = { playerDamage: 0, enemyDamage: 0, playerHealing: 0, cards: [] };
  private outcomeStep = -1;
  private playing = true;
  private playTimer?: Phaser.Time.TimerEvent;
  /** Playback speed multiplier (0.5 = half speed). Deliberately NOT reset in
   *  init() — the player's speed choice should survive REPLAY and re-entry. */
  private speedMult = 1;

  constructor() { super('DesktopBattle'); }

  /** Phaser reuses scene instances across restarts (PREP → FIGHT → PREP →
   * FIGHT never re-runs the constructor) — reset every mutable field here so
   * a second fight never carries stale maps/timers/expanded-state. */
  init(): void {
    this.W = SCREEN.width; this.H = SCREEN.height;
    this.linesByTurn = new Map();
    this.hpByTurn = new Map();
    this.shieldByTurn = new Map();
    this.statusByTurn = new Map();
    this.speedByTurn = new Map();
    this.playSlotByTurn = new Map();
    this.turns = [];
    this.steps = [];
    this.hpByStep = [];
    this.shieldByStep = [];
    this.fxByStep = [];
    this.focusFoeByStep = [];
    this.idx = 0;
    this.lastIdx = -1;
    this.focusedFoe = 0;
    this.autoFollow = true;
    this.lastFocusedFoe = -1;
    this.expanded = new Set();
    this.heroPieces = [];
    this.heroSkills = [];
    this.foes = [];
    this.heroName = 'Hero';
    this.heroStats = { attack: 0, magicPower: 0 };
    this.heroStatLine = '';
    this.outcome = '';
    this.combatSummary = { playerDamage: 0, enemyDamage: 0, playerHealing: 0, cards: [] };
    this.outcomeStep = -1;
    this.playing = true;
    this.playTimer = undefined;
  }

  create(): void {
    // The battle service owns combat, so the log is a round trip: show a status
    // line, then render once it lands. No local fallback exists by design.
    this.renderStatus('RESOLVING BATTLE…');
    void this.startFight();
  }

  /** Fetches the log, folds it, then starts playback. */
  private async startFight(): Promise<void> {
    const input = this.fightInput();
    try {
      const log = await fetchBattleLog(input);
      if (!this.scene.isActive()) return;
      this.buildFight(input, log);
      this.idx = 0;
      this.render();
      this.startPlayback();
    } catch (err) {
      if (!this.scene.isActive()) return;
      this.renderStatus(`BATTLE SERVICE UNREACHABLE\n${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /** Centered status/error text — the only thing drawn before the log arrives. */
  private renderStatus(message: string): void {
    this.children.removeAll();
    this.add.text(SCREEN.width / 2, SCREEN.height / 2, message, {
      fontSize: '16px', color: '#8a94a6', fontFamily: FONT.body,
      align: 'center', wordWrap: { width: SCREEN.width - 200 }, lineSpacing: 6,
    }).setOrigin(0.5);
  }

  /** The prep info this fight resolves from. */
  private fightInput(): BattleTimelineInput {
    return {
      pieces: demoState.pieces,
      heroLevel: demoState.heroLevel,
      heroAllocation: demoState.heroAllocation,
      enemyId: demoState.enemyId,
      enemyLevel: demoState.enemyLevel,
      enemyTitle: demoState.enemyTitle,
      enemyRank: demoState.enemyRank,
      enemyModifiers: demoState.enemyModifiers,
      enemyTeam: demoState.enemyTeam,
      seed: demoState.seed,
    };
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
    const delay = (line?.tag === 'DOWN' ? 160 : 450) / this.speedMult;
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

  /** Runs the shared `buildBattleTimeline` transform and copies its model
   * into this scene's fields — the scene stays a pure playback head. */
  private buildFight(input: BattleTimelineInput, log: BattleLog): void {
    const model = buildBattleTimeline(input, log);
    this.linesByTurn = model.linesByTurn;
    this.hpByTurn = model.hpByTurn;
    this.shieldByTurn = model.shieldByTurn;
    this.statusByTurn = model.statusByTurn;
    this.speedByTurn = model.speedByTurn;
    this.playSlotByTurn = model.playSlotByTurn;
    this.turns = model.turns;
    this.steps = model.steps;
    this.hpByStep = model.hpByStep;
    this.shieldByStep = model.shieldByStep;
    this.fxByStep = model.fxByStep;
    this.focusFoeByStep = model.focusFoeByStep;
    this.outcome = model.outcome;
    this.outcomeStep = model.outcomeStep;
    this.combatSummary = model.combatSummary;
    this.heroName = model.heroName;
    this.heroStats = model.heroStats;
    this.heroPieces = model.heroPieces;
    this.heroSkills = model.heroSkills;
    this.foes = model.foes;
    this.heroStatLine = model.heroStatLine;
  }

  private render(): void {
    // Kill any in-flight FX tweens before the full redraw so fast scrubbing
    // never leaves an orphaned tween chasing a destroyed object.
    this.tweens.killAll();
    // Destroy (not just remove) the previous frame's objects — removeAll()
    // alone leaks every Text's backing canvas texture across ~30 redraws/fight.
    for (const child of [...this.children.list]) child.destroy();
    renderDesktopBackground(this);

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
    const isOutcomeStep = this.outcomeStep >= 0 && this.idx >= this.outcomeStep;

    // ---- landscape geometry ----
    const footerY = this.H - FOOTER_BOTTOM - FOOTER_H;
    const scrubberY = footerY - GAP - SCRUBBER_H;
    const contentBottom = scrubberY - GAP;
    const contentTop = TOP_MARGIN;
    const leftX = GUTTER;
    const rightX = this.W - GUTTER - PANEL_W;
    const logX = leftX + PANEL_W + GAP;
    const logW = rightX - logX - GAP;
    const boardTop = contentTop + HP_BLOCK_H + GAP;
    const boardH = contentBottom - boardTop;

    // ---- HP blocks + boards. LEFT: the hero. RIGHT: one section per foe,
    // stacked vertically (a 1v1 fight is just the single full-height case).
    const slots = this.playSlotByTurn.get(turn) ?? {};
    const mark = (pieces: ColumnPiece[], slot?: number): ColumnPiece[] => pieces.map((p) => ({
      ...p,
      state: slot !== undefined && slot >= p.slot && slot < p.slot + Math.max(1, p.skill.size) ? 'cursor' as const : p.state,
    }));

    const heroBar = this.hpBar(
      leftX, contentTop, PANEL_W, this.heroName, hp.player, hp.playerMax, shield.player, UI.good ?? 0x4f9e57, status.player,
      forwardStep ? { hp: prevHp?.player ?? hp.player, shield: prevShield?.player ?? shield.player } : undefined,
    );
    // Full statline under the bar — the stat-sheet spend (e.g. DEF buys) must
    // be VISIBLE in battle, not only inferable from the D: math expansions.
    this.add.text(leftX, contentTop + 46, this.heroStatLine, { fontFamily: FONT.body, fontSize: `${F.small}px`, color: UI.textDim });
    const heroCol = new BoardColumn(this, { x: leftX, y: boardTop, width: PANEL_W, height: boardH, side: 'left', pieces: mark(this.heroPieces, slots.player), deck: this.heroSkills, stats: this.heroStats });
    if (forwardStep && slots.player !== undefined) this.pulseTokenAt(heroCol, this.heroPieces, slots.player);

    const n = Math.max(1, this.foes.length);
    const tabbed = this.foes.length > 2;
    // Auto-follow: focus the foe this step involves (the struck/buffed foe, or
    // the acting foe when the hero is the victim). Applies on ANY position
    // change (playback or scrubbing); a pinned tab (autoFollow=false) wins.
    if (tabbed && this.autoFollow) {
      const f = this.focusFoeByStep[this.idx];
      if (f !== undefined && f < this.foes.length) this.focusedFoe = f;
    }
    this.focusedFoe = Math.max(0, Math.min(this.focusedFoe, this.foes.length - 1));
    const focusChanged = this.focusedFoe !== this.lastFocusedFoe;
    this.lastFocusedFoe = this.focusedFoe;

    const foeHpOf = (u: number): number => hp.enemies?.[u] ?? hp.enemy;
    const foeBars: Array<HpBarHandles | undefined> = [];
    /** Tab-mode float anchor for foes whose full bar isn't on screen. */
    const tabAnchors: Array<{ x: number; y: number } | undefined> = [];
    const renderFoeSection = (u: number, top: number, height: number, animate: boolean): void => {
      const foeModel = this.foes[u]!;
      const foeHp = foeHpOf(u);
      const foeMax = hp.enemyMaxes?.[u] ?? hp.enemyMax;
      const foeShield = shield.enemies?.[u] ?? shield.enemy;
      const foeStatus = status.enemyUnits?.[u] ?? status.enemy;
      const prevFoeHp = prevHp ? (prevHp.enemies?.[u] ?? prevHp.enemy) : undefined;
      const prevFoeShield = prevShield ? (prevShield.enemies?.[u] ?? prevShield.enemy) : undefined;
      foeBars[u] = this.hpBar(
        rightX, top, PANEL_W, foeModel.name, foeHp, foeMax, foeShield, UI.bad ?? 0xb0483c, foeStatus,
        animate ? { hp: prevFoeHp ?? foeHp, shield: prevFoeShield ?? foeShield } : undefined,
      );
      this.add.text(rightX, top + 46, foeModel.statLine, { fontFamily: FONT.body, fontSize: `${F.small}px`, color: UI.textDim });
      const foeSlot = slots.enemyUnits?.[u] ?? (u === 0 ? slots.enemy : undefined);
      const foeCol = new BoardColumn(this, {
        x: rightX, y: top + HP_BLOCK_H, width: PANEL_W, height: height - HP_BLOCK_H, side: 'right',
        pieces: mark(foeModel.pieces, foeSlot), deck: foeModel.skills, stats: foeModel.stats,
      });
      if (animate && foeSlot !== undefined) this.pulseTokenAt(foeCol, foeModel.pieces, foeSlot);
    };

    if (!tabbed) {
      // 1–2 foes: full stacked sections, everything visible at once.
      const sectionH = (contentBottom - contentTop - GAP * (n - 1)) / n;
      this.foes.forEach((_, u) => renderFoeSection(u, contentTop + u * (sectionH + GAP), sectionH, forwardStep));
    } else {
      // 3+ foes: one compact tab per foe (name + mini HP strip; click to pin)
      // + an AUTO pill, then the FOCUSED foe's full bar/statline/board.
      const tabH = 40;
      const tabGap = 4;
      const autoW = 52;
      const tabW = (PANEL_W - autoW - tabGap * n) / n;
      this.foes.forEach((foeModel, u) => {
        const tx = rightX + u * (tabW + tabGap);
        const isActive = u === this.focusedFoe;
        const foeHp = foeHpOf(u);
        const foeMax = Math.max(1, hp.enemyMaxes?.[u] ?? hp.enemyMax);
        const dead = foeHp <= 0;
        const tab = this.add.rectangle(tx, contentTop, tabW, tabH, isActive ? UI.panelAlt : UI.panelMuted, dead ? 0.55 : 1)
          .setOrigin(0, 0).setStrokeStyle(isActive ? 2 : 1, isActive ? (UI.chip ?? 0xb78a46) : UI.border, isActive ? 1 : 0.6)
          .setInteractive({ useHandCursor: true });
        tab.on('pointerdown', () => { this.focusedFoe = u; this.autoFollow = false; this.render(); });
        const label = this.add.text(tx + 6, contentTop + 5, dead ? `✕ ${foeModel.name.toUpperCase()}` : foeModel.name.toUpperCase(), {
          fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${F.tiny}px`, color: dead ? UI.textSoft : isActive ? UI.text : UI.textDim,
        });
        while (label.width > tabW - 12 && label.text.length > 2) label.setText(`${label.text.slice(0, -2)}…`);
        // Mini HP strip along the tab's bottom — every foe's health stays
        // readable even while another foe's full bar is focused.
        this.add.rectangle(tx + 6, contentTop + tabH - 11, tabW - 12, 5, 0x1b2431).setOrigin(0, 0);
        this.add.rectangle(tx + 6, contentTop + tabH - 11, (tabW - 12) * Math.max(0, Math.min(1, foeHp / foeMax)), 5, dead ? 0x5a3a36 : (UI.bad ?? 0xb0483c)).setOrigin(0, 0);
        tabAnchors[u] = { x: tx + tabW / 2, y: contentTop + tabH / 2 };
      });
      // AUTO pill: re-enables follow-the-action tab switching.
      const ax = rightX + PANEL_W - autoW;
      const auto = this.add.rectangle(ax, contentTop, autoW, tabH, this.autoFollow ? (UI.chip ?? 0xb78a46) : UI.panelMuted)
        .setOrigin(0, 0).setStrokeStyle(1, UI.border, 0.8).setInteractive({ useHandCursor: true });
      auto.on('pointerdown', () => { this.autoFollow = !this.autoFollow; this.render(); });
      this.add.text(ax + autoW / 2, contentTop + tabH / 2, 'AUTO', {
        fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${F.tiny}px`, color: this.autoFollow ? UI.textOnChip : UI.textDim,
      }).setOrigin(0.5);

      const sectionTop = contentTop + tabH + GAP;
      // Snap (don't tween) the bar when the focused tab just changed — a tween
      // from the PREVIOUS foe's HP fraction would be a lie.
      renderFoeSection(this.focusedFoe, sectionTop, contentBottom - sectionTop, forwardStep && !focusChanged);
    }

    // ---- floating numbers + defender shake for this step's damage/heal/shield ----
    if (forwardStep) {
      for (const fx of this.fxByStep[this.idx] ?? []) {
        const bar = fx.side === 'player' ? heroBar : foeBars[fx.unit ?? 0];
        const anchor = bar
          ? { x: bar.floatX, y: bar.floatY }
          : (fx.side === 'enemy' ? tabAnchors[fx.unit ?? 0] : undefined);
        if (!anchor) continue;
        if (fx.kind === 'damage') {
          if (bar) this.shakeBar(bar.shakeTargets);
          const dmgColor = fx.source ? (AILMENT_COLOR[fx.source] ?? '#d05c4e') : '#d05c4e';
          this.spawnFloat(anchor.x, anchor.y, `−${fx.amount}`, dmgColor);
        } else if (fx.kind === 'heal') {
          this.spawnFloat(anchor.x, anchor.y, `+${fx.amount}`, '#5fb56a');
        } else if (fx.kind === 'shield') {
          this.spawnFloat(anchor.x, anchor.y, `+${fx.amount}`, '#5fa8d3');
        }
      }
    }

    // ---- combat log (center column) ----
    this.renderLog(logX, contentTop, logW, contentBottom - contentTop, turn, step, isOutcomeStep);

    // ---- horizontal scrubber + footer controls ----
    this.renderScrubber(leftX, scrubberY, this.W - GUTTER * 2);
    this.renderFooter(leftX, footerY, this.W - GUTTER * 2);

    if (isOutcomeStep) {
      this.renderOutcome(leftX, contentTop, this.W - GUTTER * 2, contentBottom - contentTop);
    }
  }

  /** Wide center-column combat log: header (turnline) + a scrolling
   * transcript (newest at bottom), tap a HIT row to expand its D: math. */
  private renderLog(x: number, y: number, w: number, h: number, turn: number, step: PlaybackStep, isOutcomeStep: boolean): void {
    this.add.rectangle(x, y, w, h, UI.panel, 0.92).setOrigin(0, 0).setStrokeStyle(1, UI.border, 0.8);
    this.add.text(x + 16, y + 12, 'COMBAT LOG', { fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${F.label}px`, color: UI.text });
    const spd = this.speedByTurn.get(turn) ?? { player: '', enemy: '' };
    const turnStats = [
      spd.player && `${this.heroName} ${spd.player}`,
      ...this.foes.map((f, u) => {
        const line = spd.enemyUnits?.[u] ?? (u === 0 ? spd.enemy : '');
        return line && `${f.name} ${line}`;
      }),
    ].filter(Boolean).join('   ·   ');
    this.boundedText(x + 16, y + 32, `T${turn}${!isOutcomeStep && this.playing ? ' ▶' : ''}   ${turnStats}`, {
      fontFamily: FONT.body, fontSize: `${F.small}px`, color: UI.textDim,
    }, w - 32);
    this.add.rectangle(x + 16, y + 54, w - 32, 1, UI.border, 0.4).setOrigin(0, 0);

    const feed: Array<{ t: number; local: number; line: LogLine }> = [];
    for (const t of this.turns) {
      if (t > turn) break;
      const lines = this.linesByTurn.get(t) ?? [];
      const limit = t === turn ? step.lineIndex : lines.length - 1;
      lines.forEach((line, local) => { if (local <= limit) feed.push({ t, local, line }); });
    }
    const rowH = 24;
    const headerBottom = y + 66;
    const turnX = x + 16;
    const tagX = x + 58;
    const textX = x + 136;
    const maxRows = Math.max(1, Math.floor((h - 66 - 12) / rowH));
    const visible = feed.slice(-maxRows);
    let ly = headerBottom;
    let prevTurn = -1;
    for (const { t, local, line } of visible) {
      if (ly > y + h - 20) break;
      const key = `${t}:${local}`;
      this.add.rectangle(x + 16, ly - 3, w - 32, 1, 0x1c2940).setOrigin(0, 0);
      if (t !== prevTurn) this.boundedText(turnX, ly + 3, `T${t}`, { fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${F.tiny}px`, color: UI.textDim }, tagX - turnX - 8);
      prevTurn = t;
      this.boundedText(tagX, ly, line.tag, { fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${F.small}px`, color: TAG_COLOR[line.tag] ?? UI.textDim }, textX - tagX - 8);
      const textMaxW = w - (textX - x) - (line.detail ? 30 : 16);
      this.boundedText(textX, ly, line.text, { fontFamily: FONT.body, fontSize: `${F.body}px`, color: UI.text }, textMaxW);
      if (line.detail) {
        this.add.text(x + w - 16, ly, this.expanded.has(key) ? '▲' : '▾', { fontFamily: FONT.body, fontSize: `${F.small}px`, color: UI.textDim }).setOrigin(1, 0);
        const zone = this.add.rectangle(x, ly - 3, w, rowH, 0xffffff, 0.001).setOrigin(0, 0).setInteractive({ useHandCursor: true });
        zone.on('pointerdown', () => { if (this.expanded.has(key)) this.expanded.delete(key); else this.expanded.add(key); this.render(); });
      }
      ly += rowH;
      if (line.detail && this.expanded.has(key) && ly < y + h - 16) {
        const d = this.boundedText(textX, ly, line.detail, { fontFamily: FONT.body, fontSize: `${F.tiny}px`, color: UI.textDim }, w - (textX - x) - 16);
        ly += d.height + 6;
      }
    }
  }

  /** Horizontal event-level scrubber: a MAJOR tick at each turn's first step,
   * a MINI tick for every other step — matches MobileBattleScene's vertical
   * scrubber semantics, laid out sideways for the landscape canvas. */
  private renderScrubber(x: number, y: number, w: number): void {
    const n = this.steps.length;
    const gap = n <= 1 ? 0 : Math.min(24, w / (n - 1));
    const railLen = gap * (n - 1);
    const xFor = (i: number): number => x + i * gap;
    const cy = y + SCRUBBER_H / 2;
    this.add.rectangle(x, cy, railLen, 8, 0x16233a).setOrigin(0, 0.5).setStrokeStyle(1, 0x2a3a52, 1);
    this.add.rectangle(x, cy, xFor(this.idx) - x, 8, 0xb78a46).setOrigin(0, 0.5);
    for (let i = 0; i < n; i++) {
      const passed = i <= this.idx;
      const isMajor = i === 0 || this.steps[i]!.turn !== this.steps[i - 1]!.turn;
      if (isMajor) this.add.rectangle(xFor(i), cy, 3, 14, passed ? 0xb78a46 : 0x3a4a62).setOrigin(0.5, 0.5);
      else this.add.rectangle(xFor(i), cy, 2, 7, passed ? 0x8a6a34 : 0x2c3e58).setOrigin(0.5, 0.5);
    }
    this.add.circle(xFor(this.idx), cy, 11, 0xe8b446).setStrokeStyle(2, 0x1a1208);
    this.add.text(xFor(this.idx), cy + 16, `T${this.steps[this.idx]?.turn ?? this.turns[0] ?? 1}`, { fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${F.tiny}px`, color: '#e8b446' }).setOrigin(0.5, 0);
    const zone = this.add.rectangle(x, cy, railLen || 20, 40, 0xffffff, 0.001).setOrigin(0, 0.5).setInteractive({ useHandCursor: true });
    const setFromX = (px: number): void => {
      const i = railLen <= 0 ? 0 : Math.round(Math.max(0, Math.min(1, (px - x) / railLen)) * (n - 1));
      if (i !== this.idx) { this.idx = i; this.render(); }
    };
    zone.on('pointerdown', (p: Phaser.Input.Pointer) => { this.stopPlayback(); setFromX(p.x); });
    zone.on('pointermove', (p: Phaser.Input.Pointer) => { if (p.isDown) setFromX(p.x); });
  }

  /** Footer control row: PREP / REPLAY / speed segment / END — desktop draws
   * its own buttons (the shared ActionBar template is portrait-fixed). */
  private renderFooter(x: number, y: number, w: number): void {
    const gap = GAP;
    const speeds: Array<[string, number]> = [['×½', 0.5], ['×1', 1], ['×2', 2]];
    const speedCellW = 56;
    const speedW = speedCellW * speeds.length + gap * (speeds.length - 1);
    const buttons: Array<{ label: string; primary?: boolean; onPress: () => void }> = [
      { label: 'PREP', onPress: () => this.scene.start('DesktopPrep') },
      { label: 'REPLAY', onPress: () => { this.stopPlayback(); this.idx = 0; this.render(); this.startPlayback(); } },
      { label: 'END', primary: true, onPress: () => { this.stopPlayback(); this.idx = this.steps.length - 1; this.render(); } },
    ];
    const bw = (w - speedW - gap * buttons.length) / buttons.length;
    let cx = x;
    const drawButton = (label: string, width: number, active: boolean, primary: boolean, onPress: () => void): void => {
      const fill = primary || active ? UI.chip : UI.panelAlt;
      const color = primary || active ? UI.textOnChip : UI.text;
      const r = this.add.rectangle(cx, y, width, FOOTER_H, fill).setOrigin(0, 0)
        .setStrokeStyle(1, UI.border, primary || active ? 1 : 0.7).setInteractive({ useHandCursor: true });
      r.on('pointerdown', onPress);
      if (!primary && !active) {
        r.on('pointerover', () => r.setFillStyle(UI.slotHover));
        r.on('pointerout', () => r.setFillStyle(fill));
      }
      this.add.text(cx + width / 2, y + FOOTER_H / 2, label, {
        fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${F.label}px`, color,
      }).setOrigin(0.5);
      cx += width + gap;
    };
    drawButton(buttons[0]!.label, bw, false, false, buttons[0]!.onPress);
    drawButton(buttons[1]!.label, bw, false, false, buttons[1]!.onPress);
    // Playback speed segment — the multiplier applies at the NEXT scheduled
    // step, so switching mid-playback takes effect immediately in practice.
    for (const [label, mult] of speeds) {
      drawButton(label, speedCellW, this.speedMult === mult, false, () => {
        if (this.speedMult === mult) return;
        this.speedMult = mult;
        this.render();
      });
    }
    drawButton(buttons[2]!.label, bw, false, true, buttons[2]!.onPress);
  }

  /** Compact centered outcome card: banner + totals + CARD OUTPUT grid in one
   * ~640px panel over a dimming scrim — the boards/log stay visible around it. */
  private renderOutcome(x: number, y: number, w: number, h: number): void {
    this.add.rectangle(x, y, w, h, 0x05070c, 0.72).setOrigin(0, 0);
    const good = this.outcome === 'VICTORY';
    const summaryRows = this.combatSummary.cards.filter((row) => row.damage > 0 || row.shield > 0 || row.healing > 0 || row.dots > 0);
    const columns = 2;
    const rowH = 34;
    const gridRows = Math.max(1, Math.ceil(summaryRows.length / columns));

    const pw = 640;
    const bannerH = 52;
    const pad = 16;
    // banner + totals row + CARD OUTPUT label + grid + padding
    const ph = bannerH + 10 + 20 + 18 + gridRows * rowH + pad;
    const px = x + (w - pw) / 2;
    const py = y + (h - ph) / 2;

    this.add.rectangle(px, py, pw, ph, UI.panel, 0.97).setOrigin(0, 0).setStrokeStyle(1, UI.border, 0.9);
    this.add.rectangle(px, py, pw, bannerH, good ? 0x143a1a : 0x3a1414, 0.95).setOrigin(0, 0).setStrokeStyle(2, good ? 0x4f9e57 : 0xb0483c);
    this.add.text(px + pw / 2, py + bannerH / 2, this.outcome, { fontFamily: FONT.display, fontStyle: 'bold', fontSize: `${F.title}px`, color: good ? '#7fe08a' : '#f08a7a' }).setOrigin(0.5);

    let cy = py + bannerH + 10;
    const totalMetrics = [
      this.combatSummary.playerDamage > 0 ? `YOU DMG ${this.combatSummary.playerDamage}` : '',
      this.combatSummary.enemyDamage > 0 ? `FOE DMG ${this.combatSummary.enemyDamage}` : '',
      this.combatSummary.playerHealing > 0 ? `HEAL ${this.combatSummary.playerHealing}` : '',
    ].filter(Boolean).join('  ·  ');
    this.boundedText(px + pad, cy, totalMetrics || 'No measurable output', { fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${F.small}px`, color: UI.text }, pw - pad * 2 - 130);
    this.add.text(px + pw - pad, cy, `${summaryRows.length} EFFECTIVE CARDS`, { fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${F.tiny}px`, color: UI.textDim }).setOrigin(1, 0);
    cy += 20;
    this.add.text(px + pad, cy, 'CARD OUTPUT', { fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${F.tiny}px`, color: UI.textDim });
    cy += 18;
    summaryRows.forEach((row, index) => {
      const col = index % columns;
      const rowIndex = Math.floor(index / columns);
      const cellW = (pw - pad * 2 - GAP) / columns;
      const cellX = px + pad + col * (cellW + GAP);
      const cellY = cy + rowIndex * rowH;
      const accent = row.side === 'player' ? 0x315f43 : 0x6c3838;
      this.add.rectangle(cellX, cellY, cellW, rowH - 6, accent, 0.42).setOrigin(0, 0).setStrokeStyle(1, row.side === 'player' ? 0x4f9e57 : 0xb0483c, 0.55);
      const prefix = row.side === 'player' ? 'YOU' : 'FOE';
      this.boundedText(cellX + 8, cellY + 3, `${prefix} · ${row.name}`, { fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${F.tiny}px`, color: UI.text }, cellW * 0.55);
      const metrics = [
        row.damage > 0 ? `DMG ${row.damage}` : '',
        row.shield > 0 ? `SHD ${row.shield}` : '',
        row.healing > 0 ? `HEAL ${row.healing}` : '',
        row.dots > 0 ? `DOT ${row.dots}` : '',
      ].filter(Boolean).join(' · ');
      this.boundedText(cellX + cellW - 8, cellY + 3, metrics, { fontFamily: FONT.body, fontSize: `${F.tiny}px`, color: '#e8b446' }, cellW * 0.4, 1);
      void rowIndex;
    });
  }

  /**
   * `prev`, when given (forward-step only), makes the fill/shield rects tween
   * from the previous step's fraction to the current one instead of snapping.
   */
  private hpBar(
    panelX: number, panelY: number, panelW: number,
    name: string, hp: number, max: number, shield: number, color: number,
    ailments: string[],
    prev?: { hp: number; shield: number },
  ): HpBarHandles {
    const nameText = this.boundedText(panelX, panelY, name.toUpperCase(), { fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${F.name}px`, color: UI.text }, panelW - 90);
    const hpLabelText = this.add.text(panelX + panelW, panelY, `${hp}/${max}`, { fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${F.name}px`, color: UI.text }).setOrigin(1, 0);
    const barY = panelY + 26;
    const barW = panelW;
    const frac = (v: number): number => barW * Math.max(0, Math.min(1, v / max));
    const firstAilment = ailments.find((a) => AILMENT_TINT[a] !== undefined);
    const fillColor = firstAilment ? this.blendColor(color, AILMENT_TINT[firstAilment]!, 45) : color;
    const border = this.add.rectangle(panelX, barY + 8, barW, 16, 0x1b2431).setOrigin(0, 0.5);
    border.setStrokeStyle(1, firstAilment ? AILMENT_TINT[firstAilment]! : 0x3a4a62, firstAilment ? 1 : 0.7);
    ailments.forEach((a, i) => {
      const tint = AILMENT_TINT[a];
      if (tint !== undefined) this.add.rectangle(panelX + barW - 6 - i * 12, barY + 20, 8, 4, tint).setOrigin(1, 0.5);
    });

    const hpTarget = frac(hp);
    const hpStart = prev ? frac(prev.hp) : hpTarget;
    const fillRect = this.add.rectangle(panelX, barY + 8, hpStart, 16, fillColor).setOrigin(0, 0.5);
    if (prev && hpStart !== hpTarget) {
      this.tweens.add({ targets: fillRect, width: hpTarget, duration: 400, ease: 'Cubic.Out' });
    }

    const shieldTarget = frac(shield);
    const shieldStart = prev ? frac(prev.shield) : shieldTarget;
    const shieldVisible = shield > 0 || (prev?.shield ?? 0) > 0;
    const shieldRect = this.add.rectangle(panelX, barY, shieldStart, 5, 0x5fa8d3).setOrigin(0, 0.5).setVisible(shieldVisible);
    if (prev && shieldStart !== shieldTarget) {
      this.tweens.add({ targets: shieldRect, width: shieldTarget, duration: 400, ease: 'Cubic.Out' });
    }

    const shieldText = shield > 0 ? this.add.text(panelX + barW, panelY + 24, `+${shield}`, { fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${F.small}px`, color: '#5fa8d3' }).setOrigin(1, 0) : undefined;

    return {
      fillRect,
      shieldRect,
      shakeTargets: [nameText, fillRect, hpLabelText, ...(shieldText ? [shieldText] : [])],
      floatX: panelX + barW / 2,
      floatY: barY + 8,
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
  private spawnFloat(x: number, y: number, text: string, color: string): void {
    const t = this.add
      .text(x + (Math.random() * 24 - 12), y - 4, text, {
        fontFamily: FONT.body, fontSize: `${F.body}px`, fontStyle: 'bold', color,
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
