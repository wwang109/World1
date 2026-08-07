import Phaser from 'phaser';
import { playSfx } from '../audio/sfxSynth';
import { applyTier, resolveDisplaySkill } from '../../engine/cards';
import { skillBook } from '../../data/skills';
import { gemBook, type GemDef } from '../../data/gems';
import { shopCatalog, shopTypeIds } from '../../data/shopTypes';
import type { Gem, SkillDef, SkillTier } from '../../engine/types';
import type { CardOffer, GemOffer } from '../../run/shop';
import { sellPriceOfCard, sellPriceOfGem, shopPoolInfo } from '../../run/shop';
import { canPlace, bagAsBoardPieces } from '../../run/loadout';
import {
  bagHasRoomFor, buyCard, buyCardTo, buyGem, ensureShelf, mergeCard, mergeTargetFor, moveToBag, moveToBoard,
  rerollShelf, sellCard, sellGem, type BuyDestination, type RearrangeOutcome,
} from '../shopActions';
import { demoState, type InventorySlot, type OwnedBoardPiece } from '../demoState';
import {
  buyCurrentShopCard, buyCurrentShopCardTo, buyCurrentShopGem, currentNode, currentRunBagHasRoomFor,
  currentRunBagSlots, currentRunGemInventory, currentRunPieces, currentShopMergeTarget, currentShopShelf,
  ensureCurrentShopShelf, getActiveRun, leaveCurrentShop, mergeCurrentShopCard, rerollCurrentShop,
  retireActiveRun, sellCurrentRunCard, sellCurrentRunGem, setCurrentRunBagSlots, setCurrentRunGemInventory,
  setCurrentRunPieces,
} from '../runStore';
import type { MergeTarget } from '../../run/shop';
import { stripCardTextMarkup } from '../ui/cardTextMarkup';
import { DESKTOP_PROFILE } from '../layoutProfile';
import { FONT, GEM_RARITY_COLOR, SCREEN, UI } from '../theme';
import { CardToken } from '../ui/CardToken';
import { FantasyCardTemplateV2 } from '../ui/FantasyCardTemplateV2';
import { DESKTOP_LAYOUT, renderDesktopBackground, renderDesktopHeader } from '../ui/DesktopNav';
import { renderRetireConfirm, renderRunHud, snapshotRunProgress } from '../ui/RunProgressStrip';
import { addRunArt, RUN_ART_KEYS, shopArtKey } from '../ui/runArt';
import { runScreenLayoutRef } from '../ui/runScreenLayout';
import { setDeckBuildContext } from '../deckBuildContext';
import { rebuildScene, wasPointerConsumedByRebuild } from '../sceneRebuild';
import { BoardColumn, type ColumnPiece } from '../ui/BoardColumn';

/** Structural shape shared by `ShopShelfState` (demoState) and `RunShopShelf`
 * (run) — the shop scene reads/writes through this either way. */
interface ShelfLike { cards: CardOffer[]; gems: GemOffer[]; rerollCount: number }

/** Structural (instanceId/skillId/tier/slot[/gem])-shaped board piece — matches
 * BOTH `OwnedBoardPiece` (sandbox) and `RunBoardPiece` (run) without either
 * module importing the other, mirroring the `pieces`/`bagSlots` split
 * `DesktopDeckBuildScene` already uses. */
type BoardPieceLike = { instanceId: string; skillId: string; tier: SkillTier; slot: number; gem?: Gem | null };
type BagSlotLike = { instanceId: string; skillId: string; tier: SkillTier } | null;

const F = DESKTOP_PROFILE.font;
const BAD_HEX = `#${UI.bad.toString(16).padStart(6, '0')}`;
// LIVE reference: every `TEMPLATE.*` read below resolves against the
// CURRENT viewport (the canvas fills the window -- see game/viewport.ts).
const TEMPLATE = runScreenLayoutRef('desktop');

/** Width of the permanent right-hand inspect dock in the shelf view — sized
 * like the Wiki's detail pane (same idiom) so a card render + full text +
 * BUY button all fit without crowding. Spans the FULL content height
 * (top..bottom), untouched by the 2026-08-04 drag/sell pass below. */
const DOCK_WIDTH = 380;

const BOARD_BAG_SLOTS = 10;

/**
 * YOUR BOARD / BAG are two VERTICAL columns beside the shelf — the same
 * "deck-build" idiom `DesktopDeckBuildScene.renderColumns` uses (a column of
 * real `CardToken`s, multi-slot cards spanning rows), just narrower than that
 * screen's 620px columns to leave room for the shelf grid + the permanent
 * inspect dock alongside them. Replaces the old 92×44 horizontal mini-token
 * strip (2026-08-04..08-05) — this is deliberately much more spacious: a full
 * card render (art, name, effects, affinity) instead of a truncated name/tier
 * label, per the user's explicit "more spacing" ask.
 */
const OWNED_COL_W = 220;
/** Gap between the [shelf | BOARD | BAG] regions. */
const OWNED_COL_GAP = DESKTOP_LAYOUT.gap;
/** Vertical gap between rows inside a BOARD/BAG column. */
const OWNED_ROW_GAP = 8;
const SELL_ZONE_H = 40;
const POUCH_LABEL_H = 14;
const POUCH_LABEL_GAP = 4;
const POUCH_CELL_H = 30;
/**
 * Reserved band UNDER the BOARD/BAG columns for SELL ZONE + GEM POUCH
 * (bottom-anchored at the same `bottom` the shelf viewport and dock use):
 *   gap (column bottom → SELL ZONE)   = 8
 *   SELL ZONE                          = 40
 *   gap                                 = 8
 *   POUCH label + gap + cell           = 14 + 4 + 30 = 48
 *   total                               = 104
 * The shelf viewport does NOT reserve this band — it runs the full column
 * height (it scrolls; the columns are sized to fit without scrolling).
 */
const OWNED_FOOTER_H = 8 + SELL_ZONE_H + 8 + POUCH_LABEL_H + POUCH_LABEL_GAP + POUCH_CELL_H;

type PendingBuy = { kind: 'card'; index: number; dest?: BuyDestination } | { kind: 'gem'; index: number };
type PendingSell = { location: 'board' | 'bag' | 'gem'; index: number };

/** A manual-drag participant — mirrors the DeckBuild scenes' `Source`/
 * `draggables` idiom (hit-test rect + <8px tap guard + a moving visual),
 * extended to cover shelf offers (BUY) and owned board/bag/pouch items
 * (SELL) in one unified drag system. */
type DragSource =
  | { kind: 'shelfCard'; index: number }
  | { kind: 'board'; index: number } // index into `this.pieces`
  | { kind: 'bag'; index: number } // slot index into `this.bagSlots`
  | { kind: 'gem'; index: number }; // index into `this.gemInventory`

interface DragEntry { bounds: Phaser.Geom.Rectangle; src: DragSource; obj: Phaser.GameObjects.Container }

/**
 * Geometry the drag hit-testing (`wireDrag`) and the invalid-drop flash need
 * to agree with what `renderOwnedColumns` actually drew — computed once per
 * render, shared by both.
 */
interface OwnedColumnLayout {
  boardX: number;
  bagX: number;
  colW: number;
  colTop: number;
  rowH: number;
  rowGap: number;
  sellRect: Phaser.Geom.Rectangle;
}

/**
 * Desktop Shop — storefront picker (16 themed shops) → shelf view (card
 * offers + gem offers, gold prices, REROLL) with a permanent right-hand
 * inspect dock. Tap a card/gem tile and its full render/text/BUY button
 * fills the dock in place (no full-screen overlay) — BUY opens a small
 * confirm dialog (mirrors the deck-build trash-confirm) with CANCEL / BUY /
 * (MERGE, when a duplicate is already owned) before the purchase actually
 * deducts gold and lands the item in the bag/pouch.
 *
 * 2026-08-04: DRAG-TO-BUY + SELLING. A YOUR BOARD / BAG pair of columns sits
 * beside the shelf grid (now a scrollable masked viewport), with a SELL ZONE
 * and a gem POUCH row beneath them. Dragging a shelf card onto a board/bag
 * slot opens the BUY confirm pre-targeted at that destination; dragging an
 * owned card/gem onto SELL ZONE (or just tapping it) opens a SELL confirm.
 * One manual pointer-drag system (hit-test + <8px tap guard — the DeckBuild
 * idiom) drives both.
 *
 * 2026-08-05: BOARD/BAG went VERTICAL — two `CardToken` columns (the same
 * deck-build idiom, multi-slot cards spanning rows) in place of the old
 * horizontal 92px mini-token strip. See `OWNED_COL_W`/`OWNED_FOOTER_H`.
 *
 * 2026-08-06: BOARD<->BAG REARRANGE (task #32 — this move never existed in
 * the shop before; only BUY-to-slot and SELL did) — dragging an owned card
 * onto a board/bag slot now moves it there via `moveToBoard`/`moveToBag`
 * (`src/game/shopActions.ts`, itself built from `run/loadout.ts`'s
 * `moveWithinStrip`/`shiftInsert`, the same primitives DeckBuild's
 * `toDeck`/`toBag` already ship with). This also resolved a tap-vs-drag
 * conflict: an owned card's body is now a PURE drag surface (tap-to-sell is
 * gone; SELL is drag-onto-the-SELL-ZONE only) so a real drag never races a
 * tap branch, and inspect moved to the `CardToken`'s own "ⓘ" button — the
 * ONLY way to open the owned-card dock now (`renderOwnedCardDock`).
 */
export class DesktopShopScene extends Phaser.Scene {
  private selectedShop: string | null = null;
  private detailCardIndex: number | null = null;
  private detailGemIndex: number | null = null;
  private detailTier: SkillTier = 'bronze';
  /** OWNED board/bag card whose "ⓘ" button opened the dock — mutually
   * exclusive with `detailCardIndex`/`detailGemIndex` (a shelf selection
   * clears this, and this clears a shelf selection), same idiom, so the dock
   * always shows whichever the player looked at most recently. The whole
   * card body is a pure drag surface now (2026-08-06) — this button is the
   * ONLY way to open it, replacing the tap-to-sell shortcut that used to
   * double as an inspect. */
  private inspectOwned: { location: 'board' | 'bag'; index: number } | null = null;
  private pendingBuy: PendingBuy | null = null;
  private pendingSell: PendingSell | null = null;
  /** One-shot transient red flash on an invalid BUY-to-slot drop — read and
   * cleared the instant it's rendered (see `renderOwnedColumns`), so it never
   * re-fires on an unrelated later rerender. Purely cosmetic (a tween), not a
   * gameplay decision. */
  private invalidFlash: { where: 'board' | 'bag'; index: number } | null = null;
  private toastObjects: Phaser.GameObjects.GameObject[] = [];
  private retireConfirmOpen = false;

