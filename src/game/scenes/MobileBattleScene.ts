import Phaser from 'phaser';
import type { SkillDef } from '../../engine/types';
import {
  buildBattleTimeline,
  type BattleTimelineInput,
  type CombatSummary, type FoeModel, type HpSnap, type LogLine, type PlaybackStep, type ShieldSnap, type SpeedSnap, type TurnFx,
} from '../battleTimeline';
import { fetchBattleLog } from '../battleApi';
import { creditBattleGold } from '../battleGold';
import { getBattleContext, getBattleTimelineInput } from '../battleContext';
import { currentBankedPL, currentHeroLevel, resolveRunBattleResult } from '../runStore';
import type { BattleLog } from '../../run/resolveBattle';
import { FONT, SCREEN, UI } from '../theme';
import { BoardColumn, type ColumnPiece } from '../ui/BoardColumn';
import { footerY, renderActionBar, type ActionButton } from '../ui/ActionBar';
import { addHoverTipZone, attachHoverTip } from '../ui/hoverTip';
import { STAT_LABELS, statHoverEntry } from '../ui/statGlossary';
import type { ScalingStats } from '../ui/skillPresentation';

/** Hover copy for every stat shown on a battle statline, in one shared tip. */
const ALL_STAT_ENTRIES = STAT_LABELS.map(statHoverEntry);
/** Hover copy for the turnline — read once, shown on every render. */
const TURNLINE_ENTRY = { title: 'Turn order', body: 'Each side’s turn score is banked readiness + Speed − the queued card’s weight; higher performs. The loser banks their Speed for next time. A size-N card busies its caster N−1 extra turns.' };

/** Everything a rendered HP bar hands back so FX can target it after the fact. */
interface HpBarHandles {
  fillRect: Phaser.GameObjects.Rectangle;
  shieldRect: Phaser.GameObjects.Rectangle;
  shakeTargets: Array<Phaser.GameObjects.Text | Phaser.GameObjects.Rectangle>;
  floatX: number;
  floatY: number;
}
// Footer buttons come from the shared ActionBar template (ui/ActionBar.ts).

/** The result overlay (scrim + ledger + banner) draws above the board. */
const OUTCOME_DEPTH = 40;

