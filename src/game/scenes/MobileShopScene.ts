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
import { setDeckBuildContext } from '../deckBuildContext';
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
import { MOBILE_PROFILE } from '../layoutProfile';
import { FONT, GEM_RARITY_COLOR, SCREEN, textRole, TIER_COLOR, UI } from '../theme';
import { CardToken } from '../ui/CardToken';
import { boxCenter, gutterCell, MOBILE_SHELF_CARD_CELL_H, SHELF_PRICE_GUTTER_W, type CellBox } from '../ui/cardCellLayout';
import { FantasyCardTemplateV2 } from '../ui/FantasyCardTemplateV2';
import { renderCardInfoBox } from '../ui/cardInfoBox';
import { renderRetireConfirm, renderRunHud, snapshotRunProgress } from '../ui/RunProgressStrip';
import { addBrightRunArt, addRunArt, RUN_ART_KEYS, shopArtKey } from '../ui/runArt';
import { BRIGHT_ART_TREATMENT } from '../ui/brightArtTreatment';
import { auditControlLabel } from '../ui/controlLayoutAudit';
import { attachButtonFeel } from '../ui/motion';
import { runScreenLayoutRef } from '../ui/runScreenLayout';
import { rebuildScene, wasPointerConsumedByRebuild } from '../sceneRebuild';
import { BoardColumn, type ColumnPiece } from '../ui/BoardColumn';
import { renderCardDetailOverlay } from '../ui/cardDetailOverlay';
import { tierUpgradePreview } from '../ui/tierUpgradePreview';
import {
  activateMobileShopCard, closeMobileShopCardDetails, mobileRunShopBrowseLayout,
  mobileShopConfirmButtonLayout, mobileShopPage, mobileShopShelfHeaderLayout, mobileShopStorefrontLayout,
} from '../ui/mobileShopLayout';
import { classifyShopShelfGesture } from '../ui/shopGestureArbitration';
import { bindShopShelfMaskSync, setShopShelfScrollPosition } from '../ui/shopShelfScroll';
import { renderGemText } from '../../engine/keywords/gemText';

/** Structural shape shared by `ShopShelfState` (demoState) and `RunShopShelf`
 * (run) — the shop scene reads/writes through this either way. */
interface ShelfLike { cards: CardOffer[]; gems: GemOffer[]; rerollCount: number }

/** Structural (instanceId/skillId/tier/slot[/gem])-shaped board piece — matches
 * BOTH `OwnedBoardPiece` (sandbox) and `RunBoardPiece` (run), mirroring the
 * `pieces`/`bagSlots` split `MobileDeckBuildScene` already uses. */
type BoardPieceLike = { instanceId: string; skillId: string; tier: SkillTier; slot: number; gem?: Gem | null };
type BagSlotLike = { instanceId: string; skillId: string; tier: SkillTier } | null;

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
   * ON TOP of the run HUD (added later in `create()`) — on mobile the HUD's
   * LEAVE SHOP button lives in the bottom footer, which an unrolled shop's
   * off-screen gem row can geometrically reach. A native per-object listener
   * has no way to defer to `inViewport`; routing gems through `draggables`
   * does, for free. */
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
  colW: number;
  colTop: number;
  rowH: number;
  rowGap: number;
  sellRect: Phaser.Geom.Rectangle;
}

const F = MOBILE_PROFILE.font;
// LIVE reference: every `TEMPLATE.*` read below resolves against the
// CURRENT viewport (the canvas fills the window -- see game/viewport.ts).
const TEMPLATE = runScreenLayoutRef('mobile');

const BOARD_BAG_SLOTS = 10;

/**
 * YOUR BOARD / BAG are two VERTICAL columns BELOW the shelf — the same
 * "deck-build" idiom `MobileDeckBuildScene.renderColumns` uses (a column of
 * real `CardToken`s, multi-slot cards spanning rows), sized off the SAME
 * `colW`/`gap` formula that scene uses so the two screens read identically.
 * Replaces the old 36×32 horizontal mini-token strip (2026-08-04..08-05) —
 * much more spacious: a full card render (art, name, effects, affinity)
 * instead of a truncated name/tier label, per the user's explicit
 * "more spacing" ask.
 */
const OWNED_ROW_GAP = 5; // matches MobileDeckBuildScene's column row gap
/** Fixed column height (10 rows) — the shelf viewport above absorbs any
 * leftover/shortfall via scrolling, same fixed-band idiom the old strip used. */
const OWNED_COL_H = 380;
const SELL_ZONE_H = 28;
const POUCH_LABEL_H = 12;
const POUCH_LABEL_GAP = 2;
const POUCH_CELL_H = 48;
/** SELL ZONE + GEM POUCH, stacked directly under the two columns:
 *   gap (column bottom → SELL ZONE)   = 6
 *   SELL ZONE                          = 28
 *   gap                                 = 6
 *   POUCH label + gap + cell           = 12 + 2 + 24 = 38
 *   total                               = 78
 */
const OWNED_FOOTER_H = 6 + SELL_ZONE_H + 6 + POUCH_LABEL_H + POUCH_LABEL_GAP + POUCH_CELL_H;
/** Whole reserved band under the (scrollable) shelf viewport: columns + the
 * SELL ZONE/POUCH footer beneath them. FIXED height, independent of a shop's
 * stock — the shelf viewport above it absorbs 100% of any stock-size
 * variance via scrolling instead of pushing this band around. */
const OWNED_BAND_H = OWNED_COL_H + OWNED_FOOTER_H;
// The BOARD/BAG heading is bottom-anchored 4px above the owned columns. Its
// rendered 9px bold glyph box is 12px tall, so the shelf mask needs the full
// 12 + 4px clearance; an 8px gap let the clipped last offer print through it.
const STRIP_GAP = 16;

/**
 * Mobile Shop — storefront picker (21 themed shops, tap to browse) → shelf
 * view (stacked card offers + gem offers, gold prices, REROLL). Tap a tile to
 * open an inspect overlay (mirrors the mobile Wiki detail) with a BUY button;
 * BUY opens a confirm dialog (mirrors the deck-build trash-confirm).
 * Reachable at ?scene=mobile-shop.
 *
 * 2026-08-04: DRAG-TO-BUY + SELLING + the shelf-overflow fix. A YOUR
 * BOARD/BAG pair of columns (same sandbox/run split `MobileDeckBuildScene`
 * uses) sits below the (now scrollable) shelf, with a SELL ZONE and a gem
 * POUCH row beneath it. Dragging a shelf card onto a board/bag slot opens
 * the BUY confirm pre-targeted at that destination; dragging an owned
 * card/gem onto SELL ZONE (or tapping it) opens a SELL confirm.
 *
 * 2026-08-05: BOARD/BAG went VERTICAL — two `CardToken` columns (the same
 * deck-build idiom, multi-slot cards spanning rows) in place of the old
 * horizontal 36px mini-token strip. See `OWNED_COL_H`/`OWNED_BAND_H`.
 *
 * 2026-08-06: BOARD<->BAG REARRANGE (task #32 — this move never existed in
 * the shop before; only BUY-to-slot and SELL did) — dragging an owned card
 * onto a board/bag slot now moves it there via `moveToBoard`/`moveToBag`
 * (`src/game/shopActions.ts`, built from `run/loadout.ts`'s
 * `moveWithinStrip`/`shiftInsert`, the same primitives DeckBuild's
 * `toDeck`/`toBag` already ship with). This also resolved a tap-vs-drag
 * conflict: an owned card's body is now a PURE drag surface (tap-to-sell is
 * gone; SELL is drag-onto-the-SELL-ZONE only) so a real drag never races a
 * tap branch, and inspect moved to the `CardToken`'s own "ⓘ" button — the
 * ONLY way to open the owned-card detail veil now (`renderOwnedCardDetail`).
 */
export class MobileShopScene extends Phaser.Scene {
  private embedded: EmbeddedRunDestination | undefined;
  private detailsHostScroll: number | null = null;
  private W = SCREEN.width;
  private H = SCREEN.height;
  private selectedShop: string | null = null;
  private storefrontPage = 0;
  private readonly detailActivation = new CardDetailActivation();
  private selectedCardIndex: number | null = null;
  private runBrowseTab: 'cards' | 'gems' = 'cards';
  private detailCardIndex: number | null = null;
  private detailGemIndex: number | null = null;
  private inspectGemIndex: number | null = null;
  private detailTier: SkillTier = 'bronze';
  /** OWNED board/bag card whose "ⓘ" button opened the detail veil — mutually
   * exclusive with `detailCardIndex`/`detailGemIndex` (both-platforms twin
   * of `DesktopShopScene`'s `inspectOwned`). The whole card body is a pure
   * drag surface now (2026-08-06) — this button is the ONLY way to open it,
   * replacing the tap-to-sell shortcut that used to double as an inspect. */
  private inspectOwned: { location: 'board' | 'bag'; index: number } | null = null;
  private pendingBuy: PendingBuy | null = null;
  /** Destination-card inspect sits above the still-live buy/merge confirm. */
  private mergePreviewOpen = false;
  private pendingSell: PendingSell | null = null;
  /** One-shot transient red flash on an invalid BUY-to-slot drop — read and
   * cleared the instant it's rendered, so it never re-fires on an unrelated
   * later rerender. Purely cosmetic (a tween), not a gameplay decision. */
  private invalidFlash: { where: 'board' | 'bag'; index: number } | null = null;
  private toastObjects: Phaser.GameObjects.GameObject[] = [];
  private retireConfirmOpen = false;

