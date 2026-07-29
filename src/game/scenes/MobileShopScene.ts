import Phaser from 'phaser';
import { applyTier } from '../../engine/cards';
import { skillBook } from '../../data/skills';
import { gemBook, type GemDef } from '../../data/gems';
import { shopCatalog, shopTypeIds } from '../../data/shopTypes';
import type { SkillTier } from '../../engine/types';
import { bagHasRoomFor, buyCard, buyGem, ensureShelf, rerollShelf } from '../shopActions';
import { demoState } from '../demoState';
import { stripCardTextMarkup } from '../ui/cardTextMarkup';
import { FONT, GEM_RARITY_COLOR, SCREEN, UI } from '../theme';
import { CardToken } from '../ui/CardToken';
import { FantasyCardTemplateV2 } from '../ui/FantasyCardTemplateV2';
import { rebuildScene } from '../sceneRebuild';

type PendingBuy = { kind: 'card'; index: number } | { kind: 'gem'; index: number };

/**
 * Mobile Shop — storefront picker (5 shops, tap to browse) → shelf view
 * (stacked card offers + gem offers, gold prices, REROLL). Tap a tile to
 * open an inspect overlay (mirrors the mobile Wiki detail) with a BUY
 * button; BUY opens a confirm dialog (mirrors the deck-build trash-confirm).
 * Reachable at ?scene=mobile-shop.
 */
export class MobileShopScene extends Phaser.Scene {
  private W = SCREEN.width;
  private H = SCREEN.height;
  private selectedShop: string | null = null;
  private detailCardIndex: number | null = null;
  private detailGemIndex: number | null = null;
  private detailTier: SkillTier = 'bronze';
  private pendingBuy: PendingBuy | null = null;
  private toastObjects: Phaser.GameObjects.GameObject[] = [];