const TAG_COLOR: Record<string, string> = {
  START: '#e8b446', PLAY: '#4f9e57', HIT: '#d05c4e', BUFF: '#5fb56a',
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
  private shieldByTurn = new Map<number, ShieldSnap>();
  /** Active ailment keys per side per turn — drives the HP-bar ailment tint. */
  private statusByTurn = new Map<number, { player: string[]; enemy: string[]; enemyUnits?: string[][] }>();
  private speedByTurn = new Map<number, SpeedSnap>();
  /** Which board slot each side cast from, per turn — drives the gold cursor. */
  private playSlotByTurn = new Map<number, { player?: number; enemy?: number; enemyUnits?: Array<number | undefined> }>();
  private turns: number[] = [];
  /** Flat, event-level playback timeline — one entry per IMPORTANT log line
   * (HIT/DEBUFF/BUFF/DOWN/RESULT), plus one fallback entry for any turn that
   * had none (e.g. a turn that was only a PLAY/wait). `this.idx` indexes this,
   * not `turns` — playback now steps event-by-event, not turn-by-turn. */
  private steps: PlaybackStep[] = [];
  /** HP/shield snapshots captured at each step's exact position in the event
   * stream (not just per-turn) so the bars animate on the precise event. */
  private hpByStep: HpSnap[] = [];
  private shieldByStep: ShieldSnap[] = [];
  /** Structured per-step FX (damage/heal/shield deltas) for floating numbers + shakes. */
  private fxByStep: TurnFx[][] = [];
  private focusFoeByStep: Array<number | undefined> = [];
  private idx = 0;
  /** Which foe the tabbed enemy view (3+ foes) is showing. */
  private focusedFoe = 0;
  /** Auto-switch the focused tab to the foe involved in the current event;
   *  tapping a tab pins it (turns this off) until AUTO is tapped again. */
  private autoFollow = true;
  private lastFocusedFoe = -1;
  /** The `idx` shown by the previous render() call — used to detect a single
   * forward step (playback tick or one scrub click) vs. a jump/rewind, which
   * gates all FX (floating numbers, shakes, bar tweens) per the no-spam rule. */
  private lastIdx = -1;
  private expanded = new Set<string>();
  private heroPieces: ColumnPiece[] = [];
  private heroSkills: SkillDef[] = [];
  private foes: FoeModel[] = [];
  private heroName = 'Hero';
  private heroStats: ScalingStats = { attack: 0, magicPower: 0 };
  private heroStatLine = '';
  private outcome = '';
  private combatSummary: CombatSummary = { playerDamage: 0, enemyDamage: 0, playerHealing: 0, cards: [] };
  /** First playback step that contains the defeated unit's DOWN log. */
  private outcomeStep = -1;
  private playing = true;
  private playTimer?: Phaser.Time.TimerEvent;
  /** Playback speed multiplier — cycles ×1 → ×2 → ×½ → ×1 via the footer
   * button; NOT reset on replay/restart so the player's pick persists. */
  private speedMult = 1;
  /** Guards the gold payout to exactly once per fetched `BattleLog` — REPLAY
   * re-renders the SAME log object (no re-fetch), so the identity check skips
   * it; a fresh scene entry re-fetches a new log object and credits again. */
  private goldCreditedLog: BattleLog | null = null;
  private goldPayout = 0;

  constructor() { super('MobileBattle'); }

  create(): void {
    this.W = SCREEN.width; this.H = SCREEN.height;
    this.cameras.main.setBackgroundColor(0x0b1420);
    this.focusedFoe = 0;
    this.autoFollow = true;
    this.lastFocusedFoe = -1;
    this.goldCreditedLog = null;
    this.goldPayout = 0;
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
      // Credit exactly once per fetched response — a REPLAY re-renders this
      // SAME log object (no re-fetch), so the identity check skips it.
      if (this.goldCreditedLog !== log) {
        this.goldCreditedLog = log;
        this.goldPayout = getBattleContext() === 'run'
          ? resolveRunBattleResult(input, log)
          : creditBattleGold(input, log);
      }
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
    this.add.text(this.W / 2, this.H / 2, message, {
      fontSize: '12px', color: '#8a94a6', fontFamily: FONT.body,
      align: 'center', wordWrap: { width: this.W - 60 }, lineSpacing: 4,
    }).setOrigin(0.5);
  }

  /** The prep info this fight resolves from — demoState in Sandbox, the
   * active run's current combat node in Run Mode (see `battleContext.ts`). */
  private fightInput(): BattleTimelineInput {
    return getBattleTimelineInput();
  }

  /** Footer buttons: Sandbox is PREP / REPLAY / speed / END; Run Mode is
   * REPLAY / speed / CONTINUE › (no PREP — nothing to return to mid-run; no
   * END — CONTINUE both finishes playback and moves the run on). */
  private footerButtons(): ActionButton[] {
    const replay: ActionButton = { label: 'REPLAY', onPress: () => { this.stopPlayback(); this.idx = 0; this.render(); this.startPlayback(); } };
    const speed: ActionButton = {
      label: this.speedMult === 1 ? '×1' : this.speedMult === 2 ? '×2' : '×½',
      onPress: () => {
        // Cycle ×1 → ×2 → ×½ → ×1. Takes effect on the next scheduled step.
        this.speedMult = this.speedMult === 1 ? 2 : this.speedMult === 2 ? 0.5 : 1;
        this.render();
      },
    };
    if (getBattleContext() === 'run') {
      return [replay, speed, { label: 'CONTINUE ›', primary: true, onPress: () => this.scene.start('MobileRunMap') }];
    }
    return [
      { label: 'PREP', onPress: () => this.scene.start('MobilePrep') },
      replay,
      speed,
      { label: 'END', primary: true, onPress: () => { this.stopPlayback(); this.idx = this.steps.length - 1; this.render(); } },
    ];
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
    this.heroStatLine = model.heroStatLine;
    this.heroPieces = model.heroPieces;
    this.heroSkills = model.heroSkills;
    this.foes = model.foes;
  }

  private render(): void {
    // Kill any in-flight FX tweens before the full redraw so fast scrubbing
    // never leaves an orphaned tween chasing a destroyed object.
    this.tweens.killAll();
    // Destroy (not just remove) the previous frame's objects — removeAll()
    // alone leaks every Text's backing canvas texture across ~30 redraws/fight.
    for (const child of [...this.children.list]) child.destroy();
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
    const turnStats = [
      spd.player && `${this.heroName} ${spd.player}`,
      ...this.foes.map((f, u) => {
        const line = spd.enemyUnits?.[u] ?? (u === 0 ? spd.enemy : '');
        return line && `${f.name} ${line}`;
      }),
    ].filter(Boolean).join('   ·   ');
    if (turnStats) this.boundedText(66, 9, turnStats, { fontSize: '11px', color: '#cdd4de', fontFamily: FONT.body }, this.W - 78);
    addHoverTipZone(this, { x: 12, y: 6, w: this.W - 24, h: 16 }, [TURNLINE_ENTRY]);

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
        // Hover (desktop)/tap (mobile, alongside the expand toggle above):
        // how this number was reached — the ALREADY-formatted D: string the
        // log computed, never recomputed here.
        attachHoverTip(this, zone, { x: 0, y: ly - 3, w: this.W, h: rowH }, [{ title: `${line.tag} — how this was reached`, body: line.detail }]);
      }
      ly += rowH;
      if (line.detail && this.expanded.has(key) && ly < dockH - 12) {
        const d = this.boundedText(textX, ly, line.detail, { fontSize: '10px', color: '#8a94a6', fontFamily: FONT.body }, this.W - textX - 14);
        ly += d.height + 4;
      }
    }

    // ---- HP block: bars + shield strip. Ailments live ON the bar (tint +
    // colored pips), not in a text row — the log already narrates them. A
    // tiny 9px statline sits under each bar (barRowH accounts for it).
    // 1–2 foes: one row each. 3+ foes: the FOCUSED foe's row + a tab strip
    // (name + mini HP per foe); tabs auto-follow the foe involved in the
    // current event unless the player pins one. ----
    const tabbed = this.foes.length > 2;
    if (tabbed && this.autoFollow) {
      const f = this.focusFoeByStep[this.idx];
      if (f !== undefined && f < this.foes.length) this.focusedFoe = f;
    }
    this.focusedFoe = Math.max(0, Math.min(this.focusedFoe, Math.max(0, this.foes.length - 1)));
    const focusChanged = this.focusedFoe !== this.lastFocusedFoe;
    this.lastFocusedFoe = this.focusedFoe;

    const hpY = dockH + 10;
    const barRowH = 36;
    const heroBar = this.hpBar(
      hpY, this.heroName, hp.player, hp.playerMax, shield.player, UI.good ?? 0x4f9e57, status.player,
      forwardStep ? { hp: prevHp?.player ?? hp.player, shield: prevShield?.player ?? shield.player } : undefined,
    );
    this.boundedText(120, hpY + 17, this.heroStatLine, { fontSize: '9px', color: '#7a8699', fontFamily: FONT.body }, this.W - 120 - 84);
    addHoverTipZone(this, { x: 120, y: hpY + 17, w: this.W - 120 - 84, h: 12 }, ALL_STAT_ENTRIES);
    const foeBars: Array<HpBarHandles | undefined> = [];
    /** Tab-mode float anchor for foes whose full bar isn't on screen. */
    const tabAnchors: Array<{ x: number; y: number } | undefined> = [];
    const foeRowAt = (u: number, barY: number, animate: boolean): void => {
      const foeModel = this.foes[u]!;
      const foeHp = hp.enemies?.[u] ?? hp.enemy;
      const foeMax = hp.enemyMaxes?.[u] ?? hp.enemyMax;
      const foeShield = shield.enemies?.[u] ?? shield.enemy;
      const foeStatus = status.enemyUnits?.[u] ?? status.enemy;
      const prevFoeHp = prevHp ? (prevHp.enemies?.[u] ?? prevHp.enemy) : undefined;
      const prevFoeShield = prevShield ? (prevShield.enemies?.[u] ?? prevShield.enemy) : undefined;
      foeBars[u] = this.hpBar(
        barY, foeModel.name, foeHp, foeMax, foeShield, UI.bad ?? 0xb0483c, foeStatus,
        animate ? { hp: prevFoeHp ?? foeHp, shield: prevFoeShield ?? foeShield } : undefined,
      );
      this.boundedText(120, barY + 17, foeModel.statLine, { fontSize: '9px', color: '#7a8699', fontFamily: FONT.body }, this.W - 120 - 84);
      addHoverTipZone(this, { x: 120, y: barY + 17, w: this.W - 120 - 84, h: 12 }, ALL_STAT_ENTRIES);
    };
    let boardsTop: number;
    if (!tabbed) {
      this.foes.forEach((_, u) => foeRowAt(u, hpY + barRowH * (u + 1), forwardStep));
      boardsTop = hpY + 32 + barRowH * this.foes.length;
    } else {
      // Snap (don't tween) the focused bar right after a tab switch — a tween
      // from the PREVIOUS foe's HP fraction would be a lie.
      foeRowAt(this.focusedFoe, hpY + barRowH, forwardStep && !focusChanged);
      const tabY = hpY + barRowH * 2 - 4;
      const tabH = 26;
      const tabGap = 4;
      const autoW = 46;
      const tabW = (this.W - 20 - autoW - tabGap * this.foes.length) / this.foes.length;
      this.foes.forEach((foeModel, u) => {
        const tx = 10 + u * (tabW + tabGap);
        const isActive = u === this.focusedFoe;
        const foeHp = hp.enemies?.[u] ?? hp.enemy;
        const foeMax = Math.max(1, hp.enemyMaxes?.[u] ?? hp.enemyMax);
        const dead = foeHp <= 0;
        const tab = this.add.rectangle(tx, tabY, tabW, tabH, isActive ? 0x16233a : 0x101a2a, dead ? 0.55 : 1)
          .setOrigin(0, 0).setStrokeStyle(isActive ? 2 : 1, isActive ? 0xe8b446 : UI.border, isActive ? 0.9 : 0.5)
          .setInteractive({ useHandCursor: true });
        tab.on('pointerdown', () => { this.focusedFoe = u; this.autoFollow = false; this.render(); });
        this.boundedText(tx + 5, tabY + 3, dead ? `✕ ${foeModel.name.toUpperCase()}` : foeModel.name.toUpperCase(), {
          fontSize: '9px', color: dead ? '#5a6a82' : isActive ? '#e8e0c8' : '#9aa4b6', fontFamily: FONT.body, fontStyle: 'bold',
        }, tabW - 10);
        // Mini HP strip along the tab's bottom — every foe's health stays
        // readable even while another foe's full bar is focused.
        this.add.rectangle(tx + 5, tabY + tabH - 8, tabW - 10, 4, 0x1b2431).setOrigin(0, 0);
        this.add.rectangle(tx + 5, tabY + tabH - 8, (tabW - 10) * Math.max(0, Math.min(1, foeHp / foeMax)), 4, dead ? 0x5a3a36 : (UI.bad ?? 0xb0483c)).setOrigin(0, 0);
        tabAnchors[u] = { x: tx + tabW / 2, y: tabY + tabH / 2 };
      });
      // AUTO pill: re-enables follow-the-action tab switching.
      const ax = this.W - 10 - autoW;
      const auto = this.add.rectangle(ax, tabY, autoW, tabH, this.autoFollow ? 0xb78a46 : 0x101a2a)
        .setOrigin(0, 0).setStrokeStyle(1, UI.border, 0.7).setInteractive({ useHandCursor: true });
      auto.on('pointerdown', () => { this.autoFollow = !this.autoFollow; this.render(); });
      this.add.text(ax + autoW / 2, tabY + tabH / 2, 'AUTO', { fontSize: '9px', color: this.autoFollow ? '#1a1208' : '#9aa4b6', fontFamily: FONT.body, fontStyle: 'bold' }).setOrigin(0.5);
      boardsTop = tabY + tabH + 8;
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
          // DoT ticks float in their ailment's color (poison green, burn orange…)
          const dmgColor = fx.source ? (AILMENT_COLOR[fx.source] ?? '#d05c4e') : '#d05c4e';
          this.spawnFloat(anchor.x, anchor.y, `−${fx.amount}`, dmgColor);
        } else if (fx.kind === 'heal') {
          this.spawnFloat(anchor.x, anchor.y, `+${fx.amount}`, '#5fb56a');
        } else if (fx.kind === 'shield') {
          this.spawnFloat(anchor.x, anchor.y, `+${fx.amount}`, '#5fa8d3');
        }
      }
    }

    // ---- boards + gutter scrubber ----
    const top = boardsTop;
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
    if (forwardStep && slots.player !== undefined) this.pulseTokenAt(heroCol, this.heroPieces, slots.player);
    // Enemy boards: 1–2 foes stack vertically in the right column; 3+ foes
    // show only the FOCUSED foe's board (the tab strip covers the rest).
    const foeBoard = (u: number, boardTop: number, boardH: number): void => {
      const foeModel = this.foes[u]!;
      const foeSlot = slots.enemyUnits?.[u] ?? (u === 0 ? slots.enemy : undefined);
      const foeCol = new BoardColumn(this, {
        x: bagX, y: boardTop, width: colW, height: boardH, side: 'right',
        pieces: mark(foeModel.pieces, foeSlot), deck: foeModel.skills, stats: foeModel.stats,
      });
      if (forwardStep && foeSlot !== undefined) this.pulseTokenAt(foeCol, foeModel.pieces, foeSlot);
    };
    if (!tabbed) {
      const nFoes = Math.max(1, this.foes.length);
      const subH = (colH - (nFoes - 1) * 8) / nFoes;
      this.foes.forEach((_, u) => foeBoard(u, top + u * (subH + 8), subH));
    } else {
      foeBoard(this.focusedFoe, top, colH);
    }
    this.renderScrubber(gutterX + gutterW / 2, top, colH);
    renderActionBar(this, this.W, this.H, this.footerButtons());

    if (isOutcomeStep) {
      // The result overlay is a LAYER over the board, so give it an explicit
      // depth instead of relying on draw order, and make the scrim opaque
      // enough that card text underneath stops reading through it.
      const D = OUTCOME_DEPTH;
      this.add.rectangle(deckX, top, this.W - 20, colH, 0x05070c, 0.93)
        .setOrigin(0, 0).setStrokeStyle(1, 0xb78a46, 0.35).setDepth(D);
      const good = this.outcome === 'VICTORY';
      const by = top + colH / 2 - 26;
      const summaryRows = this.combatSummary.cards.filter((row) => row.damage > 0 || row.shield > 0 || row.healing > 0 || row.dots > 0);
      const summaryColumns = 2;
      const summaryRowH = 34;
      const summaryH = 74 + Math.max(1, Math.ceil(summaryRows.length / summaryColumns)) * summaryRowH;
      const summaryBy = by - summaryH - 8;
      this.add.rectangle(deckX, summaryBy, this.W - 20, summaryH, 0x101a2a, 0.96)
        .setOrigin(0, 0).setStrokeStyle(1, 0xb78a46, 0.8).setDepth(D);
      this.add.text(deckX + 12, summaryBy + 8, 'BATTLE LEDGER', { fontSize: '11px', color: '#e8b446', fontFamily: FONT.body, fontStyle: 'bold' }).setDepth(D);
      this.add.text(this.W - 30, summaryBy + 8, `${summaryRows.length} EFFECTIVE CARDS`, { fontSize: '9px', color: '#8a94a6', fontFamily: FONT.body, fontStyle: 'bold' }).setOrigin(1, 0).setDepth(D);
      this.add.rectangle(deckX + 10, summaryBy + 27, this.W - 40, 1, 0x2a3a52).setOrigin(0, 0).setDepth(D);
      const totalMetrics = [
        this.combatSummary.playerDamage > 0 ? `YOU DMG ${this.combatSummary.playerDamage}` : '',
        this.combatSummary.enemyDamage > 0 ? `FOE DMG ${this.combatSummary.enemyDamage}` : '',
        this.combatSummary.playerHealing > 0 ? `HEAL ${this.combatSummary.playerHealing}` : '',
      ].filter(Boolean).join('  ·  ');
      this.boundedText(deckX + 12, summaryBy + 33, totalMetrics || 'No measurable output', { fontSize: '10px', color: '#cdd4de', fontFamily: FONT.body, fontStyle: 'bold' }, this.W - 44).setDepth(D);
      this.add.text(deckX + 12, summaryBy + 52, 'CARD OUTPUT', { fontSize: '9px', color: '#8a94a6', fontFamily: FONT.body, fontStyle: 'bold' }).setDepth(D);
      summaryRows.forEach((row, index) => {
        const col = index % summaryColumns;
        const rowIndex = Math.floor(index / summaryColumns);
        const cellW = (this.W - 40) / summaryColumns;
        const cellX = deckX + 10 + col * cellW;
        const y = summaryBy + 66 + rowIndex * summaryRowH;
        const prefix = row.side === 'player' ? 'YOU' : 'FOE';
        const accent = row.side === 'player' ? 0x315f43 : 0x6c3838;
        this.add.rectangle(cellX, y, cellW - 6, 27, accent, 0.42).setOrigin(0, 0).setStrokeStyle(1, row.side === 'player' ? 0x4f9e57 : 0xb0483c, 0.55).setDepth(D);
        this.boundedText(cellX + 6, y + 3, `${prefix} · ${row.name}`, { fontSize: '9px', color: '#e8e0c8', fontFamily: FONT.body, fontStyle: 'bold' }, cellW - 18).setDepth(D);
        const metrics = [
          row.damage > 0 ? `DMG ${row.damage}` : '',
          row.shield > 0 ? `SHD ${row.shield}` : '',
          row.healing > 0 ? `HEAL ${row.healing}` : '',
          row.dots > 0 ? `DOT ${row.dots}` : '',
        ].filter(Boolean).join('  ·  ');
        this.boundedText(cellX + 6, y + 15, metrics, { fontSize: '9px', color: '#e8b446', fontFamily: FONT.body }, cellW - 18).setDepth(D);
      });
      const bannerH = getBattleContext() === 'run' ? 66 : 52;
      this.add.rectangle(deckX, by, this.W - 20, bannerH, good ? 0x143a1a : 0x3a1414, 0.92).setOrigin(0, 0).setStrokeStyle(2, good ? 0x4f9e57 : 0xb0483c).setDepth(D);
      this.add.text(this.W / 2 - 10, by + 26, this.outcome, { fontSize: '26px', color: good ? '#7fe08a' : '#f08a7a', fontFamily: FONT.display, fontStyle: 'bold' }).setOrigin(1, 0.5).setDepth(D);
      this.add.text(this.W / 2 + 6, by + 30, `+${this.goldPayout} GOLD`, { fontSize: '11px', color: '#e8b446', fontFamily: FONT.body, fontStyle: 'bold' }).setOrigin(0, 0.5).setDepth(D);
      if (getBattleContext() === 'run') {
        // The hero levels after EVERY fight, win or lose (locked design) —
        // `resolveRunBattleResult` already applied it before this renders.
        this.add.text(this.W / 2, by + 50, `LEVEL UP → LV ${currentHeroLevel()} · ${currentBankedPL()} PL BANKED`, {
          fontSize: '10px', color: '#c69948', fontFamily: FONT.body, fontStyle: 'bold',
        }).setOrigin(0.5).setDepth(D);
      }
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
