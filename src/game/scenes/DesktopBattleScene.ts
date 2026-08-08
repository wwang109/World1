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
import { currentBankedPL, currentHeroLevel, getActiveRun, resolveRunBattleResult } from '../runStore';
import type { BattleLog } from '../../run/resolveBattle';
import { recipeForIdentity, fxTierFor, type FxRecipe, type FxTier } from '../ui/battleFxSpec';
import { DESKTOP_PROFILE } from '../layoutProfile';
import { FONT, SCREEN, UI } from '../theme';
import { playSfx } from '../audio/sfxSynth';
import { renderDesktopBackground } from '../ui/DesktopNav';
import { BoardColumn, type ColumnPiece } from '../ui/BoardColumn';
import { addHoverTipZone, attachHoverTip } from '../ui/hoverTip';
import { STAT_LABELS, statHoverEntry } from '../ui/statGlossary';
import type { ScalingStats } from '../ui/skillPresentation';
import { renderRunStatsStrip, snapshotRunProgress } from '../ui/RunProgressStrip';
import { runScreenLayout } from '../ui/runScreenLayout';

/** Hover copy for every stat shown on a battle statline, in one shared tip. */
const ALL_STAT_ENTRIES = STAT_LABELS.map(statHoverEntry);
/** Hover copy for the turnline — read once, shown on every render. */
const TURNLINE_ENTRY = { title: 'Turn order', body: 'Each side’s turn score is banked readiness + Speed − the queued card’s weight; higher performs. The loser banks their Speed for next time. A size-N card busies its caster N−1 extra turns.' };

const F = DESKTOP_PROFILE.font;

/** Everything a rendered HP bar hands back so FX can target it after the fact. */
interface HpBarHandles {
  fillRect: Phaser.GameObjects.Rectangle;
  shieldRect: Phaser.GameObjects.Rectangle;
  shakeTargets: Array<Phaser.GameObjects.Text | Phaser.GameObjects.Rectangle>;
  floatX: number;
  floatY: number;
}

// DEBUFF ("an effect was just APPLIED to you") vs EFFECT ("that effect is
// DEALING DAMAGE right now") are deliberately split into their own tags AND
// colors (2026-08 log-clarity pass) — before this they shared one tag/color
// and a fresh "Poison 5" application read identically to a "Poison -5" tick.
// EFFECT gets a color in neither the HIT (red/coral) nor the DEBUFF (rose)
// family, and outside the per-ailment palette below (poison green / burn
// orange / bleed red / stun tan / expose purple) so the TAG itself never
// implies one specific ailment — the floating combat numbers already carry
// that per-ailment color via AILMENT_COLOR.
const TAG_COLOR: Record<string, string> = {
  START: '#e8b446', READY: '#5fa8d3', PLAY: '#4f9e57', HIT: '#d05c4e', BUFF: '#5fb56a',
  DEBUFF: '#d8578f', EFFECT: '#3fb6c4', WAIT: '#c9a15a', DOWN: '#d05c4e', RESULT: '#e8b446',
  // A stalemate-breaker phase change (sudden death / fatigue / attrition) is a
  // boundary in the FIGHT ITSELF, not an action — it reuses the START/RESULT
  // gold so it reads as the log's third kind of bookend, never as a regular row.
  PHASE: '#e8b446',
};
/** Ailment identity colors — used to tint the afflicted side's HP bar and its DoT tick numbers. */
const AILMENT_COLOR: Record<string, string> = { poison: '#8fbe5a', burn: '#e07a3a', bleed: '#d05c4e', stun: '#c9a15a', expose: '#a678d8' };
const AILMENT_TINT: Record<string, number> = { poison: 0x8fbe5a, burn: 0xe07a3a, bleed: 0xd05c4e, stun: 0xc9a15a, expose: 0xa678d8 };

/** Shared landscape geometry — computed once from the desktop canvas so the
 * board/log/footer regions never overlap and nothing draws past y=876. */
