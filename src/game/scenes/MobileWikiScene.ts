import Phaser from 'phaser';
import { playSfx } from '../audio/sfxSynth';
import { setDeckBuildContext } from '../deckBuildContext';
import { instancePowerLevelDeci, powerLevelDeci } from '../../engine/balance';
import { applyTier } from '../../engine/cards';
import { cardOfferableAtTier, minOfferableTier } from '../../engine/types';
import type { SkillDef, SkillTier } from '../../engine/types';
import { skillBook } from '../../data/skills';
import { gemBook, type GemDef } from '../../data/gems';
import { gemCatalogOrder } from '../ui/gemGlossary';
import { createOwnedCard, demoState } from '../demoState';
import { stripCardTextMarkup } from '../ui/cardTextMarkup';
import { MOBILE_PROFILE } from '../layoutProfile';
import { FONT, GEM_RARITY_COLOR, SCREEN, textRole, TIER_COLOR, UI } from '../theme';
import { CardToken } from '../ui/CardToken';
import { captionCell, captionCellHeight, MOBILE_WIKI_TOKEN_H, WIKI_PL_ROW_H, WIKI_PL_ROW_INSET, type CellBox } from '../ui/cardCellLayout';
import { FantasyCardTemplateV2 } from '../ui/FantasyCardTemplateV2';
import { gridWindow, inGridWindow } from '../ui/gridWindow';
import { rebuildScene, wasPointerConsumedByRebuild } from '../sceneRebuild';

const F = MOBILE_PROFILE.font;
const SLOTS = 10;
/**
 * Height of the catalogue card's `CardToken` itself. NOT the row's height —
 * see `CELL_H`.
 */
const TOKEN_H = MOBILE_WIKI_TOKEN_H;
/**
 * One catalogue cell: the token, plus the `PL n` row RESERVED underneath it
 * (`ui/cardCellLayout.ts`). The PL chip used to be drawn INSIDE the token's
 * inward top corner, which is where `CardToken` draws a multi-slot offer's
 * `×N SLOTS` badge — see that module's header for the full write-up. This is
 * the same split the DESKTOP gallery has always used (`plRowH` there), so both
 * platforms now put PL in the same place relative to the card.
 */
const CELL_H = captionCellHeight(TOKEN_H, WIKI_PL_ROW_H);
const ROW_GAP = 8;
const FILTER_BAND_H = 82;
const GEM_ROW_H = 78;
const GEM_ROW_GAP = 8;
/**
 * Catalogue rows kept live above and below the viewport (`ui/gridWindow.ts`).
 * Two rows of a two-column grid is four cards of slack in each direction — more
 * than one drag frame can cross at the ~92px row stride, so a fast flick never
 * exposes an unbuilt cell.
 */
const OVERSCAN_ROWS = 2;
type WikiCardFilter = 'all' | 'weapon' | 'magic';
type WikiView = 'cards' | 'gems';
const TIERS: readonly SkillTier[] = ['bronze', 'silver', 'gold', 'diamond'];

interface CatalogRow {
  skill: SkillDef;
  token: CardToken;
  plText: Phaser.GameObjects.Text;
  baseX: number;
  baseY: number;
  /** Cell width (the token's width too — the caption strip is full-width). */
  w: number;
  /** Cell height: token + reserved PL row. The TAP region, hence the cell. */
  h: number;
}

interface GemRow {
  gem: GemDef;
  container: Phaser.GameObjects.Container;
  baseY: number;
  h: number;
}

