import Phaser from 'phaser';
import { playSfx } from '../audio/sfxSynth';
import { setDeckBuildContext } from '../deckBuildContext';
import { instancePowerLevelDeci, powerLevelDeci } from '../../engine/balance';
import { applyTier } from '../../engine/cards';
import type { SkillDef, SkillTier } from '../../engine/types';
import { skillBook } from '../../data/skills';
import { gemBook, type GemDef } from '../../data/gems';
import { createOwnedCard, demoState } from '../demoState';
import { stripCardTextMarkup } from '../ui/cardTextMarkup';
import { MOBILE_PROFILE } from '../layoutProfile';
import { FONT, GEM_RARITY_COLOR, SCREEN, TIER_COLOR, UI } from '../theme';
import { CardToken } from '../ui/CardToken';
import { FantasyCardTemplateV2 } from '../ui/FantasyCardTemplateV2';
import { rebuildScene, wasPointerConsumedByRebuild } from '../sceneRebuild';

const F = MOBILE_PROFILE.font;
const SLOTS = 10;
const ROW_H = 84;
const ROW_GAP = 8;
const FILTER_BAND_H = 82;
const GEM_ROW_H = 78;
const GEM_ROW_GAP = 8;
type WikiCardFilter = 'all' | 'weapon' | 'magic';
type WikiView = 'cards' | 'gems';
const TIERS: readonly SkillTier[] = ['bronze', 'silver', 'gold', 'diamond'];

interface CatalogRow {
  skill: SkillDef;
  token: CardToken;
  plText: Phaser.GameObjects.Text;
  baseX: number;
  baseY: number;
  h: number;
}

interface GemRow {
  gem: GemDef;
  container: Phaser.GameObjects.Container;
  baseY: number;
  h: number;
}

