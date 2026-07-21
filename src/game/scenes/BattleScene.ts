import Phaser from 'phaser';
import { gemPowerLevel, instancePowerLevelDeci } from '../../engine/balance';
import { applyTier, resolveEffectiveSkill } from '../../engine/cards';
import { auraAffectedTargetSlots } from '../../engine/combat/auras';
import { cardContributions } from '../../run/analysis';
import { presentCardActions } from '../ui/cardActionPresentation';
import { stripCardTextMarkup } from '../ui/cardTextMarkup';
import { effectiveCooldown } from '../../engine/combat/castSelect';
import type { CombatEvent, ComparisonEntry, ComparisonSide } from '../../engine/combat/events';
import { simulate, type CombatResult } from '../../engine/combat/simulate';
import { weightOf, type BoardPiece, type CombatantStats, type Property, type Side, type SkillDef } from '../../engine/types';
import { gemBook } from '../../data/gems';
import { skillBook } from '../../data/skills';
import { buildAutoHeroSetup, buildEnemyEncounter } from '../../run/encounter';
import { demoState } from '../demoState';
import { ARCHETYPE_COLOR, BATTLE_SIDE_LAYOUT, ELEMENT_COLOR, ELEMENT_ICON, FOOTER_ACTION_LAYOUT, FONT, PROPERTY_COLOR, PROPERTY_LABEL, SCREEN, STATUS_ICON, TYPE_SCALE, UI, WEAPON_COLOR, WEAPON_ICON } from '../theme';
import { drawBackdrop } from '../ui/displayLibrary';
import { presentAuraSource, skillAccent, type AuraSourcePresentation } from '../ui/auraPresentation';
import { describeAura, isAuraSkill } from '../ui/skillPresentation';

interface CombatCardToken {
  root: Phaser.GameObjects.Container;
  bg: Phaser.GameObjects.Rectangle;
  baseStrokeWidth: number;
  setHighlight(on: boolean, color?: number): void;
}

type ViewObject = Phaser.GameObjects.GameObject & {
  visible: boolean;
  active: boolean;
  x: number;
  y: number;
  setPosition(x: number, y: number): ViewObject;
};

interface SideView {
  objects: ViewObject[];
  name: string;
  maxHp: number;
  hp: number;
  displayHp: number;
  scheduledHp: number;
  readiness: number;
  shield: number;
  hpBar: Phaser.GameObjects.Rectangle;
  shieldBar: Phaser.GameObjects.Rectangle;
  hpText: Phaser.GameObjects.Text;
  statusText: Phaser.GameObjects.Text;
  scoreText: Phaser.GameObjects.Text;
  statuses: Array<{ status: string; turns: number; property?: Property; charges?: number }>;
  cards: Map<number, CombatCardToken>;
  pieces: Map<number, BoardPiece>;
  auraBounds: Map<number, { x: number; y: number; width: number; height: number }>;
  barWidth: number;
  floatX: number;
  floatY: number;
  isShaking: boolean;
}

interface TurnTempo {
  bank: number;
  speed: number;
  weight: number | null;
  score: number | null;
  state: ComparisonSide['state'];
  banked: number;
  used: number;
  cardId: string | null;
  stunned: boolean;
}

interface TurnSummary {
  turn: number;
  round: number;
  performer: Side | null;
  player: TurnTempo;
  enemyCardId: string | null;
  notes: string[];
}

interface ActivationRow {
  turn: number;
  side: Side | null;
  unit: number | null;
  skillId: string | null;
  slot: number | null;
  weight: number | null;
  note: string;
  activation: string;
  entries: ComparisonEntry[];
  tempoLines: Map<string, { math: string; bank: string; startBank: number }>;
  auraSources: AuraSourcePresentation[];
  resultLines: string[];
  targetSide: Side | null;
  targetUnit: number | null;
  snapshot?: BattleSnapshot;
}

interface BattleUnitSnapshot {
  hp: number;
  shield: number;
}

interface BattleSnapshot {
  player: BattleUnitSnapshot[];
  enemy: BattleUnitSnapshot[];
}

interface ButtonPair {
  rect: Phaser.GameObjects.Rectangle;
  text: Phaser.GameObjects.Text;
}

interface FeedCard {
  container: Phaser.GameObjects.Container;
  bg: Phaser.GameObjects.Rectangle;
  accent: Phaser.GameObjects.Rectangle;
  line: Phaser.GameObjects.Rectangle;
  verb: Phaser.GameObjects.Text;
  title: Phaser.GameObjects.Text;
  resultVerb: Phaser.GameObjects.Text;
  body: Phaser.GameObjects.Text;
  calculation: Phaser.GameObjects.Text;
  calculationTokens: Phaser.GameObjects.Text[];
}

interface AuraOverlay {
  object: ViewObject;
  side: Side;
  unit: number;
  targetSlot: number;
  role: 'source' | 'affected' | 'indicator';
}

interface RosterEntry {
  label: string;
  sublabel: string;
  speed: number;
  fill: number;
  accent: number;
  onClick: () => void;
}

interface RosterChip {
  rect: Phaser.GameObjects.Rectangle;
  accent: Phaser.GameObjects.Rectangle;
  label: Phaser.GameObjects.Text;
  speedLabel: Phaser.GameObjects.Text;
  sublabel: Phaser.GameObjects.Text;
  baseFill: number;
}

const VIEW_W = SCREEN.width - SCREEN.safeX * 2;
const FRAME = { x: SCREEN.safeX - 12, y: 96, w: VIEW_W + 24, h: 1094 };
const PLAYER_PANEL = { x: SCREEN.safeX, y: 170, w: 202, h: 886 };
const LOG_PANEL = { x: 242, y: 170, w: 236, h: 886 };
const COMPARISON_PANEL = { x: LOG_PANEL.x, y: 148, w: LOG_PANEL.w, h: 234 };
const ENEMY_PANEL = { x: 490, y: 170, w: 202, h: 886 };
const FEED_CARD_H = 52;
const FEED_CARD_GAP = 0;
const FEED_ROWS = 12;
const LOG_REVEAL_STAGGER_MS = 300;
const TURN_SETTLE_MS = 800;
const BOARD_SLOT_COUNT = 10;
const BOARD_SLOT_H = 84;
const BOARD_TOP_Y = PLAYER_PANEL.y + BATTLE_SIDE_LAYOUT.boardTopOffsetY;

function formatPowerDeci(value: number): string {
  const power = value / 10;
  return Number.isInteger(power) ? String(power) : power.toFixed(1);
}

export class BattleScene extends Phaser.Scene {
  private result!: CombatResult;
  private views!: Record<Side, SideView[]>;
  private eventIdx = 0;
  private finished = false;
  private reportAutoShown = false;
  private turnText!: Phaser.GameObjects.Text;
  private comparisonText!: Phaser.GameObjects.Text;
  private turnAuraTokens: Phaser.GameObjects.Text[] = [];
  private turnResultText!: Phaser.GameObjects.Text;
  private turnCalculationTokens: Phaser.GameObjects.Text[] = [];
  private turnCalculationBg!: Phaser.GameObjects.Rectangle;
  private selectedSkillText!: Phaser.GameObjects.Text;
  private feedCards: FeedCard[] = [];
  private pageText!: Phaser.GameObjects.Text;
  private modalObjects: Phaser.GameObjects.GameObject[] = [];
  private activationRows: ActivationRow[] = [];
  private revealedRowCount = 0;
  private playbackTimer?: Phaser.Time.TimerEvent;
  private playbackRate: 1 | 2 = 1;
  private playbackButtons = new Map<1 | 2, ButtonPair>();
  private pendingVisualTimers: Phaser.Time.TimerEvent[] = [];
  private hpTweenCounters: Array<{ view: SideView; counter: { hp: number } }> = [];
  private pendingCombatEnd: { result: 'win' | 'loss' | 'draw'; turns: number } | null = null;
  private logPage = 0;
  private selectedRow: ActivationRow | null = null;
  private currentTurn = 0;
  private turnSummaries = new Map<number, TurnSummary>();
  private performsSeen: Record<Side, number> = { player: 0, enemy: 0 };
  private unitNames: Record<Side, string[]> = { player: ['Hero'], enemy: ['Enemy'] };
  private activeEnemyUnit: number | null = null;
  private partyRosterChips: RosterChip[] = [];
  private enemyRosterChips: RosterChip[] = [];
  private auraViewEnabled = true;
  private persistentAuraObjects: AuraOverlay[] = [];
  private hoverAuraObjects: AuraOverlay[] = [];
  private selectedAuraObjects: AuraOverlay[] = [];
  private auraToggle!: ButtonPair;

  constructor() {
    super('Battle');
  }

  init(): void {
    this.eventIdx = 0;
    this.finished = false;
    this.reportAutoShown = false;
    this.feedCards = [];
    this.activationRows = [];
    this.revealedRowCount = 0;
    this.playbackTimer = undefined;
    this.playbackRate = 1;
    this.playbackButtons = new Map();
    this.pendingVisualTimers = [];
    this.hpTweenCounters = [];
    this.pendingCombatEnd = null;
    this.logPage = 0;
    this.selectedRow = null;
    this.currentTurn = 0;
    this.turnSummaries.clear();
    this.performsSeen = { player: 0, enemy: 0 };
    this.unitNames = { player: ['Hero'], enemy: ['Enemy'] };
    this.activeEnemyUnit = null;
    this.partyRosterChips = [];
    this.enemyRosterChips = [];
    this.turnCalculationTokens = [];
    this.turnAuraTokens = [];
    this.auraViewEnabled = true;
    this.persistentAuraObjects = [];
    this.hoverAuraObjects = [];
    this.selectedAuraObjects = [];
  }

  private clearAuraObjects(objects: AuraOverlay[]): void {
    for (const overlay of objects) overlay.object.destroy();
    objects.length = 0;
  }

  create(): void {
    this.cameras.main.setBackgroundColor(UI.bg);
    this.drawBackdrop();

    const heroEncounter = buildAutoHeroSetup(
      demoState.heroLevel,
      demoState.pieces.map((piece) => ({ ...piece })),
    );
    const enemyTeam = demoState.enemyTeam.length > 0
      ? demoState.enemyTeam
      : (demoState.enemyIds.length > 0 ? demoState.enemyIds : [demoState.enemyId]).map((enemyId) => ({
          enemyId,
          level: demoState.enemyLevel,
          title: demoState.enemyTitle,
          rank: demoState.enemyRank,
        }));
    const enemyEncounters = enemyTeam.map((enemy) =>
      buildEnemyEncounter(enemy.enemyId, enemy.level, enemy.title, enemy.rank),
    );
    const heroSetup = heroEncounter.setup;
    const enemySetups = enemyEncounters.map((encounter) => encounter.setup);
    this.unitNames = { player: [heroSetup.name], enemy: enemySetups.map((setup) => setup.name) };
    this.result = simulate(
      {
        playerTeam: [heroSetup],
        enemyTeam: enemySetups,
        skillBook,
      },
      demoState.seed,
    );
    this.activationRows = this.buildActivationRows(this.result.events, {
      player: [this.initialBattleSnapshot(heroSetup.stats)],
      enemy: enemySetups.map((setup) => this.initialBattleSnapshot(setup.stats)),
    });

    this.drawHeader(enemySetups.map((setup) => setup.name).join(' + '));
    this.drawCombatFrame({
      party: [
        {
          label: heroSetup.name,
          sublabel: `HP ${heroSetup.stats.maxHp}/${heroSetup.stats.maxHp} · R 0`,
          speed: heroSetup.stats.speed,
          fill: UI.battlePlayer,
          accent: UI.lanePlayer,
          onClick: () => this.openStatsModal(heroSetup.name, heroSetup.stats, heroEncounter.level, 'player'),
        },
      ],
      enemies: enemyEncounters.map((encounter, unit) => ({
          label: encounter.setup.name,
          sublabel: `HP ${encounter.setup.stats.maxHp}/${encounter.setup.stats.maxHp} · R 0`,
          speed: encounter.setup.stats.speed,
          fill: UI.battleEnemy,
          accent: UI.laneEnemy,
          onClick: () => this.focusEnemy(unit),
        })),
    });

    this.views = {
      player: [this.buildSideView(heroSetup.name, heroSetup.stats, heroEncounter.level, 'player', 0, PLAYER_PANEL, heroSetup.pieces)],
      enemy: enemyEncounters.map((encounter, unit) => this.buildSideView(
        encounter.setup.name,
        encounter.setup.stats,
        encounter.level,
        'enemy',
        unit,
        ENEMY_PANEL,
        encounter.setup.pieces,
      )),
    };

    this.focusEnemy(0);
    this.refreshPersistentAuraOverlays();

    this.buildComparisonPanel();
    this.buildLogPanel();
    this.buildControls();

    const firstPiece = demoState.pieces[0];
    if (firstPiece) {
      this.inspectSkill(firstPiece.skillId);
    } else if (enemySetups[0]?.pieces[0]) {
      this.inspectSkill(enemySetups[0].pieces[0].skillId);
    }

    this.startPlayback();
  }

  private drawBackdrop(): void {
    drawBackdrop(this);
    this.add.rectangle(0, 96, SCREEN.width, 1094, UI.panel, 0.28).setOrigin(0, 0);
  }

  private drawHeader(enemyName: string): void {
    this.add.text(SCREEN.safeX, SCREEN.safeTop, 'WORLD1', {
      fontSize: '26px',
      color: UI.text,
      fontFamily: FONT.display,
      fontStyle: 'bold',
    });
    this.add.text(SCREEN.safeX, SCREEN.safeTop + 32, `${enemyName} · seed ${demoState.seed} · combat`, {
      fontSize: TYPE_SCALE.small,
      color: UI.textDim,
      fontFamily: FONT.body,
    });
  }

  private drawCombatFrame(rosters: { party: RosterEntry[]; enemies: RosterEntry[] }): void {
    this.add.rectangle(FRAME.x, FRAME.y, FRAME.w, FRAME.h, UI.battleFrame, 0.72).setOrigin(0, 0).setStrokeStyle(2, UI.battleOutline);
    this.drawLaneButton(PLAYER_PANEL.x, 104, PLAYER_PANEL.w, `PARTY ${rosters.party.length}`, UI.lanePlayer);
    this.drawLaneButton(LOG_PANEL.x, 104, LOG_PANEL.w, 'TURN LOG', UI.laneLog);
    this.drawLaneButton(ENEMY_PANEL.x, 104, ENEMY_PANEL.w, `ENEMIES ${rosters.enemies.length}`, UI.laneEnemy);

    this.partyRosterChips = this.drawRosterStrip(PLAYER_PANEL.x, PLAYER_PANEL.y - 22, PLAYER_PANEL.w, rosters.party);
    this.enemyRosterChips = this.drawRosterStrip(ENEMY_PANEL.x, ENEMY_PANEL.y - 22, ENEMY_PANEL.w, rosters.enemies);

    this.selectedSkillText = this.add.text(FRAME.x + 18, FRAME.y + FRAME.h - 26, 'Tap a card to inspect.', {
      fontSize: '11px',
      color: UI.textDim,
      fontFamily: FONT.body,
      wordWrap: { width: FRAME.w - 36 },
    });
  }

