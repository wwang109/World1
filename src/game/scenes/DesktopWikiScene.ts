import Phaser from 'phaser';
import { playSfx } from '../audio/sfxSynth';
import { gemPowerLevel, powerLevelDeci } from '../../engine/balance';
import { applyTier } from '../../engine/cards';
import type { SkillDef, SkillTier } from '../../engine/types';
import { skillBook } from '../../data/skills';
import { gemBook, type GemDef } from '../../data/gems';
import { createOwnedCard, demoState } from '../demoState';
import { stripCardTextMarkup } from '../ui/cardTextMarkup';
import { DESKTOP_PROFILE } from '../layoutProfile';
import { FONT, GEM_RARITY_COLOR, SCREEN, TIER_COLOR, UI } from '../theme';
import { FantasyCardTemplateV2 } from '../ui/FantasyCardTemplateV2';
import { DESKTOP_LAYOUT, renderDesktopBackground, renderDesktopHeader } from '../ui/DesktopNav';
import { rebuildScene } from '../sceneRebuild';

const F = DESKTOP_PROFILE.font;
const SLOTS = 10;
type CardFilter = 'all' | 'weapon' | 'magic';
const TIERS: readonly SkillTier[] = ['bronze', 'silver', 'gold', 'diamond'];

interface GalleryCard {
  skill: SkillDef;
  card: FantasyCardTemplateV2;
  hit: Phaser.GameObjects.Rectangle;
  plText: Phaser.GameObjects.Text;
  baseX: number;
  baseY: number;
  w: number;
  h: number;
}

/**
 * Desktop Wiki — the full read-only card catalog. A masked, drag/wheel
 * scrollable grid on the left (ALL/WEAPON/MAGIC filters) plays a dumb
 * gallery over `skillBook`; the right-hand detail pane shows a larger
 * render of whichever card is selected plus an ADD TO BAG action that
 * mirrors the mobile wiki's slot-fit insertion.
 */
export class DesktopWikiScene extends Phaser.Scene {
  private filter: CardFilter = 'all';
  private view: 'cards' | 'gems' = 'cards';
  private selected?: SkillDef;
  /** Preview/add tier for the selected card (defaults to the card's authored tier). */
  private tier: SkillTier = 'bronze';
  private selectedGem?: GemDef;
  private filterObjects: Phaser.GameObjects.GameObject[] = [];
  private galleryCards: GalleryCard[] = [];
  private gemObjects: Phaser.GameObjects.GameObject[] = [];
  private detailObjects: Phaser.GameObjects.GameObject[] = [];
  private toastObjects: Phaser.GameObjects.GameObject[] = [];
  private galleryMask?: Phaser.GameObjects.Graphics;
  private indicator?: Phaser.GameObjects.Rectangle;
  private viewport = { top: 0, height: 0, left: 0, width: 0 };
  private scrollY = 0;
  private maxScroll = 0;
  private scrollWired = false;

  constructor() {
    super('DesktopWiki');
  }

  init(): void {
    this.filter = 'all';
    this.view = 'cards';
    this.selected = undefined;
    this.tier = 'bronze';
    this.selectedGem = undefined;
    this.filterObjects = [];
    this.galleryCards = [];
    this.gemObjects = [];
    this.detailObjects = [];
    this.toastObjects = [];
    this.galleryMask = undefined;
    this.indicator = undefined;
    this.viewport = { top: 0, height: 0, left: 0, width: 0 };
    this.scrollY = 0;
    this.maxScroll = 0;
    this.scrollWired = false;
  }

  create(): void {
    renderDesktopBackground(this);
    renderDesktopHeader(this, 'WIKI', 'wiki');
    if (this.view === 'cards') {
      this.selected = this.selected ?? this.filteredSkills()[0];
      this.tier = this.selected?.tier ?? 'bronze';
      this.renderFilterRow();
      this.renderGallery();
      this.renderDetail();
      this.wireScroll();
    } else {
      this.selectedGem = this.selectedGem ?? Object.values(gemBook)[0];
      this.renderFilterRow();
      this.renderGemGallery();
      this.renderGemDetail();
    }
  }

