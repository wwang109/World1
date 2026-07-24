import Phaser from 'phaser';
import { instancePowerLevelDeci } from '../../engine/balance';
import type { SkillDef } from '../../engine/types';
import { skillBook } from '../../data/skills';
import { createOwnedCard, demoState } from '../demoState';
import { FONT, SCREEN, UI } from '../theme';
import { CardToken } from '../ui/CardToken';
import { FantasyCardTemplateV2 } from '../ui/FantasyCardTemplateV2';

const SLOTS = 10;
const ROW_H = 84;
const ROW_GAP = 8;
const FILTER_BAND_H = 82;
type WikiCardFilter = 'all' | 'weapon' | 'magic';

interface CatalogRow {
  skill: SkillDef;
  token: CardToken;
  plText: Phaser.GameObjects.Text;
  baseX: number;
  baseY: number;
  h: number;
}

/**
 * Mobile Wiki — a scrollable read-only catalog of every card in skillBook,
 * built for playtesting: tap a card to inspect it and ADD TO BAG on demand.
 * Reachable at ?scene=mwiki.
 *
 * Cards use the same spec-driven fantasy template as the main Wiki. The
 * gallery is repositioned directly in world space on scroll so its geometry
 * mask stays aligned to the mobile viewport.
 */
export class MobileWikiScene extends Phaser.Scene {
  private W = SCREEN.width;
  private H = SCREEN.height;
  private viewport = { top: 0, height: 0 };
  private scrollY = 0;
  private maxScroll = 0;
  private rows: CatalogRow[] = [];
  private indicator?: Phaser.GameObjects.Rectangle;
  private detailOpen = false;
  private detailObjects: Phaser.GameObjects.GameObject[] = [];
  private toastObjects: Phaser.GameObjects.GameObject[] = [];
  private cardFilter: WikiCardFilter = 'all';

  constructor() { super('MobileWiki'); }

  create(): void {
    this.W = SCREEN.width;
    this.H = SCREEN.height;
    this.scrollY = 0;
    this.detailOpen = false;
    this.rows = [];
    this.detailObjects = [];
    this.toastObjects = [];
    this.cameras.main.setBackgroundColor(0x0b1420);
    this.renderTabs();
    this.renderFilterBand();
    this.renderCatalog();
    this.wireScroll();
  }

  private boundedText(
    x: number, y: number, str: string,
    style: Phaser.Types.GameObjects.Text.TextStyle, maxW: number,
    originX = 0, originY = 0,
  ): Phaser.GameObjects.Text {
    const t = this.add.text(x, y, str, style).setOrigin(originX, originY);
    if (t.width > maxW && str.length > 1) {
      let s = str;
      while (s.length > 1 && t.width > maxW) { s = s.slice(0, -1); t.setText(`${s}…`); }
    }
    return t;
  }

  private renderTabs(): void {
    const tabs: Array<[string, boolean, () => void]> = [
      ['PREP', false, () => this.scene.start('MobilePrep')],
      ['DECK BUILD', false, () => this.scene.start('MobileDeckBuild')],
      ['WIKI', true, () => {}],
    ];
    const w = (this.W - 20 - 12) / 3;
    tabs.forEach(([label, active, fn], i) => {
      const r = this.add.rectangle(10 + i * (w + 6), 8, w, 34, active ? 0xb78a46 : 0x131f32).setOrigin(0, 0).setStrokeStyle(1, UI.border, 0.7).setInteractive({ useHandCursor: true });
      r.on('pointerdown', fn);
      this.add.text(10 + i * (w + 6) + w / 2, 25, label, { fontSize: '12px', color: active ? '#1a1208' : UI.textDim, fontFamily: FONT.body, fontStyle: 'bold' }).setOrigin(0.5);
    });
  }

  // ---------- catalog + scroll ----------