  /** The (masked, scrollable) shelf CARDS+GEMS container — null on the
   * storefront picker (no shelf to scroll there). Persisted scroll offset so
   * a rerender (e.g. after a purchase) doesn't reset the player's scroll. */
  private shelfContainer: Phaser.GameObjects.Container | null = null;
  private shelfScrollY = 0;
  private shelfThumb: Phaser.GameObjects.Rectangle | null = null;
  private shelfFadeTop: Phaser.GameObjects.Rectangle | null = null;
  private shelfFadeBottom: Phaser.GameObjects.Rectangle | null = null;
  private shelfViewport = { x: 0, y: 0, width: 0, height: 0 };
  private shelfMaxScroll = 0;

  private draggables: DragEntry[] = [];
  private ownedColumns: OwnedColumnLayout | null = null;
  private sellZoneRectObj: Phaser.GameObjects.Rectangle | null = null;
  private sellZoneLabelObj: Phaser.GameObjects.Text | null = null;

  constructor() { super('DesktopShop'); }

  init(): void {
    this.selectedShop = null;
    this.detailCardIndex = null;
    this.detailGemIndex = null;
    this.detailTier = 'bronze';
    this.inspectOwned = null;
    this.pendingBuy = null;
    this.pendingSell = null;
    this.invalidFlash = null;
    this.toastObjects = [];
    this.retireConfirmOpen = false;
    this.shelfScrollY = 0;
    // rebuildScene() destroys the game objects but NOT the fields pointing at
    // them — a stale Rectangle here would be repositioned by
    // `syncShelfScrollAffordance` after its destruction (scene-rebuild idiom).
    this.shelfThumb = null;
    this.shelfFadeTop = null;
    this.shelfFadeBottom = null;
  }

  private rerender(): void { rebuildScene(this); }

  /** Run Mode: the current node IS a shop node — single storefront, no
   * 5-shop picker, wallet/shelf come from the active run instead of
   * `demoState`. Sandbox otherwise (unchanged). */
  private runShopId(): string | null {
    const node = currentNode();
    return node?.kind === 'shop' && node.shopId ? node.shopId : null;
  }

  private isRunMode(): boolean { return this.runShopId() !== null; }

  private activeGold(): number {
    const runShop = this.runShopId();
    // Sandbox wallet is unlimited (user-locked 2026-08-04): a plain int so
    // every `activeGold() >= price` check passes without special cases.
    return runShop ? (getActiveRun()?.gold ?? 0) : Number.MAX_SAFE_INTEGER;
  }

  /** Wallet label — the sandbox says the word instead of a giant number. */
  private goldLabel(): string {
    const gold = this.activeGold();
    return gold === Number.MAX_SAFE_INTEGER ? 'GOLD UNLIMITED' : `GOLD ${gold}`;
  }

  /** The current shelf for `shopId`, sourced from the run in Run Mode or
   * `demoState.shopShelves` in the Sandbox — rolls it fresh the first time. */
  private shelfFor(shopId: string): ShelfLike {
    if (this.runShopId() === shopId) {
      ensureCurrentShopShelf();
      return currentShopShelf() ?? { cards: [], gems: [], rerollCount: 0 };
    }
    return ensureShelf(shopId);
  }

  // ---------- owned-item data source (Sandbox demoState vs. the active run) ----------
  // Same split as `DesktopDeckBuildScene` — the shop's BOARD/BAG/POUCH strips
  // read/write through it identically, so a purchase/sale here and an edit in
  // Deck Build are always looking at the SAME underlying collection.

  private get pieces(): BoardPieceLike[] { return this.isRunMode() ? currentRunPieces() : demoState.pieces; }
  private set pieces(next: BoardPieceLike[]) {
    if (this.isRunMode()) setCurrentRunPieces(next as OwnedBoardPiece[]);
    else demoState.pieces = next as OwnedBoardPiece[];
  }
  private get bagSlots(): BagSlotLike[] { return this.isRunMode() ? currentRunBagSlots() : demoState.bagSlots; }
  private set bagSlots(next: BagSlotLike[]) {
    if (this.isRunMode()) setCurrentRunBagSlots(next as InventorySlot[]);
    else demoState.bagSlots = next as InventorySlot[];
  }
  private get gemInventory(): string[] { return this.isRunMode() ? currentRunGemInventory() : demoState.gemInventory; }
  private set gemInventory(next: string[]) {
    if (this.isRunMode()) setCurrentRunGemInventory(next);
    else demoState.gemInventory = next;
  }

  private sizeOf(skillId: string): number { return Math.max(1, skillBook[skillId]?.size ?? 1); }

  /**
   * X geometry for the [shelf | BOARD | BAG] band before the dock — shared by
   * `renderShelf` (which needs the shelf's own narrower right edge for its
   * card/gem grid) and `renderOwnedColumns` (which needs `boardX`/`bagX`),
   * so the two can never disagree about where the columns actually sit.
   */
  private ownedColumnX(): { areaRight: number; boardX: number; bagX: number; colW: number } {
    const gx = DESKTOP_LAYOUT.gutter;
    const areaRight = SCREEN.width - gx - DOCK_WIDTH - DESKTOP_LAYOUT.gap;
    const colW = OWNED_COL_W;
    const bagX = areaRight - colW;
    const boardX = bagX - OWNED_COL_GAP - colW;
    return { areaRight, boardX, bagX, colW };
  }

  /** How many `desiredW`-ish columns fit `availW`, capped at `count` (never
   * more columns than there are actual offers — an empty trailing column
   * would just be dead space) and never fewer than 1. */
  private gridColsFor(count: number, availW: number, desiredW: number): number {
    const gap = DESKTOP_LAYOUT.gap;
    const fit = Math.floor((availW + gap) / (desiredW + gap));
    return Math.max(1, Math.min(count, fit));
  }

  private boardOccupied(): boolean[] {
    const occ = Array<boolean>(BOARD_BAG_SLOTS).fill(false);
    for (const p of this.pieces) {
      const size = this.sizeOf(p.skillId);
      for (let i = p.slot; i < p.slot + size && i < BOARD_BAG_SLOTS; i++) occ[i] = true;
    }
    return occ;
  }

  private bagOccupied(): boolean[] {
    const occ = Array<boolean>(BOARD_BAG_SLOTS).fill(false);
    this.bagSlots.forEach((card, index) => {
      if (!card) return;
      const size = this.sizeOf(card.skillId);
      for (let i = index; i < index + size && i < BOARD_BAG_SLOTS; i++) occ[i] = true;
    });
    return occ;
  }

  create(): void {
    this.draggables = [];
    this.shelfContainer = null;
    this.ownedColumns = null;
    this.sellZoneRectObj = null;
    this.sellZoneLabelObj = null;
    renderDesktopBackground(this);
    const runShop = this.runShopId();
    if (runShop) {
      this.renderHud(runShop);
    } else {
      renderDesktopHeader(this, 'SHOP', 'shop');
      this.renderGoldBalance();
    }
    const shopId = runShop ?? this.selectedShop;
    if (shopId) {
      this.renderShelf(shopId);
      this.renderOwnedColumns(shopId);
      this.renderDock(shopId);
    } else {
      this.renderStorefront();
    }
    this.wireDrag();
    if (this.pendingBuy) this.renderConfirm();
    if (this.pendingSell) this.renderSellConfirm();
    if (this.retireConfirmOpen) {
      renderRetireConfirm(this, {
        compact: false,
        onCancel: () => { this.retireConfirmOpen = false; this.rerender(); },
        onConfirm: () => { retireActiveRun(); this.scene.start('DesktopRunMap'); },
      });
    }
  }

  /** THE run HUD — identical header on every run screen. LEAVE SHOP (this
   * screen's primary go-forward action) sits in the HUD's fixed primary slot. */
  private renderHud(shopId: string): void {
    const run = getActiveRun();
    if (!run) return;
    renderRunHud(this, {
      screen: 'SHOP',
      compact: false,
      snapshot: snapshotRunProgress(run),
      actions: {
        secondary: { label: 'DECK / BAG', onPress: () => { setDeckBuildContext('run'); this.scene.start('DesktopDeck'); } },
        tertiary: { label: 'RETIRE', danger: true, onPress: () => { this.retireConfirmOpen = true; this.rerender(); } },
        primary: { label: 'LEAVE SHOP', onPress: () => { leaveCurrentShop(); this.scene.start('DesktopRunMap'); } },
      },
    });
    void shopId;
  }

