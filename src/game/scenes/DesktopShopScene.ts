import Phaser from 'phaser';
import { playSfx } from '../audio/sfxSynth';
import { applyTier } from '../../engine/cards';
import { skillBook } from '../../data/skills';
import { gemBook, type GemDef } from '../../data/gems';
import { shopCatalog, shopTypeIds } from '../../data/shopTypes';
import type { SkillDef, SkillTier } from '../../engine/types';
import type { CardOffer, GemOffer } from '../../run/shop';
import { shopPoolInfo } from '../../run/shop';
import { bagHasRoomFor, buyCard, buyGem, ensureShelf, mergeCard, mergeTargetFor, rerollShelf } from '../shopActions';
import { demoState } from '../demoState';
import {
  buyCurrentShopCard, buyCurrentShopGem, currentNode, currentRunBagHasRoomFor, currentShopMergeTarget,
  currentShopShelf, ensureCurrentShopShelf, getActiveRun, leaveCurrentShop, mergeCurrentShopCard,
  rerollCurrentShop, retireActiveRun,
} from '../runStore';
import type { MergeTarget } from '../../run/shop';
import { stripCardTextMarkup } from '../ui/cardTextMarkup';
import { DESKTOP_PROFILE } from '../layoutProfile';
import { FONT, GEM_RARITY_COLOR, SCREEN, UI } from '../theme';
import { CardToken } from '../ui/CardToken';
import { FantasyCardTemplateV2 } from '../ui/FantasyCardTemplateV2';
import { DESKTOP_LAYOUT, renderDesktopBackground, renderDesktopHeader } from '../ui/DesktopNav';
import { renderRetireConfirm, renderRunHud, snapshotRunProgress } from '../ui/RunProgressStrip';
import { runScreenTemplate } from '../ui/runScreenTemplate';
import { setDeckBuildContext } from '../deckBuildContext';
import { rebuildScene } from '../sceneRebuild';

/** Structural shape shared by `ShopShelfState` (demoState) and `RunShopShelf`
 * (run) — the shop scene reads/writes through this either way. */
interface ShelfLike { cards: CardOffer[]; gems: GemOffer[]; rerollCount: number }

const F = DESKTOP_PROFILE.font;
const BAD_HEX = `#${UI.bad.toString(16).padStart(6, '0')}`;
const TEMPLATE = runScreenTemplate('desktop');

/** Width of the permanent right-hand inspect dock in the shelf view — sized
 * like the Wiki's detail pane (same idiom) so a card render + full text +
 * BUY button all fit without crowding. */
const DOCK_WIDTH = 380;

type PendingBuy = { kind: 'card'; index: number } | { kind: 'gem'; index: number };

/**
 * Desktop Shop — storefront picker (16 themed shops) → shelf view (card
 * offers + gem offers, gold prices, REROLL) with a permanent right-hand
 * inspect dock. Tap a card/gem tile and its full render/text/BUY button
 * fills the dock in place (no full-screen overlay) — BUY opens a small
 * confirm dialog (mirrors the deck-build trash-confirm) with CANCEL / BUY /
 * (MERGE, when a duplicate is already owned) before the purchase actually
 * deducts gold and lands the item in the bag/pouch.
 */
export class DesktopShopScene extends Phaser.Scene {
  private selectedShop: string | null = null;
  private detailCardIndex: number | null = null;
  private detailGemIndex: number | null = null;
  private detailTier: SkillTier = 'bronze';
  private pendingBuy: PendingBuy | null = null;
  private toastObjects: Phaser.GameObjects.GameObject[] = [];
  private retireConfirmOpen = false;

  constructor() { super('DesktopShop'); }

  init(): void {
    this.selectedShop = null;
    this.detailCardIndex = null;
    this.detailGemIndex = null;
    this.detailTier = 'bronze';
    this.pendingBuy = null;
    this.toastObjects = [];
    this.retireConfirmOpen = false;
  }

  private rerender(): void { rebuildScene(this); }

  /** Run Mode: the current node IS a shop node — single storefront, no
   * 5-shop picker, wallet/shelf come from the active run instead of
   * `demoState`. Sandbox otherwise (unchanged). */
  private runShopId(): string | null {
    const node = currentNode();
    return node?.kind === 'shop' && node.shopId ? node.shopId : null;
  }

