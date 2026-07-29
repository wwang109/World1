import Phaser from 'phaser';
import { applyTier } from '../../engine/cards';
import { skillBook } from '../../data/skills';
import { gemBook, type GemDef } from '../../data/gems';
import { shopCatalog, shopTypeIds } from '../../data/shopTypes';
import type { SkillDef, SkillTier } from '../../engine/types';
import { bagHasRoomFor, buyCard, buyGem, ensureShelf, rerollShelf } from '../shopActions';
import { demoState } from '../demoState';
import { stripCardTextMarkup } from '../ui/cardTextMarkup';
import { DESKTOP_PROFILE } from '../layoutProfile';
import { FONT, GEM_RARITY_COLOR, SCREEN, UI } from '../theme';
import { CardToken } from '../ui/CardToken';
import { FantasyCardTemplateV2 } from '../ui/FantasyCardTemplateV2';
import { DESKTOP_LAYOUT, renderDesktopBackground, renderDesktopHeader } from '../ui/DesktopNav';
import { rebuildScene } from '../sceneRebuild';

const F = DESKTOP_PROFILE.font;
const BAD_HEX = `#${UI.bad.toString(16).padStart(6, '0')}`;

type PendingBuy = { kind: 'card'; index: number } | { kind: 'gem'; index: number };

/**
 * Desktop Shop — storefront picker (5 themed shops) → shelf view (4 card
 * offers + 3 gem offers, gold prices, REROLL). Tap a card/gem tile to open
 * an inspect overlay (mirrors the Wiki detail pane) with a BUY button; BUY
 * opens a confirm dialog (mirrors the deck-build trash-confirm) before the
 * purchase actually deducts gold and lands the item in the bag/pouch.
 */
export class DesktopShopScene extends Phaser.Scene {
  private selectedShop: string | null = null;
  private detailCardIndex: number | null = null;
  private detailGemIndex: number | null = null;
  private detailTier: SkillTier = 'bronze';
  private pendingBuy: PendingBuy | null = null;
  private toastObjects: Phaser.GameObjects.GameObject[] = [];

  constructor() { super('DesktopShop'); }

  init(): void {
    this.selectedShop = null;
    this.detailCardIndex = null;
    this.detailGemIndex = null;
    this.detailTier = 'bronze';
    this.pendingBuy = null;
    this.toastObjects = [];
  }

  private rerender(): void { rebuildScene(this); }

  create(): void {
    renderDesktopBackground(this);
    renderDesktopHeader(this, 'SHOP', 'shop');
    this.renderGoldBalance();
    if (this.selectedShop === null) this.renderStorefront();
    else this.renderShelf(this.selectedShop);
    if (this.pendingBuy) this.renderConfirm();
    else if (this.detailCardIndex !== null) this.renderCardDetail();
    else if (this.detailGemIndex !== null) this.renderGemDetail();
  }

