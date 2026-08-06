import Phaser from 'phaser';
import { playSfx } from '../audio/sfxSynth';
import { applyTier } from '../../engine/cards';
import { skillBook } from '../../data/skills';
import { gemBook, type GemDef } from '../../data/gems';
import { shopCatalog, shopTypeIds } from '../../data/shopTypes';
import type { Gem, SkillTier } from '../../engine/types';
import type { CardOffer, GemOffer } from '../../run/shop';
import { sellPriceOfCard, sellPriceOfGem, shopPoolInfo } from '../../run/shop';
import { canPlace, bagAsBoardPieces } from '../../run/loadout';
import {
  bagHasRoomFor, buyCard, buyCardTo, buyGem, ensureShelf, mergeCard, mergeTargetFor, rerollShelf,
  sellCard, sellGem, type BuyDestination,
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
import { runScreenTemplate } from '../ui/runScreenTemplate';
import { setDeckBuildContext } from '../deckBuildContext';
import { rebuildScene } from '../sceneRebuild';

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
const TEMPLATE = runScreenTemplate('desktop');

/** Width of the permanent right-hand inspect dock in the shelf view — sized
 * like the Wiki's detail pane (same idiom) so a card render + full text +
 * BUY button all fit without crowding. Spans the FULL content height
 * (top..bottom), untouched by the 2026-08-04 drag/sell pass below. */
const DOCK_WIDTH = 380;

const BOARD_BAG_SLOTS = 10;

/**
 * Reserved band under the (now scrollable) shelf grid for the new owned-item
 * strips (BOARD · BAG · SELL ZONE · GEM POUCH), bottom-anchored at the same
 * `bottom` the dock uses. FIXED height — never grows/shrinks with a shop's
 * stock, so the shelf viewport above it (not this band) absorbs 100% of any
 * stock-size variance, via scrolling instead of pushing this band around:
 *   BOARD  14 (label) + 4 + 44 (cell)                = 62
 *   BAG    14 + 4 + 44                                = 62
 *   gap                                                = 8
 *   SELL   40                                          = 40
 *   gap                                                = 8
 *   POUCH  14 + 4 + 30                                 = 48
 *   gap (board→bag, already counted above as its own 8)
 *   total  62 + 8 + 62 + 8 + 40 + 8 + 48               = 236
 */
const STRIP_BAND_H = 236;
const STRIP_GAP = 12;
const CELL_W = 92;
const CELL_H = 44;
const CELL_GAP = 6;
const SELL_ZONE_H = 40;
const POUCH_CELL_H = 30;

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

interface OwnedStripLayout {
  rowX: number;
  boardY: number;
  bagY: number;
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
 * 2026-08-04: DRAG-TO-BUY + SELLING. A compact YOUR BOARD / BAG strip (read
 * through the SAME sandbox/run split `DesktopDeckBuildScene` uses) sits below
 * the shelf grid (now a scrollable masked viewport instead of clamped row
 * heights), with a SELL ZONE and a gem POUCH row beneath it. Dragging a
 * shelf card onto a board/bag slot opens the BUY confirm pre-targeted at that
 * destination; dragging an owned card/gem onto SELL ZONE (or just tapping
 * it) opens a SELL confirm. One manual pointer-drag system (hit-test + <8px
 * tap guard — the DeckBuild idiom) drives both.
 */
export class DesktopShopScene extends Phaser.Scene {
  private selectedShop: string | null = null;
  private detailCardIndex: number | null = null;
  private detailGemIndex: number | null = null;
  private detailTier: SkillTier = 'bronze';
  private pendingBuy: PendingBuy | null = null;
  private pendingSell: PendingSell | null = null;
  /** One-shot transient red flash on an invalid BUY-to-slot drop — read and
   * cleared the instant it's rendered (see `renderOwnedStrips`), so it never
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
  private shelfViewport = { x: 0, y: 0, width: 0, height: 0 };
  private shelfMaxScroll = 0;

  private draggables: DragEntry[] = [];
  private ownedStrip: OwnedStripLayout | null = null;
  private sellZoneRectObj: Phaser.GameObjects.Rectangle | null = null;
  private sellZoneLabelObj: Phaser.GameObjects.Text | null = null;

  constructor() { super('DesktopShop'); }

  init(): void {
    this.selectedShop = null;
    this.detailCardIndex = null;
    this.detailGemIndex = null;
    this.detailTier = 'bronze';
    this.pendingBuy = null;
    this.pendingSell = null;
    this.invalidFlash = null;
    this.toastObjects = [];
    this.retireConfirmOpen = false;
    this.shelfScrollY = 0;
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
    this.ownedStrip = null;
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
      this.renderOwnedStrips(shopId);
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
    // edge — the shelf lays out within the narrower remainder so the two
    // never overlap.
    const shelfRight = SCREEN.width - gx - DOCK_WIDTH - DESKTOP_LAYOUT.gap;
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
    addRunArt(this, shopArtKey(shopId), { x: titleX, y: top + F.name + F.small + 8, width: 150, height: 25 }, 0.72);

    // A thin shop whose WHOLE pool already fits the shelf can never reveal
    // anything new on reroll (docs/run-shops-design.md §2b, USER-LOCKED) —
    // hide it behind a "FULL STOCK" label rather than inviting a wasted gold.
    const rerollW = 120;
    const rerollX = shelfRight - rerollW;
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

    const rowTop = top + 64;
    // Scrollable viewport for the CARDS+GEMS grid — bottom-anchored above the
    // fixed STRIP_BAND_H reserved for BOARD/BAG/SELL/POUCH (see that
    // constant's comment). Masking (not row-height clamping) is what makes
    // the shelf immune to overflow regardless of a shop's offer count.
    const viewportTop = rowTop;
    const viewportBottom = bottom - STRIP_BAND_H - STRIP_GAP;
    const viewportH = Math.max(40, viewportBottom - viewportTop);
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
      // Denser grid: wrap past 4 offers into a second row instead of one
      // ever-widening single row — the deepest-stocked shop (Caravan, 6
      // cards) used to force a hard width cap; wrapping uses the vertical
      // room the dock's narrower shelf leaves spare.
      const gridCols = Math.min(cardCols, 4);
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
      // Same wrap treatment as CARDS (max 3-wide — gem tiles carry more
      // text than card tiles, so they stay a touch narrower per column).
      const gridCols = Math.min(gemCols, 3);
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
        cell.on('pointerdown', () => { playSfx('uiClick'); this.detailGemIndex = i; this.rerender(); });
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
  }

  /** The shop id the dock/confirm overlays operate on — the run's single
   * storefront in Run Mode (no picker to have set `selectedShop`), else the
   * Sandbox's browsed `selectedShop`. */
  private activeShopId(): string {
    return this.runShopId() ?? this.selectedShop!;
  }

  // ---------- owned strips: BOARD · BAG · SELL ZONE · GEM POUCH ----------

  private renderOwnedStrips(shopId: string): void {
    const gx = DESKTOP_LAYOUT.gutter;
    const shelfRight = SCREEN.width - gx - DOCK_WIDTH - DESKTOP_LAYOUT.gap;
    const bottom = SCREEN.height - DESKTOP_PROFILE.safe.bottom;
    const stripTop = bottom - STRIP_BAND_H;

    const rowW = CELL_W * BOARD_BAG_SLOTS + CELL_GAP * (BOARD_BAG_SLOTS - 1);
    const rowX = gx + Math.max(0, (shelfRight - gx - rowW) / 2);

    // BOARD row
    this.add.text(rowX, stripTop, `YOUR BOARD · ${this.boardOccupied().filter(Boolean).length}/${BOARD_BAG_SLOTS}`, {
      fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${F.tiny}px`, color: UI.textAccent,
    });
    const boardY = stripTop + 18;
    this.renderBoardRow(rowX, boardY);

    // BAG row
    const bagLabelY = boardY + CELL_H + 8;
    this.add.text(rowX, bagLabelY, `BAG · ${this.bagOccupied().filter(Boolean).length}/${BOARD_BAG_SLOTS}`, {
      fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${F.tiny}px`, color: UI.textAccent,
    });
    const bagY = bagLabelY + 18;
    this.renderBagRow(rowX, bagY);

    // SELL ZONE
    const sellY = bagY + CELL_H + 8;
    const sellRect = new Phaser.Geom.Rectangle(rowX, sellY, rowW, SELL_ZONE_H);
    this.sellZoneRectObj = this.add.rectangle(rowX, sellY, rowW, SELL_ZONE_H, UI.badSoft, 0.35).setOrigin(0, 0).setStrokeStyle(1, UI.bad, 0.8);
    this.sellZoneLabelObj = this.add.text(rowX + rowW / 2, sellY + SELL_ZONE_H / 2, 'SELL ZONE — drag or tap an owned card/gem', {
      fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${F.tiny}px`, color: BAD_HEX,
    }).setOrigin(0.5);

    // GEM POUCH row
    const pouchLabelY = sellY + SELL_ZONE_H + 8;
    this.add.text(rowX, pouchLabelY, `GEM POUCH · ${this.gemInventory.length}`, {
      fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${F.tiny}px`, color: UI.textAccent,
    });
    const pouchY = pouchLabelY + 18;
    this.renderPouchRow(rowX, pouchY, rowW);

    this.ownedStrip = { rowX, boardY, bagY, sellRect };

    // One-shot invalid-drop flash — read + cleared here so it never survives
    // past the single rebuild it was set for.
    if (this.invalidFlash) {
      const flash = this.invalidFlash;
      this.invalidFlash = null;
      const y = flash.where === 'board' ? boardY : bagY;
      const cx = rowX + flash.index * (CELL_W + CELL_GAP);
      const overlay = this.add.rectangle(cx, y, CELL_W, CELL_H, UI.bad, 0.6).setOrigin(0, 0).setStrokeStyle(2, UI.bad, 1);
      this.tweens.add({ targets: overlay, alpha: 0, duration: 420, onComplete: () => overlay.destroy() });
    }
    void shopId;
  }

  private slotBoxLabel(skillId: string, tier: SkillTier): string {
    const skill = skillBook[skillId];
    const name = skill?.name ?? skillId;
    return name.length > 12 ? `${name.slice(0, 11)}…` : `${name} · ${tier[0]!.toUpperCase()}`;
  }

  private renderBoardRow(rowX: number, y: number): void {
    const occ = this.boardOccupied();
    const bySlot = new Map(this.pieces.map((p) => [p.slot, p]));
    for (let slot = 0; slot < BOARD_BAG_SLOTS; slot++) {
      const cx = rowX + slot * (CELL_W + CELL_GAP);
      const piece = bySlot.get(slot);
      if (piece) {
        const idx = this.pieces.findIndex((p) => p.instanceId === piece.instanceId);
        const box = this.makeMiniToken(cx, y, this.slotBoxLabel(piece.skillId, piece.tier));
        this.draggables.push({ bounds: new Phaser.Geom.Rectangle(cx, y, CELL_W, CELL_H), src: { kind: 'board', index: idx }, obj: box });
      } else if (!occ[slot]) {
        this.add.rectangle(cx, y, CELL_W, CELL_H, UI.slot, 0.45).setOrigin(0, 0).setStrokeStyle(1, UI.border, 0.35);
        this.add.text(cx + CELL_W / 2, y + CELL_H / 2, `${slot + 1}`, { fontFamily: 'monospace', fontStyle: 'bold', fontSize: `${F.tiny}px`, color: UI.textSoft }).setOrigin(0.5);
      }
    }
  }

  private renderBagRow(rowX: number, y: number): void {
    const occ = this.bagOccupied();
    for (let slot = 0; slot < BOARD_BAG_SLOTS; slot++) {
      const cx = rowX + slot * (CELL_W + CELL_GAP);
      const card = this.bagSlots[slot];
      if (card) {
        const box = this.makeMiniToken(cx, y, this.slotBoxLabel(card.skillId, card.tier));
        this.draggables.push({ bounds: new Phaser.Geom.Rectangle(cx, y, CELL_W, CELL_H), src: { kind: 'bag', index: slot }, obj: box });
      } else if (!occ[slot]) {
        this.add.rectangle(cx, y, CELL_W, CELL_H, UI.slot, 0.45).setOrigin(0, 0).setStrokeStyle(1, UI.border, 0.35);
        this.add.text(cx + CELL_W / 2, y + CELL_H / 2, `${slot + 1}`, { fontFamily: 'monospace', fontStyle: 'bold', fontSize: `${F.tiny}px`, color: UI.textSoft }).setOrigin(0.5);
      }
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

  /** A compact custom token (not the full `CardToken`) for the BOARD/BAG mini
   * strips — a truncated name/tier line on a plain panel. Kept deliberately
   * simple: these ~44px cells are drag sources/sell targets, not the primary
   * card-inspect surface (that stays the dock/DeckBuild's full `CardToken`). */
  private makeMiniToken(x: number, y: number, label: string): Phaser.GameObjects.Container {
    const box = this.add.container(x, y);
    const bg = this.add.rectangle(CELL_W / 2, CELL_H / 2, CELL_W, CELL_H, UI.playerCard, 0.95).setStrokeStyle(1, UI.border, 0.8);
    const text = this.add.text(CELL_W / 2, CELL_H / 2, label, {
      fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${F.tiny}px`, color: UI.text, align: 'center', wordWrap: { width: CELL_W - 8 },
    }).setOrigin(0.5);
    box.add([bg, text]);
    return box;
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

    if (this.detailCardIndex !== null) { this.renderCardDock(shopId, dockX, top, bottom); return; }
    if (this.detailGemIndex !== null) { this.renderGemDock(shopId, dockX, top, bottom); return; }

    this.add.text(dockX + DOCK_WIDTH / 2, top + 48, 'Tap a card or gem on the shelf to inspect it here.', {
      fontFamily: FONT.body, fontSize: `${F.small}px`, color: UI.textDim, align: 'center', wordWrap: { width: DOCK_WIDTH - 48 },
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
      if (this.pendingBuy || this.pendingSell || this.retireConfirmOpen) return;
      const hit = this.draggables.find((d) => this.worldBounds(d).contains(p.worldX, p.worldY));
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
          const hovering = sell != null && this.ownedStrip != null && this.ownedStrip.sellRect.contains(p.worldX, p.worldY);
          if (hovering && sell) {
            const preview = this.sellPreview(sell);
            this.sellZoneRectObj.setFillStyle(UI.bad, 0.55);
            if (preview) this.sellZoneLabelObj.setText(`SELL ${preview.name} ${preview.tierLabel} → +${preview.price} GOLD`);
          } else {
            this.sellZoneRectObj.setFillStyle(UI.badSoft, 0.35);
            this.sellZoneLabelObj.setText('SELL ZONE — drag or tap an owned card/gem');
          }
        }
        return;
      }
      if (scrolling) {
        this.shelfScrollY = Phaser.Math.Clamp(scrolling.startScroll + (p.worldY - scrolling.startY), -this.shelfMaxScroll, 0);
        this.shelfContainer?.setY(this.shelfScrollY);
      }
    });

    this.input.on('pointerup', (p: Phaser.Input.Pointer) => {
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
          this.rerender();
          return;
        }
        const strip = this.ownedStrip;
        let where: 'board' | 'bag' | null = null;
        if (strip && p.worldY >= strip.boardY && p.worldY <= strip.boardY + CELL_H) where = 'board';
        else if (strip && p.worldY >= strip.bagY && p.worldY <= strip.bagY + CELL_H) where = 'bag';
        if (where && strip) {
          const slot = Phaser.Math.Clamp(Math.floor((p.worldX - strip.rowX) / (CELL_W + CELL_GAP)), 0, BOARD_BAG_SLOTS - 1);
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

      // board/bag/gem: SELL flow
      if (totalMove < 6) {
        playSfx('uiClick');
        this.pendingSell = this.sellRefFor(src);
        this.rerender();
        return;
      }
      draggedObj.setDepth(0).setAlpha(1);
      const strip = this.ownedStrip;
      if (strip && strip.sellRect.contains(p.worldX, p.worldY)) {
        this.pendingSell = this.sellRefFor(src);
      }
      this.rerender();
    });

    this.input.on('wheel', (pointer: Phaser.Input.Pointer, _o: unknown, _dx: number, dy: number) => {
      if (this.shelfMaxScroll <= 0 || !inViewport(pointer.worldX, pointer.worldY)) return;
      this.shelfScrollY = Phaser.Math.Clamp(this.shelfScrollY - dy, -this.shelfMaxScroll, 0);
      this.shelfContainer?.setY(this.shelfScrollY);
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
      r.on('pointerdown', b.fn);
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
    sellBtn.on('pointerdown', doSell);
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
