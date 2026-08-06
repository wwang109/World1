import Phaser from 'phaser';
import { playSfx } from '../audio/sfxSynth';
import { applyTier } from '../../engine/cards';
import { skillBook } from '../../data/skills';
import { gemBook, type GemDef } from '../../data/gems';
import { shopCatalog, shopTypeIds } from '../../data/shopTypes';
import { setDeckBuildContext } from '../deckBuildContext';
import type { Gem, SkillDef, SkillTier } from '../../engine/types';
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
import { MOBILE_PROFILE } from '../layoutProfile';
import { FONT, GEM_RARITY_COLOR, SCREEN, UI } from '../theme';
import { CardToken } from '../ui/CardToken';
import { FantasyCardTemplateV2 } from '../ui/FantasyCardTemplateV2';
import { renderRetireConfirm, renderRunHud, snapshotRunProgress } from '../ui/RunProgressStrip';
import { addRunArt, RUN_ART_KEYS, shopArtKey } from '../ui/runArt';
import { runScreenTemplate } from '../ui/runScreenTemplate';
import { rebuildScene, wasPointerConsumedByRebuild } from '../sceneRebuild';
import { BoardColumn, type ColumnPiece } from '../ui/BoardColumn';

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

const F = MOBILE_PROFILE.font;
const TEMPLATE = runScreenTemplate('mobile');

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
const POUCH_CELL_H = 24;
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
const STRIP_GAP = 8;

/**
 * Mobile Shop — storefront picker (16 themed shops, tap to browse) → shelf
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
 */
export class MobileShopScene extends Phaser.Scene {
  private W = SCREEN.width;
  private H = SCREEN.height;
  private selectedShop: string | null = null;
  private detailCardIndex: number | null = null;
  private detailGemIndex: number | null = null;
  private detailTier: SkillTier = 'bronze';
  private pendingBuy: PendingBuy | null = null;
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

  private draggables: DragEntry[] = [];
  private ownedColumns: OwnedColumnLayout | null = null;
  private sellZoneRectObj: Phaser.GameObjects.Rectangle | null = null;
  private sellZoneLabelObj: Phaser.GameObjects.Text | null = null;
  /**
   * `pointer.downTime` of the most recent click a DIALOG BUTTON (CANCEL/BUY/
   * MERGE/SELL) already handled — read by `wireDrag`'s scene-wide generic
   * pointerdown handler to skip re-processing that SAME physical click as a
   * board/bag hit-test.
   *
   * Real bug this fixes (desktop twin discovered it first, 2026-08-05): the
   * BOARD/BAG columns are now tall enough that a centered confirm dialog's
   * buttons always sit ON TOP of a board/bag card underneath. Phaser
   * dispatches a pointerdown to BOTH the button's own object-level listener
   * AND the scene's generic `this.input.on('pointerdown')` listener for the
   * SAME click — deterministically, not a timing race. If the button's
   * handler calls `rerender()` (closing the dialog) BEFORE the generic
   * listener runs, the generic listener sees the just-closed dialog state
   * and the FRESH (rebuilt) `draggables`, "discovers" the card now exposed
   * under the same pixel, and starts a phantom drag/tap — which completes as
   * a SELL confirm on pointerup. Every button that can overlap a card must
   * call `consumePointer(pointer)` before mutating state.
   */
  private consumedPointerAt: number | null = null;

  constructor() { super('MobileShop'); }