  private drawLaneButton(x: number, y: number, w: number, label: string, fill: number): void {
    this.add.rectangle(x, y, w, 42, fill).setOrigin(0, 0).setStrokeStyle(1, UI.battleOutline, 0.8);
    this.add.text(x + w / 2, y + 21, label, {
      fontSize: '12px',
      color: '#ffffff',
      fontFamily: FONT.body,
      fontStyle: 'bold',
    }).setOrigin(0.5);
  }

  private drawRosterStrip(x: number, y: number, w: number, entries: RosterEntry[]): RosterChip[] {
    const chips: RosterChip[] = [];
    const chipGap = 4;
    const maxVisible = Math.min(entries.length, 3);
    const chipSpace = w - chipGap * Math.max(0, maxVisible - 1);
    const baseChipW = Math.floor(chipSpace / Math.max(1, maxVisible));
    const chipRemainder = chipSpace % Math.max(1, maxVisible);
    let chipX = x;

    for (let index = 0; index < maxVisible; index++) {
      const entry = entries[index]!;
      const chipW = baseChipW + (index < chipRemainder ? 1 : 0);
      const rect = this.add.rectangle(chipX, y, chipW, 32, entry.fill, 0.88).setOrigin(0, 0).setStrokeStyle(1, UI.battleOutline, 0.74).setInteractive({ useHandCursor: true });
      const accent = this.add.rectangle(chipX + 1, y + 28, chipW - 2, 3, entry.accent).setOrigin(0, 0).setVisible(index === 0);
      // Chip text shares the column's single text inset so it lines up with
      // the stat block and HP bar below (BATTLE_SIDE_LAYOUT.contentInset).
      const chipInset = BATTLE_SIDE_LAYOUT.contentInset;
      const label = this.add.text(chipX + chipInset, y + 5, entry.label.toUpperCase(), {
        fontSize: '8px',
        color: UI.text,
        fontFamily: FONT.body,
        fontStyle: 'bold',
        maxLines: 1,
        fixedWidth: chipW - chipInset - 46,
      });
      const speedLabel = this.add.text(chipX + chipW - chipInset, y + 5, `SPD ${entry.speed}`, {
        fontSize: '7px',
        color: UI.text,
        fontFamily: FONT.body,
        fontStyle: 'bold',
      }).setOrigin(1, 0);
      const sublabel = this.add.text(chipX + chipInset, y + 18, entry.sublabel, {
        fontSize: '8px',
        color: UI.text,
        fontFamily: FONT.body,
        fontStyle: 'bold',
        maxLines: 1,
        fixedWidth: chipW - chipInset * 2,
      });

      rect.on('pointerdown', entry.onClick);
      label.setInteractive({ useHandCursor: true }).on('pointerdown', entry.onClick);
      speedLabel.setInteractive({ useHandCursor: true }).on('pointerdown', entry.onClick);
      sublabel.setInteractive({ useHandCursor: true }).on('pointerdown', entry.onClick);
      chips.push({ rect, accent, label, speedLabel, sublabel, baseFill: entry.fill });
      chipX += chipW + chipGap;
    }

    if (entries.length > maxVisible) {
      this.add.text(x + w - 4, y + 14, `+${entries.length - maxVisible}`, {
        fontSize: '9px',
        color: UI.text,
        fontFamily: FONT.body,
        fontStyle: 'bold',
      }).setOrigin(1, 0.5);
    }
    return chips;
  }

  private setSideViewVisible(view: SideView, visible: boolean): void {
    for (const object of view.objects) {
      object.visible = visible;
      object.active = visible;
    }
  }

  private focusEnemy(unit: number): void {
    const view = this.views?.enemy?.[unit];
    if (!view) return;
    this.activeEnemyUnit = unit;
    for (let index = 0; index < this.views.enemy.length; index++) {
      this.setSideViewVisible(this.views.enemy[index]!, index === unit);
    }
    for (let index = 0; index < this.enemyRosterChips.length; index++) {
      const chip = this.enemyRosterChips[index]!;
      const selected = index === unit;
      chip.rect.setFillStyle(chip.baseFill, selected ? 1 : 0.82).setStrokeStyle(1, UI.battleOutline, selected ? 0.9 : 0.62);
      chip.accent.setVisible(selected);
      chip.label.setColor(selected ? UI.text : UI.textDim);
      chip.speedLabel.setColor(selected ? UI.text : UI.textDim);
      chip.sublabel.setColor(selected ? UI.text : UI.textDim);
    }
    this.syncAuraOverlayVisibility();
    this.selectedSkillText?.setText(`${view.name} selected · tap a card to inspect its details.`);
  }

  private updateEnemyRoster(unit: number): void {
    const view = this.views?.enemy?.[unit];
    const chip = this.enemyRosterChips[unit];
    if (!view || !chip) return;
    chip.sublabel.setText(`HP ${Math.round(view.displayHp)}/${view.maxHp} · R ${view.readiness}`);
  }

  private buildSideView(
    name: string,
    stats: CombatantStats,
    level: number,
    side: Side,
    unit: number,
    panel: { x: number; y: number; w: number; h: number },
    pieces: BoardPiece[],
  ): SideView {
    const objects: ViewObject[] = [];
    const track = <T extends ViewObject>(object: T): T => {
      objects.push(object);
      return object;
    };
    const compact = panel.w < 140;
    const contentInset = BATTLE_SIDE_LAYOUT.contentInset;
    const barX = panel.x + contentInset;
    const barY = panel.y + BATTLE_SIDE_LAYOUT.hpBarOffsetY;
    const barWidth = panel.w - contentInset * 2;
    const totalPl = this.totalBoardPowerDeci(pieces);

    const identityText = track(this.add.text(panel.x + contentInset, panel.y + BATTLE_SIDE_LAYOUT.nameOffsetY, `${name.toUpperCase()} · LV ${level}`, {
      fontSize: compact ? '8px' : '10px',
      color: UI.text,
      fontFamily: FONT.display,
      fontStyle: 'bold',
      maxLines: 1,
      fixedWidth: panel.w - contentInset * 2,
    }));
    identityText.setInteractive({ useHandCursor: true });
    identityText.on('pointerdown', () => this.openStatsModal(name, stats, level, side));
    track(this.add.text(panel.x + contentInset, panel.y + BATTLE_SIDE_LAYOUT.summaryOffsetY, `${pieces.length} skill${pieces.length === 1 ? '' : 's'} · PL ${formatPowerDeci(totalPl)} · DMG/t ${this.actualDamagePerTurn(side)}`, {
      fontSize: compact ? '7px' : '9px',
      color: UI.textDim,
      fontFamily: FONT.body,
      fontStyle: 'bold',
      maxLines: 1,
      fixedWidth: panel.w - contentInset * 2,
    }));
    const statLine = track(this.add.text(panel.x + contentInset, panel.y + BATTLE_SIDE_LAYOUT.attackOffsetY, `ATK ${stats.attack} · MAG ${stats.magicPower} · SPD ${stats.speed}`, {
      fontSize: compact ? '7px' : '9px',
      color: UI.text,
      fontFamily: FONT.body,
      fontStyle: 'bold',
    }));
    statLine.setInteractive({ useHandCursor: true });
    statLine.on('pointerdown', () => this.openStatsModal(name, stats, level, side));
    const defenseLine = track(this.add.text(panel.x + contentInset, panel.y + BATTLE_SIDE_LAYOUT.defenseOffsetY, `DEF ${stats.armor} · RES ${stats.magicResist} · CRIT ${stats.critPct}%`, {
      fontSize: compact ? '7px' : '8px',
      color: UI.text,
      fontFamily: FONT.body,
      fontStyle: 'bold',
      fixedWidth: panel.w - contentInset * 2,
      maxLines: 1,
    }));
    defenseLine.setInteractive({ useHandCursor: true });
    defenseLine.on('pointerdown', () => this.openStatsModal(name, stats, level, side));

    track(this.add.rectangle(barX, barY, barWidth, 12, UI.hpBack).setOrigin(0, 0.5).setStrokeStyle(1, UI.battleOutline, 0.7));
    const hpBar = track(this.add.rectangle(barX, barY, barWidth, 12, side === 'player' ? UI.hp : UI.bad).setOrigin(0, 0.5));
    const shieldBar = track(this.add.rectangle(barX, barY - 10, 0, 5, UI.shield).setOrigin(0, 0.5));
    const hpText = track(this.add.text(barX, barY + BATTLE_SIDE_LAYOUT.hpTextOffsetY, `HP ${stats.maxHp}/${stats.maxHp}`, {
      fontSize: compact ? '9px' : '11px',
      color: UI.text,
      fontFamily: FONT.body,
      fontStyle: 'bold',
    }));
    hpText.setInteractive({ useHandCursor: true });
    hpText.on('pointerdown', () => this.openStatsModal(name, stats, level, side));
    const scoreText = track(this.add
      .text(barX + barWidth, barY + BATTLE_SIDE_LAYOUT.scoreOffsetY, '', {
        fontSize: compact ? '7px' : '10px',
        color: '#855821',
        fontFamily: FONT.body,
        fontStyle: 'bold',
      })
      .setOrigin(1, 0));
    // Shares the score row: statuses left, score right. Single line clipped
    // short of the score so neither can overlap the other or the board below.
    const statusText = track(this.add.text(barX, barY + BATTLE_SIDE_LAYOUT.statusOffsetY, '', {
      fontSize: compact ? '8px' : '10px',
      color: UI.textDim,
      fontFamily: FONT.body,
      maxLines: 1,
      fixedWidth: Math.max(40, barWidth - (compact ? 56 : 84)),
    }));

    const cards = new Map<number, CombatCardToken>();
    const pieceMap = new Map<number, BoardPiece>();
    const sortedPieces = [...pieces].sort((a, b) => a.slot - b.slot);
    const boardX = panel.x + (compact ? 4 : 10);
    const boardY = BOARD_TOP_Y;
    const boardW = panel.w - (compact ? 8 : 20);
    // Slot numbers face INWARD toward the center log: the player's column
    // (left) numbers on its right edge, the enemy's (right) on its left edge.
    for (let slot = 0; slot < BOARD_SLOT_COUNT; slot++) {
      const y = boardY + slot * BOARD_SLOT_H;
      const slotFill = side === 'player' ? UI.battlePlayerSlot : UI.battleEnemySlot;
      track(this.add.rectangle(boardX, y, boardW, BOARD_SLOT_H - 4, slotFill, 0.72).setOrigin(0, 0).setStrokeStyle(1, UI.battleOutline, 0.24));
      const numberText = this.add.text(side === 'player' ? boardX + boardW - 6 : boardX + 6, y + 6, String(slot + 1), {
        fontSize: compact ? '8px' : '11px',
        color: UI.textDim,
        fontFamily: FONT.body,
        fontStyle: 'bold',
      });
      if (side === 'player') numberText.setOrigin(1, 0);
      track(numberText);
    }

    const cardInset = compact ? 18 : 24;
    const cardWidth = boardW - (compact ? 22 : 30);
    // Mirror the card gutter with the numbers: player cards hug the left edge
    // (number gutter on the right); enemy cards keep the left gutter.
    const cardX = side === 'player' ? boardX + (compact ? 4 : 6) : boardX + cardInset;
    const auraBounds = new Map<number, { x: number; y: number; width: number; height: number }>();

    for (const piece of sortedPieces) {
      const base = skillBook[piece.skillId];
      if (!base) continue;
      // Show the RANK-upgraded card face (tier badge + scaled numbers). applyTier
      // is a no-op when the piece has no tier (players), so their display is
      // unchanged; gems are still surfaced via the inspect modal.
      const skill = piece.tier ? applyTier(base, piece.tier) : base;
      const cardY = boardY + piece.slot * BOARD_SLOT_H + 4;
      const cardHeight = skill.size * BOARD_SLOT_H - 10;

      const card = this.makeBoardToken(cardX, cardY, cardWidth, cardHeight, skill, side, compact);
      auraBounds.set(piece.slot, { x: cardX, y: cardY, width: cardWidth, height: cardHeight });
      card.root.setInteractive(new Phaser.Geom.Rectangle(0, 0, cardWidth, cardHeight), Phaser.Geom.Rectangle.Contains);
      card.root.on('pointerover', () => {
        this.inspectSkill(base.id);
        if (skill.aura) this.showAuraReach(side, unit, piece, 'hover');
      });
      card.root.on('pointerout', () => {
        if (skill.aura) this.clearAuraObjects(this.hoverAuraObjects);
      });
      card.root.on('pointerdown', () => this.openSkillModal(skill, piece));
      objects.push(card.root);
      cards.set(piece.slot, card);
      pieceMap.set(piece.slot, piece);
    }

    return {
      objects,
      name,
      maxHp: stats.maxHp,
      hp: stats.maxHp,
      displayHp: stats.maxHp,
      scheduledHp: stats.maxHp,
      readiness: 0,
      shield: 0,
      hpBar,
      shieldBar,
      hpText,
      statusText,
      scoreText,
      statuses: [],
      cards,
      pieces: pieceMap,
      auraBounds,
      barWidth,
      floatX: panel.x + panel.w / 2,
      floatY: panel.y + 64,
      isShaking: false,
    };
  }

  private auraEffectColor(source: AuraSourcePresentation): number {
    if (source.tone === 'negative') return UI.bad;
    if (source.tone === 'mixed') return UI.waiting;
    return UI.good;
  }

  private addAuraOverlay(
    collection: AuraOverlay[],
    object: ViewObject,
    side: Side,
    unit: number,
    targetSlot: number,
    role: AuraOverlay['role'],
  ): void {
    const visible = side === 'player' || unit === this.activeEnemyUnit;
    object.visible = visible;
    object.active = visible;
    collection.push({ object, side, unit, targetSlot, role });
  }

