import Phaser from 'phaser';
import { renderGemDetailsDrawer, type GemDetailsSlot } from '../ui/gemDetailsDrawer';
import { GemToken } from '../ui/GemToken';
import { instancePowerLevelDeci } from '../../engine/balance';
import { CardDetailActivation } from '../ui/cardDetailActivation';
import { renderCardDetailsDrawer } from '../ui/cardDetailsDrawer';
import { positionRunDestination, type EmbeddedRunDestination } from '../ui/RunDestinationHost';
import { renderSkillText } from '../../engine/keywords/compose';
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
  currentRunBagSlots, currentRunGemInventory, currentRunPieces, currentShopMergeTarget, currentShopRerollCost,
  currentShopShelf, ensureCurrentShopShelf, getActiveRun, leaveCurrentShop, mergeCurrentShopCard, rerollCurrentShop,
  retireActiveRun, sellCurrentRunCard, sellCurrentRunGem, setCurrentRunBagSlots, setCurrentRunGemInventory,
  setCurrentRunPieces,
} from '../runStore';
import type { MergeTarget } from '../../run/shop';
import { stripCardTextMarkup } from '../ui/cardTextMarkup';
import { DESKTOP_PROFILE } from '../layoutProfile';
import { FONT, GEM_RARITY_COLOR, SCREEN, TIER_COLOR, textRoleFor, UI } from '../theme';
import { CardToken } from '../ui/CardToken';
import { boxCenter, captionCell, captionCellHeight, DESKTOP_SHELF_CARD_TOKEN_H, SHELF_PRICE_STRIP_H, type CellBox } from '../ui/cardCellLayout';
import { FantasyCardTemplateV2 } from '../ui/FantasyCardTemplateV2';
import { renderCardInfoBox } from '../ui/cardInfoBox';
import { DESKTOP_LAYOUT, renderDesktopBackground, renderDesktopHeader } from '../ui/DesktopNav';
import { renderRetireConfirm, renderRunHud, snapshotRunProgress } from '../ui/RunProgressStrip';
import { addBrightRunArt, addRunArt, RUN_ART_KEYS, shopArtKey } from '../ui/runArt';
import { BRIGHT_ART_TREATMENT } from '../ui/brightArtTreatment';
import { auditControlLabel } from '../ui/controlLayoutAudit';
import {
  desktopShopBannerControlLayout,
  desktopShopDragVisualPlan,
  desktopShopEmbeddedViewHeight,
  desktopShopInventoryTabs,
  desktopShopOfferGridLayout,
  desktopShopPage,
  desktopShopStorefrontLayout,
  desktopShopWorkspaceLayout,
  type DesktopShopBox,
  type DesktopShopInventoryTab,
} from '../ui/desktopShopLayout';
import { classifyShopShelfGesture } from '../ui/shopGestureArbitration';
import { bindShopShelfMaskSync, setShopShelfScrollPosition } from '../ui/shopShelfScroll';
import { runScreenLayoutRef } from '../ui/runScreenLayout';
import { setDeckBuildContext } from '../deckBuildContext';
import { rebuildScene, wasPointerConsumedByRebuild } from '../sceneRebuild';
import { BoardColumn, type ColumnPiece } from '../ui/BoardColumn';
import { tierUpgradePreview } from '../ui/tierUpgradePreview';
import { renderTierUpgradeDetailOverlay } from '../ui/tierUpgradeDetailOverlay';
import { tierProgressMergeLine } from '../ui/tierProgressDisplay';
import { renderGemText } from '../../engine/keywords/gemText';

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
/** Gap between the [shelf | BOARD | BAG] regions. */
const OWNED_COL_GAP = DESKTOP_LAYOUT.gap;
/** Vertical gap between rows inside a BOARD/BAG column. */
const OWNED_ROW_GAP = 8;
const SELL_ZONE_H = 40;
const SHOP_HEADER_H = 56;

type PendingBuy = { kind: 'card'; index: number; dest?: BuyDestination } | { kind: 'gem'; index: number };
type PendingSell = { location: 'board' | 'bag' | 'gem'; index: number };

/** A manual-drag participant — mirrors the DeckBuild scenes' `Source`/
 * `draggables` idiom (hit-test rect + <8px tap guard + a moving visual),
 * extended to cover shelf offers (BUY) and owned board/bag/pouch items
 * (SELL) in one unified drag system. */
type DragSource =
  | { kind: 'shelfCard'; index: number }
  /** A shelf GEM offer — tap-only (no drop target, unlike `shelfCard`'s
   * drag-to-board/bag), but still routed through this same unified system
   * (rather than a bespoke native `setInteractive`) so it shares the
   * `shelfCard` viewport gate below. See `wireDrag`'s pointerdown doc
   * comment for why that gate is load-bearing: a shelf row scrolled below
   * the masked viewport keeps its full, unclipped hit box (Phaser masks
   * clip rendering, never input), and this scene's shelf container renders
   * ON TOP of the run HUD (added later in `create()`) — a mobile-twin bug
   * (LEAVE SHOP unresponsive after 2 rerolls) confirmed this is a real
   * hazard, not merely theoretical, on this same rerender pattern. */
  | { kind: 'shelfGem'; index: number }
  | { kind: 'board'; index: number } // index into `this.pieces`
  | { kind: 'bag'; index: number } // slot index into `this.bagSlots`
  | { kind: 'gem'; index: number }; // index into `this.gemInventory`

/** `obj` is a `Container` for every OTHER drag source (CardToken/board-bag
 * tokens/pouch gem box) but a plain `Rectangle` for `shelfGem` (no per-row
 * container exists — the row's texts are siblings, not children, so only the
 * backing cell needs a hit box). Every op this scene runs on `.obj`
 * (`setPosition`/`setDepth`/`setAlpha`) exists on both. */
interface DragEntry {
  bounds: Phaser.Geom.Rectangle;
  src: DragSource;
  obj: Phaser.GameObjects.Container | Phaser.GameObjects.Rectangle;
}

/**
 * Geometry the drag hit-testing (`wireDrag`) and the invalid-drop flash need
 * to agree with what `renderOwnedColumns` actually drew — computed once per
 * render, shared by both.
 */
interface OwnedColumnLayout {
  boardX: number;
  bagX: number;
  boardW: number;
  bagW: number;
  colTop: number;
  rowH: number;
  rowGap: number;
  sellRect: Phaser.Geom.Rectangle;
}