  /** See `consumedPointerAt`. Call from every dialog-button's OWN pointerdown
   * handler, before it mutates any pending-dialog state. */
  private consumePointer(pointer: Phaser.Input.Pointer): void {
    this.consumedPointerAt = pointer.downTime;
  }

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
    this.consumedPointerAt = null;
    // rebuildScene() destroys the game objects but NOT the fields pointing at
    // them (scene-rebuild idiom).
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
    this.W = SCREEN.width; this.H = SCREEN.height;
    this.draggables = [];
    this.shelfContainer = null;
    this.ownedColumns = null;
    this.sellZoneRectObj = null;
    this.sellZoneLabelObj = null;
    this.cameras.main.setBackgroundColor(0x0b1420);
    const runShop = this.runShopId();
    if (runShop) {
      this.renderHud();
    } else {
      this.renderTabs();
      this.renderGoldBalance();
    }
    const shopId = runShop ?? this.selectedShop;
    if (shopId) {
      this.renderShelf(shopId);
      this.renderOwnedColumns();
    } else {
      this.renderStorefront();
    }
    this.wireDrag();
    if (this.pendingBuy) this.renderConfirm();
    else if (this.pendingSell) this.renderSellConfirm();
    else if (this.detailCardIndex !== null) this.renderCardDetail();
    else if (this.detailGemIndex !== null) this.renderGemDetail();
    if (this.retireConfirmOpen) {
      renderRetireConfirm(this, {
        compact: true,
        onCancel: (pointer) => { this.consumePointer(pointer); this.retireConfirmOpen = false; this.rerender(); },
        onConfirm: (pointer) => { this.consumePointer(pointer); retireActiveRun(); this.scene.start('MobileRunMap'); },
      });
    }
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
        primary: { label: 'LEAVE SHOP', onPress: () => { leaveCurrentShop(); this.scene.start('MobileRunMap'); } },
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
    const gap = 5;
    const w = (this.W - 20 - gap * (tabs.length - 1)) / tabs.length;
    tabs.forEach(([label, active, fn], i) => {
      const x = 10 + i * (w + gap);
      const r = this.add.rectangle(x, 8, w, 34, active ? 0xb78a46 : 0x131f32).setOrigin(0, 0).setStrokeStyle(1, UI.border, 0.7).setInteractive({ useHandCursor: true });
      r.on('pointerdown', () => { playSfx('uiClick'); fn(); });
      this.add.text(x + w / 2, 25, label, { fontSize: `${F.tiny}px`, color: active ? UI.textOnChip : UI.textDim, fontFamily: FONT.body, fontStyle: 'bold' }).setOrigin(0.5);
    });
  }

  private renderGoldBalance(): void {
    this.add.text(this.W - 12, 50, this.goldLabel(), { fontSize: `${F.body}px`, color: UI.textAccent, fontFamily: FONT.body, fontStyle: 'bold' }).setOrigin(1, 0);
  }

  // ---------- storefront ----------

  private renderStorefront(): void {
    this.add.text(12, 46, 'CHOOSE A SHOP', { fontSize: `${F.label}px`, color: UI.textMuted, fontFamily: FONT.body, fontStyle: 'bold' });
    // 16 themes won't fit as full-width rows (they ran off the bottom), so the
    // picker is a 2-column grid sized to the remaining screen height. Sized
    // (not capped low) to actually fill that height — the old fixed 76px cap
    // left ~140px of dead space below row 8 on a 892-tall canvas.
    const top = 60;
    const cols = 2;
    const gap = 6;
    const cellW = (this.W - 20 - gap * (cols - 1)) / cols;
    const rows = Math.ceil(shopTypeIds.length / cols);
    const h = Math.min(100, (this.H - top - 12 - gap * (rows - 1)) / rows);
    shopTypeIds.forEach((id, i) => {
      const shop = shopCatalog[id]!;
      const x = 10 + (i % cols) * (cellW + gap);
      const y = top + Math.floor(i / cols) * (h + gap);
      const cell = this.add.rectangle(x, y, cellW, h, 0x101a2a, 0.94).setOrigin(0, 0).setStrokeStyle(1, UI.border, 0.7).setInteractive({ useHandCursor: true });
      // CONFIRMED INSTANCE (#22, audit 2026-08): entering a shop rebuilds the
      // scene into the shelf+BOARD/BAG layout — a storefront tile's own pixel
      // can land on a shelf/board/bag card in that FRESH layout, and the
      // rebuild's freshly re-registered wireDrag pointerdown listener would
      // "discover" it. See `consumedPointerAt`'s doc comment.
      cell.on('pointerdown', (pointer: Phaser.Input.Pointer) => { this.consumePointer(pointer); playSfx('uiClick'); ensureShelf(id); this.selectedShop = id; this.rerender(); });
      const bannerH = Math.min(44, Math.round(h * 0.44));
      addRunArt(this, shopArtKey(id), { x, y, width: cellW, height: bannerH }, 0.8);
      this.add.rectangle(x, y, cellW, bannerH, 0x0b1420, 0.28).setOrigin(0, 0);
      this.add.text(x + 10, y + bannerH + 6, shop.name.toUpperCase(), { fontSize: `${F.body}px`, color: UI.textBright, fontFamily: FONT.display, fontStyle: 'bold', wordWrap: { width: cellW - 20 } });
      this.add.text(x + 10, y + h - 14, `${shop.shelf.cards}C · ${shop.shelf.gems}G`, { fontSize: `${F.tiny}px`, color: UI.textAccent, fontFamily: FONT.body, fontStyle: 'bold' });
    });
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
    const top = runShop ? TEMPLATE.regions.content.y : 50;

    let titleX = 10;
    if (!runShop) {
      const backW = 70;
      const back = this.add.rectangle(10, top, backW, 24, 0x131f32).setOrigin(0, 0).setStrokeStyle(1, UI.border, 0.7).setInteractive({ useHandCursor: true });
      this.add.text(10 + backW / 2, top + 12, '‹ SHOPS', { fontSize: `${F.tiny}px`, color: UI.textBright, fontFamily: FONT.body, fontStyle: 'bold' }).setOrigin(0.5);
      back.on('pointerdown', (pointer: Phaser.Input.Pointer) => { this.consumePointer(pointer); playSfx('uiBack'); this.selectedShop = null; this.rerender(); });
      titleX = 18 + backW;
    }
    this.add.text(titleX, top, shop.name.toUpperCase(), { fontSize: `${F.lead}px`, color: UI.textAccent, fontFamily: FONT.display, fontStyle: 'bold' });

    // A thin shop whose whole pool already fits the shelf can never reveal
    // anything new on reroll (docs/run-shops-design.md §2b, USER-LOCKED).
    const rerollY = top + 26;
    const rerollW = 92;
    if (info.fullStock) {
      this.add.rectangle(this.W - 10 - rerollW, rerollY, rerollW, 24, 0x16233a, 0.5).setOrigin(0, 0).setStrokeStyle(1, UI.border, 0.4);
      this.add.text(this.W - 10 - rerollW / 2, rerollY + 12, 'FULL STOCK', { fontSize: `${F.tiny}px`, color: UI.textMuted, fontFamily: FONT.body, fontStyle: 'bold' }).setOrigin(0.5);
    } else {
      const canReroll = this.activeGold() >= 1;
      const rr = this.add.rectangle(this.W - 10 - rerollW, rerollY, rerollW, 24, canReroll ? 0xb78a46 : 0x16233a, canReroll ? 1 : 0.5)
        .setOrigin(0, 0).setStrokeStyle(1, UI.border, canReroll ? 1 : 0.4);
      this.add.text(this.W - 10 - rerollW / 2, rerollY + 12, 'REROLL · 1G', { fontSize: `${F.tiny}px`, color: canReroll ? UI.textOnChip : UI.textDisabled, fontFamily: FONT.body, fontStyle: 'bold' }).setOrigin(0.5);
      if (canReroll) {
        rr.setInteractive({ useHandCursor: true });
        rr.on('pointerdown', (pointer: Phaser.Input.Pointer) => { this.consumePointer(pointer); playSfx('purchase'); runShop ? rerollCurrentShop() : rerollShelf(shopId); this.rerender(); });
      }
    }

    const cardSlots = info.cardSlots;
    const gemSlots = info.gemSlots;

    // Scrollable viewport for the CARDS+GEMS list — bottom-anchored above the
    // fixed OWNED_BAND_H reserved for the BOARD/BAG columns + SELL ZONE/POUCH
    // beneath them (see that constant's comment).
    const contentTop = top + 54;
    const bottomLimit = (runShop ? TEMPLATE.regions.footer.y : this.H - MOBILE_PROFILE.safe.bottom) - 6;
    const viewportBottom = bottomLimit - OWNED_BAND_H - STRIP_GAP;
    const viewportH = Math.max(40, viewportBottom - contentTop);
    this.shelfViewport = { x: 10, y: contentTop, width: this.W - 20, height: viewportH };

    const container = this.add.container(0, this.shelfScrollY);
    this.shelfContainer = container;
    const created: Phaser.GameObjects.GameObject[] = [];
    const A = <T extends Phaser.GameObjects.GameObject>(obj: T): T => { created.push(obj); return obj; };

    const rowGap = 8;
    const labelH = 16;
    const cardH = 92;
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
        const tok = new CardToken(this, 10 + (this.W - 20) / 2, y + cardH / 2, skill, { width: this.W - 20, height: cardH, side: 'left' });
        A(tok);
        this.draggables.push({ bounds: new Phaser.Geom.Rectangle(10, y, this.W - 20, cardH), src: { kind: 'shelfCard', index: i }, obj: tok });
        const affordable = this.activeGold() >= offer.price;
        A(this.add.text(this.W - 16, y + 6, `${offer.price} G`, { fontSize: `${F.small}px`, color: affordable ? '#e8b446' : '#e08a7a', fontFamily: FONT.body, fontStyle: 'bold' }).setOrigin(1, 0).setBackgroundColor('#0b1420').setPadding(4, 2, 4, 2));
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
        const cell = A(this.add.rectangle(10, y, this.W - 20, gemH, 0x101a2a, 0.94).setOrigin(0, 0).setStrokeStyle(1, GEM_RARITY_COLOR[gem.rarity], 0.8).setInteractive({ useHandCursor: true }));
        cell.on('pointerdown', (pointer: Phaser.Input.Pointer) => { this.consumePointer(pointer); playSfx('uiClick'); this.detailGemIndex = i; this.rerender(); });
        A(this.add.rectangle(28, y + gemH / 2, 11, 11, GEM_RARITY_COLOR[gem.rarity]).setOrigin(0.5).setAngle(45));
        A(this.add.text(42, y + 8, gem.name, { fontSize: `${F.label}px`, color: UI.textBright, fontFamily: FONT.display, fontStyle: 'bold' }));
        const body = A(this.add.text(42, y + 24, stripCardTextMarkup(gem.text), { fontSize: `${F.tiny}px`, color: '#e8b446', fontFamily: FONT.body, fontStyle: 'bold', wordWrap: { width: this.W - 100 } }));
        let s = stripCardTextMarkup(gem.text);
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
      const skill = skillBook[p.skillId];
      if (!skill) continue;
      boardPieces.push({ skill, slot: p.slot });
      boardSkills.push(skill);
    }
    const boardCol = new BoardColumn(this, {
      x: boardX, y: colTop, width: colW, height: colH, side: 'left',
      slotCount: BOARD_BAG_SLOTS, gap: rowGap, pieces: boardPieces, deck: boardSkills,
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
    this.sellZoneLabelObj = this.add.text(rowX + rowW / 2, y + SELL_ZONE_H / 2, 'SELL ZONE — drag or tap to sell', {
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
    const cellW = 26;
    const gap = 3;
    const maxShown = Math.max(0, Math.floor((rowW + gap) / (cellW + gap)) - 1);
    const pouch = this.gemInventory;
    const shown = pouch.slice(0, maxShown);
    shown.forEach((gemId, i) => {
      const gem = gemBook[gemId];
      const cx = rowX + i * (cellW + gap);
      const box = this.add.container(cx, y);
      const bg = this.add.rectangle(cellW / 2, POUCH_CELL_H / 2, cellW, POUCH_CELL_H, 0x101a2a, 0.94).setStrokeStyle(1, gem ? GEM_RARITY_COLOR[gem.rarity] : UI.border, 0.9);
      const label = this.add.text(cellW / 2, POUCH_CELL_H / 2, gem?.name.slice(0, 2).toUpperCase() ?? '??', {
        fontSize: `${F.tiny}px`, color: UI.textBright, fontFamily: FONT.body, fontStyle: 'bold',
      }).setOrigin(0.5);
      box.add([bg, label]);
      this.draggables.push({ bounds: new Phaser.Geom.Rectangle(cx, y, cellW, POUCH_CELL_H), src: { kind: 'gem', index: i }, obj: box });
    });
    if (pouch.length > maxShown) {
      this.add.text(rowX + shown.length * (cellW + gap), y + POUCH_CELL_H / 2, `+${pouch.length - maxShown}`, {
        fontSize: `${F.tiny}px`, color: UI.textMuted, fontFamily: FONT.body, fontStyle: 'bold',
      }).setOrigin(0, 0.5);
    }
  }

  // ---------- card/gem inspect overlays (tap, no drag) ----------

  private renderCardDetail(): void {
    const shopId = this.activeShopId();
    const shelf = this.shelfFor(shopId);
    const offer = shelf.cards[this.detailCardIndex!];
    if (!offer) { this.detailCardIndex = null; return; }
    const base = skillBook[offer.skillId]!;
    const shown = this.detailTier === base.tier ? base : applyTier(base, this.detailTier);

    const veil = this.add.rectangle(0, 0, this.W, this.H, 0x05070c, 0.86).setOrigin(0, 0).setInteractive();
    // consumePointer FIRST — see its doc comment: the BOARD/BAG columns sit
    // directly under this full-screen veil, so this exact dismiss tap would
    // otherwise also be reprocessed as a board/bag tap once `rerender()`
    // closes the overlay and re-exposes whatever card was underneath.
    veil.on('pointerdown', (pointer: Phaser.Input.Pointer) => { this.consumePointer(pointer); playSfx('uiBack'); this.detailCardIndex = null; this.rerender(); });

    const centerX = this.W / 2;
    const cardW = 150;
    const cardH = cardW * (690 / 420);
    let y = 70;
    const cardY = y + cardH / 2;
    new FantasyCardTemplateV2(this, centerX, cardY, shown, { width: cardW, height: cardH, tier: this.detailTier, glossary: false });
    y = cardY + cardH / 2 + 10;

    this.add.text(centerX, y, base.name, { fontFamily: FONT.display, fontStyle: 'bold', fontSize: `${F.heading}px`, color: UI.textBright, align: 'center', wordWrap: { width: this.W - 40 } }).setOrigin(0.5, 0);
    y += 24;
    const text = this.add.text(centerX, y, stripCardTextMarkup(shown.text), {
      fontFamily: FONT.body, fontSize: `${F.label}px`, color: '#c9b896', align: 'center', wordWrap: { width: this.W - 40 }, lineSpacing: 3,
    }).setOrigin(0.5, 0);
    y += text.height + 16;

    const runMode = this.isRunMode();
    const affordable = this.activeGold() >= offer.price;
    const hasRoom = runMode ? currentRunBagHasRoomFor(offer.skillId) : bagHasRoomFor(offer.skillId);
    // A duplicate MERGE never needs bag room (it upgrades an already-owned
    // slot instead of adding a new one) — a full bag no longer blocks opening
    // the confirm dialog when a merge target exists.
    const mergeTarget = runMode ? currentShopMergeTarget(offer.skillId) : mergeTargetFor(offer.skillId);
    const canBuy = affordable && (hasRoom || mergeTarget != null);
    const btn = this.add.rectangle(centerX, y, this.W - 40, 40, canBuy ? 0xe8b446 : 0x16233a, canBuy ? 1 : 0.5).setOrigin(0.5, 0).setStrokeStyle(1, UI.border, canBuy ? 0.8 : 0.4);
    const label = !affordable ? `NEED ${offer.price} GOLD` : !hasRoom && !mergeTarget ? 'BAG FULL' : !hasRoom ? 'MERGE AVAILABLE' : `BUY · ${offer.price} GOLD`;
    this.add.text(centerX, y + 20, label, { fontSize: `${F.body}px`, color: canBuy ? UI.textOnChip : UI.textDisabled, fontFamily: FONT.body, fontStyle: 'bold' }).setOrigin(0.5);
    if (canBuy) {
      btn.setInteractive({ useHandCursor: true });
      btn.on('pointerdown', (_p: Phaser.Input.Pointer, _lx: number, _ly: number, event: Phaser.Types.Input.EventData) => {
        event.stopPropagation();
        playSfx('uiClick');
        this.pendingBuy = { kind: 'card', index: this.detailCardIndex! };
        this.rerender();
      });
    }
  }

  private renderGemDetail(): void {
    const shopId = this.activeShopId();
    const shelf = this.shelfFor(shopId);
    const offer = shelf.gems[this.detailGemIndex!];
    if (!offer) { this.detailGemIndex = null; return; }
    const gem: GemDef = gemBook[offer.gemId]!;

    const veil = this.add.rectangle(0, 0, this.W, this.H, 0x05070c, 0.86).setOrigin(0, 0).setInteractive();
    // consumePointer FIRST — see its doc comment: the BOARD/BAG columns sit
    // directly under this full-screen veil, so this exact dismiss tap would
    // otherwise also be reprocessed as a board/bag tap once `rerender()`
    // closes the overlay and re-exposes whatever card was underneath.
    veil.on('pointerdown', (pointer: Phaser.Input.Pointer) => { this.consumePointer(pointer); playSfx('uiBack'); this.detailGemIndex = null; this.rerender(); });

    const centerX = this.W / 2;
    let y = 110;
    this.add.rectangle(centerX, y + 12, 30, 30, GEM_RARITY_COLOR[gem.rarity]).setOrigin(0.5).setAngle(45).setStrokeStyle(2, 0x8a94a6, 0.8);
    y += 46;
    this.add.text(centerX, y, gem.name, { fontFamily: FONT.display, fontStyle: 'bold', fontSize: `${F.title}px`, color: UI.textBright, align: 'center', wordWrap: { width: this.W - 40 } }).setOrigin(0.5, 0);
    y += 26;
    this.add.text(centerX, y, `${gem.rarity.toUpperCase()} · ${gem.kind === 'stat' ? 'STAT MOD' : 'EFFECT RIDER'}`, { fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${F.small}px`, color: UI.textMuted }).setOrigin(0.5, 0);
    y += 24;
    const body = this.add.text(centerX, y, stripCardTextMarkup(gem.text), {
      fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${F.name}px`, color: UI.textBright, align: 'center', wordWrap: { width: this.W - 40 }, lineSpacing: 3,
    }).setOrigin(0.5, 0);
    y += body.height + 20;

    const affordable = this.activeGold() >= offer.price;
    const btn = this.add.rectangle(centerX, y, this.W - 40, 40, affordable ? 0xe8b446 : 0x16233a, affordable ? 1 : 0.5).setOrigin(0.5, 0).setStrokeStyle(1, UI.border, affordable ? 0.8 : 0.4);
    this.add.text(centerX, y + 20, affordable ? `BUY · ${offer.price} GOLD` : `NEED ${offer.price} GOLD`, { fontSize: `${F.body}px`, color: affordable ? UI.textOnChip : UI.textDisabled, fontFamily: FONT.body, fontStyle: 'bold' }).setOrigin(0.5);
    if (affordable) {
      btn.setInteractive({ useHandCursor: true });
      btn.on('pointerdown', (_p: Phaser.Input.Pointer, _lx: number, _ly: number, event: Phaser.Types.Input.EventData) => {
        event.stopPropagation();
        playSfx('uiClick');
        this.pendingBuy = { kind: 'gem', index: this.detailGemIndex! };
        this.rerender();
      });
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
      // See `consumedPointerAt` — a dialog button already handled this exact
      // physical click (and likely just closed the dialog + rebuilt the
      // scene); don't ALSO reinterpret it as a fresh board/bag hit-test.
      if (p.downTime === this.consumedPointerAt) return;
      // Structural backstop (sceneRebuild.ts) — catches any rerender()-calling
      // handler that forgot the manual `consumePointer()` call above (e.g. the
      // storefront shop tiles, which have no dialog to guard behind a state
      // flag at all — see `renderStorefront`).
      if (wasPointerConsumedByRebuild(this, p)) return;
      if (this.pendingBuy || this.pendingSell || this.retireConfirmOpen) return;
      // A shelfCard's registered bounds are its UNCLIPPED position inside the
      // scrollable container — a card scrolled below the masked viewport
      // still has bounds sitting where it would be, invisible but "clickable"
      // there. Gate shelfCard hits on `inViewport` too, or a scrolled-away
      // card can steal a tap intended for whatever's actually visible at
      // that pixel — the BOARD/BAG columns now sit directly below a shelf
      // viewport short enough that even a default 6-card shop needs scrolling.
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
            if (preview) this.sellZoneLabelObj.setText(`SELL ${preview.name} → +${preview.price}G`);
          } else {
            this.sellZoneRectObj.setFillStyle(UI.badSoft, 0.35);
            this.sellZoneLabelObj.setText('SELL ZONE — drag or tap to sell');
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
      scrolling = null;
      if (!dragging) return;
      const src = dragging.src;
      const draggedObj = dragging.obj;
      dragging = null;
      ghost?.destroy(); ghost = null;

      if (src.kind === 'shelfCard') {
        const shopId = this.activeShopId();
        const shelf = this.shelfFor(shopId);
        if (totalMove < 8) {
          playSfx('uiClick');
          this.detailCardIndex = src.index;
          this.detailTier = shelf.cards[src.index]?.tier ?? 'bronze';
          this.rerender();
          return;
        }
        // Vertical columns: BOARD/BAG are told apart by X range (which
        // column the pointer is over), the slot by Y position within that
        // column's row pitch — the mirror image of the old horizontal strip,
        // which told them apart by Y band and read the slot off X.
        const strip = this.ownedColumns;
        let where: 'board' | 'bag' | null = null;
        const colBottom = strip ? strip.colTop + BOARD_BAG_SLOTS * strip.rowH + (BOARD_BAG_SLOTS - 1) * strip.rowGap : 0;
        if (strip && p.worldY >= strip.colTop && p.worldY <= colBottom) {
          if (p.worldX >= strip.boardX && p.worldX <= strip.boardX + strip.colW) where = 'board';
          else if (p.worldX >= strip.bagX && p.worldX <= strip.bagX + strip.colW) where = 'bag';
        }
        if (where && strip) {
          const slot = Phaser.Math.Clamp(Math.floor((p.worldY - strip.colTop) / (strip.rowH + strip.rowGap)), 0, BOARD_BAG_SLOTS - 1);
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
      if (totalMove < 8) {
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

    this.add.rectangle(0, 0, this.W, this.H, 0x05070c, 0.72).setOrigin(0, 0).setInteractive();
    const bw = this.W - 60; const bx = 30;
    const bh = mergeTarget ? 172 : 140;
    const by = this.H / 2 - bh / 2;
    this.add.rectangle(bx, by, bw, bh, 0x141d2c).setOrigin(0, 0).setStrokeStyle(2, 0xe8b446);
    const headline = dest ? `BUY → ${dest.where.toUpperCase()} SLOT ${dest.slot + 1}` : `Buy ${name}?`;
    const confirmHeadline = this.add.text(this.W / 2, by + 24, headline, { fontSize: `${F.heading}px`, color: UI.textBright, fontFamily: FONT.display, fontStyle: 'bold' }).setOrigin(0.5);
    addRunArt(this, RUN_ART_KEYS.icon.coin, {
      x: confirmHeadline.x - confirmHeadline.width / 2 - 26,
      y: by + 12,
      width: 22,
      height: 22,
    });
    this.add.text(this.W / 2, by + 50, dest ? `${name} · ${price} gold` : `${price} gold — leaves the shelf once bought.`, { fontSize: `${F.small}px`, color: UI.textFootnote, fontFamily: FONT.body }).setOrigin(0.5);
    if (mergeTarget) {
      this.add.text(this.W / 2, by + 72, `Already owned — MERGE → ${name} ${mergeTarget.toTier.toUpperCase()} (${mergeTarget.fromTier.toUpperCase()} → ${mergeTarget.toTier.toUpperCase()})`, {
        fontSize: `${F.tiny}px`, color: '#e8b446', fontFamily: FONT.body, fontStyle: 'bold', align: 'center', wordWrap: { width: bw - 32 },
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
      if (!result.ok) this.showToast(result.reason === 'bag' || result.reason === 'slot' ? 'No room there — purchase cancelled' : 'Could not complete purchase', '#e8907a');
      else { playSfx('purchase'); this.showToast(`Bought ${name}`, '#9ad17a'); }
    };
    const doMerge = (): void => {
      const result = runMode ? mergeCurrentShopCard(buy.index) : mergeCard(shopId, buy.index);
      this.pendingBuy = null;
      this.detailCardIndex = null;
      this.detailGemIndex = null;
      this.rerender();
      if (!result.ok) this.showToast('Could not complete merge', '#e8907a');
      else { playSfx('purchase'); this.showToast(`Merged into ${mergeTarget!.toTier.toUpperCase()} ${name}`, '#9ad17a'); }
    };

    const buttons: ConfirmButton[] = [
      { label: 'CANCEL', fill: 0x1b2940, color: UI.textBright, fn: () => { playSfx('uiBack'); this.pendingBuy = null; this.rerender(); } },
      { label: 'BUY', fill: 0xe8b446, color: UI.textOnChip, fn: doBuy },
    ];
    if (mergeTarget) buttons.push({ label: 'MERGE', fill: 0x7cab63, color: UI.textOnChip, fn: doMerge });

    const margin = 16; const gap = 8;
    const btnW = (bw - margin * 2 - gap * (buttons.length - 1)) / buttons.length;
    const btnY = by + bh - 52;
    buttons.forEach((b, i) => {
      const dx = bx + margin + i * (btnW + gap);
      const r = this.add.rectangle(dx, btnY, btnW, 36, b.fill).setOrigin(0, 0).setStrokeStyle(1, UI.border, 0.7).setInteractive({ useHandCursor: true });
      // consumePointer FIRST — see its doc comment: the BOARD/BAG columns now
      // sit directly under this dialog, so this exact click would otherwise
      // also be reprocessed as a board/bag tap once `b.fn()` closes it.
      r.on('pointerdown', (pointer: Phaser.Input.Pointer) => { this.consumePointer(pointer); b.fn(); });
      this.add.text(dx + btnW / 2, btnY + 18, b.label, { fontSize: `${F.name}px`, color: b.color, fontFamily: FONT.body, fontStyle: 'bold' }).setOrigin(0.5);
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
      else { playSfx('uiClick'); this.showToast(`Sold ${preview.name} · +${result.goldReceived} gold`, '#9ad17a'); }
    };

    const margin = 16; const gap = 8;
    const btnW = (bw - margin * 2 - gap) / 2;
    const btnY = by + bh - 52;
    const cancel = this.add.rectangle(bx + margin, btnY, btnW, 36, 0x1b2940).setOrigin(0, 0).setStrokeStyle(1, UI.border, 0.7).setInteractive({ useHandCursor: true });
    this.add.text(bx + margin + btnW / 2, btnY + 18, 'CANCEL', { fontSize: `${F.name}px`, color: UI.textBright, fontFamily: FONT.body, fontStyle: 'bold' }).setOrigin(0.5);
    cancel.on('pointerdown', (pointer: Phaser.Input.Pointer) => { this.consumePointer(pointer); playSfx('uiBack'); this.pendingSell = null; this.rerender(); });
    const sellBtn = this.add.rectangle(bx + margin + btnW + gap, btnY, btnW, 36, 0x7a2e2a).setOrigin(0, 0).setStrokeStyle(1, 0xd05c4e, 1).setInteractive({ useHandCursor: true });
    this.add.text(bx + margin + btnW + gap + btnW / 2, btnY + 18, 'SELL', { fontSize: `${F.name}px`, color: '#ffffff', fontFamily: FONT.body, fontStyle: 'bold' }).setOrigin(0.5);
    sellBtn.on('pointerdown', (pointer: Phaser.Input.Pointer) => { this.consumePointer(pointer); doSell(); });
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