  private activeGold(): number {
    const runShop = this.runShopId();
    return runShop ? (getActiveRun()?.gold ?? 0) : demoState.gold;
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

  create(): void {
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
      this.renderDock(shopId);
    } else {
      this.renderStorefront();
    }
    if (this.pendingBuy) this.renderConfirm();
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
    this.add.text(SCREEN.width - gx, 102 + DESKTOP_LAYOUT.tabH / 2, `GOLD ${this.activeGold()}`, {
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
      // Reserved banner band (see comment above `bannerH`) — a quiet
      // placeholder tone only, no art mounted this pass.
      this.add.rectangle(cx, gridTopRow, cellW, bannerH, UI.panelMuted, 0.4).setOrigin(0, 0);
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
    // `sectionTop` threads from the CARDS block into the GEMS block below it
    // — whichever sections exist stack with a consistent margin, and an
    // absent section (a shop with 0 of either) costs no space at all.
    let sectionTop = rowTop;

    // cardCols/gemCols cap at the shop's WHOLE pool size, so a thin theme
    // (e.g. a 1-card element stall) never renders permanent dead "SOLD OUT"
    // gaps — only genuinely transient ones (bought out mid-visit) show up.
    const cardCols = info.cardSlots;
    if (cardCols > 0) {
      this.add.text(gx, sectionTop, `CARDS · ${shelf.cards.length}/${cardCols}`, { fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${F.tiny}px`, color: UI.textDim });
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
        if (!offer) { this.emptySlot(cx, cy, cardW, cardH); continue; }
        const base = skillBook[offer.skillId]!;
        const skill = offer.tier === base.tier ? base : applyTier(base, offer.tier);
        const tok = new CardToken(this, cx + cardW / 2, cy + cardH / 2, skill, { width: cardW, height: cardH, side: 'left' });
        const hit = this.add.rectangle(cx + cardW / 2, cy + cardH / 2, cardW, cardH, 0xffffff, 0).setInteractive({ useHandCursor: true });
        hit.on('pointerdown', () => { playSfx('uiClick'); this.detailCardIndex = i; this.detailTier = offer.tier; this.rerender(); });
        const affordable = this.activeGold() >= offer.price;
        this.add.rectangle(cx, cy + cardH, cardW, priceStripH, UI.panelMuted, 0.95).setOrigin(0, 0).setStrokeStyle(1, UI.border, 0.6);
        this.add.text(cx + cardW / 2, cy + cardH + 12, `${offer.price} GOLD`, {
          fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${F.tiny}px`, color: affordable ? UI.textAccent : BAD_HEX,
        }).setOrigin(0.5);
        void tok;
      }
      sectionTop += (rows - 1) * rowStride + cardH + priceStripH + 24;
    }

    const gemCols = info.gemSlots;
    if (gemCols > 0) {
      this.add.text(gx, sectionTop, `GEMS · ${shelf.gems.length}/${gemCols}`, { fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${F.tiny}px`, color: UI.textDim });
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
        if (!offer) { this.emptySlot(cx, cy, gemW, gemH); continue; }
        const gem = gemBook[offer.gemId]!;
        const cell = this.add.rectangle(cx, cy, gemW, gemH, UI.panel, 0.94)
          .setOrigin(0, 0).setStrokeStyle(1, GEM_RARITY_COLOR[gem.rarity], 0.8).setInteractive({ useHandCursor: true });
        cell.on('pointerdown', () => { playSfx('uiClick'); this.detailGemIndex = i; this.rerender(); });
        this.add.rectangle(cx + 22, cy + 22, 14, 14, GEM_RARITY_COLOR[gem.rarity]).setOrigin(0.5).setAngle(45);
        this.add.text(cx + 38, cy + 12, gem.name, { fontFamily: FONT.display, fontStyle: 'bold', fontSize: `${F.small}px`, color: UI.text });
        const body = this.add.text(cx + 16, cy + 40, stripCardTextMarkup(gem.text), {
          fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${F.tiny}px`, color: UI.textAccent,
          wordWrap: { width: gemW - 32 }, lineSpacing: 2,
        });
        if (body.height > 30) { body.setText(`${body.text.slice(0, 60)}…`); }
        const affordable = this.activeGold() >= offer.price;
        this.add.text(cx + gemW - 16, cy + gemH - 18, `${offer.price} GOLD`, {
          fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${F.tiny}px`, color: affordable ? UI.textAccent : BAD_HEX,
        }).setOrigin(1, 0);
      }
    }

    if (cardCols === 0 && gemCols === 0) {
      this.add.text(gx, rowTop, 'This shop has nothing to sell.', {
        fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${F.small}px`, color: UI.textSoft,
      });
    }
  }

  /** The shop id the dock/confirm overlays operate on — the run's single
   * storefront in Run Mode (no picker to have set `selectedShop`), else the
   * Sandbox's browsed `selectedShop`. */
  private activeShopId(): string {
    return this.runShopId() ?? this.selectedShop!;
  }

  private emptySlot(x: number, y: number, w: number, h: number): void {
    this.add.rectangle(x, y, w, h, UI.panelMuted, 0.4).setOrigin(0, 0).setStrokeStyle(1, UI.border, 0.3);
    this.add.text(x + w / 2, y + h / 2, 'SOLD OUT', { fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${F.tiny}px`, color: UI.textSoft }).setOrigin(0.5);
  }

  // ---------- inspect dock (permanent right-hand panel) ----------

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

    const runMode = this.runShopId() !== null;
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

  // ---------- confirm ----------

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
    const runMode = this.runShopId() !== null;
    const buy = this.pendingBuy!;
    const name = buy.kind === 'card'
      ? (skillBook[shelf.cards[buy.index]?.skillId ?? '']?.name ?? 'card')
      : (gemBook[shelf.gems[buy.index]?.gemId ?? '']?.name ?? 'gem');
    const price = buy.kind === 'card' ? shelf.cards[buy.index]?.price ?? 0 : shelf.gems[buy.index]?.price ?? 0;
    const mergeTarget = this.mergeTargetForPendingBuy(shopId, runMode);

    this.add.rectangle(0, 0, SCREEN.width, SCREEN.height, UI.shadow, 0.72).setOrigin(0, 0).setInteractive();
    const bw = 460;
    const bh = mergeTarget ? 216 : 180;
    const bx = SCREEN.width / 2 - bw / 2; const by = SCREEN.height / 2 - bh / 2;
    this.add.rectangle(bx, by, bw, bh, UI.panelAlt).setOrigin(0, 0).setStrokeStyle(2, UI.chip);
    this.add.text(SCREEN.width / 2, by + 34, `Buy ${name} for ${price} gold?`, { fontSize: `${F.name}px`, color: UI.text, fontFamily: FONT.display, fontStyle: 'bold' }).setOrigin(0.5);
    this.add.text(SCREEN.width / 2, by + 66, 'This offer leaves the shelf once bought.', { fontSize: `${F.small}px`, color: UI.textDim, fontFamily: FONT.body }).setOrigin(0.5);
    if (mergeTarget) {
      this.add.text(SCREEN.width / 2, by + 90, `You already own this — MERGE → ${name} ${mergeTarget.toTier.toUpperCase()} (${mergeTarget.fromTier.toUpperCase()} → ${mergeTarget.toTier.toUpperCase()})`, {
        fontSize: `${F.tiny}px`, color: UI.textAccent, fontFamily: FONT.body, fontStyle: 'bold', align: 'center', wordWrap: { width: bw - 40 },
      }).setOrigin(0.5, 0);
    }

    type ConfirmButton = { label: string; fill: number; color: string; fn: () => void };
    const doBuy = (): void => {
      const result = runMode
        ? (buy.kind === 'card' ? buyCurrentShopCard(buy.index) : buyCurrentShopGem(buy.index))
        : (buy.kind === 'card' ? buyCard(shopId, buy.index) : buyGem(shopId, buy.index));
      this.pendingBuy = null;
      this.detailCardIndex = null;
      this.detailGemIndex = null;
      this.rerender();
      if (!result.ok) this.showToast(result.reason === 'bag' ? 'Bag full — purchase cancelled' : 'Could not complete purchase', UI.bad);
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