/**
 * Desktop Shop — storefront picker (21 themed shops) → shelf view (card
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
 * horizontal 92px mini-token strip.
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
  private embedded: EmbeddedRunDestination | undefined;
  private get viewWidth(): number { return this.embedded?.bounds.width ?? SCREEN.width; }
  private get viewHeight(): number { return desktopShopEmbeddedViewHeight(this.embedded?.bounds.height, SCREEN.height); }
  private get dockWidth(): number { return this.embedded ? Math.min(360, this.viewWidth * 0.3) : 380; }
  private get contentTop(): number { return this.embedded ? 12 : TEMPLATE.regions.content.y; }
  private selectedShop: string | null = null;
  private storefrontPage = 0;
  private readonly detailActivation = new CardDetailActivation();
  private detailCardIndex: number | null = null;
  private detailGemIndex: number | null = null;
  private inspectGemIndex: number | null = null;
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
  /** Destination-card inspect sits above the still-live buy/merge confirm. */
  private mergePreviewOpen = false;
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
  private inventoryTab: DesktopShopInventoryTab = 'bag';
  private inventoryContainer: Phaser.GameObjects.Container | null = null;
  private inventoryScrollY = 0;
  private inventoryThumb: Phaser.GameObjects.Rectangle | null = null;
  private inventoryViewport = { x: 0, y: 0, width: 0, height: 0 };
  private inventoryMaxScroll = 0;

  private setShelfScrollPosition(y: number): void {
    setShopShelfScrollPosition(this.shelfContainer, y);
  }

  private setInventoryScrollPosition(y: number): void {
    this.inventoryContainer?.setY(y);
    if (!this.inventoryThumb || this.inventoryMaxScroll <= 0) return;
    const v = this.inventoryViewport;
    const progress = Phaser.Math.Clamp(-y / this.inventoryMaxScroll, 0, 1);
    this.inventoryThumb.y = v.y + (v.height - this.inventoryThumb.height) * progress;
  }

  private draggables: DragEntry[] = [];
  private ownedColumns: OwnedColumnLayout | null = null;
  private sellZoneRectObj: Phaser.GameObjects.Rectangle | null = null;
  private sellZoneLabelObj: Phaser.GameObjects.Text | null = null;

  constructor() { super('DesktopShop'); }

  init(data?: { embedded?: EmbeddedRunDestination }): void {
    this.embedded = data?.embedded;
    this.selectedShop = null;
    this.storefrontPage = 0;
    this.detailCardIndex = null;
    this.detailGemIndex = null;
    this.inspectGemIndex = null;
    this.detailTier = 'bronze';
    this.inspectOwned = null;
    this.pendingBuy = null;
    this.mergePreviewOpen = false;
    this.pendingSell = null;
    this.invalidFlash = null;
    this.toastObjects = [];
    this.retireConfirmOpen = false;
    this.shelfScrollY = 0;
    this.inventoryTab = 'bag';
    this.inventoryScrollY = 0;
    // rebuildScene() destroys the game objects but NOT the fields pointing at
    // them — a stale Rectangle here would be repositioned by
    // `syncShelfScrollAffordance` after its destruction (scene-rebuild idiom).
    this.shelfThumb = null;
    this.shelfFadeTop = null;
    this.shelfFadeBottom = null;
  }

  private rerender(): void { rebuildScene(this); this.embedded?.onChanged(); }

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
  private ownedColumnX(): { areaRight: number; boardX: number; bagX: number; boardW: number; bagW: number; shelfRight: number } {
    const gx = this.embedded ? 12 : DESKTOP_LAYOUT.gutter;
    const layout = desktopShopWorkspaceLayout(this.viewWidth, this.viewHeight, gx, OWNED_COL_GAP);
    return {
      areaRight: layout.inventory.x + layout.inventory.width,
      boardX: layout.board.x,
      bagX: layout.inventory.x,
      boardW: layout.board.width,
      bagW: layout.inventory.width,
      shelfRight: layout.shelf.x + layout.shelf.width,
    };
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
    this.detailActivation.reset();
    this.draggables = [];
    this.shelfContainer = null;
    this.inventoryContainer = null;
    this.inventoryThumb = null;
    this.inventoryMaxScroll = 0;
    this.ownedColumns = null;
    this.sellZoneRectObj = null;
    this.sellZoneLabelObj = null;
    if (!this.embedded) renderDesktopBackground(this);
    const runShop = this.runShopId();
    if (runShop) {
      if (!this.embedded) this.renderHud(runShop);
    } else {
      renderDesktopHeader(this, 'SHOP', 'shop');
      this.renderGoldBalance();
    }
    const shopId = runShop ?? this.selectedShop;
    if (shopId) {
      this.renderShelf(shopId);
      this.renderOwnedColumns(shopId);
    } else {
      this.renderStorefront();
    }
    this.wireDrag();
    if (this.pendingBuy) {
      this.renderConfirm();
      if (this.mergePreviewOpen) this.renderMergePreview();
    }
    else if (this.pendingSell) this.renderSellConfirm();
    else if (this.inspectOwned) this.renderOwnedCardDetail();
    else if (this.detailCardIndex !== null) this.renderCardDetail();
    else if (this.detailGemIndex !== null) this.renderGemDetail();
    else if (this.inspectGemIndex !== null) this.renderOwnedGemDetail();
    if (this.retireConfirmOpen) {
      renderRetireConfirm(this, {
        compact: false,
        onCancel: () => { this.retireConfirmOpen = false; this.rerender(); },
        onConfirm: () => { playSfx('runLose'); retireActiveRun(); this.scene.start('DesktopRunMap'); },
      });
    }
    const inspecting = this.pendingBuy || this.pendingSell || this.mergePreviewOpen;
    const sourceTop = this.embedded ? 0 : inspecting ? 0 : this.contentTop;
    positionRunDestination(this, this.embedded, {
      x: 0, y: sourceTop, width: this.viewWidth, height: this.viewHeight - sourceTop,
    });
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
    const gx = this.embedded ? 12 : DESKTOP_LAYOUT.gutter;
    this.add.text(this.viewWidth - gx, 102 + DESKTOP_LAYOUT.tabH / 2, this.goldLabel(), {
      fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${F.body}px`, color: UI.textAccent,
    }).setOrigin(1, 0.5);
  }

  // ---------- storefront ----------

  private renderStorefront(): void {
    const page = desktopShopPage(shopTypeIds, this.storefrontPage);
    this.storefrontPage = page.page;
    const layout = desktopShopStorefrontLayout(this.viewWidth, this.viewHeight, page.ids.length);
    const gx = layout.heading.x;
    const top = layout.heading.y;
    this.add.text(gx, top, 'CHOOSE A SHOP', { fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${F.label}px`, color: UI.textAccent });
    // Tighter than the shared DESKTOP_LAYOUT.gap — the picker grid is a dense
    // paged catalog, not a wall of tiny panels.
    // The 21-shop catalog is paged so every storefront stays large, readable,
    // on-canvas, and clickable.
    const cellW = layout.grid.cellWidth;
    const cellH = layout.grid.cellHeight;
    // The layout owns the mounted shop-front banner band. Its height remains
    // proportional if the desktop page geometry changes again.
    const bannerH = layout.grid.artHeight;
    page.ids.forEach((id, i) => {
      const shop = shopCatalog[id]!;
      const box = layout.grid.cell(i);
      const cx = box.x;
      const gridTopRow = box.y;
      const cell = this.add.rectangle(cx, gridTopRow, cellW, cellH, UI.panelAlt, 0.94)
        .setOrigin(0, 0).setStrokeStyle(1, UI.border, BRIGHT_ART_TREATMENT.storefront.idleStrokeAlpha).setInteractive({ useHandCursor: true });
      cell.on('pointerover', () => cell.setStrokeStyle(2, UI.chip, 1));
      cell.on('pointerout', () => cell.setStrokeStyle(1, UI.border, BRIGHT_ART_TREATMENT.storefront.idleStrokeAlpha));
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
      addBrightRunArt(this, shopArtKey(id), { x: cx, y: gridTopRow, width: cellW, height: bannerH }, BRIGHT_ART_TREATMENT.storefront);
      this.add.rectangle(cx, gridTopRow + bannerH, cellW, 1, UI.border, BRIGHT_ART_TREATMENT.storefront.dividerAlpha).setOrigin(0, 0);
      const tileTitle = this.add.text(cx + 16, gridTopRow + bannerH + 8, shop.name.toUpperCase(), {
        fontFamily: FONT.display, fontStyle: 'bold', fontSize: `${F.name}px`, color: UI.text,
      });
      // Same fix as the shelf header below: derive the tagline's y from the
      // title's own measured height instead of a hardcoded `F.name` guess,
      // so no theme's name+tagline pair can collide regardless of content.
      this.add.text(cx + 16, tileTitle.y + tileTitle.height + 4, shop.tagline, {
        fontFamily: FONT.body, fontSize: `${F.small}px`, color: UI.textDim,
        wordWrap: { width: cellW - 32 }, lineSpacing: 3,
      });
      this.add.text(cx + 16, gridTopRow + cellH - 20, `${shop.shelf.cards} CARDS · ${shop.shelf.gems} GEMS`, {
        fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${F.tiny}px`, color: UI.textAccent,
      });
    });

    const renderPageControl = (box: DesktopShopBox, label: string, enabled: boolean, onPress: () => void): void => {
      const fill = enabled ? UI.panelAlt : UI.panelMuted;
      const control = this.add.rectangle(box.x, box.y, box.width, box.height, fill, enabled ? 1 : 0.55)
        .setOrigin(0, 0).setStrokeStyle(1, enabled ? UI.chip : UI.border, enabled ? 0.8 : 0.4);
      const controlLabel = this.add.text(box.x + box.width / 2, layout.pager.labelY, label, {
        ...textRoleFor('desktop', 'label', { ink: enabled ? 'primary' : 'disabled' }),
      }).setOrigin(0.5);
      auditControlLabel(control, controlLabel, {
        name: `Desktop shop pager ${label}`,
        horizontalPadding: 10,
        verticalPadding: 6,
      });
      if (!enabled) return;
      control.setInteractive({ useHandCursor: true });
      control.on('pointerover', () => control.setFillStyle(UI.chipDark));
      control.on('pointerout', () => control.setFillStyle(fill));
      control.on('pointerdown', () => { playSfx('uiClick'); onPress(); this.rerender(); });
    };
    renderPageControl(layout.pager.previous, '‹ PREVIOUS', page.canPrevious, () => { this.storefrontPage = page.page - 1; });
    renderPageControl(layout.pager.next, 'NEXT ›', page.canNext, () => { this.storefrontPage = page.page + 1; });
    this.add.text(layout.pager.indicatorX, layout.pager.labelY, `PAGE ${page.page + 1} / ${page.pageCount}`, {
      ...textRoleFor('desktop', 'kicker', { ink: 'label' }),
    }).setOrigin(0.5);
  }

  // ---------- shelf ----------

  private renderShelf(shopId: string): void {
    const shop = shopCatalog[shopId]!;
    const shelf = this.shelfFor(shopId);
    const info = shopPoolInfo(shopId);
    const runShop = this.runShopId() === shopId;
    const gx = this.embedded ? 12 : DESKTOP_LAYOUT.gutter;
    // Run Mode's shop is entered straight from the map (no shop-picker to
    // navigate back through) and LEAVE SHOP lives in the HUD's fixed primary
    // slot now — so the run-context shelf starts at the HUD's content top
    // with no back button; the Sandbox keeps its own `‹ SHOPS` back nav.
    const top = runShop ? this.contentTop : DESKTOP_LAYOUT.contentTop;

    // The catalog owns the left lane; the permanent board and swappable
    // inventory lanes own the right. The shared pure layout keeps them apart.
    const { shelfRight } = this.ownedColumnX();
    const bottom = this.viewHeight - DESKTOP_PROFILE.safe.bottom;
    const footerTop = bottom - SELL_ZONE_H;

    addBrightRunArt(this, RUN_ART_KEYS.shopBanner, {
      x: gx,
      y: top,
      width: shelfRight - gx,
      height: SHOP_HEADER_H,
    }, { imageAlpha: 0.35, liftAlpha: 0.12 });

    let titleX = gx;
    if (!runShop) {
      const backW = 90;
      const back = this.add.rectangle(gx, top, backW, 28, UI.panelAlt).setOrigin(0, 0).setStrokeStyle(1, UI.border, 0.7).setInteractive({ useHandCursor: true });
      this.add.text(gx + backW / 2, top + 14, '‹ SHOPS', { fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${F.small}px`, color: UI.text }).setOrigin(0.5);
      back.on('pointerdown', () => { playSfx('uiBack'); this.selectedShop = null; this.rerender(); });
      titleX = gx + backW + 16;
    }
    // Position the tagline off the TITLE's own measured height (not a
    // hardcoded `F.name` guess) — the display font's real rendered line
    // height can exceed its nominal point size, and that gap is constant
    // across every shop name (it's a font-metrics fact, not a name-length
    // one), so a hand-tuned offset either overlaps EVERY theme's header or
    // none — it just depends on which theme a given run happens to land on.
    // Deriving the gap from `titleText.height` (same measurement `getBounds()`
    // uses) guarantees the tagline clears the title for every theme, long or
    // short, with no per-theme layout math to keep in sync with content.
    const titleText = this.add.text(titleX + 8, top + 8, shop.name.toUpperCase(), { fontFamily: FONT.display, fontStyle: 'bold', fontSize: `${F.name}px`, color: UI.textAccent, wordWrap: { width: Math.max(80, shelfRight - titleX - 152) }, maxLines: 1 });
    this.add.text(titleX + 8, titleText.y + titleText.height + 2, shop.tagline, { fontFamily: FONT.body, fontSize: `${F.small}px`, color: UI.textDim, wordWrap: { width: Math.max(80, shelfRight - titleX - 152) }, maxLines: 1 });

    // A thin shop whose WHOLE pool already fits the shelf can never reveal
    // anything new on reroll (docs/run-shops-design.md §2b, USER-LOCKED) —
    // hide it behind a "FULL STOCK" label rather than inviting a wasted gold.
    const rerollControl = desktopShopBannerControlLayout({
      x: gx,
      y: top,
      width: shelfRight - gx,
      height: SHOP_HEADER_H,
    });
    const rerollW = rerollControl.width;
    const rerollX = rerollControl.x;
    const rerollY = rerollControl.y;
    if (info.fullStock) {
      this.add.rectangle(rerollX, rerollY, rerollW, rerollControl.height, UI.panelMuted, 0.5).setOrigin(0, 0).setStrokeStyle(1, UI.border, 0.4);
      this.add.text(rerollX + rerollW / 2, rerollY + rerollControl.height / 2, 'FULL STOCK', {
        fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${F.small}px`, color: UI.textSoft,
      }).setOrigin(0.5);
    } else {
      // Run Mode's reroll cost escalates per node (1, 2, 3, 4… — see
      // `currentShopRerollCost`); the sandbox shop has no run node to key
      // off of and keeps its pre-existing flat 1-gold label/gate.
      const cost = runShop ? currentShopRerollCost() : 1;
      const canReroll = this.activeGold() >= cost;
      const reroll = this.add.rectangle(rerollX, rerollY, rerollW, rerollControl.height, canReroll ? UI.chip : UI.panelMuted, canReroll ? 1 : 0.5)
        .setOrigin(0, 0).setStrokeStyle(1, UI.border, canReroll ? 1 : 0.4);
      this.add.text(rerollX + rerollW / 2, rerollY + rerollControl.height / 2, `REROLL · ${cost} G`, {
        fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${F.small}px`, color: canReroll ? UI.textOnChip : UI.textSoft,
      }).setOrigin(0.5);
      if (canReroll) {
        reroll.setInteractive({ useHandCursor: true });
        reroll.on('pointerdown', () => { playSfx('purchase'); runShop ? rerollCurrentShop() : rerollShelf(shopId); this.rerender(); });
      }
    }

    const rowTop = top + SHOP_HEADER_H + 8;
    // Scrollable viewport for the CARDS+GEMS grid — runs the FULL remaining
    // height (down to `bottom`), unlike before: BOARD/BAG are now vertical
    // columns BESIDE the shelf (not a horizontal strip below it), so nothing
    // here needs to reserve room for them. Masking (not row-height clamping)
    // is what makes the shelf immune to overflow regardless of offer count.
    const viewportTop = rowTop;
    const viewportH = Math.max(40, footerTop - OWNED_COL_GAP - viewportTop);
    this.shelfViewport = { x: gx, y: viewportTop, width: shelfRight - gx, height: viewportH };

    const container = this.add.container(0, this.shelfScrollY);
    bindShopShelfMaskSync(container);
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
    const offerGrid = desktopShopOfferGridLayout(shelfRight - gx, viewportH, cardCols, info.gemSlots, Boolean(this.embedded));
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
      const gridCols = offerGrid.cardColumns;
      const rows = offerGrid.cardRows;
      const cardGap = DESKTOP_LAYOUT.gap;
      const cardW = (shelfRight - gx - cardGap * (gridCols - 1)) / gridCols;
      const rowW = gridCols * cardW + (gridCols - 1) * cardGap;
      const rowX = gx + (shelfRight - gx - rowW) / 2;
      const cardH = offerGrid.cardHeight || DESKTOP_SHELF_CARD_TOKEN_H;
      // The price strip is a RESERVED band under the card, never a chip on it
      // — `ui/cardCellLayout.ts`. This shelf has always worked that way (which
      // is why it never showed the `x2 SL 2 G` collision its mobile twin did);
      // routing it through the shared split is what puts BOTH platforms' shop
      // cells under one audit (`tests/game/cardChipClearanceAudit.test.ts`).
      const cellH = captionCellHeight(cardH, SHELF_PRICE_STRIP_H);
      const rowStride = cellH + offerGrid.rowGap;
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
        const cell: CellBox = { x: cx, y: cy, w: cardW, h: cellH };
        const { token: tokenBox, caption } = captionCell(cell, SHELF_PRICE_STRIP_H);
        const tok = new CardToken(this, tokenBox.x + tokenBox.w / 2, tokenBox.y + tokenBox.h / 2, skill, {
          width: tokenBox.w, height: tokenBox.h, side: 'left', tier: offer.tier,
        });
        A(tok);
        this.draggables.push({ bounds: new Phaser.Geom.Rectangle(cx, cy, cardW, cardH), src: { kind: 'shelfCard', index: i }, obj: tok });
        // MERGE affordance — same lookup the BUY confirm dialog already uses
        // (`mergeTargetForPendingBuy`'s sibling read, done here up front for
        // every shelf offer instead of just the pending one). Overlaid, not
        // baked into CardToken: the badge is shop-specific chrome, and
        // CardToken stays feature-agnostic for its other (battle/prep/deck
        // build/draft) callers.
        const shelfMergeTarget = runShop ? currentShopMergeTarget(offer.skillId, offer.tier) : mergeTargetFor(offer.skillId, offer.tier);
        if (shelfMergeTarget) A(this.renderMergeBadge(tokenBox.x, tokenBox.y, shelfMergeTarget, F.tiny, tokenBox.w, tokenBox.h));
        const affordable = this.activeGold() >= offer.price;
        const priceAt = boxCenter(caption);
        A(this.add.rectangle(caption.x, caption.y, caption.w, caption.h, UI.panelMuted, 0.95).setOrigin(0, 0).setStrokeStyle(1, UI.border, 0.6));
        A(this.add.text(priceAt.x, priceAt.y, `${offer.price} GOLD`, {
          fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${F.tiny}px`, color: affordable ? UI.textAccent : BAD_HEX,
        }).setOrigin(0.5));
      }
      sectionTop += (rows - 1) * rowStride + cellH + (this.embedded ? 14 : 24);
    }

    const gemCols = info.gemSlots;
    if (gemCols > 0) {
      A(this.add.text(gx, sectionTop, `GEMS · ${shelf.gems.length}/${gemCols}`, { fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${F.tiny}px`, color: UI.textDim }));
      sectionTop += F.tiny + 8;
      // The selected desktop design keeps a two-column gem shelf below the
      // two-column card shelf; only row height changes on shorter panels.
      const gridCols = offerGrid.gemColumns;
      const gemGap = DESKTOP_LAYOUT.gap;
      const gemW = (shelfRight - gx - gemGap * (gridCols - 1)) / gridCols;
      const gemRowW = gridCols * gemW + (gridCols - 1) * gemGap;
      const gemRowX = gx + (shelfRight - gx - gemRowW) / 2;
      const gemH = offerGrid.gemHeight;
      const gemRowStride = gemH + offerGrid.rowGap;
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
          .setOrigin(0, 0).setStrokeStyle(1, GEM_RARITY_COLOR[gem.rarity], 0.8));
        // Routed through the unified `draggables` system (see `DragSource`'s
        // `shelfGem` doc comment) instead of a native `setInteractive` +
        // `pointerdown` — that native form had no viewport gate, so a gem row
        // scrolled below the masked shelf viewport (a fresh, real offer, not
        // a non-interactive SOLD OUT placeholder) kept its full hit box and
        // could swallow taps aimed at content below it.
        this.draggables.push({ bounds: new Phaser.Geom.Rectangle(cx, cy, gemW, gemH), src: { kind: 'shelfGem', index: i }, obj: cell });
        const compactGem = gemH < 80;
        const gemInset = compactGem ? 10 : 16;
        const artSize = compactGem ? 32 : 40;
        A(new GemToken(this, cx + gemInset + artSize / 2, cy + gemH / 2, gem, { width: artSize, height: artSize }));
        const affordable = this.activeGold() >= offer.price;
        const price = A(this.add.text(cx + gemW - gemInset, cy, `${offer.price} GOLD`, {
          fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${F.tiny}px`, color: affordable ? UI.textAccent : BAD_HEX,
        }).setOrigin(1, 0));
        price.y = cy + (gemH - price.height) / 2;
        const textX = cx + gemInset + artSize + 10;
        const textW = Math.max(36, price.x - price.width - 10 - textX);
        const name = A(this.add.text(textX, cy, gem.name, {
          fontFamily: FONT.display, fontStyle: 'bold', fontSize: `${compactGem ? F.tiny : F.small}px`, color: UI.text,
          wordWrap: { width: textW }, maxLines: 1,
        }));
        const bodyText = stripCardTextMarkup(renderGemText(gem));
        const body = A(this.add.text(textX, cy, bodyText, {
          fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${F.tiny}px`, color: UI.textAccent,
          wordWrap: { width: textW }, lineSpacing: 2, maxLines: compactGem ? 1 : 2,
        }));
        name.y = cy + Math.max(4, (gemH - name.height - 4 - body.height) / 2);
        body.y = name.y + name.height + 4;
      }
      sectionTop += (offerGrid.gemRows - 1) * gemRowStride + gemH;
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

  /** Shop-only eligibility outline and opaque label; never changes CardToken or its mask. */
  private renderMergeBadge(x: number, y: number, target: MergeTarget, fontPx: number, cardW: number, cardH: number): Phaser.GameObjects.Container {
    const goodHex = `#${UI.good.toString(16).padStart(6, '0')}`;
    const tierHex = `#${TIER_COLOR[target.toTier].toString(16).padStart(6, '0')}`;
    const padX = 6, padY = 3;
    const prefix = this.add.text(0, 0, '▲ MERGE ', {
      fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${fontPx}px`, color: goodHex,
    }).setOrigin(0, 0);
    const suffix = this.add.text(0, 0, `→ ${target.toTier.toUpperCase()}`, {
      fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${fontPx}px`, color: tierHex,
    }).setOrigin(0, 0);
    const w = padX * 2 + prefix.width + suffix.width;
    const h = padY * 2 + Math.max(prefix.height, suffix.height);
    const left = (cardW - w) / 2, top = cardH - h - 4;
    prefix.x = left + padX; prefix.y = top + padY;
    suffix.x = prefix.x + prefix.width; suffix.y = top + padY;
    const outline = this.add.rectangle(0, 0, cardW, cardH, UI.good, 0).setOrigin(0, 0).setStrokeStyle(3, UI.good, 1);
    const plate = this.add.rectangle(left, top, w, h, 0x0b1420, 1).setOrigin(0, 0).setStrokeStyle(2, UI.good, 1);
    return this.add.container(x, y, [outline, plate, prefix, suffix]);
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

  // ---------- owned columns: permanent BOARD · swappable BAG/GEMS ----------

  /**
   * The board stays visible as a true ten-slot `BoardColumn`. The neighboring
   * owned lane swaps between the same regular card presentation for BAG and a
   * gem inventory view. The single SELL ZONE spans all three workspace lanes.
   */
  private renderOwnedColumns(shopId: string): void {
    const runShop = this.runShopId() === shopId;
    const top = runShop ? this.contentTop : DESKTOP_LAYOUT.contentTop;
    const bottom = this.viewHeight - DESKTOP_PROFILE.safe.bottom;
    const gx = this.embedded ? 12 : DESKTOP_LAYOUT.gutter;
    const { areaRight, boardX, bagX, boardW, bagW } = this.ownedColumnX();
    const headerH = 40;
    const labelY = top;
    const colTop = labelY + headerH + 8;
    const footerY = bottom - SELL_ZONE_H;
    const colBottom = footerY - OWNED_COL_GAP;
    const colH = Math.max(80, colBottom - colTop);
    const rowGap = OWNED_ROW_GAP;
    const rowH = (colH - rowGap * (BOARD_BAG_SLOTS - 1)) / BOARD_BAG_SLOTS;

    this.add.rectangle(boardX, labelY, boardW, headerH, UI.panelAlt, 0.96).setOrigin(0, 0).setStrokeStyle(1, UI.border, 0.8);
    this.add.text(boardX + 12, labelY + headerH / 2, `YOUR BOARD · ${this.boardOccupied().filter(Boolean).length}/${BOARD_BAG_SLOTS}`, {
      fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${F.tiny}px`, color: UI.textAccent,
    }).setOrigin(0, 0.5);

    const tabs = desktopShopInventoryTabs(this.bagOccupied().filter(Boolean).length);
    const tabGap = 6;
    const tabW = (bagW - tabGap) / 2;
    tabs.forEach((tab, index) => {
      const x = bagX + index * (tabW + tabGap);
      const active = this.inventoryTab === tab.id;
      const box = this.add.rectangle(x, labelY, tabW, headerH, active ? UI.chip : UI.panelAlt, 1)
        .setOrigin(0, 0).setStrokeStyle(1, UI.border, active ? 1 : 0.8)
        .setInteractive({ useHandCursor: true });
      const label = this.add.text(x + tabW / 2, labelY + headerH / 2, tab.label, {
        fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${F.tiny}px`, color: active ? UI.textOnChip : UI.textAccent,
      }).setOrigin(0.5);
      auditControlLabel(box, label, { name: `Desktop shop ${tab.id} tab`, horizontalPadding: 10, verticalPadding: 6, minFontSize: 9 });
      box.on('pointerup', () => {
        if (this.inventoryTab === tab.id) return;
        playSfx('uiClick');
        this.inventoryTab = tab.id;
        // The embedded child also asks its parent host to rebuild. Finish the
        // physical click first so the new scene objects cannot receive the
        // same pointer event and navigate away from the shop.
        this.time.delayedCall(0, () => this.rerender());
      });
    });

    const boardPieces: ColumnPiece[] = [];
    const boardSkills: SkillDef[] = [];
    for (const p of this.pieces) {
      const base = skillBook[p.skillId];
      if (!base) continue;
      // Tier + socketed-gem fold (resolver seam, display-only) so YOUR BOARD's
      // face numbers match what the card actually casts — see `resolveDisplaySkill`.
      const skill = resolveDisplaySkill(base, p);
      boardPieces.push({ skill, slot: p.slot, tier: p.tier });
      boardSkills.push(skill);
    }
    const boardCol = new BoardColumn(this, {
      x: boardX, y: colTop, width: boardW, height: colH, side: 'left',
      slotCount: BOARD_BAG_SLOTS, gap: rowGap, pieces: boardPieces, deck: boardSkills,
    });
    this.wireColumnDraggables(boardCol, boardX, colTop, boardW, rowH, rowGap, (slot) => {
      const piece = this.pieces.find((p) => p.slot === slot);
      if (!piece || !skillBook[piece.skillId]) return null;
      return { size: this.sizeOf(piece.skillId), src: { kind: 'board', index: this.pieces.indexOf(piece) } };
    });

    if (this.inventoryTab === 'bag') {
      const bagPieces: ColumnPiece[] = [];
      const bagSkills: SkillDef[] = [];
      this.bagSlots.forEach((card, index) => {
        if (!card) return;
        const base = skillBook[card.skillId];
        if (!base) return;
        const skill = card.tier === base.tier ? base : applyTier(base, card.tier);
        bagPieces.push({ skill, slot: index, tier: card.tier });
        bagSkills.push(skill);
      });
      const bagCol = new BoardColumn(this, {
        x: bagX, y: colTop, width: bagW, height: colH, side: 'right',
        slotCount: BOARD_BAG_SLOTS, gap: rowGap, pieces: bagPieces, deck: bagSkills,
      });
      this.wireColumnDraggables(bagCol, bagX, colTop, bagW, rowH, rowGap, (slot) => {
        const card = this.bagSlots[slot];
        if (!card || !skillBook[card.skillId]) return null;
        return { size: this.sizeOf(card.skillId), src: { kind: 'bag', index: slot } };
      });
    } else {
      this.renderOwnedGemInventory(bagX, colTop, bagW, colH);
    }

    const rowX = gx;
    const rowW = areaRight - gx;
    const sellRect = new Phaser.Geom.Rectangle(rowX, footerY, rowW, SELL_ZONE_H);
    this.sellZoneRectObj = this.add.rectangle(rowX, footerY, rowW, SELL_ZONE_H, UI.badSoft, 0.35).setOrigin(0, 0).setStrokeStyle(1, UI.bad, 0.8);
    this.sellZoneLabelObj = this.add.text(rowX + rowW / 2, footerY + SELL_ZONE_H / 2, 'SELL ZONE — drag a card or gem here', {
      fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${F.tiny}px`, color: BAD_HEX,
    }).setOrigin(0.5);

    this.ownedColumns = { boardX, bagX, boardW, bagW, colTop, rowH, rowGap, sellRect };

    // One-shot invalid-drop flash — read + cleared here so it never survives
    // past the single rebuild it was set for.
    if (this.invalidFlash) {
      const flash = this.invalidFlash;
      this.invalidFlash = null;
      const fx = flash.where === 'board' ? boardX : bagX;
      const fw = flash.where === 'board' ? boardW : bagW;
      const fy = colTop + flash.index * (rowH + rowGap);
      const overlay = this.add.rectangle(fx, fy, fw, rowH, UI.bad, 0.6).setOrigin(0, 0).setStrokeStyle(2, UI.bad, 1);
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

  /** The GEMS tab owns the same full-height lane as BAG and scrolls internally. */
  private renderOwnedGemInventory(x: number, y: number, width: number, height: number): void {
    this.inventoryViewport = { x, y, width, height };
    this.add.rectangle(x, y, width, height, UI.panel, 0.58).setOrigin(0, 0).setStrokeStyle(1, UI.border, 0.7);
    if (this.gemInventory.length === 0) {
      this.add.text(x + width / 2, y + 32, 'NO GEMS', {
        fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${F.tiny}px`, color: UI.textSoft,
      }).setOrigin(0.5, 0);
      return;
    }

    const inset = 8;
    const gap = 8;
    const cellH = 88;
    const cellW = width - inset * 2 - 4;
    const created: Phaser.GameObjects.GameObject[] = [];
    const container = this.add.container(0, this.inventoryScrollY);
    this.inventoryContainer = container;
    this.gemInventory.forEach((gemId, index) => {
      const gem = gemBook[gemId];
      if (!gem) return;
      const cx = x + inset;
      const cy = y + index * (cellH + gap);
      const tile = this.createOwnedGemTile(gem, cx, cy, cellW, cellH);
      created.push(tile);
      this.draggables.push({ bounds: new Phaser.Geom.Rectangle(cx, cy, cellW, cellH), src: { kind: 'gem', index }, obj: tile });
    });
    container.add(created);

    const contentH = this.gemInventory.length * (cellH + gap) - gap;
    this.inventoryMaxScroll = Math.max(0, contentH - height);
    this.inventoryScrollY = Phaser.Math.Clamp(this.inventoryScrollY, -this.inventoryMaxScroll, 0);
    container.setY(this.inventoryScrollY);
    const maskShape = this.make.graphics({}, false);
    maskShape.fillStyle(0xffffff).fillRect(x, y, width, height);
    container.setMask(maskShape.createGeometryMask());
    if (this.inventoryMaxScroll > 0) {
      const trackX = x + width - 4;
      this.add.rectangle(trackX, y, 4, height, UI.border, 0.35).setOrigin(0, 0);
      const thumbH = Math.max(24, height * height / contentH);
      this.inventoryThumb = this.add.rectangle(trackX, y, 4, thumbH, UI.chip, 0.9).setOrigin(0, 0);
      this.setInventoryScrollPosition(this.inventoryScrollY);
    }
  }

  private createOwnedGemTile(gem: GemDef, x: number, y: number, width: number, height: number): Phaser.GameObjects.Container {
    const tile = this.add.container(x, y);
    const bg = this.add.rectangle(0, 0, width, height, UI.panelAlt, 0.96).setOrigin(0, 0)
      .setStrokeStyle(1, GEM_RARITY_COLOR[gem.rarity], 0.9);
    const mark = new GemToken(this, 28, 28, gem, { width: 48, height: 48 });
    const name = this.add.text(58, 12, gem.name, {
      fontFamily: FONT.display, fontStyle: 'bold', fontSize: `${F.small}px`, color: UI.text,
      wordWrap: { width: width - 70 }, maxLines: 1,
    });
    const effect = this.add.text(12, 54, stripCardTextMarkup(renderGemText(gem)), {
      fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${F.tiny}px`, color: UI.textAccent,
      wordWrap: { width: width - 24 }, maxLines: 2,
    });
    tile.add([bg, mark, name, effect]);
    return tile;
  }

  /** Scene-root copy: unlike the source tile, this never inherits the lane mask. */
  private spawnOwnedGemDragProxy(index: number, bounds: Phaser.Geom.Rectangle): Phaser.GameObjects.Container | null {
    const gemId = this.gemInventory[index];
    const gem = gemId ? gemBook[gemId] : undefined;
    if (!gem) return null;
    return this.createOwnedGemTile(gem, bounds.x, bounds.y, bounds.width, bounds.height).setDepth(1000).setAlpha(0.9);
  }

  /** Full CardToken copy at world level so a shelf drag remains visible after
   * it leaves the masked catalog viewport, matching the Bag drag treatment. */
  private spawnShelfCardDragProxy(token: CardToken, bounds: Phaser.Geom.Rectangle): CardToken {
    return new CardToken(this, bounds.centerX, bounds.centerY, token.sourceSkill, {
      ...token.sourceOpts,
      width: bounds.width,
      height: bounds.height,
      state: 'none',
      onInspect: undefined,
    }).setDepth(1000).setAlpha(0.9);
  }

  // ---------- inspect dock (permanent right-hand panel, FULL height, unchanged) ----------

  /** The flagship density fix: a permanently docked inspect panel, same
   * idiom as `DesktopWikiScene`'s detail pane — tapping a card/gem tile
   * fills this dock in place instead of opening a full-screen overlay, so
   * the screen's right edge (previously empty once the shelf's few offers
   * had rendered) becomes the inspect surface. */
  private renderDock(shopId: string): void {
    const gx = this.embedded ? 12 : DESKTOP_LAYOUT.gutter;
    const runShop = this.runShopId() === shopId;
    const top = runShop ? this.contentTop : DESKTOP_LAYOUT.contentTop;
    const bottom = this.viewHeight - DESKTOP_PROFILE.safe.bottom;
    const dockX = this.viewWidth - gx - this.dockWidth;

    this.add.rectangle(dockX, top, this.dockWidth, bottom - top, UI.panel, 0.92)
      .setOrigin(0, 0).setStrokeStyle(1, UI.border, 0.8);

    if (this.inspectOwned) { this.renderOwnedCardDock(dockX, top, bottom); return; }
    if (this.detailCardIndex !== null) { this.renderLegacyCardDock(shopId, dockX, top, bottom); return; }
    if (this.detailGemIndex !== null) { this.renderGemDetail(); return; }

    this.add.text(dockX + this.dockWidth / 2, top + 48, 'Tap a card or gem on the shelf to inspect it here.', {
      fontFamily: FONT.body, fontSize: `${F.small}px`, color: UI.textDim, align: 'center', wordWrap: { width: this.dockWidth - 48 },
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

    const pw = this.dockWidth;
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
      this.add.text(centerX - pw / 2 + 48, rowY + 22, stripCardTextMarkup(renderGemText(gemDef)), {
        fontFamily: FONT.body, fontSize: `${F.tiny}px`, color: '#e8b446', wordWrap: { width: pw - 100 },
      }).setOrigin(0, 0);
      y = rowY + 40 + 8;
    }

    // THE FULL BODY *AND* THE KEYWORD DEFINITIONS, through the SAME
    // `renderCardInfoBox` -> `cardGlossaryEntries` route the Wiki, DeckBuild
    // and Draft use. This was a bare
    // `stripCardTextMarkup(renderSkillText(shown))` block: the markup stripped
    // (which is the only tap/hover cue) and no glossary anywhere on the scene.
    // THE SHOP IS WHERE THE PLAYER SPENDS GOLD, so it is the worst screen to
    // be unable to look a keyword up on — and it was a NET LOSS against HEAD,
    // whose pane printed the authored sentence complete with its inlined rule
    // ("Poison 8 (ticks at end of turn; bypasses shields)").
    //
    // The SOCKETED GEM is passed through so the box splits the card's own
    // clauses from the gem's, exactly as the deck-build socket panel does.
    const ownedInfoH = Math.max(60, (bottom - 44) - y);
    this.add.rectangle(px + 20, y, pw - 40, ownedInfoH, UI.panelAlt, 0.5)
      .setOrigin(0, 0).setStrokeStyle(1, UI.border, 0.5);
    renderCardInfoBox(this, px + 20, y, pw - 40, ownedInfoH, shown, { gem: gemDef ?? null });

    this.add.text(centerX, bottom - 32, 'Drag onto the SELL ZONE to sell.', {
      fontFamily: FONT.body, fontSize: `${F.tiny}px`, color: UI.textDim, align: 'center',
    }).setOrigin(0.5, 0);
  }

  private detailsView() {
    return { x: 0, y: this.embedded?.scrollY ?? 0, width: this.viewWidth,
      height: this.embedded?.bounds.height ?? this.viewHeight };
  }

  private renderOwnedCardDetail(): void {
    const owned = this.inspectOwned!;
    const card = owned.location === 'board' ? this.pieces[owned.index] : this.bagSlots[owned.index];
    if (!card) { this.inspectOwned = null; return; }
    const base = skillBook[card.skillId];
    if (!base) { this.inspectOwned = null; return; }
    const piece = owned.location === 'board' ? card as BoardPieceLike : null;
    const shown = piece ? resolveDisplaySkill(base, piece) : applyTier(base, card.tier);
    renderCardDetailsDrawer(this, shown, {
      compact: false, view: this.detailsView(),
      gem: piece?.gem ? gemBook[piece.gem.id] : null,
      powerDeci: instancePowerLevelDeci(applyTier(base, card.tier), piece ?? {}),
      onClose: () => { this.inspectOwned = null; this.rerender(); },
    });
  }

  private renderGemDetail(): void {
    const index = this.detailGemIndex!;
    const offer = this.shelfFor(this.activeShopId()).gems[index];
    const gem = offer ? gemBook[offer.gemId] : undefined;
    if (!offer || !gem) { this.detailGemIndex = null; return; }
    const affordable = this.activeGold() >= offer.price;
    renderGemDetailsDrawer(this, gem, {
      compact: false, view: this.detailsView(),
      onClose: () => { this.detailGemIndex = null; this.rerender(); },
      primaryAction: { label: affordable ? `BUY · ${offer.price} GOLD` : `NEED ${offer.price} GOLD`, enabled: affordable,
        onPress: () => { this.pendingBuy = { kind: 'gem', index }; this.rerender(); } },
    });
  }

  private renderOwnedGemDetail(): void {
    const slots: GemDetailsSlot[] = [];
    this.gemInventory.forEach((id, index) => {
      const gem = gemBook[id];
      if (!gem) return;
      slots.push({ key: `pouch:${index}`, label: `POUCH ${index + 1}`, gem, action: {
        label: 'SELL', enabled: true, onPress: () => {
          this.inspectGemIndex = null;
          this.pendingSell = { location: 'gem', index };
          this.rerender();
        },
      } });
    });
    const selected = slots.find(slot => slot.key === `pouch:${this.inspectGemIndex}`);
    if (!selected) { this.inspectGemIndex = null; return; }
    renderGemDetailsDrawer(this, selected.gem, {
      compact: false, view: this.detailsView(), slots, selectedKey: selected.key,
      onClose: () => { this.inspectGemIndex = null; this.rerender(); },
    });
  }
  private renderCardDetail(): void {
    const index = this.detailCardIndex!;
    const offer = this.shelfFor(this.activeShopId()).cards[index];
    if (!offer) { this.detailCardIndex = null; return; }
    const base = skillBook[offer.skillId]!;
    const shown = applyTier(base, this.detailTier);
    const runMode = this.isRunMode();
    const affordable = this.activeGold() >= offer.price;
    const hasRoom = runMode ? currentRunBagHasRoomFor(offer.skillId) : bagHasRoomFor(offer.skillId);
    const mergeTarget = runMode ? currentShopMergeTarget(offer.skillId, offer.tier) : mergeTargetFor(offer.skillId, offer.tier);
    const canBuy = affordable && (hasRoom || mergeTarget != null);
    const label = !affordable ? `NEED ${offer.price} GOLD` : !hasRoom && !mergeTarget ? 'BAG FULL' : !hasRoom ? 'MERGE AVAILABLE' : `BUY · ${offer.price} GOLD`;
    renderCardDetailsDrawer(this, shown, {
      compact: false, view: this.detailsView(),
      onClose: () => { this.detailCardIndex = null; this.rerender(); },
      primaryAction: { label, enabled: canBuy, onPress: () => {
        this.pendingBuy = { kind: 'card', index }; this.rerender();
      } },
      secondaryAction: mergeTarget ? { label: 'MERGE', enabled: affordable, onPress: () => {
        this.pendingBuy = { kind: 'card', index }; this.rerender();
      } } : undefined,
    });
  }

  private renderLegacyCardDock(shopId: string, px: number, py: number, bottom: number): void {
    const shelf = this.shelfFor(shopId);
    const offer = shelf.cards[this.detailCardIndex!];
    if (!offer) { this.detailCardIndex = null; return; }
    const base = skillBook[offer.skillId]!;
    const shown = this.detailTier === base.tier ? base : applyTier(base, this.detailTier);

    const pw = this.dockWidth;
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

    // THE FULL BODY *AND* THE KEYWORD DEFINITIONS, through the SAME
    // `renderCardInfoBox` -> `cardGlossaryEntries` route the Wiki, DeckBuild
    // and Draft use. This was a bare
    // `stripCardTextMarkup(renderSkillText(shown))` block: the markup stripped
    // (which is the only tap/hover cue) and no glossary anywhere on the scene.
    // THE SHOP IS WHERE THE PLAYER SPENDS GOLD, so it is the worst screen to
    // be unable to look a keyword up on — and it was a NET LOSS against HEAD,
    // whose pane printed the authored sentence complete with its inlined rule
    // ("Poison 8 (ticks at end of turn; bypasses shields)").
    const offerInfoTop = y;
    const offerInfoH = Math.max(60, (bottom - 56) - 12 - offerInfoTop);
    this.add.rectangle(px + 20, offerInfoTop, pw - 40, offerInfoH, UI.panelAlt, 0.5)
      .setOrigin(0, 0).setStrokeStyle(1, UI.border, 0.5);
    renderCardInfoBox(this, px + 20, offerInfoTop, pw - 40, offerInfoH, shown);

    const runMode = this.isRunMode();
    const affordable = this.activeGold() >= offer.price;
    const hasRoom = runMode ? currentRunBagHasRoomFor(offer.skillId) : bagHasRoomFor(offer.skillId);
    // A duplicate MERGE never needs bag room (it upgrades an already-owned
    // slot instead of adding a new one) — a full bag no longer blocks the
    // BUY button when a merge target exists.
    const mergeTarget = runMode ? currentShopMergeTarget(offer.skillId, offer.tier) : mergeTargetFor(offer.skillId, offer.tier);
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

  // ---------- unified manual drag: shelf→board/bag (BUY) · owned→SELL ZONE (SELL) ----------

  /** Shelf-card entries live inside the scrollable `shelfContainer` — their
   * captured `bounds` assume an unscrolled container, so hit-testing against
   * the pointer's WORLD coords must add the container's current scroll y. */
  private worldBounds(e: DragEntry): Phaser.Geom.Rectangle {
    // Both shelf-hosted kinds (`shelfCard`, `shelfGem`) live inside the
    // scrollable container — their captured `bounds` assume an unscrolled
    // container, exactly alike.
    if ((e.src.kind === 'shelfCard' || e.src.kind === 'shelfGem') && this.shelfContainer) {
      return new Phaser.Geom.Rectangle(e.bounds.x, e.bounds.y + this.shelfContainer.y, e.bounds.width, e.bounds.height);
    }
    if (e.src.kind === 'gem' && this.inventoryContainer) {
      return new Phaser.Geom.Rectangle(e.bounds.x, e.bounds.y + this.inventoryContainer.y, e.bounds.width, e.bounds.height);
    }
    return e.bounds;
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
    if (worldX >= strip.boardX && worldX <= strip.boardX + strip.boardW) where = 'board';
    else if (this.inventoryTab === 'bag' && worldX >= strip.bagX && worldX <= strip.bagX + strip.bagW) where = 'bag';
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
    let dragging: { src: DragSource; obj: Phaser.GameObjects.Container | Phaser.GameObjects.Rectangle; home?: { x: number; y: number } } | null = null;
    let ghost: Phaser.GameObjects.Container | null = null;
    let dropHint: Phaser.GameObjects.Rectangle | null = null;
    let dragProxy: Phaser.GameObjects.Container | null = null;
    let dragSourceObj: Phaser.GameObjects.Container | Phaser.GameObjects.Rectangle | null = null;
    let totalMove = 0;
    let start = { x: 0, y: 0 };
    let scrolling: { kind: 'shelf' | 'inventory'; startY: number; startScroll: number } | null = null;
    let pendingShelf: DragEntry | null = null;
    let pendingInventoryGem: DragEntry | null = null;
    let dragPickPlayedThisGesture = false;

    const beginDrag = (entry: DragEntry): void => {
      const visualKind = entry.src.kind === 'gem' ? 'gem'
        : entry.src.kind === 'shelfCard' ? 'shelf-card' : 'owned-card';
      const plan = desktopShopDragVisualPlan(visualKind);
      if (plan.useUnmaskedProxy && (entry.src.kind === 'gem' || entry.src.kind === 'shelfCard')) {
        const bounds = this.worldBounds(entry);
        const proxy = entry.src.kind === 'gem'
          ? this.spawnOwnedGemDragProxy(entry.src.index, bounds)
          : entry.obj instanceof CardToken ? this.spawnShelfCardDragProxy(entry.obj, bounds) : null;
        if (proxy) {
          dragProxy = proxy;
          dragSourceObj = entry.obj;
          entry.obj.setAlpha(plan.sourceAlpha);
          dragging = { src: entry.src, obj: proxy };
          if (entry.src.kind === 'shelfCard') {
            dropHint = this.add.rectangle(0, 0, 10, 10, UI.chip, 0.12).setOrigin(0, 0)
              .setStrokeStyle(2, UI.chip, 0.9).setVisible(false).setDepth(900);
          }
          return;
        }
      }
      dragging = { src: entry.src, obj: entry.obj, home: { x: entry.obj.x, y: entry.obj.y } };
      if ((entry.src.kind === 'board' || entry.src.kind === 'bag') && entry.obj instanceof CardToken) {
        ghost = entry.obj.spawnGhost();
        dropHint = this.add.rectangle(0, 0, 10, 10, UI.chip, 0.12).setOrigin(0, 0)
          .setStrokeStyle(2, UI.chip, 0.9).setVisible(false).setDepth(900);
      }
      if (plan.moveSource) entry.obj.setDepth(1000).setAlpha(plan.sourceAlpha);
    };

    const inViewport = (x: number, y: number): boolean => {
      const v = this.shelfViewport;
      return x >= v.x && x <= v.x + v.width && y >= v.y && y <= v.y + v.height;
    };
    const inInventoryViewport = (x: number, y: number): boolean => {
      const v = this.inventoryViewport;
      return this.inventoryTab === 'gems' && x >= v.x && x <= v.x + v.width && y >= v.y && y <= v.y + v.height;
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
      if (this.pendingBuy || this.pendingSell || this.retireConfirmOpen || this.inspectOwned || this.detailCardIndex !== null || this.detailGemIndex !== null || this.inspectGemIndex !== null) return;
      // A shelfCard/shelfGem's registered bounds are its UNCLIPPED position
      // inside the scrollable container — a row scrolled below the masked
      // viewport still has bounds sitting where it would be, invisible but
      // "clickable" there. Gate BOTH shelf-hosted kinds on `inViewport`, or a
      // scrolled-away row can steal a tap intended for whatever's actually
      // visible at that pixel (the BOARD/BAG columns, once the shelf is short
      // enough to need scrolling at all — true for mobile's default stock).
      const hit = this.draggables.find((d) => this.worldBounds(d).contains(p.worldX, p.worldY)
        && ((d.src.kind !== 'shelfCard' && d.src.kind !== 'shelfGem') || inViewport(p.worldX, p.worldY))
        && (d.src.kind !== 'gem' || !this.inventoryContainer || inInventoryViewport(p.worldX, p.worldY)));
      if (hit) {
        totalMove = 0;
        dragPickPlayedThisGesture = false;
        start = { x: p.worldX, y: p.worldY };
        if (hit.src.kind === 'shelfCard' || hit.src.kind === 'shelfGem') pendingShelf = hit;
        else if (hit.src.kind === 'gem') pendingInventoryGem = hit;
        else beginDrag(hit);
        return;
      }
      this.detailActivation.reset();
      if (this.shelfMaxScroll > 0 && inViewport(p.worldX, p.worldY)) {
        scrolling = { kind: 'shelf', startY: p.worldY, startScroll: this.shelfScrollY };
      } else if (this.inventoryMaxScroll > 0 && inInventoryViewport(p.worldX, p.worldY)) {
        scrolling = { kind: 'inventory', startY: p.worldY, startScroll: this.inventoryScrollY };
      }
    });

    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (pendingShelf) {
        const dx = p.worldX - start.x;
        const dy = p.worldY - start.y;
        const intent = classifyShopShelfGesture(dx, dy);
        if (intent === 'pending') return;
        this.detailActivation.reset();
        if (intent === 'scroll' && this.shelfMaxScroll > 0) {
          scrolling = { kind: 'shelf', startY: start.y, startScroll: this.shelfScrollY };
          pendingShelf = null;
          this.shelfScrollY = Phaser.Math.Clamp(scrolling.startScroll + dy, -this.shelfMaxScroll, 0);
          this.setShelfScrollPosition(this.shelfScrollY);
          this.syncShelfScrollAffordance();
          return;
        }
        const entry = pendingShelf;
        pendingShelf = null;
        beginDrag(entry);
      }
      if (pendingInventoryGem) {
        const dx = p.worldX - start.x;
        const dy = p.worldY - start.y;
        const intent = classifyShopShelfGesture(dx, dy);
        if (intent === 'pending') return;
        if (intent === 'scroll' && this.inventoryMaxScroll > 0) {
          scrolling = { kind: 'inventory', startY: start.y, startScroll: this.inventoryScrollY };
          pendingInventoryGem = null;
          this.inventoryScrollY = Phaser.Math.Clamp(scrolling.startScroll + dy, -this.inventoryMaxScroll, 0);
          this.setInventoryScrollPosition(this.inventoryScrollY);
          return;
        }
        const entry = pendingInventoryGem;
        pendingInventoryGem = null;
        beginDrag(entry);
      }
      if (dragging) {
        totalMove = Math.max(totalMove, Math.hypot(p.worldX - start.x, p.worldY - start.y));
        if (totalMove >= 6) {
          this.detailActivation.reset();
          if (!dragPickPlayedThisGesture) { dragPickPlayedThisGesture = true; playSfx('dragPick'); }
        }
        if (dragging.src.kind === 'shelfGem') {
          // Tap-only shelf offer (no drop target) — no drag visual, mirrors
          // the native-listener behavior this replaced; `totalMove` above is
          // still tracked for the tap-vs-drag threshold in `pointerup`.
        } else if (dragging.src.kind === 'shelfCard' && this.shelfContainer) {
          dragging.obj.setPosition(p.worldX, p.worldY - this.shelfContainer.y);
        } else {
          dragging.obj.setPosition(p.worldX, p.worldY);
        }
        if (dropHint && dragging.src.kind !== 'gem' && dragging.src.kind !== 'shelfGem') {
          const hit = this.columnHitTest(p.worldX, p.worldY);
          const layout = this.ownedColumns;
          if (hit && layout) {
            const x = hit.where === 'board' ? layout.boardX : layout.bagX;
            const width = hit.where === 'board' ? layout.boardW : layout.bagW;
            dropHint.setVisible(true).setPosition(x, layout.colTop + hit.slot * (layout.rowH + layout.rowGap))
              .setSize(width, layout.rowH);
          } else dropHint.setVisible(false);
        }
        if (dragging.src.kind !== 'shelfCard' && dragging.src.kind !== 'shelfGem' && this.sellZoneRectObj && this.sellZoneLabelObj) {
          const sell = this.sellRefFor(dragging.src);
          const hovering = sell != null && this.ownedColumns != null && this.ownedColumns.sellRect.contains(p.worldX, p.worldY);
          if (hovering && sell) {
            const preview = this.sellPreview(sell);
            this.sellZoneRectObj.setFillStyle(UI.bad, 0.55);
            if (preview) this.sellZoneLabelObj.setText(`SELL ${preview.name} ${preview.tierLabel} → +${preview.price} GOLD`);
          } else {
            this.sellZoneRectObj.setFillStyle(UI.badSoft, 0.35);
            this.sellZoneLabelObj.setText('SELL ZONE — drag a card or gem here');
          }
        }
        return;
      }
      if (scrolling) {
        if (scrolling.kind === 'shelf') {
          this.shelfScrollY = Phaser.Math.Clamp(scrolling.startScroll + (p.worldY - scrolling.startY), -this.shelfMaxScroll, 0);
          this.setShelfScrollPosition(this.shelfScrollY);
          this.syncShelfScrollAffordance();
        } else {
          this.inventoryScrollY = Phaser.Math.Clamp(scrolling.startScroll + (p.worldY - scrolling.startY), -this.inventoryMaxScroll, 0);
          this.setInventoryScrollPosition(this.inventoryScrollY);
        }
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
      if (pendingShelf) {
        beginDrag(pendingShelf);
        pendingShelf = null;
      }
      if (pendingInventoryGem) {
        beginDrag(pendingInventoryGem);
        pendingInventoryGem = null;
      }
      if (!dragging) return;
      const src = dragging.src;
      const draggedObj = dragging.obj;
      const home = dragging.home;
      dragging = null;
      ghost?.destroy(); ghost = null;
      dropHint?.destroy(); dropHint = null;
      const releasedProxy = dragProxy;
      dragProxy = null;
      releasedProxy?.destroy();
      dragSourceObj?.setAlpha(1);
      dragSourceObj = null;

      if (src.kind === 'shelfCard') {
        const shopId = this.activeShopId();
        const shelf = this.shelfFor(shopId);
        if (totalMove < 6) {
          if (home) draggedObj.setPosition(home.x, home.y);
          draggedObj.setDepth(0).setAlpha(1);
          if (!this.detailActivation.release(`shelf:${src.index}`, p.upTime)) return;
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
              playSfx('dragDrop');
              this.pendingBuy = { kind: 'card', index: src.index, dest: { where, slot } };
            } else {
              this.invalidFlash = { where, index: slot };
            }
          }
        }
        this.rerender();
        return;
      }

      // Shelf GEM offer: tap-only, same open-detail action the old native
      // `pointerdown` listener performed — see `DragSource`'s `shelfGem` doc
      // comment for why this now lives in the unified system instead.
      if (src.kind === 'shelfGem') {
        draggedObj.setDepth(0).setAlpha(1);
        if (totalMove < 6) {
          playSfx('uiClick');
          this.detailGemIndex = src.index;
          this.inspectOwned = null;
        }
        this.rerender();
        return;
      }

      // Inspect on tap; selling is explicit in details or by dragging to SELL ZONE.
      if (src.kind === 'gem') {
        if (totalMove < 6) {
          playSfx('uiClick');
          this.inspectGemIndex = src.index;
          this.rerender();
          return;
        }
        if (!releasedProxy) draggedObj.setDepth(0).setAlpha(1);
        const strip = this.ownedColumns;
        if (strip && strip.sellRect.contains(p.worldX, p.worldY)) {
          this.pendingSell = this.sellRefFor(src);
        }
        this.rerender();
        return;
      }

      // Completed same-card double activation opens details; a single release only restores its visual.
      if (totalMove < 6) {
        if (home) draggedObj.setPosition(home.x, home.y);
        draggedObj.setDepth(0).setAlpha(1);
        if (this.detailActivation.release(`${src.kind}:${src.index}`, p.upTime)) {
          this.inspectOwned = { location: src.kind, index: src.index };
          this.rerender();
        }
        return;
      }
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
        if (outcome) { playSfx('dragDrop'); this.applyRearrange(outcome); }
        else this.invalidFlash = { where: hit.where, index: hit.slot };
      }
      this.rerender();
    });

    this.input.on('pointerupoutside', () => {
      this.detailActivation.reset();
      if (dragging?.home) dragging.obj.setPosition(dragging.home.x, dragging.home.y).setDepth(0).setAlpha(1);
      ghost?.destroy(); ghost = null;
      dropHint?.destroy(); dropHint = null;
      pendingShelf = null;
      dragging = null;
      if (!dragProxy) return;
      dragProxy.destroy();
      dragProxy = null;
      dragSourceObj?.setAlpha(1);
      dragSourceObj = null;
      dragging = null;
      pendingInventoryGem = null;
      scrolling = null;
    });

    this.input.on('wheel', (pointer: Phaser.Input.Pointer, _o: unknown, _dx: number, dy: number) => {
      if (this.inspectOwned || this.detailCardIndex !== null || this.detailGemIndex !== null || this.inspectGemIndex !== null || this.pendingBuy || this.pendingSell) return;
      this.detailActivation.reset();
      if (this.inventoryMaxScroll > 0 && inInventoryViewport(pointer.worldX, pointer.worldY)) {
        this.inventoryScrollY = Phaser.Math.Clamp(this.inventoryScrollY - dy, -this.inventoryMaxScroll, 0);
        this.setInventoryScrollPosition(this.inventoryScrollY);
        return;
      }
      if (this.shelfMaxScroll > 0 && inViewport(pointer.worldX, pointer.worldY)) {
        this.shelfScrollY = Phaser.Math.Clamp(this.shelfScrollY - dy, -this.shelfMaxScroll, 0);
        this.setShelfScrollPosition(this.shelfScrollY);
        this.syncShelfScrollAffordance();
      }
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
    return runMode ? currentShopMergeTarget(offer.skillId, offer.tier) : mergeTargetFor(offer.skillId, offer.tier);
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
    const offeredSkillId = buy.kind === 'card' ? shelf.cards[buy.index]?.skillId : undefined;
    const preview = mergeTarget && offeredSkillId
      ? tierUpgradePreview(offeredSkillId, mergeTarget.fromTier, mergeTarget.toTier)
      : null;
    const mergePreview = preview?.available ? preview : null;
    const dest = buy.kind === 'card' ? buy.dest : undefined;

    this.add.rectangle(0, 0, this.viewWidth, this.viewHeight, UI.shadow, 0.72).setOrigin(0, 0).setInteractive();
    const bw = 460;
    const panel = this.add.rectangle(0, 0, bw, 180, UI.panelAlt).setOrigin(0, 0).setStrokeStyle(2, UI.chip);
    let contentY = 90;
    const mergeContent: Phaser.GameObjects.Text[] = [];
    if (mergeTarget) {
      const summary = this.add.text(bw / 2, contentY, `You already own this — MERGE → ${name} ${mergeTarget.toTier.toUpperCase()} (${mergeTarget.fromTier.toUpperCase()} → ${mergeTarget.toTier.toUpperCase()})`, {
        fontSize: `${F.tiny}px`, color: UI.textAccent, fontFamily: FONT.body, fontStyle: 'bold', align: 'center', wordWrap: { width: bw - 40 },
      }).setOrigin(0.5, 0);
      mergeContent.push(summary);
      contentY += summary.height + 12;
    }
    if (mergePreview?.conditionalTrade) {
      const guaranteedDelta = (mergePreview.guaranteedDeltaDeci / 10).toFixed(1).replace(/\.0$/, '');
      const warning = this.add.text(bw / 2, contentY, `CONDITIONAL UPGRADE · GUARANTEED POWER ${guaranteedDelta}`, {
        ...textRoleFor('desktop', 'kicker', { ink: 'alarm' }), align: 'center', wordWrap: { width: bw - 40 },
      }).setOrigin(0.5, 0);
      mergeContent.push(warning);
      contentY += warning.height + 12;
    }
    if (mergePreview) {
      const stats = this.add.text(20, contentY, `${mergePreview.toSkill.tier.toUpperCase()} UPGRADE\n${stripCardTextMarkup(renderSkillText(mergePreview.toSkill))}`, {
        fontSize: `${F.small}px`, color: UI.text, fontFamily: FONT.body, lineSpacing: 4, wordWrap: { width: bw - 40 },
      }).setOrigin(0, 0);
      mergeContent.push(stats);
      contentY += stats.height + 20;
    }
    const bh = mergeTarget ? contentY + 64 : 180;
    const bx = this.viewWidth / 2 - bw / 2; const by = this.viewHeight / 2 - bh / 2;
    panel.setPosition(bx, by).setSize(bw, bh);
    mergeContent.forEach(text => text.setPosition(bx + text.x, by + text.y));
    const headline = dest
      ? `BUY → ${dest.where.toUpperCase()} SLOT ${dest.slot + 1} · ${price} GOLD`
      : `Buy ${name} for ${price} gold?`;
    const confirmHeadline = this.add.text(this.viewWidth / 2, by + 34, headline, { fontSize: `${F.name}px`, color: UI.text, fontFamily: FONT.display, fontStyle: 'bold' }).setOrigin(0.5);
    addRunArt(this, RUN_ART_KEYS.icon.coin, {
      x: confirmHeadline.x - confirmHeadline.width / 2 - 30,
      y: by + 22,
      width: 24,
      height: 24,
    });
    this.add.text(this.viewWidth / 2, by + 66, dest ? name : 'This offer leaves the shelf once bought.', { fontSize: `${F.small}px`, color: UI.textDim, fontFamily: FONT.body }).setOrigin(0.5);

    type ConfirmButton = { label: string; fill: number; color: string; fn: () => void };
    const doBuy = (): void => {
      const result = runMode
        ? (buy.kind === 'card' ? (dest ? buyCurrentShopCardTo(buy.index, dest) : buyCurrentShopCard(buy.index)) : buyCurrentShopGem(buy.index))
        : (buy.kind === 'card' ? (dest ? buyCardTo(shopId, buy.index, dest) : buyCard(shopId, buy.index)) : buyGem(shopId, buy.index));
      this.pendingBuy = null;
      this.mergePreviewOpen = false;
      this.detailCardIndex = null;
      this.detailGemIndex = null;
      this.rerender();
      if (!result.ok) this.showToast(result.reason === 'bag' || result.reason === 'slot' ? 'No room there — purchase cancelled' : 'Could not complete purchase', UI.bad);
      else { playSfx('purchase'); this.showToast(`Bought ${name}`, UI.good); }
    };
    const doMerge = (): void => {
      const result = runMode ? mergeCurrentShopCard(buy.index) : mergeCard(shopId, buy.index);
      this.pendingBuy = null;
      this.mergePreviewOpen = false;
      this.detailCardIndex = null;
      this.detailGemIndex = null;
      this.rerender();
      if (!result.ok) this.showToast('Could not complete merge', UI.bad);
      else { playSfx('purchase'); this.showToast(`Merged into ${mergeTarget!.toTier.toUpperCase()} ${name}`, UI.good); }
    };

    const buttons: ConfirmButton[] = [
      { label: 'CANCEL', fill: UI.panelMuted, color: UI.text, fn: () => { playSfx('uiBack'); this.pendingBuy = null; this.mergePreviewOpen = false; this.rerender(); } },
      { label: 'ADD TO BAG', fill: UI.chip, color: UI.textOnChip, fn: doBuy },
    ];
    if (mergeTarget) {
      buttons.push({ label: 'MERGE', fill: UI.good, color: UI.textOnChip, fn: doMerge });
      buttons.push({ label: 'PREVIEW', fill: UI.panelMuted, color: UI.textAccent, fn: () => { playSfx('uiClick'); this.mergePreviewOpen = true; this.rerender(); } });
    }

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

  private renderMergePreview(): void {
    const shopId = this.activeShopId();
    const buy = this.pendingBuy;
    const target = this.mergeTargetForPendingBuy(shopId, this.isRunMode());
    const skillId = buy?.kind === 'card' ? this.shelfFor(shopId).cards[buy.index]?.skillId : undefined;
    if (!target || !skillId) { this.mergePreviewOpen = false; return; }
    const preview = tierUpgradePreview(skillId, target.fromTier, target.toTier);
    if (!preview.available) { this.mergePreviewOpen = false; return; }
    renderTierUpgradeDetailOverlay(this, preview, {
      font: F,
      mode: 'composition',
      actionWord: 'MERGE',
      progressLine: tierProgressMergeLine(
        { tier: target.fromTier, points: target.fromPoints },
        { tier: target.toTier, points: target.toPoints },
      ),
      onClose: () => { this.mergePreviewOpen = false; this.rerender(); },
    });
  }

  // ---------- SELL confirm ----------

  private renderSellConfirm(): void {
    const sell = this.pendingSell;
    if (!sell) return;
    const preview = this.sellPreview(sell);
    if (!preview) { this.pendingSell = null; return; }
    const runMode = this.isRunMode();

    this.add.rectangle(0, 0, this.viewWidth, this.viewHeight, UI.shadow, 0.72).setOrigin(0, 0).setInteractive();
    const bw = 460; const bh = 160;
    const bx = this.viewWidth / 2 - bw / 2; const by = this.viewHeight / 2 - bh / 2;
    this.add.rectangle(bx, by, bw, bh, UI.panelAlt).setOrigin(0, 0).setStrokeStyle(2, UI.bad);
    this.add.text(this.viewWidth / 2, by + 34, `SELL ${preview.name} ${preview.tierLabel}`, { fontSize: `${F.name}px`, color: UI.text, fontFamily: FONT.display, fontStyle: 'bold' }).setOrigin(0.5);
    this.add.text(this.viewWidth / 2, by + 66, `→ +${preview.price} GOLD`, { fontSize: `${F.small}px`, color: BAD_HEX, fontFamily: FONT.body, fontStyle: 'bold' }).setOrigin(0.5);

    const doSell = (): void => {
      const result = sell.location === 'gem'
        ? (runMode ? sellCurrentRunGem(sell.index) : sellGem(sell.index))
        : (runMode ? sellCurrentRunCard(sell.location, sell.index) : sellCard(sell.location, sell.index));
      this.pendingSell = null;
      this.rerender();
      if (!result.ok) this.showToast('Could not complete sale', UI.bad);
      else { playSfx('sell'); this.showToast(`Sold ${preview.name} · +${result.goldReceived} gold`, UI.good); }
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
    const y = this.viewHeight - DESKTOP_PROFILE.safe.bottom - 40;
    const label = this.add.text(this.viewWidth / 2, y, text, {
      fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${F.label}px`, color: color === UI.good ? UI.textGem : '#e8907a',
    }).setOrigin(0.5).setDepth(4001);
    const bg = this.add.rectangle(this.viewWidth / 2, y, label.width + 24, label.height + 14, UI.panelMuted, 0.94)
      .setOrigin(0.5).setDepth(4000).setStrokeStyle(1, UI.border, 0.8);
    this.toastObjects = [bg, label];
    this.tweens.add({ targets: [label, bg], alpha: 0, delay: 1200, duration: 500, onComplete: () => { for (const o of this.toastObjects) o.destroy(); this.toastObjects = []; } });
  }
}