  private showAuraReach(
    side: Side,
    unit: number,
    sourcePiece: BoardPiece,
    layer: 'persistent' | 'hover' | 'selection',
    append = false,
  ): void {
    const persistent = layer === 'persistent';
    const collection = persistent
      ? this.persistentAuraObjects
      : layer === 'hover'
        ? this.hoverAuraObjects
        : this.selectedAuraObjects;
    if (!append) this.clearAuraObjects(collection);

    const view = this.viewFor(side, unit);
    const sourceSkill = skillBook[sourcePiece.skillId];
    const sourceBounds = view?.auraBounds.get(sourcePiece.slot);
    if (!view || !sourceSkill?.aura || !sourceBounds) return;

    const source = presentAuraSource(
      { slot: sourcePiece.slot, skillId: sourcePiece.skillId, ...sourceSkill.aura.mods },
      skillBook,
    );
    const outline = this.add.graphics().setDepth(50);
    outline.lineStyle(persistent ? 2 : 3, source.accent, persistent ? 0.9 : 1);
    outline.strokeRect(sourceBounds.x, sourceBounds.y, sourceBounds.width, sourceBounds.height);
    this.addAuraOverlay(collection, outline, side, unit, sourcePiece.slot, 'source');

    const affected = auraAffectedTargetSlots(
      { slot: sourcePiece.slot, skillId: sourcePiece.skillId },
      [...view.pieces.values()].map((piece) => ({ slot: piece.slot, skillId: piece.skillId })),
      skillBook,
    );
    const color = this.auraEffectColor(source);
    for (const slot of affected) {
      const bounds = view.auraBounds.get(slot);
      if (!bounds) continue;
      const edgeIndex = collection.filter((overlay) => (
        overlay.side === side
        && overlay.unit === unit
        && overlay.targetSlot === slot
        && overlay.role === 'affected'
      )).length;
      const marker = this.add
        .rectangle(bounds.x + 2 + edgeIndex * 4, bounds.y + 2, 3, bounds.height - 4, color, persistent ? 0.86 : 1)
        .setOrigin(0, 0)
        .setDepth(51);
      this.addAuraOverlay(collection, marker, side, unit, slot, 'affected');
      const sign = source.tone === 'negative' ? '-' : source.tone === 'mixed' ? '±' : '+';
      const indicator = this.add.text(bounds.x + 1 + edgeIndex * 4, bounds.y + 1, sign, {
        fontSize: '6px',
        color: this.hexColor(color),
        fontFamily: FONT.body,
        fontStyle: 'bold',
      }).setDepth(52);
      this.addAuraOverlay(collection, indicator, side, unit, slot, 'indicator');
    }
  }

  private refreshPersistentAuraOverlays(): void {
    this.clearAuraObjects(this.persistentAuraObjects);
    if (!this.auraViewEnabled || !this.views) return;

    for (const side of ['player', 'enemy'] as Side[]) {
      for (let unit = 0; unit < this.views[side].length; unit++) {
        const view = this.views[side][unit]!;
        for (const piece of view.pieces.values()) {
          if (skillBook[piece.skillId]?.aura) this.showAuraReach(side, unit, piece, 'persistent', true);
        }
      }
    }
    this.syncAuraOverlayVisibility();
  }

  private syncAuraOverlayVisibility(): void {
    for (const overlay of [...this.persistentAuraObjects, ...this.hoverAuraObjects, ...this.selectedAuraObjects]) {
      const visible = overlay.side === 'player' || overlay.unit === this.activeEnemyUnit;
      overlay.object.visible = visible;
      overlay.object.active = visible;
    }
  }

  private toggleAuraView(): void {
    this.auraViewEnabled = !this.auraViewEnabled;
    this.auraToggle.text.setText(this.auraViewEnabled ? 'AURA ON' : 'AURA OFF');
    this.auraToggle.rect.setFillStyle(this.auraViewEnabled ? UI.chip : UI.panelMuted);
    this.auraToggle.text.setColor(this.auraViewEnabled ? '#ffffff' : UI.text);
    this.refreshPersistentAuraOverlays();
  }

  private totalBoardPowerDeci(pieces: BoardPiece[]): number {
    return pieces.reduce((sum, piece) => {
      const base = skillBook[piece.skillId];
      if (!base) return sum;
      // Rank-upgraded cards carry the higher tier's PL; applyTier is a no-op for
      // un-ranked (player) pieces. Gem PL is added on top by instancePowerLevelDeci.
      const skill = piece.tier ? applyTier(base, piece.tier) : base;
      return sum + instancePowerLevelDeci(skill, piece);
    }, 0);
  }

  /**
   * The REAL average damage this side dealt this fight — total damage inflicted
   * on the opposing side (direct hits + DoT ticks) divided by turns elapsed.
   * Read straight from the resolved event log (no re-simulation), so it's the
   * honest realized output, complementing the theoretical band shown in Prep.
   */
  private actualDamagePerTurn(side: Side): number {
    const victimSide: Side = side === 'player' ? 'enemy' : 'player';
    let dealt = 0;
    for (const event of this.result.events) {
      if (event.kind === 'damage' && event.side === victimSide) dealt += event.amount;
    }
    const turns = Math.max(1, this.result.finalState.turn);
    return Math.round(dealt / turns);
  }

  private makeBoardToken(x: number, y: number, w: number, h: number, skill: SkillDef, side: Side, compact = false): CombatCardToken {
    const root = this.add.container(x, y);
    const fill = side === 'player' ? UI.battlePlayerCard : UI.battleEnemyCard;
    const propertyColor = PROPERTY_COLOR[skill.property];
    const auraSkill = isAuraSkill(skill);
    const baseStrokeWidth = 1;
    const bg = this.add.rectangle(0, 0, w, h, fill, 0.94).setOrigin(0, 0).setStrokeStyle(baseStrokeWidth, UI.battleOutline, 0.9);
    const contentX = compact ? 9 : 14;
    const accent = this.add.rectangle(0, 0, compact ? 4 : 5, h, propertyColor).setOrigin(0, 0);
    const name = this.add.text(contentX, compact ? 8 : 10, skill.name, {
      fontSize: compact ? '8px' : '11px',
      color: UI.text,
      fontFamily: FONT.display,
      fontStyle: 'bold',
      wordWrap: { width: w - contentX - 5 },
      maxLines: 2,
    });

    const archetypeObjects: Phaser.GameObjects.GameObject[] = [];
    let archetypeX = contentX;
    for (const archetype of skill.archetypes.slice(0, compact ? 1 : 2)) {
      const label = archetype.toUpperCase();
      const badgeW = Math.max(compact ? 26 : 32, label.length * (compact ? 3.7 : 4.8) + (compact ? 7 : 10));
      const badgeY = compact ? 34 : 38;
      const badgeH = compact ? 11 : 13;
      const badge = this.add.rectangle(archetypeX, badgeY, badgeW, badgeH, ARCHETYPE_COLOR[archetype], 0.92).setOrigin(0, 0);
      const badgeText = this.add.text(archetypeX + badgeW / 2, badgeY + badgeH / 2, label, {
        fontSize: compact ? '6px' : '7px', color: '#ffffff', fontFamily: FONT.body, fontStyle: 'bold',
      }).setOrigin(0.5);
      archetypeObjects.push(badge, badgeText);
      archetypeX += badgeW + 4;
    }

    const kindLabel = skill.element
      ? `${ELEMENT_ICON[skill.element]} ${skill.element.toUpperCase()}`
      : skill.weapon
        ? `${WEAPON_ICON[skill.weapon]} ${skill.weapon.toUpperCase()}`
        : auraSkill
          ? 'AURA'
          : PROPERTY_LABEL[skill.property];
    const kindColor = skill.element
      ? (ELEMENT_COLOR[skill.element] ?? propertyColor)
      : skill.weapon
        ? (WEAPON_COLOR[skill.weapon] ?? propertyColor)
        : auraSkill
          ? ARCHETYPE_COLOR.support
          : propertyColor;
    const kind = this.add.text(contentX, h - 22, kindLabel, {
      fontSize: compact ? '6px' : '7px',
      color: this.hexColor(kindColor),
      fontFamily: FONT.body,
      fontStyle: 'bold',
      fixedWidth: w - contentX - 5,
      maxLines: 1,
    });
    const weightLabel = compact ? `W${weightOf(skill)} · ${skill.size}S` : `WEIGHT ${weightOf(skill)} · ${skill.size} SLOT${skill.size === 1 ? '' : 'S'}`;
    const weight = this.add.text(contentX, h - 12, weightLabel, {
      fontSize: compact ? '6px' : '7px', color: UI.text, fontFamily: FONT.body, fontStyle: 'bold',
    });

    root.add([bg, accent, name, ...archetypeObjects, kind, weight]);
    root.setSize(w, h);

    return {
      root,
      bg,
      baseStrokeWidth,
      setHighlight(on: boolean, color = 0xffffff): void {
        bg.setStrokeStyle(on ? baseStrokeWidth + 2 : baseStrokeWidth, on ? color : UI.battleOutline);
      },
    };
  }

  private buildComparisonPanel(): void {
    this.add.rectangle(COMPARISON_PANEL.x, COMPARISON_PANEL.y, COMPARISON_PANEL.w, COMPARISON_PANEL.h, UI.panelAlt, 0.94).setOrigin(0, 0).setStrokeStyle(1, UI.battleOutline, 0.86);
    this.add.rectangle(COMPARISON_PANEL.x, COMPARISON_PANEL.y, COMPARISON_PANEL.w, 5, UI.laneLog).setOrigin(0, 0);
    this.turnText = this.add.text(COMPARISON_PANEL.x + 14, COMPARISON_PANEL.y + 13, 'SELECT A TURN', {
      fontSize: '13px',
      color: UI.text,
      fontFamily: FONT.body,
      fontStyle: 'bold',
    });
    this.add.text(COMPARISON_PANEL.x + COMPARISON_PANEL.w - 14, COMPARISON_PANEL.y + 15, 'TURN DETAIL', {
      fontSize: '7px',
      color: UI.textDim,
      fontFamily: FONT.body,
      fontStyle: 'bold',
    }).setOrigin(1, 0);
    this.comparisonText = this.add.text(COMPARISON_PANEL.x + 14, COMPARISON_PANEL.y + 40, 'Select a log line to inspect its action and readiness change.', {
      fontSize: '9px',
      color: UI.text,
      fontFamily: FONT.body,
      wordWrap: { width: COMPARISON_PANEL.w - 28 },
      lineSpacing: 1,
      maxLines: 4,
    });
    this.turnResultText = this.add.text(COMPARISON_PANEL.x + 14, COMPARISON_PANEL.y + 124, 'RESULT  Waiting for a selected event.', {
      fontSize: '8px',
      color: UI.textDim,
      fontFamily: FONT.body,
      fontStyle: 'bold',
      wordWrap: { width: COMPARISON_PANEL.w - 28 },
      lineSpacing: 1,
      maxLines: 3,
    });
    this.turnCalculationBg = this.add.rectangle(COMPARISON_PANEL.x + 10, COMPARISON_PANEL.y + 182, COMPARISON_PANEL.w - 20, 38, UI.battleLog, 0.9).setOrigin(0, 0).setStrokeStyle(1, UI.battleOutline, 0.28);
    this.renderTurnCalculation('Readiness and damage calculations appear here.', false);
  }

  private buildLogPanel(): void {
    const feedStartY = COMPARISON_PANEL.y + COMPARISON_PANEL.h + 12;
    const feedX = LOG_PANEL.x;
    const feedW = LOG_PANEL.w;
    const cardX = feedX;
    const cardW = feedW;
    this.add.rectangle(feedX, feedStartY, feedW, FEED_CARD_H * FEED_ROWS, UI.battleLog, 0.78).setOrigin(0, 0).setStrokeStyle(1, UI.battleOutline);

    for (let index = 0; index < FEED_ROWS; index++) {
      const y = feedStartY + index * (FEED_CARD_H + FEED_CARD_GAP);
      const bg = this.add
        .rectangle(cardX, y + 2, cardW, FEED_CARD_H - 4, index % 2 === 0 ? UI.battleFrame : UI.battleLog, 0.84)
        .setOrigin(0, 0)
        .setInteractive({ useHandCursor: true });
      const accent = this.add.rectangle(cardX, y + 2, 2, FEED_CARD_H - 4, UI.battleOutline, 0.3).setOrigin(0, 0);
      const line = this.add.rectangle(cardX + 4, y + FEED_CARD_H, cardW - 8, 1, UI.battleOutline, 0.14).setOrigin(0, 0);
      const verb = this.add.text(cardX + 12, y + 5, '', {
        fontSize: '9px',
        color: UI.textDim,
        fontFamily: FONT.body,
        fontStyle: 'bold',
      });
      const title = this.add.text(cardX + 70, y + 5, '', {
        fontSize: '8px', color: UI.textDim, fontFamily: FONT.body,
      });
      const resultVerb = this.add.text(cardX + 12, y + 20, '', {
        fontSize: '8px', color: UI.text, fontFamily: FONT.body, fontStyle: 'bold',
      });
      const body = this.add.text(cardX + 48, y + 20, '', {
        fontSize: '8px', color: UI.text, fontFamily: FONT.body,
        wordWrap: { width: cardW - 58 }, lineSpacing: 0, maxLines: 1,
      });
      const calculation = this.add.text(cardX + 12, y + 34, '', {
        fontSize: '8px', color: UI.textDim, fontFamily: FONT.body,
        wordWrap: { width: cardW - 20 }, lineSpacing: 0, maxLines: 1,
      });
      const selectVisibleRow = (): void => {
        const row = this.visibleLogRows()[index];
        if (!row) return;
        this.selectTurn(row);
        // Clicking the final RESULT log row pops out the per-card fight report.
        if (row.note === 'RESULT') this.openReportModal();
      };
      bg.on('pointerdown', selectVisibleRow);
      for (const text of [verb, title, resultVerb, body, calculation]) {
        text.setInteractive({ useHandCursor: true }).on('pointerdown', selectVisibleRow);
      }
      const container = this.add.container(0, 0, [bg, accent, line, verb, title, resultVerb, body, calculation]);
      this.feedCards.push({ container, bg, accent, line, verb, title, resultVerb, body, calculation, calculationTokens: [] });
    }

    const pagerY = feedStartY + FEED_CARD_H * FEED_ROWS + 10;
    this.makeButton(feedX, pagerY, 42, 30, '‹', UI.panel, UI.text, () => this.changeLogPage(-1));
    this.pageText = this.add
      .text(feedX + feedW / 2, pagerY + 15, '', {
        fontSize: '10px',
        color: UI.text,
        fontFamily: FONT.body,
        fontStyle: 'bold',
      })
      .setOrigin(0.5);
    this.makeButton(feedX + feedW - 42, pagerY, 42, 30, '›', UI.panel, UI.text, () => this.changeLogPage(1));

    const playbackY = pagerY + 40;
    this.playbackButtons.set(1, this.makeButton(feedX, playbackY, 52, 30, '1×', UI.chipDark, '#ffffff', () => this.setPlaybackRate(1)));
    this.playbackButtons.set(2, this.makeButton(feedX + 58, playbackY, 52, 30, '2×', UI.panelMuted, UI.text, () => this.setPlaybackRate(2)));
    const utilityX = feedX + 116;
    const utilityW = feedW - 116;
    const auraW = 52;
    this.auraToggle = this.makeButton(utilityX, playbackY, auraW, 30, 'AURA ON', UI.chip, '#1a1208', () => this.toggleAuraView());
    this.auraToggle.text.setFontSize('8px');
    const endButton = this.makeButton(utilityX + auraW + 6, playbackY, utilityW - auraW - 6, 30, 'END', UI.panelAlt, UI.text, () => this.finishPlayback());
    endButton.text.setFontSize('9px');
    this.refreshFeed();
  }

