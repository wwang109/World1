import Phaser from 'phaser';
import { actionsPriceDeci, BUDGET_TOLERANCE_DECI, effectCapDeci, gemPowerLevel, instancePowerLevelDeci, MAX_STUN_PER_CARD, powerLevel, powerLevelBreakdown, powerLevelDeci, PRICE, sizeGrantDeci, TIER_BUDGET_DECI } from '../../engine/balance';
import { ELEMENT_BEATS, WEAPON_BEATS } from '../../engine/elements';
import { weightOf, type Action, type CombatantSetup, type Element, type EnemyDef, type Property, type SkillDef, type SkillTier, type WeaponType } from '../../engine/types';
import type { DamageBand } from '../../run/analysis';
import { fetchDamageBand } from '../battleApi';
import { enemies } from '../../data/enemies';
import { gemBook, type GemDef } from '../../data/gems';
import { BASE_HERO_STATS, HERO_BOARD_SLOTS } from '../../data/heroes';
import { skillBook } from '../../data/skills';
import { buildAutoHeroSetup, buildEnemyEncounter, defaultTitleFor, ENEMY_TITLES, maxRankFor, TITLE_PRESETS, type EncounterUnit, type EnemyTitle } from '../../run/encounter';
import { canPlace, clampSlot, hasGem, moveWithinStrip, shiftInsert, socketGem, swapGem, unsocketGem, type ShiftPlan, type StripItem } from '../../run/loadout';
import { createOwnedCard, demoState, type EnemyFightConfig, type GemInventorySlot, type InventorySlot, type OwnedBoardPiece, type OwnedCard, type PrepView } from '../demoState';
import { ARCHETYPE_COLOR, DECK_BUILD_LAYOUT, DISPLAY_THEME, ELEMENT_COLOR, ELEMENT_ICON, FOOTER_ACTION_LAYOUT, FONT, GEM_RARITY_COLOR, PREP_FIGHT_LAYOUT, PROPERTY_COLOR, PROPERTY_LABEL, SCREEN, TIER_COLOR, TYPE_SCALE, UI, WEAPON_COLOR, WEAPON_ICON } from '../theme';
import { applyTier } from '../../engine/cards';
import { auraAffectedTargetSlots } from '../../engine/combat/auras';
import { boardTypeIdentity, cardType, IDENTITY_THRESHOLD, type BoardIdentity } from '../../engine/combat/typeIdentity';
import { CardView, CARD_H, SLOT_W } from '../ui/CardView';
import { drawBackdrop, drawCompactTextBlock, drawPanelShell, drawStepperControl, panelHeaderCenterY, panelToolbarRowY } from '../ui/displayLibrary';
import { presentCardActions } from '../ui/cardActionPresentation';
import { stripCardTextMarkup } from '../ui/cardTextMarkup';
import { describeAura } from '../ui/skillPresentation';
import { FantasyCardTemplateV2 } from '../ui/FantasyCardTemplateV2';
import { SkillDetailPanel } from '../ui/SkillDetailPanel';
import { auditControlLabel } from '../ui/controlLayoutAudit';

const HEADER = { x: SCREEN.safeX, y: SCREEN.safeTop, w: SCREEN.width - SCREEN.safeX * 2, h: 74 };
const TAB_BAR_Y = 122;
const VIEW_TOP = 186;
const VIEW_W = SCREEN.width - SCREEN.safeX * 2;
const DETAIL = { x: SCREEN.safeX, y: 992, w: VIEW_W, h: 200 };
const PREP_FIGHT = { x: SCREEN.safeX, y: VIEW_TOP, w: VIEW_W, h: 790 };

const DECK_BUILD_BOARD = { x: SCREEN.safeX, y: VIEW_TOP, w: VIEW_W, h: DECK_BUILD_LAYOUT.panel.boardHeight };
const DECK_TRANSFER = { x: SCREEN.safeX, y: DECK_BUILD_LAYOUT.panel.transferY, w: VIEW_W, h: DECK_BUILD_LAYOUT.panel.transferHeight };
const DECK_BUILD_BAG = { x: SCREEN.safeX, y: DECK_BUILD_LAYOUT.panel.bagY, w: VIEW_W, h: DECK_BUILD_LAYOUT.panel.bagHeight };

const WIKI_LIBRARY = { x: SCREEN.safeX, y: VIEW_TOP, w: VIEW_W, h: 1004 };
const OPPONENT_LIBRARY = { x: SCREEN.safeX, y: VIEW_TOP, w: VIEW_W, h: 790 };

const ACTION_BUTTONS = {
  seed: { x: SCREEN.safeX, y: FOOTER_ACTION_LAYOUT.y, w: FOOTER_ACTION_LAYOUT.firstWidth, h: FOOTER_ACTION_LAYOUT.height },
  clear: { x: SCREEN.safeX + FOOTER_ACTION_LAYOUT.secondX, y: FOOTER_ACTION_LAYOUT.y, w: FOOTER_ACTION_LAYOUT.secondWidth, h: FOOTER_ACTION_LAYOUT.height },
  // FIGHT fills the remaining row width so it ends on the same safe-area
  // right edge as every panel above it.
  fight: { x: SCREEN.safeX + FOOTER_ACTION_LAYOUT.thirdX, y: FOOTER_ACTION_LAYOUT.y, w: VIEW_W - FOOTER_ACTION_LAYOUT.thirdX, h: FOOTER_ACTION_LAYOUT.height },
};

const BOARD_LEFT = SCREEN.safeX + (VIEW_W - HERO_BOARD_SLOTS * SLOT_W) / 2;
const BOARD_DROP_BAND = 150;
const DECK_BUILD_BOARD_Y = DECK_BUILD_BOARD.y + DECK_BUILD_LAYOUT.rail.boardOffsetY;
const DECK_BUILD_BAG_RAIL_Y = DECK_BUILD_BAG.y + DECK_BUILD_LAYOUT.rail.bagOffsetY;
/** Split inspect area in the card bag's unused lower half: card left, gem right. */
const BAG_INSPECT = { x: DECK_BUILD_BAG.x + 18, y: DECK_BUILD_BAG.y + 262, w: DECK_BUILD_BAG.w - 36, h: DECK_BUILD_BAG.h - 262 - 18 };
const OPPONENT_PAGE_SIZE = 8;
const WIKI_TIERS: SkillTier[] = ['bronze', 'silver', 'gold', 'diamond'];

const GRID = { cols: 5, cellW: 124, cellH: 82, cellInnerW: 108, cellInnerH: 76 };
const MAX_LEVEL = 50;
const TITLE_LABEL: Record<EnemyTitle, string> = { mob: 'MOB', normal: 'NORMAL', elite: 'ELITE', boss: 'BOSS' };

type WikiRoleFilter = 'all' | 'attack' | 'defense' | 'heal' | 'buff' | 'debuff' | 'support';
type WikiPropertyFilter = 'all' | Property;
type WikiWeaponFilter = 'all' | WeaponType;
type WikiElementFilter = 'all' | Element;
type WikiWeightFilter = 'all' | 'light' | 'medium' | 'heavy';
type WikiSizeFilter = 'all' | 'one' | 'two' | 'threePlus';
type WikiSort = 'name' | 'weight' | 'pl';

interface WikiFilters {
  role: WikiRoleFilter;
  property: WikiPropertyFilter;
  weapon: WikiWeaponFilter;
  element: WikiElementFilter;
  weight: WikiWeightFilter;
  size: WikiSizeFilter;
  sort: WikiSort;
}

const DEFAULT_WIKI_FILTERS: WikiFilters = {
  role: 'all',
  property: 'all',
  weapon: 'all',
  element: 'all',
  weight: 'all',
  size: 'all',
  sort: 'name',
};

type InspectTarget =
  | { kind: 'skill'; skillId: string; hostInstanceId?: string; tier?: SkillTier; contextLabel?: string }
  | { kind: 'gem'; gemId: string; hostInstanceId?: string };
type DragSource =
  | { kind: 'board'; piece: OwnedBoardPiece; skillId: string; tier: SkillTier }
  | { kind: 'bag'; index: number; card: OwnedCard; skillId: string; tier: SkillTier }
  | { kind: 'transfer'; card: OwnedCard; piece?: OwnedBoardPiece; skillId: string; tier: SkillTier };

type TransferOrigin =
  | { kind: 'bag'; index: number; card: OwnedCard }
  | { kind: 'board'; piece: OwnedBoardPiece };

interface TransferSlotState {
  origin: TransferOrigin;
  card: OwnedCard;
  piece?: OwnedBoardPiece;
}

interface SlotZone {
  index: number;
  rect: Phaser.GameObjects.Rectangle;
  baseFill: number;
}

interface TransferZone {
  rect: Phaser.GameObjects.Rectangle;
  baseFill: number;
}

interface TabButton {
  view: PrepView;
  rect: Phaser.GameObjects.Rectangle;
  text: Phaser.GameObjects.Text;
}

interface ButtonPair {
  rect: Phaser.GameObjects.Rectangle;
  text: Phaser.GameObjects.Text;
}

function formatWeaknessLine(enemyId = demoState.enemyId): string {
  const enemy = enemies[enemyId]!;
  const parts: string[] = [];

  if (enemy.elementAffinity) {
    const weakTo = Object.entries(ELEMENT_BEATS).find(([, value]) => value === enemy.elementAffinity)?.[0];
    parts.push(`${ELEMENT_ICON[enemy.elementAffinity]} weak to ${weakTo ?? enemy.elementAffinity}`);
  }

  if (enemy.weaponAffinity) {
    const weakTo = Object.entries(WEAPON_BEATS).find(([, value]) => value === enemy.weaponAffinity)?.[0];
    parts.push(`${WEAPON_ICON[enemy.weaponAffinity]} weak to ${weakTo ?? enemy.weaponAffinity}`);
  }

  return parts.join('  ·  ');
}

function opponentIdentity(title: EnemyTitle): { label: string; color: number } {
  switch (title) {
    case 'mob': return { label: 'MOB', color: 0x777064 };
    case 'normal': return { label: 'NORMAL', color: UI.chip };
    case 'elite': return { label: 'ELITE', color: UI.waiting };
    case 'boss': return { label: 'BOSS', color: UI.bad };
  }
}

function opponentAffinities(enemy: EnemyDef): string {
  return [
    enemy.elementAffinity ? `${ELEMENT_ICON[enemy.elementAffinity]} ${enemy.elementAffinity}` : '',
    enemy.weaponAffinity ? `${WEAPON_ICON[enemy.weaponAffinity]} ${enemy.weaponAffinity}` : '',
  ].filter(Boolean).join('  ·  ') || 'neutral';
}

function sortSkillsForWiki(): SkillDef[] {
  return Object.values(skillBook).sort((a, b) =>
    a.tier === b.tier
      ? a.property === b.property
        ? a.name.localeCompare(b.name)
        : a.property.localeCompare(b.property)
      : a.tier.localeCompare(b.tier),
  );
}

function formatPowerDeci(value: number): string {
  const power = value / 10;
  return Number.isInteger(power) ? String(power) : power.toFixed(1);
}

export class PrepScene extends Phaser.Scene {
  private detailPanel!: SkillDetailPanel;
  private headerMetaText!: Phaser.GameObjects.Text;
  private viewObjects: Phaser.GameObjects.GameObject[] = [];
  private boardSlotRects: Phaser.GameObjects.Rectangle[] = [];
  private slotZones: SlotZone[] = [];
  private transferZone: TransferZone | null = null;
  private trashZone: TransferZone | null = null;
  private bagInspectObjects: Phaser.GameObjects.GameObject[] = [];
  private transferSlot: TransferSlotState | null = null;
  private dragGhost: CardView | null = null;
  private dragSource: DragSource | null = null;
  private tabButtons: TabButton[] = [];
  private selectedInspect: InspectTarget | null = null;
  private wikiPage = 0;
  private balanceView: 'rules' | 'table' = 'rules';
  /** Which rule group the RULES subtab shows — one group per page so nothing overflows the panel. */
  private balanceRulesGroup: 'buffs' | 'debuffs' | 'stats' | 'budget' = 'buffs';
  private opponentPage = 0;
  private opponentPreviewLevel = 1;
  private opponentPreviewTitle: EnemyTitle = 'normal';
  private opponentPreviewTier: SkillTier = 'bronze';
  private wikiTier: SkillTier = 'bronze';
  private wikiFilters: WikiFilters = { ...DEFAULT_WIKI_FILTERS };
  private wikiFilterDraft: WikiFilters | null = null;
  private modalObjects: Phaser.GameObjects.GameObject[] = [];
  private activeEnemySlot = 0;
  /** Memoized damage-per-turn bands, fetched from the battle service (combat is not in this bundle). */
  private dptCache = new Map<string, DamageBand>();
  /** Signatures with an in-flight fetch — avoids firing duplicate requests for the same key. */
  private dptPending = new Set<string>();
  /** Signatures whose fetch failed — shown as a dim "n/a" instead of retrying every render. */
  private dptFailed = new Set<string>();
  /** Transient border overlays showing an aura card's reach; cleared on hover-out. */
  private auraHighlightObjects: Phaser.GameObjects.GameObject[] = [];

  constructor() {
    super('Prep');
  }

  /**
   * Cached damage-per-turn band for a setup, keyed by a stable signature.
   * Combat sims are served (this bundle may not import `simulate()`), so a
   * cache miss kicks off an async fetch and returns `null` for this render;
   * the resolved band is cached and the active view is redrawn once so the
   * real number appears in place of the placeholder. Duplicate in-flight
   * requests for the same key are suppressed via `dptPending`.
   */
  private dptBand(key: string, setup: CombatantSetup): DamageBand | null {
    const cached = this.dptCache.get(key);
    if (cached) return cached;
    if (this.dptFailed.has(key)) return null;
    if (!this.dptPending.has(key)) {
      this.dptPending.add(key);
      fetchDamageBand(setup).then((band) => {
        this.dptPending.delete(key);
        this.dptCache.set(key, band);
        if (!this.scene.isActive()) return;
        this.renderActiveView();
        this.restoreSelection();
      }).catch(() => {
        this.dptPending.delete(key);
        this.dptFailed.add(key);
        if (!this.scene.isActive()) return;
        this.renderActiveView();
        this.restoreSelection();
      });
    }
    return null;
  }

  /** Compact "min–max" (a single number when the band has no spread), "…" while pending, "n/a" on failure. */
  private static formatBand(band: DamageBand | null, failed = false): string {
    if (!band) return failed ? 'n/a' : '…';
    return band.min === band.max ? `${band.avg}` : `${band.min}–${band.max}`;
  }

  // Phaser reuses the scene instance across scene.start() round trips; field
  // initializers only run at construction, so every list that holds display
  // objects must be reset here or create() touches destroyed objects.
  init(): void {
    this.viewObjects = [];
    this.boardSlotRects = [];
    this.slotZones = [];
    this.transferZone = null;
    this.trashZone = null;
    this.bagInspectObjects = [];
    this.transferSlot = null;
    this.tabButtons = [];
    this.modalObjects = [];
    this.dragGhost = null;
    this.dragSource = null;
    this.wikiFilterDraft = null;
    this.wikiTier = demoState.wikiTier;
    this.dptCache = new Map();
    this.dptPending = new Set();
    this.dptFailed = new Set();
    this.activeEnemySlot = 0;
    this.auraHighlightObjects = [];
  }

  /**
   * Draw the reach of an aura card at `boardY`: a solid outline on the source
   * and a border around each card it affects (same coverage rule as combat).
   * Transient — cleared by {@link clearAuraReach} on hover-out / re-render.
   */
  private showAuraReach(source: OwnedBoardPiece, boardY: number): void {
    this.clearAuraReach();
    const sourceSkill = skillBook[source.skillId];
    if (!sourceSkill?.aura) return;

    const outline = (slot: number, sizeSlots: number, color: number, width: number): void => {
      const w = sizeSlots * SLOT_W - 8;
      const cx = BOARD_LEFT + slot * SLOT_W + (sizeSlots * SLOT_W) / 2;
      const rect = this.add.rectangle(cx, boardY, w + 6, CARD_H + 6, color, 0).setStrokeStyle(width, color);
      rect.setDepth(30);
      this.auraHighlightObjects.push(rect);
    };

    // Source card (green, thicker) so you can see what's projecting.
    outline(source.slot, sourceSkill.size, UI.good, 3);

    const affected = auraAffectedTargetSlots(
      { slot: source.slot, skillId: source.skillId },
      demoState.pieces.map((p) => ({ slot: p.slot, skillId: p.skillId })),
      skillBook,
    );
    const bySlot = new Map(demoState.pieces.map((p) => [p.slot, p]));
    for (const slot of affected) {
      const piece = bySlot.get(slot);
      const size = piece ? skillBook[piece.skillId]?.size ?? 1 : 1;
      outline(slot, size, UI.chip, 3);
    }
  }

  private clearAuraReach(): void {
    for (const obj of this.auraHighlightObjects) obj.destroy();
    this.auraHighlightObjects = [];
  }

  create(): void {
    this.ensureEnemyTeam();
    this.cameras.main.setBackgroundColor(UI.bg);

    this.drawBackdrop();
    this.drawHeader();
    this.buildTabs();
    this.buildFooter();
    this.detailPanel = new SkillDetailPanel(this, DETAIL.x, DETAIL.y, DETAIL.w, DETAIL.h, {
      title: 'CURRENT DECK',
      fillColor: UI.panelAlt,
      showChrome: true,
      emptyMessage: 'Current deck summary appears here.',
    });

    this.renderActiveView();
    this.restoreSelection();
  }

  private drawBackdrop(): void {
    drawBackdrop(this);
  }

  private drawHeader(): void {
    this.add.text(HEADER.x, HEADER.y, 'WORLD1', {
      fontSize: TYPE_SCALE.display,
      color: UI.text,
      fontFamily: FONT.display,
      fontStyle: 'bold',
    });
    this.add.text(HEADER.x, HEADER.y + 38, 'Portrait combat prep. Build the board, socket gems, then launch the fight.', {
      fontSize: TYPE_SCALE.small,
      color: UI.textDim,
      fontFamily: FONT.body,
    });
    this.headerMetaText = this.add.text(HEADER.x, HEADER.y + 58, '', {
      fontSize: '11px',
      color: UI.text,
      fontFamily: FONT.body,
    });
    this.refreshHeaderMeta();
  }

  private refreshHeaderMeta(): void {
    const enemyNames = demoState.enemyTeam
      .map((config) => enemies[config.enemyId]?.name ?? config.enemyId)
      .join(' + ');
    this.headerMetaText.setText(
      `${enemyNames} · seed ${demoState.seed} · ${demoState.bagSlots.filter(Boolean).length} bag cards · ${demoState.gemInventory.length} loose gems`,
    );
  }

  private buildTabs(): void {
    const defs: Array<{ view: PrepView; label: string }> = [
      { view: 'loadout', label: 'PREP' },
      { view: 'bag', label: 'DECK BUILD' },
      { view: 'codex', label: 'WIKI' },
    ];

    const gap = 10;
    const tabW = (VIEW_W - gap * (defs.length - 1)) / defs.length;
    let x = SCREEN.safeX;
    for (const def of defs) {
      this.add.rectangle(x + 2, TAB_BAR_Y + 3, tabW, 42, UI.shadow, 0.14).setOrigin(0, 0);
      const rect = this.add
        .rectangle(x, TAB_BAR_Y, tabW, 42, UI.panel)
        .setOrigin(0, 0)
        .setStrokeStyle(1.5, UI.border, 0.86)
        .setInteractive({ useHandCursor: true });
      const text = this.add
        .text(x + tabW / 2, TAB_BAR_Y + 22, def.label, {
          fontSize: '13px',
          color: UI.text,
          fontFamily: FONT.body,
          fontStyle: 'bold',
        })
        .setOrigin(0.5);
      auditControlLabel(rect, text, { name: `${def.label} tab`, horizontalPadding: 12, verticalPadding: 6 });
      rect.on('pointerdown', () => {
        if (def.view !== demoState.prepView) this.returnTransferSlot();
        demoState.prepView = def.view;
        this.renderActiveView();
      });
      this.tabButtons.push({ view: def.view, rect, text });
      x += tabW + gap;
    }
    this.refreshTabs();
  }

  private buildFooter(): void {
    this.makeButton(ACTION_BUTTONS.seed.x, ACTION_BUTTONS.seed.y, ACTION_BUTTONS.seed.w, ACTION_BUTTONS.seed.h, 'ROLL SEED', UI.panel, UI.text, () => {
      demoState.seed = Math.floor(Math.random() * 1_000_000);
      this.refreshHeaderMeta();
    });
    this.makeButton(ACTION_BUTTONS.clear.x, ACTION_BUTTONS.clear.y, ACTION_BUTTONS.clear.w, ACTION_BUTTONS.clear.h, 'CLEAR', UI.panelMuted, UI.text, () => {
      this.returnTransferSlot();
      for (const piece of demoState.pieces.slice()) this.unequipToBag(piece, null);
      this.scene.restart();
    });
    this.makeButton(ACTION_BUTTONS.fight.x, ACTION_BUTTONS.fight.y, ACTION_BUTTONS.fight.w, ACTION_BUTTONS.fight.h, 'FIGHT', UI.chip, '#1a1208', () => {
      if (demoState.pieces.length === 0) return;
      this.returnTransferSlot();
      this.saveEnemyEditor();
      this.scene.start('Battle');
    });
  }