  constructor() { super('MobileShop'); }

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
    this.W = SCREEN.width; this.H = SCREEN.height;
    this.cameras.main.setBackgroundColor(0x0b1420);
    this.renderTabs();
    this.renderGoldBalance();
    if (this.selectedShop === null) this.renderStorefront();
    else this.renderShelf(this.selectedShop);
    if (this.pendingBuy) this.renderConfirm();
    else if (this.detailCardIndex !== null) this.renderCardDetail();
    else if (this.detailGemIndex !== null) this.renderGemDetail();
  }

  private renderTabs(): void {
    const tabs: Array<[string, boolean, () => void]> = [
      ['PREP', false, () => this.scene.start('MobilePrep')],
      ['DECK', false, () => this.scene.start('MobileDeckBuild')],
      ['WIKI', false, () => this.scene.start('MobileWiki')],
      ['SHOP', true, () => {}],
      ['DRAFT', false, () => this.scene.start('MobileDraft')],
    ];
    const gap = 5;
    const w = (this.W - 20 - gap * (tabs.length - 1)) / tabs.length;
    tabs.forEach(([label, active, fn], i) => {
      const x = 10 + i * (w + gap);
      const r = this.add.rectangle(x, 8, w, 34, active ? 0xb78a46 : 0x131f32).setOrigin(0, 0).setStrokeStyle(1, UI.border, 0.7).setInteractive({ useHandCursor: true });
      r.on('pointerdown', fn);
      this.add.text(x + w / 2, 25, label, { fontSize: '9px', color: active ? '#1a1208' : UI.textDim, fontFamily: FONT.body, fontStyle: 'bold' }).setOrigin(0.5);
    });
  }

  private renderGoldBalance(): void {
    this.add.text(this.W - 12, 50, `GOLD ${demoState.gold}`, { fontSize: '12px', color: '#c69948', fontFamily: FONT.body, fontStyle: 'bold' }).setOrigin(1, 0);
  }

  // ---------- storefront ----------

  private renderStorefront(): void {
    this.add.text(12, 50, 'CHOOSE A SHOP', { fontSize: '11px', color: '#8a94a6', fontFamily: FONT.body, fontStyle: 'bold' });
    let y = 70;
    const h = 76;
    for (const id of shopTypeIds) {
      const shop = shopCatalog[id]!;
      const cell = this.add.rectangle(10, y, this.W - 20, h, 0x101a2a, 0.94).setOrigin(0, 0).setStrokeStyle(1, UI.border, 0.7).setInteractive({ useHandCursor: true });
      cell.on('pointerdown', () => { ensureShelf(id); this.selectedShop = id; this.rerender(); });
      this.add.text(22, y + 10, shop.name.toUpperCase(), { fontSize: '13px', color: '#e8e0c8', fontFamily: FONT.display, fontStyle: 'bold' });
      const tag = this.add.text(22, y + 30, shop.tagline, { fontSize: '9px', color: '#8a94a6', fontFamily: FONT.body, wordWrap: { width: this.W - 44 }, lineSpacing: 2 });
      void tag;
      this.add.text(this.W - 22, y + h - 16, `${shop.shelf.cards} CARDS · ${shop.shelf.gems} GEMS`, { fontSize: '9px', color: '#c69948', fontFamily: FONT.body, fontStyle: 'bold' }).setOrigin(1, 0);
      y += h + 8;
    }
  }

  // ---------- shelf ----------

  private renderShelf(shopId: string): void {
    const shop = shopCatalog[shopId]!;
    const shelf = ensureShelf(shopId);

    const back = this.add.rectangle(10, 50, 70, 24, 0x131f32).setOrigin(0, 0).setStrokeStyle(1, UI.border, 0.7).setInteractive({ useHandCursor: true });
    this.add.text(45, 62, '‹ SHOPS', { fontSize: '9px', color: '#e8e0c8', fontFamily: FONT.body, fontStyle: 'bold' }).setOrigin(0.5);
    back.on('pointerdown', () => { this.selectedShop = null; this.rerender(); });

    this.add.text(88, 50, shop.name.toUpperCase(), { fontSize: '14px', color: '#c69948', fontFamily: FONT.display, fontStyle: 'bold' });

    const canReroll = demoState.gold >= 1;
    const rerollW = 92;
    const rr = this.add.rectangle(this.W - 10 - rerollW, 76, rerollW, 24, canReroll ? 0xb78a46 : 0x16233a, canReroll ? 1 : 0.5)
      .setOrigin(0, 0).setStrokeStyle(1, UI.border, canReroll ? 1 : 0.4);
    this.add.text(this.W - 10 - rerollW / 2, 88, 'REROLL · 1G', { fontSize: '9px', color: canReroll ? '#1a1208' : '#5a6880', fontFamily: FONT.body, fontStyle: 'bold' }).setOrigin(0.5);
    if (canReroll) {
      rr.setInteractive({ useHandCursor: true });
      rr.on('pointerdown', () => { rerollShelf(shopId); this.rerender(); });
    }

    let y = 108;
    this.add.text(12, y, `CARDS · ${shelf.cards.length}/${shop.shelf.cards}`, { fontSize: '10px', color: '#8a94a6', fontFamily: FONT.body, fontStyle: 'bold' });
    y += 16;
    const cardH = 66;
    for (let i = 0; i < shop.shelf.cards; i++) {
      const offer = shelf.cards[i];
      if (!offer) { this.emptySlot(y, cardH); y += cardH + 6; continue; }
      const base = skillBook[offer.skillId]!;
      const skill = offer.tier === base.tier ? base : applyTier(base, offer.tier);
      new CardToken(this, 10 + (this.W - 20) / 2, y + cardH / 2, skill, { width: this.W - 20, height: cardH, side: 'left' });
      const hit = this.add.rectangle(10 + (this.W - 20) / 2, y + cardH / 2, this.W - 20, cardH, 0xffffff, 0).setInteractive({ useHandCursor: true });
      hit.on('pointerdown', () => { this.detailCardIndex = i; this.detailTier = offer.tier; this.rerender(); });
      const affordable = demoState.gold >= offer.price;
      this.add.text(this.W - 16, y + 6, `${offer.price} G`, { fontSize: '10px', color: affordable ? '#e8b446' : '#e08a7a', fontFamily: FONT.body, fontStyle: 'bold' }).setOrigin(1, 0).setBackgroundColor('#0b1420').setPadding(4, 2, 4, 2);
      y += cardH + 6;
    }

    y += 6;
    this.add.text(12, y, `GEMS · ${shelf.gems.length}/${shop.shelf.gems}`, { fontSize: '10px', color: '#8a94a6', fontFamily: FONT.body, fontStyle: 'bold' });
    y += 16;
    const gemH = 58;
    for (let i = 0; i < shop.shelf.gems; i++) {
      const offer = shelf.gems[i];
      if (!offer) { this.emptySlot(y, gemH); y += gemH + 6; continue; }
      const gem = gemBook[offer.gemId]!;
      const cell = this.add.rectangle(10, y, this.W - 20, gemH, 0x101a2a, 0.94).setOrigin(0, 0).setStrokeStyle(1, GEM_RARITY_COLOR[gem.rarity], 0.8).setInteractive({ useHandCursor: true });
      cell.on('pointerdown', () => { this.detailGemIndex = i; this.rerender(); });
      this.add.rectangle(28, y + gemH / 2, 11, 11, GEM_RARITY_COLOR[gem.rarity]).setOrigin(0.5).setAngle(45);
      this.add.text(42, y + 8, gem.name, { fontSize: '11px', color: '#e8e0c8', fontFamily: FONT.display, fontStyle: 'bold' });
      const body = this.add.text(42, y + 24, stripCardTextMarkup(gem.text), { fontSize: '9px', color: '#e8b446', fontFamily: FONT.body, fontStyle: 'bold', wordWrap: { width: this.W - 100 } });
      let s = stripCardTextMarkup(gem.text);
      while (s.length > 1 && body.height > 24) { s = s.slice(0, -1); body.setText(`${s}…`); }
      const affordable = demoState.gold >= offer.price;
      this.add.text(this.W - 20, y + gemH - 18, `${offer.price} G`, { fontSize: '10px', color: affordable ? '#e8b446' : '#e08a7a', fontFamily: FONT.body, fontStyle: 'bold' }).setOrigin(1, 0);
      y += gemH + 6;
    }
  }

  private emptySlot(y: number, h: number): void {
    this.add.rectangle(10, y, this.W - 20, h, 0x0d1b28, 0.4).setOrigin(0, 0).setStrokeStyle(1, UI.border, 0.3);
    this.add.text(this.W / 2, y + h / 2, 'SOLD OUT', { fontSize: '10px', color: '#5a6880', fontFamily: FONT.body, fontStyle: 'bold' }).setOrigin(0.5);
  }

  // ---------- card detail overlay ----------

  private renderCardDetail(): void {
    const shopId = this.selectedShop!;
    const shelf = ensureShelf(shopId);
    const offer = shelf.cards[this.detailCardIndex!];
    if (!offer) { this.detailCardIndex = null; return; }
    const base = skillBook[offer.skillId]!;
    const shown = this.detailTier === base.tier ? base : applyTier(base, this.detailTier);

    const veil = this.add.rectangle(0, 0, this.W, this.H, 0x05070c, 0.86).setOrigin(0, 0).setInteractive();
    veil.on('pointerdown', () => { this.detailCardIndex = null; this.rerender(); });

    const centerX = this.W / 2;
    const cardW = 150;
    const cardH = cardW * (690 / 420);
    let y = 70;
    const cardY = y + cardH / 2;
    new FantasyCardTemplateV2(this, centerX, cardY, shown, { width: cardW, height: cardH, tier: this.detailTier, glossary: false });
    y = cardY + cardH / 2 + 10;

    this.add.text(centerX, y, base.name, { fontFamily: FONT.display, fontStyle: 'bold', fontSize: '15px', color: '#e8e0c8', align: 'center', wordWrap: { width: this.W - 40 } }).setOrigin(0.5, 0);
    y += 24;
    const text = this.add.text(centerX, y, stripCardTextMarkup(shown.text), {
      fontFamily: FONT.body, fontSize: '11px', color: '#c9b896', align: 'center', wordWrap: { width: this.W - 40 }, lineSpacing: 3,
    }).setOrigin(0.5, 0);
    y += text.height + 16;

    const affordable = demoState.gold >= offer.price;
    const hasRoom = bagHasRoomFor(offer.skillId);
    const canBuy = affordable && hasRoom;
    const btn = this.add.rectangle(centerX, y, this.W - 40, 40, canBuy ? 0xe8b446 : 0x16233a, canBuy ? 1 : 0.5).setOrigin(0.5, 0).setStrokeStyle(1, UI.border, canBuy ? 0.8 : 0.4);
    const label = !affordable ? `NEED ${offer.price} GOLD` : !hasRoom ? 'BAG FULL' : `BUY · ${offer.price} GOLD`;
    this.add.text(centerX, y + 20, label, { fontSize: '12px', color: canBuy ? '#1a1208' : '#5a6880', fontFamily: FONT.body, fontStyle: 'bold' }).setOrigin(0.5);
    if (canBuy) {
      btn.setInteractive({ useHandCursor: true });
      btn.on('pointerdown', (_p: Phaser.Input.Pointer, _lx: number, _ly: number, event: Phaser.Types.Input.EventData) => {
        event.stopPropagation();
        this.pendingBuy = { kind: 'card', index: this.detailCardIndex! };
        this.rerender();
      });
    }
  }

  // ---------- gem detail overlay ----------

  private renderGemDetail(): void {
    const shopId = this.selectedShop!;
    const shelf = ensureShelf(shopId);
    const offer = shelf.gems[this.detailGemIndex!];
    if (!offer) { this.detailGemIndex = null; return; }
    const gem: GemDef = gemBook[offer.gemId]!;

    const veil = this.add.rectangle(0, 0, this.W, this.H, 0x05070c, 0.86).setOrigin(0, 0).setInteractive();
    veil.on('pointerdown', () => { this.detailGemIndex = null; this.rerender(); });

    const centerX = this.W / 2;
    let y = 110;
    this.add.rectangle(centerX, y + 12, 30, 30, GEM_RARITY_COLOR[gem.rarity]).setOrigin(0.5).setAngle(45).setStrokeStyle(2, 0x8a94a6, 0.8);
    y += 46;
    this.add.text(centerX, y, gem.name, { fontFamily: FONT.display, fontStyle: 'bold', fontSize: '16px', color: '#e8e0c8', align: 'center', wordWrap: { width: this.W - 40 } }).setOrigin(0.5, 0);
    y += 26;
    this.add.text(centerX, y, `${gem.rarity.toUpperCase()} · ${gem.kind === 'stat' ? 'STAT MOD' : 'EFFECT RIDER'}`, { fontFamily: FONT.body, fontStyle: 'bold', fontSize: '10px', color: '#8a94a6' }).setOrigin(0.5, 0);
    y += 24;
    const body = this.add.text(centerX, y, stripCardTextMarkup(gem.text), {
      fontFamily: FONT.body, fontStyle: 'bold', fontSize: '13px', color: '#e8e0c8', align: 'center', wordWrap: { width: this.W - 40 }, lineSpacing: 3,
    }).setOrigin(0.5, 0);
    y += body.height + 20;

    const affordable = demoState.gold >= offer.price;
    const btn = this.add.rectangle(centerX, y, this.W - 40, 40, affordable ? 0xe8b446 : 0x16233a, affordable ? 1 : 0.5).setOrigin(0.5, 0).setStrokeStyle(1, UI.border, affordable ? 0.8 : 0.4);
    this.add.text(centerX, y + 20, affordable ? `BUY · ${offer.price} GOLD` : `NEED ${offer.price} GOLD`, { fontSize: '12px', color: affordable ? '#1a1208' : '#5a6880', fontFamily: FONT.body, fontStyle: 'bold' }).setOrigin(0.5);
    if (affordable) {
      btn.setInteractive({ useHandCursor: true });
      btn.on('pointerdown', (_p: Phaser.Input.Pointer, _lx: number, _ly: number, event: Phaser.Types.Input.EventData) => {
        event.stopPropagation();
        this.pendingBuy = { kind: 'gem', index: this.detailGemIndex! };
        this.rerender();
      });
    }
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

    this.add.rectangle(0, 0, this.W, this.H, 0x05070c, 0.72).setOrigin(0, 0).setInteractive();
    const bw = this.W - 60; const bx = 30; const by = this.H / 2 - 70;
    this.add.rectangle(bx, by, bw, 140, 0x141d2c).setOrigin(0, 0).setStrokeStyle(2, 0xe8b446);
    this.add.text(this.W / 2, by + 24, `Buy ${name}?`, { fontSize: '15px', color: '#e8e0c8', fontFamily: FONT.display, fontStyle: 'bold' }).setOrigin(0.5);
    this.add.text(this.W / 2, by + 50, `${price} gold — leaves the shelf once bought.`, { fontSize: '10px', color: '#9aa4b6', fontFamily: FONT.body }).setOrigin(0.5);
    const mk = (dx: number, w: number, label: string, fill: number, color: string, fn: () => void): void => {
      const r = this.add.rectangle(dx, by + 88, w, 36, fill).setOrigin(0, 0).setStrokeStyle(1, UI.border, 0.7).setInteractive({ useHandCursor: true });
      r.on('pointerdown', fn);
      this.add.text(dx + w / 2, by + 106, label, { fontSize: '13px', color, fontFamily: FONT.body, fontStyle: 'bold' }).setOrigin(0.5);
    };
    mk(bx + 16, (bw - 40) / 2, 'CANCEL', 0x1b2940, '#e8e0c8', () => { this.pendingBuy = null; this.rerender(); });
    mk(bx + 24 + (bw - 40) / 2, (bw - 40) / 2, 'BUY', 0xe8b446, '#1a1208', () => {
      const result = buy.kind === 'card' ? buyCard(shopId, buy.index) : buyGem(shopId, buy.index);
      this.pendingBuy = null;
      this.detailCardIndex = null;
      this.detailGemIndex = null;
      this.rerender();
      if (!result.ok) this.showToast(result.reason === 'bag' ? 'Bag full — purchase cancelled' : 'Could not complete purchase', '#e8907a');
      else this.showToast(`Bought ${name}`, '#9ad17a');
    });
  }

  private showToast(text: string, color: string): void {
    for (const o of this.toastObjects) o.destroy();
    this.toastObjects = [];
    const t = this.add.text(this.W / 2, this.H - 60, text, { fontSize: '12px', color, fontFamily: FONT.body, fontStyle: 'bold' }).setOrigin(0.5).setDepth(4001);
    const bg = this.add.rectangle(this.W / 2, this.H - 60, t.width + 24, t.height + 14, 0x0b1420, 0.92).setOrigin(0.5).setDepth(4000).setStrokeStyle(1, 0x3a4a62, 0.9);
    this.toastObjects = [bg, t];
    this.tweens.add({ targets: [t, bg], alpha: 0, delay: 1200, duration: 500, onComplete: () => { for (const o of this.toastObjects) o.destroy(); this.toastObjects = []; } });
  }
}