/**
 * Mobile Wiki — a scrollable read-only catalog of every card in skillBook,
 * built for playtesting: tap a card to inspect it (with a tier selector) and
 * ADD TO BAG on demand. A CARDS | GEMS tab switches the same scrollable
 * viewport to the gem catalog (tap a gem for its detail + ADD TO POUCH).
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
  private gemRows: GemRow[] = [];
  private indicator?: Phaser.GameObjects.Rectangle;
  private detailOpen = false;
  private detailSkill?: SkillDef;
  private detailTier: SkillTier = 'bronze';
  private detailGem?: GemDef;
  private detailObjects: Phaser.GameObjects.GameObject[] = [];
  private toastObjects: Phaser.GameObjects.GameObject[] = [];
  private cardFilter: WikiCardFilter = 'all';
  private view: WikiView = 'cards';

  constructor() { super('MobileWiki'); }

  /** State changed → rebuild this frame in place (see sceneRebuild.ts). */
  private rerender(): void {
    rebuildScene(this);
  }

  /** Fresh entry (scene.start) always reopens on CARDS / ALL / bronze —
   * matching DesktopWikiScene.init(); rebuilds within a visit keep the
   * current tab, filter, and tier (rebuildScene re-runs create() only). */
  init(): void {
    this.view = 'cards';
    this.cardFilter = 'all';
    this.detailTier = 'bronze';
  }

  create(): void {
    this.W = SCREEN.width;
    this.H = SCREEN.height;
    this.scrollY = 0;
    this.detailOpen = false;
    this.detailSkill = undefined;
    this.detailGem = undefined;
    this.rows = [];
    this.gemRows = [];
    this.detailObjects = [];
    this.toastObjects = [];
    this.cameras.main.setBackgroundColor(0x0b1420);
    this.renderTabs();
    this.renderFilterBand();
    if (this.view === 'cards') this.renderCardCatalog();
    else this.renderGemCatalog();
    this.wireScroll();
  }

  private renderTabs(): void {
    const tabs: Array<[string, boolean, () => void]> = [
      ['MENU', false, () => this.scene.start('Start')],
      ['PREP', false, () => this.scene.start('MobilePrep')],
      ['DECK', false, () => { setDeckBuildContext('demo'); this.scene.start('MobileDeckBuild'); }],
      ['WIKI', true, () => {}],
      ['SHOP', false, () => this.scene.start('MobileShop')],
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

  // ---------- filter / view band ----------

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

    // CARDS | GEMS view tabs (compact chips).
    const viewTabs: Array<[WikiView, string]> = [['cards', 'CARDS'], ['gems', 'GEMS']];
    let tx = 22;
    for (const [v, label] of viewTabs) {
      const active = this.view === v;
      const w = 30 + label.length * 7;
      const chip = this.add.rectangle(tx, y + 8, w, 20, active ? 0xb78a46 : 0x18263a, 1)
        .setOrigin(0, 0).setStrokeStyle(1, active ? 0xe8b446 : 0x3a4a62, 0.9).setInteractive({ useHandCursor: true });
      this.add.text(tx + w / 2, y + 18, label, { fontSize: `${F.tiny}px`, color: active ? UI.textOnChip : UI.textMuted, fontFamily: FONT.body, fontStyle: 'bold' }).setOrigin(0.5);
      chip.on('pointerdown', () => {
        playSfx('uiClick');
        if (this.view === v) return;
        this.view = v;
        this.rerender();
      });
      tx += w + 6;
    }
    const countLabel = this.view === 'cards'
      ? `${this.filteredSkills().length}/${Object.keys(skillBook).length} CARDS`
      : `${Object.keys(gemBook).length} GEMS · ${demoState.gemInventory.length} IN POUCH`;
    this.add.text(this.W - 22, y + 12, countLabel, { fontSize: `${F.tiny}px`, color: UI.textMuted, fontFamily: FONT.body, fontStyle: 'bold' }).setOrigin(1, 0);
    this.add.rectangle(22, y + 31, this.W - 44, 1, 0x2a3a52).setOrigin(0, 0);

    if (this.view === 'cards') {
      this.add.text(22, y + 43, 'FILTERS', { fontSize: `${F.tiny}px`, color: UI.textMuted, fontFamily: FONT.body, fontStyle: 'bold' });
      const chips: Array<[string, WikiCardFilter]> = [['ALL', 'all'], ['WEAPON', 'weapon'], ['MAGIC', 'magic']];
      let x = 78;
      for (const [index, [label, value]] of chips.entries()) {
        const active = this.cardFilter === value;
        const w = index === 0 ? 58 : 72;
        const chip = this.add.rectangle(x, y + 54, w, 22, active ? 0xb78a46 : 0x18263a, 1)
          .setOrigin(0, 0).setStrokeStyle(1, active ? 0xe8b446 : 0x3a4a62, 0.9);
        this.add.text(x + w / 2, y + 65, label, { fontSize: `${F.tiny}px`, color: active ? UI.textOnChip : UI.textMuted, fontFamily: FONT.body, fontStyle: 'bold' }).setOrigin(0.5);
        chip.setInteractive({ useHandCursor: true });
        chip.on('pointerdown', () => {
          playSfx('uiClick');
          if (this.cardFilter === value) return;
          this.cardFilter = value;
          this.rerender();
        });
        x += w + 6;
      }
    } else {
      this.add.text(22, y + 43, 'GEM CATALOG', { fontSize: `${F.tiny}px`, color: UI.textMuted, fontFamily: FONT.body, fontStyle: 'bold' });
      this.add.text(22, y + 58, 'Tap a gem for details · ADD TO POUCH', { fontSize: `${F.tiny}px`, color: UI.textMuted, fontFamily: FONT.body });
    }
  }

  // ---------- card catalog + scroll ----------

  private renderCardCatalog(): void {
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
      // CardToken owns that same inward TOP corner for a multi-slot card's
      // "xN SLOTS" badge, so drop PL a row below it rather than overlap.
      const plY = top + baseY + (skill.size > 1 ? 24 : 8);
      const plText = this.add.text(baseX + (col === 0 ? cardW / 2 - 8 : -cardW / 2 + 8), plY, `PL ${(plDeci / 10).toFixed(0)}`, {
        fontSize: `${F.small}px`, color: '#e8b446', fontFamily: FONT.body, fontStyle: 'bold',
      }).setOrigin(col === 0 ? 1 : 0, 0).setBackgroundColor('#0b1420').setPadding(4, 2, 4, 2);
      plText.setMask(mask);
      this.rows.push({ skill, token, plText, baseX, baseY, h: ROW_H });
    }
    const contentHeight = Math.max(0, Math.ceil(skills.length / 2) * rowStride - ROW_GAP);
    this.maxScroll = Math.max(0, contentHeight - height);

    this.indicator = this.add.rectangle(this.W - 4, top, 3, height, 0x3a4a62, 0.8).setOrigin(0.5, 0);
    this.updateIndicator();
    if (skills.length === 0) {
      this.add.text(this.W / 2, top + 40, 'No cards in the catalog.', { fontSize: `${F.body}px`, color: UI.textDim, fontFamily: FONT.body }).setOrigin(0.5, 0);
    }
  }

  /** Single-column gem catalog: rarity diamond + name/rarity + prominent bonus text. */
  private renderGemCatalog(): void {
    const top = 142;
    const bottom = this.H - 10;
    const height = bottom - top;
    this.viewport = { top, height };

    const maskShape = this.make.graphics({}, false);
    maskShape.fillStyle(0xffffff);
    maskShape.fillRect(0, top, this.W, height);
    const mask = maskShape.createGeometryMask();

    const gems = Object.values(gemBook);
    const rowStride = GEM_ROW_H + GEM_ROW_GAP;
    gems.forEach((gem, index) => {
      const baseY = index * rowStride;
      const container = this.add.container(0, top + baseY);
      const bg = this.add.rectangle(10, 0, this.W - 20, GEM_ROW_H, 0x101a2a, 0.9)
        .setOrigin(0, 0).setStrokeStyle(1, GEM_RARITY_COLOR[gem.rarity], 0.7);
      const diamond = this.add.rectangle(28, 20, 13, 13, GEM_RARITY_COLOR[gem.rarity]).setOrigin(0.5).setAngle(45);
      const name = this.add.text(44, 8, gem.name, { fontSize: `${F.label}px`, color: UI.textBright, fontFamily: FONT.display, fontStyle: 'bold' });
      const meta = this.add.text(44, 26, `${gem.rarity.toUpperCase()} · ${gem.kind === 'stat' ? 'STAT MOD' : 'EFFECT'}`, {
        fontSize: `${F.tiny}px`, color: MobileWikiScene.rarityHex(gem), fontFamily: FONT.body, fontStyle: 'bold',
      });
      // The bonus itself is the headline — NOT its PL price (see detail overlay).
      const body = this.add.text(20, 44, stripCardTextMarkup(gem.text), {
        fontSize: `${F.tiny}px`, color: UI.textBright, fontFamily: FONT.body, wordWrap: { width: this.W - 60 }, lineSpacing: 2,
      });
      if (body.height > 26) {
        let s = stripCardTextMarkup(gem.text);
        while (s.length > 1 && body.height > 26) { s = s.slice(0, -1); body.setText(`${s}…`); }
      }
      container.add([bg, diamond, name, meta, body]);
      container.setMask(mask);
      this.gemRows.push({ gem, container, baseY, h: GEM_ROW_H });
    });
    const contentHeight = Math.max(0, gems.length * rowStride - GEM_ROW_GAP);
    this.maxScroll = Math.max(0, contentHeight - height);

    this.indicator = this.add.rectangle(this.W - 4, top, 3, height, 0x3a4a62, 0.8).setOrigin(0.5, 0);
    this.updateIndicator();
  }

  private static rarityHex(gem: GemDef): string {
    return `#${GEM_RARITY_COLOR[gem.rarity].toString(16).padStart(6, '0')}`;
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
      // See `wasPointerConsumedByRebuild` (sceneRebuild.ts) — the CARDS/GEMS
      // and ALL/WEAPON/MAGIC filter chips (`renderFilterBand`) call
      // `rerender()` from their own pointerdown handler; without this, a
      // rebuild-timed click landing inside the (freshly laid out) catalog
      // viewport would immediately start a phantom scroll-drag / tap-select.
      // (`this.detailOpen` below is a plain, correctly-timed guard — opening/
      // closing the detail overlay does NOT rebuild the scene, so this
      // listener is never re-registered mid-click for that flow; the veil's
      // own pointerdown separately guards THAT case with
      // `event.stopPropagation()` — see `renderCardDetail`/`renderGemDetail`.)
      if (wasPointerConsumedByRebuild(this, p)) return;
      if (this.detailOpen) return;
      const { top, height } = this.viewport;
      if (p.worldY < top || p.worldY > top + height) return;
      dragging = true;
      startY = p.worldY; startX = p.worldX; startScroll = this.scrollY; totalMove = 0;
    });
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (!dragging) return;
      const dy = p.worldY - startY;
      totalMove = Math.max(totalMove, Math.hypot(p.worldX - startX, p.worldY - startY));
      this.scrollY = Phaser.Math.Clamp(startScroll + dy, -this.maxScroll, 0);
      if (this.view === 'cards') this.applyScroll();
      else this.applyGemScroll();
    });
    this.input.on('pointerup', (p: Phaser.Input.Pointer) => {
      // Symmetric with the `pointerdown` guard above — `processUpEvents` has
      // the SAME two-phase (per-object then scene-level) dispatch as
      // `processDownEvents` (see `wasPointerConsumedByRebuild`'s doc comment,
      // sceneRebuild.ts). No object-level `pointerup` handler rebuilds today,
      // so `dragging` being null already protects this listener in practice —
      // this guard is defense-in-depth against the first one that does.
      if (wasPointerConsumedByRebuild(this, p)) return;
      if (!dragging) return;
      dragging = false;
      if (totalMove < 8) {
        const localY = p.worldY - this.viewport.top - this.scrollY;
        if (this.view === 'cards') {
          const row = this.rows.find((r) => p.worldX >= r.baseX - r.token.width / 2 && p.worldX <= r.baseX + r.token.width / 2 && localY >= r.baseY && localY < r.baseY + r.h);
          if (row) { playSfx('uiClick'); this.openDetail(row.skill); }
        } else {
          const row = this.gemRows.find((r) => localY >= r.baseY && localY < r.baseY + r.h);
          if (row) { playSfx('uiClick'); this.openGemDetail(row.gem); }
        }
      }
    });
  }

  /** Repositions every gem row's container (each row is a single container
   *  holding its bg/diamond/name/meta/body children). */
  private applyGemScroll(): void {
    const { top } = this.viewport;
    for (const row of this.gemRows) {
      row.container.setY(top + this.scrollY + row.baseY);
    }
    this.updateIndicator();
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
    const card = createOwnedCard(skill.id, tier);
    demoState.bagSlots[fit] = { instanceId: card.instanceId, skillId: card.skillId, tier: card.tier };
    const used = this.bagOccupied().filter(Boolean).length;
    return { ok: true, used };
  }

  // ---------- card detail overlay ----------

  private clearDetail(): void {
    for (const o of this.detailObjects) o.destroy();
    this.detailObjects = [];
  }

  private openDetail(skill: SkillDef): void {
    this.detailOpen = true;
    this.detailSkill = skill;
    this.detailTier = skill.tier;
    this.renderCardDetail();
  }

  private renderCardDetail(): void {
    this.clearDetail();
    const skill = this.detailSkill;
    if (!skill) return;
    const objs: Phaser.GameObjects.GameObject[] = [];
    const veil = this.add.rectangle(0, 0, this.W, this.H, 0x05070c, 0.86).setOrigin(0, 0).setDepth(3000).setInteractive();
    // ADJACENT FINDING (audit 2026-08, same sweep as `wasPointerConsumedByRebuild`):
    // this handler mutates `detailOpen` to false WITHOUT a scene rebuild — the
    // scene-level `wireScroll` pointerdown listener is the SAME (never
    // re-registered) one, but it re-evaluates `this.detailOpen` for THIS same
    // click right after this handler runs, now sees it false, and can start a
    // phantom scroll-drag that reopens a detail panel on release. The
    // sibling `close` button below already guards this correctly via
    // `event.stopPropagation()` — mirror it here.
    veil.on('pointerdown', (_p: Phaser.Input.Pointer, _lx: number, _ly: number, event: Phaser.Types.Input.EventData) => {
      event.stopPropagation();
      playSfx('uiBack');
      this.closeDetail();
    });
    objs.push(veil);

    const close = this.add.rectangle(this.W - 30, 46, 28, 28, 0x24344a, 1)
      .setOrigin(0.5).setDepth(3003).setStrokeStyle(1, 0x8a94a6, 0.8).setInteractive({ useHandCursor: true });
    const closeText = this.add.text(close.x, close.y, '×', { fontSize: `${F.xlarge}px`, color: UI.textBright, fontFamily: FONT.body, fontStyle: 'bold' }).setOrigin(0.5).setDepth(3004);
    close.on('pointerdown', (_p: Phaser.Input.Pointer, _lx: number, _ly: number, event: Phaser.Types.Input.EventData) => { event.stopPropagation(); playSfx('uiBack'); this.closeDetail(); });
    objs.push(close, closeText);

    const shown = this.detailTier === skill.tier ? skill : applyTier(skill, this.detailTier);
    const paneWidth = this.W - 40;
    const centerX = this.W / 2;
    const cardW = 150;
    const cardH = cardW * (690 / 420);
    let y = 70;
    const cardY = y + cardH / 2;
    const preview = new FantasyCardTemplateV2(this, centerX, cardY, shown, { width: cardW, height: cardH, tier: this.detailTier, glossary: false }).setDepth(3002);
    objs.push(preview);
    y = cardY + cardH / 2 + 10;

    const name = this.add.text(centerX, y, skill.name, {
      fontFamily: FONT.display, fontStyle: 'bold', fontSize: `${F.heading}px`, color: UI.textBright,
      align: 'center', wordWrap: { width: paneWidth },
    }).setOrigin(0.5, 0).setDepth(3002);
    objs.push(name);
    y += name.height + 4;

    const plDeci = powerLevelDeci(shown);
    const pl = this.add.text(centerX, y, `POWER LEVEL ${(plDeci / 10).toFixed(0)} · ${this.detailTier.toUpperCase()}`, {
      fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${F.label}px`, color: '#e8b446',
    }).setOrigin(0.5, 0).setDepth(3002);
    objs.push(pl);
    y += pl.height + 8;

    // Tier chips — preview/add any tier from the card's authored tier up.
    const baseIdx = TIERS.indexOf(skill.tier);
    const chipGap = 6;
    const chipW = (paneWidth - 3 * chipGap) / 4;
    const chipsX = centerX - paneWidth / 2;
    TIERS.forEach((t, i) => {
      const cx = chipsX + i * (chipW + chipGap);
      const active = t === this.detailTier;
      const allowed = i >= baseIdx;
      const chip = this.add.rectangle(cx, y, chipW, 24, active ? TIER_COLOR[t] : allowed ? 0x18263a : 0x101a2a, allowed ? 1 : 0.4)
        .setOrigin(0, 0).setStrokeStyle(active ? 2 : 1, TIER_COLOR[t], allowed ? 1 : 0.3).setDepth(3002);
      const label = this.add.text(cx + chipW / 2, y + 12, t.toUpperCase(), {
        fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${F.tiny}px`,
        color: active ? UI.textOnChip : allowed ? UI.textMuted : UI.textDisabled,
      }).setOrigin(0.5).setDepth(3002);
      if (allowed && !active) {
        chip.setInteractive({ useHandCursor: true });
        chip.on('pointerdown', (_p: Phaser.Input.Pointer, _lx: number, _ly: number, event: Phaser.Types.Input.EventData) => {
          event.stopPropagation();
          playSfx('uiClick');
          this.detailTier = t;
          this.renderCardDetail();
        });
      }
      objs.push(chip, label);
    });
    y += 24 + 10;

    const text = this.add.text(centerX, y, stripCardTextMarkup(shown.text), {
      fontFamily: FONT.body, fontSize: `${F.label}px`, color: '#c9b896',
      align: 'center', wordWrap: { width: paneWidth }, lineSpacing: 3,
    }).setOrigin(0.5, 0).setDepth(3002);
    objs.push(text);
    y += text.height + 14;

    const btnW = paneWidth;
    const btnH = 40;
    const btn = this.add.rectangle(centerX, y, btnW, btnH, 0xe8b446).setOrigin(0.5, 0).setDepth(3002).setStrokeStyle(1, 0x1a1208, 0.8).setInteractive({ useHandCursor: true });
    const btnText = this.add.text(centerX, y + btnH / 2, `ADD TO BAG · ${this.detailTier.toUpperCase()}`, {
      fontSize: `${F.body}px`, color: UI.textOnChip, fontFamily: FONT.body, fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(3003);
    btn.on('pointerdown', (_p: Phaser.Input.Pointer, _lx: number, _ly: number, event: Phaser.Types.Input.EventData) => {
      event.stopPropagation();
      playSfx('uiClick');
      const result = this.addToBag(skill, this.detailTier);
      this.closeDetail();
      if (result.ok) this.showToast(`Added ${this.detailTier} · bag ${result.used}/${SLOTS}`, '#9ad17a');
      else this.showToast(`Bag full — no room for size ${Math.max(1, skill.size)}`, '#e8907a');
    });
    objs.push(btn, btnText);

    this.detailObjects = objs;
  }

  // ---------- gem detail overlay ----------

  private openGemDetail(gem: GemDef): void {
    this.detailOpen = true;
    this.detailGem = gem;
    this.renderGemDetail();
  }

  private renderGemDetail(): void {
    this.clearDetail();
    const gem = this.detailGem;
    if (!gem) return;
    const objs: Phaser.GameObjects.GameObject[] = [];
    const veil = this.add.rectangle(0, 0, this.W, this.H, 0x05070c, 0.86).setOrigin(0, 0).setDepth(3000).setInteractive();
    // ADJACENT FINDING (audit 2026-08, same sweep as `wasPointerConsumedByRebuild`):
    // this handler mutates `detailOpen` to false WITHOUT a scene rebuild — the
    // scene-level `wireScroll` pointerdown listener is the SAME (never
    // re-registered) one, but it re-evaluates `this.detailOpen` for THIS same
    // click right after this handler runs, now sees it false, and can start a
    // phantom scroll-drag that reopens a detail panel on release. The
    // sibling `close` button below already guards this correctly via
    // `event.stopPropagation()` — mirror it here.
    veil.on('pointerdown', (_p: Phaser.Input.Pointer, _lx: number, _ly: number, event: Phaser.Types.Input.EventData) => {
      event.stopPropagation();
      playSfx('uiBack');
      this.closeDetail();
    });
    objs.push(veil);

    const close = this.add.rectangle(this.W - 30, 46, 28, 28, 0x24344a, 1)
      .setOrigin(0.5).setDepth(3003).setStrokeStyle(1, 0x8a94a6, 0.8).setInteractive({ useHandCursor: true });
    const closeText = this.add.text(close.x, close.y, '×', { fontSize: `${F.xlarge}px`, color: UI.textBright, fontFamily: FONT.body, fontStyle: 'bold' }).setOrigin(0.5).setDepth(3004);
    close.on('pointerdown', (_p: Phaser.Input.Pointer, _lx: number, _ly: number, event: Phaser.Types.Input.EventData) => { event.stopPropagation(); playSfx('uiBack'); this.closeDetail(); });
    objs.push(close, closeText);

    const centerX = this.W / 2;
    const paneWidth = this.W - 40;
    let y = 100;
    const diamond = this.add.rectangle(centerX, y + 12, 32, 32, GEM_RARITY_COLOR[gem.rarity]).setOrigin(0.5).setAngle(45)
      .setStrokeStyle(2, 0x8a94a6, 0.8).setDepth(3002);
    objs.push(diamond);
    y += 48;

    const name = this.add.text(centerX, y, gem.name, {
      fontFamily: FONT.display, fontStyle: 'bold', fontSize: `${F.subtitle}px`, color: UI.textBright,
      align: 'center', wordWrap: { width: paneWidth },
    }).setOrigin(0.5, 0).setDepth(3002);
    objs.push(name);
    y += name.height + 6;

    const meta = this.add.text(centerX, y, `${gem.rarity.toUpperCase()} · ${gem.kind === 'stat' ? 'STAT MOD' : 'EFFECT RIDER'}`, {
      fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${F.label}px`, color: MobileWikiScene.rarityHex(gem),
    }).setOrigin(0.5, 0).setDepth(3002);
    objs.push(meta);
    y += meta.height + 16;

    // Effect text is the whole story here — rarity is the rank, no PL shown
    // (PL still gates pricing via gemAudit.test.ts; this is display-only).
    const body = this.add.text(centerX, y, stripCardTextMarkup(gem.text), {
      fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${F.lead}px`, color: UI.textBright,
      align: 'center', wordWrap: { width: paneWidth }, lineSpacing: 4,
    }).setOrigin(0.5, 0).setDepth(3002);
    objs.push(body);
    y += body.height + 12;

    const owned = demoState.gemInventory.filter((id) => id === gem.id).length;
    const ownedText = this.add.text(centerX, y, `IN POUCH: ${owned}`, {
      fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${F.body}px`, color: UI.textDim,
    }).setOrigin(0.5, 0).setDepth(3002);
    objs.push(ownedText);
    y += ownedText.height + 24;

    const noteText = this.add.text(centerX, y, 'Socket gems onto deck cards in DECK BUILD (tap a deck card).', {
      fontFamily: FONT.body, fontSize: `${F.tiny}px`, color: UI.textMuted, align: 'center', wordWrap: { width: paneWidth }, lineSpacing: 3,
    }).setOrigin(0.5, 0).setDepth(3002);
    objs.push(noteText);
    y += noteText.height + 16;

    const btnW = paneWidth;
    const btnH = 40;
    const btn = this.add.rectangle(centerX, y, btnW, btnH, 0xe8b446).setOrigin(0.5, 0).setDepth(3002).setStrokeStyle(1, 0x1a1208, 0.8).setInteractive({ useHandCursor: true });
    const btnText = this.add.text(centerX, y + btnH / 2, 'ADD TO POUCH', {
      fontSize: `${F.body}px`, color: UI.textOnChip, fontFamily: FONT.body, fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(3003);
    btn.on('pointerdown', (_p: Phaser.Input.Pointer, _lx: number, _ly: number, event: Phaser.Types.Input.EventData) => {
      event.stopPropagation();
      playSfx('uiClick');
      demoState.gemInventory = [...demoState.gemInventory, gem.id];
      this.renderGemDetail();
      this.showToast(`${gem.name} added to pouch`, '#9ad17a');
    });
    objs.push(btn, btnText);

    this.detailObjects = objs;
  }

  private closeDetail(): void {
    this.detailOpen = false;
    this.detailSkill = undefined;
    this.detailGem = undefined;
    this.clearDetail();
  }

  private showToast(text: string, color: string): void {
    for (const o of this.toastObjects) o.destroy();
    this.toastObjects = [];
    const t = this.add.text(this.W / 2, this.H - 60, text, {
      fontSize: `${F.body}px`, color, fontFamily: FONT.body, fontStyle: 'bold',
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