  /** The (masked, scrollable) shelf CARDS+GEMS container — null on the
   * storefront picker. Persisted scroll offset so a rerender doesn't reset
   * the player's scroll position. */
  private shelfContainer: Phaser.GameObjects.Container | null = null;
  private shelfScrollY = 0;
  private shelfThumb: Phaser.GameObjects.Rectangle | null = null;
  private shelfFadeTop: Phaser.GameObjects.Rectangle | null = null;
  private shelfFadeBottom: Phaser.GameObjects.Rectangle | null = null;
  private shelfViewport = { x: 0, y: 0, width: 0, height: 0 };
  private shelfMaxScroll = 0;

  private setShelfScrollPosition(y: number): void {
    setShopShelfScrollPosition(this.shelfContainer, y);
  }

  private draggables: DragEntry[] = [];
  private ownedColumns: OwnedColumnLayout | null = null;
  private sellZoneRectObj: Phaser.GameObjects.Rectangle | null = null;
  private sellZoneLabelObj: Phaser.GameObjects.Text | null = null;

  constructor() { super('MobileShop'); }

  init(data?: { embedded?: EmbeddedRunDestination }): void {
    this.embedded = data?.embedded;
    this.selectedShop = null;
    this.storefrontPage = 0;
    this.detailCardIndex = null;
    this.selectedCardIndex = null;
    this.runBrowseTab = 'cards';
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
    // rebuildScene() destroys the game objects but NOT the fields pointing at
    // them (scene-rebuild idiom).
    this.shelfThumb = null;
    this.shelfFadeTop = null;
    this.shelfFadeBottom = null;
  }

  private rerender(preserveActivation = false): void {
    if (!preserveActivation) this.detailActivation.reset();
    rebuildScene(this);
    this.embedded?.onChanged();
  }

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

  /** The shop id the detail/confirm overlays operate on — the run's single
   * storefront in Run Mode (no picker to have set `selectedShop`), else the
   * Sandbox's browsed `selectedShop`. */
  private activeShopId(): string {
    return this.runShopId() ?? this.selectedShop!;
  }