  private buildControls(): void {
    this.makeButton(SCREEN.safeX, FOOTER_ACTION_LAYOUT.y, FOOTER_ACTION_LAYOUT.firstWidth, FOOTER_ACTION_LAYOUT.height, 'PREP', UI.panel, UI.text, () => this.scene.start('Prep'));
    this.makeButton(SCREEN.safeX + FOOTER_ACTION_LAYOUT.secondX, FOOTER_ACTION_LAYOUT.y, FOOTER_ACTION_LAYOUT.secondWidth, FOOTER_ACTION_LAYOUT.height, 'REPLAY', UI.chipDark, '#ffffff', () => this.scene.restart());
    this.makeButton(SCREEN.safeX + FOOTER_ACTION_LAYOUT.thirdX, FOOTER_ACTION_LAYOUT.y, VIEW_W - FOOTER_ACTION_LAYOUT.thirdX, FOOTER_ACTION_LAYOUT.height, 'NEW SEED', UI.panelAlt, UI.text, () => {
      demoState.seed = Math.floor(Math.random() * 1_000_000);
      this.scene.restart();
    });
  }

  private makeButton(
    x: number,
    y: number,
    w: number,
    h: number,
    label: string,
    fill: number,
    textColor: string,
    onClick: () => void,
  ): ButtonPair {
    const rect = this.add.rectangle(x, y, w, h, fill).setOrigin(0, 0).setStrokeStyle(1, UI.battleOutline).setInteractive({ useHandCursor: true });
    const text = this.add
      .text(x + w / 2, y + h / 2, label, {
        fontSize: '11px',
        color: textColor,
        fontFamily: FONT.body,
        fontStyle: 'bold',
      })
      .setOrigin(0.5);

    rect.on('pointerover', () => {
      rect.setScale(1.01);
      text.setScale(1.01);
    });
    rect.on('pointerout', () => {
      rect.setScale(1);
      text.setScale(1);
    });
    rect.on('pointerdown', () => {
      rect.setScale(0.98);
      text.setScale(0.98);
      onClick();
    });
    rect.on('pointerup', () => {
      rect.setScale(1);
      text.setScale(1);
    });

    return { rect, text };
  }

  private inspectSkill(skillId: string): void {
    const skill = skillBook[skillId];
    if (!skill) return;
    const role = isAuraSkill(skill) ? 'AURA · ' : '';
    this.selectedSkillText.setText(`${role}${skill.name} · ${skill.property} · size ${skill.size}`);
  }

  private openSkillModal(skill: SkillDef, piece: BoardPiece): void {
    this.closeModal();
    this.inspectSkill(skill.id);

    const effectiveSkill = resolveEffectiveSkill(skill, piece);
    const basePl = instancePowerLevelDeci(skill, { gem: null });
    const totalPl = instancePowerLevelDeci(skill, piece);
    const gem = piece.gem ? gemBook[piece.gem.id] : undefined;
    const aura = describeAura(skill);

    const overlay = this.add.rectangle(0, 0, SCREEN.width, SCREEN.height, UI.border, 0.48).setOrigin(0, 0).setDepth(50).setInteractive();
    const panelX = SCREEN.safeX + 14;
    const panelY = 206;
    const panelW = VIEW_W - 28;
    const panelH = 700;
    const bg = this.add.rectangle(panelX, panelY, panelW, panelH, UI.battleFrame).setOrigin(0, 0).setStrokeStyle(1, UI.battleOutline).setDepth(51).setInteractive();
    const accent = this.add.rectangle(panelX, panelY, panelW, 10, PROPERTY_COLOR[skill.property]).setOrigin(0, 0).setDepth(52);
    const title = this.add.text(panelX + 24, panelY + 30, skill.name, {
      fontSize: '26px',
      color: UI.text,
      fontFamily: FONT.display,
      fontStyle: 'bold',
      fixedWidth: panelW - 112,
      maxLines: 2,
    }).setDepth(52);
    const context = this.add.text(panelX + 24, panelY + 76, `CARD INFORMATION · BOARD SLOTS ${piece.slot + 1}-${piece.slot + skill.size}`, {
      fontSize: '10px',
      color: UI.textDim,
      fontFamily: FONT.body,
      fontStyle: 'bold',
    }).setDepth(52);

    const chips: Phaser.GameObjects.Text[] = [];
    const chipLabels = [
      isAuraSkill(skill) ? 'AURA' : skill.archetypes[0]?.toUpperCase(),
      skill.tier.toUpperCase(),
      PROPERTY_LABEL[skill.property],
      skill.element?.toUpperCase() ?? skill.weapon?.toUpperCase(),
    ].filter((label): label is string => Boolean(label));
    let chipX = panelX + 24;
    for (const label of chipLabels) {
      const chip = this.add.text(chipX, panelY + 101, label, {
        fontSize: '8px',
        color: '#ffffff',
        fontFamily: FONT.body,
        fontStyle: 'bold',
        backgroundColor: this.hexColor(label === PROPERTY_LABEL[skill.property] ? PROPERTY_COLOR[skill.property] : UI.laneLog),
        padding: { x: 8, y: 4 },
      }).setDepth(52);
      chips.push(chip);
      chipX += chip.width + 6;
    }

    const metricObjects: Phaser.GameObjects.GameObject[] = [];
    const metricGap = 8;
    const metricX = panelX + 24;
    const metricY = panelY + 142;
    const metricW = (panelW - 48 - metricGap * 3) / 4;
    const metrics = [
      ['WEIGHT', String(weightOf(effectiveSkill))],
      ['SIZE', `${effectiveSkill.size} SLOT${effectiveSkill.size === 1 ? '' : 'S'}`],
      ['COOLDOWN', `${effectiveCooldown(effectiveSkill)} TURNS`],
      ['TOTAL PL', formatPowerDeci(totalPl)],
    ];
    metrics.forEach(([label, value], index) => {
      const x = metricX + index * (metricW + metricGap);
      const tile = this.add.rectangle(x, metricY, metricW, 64, index % 2 === 0 ? UI.panelMuted : UI.panelAlt, 0.74).setOrigin(0, 0).setStrokeStyle(1, UI.battleOutline, 0.3).setDepth(52);
      const metricLabel = this.add.text(x + 10, metricY + 9, label!, {
        fontSize: '8px', color: UI.textDim, fontFamily: FONT.body, fontStyle: 'bold',
      }).setDepth(53);
      const metricValue = this.add.text(x + 10, metricY + 29, value!, {
        fontSize: '14px', color: UI.text, fontFamily: FONT.display, fontStyle: 'bold',
        fixedWidth: metricW - 20, maxLines: 1,
      }).setDepth(53);
      metricObjects.push(tile, metricLabel, metricValue);
    });

    const effectY = panelY + 226;
    const effectBg = this.add.rectangle(panelX + 24, effectY, panelW - 48, 142, UI.panelAlt, 0.72).setOrigin(0, 0).setStrokeStyle(1, UI.battleOutline, 0.34).setDepth(52);
    const effectLabel = this.add.text(panelX + 40, effectY + 14, 'CARD EFFECT', {
      fontSize: '9px', color: UI.textDim, fontFamily: FONT.body, fontStyle: 'bold',
    }).setDepth(53);
    // The authored `text` carries Bronze numbers; a RANK-upgraded card would show
    // stale values, so tiered cards show the scaled effect breakdown instead.
    const isTiered = skill.tier !== (skillBook[skill.id]?.tier ?? skill.tier);
    const effectBody = isTiered
      ? presentCardActions(skill).map((a) => `${a.verb}: ${a.effect}`).join('\n')
      : stripCardTextMarkup(skill.text);
    const body = this.add.text(panelX + 40, effectY + 40, effectBody, {
      fontSize: '16px',
      color: UI.text,
      fontFamily: FONT.body,
      fontStyle: 'bold',
      wordWrap: { width: panelW - 80 },
      lineSpacing: 7,
      maxLines: 4,
    }).setDepth(53);

    const detailY = effectY + 160;
    const detailBg = this.add.rectangle(panelX + 24, detailY, panelW - 48, 174, UI.battleLog, 0.72).setOrigin(0, 0).setStrokeStyle(1, UI.battleOutline, 0.28).setDepth(52);
    const detailLabel = this.add.text(panelX + 40, detailY + 14, aura ? 'AURA & SOCKET' : 'SOCKET', {
      fontSize: '9px', color: UI.textDim, fontFamily: FONT.body, fontStyle: 'bold',
    }).setDepth(53);
    const detailLines = [
      aura ? `Aura · ${aura}` : '',
      gem ? `${gem.name.toUpperCase()} · ${gem.rarity.toUpperCase()} · +${gemPowerLevel(gem)} PL` : 'Empty socket',
      gem?.text ?? '',
      gem ? `Card PL · ${formatPowerDeci(basePl)} base + ${gemPowerLevel(gem)} gem = ${formatPowerDeci(totalPl)}` : `Card PL · ${formatPowerDeci(basePl)}`,
    ].filter(Boolean);
    const detailText = this.add.text(panelX + 40, detailY + 40, detailLines.join('\n\n'), {
      fontSize: '12px',
      color: UI.text,
      fontFamily: FONT.body,
      wordWrap: { width: panelW - 80 },
      lineSpacing: 5,
      maxLines: 7,
    }).setDepth(53);

    const hint = this.add.text(panelX + 24, panelY + panelH - 42, 'Tap outside this card sheet to close.', {
      fontSize: '9px', color: UI.textDim, fontFamily: FONT.body,
    }).setDepth(52);
    const close = this.makeButton(panelX + panelW - 58, panelY + 22, 34, 32, '×', UI.laneLog, '#ffffff', () => this.closeModal());
    close.rect.setDepth(52);
    close.text.setDepth(53);
    overlay.on('pointerdown', () => this.closeModal());

    this.modalObjects.push(
      overlay, bg, accent, title, context, ...chips, ...metricObjects,
      effectBg, effectLabel, body, detailBg, detailLabel, detailText, hint,
      close.rect, close.text,
    );
  }

  private openStatsModal(name: string, stats: CombatantStats, level: number, side: Side): void {
    this.closeModal();

    const overlay = this.add.rectangle(0, 0, SCREEN.width, SCREEN.height, UI.border, 0.42).setOrigin(0, 0).setDepth(50).setInteractive();
    const panelX = SCREEN.safeX + 36;
    const panelY = 338;
    const panelW = VIEW_W - 72;
    const panelH = 360;
    const bg = this.add.rectangle(panelX, panelY, panelW, panelH, UI.battleFrame).setOrigin(0, 0).setStrokeStyle(2, UI.battleOutline).setDepth(51);
    const accent = this.add.rectangle(panelX, panelY, panelW, 12, side === 'player' ? UI.good : UI.bad).setOrigin(0, 0).setDepth(52);
    const title = this.add.text(panelX + 22, panelY + 34, `${name} · Level ${level}`, {
      fontSize: '22px',
      color: UI.text,
      fontFamily: FONT.display,
      fontStyle: 'bold',
    }).setDepth(52);
    const role = this.add.text(panelX + 22, panelY + 72, side === 'player' ? 'Player combatant' : 'Monster combatant', {
      fontSize: '12px',
      color: UI.textDim,
      fontFamily: FONT.body,
    }).setDepth(52);
    const statText = [
      `HP         ${stats.maxHp}`,
      `Attack     ${stats.attack}`,
      `Magic      ${stats.magicPower}`,
      `Armor      ${stats.armor}`,
      `Resist     ${stats.magicResist}`,
      `Speed      ${stats.speed}`,
      `Crit       ${stats.critPct}%`,
    ].join('\n');
    const statsBlock = this.add.text(panelX + 22, panelY + 112, statText, {
      fontSize: '16px',
      color: UI.text,
      fontFamily: FONT.body,
      lineSpacing: 8,
    }).setDepth(52);
    const close = this.makeButton(panelX + panelW - 114, panelY + panelH - 58, 88, 34, 'CLOSE', UI.chip, '#1a1208', () => this.closeModal());
    close.rect.setDepth(52);
    close.text.setDepth(53);
    overlay.on('pointerdown', () => this.closeModal());

    this.modalObjects.push(overlay, bg, accent, title, role, statsBlock, close.rect, close.text);
  }

  private closeModal(): void {
    for (const obj of this.modalObjects) obj.destroy();
    this.modalObjects = [];
  }