/** What `ensureGemRow` needs to build one gem row on demand. */
interface GemGrid {
  rowStride: number;
  mask?: Phaser.Display.Masks.GeometryMask;
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
  /**
   * The catalogue is WINDOWED — `rows[i]` exists only once cell `i` has been
   * scrolled within `OVERSCAN_ROWS` of the viewport, so the array is SPARSE
   * until the reader has been everywhere. See `ui/gridWindow.ts` for the
   * measurements that forced this; the short version is that Phaser does not
   * frustum-cull, so all 166 cards used to be drawn (and stencil-masked) every
   * frame no matter where they were scrolled to.
   *
   * Cells leaving the window are HIDDEN, never destroyed: `visible` is the one
   * thing `willRender` checks, so hiding is the whole frame-rate win, while
   * keeping the object means a card's art streams once and a fast drag never
   * pays to rebuild a `CardToken`.
   */
  private rows: Array<CatalogRow | undefined> = [];
  /** The filtered catalogue `rows` indexes into. */
  private catalogSkills: SkillDef[] = [];
  /** The viewport clip every catalogue cell shares (built once per render). */
  private cellMask?: Phaser.Display.Masks.GeometryMask;
  /** Column centres / card width / row stride — what `ensureRow` places from. */
  private grid = { cardW: 0, colX: [0, 0] as [number, number], rowStride: CELL_H + ROW_GAP };
  /** Windowed exactly like `rows` — 53 gem rows, ~9 on screen. */
  private gemRows: Array<GemRow | undefined> = [];
  private catalogGems: GemDef[] = [];
  private gemGrid: GemGrid = { rowStride: GEM_ROW_H + GEM_ROW_GAP };
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
    this.catalogSkills = [];
    this.cellMask = undefined;
    this.gemRows = [];
    this.catalogGems = [];
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
    this.cellMask = maskShape.createGeometryMask();

    const contentW = this.W - 20;
    const cardW = (contentW - ROW_GAP) / 2;
    this.grid = {
      cardW,
      colX: [10 + cardW / 2, 10 + cardW + ROW_GAP + cardW / 2],
      rowStride: CELL_H + ROW_GAP,
    };

    const skills = this.filteredSkills();
    this.catalogSkills = skills;
    this.rows = new Array<CatalogRow | undefined>(skills.length);
    const contentHeight = Math.max(0, Math.ceil(skills.length / 2) * this.grid.rowStride - ROW_GAP);
    this.maxScroll = Math.max(0, contentHeight - height);