  /** Full re-render for view/tier switches (see sceneRebuild.ts). The rebuild
   * strips scene-level input listeners, so `scrollWired` must reset with it —
   * otherwise the guard skips `wireScroll()` and scrolling dies. */
  private rerender(): void {
    this.filterObjects = [];
    this.galleryCards = [];
    this.gemObjects = [];
    this.detailObjects = [];
    this.toastObjects = [];
    this.galleryMask = undefined;
    this.indicator = undefined;
    this.scrollY = 0;
    this.maxScroll = 0;
    this.scrollWired = false;
    rebuildScene(this);
  }

  private filteredSkills(): SkillDef[] {
    return Object.values(skillBook)
      .filter((skill) => this.filter === 'all'
        || (this.filter === 'weapon' ? skill.weapon !== undefined : skill.element !== undefined))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  // ---------- layout geometry ----------

  private detailPaneX(): number {
    const gx = DESKTOP_LAYOUT.gutter;
    const detailWidth = 364;
    return SCREEN.width - gx - detailWidth;
  }

  private gridBounds(): { left: number; right: number; width: number } {
    const gx = DESKTOP_LAYOUT.gutter;
    const right = this.detailPaneX() - DESKTOP_LAYOUT.gap;
    return { left: gx, right, width: right - gx };
  }

  // ---------- filter row ----------

  private renderFilterRow(): void {
    this.clearObjects(this.filterObjects);
    const gx = DESKTOP_LAYOUT.gutter;
    const top = DESKTOP_LAYOUT.contentTop;

    // CARDS | GEMS view tabs.
    let tx = gx;
    (['cards', 'gems'] as const).forEach((v) => {
      const active = this.view === v;
      const label = v.toUpperCase();
      const width = 34 + label.length * 9;
      const tab = this.add.rectangle(tx, top - 4, width, 26, active ? UI.chip : UI.panelAlt)
        .setOrigin(0, 0).setStrokeStyle(1, active ? UI.chip : UI.border, 0.8).setInteractive({ useHandCursor: true });
      const text = this.add.text(tx + width / 2, top - 4 + 13, label, {
        fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${F.tiny}px`, color: active ? UI.textOnChip : UI.textDim,
      }).setOrigin(0.5);
      tab.on('pointerdown', () => {
        playSfx('uiClick');
        if (this.view === v) return;
        this.view = v;
        this.rerender();
      });
      this.filterObjects.push(tab, text);
      tx += width + 8;
    });

    const countLabel = this.view === 'cards'
      ? `${this.filteredSkills().length}/${Object.keys(skillBook).length} AUTHORED ENTRIES`
      : `${Object.keys(gemBook).length} GEMS · ${demoState.gemInventory.length} IN POUCH`;
    const count = this.add.text(this.gridBounds().right, top, countLabel, {
      fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${F.tiny}px`, color: UI.textDim,
    }).setOrigin(1, 0);
    this.filterObjects.push(count);

    if (this.view !== 'cards') return;
    const labels: Array<[string, CardFilter]> = [['ALL', 'all'], ['WEAPON', 'weapon'], ['MAGIC', 'magic']];
    let x = gx;
    const chipY = top + 28;
    for (const [chipLabel, value] of labels) {
      const active = value === this.filter;
      const width = 30 + chipLabel.length * 8;
      const chip = this.add.rectangle(x, chipY, width, 28, active ? UI.chip : UI.panelAlt)
        .setOrigin(0, 0)
        .setStrokeStyle(1, active ? UI.chip : UI.border, 0.8)
        .setInteractive({ useHandCursor: true });
      const text = this.add.text(x + width / 2, chipY + 14, chipLabel, {
        fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${F.tiny}px`, color: active ? UI.textOnChip : UI.textDim,
      }).setOrigin(0.5);
      chip.on('pointerdown', () => {
        playSfx('uiClick');
        if (this.filter === value) return;
        this.filter = value;
        this.selected = this.filteredSkills()[0];
        this.tier = this.selected?.tier ?? 'bronze';
        this.renderFilterRow();
        this.renderGallery();
        this.clearObjects(this.detailObjects);
        this.renderDetail();
      });
      this.filterObjects.push(chip, text);
      x += width + DESKTOP_LAYOUT.gap;
    }
  }

  // ---------- gallery (scrollable grid) ----------

  private clearGallery(): void {
    for (const row of this.galleryCards) {
      row.card.destroy();
      row.hit.destroy();
      row.plText.destroy();
    }
    this.galleryCards = [];
    this.indicator?.destroy();
    this.indicator = undefined;
    this.galleryMask?.destroy();
    this.galleryMask = undefined;
    this.scrollY = 0;
    this.maxScroll = 0;
  }

  private renderGallery(): void {
    this.clearGallery();
    const { left, width } = this.gridBounds();
    const top = DESKTOP_LAYOUT.contentTop + 68;
    const bottom = SCREEN.height - DESKTOP_PROFILE.safe.bottom;
    const height = bottom - top;
    this.viewport = { top, height, left, width };

    const maskShape = this.make.graphics({}, false);
    maskShape.fillStyle(0xffffff);
    maskShape.fillRect(left, top, width, height);
    const mask = maskShape.createGeometryMask();
    this.galleryMask = maskShape;

    const columns = 5;
    const gapX = 16;
    const gapY = 24;
    const plRowH = 20;
    const cardW = (width - (columns - 1) * gapX) / columns;
    const cardH = Math.round(cardW * (690 / 420));
    const rowStride = cardH + plRowH + gapY;

    const skills = this.filteredSkills();
    for (const [index, skill] of skills.entries()) {
      const col = index % columns;
      const row = Math.floor(index / columns);
      const baseX = left + col * (cardW + gapX) + cardW / 2;
      const baseY = row * rowStride;
      const card = new FantasyCardTemplateV2(this, baseX, top + baseY + cardH / 2, skill, {
        width: cardW,
        height: cardH,
        tier: skill.tier,
        glossary: false,
      });
      card.setMask(mask);
      const hit = this.add.rectangle(baseX, top + baseY + cardH / 2, cardW, cardH, 0xffffff, 0)
        .setInteractive({ useHandCursor: true });
      hit.setMask(mask);
      const plDeci = powerLevelDeci(skill);
      const plText = this.add.text(baseX, top + baseY + cardH + 4, `PL ${(plDeci / 10).toFixed(0)}`, {
        fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${F.tiny}px`, color: UI.textAccent,
      }).setOrigin(0.5, 0);
      plText.setMask(mask);
      this.galleryCards.push({ skill, card, hit, plText, baseX, baseY, w: cardW, h: cardH });
    }

    const rows = Math.ceil(skills.length / columns);
    const contentHeight = Math.max(0, rows * rowStride - gapY);
    this.maxScroll = Math.max(0, contentHeight - height);

    this.indicator = this.add.rectangle(left + width + 4, top, 3, height, UI.border, 0.6).setOrigin(0.5, 0);
    this.updateIndicator();

    if (skills.length === 0) {
      const empty = this.add.text(left + width / 2, top + 40, 'No cards match this filter.', {
        fontFamily: FONT.body, fontSize: `${F.small}px`, color: UI.textDim,
      }).setOrigin(0.5, 0);
      empty.setMask(mask);
      this.filterObjects.push(empty);
    }

    this.applyScroll();
  }

  private applyScroll(): void {
    const { top } = this.viewport;
    for (const row of this.galleryCards) {
      const worldTop = top + this.scrollY + row.baseY;
      row.card.setPosition(row.baseX, worldTop + row.h / 2);
      row.hit.setPosition(row.baseX, worldTop + row.h / 2);
      row.plText.setPosition(row.baseX, worldTop + row.h + 4);
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
    this.indicator.setPosition(this.indicator.x, thumbY + thumbH / 2);
  }

  private inViewport(x: number, y: number): boolean {
    const { top, height, left, width } = this.viewport;
    return x >= left && x <= left + width && y >= top && y <= top + height;
  }

  private wireScroll(): void {
    if (this.scrollWired) return;
    this.scrollWired = true;
    let dragging = false;
    let startY = 0;
    let startX = 0;
    let startScroll = 0;
    let totalMove = 0;
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (!this.inViewport(p.worldX, p.worldY)) return;
      dragging = true;
      startY = p.worldY; startX = p.worldX; startScroll = this.scrollY; totalMove = 0;
    });
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (!dragging) return;
      const dy = p.worldY - startY;
      totalMove = Math.max(totalMove, Math.hypot(p.worldX - startX, p.worldY - startY));
      this.scrollY = Phaser.Math.Clamp(startScroll + dy, -this.maxScroll, 0);
      this.applyScroll();
    });
    this.input.on('pointerup', (p: Phaser.Input.Pointer) => {
      if (!dragging) return;
      dragging = false;
      if (totalMove < 8) {
        const localY = p.worldY - this.viewport.top - this.scrollY;
        const row = this.galleryCards.find((r) => p.worldX >= r.baseX - r.w / 2 && p.worldX <= r.baseX + r.w / 2
          && localY >= r.baseY && localY < r.baseY + r.h);
        if (row) { playSfx('uiClick'); this.selectCard(row.skill); }
      }
    });
    this.input.on('wheel', (pointer: Phaser.Input.Pointer, _objs: unknown, _dx: number, dy: number) => {
      if (!this.inViewport(pointer.worldX, pointer.worldY)) return;
      this.scrollY = Phaser.Math.Clamp(this.scrollY - dy, -this.maxScroll, 0);
      this.applyScroll();
    });
  }