  private refreshTabs(): void {
    for (const tab of this.tabButtons) {
      const active = tab.view === demoState.prepView
        || (tab.view === 'codex' && demoState.prepView === 'opponents');
      tab.rect.setFillStyle(active ? UI.chip : UI.panel);
      tab.text.setColor(active ? '#1a1208' : UI.text);
    }
  }

  private clearViewObjects(): void {
    for (const obj of this.viewObjects) obj.destroy();
    this.viewObjects = [];
    for (const obj of this.bagInspectObjects) obj.destroy();
    this.bagInspectObjects = [];
    this.boardSlotRects = [];
    this.slotZones = [];
    this.transferZone = null;
    this.trashZone = null;
    this.clearAuraReach();
    this.clearDrag(false);
    this.closeModal();
  }

  private renderActiveView(): void {
    this.clearViewObjects();
    this.refreshTabs();
    this.refreshHeaderMeta();
    this.detailPanel.setVisible(demoState.prepView !== 'codex' && demoState.prepView !== 'bag' && demoState.prepView !== 'balance');

    switch (demoState.prepView) {
      case 'loadout':
        this.renderLoadoutView();
        break;
      case 'bag':
        this.renderBagView();
        break;
      case 'codex':
        this.renderWikiView();
        break;
      case 'opponents':
        this.renderOpponentsView();
        break;
      case 'balance':
        this.renderWikiBalanceView();
        break;
    }
  }

  private renderLoadoutView(): void {
    this.selectedInspect = null;
    this.viewPanel(PREP_FIGHT, 'CHOOSE FIGHT', UI.panelAlt);
    this.renderEnemyScout(PREP_FIGHT, true);
    const activeDeckRailY = PREP_FIGHT.y + PREP_FIGHT_LAYOUT.activeDeckRailOffsetY;
    const dividerY = activeDeckRailY - PREP_FIGHT_LAYOUT.railLabelGap - PREP_FIGHT_LAYOUT.activeDeckDividerGap;
    const divider = this.viewRect(PREP_FIGHT.x + PREP_FIGHT.w / 2, dividerY, PREP_FIGHT.w - 36, 1, UI.border, 0.46);
    divider.setDepth(1);
    const activeDeckBottom = PREP_FIGHT.y + PREP_FIGHT.h - PREP_FIGHT_LAYOUT.activeDeckPanelBottomInset;
    const activeDeckPanel = this.viewRect(
      PREP_FIGHT.x + PREP_FIGHT.w / 2,
      (dividerY + activeDeckBottom) / 2,
      PREP_FIGHT.w - 36,
      activeDeckBottom - dividerY,
      UI.panelMuted,
      0.28,
    );
    activeDeckPanel.setStrokeStyle(1, UI.border, 0.22);
    this.renderReadOnlyCardRail(
      'ACTIVE DECK',
      demoState.pieces,
      activeDeckRailY,
      UI.playerCard,
      'Active deck card',
    );
    this.renderDeckIdentityLine(PREP_FIGHT, activeDeckRailY + PREP_FIGHT_LAYOUT.activeDeckIdentityOffsetY, true);
  }

  private renderBagView(): void {
    this.renderActiveDeckPanel(DECK_BUILD_BOARD, DECK_BUILD_BOARD_Y, true);

    this.viewPanel(DECK_BUILD_BAG, 'CARD BAG', UI.panel);
    this.viewText(DECK_BUILD_BAG.x + 18, panelToolbarRowY(DECK_BUILD_BAG) - 12, 'Cards not currently in the active deck. Works exactly like the deck rail — big cards fill multiple slots, and dropping between cards shifts them over when there is room.', {
      fontSize: TYPE_SCALE.small,
      color: UI.textDim,
      fontFamily: FONT.body,
      wordWrap: { width: DECK_BUILD_BAG.w - 36 },
    });
    this.renderBagRail(DECK_BUILD_BAG_RAIL_Y, true);
    this.renderBagInspectFrame();
    this.updateBagInspect();

    this.renderTransferSlot();
  }

  /** Static frame of the split inspect area: outline, divider, section headers. */
  private renderBagInspectFrame(): void {
    const frame = this.viewRect(BAG_INSPECT.x + BAG_INSPECT.w / 2, BAG_INSPECT.y + BAG_INSPECT.h / 2, BAG_INSPECT.w, BAG_INSPECT.h, UI.panelMuted, 0.45);
    frame.setStrokeStyle(1.25, UI.border, 0.6);
    const divider = this.viewRect(BAG_INSPECT.x + BAG_INSPECT.w / 2, BAG_INSPECT.y + BAG_INSPECT.h / 2, 1, BAG_INSPECT.h - 16, UI.border);
    divider.setAlpha(0.5);
    this.viewText(BAG_INSPECT.x + 12, BAG_INSPECT.y + 14, 'CARD INSPECT', {
      fontSize: '9px',
      color: UI.textDim,
      fontFamily: FONT.body,
      fontStyle: 'bold',
      letterSpacing: 1,
    }).setOrigin(0, 0.5);
    this.viewText(BAG_INSPECT.x + BAG_INSPECT.w / 2 + 12, BAG_INSPECT.y + 14, 'SOCKETED GEM', {
      fontSize: '9px',
      color: UI.textDim,
      fontFamily: FONT.body,
      fontStyle: 'bold',
      letterSpacing: 1,
    }).setOrigin(0, 0.5);
  }

  /**
   * Dynamic half of the inspect area — redrawn whenever the hovered/dragged/
   * tapped card changes: card details on the left, its socketed gem (if the
   * card is a deck piece with one) on the right.
   */
  private updateBagInspect(): void {
    for (const obj of this.bagInspectObjects) obj.destroy();
    this.bagInspectObjects = [];
    if (demoState.prepView !== 'bag') return;

    const halfW = BAG_INSPECT.w / 2;
    const leftX = BAG_INSPECT.x + 12;
    const rightX = BAG_INSPECT.x + halfW + 12;
    const colW = halfW - 24;
    const topY = BAG_INSPECT.y + 30;
    const text = (x: number, y: number, str: string, style: Phaser.Types.GameObjects.Text.TextStyle): Phaser.GameObjects.Text => {
      const t = this.add.text(x, y, str, style);
      this.bagInspectObjects.push(t);
      return t;
    };

    // Resolve the inspected card (and host piece) from either target kind.
    const target = this.selectedInspect;
    const piece = target?.hostInstanceId ? this.findPiece(target.hostInstanceId) : undefined;
    const baseSkill = target?.kind === 'skill' ? skillBook[target.skillId] : piece ? skillBook[piece.skillId] : undefined;

    if (!target || !baseSkill) {
      text(leftX, topY, 'Hover, drag, or tap a card to inspect it.', {
        fontSize: '10px',
        color: UI.textDim,
        fontFamily: FONT.body,
        wordWrap: { width: colW },
      });
      return;
    }

    const tier = (target.kind === 'skill' ? target.tier : undefined) ?? piece?.tier ?? baseSkill.tier;
    const skill = applyTier(baseSkill, tier);

    // Left: the card.
    const name = text(leftX, topY, skill.name, {
      fontSize: '13px',
      color: `#${TIER_COLOR[skill.tier].toString(16).padStart(6, '0')}`,
      fontFamily: FONT.body,
      fontStyle: 'bold',
    });
    const type = cardType(skill);
    const typeLabel = type ? String(type.type).toUpperCase() : PROPERTY_LABEL[skill.property];
    const meta = text(leftX, name.y + name.height + 4, `${typeLabel} · ${skill.tier.toUpperCase()} · size ${skill.size} · w${weightOf(skill)} · PL ${powerLevel(skill)}`, {
      fontSize: '9px',
      color: UI.textDim,
      fontFamily: FONT.body,
    });
    const body = text(leftX, meta.y + meta.height + 8, stripCardTextMarkup(skill.text ?? ''), {
      fontSize: '10px',
      color: UI.text,
      fontFamily: FONT.body,
      wordWrap: { width: colW },
      lineSpacing: 2,
    });
    const aura = describeAura(skill);
    if (aura) {
      text(leftX, body.y + body.height + 8, `Aura: ${aura}`, {
        fontSize: '9px',
        color: UI.textSoft,
        fontFamily: FONT.body,
        wordWrap: { width: colW },
        lineSpacing: 2,
      });
    }

    // Right: the socketed gem, when the card is a deck piece holding one.
    const gemDef = target.kind === 'gem' ? gemBook[target.gemId] : piece?.gem ? gemBook[piece.gem.id] : undefined;
    if (!gemDef) {
      text(rightX, topY, piece ? 'No gem socketed.' : 'No gem — only deck cards can hold one.', {
        fontSize: '10px',
        color: UI.textDim,
        fontFamily: FONT.body,
        wordWrap: { width: colW },
      });
      if (piece) {
        text(rightX, topY + 20, 'Tap the + button under the card to socket a gem.', {
          fontSize: '9px',
          color: UI.textSoft,
          fontFamily: FONT.body,
          wordWrap: { width: colW },
        });
      }
      return;
    }

    const gemName = text(rightX, topY, gemDef.name, {
      fontSize: '13px',
      color: `#${GEM_RARITY_COLOR[gemDef.rarity].toString(16).padStart(6, '0')}`,
      fontFamily: FONT.body,
      fontStyle: 'bold',
    });
    const gemMeta = text(rightX, gemName.y + gemName.height + 4, `${gemDef.rarity.toUpperCase()} · ${gemDef.kind === 'effect' ? 'EFFECT GEM' : 'STAT GEM'} · PL +${gemPowerLevel(gemDef)}`, {
      fontSize: '9px',
      color: UI.textDim,
      fontFamily: FONT.body,
    });
    text(rightX, gemMeta.y + gemMeta.height + 8, gemDef.text, {
      fontSize: '10px',
      color: UI.text,
      fontFamily: FONT.body,
      wordWrap: { width: colW },
      lineSpacing: 2,
    });
  }

  /**
   * The Active Deck panel: header, hero level control, board summary, the
   * 10-slot rail and its equipped cards. Deck Build renders it editable; the
   * prep screen can reuse it read-only (`editable: false`) — cards then only
   * inspect, never drag.
   */
  private renderActiveDeckPanel(
    bounds: { x: number; y: number; w: number; h: number },
    railY: number,
    editable: boolean,
  ): void {
    this.viewPanel(bounds, 'ACTIVE DECK', UI.panelMuted);
    this.viewText(bounds.x + bounds.w - 18, panelToolbarRowY(bounds), this.boardSummaryText(), {
      fontSize: '10px',
      color: UI.text,
      fontFamily: FONT.body,
      align: 'right',
      lineSpacing: 1,
    }).setOrigin(1, 0.5);
    this.renderHeroLevelControl(bounds);
    this.renderBoardSlots(railY, editable);
    const heroControlCenterY = panelToolbarRowY(bounds);
    const cardTopY = railY - CARD_H / 2;
    const socketY = (heroControlCenterY + cardTopY) / 2;
    this.renderBoardCards(railY, editable, socketY);
    this.renderDeckIdentityLine(bounds);
  }

  /**
   * Deck affinity status: 3+ cards of one weapon/element give the deck that
   * type's affinity — unlocking the weapon/element triangle (deal +50% into the
   * type it beats, take −25% from it; take +50% from the type that beats it).
   * Shows progress toward the threshold when not yet unlocked.
   */
  private renderDeckIdentityLine(bounds: { x: number; y: number; w: number; h: number }, yOverride?: number, stacked = false): void {
    const skills = demoState.pieces
      .map((piece) => skillBook[piece.skillId])
      .filter((skill): skill is SkillDef => Boolean(skill));
    const identity = boardTypeIdentity(skills);
    const y = yOverride ?? bounds.y + bounds.h - 30;
    const tally = new Map<string, { label: string; count: number }>();
    for (const skill of skills) {
      const type = cardType(skill);
      if (!type) continue;
      const key = `${type.kind}:${type.type}`;
      const entry = tally.get(key) ?? { label: String(type.type).toUpperCase(), count: 0 };
      entry.count += 1;
      tally.set(key, entry);
    }
    const entries = [...tally.values()].sort((a, b) => b.count - a.count).slice(0, 4);

    if (!identity) {
      if (entries.length === 0) {
        this.viewText(bounds.x + bounds.w / 2, y, `No affinity — 3+ cards of one type unlocks that affinity`, {
          fontSize: '10px',
          color: UI.textDim,
          fontFamily: FONT.body,
          align: 'center',
        }).setOrigin(0.5);
        return;
      }
      this.renderIdentityTalliesForLayout(bounds.x + bounds.w / 2, y, entries, `— 3 of a type unlocks its affinity`, stacked);
      return;
    }

    const { weakTo, resists } = this.identityMatchups(identity);
    const tail = [`— ${String(identity.type).toUpperCase()} affinity`];
    if (weakTo) tail.push(`weak to ${weakTo.toUpperCase()} +50%`);
    if (resists) tail.push(`beats ${resists.toUpperCase()} −25%`);
    this.renderIdentityTalliesForLayout(bounds.x + bounds.w / 2, y, entries, tail.join(' · '), stacked);
  }

  private renderIdentityTalliesForLayout(
    centerX: number,
    y: number,
    entries: Array<{ label: string; count: number }>,
    tail: string,
    stacked: boolean,
  ): void {
    if (!stacked) {
      this.renderIdentityTallies(centerX, y, entries, tail);
      return;
    }

    const rowGap = PREP_FIGHT_LAYOUT.identityStackRowGap;
    const style = { fontSize: '10px', color: UI.textDim, fontFamily: FONT.body, fontStyle: 'bold' };
    entries.forEach((entry, index) => {
      this.viewText(centerX, y + index * rowGap, `${entry.label} ${Math.min(entry.count, 3)}/3`, style).setOrigin(0.5);
    });
    this.viewText(centerX, y + entries.length * rowGap + PREP_FIGHT_LAYOUT.identityStackTailGap, tail, {
      ...style,
      fontSize: '9px',
    }).setOrigin(0.5);
  }

  /**
   * One centered row of per-type progress: `SWORD ■■□ · FIRE ■□□ · …` plus a
   * tail. Each entry gets 3 pip slots (the identity threshold), filled per
   * matching card on the board.
   */
  private renderIdentityTallies(centerX: number, y: number, entries: Array<{ label: string; count: number }>, tail: string): void {
    const pip = 9;
    const pipGap = 4;
    const textGap = 8;
    const sepGap = 14;
    const style = { fontSize: '10px', color: UI.textDim, fontFamily: FONT.body, fontStyle: 'bold' };
    const labels = entries.map((entry) => this.viewText(0, y, entry.label, style).setOrigin(0, 0.5));
    const tailText = this.viewText(0, y, tail, style).setOrigin(0, 0.5);
    const pipsW = 3 * pip + 2 * pipGap;
    const groupsW = labels.reduce((sum, label) => sum + label.width + textGap + pipsW, 0) + (entries.length - 1) * sepGap;
    let x = centerX - (groupsW + textGap + tailText.width) / 2;
    for (let i = 0; i < entries.length; i++) {
      labels[i]!.setX(x);
      x += labels[i]!.width + textGap;
      const filled = Math.min(entries[i]!.count, 3);
      for (let j = 0; j < 3; j++) {
        const rect = this.viewRect(x + pip / 2, y, pip, pip, j < filled ? UI.chip : UI.slot);
        rect.setStrokeStyle(1, UI.border, 0.85);
        x += pip + pipGap;
      }
      x += sepGap - pipGap;
    }
    tailText.setX(x - sepGap + textGap);
  }

  /** Incoming-matchup consequences of a board identity: what beats it, what it beats. */
  private identityMatchups(identity: BoardIdentity): { weakTo: string | null; resists: string | null } {
    if (identity.kind === 'element') {
      const weakTo = (Object.keys(ELEMENT_BEATS) as Element[]).find((el) => ELEMENT_BEATS[el] === identity.type) ?? null;
      return { weakTo, resists: ELEMENT_BEATS[identity.type] ?? null };
    }
    const weakTo = (Object.keys(WEAPON_BEATS) as WeaponType[]).find((weapon) => WEAPON_BEATS[weapon] === identity.type) ?? null;
    return { weakTo, resists: WEAPON_BEATS[identity.type] ?? null };
  }

  /** The bag rail — rendered identically to the deck rail, 10 slots, full-size cards. */
  private renderBagRail(y: number, draggable: boolean): void {
    for (let index = 0; index < demoState.bagSlots.length; index++) {
      const x = BOARD_LEFT + index * SLOT_W + SLOT_W / 2;
      const rect = this.viewRect(x, y, SLOT_W - 6, CARD_H + 12, UI.slot);
      rect.setStrokeStyle(1.25, UI.border, 0.78);
      this.slotZones.push({ index, rect, baseFill: UI.slot });
      this.viewText(x, y + CARD_H / 2 + DECK_BUILD_LAYOUT.rail.slotNumberGap, String(index + 1), {
        fontSize: '9px',
        color: UI.textDim,
        fontFamily: FONT.body,
      }).setOrigin(0.5, 0);
    }

    for (let index = 0; index < demoState.bagSlots.length; index++) {
      const slotValue = demoState.bagSlots[index];
      if (!slotValue) continue;
      const baseSkill = skillBook[slotValue.skillId];
      if (!baseSkill) continue;
      const skill = applyTier(baseSkill, slotValue.tier);
      const x = BOARD_LEFT + index * SLOT_W + (skill.size * SLOT_W) / 2;
      const card = this.viewCard(x, y, skill, 1, UI.panel);
      this.bindInspect(card, { kind: 'skill', skillId: slotValue.skillId, tier: slotValue.tier, contextLabel: `Bag copy · ${slotValue.instanceId}` });
      if (draggable) this.makeDraggable(card, { kind: 'bag', index, card: slotValue, skillId: slotValue.skillId, tier: slotValue.tier }, true);
    }
  }

  private renderWikiSubtabs(active: 'cards' | 'opponents' | 'balance'): void {
    const tabH = DISPLAY_THEME.spacing.panelControlH;
    const y = panelHeaderCenterY({ x: SCREEN.safeX, y: VIEW_TOP, w: VIEW_W, h: 0 });
    const gap = DISPLAY_THEME.spacing.chipGap;
    const definitions: Array<{ section: 'cards' | 'opponents' | 'balance'; label: string; width: number }> = [
      { section: 'cards', label: 'CARDS', width: 74 },
      { section: 'balance', label: 'BALANCE', width: 84 },
      { section: 'opponents', label: 'OPPONENTS', width: 106 },
    ];
    const totalW = definitions.reduce((sum, item) => sum + item.width, 0) + gap * (definitions.length - 1);
    let x = SCREEN.safeX + VIEW_W - DISPLAY_THEME.spacing.panelHeaderInset - totalW;

    for (const definition of definitions) {
      const selected = definition.section === active;
      const rect = this.viewRect(x + definition.width / 2, y, definition.width, tabH, selected ? UI.chip : UI.panelMuted);
      rect.setStrokeStyle(1, selected ? UI.chipDark : UI.border, selected ? 0.88 : 0.38).setInteractive({ useHandCursor: true });
      const text = this.viewText(x + definition.width / 2, y, definition.label, {
        fontSize: '9px',
        color: selected ? '#1a1208' : UI.text,
        fontFamily: FONT.body,
        fontStyle: 'bold',
      }).setOrigin(0.5);
      auditControlLabel(rect, text, { name: `Wiki ${definition.label}`, horizontalPadding: 9, verticalPadding: 4 });
      rect.on('pointerdown', () => {
        demoState.prepView = definition.section === 'cards' ? 'codex' : definition.section === 'balance' ? 'balance' : 'opponents';
        this.renderActiveView();
        this.restoreSelection();
      });
      x += definition.width + gap;
    }
  }

  private renderOpponentsView(): void {
    const catalog = Object.values(enemies).sort((a, b) => a.name.localeCompare(b.name));
    const pageCount = Math.max(1, Math.ceil(catalog.length / OPPONENT_PAGE_SIZE));
    this.opponentPage = Phaser.Math.Clamp(this.opponentPage, 0, pageCount - 1);
    const pageOpponents = catalog.slice(
      this.opponentPage * OPPONENT_PAGE_SIZE,
      (this.opponentPage + 1) * OPPONENT_PAGE_SIZE,
    );

    this.viewPanel(OPPONENT_LIBRARY, 'WIKI', UI.panel);
    this.renderWikiSubtabs('opponents');
    const row0 = panelToolbarRowY(OPPONENT_LIBRARY);
    this.viewText(OPPONENT_LIBRARY.x + 18, row0, `${catalog.length} known opponents · reference only — browsing does not change your fight.`, {
      fontSize: '10px',
      color: UI.textDim,
      fontFamily: FONT.body,
    }).setOrigin(0, 0.5);
    this.viewText(OPPONENT_LIBRARY.x + OPPONENT_LIBRARY.w - 114, row0, `PAGE ${this.opponentPage + 1}/${pageCount}`, {
      fontSize: '11px',
      color: UI.text,
      fontFamily: FONT.body,
      fontStyle: 'bold',
    }).setOrigin(0, 0.5);
    this.viewSmallButton(OPPONENT_LIBRARY.x + OPPONENT_LIBRARY.w - 190, row0 - 12, 32, 24, '‹', this.opponentPage > 0, () => {
      this.opponentPage -= 1;
      this.scene.restart();
    });
    this.viewSmallButton(OPPONENT_LIBRARY.x + OPPONENT_LIBRARY.w - 48, row0 - 12, 32, 24, '›', this.opponentPage < pageCount - 1, () => {
      this.opponentPage += 1;
      this.scene.restart();
    });
    this.renderOpponentPreviewControls();

    const tileW = 308;
    const tileH = 140;
    const startX = OPPONENT_LIBRARY.x + 18;
    const startY = OPPONENT_LIBRARY.y + 164;
    for (let index = 0; index < pageOpponents.length; index++) {
      const x = startX + (index % 2) * (tileW + 12);
      const y = startY + Math.floor(index / 2) * (tileH + 8);
      this.renderOpponentTile(x, y, tileW, tileH, pageOpponents[index]!);
    }

    this.detailPanel.clear('Tap an opponent to open its full stats and scenario card rotation.');
  }