  private buildActivationRows(events: CombatEvent[], initialSnapshot: BattleSnapshot): ActivationRow[] {
    const rows: ActivationRow[] = [];
    const gainRows = new Map<number, ActivationRow>();
    let activePlay: { side: Side; unit: number; skillId: string; slot: number } | null = null;
    let activePlayRow: ActivationRow | null = null;
    let activeTurn = -1;
    let snapshot = this.cloneBattleSnapshot(initialSnapshot);

    const push = (
      turn: number,
      note: string,
      activation: string,
      options: Partial<Pick<ActivationRow, 'side' | 'unit' | 'skillId' | 'slot' | 'weight' | 'auraSources' | 'resultLines' | 'targetSide' | 'targetUnit'>> = {},
    ): ActivationRow => {
      const row: ActivationRow = {
        turn,
        side: options.side ?? null,
        unit: options.unit ?? null,
        skillId: options.skillId ?? null,
        slot: options.slot ?? null,
        weight: options.weight ?? null,
        note,
        activation,
        entries: [],
        tempoLines: new Map(),
        auraSources: options.auraSources ?? [],
        resultLines: options.resultLines ?? [],
        targetSide: options.targetSide ?? null,
        targetUnit: options.targetUnit ?? null,
        snapshot: this.cloneBattleSnapshot(snapshot),
      };
      rows.push(row);
      return row;
    };

    const syncRowSnapshot = (row: ActivationRow | null): void => {
      if (row) row.snapshot = this.cloneBattleSnapshot(snapshot);
    };

    for (const event of events) {
      if (event.turn !== activeTurn) {
        activeTurn = event.turn;
        activePlay = null;
        activePlayRow = null;
      }

      if (event.kind === 'gain') {
        const speedEffect = event.speedModifier === 0
          ? ''
          : ` · effect ${event.speedModifier > 0 ? '+' : ''}${event.speedModifier}`;
        const gainLine = `${this.unitLabel(event.side, event.unit)} · R ${event.readinessBefore} → ${event.readinessAfter} · +${event.speed} Speed${speedEffect}`;
        const gainRow = gainRows.get(event.turn);
        if (gainRow) {
          gainRow.activation += `\n${gainLine}`;
        } else {
          gainRows.set(event.turn, push(event.turn, 'GAIN', gainLine));
        }
      } else if (event.kind === 'play') {
        activePlay = { side: event.side, unit: event.unit, skillId: event.skillId, slot: event.slot };
        const auraSources = (event.auras ?? []).map((aura) => presentAuraSource(aura, skillBook));
        activePlayRow = push(
          event.turn,
          'PLAY',
          `${this.unitLabel(event.side, event.unit)} · ${this.skillName(event.skillId)} · S${event.slot + 1} · weight ${event.weight}${this.formatTarget(event)}${event.damage === undefined ? '' : ` · -${event.damage} HP [${event.hpAfter}]`}`,
          {
            side: event.side,
            unit: event.unit,
            skillId: event.skillId,
            slot: event.slot,
            weight: event.weight,
            auraSources,
            targetSide: event.targetUnit === undefined ? null : this.opposingSide(event.side),
            targetUnit: event.targetUnit ?? null,
          },
        );
      } else if (event.kind === 'cost') {
        if (activePlayRow && activePlay?.side === event.side && activePlay.unit === event.unit) {
          activePlayRow.resultLines.push(`R ${event.readinessBefore} → ${event.readinessAfter} · paid ${event.paid}`);
        } else {
          push(event.turn, 'COST', `${this.unitLabel(event.side, event.unit)} · readiness ${event.readinessBefore} → ${event.readinessAfter} · paid ${event.paid}`, event);
        }
      } else if (event.kind === 'cursor') {
        const card = event.skillId ? this.skillName(event.skillId) : `empty slot ${event.slot + 1}`;
        const span = event.slotCount && event.slotCount > 1 ? ` · ${event.slotIndex}/${event.slotCount}` : '';
        const cursorLine = `next ${card} · S${event.slot + 1}${span}${event.wrapped ? ' · wrap' : ''}`;
        if (activePlayRow && activePlay?.side === event.side && activePlay.unit === event.unit) {
          const last = activePlayRow.resultLines.length - 1;
          if (last >= 0 && activePlayRow.resultLines[last]!.startsWith('R ')) {
            activePlayRow.resultLines[last] += ` · ${cursorLine}`;
          } else {
            activePlayRow.resultLines.push(cursorLine);
          }
        } else {
          push(event.turn, 'CURSOR', `${this.unitLabel(event.side, event.unit)} → ${card} · S${event.slot + 1}${span}${event.wrapped ? ' · wrap' : ''}`, {
            side: event.side, unit: event.unit, skillId: event.skillId, slot: event.skillId ? event.slot - (event.slotIndex ?? 1) + 1 : null,
          });
        }
      } else if (event.kind === 'busy') {
        push(event.turn, 'BUSY', `${this.unitLabel(event.side, event.unit)} · ${this.skillName(event.skillId)} resolving · ${event.slotIndex}/${event.slotCount}`, {
          side: event.side, unit: event.unit, skillId: event.skillId, slot: event.slot - event.slotIndex + 1,
        });
      } else if (event.kind === 'wait') {
        const text = event.reason === 'cantAfford'
          ? `${this.unitLabel(event.side, event.unit)} · readiness ${event.readiness} < ${this.skillName(event.skillId)} weight ${event.weight}`
          : event.reason === 'cooling'
            ? `${this.unitLabel(event.side, event.unit)} · ${this.skillName(event.skillId)} cooling · ${event.turnsLeft}t left`
            : `${this.unitLabel(event.side, event.unit)} · ${event.reason === 'stunned' ? 'stunned' : 'no cards'}`;
        push(event.turn, 'WAIT', text, {
          side: event.side,
          unit: event.unit,
          skillId: 'skillId' in event ? event.skillId : undefined,
          slot: 'slot' in event ? event.slot : undefined,
        });
      } else if (event.kind === 'end') {
        push(event.turn, 'END', 'Turn complete');
      } else if (event.kind === 'damage') {
        const dealt = Math.max(0, event.amount - event.blocked);
        const tags = [event.blocked ? `${event.blocked} blocked` : '', event.crit ? 'CRIT' : ''].filter(Boolean).join(' · ');
        const isPreTurnDot = event.source === 'poison' || event.source === 'burn';
        const sourceLabel = isPreTurnDot ? `${event.source.toUpperCase()} · ` : '';
        const hitLine = `${sourceLabel}${this.unitLabel(event.side, event.unit)} · -${dealt} HP · ${event.hpAfter} left${tags ? ` · ${tags}` : ''}`;
        snapshot[event.side][event.unit] = {
          hp: event.hpAfter,
          shield: Math.max(0, snapshot[event.side][event.unit]!.shield - event.blocked),
        };
        if (event.source === 'skill' && activePlayRow) {
          activePlayRow.resultLines.push(`HIT · ${hitLine}`);
          if (event.calculation) activePlayRow.resultLines.push(this.formatDamageCalculation(event.calculation));
          syncRowSnapshot(activePlayRow);
        } else {
          push(event.turn, isPreTurnDot ? 'PRE-TURN' : event.source.toUpperCase(), hitLine, {
            targetSide: event.side,
            targetUnit: event.unit,
          });
        }
      } else if (event.kind === 'heal') {
        const over = event.overheal > 0 ? ` (+${event.overheal} overheal)` : '';
        snapshot[event.side][event.unit] = {
          hp: event.hpAfter,
          shield: snapshot[event.side][event.unit]!.shield,
        };
        if (activePlayRow) activePlayRow.resultLines.push(`HEAL · ${this.unitLabel(event.side, event.unit)} +${event.amount} HP${over} · ${event.hpAfter}`);
        else push(event.turn, 'HEAL', `${this.unitLabel(event.side, event.unit)} · +${event.amount} HP${over} · ${event.hpAfter}`, event);
        syncRowSnapshot(activePlayRow);
      } else if (event.kind === 'shieldGain') {
        snapshot[event.side][event.unit] = {
          hp: snapshot[event.side][event.unit]!.hp,
          shield: event.totalAfter,
        };
        if (activePlayRow) activePlayRow.resultLines.push(`SHIELD · ${this.unitLabel(event.side, event.unit)} +${event.amount} · ${event.totalAfter}`);
        else push(event.turn, 'SHIELD', `${this.unitLabel(event.side, event.unit)} · +${event.amount} shield · ${event.totalAfter}`, event);
        syncRowSnapshot(activePlayRow);
      } else if (event.kind === 'statusApplied') {
        const magnitude = event.stat
          ? `${event.stat.toUpperCase()} ${event.status === 'debuff' ? '-' : '+'}${event.pct ?? event.amount ?? 0}${event.pct !== undefined ? '%' : ''} · ${event.turns}t`
          : `${event.status}${event.property ? ` ${event.property}` : ''} · ${event.turns}t`;
        const statusLine = `${this.unitLabel(event.side, event.unit)} · ${magnitude}`;
        if (activePlayRow) activePlayRow.resultLines.push(`STATUS · ${statusLine}`);
        else push(event.turn, 'STATUS', statusLine, event);
      } else if (event.kind === 'statusExpired') {
        push(event.turn, 'STATUS', `${this.unitLabel(event.side, event.unit)} · ${event.status} ended`, event);
      } else if (event.kind === 'cleansed') {
        push(event.turn, 'CLEANSE', `${this.unitLabel(event.side, event.unit)} · removed ${event.removed} effects`, activePlay ?? event);
      } else if (event.kind === 'aggroChanged') {
        push(event.turn, 'AGGRO', `${this.unitLabel(event.side, event.unit)} · aggro ${event.aggro}`, activePlay ?? event);
      } else if (event.kind === 'slowed') {
        push(event.turn, 'SLOW', `${this.unitLabel(event.side, event.unit)} · next card +${event.weight} weight`, activePlay ?? event);
      } else if (event.kind === 'disrupted') {
        push(event.turn, 'STAGGER', `${this.unitLabel(event.side, event.unit)} · readiness -${event.amount} → ${event.readinessAfter}`, activePlay ?? event);
      } else if (event.kind === 'shieldBroken') {
        snapshot[event.side][event.unit] = {
          hp: snapshot[event.side][event.unit]!.hp,
          shield: event.totalAfter,
        };
        push(event.turn, 'BREAK', `${this.unitLabel(event.side, event.unit)} · shield -${event.amount} → ${event.totalAfter}`, activePlay ?? event);
      } else if (event.kind === 'negated') {
        push(event.turn, 'NEGATE', `${this.unitLabel(event.side, event.unit)} negated ${event.property}`, activePlay ?? event);
      } else if (event.kind === 'died') {
        if (activePlayRow) activePlayRow.resultLines.push(`DOWN · ${this.unitLabel(event.side, event.unit)}`);
        else push(event.turn, 'DOWN', `${this.unitLabel(event.side, event.unit)} was defeated`, { targetSide: event.side, targetUnit: event.unit });
      } else if (event.kind === 'suddenDeathStart') {
        push(event.turn, 'SUDDEN DEATH', 'Damage escalation has begun');
      } else if (event.kind === 'fatigueStart') {
        push(event.turn, 'FATIGUE', 'Endurance damage has begun');
      } else if (event.kind === 'combatEnd') {
        push(event.turn, 'RESULT', `${event.result.toUpperCase()} · ${event.turns} turns`);
      }
    }

    return rows;
  }

  private initialBattleSnapshot(stats: CombatantStats): BattleUnitSnapshot {
    return { hp: stats.maxHp, shield: 0 };
  }

  private cloneBattleSnapshot(snapshot: BattleSnapshot): BattleSnapshot {
    return {
      player: snapshot.player.map((unit) => ({ ...unit })),
      enemy: snapshot.enemy.map((unit) => ({ ...unit })),
    };
  }

  private startPlayback(): void {
    this.refreshFeed();
    this.playbackTimer = this.time.delayedCall(this.scaledMs(650), () => this.playbackStep());
  }

  private scaledMs(milliseconds: number): number {
    return Math.max(1, Math.round(milliseconds / this.playbackRate));
  }

  private setPlaybackRate(rate: 1 | 2): void {
    if (this.playbackRate === rate) return;
    const previousRate = this.playbackRate;
    this.playbackRate = rate;

    for (const [buttonRate, button] of this.playbackButtons) {
      const selected = buttonRate === rate;
      button.rect.setFillStyle(selected ? UI.chipDark : UI.panelMuted);
      button.text.setColor(selected ? '#ffffff' : UI.text);
    }

    if (this.playbackTimer && !this.finished) {
      const remaining = this.playbackTimer.getRemaining();
      this.playbackTimer.remove(false);
      const adjustedRemaining = Math.max(80, Math.round((remaining * previousRate) / rate));
      this.playbackTimer = this.time.delayedCall(adjustedRemaining, () => this.playbackStep());
    }
  }

  private finishPlayback(): void {
    this.playbackTimer?.remove(false);
    this.playbackTimer = undefined;
    for (const timer of this.pendingVisualTimers) timer.remove(false);
    this.pendingVisualTimers = [];
    for (const animation of this.hpTweenCounters) this.tweens.killTweensOf(animation.counter);
    this.hpTweenCounters = [];

    while (this.eventIdx < this.result.events.length) {
      this.applyEvent(this.result.events[this.eventIdx++]!, true);
    }
    for (const side of ['player', 'enemy'] as Side[]) {
      for (let unit = 0; unit < this.views[side].length; unit++) {
        const view = this.views[side][unit]!;
        view.displayHp = view.hp;
        view.scheduledHp = view.hp;
        this.refreshBars(side, unit);
      }
    }

    this.revealedRowCount = this.activationRows.length;
    this.logPage = Math.max(0, Math.ceil(this.revealedRowCount / FEED_ROWS) - 1);
    this.selectTurn(this.activationRows[this.revealedRowCount - 1] ?? null);
    for (const card of this.feedCards) {
      this.tweens.killTweensOf(card.container);
      card.container.setY(0).setAlpha(1);
    }
    this.flushCombatEnd(true);
  }

  private scheduleVisual(delay: number, callback: () => void): void {
    if (delay <= 0) {
      callback();
      this.flushCombatEnd();
      return;
    }
    let timer: Phaser.Time.TimerEvent;
    timer = this.time.delayedCall(delay, () => {
      const index = this.pendingVisualTimers.indexOf(timer);
      if (index >= 0) this.pendingVisualTimers.splice(index, 1);
      callback();
      this.flushCombatEnd();
    });
    this.pendingVisualTimers.push(timer);
  }

  private playbackStep(): void {
    const first = this.result.events[this.eventIdx];
    if (!first) return;

    const turn = first.turn;
    let rowOrder = 0;
    let gainDelay: number | null = null;
    let activePlay: { side: Side; unit: number; delay: number } | null = null;
    const startRow = (): number => {
      const delay = this.scaledMs(rowOrder * LOG_REVEAL_STAGGER_MS);
      rowOrder += 1;
      return delay;
    };
    while (this.eventIdx < this.result.events.length && this.result.events[this.eventIdx]!.turn === turn) {
      const event = this.result.events[this.eventIdx++]!;
      let visualDelay = this.scaledMs(Math.max(0, rowOrder - 1) * LOG_REVEAL_STAGGER_MS);

      switch (event.kind) {
        case 'gain':
          gainDelay ??= startRow();
          visualDelay = gainDelay;
          break;
        case 'play':
          visualDelay = startRow();
          activePlay = { side: event.side, unit: event.unit, delay: visualDelay };
          break;
        case 'cost':
        case 'cursor':
          visualDelay = activePlay?.side === event.side && activePlay.unit === event.unit ? activePlay.delay : startRow();
          break;
        case 'damage':
          visualDelay = event.source === 'skill' && activePlay ? activePlay.delay : startRow();
          break;
        case 'heal':
        case 'shieldGain':
        case 'statusApplied':
          visualDelay = activePlay?.delay ?? startRow();
          break;
        case 'died':
          visualDelay = activePlay?.delay ?? startRow();
          break;
        case 'busy':
        case 'wait':
        case 'end':
        case 'statusExpired':
        case 'cleansed':
        case 'aggroChanged':
        case 'slowed':
        case 'disrupted':
        case 'shieldBroken':
        case 'negated':
        case 'suddenDeathStart':
        case 'fatigueStart':
        case 'combatEnd':
          visualDelay = startRow();
          break;
        default:
          break;
      }

      this.applyEvent(event, false, visualDelay);
    }

    const previousCount = this.revealedRowCount;
    while (this.revealedRowCount < this.activationRows.length && this.activationRows[this.revealedRowCount]!.turn <= turn) {
      this.revealedRowCount += 1;
    }

    this.logPage = Math.max(0, Math.ceil(this.revealedRowCount / FEED_ROWS) - 1);
    this.selectTurn(this.activationRows[this.revealedRowCount - 1] ?? null);
    this.revealNewRows(previousCount);

    if (this.eventIdx < this.result.events.length) {
      const revealedThisTurn = Math.max(1, this.revealedRowCount - previousCount);
      const nextTurnDelay = this.scaledMs(TURN_SETTLE_MS + revealedThisTurn * LOG_REVEAL_STAGGER_MS);
      this.playbackTimer = this.time.delayedCall(nextTurnDelay, () => this.playbackStep());
    }
  }