  private selectCard(skill: SkillDef): void {
    this.selected = skill;
    this.tier = skill.tier;
    this.clearObjects(this.detailObjects);
    this.renderDetail();
  }

  // ---------- detail pane ----------

  private renderDetail(): void {
    const skill = this.selected;
    const paneX = this.detailPaneX();
    const paneWidth = 364;
    const top = DESKTOP_LAYOUT.contentTop;
    const bottom = SCREEN.height - DESKTOP_PROFILE.safe.bottom;

    const panel = this.add.rectangle(paneX, top, paneWidth, bottom - top, UI.panel, 0.92)
      .setOrigin(0, 0).setStrokeStyle(1, UI.border, 0.8);
    this.detailObjects.push(panel);

    if (!skill) {
      const empty = this.add.text(paneX + paneWidth / 2, top + 60, 'No card selected.', {
        fontFamily: FONT.body, fontSize: `${F.small}px`, color: UI.textDim,
      }).setOrigin(0.5, 0);
      this.detailObjects.push(empty);
      return;
    }

    // Everything below previews the SELECTED TIER — the resolver's applyTier
    // scales the card to that tier's PL budget, and ADD TO BAG stamps it.
    const shown = this.tier === skill.tier ? skill : applyTier(skill, this.tier);
    const centerX = paneX + paneWidth / 2;
    const cardW = 220;
    const cardH = Math.round(cardW * (690 / 420));
    const cardY = top + 16 + cardH / 2;
    const card = new FantasyCardTemplateV2(this, centerX, cardY, shown, {
      width: cardW,
      height: cardH,
      tier: this.tier,
      glossary: false,
    });
    this.detailObjects.push(card);

    let y = cardY + cardH / 2 + 12;
    const name = this.add.text(centerX, y, skill.name, {
      fontFamily: FONT.display, fontStyle: 'bold', fontSize: `${F.name}px`, color: UI.text,
      align: 'center', wordWrap: { width: paneWidth - 32 },
    }).setOrigin(0.5, 0);
    this.detailObjects.push(name);
    y += name.height + 4;

    const plDeci = powerLevelDeci(shown);
    const pl = this.add.text(centerX, y, `POWER LEVEL ${(plDeci / 10).toFixed(0)} · ${this.tier.toUpperCase()}`, {
      fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${F.label}px`, color: UI.textAccent,
    }).setOrigin(0.5, 0);
    this.detailObjects.push(pl);
    y += pl.height + 8;

    // Tier chips — preview/add any tier from the card's authored tier up.
    const baseIdx = TIERS.indexOf(skill.tier);
    const chipW = (paneWidth - 32 - 3 * 6) / 4;
    TIERS.forEach((t, i) => {
      const cx = paneX + 16 + i * (chipW + 6);
      const active = t === this.tier;
      const allowed = i >= baseIdx;
      const chip = this.add.rectangle(cx, y, chipW, 26, active ? TIER_COLOR[t] : allowed ? UI.panelAlt : UI.panelMuted, allowed ? 1 : 0.4)
        .setOrigin(0, 0).setStrokeStyle(active ? 2 : 1, TIER_COLOR[t], allowed ? 1 : 0.3);
      const label = this.add.text(cx + chipW / 2, y + 13, t.toUpperCase(), {
        fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${F.tiny}px`,
        color: active ? UI.textOnChip : allowed ? UI.textDim : UI.textSoft,
      }).setOrigin(0.5);
      if (allowed && !active) {
        chip.setInteractive({ useHandCursor: true });
        chip.on('pointerdown', () => {
          playSfx('uiClick');
          this.tier = t;
          this.clearObjects(this.detailObjects);
          this.renderDetail();
        });
      }
      this.detailObjects.push(chip, label);
    });
    y += 26 + 10;

    const text = this.add.text(centerX, y, stripCardTextMarkup(shown.text), {
      fontFamily: FONT.body, fontSize: `${F.body}px`, color: UI.textSoft,
      align: 'center', wordWrap: { width: paneWidth - 32 }, lineSpacing: 4,
    }).setOrigin(0.5, 0);
    this.detailObjects.push(text);

    const buttonY = bottom - 60;
    const button = this.add.rectangle(centerX, buttonY, 220, 40, UI.chip)
      .setStrokeStyle(1, UI.border, 0.9).setInteractive({ useHandCursor: true });
    this.detailObjects.push(button);
    const buttonText = this.add.text(centerX, buttonY, `ADD TO BAG · ${this.tier.toUpperCase()}`, {
      fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${F.label}px`, color: UI.textOnChip,
    }).setOrigin(0.5);
    this.detailObjects.push(buttonText);
    button.on('pointerover', () => button.setFillStyle(UI.slotHover));
    button.on('pointerout', () => button.setFillStyle(UI.chip));
    button.on('pointerdown', () => {
      playSfx('uiClick');
      const result = this.addToBag(skill, this.tier);
      if (result.ok) this.showToast(`Added ${this.tier} · bag ${result.used}/${SLOTS}`, UI.good);
      else this.showToast(`Bag full — no room for size ${Math.max(1, skill.size)}`, UI.bad);
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

  private addToBag(skill: SkillDef, tier: SkillTier): { ok: true; used: number } | { ok: false } {
    const size = Math.max(1, skill.size);
    const fit = this.nearestFit(this.bagOccupied(), size, 0);
    if (fit < 0) return { ok: false };
    const cardInstance = createOwnedCard(skill.id, tier);
    demoState.bagSlots[fit] = { instanceId: cardInstance.instanceId, skillId: cardInstance.skillId, tier: cardInstance.tier };
    const used = this.bagOccupied().filter(Boolean).length;
    return { ok: true, used };
  }

  private showToast(text: string, color: number): void {
    this.clearObjects(this.toastObjects);
    const paneX = this.detailPaneX();
    const paneWidth = 364;
    const centerX = paneX + paneWidth / 2;
    const y = SCREEN.height - DESKTOP_PROFILE.safe.bottom - 96;
    const label = this.add.text(centerX, y, text, {
      fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${F.label}px`,
      color: color === UI.good ? '#9ad17a' : '#e8907a',
    }).setOrigin(0.5).setDepth(4001);
    const bg = this.add.rectangle(centerX, y, label.width + 24, label.height + 14, UI.panelMuted, 0.94)
      .setOrigin(0.5).setDepth(4000).setStrokeStyle(1, UI.border, 0.8);
    this.toastObjects = [bg, label];
    this.tweens.add({
      targets: [label, bg],
      alpha: 0,
      delay: 1200,
      duration: 500,
      onComplete: () => {
        this.clearObjects(this.toastObjects);
      },
    });
  }

  private clearObjects(objects: Phaser.GameObjects.GameObject[]): void {
    for (const object of objects) object.destroy();
    objects.length = 0;
  }

  // ---------- GEMS view ----------

  private static rarityHex(gem: GemDef): string {
    return `#${GEM_RARITY_COLOR[gem.rarity].toString(16).padStart(6, '0')}`;
  }

  /** Gem catalog grid — all 12 gems fit without scrolling. */
  private renderGemGallery(): void {
    this.clearObjects(this.gemObjects);
    const { left, width } = this.gridBounds();
    const top = DESKTOP_LAYOUT.contentTop + 40;
    const gems = Object.values(gemBook);
    const columns = 3;
    const gapX = DESKTOP_LAYOUT.gap;
    const cellW = (width - (columns - 1) * gapX) / columns;
    const cellH = 118;
    gems.forEach((gem, index) => {
      const col = index % columns;
      const row = Math.floor(index / columns);
      const cx = left + col * (cellW + gapX);
      const cy = top + row * (cellH + gapX);
      const active = this.selectedGem?.id === gem.id;
      const cell = this.add.rectangle(cx, cy, cellW, cellH, UI.panel, 0.94)
        .setOrigin(0, 0).setStrokeStyle(active ? 2 : 1, active ? GEM_RARITY_COLOR[gem.rarity] : UI.border, active ? 1 : 0.6)
        .setInteractive({ useHandCursor: true });
      cell.on('pointerdown', () => {
        playSfx('uiClick');
        this.selectedGem = gem;
        this.renderGemGallery();
        this.clearObjects(this.detailObjects);
        this.renderGemDetail();
      });
      // rarity diamond + name row
      const diamond = this.add.rectangle(cx + 22, cy + 22, 14, 14, GEM_RARITY_COLOR[gem.rarity]).setOrigin(0.5).setAngle(45);
      const name = this.add.text(cx + 38, cy + 14, gem.name, {
        fontFamily: FONT.display, fontStyle: 'bold', fontSize: `${F.name}px`, color: UI.text,
      });
      const meta = this.add.text(cx + 16, cy + 42, `${gem.rarity.toUpperCase()} · ${gem.kind === 'stat' ? 'STAT MOD' : 'EFFECT RIDER'}`, {
        fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${F.tiny}px`, color: DesktopWikiScene.rarityHex(gem),
      });
      // The gem's ACTUAL bonus is the headline information — not its PL price.
      const body = this.add.text(cx + 16, cy + 62, stripCardTextMarkup(gem.text), {
        fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${F.small}px`, color: UI.text,
        wordWrap: { width: cellW - 32 }, lineSpacing: 3,
      });
      // clamp to two lines so the grid stays even
      if (body.height > 40) { body.setText(`${body.text.slice(0, 84)}…`); }
      this.gemObjects.push(cell, diamond, name, meta, body);
    });
  }

  /** Right pane: full gem info + ADD TO POUCH (grows demoState.gemInventory). */
  private renderGemDetail(): void {
    const gem = this.selectedGem;
    const paneX = this.detailPaneX();
    const paneWidth = 364;
    const top = DESKTOP_LAYOUT.contentTop;
    const bottom = SCREEN.height - DESKTOP_PROFILE.safe.bottom;

    const panel = this.add.rectangle(paneX, top, paneWidth, bottom - top, UI.panel, 0.92)
      .setOrigin(0, 0).setStrokeStyle(1, UI.border, 0.8);
    this.detailObjects.push(panel);
    if (!gem) return;

    const centerX = paneX + paneWidth / 2;
    let y = top + 36;
    const diamond = this.add.rectangle(centerX, y + 10, 30, 30, GEM_RARITY_COLOR[gem.rarity]).setOrigin(0.5).setAngle(45)
      .setStrokeStyle(2, UI.border, 0.8);
    this.detailObjects.push(diamond);
    y += 44;
    const name = this.add.text(centerX, y, gem.name, {
      fontFamily: FONT.display, fontStyle: 'bold', fontSize: `${F.title}px`, color: UI.text,
      align: 'center', wordWrap: { width: paneWidth - 32 },
    }).setOrigin(0.5, 0);
    this.detailObjects.push(name);
    y += name.height + 6;
    const meta = this.add.text(centerX, y, `${gem.rarity.toUpperCase()} · ${gem.kind === 'stat' ? 'STAT MOD' : 'EFFECT RIDER'}`, {
      fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${F.label}px`, color: DesktopWikiScene.rarityHex(gem),
    }).setOrigin(0.5, 0);
    this.detailObjects.push(meta);
    y += meta.height + 14;
    // Lead with what the gem DOES; the PL price is a dim footnote below.
    const body = this.add.text(centerX, y, stripCardTextMarkup(gem.text), {
      fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${F.body}px`, color: UI.text,
      align: 'center', wordWrap: { width: paneWidth - 32 }, lineSpacing: 4,
    }).setOrigin(0.5, 0);
    this.detailObjects.push(body);
    y += body.height + 12;
    const plNote = this.add.text(centerX, y, `adds +${gemPowerLevel(gem)} PL to the host card's total`, {
      fontFamily: FONT.body, fontSize: `${F.tiny}px`, color: UI.textSoft,
    }).setOrigin(0.5, 0);
    this.detailObjects.push(plNote);
    y += plNote.height + 12;
    const owned = demoState.gemInventory.filter((id) => id === gem.id).length;
    const ownedText = this.add.text(centerX, y, `IN POUCH: ${owned}`, {
      fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${F.small}px`, color: UI.textDim,
    }).setOrigin(0.5, 0);
    this.detailObjects.push(ownedText);
    this.detailObjects.push(this.add.text(centerX, bottom - 106, 'Socket gems onto deck cards in DECK BUILD\n(click a deck card).', {
      fontFamily: FONT.body, fontSize: `${F.tiny}px`, color: UI.textSoft, align: 'center', lineSpacing: 3,
    }).setOrigin(0.5, 0));

    const buttonY = bottom - 60;
    const button = this.add.rectangle(centerX, buttonY, 220, 40, UI.chip)
      .setStrokeStyle(1, UI.border, 0.9).setInteractive({ useHandCursor: true });
    const buttonText = this.add.text(centerX, buttonY, 'ADD TO POUCH', {
      fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${F.label}px`, color: UI.textOnChip,
    }).setOrigin(0.5);
    this.detailObjects.push(button, buttonText);
    button.on('pointerover', () => button.setFillStyle(UI.slotHover));
    button.on('pointerout', () => button.setFillStyle(UI.chip));
    button.on('pointerdown', () => {
      playSfx('uiClick');
      demoState.gemInventory = [...demoState.gemInventory, gem.id];
      this.clearObjects(this.detailObjects);
      this.renderGemDetail();
      this.showToast(`${gem.name} added to pouch`, UI.good);
    });
  }
}