  private resolveOpponentPreview(enemyId: string): EncounterUnit {
    const titled = buildEnemyEncounter(enemyId, this.opponentPreviewLevel, this.opponentPreviewTitle);
    const tierSteps = WIKI_TIERS.indexOf(this.opponentPreviewTier);
    const uniformRank = titled.setup.pieces.length * tierSteps;
    return buildEnemyEncounter(enemyId, this.opponentPreviewLevel, this.opponentPreviewTitle, uniformRank);
  }

  private renderOpponentPreviewControls(): void {
    const rowOneY = panelToolbarRowY(OPPONENT_LIBRARY, 1);
    const rowTwoY = rowOneY + 38;
    this.viewText(OPPONENT_LIBRARY.x + 18, rowOneY, 'TITLE', {
      fontSize: '10px',
      color: UI.textDim,
      fontFamily: FONT.body,
      fontStyle: 'bold',
    }).setOrigin(0, 0.5);

    let titleX = OPPONENT_LIBRARY.x + 72;
    for (const title of ENEMY_TITLES) {
      const selected = this.opponentPreviewTitle === title;
      const w = title === 'normal' ? 68 : 54;
      const chip = this.viewRect(titleX + w / 2, rowOneY, w, 28, selected ? UI.chip : UI.panelMuted);
      chip.setStrokeStyle(1, selected ? UI.chipDark : UI.border, selected ? 0.9 : 0.4).setInteractive({ useHandCursor: true });
      const label = TITLE_LABEL[title];
      const text = this.viewText(titleX + w / 2, rowOneY, label, {
        fontSize: '9px',
        color: selected ? '#1a1208' : UI.text,
        fontFamily: FONT.body,
        fontStyle: 'bold',
      }).setOrigin(0.5);
      auditControlLabel(chip, text, { name: `Opponent title ${label}`, horizontalPadding: 8, verticalPadding: 5 });
      chip.on('pointerdown', () => {
        this.opponentPreviewTitle = title;
        this.opponentPage = 0;
        this.scene.restart();
      });
      titleX += w + 5;
    }

    const levelX = OPPONENT_LIBRARY.x + OPPONENT_LIBRARY.w - 198;
    const levelGroup = this.viewRect(levelX + 90, rowOneY, 180, 30, UI.panel, 0.74);
    levelGroup.setStrokeStyle(1, UI.border, 0.5);
    this.viewText(levelX + 10, rowOneY, 'LEVEL', {
      fontSize: '10px',
      color: UI.textDim,
      fontFamily: FONT.body,
      fontStyle: 'bold',
    }).setOrigin(0, 0.5);
    this.viewSmallButton(levelX + 68, rowOneY - 12, 26, 24, '−', this.opponentPreviewLevel > 1, () => {
      this.opponentPreviewLevel -= 1;
      this.scene.restart();
    });
    this.viewText(levelX + 112, rowOneY, String(this.opponentPreviewLevel), {
      fontSize: '13px',
      color: UI.text,
      fontFamily: FONT.body,
      fontStyle: 'bold',
    }).setOrigin(0.5);
    this.viewSmallButton(levelX + 136, rowOneY - 12, 26, 24, '+', this.opponentPreviewLevel < MAX_LEVEL, () => {
      this.opponentPreviewLevel += 1;
      this.scene.restart();
    });

    this.viewText(OPPONENT_LIBRARY.x + 18, rowTwoY, 'CARD TIER', {
      fontSize: '10px',
      color: UI.textDim,
      fontFamily: FONT.body,
      fontStyle: 'bold',
    }).setOrigin(0, 0.5);
    let tierX = OPPONENT_LIBRARY.x + 92;
    for (const tier of WIKI_TIERS) {
      const selected = this.opponentPreviewTier === tier;
      const w = 72;
      const chip = this.viewRect(tierX + w / 2, rowTwoY, w, 28, selected ? UI.chipDark : UI.panelMuted);
      chip.setStrokeStyle(1, TIER_COLOR[tier], selected ? 1 : 0.5).setInteractive({ useHandCursor: true });
      const text = this.viewText(tierX + w / 2, rowTwoY, tier.toUpperCase(), {
        fontSize: '9px',
        color: selected ? `#${TIER_COLOR[tier].toString(16).padStart(6, '0')}` : UI.textDim,
        fontFamily: FONT.body,
        fontStyle: 'bold',
      }).setOrigin(0.5);
      auditControlLabel(chip, text, { name: `Opponent tier ${tier}`, horizontalPadding: 8, verticalPadding: 5 });
      chip.on('pointerdown', () => {
        this.opponentPreviewTier = tier;
        this.opponentPage = 0;
        this.scene.restart();
      });
      tierX += w + 5;
    }
    this.viewSmallButton(OPPONENT_LIBRARY.x + OPPONENT_LIBRARY.w - 124, rowTwoY - 14, 106, 28, 'CLEAR', true, () => {
      this.opponentPreviewLevel = 1;
      this.opponentPreviewTitle = 'normal';
      this.opponentPreviewTier = 'bronze';
      this.opponentPage = 0;
      this.scene.restart();
    });
  }

  private renderOpponentTile(x: number, y: number, w: number, h: number, enemy: EnemyDef): void {
    const preview = this.resolveOpponentPreview(enemy.id);
    const identity = opponentIdentity(this.opponentPreviewTitle);
    const shadow = this.viewRect(x + 2, y + 3, w, h, UI.shadow, 0.12);
    shadow.setOrigin(0, 0);
    const tile = this.viewRect(x, y, w, h, UI.panelMuted, 0.94);
    tile.setOrigin(0, 0).setStrokeStyle(1, UI.border, 0.68).setInteractive({ useHandCursor: true });
    const spine = this.viewRect(x, y, 5, h, identity.color, 0.92);
    spine.setOrigin(0, 0);

    this.viewText(x + 14, y + 12, enemy.name, {
      fontSize: '15px',
      color: UI.text,
      fontFamily: FONT.display,
      fontStyle: 'bold',
    });
    const tagW = identity.label === 'NORMAL' ? 62 : 50;
    const tag = this.viewRect(x + w - 14 - tagW / 2, y + 20, tagW, 22, identity.color, 0.9);
    tag.setStrokeStyle(1, UI.border, 0.46);
    const tagText = this.viewText(x + w - 14 - tagW / 2, y + 20, identity.label, {
      fontSize: '9px',
      color: '#ffffff',
      fontFamily: FONT.body,
      fontStyle: 'bold',
    }).setOrigin(0.5);
    auditControlLabel(tag, tagText, { name: `${enemy.name} identity`, horizontalPadding: 6, verticalPadding: 4 });

    const stats = preview.setup.stats;
    this.viewText(x + 14, y + 43, `HP ${stats.maxHp} · SPD ${stats.speed} · ATK ${stats.attack} · MAG ${stats.magicPower}`, {
      fontSize: '10px',
      color: UI.text,
      fontFamily: FONT.body,
      fontStyle: 'bold',
    });
    this.viewText(x + 14, y + 61, `DEF ${stats.armor} · RES ${stats.magicResist}`, {
      fontSize: '10px',
      color: UI.textDim,
      fontFamily: FONT.body,
    });
    this.viewText(x + 14, y + 81, opponentAffinities(enemy), {
      fontSize: '10px',
      color: '#84531d',
      fontFamily: FONT.body,
      fontStyle: 'bold',
    });

    const deckNames = preview.setup.pieces.map((piece) => skillBook[piece.skillId]?.name ?? piece.skillId);
    const compactDeck = deckNames.length > 3
      ? `${deckNames.slice(0, 2).join(' · ')} · +${deckNames.length - 2} more`
      : deckNames.join(' · ');
    this.viewText(x + 14, y + 103, compactDeck, {
      fontSize: '10px',
      color: UI.text,
      fontFamily: FONT.body,
      wordWrap: { width: w - 28 },
      maxLines: 1,
    });
    const totalPl = preview.setup.pieces.reduce((sum, piece) => {
      const baseSkill = skillBook[piece.skillId];
      if (!baseSkill) return sum;
      const skill = piece.tier ? applyTier(baseSkill, piece.tier) : baseSkill;
      return sum + instancePowerLevelDeci(skill, piece);
    }, 0);
    this.viewText(x + 14, y + h - 18, `${this.opponentPreviewTier.toUpperCase()} · LV ${preview.effectiveLevel} · ${preview.setup.pieces.length} cards · PL ${formatPowerDeci(totalPl)} · ${enemy.goldReward}g · ${enemy.xpReward}XP`, {
      fontSize: '9px',
      color: UI.textDim,
      fontFamily: FONT.body,
      fontStyle: 'bold',
    });

    tile.on('pointerover', () => tile.setFillStyle(UI.slotHover, 0.98));
    tile.on('pointerout', () => tile.setFillStyle(UI.panelMuted, 0.94));
    tile.on('pointerdown', () => this.openOpponentDetails(enemy.id));
  }