  private ensureTurnSummary(turn: number): TurnSummary {
    const existing = this.turnSummaries.get(turn);
    if (existing) return existing;

    const summary: TurnSummary = {
      turn,
      round: Math.min(this.performsSeen.player, this.performsSeen.enemy) + 1,
      performer: null,
      player: {
        bank: 0,
        speed: 0,
        weight: null,
        score: null,
        state: 'nothingUsable',
        banked: 0,
        used: 0,
        cardId: null,
        stunned: false,
      },
      enemyCardId: null,
      notes: [],
    };
    this.turnSummaries.set(turn, summary);
    return summary;
  }

  private addTurnNote(turn: number, note: string): void {
    const summary = this.ensureTurnSummary(turn);
    if (summary.notes.includes(note)) return;
    summary.notes.push(note);
    if (summary.notes.length > 4) summary.notes.shift();
  }

  private refreshFeed(): void {
    const visible = this.visibleLogRows();
    const pageCount = this.logPageCount();
    if (this.pageText) {
      const firstTurn = visible[0]?.turn;
      const lastTurn = visible[visible.length - 1]?.turn;
      const range = firstTurn === undefined ? 'NO TURNS' : `T${firstTurn}-${lastTurn}`;
      this.pageText.setText(`${range} · ${this.logPage + 1}/${pageCount}`);
    }

    for (let index = 0; index < this.feedCards.length; index++) {
      const card = this.feedCards[index]!;
      const row = visible[index];
      const isSelected = row === this.selectedRow;
      const presentation = row ? this.rowPresentation(row) : null;
      const verbColor = row ? this.rowVerbColor(presentation?.verb ?? row.note, row) : UI.border;
      const resultColor = row ? this.rowVerbColor(presentation?.resultVerb ?? '', row) : UI.border;
      card.bg.setVisible(true);
      card.accent.setVisible(Boolean(row));
      card.line.setVisible(Boolean(row) && index < visible.length - 1);
      card.bg.setFillStyle(isSelected ? UI.panelAlt : index % 2 === 0 ? UI.battleFrame : UI.battleLog, isSelected ? 1 : 0.84);
      card.bg.setStrokeStyle(isSelected ? 1 : 0, verbColor);
      card.accent.setFillStyle(UI.battleOutline, isSelected ? 0.66 : 0.24);
      card.verb.setVisible(Boolean(row)).setText(presentation?.verb ?? '').setColor(this.hexColor(verbColor));
      card.title
        .setVisible(Boolean(row))
        .setText(presentation?.title ?? '')
        .setX(card.bg.x + 12 + card.verb.width + 10);
      card.resultVerb.setVisible(Boolean(row && presentation?.resultVerb)).setText(presentation?.resultVerb ?? '').setColor(this.hexColor(resultColor));
      const bodyInset = presentation?.resultVerb ? 48 : 12;
      card.body
        .setVisible(Boolean(row))
        .setText(presentation?.body ?? '')
        .setX(card.bg.x + bodyInset)
        .setWordWrapWidth(card.bg.width - bodyInset - 8);
      const hasAuraTokens = this.renderFeedAuraTokens(card, row ?? null);
      card.calculation
        .setVisible(Boolean(row && presentation?.calculation && !hasAuraTokens))
        .setText(presentation?.calculation ?? '');
    }
  }

  private visibleLogRows(): ActivationRow[] {
    const start = this.logPage * FEED_ROWS;
    return this.activationRows.slice(start, Math.min(start + FEED_ROWS, this.revealedRowCount));
  }

  private logPageCount(): number {
    return Math.max(1, Math.ceil(this.revealedRowCount / FEED_ROWS));
  }

  private changeLogPage(delta: number): void {
    const next = Phaser.Math.Clamp(this.logPage + delta, 0, this.logPageCount() - 1);
    if (next === this.logPage) return;
    this.logPage = next;
    this.selectTurn(this.visibleLogRows()[0] ?? null);
    this.revealVisibleRows();
  }

  private selectTurn(row: ActivationRow | null): void {
    this.selectedRow = row;
    this.clearTurnHighlights();
    this.clearAuraObjects(this.selectedAuraObjects);
    if (!row) {
      for (const token of this.turnAuraTokens) token.destroy();
      this.turnAuraTokens = [];
      this.refreshFeed();
      return;
    }

    if (this.views.enemy.length > 1) {
      if (row.targetSide === 'enemy' && row.targetUnit !== null) this.focusEnemy(row.targetUnit);
      else if (row.side === 'enemy' && row.unit !== null) this.focusEnemy(row.unit);
    }
    if (row.side !== null && row.unit !== null && row.slot !== null) {
      this.viewFor(row.side, row.unit)?.cards.get(row.slot)?.setHighlight(true, row.note === 'WAIT' ? UI.waiting : row.side === 'player' ? UI.good : UI.bad);
    }
    if (row.side !== null && row.unit !== null) {
      row.auraSources.forEach((source, index) => {
        this.viewFor(row.side!, row.unit!)?.cards.get(source.slot)?.setHighlight(true, source.accent);
        const piece = this.viewFor(row.side!, row.unit!)?.pieces.get(source.slot);
        if (piece) this.showAuraReach(row.side!, row.unit!, piece, 'selection', index > 0);
      });
    }

    const page = Math.floor(this.activationRows.indexOf(row) / FEED_ROWS);
    this.logPage = Math.max(0, page);
    const castColor = row.side === 'player' ? UI.good : row.side === 'enemy' ? UI.bad : UI.border;
    this.turnText.setColor(`#${castColor.toString(16).padStart(6, '0')}`);
    this.turnText.setText(`TURN ${row.turn} · ${row.note}`);
    const calculation = row.resultLines.find((line) => line.startsWith('DMG '));
    const readiness = row.resultLines.find((line) => line.startsWith('R '));
    const outcomes = row.resultLines.filter((line) => line !== calculation && line !== readiness);
    this.comparisonText.setText(row.activation);
    this.renderTurnAuraSources(row);

    const resultLines = outcomes.slice(0, 1);
    if (readiness) resultLines.push(`READY · ${readiness}`);
    if (resultLines.length === 0) {
      resultLines.push(row.note === 'GAIN'
        ? 'SPEED · Added to every living combatant before cards resolve.'
        : row.note === 'END'
          ? 'TURN · All affordable activations have resolved.'
          : `${row.note} · No additional effect.`);
    }
    this.turnResultText.setText(`RESULT  ${resultLines.join('\n')}`);

    const math = calculation
      ?? (readiness ? `READINESS ${readiness.slice(2)}` : row.note === 'GAIN' ? 'ORDER · Highest affordable readiness resolves first.' : row.activation);
    this.renderTurnCalculation(math.replace(/^DMG\s+/, ''), Boolean(calculation));
    this.turnCalculationBg.setFillStyle(row.side === 'player' ? UI.goodSoft : row.side === 'enemy' ? UI.badSoft : UI.battleLog, 0.9);
    if (row.snapshot) {
      for (const side of ['player', 'enemy'] as Side[]) {
        for (let unit = 0; unit < this.views[side].length; unit++) {
          const snap = row.snapshot[side][unit];
          const view = this.views[side][unit];
          if (!snap || !view) continue;
          view.displayHp = snap.hp;
          view.shield = snap.shield;
          this.refreshBars(side, unit);
          if (side === 'enemy') this.updateEnemyRoster(unit);
        }
      }
    }
    this.refreshFeed();
  }

  private renderTurnCalculation(math: string, emphasizeValues: boolean): void {
    for (const token of this.turnCalculationTokens) token.destroy();
    this.turnCalculationTokens = [];

    const y = COMPARISON_PANEL.y + 188;
    const startX = COMPARISON_PANEL.x + 18;
    let x = startX;
    let line = 0;
    const maxX = COMPARISON_PANEL.x + COMPARISON_PANEL.w - 16;
    const addToken = (value: string, fontSize: string, color: string, fontStyle = ''): Phaser.GameObjects.Text => {
      const text = this.add.text(x, y + line * 13, value, {
        fontSize,
        color,
        fontFamily: FONT.body,
        fontStyle,
      });
      if (x > startX && x + text.width > maxX && line === 0) {
        line = 1;
        x = startX;
        text.setPosition(x, y + line * 13);
      }
      this.turnCalculationTokens.push(text);
      x += text.width + 3;
      return text;
    };

    addToken('MATH', '6px', UI.textDim, 'bold');
    if (!emphasizeValues) {
      const note = addToken(math, '7px', UI.textDim, 'bold');
      note.setCrop(0, 0, Math.max(0, maxX - note.x), note.height);
      return;
    }

    // Uniform token size + baseline so the row reads as one line; labels are
    // only distinguished by a dimmer colour, the final result by weight.
    const parts = math.split(/\s+/).filter(Boolean);
    for (let index = 0; index < parts.length; index++) {
      const part = parts[index]!;
      const isLabel = /^[A-Z]+$/.test(part) && part !== 'DMG';
      const isResult = part === '=' || parts[index - 1] === '=';
      const token = addToken(part, '8px', isLabel ? UI.textDim : UI.text, isResult ? 'bold' : '');
      if (x > maxX) {
        token.setCrop(0, 0, Math.max(0, maxX - token.x), token.height);
        break;
      }
    }
  }

  private clearTurnHighlights(): void {
    if (!this.views) return;
    for (const side of ['player', 'enemy'] as Side[]) {
      for (const view of this.views[side]) {
        for (const card of view.cards.values()) card.setHighlight(false);
      }
    }
  }

  private auraSourceText(row: ActivationRow): string {
    return row.auraSources
      .map((source) => `AURA ${source.label}${source.modifier ? ` · ${source.modifier}` : ''}`)
      .join(' + ');
  }

  private fitTextToken(token: Phaser.GameObjects.Text, maxWidth: number): void {
    if (token.width <= maxWidth) return;
    const original = token.text;
    let trimmed = original;
    while (trimmed.length > 1) {
      trimmed = trimmed.slice(0, -1);
      token.setText(`${trimmed}…`);
      if (token.width <= maxWidth) return;
    }
    token.setText('…');
  }

  private renderTurnAuraSources(row: ActivationRow): void {
    for (const token of this.turnAuraTokens) token.destroy();
    this.turnAuraTokens = [];
    if (row.auraSources.length === 0) return;

    const startX = COMPARISON_PANEL.x + 14;
    let x = startX;
    const y = COMPARISON_PANEL.y + 98;
    const maxX = COMPARISON_PANEL.x + COMPARISON_PANEL.w - 14;
    let line = 0;
    const add = (value: string, color: string, bold = false): void => {
      if (x >= maxX) return;
      const token = this.add.text(x, y + line * 9, value, {
        fontSize: '7px',
        color,
        fontFamily: FONT.body,
        fontStyle: bold ? 'bold' : '',
      });
      if (token.x + token.width > maxX && x > startX && line === 0) {
        line = 1;
        x = startX;
        token.setPosition(x, y + line * 9);
      }
      this.fitTextToken(token, Math.max(0, maxX - token.x));
      this.turnAuraTokens.push(token);
      x += token.width + 4;
    };

    add('AURA', UI.textDim, true);
    for (const source of row.auraSources) {
      add(source.label, this.hexColor(source.accent), true);
      if (source.modifier) add(source.modifier, this.hexColor(source.accent));
    }
  }

  private renderFeedAuraTokens(card: FeedCard, row: ActivationRow | null): boolean {
    for (const token of card.calculationTokens) token.destroy();
    card.calculationTokens = [];
    if (!row || row.auraSources.length === 0) return false;

    let x = card.bg.x + 12;
    const y = card.calculation.y;
    const maxX = card.bg.x + card.bg.width - 10;
    const add = (value: string, color: string, bold = false): void => {
      if (x >= maxX) return;
      const token = this.add.text(x, y, value, {
        fontSize: '8px',
        color,
        fontFamily: FONT.body,
        fontStyle: bold ? 'bold' : '',
      });
      this.fitTextToken(token, Math.max(0, maxX - token.x));
      token.setInteractive({ useHandCursor: true }).on('pointerdown', () => this.selectTurn(row));
      card.container.add(token);
      card.calculationTokens.push(token);
      x += token.width + 4;
    };

    add('AURA', UI.textDim, true);
    for (const source of row.auraSources.slice(0, 1)) {
      add(source.label, this.hexColor(source.accent), true);
      if (source.modifier) add(source.modifier, this.hexColor(source.accent));
    }
    if (row.auraSources.length > 1) add(`+${row.auraSources.length - 1}`, UI.textDim, true);
    return true;
  }

  private rowPresentation(row: ActivationRow): { verb: string; title: string; resultVerb: string; body: string; calculation: string } {
    if (row.note === 'PLAY' && row.side !== null && row.unit !== null && row.skillId) {
      const firstResult = row.resultLines[0] ?? row.activation;
      const knownResultVerbs = new Set(['HIT', 'HEAL', 'SHIELD', 'STATUS', 'DOWN', 'CLEANSE', 'AGGRO', 'SLOW', 'STAGGER', 'BREAK', 'NEGATE']);
      const divider = firstResult.indexOf(' · ');
      const candidateVerb = divider > 0 ? firstResult.slice(0, divider) : '';
      const resultVerb = knownResultVerbs.has(candidateVerb) ? candidateVerb : '';
      const body = resultVerb ? firstResult.slice(divider + 3) : firstResult;
      const calculation = row.resultLines.find((line) => line.startsWith('DMG '))
        || this.auraSourceText(row)
        || row.resultLines[1]
        || '';
      return {
        verb: 'PLAY',
        title: `T${row.turn} · ${this.shortUnitLabel(row.side, row.unit)} · ${this.skillName(row.skillId)}${row.weight === null ? '' : ` · W${row.weight}`}`,
        resultVerb,
        body,
        calculation,
      };
    }

    const [body = '', secondLine = ''] = row.activation.split('\n');
    return {
      verb: row.note,
      title: `T${row.turn}${row.side !== null && row.unit !== null ? ` · ${this.shortUnitLabel(row.side, row.unit)}` : ''}`,
      resultVerb: '',
      body,
      calculation: secondLine || this.auraSourceText(row),
    };
  }

