import Phaser from 'phaser';
import type { SkillDef } from '../../engine/types';
import {
  buildBattleTimeline, shieldPoolsLabel,
  type BattleTimelineInput,
  type CombatSummary, type FoeModel, type HpSnap, type LogLine, type PlaybackStep, type ShieldSnap, type SpeedSnap, type TurnFx,
} from '../battleTimeline';
import { fetchBattleLog } from '../battleApi';
import { creditBattleGold } from '../battleGold';
import { getBattleContext, getBattleTimelineInput } from '../battleContext';
import { currentBankedPL, currentHeroLevel, resolveRunBattleResult } from '../runStore';
import type { BattleLog } from '../../run/resolveBattle';
import { recipeForIdentity, fxTierFor, type FxRecipe, type FxTier } from '../ui/battleFxSpec';
import { MOBILE_PROFILE } from '../layoutProfile';
import { FONT, SCREEN, UI } from '../theme';
import { playSfx } from '../audio/sfxSynth';
import { BoardColumn, type ColumnPiece } from '../ui/BoardColumn';
import { footerY, renderActionBar, type ActionButton } from '../ui/ActionBar';
import { addHoverTipZone, attachHoverTip } from '../ui/hoverTip';
import { STAT_LABELS, statHoverEntry } from '../ui/statGlossary';
import type { ScalingStats } from '../ui/skillPresentation';