  private openOpponentDetails(enemyId: string): void {
    const enemy = enemies[enemyId];
    if (!enemy) return;
    this.closeModal();

    const closeModal = (): void => this.closeModal();
    const preview = this.resolveOpponentPreview(enemy.id);
    const identity = opponentIdentity(this.opponentPreviewTitle);
    const panelHeight = 326 + preview.setup.pieces.length * 108;
    const overlay = this.add.rectangle(0, 0, SCREEN.width, SCREEN.height, 0x0f1822, 0.36).setOrigin(0, 0).setDepth(60).setInteractive();
    overlay.on('pointerdown', closeModal);
    const shadow = this.add.rectangle(60, 246, 612, panelHeight, UI.shadow, 0.2).setOrigin(0, 0).setDepth(61);
    const panel = this.add.rectangle(54, 238, 612, panelHeight, UI.panel).setOrigin(0, 0).setStrokeStyle(1, UI.border, 0.82).setDepth(62);
    const header = this.add.rectangle(54, 238, 612, 66, UI.chipDark).setOrigin(0, 0).setDepth(63);
    const spine = this.add.rectangle(54, 238, 5, panelHeight, identity.color).setOrigin(0, 0).setDepth(64);
    const title = this.add.text(76, 250, enemy.name.toUpperCase(), {
      fontSize: '19px',
      color: '#ffffff',
      fontFamily: FONT.display,
      fontStyle: 'bold',
    }).setDepth(64);
    const subtitle = this.add.text(76, 278, `${identity.label} · EFFECTIVE LV ${preview.effectiveLevel} · ${this.opponentPreviewTier.toUpperCase()} CARDS`, {
      fontSize: '9px',
      color: '#ded3ba',
      fontFamily: FONT.body,
      fontStyle: 'bold',
    }).setDepth(64);
    const close = this.add.rectangle(636, 270, 28, 28, UI.panelMuted).setStrokeStyle(1, UI.border, 0.58).setDepth(64).setInteractive({ useHandCursor: true });
    const closeText = this.add.text(636, 270, '×', {
      fontSize: '14px',
      color: UI.text,
      fontFamily: FONT.body,
      fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(65);
    auditControlLabel(close, closeText, { name: 'Opponent detail close', horizontalPadding: 6, verticalPadding: 4 });
    close.on('pointerdown', closeModal);
    this.modalObjects.push(overlay, shadow, panel, header, spine, title, subtitle, close, closeText);

    const stats = preview.setup.stats;
    const section = this.add.text(76, 326, 'SCENARIO STATS', {
      fontSize: '10px',
      color: UI.textDim,
      fontFamily: FONT.body,
      fontStyle: 'bold',
    }).setDepth(64);
    const primary = this.add.text(76, 350, `HP ${stats.maxHp}     SPD ${stats.speed}     ATK ${stats.attack}     MAG ${stats.magicPower}`, {
      fontSize: '14px',
      color: UI.text,
      fontFamily: FONT.body,
      fontStyle: 'bold',
    }).setDepth(64);
    const defense = this.add.text(76, 376, `DEF ${stats.armor}     RES ${stats.magicResist}     BOARD ${preview.setup.boardSize}`, {
      fontSize: '12px',
      color: UI.textDim,
      fontFamily: FONT.body,
    }).setDepth(64);
    const affinity = this.add.text(76, 406, `AFFINITY  ${opponentAffinities(enemy)}`, {
      fontSize: '11px',
      color: '#84531d',
      fontFamily: FONT.body,
      fontStyle: 'bold',
    }).setDepth(64);
    const weakness = this.add.text(76, 428, `COUNTER  ${formatWeaknessLine(enemy.id) || 'none recorded'}`, {
      fontSize: '11px',
      color: UI.text,
      fontFamily: FONT.body,
    }).setDepth(64);
    const rewards = this.add.text(76, 450, `REWARDS  ${enemy.goldReward} gold · ${enemy.xpReward} XP`, {
      fontSize: '11px',
      color: UI.textDim,
      fontFamily: FONT.body,
    }).setDepth(64);
    const rule = this.add.rectangle(76, 480, 570, 1, UI.border, 0.25).setOrigin(0, 0).setDepth(63);
    const rotationTitle = this.add.text(76, 496, 'SCENARIO CARD ROTATION', {
      fontSize: '10px',
      color: UI.textDim,
      fontFamily: FONT.body,
      fontStyle: 'bold',
    }).setDepth(64);
    this.modalObjects.push(section, primary, defense, affinity, weakness, rewards, rule, rotationTitle);

    for (let index = 0; index < preview.setup.pieces.length; index++) {
      const piece = preview.setup.pieces[index]!;
      const baseSkill = skillBook[piece.skillId];
      if (!baseSkill) continue;
      const skill = piece.tier ? applyTier(baseSkill, piece.tier) : baseSkill;
      const y = 526 + index * 108;
      const color = PROPERTY_COLOR[skill.property];
      const cardSpine = this.add.rectangle(76, y, 5, 86, color).setOrigin(0, 0).setDepth(64);
      const number = this.add.text(90, y + 2, String(index + 1).padStart(2, '0'), {
        fontSize: '10px',
        color: UI.textSoft,
        fontFamily: FONT.body,
        fontStyle: 'bold',
      }).setDepth(64);
      const name = this.add.text(118, y, skill.name, {
        fontSize: '14px',
        color: UI.text,
        fontFamily: FONT.display,
        fontStyle: 'bold',
      }).setDepth(64);
      const meta = this.add.text(118, y + 24, `${skill.tier.toUpperCase()} · ${PROPERTY_LABEL[skill.property]} · WT ${weightOf(skill)} · ${skill.size} SLOT${skill.size === 1 ? '' : 'S'} · START ${piece.slot + 1}`, {
        fontSize: '10px',
        color: `#${color.toString(16).padStart(6, '0')}`,
        fontFamily: FONT.body,
        fontStyle: 'bold',
      }).setDepth(64);
      const actions = presentCardActions(skill).slice(0, 2).map((action) => `${action.verb} ${action.effect}`).join(' · ');
      const actionText = this.add.text(118, y + 46, actions || stripCardTextMarkup(skill.text), {
        fontSize: '10px',
        color: UI.textDim,
        fontFamily: FONT.body,
        wordWrap: { width: 508 },
        maxLines: 2,
      }).setDepth(64);
      const cardRule = this.add.rectangle(76, y + 96, 570, 1, UI.border, 0.16).setOrigin(0, 0).setDepth(63);
      this.modalObjects.push(cardSpine, number, name, meta, actionText, cardRule);
    }

    const note = this.add.text(76, 238 + panelHeight - 28, 'Preview only. CLEAR restores LV 1 · NORMAL · BRONZE.', {
      fontSize: '9px',
      color: UI.textSoft,
      fontFamily: FONT.body,
    }).setDepth(64);
    this.modalObjects.push(note);
  }

  private renderWikiView(): void {
    const catalog = sortSkillsForWiki();
    const allSkills = this.filteredWikiSkills(catalog);
    const dense = demoState.wikiGrid === 'dense';
    const gridCols = dense ? 4 : 3;
    const gridRows = dense ? 4 : 3;
    const pageSize = gridCols * gridRows;
    const pageCount = Math.max(1, Math.ceil(allSkills.length / pageSize));
    this.wikiPage = Phaser.Math.Clamp(this.wikiPage, 0, pageCount - 1);
    const pageSkills = allSkills.slice(this.wikiPage * pageSize, (this.wikiPage + 1) * pageSize);

    this.viewPanel(WIKI_LIBRARY, 'WIKI', UI.panel);
    this.renderWikiSubtabs('cards');
    const row0 = panelToolbarRowY(WIKI_LIBRARY);
    const row1 = panelToolbarRowY(WIKI_LIBRARY, 1);
    this.viewText(WIKI_LIBRARY.x + 18, row0, `${allSkills.length}/${catalog.length} cards · choose a tier, open a card sheet, then add copies.`, {
      fontSize: '10px',
      color: UI.textDim,
      fontFamily: FONT.body,
    }).setOrigin(0, 0.5);
    this.viewText(WIKI_LIBRARY.x + WIKI_LIBRARY.w - 114, row0, `PAGE ${this.wikiPage + 1}/${pageCount}`, {
      fontSize: '11px',
      color: UI.text,
      fontFamily: FONT.body,
      fontStyle: 'bold',
    }).setOrigin(0, 0.5);
    let gridChipX = WIKI_LIBRARY.x + WIKI_LIBRARY.w - 322;
    for (const mode of ['large', 'dense'] as const) {
      const active = demoState.wikiGrid === mode;
      const chip = this.viewRect(gridChipX + 27, row0, 54, 24, active ? UI.chipDark : UI.panelMuted);
      chip.setStrokeStyle(1, UI.border, active ? 1 : 0.55).setInteractive({ useHandCursor: true });
      chip.on('pointerdown', () => {
        demoState.wikiGrid = mode;
        this.scene.restart();
      });
      const chipText = this.viewText(gridChipX + 27, row0, mode === 'large' ? '3×3' : '4×4', {
        fontSize: '9px',
        color: active ? '#ffffff' : UI.textDim,
        fontFamily: FONT.body,
        fontStyle: 'bold',
      }).setOrigin(0.5);
      auditControlLabel(chip, chipText, { name: `Wiki grid ${mode}`, horizontalPadding: 8, verticalPadding: 4 });
      gridChipX += 60;
    }
    this.viewText(WIKI_LIBRARY.x + 18, row1, 'PREVIEW TIER', {
      fontSize: '10px',
      color: UI.textDim,
      fontFamily: FONT.body,
      fontStyle: 'bold',
    }).setOrigin(0, 0.5);
    let tierX = WIKI_LIBRARY.x + 112;
    for (const tier of WIKI_TIERS) {
      const active = tier === this.wikiTier;
      const w = 72;
      const chip = this.viewRect(tierX + w / 2, row1, w, 24, active ? UI.chipDark : UI.panelMuted);
      chip.setStrokeStyle(active ? 1.5 : 1, TIER_COLOR[tier], active ? 1 : 0.55);
      chip.setInteractive({ useHandCursor: true });
      chip.on('pointerdown', () => {
        this.wikiTier = tier;
        demoState.wikiTier = tier;
        if (this.selectedInspect?.kind === 'skill' && this.selectedInspect.contextLabel?.startsWith('Wiki')) {
          this.selectedInspect.tier = tier;
          this.selectedInspect.contextLabel = 'Wiki preview';
        }
        this.scene.restart();
      });
      const tierText = this.viewText(tierX + w / 2, row1, tier.toUpperCase(), {
        fontSize: '9px',
        color: active ? `#${TIER_COLOR[tier].toString(16).padStart(6, '0')}` : UI.textDim,
        fontFamily: FONT.body,
        fontStyle: 'bold',
      }).setOrigin(0.5);
      auditControlLabel(chip, tierText, { name: `${tier} tier`, horizontalPadding: 8, verticalPadding: 4 });
      tierX += w + 6;
    }
    this.viewText(WIKI_LIBRARY.x + WIKI_LIBRARY.w - 18, row1, `BAG ${this.bagSlotsUsed()}/${demoState.bagSlots.length}`, {
      fontSize: '10px',
      color: UI.text,
      fontFamily: FONT.body,
      fontStyle: 'bold',
    }).setOrigin(1, 0.5);
    const activeFilters = this.activeWikiFilterCount();
    const filterW = 78;
    const filterX = WIKI_LIBRARY.x + WIKI_LIBRARY.w - 184;
    const filter = this.viewRect(filterX + filterW / 2, row1, filterW, 24, activeFilters > 0 ? UI.chipDark : UI.panelMuted);
    filter.setStrokeStyle(1, UI.border, 0.7).setInteractive({ useHandCursor: true });
    filter.on('pointerdown', () => this.openWikiFilters());
    const filterText = this.viewText(filterX + filterW / 2, row1, activeFilters > 0 ? `FILTER ${activeFilters}` : 'FILTER', {
      fontSize: '9px',
      color: activeFilters > 0 ? '#ffffff' : UI.text,
      fontFamily: FONT.body,
      fontStyle: 'bold',
    }).setOrigin(0.5);
    auditControlLabel(filter, filterText, { name: 'Wiki filter', horizontalPadding: 9, verticalPadding: 4 });

    // Grid of shrunken full-art templates; density is a user toggle (3×3
    // large / 4×4 dense). Card size derives from the row pitch at the locked
    // 420:690 aspect; tap a card to open its full sheet with the + BAG action.
    const gridTop = row1 + 24;
    const gridBottom = WIKI_LIBRARY.y + WIKI_LIBRARY.h - 14;
    const rowPitch = (gridBottom - gridTop) / gridRows;
    const cardH = Math.round(rowPitch - 10);
    const cardW = Math.round(cardH * (420 / 690));
    const gridSideInset = 44;
    const colPitch = (WIKI_LIBRARY.w - gridSideInset * 2) / gridCols;
    for (let index = 0; index < pageSkills.length; index++) {
      const cx = WIKI_LIBRARY.x + gridSideInset + colPitch * (index % gridCols) + colPitch / 2;
      const cy = gridTop + rowPitch * Math.floor(index / gridCols) + rowPitch / 2;
      this.renderWikiCardGridItem(cx, cy, cardW, cardH, pageSkills[index]!);
    }
    const gridCenterY = (gridTop + gridBottom) / 2;
    this.viewSmallButton(WIKI_LIBRARY.x + 28, gridCenterY - 20, 32, 40, '‹', this.wikiPage > 0, () => {
      this.wikiPage -= 1;
      this.scene.restart();
    });
    this.viewSmallButton(WIKI_LIBRARY.x + WIKI_LIBRARY.w - 60, gridCenterY - 20, 32, 40, '›', this.wikiPage < pageCount - 1, () => {
      this.wikiPage += 1;
      this.scene.restart();
    });
    if (pageSkills.length === 0) this.renderWikiEmptyState();
  }

  /**
   * BALANCE subtab: RULES = the general pricing model (rendered live from
   * PRICE so it can never drift from the audited math) · TABLE = the per-card
   * ledger with per-column PL contributions and budget check.
   */
  private renderWikiBalanceView(): void {
    this.viewPanel(WIKI_LIBRARY, 'WIKI', UI.panel);
    this.renderWikiSubtabs('balance');
    const row0 = panelToolbarRowY(WIKI_LIBRARY);
    const row1 = panelToolbarRowY(WIKI_LIBRARY, 1);

    let chipX = WIKI_LIBRARY.x + 18;
    for (const mode of ['rules', 'table'] as const) {
      const active = this.balanceView === mode;
      const chip = this.viewRect(chipX + 37, row0, 74, 24, active ? UI.chipDark : UI.panelMuted);
      chip.setStrokeStyle(1, UI.border, active ? 1 : 0.55).setInteractive({ useHandCursor: true });
      chip.on('pointerdown', () => {
        this.balanceView = mode;
        this.renderActiveView();
      });
      const chipText = this.viewText(chipX + 37, row0, mode.toUpperCase(), {
        fontSize: '9px',
        color: active ? '#ffffff' : UI.textDim,
        fontFamily: FONT.body,
        fontStyle: 'bold',
      }).setOrigin(0.5);
      auditControlLabel(chip, chipText, { name: `Balance ${mode}`, horizontalPadding: 8, verticalPadding: 4 });
      chipX += 80;
    }

    if (this.balanceView === 'rules') {
      this.viewText(WIKI_LIBRARY.x + WIKI_LIBRARY.w - 18, row0, 'Live from PRICE (audited).', {
        fontSize: '9px',
        color: UI.textDim,
        fontFamily: FONT.body,
      }).setOrigin(1, 0.5);
      // One rule group per page — the group chips keep every page inside the panel.
      const groups: Array<{ key: 'buffs' | 'debuffs' | 'stats' | 'budget'; label: string }> = [
        { key: 'buffs', label: 'BUFFS' },
        { key: 'debuffs', label: 'DEBUFFS' },
        { key: 'stats', label: 'STATS' },
        { key: 'budget', label: 'BUDGET' },
      ];
      let groupX = WIKI_LIBRARY.x + 18;
      for (const group of groups) {
        const active = this.balanceRulesGroup === group.key;
        const chip = this.viewRect(groupX + 37, row1, 74, 24, active ? UI.chipDark : UI.panelMuted);
        chip.setStrokeStyle(1, UI.border, active ? 1 : 0.55).setInteractive({ useHandCursor: true });
        chip.on('pointerdown', () => {
          this.balanceRulesGroup = group.key;
          this.renderActiveView();
        });
        const chipText = this.viewText(groupX + 37, row1, group.label, {
          fontSize: '9px',
          color: active ? '#ffffff' : UI.textDim,
          fontFamily: FONT.body,
          fontStyle: 'bold',
        }).setOrigin(0.5);
        auditControlLabel(chip, chipText, { name: `Rules ${group.label}`, horizontalPadding: 8, verticalPadding: 4 });
        groupX += 80;
      }
      this.renderBalanceRules();
      return;
    }

    // TABLE mode reuses the cards header controls: tier preview + filter + pages
    const catalog = sortSkillsForWiki();
    const allSkills = this.filteredWikiSkills(catalog);
    const pageSize = 18;
    const pageCount = Math.max(1, Math.ceil(allSkills.length / pageSize));
    this.wikiPage = Phaser.Math.Clamp(this.wikiPage, 0, pageCount - 1);
    const pageSkills = allSkills.slice(this.wikiPage * pageSize, (this.wikiPage + 1) * pageSize);

    this.viewText(WIKI_LIBRARY.x + WIKI_LIBRARY.w - 114, row0, `PAGE ${this.wikiPage + 1}/${pageCount}`, {
      fontSize: '11px',
      color: UI.text,
      fontFamily: FONT.body,
      fontStyle: 'bold',
    }).setOrigin(0, 0.5);
    this.viewSmallButton(WIKI_LIBRARY.x + WIKI_LIBRARY.w - 190, row0 - 12, 32, 24, '‹', this.wikiPage > 0, () => {
      this.wikiPage -= 1;
      this.scene.restart();
    });
    this.viewSmallButton(WIKI_LIBRARY.x + WIKI_LIBRARY.w - 48, row0 - 12, 32, 24, '›', this.wikiPage < pageCount - 1, () => {
      this.wikiPage += 1;
      this.scene.restart();
    });
    this.viewText(WIKI_LIBRARY.x + 18, row1, 'PREVIEW TIER', {
      fontSize: '10px',
      color: UI.textDim,
      fontFamily: FONT.body,
      fontStyle: 'bold',
    }).setOrigin(0, 0.5);
    let tierX = WIKI_LIBRARY.x + 112;
    for (const tier of WIKI_TIERS) {
      const active = tier === this.wikiTier;
      const w = 72;
      const chip = this.viewRect(tierX + w / 2, row1, w, 24, active ? UI.chipDark : UI.panelMuted);
      chip.setStrokeStyle(active ? 1.5 : 1, TIER_COLOR[tier], active ? 1 : 0.55);
      chip.setInteractive({ useHandCursor: true });
      chip.on('pointerdown', () => {
        this.wikiTier = tier;
        demoState.wikiTier = tier;
        this.renderActiveView();
      });
      const tierText = this.viewText(tierX + w / 2, row1, tier.toUpperCase(), {
        fontSize: '9px',
        color: active ? `#${TIER_COLOR[tier].toString(16).padStart(6, '0')}` : UI.textDim,
        fontFamily: FONT.body,
        fontStyle: 'bold',
      }).setOrigin(0.5);
      auditControlLabel(chip, tierText, { name: `${tier} tier balance`, horizontalPadding: 8, verticalPadding: 4 });
      tierX += w + 6;
    }
    const filterW = 78;
    const filterX = WIKI_LIBRARY.x + WIKI_LIBRARY.w - 96;
    const activeFilters = this.activeWikiFilterCount();
    const filter = this.viewRect(filterX + filterW / 2, row1, filterW, 24, activeFilters > 0 ? UI.chipDark : UI.panelMuted);
    filter.setStrokeStyle(1, UI.border, 0.7).setInteractive({ useHandCursor: true });
    filter.on('pointerdown', () => this.openWikiFilters());
    const filterText = this.viewText(filterX + filterW / 2, row1, activeFilters > 0 ? `FILTER ${activeFilters}` : 'FILTER', {
      fontSize: '9px',
      color: activeFilters > 0 ? '#ffffff' : UI.text,
      fontFamily: FONT.body,
      fontStyle: 'bold',
    }).setOrigin(0.5);
    auditControlLabel(filter, filterText, { name: 'Balance filter', horizontalPadding: 9, verticalPadding: 4 });

    this.renderWikiListTable(pageSkills);
    if (pageSkills.length === 0) this.renderWikiEmptyState();
  }

  /** The general pricing model, one rule per line, computed from PRICE. */
  private renderBalanceRules(): void {
    const x = WIKI_LIBRARY.x + 18;
    const w = WIKI_LIBRARY.w - 36;
    // Start below the RULES/TABLE row AND the group-chip row.
    let y = panelToolbarRowY(WIKI_LIBRARY, 1) + 26;
    const section = (title: string): void => {
      this.viewText(x, y, title, {
        fontSize: '13px',
        color: UI.text,
        fontFamily: FONT.body,
        fontStyle: 'bold',
      });
      y += 18;
      this.viewRect(x + w / 2, y, w, 1, UI.border, 0.4);
      y += 8;
    };
    // Each rule shows the symbolic formula AND a worked example computed LIVE
    // through the engine's actual pricing function (actionsPriceDeci /
    // sizeGrantDeci) — the gold numbers on screen ARE the real calculation.
    // Three fixed column bands (label · formula · worked example); each cell
    // wraps inside its own band and the row advances by the tallest cell, so
    // long rules can never overflow into their neighbors.
    const rule = (label: string, formula: string, example?: string, note?: string): void => {
      const labelText = this.viewText(x, y, label, {
        fontSize: '11px',
        color: UI.text,
        fontFamily: FONT.body,
        fontStyle: 'bold',
        wordWrap: { width: 140 },
      });
      const formulaText = this.viewText(x + 152, y, formula, {
        fontSize: '11px',
        color: UI.textDim,
        fontFamily: FONT.body,
        wordWrap: { width: 196 },
      });
      const exampleText = example
        ? this.viewText(x + 360, y, example, {
            fontSize: '11px',
            color: `#${TIER_COLOR.gold.toString(16).padStart(6, '0')}`,
            fontFamily: FONT.body,
            fontStyle: 'bold',
            wordWrap: { width: w - 360 },
          })
        : null;
      y += Math.max(labelText.height, formulaText.height, exampleText?.height ?? 0) + 4;
      // Mechanic line: WHAT the keyword does, under the pricing rule.
      if (note) {
        const noteText = this.viewText(x + 152, y, note, {
          fontSize: '9px',
          color: UI.textDim,
          fontFamily: FONT.body,
          fontStyle: 'italic',
          wordWrap: { width: w - 152 },
        });
        y += noteText.height + 5;
      }
      y += 5;
    };
    const priced = (action: Action, property: Property = 'physical'): number =>
      actionsPriceDeci([action], property) / 10;

    // One group per page (chips above); every line is a RULE — a rate, a cap,
    // or a constraint — not an explanation. Numbers computed live from PRICE.
    const caps = (family: 'control' | 'dot' | 'empower' | 'damage'): string =>
      `${effectCapDeci(family, 1) / 10} / ${effectCapDeci(family, 2) / 10} / ${effectCapDeci(family, 3) / 10} PL by size`;

    switch (this.balanceRulesGroup) {
      case 'buffs': {
        section('BUFFS');
        rule('stat up', `${10 / PRICE.statPctTurn} %-turns = 1 PL`, `50% × 2t = ${priced({ kind: 'buffStat', stat: 'attack', pct: 50, turns: 2 })} PL`,
          'Raises one of your stats by % for N global turns.');
        rule('guard', `${(10 * PRICE.guardPerPctTurnDen) / PRICE.guardPerPctTurnNum} %-turns = 1 PL · max 60%`, `50% × 2t = ${priced({ kind: 'guard', property: 'magical', pct: 50, turns: 2 })} PL`,
          'Reduces incoming damage of its type by % for N turns.');
        rule('negate', `1 charge = ${PRICE.negatePerCharge / 10} PL · max 3 charges`, `negate 1 = ${priced({ kind: 'negate', property: 'magical', charges: 1 })} PL`,
          'Fully cancels the next direct hit of its type. DoT ticks never spend a charge.');
        rule('cleanse', `1 stack = ${PRICE.cleansePerCharge / 10} PL`, `cleanse 4 = ${priced({ kind: 'cleanse', charges: 4 })} PL`,
          'Removes your ailment stacks, soonest-to-expire first.');
        rule('lifesteal', `${Math.round((10 * PRICE.lifestealPerPctDen) / PRICE.lifestealPerPctNum)}% = 1 PL`, `45% = ${priced({ kind: 'lifesteal', pct: 45 })} PL`,
          'Heals the caster for % of the damage this cast dealt.');
        rule('combo', `${Math.round((10 * PRICE.comboPerPointDen) / PRICE.comboPerPointNum)} dmg = 1 PL`, `+20 = ${priced({ kind: 'comboBonus', amount: 20 })} PL`,
          'Bonus damage when your previous cast shared an archetype with this card.');
        rule('auras', `dmg+1 = ${PRICE.auraDamageFlat / 10} · heal+1 = ${PRICE.auraHealFlat / 10} · wt±1 = ${PRICE.auraWeightDelta / 10} PL · all-board ×2`, `dmg+5 adjacent = ${(5 * PRICE.auraDamageFlat) / 10} PL`,
          'Passive — boosts neighboring cards while this card sits on the board.');
        rule('CAP per card', 'auras exempt', caps('empower'));
        break;
      }
      case 'debuffs': {
        section('DEBUFFS');
        rule('poison / bleed', `tick = stacks, then −1 (decays) · ${10 / PRICE.dotPerStack} stack = 1 PL`, `5 stacks = ${priced({ kind: 'poison', stacks: 5 })} PL`,
          'Poison ticks at END of turn, unstoppable. Bleed ticks each time the victim CASTS; can\'t be applied through a shield. New stacks add to the pile.');
        rule('burn', `tick = 2× stacks, then halve · ${10 / PRICE.dotPerStack} stack = 1 PL`, `burn 8 = ${priced({ kind: 'burn', stacks: 8 })} PL`,
          'Ticks at START of turn — can kill before the victim acts. Shields absorb burn ticks.');
        rule('stun', `1 performance = ${PRICE.stunPerTurn / 10} PL · max ${MAX_STUN_PER_CARD} per card`, `stun 1 = ${priced({ kind: 'stun', turns: 1 })} PL`,
          'The enemy skips their next cast (they still bank Speed).');
        rule('slow', `+${(10 * PRICE.slowPerWeightDen) / PRICE.slowPerWeightNum} weight = 1 PL`, `+16w = ${priced({ kind: 'slow', weight: 16 })} PL`,
          'The enemy\'s next cast costs +N weight, so it comes out later.');
        rule('disrupt', 'escalating: pts 1-5 @ 5/pt, 6-10 @ 15/pt, 11-15 @ 30/pt, 16+ @ 60/pt (deci)', `disrupt 6 = ${priced({ kind: 'disrupt', amount: 6 })} PL · disrupt 10 = ${priced({ kind: 'disrupt', amount: 10 })} PL`,
          'Drains the enemy\'s banked readiness — can deny an imminent cast. Cost escalates sharply above 10.');
        rule('stat down', `${10 / PRICE.statPctTurn} %-turns = 1 PL`, `50% × 2t = ${priced({ kind: 'debuffStat', stat: 'attack', pct: 50, turns: 2 })} PL`,
          'Lowers an enemy stat by % for N global turns.');
        rule('expose', `${(10 * PRICE.guardPerPctTurnDen) / PRICE.guardPerPctTurnNum} %-turns = 1 PL · max 50%`, `50% × 2t = ${priced({ kind: 'expose', pct: 50, turns: 2 })} PL`,
          'The enemy takes +% damage from direct hits (never DoT ticks) for N turns.');
        rule('shieldBreak', `${(10 * PRICE.shieldBreakPerPointDen) / PRICE.shieldBreakPerPointNum} shattered = 1 PL`, `24 = ${priced({ kind: 'shieldBreak', amount: 24 })} PL`,
          'Shatters up to N enemy shield before this cast\'s hit lands.');
        rule('CAP: control per card', `stun / slow / disrupt / stat-down / expose / shieldBreak · stun ≤ ${MAX_STUN_PER_CARD}`, caps('control'));
        rule('CAP: DoTs per card', 'poison + burn + bleed combined', caps('dot'));
        break;
      }
      case 'stats': {
        section('FLAT STATS — ATK / MATK / DEF / MDEF / HEAL');
        rule('damage', `${10 / PRICE.flatPowerPerPoint} pts = 1 PL · +stat free`, `20 dmg = ${priced({ kind: 'damage', power: 20 })} PL`);
        rule('TRUE damage', `1 pt = 1 PL · flat ignores DEF/MDEF · stat add checked vs DEF/MDEF`, `27 = ${priced({ kind: 'damage', power: 27 }, 'true')} PL`);
        rule('shield', `${10 / PRICE.flatPowerPerPoint} pts = 1 PL · +stat free · pool caps at max HP`, `48 = ${priced({ kind: 'shield', power: 48 })} PL`);
        rule('TRUE shield', `${10 / PRICE.flatTrueShieldPerPoint} pts = 1 PL · no stat · blocks TRUE 1:1, typed drains 2:1`, `92 = ${priced({ kind: 'shield', power: 92 }, 'true')} PL`);
        rule('heal', `${10 / PRICE.flatPowerPerPoint} pts = 1 PL · +stat free (TRUE: flat only)`, `TRUE 50 = ${priced({ kind: 'heal', power: 50 }, 'true')} PL`);
        rule('CAP per card', 'each of dmg / shield / heal · ×1.5 / ×2 / ×2.5 at Silver/Gold/Diamond', `${caps('damage')} at Bronze`);
        y += 4;
        section('DAMAGE ORDER — how a hit resolves');
        rule(
          'pipeline',
          'base + ATK/MAG + skill/aura bonuses − DEF/RES · then × affinity 1.5 / 0.75 · then shields absorb · never below 1',
          'base 96 + 12 − 2 = 106 → ×0.75 = 79',
        );
        rule(
          'reading the math',
          'the affinity step displays as the flat damage it added or removed AT THAT STEP — so every term sums exactly to the total',
          '− (27 AFFINITY) = 25% of 106',
        );
        rule(
          'AFFINITY (design rule)',
          `innate (authored on monsters) always wins · else ${IDENTITY_THRESHOLD}+ cards of one unique top type grants that affinity · else none (neutral)`,
          `SWORD deck ⇒ sword affinity · beats AXE −25% · weak to LANCE +50%`,
        );
        break;
      }
      case 'budget': {
        section('PACKAGING');
        rule('weight', `${10 / PRICE.weightPer} under baseline (size × 10) = 1 PL · heavier refunds`, `wt 8 sz 1 = +${((10 - 8) * PRICE.weightPer) / 10} PL`);
        rule('cooldown', 'all cards = 3 · 0 PL (gems only)', `gem −1t = ${PRICE.cooldownPerTurn / 10} PL`);
        y += 4;
        // Dedicated size × tier matrix: the total PL a card's kit must sum to.
        section('KIT BUDGET — total PL by size × tier');
        this.renderKitBudgetMatrix(x, y, w);
        break;
      }
    }
  }

  /** The size × tier grid of total kit PL, rendered as a real table. */
  private renderKitBudgetMatrix(x: number, y: number, w: number): void {
    const tiers: SkillTier[] = ['bronze', 'silver', 'gold', 'diamond'];
    const sizes = [1, 2, 3] as const;
    const labelW = 96;
    const colW = Math.floor((w - labelW) / tiers.length);
    const rowH = 30;
    const kit = (size: number, tier: SkillTier): number => (TIER_BUDGET_DECI[tier] + sizeGrantDeci(size, tier)) / 10;

    // header row: tier names
    for (let c = 0; c < tiers.length; c++) {
      this.viewText(x + labelW + c * colW + colW / 2, y + rowH / 2, tiers[c]!.toUpperCase(), {
        fontSize: '10px',
        color: `#${TIER_COLOR[tiers[c]!].toString(16).padStart(6, '0')}`,
        fontFamily: FONT.body,
        fontStyle: 'bold',
      }).setOrigin(0.5);
    }
    this.viewRect(x + w / 2, y + rowH, w, 1, UI.border, 0.4);

    // body rows: one per size
    for (let r = 0; r < sizes.length; r++) {
      const size = sizes[r]!;
      const ry = y + rowH * (r + 1);
      if (r % 2 === 0) this.viewRect(x + w / 2, ry + rowH / 2, w, rowH, UI.panelMuted, 0.5);
      this.viewText(x + 6, ry + rowH / 2, `SIZE ${size}`, {
        fontSize: '10px',
        color: UI.text,
        fontFamily: FONT.body,
        fontStyle: 'bold',
      }).setOrigin(0, 0.5);
      for (let c = 0; c < tiers.length; c++) {
        this.viewText(x + labelW + c * colW + colW / 2, ry + rowH / 2, `${kit(size, tiers[c]!)}`, {
          fontSize: '12px',
          color: `#${TIER_COLOR.gold.toString(16).padStart(6, '0')}`,
          fontFamily: FONT.body,
          fontStyle: 'bold',
        }).setOrigin(0.5);
      }
    }

    const noteY = y + rowH * (sizes.length + 1) + 6;
    this.viewText(x, noteY, 'A card\'s effects + weight must total the cell for its size and tier. Bigger cards get more because they cost extra board slots and busy the caster for extra turns (spell span).', {
      fontSize: '10px',
      color: UI.textDim,
      fontFamily: FONT.body,
      wordWrap: { width: w },
    });
  }

  private renderWikiEmptyState(): void {
    this.viewText(WIKI_LIBRARY.x + WIKI_LIBRARY.w / 2, WIKI_LIBRARY.y + 410, 'No cards match these filters.', {
      fontSize: '18px',
      color: UI.text,
      fontFamily: FONT.display,
      fontStyle: 'bold',
    }).setOrigin(0.5);
    this.viewText(WIKI_LIBRARY.x + WIKI_LIBRARY.w / 2, WIKI_LIBRARY.y + 442, 'Open FILTER and clear one or more choices.', {
      fontSize: '11px',
      color: UI.textDim,
      fontFamily: FONT.body,
    }).setOrigin(0.5);
  }

  /**
   * LIST mode: plain stats table for balance work — name, type, archetypes,
   * size, weight, PL, and the authored description. Same filters/sort/tier
   * preview as the visual grid; tap a row to open its card sheet.
   */
  private renderWikiListTable(pageSkills: SkillDef[]): void {
    const x0 = WIKI_LIBRARY.x + 14;
    const tableW = WIKI_LIBRARY.w - 28;
    const headerY = panelToolbarRowY(WIKI_LIBRARY, 1) + 24;
    // column x-offsets within the table. Stat columns show the value from the
    // card's `effects` data (the authority) with each column's PL contribution
    // (audited PRICE math) in gold beneath; FX = special effects PL, PKG =
    // weight/size/cooldown packaging PL. Contributions sum to the tier budget.
    const COL = { name: 0, type: 102, arch: 154, size: 210, wt: 244, dmg: 280, def: 316, mdf: 352, heal: 388, fx: 424, tot: 456, text: 500 } as const;
    const LABELS: Array<[keyof typeof COL, string]> = [
      ['name', 'NAME'], ['type', 'TYPE'], ['arch', 'ARCH'], ['size', 'SZ'], ['wt', 'WT'],
      ['dmg', 'DMG'], ['def', 'DEF'], ['mdf', 'MDF'], ['heal', 'HEAL'], ['fx', 'FX'], ['tot', 'TOTAL'], ['text', 'FX BREAKDOWN'],
    ];
    const header = this.viewRect(x0 + tableW / 2, headerY + 11, tableW, 22, UI.chipDark);
    header.setStrokeStyle(0);
    for (const [key, label] of LABELS) {
      this.viewText(x0 + 8 + COL[key], headerY + 11, label, {
        fontSize: '9px',
        color: '#ffffff',
        fontFamily: FONT.body,
        fontStyle: 'bold',
      }).setOrigin(0, 0.5);
    }

    const rowH = 46;
    // One short line, clamped inside the panel — keyword mechanics live on the RULES tabs.
    const legendY = Math.min(headerY + 24 + pageSkills.length * rowH + 8, WIKI_LIBRARY.y + WIKI_LIBRARY.h - 22);
    this.viewText(x0, legendY, 'Gold = each column\'s PL (sums to the tier budget) · WT = weight/cooldown · FX = special effects, itemized right', {
      fontSize: '9px',
      color: UI.textDim,
      fontFamily: FONT.body,
      wordWrap: { width: tableW },
      maxLines: 1,
    });
    for (let index = 0; index < pageSkills.length; index++) {
      const baseSkill = pageSkills[index]!;
      const skill = applyTier(baseSkill, this.wikiTier);
      const y = headerY + 24 + index * rowH;
      const row = this.viewRect(x0 + tableW / 2, y + rowH / 2, tableW, rowH - 2, index % 2 === 0 ? UI.panelMuted : UI.panel, 0.9);
      row.setStrokeStyle(1, UI.border, 0.25).setInteractive({ useHandCursor: true });
      row.on('pointerdown', () => this.openWikiSkillSheet(baseSkill));

      const cell = (key: keyof typeof COL, value: string, opts: { color?: string; bold?: boolean; wrap?: number } = {}): void => {
        this.viewText(x0 + 8 + COL[key], y + (opts.wrap ? 6 : rowH / 2), value, {
          fontSize: '9px',
          color: opts.color ?? UI.text,
          fontFamily: FONT.body,
          fontStyle: opts.bold ? 'bold' : 'normal',
          ...(opts.wrap ? { wordWrap: { width: opts.wrap }, maxLines: 3 } : {}),
        }).setOrigin(0, opts.wrap ? 0 : 0.5);
      };

      const type = skill.element ?? skill.weapon ?? '—';
      const typeColor = skill.element
        ? `#${(ELEMENT_COLOR[skill.element] ?? UI.chip).toString(16).padStart(6, '0')}`
        : skill.weapon
          ? `#${(WEAPON_COLOR[skill.weapon] ?? UI.chip).toString(16).padStart(6, '0')}`
          : UI.textDim;

      // authoritative base magnitudes + per-bucket PL (deci) from effects data
      let dmg = 0;
      let defShield = 0;
      let mdfShield = 0;
      let heal = 0;
      let dmgDeci = 0;
      let defDeci = 0;
      let mdfDeci = 0;
      let healDeci = 0;
      let fxDeci = 0;
      for (const action of skill.effects) {
        const deci = actionsPriceDeci([action], skill.property);
        if (action.kind === 'damage') { dmg += action.power; dmgDeci += deci; }
        else if (action.kind === 'heal') { heal += action.power; healDeci += deci; }
        else if (action.kind === 'shield') {
          // TRUE shields block all damage types: value shown in both columns,
          // PL counted once under DEF so contributions still sum exactly.
          if (skill.property === 'physical') { defShield += action.power; defDeci += deci; }
          else if (skill.property === 'magical') { mdfShield += action.power; mdfDeci += deci; }
          else { defShield += action.power; mdfShield += action.power; defDeci += deci; }
        } else {
          fxDeci += deci;
        }
      }
      // aura + TRUE premium land in FX; weight/cooldown PL under WT, size PL under SZ
      let wtDeci = 0;
      let szDeci = 0;
      for (const part of powerLevelBreakdown(skill)) {
        if (part.label === 'aura' || part.label === 'TRUE') fxDeci += part.deci;
        else if (part.label === 'weight' || part.label === 'cooldown') wtDeci += part.deci;
        else if (part.label === 'size') szDeci += part.deci;
      }
      const num = (value: number): string => (value > 0 ? String(value) : '·');
      const pl = (deci: number): string => (deci === 0 ? '·' : `${deci < 0 ? '−' : '+'}${Math.abs(deci) / 10}`);
      const gold = `#${TIER_COLOR.gold.toString(16).padStart(6, '0')}`;
      const statCell = (key: keyof typeof COL, value: string, deci: number): void => {
        if (value === '') {
          // PL-only column (FX / PKG): single centered line
          this.viewText(x0 + 8 + COL[key], y + rowH / 2, pl(deci), {
            fontSize: '8px',
            color: gold,
            fontFamily: FONT.body,
            fontStyle: 'bold',
          }).setOrigin(0, 0.5);
          return;
        }
        this.viewText(x0 + 8 + COL[key], y + 13, value, {
          fontSize: '9px',
          color: UI.text,
          fontFamily: FONT.body,
          fontStyle: value !== '·' ? 'bold' : 'normal',
        }).setOrigin(0, 0.5);
        this.viewText(x0 + 8 + COL[key], y + 31, pl(deci), {
          fontSize: '8px',
          color: gold,
          fontFamily: FONT.body,
          fontStyle: 'bold',
        }).setOrigin(0, 0.5);
      };

      cell('name', skill.name, { bold: true, wrap: 94 });
      cell('type', type, { color: typeColor, bold: true });
      cell('arch', skill.archetypes.map((a) => a.slice(0, 3).toUpperCase()).join('/'), { color: UI.textDim });
      cell('size', String(skill.size));
      statCell('wt', String(weightOf(skill)), wtDeci);
      statCell('dmg', num(dmg), dmgDeci);
      statCell('def', num(defShield), defDeci);
      statCell('mdf', num(mdfShield), mdfDeci);
      statCell('heal', num(heal), healDeci);
      statCell('fx', '', fxDeci);
      // KIT totals: what the card's effects + weight actually sum to, vs what
      // its size × tier allows (no separate "grant" bookkeeping on screen).
      const grantDeci = sizeGrantDeci(skill.size, this.wikiTier);
      const totalDeci = powerLevelDeci(skill) + grantDeci;
      const budgetDeci = TIER_BUDGET_DECI[this.wikiTier] + grantDeci;
      const onBudget = Math.abs(totalDeci - budgetDeci) <= BUDGET_TOLERANCE_DECI;
      const totColor = onBudget
        ? `#${UI.good.toString(16).padStart(6, '0')}`
        : totalDeci > budgetDeci
          ? `#${UI.bad.toString(16).padStart(6, '0')}`
          : `#${UI.shield.toString(16).padStart(6, '0')}`;
      this.viewText(x0 + 8 + COL.tot, y + 13, `${totalDeci / 10}`, {
        fontSize: '10px',
        color: totColor,
        fontFamily: FONT.body,
        fontStyle: 'bold',
      }).setOrigin(0, 0.5);
      this.viewText(x0 + 8 + COL.tot, y + 31, `/${budgetDeci / 10}`, {
        fontSize: '8px',
        color: UI.textDim,
        fontFamily: FONT.body,
      }).setOrigin(0, 0.5);
      const descW = tableW - COL.text - 16;
      // FX itemization: each special effect with its magnitude·duration terms
      // and the priced result, so the gold FX number is auditable at a glance.
      const fxParts: string[] = [];
      for (const action of skill.effects) {
        if (action.kind === 'damage' || action.kind === 'heal' || action.kind === 'shield') continue;
        const deci = actionsPriceDeci([action], skill.property);
        const terms =
          action.kind === 'poison' || action.kind === 'burn' || action.kind === 'bleed' ? `${action.stacks}s (${(action.stacks * (action.stacks + 1)) / 2} total)`
          : action.kind === 'stun' ? `${action.turns}t`
          : action.kind === 'buffStat' || action.kind === 'debuffStat' ? `${action.pct}%×${action.turns}t`
          : action.kind === 'guard' ? `${action.pct}%×${action.turns}t`
          : action.kind === 'negate' ? `×${action.charges}`
          : action.kind === 'slow' ? `+${action.weight}w`
          : action.kind === 'disrupt' ? `${action.amount}`
          : action.kind === 'lifesteal' ? `${action.pct}%`
          : action.kind === 'shieldBreak' ? `${action.amount}`
          : action.kind === 'comboBonus' ? `+${action.amount}`
          : '';
        fxParts.push(`${action.kind}${terms ? ` ${terms}` : ''} → +${deci / 10}`);
      }
      for (const part of powerLevelBreakdown(skill)) {
        if (part.label === 'TRUE') fxParts.push(`TRUE → +${part.deci / 10}`);
        else if (part.label === 'aura' && skill.aura) {
          const mods = skill.aura.mods;
          const modBits = [
            mods.damageFlat ? `dmg+${mods.damageFlat}` : '',
            mods.healFlat ? `heal+${mods.healFlat}` : '',
            mods.weightDelta ? `wt${mods.weightDelta}` : '',
          ].filter(Boolean).join(' ');
          const reach = skill.aura.affects === 'allBoard' ? 'all-board(9)' : 'adjacent(2)';
          fxParts.push(`aura ${reach} ${modBits} → +${part.deci / 10}`);
        }
      }
      // EFFECTS column: only the itemized special-effects breakdown that
      // explains the FX gold number. Card text lives in the CARDS view;
      // keyword mechanics live on the RULES tabs.
      if (fxParts.length > 0) {
        this.viewText(x0 + 8 + COL.text, y + 6, fxParts.join(' · '), {
          fontSize: '9px',
          color: gold,
          fontFamily: FONT.body,
          fontStyle: 'bold',
          wordWrap: { width: descW },
          maxLines: 4,
        }).setOrigin(0, 0);
      } else {
        this.viewText(x0 + 8 + COL.text, y + rowH / 2, '·', {
          fontSize: '9px',
          color: UI.textDim,
          fontFamily: FONT.body,
        }).setOrigin(0, 0.5);
      }
    }
  }

  private filteredWikiSkills(catalog: SkillDef[]): SkillDef[] {
    const filtered = catalog.filter((skill) => {
      if (this.wikiFilters.role !== 'all' && !this.matchesWikiRole(skill, this.wikiFilters.role)) return false;
      if (this.wikiFilters.property !== 'all' && skill.property !== this.wikiFilters.property) return false;
      if (this.wikiFilters.weapon !== 'all' && skill.weapon !== this.wikiFilters.weapon) return false;
      if (this.wikiFilters.element !== 'all' && skill.element !== this.wikiFilters.element) return false;
      const weight = weightOf(skill);
      if (this.wikiFilters.weight === 'light' && weight >= 10) return false;
      if (this.wikiFilters.weight === 'medium' && (weight < 10 || weight >= 20)) return false;
      if (this.wikiFilters.weight === 'heavy' && weight < 20) return false;
      if (this.wikiFilters.size === 'one' && skill.size !== 1) return false;
      if (this.wikiFilters.size === 'two' && skill.size !== 2) return false;
      if (this.wikiFilters.size === 'threePlus' && skill.size < 3) return false;
      return true;
    });

    return filtered.sort((a, b) => {
      if (this.wikiFilters.sort === 'weight') return weightOf(a) - weightOf(b) || a.name.localeCompare(b.name);
      if (this.wikiFilters.sort === 'pl') {
        return powerLevel(applyTier(b, this.wikiTier)) - powerLevel(applyTier(a, this.wikiTier)) || a.name.localeCompare(b.name);
      }
      return a.name.localeCompare(b.name);
    });
  }

  private matchesWikiRole(skill: SkillDef, role: Exclude<WikiRoleFilter, 'all'>): boolean {
    const kinds = new Set(skill.effects.map((effect) => effect.kind));
    switch (role) {
      case 'attack':
        return skill.archetypes.includes('offense') || kinds.has('damage');
      case 'defense':
        return skill.archetypes.includes('defensive') || kinds.has('shield') || kinds.has('guard') || kinds.has('negate');
      case 'heal':
        return skill.archetypes.includes('healing') || kinds.has('heal') || kinds.has('lifesteal');
      case 'buff':
        return kinds.has('buffStat') || Boolean(skill.aura);
      case 'debuff':
        return skill.archetypes.includes('debuff')
          || kinds.has('poison')
          || kinds.has('burn')
          || kinds.has('stun')
          || kinds.has('debuffStat')
          || kinds.has('slow')
          || kinds.has('disrupt')
          || kinds.has('shieldBreak');
      case 'support':
        return skill.archetypes.includes('support');
    }
  }

  private activeWikiFilterCount(): number {
    return Number(this.wikiFilters.role !== 'all')
      + Number(this.wikiFilters.property !== 'all')
      + Number(this.wikiFilters.weapon !== 'all')
      + Number(this.wikiFilters.element !== 'all')
      + Number(this.wikiFilters.weight !== 'all')
      + Number(this.wikiFilters.size !== 'all')
      + Number(this.wikiFilters.sort !== 'name');
  }

  private openWikiFilters(): void {
    this.wikiFilterDraft = { ...this.wikiFilters };
    this.renderWikiFilterSheet();
  }

  private renderWikiFilterSheet(): void {
    const draft = this.wikiFilterDraft;
    if (!draft) return;
    this.closeModal();
    this.wikiFilterDraft = draft;

    const cancel = (): void => {
      this.wikiFilterDraft = null;
      this.closeModal();
    };
    // Sheet geometry derives from the row list: header band, one 48px-pitch
    // row per category, then the footer rule + buttons.
    const sheetX = 54;
    const sheetW = 612;
    const rowPitch = 48;
    const rowCount = 7;
    const firstRowOffset = 92;
    const footerH = 122;
    const sheetH = firstRowOffset + rowPitch * (rowCount - 1) + footerH;
    const sheetY = 740 - sheetH;
    const rowY = (index: number): number => sheetY + firstRowOffset + rowPitch * index;

    const overlay = this.add.rectangle(0, 0, SCREEN.width, SCREEN.height, 0x0f1822, 0.34).setOrigin(0, 0).setDepth(60).setInteractive();
    overlay.on('pointerdown', cancel);
    const shadow = this.add.rectangle(sheetX + 6, sheetY + 8, sheetW, sheetH, UI.shadow, 0.2).setOrigin(0, 0).setDepth(61);
    const panel = this.add.rectangle(sheetX, sheetY, sheetW, sheetH, UI.panel).setOrigin(0, 0).setStrokeStyle(1, UI.border, 0.82).setDepth(62);
    const header = this.add.rectangle(sheetX, sheetY, sheetW, 62, UI.chipDark).setOrigin(0, 0).setDepth(63);
    const spine = this.add.rectangle(sheetX, sheetY, 5, sheetH, UI.chip).setOrigin(0, 0).setDepth(64);
    const title = this.add.text(sheetX + 22, sheetY + 12, 'FILTER CARDS', {
      fontSize: '17px',
      color: '#ffffff',
      fontFamily: FONT.display,
      fontStyle: 'bold',
    }).setDepth(64);
    const subtitle = this.add.text(sheetX + 22, sheetY + 38, 'MATCHES ALL SELECTED CATEGORIES', {
      fontSize: '9px',
      color: '#ded3ba',
      fontFamily: FONT.body,
      fontStyle: 'bold',
    }).setDepth(64);
    const close = this.add.rectangle(sheetX + sheetW - 30, sheetY + 31, 28, 28, UI.panelMuted).setStrokeStyle(1, UI.border, 0.58).setDepth(64).setInteractive({ useHandCursor: true });
    const closeText = this.add.text(sheetX + sheetW - 30, sheetY + 31, '×', {
      fontSize: '14px',
      color: UI.text,
      fontFamily: FONT.body,
      fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(65);
    auditControlLabel(close, closeText, { name: 'Filter close', horizontalPadding: 6, verticalPadding: 4 });
    close.on('pointerdown', cancel);
    this.modalObjects.push(overlay, shadow, panel, header, spine, title, subtitle, close, closeText);

    this.renderWikiFilterChoices('ROLE', rowY(0), [
      ['all', 'ALL'], ['attack', 'ATTACK'], ['defense', 'DEFENSE'], ['heal', 'HEAL'], ['buff', 'BUFF'], ['debuff', 'DEBUFF'], ['support', 'SUPPORT'],
    ], draft.role, (value) => { draft.role = value as WikiRoleFilter; });
    this.renderWikiFilterChoices('PROPERTY', rowY(1), [
      ['all', 'ALL'], ['physical', 'PHYSICAL'], ['magical', 'MAGICAL'], ['true', 'TRUE'],
    ], draft.property, (value) => { draft.property = value as WikiPropertyFilter; });
    this.renderWikiFilterChoices('WEAPON', rowY(2), [
      ['all', 'ALL'], ['sword', 'SWORD'], ['axe', 'AXE'], ['lance', 'LANCE'], ['bow', 'BOW'], ['beast', 'BEAST'],
    ], draft.weapon, (value) => { draft.weapon = value as WikiWeaponFilter; });
    this.renderWikiFilterChoices('ELEMENT', rowY(3), [
      ['all', 'ALL'], ['fire', 'FIRE'], ['frost', 'FROST'], ['lightning', 'LIGHTNING'], ['nature', 'NATURE'], ['holy', 'HOLY'], ['dark', 'DARK'],
    ], draft.element, (value) => { draft.element = value as WikiElementFilter; });
    this.renderWikiFilterChoices('WEIGHT', rowY(4), [
      ['all', 'ALL'], ['light', 'LIGHT 0-9'], ['medium', 'MEDIUM 10-19'], ['heavy', 'HEAVY 20+'],
    ], draft.weight, (value) => { draft.weight = value as WikiWeightFilter; });
    this.renderWikiFilterChoices('CARD SIZE', rowY(5), [
      ['all', 'ALL'], ['one', '1 SLOT'], ['two', '2 SLOTS'], ['threePlus', '3+ SLOTS'],
    ], draft.size, (value) => { draft.size = value as WikiSizeFilter; });
    this.renderWikiFilterChoices('SORT', rowY(6), [
      ['name', 'NAME'], ['weight', 'WEIGHT'], ['pl', 'PL HIGH'],
    ], draft.sort, (value) => { draft.sort = value as WikiSort; });

    const footerRule = this.add.rectangle(sheetX + 22, rowY(rowCount - 1) + 42, sheetW - 42, 1, UI.border, 0.22).setOrigin(0, 0).setDepth(63);
    this.modalObjects.push(footerRule);
    const buttonY = rowY(rowCount - 1) + 60;
    const clear = this.makeModalButton(sheetX + 22, buttonY, 152, 44, 'CLEAR', UI.panelMuted, UI.text, () => {
      this.wikiFilterDraft = { ...DEFAULT_WIKI_FILTERS };
      this.renderWikiFilterSheet();
    });
    const apply = this.makeModalButton(sheetX + sheetW - 22 - 252, buttonY, 252, 44, 'APPLY FILTERS', UI.chipDark, '#ffffff', () => {
      if (!this.wikiFilterDraft) return;
      this.wikiFilters = { ...this.wikiFilterDraft };
      this.wikiFilterDraft = null;
      this.wikiPage = 0;
      this.closeModal();
      this.scene.restart();
    });
    clear.rect.setDepth(64); clear.text.setDepth(65);
    apply.rect.setDepth(64); apply.text.setDepth(65);
    this.modalObjects.push(clear.rect, clear.text, apply.rect, apply.text);
  }

  private renderWikiFilterChoices(
    label: string,
    y: number,
    choices: Array<[string, string]>,
    selected: string,
    onSelect: (value: string) => void,
  ): void {
    const heading = this.add.text(76, y, label, {
      fontSize: '10px',
      color: UI.textDim,
      fontFamily: FONT.body,
      fontStyle: 'bold',
    }).setOrigin(0, 0.5).setDepth(63);
    this.modalObjects.push(heading);
    let x = 150;
    for (const [value, text] of choices) {
      const active = value === selected;
      const w = Math.max(46, 16 + text.length * 6.4);
      const rect = this.add.rectangle(x, y - 14, w, 28, active ? UI.chip : UI.panelMuted)
        .setOrigin(0, 0)
        .setStrokeStyle(1, active ? UI.chipDark : UI.border, active ? 0.9 : 0.4)
        .setDepth(63)
        .setInteractive({ useHandCursor: true });
      const textObject = this.add.text(x + w / 2, y, text, {
        fontSize: '9px',
        color: active ? '#1a1208' : UI.text,
        fontFamily: FONT.body,
        fontStyle: 'bold',
      }).setOrigin(0.5).setDepth(64);
      auditControlLabel(rect, textObject, { name: `${label}: ${text}`, horizontalPadding: 8, verticalPadding: 5 });
      rect.on('pointerdown', () => {
        onSelect(value);
        this.renderWikiFilterSheet();
      });
      this.modalObjects.push(rect, textObject);
      x += w + 5;
    }
  }

  private renderWikiCardGridItem(cx: number, cy: number, w: number, h: number, baseSkill: SkillDef): void {
    const skill = applyTier(baseSkill, this.wikiTier);
    const bagCopies = demoState.bagSlots.filter((card) => card?.skillId === baseSkill.id).length;
    const deckCopies = demoState.pieces.filter((piece) => piece.skillId === baseSkill.id).length;

    const card = new FantasyCardTemplateV2(this, cx, cy, skill, {
      width: w,
      height: h,
      tier: this.wikiTier,
      glossary: false,
    });
    // The template container already has setSize(w, h); the default hit area
    // accounts for the container's center origin (an explicit rect at
    // -w/2,-h/2 ends up shifted by displayOrigin and misses the card).
    card.setInteractive({ useHandCursor: true });
    card.on('pointerdown', () => this.openWikiSkillSheet(baseSkill));
    this.viewObjects.push(card);

    if (bagCopies + deckCopies > 0) {
      const owned = this.viewText(cx + w / 2 - 6, cy - h / 2 + 6, `×${bagCopies + deckCopies}`, {
        fontSize: '9px',
        color: '#ffffff',
        fontFamily: FONT.body,
        fontStyle: 'bold',
        backgroundColor: '#1e2733',
        padding: { x: 4, y: 2 },
      }).setOrigin(1, 0);
      owned.setAlpha(0.92);
    }
  }

  private openWikiSkillSheet(baseSkill: SkillDef): void {
    this.closeModal();
    const skill = applyTier(baseSkill, this.wikiTier);
    const overlay = this.add.rectangle(0, 0, SCREEN.width, SCREEN.height, 0x090b12, 0.8)
      .setOrigin(0, 0)
      .setDepth(60)
      .setInteractive();
    const card = new FantasyCardTemplateV2(this, SCREEN.width / 2, 598, skill, {
      width: 420,
      height: 690,
      tier: this.wikiTier,
    });
    card.setDepth(61);
    const close = this.add.rectangle(656, 76, 30, 30, UI.panelMuted)
      .setStrokeStyle(1, UI.border, 0.7)
      .setDepth(62)
      .setInteractive({ useHandCursor: true });
    const closeText = this.add.text(656, 76, '×', {
      fontSize: '16px',
      color: UI.text,
      fontFamily: FONT.body,
      fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(63);
    auditControlLabel(close, closeText, { name: 'Wiki card sheet close', horizontalPadding: 6, verticalPadding: 4 });
    const dismiss = (): void => this.closeModal();
    overlay.on('pointerdown', dismiss);
    close.on('pointerdown', dismiss);

    // The catalog grid no longer carries a per-tile + BAG button — the sheet
    // owns the add action now.
    const bagCopies = demoState.bagSlots.filter((c) => c?.skillId === baseSkill.id).length;
    const deckCopies = demoState.pieces.filter((piece) => piece.skillId === baseSkill.id).length;
    const bagUsed = this.bagSlotsUsed();
    const addEnabled = this.findBagFit(this.bagCardSize(baseSkill.id)) >= 0;
    const counts = this.add.text(SCREEN.width / 2, 1158, `BAG ${bagCopies} · DECK ${deckCopies} · bag space ${bagUsed}/${demoState.bagSlots.length}`, {
      fontSize: '11px',
      color: '#d8d2c4',
      fontFamily: FONT.body,
      fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(62);
    const addBtn = this.add.rectangle(SCREEN.width / 2, 1204, 200, 44, addEnabled ? UI.chip : UI.slot)
      .setStrokeStyle(1, UI.border, 0.8)
      .setDepth(62);
    const addText = this.add.text(SCREEN.width / 2, 1204, addEnabled ? '+ ADD TO BAG' : 'BAG FULL', {
      fontSize: '12px',
      color: addEnabled ? '#ffffff' : UI.textSoft,
      fontFamily: FONT.body,
      fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(63);
    auditControlLabel(addBtn, addText, { name: 'Wiki sheet add to bag', horizontalPadding: 10, verticalPadding: 6 });
    if (addEnabled) {
      addBtn.setInteractive({ useHandCursor: true });
      addBtn.on('pointerdown', () => this.addWikiCard(baseSkill.id));
    }
    this.modalObjects.push(overlay, card, close, closeText, counts, addBtn, addText);
  }

  private addWikiCard(skillId: string): void {
    const slot = this.findBagFit(this.bagCardSize(skillId));
    if (slot < 0) return;
    const card = createOwnedCard(skillId, this.wikiTier);
    demoState.bagSlots[slot] = card;
    this.selectedInspect = {
      kind: 'skill',
      skillId,
      tier: this.wikiTier,
      contextLabel: `Added to bag · ${card.instanceId}`,
    };
    this.scene.restart();
  }

  private renderLoadoutSummary(): void {
    const heroSetup = buildAutoHeroSetup(demoState.heroLevel, demoState.pieces, demoState.heroAllocation).setup;
    const stats = heroSetup.stats;
    const deckSig = demoState.pieces
      .map((p) => `${p.skillId}@${p.slot}${p.gem ? `#${p.gem.id}` : ''}`)
      .sort()
      .join(',');
    const heroBandKey = `h:${demoState.heroLevel}:${deckSig}`;
    const heroBand = this.dptBand(heroBandKey, heroSetup);
    const totalPl = demoState.pieces.reduce((sum, piece) => {
      const baseSkill = skillBook[piece.skillId];
      const skill = baseSkill ? applyTier(baseSkill, piece.tier) : undefined;
      return skill ? sum + instancePowerLevelDeci(skill, piece) : sum;
    }, 0);
    const orderedDeck = demoState.pieces
      .slice()
      .sort((a, b) => a.slot - b.slot)
      .map((piece) => {
        const name = skillBook[piece.skillId]?.name ?? piece.skillId;
        const tierTag = piece.tier !== 'bronze' ? ` [${piece.tier[0]!.toUpperCase()}]` : '';
        return `S${piece.slot + 1} ${name}${tierTag}`;
      });
    const deckRows = orderedDeck.length > 3
      ? [orderedDeck.slice(0, 3).join(' · '), orderedDeck.slice(3).join(' · ')]
      : [orderedDeck.join(' · ')];
    this.detailPanel.setSummary(
      'CURRENT DECK',
      `${demoState.pieces.length} cards ready`,
      `LV ${demoState.heroLevel} · PL ${formatPowerDeci(totalPl)}`,
      `HP ${stats.maxHp} · ATK ${stats.attack} · MAG ${stats.magicPower} · SPD ${stats.speed} · DMG/turn ${PrepScene.formatBand(heroBand, this.dptFailed.has(heroBandKey))}`,
      deckRows.length > 0 && deckRows[0]
        ? deckRows.join('\n')
        : 'No cards equipped yet.',
      { accentColor: UI.good },
    );
  }

  private renderEnemyScout(bounds: { x: number; y: number; w: number; h: number }, _showGemHint: boolean): void {
    const enemy = enemies[demoState.enemyId]!;

    this.renderEnemyTeamControls(bounds);

    this.viewSmallButton(bounds.x + 18, bounds.y + 60, 32, 24, '‹', demoState.enemyTeam.length > 1, () => this.cycleConfiguredEnemy(-1));
    this.viewSmallButton(bounds.x + bounds.w - 50, bounds.y + 60, 32, 24, '›', demoState.enemyTeam.length > 1, () => this.cycleConfiguredEnemy(1));
    this.viewText(bounds.x + 58, bounds.y + 58, enemy.name.toUpperCase(), {
      fontSize: TYPE_SCALE.heading,
      color: UI.text,
      fontFamily: FONT.display,
      fontStyle: 'bold',
      wordWrap: { width: bounds.w - 116 },
    });

    // Preview the fight the player will actually get (level + title + rank +
    // extra cards resolved). Stats reflect the effective level; the resolved
    // deck (with per-card tiers) reflects rank + title's extra cards.
    const encounter = buildEnemyEncounter(demoState.enemyId, demoState.enemyLevel, demoState.enemyTitle, demoState.enemyRank);
    const stats = encounter.setup.stats;
    const deck = encounter.setup.pieces;
    const totalPl = deck.reduce((sum, piece) => {
      const skill = skillBook[piece.skillId];
      return skill ? sum + instancePowerLevelDeci(piece.tier ? applyTier(skill, piece.tier) : skill, piece) : sum;
    }, 0);
    this.viewText(bounds.x + 18, bounds.y + 84, `HP ${stats.maxHp} · SPD ${stats.speed} · ATK ${stats.attack} · MPW ${stats.magicPower}`, {
      fontSize: '11px',
      color: UI.text,
      fontFamily: FONT.body,
    });
    this.viewText(bounds.x + 18, bounds.y + 102, `ARM ${stats.armor} · RES ${stats.magicResist} · ${deck.length} cards · PL ${formatPowerDeci(totalPl)}`, {
      fontSize: '11px',
      color: UI.textDim,
      fontFamily: FONT.body,
    });

    // Real simulated damage-per-turn band (10-turn output vs an inert dummy) —
    // the balancing readout; emphasized on the right of the stat block.
    const enemyBandKey = `e:${demoState.enemyId}:${demoState.enemyLevel}:${demoState.enemyTitle}:${demoState.enemyRank}`;
    const enemyBand = this.dptBand(enemyBandKey, encounter.setup);
    this.viewText(bounds.x + bounds.w - 18, bounds.y + 102, `DMG/turn ${PrepScene.formatBand(enemyBand, this.dptFailed.has(enemyBandKey))}`, {
      fontSize: '12px',
      color: `#${UI.bad.toString(16).padStart(6, '0')}`,
      fontFamily: FONT.body,
      fontStyle: 'bold',
    }).setOrigin(1, 0);

    const weakness = formatWeaknessLine();
    if (weakness) {
      this.viewText(bounds.x + bounds.w - 18, bounds.y + 84, weakness, {
        fontSize: '11px',
        color: '#84531d',
        fontFamily: FONT.body,
        fontStyle: 'bold',
        align: 'right',
        wordWrap: { width: 220 },
      }).setOrigin(1, 0);
    }

    this.renderScoutControls(bounds, maxRankFor(deck.length));

    this.renderReadOnlyCardRail(
      'ENEMY SKILLS',
      deck,
      bounds.y + PREP_FIGHT_LAYOUT.enemySkillRailOffsetY,
      UI.enemyCard,
      'Enemy skill card',
    );
  }

  private renderReadOnlyCardRail(
    label: string,
    pieces: ReadonlyArray<{ skillId: string; slot: number; tier?: SkillTier; instanceId?: string }>,
    y: number,
    fill: number,
    contextLabel: string,
  ): void {
    this.viewText(PREP_FIGHT.x + 18, y - PREP_FIGHT_LAYOUT.railLabelGap, label, {
      fontSize: '10px',
      color: UI.textDim,
      fontFamily: FONT.body,
      fontStyle: 'bold',
      letterSpacing: 1,
    }).setOrigin(0, 0.5);

    for (const piece of pieces.slice().sort((a, b) => a.slot - b.slot)) {
      const baseSkill = skillBook[piece.skillId];
      if (!baseSkill) continue;
      const skill = applyTier(baseSkill, piece.tier ?? baseSkill.tier);
      const x = BOARD_LEFT + piece.slot * SLOT_W + (skill.size * SLOT_W) / 2;
      const card = this.viewCard(x, y, skill, 1, fill);
      this.bindInspect(card, {
        kind: 'skill',
        skillId: piece.skillId,
        hostInstanceId: piece.instanceId,
        tier: piece.tier ?? baseSkill.tier,
        contextLabel: `${contextLabel} · ${piece.instanceId ?? piece.slot + 1}`,
      });
    }
  }

  /** Title chips + enemy level/rank steppers + the reserved modifier slot. */
  private renderScoutControls(bounds: { x: number; y: number; w: number; h: number }, maxRank: number): void {
    const rowY = bounds.y + 126;

    let chipX = bounds.x + 18;
    for (const title of ENEMY_TITLES) {
      const selected = demoState.enemyTitle === title;
      const w = 12 + TITLE_LABEL[title].length * 8;
      const chip = this.viewRect(chipX + w / 2, rowY + 12, w, 24, selected ? UI.chip : UI.panel);
      chip.setStrokeStyle(1, UI.border, 0.78);
      chip.setInteractive({ useHandCursor: true });
      chip.on('pointerdown', () => {
        // Selecting a title presets its rank (the knobs stay adjustable after).
        demoState.enemyTitle = title;
        demoState.enemyRank = TITLE_PRESETS[title].rank;
        this.saveEnemyEditor();
        this.renderActiveView();
        this.restoreSelection();
      });
      chip.on('pointerover', () => chip.setFillStyle(selected ? UI.chip : UI.slotHover));
      chip.on('pointerout', () => chip.setFillStyle(selected ? UI.chip : UI.panel));
      this.viewText(chipX + w / 2, rowY + 12, TITLE_LABEL[title], {
        fontSize: '10px',
        color: selected ? '#1a1208' : UI.text,
        fontFamily: FONT.body,
        fontStyle: 'bold',
      }).setOrigin(0.5);
      chipX += w + 6;
    }

    // Segmented stepper controls keep the label, value, and actions on a single surface.
    const lvX = chipX + 10;
    drawStepperControl(this, lvX, rowY + 1, {
      label: 'LV',
      value: String(demoState.enemyLevel),
      width: 130,
      canDec: demoState.enemyLevel > 1,
      canInc: demoState.enemyLevel < MAX_LEVEL,
      onDec: () => this.stepEnemyLevel(-1),
      onInc: () => this.stepEnemyLevel(1),
      track: this.viewObjects,
    });
    const rankX = lvX + 140;
    drawStepperControl(this, rankX, rowY + 1, {
      label: 'RANK',
      value: String(demoState.enemyRank),
      width: 148,
      canDec: demoState.enemyRank > 0,
      canInc: demoState.enemyRank < maxRank,
      onDec: () => this.stepEnemyRank(-1, maxRank),
      onInc: () => this.stepEnemyRank(1, maxRank),
      track: this.viewObjects,
    });

    // Reserved modifier slot — rogue-like affixes land here later.
    const modW = 110;
    const modChip = this.viewRect(bounds.x + bounds.w - 18 - modW / 2, rowY + 12, modW, 24, UI.slot, 0.7);
    modChip.setStrokeStyle(1, UI.border, 0.4);
    this.viewText(bounds.x + bounds.w - 18 - modW / 2, rowY + 12, 'MODS · soon', {
      fontSize: '10px',
      color: UI.textSoft,
      fontFamily: FONT.body,
      fontStyle: 'bold',
    }).setOrigin(0.5);
  }

  private stepEnemyLevel(delta: number): void {
    demoState.enemyLevel = Phaser.Math.Clamp(demoState.enemyLevel + delta, 1, MAX_LEVEL);
    this.saveEnemyEditor();
    this.renderActiveView();
    this.restoreSelection();
  }

  private stepEnemyRank(delta: number, maxRank: number): void {
    demoState.enemyRank = Phaser.Math.Clamp(demoState.enemyRank + delta, 0, maxRank);
    this.saveEnemyEditor();
    this.renderActiveView();
    this.restoreSelection();
  }

  private stepHeroLevel(delta: number): void {
    demoState.heroLevel = Phaser.Math.Clamp(demoState.heroLevel + delta, 1, MAX_LEVEL);
    this.renderActiveView();
    this.restoreSelection();
  }

  /** Hero-level stepper + a preview of the stats that level scales the hero to. */
  private renderHeroLevelControl(bounds: { x: number; y: number; w: number; h: number }): void {
    const rowY = panelToolbarRowY(bounds) - 12;
    this.viewText(bounds.x + 18, rowY + 12, 'YOUR HERO', {
      fontSize: '11px',
      color: UI.textDim,
      fontFamily: FONT.body,
      fontStyle: 'bold',
    }).setOrigin(0, 0.5);

    const stepX = bounds.x + 128;
    const levelGroup = this.viewRect(stepX + 58, rowY + 12, 116, 28, UI.panel, 0.74);
    levelGroup.setStrokeStyle(1, UI.border, 0.58);
    this.viewText(stepX + 10, rowY + 12, 'LV', {
      fontSize: '10px',
      color: UI.textDim,
      fontFamily: FONT.body,
      fontStyle: 'bold',
    }).setOrigin(0, 0.5);
    this.viewSmallButton(stepX + 32, rowY + 2, 22, 22, '−', demoState.heroLevel > 1, () => this.stepHeroLevel(-1));
    this.viewText(stepX + 68, rowY + 12, String(demoState.heroLevel), {
      fontSize: '13px',
      color: UI.text,
      fontFamily: FONT.body,
      fontStyle: 'bold',
    }).setOrigin(0.5);
    this.viewSmallButton(stepX + 82, rowY + 2, 22, 22, '+', demoState.heroLevel < MAX_LEVEL, () => this.stepHeroLevel(1));

    // Preview the stats this level + the player's banked PL-budget spend
    // (demoState.heroAllocation) produces, plus the deck's real simulated
    // damage-per-turn band (10-turn output vs a dummy).
    const heroSetup = buildAutoHeroSetup(demoState.heroLevel, demoState.pieces, demoState.heroAllocation).setup;
    const stats = heroSetup.stats;
    const deckSig = demoState.pieces
      .map((p) => `${p.skillId}@${p.slot}${p.gem ? `#${p.gem.id}` : ''}`)
      .sort()
      .join(',');
    const heroBandKey = `h:${demoState.heroLevel}:${deckSig}`;
    const heroBand = this.dptBand(heroBandKey, heroSetup);
    this.viewText(stepX + 132, rowY + 12, `HP ${stats.maxHp} · ATK ${stats.attack} · MAG ${stats.magicPower} · SPD ${stats.speed} · DMG/turn ${PrepScene.formatBand(heroBand, this.dptFailed.has(heroBandKey))}`, {
      fontSize: '10px',
      color: UI.text,
      fontFamily: FONT.body,
    }).setOrigin(0, 0.5);
  }

  private cycleConfiguredEnemy(delta: number): void {
    if (demoState.enemyTeam.length < 2) return;
    this.saveEnemyEditor();
    const nextSlot = Phaser.Math.Wrap(this.activeEnemySlot + delta, 0, demoState.enemyTeam.length);
    this.loadEnemyEditor(nextSlot);
    this.renderActiveView();
    this.restoreSelection();
  }

  private ensureEnemyTeam(): void {
    if (demoState.enemyTeam.length === 0) {
      demoState.enemyTeam = [this.currentEnemyEditorConfig()];
    }
    this.activeEnemySlot = Phaser.Math.Clamp(this.activeEnemySlot, 0, demoState.enemyTeam.length - 1);
    this.loadEnemyEditor(this.activeEnemySlot);
  }

  private currentEnemyEditorConfig(): EnemyFightConfig {
    return {
      enemyId: demoState.enemyId,
      level: demoState.enemyLevel,
      title: demoState.enemyTitle,
      rank: demoState.enemyRank,
      modifiers: [...demoState.enemyModifiers],
    };
  }

  private saveEnemyEditor(): void {
    demoState.enemyTeam[this.activeEnemySlot] = this.currentEnemyEditorConfig();
    demoState.enemyIds = demoState.enemyTeam.map((enemy) => enemy.enemyId);
  }

  private loadEnemyEditor(slot: number): void {
    const config = demoState.enemyTeam[slot];
    if (!config) return;
    this.activeEnemySlot = slot;
    demoState.enemyId = config.enemyId;
    demoState.enemyLevel = config.level;
    demoState.enemyTitle = config.title;
    demoState.enemyRank = config.rank;
    demoState.enemyModifiers = [...config.modifiers];
    demoState.enemyIds = demoState.enemyTeam.map((enemy) => enemy.enemyId);
  }

  private selectEnemySlot(slot: number): void {
    if (!demoState.enemyTeam[slot] || slot === this.activeEnemySlot) return;
    this.saveEnemyEditor();
    this.loadEnemyEditor(slot);
    this.renderActiveView();
    this.restoreSelection();
  }

  private addEnemySlot(): void {
    if (demoState.enemyTeam.length >= 2) return;
    this.saveEnemyEditor();
    const enemyIds = Object.keys(enemies);
    const nextId = enemyIds.find((id) => !demoState.enemyTeam.some((config) => config.enemyId === id)) ?? enemyIds[0]!;
    const enemy = enemies[nextId]!;
    const title = defaultTitleFor(enemy);
    demoState.enemyTeam.push({
      enemyId: nextId,
      level: Math.max(1, enemy.baseDepth),
      title,
      rank: TITLE_PRESETS[title].rank,
      modifiers: [],
    });
    this.loadEnemyEditor(1);
    this.renderActiveView();
    this.restoreSelection();
  }

  private removeEnemySlot(): void {
    if (demoState.enemyTeam.length < 2) return;
    this.saveEnemyEditor();
    demoState.enemyTeam.splice(1, 1);
    this.loadEnemyEditor(0);
    this.renderActiveView();
    this.restoreSelection();
  }

  private renderEnemyTeamControls(bounds: { x: number; y: number; w: number; h: number }): void {
    const chipH = DISPLAY_THEME.spacing.panelControlH;
    const chipY = panelHeaderCenterY(bounds) - chipH / 2;
    const gap = DISPLAY_THEME.spacing.chipGap;
    const removeW = 22;
    const chipText = (slot: number): string => {
      const config = demoState.enemyTeam[slot];
      if (!config) return '+ FOE 2';
      const name = enemies[config.enemyId]?.name ?? 'FOE';
      return `${slot + 1} ${name.toUpperCase()}`;
    };
    const chipWidth = (label: string): number => Math.min(144, Math.max(84, 18 + label.length * 7));
    const firstLabel = chipText(0);
    const secondLabel = chipText(1);
    const firstW = chipWidth(firstLabel);
    const secondW = chipWidth(secondLabel);
    const startX = bounds.x + bounds.w - DISPLAY_THEME.spacing.panelHeaderInset - firstW - gap - secondW - gap - removeW;

    const drawSlot = (slot: number, x: number): void => {
      const config = demoState.enemyTeam[slot];
      const exists = Boolean(config);
      const selected = exists && slot === this.activeEnemySlot;
      const label = slot === 0 ? firstLabel : secondLabel;
      const w = slot === 0 ? firstW : secondW;
      const rect = this.viewRect(x + w / 2, chipY + chipH / 2, w, chipH, selected ? UI.chip : UI.panel);
      rect.setStrokeStyle(1, UI.border, exists ? 0.8 : 0.45);
      rect.setInteractive({ useHandCursor: true });
      rect.on('pointerdown', () => exists ? this.selectEnemySlot(slot) : this.addEnemySlot());
      const text = this.viewText(x + w / 2, chipY + chipH / 2 + 1, label, {
        fontSize: '10px',
        color: selected ? '#1a1208' : UI.text,
        fontFamily: FONT.body,
        fontStyle: 'bold',
      }).setOrigin(0.5);
      auditControlLabel(rect, text, { name: `Enemy slot ${slot + 1}`, horizontalPadding: 8, verticalPadding: 5, minFontSize: 8 });
    };

    drawSlot(0, startX);
    drawSlot(1, startX + firstW + gap);
    this.viewSmallButton(startX + firstW + gap + secondW + gap, chipY, removeW, chipH, '×', demoState.enemyTeam.length > 1, () => this.removeEnemySlot());
  }

  private boardSummaryText(): string {
    const filledSlots = demoState.pieces.reduce((sum, piece) => {
      const skill = skillBook[piece.skillId];
      return sum + (skill?.size ?? 1);
    }, 0);
    const gemmed = demoState.pieces.filter((piece) => piece.gem).length;
    const totalPl = demoState.pieces.reduce((sum, piece) => {
      const baseSkill = skillBook[piece.skillId];
      const skill = baseSkill ? applyTier(baseSkill, piece.tier) : undefined;
      return skill ? sum + instancePowerLevelDeci(skill, piece) : sum;
    }, 0);
    return `${demoState.pieces.length} cards · ${filledSlots}/${HERO_BOARD_SLOTS} slots\nPL ${formatPowerDeci(totalPl)} · ${gemmed} gems`;
  }

  private renderBoardSlots(y: number, interactive = true): void {
    for (let slot = 0; slot < HERO_BOARD_SLOTS; slot++) {
      const x = BOARD_LEFT + slot * SLOT_W + SLOT_W / 2;
      const rect = this.viewRect(x, y, SLOT_W - 6, CARD_H + 12, UI.slot);
      rect.setStrokeStyle(1.25, UI.border, 0.78);
      this.boardSlotRects.push(rect);
      if (!interactive) rect.setAlpha(0.9);
      // Numbers stay below the card rail; gem sockets now sit above each card.
      this.viewText(x, y + CARD_H / 2 + DECK_BUILD_LAYOUT.rail.slotNumberGap, String(slot + 1), {
        fontSize: '9px',
        color: UI.textDim,
        fontFamily: FONT.body,
      }).setOrigin(0.5, 0);
    }
  }

  private renderBoardCards(y: number, draggable: boolean, socketY: number): void {
    const pieces = [...demoState.pieces].sort((a, b) => a.slot - b.slot);
    for (const piece of pieces) {
      const baseSkill = skillBook[piece.skillId];
      if (!baseSkill) continue;
      const skill = applyTier(baseSkill, piece.tier);
      const x = BOARD_LEFT + piece.slot * SLOT_W + (skill.size * SLOT_W) / 2;
      const card = this.viewCard(x, y, skill, 1, UI.playerCard);
      this.bindInspect(card, { kind: 'skill', skillId: piece.skillId, hostInstanceId: piece.instanceId, tier: piece.tier, contextLabel: `Board card · ${piece.instanceId}` });
      // Hovering an aura card previews its reach as borders on the affected cards.
      if (skill.aura) {
        card.on('pointerover', () => this.showAuraReach(piece, y));
        card.on('pointerout', () => this.clearAuraReach());
      }
      if (draggable) this.makeDraggable(card, { kind: 'board', piece, skillId: piece.skillId, tier: piece.tier }, true);
      this.renderSocketBadge(piece, card, socketY);
    }
  }

  private renderTransferSlot(): void {
    // Panel shell without the header underline — the boxes are centered in
    // the full panel height and the labels sit between them.
    const shell = drawPanelShell(this, DECK_TRANSFER, '', {
      fill: UI.panel,
      track: this.viewObjects,
    });
    shell.line.setVisible(false);
    shell.title.setVisible(false);

    const slotW = GRID.cellInnerW;
    const slotH = CARD_H + 4;
    const cy = DECK_TRANSFER.y + DECK_TRANSFER.h / 2;
    const trashCx = DECK_TRANSFER.x + 34 + slotW / 2;
    const holdCx = DECK_TRANSFER.x + DECK_TRANSFER.w - 34 - slotW / 2;

    // Trash box — dropping any deck/bag/transfer card here deletes it (its
    // gem returns to the loose inventory).
    const trashRect = this.viewRect(trashCx, cy, slotW, slotH, UI.panelMuted);
    trashRect.setStrokeStyle(1.35, UI.bad, 0.8);
    this.trashZone = { rect: trashRect, baseFill: UI.panelMuted };
    this.viewText(trashCx + slotW / 2 + 16, cy, '◀ TRASH SKILL CARD', {
      fontSize: '10px',
      color: UI.textSoft,
      fontFamily: FONT.body,
      fontStyle: 'bold',
    }).setOrigin(0, 0.5);

    // Temp holding box — a parked card snaps back to its original spot when
    // you leave Deck Build.
    const rect = this.viewRect(holdCx, cy, slotW, slotH, this.transferSlot ? UI.slotHover : UI.panelMuted);
    rect.setStrokeStyle(1.35, UI.border, 0.78);
    this.transferZone = { rect, baseFill: this.transferSlot ? UI.slotHover : UI.panelMuted };
    this.viewText(holdCx - slotW / 2 - 16, cy, 'TEMP HOLDING CARD ▶', {
      fontSize: '10px',
      color: UI.textSoft,
      fontFamily: FONT.body,
      fontStyle: 'bold',
    }).setOrigin(1, 0.5);

    if (!this.transferSlot) return;

    const baseSkill = skillBook[this.transferSlot.card.skillId];
    if (!baseSkill) return;
    const skill = applyTier(baseSkill, this.transferSlot.card.tier);
    const cardW = skill.size * SLOT_W - 8;
    const scale = Math.min(1, (slotW - 8) / cardW);
    const card = this.viewCard(holdCx, cy, skill, scale, UI.panel);
    this.makeDraggable(card, {
      kind: 'transfer',
      card: this.transferSlot.card,
      piece: this.transferSlot.piece,
      skillId: this.transferSlot.card.skillId,
      tier: this.transferSlot.card.tier,
    }, true);
  }

  /** Gem socket button — a diamond above the card keeps the card face clean. */
  private renderSocketBadge(piece: OwnedBoardPiece, card: CardView, socketY: number): void {
    const bounds = card.getBounds();
    const fill = piece.gem ? GEM_RARITY_COLOR[piece.gem.rarity] : UI.panel;
    const cx = bounds.centerX;
    // Center the socket between the actual hero-control row and card top.
    const cy = socketY;
    const diamond = this.viewRect(cx, cy, DECK_BUILD_LAYOUT.socket.size, DECK_BUILD_LAYOUT.socket.size, fill);
    diamond.setRotation(DECK_BUILD_LAYOUT.socket.rotation);
    diamond.setStrokeStyle(1, UI.border, DECK_BUILD_LAYOUT.socket.strokeAlpha);
    diamond.setInteractive({ useHandCursor: true });
    const label = this.viewText(cx, cy, piece.gem ? '◆' : '+', {
      fontSize: DECK_BUILD_LAYOUT.socket.labelFontSize,
      color: piece.gem ? '#ffffff' : UI.text,
      fontFamily: FONT.body,
      fontStyle: 'bold',
    }).setOrigin(0.5);
    diamond.on('pointerdown', () => this.openGemPicker(piece.instanceId));
    label.setDepth(diamond.depth + 1);
  }

  private restoreSelection(): void {
    if (demoState.prepView === 'loadout' && !this.selectedInspect) {
      this.detailPanel.clear('Tap an enemy or active-deck card to inspect it.');
      return;
    }
    if (demoState.prepView === 'opponents') {
      this.detailPanel.clear('Tap an opponent to open its full stats and scenario card rotation.');
      return;
    }
    if (demoState.prepView === 'bag') {
      this.updateBagInspect();
      return;
    }
    if (!this.selectedInspect) {
      this.detailPanel.clear();
      return;
    }

    if (this.selectedInspect.kind === 'skill') {
      const baseSkill = skillBook[this.selectedInspect.skillId];
      if (!baseSkill) {
        this.detailPanel.clear();
        return;
      }
      const piece = this.selectedInspect.hostInstanceId ? this.findPiece(this.selectedInspect.hostInstanceId) : undefined;
      const tier = this.selectedInspect.tier ?? piece?.tier ?? baseSkill.tier;
      const skill = applyTier(baseSkill, tier);
      this.detailPanel.setSkill(skill, { piece, contextLabel: this.selectedInspect.contextLabel });
      return;
    }

    const gem = gemBook[this.selectedInspect.gemId];
    if (!gem) {
      this.detailPanel.clear();
      return;
    }
    const piece = this.selectedInspect.hostInstanceId ? this.findPiece(this.selectedInspect.hostInstanceId) : undefined;
    const baseHostSkill = piece ? skillBook[piece.skillId] : undefined;
    const hostSkill = baseHostSkill && piece ? applyTier(baseHostSkill, piece.tier) : undefined;
    this.detailPanel.setGem(gem, { hostSkill, piece });
  }

  private inspectSkill(skillId: string, hostInstanceId?: string, tier?: SkillTier, contextLabel?: string): void {
    this.selectedInspect = { kind: 'skill', skillId, hostInstanceId, tier, contextLabel };
    this.restoreSelection();
  }

  private inspectGem(gemId: string, hostInstanceId?: string): void {
    this.selectedInspect = { kind: 'gem', gemId, hostInstanceId };
    this.restoreSelection();
  }

  private bindInspect(card: CardView, target: InspectTarget): void {
    card.setInteractive({ useHandCursor: true });
    card.on('pointerover', () => {
      if (target.kind === 'skill') this.inspectSkill(target.skillId, target.hostInstanceId, target.tier, target.contextLabel);
      else this.inspectGem(target.gemId, target.hostInstanceId);
    });
    card.on('pointerdown', () => {
      if (target.kind === 'skill') this.inspectSkill(target.skillId, target.hostInstanceId, target.tier, target.contextLabel);
      else this.inspectGem(target.gemId, target.hostInstanceId);
    });
  }

  // Gem Picker layout "A" (chosen from the UiKit proposals): compact gem grid,
  // tap to SELECT and read the full effect + PL impact in the detail pane,
  // then an explicit SOCKET button confirms — no more blind instant socketing.
  private openGemPicker(pieceInstanceId: string, selectedIndex = 0): void {
    this.closeModal();
    const piece = this.findPiece(pieceInstanceId);
    if (!piece) return;

    const px = 38;
    const pw = 632;
    const py = 200;
    const ph = 860;
    const overlay = this.add.rectangle(0, 0, SCREEN.width, SCREEN.height, 0x0f1822, 0.36).setOrigin(0, 0).setInteractive();
    overlay.on('pointerdown', () => this.closeModal());
    const shadow = this.add.rectangle(px + 3, py + 4, pw, ph, UI.shadow, 0.18).setOrigin(0, 0);
    const panel = this.add.rectangle(px, py, pw, ph, UI.panel).setOrigin(0, 0).setStrokeStyle(1.75, UI.border);
    const chip = this.add.rectangle(px + 18, py + 18, 194, 30, UI.chipDark).setOrigin(0, 0).setStrokeStyle(1, UI.border);
    const title = this.add.text(px + 32, py + 27, 'SOCKET GEM', {
      fontSize: '14px',
      color: '#ffffff',
      fontFamily: FONT.body,
      fontStyle: 'bold',
    });
    const skill = skillBook[piece.skillId]!;
    const socketedName = piece.gem ? gemBook[piece.gem.id]?.name ?? piece.gem.id : null;
    const subtitle = this.add.text(px + 18, py + 66, `${skill.name} · ${socketedName ? `socketed: ${socketedName}` : 'socket empty'}`, {
      fontSize: '12px',
      color: UI.textDim,
      fontFamily: FONT.body,
    });
    this.modalObjects.push(overlay, shadow, panel, chip, title, subtitle);

    let gridY = py + 96;
    if (hasGem(piece) && piece.gem) {
      const remove = this.makeModalButton(px + 18, py + 92, 190, 30, 'REMOVE GEM', UI.badSoft, UI.text, () => {
        const removed = unsocketGem(piece);
        if (removed) demoState.gemInventory.push(removed.id as GemInventorySlot);
        this.closeModal();
        this.inspectSkill(piece.skillId, piece.instanceId, piece.tier, `Board card · ${piece.instanceId}`);
        this.renderActiveView();
        this.restoreSelection();
      });
      this.modalObjects.push(remove.rect, remove.text);
      gridY = py + 134;
    }

    const looseGems = demoState.gemInventory.map((id) => gemBook[id]).filter((gem): gem is GemDef => Boolean(gem));
    if (looseGems.length === 0) {
      const empty = this.add.text(px + 18, gridY + 24, 'No loose gems left. Remove one from another card or reset the demo state.', {
        fontSize: '12px',
        color: UI.textDim,
        fontFamily: FONT.body,
        wordWrap: { width: pw - 40 },
      });
      this.modalObjects.push(empty);
      return;
    }

    const selected = looseGems[Math.min(selectedIndex, looseGems.length - 1)]!;
    const rowW = (pw - 48) / 2;
    for (let index = 0; index < looseGems.length; index++) {
      const gem = looseGems[index]!;
      const col = index % 2;
      const row = Math.floor(index / 2);
      const x = px + 18 + col * (rowW + 12);
      const y = gridY + row * 60;
      const active = index === Math.min(selectedIndex, looseGems.length - 1);
      const rect = this.add.rectangle(x, y, rowW, 52, active ? UI.panelAlt : UI.panelMuted)
        .setOrigin(0, 0)
        .setStrokeStyle(active ? 2 : 1, active ? UI.chip : UI.border, active ? 1 : 0.6)
        .setInteractive({ useHandCursor: true });
      const rarity = this.add.rectangle(x + 12, y + 12, 12, 12, GEM_RARITY_COLOR[gem.rarity]).setOrigin(0, 0);
      const name = this.add.text(x + 32, y + 8, gem.name, {
        fontSize: '12px',
        color: UI.text,
        fontFamily: FONT.body,
        fontStyle: 'bold',
      });
      const pl = this.add.text(x + rowW - 12, y + 8, `+${gemPowerLevel(gem)} PL`, {
        fontSize: '11px',
        color: UI.text,
        fontFamily: FONT.body,
        fontStyle: 'bold',
      }).setOrigin(1, 0);
      const meta = this.add.text(x + 32, y + 28, `${gem.rarity.toUpperCase()} · ${gem.kind === 'stat' ? `${gem.scope} mod` : 'effect rider'}`, {
        fontSize: '9px',
        color: UI.textDim,
        fontFamily: FONT.body,
      });
      rect.on('pointerdown', () => this.openGemPicker(pieceInstanceId, index));
      this.modalObjects.push(rect, rarity, name, meta, pl);
    }

    // detail pane: full effect text + PL impact + confirm
    const gridRows = Math.ceil(looseGems.length / 2);
    const dy = gridY + gridRows * 60 + 14;
    const detailH = 206;
    const detail = this.add.rectangle(px + 18, dy, pw - 36, detailH, UI.panelAlt).setOrigin(0, 0).setStrokeStyle(1.5, UI.chip, 0.9);
    const dTitle = this.add.text(px + 34, dy + 14, `SELECTED · ${selected.name.toUpperCase()}`, {
      fontSize: '12px',
      color: UI.text,
      fontFamily: FONT.body,
      fontStyle: 'bold',
    });
    const dMeta = this.add.text(px + 34, dy + 38, `${selected.rarity.toUpperCase()} · ${selected.kind === 'stat' ? `${selected.scope} stat mod` : 'effect rider'} · +${gemPowerLevel(selected)} gem PL`, {
      fontSize: '10px',
      color: `#${GEM_RARITY_COLOR[selected.rarity].toString(16).padStart(6, '0')}`,
      fontFamily: FONT.body,
      fontStyle: 'bold',
    });
    const dText = this.add.text(px + 34, dy + 60, selected.text, {
      fontSize: '12px',
      color: UI.text,
      fontFamily: FONT.body,
      wordWrap: { width: pw - 84 },
      lineSpacing: 4,
    });
    const hostPl = powerLevel(applyTier(skill, piece.tier ?? skill.tier));
    const dHost = this.add.text(px + 34, dy + 118, `${skill.name}: PL ${hostPl} → ${hostPl + gemPowerLevel(selected)}${socketedName ? ` (replaces ${socketedName})` : ''}`, {
      fontSize: '12px',
      color: UI.textDim,
      fontFamily: FONT.body,
      fontStyle: 'bold',
    });
    const socket = this.makeModalButton(px + pw / 2 - 120, dy + detailH - 56, 240, 40, `SOCKET ${selected.name.toUpperCase()}`, UI.chipDark, '#ffffff', () => {
      const inventoryIndex = demoState.gemInventory.indexOf(selected.id);
      if (inventoryIndex < 0) return;
      demoState.gemInventory.splice(inventoryIndex, 1);
      const displaced = hasGem(piece) ? swapGem(piece, selected) : (socketGem(piece, selected), null);
      if (displaced) demoState.gemInventory.push(displaced.id as GemInventorySlot);
      this.closeModal();
      this.inspectGem(selected.id, piece.instanceId);
      this.renderActiveView();
      this.restoreSelection();
    });
    this.modalObjects.push(detail, dTitle, dMeta, dText, dHost, socket.rect, socket.text);
  }

  private closeModal(): void {
    for (const obj of this.modalObjects) obj.destroy();
    this.modalObjects = [];
  }

  private makeDraggable(card: CardView, source: DragSource, enabled: boolean): void {
    if (!enabled) return;
    if (!card.input) card.setInteractive({ useHandCursor: true });
    this.input.setDraggable(card);
    card.on('dragstart', () => this.startDrag(source, card.x, card.y));
    card.on('drag', (_pointer: Phaser.Input.Pointer, dragX: number, dragY: number) => this.moveDrag(dragX, dragY));
    card.on('dragend', () => this.endDrag());
  }

  private startDrag(source: DragSource, x: number, y: number): void {
    const baseSkill = skillBook[source.skillId];
    if (!baseSkill) return;
    const skill = applyTier(baseSkill, source.tier);

    this.dragSource = source;
    this.dragGhost = new CardView(this, x, y, skill, { mini: source.kind === 'transfer', fillColor: UI.panelAlt });
    if (source.kind === 'transfer') this.dragGhost.setScale(0.72);
    this.dragGhost.setAlpha(0.9).setDepth(40);
  }

  private moveDrag(x: number, y: number): void {
    if (!this.dragGhost) return;
    this.dragGhost.setPosition(x, y);
    this.paintTargets(x, y);
  }

  private endDrag(): void {
    const source = this.dragSource;
    const dragGhost = this.dragGhost;
    const dropX = dragGhost?.x ?? 0;
    const dropY = dragGhost?.y ?? 0;

    this.clearDrag(false);
    if (!source) return;

    if (demoState.prepView === 'bag') {
      if (this.targetTrashZone(dropX, dropY)) {
        this.trashSource(source);
        this.renderActiveView();
        this.restoreSelection();
        return;
      }

      const slot = this.targetBoardSlot(dropX, dropY, source.skillId);
      const bagSlot = this.targetBagSlot(dropX, dropY, source.skillId);
      const transfer = this.targetTransferZone(dropX, dropY);

      if (source.kind === 'transfer') {
        if ((slot === null || !this.dropOnBoardWithShift(source, slot)) && bagSlot !== null) {
          this.placeTransferInBag(bagSlot);
        }
        this.renderActiveView();
        this.restoreSelection();
        return;
      }

      if (transfer && this.moveSourceToTransfer(source)) {
        this.renderActiveView();
        this.restoreSelection();
        return;
      }

      if (slot !== null) {
        this.dropOnBoardWithShift(source, slot);
      } else if (source.kind === 'board') {
        this.unequipToBag(source.piece, bagSlot);
      } else if (source.kind === 'bag') {
        this.moveBagCard(source.index, bagSlot);
      }

      this.renderActiveView();
      this.restoreSelection();
      return;
    }
  }

  /** Permanently delete the dragged card; any socketed gem returns to the loose inventory. */
  private trashSource(source: DragSource): void {
    if (source.kind === 'board') {
      demoState.pieces = demoState.pieces.filter((piece) => piece.instanceId !== source.piece.instanceId);
      if (source.piece.gem) demoState.gemInventory.push(source.piece.gem.id as GemInventorySlot);
      return;
    }
    if (source.kind === 'bag') {
      const current = demoState.bagSlots[source.index];
      if (current && current.instanceId === source.card.instanceId) demoState.bagSlots[source.index] = null;
      return;
    }
    // Transfer slot — the card was already lifted out of the deck/bag.
    if (this.transferSlot?.piece?.gem) {
      demoState.gemInventory.push(this.transferSlot.piece.gem.id as GemInventorySlot);
    }
    this.transferSlot = null;
  }

  private moveSourceToTransfer(source: DragSource): boolean {
    if (this.transferSlot || source.kind === 'transfer') return false;

    if (source.kind === 'bag') {
      const current = demoState.bagSlots[source.index];
      if (!current || current.instanceId !== source.card.instanceId) return false;
      demoState.bagSlots[source.index] = null;
      this.transferSlot = {
        origin: { kind: 'bag', index: source.index, card: { ...source.card } },
        card: { ...source.card },
      };
      return true;
    }

    demoState.pieces = demoState.pieces.filter((piece) => piece.instanceId !== source.piece.instanceId);
    const piece = { ...source.piece };
    this.transferSlot = {
      origin: { kind: 'board', piece },
      card: {
        instanceId: piece.instanceId,
        skillId: piece.skillId,
        tier: piece.tier,
      },
      piece,
    };
    return true;
  }

  private returnTransferSlot(): void {
    const held = this.transferSlot;
    if (!held) return;
    this.transferSlot = null;

    if (held.origin.kind === 'bag') {
      this.placeCardInBag(held.card, held.origin.index);
      return;
    }

    const original = { ...held.origin.piece };
    if (canPlace(demoState.pieces, skillBook, original.skillId, original.slot, HERO_BOARD_SLOTS)) {
      demoState.pieces.push(original);
      return;
    }

    const fallbackSlot = this.firstBoardSlotFor(original.skillId);
    if (fallbackSlot !== null) {
      demoState.pieces.push({ ...original, slot: fallbackSlot });
      return;
    }

    if (original.gem) {
      demoState.gemInventory.push(original.gem.id as GemInventorySlot);
      original.gem = null;
    }
    this.placeCardInBag({
      instanceId: original.instanceId,
      skillId: original.skillId,
      tier: original.tier,
    }, null);
  }

  private placeTransferInBag(index: number | null): void {
    const held = this.transferSlot;
    if (!held) return;
    const piece = held.piece;
    if (piece?.gem) {
      demoState.gemInventory.push(piece.gem.id as GemInventorySlot);
      piece.gem = null;
    }
    if (this.placeCardInBag(held.card, index ?? (held.origin.kind === 'bag' ? held.origin.index : null))) {
      this.transferSlot = null;
    }
  }

  private bagCardSize(skillId: string): number {
    return skillBook[skillId]?.size ?? 1;
  }

  /** Start index of the card whose span covers `index`, or null when the slot is free. */
  private bagOwnerIndex(index: number): number | null {
    for (let start = index; start >= 0; start--) {
      const card = demoState.bagSlots[start];
      if (!card) continue;
      return start + this.bagCardSize(card.skillId) > index ? start : null;
    }
    return null;
  }

  /**
   * Whether a card of `size` slots can sit with its first slot at `index`
   * without shifting anything. `ignoreIndex` exempts the card being moved.
   */
  private canPlaceInBag(size: number, index: number, ignoreIndex: number | null = null): boolean {
    if (index < 0 || index + size > demoState.bagSlots.length) return false;
    for (let cover = index; cover < index + size; cover++) {
      const owner = this.bagOwnerIndex(cover);
      if (owner !== null && owner !== ignoreIndex) return false;
    }
    return true;
  }

  private findBagFit(size: number, ignoreIndex: number | null = null): number {
    for (let index = 0; index < demoState.bagSlots.length; index++) {
      if (this.canPlaceInBag(size, index, ignoreIndex)) return index;
    }
    return -1;
  }

  /** Bag slots consumed, counting each card's full span. */
  private bagSlotsUsed(): number {
    return demoState.bagSlots.reduce((sum, card) => sum + (card ? this.bagCardSize(card.skillId) : 0), 0);
  }

  /**
   * Shift plan for dropping a card of this skill at bag slot `desired`.
   * `excludeIndex` marks a within-bag move — those reorder (adjacent drop =
   * swap) instead of pushing, mirroring the deck rail.
   */
  private bagShiftPlan(skillId: string, desired: number, excludeIndex: number | null): ShiftPlan | null {
    const others: StripItem[] = [];
    for (let index = 0; index < demoState.bagSlots.length; index++) {
      const card = demoState.bagSlots[index];
      if (!card || index === excludeIndex) continue;
      others.push({ id: card.instanceId, start: index, size: this.bagCardSize(card.skillId) });
    }
    const size = this.bagCardSize(skillId);
    if (excludeIndex !== null) {
      return moveWithinStrip(others, size, excludeIndex, desired, demoState.bagSlots.length);
    }
    return shiftInsert(others, size, desired, demoState.bagSlots.length);
  }

  /**
   * Drop `card` at bag slot `desired`, shifting neighbors over when there is
   * room — the same movement rules as the deck rail. Returns false (nothing
   * changes) when the bag cannot make room.
   */
  private dropInBagWithShift(card: OwnedCard, excludeIndex: number | null, desired: number): boolean {
    const plan = this.bagShiftPlan(card.skillId, desired, excludeIndex);
    if (!plan) return false;
    const byId = new Map<string, OwnedCard>();
    for (const slotCard of demoState.bagSlots) {
      if (slotCard) byId.set(slotCard.instanceId, slotCard);
    }
    const next: InventorySlot[] = demoState.bagSlots.map(() => null);
    for (const move of plan.moved) {
      const moved = byId.get(move.id);
      if (moved) next[move.start] = moved;
    }
    next[plan.movedStart] = { ...card };
    demoState.bagSlots = next;
    return true;
  }

  private placeCardInBag(card: OwnedCard, preferredIndex: number | null): boolean {
    if (preferredIndex !== null && this.dropInBagWithShift(card, null, preferredIndex)) return true;
    const fallback = this.findBagFit(this.bagCardSize(card.skillId));
    if (fallback < 0) return false;
    demoState.bagSlots[fallback] = { ...card };
    return true;
  }

  private firstBoardSlotFor(skillId: string): number | null {
    for (let slot = 0; slot < HERO_BOARD_SLOTS; slot++) {
      if (canPlace(demoState.pieces, skillBook, skillId, slot, HERO_BOARD_SLOTS)) return slot;
    }
    return null;
  }

  /** Remove a piece from the board and return its card (and any socketed gem) to the bag. */
  private unequipToBag(piece: OwnedBoardPiece, index: number | null): void {
    const card: OwnedCard = {
      instanceId: piece.instanceId,
      skillId: piece.skillId,
      tier: piece.tier,
    };
    if (!this.placeCardInBag(card, index)) return;
    demoState.pieces = demoState.pieces.filter((other) => other.instanceId !== piece.instanceId);
    if (piece.gem) {
      demoState.gemInventory.push(piece.gem.id as GemInventorySlot);
      piece.gem = null;
    }
  }

  /** Reorder within the bag: insert the dragged card at the target slot, shifting neighbors. */
  private moveBagCard(sourceIndex: number, targetIndex: number | null): void {
    if (targetIndex === null || targetIndex === sourceIndex) return;
    const sourceCard = demoState.bagSlots[sourceIndex] ?? null;
    if (!sourceCard) return;
    this.dropInBagWithShift(sourceCard, sourceIndex, targetIndex);
  }

  private clearDrag(skipDestroy: boolean): void {
    if (!skipDestroy) this.dragGhost?.destroy();
    this.dragGhost = null;
    this.dragSource = null;
    this.resetTargetPaint();
  }

  private paintTargets(x: number, y: number): void {
    this.resetTargetPaint();

    if (!this.dragSource) return;

    if (demoState.prepView === 'bag') {
      const slot = this.targetBoardSlot(x, y, this.dragSource.skillId);
      if (slot !== null) {
        const skill = skillBook[this.dragSource.skillId];
        if (!skill) return;

        // Paint where the card will actually land after neighbors shift.
        const plan = this.boardShiftPlan(this.dragSource, slot);
        const paintSlot = plan ? plan.movedStart : slot;
        for (let current = paintSlot; current < paintSlot + skill.size; current++) {
          this.boardSlotRects[current]?.setFillStyle(plan ? UI.slotHover : UI.badSoft);
        }
        return;
      }
    }

    const trash = this.targetTrashZone(x, y);
    if (trash) {
      trash.rect.setFillStyle(UI.badSoft);
      return;
    }

    const transfer = this.targetTransferZone(x, y);
    if (transfer) {
      const canUseTransfer = !this.transferSlot && this.dragSource.kind !== 'transfer';
      transfer.rect.setFillStyle(canUseTransfer ? UI.slotHover : UI.badSoft);
      return;
    }

    const bagSlot = this.targetBagSlot(x, y, this.dragSource.skillId);
    if (bagSlot === null) return;
    const size = this.bagCardSize(this.dragSource.skillId);
    const ignoreIndex = this.dragSource.kind === 'bag' ? this.dragSource.index : null;
    // Paint where the card will actually land after neighbors shift.
    const plan = this.bagShiftPlan(this.dragSource.skillId, bagSlot, ignoreIndex);
    const paintStart = plan ? plan.movedStart : bagSlot;
    for (let current = paintStart; current < paintStart + size; current++) {
      const zone = this.slotZones.find((candidate) => candidate.index === current);
      zone?.rect.setFillStyle(plan ? UI.slotHover : UI.badSoft);
    }
  }

  private resetTargetPaint(): void {
    for (const rect of this.boardSlotRects) rect.setFillStyle(UI.slot);
    for (const zone of this.slotZones) zone.rect.setFillStyle(zone.baseFill);
    if (this.transferZone) this.transferZone.rect.setFillStyle(this.transferZone.baseFill);
    if (this.trashZone) this.trashZone.rect.setFillStyle(this.trashZone.baseFill);
  }

  private canDropOnBoard(source: DragSource, slot: number): boolean {
    return this.boardShiftPlan(source, slot) !== null;
  }

  /**
   * Shift plan for dropping the dragged card at `desired` on the deck rail.
   * A deck card moving along its own rail reorders (adjacent drop = swap);
   * a card arriving from the bag or transfer pushes neighbors aside.
   */
  private boardShiftPlan(source: DragSource, desired: number): ShiftPlan | null {
    const others: StripItem[] = demoState.pieces
      .filter((piece) => !(source.kind === 'board' && piece.instanceId === source.piece.instanceId))
      .map((piece) => ({ id: piece.instanceId, start: piece.slot, size: this.bagCardSize(piece.skillId) }));
    const size = this.bagCardSize(source.skillId);
    if (source.kind === 'board') {
      return moveWithinStrip(others, size, source.piece.slot, desired, HERO_BOARD_SLOTS);
    }
    return shiftInsert(others, size, desired, HERO_BOARD_SLOTS);
  }

  /**
   * Drop the dragged card at `desired` on the deck rail, shifting neighbors
   * over when there is room. Returns false (nothing changes, card snaps
   * back) when the rail cannot make room.
   */
  private dropOnBoardWithShift(source: DragSource, desired: number): boolean {
    if (source.kind === 'transfer' && !this.transferSlot) return false;
    const plan = this.boardShiftPlan(source, desired);
    if (!plan) return false;
    for (const move of plan.moved) {
      const piece = this.findPiece(move.id);
      if (piece) piece.slot = move.start;
    }
    if (source.kind === 'board') {
      source.piece.slot = plan.movedStart;
    } else if (source.kind === 'bag') {
      demoState.pieces.push({ ...source.card, slot: plan.movedStart });
      demoState.bagSlots[source.index] = null;
    } else {
      const held = this.transferSlot;
      if (!held) return false;
      demoState.pieces.push(held.piece ? { ...held.piece, slot: plan.movedStart } : { ...held.card, slot: plan.movedStart });
      this.transferSlot = null;
    }
    return true;
  }

  private targetBoardSlot(x: number, y: number, skillId: string): number | null {
    if (Math.abs(y - DECK_BUILD_BOARD_Y) > BOARD_DROP_BAND / 2) return null;
    const skill = skillBook[skillId];
    if (!skill) return null;
    const raw = (x - BOARD_LEFT - (skill.size * SLOT_W) / 2) / SLOT_W;
    return clampSlot(raw, skillId, skillBook, HERO_BOARD_SLOTS);
  }

  /** Positional drop targeting on the bag rail — mirrors targetBoardSlot. */
  private targetBagSlot(x: number, y: number, skillId: string): number | null {
    if (Math.abs(y - DECK_BUILD_BAG_RAIL_Y) > BOARD_DROP_BAND / 2) return null;
    const skill = skillBook[skillId];
    if (!skill) return null;
    const raw = (x - BOARD_LEFT - (skill.size * SLOT_W) / 2) / SLOT_W;
    return clampSlot(raw, skillId, skillBook, demoState.bagSlots.length);
  }

  private targetTransferZone(x: number, y: number): TransferZone | null {
    return this.transferZone?.rect.getBounds().contains(x, y) ? this.transferZone : null;
  }

  private targetTrashZone(x: number, y: number): TransferZone | null {
    return this.trashZone?.rect.getBounds().contains(x, y) ? this.trashZone : null;
  }

  private findPiece(instanceId: string): OwnedBoardPiece | undefined {
    return demoState.pieces.find((piece) => piece.instanceId === instanceId);
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
    this.add.rectangle(x + 2, y + 3, w, h, UI.shadow, 0.16).setOrigin(0, 0);
    const rect = this.add.rectangle(x, y, w, h, fill).setOrigin(0, 0).setStrokeStyle(1.5, UI.border, 0.88).setInteractive({ useHandCursor: true });
    const text = this.add
      .text(x + w / 2, y + h / 2, label, {
        fontSize: '12px',
        color: textColor,
        fontFamily: FONT.body,
        fontStyle: 'bold',
      })
      .setOrigin(0.5);
    auditControlLabel(rect, text, { name: label, horizontalPadding: 12, verticalPadding: 7 });
    this.bindButton(pairFrom(rect, text), onClick);
    return { rect, text };
  }

  private makeModalButton(
    x: number,
    y: number,
    w: number,
    h: number,
    label: string,
    fill: number,
    textColor: string,
    onClick: () => void,
  ): ButtonPair {
    const rect = this.add.rectangle(x, y, w, h, fill).setOrigin(0, 0).setStrokeStyle(1, UI.border, 0.78).setInteractive({ useHandCursor: true });
    const text = this.add
      .text(x + w / 2, y + h / 2, label, {
        fontSize: '11px',
        color: textColor,
        fontFamily: FONT.body,
        fontStyle: 'bold',
      })
      .setOrigin(0.5);
    auditControlLabel(rect, text, { name: label, horizontalPadding: 10, verticalPadding: 6 });
    this.bindButton(pairFrom(rect, text), onClick);
    return { rect, text };
  }

  private bindButton(button: ButtonPair, onClick: () => void): void {
    button.rect.on('pointerover', () => {
      button.rect.setScale(1.01);
      button.text.setScale(1.01);
    });
    button.rect.on('pointerout', () => {
      button.rect.setScale(1);
      button.text.setScale(1);
    });
    button.rect.on('pointerdown', () => {
      button.rect.setScale(0.98);
      button.text.setScale(0.98);
      onClick();
    });
    button.rect.on('pointerup', () => {
      button.rect.setScale(1);
      button.text.setScale(1);
    });
  }

  private viewSmallButton(x: number, y: number, w: number, h: number, label: string, enabled: boolean, onClick: () => void): void {
    const rect = this.viewRect(x + w / 2, y + h / 2, w, h, enabled ? UI.panel : UI.slot);
    rect.setStrokeStyle(1, UI.border, enabled ? 0.78 : 0.38);
    const text = this.viewText(x + w / 2, y + h / 2, label, {
      fontSize: '12px',
      color: enabled ? UI.text : UI.textSoft,
      fontFamily: FONT.body,
      fontStyle: 'bold',
    }).setOrigin(0.5);
    auditControlLabel(rect, text, { name: label, horizontalPadding: 5, verticalPadding: 4, minFontSize: 8 });
    if (!enabled) return;
    rect.setInteractive({ useHandCursor: true });
    rect.on('pointerdown', onClick);
  }

  private viewPanel(
    bounds: { x: number; y: number; w: number; h: number },
    label: string,
    fill: number,
  ): void {
    drawPanelShell(this, bounds, label, {
      fill,
      track: this.viewObjects,
    });
  }

  private viewRect(x: number, y: number, w: number, h: number, fill: number, alpha = 1): Phaser.GameObjects.Rectangle {
    const rect = this.add.rectangle(x, y, w, h, fill, alpha);
    this.viewObjects.push(rect);
    return rect;
  }

  private viewCircle(x: number, y: number, radius: number, fill: number, alpha = 1): Phaser.GameObjects.Arc {
    const circle = this.add.circle(x, y, radius, fill, alpha);
    this.viewObjects.push(circle);
    return circle;
  }

  private viewText(x: number, y: number, text: string, style: Phaser.Types.GameObjects.Text.TextStyle): Phaser.GameObjects.Text {
    const label = this.add.text(x, y, text, style);
    this.viewObjects.push(label);
    return label;
  }

  private viewCard(x: number, y: number, skill: SkillDef, scale: number, fillColor: number): CardView {
    const mini = scale < 0.9;
    const card = new CardView(this, x, y, skill, { mini, fillColor });
    card.setScale(scale);
    this.viewObjects.push(card);
    return card;
  }
}

function pairFrom(rect: Phaser.GameObjects.Rectangle, text: Phaser.GameObjects.Text): ButtonPair {
  return { rect, text };
}