  private rowVerbColor(verb: string, row: ActivationRow): number {
    switch (verb) {
      case 'PLAY':
        return row.side === 'enemy' ? UI.bad : UI.good;
      case 'HIT':
      case 'DOWN':
      case 'SUDDEN DEATH':
      case 'FATIGUE':
      case 'PRE-TURN':
      case 'BURN':
      case 'POISON':
        return UI.bad;
      case 'HEAL':
      case 'CLEANSE':
        return UI.good;
      case 'SHIELD':
      case 'GAIN':
      case 'COST':
      case 'CURSOR':
      case 'BUSY':
      case 'STATUS':
        return UI.shield;
      case 'WAIT':
      case 'STAGGER':
      case 'SLOW':
        return UI.waiting;
      case 'RESULT':
        return row.activation.startsWith('WIN') ? UI.good : UI.bad;
      default:
        return UI.border;
    }
  }

  private hexColor(color: number): string {
    return `#${color.toString(16).padStart(6, '0')}`;
  }

  private revealVisibleRows(): void {
    const visible = this.visibleLogRows();
    for (let index = 0; index < this.feedCards.length; index++) {
      const card = this.feedCards[index]!;
      this.tweens.killTweensOf(card.container);
      card.container.setY(0).setAlpha(visible[index] ? 0 : 1);
      if (!visible[index]) continue;
      card.container.setY(6);
      this.tweens.add({
        targets: card.container,
        y: 0,
        alpha: 1,
        delay: index * 36,
        duration: this.scaledMs(190),
        ease: 'Cubic.Out',
      });
    }
  }

  private revealNewRows(previousCount: number): void {
    const start = this.logPage * FEED_ROWS;
    for (let index = 0; index < this.feedCards.length; index++) {
      const card = this.feedCards[index]!;
      const rowIndex = start + index;
      const isNew = rowIndex >= previousCount && rowIndex < this.revealedRowCount;
      this.tweens.killTweensOf(card.container);
      card.container.setY(0).setAlpha(1);
      if (!isNew) continue;
      card.container.setY(6).setAlpha(0);
      this.tweens.add({
        targets: card.container,
        y: 0,
        alpha: 1,
        delay: this.scaledMs((rowIndex - previousCount) * LOG_REVEAL_STAGGER_MS),
        duration: this.scaledMs(320),
        ease: 'Cubic.Out',
      });
    }
  }

  private formatActivationRow(row: ActivationRow): string {
    if (row.note === 'PLAY' && row.side !== null && row.unit !== null && row.skillId) {
      const title = `T${row.turn} · ${this.shortUnitLabel(row.side, row.unit)} PLAY · ${this.skillName(row.skillId)}${row.weight === null ? '' : ` · W${row.weight}`}`;
      const result = row.resultLines[0] ?? row.activation;
      const calculation = row.resultLines.find((line) => line.startsWith('DMG ')) || this.auraSourceText(row) || row.resultLines[1];
      return [title, result, calculation].filter(Boolean).join('\n');
    }
    const aura = this.auraSourceText(row);
    return [`T${row.turn} · ${row.note}`, row.activation, aura].filter(Boolean).join('\n');
  }

  private formatDamageCalculation(calculation: NonNullable<Extract<CombatEvent, { kind: 'damage' }>['calculation']>): string {
    const stat = calculation.scalingStat === 'attack' ? 'ATK' : 'MAG';
    const terms = [`${calculation.power} BASE`, `+${calculation.baseStat} ${stat}`];
    const addTerm = (label: string, value: number): void => {
      if (value === 0) return;
      terms.push(`${value > 0 ? '+' : '-'}${label}${Math.abs(value)}`);
    };
    addTerm('BUFF', calculation.statBonusDamage);
    addTerm('FX', calculation.effectBonusDamage);
    addTerm('DEF', -calculation.defense);
    addTerm('MIN', calculation.minimumDamageBonus);
    addTerm('CRIT', calculation.critBonusDamage);
    addTerm('MATCH', calculation.matchupBonusDamage);
    addTerm('RAMP', calculation.suddenDeathBonusDamage);
    addTerm('GUARD', -calculation.guardReduction);
    addTerm('BLOCK', -calculation.shieldBlocked);
    return `DMG ${terms.join(' ')} = ${calculation.hpDamage}`;
  }

  private turnCastLabel(row: ActivationRow): string {
    return row.side === null ? row.note : `${this.activationActorLabel(row.side, row.unit).toUpperCase()} · ${row.note}`;
  }

  private comparisonEntries(event: Extract<CombatEvent, { kind: 'comparison' }>): ComparisonEntry[] {
    return event.entries.length > 0
      ? event.entries
      : [
          { side: 'player', unit: 0, ...event.player },
          { side: 'enemy', unit: 0, ...event.enemy },
        ];
  }

  private setTempoLine(row: ActivationRow, entry: ComparisonEntry, performed: boolean): void {
    const key = this.unitKey(entry.side, entry.unit);
    const math = this.formatSpeedMath(entry, this.shortUnitLabel(entry.side, entry.unit));
    const idle = entry.state === 'nothingUsable';
    const endBank = performed ? 0 : idle ? entry.bank : entry.bank + entry.speed;
    const reason = performed
      ? `ACT->bank0`
      : idle
        ? `SKIP · bank stays${entry.bank}`
        : entry.state === 'busy'
          ? `BUSY · BANK->${endBank}`
          : `BANK->${endBank}`;
    row.tempoLines.set(key, { math, bank: reason, startBank: entry.bank });
  }

  private applyStaggeredBank(row: ActivationRow, side: Side, unit: number, amount: number, bankAfter: number): void {
    const key = this.unitKey(side, unit);
    const existing = row.tempoLines.get(key);
    if (!existing) {
      row.tempoLines.set(key, {
        math: this.shortUnitLabel(side, unit),
        bank: `bank ?->${bankAfter} stag-${amount}`,
        startBank: bankAfter + amount,
      });
      return;
    }
    existing.bank = `bank ${existing.startBank}->${bankAfter} stag-${amount}`;
  }

  private addResultLine(row: ActivationRow, line: string): void {
    if (row.resultLines.includes(line)) return;
    row.resultLines.push(line);
  }

  private formatSpeedMath(side: ComparisonSide, label: string): string {
    if (side.state === 'busy') return `${label} bank${side.bank} + SPD${side.speed}`;
    if (side.state === 'nothingUsable') return `${label} bank${side.bank} + SPD${side.speed} · no card`;
    return `${label} bank${side.bank} + SPD${side.speed} - card${side.weight} = ${side.score}`;
  }

  private activationActorLabel(side: Side | null, unit: number | null = null): string {
    if (side !== null && unit !== null) return this.unitLabel(side, unit);
    if (side === 'player') return this.views?.player?.[0]?.name ?? this.unitNames.player[0] ?? 'Hero';
    if (side === 'enemy') return this.views?.enemy?.[0]?.name ?? this.unitNames.enemy[0] ?? 'Enemy';
    return 'Wait';
  }

  private formatTurnCard(summary: TurnSummary): string {
    const actor = summary.performer === 'player' ? 'YOU' : summary.performer === 'enemy' ? 'FOE' : 'WAIT';
    const play = summary.player.stunned ? 'stunned' : summary.player.cardId ? this.skillName(summary.player.cardId) : summary.enemyCardId ? `foe ${this.skillName(summary.enemyCardId)}` : 'no play';
    const tempo = `bank +${summary.player.banked} / use ${summary.player.used}`;
    const note = summary.notes[summary.notes.length - 1] ?? this.playerTempoLabel(summary);
    return `T${summary.turn}  ${actor}  ${play}\n${tempo} · ${note}`;
  }

  private playerTempoLabel(summary: TurnSummary): string {
    if (summary.player.stunned) return `stunned after ${summary.player.bank}+${summary.player.speed}`;
    if (summary.player.state === 'busy') return `busy (${summary.player.bank}+${summary.player.speed})`;
    if (summary.player.state === 'nothingUsable') return `no card (${summary.player.bank}+${summary.player.speed})`;
    if (summary.player.weight === null || summary.player.score === null) return 'waiting';
    return `${summary.player.bank}+${summary.player.speed}-${summary.player.weight}=${summary.player.score}`;
  }

  private cardLabel(cardId: string | null): string {
    return cardId ? this.skillName(cardId) : 'none';
  }

  private skillName(skillId: string): string {
    return skillBook[skillId]?.name ?? skillId;
  }

  private unitKey(side: Side, unit: number): string {
    return `${side}:${unit}`;
  }

  private unitLabel(side: Side, unit: number): string {
    const name = this.unitNames[side][unit];
    if (name) return name;
    return side === 'player' ? `Hero ${unit + 1}` : `Enemy ${unit + 1}`;
  }

  private shortUnitLabel(side: Side, unit: number): string {
    const base = side === 'player' ? 'H' : 'E';
    return unit === 0 ? base : `${base}${unit + 1}`;
  }

  private opposingSide(side: Side): Side {
    return side === 'player' ? 'enemy' : 'player';
  }

  private formatTarget(event: Extract<CombatEvent, { kind: 'skillCast' | 'play' }>): string {
    if (event.aoe) {
      const targets = event.targets?.map((unit) => this.shortUnitLabel(this.opposingSide(event.side), unit)).join(',');
      return targets ? ` -> AoE ${targets}` : ' -> AoE';
    }
    if (event.targetUnit === undefined) return '';

    const target = this.unitLabel(this.opposingSide(event.side), event.targetUnit);
    if (!event.targetPolicy || event.targetPolicy === 'first' || event.targetPolicy === 'focus') {
      return ` -> ${target}`;
    }
    const metric = event.targetValue === undefined ? event.targetPolicy : `${event.targetPolicy} ${event.targetValue}`;
    return ` -> ${target} (${metric})`;
  }

  private fmtSide(side: ComparisonSide, label: string): string {
    if (side.state === 'busy') return `${label}: busy`;
    if (side.state === 'nothingUsable') return `${label}: no card`;
    const name = side.queuedSkillId ? this.skillName(side.queuedSkillId) : '?';
    return `${label}: ${side.bank}+${side.speed}-${side.weight} = ${side.score} (${name})`;
  }