  // ---------- owned-item data source (Sandbox demoState vs. the active run) ----------

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
    const cardInspectOpen = this.inspectOwned !== null || this.detailCardIndex !== null || this.detailGemIndex !== null || this.inspectGemIndex !== null;
    const runShop = this.runShopId();
    if (this.embedded) {
      if (cardInspectOpen) {
        this.detailsHostScroll ??= this.embedded.scrollY;
        this.embedded.scrollY = 0;
      } else if (this.detailsHostScroll !== null) {
        this.embedded.scrollY = this.detailsHostScroll;
        this.detailsHostScroll = null;
      }
    }
    this.W = this.embedded ? Math.min(660, this.embedded.bounds.width) : SCREEN.width;
    this.H = this.embedded ? (runShop ? this.embedded.bounds.height : cardInspectOpen ? this.embedded.bounds.height : Math.max(800, this.embedded.bounds.height)) : SCREEN.height;
    this.draggables = [];
    this.shelfContainer = null;
    this.ownedColumns = null;
    this.sellZoneRectObj = null;
    this.sellZoneLabelObj = null;
    if (!this.embedded) this.cameras.main.setBackgroundColor(UI.bg);
    if (runShop) {
      if (!this.embedded) this.renderHud();
    } else {
      this.renderTabs();
      this.renderGoldBalance();
    }
    const shopId = runShop ?? this.selectedShop;
    if (shopId) {
      if (runShop) this.renderRunBrowse(shopId);
      else {
        this.renderShelf(shopId);
        this.renderOwnedColumns();
      }
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
        compact: true,
        onCancel: () => { this.retireConfirmOpen = false; this.rerender(); },
        onConfirm: () => { retireActiveRun(); this.scene.start('MobileRunMap'); },
      });
    }
    const inspecting = this.pendingBuy || this.pendingSell || this.mergePreviewOpen || this.inspectOwned || this.detailCardIndex !== null || this.detailGemIndex !== null || this.inspectGemIndex !== null;
    const sourceTop = this.embedded ? 0 : inspecting ? 0 : TEMPLATE.regions.content.y;
    positionRunDestination(this, this.embedded, {
      x: 0, y: sourceTop, width: this.W, height: this.H - sourceTop,
    });
  }

  /** THE run HUD — identical header on every run screen. LEAVE SHOP sits in
   * the HUD's fixed primary slot. */
  private renderHud(): void {
    const run = getActiveRun();
    if (!run) return;
    renderRunHud(this, {
      screen: 'SHOP',
      compact: true,
      snapshot: snapshotRunProgress(run),
      actions: {
        secondary: { label: 'DECK/BAG', onPress: () => { setDeckBuildContext('run'); this.scene.start('MobileDeckBuild'); } },
        tertiary: { label: 'RETIRE', danger: true, onPress: () => { this.retireConfirmOpen = true; this.rerender(); } },
      },
    });
  }

  private renderTabs(): void {
    const tabs: Array<[string, boolean, () => void]> = [
      ['MENU', false, () => this.scene.start('Start')],
      ['PREP', false, () => this.scene.start('MobilePrep')],
      ['DECK', false, () => { setDeckBuildContext('demo'); this.scene.start('MobileDeckBuild'); }],
      ['WIKI', false, () => this.scene.start('MobileWiki')],
      ['SHOP', true, () => {}],
      ['DRAFT', false, () => this.scene.start('MobileDraft')],
    ];
    const layout = mobileShopStorefrontLayout(this.W, this.H, tabs.length);
    tabs.forEach(([label, active, fn], i) => {
      const box = layout.tabs[i]!;
      const r = this.add.rectangle(box.x, box.y, box.width, box.height, active ? 0xb78a46 : 0x131f32).setOrigin(0, 0).setStrokeStyle(1, UI.border, 0.7).setInteractive({ useHandCursor: true });
      r.on('pointerdown', () => { playSfx('uiClick'); fn(); });
      this.add.text(box.x + box.width / 2, layout.tabLabelY, label, { fontSize: `${F.tiny}px`, color: active ? UI.textOnChip : UI.textDim, fontFamily: FONT.body, fontStyle: 'bold' }).setOrigin(0.5);
    });
  }

  private renderGoldBalance(): void {
    const { gold } = mobileShopStorefrontLayout(this.W, this.H, 6);
    this.add.text(this.W - 12, gold.y, this.goldLabel(), { fontSize: `${F.body}px`, color: UI.textAccent, fontFamily: FONT.body, fontStyle: 'bold' }).setOrigin(1, 0);
  }

  // ---------- storefront ----------

  private renderStorefront(): void {
    const page = mobileShopPage(shopTypeIds, this.storefrontPage);
    this.storefrontPage = page.page;
    const layout = mobileShopStorefrontLayout(this.W, this.H, 6);
    this.add.text(12, layout.heading.y, 'CHOOSE A SHOP', { fontSize: `${F.label}px`, color: UI.textMuted, fontFamily: FONT.body, fontStyle: 'bold' });
    // Six authored-order shops per page keep the mobile catalog distinct from
    // desktop's independent four-by-two pages while giving each shop useful
    // banner art and its tagline. Paging only changes this view over
    // `shopTypeIds`; selection still opens the exact same id/shelf as before.
    page.ids.forEach((id, i) => {
      const shop = shopCatalog[id]!;
      const box = layout.grid.cell(i);
      const { x, y, width: cellW, height: h } = box;
      const cell = this.add.rectangle(x, y, cellW, h, UI.panelAlt, 0.94).setOrigin(0, 0).setStrokeStyle(1, UI.border, BRIGHT_ART_TREATMENT.storefront.idleStrokeAlpha).setInteractive({ useHandCursor: true });
      // CONFIRMED INSTANCE (#22, audit 2026-08): entering a shop rebuilds the
      // scene into the shelf+BOARD/BAG layout — a storefront tile's own pixel
      // can land on a shelf/board/bag card in that FRESH layout, and the
      // rebuild's freshly re-registered wireDrag pointerdown listener would
      // "discover" it. `rerender()` below stamps the structural guard
      // (`wasPointerConsumedByRebuild`, sceneRebuild.ts) that `wireDrag`'s
      // pointerdown handler checks first, so that re-dispatch is a no-op.
      cell.on('pointerdown', () => { playSfx('uiClick'); ensureShelf(id); this.selectedShop = id; this.rerender(); });
      const bannerH = layout.grid.artHeight;
      addBrightRunArt(this, shopArtKey(id), { x, y, width: cellW, height: bannerH }, BRIGHT_ART_TREATMENT.storefront);
      this.add.rectangle(x, y + bannerH, cellW, 1, UI.border, BRIGHT_ART_TREATMENT.storefront.dividerAlpha).setOrigin(0, 0);
      const title = this.add.text(x + 10, y + bannerH + 8, shop.name.toUpperCase(), {
        fontSize: `${F.body}px`, color: UI.textBright, fontFamily: FONT.display, fontStyle: 'bold', wordWrap: { width: cellW - 20 },
      });
      this.add.text(x + 10, title.y + title.height + 5, shop.tagline, {
        ...textRole('micro'), color: UI.textDim, wordWrap: { width: cellW - 20 }, lineSpacing: 2,
      });
      this.add.text(x + 10, y + h - 18, `${shop.shelf.cards}C · ${shop.shelf.gems}G`, { fontSize: `${F.tiny}px`, color: UI.textAccent, fontFamily: FONT.body, fontStyle: 'bold' });
    });

    const renderPageControl = (box: typeof layout.pager.previous, label: string, enabled: boolean, onPress: () => void): void => {
      const control = this.add.rectangle(box.x, box.y, box.width, box.height, enabled ? 0x131f32 : 0x16233a, enabled ? 1 : 0.5)
        .setOrigin(0, 0).setStrokeStyle(1, enabled ? UI.chip : UI.border, enabled ? 0.8 : 0.4);
      const controlLabel = this.add.text(box.x + box.width / 2, layout.pager.labelY, label, {
        ...textRole('label'), color: enabled ? UI.textBright : UI.textDisabled,
      }).setOrigin(0.5);
      auditControlLabel(control, controlLabel, {
        name: `Mobile shop pager ${label}`,
        horizontalPadding: 8,
        verticalPadding: 6,
      });
      if (!enabled) return;
      control.setInteractive({ useHandCursor: true });
      control.on('pointerdown', () => { playSfx('uiClick'); onPress(); this.rerender(); });
    };
    renderPageControl(layout.pager.previous, '‹ PREVIOUS', page.canPrevious, () => { this.storefrontPage = page.page - 1; });
    renderPageControl(layout.pager.next, 'NEXT ›', page.canNext, () => { this.storefrontPage = page.page + 1; });
    this.add.text(layout.pager.indicatorX, layout.pager.labelY, `PAGE ${page.page + 1} / ${page.pageCount}`, {
      ...textRole('kicker'), color: UI.textMuted,
    }).setOrigin(0.5);
  }

  // ---------- shelf ----------

  private renderShelf(shopId: string): void {
    const shop = shopCatalog[shopId]!;
    const shelf = this.shelfFor(shopId);
    const info = shopPoolInfo(shopId);
    const runShop = this.runShopId() === shopId;
    // Run Mode's shop is entered straight from the map and LEAVE SHOP lives
    // in the HUD's fixed primary slot now — no back button, content starts
    // at the HUD's content top; the Sandbox keeps its own `‹ SHOPS` back nav.
    const storefront = mobileShopStorefrontLayout(this.W, this.H, 6);
    const top = runShop ? (this.embedded ? 10 : TEMPLATE.regions.content.y) : storefront.heading.y;
    const header = mobileShopShelfHeaderLayout(this.W, top);

    addBrightRunArt(this, RUN_ART_KEYS.shopBanner, {
      x: 10,
      y: top,
      width: this.W - 20,
      height: header.contentTop - top,
    }, { imageAlpha: 0.35, liftAlpha: 0.12 });

    let titleX = 10;
    if (!runShop) {
      const back = this.add.rectangle(header.back.x, header.back.y, header.back.width, header.back.height, 0x131f32).setOrigin(0, 0).setStrokeStyle(1, UI.border, 0.7).setInteractive({ useHandCursor: true });
      this.add.text(header.back.x + header.back.width / 2, header.labelY, '‹ SHOPS', { fontSize: `${F.tiny}px`, color: UI.textBright, fontFamily: FONT.body, fontStyle: 'bold' }).setOrigin(0.5);
      back.on('pointerdown', () => { playSfx('uiBack'); this.selectedShop = null; this.rerender(); });
      titleX = header.back.x + header.back.width + 8;
    }
    this.add.text(titleX, header.titleY, shop.name.toUpperCase(), { fontSize: `${F.lead}px`, color: UI.textAccent, fontFamily: FONT.display, fontStyle: 'bold' });

    // A thin shop whose whole pool already fits the shelf can never reveal
    // anything new on reroll (docs/run-shops-design.md §2b, USER-LOCKED).
    const rerollY = header.stock.y;
    const rerollW = header.stock.width;
    if (info.fullStock) {
      this.add.rectangle(header.stock.x, rerollY, rerollW, header.stock.height, 0x16233a, 0.5).setOrigin(0, 0).setStrokeStyle(1, UI.border, 0.4);
      this.add.text(header.stock.x + rerollW / 2, header.labelY, 'FULL STOCK', { fontSize: `${F.tiny}px`, color: UI.textMuted, fontFamily: FONT.body, fontStyle: 'bold' }).setOrigin(0.5);
    } else {
      // Run Mode's reroll cost escalates per node (1, 2, 3, 4… — see
      // `currentShopRerollCost`); the sandbox shop has no run node to key
      // off of and keeps its pre-existing flat 1-gold label/gate.
      const cost = runShop ? currentShopRerollCost() : 1;
      const canReroll = this.activeGold() >= cost;
      const rr = this.add.rectangle(header.stock.x, rerollY, rerollW, header.stock.height, canReroll ? 0xb78a46 : 0x16233a, canReroll ? 1 : 0.5)
        .setOrigin(0, 0).setStrokeStyle(1, UI.border, canReroll ? 1 : 0.4);
      this.add.text(header.stock.x + rerollW / 2, header.labelY, `REROLL · ${cost}G`, { fontSize: `${F.tiny}px`, color: canReroll ? UI.textOnChip : UI.textDisabled, fontFamily: FONT.body, fontStyle: 'bold' }).setOrigin(0.5);
      if (canReroll) {
        rr.setInteractive({ useHandCursor: true });
        rr.on('pointerdown', () => { playSfx('purchase'); runShop ? rerollCurrentShop() : rerollShelf(shopId); this.rerender(); });
      }
    }

    const cardSlots = info.cardSlots;
    const gemSlots = info.gemSlots;

    // Scrollable viewport for the CARDS+GEMS list — bottom-anchored above the
    // fixed OWNED_BAND_H reserved for the BOARD/BAG columns + SELL ZONE/POUCH
    // beneath them (see that constant's comment).
    const contentTop = header.contentTop;
    const bottomLimit = (runShop ? (this.embedded ? this.H - 10 : TEMPLATE.regions.footer.y) : this.H - MOBILE_PROFILE.safe.bottom) - 6;
    const viewportBottom = bottomLimit - OWNED_BAND_H - STRIP_GAP;
    const viewportH = Math.max(40, viewportBottom - contentTop);
    this.shelfViewport = { x: 10, y: contentTop, width: this.W - 20, height: viewportH };

    const container = this.add.container(0, this.shelfScrollY);
    bindShopShelfMaskSync(container);
    this.shelfContainer = container;
    const created: Phaser.GameObjects.GameObject[] = [];
    const A = <T extends Phaser.GameObjects.GameObject>(obj: T): T => { created.push(obj); return obj; };

    const rowGap = 8;
    const labelH = 16;
    const cardH = MOBILE_SHELF_CARD_CELL_H;
    const gemH = 76;

    let y = contentTop;
    if (cardSlots > 0) {
      A(this.add.text(12, y, `CARDS · ${shelf.cards.length}/${cardSlots}`, { fontSize: `${F.small}px`, color: UI.textMuted, fontFamily: FONT.body, fontStyle: 'bold' }));
      y += labelH;
      for (let i = 0; i < cardSlots; i++) {
        const offer = shelf.cards[i];
        if (!offer) {
          A(this.add.rectangle(10 + (this.W - 20) / 2, y + cardH / 2, this.W - 20, cardH, 0x0d1b28, 0.4).setStrokeStyle(1, UI.border, 0.3));
          A(this.add.text(this.W / 2, y + cardH / 2, 'SOLD OUT', { fontSize: `${F.small}px`, color: UI.textMuted, fontFamily: FONT.body, fontStyle: 'bold' }).setOrigin(0.5));
          y += cardH + rowGap;
          continue;
        }
        const base = skillBook[offer.skillId]!;
        const skill = offer.tier === base.tier ? base : applyTier(base, offer.tier);
        // THE PRICE GETS ITS OWN COLUMN (`ui/cardCellLayout.ts`, 2026-08-31).
        // It used to be drawn at `W - 16, y + 6, origin(1, 0)` — which is
        // `CardToken`'s INWARD TOP corner, where the token draws an offer's
        // `xN SLOTS` span badge — so a multi-slot offer read `x2 SL 2 G` and
        // the one number that says "this eats two board slots" was buried.
        // A GUTTER, not a strip under the row (the shape the DESKTOP shelf
        // uses): this viewport is only ~205px tall and a 24px strip per row
        // would cost it a fifth of what it can show, while a 392px-wide row
        // has width to spare. Both reservations live in one module.
        const cell: CellBox = { x: 10, y, w: this.W - 20, h: cardH };
        const { token: tokenBox, gutter } = gutterCell(cell, SHELF_PRICE_GUTTER_W, 'left');
        const tok = new CardToken(this, tokenBox.x + tokenBox.w / 2, tokenBox.y + tokenBox.h / 2, skill, { width: tokenBox.w, height: tokenBox.h, side: 'left', tier: offer.tier, onInspect: () => {
          const pointer = this.input.activePointer;
          const v = this.shelfViewport;
          if (pointer.worldY < v.y || pointer.worldY > v.y + v.height) return;
          this.detailCardIndex = i; this.detailTier = offer.tier; this.inspectOwned = null; this.rerender();
        } });
        A(tok);
        this.draggables.push({ bounds: new Phaser.Geom.Rectangle(cell.x, cell.y, cell.w, cell.h), src: { kind: 'shelfCard', index: i }, obj: tok });
        // MERGE affordance — same lookup the BUY confirm dialog already uses;
        // Shop-only outline and opaque bottom label, independent of token art.
        const shelfMergeTarget = runShop ? currentShopMergeTarget(offer.skillId) : mergeTargetFor(offer.skillId);
        if (shelfMergeTarget) A(this.renderMergeBadge(tokenBox.x, tokenBox.y, shelfMergeTarget, F.tiny, tokenBox.w, tokenBox.h));
        const affordable = this.activeGold() >= offer.price;
        const priceAt = boxCenter(gutter);
        A(this.add.text(priceAt.x, priceAt.y, `${offer.price} G`, textRole('label', { ink: affordable ? 'resource' : 'alarm' })).setOrigin(0.5));
        y += cardH + rowGap;
      }
    }

    if (gemSlots > 0) {
      A(this.add.text(12, y, `GEMS · ${shelf.gems.length}/${gemSlots}`, { fontSize: `${F.small}px`, color: UI.textMuted, fontFamily: FONT.body, fontStyle: 'bold' }));
      y += labelH;
      for (let i = 0; i < gemSlots; i++) {
        const offer = shelf.gems[i];
        if (!offer) {
          A(this.add.rectangle(10 + (this.W - 20) / 2, y + gemH / 2, this.W - 20, gemH, 0x0d1b28, 0.4).setStrokeStyle(1, UI.border, 0.3));
          A(this.add.text(this.W / 2, y + gemH / 2, 'SOLD OUT', { fontSize: `${F.small}px`, color: UI.textMuted, fontFamily: FONT.body, fontStyle: 'bold' }).setOrigin(0.5));
          y += gemH + rowGap;
          continue;
        }
        const gem = gemBook[offer.gemId]!;
        const cell = A(this.add.rectangle(10, y, this.W - 20, gemH, 0x101a2a, 0.94).setOrigin(0, 0).setStrokeStyle(1, GEM_RARITY_COLOR[gem.rarity], 0.8));
        // Routed through the unified `draggables` system (see `DragSource`'s
        // `shelfGem` doc comment) instead of a native `setInteractive` +
        // `pointerdown` — that native form had no viewport gate, so a gem row
        // scrolled below the masked shelf viewport (a fresh, real offer, not
        // a non-interactive SOLD OUT placeholder) kept its full hit box and
        // could swallow taps aimed at content below it, including the run
        // HUD's footer-anchored LEAVE SHOP button on mobile.
        this.draggables.push({ bounds: new Phaser.Geom.Rectangle(10, y, this.W - 20, gemH), src: { kind: 'shelfGem', index: i }, obj: cell });
        A(new GemToken(this, 28, y + gemH / 2, gem, { width: 32, height: 32 }));
        A(this.add.text(42, y + 8, gem.name, { fontSize: `${F.label}px`, color: UI.textBright, fontFamily: FONT.display, fontStyle: 'bold' }));
        const body = A(this.add.text(42, y + 24, stripCardTextMarkup(renderGemText(gem)), { fontSize: `${F.tiny}px`, color: '#e8b446', fontFamily: FONT.body, fontStyle: 'bold', wordWrap: { width: this.W - 100 } }));
        let s = stripCardTextMarkup(renderGemText(gem));
        while (s.length > 1 && body.height > gemH - 34) { s = s.slice(0, -1); body.setText(`${s}…`); }
        const affordable = this.activeGold() >= offer.price;
        A(this.add.text(this.W - 20, y + gemH - 18, `${offer.price} G`, { fontSize: `${F.small}px`, color: affordable ? '#e8b446' : '#e08a7a', fontFamily: FONT.body, fontStyle: 'bold' }).setOrigin(1, 0));
        y += gemH + rowGap;
      }
    }

    if (cardSlots === 0 && gemSlots === 0) {
      A(this.add.text(12, y, 'This shop has nothing to sell.', { fontSize: `${F.label}px`, color: UI.textMuted, fontFamily: FONT.body, fontStyle: 'bold' }));
    }

    container.add(created);
    const contentH = y - contentTop;
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

  /** User-approved compact Run Shop browse view. Sandbox retains the legacy
   * shelf/owned-column composition; this branch only reorganizes the same run
   * shelf, wallet and actions into one phone-sized surface. */
  private renderRunBrowse(shopId: string): void {
    const shop = shopCatalog[shopId]!;
    const shelf = this.shelfFor(shopId);
    const info = shopPoolInfo(shopId);
    const layout = mobileRunShopBrowseLayout(this.W, this.H, this.embedded ? 6 : TEMPLATE.regions.content.y);

    addBrightRunArt(this, RUN_ART_KEYS.shopBanner, layout.header, { imageAlpha: 0.3, liftAlpha: 0.12 });
    this.add.rectangle(layout.header.x, layout.header.y, layout.header.width, layout.header.height, UI.panel, 0.72)
      .setOrigin(0, 0).setStrokeStyle(1, UI.border, 0.75);
    this.add.text(layout.header.x + 8, layout.header.y + 7, shop.name.toUpperCase(), {
      ...textRole('section', { ink: 'accent' }), fontFamily: FONT.display, fontStyle: 'bold',
      wordWrap: { width: layout.header.width - 126 },
    });
    this.add.text(layout.header.x + layout.header.width - 8, layout.header.y + 7, `${this.activeGold()} G`, {
      ...textRole('section', { ink: 'resource' }), fontFamily: FONT.display, fontStyle: 'bold',
    }).setOrigin(1, 0);

    const cost = currentShopRerollCost();
    const canReroll = !info.fullStock && this.activeGold() >= cost;
    const rerollW = 112;
    const rerollH = 24;
    const rerollX = layout.header.x + layout.header.width - rerollW - 6;
    const rerollY = layout.header.y + layout.header.height - rerollH - 5;
    const reroll = this.add.rectangle(rerollX, rerollY, rerollW, rerollH, canReroll ? UI.chip : UI.panelMuted, canReroll ? 1 : 0.6)
      .setOrigin(0, 0).setStrokeStyle(1, UI.border, canReroll ? 1 : 0.45);
    const rerollLabel = info.fullStock ? 'FULL STOCK' : `REROLL · ${cost}G`;
    this.add.text(rerollX + rerollW / 2, rerollY + rerollH / 2, rerollLabel, textRole('micro', { ink: canReroll ? 'onAccent' : 'disabled' })).setOrigin(0.5);
    if (canReroll) reroll.setInteractive({ useHandCursor: true }).on('pointerdown', () => {
      playSfx('purchase'); this.selectedCardIndex = null; rerollCurrentShop(); this.rerender();
    });

    const renderTab = (box: typeof layout.tabs.cards, id: 'cards' | 'gems', label: string): void => {
      const active = this.runBrowseTab === id;
      const plate = this.add.rectangle(box.x, box.y, box.width, box.height, active ? UI.panelAlt : UI.panelMuted, 0.96)
        .setOrigin(0, 0).setStrokeStyle(active ? 2 : 1, active ? UI.chip : UI.border, active ? 1 : 0.65)
        .setInteractive({ useHandCursor: true });
      this.add.text(box.x + box.width / 2, box.y + box.height / 2, label, textRole('label', { ink: active ? 'accent' : 'secondary' })).setOrigin(0.5);
      plate.on('pointerdown', () => {
        if (this.runBrowseTab === id) return;
        playSfx('uiClick'); this.runBrowseTab = id; this.selectedCardIndex = null; this.shelfScrollY = 0; this.rerender();
      });
    };
    renderTab(layout.tabs.cards, 'cards', `CARDS · ${shelf.cards.length}/${info.cardSlots}`);
    renderTab(layout.tabs.gems, 'gems', `GEMS · ${shelf.gems.length}/${info.gemSlots}`);

    this.shelfViewport = { ...layout.shelf };
    const container = this.add.container(0, this.shelfScrollY);
    bindShopShelfMaskSync(container);
    this.shelfContainer = container;
    const created: Phaser.GameObjects.GameObject[] = [];
    const A = <T extends Phaser.GameObjects.GameObject>(obj: T): T => { created.push(obj); return obj; };
    const rowGap = 6;
    let y = layout.shelf.y;
    if (this.runBrowseTab === 'cards') {
      const cardH = Math.min(72, Math.max(58, layout.shelf.height / 3 - rowGap));
      shelf.cards.forEach((offer, index) => {
        const base = skillBook[offer.skillId];
        if (!base) return;
        const skill = applyTier(base, offer.tier);
        const cell: CellBox = { x: layout.shelf.x, y, w: layout.shelf.width, h: cardH };
        if (this.selectedCardIndex === index) A(this.add.rectangle(cell.x, cell.y, cell.w, cell.h, UI.chip, 0.08)
          .setOrigin(0, 0).setStrokeStyle(3, UI.chip, 1));
        const { token: tokenBox, gutter } = gutterCell(cell, 54, 'left');
        const token = A(new CardToken(this, tokenBox.x + tokenBox.w / 2, tokenBox.y + tokenBox.h / 2, skill, {
          width: tokenBox.w, height: tokenBox.h, side: 'left', tier: offer.tier,
          onInspect: () => {
            const pointer = this.input.activePointer;
            const v = this.shelfViewport;
            if (pointer.worldY < v.y || pointer.worldY > v.y + v.height) return;
            this.selectedCardIndex = index; this.detailCardIndex = index; this.detailTier = offer.tier; this.rerender();
          },
        }));
        this.draggables.push({ bounds: new Phaser.Geom.Rectangle(cell.x, cell.y, cell.w, cell.h), src: { kind: 'shelfCard', index }, obj: token });
        const affordable = this.activeGold() >= offer.price;
        const price = boxCenter(gutter);
        A(this.add.text(price.x, price.y, `${offer.price} G`, textRole('label', { ink: affordable ? 'resource' : 'alarm' })).setOrigin(0.5));
        y += cardH + rowGap;
      });
    } else {
      const gemH = 62;
      shelf.gems.forEach((offer, index) => {
        const gem = gemBook[offer.gemId];
        if (!gem) return;
        const cell = A(this.add.rectangle(layout.shelf.x, y, layout.shelf.width, gemH, UI.panelAlt, 0.96)
          .setOrigin(0, 0).setStrokeStyle(1, GEM_RARITY_COLOR[gem.rarity], 0.85));
        A(new GemToken(this, layout.shelf.x + 26, y + gemH / 2, gem, { width: 42, height: 42 }));
        A(this.add.text(layout.shelf.x + 54, y + 8, gem.name, textRole('label')).setOrigin(0, 0));
        A(this.add.text(layout.shelf.x + 54, y + 27, stripCardTextMarkup(renderGemText(gem)), {
          ...textRole('micro', { ink: 'secondary' }), wordWrap: { width: layout.shelf.width - 120 },
        }));
        A(this.add.text(layout.shelf.x + layout.shelf.width - 10, y + gemH / 2, `${offer.price} G`, textRole('label', { ink: this.activeGold() >= offer.price ? 'resource' : 'alarm' })).setOrigin(1, 0.5));
        this.draggables.push({ bounds: new Phaser.Geom.Rectangle(layout.shelf.x, y, layout.shelf.width, gemH), src: { kind: 'shelfGem', index }, obj: cell });
        y += gemH + rowGap;
      });
    }
    container.add(created);
    this.shelfMaxScroll = Math.max(0, y - rowGap - (layout.shelf.y + layout.shelf.height));
    this.shelfScrollY = Phaser.Math.Clamp(this.shelfScrollY, -this.shelfMaxScroll, 0);
    container.setY(this.shelfScrollY);
    const maskShape = this.make.graphics({}, false).fillStyle(0xffffff).fillRect(layout.shelf.x, layout.shelf.y, layout.shelf.width, layout.shelf.height);
    container.setMask(maskShape.createGeometryMask());
    container.once(Phaser.GameObjects.Events.DESTROY, () => maskShape.destroy());
    this.add.rectangle(layout.shelf.x, layout.shelf.y, layout.shelf.width, layout.shelf.height, 0xffffff, 0.001).setOrigin(0, 0);
    this.renderShelfScrollAffordance();

    const boardUsed = this.boardOccupied().filter(Boolean).length;
    const bagUsed = this.bagOccupied().filter(Boolean).length;
    this.add.rectangle(layout.owned.x, layout.owned.y, layout.owned.width, layout.owned.height, UI.panelAlt, 0.96)
      .setOrigin(0, 0).setStrokeStyle(1, UI.border, 0.85);
    this.add.text(layout.owned.x + 10, layout.owned.y + layout.owned.height / 2, `YOUR CARDS · BOARD ${boardUsed}/${BOARD_BAG_SLOTS} · BAG ${bagUsed}/${BOARD_BAG_SLOTS}`, textRole('micro', { ink: 'accent' })).setOrigin(0, 0.5);

    this.add.text(layout.pouch.x, layout.pouch.y + 2, `GEM POUCH · ${this.gemInventory.length}`, textRole('micro', { ink: 'accent' }));
    this.gemInventory.slice(0, 7).forEach((gemId, index) => {
      const gem = gemBook[gemId];
      if (!gem) return;
      const x = layout.pouch.x + 102 + index * 32;
      const box = this.add.container(x, layout.pouch.y);
      box.add(new GemToken(this, 14, 14, gem, { width: 28, height: 28 }));
      this.draggables.push({ bounds: new Phaser.Geom.Rectangle(x, layout.pouch.y, 28, 28), src: { kind: 'gem', index }, obj: box });
    });
    const sellRect = new Phaser.Geom.Rectangle(layout.sell.x, layout.sell.y, layout.sell.width, layout.sell.height);
    this.sellZoneRectObj = this.add.rectangle(layout.sell.x, layout.sell.y, layout.sell.width, layout.sell.height, UI.badSoft, 0.35)
      .setOrigin(0, 0).setStrokeStyle(1, UI.bad, 0.85);
    this.sellZoneLabelObj = this.add.text(layout.sell.x + layout.sell.width / 2, layout.sell.y + layout.sell.height / 2, 'SELL ZONE — drag a card or gem here', textRole('micro', { ink: 'alarm' })).setOrigin(0.5);
    this.ownedColumns = { boardX: -1000, bagX: -1000, colW: 0, colTop: 0, rowH: 0, rowGap: 0, sellRect };

    const selected = this.selectedCardIndex === null ? undefined : shelf.cards[this.selectedCardIndex];
    const affordable = Boolean(selected) && this.activeGold() >= selected!.price;
    const hasRoom = selected ? currentRunBagHasRoomFor(selected.skillId) : false;
    const mergeTarget = selected ? currentShopMergeTarget(selected.skillId) : null;
    const canBuy = affordable && (hasRoom || mergeTarget !== null);
    const action = (box: typeof layout.footer.leave, label: string, enabled: boolean, primary: boolean, onPress: () => void): void => {
      const fill = primary && enabled ? UI.chip : UI.panelAlt;
      const plate = this.add.rectangle(box.x, box.y, box.width, box.height, fill, enabled ? 1 : 0.55).setOrigin(0, 0)
        .setStrokeStyle(primary && enabled ? 2 : 1, primary && enabled ? UI.chip : UI.border, enabled ? 1 : 0.45);
      const caption = this.add.text(box.x + box.width / 2, box.y + box.height / 2, label, textRole('label', { ink: primary && enabled ? 'onAccent' : enabled ? 'primary' : 'disabled' })).setOrigin(0.5);
      auditControlLabel(plate, caption, { name: `Mobile Run Shop ${label}`, horizontalPadding: 8, verticalPadding: 6, minFontSize: 9 });
      if (enabled) attachButtonFeel(this, plate, { fill, hover: fill, follow: [caption], onPress });
    };
    action(layout.footer.leave, 'LEAVE SHOP', true, false, () => {
      leaveCurrentShop();
      if (this.embedded) this.embedded.onClose(); else this.scene.start('MobileRunMap');
    });
    const buyLabel = !selected ? 'SELECT A CARD' : !affordable ? `NEED ${selected.price} GOLD` : !hasRoom && !mergeTarget ? 'BAG FULL' : `BUY · ${selected.price} GOLD`;
    action(layout.footer.buy, buyLabel, canBuy, true, () => { this.pendingBuy = { kind: 'card', index: this.selectedCardIndex! }; this.rerender(); });
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
   * Scroll affordance for the masked shelf — the mobile twin of
   * `DesktopShopScene.renderShelfScrollAffordance` (both-platforms rule).
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

    const trackW = 3;
    const trackX = v.x + v.width - trackW;
    this.add.rectangle(trackX, v.y, trackW, v.height, 0x24344a, 0.5).setOrigin(0, 0);

    // Thumb length is the visible FRACTION of the content, so it doubles as a
    // read on how much is hidden.
    const visibleFraction = v.height / (v.height + this.shelfMaxScroll);
    const thumbH = Math.max(20, v.height * visibleFraction);
    const progress = this.shelfMaxScroll > 0 ? -this.shelfScrollY / this.shelfMaxScroll : 0;
    this.shelfThumb = this.add.rectangle(trackX, v.y, trackW, thumbH, UI.chip, 0.85).setOrigin(0, 0);

    // Edge fades: only on the side that actually has more content, so they
    // double as direction hints rather than permanent decoration.
    const fadeH = 12;
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

  // ---------- owned columns: BOARD · BAG · SELL ZONE · GEM POUCH ----------

  /**
   * YOUR BOARD / BAG — two vertical `BoardColumn`s (the SAME shared 10-slot
   * column-of-`CardToken`s component battle/prep already render with — "one
   * component, no per-screen copies") side by side below the shelf, with a
   * SELL ZONE and GEM POUCH stacked underneath them. Replaces the old
   * 36×32 horizontal mini-token strip: much more spacious (a full card
   * render — art, name, effects, affinity — instead of a truncated
   * name/tier label), per the user's explicit "more spacing" ask.
   */
  private renderOwnedColumns(): void {
    const colW = (this.W - 20 - 8) / 2; // matches MobileDeckBuildScene's column width
    const boardX = 10;
    const bagX = 10 + colW + 8;
    const colTop = this.shelfViewport.y + this.shelfViewport.height + STRIP_GAP;
    const rowGap = OWNED_ROW_GAP;
    const colH = OWNED_COL_H;
    const rowH = (colH - rowGap * (BOARD_BAG_SLOTS - 1)) / BOARD_BAG_SLOTS;
    const colBottom = colTop + colH;

    this.add.text(boardX + colW / 2, colTop - 4, `BOARD · ${this.boardOccupied().filter(Boolean).length}/${BOARD_BAG_SLOTS}`, {
      fontSize: `${F.tiny}px`, color: UI.textAccent, fontFamily: FONT.body, fontStyle: 'bold',
    }).setOrigin(0.5, 1);
    this.add.text(bagX + colW / 2, colTop - 4, `BAG · ${this.bagOccupied().filter(Boolean).length}/${BOARD_BAG_SLOTS}`, {
      fontSize: `${F.tiny}px`, color: UI.textAccent, fontFamily: FONT.body, fontStyle: 'bold',
    }).setOrigin(0.5, 1);

    const boardPieces: ColumnPiece[] = [];
    const boardSkills: SkillDef[] = [];
    for (const p of this.pieces) {
      const base = skillBook[p.skillId];
      if (!base) continue;
      // Tier + socketed-gem fold (resolver seam, display-only) so BOARD's
      // face numbers match what the card actually casts — see `resolveDisplaySkill`.
      const skill = resolveDisplaySkill(base, p);
      boardPieces.push({ skill, slot: p.slot, tier: p.tier });
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
      const base = skillBook[card.skillId];
      if (!base) return;
      // Tier fold (display-only, no gem — bag cards can't hold one) so a bag
      // card's face — including whether it reads AoE — matches its OWN
      // owned tier, not always the bronze base.
      const skill = card.tier === base.tier ? base : applyTier(base, card.tier);
      bagPieces.push({ skill, slot: index, tier: card.tier });
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
    let y = colBottom + 6;
    const sellRect = new Phaser.Geom.Rectangle(rowX, y, rowW, SELL_ZONE_H);
    this.sellZoneRectObj = this.add.rectangle(rowX, y, rowW, SELL_ZONE_H, UI.badSoft, 0.35).setOrigin(0, 0).setStrokeStyle(1, UI.bad, 0.8);
    this.sellZoneLabelObj = this.add.text(rowX + rowW / 2, y + SELL_ZONE_H / 2, 'SELL ZONE — drag a card or gem here', {
      fontSize: `${F.tiny}px`, color: '#e08a7a', fontFamily: FONT.body, fontStyle: 'bold',
    }).setOrigin(0.5);
    y += SELL_ZONE_H + 6;

    this.add.text(rowX, y, `GEM POUCH · ${this.gemInventory.length}`, {
      fontSize: `${F.tiny}px`, color: UI.textAccent, fontFamily: FONT.body, fontStyle: 'bold',
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
    const cellW = 48;
    const gap = 3;
    const maxShown = Math.max(0, Math.floor((rowW + gap) / (cellW + gap)) - 1);
    const pouch = this.gemInventory;
    const shown = pouch.slice(0, maxShown);
    shown.forEach((gemId, i) => {
      const gem = gemBook[gemId];
      const cx = rowX + i * (cellW + gap);
      const box = this.add.container(cx, y);
      const bg = this.add.rectangle(cellW / 2, POUCH_CELL_H / 2, cellW, POUCH_CELL_H, 0x101a2a, 0.94).setStrokeStyle(1, gem ? GEM_RARITY_COLOR[gem.rarity] : UI.border, 0.9);
      box.add(bg);
      if (gem) box.add(new GemToken(this, cellW / 2, POUCH_CELL_H / 2, gem, { width: cellW, height: POUCH_CELL_H }));
      this.draggables.push({ bounds: new Phaser.Geom.Rectangle(cx, y, cellW, POUCH_CELL_H), src: { kind: 'gem', index: i }, obj: box });
    });
    if (pouch.length > maxShown) {
      this.add.text(rowX + shown.length * (cellW + gap), y + POUCH_CELL_H / 2, `+${pouch.length - maxShown}`, {
        fontSize: `${F.tiny}px`, color: UI.textMuted, fontFamily: FONT.body, fontStyle: 'bold',
      }).setOrigin(0, 0.5);
    }
  }

  // ---------- card/gem inspect overlays (tap, no drag) ----------

  /**
   * OWNED board/bag card detail — opened ONLY by a `CardToken` "ⓘ" button
   * (2026-08-06; see `inspectOwned`'s doc comment), same full-screen veil
   * idiom as `renderCardDetail`/`renderGemDetail`. Read-only: no BUY (it's
   * already owned) and no SELL button either — SELL stays a single gesture,
   * drag onto the SELL ZONE, exactly as the coordinator's brief asked for.
   */
  private detailsView() {
    return { x: 0, y: this.embedded?.scrollY ?? 0, width: this.W,
      height: this.embedded?.bounds.height ?? this.H };
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
      compact: true, view: this.detailsView(),
      gem: piece?.gem ? gemBook[piece.gem.id] : null,
      powerDeci: instancePowerLevelDeci(applyTier(base, card.tier), piece ?? {}),
      onClose: () => { this.inspectOwned = null; this.rerender(); },
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
    const mergeTarget = runMode ? currentShopMergeTarget(offer.skillId) : mergeTargetFor(offer.skillId);
    const canBuy = affordable && (hasRoom || mergeTarget != null);
    const label = !affordable ? `NEED ${offer.price} GOLD` : !hasRoom && !mergeTarget ? 'BAG FULL' : !hasRoom ? 'MERGE AVAILABLE' : `BUY · ${offer.price} GOLD`;
    renderCardDetailsDrawer(this, shown, {
      compact: true, view: this.detailsView(),
      presentation: runMode ? 'mobile-shop' : 'default',
      powerDeci: instancePowerLevelDeci(shown, {}),
      onClose: () => {
        const next = closeMobileShopCardDetails({ selectedCardIndex: this.selectedCardIndex, detailCardIndex: this.detailCardIndex });
        this.selectedCardIndex = next.selectedCardIndex;
        this.detailCardIndex = next.detailCardIndex;
        this.rerender();
      },
      primaryAction: { label, enabled: canBuy, onPress: () => {
        this.pendingBuy = { kind: 'card', index }; this.rerender();
      } },
      secondaryAction: mergeTarget ? { label: 'MERGE', enabled: affordable, onPress: () => {
        this.pendingBuy = { kind: 'card', index }; this.rerender();
      } } : undefined,
    });
  }

  private renderGemDetail(): void {
    const index = this.detailGemIndex!;
    const offer = this.shelfFor(this.activeShopId()).gems[index];
    const gem = offer ? gemBook[offer.gemId] : undefined;
    if (!offer || !gem) { this.detailGemIndex = null; return; }
    const affordable = this.activeGold() >= offer.price;
    renderGemDetailsDrawer(this, gem, {
      compact: true, view: this.detailsView(),
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
      compact: true, view: this.detailsView(), slots, selectedKey: selected.key,
      onClose: () => { this.inspectGemIndex = null; this.rerender(); },
    });
  }
  // ---------- unified manual drag: shelf→board/bag (BUY) · owned→SELL ZONE (SELL) ----------

  /** Shelf-card entries live inside the scrollable `shelfContainer` — their
   * captured `bounds` assume an unscrolled container, so hit-testing against
   * the pointer's WORLD coords must add the container's current scroll y. */
  private worldBounds(e: DragEntry): Phaser.Geom.Rectangle {
    // Both shelf-hosted kinds (`shelfCard`, `shelfGem`) live inside the
    // scrollable container — their captured `bounds` assume an unscrolled
    // container, exactly alike.
    if ((e.src.kind !== 'shelfCard' && e.src.kind !== 'shelfGem') || !this.shelfContainer) return e.bounds;
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
    let dragging: { src: DragSource; obj: Phaser.GameObjects.Container | Phaser.GameObjects.Rectangle; home?: { x: number; y: number } } | null = null;
    let ghost: Phaser.GameObjects.Container | null = null;
    let totalMove = 0;
    let start = { x: 0, y: 0 };
    let scrolling: { startY: number; startScroll: number } | null = null;
    let pendingShelf: DragEntry | null = null;

    const beginDrag = (entry: DragEntry): void => {
      dragging = { src: entry.src, obj: entry.obj, home: { x: entry.obj.x, y: entry.obj.y } };
      if (entry.src.kind === 'shelfCard' && entry.obj instanceof CardToken) {
        ghost = entry.obj.spawnGhost();
        if (this.shelfContainer) ghost.setPosition(ghost.x, ghost.y + this.shelfContainer.y);
      }
      entry.obj.setDepth(1000).setAlpha(0.9);
    };

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
      if (this.pendingBuy || this.pendingSell || this.retireConfirmOpen || this.inspectOwned || this.detailCardIndex !== null || this.detailGemIndex !== null || this.inspectGemIndex !== null) return;
      // A shelfCard/shelfGem's registered bounds are its UNCLIPPED position
      // inside the scrollable container — a row scrolled below the masked
      // viewport still has bounds sitting where it would be, invisible but
      // "clickable" there. Gate BOTH shelf-hosted kinds on `inViewport`, or a
      // scrolled-away row can steal a tap intended for whatever's actually
      // visible at that pixel — the BOARD/BAG columns (and, on mobile, the
      // HUD's footer-anchored LEAVE SHOP button) sit at world coordinates a
      // tall, unscrolled shelf's later rows can reach.
      const hit = this.draggables.find((d) => this.worldBounds(d).contains(p.worldX, p.worldY)
        && ((d.src.kind !== 'shelfCard' && d.src.kind !== 'shelfGem') || inViewport(p.worldX, p.worldY)));
      if (hit) {
        totalMove = 0;
        start = { x: p.worldX, y: p.worldY };
        if (hit.src.kind === 'shelfCard' || hit.src.kind === 'shelfGem') pendingShelf = hit;
        else beginDrag(hit);
        return;
      }
      this.detailActivation.reset();
      if (this.shelfMaxScroll > 0 && inViewport(p.worldX, p.worldY)) {
        scrolling = { startY: p.worldY, startScroll: this.shelfScrollY };
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
          scrolling = { startY: start.y, startScroll: this.shelfScrollY };
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
      if (dragging) {
        totalMove = Math.max(totalMove, Math.hypot(p.worldX - start.x, p.worldY - start.y));
        if (totalMove >= 8) this.detailActivation.reset();
        if (dragging.src.kind === 'shelfGem') {
          // Tap-only shelf offer (no drop target) — no drag visual, mirrors
          // the native-listener behavior this replaced; `totalMove` above is
          // still tracked for the tap-vs-drag threshold in `pointerup`.
        } else if (dragging.src.kind === 'shelfCard' && this.shelfContainer) {
          dragging.obj.setPosition(p.worldX, p.worldY - this.shelfContainer.y);
        } else {
          dragging.obj.setPosition(p.worldX, p.worldY);
        }
        if (dragging.src.kind !== 'shelfCard' && dragging.src.kind !== 'shelfGem' && this.sellZoneRectObj && this.sellZoneLabelObj) {
          const sell = this.sellRefFor(dragging.src);
          const hovering = sell != null && this.ownedColumns != null && this.ownedColumns.sellRect.contains(p.worldX, p.worldY);
          if (hovering && sell) {
            const preview = this.sellPreview(sell);
            this.sellZoneRectObj.setFillStyle(UI.bad, 0.55);
            if (preview) this.sellZoneLabelObj.setText(`SELL ${preview.name} → +${preview.price}G`);
          } else {
            this.sellZoneRectObj.setFillStyle(UI.badSoft, 0.35);
            this.sellZoneLabelObj.setText('SELL ZONE — drag a card or gem here');
          }
        }
        return;
      }
      if (scrolling) {
        this.shelfScrollY = Phaser.Math.Clamp(scrolling.startScroll + (p.worldY - scrolling.startY), -this.shelfMaxScroll, 0);
        this.setShelfScrollPosition(this.shelfScrollY);
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
      if (pendingShelf) {
        beginDrag(pendingShelf);
        pendingShelf = null;
      }
      if (!dragging) return;
      const src = dragging.src;
      const draggedObj = dragging.obj;
      const home = dragging.home;
      dragging = null;
      ghost?.destroy(); ghost = null;

      if (src.kind === 'shelfCard') {
        const shopId = this.activeShopId();
        const shelf = this.shelfFor(shopId);
        if (totalMove < 8) {
          if (home) draggedObj.setPosition(home.x, home.y);
          draggedObj.setDepth(0).setAlpha(1);
          const openDetails = this.detailActivation.release(`shelf:${src.index}`, p.upTime);
          if (this.isRunMode()) {
            const next = activateMobileShopCard({ selectedCardIndex: this.selectedCardIndex, detailCardIndex: this.detailCardIndex }, src.index, openDetails);
            this.selectedCardIndex = next.selectedCardIndex;
            this.detailCardIndex = next.detailCardIndex;
          } else {
            if (!openDetails) return;
            this.detailCardIndex = src.index;
          }
          this.detailTier = shelf.cards[src.index]?.tier ?? 'bronze';
          playSfx('uiClick');
          this.inspectOwned = null;
          this.rerender(this.isRunMode() && !openDetails);
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

      // Shelf GEM offer: tap-only, same open-detail action the old native
      // `pointerdown` listener performed — see `DragSource`'s `shelfGem` doc
      // comment for why this now lives in the unified system instead.
      if (src.kind === 'shelfGem') {
        draggedObj.setDepth(0).setAlpha(1);
        if (totalMove < 8) {
          playSfx('uiClick');
          this.detailGemIndex = src.index;
          this.inspectOwned = null;
        }
        this.rerender();
        return;
      }

      // Inspect on tap; selling is explicit in details or by dragging to SELL ZONE.
      if (src.kind === 'gem') {
        if (totalMove < 8) {
          playSfx('uiClick');
          this.inspectGemIndex = src.index;
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

      // Completed same-card double activation opens details; a single release only restores its visual.
      if (totalMove < 8) {
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
        if (outcome) this.applyRearrange(outcome);
        else this.invalidFlash = { where: hit.where, index: hit.slot };
      }
      this.rerender();
    });

    this.input.on('pointerupoutside', () => {
      this.detailActivation.reset();
      if (dragging?.home) dragging.obj.setPosition(dragging.home.x, dragging.home.y).setDepth(0).setAlpha(1);
      ghost?.destroy(); ghost = null;
      dragging = null; pendingShelf = null; scrolling = null;
    });
    this.input.on('wheel', (pointer: Phaser.Input.Pointer, _o: unknown, _dx: number, dy: number) => {
      if (this.inspectOwned || this.detailCardIndex !== null || this.detailGemIndex !== null || this.inspectGemIndex !== null || this.pendingBuy || this.pendingSell) return;
      this.detailActivation.reset();
      if (this.shelfMaxScroll <= 0 || !inViewport(pointer.worldX, pointer.worldY)) return;
      this.shelfScrollY = Phaser.Math.Clamp(this.shelfScrollY - dy, -this.shelfMaxScroll, 0);
      this.setShelfScrollPosition(this.shelfScrollY);
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
    const offeredSkillId = buy.kind === 'card' ? shelf.cards[buy.index]?.skillId : undefined;
    const preview = mergeTarget && offeredSkillId
      ? tierUpgradePreview(offeredSkillId, mergeTarget.fromTier, mergeTarget.toTier)
      : null;
    const mergePreview = preview?.available ? preview : null;
    const dest = buy.kind === 'card' ? buy.dest : undefined;

    this.add.rectangle(0, 0, this.W, this.H, 0x05070c, 0.72).setOrigin(0, 0).setInteractive();
    const bw = this.W - 60; const bx = 30;
    const panel = this.add.rectangle(0, 0, bw, 140, 0x141d2c).setOrigin(0, 0).setStrokeStyle(2, 0xe8b446);
    let contentY = 72;
    const mergeContent: Phaser.GameObjects.Text[] = [];
    if (mergeTarget) {
      const summary = this.add.text(bw / 2, contentY, `Already owned — MERGE → ${name} ${mergeTarget.toTier.toUpperCase()} (${mergeTarget.fromTier.toUpperCase()} → ${mergeTarget.toTier.toUpperCase()})`, {
        fontSize: `${F.tiny}px`, color: '#e8b446', fontFamily: FONT.body, fontStyle: 'bold', align: 'center', wordWrap: { width: bw - 32 },
      }).setOrigin(0.5, 0);
      mergeContent.push(summary);
      contentY += summary.height + 12;
    }
    if (mergePreview?.conditionalTrade) {
      const guaranteedDelta = (mergePreview.guaranteedDeltaDeci / 10).toFixed(1).replace(/\.0$/, '');
      const warning = this.add.text(bw / 2, contentY, `CONDITIONAL UPGRADE · GUARANTEED POWER ${guaranteedDelta}`, {
        ...textRole('kicker', { ink: 'alarm' }), align: 'center', wordWrap: { width: bw - 32 },
      }).setOrigin(0.5, 0);
      mergeContent.push(warning);
      contentY += warning.height + 12;
    }
    if (mergePreview) {
      const stats = this.add.text(16, contentY, `${mergePreview.toSkill.tier.toUpperCase()} UPGRADE\n${stripCardTextMarkup(renderSkillText(mergePreview.toSkill))}`, {
        fontSize: `${F.small}px`, color: UI.textBright, fontFamily: FONT.body, lineSpacing: 4, wordWrap: { width: bw - 32 },
      }).setOrigin(0, 0);
      mergeContent.push(stats);
      contentY += stats.height + 20;
    }
    const bh = mergeTarget ? contentY + 64 : 140;
    const by = this.H / 2 - bh / 2;
    panel.setPosition(bx, by).setSize(bw, bh);
    mergeContent.forEach(text => text.setPosition(bx + text.x, by + text.y));
    const headline = dest ? `BUY → ${dest.where.toUpperCase()} SLOT ${dest.slot + 1}` : `Buy ${name}?`;
    const confirmHeadline = this.add.text(this.W / 2, by + 24, headline, { fontSize: `${F.heading}px`, color: UI.textBright, fontFamily: FONT.display, fontStyle: 'bold' }).setOrigin(0.5);
    addRunArt(this, RUN_ART_KEYS.icon.coin, {
      x: confirmHeadline.x - confirmHeadline.width / 2 - 26,
      y: by + 12,
      width: 22,
      height: 22,
    });
    this.add.text(this.W / 2, by + 50, dest ? `${name} · ${price} gold` : `${price} gold — leaves the shelf once bought.`, { fontSize: `${F.small}px`, color: UI.textFootnote, fontFamily: FONT.body }).setOrigin(0.5);

    type ConfirmButton = { label: string; fill: number; color: string; fn: () => void };
    const doBuy = (): void => {
      const result = runMode
        ? (buy.kind === 'card' ? (dest ? buyCurrentShopCardTo(buy.index, dest) : buyCurrentShopCard(buy.index)) : buyCurrentShopGem(buy.index))
        : (buy.kind === 'card' ? (dest ? buyCardTo(shopId, buy.index, dest) : buyCard(shopId, buy.index)) : buyGem(shopId, buy.index));
      this.pendingBuy = null;
      this.mergePreviewOpen = false;
      this.detailCardIndex = null;
      this.detailGemIndex = null;
      if (result.ok && runMode && buy.kind === 'card') this.selectedCardIndex = null;
      this.rerender();
      if (!result.ok) this.showToast(result.reason === 'bag' || result.reason === 'slot' ? 'No room there — purchase cancelled' : 'Could not complete purchase', '#e8907a');
      else { playSfx('purchase'); this.showToast(`Bought ${name}`, UI.textGem); }
    };
    const doMerge = (): void => {
      const result = runMode ? mergeCurrentShopCard(buy.index) : mergeCard(shopId, buy.index);
      this.pendingBuy = null;
      this.mergePreviewOpen = false;
      this.detailCardIndex = null;
      this.detailGemIndex = null;
      if (result.ok && runMode) this.selectedCardIndex = null;
      this.rerender();
      if (!result.ok) this.showToast('Could not complete merge', '#e8907a');
      else { playSfx('purchase'); this.showToast(`Merged into ${mergeTarget!.toTier.toUpperCase()} ${name}`, UI.textGem); }
    };

    const buttons: ConfirmButton[] = [
      { label: 'CANCEL', fill: 0x1b2940, color: UI.textBright, fn: () => { playSfx('uiBack'); this.pendingBuy = null; this.mergePreviewOpen = false; this.rerender(); } },
      { label: 'BUY', fill: 0xe8b446, color: UI.textOnChip, fn: doBuy },
    ];
    if (mergeTarget) buttons.push({ label: 'MERGE', fill: 0x7cab63, color: UI.textOnChip, fn: doMerge });

    const buttonLayout = mobileShopConfirmButtonLayout({ x: bx, y: by, width: bw, height: bh }, buttons.length);
    buttons.forEach((b, i) => {
      const box = buttonLayout.buttons[i]!;
      const r = this.add.rectangle(box.x, box.y, box.width, box.height, b.fill).setOrigin(0, 0).setStrokeStyle(1, UI.border, 0.7).setInteractive({ useHandCursor: true });
      // The BOARD/BAG columns now sit directly under this dialog, so this
      // exact click would otherwise also be reprocessed as a board/bag tap
      // once `b.fn()`'s `rerender()` closes it — `wasPointerConsumedByRebuild`
      // (sceneRebuild.ts) is what stops that; see `wireDrag`'s pointerdown.
      r.on('pointerdown', () => { b.fn(); });
      this.add.text(box.x + box.width / 2, buttonLayout.labelY, b.label, { fontSize: `${F.name}px`, color: b.color, fontFamily: FONT.body, fontStyle: 'bold' }).setOrigin(0.5);
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
    const mergePreview = preview;
    renderCardDetailOverlay(this, mergePreview.toSkill, {
      font: F,
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

    this.add.rectangle(0, 0, this.W, this.H, 0x05070c, 0.72).setOrigin(0, 0).setInteractive();
    const bw = this.W - 60; const bx = 30; const bh = 132;
    const by = this.H / 2 - bh / 2;
    this.add.rectangle(bx, by, bw, bh, 0x141d2c).setOrigin(0, 0).setStrokeStyle(2, 0xd05c4e);
    this.add.text(this.W / 2, by + 24, `SELL ${preview.name} ${preview.tierLabel}`, { fontSize: `${F.heading}px`, color: UI.textBright, fontFamily: FONT.display, fontStyle: 'bold', align: 'center', wordWrap: { width: bw - 32 } }).setOrigin(0.5);
    this.add.text(this.W / 2, by + 50, `→ +${preview.price} GOLD`, { fontSize: `${F.small}px`, color: '#e08a7a', fontFamily: FONT.body, fontStyle: 'bold' }).setOrigin(0.5);

    const doSell = (): void => {
      const result = sell.location === 'gem'
        ? (runMode ? sellCurrentRunGem(sell.index) : sellGem(sell.index))
        : (runMode ? sellCurrentRunCard(sell.location, sell.index) : sellCard(sell.location, sell.index));
      this.pendingSell = null;
      this.rerender();
      if (!result.ok) this.showToast('Could not complete sale', '#e8907a');
      else { playSfx('uiClick'); this.showToast(`Sold ${preview.name} · +${result.goldReceived} gold`, UI.textGem); }
    };

    const buttonLayout = mobileShopConfirmButtonLayout({ x: bx, y: by, width: bw, height: bh }, 2);
    const cancelBox = buttonLayout.buttons[0]!;
    const sellBox = buttonLayout.buttons[1]!;
    const cancel = this.add.rectangle(cancelBox.x, cancelBox.y, cancelBox.width, cancelBox.height, 0x1b2940).setOrigin(0, 0).setStrokeStyle(1, UI.border, 0.7).setInteractive({ useHandCursor: true });
    this.add.text(cancelBox.x + cancelBox.width / 2, buttonLayout.labelY, 'CANCEL', { fontSize: `${F.name}px`, color: UI.textBright, fontFamily: FONT.body, fontStyle: 'bold' }).setOrigin(0.5);
    cancel.on('pointerdown', () => { playSfx('uiBack'); this.pendingSell = null; this.rerender(); });
    const sellBtn = this.add.rectangle(sellBox.x, sellBox.y, sellBox.width, sellBox.height, 0x7a2e2a).setOrigin(0, 0).setStrokeStyle(1, 0xd05c4e, 1).setInteractive({ useHandCursor: true });
    this.add.text(sellBox.x + sellBox.width / 2, buttonLayout.labelY, 'SELL', { fontSize: `${F.name}px`, color: '#ffffff', fontFamily: FONT.body, fontStyle: 'bold' }).setOrigin(0.5);
    sellBtn.on('pointerdown', () => { doSell(); });
  }

  private showToast(text: string, color: string): void {
    for (const o of this.toastObjects) o.destroy();
    this.toastObjects = [];
    const t = this.add.text(this.W / 2, this.H - 60, text, { fontSize: `${F.body}px`, color, fontFamily: FONT.body, fontStyle: 'bold' }).setOrigin(0.5).setDepth(4001);
    const bg = this.add.rectangle(this.W / 2, this.H - 60, t.width + 24, t.height + 14, 0x0b1420, 0.92).setOrigin(0.5).setDepth(4000).setStrokeStyle(1, 0x3a4a62, 0.9);
    this.toastObjects = [bg, t];
    this.tweens.add({ targets: [t, bg], alpha: 0, delay: 1200, duration: 500, onComplete: () => { for (const o of this.toastObjects) o.destroy(); this.toastObjects = []; } });
  }
}