  private filteredSkills(): SkillDef[] {
    return Object.values(skillBook)
      .filter((skill) => this.cardFilter === 'all'
        || (this.cardFilter === 'weapon' ? skill.weapon !== undefined : skill.element !== undefined))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  private renderFilterBand(): void {
    const y = 50;
    this.add.rectangle(10, y, this.W - 20, FILTER_BAND_H, 0x101a2a, 0.96)
      .setOrigin(0, 0).setStrokeStyle(1, 0x3a4a62, 0.9);
    this.add.text(22, y + 12, 'CARD LIBRARY', { fontSize: '11px', color: '#e8b446', fontFamily: FONT.body, fontStyle: 'bold' });
    this.add.text(this.W - 22, y + 12, `${this.filteredSkills().length}/${Object.keys(skillBook).length} CARDS`, { fontSize: '9px', color: '#8a94a6', fontFamily: FONT.body, fontStyle: 'bold' }).setOrigin(1, 0);
    this.add.rectangle(22, y + 31, this.W - 44, 1, 0x2a3a52).setOrigin(0, 0);
    this.add.text(22, y + 43, 'FILTERS', { fontSize: '9px', color: '#8a94a6', fontFamily: FONT.body, fontStyle: 'bold' });
    const chips: Array<[string, WikiCardFilter]> = [['ALL', 'all'], ['WEAPON', 'weapon'], ['MAGIC', 'magic']];
    let x = 78;
    for (const [index, [label, value]] of chips.entries()) {
      const active = this.cardFilter === value;
      const w = index === 0 ? 58 : 72;
      const chip = this.add.rectangle(x, y + 54, w, 22, active ? 0xb78a46 : 0x18263a, 1)
        .setOrigin(0, 0).setStrokeStyle(1, index === 0 ? 0xe8b446 : 0x3a4a62, 0.9);
      this.add.text(x + w / 2, y + 65, label, { fontSize: '8px', color: active ? '#1a1208' : '#8a94a6', fontFamily: FONT.body, fontStyle: 'bold' }).setOrigin(0.5);
      chip.setInteractive({ useHandCursor: true });
      chip.on('pointerdown', () => {
        if (this.cardFilter === value) return;
        this.cardFilter = value;
        this.scene.restart();
      });
      x += w + 6;
    }
  }

  private renderCatalog(): void {
    const top = 142;
    const bottom = this.H - 10;
    const height = bottom - top;
    this.viewport = { top, height };

    const maskShape = this.make.graphics({}, false);
    maskShape.fillStyle(0xffffff);
    maskShape.fillRect(0, top, this.W, height);
    const mask = maskShape.createGeometryMask();

    const contentW = this.W - 20;
    const cardW = (contentW - ROW_GAP) / 2;
    const colX = [10 + cardW / 2, 10 + cardW + ROW_GAP + cardW / 2];

    const skills = this.filteredSkills();
    const rowStride = ROW_H + ROW_GAP;
    for (const [index, skill] of skills.entries()) {
      const col = index % 2;
      const rowIndex = Math.floor(index / 2);
      const baseX = colX[col]!;
      const baseY = rowIndex * rowStride;
      const token = new CardToken(this, baseX, top + baseY + ROW_H / 2, skill, { width: cardW, height: ROW_H, side: col === 0 ? 'left' : 'right' });
      token.setMask(mask);
      const plDeci = instancePowerLevelDeci(skill, { gem: null });
      const plText = this.add.text(baseX + (col === 0 ? cardW / 2 - 8 : -cardW / 2 + 8), top + baseY + 8, `PL ${(plDeci / 10).toFixed(0)}`, {
        fontSize: '10px', color: '#e8b446', fontFamily: FONT.body, fontStyle: 'bold',
      }).setOrigin(col === 0 ? 1 : 0, 0).setBackgroundColor('#0b1420').setPadding(4, 2, 4, 2);
      plText.setMask(mask);
      this.rows.push({ skill, token, plText, baseX, baseY, h: ROW_H });
    }
    const contentHeight = Math.max(0, Math.ceil(skills.length / 2) * rowStride - ROW_GAP);
    this.maxScroll = Math.max(0, contentHeight - height);

    this.indicator = this.add.rectangle(this.W - 4, top, 3, height, 0x3a4a62, 0.8).setOrigin(0.5, 0);
    this.updateIndicator();
    if (skills.length === 0) {
      this.add.text(this.W / 2, top + 40, 'No cards in the catalog.', { fontSize: '12px', color: UI.textDim, fontFamily: FONT.body }).setOrigin(0.5, 0);
    }
  }

  /** Repositions every row's token/label to reflect the current scroll offset. */
  private applyScroll(): void {
    const { top } = this.viewport;
    for (const row of this.rows) {
      const worldTop = top + this.scrollY + row.baseY;
      row.token.setPosition(row.baseX, worldTop + row.h / 2);
      row.plText.setPosition(row.baseX + (row.baseX < this.W / 2 ? row.token.width / 2 - 8 : -row.token.width / 2 + 8), worldTop + 8);
    }
    this.updateIndicator();
  }

  private updateIndicator(): void {
    if (!this.indicator) return;
    const { top, height } = this.viewport;
    const contentHeight = height + this.maxScroll;
    const thumbH = this.maxScroll > 0 ? Math.max(24, (height / contentHeight) * height) : height;
    const progress = this.maxScroll > 0 ? (-this.scrollY) / this.maxScroll : 0;
    const thumbY = top + progress * (height - thumbH);
    this.indicator.setSize(3, thumbH);
    this.indicator.setPosition(this.W - 4, thumbY + thumbH / 2);
  }

  private wireScroll(): void {
    let dragging = false;
    let startY = 0;
    let startX = 0;
    let startScroll = 0;
    let totalMove = 0;
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (this.detailOpen) return;
      const { top, height } = this.viewport;
      if (p.y < top || p.y > top + height) return;
      dragging = true;
      startY = p.y; startX = p.x; startScroll = this.scrollY; totalMove = 0;
    });
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (!dragging) return;
      const dy = p.y - startY;
      totalMove = Math.max(totalMove, Math.hypot(p.x - startX, p.y - startY));
      this.scrollY = Phaser.Math.Clamp(startScroll + dy, -this.maxScroll, 0);
      this.applyScroll();
    });
    this.input.on('pointerup', (p: Phaser.Input.Pointer) => {
      if (!dragging) return;
      dragging = false;
      if (totalMove < 8) {
        const localY = p.y - this.viewport.top - this.scrollY;
        const row = this.rows.find((r) => p.x >= r.baseX - r.token.width / 2 && p.x <= r.baseX + r.token.width / 2 && localY >= r.baseY && localY < r.baseY + r.h);
        if (row) this.openDetail(row.skill);
      }
    });
  }

  // ---------- bag insertion ----------

  private bagOccupied(): boolean[] {
    const occ = Array<boolean>(SLOTS).fill(false);
    demoState.bagSlots.forEach((card, index) => {
      if (!card) return;
      const size = Math.max(1, skillBook[card.skillId]?.size ?? 1);
      for (let i = index; i < index + size && i < SLOTS; i++) occ[i] = true;
    });
    return occ;
  }

  private nearestFit(occ: boolean[], size: number, prefer: number): number {
    const fits: number[] = [];
    for (let i = 0; i + size <= SLOTS; i++) {
      let ok = true;
      for (let j = i; j < i + size; j++) if (occ[j]) { ok = false; break; }
      if (ok) fits.push(i);
    }
    if (fits.length === 0) return -1;
    return fits.reduce((best, s) => (Math.abs(s - prefer) < Math.abs(best - prefer) ? s : best), fits[0]!);
  }

  private addToBag(skill: SkillDef): { ok: true; used: number } | { ok: false } {
    const size = Math.max(1, skill.size);
    const fit = this.nearestFit(this.bagOccupied(), size, 0);
    if (fit < 0) return { ok: false };
    const card = createOwnedCard(skill.id, skill.tier);
    demoState.bagSlots[fit] = { instanceId: card.instanceId, skillId: card.skillId, tier: card.tier };
    const used = this.bagOccupied().filter(Boolean).length;
    return { ok: true, used };
  }

  // ---------- detail overlay ----------

  private openDetail(skill: SkillDef): void {
    this.detailOpen = true;
    const objs: Phaser.GameObjects.GameObject[] = [];
    const veil = this.add.rectangle(0, 0, this.W, this.H, 0x05070c, 0.78).setOrigin(0, 0).setDepth(3000).setInteractive();
    veil.on('pointerdown', () => this.closeDetail());
    objs.push(veil);

    const cardW = Math.min(220, this.W - 56);
    const cardH = cardW * (690 / 420);
    const cardY = this.H / 2 - 30;
    const cardRight = this.W / 2 + cardW / 2;
    const cardTop = cardY - cardH / 2;
    const close = this.add.rectangle(cardRight + 18, cardTop + 16, 30, 30, 0x24344a, 1)
      .setOrigin(0.5).setDepth(3003).setStrokeStyle(1, 0x8a94a6, 0.8).setInteractive({ useHandCursor: true });
    const closeText = this.add.text(close.x, close.y, '×', {
      fontSize: '19px', color: '#e8e0c8', fontFamily: FONT.body, fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(3004);
    close.on('pointerdown', (_pointer: Phaser.Input.Pointer, _localX: number, _localY: number, event: Phaser.Types.Input.EventData) => { event.stopPropagation(); this.closeDetail(); });
    objs.push(close, closeText);
    const preview = new FantasyCardTemplateV2(this, this.W / 2, cardY, skill, {
      width: cardW,
      height: cardH,
      tier: skill.tier,
      glossary: false,
    }).setDepth(3002);
    objs.push(preview);

    const btnW = Math.min(220, this.W - 56);
    const btnH = 40;
    const btnY = cardY + cardH / 2 + 18;
    const btn = this.add.rectangle(this.W / 2, btnY, btnW, btnH, 0xe8b446).setOrigin(0.5, 0).setDepth(3002).setStrokeStyle(1, 0x1a1208, 0.8).setInteractive({ useHandCursor: true });
    const btnText = this.add.text(this.W / 2, btnY + btnH / 2, 'ADD TO BAG', {
      fontSize: '13px', color: '#1a1208', fontFamily: FONT.body, fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(3003);
    btn.on('pointerdown', (_pointer: Phaser.Input.Pointer, _localX: number, _localY: number, event: Phaser.Types.Input.EventData) => {
      event.stopPropagation();
      const result = this.addToBag(skill);
      this.closeDetail();
      if (result.ok) this.showToast(`Added to bag · ${result.used}/${SLOTS}`, '#9ad17a');
      else this.showToast(`Bag full — no room for size ${Math.max(1, skill.size)}`, '#e8907a');
    });
    objs.push(btn, btnText);

    this.detailObjects = objs;
  }

  private closeDetail(): void {
    this.detailOpen = false;
    for (const o of this.detailObjects) o.destroy();
    this.detailObjects = [];
  }

  private showToast(text: string, color: string): void {
    for (const o of this.toastObjects) o.destroy();
    this.toastObjects = [];
    const t = this.add.text(this.W / 2, this.H - 60, text, {
      fontSize: '12px', color, fontFamily: FONT.body, fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(4001);
    const bg = this.add.rectangle(this.W / 2, this.H - 60, t.width + 24, t.height + 14, 0x0b1420, 0.92).setOrigin(0.5).setDepth(4000).setStrokeStyle(1, 0x3a4a62, 0.9);
    this.toastObjects = [bg, t];
    this.tweens.add({
      targets: [t, bg],
      alpha: 0,
      delay: 1200,
      duration: 500,
      onComplete: () => {
        bg.destroy();
        t.destroy();
        this.toastObjects = [];
      },
    });
  }
}