  private renderGoldBalance(): void {
    const gx = DESKTOP_LAYOUT.gutter;
    this.add.text(SCREEN.width - gx, 102 + DESKTOP_LAYOUT.tabH / 2, `GOLD ${demoState.gold}`, {
      fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${F.body}px`, color: UI.textAccent,
    }).setOrigin(1, 0.5);
  }

  // ---------- storefront ----------

  private renderStorefront(): void {
    const gx = DESKTOP_LAYOUT.gutter;
    const top = DESKTOP_LAYOUT.contentTop;
    this.add.text(gx, top, 'CHOOSE A SHOP', { fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${F.label}px`, color: UI.textAccent });
    const gridTop = top + F.label + 16;
    const cols = 5;
    const gap = DESKTOP_LAYOUT.gap;
    const w = SCREEN.width - gx * 2;
    const cellW = (w - gap * (cols - 1)) / cols;
    const cellH = 220;
    shopTypeIds.forEach((id, i) => {
      const shop = shopCatalog[id]!;
      const cx = gx + i * (cellW + gap);
      const cell = this.add.rectangle(cx, gridTop, cellW, cellH, UI.panel, 0.94)
        .setOrigin(0, 0).setStrokeStyle(1, UI.border, 0.8).setInteractive({ useHandCursor: true });
      cell.on('pointerover', () => cell.setStrokeStyle(2, UI.chip, 1));
      cell.on('pointerout', () => cell.setStrokeStyle(1, UI.border, 0.8));
      cell.on('pointerdown', () => {
        ensureShelf(id);
        this.selectedShop = id;
        this.rerender();
      });
      this.add.text(cx + 16, gridTop + 20, shop.name.toUpperCase(), {
        fontFamily: FONT.display, fontStyle: 'bold', fontSize: `${F.name}px`, color: UI.text,
      });
      this.add.text(cx + 16, gridTop + 52, shop.tagline, {
        fontFamily: FONT.body, fontSize: `${F.small}px`, color: UI.textDim,
        wordWrap: { width: cellW - 32 }, lineSpacing: 3,
      });
      this.add.text(cx + 16, gridTop + cellH - 30, `${shop.shelf.cards} CARDS · ${shop.shelf.gems} GEMS`, {
        fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${F.tiny}px`, color: UI.textAccent,
      });
    });
  }

  // ---------- shelf ----------

  private renderShelf(shopId: string): void {
    const shop = shopCatalog[shopId]!;
    const shelf = ensureShelf(shopId);
    const gx = DESKTOP_LAYOUT.gutter;
    const top = DESKTOP_LAYOUT.contentTop;

    const back = this.add.rectangle(gx, top, 90, 28, UI.panelAlt).setOrigin(0, 0).setStrokeStyle(1, UI.border, 0.7).setInteractive({ useHandCursor: true });
    this.add.text(gx + 45, top + 14, '‹ SHOPS', { fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${F.small}px`, color: UI.text }).setOrigin(0.5);
    back.on('pointerdown', () => { this.selectedShop = null; this.rerender(); });

    this.add.text(gx + 100, top, shop.name.toUpperCase(), { fontFamily: FONT.display, fontStyle: 'bold', fontSize: `${F.name}px`, color: UI.textAccent });
    this.add.text(gx + 100, top + F.name + 2, shop.tagline, { fontFamily: FONT.body, fontSize: `${F.small}px`, color: UI.textDim });

    const rerollW = 120;
    const rerollX = SCREEN.width - gx - rerollW;
    const canReroll = demoState.gold >= 1;
    const reroll = this.add.rectangle(rerollX, top, rerollW, 32, canReroll ? UI.chip : UI.panelMuted, canReroll ? 1 : 0.5)
      .setOrigin(0, 0).setStrokeStyle(1, UI.border, canReroll ? 1 : 0.4);
    this.add.text(rerollX + rerollW / 2, top + 16, 'REROLL · 1 G', {
      fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${F.small}px`, color: canReroll ? UI.textOnChip : UI.textSoft,
    }).setOrigin(0.5);
    if (canReroll) {
      reroll.setInteractive({ useHandCursor: true });
      reroll.on('pointerdown', () => { rerollShelf(shopId); this.rerender(); });
    }

    const rowTop = top + 64;
    this.add.text(gx, rowTop, `CARDS · ${shelf.cards.length}/${shop.shelf.cards}`, { fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${F.tiny}px`, color: UI.textDim });
    const cardTop = rowTop + F.tiny + 8;
    const cardCols = shop.shelf.cards;
    const cardGap = DESKTOP_LAYOUT.gap;
    const cardW = (SCREEN.width - gx * 2 - cardGap * (cardCols - 1)) / cardCols;
    const cardH = 130;
    for (let i = 0; i < cardCols; i++) {
      const cx = gx + i * (cardW + cardGap);
      const offer = shelf.cards[i];
      if (!offer) { this.emptySlot(cx, cardTop, cardW, cardH); continue; }
      const base = skillBook[offer.skillId]!;
      const skill = offer.tier === base.tier ? base : applyTier(base, offer.tier);
      const tok = new CardToken(this, cx + cardW / 2, cardTop + cardH / 2, skill, { width: cardW, height: cardH, side: 'left' });
      const hit = this.add.rectangle(cx + cardW / 2, cardTop + cardH / 2, cardW, cardH, 0xffffff, 0).setInteractive({ useHandCursor: true });
      hit.on('pointerdown', () => { this.detailCardIndex = i; this.detailTier = offer.tier; this.rerender(); });
      const affordable = demoState.gold >= offer.price;
      this.add.rectangle(cx, cardTop + cardH, cardW, 24, UI.panelMuted, 0.95).setOrigin(0, 0).setStrokeStyle(1, UI.border, 0.6);
      this.add.text(cx + cardW / 2, cardTop + cardH + 12, `${offer.price} GOLD`, {
        fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${F.tiny}px`, color: affordable ? UI.textAccent : BAD_HEX,
      }).setOrigin(0.5);
      void tok;
    }

    const gemRowTop = cardTop + cardH + 24 + 20;
    this.add.text(gx, gemRowTop - F.tiny - 8, `GEMS · ${shelf.gems.length}/${shop.shelf.gems}`, { fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${F.tiny}px`, color: UI.textDim });
    const gemCols = shop.shelf.gems;
    const gemGap = DESKTOP_LAYOUT.gap;
    const gemW = (SCREEN.width - gx * 2 - gemGap * (gemCols - 1)) / gemCols;
    const gemH = 96;
    for (let i = 0; i < gemCols; i++) {
      const cx = gx + i * (gemW + gemGap);
      const offer = shelf.gems[i];
      if (!offer) { this.emptySlot(cx, gemRowTop, gemW, gemH); continue; }
      const gem = gemBook[offer.gemId]!;
      const cell = this.add.rectangle(cx, gemRowTop, gemW, gemH, UI.panel, 0.94)
        .setOrigin(0, 0).setStrokeStyle(1, GEM_RARITY_COLOR[gem.rarity], 0.8).setInteractive({ useHandCursor: true });
      cell.on('pointerdown', () => { this.detailGemIndex = i; this.rerender(); });
      this.add.rectangle(cx + 22, gemRowTop + 22, 14, 14, GEM_RARITY_COLOR[gem.rarity]).setOrigin(0.5).setAngle(45);
      this.add.text(cx + 38, gemRowTop + 12, gem.name, { fontFamily: FONT.display, fontStyle: 'bold', fontSize: `${F.small}px`, color: UI.text });
      const body = this.add.text(cx + 16, gemRowTop + 40, stripCardTextMarkup(gem.text), {
        fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${F.tiny}px`, color: UI.textAccent,
        wordWrap: { width: gemW - 32 }, lineSpacing: 2,
      });
      if (body.height > 30) { body.setText(`${body.text.slice(0, 60)}…`); }
      const affordable = demoState.gold >= offer.price;
      this.add.text(cx + gemW - 16, gemRowTop + gemH - 18, `${offer.price} GOLD`, {
        fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${F.tiny}px`, color: affordable ? UI.textAccent : BAD_HEX,
      }).setOrigin(1, 0);
    }
  }

  private emptySlot(x: number, y: number, w: number, h: number): void {
    this.add.rectangle(x, y, w, h, UI.panelMuted, 0.4).setOrigin(0, 0).setStrokeStyle(1, UI.border, 0.3);
    this.add.text(x + w / 2, y + h / 2, 'SOLD OUT', { fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${F.tiny}px`, color: UI.textSoft }).setOrigin(0.5);
  }

  // ---------- card detail overlay ----------

  private renderCardDetail(): void {
    const shopId = this.selectedShop!;
    const shelf = ensureShelf(shopId);
    const offer = shelf.cards[this.detailCardIndex!];
    if (!offer) { this.detailCardIndex = null; return; }
    const base = skillBook[offer.skillId]!;
    const shown = this.detailTier === base.tier ? base : applyTier(base, this.detailTier);

    this.add.rectangle(0, 0, SCREEN.width, SCREEN.height, UI.shadow, 0.78).setOrigin(0, 0).setInteractive()
      .on('pointerdown', () => { this.detailCardIndex = null; this.rerender(); });

    const pw = 420;
    const cardW = 220;
    const cardH = Math.round(cardW * (690 / 420));
    const ph = 60 + cardH + 200;
    const px = (SCREEN.width - pw) / 2;
    const py = Math.max(30, (SCREEN.height - ph) / 2);
    this.add.rectangle(px, py, pw, ph, UI.panelAlt, 0.98).setOrigin(0, 0).setStrokeStyle(2, UI.border, 1).setInteractive();

    const centerX = px + pw / 2;
    const cardY = py + 20 + cardH / 2;
    new FantasyCardTemplateV2(this, centerX, cardY, shown, { width: cardW, height: cardH, tier: this.detailTier, glossary: false });

    let y = cardY + cardH / 2 + 10;
    this.add.text(centerX, y, base.name, { fontFamily: FONT.display, fontStyle: 'bold', fontSize: `${F.name}px`, color: UI.text, align: 'center' }).setOrigin(0.5, 0);
    y += F.name + 6;
    this.add.text(centerX, y, stripCardTextMarkup(shown.text), {
      fontFamily: FONT.body, fontSize: `${F.small}px`, color: UI.textSoft, align: 'center', wordWrap: { width: pw - 40 }, lineSpacing: 3,
    }).setOrigin(0.5, 0);
    y = py + ph - 56;

    const affordable = demoState.gold >= offer.price;
    const hasRoom = bagHasRoomFor(offer.skillId);
    const canBuy = affordable && hasRoom;
    const btn = this.add.rectangle(centerX, y, pw - 40, 40, canBuy ? UI.chip : UI.panelMuted, canBuy ? 1 : 0.5)
      .setOrigin(0.5, 0).setStrokeStyle(1, UI.border, canBuy ? 1 : 0.4);
    const label = !affordable ? `NEED ${offer.price} GOLD` : !hasRoom ? 'BAG FULL' : `BUY · ${offer.price} GOLD`;
    this.add.text(centerX, y + 20, label, { fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${F.label}px`, color: canBuy ? UI.textOnChip : UI.textSoft }).setOrigin(0.5);
    if (canBuy) {
      btn.setInteractive({ useHandCursor: true });
      btn.on('pointerdown', () => { this.pendingBuy = { kind: 'card', index: this.detailCardIndex! }; this.rerender(); });
    }
    this.add.text(px + pw - 16, py + 14, 'click outside to close', { fontFamily: FONT.body, fontSize: `${F.tiny}px`, color: UI.textSoft }).setOrigin(1, 0);
  }

  // ---------- gem detail overlay ----------

  private renderGemDetail(): void {
    const shopId = this.selectedShop!;
    const shelf = ensureShelf(shopId);
    const offer = shelf.gems[this.detailGemIndex!];
    if (!offer) { this.detailGemIndex = null; return; }
    const gem: GemDef = gemBook[offer.gemId]!;

    this.add.rectangle(0, 0, SCREEN.width, SCREEN.height, UI.shadow, 0.78).setOrigin(0, 0).setInteractive()
      .on('pointerdown', () => { this.detailGemIndex = null; this.rerender(); });

    const pw = 420; const ph = 320;
    const px = (SCREEN.width - pw) / 2;
    const py = (SCREEN.height - ph) / 2;
    this.add.rectangle(px, py, pw, ph, UI.panelAlt, 0.98).setOrigin(0, 0).setStrokeStyle(2, UI.border, 1).setInteractive();
    const centerX = px + pw / 2;
    let y = py + 30;
    this.add.rectangle(centerX, y + 10, 26, 26, GEM_RARITY_COLOR[gem.rarity]).setOrigin(0.5).setAngle(45).setStrokeStyle(2, UI.border, 0.8);
    y += 40;
    this.add.text(centerX, y, gem.name, { fontFamily: FONT.display, fontStyle: 'bold', fontSize: `${F.title}px`, color: UI.text, align: 'center' }).setOrigin(0.5, 0);
    y += F.title + 6;
    this.add.text(centerX, y, `${gem.rarity.toUpperCase()} · ${gem.kind === 'stat' ? 'STAT MOD' : 'EFFECT RIDER'}`, {
      fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${F.small}px`, color: UI.textDim,
    }).setOrigin(0.5, 0);
    y += F.small + 14;
    this.add.text(centerX, y, stripCardTextMarkup(gem.text), {
      fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${F.body}px`, color: UI.text, align: 'center', wordWrap: { width: pw - 40 }, lineSpacing: 4,
    }).setOrigin(0.5, 0);

    const affordable = demoState.gold >= offer.price;
    const btnY = py + ph - 56;
    const btn = this.add.rectangle(centerX, btnY, pw - 40, 40, affordable ? UI.chip : UI.panelMuted, affordable ? 1 : 0.5)
      .setOrigin(0.5, 0).setStrokeStyle(1, UI.border, affordable ? 1 : 0.4);
    this.add.text(centerX, btnY + 20, affordable ? `BUY · ${offer.price} GOLD` : `NEED ${offer.price} GOLD`, {
      fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${F.label}px`, color: affordable ? UI.textOnChip : UI.textSoft,
    }).setOrigin(0.5);
    if (affordable) {
      btn.setInteractive({ useHandCursor: true });
      btn.on('pointerdown', () => { this.pendingBuy = { kind: 'gem', index: this.detailGemIndex! }; this.rerender(); });
    }
    this.add.text(px + pw - 16, py + 14, 'click outside to close', { fontFamily: FONT.body, fontSize: `${F.tiny}px`, color: UI.textSoft }).setOrigin(1, 0);
  }

  // ---------- confirm ----------

  private renderConfirm(): void {
    const shopId = this.selectedShop!;
    const shelf = ensureShelf(shopId);
    const buy = this.pendingBuy!;
    const name = buy.kind === 'card'
      ? (skillBook[shelf.cards[buy.index]?.skillId ?? '']?.name ?? 'card')
      : (gemBook[shelf.gems[buy.index]?.gemId ?? '']?.name ?? 'gem');
    const price = buy.kind === 'card' ? shelf.cards[buy.index]?.price ?? 0 : shelf.gems[buy.index]?.price ?? 0;

    this.add.rectangle(0, 0, SCREEN.width, SCREEN.height, UI.shadow, 0.72).setOrigin(0, 0).setInteractive();
    const bw = 460; const bx = SCREEN.width / 2 - bw / 2; const by = SCREEN.height / 2 - 90;
    this.add.rectangle(bx, by, bw, 180, UI.panelAlt).setOrigin(0, 0).setStrokeStyle(2, UI.chip);
    this.add.text(SCREEN.width / 2, by + 34, `Buy ${name} for ${price} gold?`, { fontSize: `${F.name}px`, color: UI.text, fontFamily: FONT.display, fontStyle: 'bold' }).setOrigin(0.5);
    this.add.text(SCREEN.width / 2, by + 66, 'This offer leaves the shelf once bought.', { fontSize: `${F.small}px`, color: UI.textDim, fontFamily: FONT.body }).setOrigin(0.5);
    const mk = (dx: number, w: number, label: string, fill: number, color: string, fn: () => void): void => {
      const r = this.add.rectangle(dx, by + 116, w, 44, fill).setOrigin(0, 0).setStrokeStyle(1, UI.border, 0.7).setInteractive({ useHandCursor: true });
      r.on('pointerdown', fn);
      this.add.text(dx + w / 2, by + 138, label, { fontSize: `${F.body}px`, color, fontFamily: FONT.body, fontStyle: 'bold' }).setOrigin(0.5);
    };
    mk(bx + 20, (bw - 60) / 2, 'CANCEL', UI.panelMuted, UI.text, () => { this.pendingBuy = null; this.rerender(); });
    mk(bx + 40 + (bw - 60) / 2, (bw - 60) / 2, 'BUY', UI.chip, UI.textOnChip, () => {
      const result = buy.kind === 'card' ? buyCard(shopId, buy.index) : buyGem(shopId, buy.index);
      this.pendingBuy = null;
      this.detailCardIndex = null;
      this.detailGemIndex = null;
      this.rerender();
      if (!result.ok) this.showToast(result.reason === 'bag' ? 'Bag full — purchase cancelled' : 'Could not complete purchase', UI.bad);
      else this.showToast(`Bought ${name}`, UI.good);
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