  private renderGoldBalance(): void {
    const gx = DESKTOP_LAYOUT.gutter;
    this.add.text(SCREEN.width - gx, 102 + DESKTOP_LAYOUT.tabH / 2, this.goldLabel(), {
      fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${F.body}px`, color: UI.textAccent,
    }).setOrigin(1, 0.5);
  }

  // ---------- storefront ----------

  private renderStorefront(): void {
    const gx = DESKTOP_LAYOUT.gutter;
    const top = DESKTOP_LAYOUT.contentTop;
    this.add.text(gx, top, 'CHOOSE A SHOP', { fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${F.label}px`, color: UI.textAccent });
    const gridTop = top + F.label + 16;
    // Tighter than the shared DESKTOP_LAYOUT.gap — the picker grid is a dense
    // 16-tile catalog, not a handful of spaced-out panels.
    const gap = 8;
    const w = SCREEN.width - gx * 2;
    // The catalog grew past one row (16 themes) — wrap into a grid sized so
    // every storefront stays on-canvas and clickable.
    const cols = 6;
    const rows = Math.ceil(shopTypeIds.length / cols);
    const cellW = (w - gap * (cols - 1)) / cols;
    const availH = SCREEN.height - gridTop - DESKTOP_LAYOUT.gutter;
    const cellH = Math.min(220, (availH - gap * (rows - 1)) / rows);
    // Reserved top band for the upcoming shop-front banner art (one per
    // theme) — docs/art-prompt-pack.md §7 S1: desktop tile ≈219×215 → banner
    // ≈219×85. Ratio-sized off the actual cell height so it stays proportional
    // if the grid geometry above ever changes. NOT mounting an image this
    // pass — just holding the region and keeping text clear of it, so a
    // later pass is a pure asset-drop, no relayout.
    const bannerH = Math.round(cellH * 0.4);
    shopTypeIds.forEach((id, i) => {
      const shop = shopCatalog[id]!;
      const cx = gx + (i % cols) * (cellW + gap);
      const gridTopRow = gridTop + Math.floor(i / cols) * (cellH + gap);
      const cell = this.add.rectangle(cx, gridTopRow, cellW, cellH, UI.panel, 0.94)
        .setOrigin(0, 0).setStrokeStyle(1, UI.border, 0.8).setInteractive({ useHandCursor: true });
      cell.on('pointerover', () => cell.setStrokeStyle(2, UI.chip, 1));
      cell.on('pointerout', () => cell.setStrokeStyle(1, UI.border, 0.8));
      // CONFIRMED INSTANCE (#22, audit 2026-08): entering a shop rebuilds the
      // scene into the shelf+BOARD/BAG layout — a storefront tile's own pixel
      // can land on a shelf/board/bag card in that FRESH layout, and the
      // rebuild's freshly re-registered wireDrag pointerdown listener would
      // "discover" it. `rerender()` below stamps the structural guard
      // (`wasPointerConsumedByRebuild`, sceneRebuild.ts) that `wireDrag`'s
      // pointerdown handler checks first, so that re-dispatch is a no-op.
      cell.on('pointerdown', () => {
        playSfx('uiClick');
        ensureShelf(id);
        this.selectedShop = id;
        this.rerender();
      });
      addRunArt(this, shopArtKey(id), { x: cx, y: gridTopRow, width: cellW, height: bannerH }, 0.82);
      this.add.rectangle(cx, gridTopRow, cellW, bannerH, UI.bg, 0.28).setOrigin(0, 0);
      this.add.rectangle(cx, gridTopRow + bannerH, cellW, 1, UI.border, 0.5).setOrigin(0, 0);
      this.add.text(cx + 16, gridTopRow + bannerH + 8, shop.name.toUpperCase(), {
        fontFamily: FONT.display, fontStyle: 'bold', fontSize: `${F.name}px`, color: UI.text,
      });
      this.add.text(cx + 16, gridTopRow + bannerH + 8 + F.name + 4, shop.tagline, {
        fontFamily: FONT.body, fontSize: `${F.small}px`, color: UI.textDim,
        wordWrap: { width: cellW - 32 }, lineSpacing: 3,
      });
      this.add.text(cx + 16, gridTopRow + cellH - 20, `${shop.shelf.cards} CARDS · ${shop.shelf.gems} GEMS`, {
        fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${F.tiny}px`, color: UI.textAccent,
      });
    });
  }

  // ---------- shelf ----------

  private renderShelf(shopId: string): void {
    const shop = shopCatalog[shopId]!;
    const shelf = this.shelfFor(shopId);
    const info = shopPoolInfo(shopId);
    const runShop = this.runShopId() === shopId;
    const gx = DESKTOP_LAYOUT.gutter;
    // Run Mode's shop is entered straight from the map (no shop-picker to
    // navigate back through) and LEAVE SHOP lives in the HUD's fixed primary
    // slot now — so the run-context shelf starts at the HUD's content top
    // with no back button; the Sandbox keeps its own `‹ SHOPS` back nav.
    const top = runShop ? TEMPLATE.regions.content.y : DESKTOP_LAYOUT.contentTop;

    // The permanent inspect dock (renderDock) claims the screen's right
    // edge, and the BOARD/BAG columns (renderOwnedColumns) claim a further
    // slice before that — the shelf grid lays out within whatever's left so
    // none of the three ever overlap. `areaRight` (the header/reroll row's
    // own right edge) stays the OLD full pre-dock width — the header spans
    // over the columns below it, same as before this pass.
    const { areaRight, boardX } = this.ownedColumnX();
    const shelfRight = boardX - OWNED_COL_GAP;
    const bottom = SCREEN.height - DESKTOP_PROFILE.safe.bottom;

    let titleX = gx;
    if (!runShop) {
      const backW = 90;
      const back = this.add.rectangle(gx, top, backW, 28, UI.panelAlt).setOrigin(0, 0).setStrokeStyle(1, UI.border, 0.7).setInteractive({ useHandCursor: true });
      this.add.text(gx + backW / 2, top + 14, '‹ SHOPS', { fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${F.small}px`, color: UI.text }).setOrigin(0.5);
      back.on('pointerdown', () => { playSfx('uiBack'); this.selectedShop = null; this.rerender(); });
      titleX = gx + backW + 16;
    }
    this.add.text(titleX, top, shop.name.toUpperCase(), { fontFamily: FONT.display, fontStyle: 'bold', fontSize: `${F.name}px`, color: UI.textAccent });
    this.add.text(titleX, top + F.name + 2, shop.tagline, { fontFamily: FONT.body, fontSize: `${F.small}px`, color: UI.textDim });

    // A thin shop whose WHOLE pool already fits the shelf can never reveal
    // anything new on reroll (docs/run-shops-design.md §2b, USER-LOCKED) —
    // hide it behind a "FULL STOCK" label rather than inviting a wasted gold.
    const rerollW = 120;
    const rerollX = areaRight - rerollW;
    if (info.fullStock) {
      this.add.rectangle(rerollX, top, rerollW, 32, UI.panelMuted, 0.5).setOrigin(0, 0).setStrokeStyle(1, UI.border, 0.4);
      this.add.text(rerollX + rerollW / 2, top + 16, 'FULL STOCK', {
        fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${F.small}px`, color: UI.textSoft,
      }).setOrigin(0.5);
    } else {
      const canReroll = this.activeGold() >= 1;
      const reroll = this.add.rectangle(rerollX, top, rerollW, 32, canReroll ? UI.chip : UI.panelMuted, canReroll ? 1 : 0.5)
        .setOrigin(0, 0).setStrokeStyle(1, UI.border, canReroll ? 1 : 0.4);
      this.add.text(rerollX + rerollW / 2, top + 16, 'REROLL · 1 G', {
        fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${F.small}px`, color: canReroll ? UI.textOnChip : UI.textSoft,
      }).setOrigin(0.5);
      if (canReroll) {
        reroll.setInteractive({ useHandCursor: true });
        reroll.on('pointerdown', () => { playSfx('purchase'); runShop ? rerollCurrentShop() : rerollShelf(shopId); this.rerender(); });
      }
    }

    const rowTop = top + 40;
    // Scrollable viewport for the CARDS+GEMS grid — runs the FULL remaining
    // height (down to `bottom`), unlike before: BOARD/BAG are now vertical
    // columns BESIDE the shelf (not a horizontal strip below it), so nothing
    // here needs to reserve room for them. Masking (not row-height clamping)
    // is what makes the shelf immune to overflow regardless of offer count.
    const viewportTop = rowTop;
    const viewportH = Math.max(40, bottom - viewportTop);
    this.shelfViewport = { x: gx, y: viewportTop, width: shelfRight - gx, height: viewportH };

    const container = this.add.container(0, this.shelfScrollY);
    this.shelfContainer = container;
    const created: Phaser.GameObjects.GameObject[] = [];
    const A = <T extends Phaser.GameObjects.GameObject>(obj: T): T => { created.push(obj); return obj; };

    // `sectionTop` threads from the CARDS block into the GEMS block below it
    // — whichever sections exist stack with a consistent margin, and an
    // absent section (a shop with 0 of either) costs no space at all.
    let sectionTop = rowTop;

    // cardCols/gemCols cap at the shop's WHOLE pool size, so a thin theme
    // (e.g. a 1-card element stall) never renders permanent dead "SOLD OUT"
    // gaps — only genuinely transient ones (bought out mid-visit) show up.
    const cardCols = info.cardSlots;
    if (cardCols > 0) {
      A(this.add.text(gx, sectionTop, `CARDS · ${shelf.cards.length}/${cardCols}`, { fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${F.tiny}px`, color: UI.textDim }));
      sectionTop += F.tiny + 8;
      // Denser grid: wrap past N offers into further rows instead of one
      // ever-widening single row — the deepest-stocked shop (Caravan, 6
      // cards) used to force a hard width cap; wrapping uses the vertical
      // room the scrollable viewport leaves spare. Column COUNT now derives
      // from the shelf's actual width (narrower since BOARD/BAG columns
      // moved in beside it, 2026-08-05) rather than a flat cap of 4, so cards
      // never get squeezed below a legible width.
      const gridCols = this.gridColsFor(cardCols, shelfRight - gx, 240);
      const rows = Math.ceil(cardCols / gridCols);
      const cardGap = DESKTOP_LAYOUT.gap;
      const cardW = Math.min(260, (shelfRight - gx - cardGap * (gridCols - 1)) / gridCols);
      const rowW = gridCols * cardW + (gridCols - 1) * cardGap;
      const rowX = gx + (shelfRight - gx - rowW) / 2;
      const cardH = 130;
      const priceStripH = 24;
      const rowStride = cardH + priceStripH + 16;
      for (let i = 0; i < cardCols; i++) {
        const col = i % gridCols;
        const row = Math.floor(i / gridCols);
        const cx = rowX + col * (cardW + cardGap);
        const cy = sectionTop + row * rowStride;
        const offer = shelf.cards[i];
        if (!offer) {
          A(this.add.rectangle(cx + cardW / 2, cy + cardH / 2, cardW, cardH, UI.panelMuted, 0.4).setStrokeStyle(1, UI.border, 0.3));
          A(this.add.text(cx + cardW / 2, cy + cardH / 2, 'SOLD OUT', { fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${F.tiny}px`, color: UI.textSoft }).setOrigin(0.5));
          continue;
        }
        const base = skillBook[offer.skillId]!;
        const skill = offer.tier === base.tier ? base : applyTier(base, offer.tier);
        const tok = new CardToken(this, cx + cardW / 2, cy + cardH / 2, skill, { width: cardW, height: cardH, side: 'left' });
        A(tok);
        this.draggables.push({ bounds: new Phaser.Geom.Rectangle(cx, cy, cardW, cardH), src: { kind: 'shelfCard', index: i }, obj: tok });
        const affordable = this.activeGold() >= offer.price;
        A(this.add.rectangle(cx, cy + cardH, cardW, priceStripH, UI.panelMuted, 0.95).setOrigin(0, 0).setStrokeStyle(1, UI.border, 0.6));
        A(this.add.text(cx + cardW / 2, cy + cardH + 12, `${offer.price} GOLD`, {
          fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${F.tiny}px`, color: affordable ? UI.textAccent : BAD_HEX,
        }).setOrigin(0.5));
      }
      sectionTop += (rows - 1) * rowStride + cardH + priceStripH + 24;
    }

    const gemCols = info.gemSlots;
    if (gemCols > 0) {
      A(this.add.text(gx, sectionTop, `GEMS · ${shelf.gems.length}/${gemCols}`, { fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${F.tiny}px`, color: UI.textDim }));
      sectionTop += F.tiny + 8;
      // Same wrap treatment as CARDS, sized off the same narrower shelf width.
      const gridCols = this.gridColsFor(gemCols, shelfRight - gx, 260);
      const gemGap = DESKTOP_LAYOUT.gap;
      const gemW = Math.min(320, (shelfRight - gx - gemGap * (gridCols - 1)) / gridCols);
      const gemRowW = gridCols * gemW + (gridCols - 1) * gemGap;
      const gemRowX = gx + (shelfRight - gx - gemRowW) / 2;
      const gemH = 96;
      const gemRowStride = gemH + 16;
      for (let i = 0; i < gemCols; i++) {
        const col = i % gridCols;
        const row = Math.floor(i / gridCols);
        const cx = gemRowX + col * (gemW + gemGap);
        const cy = sectionTop + row * gemRowStride;
        const offer = shelf.gems[i];
        if (!offer) {
          A(this.add.rectangle(cx + gemW / 2, cy + gemH / 2, gemW, gemH, UI.panelMuted, 0.4).setStrokeStyle(1, UI.border, 0.3));
          A(this.add.text(cx + gemW / 2, cy + gemH / 2, 'SOLD OUT', { fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${F.tiny}px`, color: UI.textSoft }).setOrigin(0.5));
          continue;
        }
        const gem = gemBook[offer.gemId]!;
        const cell = A(this.add.rectangle(cx, cy, gemW, gemH, UI.panel, 0.94)
          .setOrigin(0, 0).setStrokeStyle(1, GEM_RARITY_COLOR[gem.rarity], 0.8).setInteractive({ useHandCursor: true }));
        cell.on('pointerdown', () => { playSfx('uiClick'); this.detailGemIndex = i; this.inspectOwned = null; this.rerender(); });
        A(this.add.rectangle(cx + 22, cy + 22, 14, 14, GEM_RARITY_COLOR[gem.rarity]).setOrigin(0.5).setAngle(45));
        A(this.add.text(cx + 38, cy + 12, gem.name, { fontFamily: FONT.display, fontStyle: 'bold', fontSize: `${F.small}px`, color: UI.text }));
        const body = A(this.add.text(cx + 16, cy + 40, stripCardTextMarkup(gem.text), {
          fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${F.tiny}px`, color: UI.textAccent,
          wordWrap: { width: gemW - 32 }, lineSpacing: 2,
        }));
        if (body.height > 30) { body.setText(`${body.text.slice(0, 60)}…`); }
        const affordable = this.activeGold() >= offer.price;
        A(this.add.text(cx + gemW - 16, cy + gemH - 18, `${offer.price} GOLD`, {
          fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${F.tiny}px`, color: affordable ? UI.textAccent : BAD_HEX,
        }).setOrigin(1, 0));
      }
      sectionTop += (Math.ceil(gemCols / gridCols) - 1) * gemRowStride + gemH;
    }

    if (cardCols === 0 && gemCols === 0) {
      A(this.add.text(gx, rowTop, 'This shop has nothing to sell.', {
        fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${F.small}px`, color: UI.textSoft,
      }));
    }

    container.add(created);
    const contentH = sectionTop - rowTop;
    this.shelfMaxScroll = Math.max(0, contentH - viewportH);
    this.shelfScrollY = Phaser.Math.Clamp(this.shelfScrollY, -this.shelfMaxScroll, 0);
    container.setY(this.shelfScrollY);

    const maskShape = this.make.graphics({}, false);
    maskShape.fillStyle(0xffffff);
    maskShape.fillRect(this.shelfViewport.x, this.shelfViewport.y, this.shelfViewport.width, this.shelfViewport.height);
    container.setMask(maskShape.createGeometryMask());
    // Invisible interactive "swallow" rect so a scroll-drag started over the
    // viewport doesn't fall through to anything behind it.
    this.add.rectangle(this.shelfViewport.x, this.shelfViewport.y, this.shelfViewport.width, this.shelfViewport.height, 0xffffff, 0.001).setOrigin(0, 0);
    this.renderShelfScrollAffordance();
  }

  /**
   * Scroll affordance for the masked shelf — a track + thumb on the viewport's
   * right edge, plus a fade at whichever edge still has content past it.
   *
   * The mask was doing its job and still looked like a bug: with the shelf
   * taller than its viewport, the GEMS row was sliced through the middle of a
   * gem's text with NOTHING on screen saying "there is more, scroll". A cut
   * with no affordance reads as broken layout, not as a scroll region. Drawn
   * OUTSIDE the masked container so it can't be clipped by its own mask.
   */
  private renderShelfScrollAffordance(): void {
    const v = this.shelfViewport;
    if (!v || this.shelfMaxScroll <= 0) return;

    const trackW = 4;
    const trackX = v.x + v.width - trackW;
    this.add.rectangle(trackX, v.y, trackW, v.height, UI.border, 0.35).setOrigin(0, 0);

    // Thumb length is the visible FRACTION of the content, so it doubles as a
    // read on how much is hidden.
    const visibleFraction = v.height / (v.height + this.shelfMaxScroll);
    const thumbH = Math.max(24, v.height * visibleFraction);
    this.shelfThumb = this.add.rectangle(trackX, v.y, trackW, thumbH, UI.chip, 0.85).setOrigin(0, 0);

    // Edge fades: only on the side that actually has more content, so they
    // double as direction hints rather than permanent decoration.
    const fadeH = 14;
    this.shelfFadeTop = this.add.rectangle(v.x, v.y, v.width - trackW, fadeH, UI.bg, 0.55).setOrigin(0, 0);
    this.shelfFadeBottom = this.add.rectangle(v.x, v.y + v.height - fadeH, v.width - trackW, fadeH, UI.bg, 0.55).setOrigin(0, 0);
    this.syncShelfScrollAffordance();
  }

  /**
   * Move the thumb / fades to match `shelfScrollY`. MUST be called everywhere
   * that field changes — scrolling only calls `shelfContainer.setY()`, it does
   * NOT rebuild the scene, so an affordance positioned once at render time
   * stays frozen while the content slides under it. A scrollbar that does not
   * track the finger is worse than none: it actively lies about the position.
   */
  private syncShelfScrollAffordance(): void {
    const v = this.shelfViewport;
    const thumb = this.shelfThumb;
    if (!v || !thumb || this.shelfMaxScroll <= 0) return;
    const progress = Phaser.Math.Clamp(-this.shelfScrollY / this.shelfMaxScroll, 0, 1);
    thumb.y = v.y + (v.height - thumb.height) * progress;
    this.shelfFadeTop?.setVisible(progress > 0.01);
    this.shelfFadeBottom?.setVisible(progress < 0.99);
  }

  /** The shop id the dock/confirm overlays operate on — the run's single
   * storefront in Run Mode (no picker to have set `selectedShop`), else the
   * Sandbox's browsed `selectedShop`. */
  private activeShopId(): string {
    return this.runShopId() ?? this.selectedShop!;
  }

  // ---------- owned columns: BOARD · BAG · SELL ZONE · GEM POUCH ----------

  /**
   * YOUR BOARD / BAG — two vertical `BoardColumn`s (the SAME shared 10-slot
   * column-of-`CardToken`s component battle/prep already render with — "one
   * component, no per-screen copies") sitting beside the shelf grid, with a
   * SELL ZONE and GEM POUCH stacked underneath them. Replaces the old
   * 92×44 horizontal mini-token strip: much more spacious (a full card
   * render — art, name, effects, affinity — instead of a truncated
   * name/tier label), per the user's explicit "more spacing" ask.
   */
  private renderOwnedColumns(shopId: string): void {
    const runShop = this.runShopId() === shopId;
    const top = runShop ? TEMPLATE.regions.content.y : DESKTOP_LAYOUT.contentTop;
    const bottom = SCREEN.height - DESKTOP_PROFILE.safe.bottom;
    const { boardX, bagX, colW } = this.ownedColumnX();
    // `labelY` matches renderShelf's own `rowTop` (`top + 40`) — the same
    // safe clearance below the title/REROLL row (which occupies
    // `[top, top+32]`) that the shelf's own "CARDS ·"/"GEMS ·" headers use,
    // so YOUR BOARD/BAG sit on that same header line instead of colliding
    // with REROLL above it (a real bug this fixes: the labels used to be
    // anchored `colTop - 18`, which landed INSIDE the reroll button's row).
    const labelY = top + 40;
    const colTop = labelY + 18;
    const colBottom = bottom - OWNED_FOOTER_H;
    const colH = Math.max(80, colBottom - colTop);
    const rowGap = OWNED_ROW_GAP;
    const rowH = (colH - rowGap * (BOARD_BAG_SLOTS - 1)) / BOARD_BAG_SLOTS;

    this.add.text(boardX + colW / 2, labelY, `YOUR BOARD · ${this.boardOccupied().filter(Boolean).length}/${BOARD_BAG_SLOTS}`, {
      fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${F.tiny}px`, color: UI.textAccent,
    }).setOrigin(0.5, 0);
    this.add.text(bagX + colW / 2, labelY, `BAG · ${this.bagOccupied().filter(Boolean).length}/${BOARD_BAG_SLOTS}`, {
      fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${F.tiny}px`, color: UI.textAccent,
    }).setOrigin(0.5, 0);

    const boardPieces: ColumnPiece[] = [];
    const boardSkills: SkillDef[] = [];
    for (const p of this.pieces) {
      const base = skillBook[p.skillId];
      if (!base) continue;
      // Tier + socketed-gem fold (resolver seam, display-only) so YOUR BOARD's
      // face numbers match what the card actually casts — see `resolveDisplaySkill`.
      const skill = resolveDisplaySkill(base, p);
      boardPieces.push({ skill, slot: p.slot });
      boardSkills.push(skill);
    }
    const boardCol = new BoardColumn(this, {
      x: boardX, y: colTop, width: colW, height: colH, side: 'left',
      slotCount: BOARD_BAG_SLOTS, gap: rowGap, pieces: boardPieces, deck: boardSkills,
      onInspectSlot: (slot) => {
        const piece = this.pieces.find((p) => p.slot === slot);
        if (!piece) return;
        this.detailCardIndex = null;
        this.detailGemIndex = null;
        this.inspectOwned = { location: 'board', index: this.pieces.indexOf(piece) };
        this.rerender();
      },
    });
    this.wireColumnDraggables(boardCol, boardX, colTop, colW, rowH, rowGap, (slot) => {
      const piece = this.pieces.find((p) => p.slot === slot);
      if (!piece || !skillBook[piece.skillId]) return null;
      return { size: this.sizeOf(piece.skillId), src: { kind: 'board', index: this.pieces.indexOf(piece) } };
    });

    const bagPieces: ColumnPiece[] = [];
    const bagSkills: SkillDef[] = [];
    this.bagSlots.forEach((card, index) => {
      if (!card) return;
      const skill = skillBook[card.skillId];
      if (!skill) return;
      bagPieces.push({ skill, slot: index });
      bagSkills.push(skill);
    });
    const bagCol = new BoardColumn(this, {
      x: bagX, y: colTop, width: colW, height: colH, side: 'right',
      slotCount: BOARD_BAG_SLOTS, gap: rowGap, pieces: bagPieces, deck: bagSkills,
      onInspectSlot: (slot) => {
        if (!this.bagSlots[slot]) return;
        this.detailCardIndex = null;
        this.detailGemIndex = null;
        this.inspectOwned = { location: 'bag', index: slot };
        this.rerender();
      },
    });
    this.wireColumnDraggables(bagCol, bagX, colTop, colW, rowH, rowGap, (slot) => {
      const card = this.bagSlots[slot];
      if (!card || !skillBook[card.skillId]) return null;
      return { size: this.sizeOf(card.skillId), src: { kind: 'bag', index: slot } };
    });

    // SELL ZONE + GEM POUCH, stacked directly under the two columns.
    const rowX = boardX;
    const rowW = bagX + colW - boardX;
    let y = colBottom + 8;
    const sellRect = new Phaser.Geom.Rectangle(rowX, y, rowW, SELL_ZONE_H);
    this.sellZoneRectObj = this.add.rectangle(rowX, y, rowW, SELL_ZONE_H, UI.badSoft, 0.35).setOrigin(0, 0).setStrokeStyle(1, UI.bad, 0.8);
    this.sellZoneLabelObj = this.add.text(rowX + rowW / 2, y + SELL_ZONE_H / 2, 'SELL ZONE — drag a card or gem here (or tap a gem)', {
      fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${F.tiny}px`, color: BAD_HEX,
    }).setOrigin(0.5);
    y += SELL_ZONE_H + 8;

    this.add.text(rowX, y, `GEM POUCH · ${this.gemInventory.length}`, {
      fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${F.tiny}px`, color: UI.textAccent,
    });
    y += POUCH_LABEL_H + POUCH_LABEL_GAP;
    this.renderPouchRow(rowX, y, rowW);

    this.ownedColumns = { boardX, bagX, colW, colTop, rowH, rowGap, sellRect };

    // One-shot invalid-drop flash — read + cleared here so it never survives
    // past the single rebuild it was set for.
    if (this.invalidFlash) {
      const flash = this.invalidFlash;
      this.invalidFlash = null;
      const fx = flash.where === 'board' ? boardX : bagX;
      const fy = colTop + flash.index * (rowH + rowGap);
      const overlay = this.add.rectangle(fx, fy, colW, rowH, UI.bad, 0.6).setOrigin(0, 0).setStrokeStyle(2, UI.bad, 1);
      this.tweens.add({ targets: overlay, alpha: 0, duration: 420, onComplete: () => overlay.destroy() });
    }
    void shopId;
  }

  /**
   * Registers a drag hit-box for every OCCUPIED row a rendered `BoardColumn`
   * drew — replicates the column's own row-consumption loop (a span-N piece
   * occupies N rows but renders exactly ONE token) to pair each token with
   * its bounds, the same idiom `DesktopBattleScene.pulseTokenAt` uses to
   * reach into a `BoardColumn`'s token list without the component needing
   * to expose that mapping itself.
   */
  private wireColumnDraggables(
    col: BoardColumn,
    colX: number, colTop: number, colW: number, rowH: number, rowGap: number,
    occupantAt: (slot: number) => { size: number; src: DragSource } | null,
  ): void {
    let tokenIdx = 0;
    for (let slot = 0; slot < BOARD_BAG_SLOTS; ) {
      const occupant = occupantAt(slot);
      const span = occupant?.size ?? 1;
      if (occupant) {
        const token = col.tokens[tokenIdx];
        if (token) {
          const y = colTop + slot * (rowH + rowGap);
          const h = rowH * span + rowGap * (span - 1);
          this.draggables.push({ bounds: new Phaser.Geom.Rectangle(colX, y, colW, h), src: occupant.src, obj: token });
        }
      }
      tokenIdx += 1;
      slot += span;
    }
  }

  /** A "+K more" cap keeps the pouch row a single non-scrolling line — the
   * board/bag are hard-capped at 10 by design, but the gem pouch can grow
   * past what one row fits; this is a deliberate density trim rather than a
   * second scroll region fighting the shelf's own. */
  private renderPouchRow(rowX: number, y: number, rowW: number): void {
    const cellW = 34;
    const gap = 4;
    const maxShown = Math.max(0, Math.floor((rowW + gap) / (cellW + gap)) - 1);
    const pouch = this.gemInventory;
    const shown = pouch.slice(0, maxShown);
    shown.forEach((gemId, i) => {
      const gem = gemBook[gemId];
      const cx = rowX + i * (cellW + gap);
      const box = this.add.container(cx, y);
      const bg = this.add.rectangle(cellW / 2, POUCH_CELL_H / 2, cellW, POUCH_CELL_H, UI.panel, 0.94).setStrokeStyle(1, gem ? GEM_RARITY_COLOR[gem.rarity] : UI.border, 0.9);
      const label = this.add.text(cellW / 2, POUCH_CELL_H / 2, gem?.name.slice(0, 2).toUpperCase() ?? '??', {
        fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${F.tiny}px`, color: UI.text,
      }).setOrigin(0.5);
      box.add([bg, label]);
      this.draggables.push({ bounds: new Phaser.Geom.Rectangle(cx, y, cellW, POUCH_CELL_H), src: { kind: 'gem', index: i }, obj: box });
    });
    if (pouch.length > maxShown) {
      this.add.text(rowX + shown.length * (cellW + gap), y + POUCH_CELL_H / 2, `+${pouch.length - maxShown} more`, {
        fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${F.tiny}px`, color: UI.textDim,
      }).setOrigin(0, 0.5);
    }
  }

  // ---------- inspect dock (permanent right-hand panel, FULL height, unchanged) ----------

  /** The flagship density fix: a permanently docked inspect panel, same
   * idiom as `DesktopWikiScene`'s detail pane — tapping a card/gem tile
   * fills this dock in place instead of opening a full-screen overlay, so
   * the screen's right edge (previously empty once the shelf's few offers
   * had rendered) becomes the inspect surface. */
  private renderDock(shopId: string): void {
    const gx = DESKTOP_LAYOUT.gutter;
    const runShop = this.runShopId() === shopId;
    const top = runShop ? TEMPLATE.regions.content.y : DESKTOP_LAYOUT.contentTop;
    const bottom = SCREEN.height - DESKTOP_PROFILE.safe.bottom;
    const dockX = SCREEN.width - gx - DOCK_WIDTH;

    this.add.rectangle(dockX, top, DOCK_WIDTH, bottom - top, UI.panel, 0.92)
      .setOrigin(0, 0).setStrokeStyle(1, UI.border, 0.8);

    if (this.inspectOwned) { this.renderOwnedCardDock(dockX, top, bottom); return; }
    if (this.detailCardIndex !== null) { this.renderCardDock(shopId, dockX, top, bottom); return; }
    if (this.detailGemIndex !== null) { this.renderGemDock(shopId, dockX, top, bottom); return; }

    this.add.text(dockX + DOCK_WIDTH / 2, top + 48, 'Tap a card or gem on the shelf to inspect it here.', {
      fontFamily: FONT.body, fontSize: `${F.small}px`, color: UI.textDim, align: 'center', wordWrap: { width: DOCK_WIDTH - 48 },
    }).setOrigin(0.5, 0);
  }

  /**
   * OWNED board/bag card detail — opened ONLY by a `CardToken` "ⓘ" button
   * (2026-08-06; see `inspectOwned`'s doc comment). Read-only: no BUY (it's
   * already owned) and no SELL button either — SELL stays a single gesture,
   * drag onto the SELL ZONE, exactly as the coordinator's brief asked for.
   */
  private renderOwnedCardDock(px: number, py: number, bottom: number): void {
    const owned = this.inspectOwned!;
    const card = owned.location === 'board' ? this.pieces[owned.index] : this.bagSlots[owned.index];
    if (!card) { this.inspectOwned = null; return; }
    const base = skillBook[card.skillId];
    if (!base) { this.inspectOwned = null; return; }
    // Board pieces can carry a socketed gem (bag slots structurally cannot —
    // see `BagSlotLike`); fold tier + gem for a board piece's face (the
    // "effective number at a glance" the socket bought), tier-only for bag.
    // See `resolveDisplaySkill`'s doc comment for why gem-folding lives here
    // and not in `powerLevelDeci`/PL math.
    const boardPiece = owned.location === 'board' ? (card as BoardPieceLike) : null;
    const shown = boardPiece ? resolveDisplaySkill(base, boardPiece) : (card.tier === base.tier ? base : applyTier(base, card.tier));
    const gem = boardPiece?.gem ?? null;
    const gemDef = gem ? gemBook[gem.id] : undefined;

    const pw = DOCK_WIDTH;
    const cardW = 200;
    const cardH = Math.round(cardW * (690 / 420));
    const centerX = px + pw / 2;
    const cardY = py + 20 + cardH / 2;
    new FantasyCardTemplateV2(this, centerX, cardY, shown, { width: cardW, height: cardH, tier: card.tier, glossary: false });

    let y = cardY + cardH / 2 + 12;
    this.add.text(centerX, y, base.name, {
      fontFamily: FONT.display, fontStyle: 'bold', fontSize: `${F.name}px`, color: UI.text, align: 'center', wordWrap: { width: pw - 40 },
    }).setOrigin(0.5, 0);
    y += F.name + 6;
    this.add.text(centerX, y, `${card.tier.toUpperCase()} · ${owned.location.toUpperCase()}`, {
      fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${F.small}px`, color: UI.textAccent,
    }).setOrigin(0.5, 0);
    y += F.small + 8;
    this.add.text(centerX, y, stripCardTextMarkup(shown.text), {
      fontFamily: FONT.body, fontSize: `${F.small}px`, color: UI.textSoft, align: 'center', wordWrap: { width: pw - 40 }, lineSpacing: 3,
    }).setOrigin(0.5, 0);
    y += F.small + 8;

    // DERIVATION: the card face/text above already show the gem-inflated
    // total — this row is the "why" (which gem, what it does verbatim), so a
    // player can tell an inflated number from a naturally big one. The gem's
    // OWN text is unmodified here (same convention as the shelf/wiki/socket
    // panel — see `resolveDisplaySkill`'s doc comment).
    if (gemDef) {
      const rowY = y;
      this.add.rectangle(centerX, rowY + 16, pw - 40, 40, 0x101a2a, 0.85).setOrigin(0.5, 0).setStrokeStyle(1, GEM_RARITY_COLOR[gemDef.rarity], 0.9);
      this.add.rectangle(centerX - pw / 2 + 34, rowY + 20, 10, 10, GEM_RARITY_COLOR[gemDef.rarity]).setOrigin(0.5).setAngle(45);
      this.add.text(centerX - pw / 2 + 48, rowY + 8, `SOCKETED · ${gemDef.name}`, {
        fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${F.tiny}px`, color: UI.textBright,
      }).setOrigin(0, 0);
      this.add.text(centerX - pw / 2 + 48, rowY + 22, stripCardTextMarkup(gemDef.text), {
        fontFamily: FONT.body, fontSize: `${F.tiny}px`, color: '#e8b446', wordWrap: { width: pw - 100 },
      }).setOrigin(0, 0);
      y = rowY + 40 + 8;
    }

    this.add.text(centerX, bottom - 32, 'Drag onto the SELL ZONE to sell.', {
      fontFamily: FONT.body, fontSize: `${F.tiny}px`, color: UI.textDim, align: 'center',
    }).setOrigin(0.5, 0);
  }

  private renderCardDock(shopId: string, px: number, py: number, bottom: number): void {
    const shelf = this.shelfFor(shopId);
    const offer = shelf.cards[this.detailCardIndex!];
    if (!offer) { this.detailCardIndex = null; return; }
    const base = skillBook[offer.skillId]!;
    const shown = this.detailTier === base.tier ? base : applyTier(base, this.detailTier);

    const pw = DOCK_WIDTH;
    const cardW = 200;
    const cardH = Math.round(cardW * (690 / 420));
    const centerX = px + pw / 2;
    const cardY = py + 20 + cardH / 2;
    new FantasyCardTemplateV2(this, centerX, cardY, shown, { width: cardW, height: cardH, tier: this.detailTier, glossary: false });

    let y = cardY + cardH / 2 + 12;
    this.add.text(centerX, y, base.name, {
      fontFamily: FONT.display, fontStyle: 'bold', fontSize: `${F.name}px`, color: UI.text, align: 'center', wordWrap: { width: pw - 40 },
    }).setOrigin(0.5, 0);
    y += F.name + 6;
    this.add.text(centerX, y, stripCardTextMarkup(shown.text), {
      fontFamily: FONT.body, fontSize: `${F.small}px`, color: UI.textSoft, align: 'center', wordWrap: { width: pw - 40 }, lineSpacing: 3,
    }).setOrigin(0.5, 0);

    const runMode = this.isRunMode();
    const affordable = this.activeGold() >= offer.price;
    const hasRoom = runMode ? currentRunBagHasRoomFor(offer.skillId) : bagHasRoomFor(offer.skillId);
    // A duplicate MERGE never needs bag room (it upgrades an already-owned
    // slot instead of adding a new one) — a full bag no longer blocks the
    // BUY button when a merge target exists.
    const mergeTarget = runMode ? currentShopMergeTarget(offer.skillId) : mergeTargetFor(offer.skillId);
    const canBuy = affordable && (hasRoom || mergeTarget != null);
    const btnY = bottom - 56;
    const btn = this.add.rectangle(centerX, btnY, pw - 40, 40, canBuy ? UI.chip : UI.panelMuted, canBuy ? 1 : 0.5)
      .setOrigin(0.5, 0).setStrokeStyle(1, UI.border, canBuy ? 1 : 0.4);
    const label = !affordable ? `NEED ${offer.price} GOLD` : !hasRoom && !mergeTarget ? 'BAG FULL' : !hasRoom ? 'MERGE AVAILABLE' : `BUY · ${offer.price} GOLD`;
    this.add.text(centerX, btnY + 20, label, { fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${F.label}px`, color: canBuy ? UI.textOnChip : UI.textSoft }).setOrigin(0.5);
    if (canBuy) {
      btn.setInteractive({ useHandCursor: true });
      btn.on('pointerdown', () => { playSfx('uiClick'); this.pendingBuy = { kind: 'card', index: this.detailCardIndex! }; this.rerender(); });
    }
  }

  private renderGemDock(shopId: string, px: number, py: number, bottom: number): void {
    const shelf = this.shelfFor(shopId);
    const offer = shelf.gems[this.detailGemIndex!];
    if (!offer) { this.detailGemIndex = null; return; }
    const gem: GemDef = gemBook[offer.gemId]!;

    const pw = DOCK_WIDTH;
    const centerX = px + pw / 2;
    let y = py + 24;
    this.add.rectangle(centerX, y + 10, 26, 26, GEM_RARITY_COLOR[gem.rarity]).setOrigin(0.5).setAngle(45).setStrokeStyle(2, UI.border, 0.8);
    y += 40;
    this.add.text(centerX, y, gem.name, { fontFamily: FONT.display, fontStyle: 'bold', fontSize: `${F.title}px`, color: UI.text, align: 'center', wordWrap: { width: pw - 40 } }).setOrigin(0.5, 0);
    y += F.title + 6;
    this.add.text(centerX, y, `${gem.rarity.toUpperCase()} · ${gem.kind === 'stat' ? 'STAT MOD' : 'EFFECT RIDER'}`, {
      fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${F.small}px`, color: UI.textDim,
    }).setOrigin(0.5, 0);
    y += F.small + 14;
    this.add.text(centerX, y, stripCardTextMarkup(gem.text), {
      fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${F.body}px`, color: UI.text, align: 'center', wordWrap: { width: pw - 40 }, lineSpacing: 4,
    }).setOrigin(0.5, 0);

    const affordable = this.activeGold() >= offer.price;
    const btnY = bottom - 56;
    const btn = this.add.rectangle(centerX, btnY, pw - 40, 40, affordable ? UI.chip : UI.panelMuted, affordable ? 1 : 0.5)
      .setOrigin(0.5, 0).setStrokeStyle(1, UI.border, affordable ? 1 : 0.4);
    this.add.text(centerX, btnY + 20, affordable ? `BUY · ${offer.price} GOLD` : `NEED ${offer.price} GOLD`, {
      fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${F.label}px`, color: affordable ? UI.textOnChip : UI.textSoft,
    }).setOrigin(0.5);
    if (affordable) {
      btn.setInteractive({ useHandCursor: true });
      btn.on('pointerdown', () => { playSfx('uiClick'); this.pendingBuy = { kind: 'gem', index: this.detailGemIndex! }; this.rerender(); });
    }
  }

  // ---------- unified manual drag: shelf→board/bag (BUY) · owned→SELL ZONE (SELL) ----------

  /** Shelf-card entries live inside the scrollable `shelfContainer` — their
   * captured `bounds` assume an unscrolled container, so hit-testing against
   * the pointer's WORLD coords must add the container's current scroll y. */
  private worldBounds(e: DragEntry): Phaser.Geom.Rectangle {
    if (e.src.kind !== 'shelfCard' || !this.shelfContainer) return e.bounds;
    return new Phaser.Geom.Rectangle(e.bounds.x, e.bounds.y + this.shelfContainer.y, e.bounds.width, e.bounds.height);
  }

  private sellRefFor(src: DragSource): PendingSell | null {
    if (src.kind === 'board') return { location: 'board', index: src.index };
    if (src.kind === 'bag') return { location: 'bag', index: src.index };
    if (src.kind === 'gem') return { location: 'gem', index: src.index };
    return null;
  }

  private sellPreview(sell: PendingSell): { name: string; tierLabel: string; price: number } | null {
    if (sell.location === 'gem') {
      const gemId = this.gemInventory[sell.index];
      const gem = gemId ? gemBook[gemId] : undefined;
      if (!gem) return null;
      return { name: gem.name, tierLabel: gem.rarity.toUpperCase(), price: sellPriceOfGem(gem.id) };
    }
    const card = sell.location === 'board' ? this.pieces[sell.index] : this.bagSlots[sell.index];
    if (!card) return null;
    const skill = skillBook[card.skillId];
    if (!skill) return null;
    return { name: skill.name, tierLabel: card.tier.toUpperCase(), price: sellPriceOfCard(card.tier) };
  }

  /** Which BOARD/BAG column (and slot within it) a drop point lands in, or
   * `null` outside both columns' band — shared by the shelf-card BUY-to-slot
   * drop and the owned-card REARRANGE drop so the two can never disagree
   * about the same geometry `renderOwnedColumns` drew. */
  private columnHitTest(worldX: number, worldY: number): { where: 'board' | 'bag'; slot: number } | null {
    const strip = this.ownedColumns;
    if (!strip) return null;
    const colBottom = strip.colTop + BOARD_BAG_SLOTS * strip.rowH + (BOARD_BAG_SLOTS - 1) * strip.rowGap;
    if (worldY < strip.colTop || worldY > colBottom) return null;
    let where: 'board' | 'bag' | null = null;
    if (worldX >= strip.boardX && worldX <= strip.boardX + strip.colW) where = 'board';
    else if (worldX >= strip.bagX && worldX <= strip.bagX + strip.colW) where = 'bag';
    if (!where) return null;
    const slot = Phaser.Math.Clamp(Math.floor((worldY - strip.colTop) / (strip.rowH + strip.rowGap)), 0, BOARD_BAG_SLOTS - 1);
    return { where, slot };
  }

  /** Applies a `moveToBoard`/`moveToBag` outcome — splices the new pieces/
   * bagSlots back through the mode-aware (`sandbox` vs. `run`) setters and
   * bounces any displaced gem to the pouch, exactly like `sellCard` already
   * does for a sold board piece's socket. */
  private applyRearrange(outcome: RearrangeOutcome): void {
    this.pieces = outcome.pieces;
    this.bagSlots = outcome.bagSlots;
    if (outcome.displacedGemId) this.gemInventory = [...this.gemInventory, outcome.displacedGemId];
  }

  private wireDrag(): void {
    this.input.removeAllListeners();
    let dragging: { src: DragSource; obj: Phaser.GameObjects.Container } | null = null;
    let ghost: Phaser.GameObjects.Container | null = null;
    let totalMove = 0;
    let start = { x: 0, y: 0 };
    let scrolling: { startY: number; startScroll: number } | null = null;

    const inViewport = (x: number, y: number): boolean => {
      const v = this.shelfViewport;
      return x >= v.x && x <= v.x + v.width && y >= v.y && y <= v.y + v.height;
    };

    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      // A dialog button already handled this exact physical click (and
      // likely just closed the dialog + rebuilt the scene via `rerender()`)
      // — don't ALSO reinterpret it as a fresh board/bag hit-test. See
      // `wasPointerConsumedByRebuild`'s doc comment (sceneRebuild.ts): this
      // structural guard covers EVERY rerender()-calling handler above,
      // including the storefront shop tiles, which have no dialog to guard
      // behind a state flag at all (see `renderStorefront`).
      if (wasPointerConsumedByRebuild(this, p)) return;
      if (this.pendingBuy || this.pendingSell || this.retireConfirmOpen) return;
      // A shelfCard's registered bounds are its UNCLIPPED position inside the
      // scrollable container — a card scrolled below the masked viewport
      // still has bounds sitting where it would be, invisible but "clickable"
      // there. Gate shelfCard hits on `inViewport` too, or a scrolled-away
      // card can steal a tap intended for whatever's actually visible at
      // that pixel (the BOARD/BAG columns, once the shelf is short enough to
      // need scrolling at all — true for mobile's default stock).
      const hit = this.draggables.find((d) => this.worldBounds(d).contains(p.worldX, p.worldY)
        && (d.src.kind !== 'shelfCard' || inViewport(p.worldX, p.worldY)));
      if (hit) {
        dragging = { src: hit.src, obj: hit.obj };
        totalMove = 0;
        start = { x: p.worldX, y: p.worldY };
        if (hit.src.kind === 'shelfCard' && hit.obj instanceof CardToken) {
          ghost = hit.obj.spawnGhost();
          if (this.shelfContainer) ghost.setPosition(ghost.x, ghost.y + this.shelfContainer.y);
        }
        hit.obj.setDepth(1000).setAlpha(0.9);
        return;
      }
      if (this.shelfMaxScroll > 0 && inViewport(p.worldX, p.worldY)) {
        scrolling = { startY: p.worldY, startScroll: this.shelfScrollY };
      }
    });

    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (dragging) {
        totalMove = Math.max(totalMove, Math.hypot(p.worldX - start.x, p.worldY - start.y));
        if (dragging.src.kind === 'shelfCard' && this.shelfContainer) {
          dragging.obj.setPosition(p.worldX, p.worldY - this.shelfContainer.y);
        } else {
          dragging.obj.setPosition(p.worldX, p.worldY);
        }
        if (dragging.src.kind !== 'shelfCard' && this.sellZoneRectObj && this.sellZoneLabelObj) {
          const sell = this.sellRefFor(dragging.src);
          const hovering = sell != null && this.ownedColumns != null && this.ownedColumns.sellRect.contains(p.worldX, p.worldY);
          if (hovering && sell) {
            const preview = this.sellPreview(sell);
            this.sellZoneRectObj.setFillStyle(UI.bad, 0.55);
            if (preview) this.sellZoneLabelObj.setText(`SELL ${preview.name} ${preview.tierLabel} → +${preview.price} GOLD`);
          } else {
            this.sellZoneRectObj.setFillStyle(UI.badSoft, 0.35);
            this.sellZoneLabelObj.setText('SELL ZONE — drag a card or gem here (or tap a gem)');
          }
        }
        return;
      }
      if (scrolling) {
        this.shelfScrollY = Phaser.Math.Clamp(scrolling.startScroll + (p.worldY - scrolling.startY), -this.shelfMaxScroll, 0);
        this.shelfContainer?.setY(this.shelfScrollY);
        this.syncShelfScrollAffordance();
      }
    });

    this.input.on('pointerup', (p: Phaser.Input.Pointer) => {
      // Symmetric with the `pointerdown` guard above — `processUpEvents` has
      // the SAME two-phase (per-object then scene-level) dispatch as
      // `processDownEvents` (see `wasPointerConsumedByRebuild`'s doc comment,
      // sceneRebuild.ts). No object-level `pointerup` handler rebuilds today,
      // so `dragging` being null already protects this listener in practice —
      // this guard is defense-in-depth against the first one that does.
      if (wasPointerConsumedByRebuild(this, p)) return;
      scrolling = null;
      if (!dragging) return;
      const src = dragging.src;
      const draggedObj = dragging.obj;
      dragging = null;
      ghost?.destroy(); ghost = null;

      if (src.kind === 'shelfCard') {
        const shopId = this.activeShopId();
        const shelf = this.shelfFor(shopId);
        if (totalMove < 6) {
          playSfx('uiClick');
          this.detailCardIndex = src.index;
          this.detailTier = shelf.cards[src.index]?.tier ?? 'bronze';
          this.inspectOwned = null;
          this.rerender();
          return;
        }
        const hit = this.columnHitTest(p.worldX, p.worldY);
        if (hit) {
          const { where, slot } = hit;
          const offer = shelf.cards[src.index];
          if (offer) {
            const fits = where === 'board'
              ? canPlace(this.pieces, skillBook, offer.skillId, slot, BOARD_BAG_SLOTS)
              : canPlace(bagAsBoardPieces(this.bagSlots), skillBook, offer.skillId, slot, BOARD_BAG_SLOTS);
            const afford = this.activeGold() >= offer.price;
            if (fits && afford) {
              this.pendingBuy = { kind: 'card', index: src.index, dest: { where, slot } };
            } else {
              this.invalidFlash = { where, index: slot };
            }
          }
        }
        this.rerender();
        return;
      }

      // GEM (pouch): unchanged — tap OR drag onto the SELL ZONE both open the
      // same SELL confirm, so there is no tap/drag ambiguity to resolve here
      // (there is no gem "rearrange" destination for a drag to conflict with).
      if (src.kind === 'gem') {
        if (totalMove < 6) {
          playSfx('uiClick');
          this.pendingSell = this.sellRefFor(src);
          this.rerender();
          return;
        }
        draggedObj.setDepth(0).setAlpha(1);
        const strip = this.ownedColumns;
        if (strip && strip.sellRect.contains(p.worldX, p.worldY)) {
          this.pendingSell = this.sellRefFor(src);
        }
        this.rerender();
        return;
      }

      // OWNED board/bag card: the whole body is a pure drag surface now
      // (2026-08-06) — a plain tap does nothing (inspect moved to the
      // CardToken's own "ⓘ" button; SELL moved to drag-onto-the-SELL-ZONE
      // only, since a tap-to-sell shortcut would have raced the same drag
      // gesture this fixes). `this.rerender()` still runs on a tap to clear
      // the depth/alpha bump `pointerdown` applied to the token.
      if (totalMove < 6) { this.rerender(); return; }
      draggedObj.setDepth(0).setAlpha(1);
      const strip = this.ownedColumns;
      if (strip && strip.sellRect.contains(p.worldX, p.worldY)) {
        this.pendingSell = this.sellRefFor(src);
        this.rerender();
        return;
      }
      const hit = this.columnHitTest(p.worldX, p.worldY);
      if (hit) {
        const rearrangeSrc = src.kind === 'board' ? { location: 'board' as const, index: src.index } : { location: 'bag' as const, index: src.index };
        const outcome = hit.where === 'board'
          ? moveToBoard(this.pieces, this.bagSlots, skillBook, rearrangeSrc, hit.slot, BOARD_BAG_SLOTS)
          : moveToBag(this.pieces, this.bagSlots, skillBook, rearrangeSrc, hit.slot, BOARD_BAG_SLOTS);
        if (outcome) this.applyRearrange(outcome);
        else this.invalidFlash = { where: hit.where, index: hit.slot };
      }
      this.rerender();
    });

    this.input.on('wheel', (pointer: Phaser.Input.Pointer, _o: unknown, _dx: number, dy: number) => {
      if (this.shelfMaxScroll <= 0 || !inViewport(pointer.worldX, pointer.worldY)) return;
      this.shelfScrollY = Phaser.Math.Clamp(this.shelfScrollY - dy, -this.shelfMaxScroll, 0);
      this.shelfContainer?.setY(this.shelfScrollY);
      this.syncShelfScrollAffordance();
    });
  }

  // ---------- BUY confirm ----------

  /** Duplicate-merge target for the pending CARD buy, or null (no owned
   * mergeable copy / this is a gem buy). Sourced from the run in Run Mode,
   * `demoState` in the Sandbox — same split every other shop query uses. */
  private mergeTargetForPendingBuy(shopId: string, runMode: boolean): MergeTarget | null {
    const buy = this.pendingBuy;
    if (!buy || buy.kind !== 'card') return null;
    const offer = this.shelfFor(shopId).cards[buy.index];
    if (!offer) return null;
    return runMode ? currentShopMergeTarget(offer.skillId) : mergeTargetFor(offer.skillId);
  }

  private renderConfirm(): void {
    const shopId = this.activeShopId();
    const shelf = this.shelfFor(shopId);
    const runMode = this.isRunMode();
    const buy = this.pendingBuy!;
    const name = buy.kind === 'card'
      ? (skillBook[shelf.cards[buy.index]?.skillId ?? '']?.name ?? 'card')
      : (gemBook[shelf.gems[buy.index]?.gemId ?? '']?.name ?? 'gem');
    const price = buy.kind === 'card' ? shelf.cards[buy.index]?.price ?? 0 : shelf.gems[buy.index]?.price ?? 0;
    const mergeTarget = this.mergeTargetForPendingBuy(shopId, runMode);
    const dest = buy.kind === 'card' ? buy.dest : undefined;

    this.add.rectangle(0, 0, SCREEN.width, SCREEN.height, UI.shadow, 0.72).setOrigin(0, 0).setInteractive();
    const bw = 460;
    const bh = mergeTarget ? 216 : 180;
    const bx = SCREEN.width / 2 - bw / 2; const by = SCREEN.height / 2 - bh / 2;
    this.add.rectangle(bx, by, bw, bh, UI.panelAlt).setOrigin(0, 0).setStrokeStyle(2, UI.chip);
    const headline = dest
      ? `BUY → ${dest.where.toUpperCase()} SLOT ${dest.slot + 1} · ${price} GOLD`
      : `Buy ${name} for ${price} gold?`;
    const confirmHeadline = this.add.text(SCREEN.width / 2, by + 34, headline, { fontSize: `${F.name}px`, color: UI.text, fontFamily: FONT.display, fontStyle: 'bold' }).setOrigin(0.5);
    addRunArt(this, RUN_ART_KEYS.icon.coin, {
      x: confirmHeadline.x - confirmHeadline.width / 2 - 30,
      y: by + 22,
      width: 24,
      height: 24,
    });
    this.add.text(SCREEN.width / 2, by + 66, dest ? name : 'This offer leaves the shelf once bought.', { fontSize: `${F.small}px`, color: UI.textDim, fontFamily: FONT.body }).setOrigin(0.5);
    if (mergeTarget) {
      this.add.text(SCREEN.width / 2, by + 90, `You already own this — MERGE → ${name} ${mergeTarget.toTier.toUpperCase()} (${mergeTarget.fromTier.toUpperCase()} → ${mergeTarget.toTier.toUpperCase()})`, {
        fontSize: `${F.tiny}px`, color: UI.textAccent, fontFamily: FONT.body, fontStyle: 'bold', align: 'center', wordWrap: { width: bw - 40 },
      }).setOrigin(0.5, 0);
    }

    type ConfirmButton = { label: string; fill: number; color: string; fn: () => void };
    const doBuy = (): void => {
      const result = runMode
        ? (buy.kind === 'card' ? (dest ? buyCurrentShopCardTo(buy.index, dest) : buyCurrentShopCard(buy.index)) : buyCurrentShopGem(buy.index))
        : (buy.kind === 'card' ? (dest ? buyCardTo(shopId, buy.index, dest) : buyCard(shopId, buy.index)) : buyGem(shopId, buy.index));
      this.pendingBuy = null;
      this.detailCardIndex = null;
      this.detailGemIndex = null;
      this.rerender();
      if (!result.ok) this.showToast(result.reason === 'bag' || result.reason === 'slot' ? 'No room there — purchase cancelled' : 'Could not complete purchase', UI.bad);
      else { playSfx('purchase'); this.showToast(`Bought ${name}`, UI.good); }
    };
    const doMerge = (): void => {
      const result = runMode ? mergeCurrentShopCard(buy.index) : mergeCard(shopId, buy.index);
      this.pendingBuy = null;
      this.detailCardIndex = null;
      this.detailGemIndex = null;
      this.rerender();
      if (!result.ok) this.showToast('Could not complete merge', UI.bad);
      else { playSfx('purchase'); this.showToast(`Merged into ${mergeTarget!.toTier.toUpperCase()} ${name}`, UI.good); }
    };

    const buttons: ConfirmButton[] = [
      { label: 'CANCEL', fill: UI.panelMuted, color: UI.text, fn: () => { playSfx('uiBack'); this.pendingBuy = null; this.rerender(); } },
      { label: 'BUY', fill: UI.chip, color: UI.textOnChip, fn: doBuy },
    ];
    if (mergeTarget) buttons.push({ label: 'MERGE', fill: UI.good, color: UI.textOnChip, fn: doMerge });

    const margin = 20; const gap = 20;
    const btnW = (bw - margin * 2 - gap * (buttons.length - 1)) / buttons.length;
    const btnY = by + bh - 64;
    buttons.forEach((b, i) => {
      const dx = bx + margin + i * (btnW + gap);
      const r = this.add.rectangle(dx, btnY, btnW, 44, b.fill).setOrigin(0, 0).setStrokeStyle(1, UI.border, 0.7).setInteractive({ useHandCursor: true });
      // The BOARD/BAG columns now sit directly under this dialog, so this
      // exact click would otherwise also be reprocessed as a board/bag tap
      // once `b.fn()`'s `rerender()` closes it — `wasPointerConsumedByRebuild`
      // (sceneRebuild.ts) is what stops that; see `wireDrag`'s pointerdown.
      r.on('pointerdown', () => { b.fn(); });
      this.add.text(dx + btnW / 2, btnY + 22, b.label, { fontSize: `${F.body}px`, color: b.color, fontFamily: FONT.body, fontStyle: 'bold' }).setOrigin(0.5);
    });
  }

  // ---------- SELL confirm ----------

  private renderSellConfirm(): void {
    const sell = this.pendingSell;
    if (!sell) return;
    const preview = this.sellPreview(sell);
    if (!preview) { this.pendingSell = null; return; }
    const runMode = this.isRunMode();

    this.add.rectangle(0, 0, SCREEN.width, SCREEN.height, UI.shadow, 0.72).setOrigin(0, 0).setInteractive();
    const bw = 460; const bh = 160;
    const bx = SCREEN.width / 2 - bw / 2; const by = SCREEN.height / 2 - bh / 2;
    this.add.rectangle(bx, by, bw, bh, UI.panelAlt).setOrigin(0, 0).setStrokeStyle(2, UI.bad);
    this.add.text(SCREEN.width / 2, by + 34, `SELL ${preview.name} ${preview.tierLabel}`, { fontSize: `${F.name}px`, color: UI.text, fontFamily: FONT.display, fontStyle: 'bold' }).setOrigin(0.5);
    this.add.text(SCREEN.width / 2, by + 66, `→ +${preview.price} GOLD`, { fontSize: `${F.small}px`, color: BAD_HEX, fontFamily: FONT.body, fontStyle: 'bold' }).setOrigin(0.5);

    const doSell = (): void => {
      const result = sell.location === 'gem'
        ? (runMode ? sellCurrentRunGem(sell.index) : sellGem(sell.index))
        : (runMode ? sellCurrentRunCard(sell.location, sell.index) : sellCard(sell.location, sell.index));
      this.pendingSell = null;
      this.rerender();
      if (!result.ok) this.showToast('Could not complete sale', UI.bad);
      else { playSfx('uiClick'); this.showToast(`Sold ${preview.name} · +${result.goldReceived} gold`, UI.good); }
    };

    const margin = 20; const gap = 20;
    const btnW = (bw - margin * 2 - gap) / 2;
    const btnY = by + bh - 64;
    const cancel = this.add.rectangle(bx + margin, btnY, btnW, 44, UI.panelMuted).setOrigin(0, 0).setStrokeStyle(1, UI.border, 0.7).setInteractive({ useHandCursor: true });
    this.add.text(bx + margin + btnW / 2, btnY + 22, 'CANCEL', { fontSize: `${F.body}px`, color: UI.text, fontFamily: FONT.body, fontStyle: 'bold' }).setOrigin(0.5);
    cancel.on('pointerdown', () => { playSfx('uiBack'); this.pendingSell = null; this.rerender(); });
    const sellBtn = this.add.rectangle(bx + margin + btnW + gap, btnY, btnW, 44, UI.bad).setOrigin(0, 0).setStrokeStyle(1, UI.bad, 1).setInteractive({ useHandCursor: true });
    this.add.text(bx + margin + btnW + gap + btnW / 2, btnY + 22, 'SELL', { fontSize: `${F.body}px`, color: UI.textOnChip, fontFamily: FONT.body, fontStyle: 'bold' }).setOrigin(0.5);
    sellBtn.on('pointerdown', () => { doSell(); });
  }

  private showToast(text: string, color: number): void {
    for (const o of this.toastObjects) o.destroy();
    this.toastObjects = [];
    const y = SCREEN.height - DESKTOP_PROFILE.safe.bottom - 40;
    const label = this.add.text(SCREEN.width / 2, y, text, {
      fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${F.label}px`, color: color === UI.good ? '#9ad17a' : '#e8907a',
    }).setOrigin(0.5).setDepth(4001);
    const bg = this.add.rectangle(SCREEN.width / 2, y, label.width + 24, label.height + 14, UI.panelMuted, 0.94)
      .setOrigin(0.5).setDepth(4000).setStrokeStyle(1, UI.border, 0.8);
    this.toastObjects = [bg, label];
    this.tweens.add({ targets: [label, bg], alpha: 0, delay: 1200, duration: 500, onComplete: () => { for (const o of this.toastObjects) o.destroy(); this.toastObjects = []; } });
  }
}