    // Depth 1 so the thumb stays above cells, which are now appended to the
    // display list LATER than it is — a windowed cell is built the first time
    // it scrolls into range, not in this pass.
    this.indicator = this.add.rectangle(this.W - 4, top, 3, height, 0x3a4a62, 0.8).setOrigin(0.5, 0).setDepth(1);
    this.updateIndicator();
    if (skills.length === 0) {
      this.add.text(this.W / 2, top + 40, 'No cards in the catalog.', { fontSize: `${F.body}px`, color: UI.textDim, fontFamily: FONT.body }).setOrigin(0.5, 0);
    }
    this.syncWindow();
  }

  /**
   * Builds catalogue cell `index` if it does not exist yet, and returns it.
   * The ONE place a catalogue `CardToken` is constructed — cells arrive as the
   * reader scrolls to them, which is also what keeps the wiki from resolving
   * all 72 card-art textures on entry.
   */
  private ensureRow(index: number): CatalogRow | undefined {
    const existing = this.rows[index];
    if (existing) return existing;
    const skill = this.catalogSkills[index];
    const mask = this.cellMask;
    if (!skill || !mask) return undefined;
    const col = index % 2;
    const { cardW, colX, rowStride } = this.grid;
    const baseX = colX[col]!;
    const baseY = Math.floor(index / 2) * rowStride;
    const token = new CardToken(this, baseX, 0, skill, { width: cardW, height: TOKEN_H, side: col === 0 ? 'left' : 'right' });
    token.setMask(mask);
    const plDeci = instancePowerLevelDeci(skill, { gem: null });
    // CENTRED IN THE RESERVED ROW UNDER THE CARD, the same place the desktop
    // gallery puts it — never in the token's own inward top corner, which
    // belongs to the `xN SLOTS` badge (`ui/cardCellLayout.ts`). No scrim
    // either: this row is scene ground, not card art.
    const plText = this.add.text(baseX, 0, `PL ${(plDeci / 10).toFixed(0)}`, textRole('kicker', { ink: 'resource' }))
      .setOrigin(0.5, 0);
    plText.setMask(mask);
    const row: CatalogRow = { skill, token, plText, baseX, baseY, w: cardW, h: CELL_H };
    this.rows[index] = row;
    return row;
  }

  /**
   * Brings the live set of cells in line with the current scroll offset:
   * everything inside the window is built (if new), placed and shown;
   * everything outside it is hidden. Cheap enough to run every drag frame —
   * the loop is over 166 array slots, not over 166 game objects.
   */
  private syncWindow(): void {
    const { top, height } = this.viewport;
    const win = gridWindow({
      count: this.catalogSkills.length,
      columns: 2,
      rowStride: this.grid.rowStride,
      cellH: CELL_H,
      viewportHeight: height,
      scrollY: this.scrollY,
      overscanRows: OVERSCAN_ROWS,
    });
    for (let index = 0; index < this.rows.length; index++) {
      if (inGridWindow(win, index)) {
        const row = this.ensureRow(index);
        if (!row) continue;
        this.placeRow(row, top + this.scrollY + row.baseY);
        row.token.setVisible(true);
        row.plText.setVisible(true);
        continue;
      }
      const row = this.rows[index];
      if (!row) continue;
      row.token.setVisible(false);
      row.plText.setVisible(false);
    }
  }

  /** The LIVE catalogue cell under a point, in scene x / content-space y. */
  private rowAt(worldX: number, localY: number): CatalogRow | undefined {
    for (const row of this.rows) {
      if (!row || !row.token.visible) continue;
      if (worldX < row.baseX - row.w / 2 || worldX > row.baseX + row.w / 2) continue;
      if (localY >= row.baseY && localY < row.baseY + row.h) return row;
    }
    return undefined;
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

    const gems = gemCatalogOrder(Object.values(gemBook));
    this.catalogGems = gems;
    this.gemRows = new Array<GemRow | undefined>(gems.length);
    this.gemGrid = { rowStride: GEM_ROW_H + GEM_ROW_GAP, mask: maskShape.createGeometryMask() };
    const contentHeight = Math.max(0, gems.length * this.gemGrid.rowStride - GEM_ROW_GAP);
    this.maxScroll = Math.max(0, contentHeight - height);

    // Depth 1: same reason as the card catalogue's thumb — rows are appended
    // to the display list as they scroll into range, after this line runs.
    this.indicator = this.add.rectangle(this.W - 4, top, 3, height, 0x3a4a62, 0.8).setOrigin(0.5, 0).setDepth(1);
    this.updateIndicator();
    this.syncGemWindow();
  }

  /** Builds gem row `index` if it does not exist yet. Twin of `ensureRow`. */
  private ensureGemRow(index: number): GemRow | undefined {
    const existing = this.gemRows[index];
    if (existing) return existing;
    const gem = this.catalogGems[index];
    const mask = this.gemGrid.mask;
    if (!gem || !mask) return undefined;
    const baseY = index * this.gemGrid.rowStride;
    const container = this.add.container(0, this.viewport.top + this.scrollY + baseY);
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
      let clipped = stripCardTextMarkup(gem.text);
      while (clipped.length > 1 && body.height > 26) { clipped = clipped.slice(0, -1); body.setText(`${clipped}…`); }
    }
    container.add([bg, diamond, name, meta, body]);
    container.setMask(mask);
    const row: GemRow = { gem, container, baseY, h: GEM_ROW_H };
    this.gemRows[index] = row;
    return row;
  }

  /** `syncWindow` for the single-column gem list. */
  private syncGemWindow(): void {
    const { top, height } = this.viewport;
    const win = gridWindow({
      count: this.catalogGems.length,
      columns: 1,
      rowStride: this.gemGrid.rowStride,
      cellH: GEM_ROW_H,
      viewportHeight: height,
      scrollY: this.scrollY,
      overscanRows: OVERSCAN_ROWS,
    });
    for (let index = 0; index < this.gemRows.length; index++) {
      if (inGridWindow(win, index)) {
        const row = this.ensureGemRow(index);
        if (!row) continue;
        row.container.setY(top + this.scrollY + row.baseY);
        row.container.setVisible(true);
        continue;
      }
      const row = this.gemRows[index];
      if (!row) continue;
      row.container.setVisible(false);
    }
  }

  /** The LIVE gem row at a content-space y. */
  private gemRowAt(localY: number): GemRow | undefined {
    for (const row of this.gemRows) {
      if (!row || !row.container.visible) continue;
      if (localY >= row.baseY && localY < row.baseY + row.h) return row;
    }
    return undefined;
  }

  private static rarityHex(gem: GemDef): string {
    return `#${GEM_RARITY_COLOR[gem.rarity].toString(16).padStart(6, '0')}`;
  }

  /**
   * Places ONE catalogue row's token and PL label for a cell whose top edge is
   * at `worldTop`. The ONE definition of that geometry, called by BOTH the
   * initial render and `applyScroll` — which is precisely the bug this closes:
   * `renderCardCatalog` used to drop the PL chip 24px on a multi-slot card to
   * dodge `CardToken`'s `xN SLOTS` badge while `applyScroll` re-placed it at a
   * flat +8, so the dodge survived exactly until the player scrolled one
   * pixel. There is no offset left to keep in sync — the strip is reserved,
   * and both call sites now derive it from the same `captionCell` split.
   */
  private placeRow(row: CatalogRow, worldTop: number): void {
    const cell: CellBox = { x: row.baseX - row.w / 2, y: worldTop, w: row.w, h: row.h };
    const { token, caption } = captionCell(cell, WIKI_PL_ROW_H);
    row.token.setPosition(row.baseX, token.y + token.h / 2);
    row.plText.setPosition(row.baseX, caption.y + WIKI_PL_ROW_INSET);
  }

  /** Re-windows and repositions the catalogue for the current scroll offset. */
  private applyScroll(): void {
    this.syncWindow();
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
          // The tap region is the CELL, not the token — a tap on the PL row under
          // a card opens that card, which is what a reader aiming at the card's
          // bottom edge expects.
          const row = this.rowAt(p.worldX, localY);
          if (row) { playSfx('uiClick'); this.openDetail(row.skill); }
        } else {
          const row = this.gemRowAt(localY);
          if (row) { playSfx('uiClick'); this.openGemDetail(row.gem); }
        }
      }
    });
  }

  /** Re-windows and repositions the gem list for the current scroll offset. */
  private applyGemScroll(): void {
    this.syncGemWindow();
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
    // The card's LOWEST OFFERABLE tier, not its authored one (`minOfferableTier`,
    // engine/types.ts) — same rule as DesktopWikiScene's `defaultTierFor`: a card
    // whose whole payload is tier-locked above its own tier has no usable copy
    // there, and ADD TO BAG must never stamp one.
    this.detailTier = minOfferableTier(skill) ?? skill.tier;
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

    // Tier chips — preview/add any tier the card actually HAS a copy at
    // (`cardOfferableAtTier`, engine/types.ts). Authored tier and up, except for
    // a card whose whole payload is tier-locked higher: there the lowest chips
    // are dead too, because a copy at them would do nothing.
    const chipGap = 6;
    const chipW = (paneWidth - 3 * chipGap) / 4;
    const chipsX = centerX - paneWidth / 2;
    TIERS.forEach((t, i) => {
      const cx = chipsX + i * (chipW + chipGap);
      const active = t === this.detailTier;
      const allowed = cardOfferableAtTier(skill, t);
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
      if (result.ok) this.showToast(`Added ${this.detailTier} · bag ${result.used}/${SLOTS}`, UI.textGem);
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
      this.showToast(`${gem.name} added to pouch`, UI.textGem);
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