const GUTTER = 32;
const GAP = 12;
/**
 * Content top — read from the statsOnly chrome template (2026-08-04
 * decision, docs/design-locked.md), never hardcoded. Reserved at this SAME y
 * in Sandbox too (nothing drawn there) so the HP blocks/boards/log sit at one
 * geometry regardless of context; only whether the run-stats strip itself
 * (kicker/title('BATTLE')/stats) is drawn in the band above varies. Moving
 * this down from the previous flat 24px margin costs the foe panel/board
 * section up to ~60px of height (see `boardH` below) — unlike Mobile, which
 * protects board height by shrinking its log dock instead.
 */
// `content.y` is a TOP anchor -- invariant under the fill-the-window
// viewport (only right/bottom/centre-anchored geometry moves), so this stays
// a plain module constant.
const TOP_MARGIN = runScreenLayout('desktop', 'statsOnly').regions.content.y;
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
  /** The step `idx` the victory/defeat stinger already played for (-1 = not
   * yet) — guards it to exactly once on forward arrival at `outcomeStep`,
   * never on a re-render or a scrub back onto that same step. Reset on
   * REPLAY (see `footerButtons`) and a fresh fight (`init`). */
  private outcomeSoundStep = -1;
  private expanded = new Set<string>();
  private heroPieces: ColumnPiece[] = [];
  private heroSkills: SkillDef[] = [];
  private foes: FoeModel[] = [];
  private heroName = 'Hero';
  private heroStats: ScalingStats = { attack: 0, magicPower: 0, armor: 0, magicResist: 0 };
  private heroStatLine = '';
  private outcome = '';
  /** Both sides at 0 in the same step — tempo tiebreak decided `outcome`. */
  private mutualWipe = false;
  private combatSummary: CombatSummary = { playerDamage: 0, enemyDamage: 0, playerHealing: 0, cards: [] };
  private summaryByStep: CombatSummary[] = [];
  private outcomeStep = -1;
  private playing = true;
  private playTimer?: Phaser.Time.TimerEvent;
  /** Playback speed multiplier (0.5 = half speed). Deliberately NOT reset in
   *  init() — the player's speed choice should survive REPLAY and re-entry. */
  private speedMult = 1;
  /** SUMMARY panel manual override: `null` = auto (visible only once
   * playback reaches `outcomeStep` — the existing "payoff" behavior), `true`/
   * `false` = the player has explicitly pinned it open/closed at whatever
   * step they were on when they pressed the button. This scene doesn't use
   * the shared `rebuildScene` idiom — every scrub/playback tick calls its own
   * `render()` directly, which never touches this field — so a plain class
   * field already "survives" every re-render within a fight for free (the
   * same reason `speedMult` above needs no special handling). It IS reset in
   * `init()`, which only runs on a genuinely NEW fight (PREP → FIGHT, or a
   * fresh scene entry): a new fight should start from the same auto default
   * every time, not inherit whatever the PREVIOUS fight's toggle was left
   * on — REPLAY reuses the SAME log/instance without calling init(), so a
   * REPLAY correctly keeps whatever the player had pinned. */
  private summaryOverride: boolean | null = null;
  /** Guards the gold payout to exactly once per fetched `BattleLog` — REPLAY
   * re-renders the SAME log object (no re-fetch), so the identity check skips
   * it; a fresh scene entry (init() runs) re-fetches a new log and credits again. */
  private goldCreditedLog: BattleLog | null = null;
  private goldPayout = 0;

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
    this.outcomeSoundStep = -1;
    this.expanded = new Set();
    this.heroPieces = [];
    this.heroSkills = [];
    this.foes = [];
    this.heroName = 'Hero';
    this.heroStats = { attack: 0, magicPower: 0, armor: 0, magicResist: 0 };
    this.heroStatLine = '';
    this.outcome = '';
    this.combatSummary = { playerDamage: 0, enemyDamage: 0, playerHealing: 0, cards: [] };
    this.summaryByStep = [];
    this.outcomeStep = -1;
    this.playing = true;
    this.playTimer = undefined;
    this.goldCreditedLog = null;
    this.goldPayout = 0;
    this.summaryOverride = null;
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
    this.add.text(SCREEN.width / 2, SCREEN.height / 2, message, {
      fontSize: '16px', color: '#8a94a6', fontFamily: FONT.body,
      align: 'center', wordWrap: { width: SCREEN.width - 200 }, lineSpacing: 6,
    }).setOrigin(0.5);
  }

  /** The prep info this fight resolves from — demoState in Sandbox, the
   * active run's current combat node in Run Mode (see `battleContext.ts`). */
  private fightInput(): BattleTimelineInput {
    return getBattleTimelineInput();
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
    this.mutualWipe = model.mutualWipe;
    this.outcomeStep = model.outcomeStep;
    this.combatSummary = model.combatSummary;
    this.summaryByStep = model.summaryByStep;
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

    // ---- run-stats strip (2026-08-04 decision) — kicker/title('BATTLE')/
    // stats ONLY, drawn ONLY in run context; Sandbox reserves the identical
    // band (TOP_MARGIN, above) but draws nothing in it, so the HP blocks/
    // boards/log below sit at one geometry regardless of context. ----
    if (getBattleContext() === 'run') {
      const run = getActiveRun();
      if (run) renderRunStatsStrip(this, { snapshot: snapshotRunProgress(run), compact: false });
    }

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
    // "payoff" moment — unchanged from the old always-on-at-the-end
    // behavior), hidden while scrubbing mid-fight. `summaryOverride` lets the
    // player pin it open (to read the live running ledger at ANY step) or
    // closed (to dismiss it at the end so the board/log stay fully visible).
    const summaryVisible = this.summaryOverride === null ? isOutcomeStep : this.summaryOverride;

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
      shieldPoolsLabel(shield.playerPools),
    );
    // Full statline under the bar — the stat-sheet spend (e.g. DEF buys) must
    // be VISIBLE in battle, not only inferable from the D: math expansions.
    this.add.text(leftX, contentTop + 46, this.heroStatLine, { fontFamily: FONT.body, fontSize: `${F.small}px`, color: UI.textDim });
    addHoverTipZone(this, { x: leftX, y: contentTop + 46, w: PANEL_W, h: F.small + 4 }, ALL_STAT_ENTRIES);
    const heroCol = new BoardColumn(this, { x: leftX, y: boardTop, width: PANEL_W, height: boardH, side: 'left', pieces: mark(this.heroPieces, slots.player), deck: this.heroSkills, stats: this.heroStats });
    if (forwardStep && slots.player !== undefined) this.pulseTokenAt(heroCol, this.heroPieces, slots.player, this.castFxFor('player', 0));

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
      const foePools = shield.enemiesPools?.[u] ?? (u === 0 ? shield.enemyPools : undefined);
      foeBars[u] = this.hpBar(
        rightX, top, PANEL_W, foeModel.name, foeHp, foeMax, foeShield, UI.bad ?? 0xb0483c, foeStatus,
        animate ? { hp: prevFoeHp ?? foeHp, shield: prevFoeShield ?? foeShield } : undefined,
        shieldPoolsLabel(foePools),
      );
      this.add.text(rightX, top + 46, foeModel.statLine, { fontFamily: FONT.body, fontSize: `${F.small}px`, color: UI.textDim });
      addHoverTipZone(this, { x: rightX, y: top + 46, w: PANEL_W, h: F.small + 4 }, ALL_STAT_ENTRIES);
      const foeSlot = slots.enemyUnits?.[u] ?? (u === 0 ? slots.enemy : undefined);
      const foeCol = new BoardColumn(this, {
        x: rightX, y: top + HP_BLOCK_H, width: PANEL_W, height: height - HP_BLOCK_H, side: 'right',
        pieces: mark(foeModel.pieces, foeSlot), deck: foeModel.skills, stats: foeModel.stats,
      });
      if (animate && foeSlot !== undefined) this.pulseTokenAt(foeCol, foeModel.pieces, foeSlot, this.castFxFor('enemy', u));
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
        // Archetype × element/weapon recipe for this fx's source card (undefined
        // for un-attributed damage, e.g. DoT ticks — those keep the ailment
        // color fallback below), and the amount's importance tier (bigger hits
        // read bigger/bolder, only the top tier flashes).
        const recipe = recipeForIdentity(fx.archetype, fx.property, fx.element, fx.weapon);
        const tier = fxTierFor(fx.amount);
        if (fx.kind === 'damage') {
          if (bar) this.shakeBar(bar.shakeTargets);
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

    // ---- combat log (center column) ----
    this.renderLog(logX, contentTop, logW, contentBottom - contentTop, turn, step, isOutcomeStep);

    // ---- horizontal scrubber + footer controls ----
    this.renderScrubber(leftX, scrubberY, this.W - GUTTER * 2);
    this.renderFooter(leftX, footerY, this.W - GUTTER * 2, summaryVisible);

    if (summaryVisible) {
      this.renderOutcome(leftX, contentTop, this.W - GUTTER * 2, contentBottom - contentTop, isOutcomeStep, turn);
    }
  }

  /** Wide center-column combat log: header (turnline) + a scrolling
   * transcript (newest at bottom), tap a HIT row to expand its D: math (and
   * hover/tap it for a "how this was reached" tip reading the SAME
   * already-formatted D: string — never a recomputation). */
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
    addHoverTipZone(this, { x: x + 16, y: y + 24, w: w - 32, h: 16 }, [TURNLINE_ENTRY]);
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
        // HIT rows ALSO get a hover tip reading the same D: string — a second
        // affordance for the math strip specifically. Status rows (BUFF/DEBUFF
        // — guard/buff/debuff/expose/negate) rely on click-to-expand ONLY, no
        // hover, per the locked both-platforms tap idiom (desktop click = tap).
        if (line.tag === 'HIT') {
          attachHoverTip(this, zone, { x, y: ly - 3, w, h: rowH }, [{ title: `${line.tag} — how this was reached`, body: line.detail }]);
        }
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
    zone.on('pointerdown', (p: Phaser.Input.Pointer) => { this.stopPlayback(); setFromX(p.worldX); });
    zone.on('pointermove', (p: Phaser.Input.Pointer) => { if (p.isDown) setFromX(p.worldX); });
  }

  /** Footer buttons EXCLUDING the speed segment (drawn separately, always in
   * the middle): Sandbox is PREP / REPLAY / SUMMARY .. END; Run Mode is
   * REPLAY / SUMMARY .. CONTINUE › (no PREP — there's no sandbox prep to
   * return to mid-run; no END — CONTINUE both finishes playback and moves the
   * run on). `summaryVisible` is this render's EFFECTIVE visibility (auto or
   * overridden) — the button just flips whatever is currently showing. */
  private footerButtons(summaryVisible: boolean): Array<{ label: string; primary?: boolean; active?: boolean; onPress: () => void }> {
    const replay = { label: 'REPLAY', onPress: () => { this.stopPlayback(); this.idx = 0; this.outcomeSoundStep = -1; this.render(); this.startPlayback(); } };
    const summary = {
      label: 'SUMMARY', active: summaryVisible,
      onPress: () => { this.summaryOverride = !summaryVisible; this.render(); },
    };
    if (getBattleContext() === 'run') {
      return [replay, summary, { label: 'CONTINUE ›', primary: true, onPress: () => this.scene.start('DesktopRunMap') }];
    }
    // The primary slot is stage-aware: END fast-forwards playback, then
    // becomes the way OUT once the outcome is on screen.
    const atEnd = this.idx >= this.steps.length - 1;
    return [
      { label: 'PREP', onPress: () => this.scene.start('DesktopPrep') },
      replay,
      summary,
      atEnd
        ? { label: 'BACK TO PREP ›', primary: true, onPress: () => this.scene.start('DesktopPrep') }
        : { label: 'END', primary: true, onPress: () => { this.stopPlayback(); this.idx = this.steps.length - 1; this.render(); } },
    ];
  }

  /** Footer control row: buttons from `footerButtons()` with a speed segment
   * sandwiched between the last two — desktop draws its own buttons (the
   * shared ActionBar template is portrait-fixed). */
  private renderFooter(x: number, y: number, w: number, summaryVisible: boolean): void {
    const gap = GAP;
    const speeds: Array<[string, number]> = [['×½', 0.5], ['×1', 1], ['×2', 2]];
    const speedCellW = 56;
    const speedW = speedCellW * speeds.length + gap * (speeds.length - 1);
    const buttons = this.footerButtons(summaryVisible);
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
    // Every button but the last draws before the speed segment; the last
    // (primary) button always trails it — 4-button Sandbox (PREP, REPLAY,
    // SUMMARY .. END) and 3-button Run Mode (REPLAY, SUMMARY .. CONTINUE)
    // both fit this shape.
    for (const b of buttons.slice(0, -1)) drawButton(b.label, bw, !!b.active, !!b.primary, b.onPress);
    // Playback speed segment — the multiplier applies at the NEXT scheduled
    // step, so switching mid-playback takes effect immediately in practice.
    for (const [label, mult] of speeds) {
      drawButton(label, speedCellW, this.speedMult === mult, false, () => {
        if (this.speedMult === mult) return;
        this.speedMult = mult;
        this.render();
      });
    }
    const last = buttons[buttons.length - 1]!;
    drawButton(last.label, bw, false, !!last.primary, last.onPress);
  }

  /** Compact centered summary card: (at the true outcome) a banner + totals +
   * CARD OUTPUT grid; (mid-fight, when manually pinned via SUMMARY) just the
   * totals + grid, AS OF `turn` — no VICTORY/DEFEAT banner, since the fight
   * hasn't resolved yet. One ~640px panel over a dimming scrim — the boards/
   * log stay visible around it either way. */
  private renderOutcome(x: number, y: number, w: number, h: number, isOutcomeStep: boolean, turn: number): void {
    this.add.rectangle(x, y, w, h, 0x05070c, 0.72).setOrigin(0, 0);
    const good = this.outcome === 'VICTORY';
    // The ledger reflects the CURRENT scrub position — `summaryByStep[idx]`
    // — not the fight's final totals, so a mid-fight peek reads the running
    // tally as of this exact step (falls back to the final tally only if a
    // step index is somehow out of range, which shouldn't happen in practice).
    const summary = this.summaryByStep[this.idx] ?? this.combatSummary;
    const summaryRows = summary.cards;
    const columns = 2;
    const rowH = 34;
    const gridRows = Math.max(1, Math.ceil(summaryRows.length / columns));

    const pw = 640;
    const bannerH = isOutcomeStep ? 52 + (this.mutualWipe ? 16 : 0) : 0;
    const bannerGap = isOutcomeStep ? 10 : 0;
    const pad = 16;
    // banner (if any) + totals row + CARD OUTPUT label + grid + padding
    const ph = bannerH + bannerGap + 20 + 18 + gridRows * rowH + pad;
    const px = x + (w - pw) / 2;
    const py = y + (h - ph) / 2;

    this.add.rectangle(px, py, pw, ph, UI.panel, 0.97).setOrigin(0, 0).setStrokeStyle(1, UI.border, 0.9);
    if (isOutcomeStep) {
      this.add.rectangle(px, py, pw, bannerH, good ? 0x143a1a : 0x3a1414, 0.95).setOrigin(0, 0).setStrokeStyle(2, good ? 0x4f9e57 : 0xb0483c);
      this.add.text(px + pw / 2 - 8, py + bannerH / 2, this.outcome, { fontFamily: FONT.display, fontStyle: 'bold', fontSize: `${F.title}px`, color: good ? '#7fe08a' : '#f08a7a' }).setOrigin(1, 0.5);
      this.add.text(px + pw / 2 + 8, py + bannerH / 2 - (getBattleContext() === 'run' ? 6 : 0), `+${this.goldPayout} GOLD`, { fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${F.small}px`, color: '#e8b446' }).setOrigin(0, 0.5);
      if (getBattleContext() === 'run') {
        // Run Mode: the hero levels after EVERY fight, win or lose (locked
        // design) — `resolveRunBattleResult` already applied it before this
        // renders, so this is a pure readout, never a second mutation.
        this.add.text(px + pw / 2 + 8, py + bannerH / 2 + 12, `LEVEL UP → LV ${currentHeroLevel()} · ${currentBankedPL()} PL BANKED`, {
          fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${F.tiny}px`, color: UI.textAccent,
        }).setOrigin(0, 0.5);
      }
      if (this.mutualWipe) {
        // Same-step mutual kill: without this line the survivor-less
        // "VICTORY"/"DEFEAT" reads like a bug (playtest report 2026-08-04).
        this.add.text(px + pw / 2, py + bannerH - 10, 'BOTH FELL — the faster side takes it', {
          fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${F.tiny}px`, color: UI.textMuted,
        }).setOrigin(0.5);
      }
    }

    let cy = py + bannerH + bannerGap;
    const totalMetrics = [
      summary.playerDamage > 0 ? `YOU DMG ${summary.playerDamage}` : '',
      summary.enemyDamage > 0 ? `FOE DMG ${summary.enemyDamage}` : '',
      summary.playerHealing > 0 ? `HEAL ${summary.playerHealing}` : '',
    ].filter(Boolean).join('  ·  ');
    this.boundedText(px + pad, cy, totalMetrics || 'No measurable output', { fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${F.small}px`, color: UI.text }, pw - pad * 2 - 130);
    // "AS OF" marker makes it unmistakable this is a running tally, not the
    // final one, whenever this panel is showing mid-fight.
    const cardsLabel = isOutcomeStep
      ? `${summaryRows.length} EFFECTIVE CARDS`
      : `${summaryRows.length} EFFECTIVE CARDS · AS OF T${turn}`;
    this.add.text(px + pw - pad, cy, cardsLabel, { fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${F.tiny}px`, color: UI.textDim }).setOrigin(1, 0);
    cy += 20;
    this.add.text(px + pad, cy, isOutcomeStep ? 'CARD OUTPUT' : `CARD OUTPUT · AS OF T${turn}`, { fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${F.tiny}px`, color: UI.textDim });
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
    /** "20 P · 30 M" — present only once >1 shield pool is nonzero, so a
     * stacked physical+magical shield never reads as one merged number. */
    poolsLabel?: string,
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

    // When more than one shield pool is stacked, break the total out by pool
    // (physical/magical/true) instead of one merged number.
    const shieldLabel = shield > 0 ? (poolsLabel ? `+${shield} (${poolsLabel})` : `+${shield}`) : '';
    const shieldText = shield > 0 ? this.add.text(panelX + barW, panelY + 24, shieldLabel, { fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${F.small}px`, color: '#5fa8d3' }).setOrigin(1, 0) : undefined;

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

  /**
   * Floating "-N"/"+N" text over an HP bar — pops in with an overshoot
   * (Back.easeOut), briefly flashes on the top FX tier only, then floats up +
   * fades. Font size/weight scale with `tier`. Every stage self-destroys into
   * the next; the final stage destroys the text object — nothing lingers, and
   * a fresh render() already kills in-flight tweens + destroys the previous
   * frame's objects before this ever runs again (see top of `render()`).
   */
  private spawnFxFloat(x: number, y: number, text: string, color: string, tier: FxTier, taxSuffix?: string): void {
    const fontSize = Math.round(F.body * tier.fontScale);
    const fx = x + (Math.random() * 24 - 12);
    const t = this.add
      .text(fx, y - 4, text, {
        fontFamily: FONT.body, fontSize: `${fontSize}px`, fontStyle: tier.bold ? 'bold' : 'normal', color,
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
          fontFamily: FONT.body, fontSize: `${F.tiny}px`, fontStyle: 'bold', color: AILMENT_COLOR.expose ?? '#a678d8',
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
      fontFamily: FONT.body, fontSize: `${F.small}px`, fontStyle: 'bold', color: palette.color,
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