const F = MOBILE_PROFILE.font;

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
  /** The step `idx` the victory/defeat stinger already played for (-1 = not
   * yet) — guards it to exactly once on forward arrival at `outcomeStep`,
   * never on a re-render or a scrub back onto that same step. Reset on
   * REPLAY (see `footerButtons`) and a fresh fight (`create`). */
  private outcomeSoundStep = -1;
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
  private summaryByStep: CombatSummary[] = [];
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
  /** SUMMARY panel manual override — same tri-state idiom as Desktop's:
   * `null` = auto (visible only once playback reaches `outcomeStep`), `true`/
   * `false` = pinned open/closed by the player. This scene has no separate
   * `init()` — every re-render goes through this class's own `render()`,
   * which never touches this field, so it survives every scrub/playback tick
   * for free; it IS reset in `create()` (a genuinely new fight, mirroring
   * `focusedFoe`/`autoFollow` above) since a fresh fight should start from
   * the same auto default rather than inherit the last fight's pin. */
  private summaryOverride: boolean | null = null;

  constructor() { super('MobileBattle'); }

  create(): void {
    this.W = SCREEN.width; this.H = SCREEN.height;
    this.cameras.main.setBackgroundColor(0x0b1420);
    this.focusedFoe = 0;
    this.autoFollow = true;
    this.lastFocusedFoe = -1;
    this.outcomeSoundStep = -1;
    this.goldCreditedLog = null;
    this.goldPayout = 0;
    this.summaryOverride = null;
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
      fontSize: `${F.body}px`, color: UI.textMuted, fontFamily: FONT.body,
      align: 'center', wordWrap: { width: this.W - 60 }, lineSpacing: 4,
    }).setOrigin(0.5);
  }

  /** The prep info this fight resolves from — demoState in Sandbox, the
   * active run's current combat node in Run Mode (see `battleContext.ts`). */
  private fightInput(): BattleTimelineInput {
    return getBattleTimelineInput();
  }

  /** Footer buttons: Sandbox is PREP / REPLAY / speed / SUMMARY / END; Run
   * Mode is REPLAY / speed / SUMMARY / CONTINUE › (no PREP — nothing to
   * return to mid-run; no END — CONTINUE both finishes playback and moves
   * the run on). `summaryVisible` is THIS render's effective visibility
   * (auto-at-outcome or manually overridden) — the button flips whatever is
   * currently showing. */
  private footerButtons(summaryVisible: boolean): ActionButton[] {
    const replay: ActionButton = { label: 'REPLAY', onPress: () => { this.stopPlayback(); this.idx = 0; this.outcomeSoundStep = -1; this.render(); this.startPlayback(); } };
    const speed: ActionButton = {
      label: this.speedMult === 1 ? '×1' : this.speedMult === 2 ? '×2' : '×½',
      onPress: () => {
        // Cycle ×1 → ×2 → ×½ → ×1. Takes effect on the next scheduled step.
        this.speedMult = this.speedMult === 1 ? 2 : this.speedMult === 2 ? 0.5 : 1;
        this.render();
      },
    };
    const summary: ActionButton = {
      label: 'SUMMARY', highlight: summaryVisible,
      onPress: () => { this.summaryOverride = !summaryVisible; this.render(); },
    };
    if (getBattleContext() === 'run') {
      return [replay, speed, summary, { label: 'CONTINUE ›', primary: true, onPress: () => this.scene.start('MobileRunMap') }];
    }
    // The primary slot is stage-aware: END fast-forwards playback, then
    // becomes the way OUT once the outcome is on screen.
    const atEnd = this.idx >= this.steps.length - 1;
    return [
      { label: 'PREP', onPress: () => this.scene.start('MobilePrep') },
      replay,
      speed,
      summary,
      atEnd
        ? { label: 'BACK TO PREP ›', primary: true, onPress: () => this.scene.start('MobilePrep') }
        : { label: 'END', primary: true, onPress: () => { this.stopPlayback(); this.idx = this.steps.length - 1; this.render(); } },
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
    this.summaryByStep = model.summaryByStep;
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
    // Victory/defeat stinger — fires exactly once, the moment playback
    // ARRIVES at the outcome step going forward (auto-play, one step-forward,
    // or the END fast-forward); never on a re-render of the same step or a
    // scrub backward onto it.
    const arrivedForward = prevIdx === -1 || this.idx > prevIdx;
    if (this.idx === this.outcomeStep && arrivedForward && this.outcomeSoundStep !== this.idx) {
      this.outcomeSoundStep = this.idx;
      playSfx(this.outcome === 'VICTORY' ? 'victory' : 'defeat');
    }
    // Default: auto-visible only once playback reaches the outcome (the
    // existing "payoff" behavior, unchanged), hidden while scrubbing
    // mid-fight. `summaryOverride` lets the player pin it open (to read the
    // live running ledger at ANY step) or closed (to dismiss it at the end).
    const summaryVisible = this.summaryOverride === null ? isOutcomeStep : this.summaryOverride;

    // ---- LOG dock (top) — small, ~4-5 rows like the mockup; the boards below
    // take the majority of the screen. Tap a HIT to expand its D: math. ----
    const dockH = 158;
    this.add.rectangle(0, 0, this.W, dockH, 0x101a2a).setOrigin(0, 0).setStrokeStyle(2, 0xb78a46, 0.9);
    // Turnline (mockup): "T3   Hero 18 · SPD +16  ·  Bandit 25 · SPD +15"
    const spd = this.speedByTurn.get(turn) ?? { player: '', enemy: '' };
    this.add.text(12, 8, `T${turn}${!isOutcomeStep && this.playing ? ' ▶' : ''}`, { fontSize: `${F.name}px`, color: '#b78a46', fontFamily: FONT.body, fontStyle: 'bold' });
    const turnStats = [
      spd.player && `${this.heroName} ${spd.player}`,
      ...this.foes.map((f, u) => {
        const line = spd.enemyUnits?.[u] ?? (u === 0 ? spd.enemy : '');
        return line && `${f.name} ${line}`;
      }),
    ].filter(Boolean).join('   ·   ');
    if (turnStats) this.boundedText(66, 9, turnStats, { fontSize: `${F.label}px`, color: '#cdd4de', fontFamily: FONT.body }, this.W - 78);
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
      if (t !== prevTurn) this.add.text(turnX, ly + 2, `T${t}`, { fontSize: `${F.tiny}px`, color: '#5a6a82', fontFamily: FONT.body, fontStyle: 'bold' });
      prevTurn = t;
      this.boundedText(tagX, ly, line.tag, { fontSize: `${F.label}px`, color: TAG_COLOR[line.tag] ?? UI.textDim, fontFamily: FONT.body, fontStyle: 'bold' }, textX - tagX - 6);
      const textMaxW = this.W - textX - (line.detail ? 26 : 14);
      this.boundedText(textX, ly, line.text, { fontSize: `${F.body}px`, color: UI.textBright, fontFamily: FONT.body }, textMaxW);
      if (line.detail) {
        this.add.text(this.W - 12, ly, this.expanded.has(key) ? '▲' : '▾', { fontSize: `${F.small}px`, color: UI.textMuted, fontFamily: FONT.body }).setOrigin(1, 0);
        const zone = this.add.rectangle(0, ly - 3, this.W, rowH, 0xffffff, 0.001).setOrigin(0, 0).setInteractive({ useHandCursor: true });
        zone.on('pointerdown', () => { if (this.expanded.has(key)) this.expanded.delete(key); else this.expanded.add(key); this.render(); });
        // HIT rows ALSO get a hover (desktop) tip reading the same D: string —
        // a second affordance for the math strip specifically. Status rows
        // (BUFF/DEBUFF — guard/buff/debuff/expose/negate) rely on tap/click-to-
        // expand ONLY, no hover, per the locked both-platforms tap idiom.
        if (line.tag === 'HIT') {
          attachHoverTip(this, zone, { x: 0, y: ly - 3, w: this.W, h: rowH }, [{ title: `${line.tag} — how this was reached`, body: line.detail }]);
        }
      }
      ly += rowH;
      if (line.detail && this.expanded.has(key) && ly < dockH - 12) {
        const d = this.boundedText(textX, ly, line.detail, { fontSize: `${F.small}px`, color: UI.textMuted, fontFamily: FONT.body }, this.W - textX - 14);
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
      shieldPoolsLabel(shield.playerPools),
    );
    this.boundedText(120, hpY + 17, this.heroStatLine, { fontSize: `${F.tiny}px`, color: '#7a8699', fontFamily: FONT.body }, this.W - 120 - 84);
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
      const foePools = shield.enemiesPools?.[u] ?? (u === 0 ? shield.enemyPools : undefined);
      foeBars[u] = this.hpBar(
        barY, foeModel.name, foeHp, foeMax, foeShield, UI.bad ?? 0xb0483c, foeStatus,
        animate ? { hp: prevFoeHp ?? foeHp, shield: prevFoeShield ?? foeShield } : undefined,
        shieldPoolsLabel(foePools),
      );
      this.boundedText(120, barY + 17, foeModel.statLine, { fontSize: `${F.tiny}px`, color: '#7a8699', fontFamily: FONT.body }, this.W - 120 - 84);
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
          fontSize: `${F.tiny}px`, color: dead ? '#5a6a82' : isActive ? UI.textBright : UI.textFootnote, fontFamily: FONT.body, fontStyle: 'bold',
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
      this.add.text(ax + autoW / 2, tabY + tabH / 2, 'AUTO', { fontSize: `${F.tiny}px`, color: this.autoFollow ? UI.textOnChip : UI.textFootnote, fontFamily: FONT.body, fontStyle: 'bold' }).setOrigin(0.5);
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
        // Archetype × element/weapon recipe for this fx's source card (undefined
        // for un-attributed damage, e.g. DoT ticks — those keep the ailment
        // color fallback below), and the amount's importance tier (bigger hits
        // read bigger/bolder, only the top tier flashes).
        const recipe = recipeForIdentity(fx.archetype, fx.property, fx.element, fx.weapon);
        const tier = fxTierFor(fx.amount);
        if (fx.kind === 'damage') {
          if (bar) this.shakeBar(bar.shakeTargets);
          // DoT ticks float in their ailment's color (poison green, burn orange…)
          const dmgColor = fx.source ? (AILMENT_COLOR[fx.source] ?? '#d05c4e') : (recipe?.palette.color ?? '#d05c4e');
          this.spawnFxFloat(anchor.x, anchor.y, `−${fx.amount}`, dmgColor, tier);
          // fx.source is set for un-attributed damage (poison/burn/bleed/
          // fatigue/attrition ticks) — those get one shared "tick" cue;
          // a skill hit's own property picks its impact voice.
          playSfx(fx.source ? 'dotTick' : fx.property === 'magical' ? 'hitMagical' : fx.property === 'true' ? 'hitTrue' : 'hitPhysical');
        } else if (fx.kind === 'heal') {
          // Anti-heal world rule tax — visibly taxed float: the sickly
          // (debuff/expose) tint carries a small "−N%" suffix so a reduced
          // heal never reads as a plain, un-taxed number.
          this.spawnFxFloat(anchor.x, anchor.y, `+${fx.amount}`, recipe?.palette.color ?? '#5fb56a', tier,
            fx.antiHealPct ? `−${fx.antiHealPct}%` : undefined);
          playSfx('heal');
        } else if (fx.kind === 'shield') {
          this.spawnFxFloat(anchor.x, anchor.y, `+${fx.amount}`, recipe?.palette.color ?? '#5fa8d3', tier);
          playSfx('shieldGain');
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
    if (forwardStep && slots.player !== undefined) this.pulseTokenAt(heroCol, this.heroPieces, slots.player, this.castFxFor('player', 0));
    // Enemy boards: 1–2 foes stack vertically in the right column; 3+ foes
    // show only the FOCUSED foe's board (the tab strip covers the rest).
    const foeBoard = (u: number, boardTop: number, boardH: number): void => {
      const foeModel = this.foes[u]!;
      const foeSlot = slots.enemyUnits?.[u] ?? (u === 0 ? slots.enemy : undefined);
      const foeCol = new BoardColumn(this, {
        x: bagX, y: boardTop, width: colW, height: boardH, side: 'right',
        pieces: mark(foeModel.pieces, foeSlot), deck: foeModel.skills, stats: foeModel.stats,
      });
      if (forwardStep && foeSlot !== undefined) this.pulseTokenAt(foeCol, foeModel.pieces, foeSlot, this.castFxFor('enemy', u));
    };
    if (!tabbed) {
      const nFoes = Math.max(1, this.foes.length);
      const subH = (colH - (nFoes - 1) * 8) / nFoes;
      this.foes.forEach((_, u) => foeBoard(u, top + u * (subH + 8), subH));
    } else {
      foeBoard(this.focusedFoe, top, colH);
    }
    this.renderScrubber(gutterX + gutterW / 2, top, colH);
    renderActionBar(this, this.W, this.H, this.footerButtons(summaryVisible));

    if (summaryVisible) {
      // The summary overlay is a LAYER over the board, so give it an explicit
      // depth instead of relying on draw order, and make the scrim opaque
      // enough that card text underneath stops reading through it. At the
      // true outcome it's a banner + ledger (the existing payoff); pinned
      // open mid-fight (via SUMMARY) it's JUST the ledger, AS OF the current
      // step — there's no VICTORY/DEFEAT to show yet.
      const D = OUTCOME_DEPTH;
      this.add.rectangle(deckX, top, this.W - 20, colH, 0x05070c, 0.93)
        .setOrigin(0, 0).setStrokeStyle(1, 0xb78a46, 0.35).setDepth(D);
      const good = this.outcome === 'VICTORY';
      // The ledger reflects the CURRENT scrub position — `summaryByStep[idx]`
      // — not the fight's final totals, so a mid-fight peek reads the
      // running tally as of this exact step.
      const summary = this.summaryByStep[this.idx] ?? this.combatSummary;
      const summaryRows = summary.cards;
      const summaryColumns = 2;
      const summaryRowH = 34;
      const summaryH = 74 + Math.max(1, Math.ceil(summaryRows.length / summaryColumns)) * summaryRowH;
      const bannerH = isOutcomeStep ? (getBattleContext() === 'run' ? 66 : 52) : 0;
      const bannerGap = isOutcomeStep ? 8 : 0;
      const blockH = summaryH + bannerGap + bannerH;
      const summaryBy = top + (colH - blockH) / 2;
      const by = summaryBy + summaryH + bannerGap;
      this.add.rectangle(deckX, summaryBy, this.W - 20, summaryH, 0x101a2a, 0.96)
        .setOrigin(0, 0).setStrokeStyle(1, 0xb78a46, 0.8).setDepth(D);
      this.add.text(deckX + 12, summaryBy + 8, 'BATTLE LEDGER', { fontSize: `${F.label}px`, color: '#e8b446', fontFamily: FONT.body, fontStyle: 'bold' }).setDepth(D);
      // "AS OF" marker makes it unmistakable this is a running tally, not the
      // final one, whenever this panel is showing mid-fight.
      const cardsLabel = isOutcomeStep ? `${summaryRows.length} EFFECTIVE CARDS` : `${summaryRows.length} CARDS · AS OF T${turn}`;
      this.add.text(this.W - 30, summaryBy + 8, cardsLabel, { fontSize: `${F.tiny}px`, color: UI.textMuted, fontFamily: FONT.body, fontStyle: 'bold' }).setOrigin(1, 0).setDepth(D);
      this.add.rectangle(deckX + 10, summaryBy + 27, this.W - 40, 1, 0x2a3a52).setOrigin(0, 0).setDepth(D);
      const totalMetrics = [
        summary.playerDamage > 0 ? `YOU DMG ${summary.playerDamage}` : '',
        summary.enemyDamage > 0 ? `FOE DMG ${summary.enemyDamage}` : '',
        summary.playerHealing > 0 ? `HEAL ${summary.playerHealing}` : '',
      ].filter(Boolean).join('  ·  ');
      this.boundedText(deckX + 12, summaryBy + 33, totalMetrics || 'No measurable output', { fontSize: `${F.small}px`, color: '#cdd4de', fontFamily: FONT.body, fontStyle: 'bold' }, this.W - 44).setDepth(D);
      this.add.text(deckX + 12, summaryBy + 52, isOutcomeStep ? 'CARD OUTPUT' : `CARD OUTPUT · AS OF T${turn}`, { fontSize: `${F.tiny}px`, color: UI.textMuted, fontFamily: FONT.body, fontStyle: 'bold' }).setDepth(D);
      summaryRows.forEach((row, index) => {
        const col = index % summaryColumns;
        const rowIndex = Math.floor(index / summaryColumns);
        const cellW = (this.W - 40) / summaryColumns;
        const cellX = deckX + 10 + col * cellW;
        const y = summaryBy + 66 + rowIndex * summaryRowH;
        const prefix = row.side === 'player' ? 'YOU' : 'FOE';
        const accent = row.side === 'player' ? 0x315f43 : 0x6c3838;
        this.add.rectangle(cellX, y, cellW - 6, 27, accent, 0.42).setOrigin(0, 0).setStrokeStyle(1, row.side === 'player' ? 0x4f9e57 : 0xb0483c, 0.55).setDepth(D);
        this.boundedText(cellX + 6, y + 3, `${prefix} · ${row.name}`, { fontSize: `${F.tiny}px`, color: UI.textBright, fontFamily: FONT.body, fontStyle: 'bold' }, cellW - 18).setDepth(D);
        const metrics = [
          row.damage > 0 ? `DMG ${row.damage}` : '',
          row.shield > 0 ? `SHD ${row.shield}` : '',
          row.healing > 0 ? `HEAL ${row.healing}` : '',
          row.dots > 0 ? `DOT ${row.dots}` : '',
        ].filter(Boolean).join('  ·  ');
        this.boundedText(cellX + 6, y + 15, metrics, { fontSize: `${F.tiny}px`, color: '#e8b446', fontFamily: FONT.body }, cellW - 18).setDepth(D);
      });
      if (isOutcomeStep) {
        this.add.rectangle(deckX, by, this.W - 20, bannerH, good ? 0x143a1a : 0x3a1414, 0.92).setOrigin(0, 0).setStrokeStyle(2, good ? 0x4f9e57 : 0xb0483c).setDepth(D);
        this.add.text(this.W / 2 - 10, by + 26, this.outcome, { fontSize: '26px', color: good ? '#7fe08a' : '#f08a7a', fontFamily: FONT.display, fontStyle: 'bold' }).setOrigin(1, 0.5).setDepth(D);
        this.add.text(this.W / 2 + 6, by + 30, `+${this.goldPayout} GOLD`, { fontSize: `${F.label}px`, color: '#e8b446', fontFamily: FONT.body, fontStyle: 'bold' }).setOrigin(0, 0.5).setDepth(D);
        if (getBattleContext() === 'run') {
          // The hero levels after EVERY fight, win or lose (locked design) —
          // `resolveRunBattleResult` already applied it before this renders.
          this.add.text(this.W / 2, by + 50, `LEVEL UP → LV ${currentHeroLevel()} · ${currentBankedPL()} PL BANKED`, {
            fontSize: `${F.small}px`, color: UI.textAccent, fontFamily: FONT.body, fontStyle: 'bold',
          }).setOrigin(0.5).setDepth(D);
        }
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
    this.add.text(cx, yFor(this.idx) + 15, `T${this.steps[this.idx]?.turn ?? this.turns[0] ?? 1}`, { fontSize: `${F.tiny}px`, color: '#e8b446', fontFamily: FONT.body, fontStyle: 'bold' }).setOrigin(0.5, 0);
    const zone = this.add.rectangle(cx, top, 40, railLen || 20, 0xffffff, 0.001).setOrigin(0.5, 0).setInteractive({ useHandCursor: true });
    const setFromY = (y: number): void => {
      const i = railLen <= 0 ? 0 : Math.round(Math.max(0, Math.min(1, (y - top) / railLen)) * (n - 1));
      if (i !== this.idx) { this.idx = i; this.render(); }
    };
    zone.on('pointerdown', (p: Phaser.Input.Pointer) => { this.stopPlayback(); setFromY(p.worldY); });
    zone.on('pointermove', (p: Phaser.Input.Pointer) => { if (p.isDown) setFromY(p.worldY); });
  }

  /**
   * `prev`, when given (forward-step only), makes the fill/shield rects tween
   * from the previous turn's fraction to the current one instead of snapping.
   */
  private hpBar(
    y: number, name: string, hp: number, max: number, shield: number, color: number,
    ailments: string[],
    prev?: { hp: number; shield: number },
    /** "20 P · 30 M" — present only once >1 shield pool is nonzero, so a
     * stacked physical+magical shield never reads as one merged number. */
    poolsLabel?: string,
  ): HpBarHandles {
    const barX = 120; const barW = this.W - barX - 84;
    const frac = (v: number): number => barW * Math.max(0, Math.min(1, v / max));
    const nameText = this.boundedText(12, y, name.toUpperCase(), { fontSize: `${F.body}px`, color: UI.textBright, fontFamily: FONT.body, fontStyle: 'bold' }, barX - 20);
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

    const hpText = this.add.text(this.W - 12, y, `${hp}/${max}`, { fontSize: `${F.body}px`, color: UI.textBright, fontFamily: FONT.body, fontStyle: 'bold' }).setOrigin(1, 0);
    // Shield as a floating number in the strip's blue — no emoji (tofu in canvas fonts).
    // When more than one shield pool is stacked, break the total out by pool
    // (physical/magical/true) instead of one merged number.
    const shieldLabel = shield > 0 ? (poolsLabel ? `+${shield} (${poolsLabel})` : `+${shield}`) : '';
    const shieldText = shield > 0 ? this.add.text(hpText.x - hpText.width - 6, y, shieldLabel, { fontSize: `${F.label}px`, color: '#5fa8d3', fontFamily: FONT.body, fontStyle: 'bold' }).setOrigin(1, 0) : undefined;

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

  /**
   * Floating "-N"/"+N" text over an HP bar — pops in with an overshoot
   * (Back.easeOut), briefly flashes on the top FX tier only, then floats up +
   * fades. Font size/weight scale with `tier`. Every stage self-destroys into
   * the next; the final stage destroys the text object — nothing lingers, and
   * a fresh render() already kills in-flight tweens + destroys the previous
   * frame's objects before this ever runs again (see top of `render()`).
   */
  private spawnFxFloat(x: number, y: number, text: string, color: string, tier: FxTier, taxSuffix?: string): void {
    const fontSize = Math.round(F.lead * tier.fontScale);
    const fx = x + (Math.random() * 24 - 12);
    const t = this.add
      .text(fx, y - 4, text, {
        fontSize: `${fontSize}px`,
        color,
        fontFamily: FONT.body,
        fontStyle: tier.bold ? 'bold' : 'normal',
      })
      .setOrigin(0.5)
      .setDepth(30)
      .setScale(0.5);
    // Anti-heal world rule tax — a small sickly-tinted "−N%" riding just past
    // the number, so a taxed heal never reads as a plain, un-taxed one. Same
    // transient lifecycle as the number itself (pop/float/fade together,
    // both destroyed at the end) — no separate cleanup path to leak.
    const suffix = taxSuffix
      ? this.add.text(fx + t.width / 2 + 3, y - 4, taxSuffix, {
          fontSize: `${F.tiny}px`, color: AILMENT_COLOR.expose ?? '#a678d8', fontFamily: FONT.body, fontStyle: 'bold',
        }).setOrigin(0, 0.5).setDepth(30).setScale(0.5)
      : undefined;
    const targets: Phaser.GameObjects.Text[] = suffix ? [t, suffix] : [t];
    const floatUp = (): void => {
      this.tweens.add({
        targets, y: '-=26', alpha: 0, duration: 320, ease: 'Quad.easeOut',
        onComplete: () => { t.destroy(); suffix?.destroy(); },
      });
    };
    this.tweens.add({
      targets, scale: 1, duration: 110, ease: 'Back.easeOut',
      onComplete: () => {
        if (tier.flash) {
          this.tweens.add({
            targets, alpha: 0.2, duration: 30, yoyo: true, repeat: 1, ease: 'Sine.easeInOut',
            onComplete: floatUp,
          });
        } else {
          floatUp();
        }
      },
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
   * Scale-pulse (1.0 → 1.04 → 1.0) the CardToken at `slot` in `col` — or, when
   * `cast` resolves to a full archetype × element/weapon recipe, the richer
   * `castTokenFx` flourish instead. Replicates BoardColumn's own row-
   * consumption loop (a size-N piece occupies N rows but renders exactly one
   * token) to find that piece's token without BoardColumn needing to expose
   * one — battle scene stays a pure playback head over data it already owns
   * (`pieces`), not a peek into BoardColumn internals.
   */
  private pulseTokenAt(col: BoardColumn, pieces: ColumnPiece[], slot: number, cast?: TurnFx, slotCount = 10): void {
    const bySlot = new Map<number, ColumnPiece>();
    for (const p of pieces) bySlot.set(p.slot, p);
    let row = 0; let tokenIdx = 0;
    while (row < slotCount) {
      const piece = bySlot.get(row);
      const span = piece ? Math.max(1, piece.skill.size) : 1;
      if (piece && row === slot) {
        const token = col.tokens[tokenIdx];
        if (token) {
          const recipe = cast ? recipeForIdentity(cast.archetype, cast.property, cast.element, cast.weapon) : undefined;
          if (recipe) {
            this.castTokenFx(token, recipe, cast?.cardName ?? piece.skill.name);
            if (cast?.archetype) playSfx(`cast:${cast.archetype}`);
          } else {
            token.setScale(1);
            this.tweens.add({ targets: token, scale: 1.04, duration: 125, yoyo: true, ease: 'Sine.InOut' });
          }
        }
        return;
      }
      tokenIdx += 1;
      row += span;
    }
  }

  /** This step's `cast` fx for `(side, unit)` — the card just played there,
   * if any (queued onto the step of its own first effect; see
   * `battleTimeline.ts`'s `pendingCastFx`). Drives `castTokenFx` below. */
  private castFxFor(side: 'player' | 'enemy', unit: number): TurnFx | undefined {
    return (this.fxByStep[this.idx] ?? []).find((fx) => fx.kind === 'cast' && fx.side === side && (fx.unit ?? 0) === unit);
  }

  /**
   * A card PLAY's archetype × element/weapon flourish on its board token: a
   * scale/rotation pulse shaped by the archetype's `MotionProfile` (offense
   * punches, defensive braces, healing rises, support shimmers, debuff sinks/
   * flickers), a brief palette-colored flash over the token, and the card
   * name floating off in the same motion. Every tween destroys its own
   * target on completion; a fresh render() already kills in-flight tweens +
   * destroys the previous frame's objects first (see top of `render()`), so
   * nothing orphans on a scrub/rebuild mid-animation.
   */
  private castTokenFx(token: Phaser.GameObjects.Container, recipe: FxRecipe, cardName: string): void {
    const { motion, palette } = recipe;
    const w = token.width || 60;
    const h = token.height || 40;
    token.setScale(1);
    token.setAngle(0);
    this.tweens.add({
      targets: token, scale: motion.scalePeak, duration: motion.activeMs, ease: motion.easeIn,
      yoyo: true, hold: motion.holdMs,
      onComplete: () => token.setScale(1),
    });
    if (motion.angleJitterDeg > 0) {
      this.tweens.add({
        targets: token, angle: motion.angleJitterDeg, duration: Math.max(40, motion.activeMs / 2),
        yoyo: true, ease: 'Sine.easeInOut',
        onComplete: () => token.setAngle(0),
      });
    }
    const flashCycles = Math.max(1, motion.pulses);
    const flash = this.add.rectangle(token.x, token.y, w, h, palette.colorNum, 0.45).setDepth(29);
    this.tweens.add({
      targets: flash, alpha: 0, duration: 70, ease: motion.easeOut,
      yoyo: flashCycles > 1, repeat: flashCycles - 1,
      onComplete: () => flash.destroy(),
    });
    const nameText = this.add.text(token.x, token.y - h / 2 - 4, cardName, {
      fontSize: `${F.label}px`, color: palette.color, fontFamily: FONT.body, fontStyle: 'bold',
    }).setOrigin(0.5, 1).setDepth(31).setAlpha(0);
    this.tweens.add({
      targets: nameText, alpha: 1, duration: 100, ease: 'Sine.easeOut',
      onComplete: () => {
        this.tweens.add({
          targets: nameText, y: nameText.y + motion.driftY, alpha: 0,
          duration: 280, delay: motion.holdMs, ease: motion.easeOut,
          onComplete: () => nameText.destroy(),
        });
      },
    });
  }
}