  private applyEvent(event: CombatEvent, instant: boolean, visualDelay = 0): void {
    const summary = this.ensureTurnSummary(event.turn);
    const view = 'side' in event ? this.viewFor(event.side, event.unit) : null;
    this.currentTurn = event.turn;

    switch (event.kind) {
      case 'gain':
        if (!view) break;
        view.readiness = event.readinessAfter;
        view.scoreText.setText(
          `R ${event.readinessAfter} · +${event.speed}${event.speedModifier === 0 ? '' : ` (${event.speedModifier > 0 ? '+' : ''}${event.speedModifier} effect)`}`,
        );
        if (event.side === 'enemy') this.updateEnemyRoster(event.unit);
        break;
      case 'play': {
        if (!view) break;
        this.inspectSkill(event.skillId);
        this.addTurnNote(event.turn, `${this.unitLabel(event.side, event.unit)} played ${this.skillName(event.skillId)}`);
        const card = view.cards.get(event.slot);
        if (card && !instant) {
          card.setHighlight(true, event.side === 'player' ? UI.good : UI.bad);
          this.tweens.add({
            targets: card.root,
            scale: 1.05,
            duration: this.scaledMs(120),
            yoyo: true,
            ease: 'Cubic.Out',
            onComplete: () => card.setHighlight(false),
          });
        }
        break;
      }
      case 'cost':
        if (view) {
          view.readiness = event.readinessAfter;
          view.scoreText.setText(`R ${event.readinessAfter} · paid ${event.paid}`);
          if (event.side === 'enemy') this.updateEnemyRoster(event.unit);
        }
        break;
      case 'cursor':
        break;
      case 'busy':
        view?.scoreText.setText(`busy ${event.slotIndex}/${event.slotCount}`);
        break;
      case 'wait':
        if (view && event.reason === 'cantAfford') view.readiness = event.readiness;
        view?.scoreText.setText(
          event.reason === 'cantAfford'
            ? `R ${event.readiness} < W ${event.weight}`
            : event.reason === 'cooling'
              ? `cooldown ${event.turnsLeft}t`
              : event.reason,
        );
        if (event.side === 'enemy') this.updateEnemyRoster(event.unit);
        break;
      case 'end':
        break;
      case 'comparison': {
        const who = event.performer === 'player' ? 'Hero acts next.' : event.performer === 'enemy' ? 'Enemy acts next.' : 'Nobody can act.';
        summary.performer = event.performer;
        summary.player.bank = event.player.bank;
        summary.player.speed = event.player.speed;
        summary.player.weight = event.player.weight;
        summary.player.score = event.player.score;
        summary.player.state = event.player.state;
        summary.player.banked = event.performer === 'player' || event.player.state === 'nothingUsable' ? 0 : event.player.speed;
        summary.player.used = 0;
        summary.player.cardId = null;
        summary.player.stunned = false;
        summary.enemyCardId = null;

        this.turnText.setText(`TURN ${event.turn}`);
        this.comparisonText.setText([this.fmtSide(event.player, 'YOU'), this.fmtSide(event.enemy, 'FOE'), who].join('\n'));
        for (const entry of event.entries) {
          this.viewFor(entry.side, entry.unit)?.scoreText.setText(entry.state === 'ready' ? `score ${entry.score}` : entry.state);
        }
        if (event.performer === null) this.addTurnNote(event.turn, 'Nobody could act.');
        break;
      }
      case 'performStart':
        this.performsSeen[event.side] = event.performs;
        break;
      case 'skillCast': {
        // Compatibility event; tagged `play` owns the visible playback line.
        break;
      }
      case 'damage': {
        if (!view) break;
        view.hp = event.hpAfter;
        if (event.blocked > 0) view.shield = Math.max(0, view.shield - event.blocked);
        const dealt = event.amount - event.blocked;
        const match = event.matchup === 'advantage' ? ' ▲' : event.matchup === 'disadvantage' ? ' ▼' : '';
        this.addTurnNote(event.turn, `${this.unitLabel(event.side, event.unit)} -${dealt}${event.blocked ? ` (${event.blocked} blocked)` : ''}${event.crit ? ' crit' : ''}${match}`);
        if (instant) {
          view.displayHp = event.hpAfter;
          view.scheduledHp = event.hpAfter;
          this.refreshBars(event.side, event.unit);
        } else {
          this.animateHpTo(view, event.side, event.unit, event.hpAfter, visualDelay);
          this.scheduleVisual(visualDelay, () => {
            this.floatText(view, `-${dealt}${event.crit ? '!' : ''}${match}`, PROPERTY_COLOR[event.property]);
            if (dealt > 0) this.shakeDamagePanel(view, event.side, event.unit, dealt, event.crit);
          });
        }
        break;
      }
      case 'heal': {
        if (!view) break;
        view.hp = event.hpAfter;
        this.addTurnNote(event.turn, `${this.unitLabel(event.side, event.unit)} +${event.amount} hp`);
        if (instant) {
          view.displayHp = event.hpAfter;
          view.scheduledHp = event.hpAfter;
          this.refreshBars(event.side, event.unit);
        } else {
          this.animateHpTo(view, event.side, event.unit, event.hpAfter, visualDelay);
          this.scheduleVisual(visualDelay, () => this.floatText(view, `+${event.amount}`, UI.good));
        }
        break;
      }
      case 'shieldGain': {
        if (!view) break;
        view.shield = event.totalAfter;
        this.refreshBars(event.side, event.unit);
        this.addTurnNote(event.turn, `${this.unitLabel(event.side, event.unit)} +${event.amount} shield`);
        if (!instant) this.floatText(view, `+${event.amount}🛡`, UI.shield);
        break;
      }
      case 'statusApplied': {
        if (!view) break;
        if (event.status === 'negate') {
          const negateCharges = event.charges ?? 1;
          const existing = view.statuses.find((status) => status.status === 'negate' && status.property === event.property);
          if (existing) existing.charges = negateCharges;
          else view.statuses.push({ status: 'negate', turns: 0, property: event.property, charges: negateCharges });
        } else {
          view.statuses.push({ status: event.status, turns: event.turns, property: event.property });
        }
        this.refreshStatuses(event.side, event.unit);
        this.addTurnNote(event.turn, `${this.unitLabel(event.side, event.unit)} gains ${event.status}`);
        break;
      }
      case 'statusExpired': {
        if (!view) break;
        const idx = view.statuses.findIndex((status) => status.status === event.status);
        if (idx >= 0) view.statuses.splice(idx, 1);
        this.refreshStatuses(event.side, event.unit);
        this.addTurnNote(event.turn, `${this.unitLabel(event.side, event.unit)} ${event.status} ended`);
        break;
      }
      case 'negated': {
        if (!view) break;
        const entry = view.statuses.find((status) => status.status === 'negate' && status.property === event.property);
        if (entry) {
          entry.charges = Math.max(0, (entry.charges ?? 1) - 1);
          if (entry.charges <= 0) {
            const idx = view.statuses.indexOf(entry);
            if (idx >= 0) view.statuses.splice(idx, 1);
          }
        }
        this.refreshStatuses(event.side, event.unit);
        this.addTurnNote(event.turn, `${this.unitLabel(event.side, event.unit)} negated ${event.property}`);
        if (!instant) this.floatText(view, 'NEGATED', UI.shield);
        break;
      }
      case 'cleansed':
        if (!view) break;
        view.statuses = view.statuses.filter((status) => status.status === 'buff');
        this.refreshStatuses(event.side, event.unit);
        this.addTurnNote(event.turn, `${this.unitLabel(event.side, event.unit)} cleansed ${event.removed}`);
        break;
      case 'performSkipped':
        if (event.side === 'player') {
          summary.player.stunned = true;
          summary.player.used = 0;
          summary.player.cardId = null;
        }
        this.addTurnNote(event.turn, `${this.unitLabel(event.side, event.unit)} was stunned`);
        break;
      case 'slowed':
        this.addTurnNote(event.turn, `${this.unitLabel(event.side, event.unit)} next action +${event.weight} weight`);
        break;
      case 'disrupted':
        if (view) view.readiness = event.readinessAfter;
        if (event.side === 'enemy') this.updateEnemyRoster(event.unit);
        this.addTurnNote(event.turn, `${this.unitLabel(event.side, event.unit)} readiness -${event.amount} => ${event.readinessAfter}`);
        break;
      case 'shieldBroken': {
        if (!view) break;
        view.shield = event.totalAfter;
        this.refreshBars(event.side, event.unit);
        this.addTurnNote(event.turn, `${this.unitLabel(event.side, event.unit)} shield broke (-${event.amount})`);
        if (!instant) this.floatText(view, `🛡-${event.amount}`, UI.bad);
        break;
      }
      case 'noPerformer':
        this.addTurnNote(event.turn, 'Both sides passed.');
        break;
      case 'suddenDeathStart':
        this.addTurnNote(event.turn, 'Sudden death started.');
        if (!instant) this.banner('SUDDEN DEATH', '#8b4a18');
        break;
      case 'fatigueStart':
        this.addTurnNote(event.turn, 'Fatigue started.');
        break;
      case 'died':
        this.addTurnNote(event.turn, `${this.unitLabel(event.side, event.unit)} died.`);
        break;
      case 'combatEnd': {
        this.finished = true;
        const msg = event.result === 'win' ? 'VICTORY' : event.result === 'loss' ? 'DEFEAT' : 'DRAW';
        this.addTurnNote(event.turn, `${msg} in ${event.turns} turns.`);
        this.pendingCombatEnd = { result: event.result, turns: event.turns };
        this.flushCombatEnd(instant);
        break;
      }
      default:
        break;
    }

    if (event.kind === 'end') {
      for (const side of ['player', 'enemy'] as Side[]) {
        for (let unit = 0; unit < this.views[side].length; unit++) {
          const unitView = this.views[side][unit]!;
          for (const status of unitView.statuses) {
            if (status.status !== 'stun' && status.status !== 'negate') status.turns = Math.max(0, status.turns - 1);
          }
          this.refreshStatuses(side, unit);
        }
      }
    }

    this.refreshFeed();
  }

  private viewFor(side: Side, unit: number): SideView | undefined {
    return this.views[side][unit];
  }

  private refreshBars(side: Side, unit: number): void {
    const view = this.viewFor(side, unit);
    if (!view) return;
    view.hpBar.width = Math.max(0, (view.displayHp / view.maxHp) * view.barWidth);
    view.shieldBar.width = Math.max(0, Math.min(1, view.shield / view.maxHp) * view.barWidth);
    view.hpText.setText(`HP ${Math.round(view.displayHp)}/${view.maxHp}${view.shield > 0 ? ` +${view.shield}🛡` : ''}`);
    if (side === 'enemy') this.updateEnemyRoster(unit);
  }

  private animateHpTo(view: SideView, side: Side, unit: number, hpAfter: number, delay: number): void {
    const hpBefore = view.scheduledHp;
    view.scheduledHp = hpAfter;
    this.scheduleVisual(delay, () => {
      const counter = { hp: hpBefore };
      const animation = { view, counter };
      this.hpTweenCounters.push(animation);
      this.tweens.add({
        targets: counter,
        hp: hpAfter,
        duration: this.scaledMs(260),
        ease: 'Cubic.Out',
        onUpdate: () => {
          view.displayHp = counter.hp;
          this.refreshBars(side, unit);
        },
      onComplete: () => {
        view.displayHp = hpAfter;
        this.refreshBars(side, unit);
        const index = this.hpTweenCounters.indexOf(animation);
        if (index >= 0) this.hpTweenCounters.splice(index, 1);
        this.flushCombatEnd();
      },
      });
    });
  }

  private flushCombatEnd(force = false): void {
    if (!this.pendingCombatEnd) return;
    if (!force && (this.pendingVisualTimers.length > 0 || this.hpTweenCounters.length > 0)) return;
    const pending = this.pendingCombatEnd;
    this.pendingCombatEnd = null;
    this.showResultBadge(pending.result, pending.turns);
    this.maybeAutoOpenReport();
  }

  private refreshStatuses(side: Side, unit: number): void {
    const view = this.viewFor(side, unit);
    if (!view) return;
    view.statusText.setText(
      view.statuses
        .map((status) => {
          const icon = STATUS_ICON[status.status] ?? status.status;
          if (status.status === 'negate') return `${icon}x${status.charges ?? 0}`;
          return `${icon}${status.turns > 0 ? status.turns : ''}`;
        })
        .join(' '),
    );
  }

  private floatText(view: SideView, text: string, color: number): void {
    const floating = this.add
      .text(view.floatX + (Math.random() * 64 - 32), view.floatY + 8, text, {
        fontSize: '20px',
        color: `#${color.toString(16).padStart(6, '0')}`,
        fontFamily: FONT.body,
        fontStyle: 'bold',
      })
      .setOrigin(0.5)
      .setDepth(18);
    this.tweens.add({
      targets: floating,
      y: view.floatY - 34,
      alpha: 0,
      duration: this.scaledMs(900),
      ease: 'Cubic.Out',
      onComplete: () => floating.destroy(),
    });
  }

  private shakeDamagePanel(view: SideView, side: Side, unit: number, damage: number, crit: boolean): void {
    if (view.isShaking) return;

    const targets = view.objects.filter((object) => object.visible);
    const rosterChip = side === 'enemy' ? this.enemyRosterChips[unit] : this.partyRosterChips[unit];
    if (rosterChip) targets.push(rosterChip.rect as ViewObject, rosterChip.accent as ViewObject, rosterChip.label as ViewObject, rosterChip.speedLabel as ViewObject, rosterChip.sublabel as ViewObject);
    if (targets.length === 0) return;

    view.isShaking = true;
    const origins = targets.map((target) => ({ target, x: target.x, y: target.y }));
    const hpRatio = damage / Math.max(1, view.maxHp);
    const distance = Phaser.Math.Clamp(Math.round(3 + hpRatio * 16 + (crit ? 2 : 0)), 3, 8);

    for (const target of targets) target.x -= distance / 2;
    this.tweens.add({
      targets,
      x: `+=${distance}`,
      duration: this.scaledMs(crit ? 42 : 48),
      ease: 'Sine.InOut',
      yoyo: true,
      repeat: crit ? 3 : 2,
      onComplete: () => {
        for (const origin of origins) {
          origin.target.setPosition(origin.x, origin.y);
        }
        view.isShaking = false;
      },
    });
  }

  private banner(text: string, color: string): void {
    const banner = this.add
      .text(SCREEN.width / 2, 82, text, {
        fontSize: '14px',
        color,
        fontFamily: FONT.body,
        fontStyle: 'bold',
        backgroundColor: '#fff8ea',
        padding: { x: 10, y: 5 },
      })
      .setOrigin(0.5)
      .setDepth(20);
    if (!this.finished) {
      this.tweens.add({
        targets: banner,
        alpha: 0,
        delay: this.scaledMs(1800),
        duration: this.scaledMs(500),
        onComplete: () => banner.destroy(),
      });
    }
  }

  private showResultBadge(result: 'win' | 'loss' | 'draw', turns: number): void {
    const win = result === 'win';
    const label = win ? 'VICTORY' : result === 'loss' ? 'DEFEAT' : 'DRAW';
    // The fight report opens by clicking the RESULT row in the log (see the log
    // row handler); the corner badge is just a plain result indicator.
    this.add
      .text(SCREEN.width - SCREEN.safeX, SCREEN.safeTop + 5, `${label} · ${turns}T`, {
        fontSize: '12px',
        color: win ? '#356c43' : result === 'loss' ? '#9b4739' : UI.textDim,
        fontFamily: FONT.body,
        fontStyle: 'bold',
        backgroundColor: win ? '#dfead6' : result === 'loss' ? '#f2d3c7' : '#e8ddca',
        padding: { x: 10, y: 5 },
      })
      .setOrigin(1, 0)
      .setDepth(20);
  }

  /** Post-fight per-card contribution report (real totals from the event log). */
  /** Pop the fight report once, when the battle finishes (auto, like clicking RESULT). */
  private maybeAutoOpenReport(): void {
    if (this.reportAutoShown) return;
    this.reportAutoShown = true;
    // Let the final row/badge settle for a beat before the modal covers them.
    this.time.delayedCall(this.scaledMs(450), () => this.openReportModal());
  }

  private openReportModal(): void {
    this.closeModal();
    const contribs = cardContributions(this.result.events);
    const fmt = (c: (typeof contribs)[number]): string => {
      const parts: string[] = [];
      if (c.damage) parts.push(`DMG ${c.damage}`);
      if (c.dotDamage) parts.push(`DoT ${c.dotDamage}`);
      if (c.healing) parts.push(`HEAL ${c.healing}`);
      if (c.shield) parts.push(`DEF ${c.shield}`);
      return `${this.skillName(c.skillId)}  ·  ${parts.join('  ·  ') || '—'}`;
    };
    const players = contribs.filter((c) => c.side === 'player').map(fmt);
    const enemies = contribs.filter((c) => c.side === 'enemy').map(fmt);
    const body = [
      'YOUR CARDS',
      ...(players.length ? players : ['  —']),
      '',
      'ENEMY CARDS',
      ...(enemies.length ? enemies : ['  —']),
    ].join('\n');

    const overlay = this.add.rectangle(0, 0, SCREEN.width, SCREEN.height, UI.border, 0.42).setOrigin(0, 0).setDepth(50).setInteractive();
    const panelX = SCREEN.safeX + 24;
    const panelY = 250;
    const panelW = VIEW_W - 48;
    const panelH = 560;
    const bg = this.add.rectangle(panelX, panelY, panelW, panelH, UI.battleFrame).setOrigin(0, 0).setStrokeStyle(2, UI.battleOutline).setDepth(51);
    const accent = this.add.rectangle(panelX, panelY, panelW, 12, UI.chip).setOrigin(0, 0).setDepth(52);
    const title = this.add.text(panelX + 22, panelY + 30, 'FIGHT REPORT', {
      fontSize: '20px', color: UI.text, fontFamily: FONT.display, fontStyle: 'bold',
    }).setDepth(52);
    const sub = this.add.text(panelX + 22, panelY + 60, 'Total damage / DoT / healing / defense each card produced.', {
      fontSize: '11px', color: UI.textDim, fontFamily: FONT.body,
    }).setDepth(52);
    const block = this.add.text(panelX + 22, panelY + 92, body, {
      fontSize: '13px', color: UI.text, fontFamily: FONT.body, lineSpacing: 7, wordWrap: { width: panelW - 44 },
    }).setDepth(52);
    const close = this.makeButton(panelX + panelW - 114, panelY + panelH - 54, 88, 34, 'CLOSE', UI.chip, '#1a1208', () => this.closeModal());
    close.rect.setDepth(52);
    close.text.setDepth(53);
    overlay.on('pointerdown', () => this.closeModal());
    this.modalObjects.push(overlay, bg, accent, title, sub, block, close.rect, close.text);
  }

}
