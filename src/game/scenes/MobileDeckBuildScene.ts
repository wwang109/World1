import Phaser from 'phaser';
import { playSfx } from '../audio/sfxSynth';
import { skillBook } from '../../data/skills';
import { gemPowerLevel, instancePowerLevelDeci, powerLevelDeci } from '../../engine/balance';
import { boardTypeIdentity, cardType } from '../../engine/combat/typeIdentity';
import type { Gem, SkillDef } from '../../engine/types';
import { buildAutoHeroSetup } from '../../run/encounter';
import { canStackMerge, moveWithinStrip, shiftInsert, socketGem, stackMergePieces, swapGem, unsocketGem } from '../../run/loadout';
import { nextSkillTier } from '../../run/shop';
import { gemBook } from '../../data/gems';
import { stripCardTextMarkup } from '../ui/cardTextMarkup';
import { demoState, type OwnedBoardPiece, type OwnedCard, type InventorySlot } from '../demoState';
import { MOBILE_PROFILE } from '../layoutProfile';
import { FONT, GEM_RARITY_COLOR, SCREEN, UI } from '../theme';
import { CardToken } from '../ui/CardToken';
import { addHoverTipZone, attachHoverTip } from '../ui/hoverTip';
import { gemHoverEntry } from '../ui/gemGlossary';
import { powerLevelEntry } from '../ui/cardGlossary';
import { renderCardInfoBox } from '../ui/cardInfoBox';
import { FantasyCardTemplateV2 } from '../ui/FantasyCardTemplateV2';
import type { ScalingStats } from '../ui/skillPresentation';
import { STAT_TOKEN } from '../ui/statLabels';
import { rebuildScene } from '../sceneRebuild';
import { getDeckBuildContext } from '../deckBuildContext';
import { renderRetireConfirm, renderRunHud, snapshotRunProgress } from '../ui/RunProgressStrip';
import { runScreenTemplate } from '../ui/runScreenTemplate';
import {
  currentHeroAllocation, currentHeroLevel,
  currentRunBagSlots, currentRunGemInventory, currentRunPieces, getActiveRun, retireActiveRun,
  setCurrentRunBagSlots, setCurrentRunGemInventory, setCurrentRunPieces,
} from '../runStore';

const F = MOBILE_PROFILE.font;
const SLOTS = 10;
const TEMPLATE = runScreenTemplate('mobile');

type Source =
  | { where: 'deck'; instanceId: string; card: OwnedCard }
  | { where: 'bag'; index: number; card: OwnedCard }
  | { where: 'hold'; card: OwnedCard };

/** A drop PARTICIPANT eligible for stack-merging — deck or bag only (never
 * `hold`: the TEMP HOLDING strip isn't a stack slot, so a card can't be
 * merge-target'd or merge-dragged through it). */
type MergeSource = Extract<Source, { where: 'deck' } | { where: 'bag' }>;

interface ColLayout { top: number; colH: number; colW: number; rowH: number; gap: number; deckX: number; bagX: number; }

/**
 * Mobile Deck Build — vertical: tabs · header · TEMP HOLDING strip · ACTIVE
 * DECK (left) vs BAG (right) columns · TRASH strip. DRAG a card between deck,
 * bag, and holding; drop on TRASH to delete (with confirm). Real demoState
 * mutations. Reachable at ?scene=mdeck.
 */
export class MobileDeckBuildScene extends Phaser.Scene {
  private W = SCREEN.width;
  private H = SCREEN.height;
  private hold: OwnedCard | null = null;
  private pendingTrash: Source | null = null;
  /** Open MERGE? confirm dialog — set when a drag ends on another instance of
   *  the SAME skill at the SAME tier (see `canStackMerge`). Survives the
   *  rebuild idiom exactly like `pendingTrash` (it IS a pending dialog): no
   *  init() in this scene, so it persists across a `rerender()`. */
  private pendingMerge: { target: MergeSource; dragged: MergeSource } | null = null;
  /** Deck piece instanceId whose gem-socket panel is open (survives restart —
   *  this scene deliberately has NO init(), mirroring `hold`/`pendingTrash`). */
  private socketFor: string | null = null;
  /** Bag slot index whose read-only card-detail overlay is open (tap on a BAG
   *  card that isn't a drag — survives restart, same convention as `socketFor`). */
  private bagDetailIndex: number | null = null;
  private layout!: ColLayout;
  private draggables: Array<{ token: CardToken; bounds: Phaser.Geom.Rectangle; src: Source }> = [];
  private heroStats!: ScalingStats;
  /** RUN CONTEXT ONLY — see `DesktopDeckBuildScene`'s identical field. */
  private runContext = false;
  private retireConfirmOpen = false;
  /** Uniform downward shift applied to every below-header y so run context's
   * taller HUD (kicker/title/stats/badge/actions) never collides with the
   * Sandbox's shorter tab-row header — same relative layout either way. */
  private get headerOffset(): number { return this.runContext ? TEMPLATE.regions.content.y - 50 : 0; }

  constructor() { super('MobileDeckBuild'); }

  /** State changed → rebuild this frame in place (see sceneRebuild.ts). */
  private rerender(): void {
    rebuildScene(this);
  }

  // ---------- data source (Sandbox demoState vs. the active run) ----------

  private get pieces(): OwnedBoardPiece[] { return this.runContext ? currentRunPieces() : demoState.pieces; }
  private set pieces(next: OwnedBoardPiece[]) { if (this.runContext) setCurrentRunPieces(next); else demoState.pieces = next; }
  private get bagSlots(): InventorySlot[] { return this.runContext ? currentRunBagSlots() : demoState.bagSlots; }
  private set bagSlots(next: InventorySlot[]) { if (this.runContext) setCurrentRunBagSlots(next); else demoState.bagSlots = next; }
  private get gemInventory(): string[] { return this.runContext ? currentRunGemInventory() : demoState.gemInventory; }
  private set gemInventory(next: string[]) { if (this.runContext) setCurrentRunGemInventory(next); else demoState.gemInventory = next; }
  private get heroLevel(): number { return this.runContext ? currentHeroLevel() : demoState.heroLevel; }
  private get heroAllocation() { return this.runContext ? currentHeroAllocation() : demoState.heroAllocation; }

  create(): void {
    this.W = SCREEN.width; this.H = SCREEN.height;
    this.draggables = [];
    this.runContext = getDeckBuildContext() === 'run';
    const hero = buildAutoHeroSetup(this.heroLevel, this.pieces.map((p) => ({ ...p })), this.heroAllocation).setup;
    this.heroStats = { attack: hero.stats.attack, magicPower: hero.stats.magicPower };
    this.cameras.main.setBackgroundColor(0x0b1420);
    if (this.runContext) this.renderHud(); else this.renderTabs();
    this.renderHeader();
    this.renderHolding();
    this.renderColumns();
    this.renderTrash();
    // wireDrag() resets ALL global input listeners — call it before any
    // overlay that registers its own (e.g. the socket panel's pouch scroll)
    // so those survive.
    this.wireDrag();
    if (this.pendingTrash) this.renderConfirm();
    if (this.pendingMerge) this.renderMergeConfirm();
    if (this.socketFor) this.renderSocketPanel();
    if (this.bagDetailIndex !== null) this.renderBagDetail();
    if (this.retireConfirmOpen) {
      renderRetireConfirm(this, {
        compact: true,
        onCancel: () => { this.retireConfirmOpen = false; this.rerender(); },
        onConfirm: () => { retireActiveRun(); this.scene.start('MobileRunMap'); },
      });
    }
  }

  /** THE run HUD — identical header on every run screen. ‹ MAP is this
   * screen's `back` role. */
  private renderHud(): void {
    const run = getActiveRun();
    if (!run) return;
    renderRunHud(this, {
      screen: 'DECK',
      compact: true,
      snapshot: snapshotRunProgress(run),
      actions: {
        back: { label: '‹ MAP', onPress: () => this.scene.start('MobileRunMap') },
        tertiary: { label: 'RETIRE', danger: true, onPress: () => { this.retireConfirmOpen = true; this.rerender(); } },
      },
    });
  }

  /** Manual pointer-drag: hit-test tokens ourselves (Phaser container-drag is
   *  unreliable). Drop resolves against columns / holding / trash. A TAP (< 8px
   *  of movement between down and up) on a DECK card opens the gem-socket
   *  panel instead of resolving as a drop. */
  private wireDrag(): void {
    this.input.removeAllListeners();
    let dragging: { token: CardToken; src: Source; home: { x: number; y: number } } | null = null;
    let dropHint: Phaser.GameObjects.Rectangle | null = null;
    let ghost: Phaser.GameObjects.Container | null = null;
    let totalMove = 0;
    let start = { x: 0, y: 0 };
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (this.pendingTrash || this.pendingMerge || this.socketFor || this.bagDetailIndex !== null) return; // dialog/panel owns input
      const hit = this.draggables.find((d) => d.bounds.contains(p.worldX, p.worldY));
      if (!hit) return;
      dragging = { token: hit.token, src: hit.src, home: { x: hit.token.x, y: hit.token.y } };
      totalMove = 0;
      start = { x: p.worldX, y: p.worldY };
      ghost = hit.token.spawnGhost(); // dimmed copy + dashed outline stays in the source slot
      hit.token.setDepth(1000).setAlpha(0.9);
      dropHint = this.add.rectangle(0, 0, 10, 10, 0xe8b446, 0.12).setOrigin(0, 0).setStrokeStyle(2, 0xe8b446, 0.9).setVisible(false).setDepth(900);
    });
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (!dragging) return;
      totalMove = Math.max(totalMove, Math.hypot(p.worldX - start.x, p.worldY - start.y));
      dragging.token.setPosition(p.worldX, p.worldY);
      // gold drop-target highlight (mockup "drop to place") on the hovered slot
      if (dropHint) {
        const { top, colH, colW, rowH, gap, deckX, bagX } = this.layout;
        if (p.worldY >= top && p.worldY <= top + colH) {
          const row = Math.max(0, Math.min(SLOTS - 1, Math.floor((p.worldY - top) / (rowH + gap))));
          const x = p.worldX >= bagX ? bagX : deckX;
          dropHint.setVisible(true).setPosition(x, top + row * (rowH + gap)).setSize(colW, rowH);
        } else dropHint.setVisible(false);
      }
    });
    this.input.on('pointerup', (p: Phaser.Input.Pointer) => {
      if (!dragging) return;
      const src = dragging.src;
      dragging = null;
      dropHint?.destroy(); dropHint = null;
      ghost?.destroy(); ghost = null;
      // A TAP (no real movement) on a DECK card opens its gem-socket panel;
      // on a BAG card it opens a read-only detail overlay (see totalMove
      // guard — mirrors the deck-card tap, so a real drag never triggers it).
      if (totalMove < 8 && src.where === 'deck') {
        playSfx('uiClick');
        this.socketFor = src.instanceId;
        this.rerender();
        return;
      }
      if (totalMove < 8 && src.where === 'bag') {
        playSfx('uiClick');
        this.bagDetailIndex = src.index;
        this.rerender();
        return;
      }
      this.resolveDrop(src, p.worldX, p.worldY);
      this.rerender(); // mutations applied above; re-render (snaps back if no move)
    });
  }

  private sizeOf(skillId: string): number { return Math.max(1, skillBook[skillId]?.size ?? 1); }

  // ---------- occupancy / placement ----------

  private deckOccupied(exclude?: string | string[]): boolean[] {
    const ex = new Set(Array.isArray(exclude) ? exclude : exclude !== undefined ? [exclude] : []);
    const occ = Array<boolean>(SLOTS).fill(false);
    for (const p of this.pieces) {
      if (ex.has(p.instanceId)) continue;
      const size = this.sizeOf(p.skillId);
      for (let i = p.slot; i < p.slot + size && i < SLOTS; i++) occ[i] = true;
    }
    return occ;
  }

  private bagOccupied(exclude?: number | number[]): boolean[] {
    const ex = new Set(Array.isArray(exclude) ? exclude : exclude !== undefined ? [exclude] : []);
    const occ = Array<boolean>(SLOTS).fill(false);
    this.bagSlots.forEach((card, index) => {
      if (!card || ex.has(index)) return;
      const size = this.sizeOf(card.skillId);
      for (let i = index; i < index + size && i < SLOTS; i++) occ[i] = true;
    });
    return occ;
  }

  /** The deck piece whose span covers `row`, if any. */
  private deckPieceAt(row: number): (typeof this.pieces)[number] | undefined {
    return this.pieces.find((p) => row >= p.slot && row < p.slot + this.sizeOf(p.skillId));
  }

  /** The bag entry whose span covers `row`, if any. */
  private bagEntryAt(row: number): { index: number; card: OwnedCard } | undefined {
    for (let i = 0; i < SLOTS; i++) {
      const card = this.bagSlots[i];
      if (!card) continue;
      if (row >= i && row < i + this.sizeOf(card.skillId)) return { index: i, card };
    }
    return undefined;
  }

  // ---------- moves (real demoState) ----------

  private removeSource(src: Source): void {
    if (src.where === 'deck') this.pieces = this.pieces.filter((p) => p.instanceId !== src.instanceId);
    else if (src.where === 'bag') this.bagSlots[src.index] = null;
    else this.hold = null;
  }

  private toHold(src: Source): boolean {
    if (this.hold) return false;
    this.removeSource(src);
    this.hold = { ...src.card };
    return true;
  }

  // ---------- render ----------

  private renderTabs(): void {
    const tabs: Array<[string, boolean, () => void]> = [
      ['MENU', false, () => this.scene.start('Start')],
      ['PREP', false, () => this.scene.start('MobilePrep')],
      ['DECK', true, () => {}],
      ['WIKI', false, () => this.scene.start('MobileWiki')],
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

  /** Mockup header meta: "LV 1 · HP 150 · ATK 12 · MATK 12 · SPD 12  ·  6/10 slots · PL 54 · 2 gems". */
  private renderHeader(): void {
    const used = this.deckOccupied().filter(Boolean).length;
    let plDeci = 0;
    for (const p of this.pieces) { const s = skillBook[p.skillId]; if (s) plDeci += instancePowerLevelDeci(s, { gem: p.gem ?? null }); }
    const gems = this.pieces.filter((p) => p.gem).length;
    const hero = buildAutoHeroSetup(this.heroLevel, this.pieces.map((p) => ({ ...p })), this.heroAllocation).setup;
    const s = hero.stats;
    const meta = `LV ${this.heroLevel} · ${STAT_TOKEN.maxHp} ${s.maxHp} · ${STAT_TOKEN.attack} ${s.attack} · ${STAT_TOKEN.magicPower} ${s.magicPower} · ${STAT_TOKEN.speed} ${s.speed}   ·   ${used}/${SLOTS} slots · PL ${(plDeci / 10).toFixed(0)} · ${gems} gem${gems === 1 ? '' : 's'}`;
    this.add.text(12, 50 + this.headerOffset, meta, { fontSize: `${F.small}px`, color: UI.textFootnote, fontFamily: FONT.body });
  }

  /** Dashed 1px border (the mockup's transfer/trash strip style). */
  private dashedRect(x: number, y: number, w: number, h: number, color: number, alpha = 0.9): void {
    const g = this.add.graphics();
    g.lineStyle(1, color, alpha);
    const dash = 5; const gapLen = 4;
    const seg = (x1: number, y1: number, x2: number, y2: number): void => {
      const len = Math.hypot(x2 - x1, y2 - y1);
      const ux = (x2 - x1) / len; const uy = (y2 - y1) / len;
      for (let s0 = 0; s0 < len; s0 += dash + gapLen) {
        const e = Math.min(s0 + dash, len);
        g.moveTo(x1 + ux * s0, y1 + uy * s0);
        g.lineTo(x1 + ux * e, y1 + uy * e);
      }
    };
    seg(x, y, x + w, y); seg(x + w, y, x + w, y + h); seg(x + w, y + h, x, y + h); seg(x, y + h, x, y);
    g.strokePath();
  }

  /** Slim TEMP HOLDING strip (mockup): dashed gold border · mini slot · label + grey sub. */
  private renderHolding(): void {
    const y = 66 + this.headerOffset; const h = 34; const w = this.W - 20;
    this.add.rectangle(10, y, w, h, 0x122033, 0.4).setOrigin(0, 0);
    this.dashedRect(10, y, w, h, 0xb78a46, this.hold ? 1 : 0.7);
    this.add.rectangle(18, y + 4, 24, h - 8, 0x16233a).setOrigin(0, 0).setStrokeStyle(1, 0x3a4a62, 0.9);
    if (this.hold) {
      const skill = skillBook[this.hold.skillId];
      if (skill) {
        const tok = new CardToken(this, 52 + 105, y + h / 2, skill, { width: 210, height: h - 6, side: 'left', deck: [skill], stats: this.heroStats });
        this.makeDraggable(tok, { where: 'hold', card: this.hold });
      }
      this.add.text(this.W - 16, y + h / 2, 'HOLDING', { fontSize: `${F.small}px`, color: '#c9a15a', fontFamily: FONT.body, fontStyle: 'bold' }).setOrigin(1, 0.5);
    } else {
      const label = this.add.text(52, y + h / 2, 'TEMP HOLDING', { fontSize: `${F.label}px`, color: '#c9a15a', fontFamily: FONT.body, fontStyle: 'bold' }).setOrigin(0, 0.5);
      this.add.text(label.x + label.width + 6, y + h / 2, '— drop a card to hold it while rearranging', { fontSize: `${F.tiny}px`, color: UI.textMuted, fontFamily: FONT.body }).setOrigin(0, 0.5);
    }
  }

  private renderColumns(): void {
    const top = 122 + this.headerOffset;
    const colH = this.H - top - 78;
    const colW = (this.W - 20 - 8) / 2;
    const gap = 5;
    const rowH = (colH - gap * (SLOTS - 1)) / SLOTS;
    const deckX = 10; const bagX = 10 + colW + 8;
    this.layout = { top, colH, colW, rowH, gap, deckX, bagX };

    const deckUsed = this.deckOccupied().filter(Boolean).length;
    const bagUsed = this.bagOccupied().filter(Boolean).length;
    this.add.text(deckX + colW / 2, top - 6, `ACTIVE DECK · ${deckUsed}/${SLOTS}`, { fontSize: `${F.small}px`, color: '#b78a46', fontFamily: FONT.body, fontStyle: 'bold' }).setOrigin(0.5, 1);
    this.add.text(bagX + colW / 2, top - 6, `BAG · ${bagUsed}/${SLOTS}`, { fontSize: `${F.small}px`, color: '#b78a46', fontFamily: FONT.body, fontStyle: 'bold' }).setOrigin(0.5, 1);

    const deckSkills = this.pieces.map((p) => skillBook[p.skillId]).filter((s): s is SkillDef => Boolean(s));
    const bagSkills = this.bagSlots.map((c) => (c ? skillBook[c.skillId] : undefined)).filter((s): s is SkillDef => Boolean(s));
    const rowTop = (row: number): number => top + row * (rowH + gap);
    const empty = (colX: number, row: number, side: 'left' | 'right'): void => {
      this.add.rectangle(colX + colW / 2, rowTop(row) + rowH / 2, colW, rowH, 0x121e30, 0.45).setOrigin(0.5).setStrokeStyle(1, 0x24344a, 0.9);
      const nx = side === 'left' ? colX + colW - 6 : colX + 6;
      this.add.text(nx, rowTop(row) + 4, `${row + 1}`, { fontSize: `${F.small}px`, color: UI.textMuted, fontFamily: 'monospace', fontStyle: 'bold' }).setOrigin(side === 'left' ? 1 : 0, 0);
    };

    // DECK (left)
    const deckOcc = this.deckOccupied();
    const deckBySlot = new Map(this.pieces.map((p) => [p.slot, p]));
    for (let row = 0; row < SLOTS; row++) {
      const piece = deckBySlot.get(row);
      if (piece) {
        const skill = skillBook[piece.skillId]!;
        const span = this.sizeOf(piece.skillId);
        const h = rowH * span + gap * (span - 1);
        const label = span > 1 ? `${row + 1}-${row + span}` : `${row + 1}`;
        const tok = new CardToken(this, deckX + colW / 2, rowTop(row) + h / 2, skill, {
          width: colW, height: h, side: 'left', slotLabel: label, deck: deckSkills, stats: this.heroStats,
          // Accessory rail (see cardTokenSpec.ts): socketed gem shows as a ◆ badge.
          accessories: piece.gem ? [{ label: '◆' }] : undefined,
        });
        this.makeDraggable(tok, { where: 'deck', instanceId: piece.instanceId, card: { instanceId: piece.instanceId, skillId: piece.skillId, tier: piece.tier } });
        row += span - 1;
      } else if (!deckOcc[row]) { empty(deckX, row, 'left'); }
    }

    // BAG (right)
    const bagOcc = this.bagOccupied();
    for (let row = 0; row < SLOTS; row++) {
      const card = this.bagSlots[row];
      if (card) {
        const skill = skillBook[card.skillId]!;
        const span = this.sizeOf(card.skillId);
        const h = rowH * span + gap * (span - 1);
        const label = span > 1 ? `${row + 1}-${row + span}` : `${row + 1}`;
        const tok = new CardToken(this, bagX + colW / 2, rowTop(row) + h / 2, skill, { width: colW, height: h, side: 'right', slotLabel: label, deck: bagSkills, stats: this.heroStats });
        this.makeDraggable(tok, { where: 'bag', index: row, card: { ...card } });
        row += span - 1;
      } else if (!bagOcc[row]) { empty(bagX, row, 'right'); }
    }

    // affinity pips under the deck column (mockup): "SWORD ■■■ — affinity"
    const id = boardTypeIdentity(deckSkills);
    const tally = new Map<string, number>();
    for (const s of deckSkills) {
      const t = cardType(s);
      if (t) tally.set(`${t.type}`, (tally.get(`${t.type}`) ?? 0) + 1);
    }
    let topType = ''; let topCount = 0;
    for (const [k, v] of tally) if (v > topCount) { topType = k; topCount = v; }
    const py = top + colH + 8;
    const pipLabel = id ? id.type.toUpperCase() : topType ? topType.toUpperCase() : 'NO TYPE';
    const label = this.add.text(deckX + colW / 2 - 30, py, pipLabel, { fontSize: `${F.small}px`, color: id ? '#e8b446' : UI.textBright, fontFamily: FONT.body, fontStyle: 'bold' }).setOrigin(1, 0.5);
    for (let i = 0; i < 3; i++) {
      const filled = i < Math.min(3, topCount);
      this.add.rectangle(label.x + 8 + i * 13, py, 9, 9, filled ? 0xb78a46 : 0x16233a).setOrigin(0, 0.5).setStrokeStyle(1, 0x3a4a62, 1);
    }
    this.add.text(label.x + 8 + 3 * 13 + 6, py, id ? 'affinity' : '3 to unlock', { fontSize: `${F.tiny}px`, color: UI.textMuted, fontFamily: FONT.body }).setOrigin(0, 0.5);
  }

  /** Slim TRASH strip (mockup): dashed red border · label + grey sub. No emoji (canvas tofu). */
  private renderTrash(): void {
    const y = this.H - 44; const h = 34; const w = this.W - 20;
    this.add.rectangle(10, y, w, h, 0x2a1412, 0.4).setOrigin(0, 0);
    this.dashedRect(10, y, w, h, 0xb0483c, 0.9);
    const label = this.add.text(52, y + h / 2, 'TRASH', { fontSize: `${F.label}px`, color: '#d05c4e', fontFamily: FONT.body, fontStyle: 'bold' }).setOrigin(0, 0.5);
    this.add.rectangle(18, y + 4, 24, h - 8, 0x1c0f0d).setOrigin(0, 0).setStrokeStyle(1, 0x7a4a42, 0.9);
    this.add.text(label.x + label.width + 6, y + h / 2, '— drop to destroy (asks to confirm)', { fontSize: `${F.tiny}px`, color: UI.textMuted, fontFamily: FONT.body }).setOrigin(0, 0.5);
  }

  // ---------- drag ----------

  private makeDraggable(tok: CardToken, src: Source): void {
    this.draggables.push({ token: tok, bounds: new Phaser.Geom.Rectangle(tok.x - tok.width / 2, tok.y - tok.height / 2, tok.width, tok.height), src });
  }

  private resolveDrop(src: Source, px: number, py: number): void {
    // TRASH strip (bottom)
    if (py >= this.H - 48) { this.pendingTrash = src; return; }
    // TEMP HOLDING strip (top)
    if (py >= 62 && py < 104) { this.toHold(src); return; }
    const { top, colH, rowH, gap, bagX } = this.layout;
    if (py < top || py > top + colH) return; // dropped nowhere valid → snaps back
    const row = Math.max(0, Math.min(SLOTS - 1, Math.floor((py - top) / (rowH + gap))));
    const where: 'deck' | 'bag' = px >= bagX ? 'bag' : 'deck';

    // Stack-merge check: dropping on ANOTHER instance of the same skill at the
    // same tier PROMPTS a merge instead of resolving the ordinary move/swap —
    // never silent (see `canStackMerge`). TEMP HOLDING is excluded on both
    // sides (a merge target/drag must be a deck or bag occupant).
    if (src.where !== 'hold') {
      const occupant: MergeSource | undefined = where === 'deck'
        ? this.deckOccupantAsSource(row)
        : this.bagOccupantAsSource(row);
      if (occupant && canStackMerge(occupant.card, src.card)) {
        this.pendingMerge = { target: occupant, dragged: src };
        return;
      }
    }

    if (where === 'bag') this.toBag(src, row); else this.toDeck(src, row);
  }

  /** The deck occupant covering `row`, reshaped as a `MergeSource` (or
   *  `undefined` if the row is empty) — for the stack-merge check only. */
  private deckOccupantAsSource(row: number): MergeSource | undefined {
    const piece = this.deckPieceAt(row);
    if (!piece) return undefined;
    return { where: 'deck', instanceId: piece.instanceId, card: { instanceId: piece.instanceId, skillId: piece.skillId, tier: piece.tier } };
  }

  /** The bag occupant covering `row`, reshaped as a `MergeSource` (or
   *  `undefined` if the row is empty) — for the stack-merge check only. */
  private bagOccupantAsSource(row: number): MergeSource | undefined {
    const entry = this.bagEntryAt(row);
    if (!entry) return undefined;
    return { where: 'bag', index: entry.index, card: entry.card };
  }

  /** Insert into the deck, shifting existing spans instead of swapping. */
  private toDeck(src: Source, preferRow: number): boolean {
    const size = this.sizeOf(src.card.skillId);
    const sourcePiece = src.where === 'deck'
      ? this.pieces.find((p) => p.instanceId === src.instanceId)
      : undefined;
    if (src.where === 'deck' && sourcePiece) {
      const others = this.pieces.filter((p) => p.instanceId !== src.instanceId)
        .map((p) => ({ id: p.instanceId, start: p.slot, size: this.sizeOf(p.skillId) }));
      const plan = moveWithinStrip(others, size, sourcePiece.slot, preferRow, SLOTS);
      if (!plan) return false;
      this.pieces = this.pieces
        .filter((p) => p.instanceId !== src.instanceId)
        .map((p) => { const moved = plan.moved.find((item) => item.id === p.instanceId); return moved ? { ...p, slot: moved.start } : p; })
        .concat({ ...sourcePiece, slot: plan.movedStart })
        .sort((a, b) => a.slot - b.slot);
      return true;
    }
    const others = this.pieces.map((p) => ({ id: p.instanceId, start: p.slot, size: this.sizeOf(p.skillId) }));
    const plan = shiftInsert(others, size, preferRow, SLOTS);
    if (!plan) return false;
    this.removeSource(src);
    this.pieces = this.pieces
      .map((p) => { const moved = plan.moved.find((item) => item.id === p.instanceId); return moved ? { ...p, slot: moved.start } : p; })
      .concat({ instanceId: src.card.instanceId, skillId: src.card.skillId, tier: src.card.tier, slot: plan.movedStart })
      .sort((a, b) => a.slot - b.slot);
    return true;
  }

  /** Insert into the bag, shifting existing spans instead of swapping. */
  private toBag(src: Source, preferRow: number): boolean {
    const size = this.sizeOf(src.card.skillId);
    if (src.where === 'bag') {
      const origin = src.index;
      const others = this.bagSlots.flatMap((card, index) => card && index !== origin
        ? [{ id: String(index), start: index, size: this.sizeOf(card.skillId) }] : []);
      const plan = moveWithinStrip(others, size, origin, preferRow, SLOTS);
      if (!plan) return false;
      const cards = this.bagSlots.map((card, index) => ({ card, index })).filter((item) => item.index !== origin);
      const next: Array<OwnedCard | null> = Array(SLOTS).fill(null);
      for (const item of cards) {
        const moved = plan.moved.find((entry) => entry.id === String(item.index));
        if (moved) next[moved.start] = item.card;
      }
      next[plan.movedStart] = src.card;
      this.bagSlots = next;
      return true;
    }
    const others = this.bagSlots.flatMap((card, index) => card
      ? [{ id: String(index), start: index, size: this.sizeOf(card.skillId) }] : []);
    const plan = shiftInsert(others, size, preferRow, SLOTS);
    if (!plan) return false;
    this.removeSource(src);
    const next: Array<OwnedCard | null> = Array(SLOTS).fill(null);
    for (const item of this.bagSlots) {
      if (!item) continue;
      const index = this.bagSlots.indexOf(item);
      const moved = plan.moved.find((entry) => entry.id === String(index));
      if (moved) next[moved.start] = item;
    }
    next[plan.movedStart] = { ...src.card };
    this.bagSlots = next;
    return true;
  }

  private renderConfirm(): void {
    const src = this.pendingTrash!;
    const skill = skillBook[src.card.skillId];
    this.add.rectangle(0, 0, this.W, this.H, 0x05070c, 0.72).setOrigin(0, 0).setInteractive();
    const bw = this.W - 60; const bx = 30; const by = this.H / 2 - 70;
    this.add.rectangle(bx, by, bw, 140, 0x141d2c).setOrigin(0, 0).setStrokeStyle(2, 0xd05c4e);
    this.add.text(this.W / 2, by + 24, `Delete ${skill?.name ?? 'card'}?`, { fontSize: `${F.heading}px`, color: UI.textBright, fontFamily: FONT.display, fontStyle: 'bold' }).setOrigin(0.5);
    this.add.text(this.W / 2, by + 50, 'This removes it from your collection.', { fontSize: `${F.small}px`, color: UI.textFootnote, fontFamily: FONT.body }).setOrigin(0.5);
    const mk = (dx: number, w: number, label: string, fill: number, color: string, fn: () => void): void => {
      const r = this.add.rectangle(dx, by + 88, w, 36, fill).setOrigin(0, 0).setStrokeStyle(1, UI.border, 0.7).setInteractive({ useHandCursor: true });
      r.on('pointerdown', fn);
      this.add.text(dx + w / 2, by + 106, label, { fontSize: `${F.name}px`, color, fontFamily: FONT.body, fontStyle: 'bold' }).setOrigin(0.5);
    };
    mk(bx + 16, (bw - 40) / 2, 'CANCEL', 0x1b2940, UI.textBright, () => { playSfx('uiBack'); this.pendingTrash = null; this.rerender(); });
    mk(bx + 24 + (bw - 40) / 2, (bw - 40) / 2, 'DELETE', 0x7a2e2a, '#ffffff', () => { playSfx('uiClick'); this.removeSource(src); this.pendingTrash = null; this.rerender(); });
  }

  /** "MERGE? 2× <NAME> <TIER> → <NEXT TIER>" — CANCEL returns the dragged card
   *  home (nothing was mutated on drop, so a re-render alone restores it,
   *  exactly like `renderConfirm`'s CANCEL); MERGE applies `stackMergePieces`
   *  through the pieces/bagSlots/gemInventory setters. */
  private renderMergeConfirm(): void {
    const { target } = this.pendingMerge!;
    const skill = skillBook[target.card.skillId];
    const fromTier = target.card.tier;
    const toTier = nextSkillTier(fromTier);
    this.add.rectangle(0, 0, this.W, this.H, 0x05070c, 0.72).setOrigin(0, 0).setInteractive();
    const bw = this.W - 60; const bx = 30; const by = this.H / 2 - 70;
    this.add.rectangle(bx, by, bw, 140, 0x141d2c).setOrigin(0, 0).setStrokeStyle(2, 0xb78a46);
    this.add.text(this.W / 2, by + 16, 'MERGE?', { fontSize: `${F.heading}px`, color: '#e8b446', fontFamily: FONT.display, fontStyle: 'bold' }).setOrigin(0.5);
    this.add.text(this.W / 2, by + 42, `2× ${skill?.name ?? 'card'} ${fromTier.toUpperCase()} → ${(toTier ?? fromTier).toUpperCase()}`, {
      fontSize: `${F.small}px`, color: UI.textFootnote, fontFamily: FONT.body, align: 'center', wordWrap: { width: bw - 24 },
    }).setOrigin(0.5);
    const mk = (dx: number, w: number, label: string, fill: number, color: string, fn: () => void): void => {
      const r = this.add.rectangle(dx, by + 88, w, 36, fill).setOrigin(0, 0).setStrokeStyle(1, UI.border, 0.7).setInteractive({ useHandCursor: true });
      r.on('pointerdown', fn);
      this.add.text(dx + w / 2, by + 106, label, { fontSize: `${F.name}px`, color, fontFamily: FONT.body, fontStyle: 'bold' }).setOrigin(0.5);
    };
    mk(bx + 16, (bw - 40) / 2, 'CANCEL', 0x1b2940, UI.textBright, () => { playSfx('uiBack'); this.pendingMerge = null; this.rerender(); });
    mk(bx + 24 + (bw - 40) / 2, (bw - 40) / 2, 'MERGE', 0xb78a46, UI.textOnChip, () => { playSfx('uiClick'); this.applyMerge(); });
  }

  /** The live gem (if any) currently socketed on a merge participant — only a
   *  DECK piece can carry one (bag cards have no `gem` field in this model),
   *  so this looks past `MergeSource.card` (which omits `gem`, see
   *  `makeDraggable`'s deck entry) to the actual live piece in `this.pieces`. */
  private liveGemOf(ref: MergeSource): Gem | null {
    if (ref.where !== 'deck') return null;
    return this.pieces.find((p) => p.instanceId === ref.instanceId)?.gem ?? null;
  }

  /** Applies the pending stack merge through `run/loadout.ts`'s pure
   *  `stackMergePieces`: the target climbs a tier keeping its own gem; the
   *  dragged copy is removed and its gem (if any) returns to the pouch. */
  private applyMerge(): void {
    const pending = this.pendingMerge;
    this.pendingMerge = null;
    if (pending) {
      const { target, dragged } = pending;
      const draggedGem = this.liveGemOf(dragged);
      if (target.where === 'deck') {
        const live = this.pieces.find((p) => p.instanceId === target.instanceId);
        const result = live ? stackMergePieces(live, { ...dragged.card, gem: draggedGem }) : null;
        if (result) {
          this.removeSource(dragged);
          this.pieces = this.pieces.map((p) => (p.instanceId === target.instanceId ? result.merged : p));
          if (result.displacedGem) this.gemInventory = [...this.gemInventory, result.displacedGem.id];
        }
      } else {
        const live = this.bagSlots[target.index];
        const result = live ? stackMergePieces(live, { ...dragged.card, gem: draggedGem }) : null;
        if (result) {
          this.removeSource(dragged);
          this.bagSlots = this.bagSlots.map((c, i) => (i === target.index ? result.merged : c));
          if (result.displacedGem) this.gemInventory = [...this.gemInventory, result.displacedGem.id];
        }
      }
    }
    this.rerender();
  }

  /**
   * Read-only BAG card detail (opened by a non-drag TAP on a bag card — see
   * the `totalMove < 8` guard in `wireDrag`). Same veil + big-card + CLOSE
   * idiom as the Wiki's card detail overlay, but info-only (no ADD/tier
   * chips — this card is already owned) plus a glossary entry for every
   * abbreviation/keyword the card uses.
   */
  private renderBagDetail(): void {
    const index = this.bagDetailIndex;
    if (index === null) return;
    const card = this.bagSlots[index];
    if (!card) { this.bagDetailIndex = null; return; }
    const skill = skillBook[card.skillId];
    if (!skill) { this.bagDetailIndex = null; return; }

    // No explicit depths here (matches this scene's other overlays —
    // `renderConfirm`/`renderSocketPanel` — which rely on add-ORDER, not
    // depth, for stacking): everything below is added after the veil, so it
    // draws on top without needing its own depth (and `renderCardInfoBox`'s
    // internal text/mask objects, which don't set a depth, stay reachable).
    const close = (): void => { this.bagDetailIndex = null; this.rerender(); };
    const veil = this.add.rectangle(0, 0, this.W, this.H, 0x05070c, 0.88).setOrigin(0, 0).setInteractive();
    veil.on('pointerdown', () => { playSfx('uiBack'); close(); });

    const closeBtn = this.add.rectangle(this.W - 30, 46, 28, 28, 0x24344a, 1)
      .setOrigin(0.5).setStrokeStyle(1, 0x8a94a6, 0.8).setInteractive({ useHandCursor: true });
    this.add.text(closeBtn.x, closeBtn.y, '×', { fontSize: `${F.xlarge}px`, color: UI.textBright, fontFamily: FONT.body, fontStyle: 'bold' }).setOrigin(0.5);
    closeBtn.on('pointerdown', (_p: Phaser.Input.Pointer, _lx: number, _ly: number, event: Phaser.Types.Input.EventData) => {
      event.stopPropagation(); playSfx('uiBack'); close();
    });

    const paneWidth = this.W - 40;
    const centerX = this.W / 2;
    const cardW = 140;
    const cardH = cardW * (690 / 420);
    let y = 66;
    const cardY = y + cardH / 2;
    new FantasyCardTemplateV2(this, centerX, cardY, skill, { width: cardW, height: cardH, tier: skill.tier, glossary: false });
    y = cardY + cardH / 2 + 10;

    const name = this.add.text(centerX, y, skill.name, {
      fontFamily: FONT.display, fontStyle: 'bold', fontSize: `${F.heading}px`, color: UI.textBright,
      align: 'center', wordWrap: { width: paneWidth },
    }).setOrigin(0.5, 0);
    y += name.height + 4;

    const plDeci = powerLevelDeci(skill);
    const plLine = this.add.text(centerX, y, `POWER ${(plDeci / 10).toFixed(0)} · ${skill.tier.toUpperCase()}`, {
      fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${F.label}px`, color: '#e8b446',
    }).setOrigin(0.5, 0);
    addHoverTipZone(this, { x: plLine.x - plLine.width / 2, y: plLine.y, w: plLine.width, h: plLine.height }, [powerLevelEntry()]);
    y += plLine.height + 10;

    // Full skill text + a glossary entry for every abbreviation/keyword the
    // card uses — scrollable (see `renderCardInfoBox`) so it never runs off
    // the bottom of the overlay regardless of how much a card's kit prints.
    const infoTop = y;
    const infoH = this.H - infoTop - 20;
    this.add.rectangle(centerX - paneWidth / 2, infoTop, paneWidth, infoH, 0x101a2a, 0.6).setOrigin(0, 0).setStrokeStyle(1, UI.border, 0.5);
    renderCardInfoBox(this, centerX - paneWidth / 2, infoTop, paneWidth, infoH, skill);
  }

  /**
   * Gem-socket panel for one deck piece (opened by TAPPING a deck card).
   * Every card has one socket: shows the current gem with UNSOCKET, and the
   * pouch inventory with SOCKET/SWAP. run/loadout's socketGem/swapGem/
   * unsocketGem are pure — each returns the new piece rather than mutating
   * `piece`, so every action here splices that new piece back into
   * `this.pieces` (through the setter, so run-context persistence still
   * fires); displaced gems return to `this.gemInventory`. The pouch list is
   * masked + drag/wheel scrollable so an overflowing pouch never draws
   * off-canvas.
   */
  private renderSocketPanel(): void {
    const piece = this.pieces.find((p) => p.instanceId === this.socketFor);
    if (!piece) { this.socketFor = null; return; }
    const skill = skillBook[piece.skillId];
    if (!skill) { this.socketFor = null; return; }

    const close = (): void => { this.socketFor = null; this.rerender(); };
    const scrim = this.add.rectangle(0, 0, this.W, this.H, 0x05070c, 0.78).setOrigin(0, 0).setInteractive();
    scrim.on('pointerdown', () => { playSfx('uiBack'); close(); });

    const pouch = this.gemInventory.map((id) => gemBook[id]).filter((g): g is NonNullable<typeof g> => Boolean(g));
    const pw = this.W - 24;
    const px = 12;
    const rowH = 58;
    const rowGap = 8;
    // Fixed-height "what this card does" block (see `renderCardInfoBox`) —
    // scrollable, so a keyword-heavy card never grows the panel.
    const INFO_H = 108;
    const headerH = (piece.gem ? 128 : 92) + INFO_H + 12;
    const footerPad = 14;
    const maxPanelH = this.H - 56;
    const maxListH = Math.max(rowH, maxPanelH - headerH - footerPad);
    const contentH = Math.max(rowH, pouch.length * (rowH + rowGap) - rowGap);
    const listH = Math.min(contentH, maxListH);
    const ph = Math.min(maxPanelH, headerH + listH + footerPad);
    const py = Math.max(20, (this.H - ph) / 2);
    this.add.rectangle(px, py, pw, ph, 0x141d2c, 0.98).setOrigin(0, 0).setStrokeStyle(2, UI.border, 1).setInteractive();

    const basePl = (instancePowerLevelDeci(skill, { gem: null }) / 10).toFixed(0);
    const totalPl = (instancePowerLevelDeci(skill, { gem: piece.gem ?? null }) / 10).toFixed(0);
    this.add.text(px + 14, py + 12, `${skill.name.toUpperCase()} — GEM SOCKET`, { fontSize: `${F.name}px`, color: '#e8b446', fontFamily: FONT.display, fontStyle: 'bold' });
    this.add.text(px + pw - 14, py + 14, 'tap outside to close', { fontSize: `${F.tiny}px`, color: UI.textMuted, fontFamily: FONT.body }).setOrigin(1, 0);

    // Card info block: full skill text + a glossary entry for every
    // abbreviation the card face uses (drag/wheel-scrollable if it overflows).
    const infoTop = py + 30;
    this.add.text(px + 14, infoTop - 12, 'CARD INFO', { fontSize: `${F.tiny}px`, color: UI.textMuted, fontFamily: FONT.body, fontStyle: 'bold' });
    this.add.rectangle(px + 14, infoTop, pw - 28, INFO_H, 0x101a2a, 0.7).setOrigin(0, 0).setStrokeStyle(1, UI.border, 0.5);
    renderCardInfoBox(this, px + 14, infoTop, pw - 28, INFO_H, skill);

    // Current socket row.
    const curY = infoTop + INFO_H + 12;
    this.add.rectangle(px + 14, curY, pw - 28, 48, 0x101a2a, 0.85).setOrigin(0, 0)
      .setStrokeStyle(1, piece.gem ? GEM_RARITY_COLOR[piece.gem.rarity] : UI.border, 0.9);
    if (piece.gem) {
      const gem = piece.gem;
      // The engine's structural Gem has no display name/text — resolve via the catalog.
      const gemDef = gemBook[gem.id];
      const bonus = gemDef ? stripCardTextMarkup(gemDef.text) : '';
      this.add.rectangle(px + 30, curY + 24, 11, 11, GEM_RARITY_COLOR[gem.rarity]).setOrigin(0.5).setAngle(45);
      this.add.text(px + 42, curY + 6, `${gemDef?.name ?? gem.id}`, { fontSize: `${F.label}px`, color: UI.textBright, fontFamily: FONT.body, fontStyle: 'bold' });
      const bonusT = this.add.text(px + 42, curY + 20, bonus, { fontSize: `${F.tiny}px`, color: '#e8b446', fontFamily: FONT.body, wordWrap: { width: pw - 175 } });
      let s = bonus;
      while (s.length > 1 && bonusT.height > 12) { s = s.slice(0, -1); bonusT.setText(`${s}…`); }
      const plLine = this.add.text(px + 42, curY + 34, `POWER ${totalPl} · card ${basePl} + gem ${gemPowerLevel(gem)}`, { fontSize: `${F.tiny}px`, color: UI.textMuted, fontFamily: FONT.body });
      addHoverTipZone(this, { x: plLine.x, y: plLine.y, w: plLine.width, h: plLine.height }, [powerLevelEntry()]);
      if (gemDef) addHoverTipZone(this, { x: px + 14, y: curY, w: pw - 28, h: 32 }, [gemHoverEntry(gemDef)]);
      const un = this.add.rectangle(px + pw - 88, curY + 8, 74, 32, 0x352019).setOrigin(0, 0).setStrokeStyle(1, UI.bad, 0.8).setInteractive({ useHandCursor: true });
      this.add.text(px + pw - 51, curY + 24, 'UNSOCKET', { fontSize: `${F.tiny}px`, color: UI.textBright, fontFamily: FONT.body, fontStyle: 'bold' }).setOrigin(0.5);
      un.on('pointerdown', () => {
        playSfx('uiClick');
        const { piece: updated, gem: removed } = unsocketGem(piece);
        this.pieces = this.pieces.map((p) => (p.instanceId === piece.instanceId ? updated : p));
        if (removed) this.gemInventory = [...this.gemInventory, removed.id];
        close();
      });
    } else {
      const emptyLine = this.add.text(px + 28, curY + 24, `Empty socket · POWER ${basePl}`, { fontSize: `${F.small}px`, color: UI.textMuted, fontFamily: FONT.body }).setOrigin(0, 0.5);
      addHoverTipZone(this, { x: emptyLine.x, y: emptyLine.y - emptyLine.height / 2, w: emptyLine.width, h: emptyLine.height }, [powerLevelEntry()]);
    }

    // Pouch list — masked, drag/wheel scrollable.
    const listTop = curY + 48 + 14;
    this.add.text(px + 14, listTop - 12, `GEM POUCH · ${pouch.length}`, { fontSize: `${F.tiny}px`, color: UI.textMuted, fontFamily: FONT.body, fontStyle: 'bold' });
    if (pouch.length === 0) {
      this.add.text(px + 14, listTop + 8, 'No gems in the pouch — collect some\nin the WIKI › GEMS tab.', {
        fontSize: `${F.tiny}px`, color: UI.textMuted, fontFamily: FONT.body, lineSpacing: 3,
      });
      return;
    }

    const maskShape = this.make.graphics({}, false);
    maskShape.fillStyle(0xffffff);
    maskShape.fillRect(px + 14, listTop, pw - 28, listH);
    const mask = maskShape.createGeometryMask();

    let scrollY = 0;
    const maxScroll = Math.max(0, contentH - listH);
    const rowContainers: Phaser.GameObjects.Container[] = [];
    pouch.forEach((gem, index) => {
      const baseY = index * (rowH + rowGap);
      const container = this.add.container(px + 14, listTop + baseY);
      const bg = this.add.rectangle(0, 0, pw - 28, rowH, 0x101a2a, 0.9).setOrigin(0, 0).setStrokeStyle(1, UI.border, 0.5);
      const diamond = this.add.rectangle(16, rowH / 2, 11, 11, GEM_RARITY_COLOR[gem.rarity]).setOrigin(0.5).setAngle(45);
      const name = this.add.text(30, 8, `${gem.name} · ${gem.rarity.toUpperCase()}`, { fontSize: `${F.small}px`, color: UI.textBright, fontFamily: FONT.body, fontStyle: 'bold' });
      // The bonus itself is the headline info (PL is bookkeeping — see WIKI).
      const desc = this.add.text(30, 24, stripCardTextMarkup(gem.text), { fontSize: `${F.tiny}px`, color: '#e8b446', fontFamily: FONT.body, fontStyle: 'bold', wordWrap: { width: pw - 28 - 100 } });
      let s = stripCardTextMarkup(gem.text);
      while (s.length > 1 && desc.height > 24) { s = s.slice(0, -1); desc.setText(`${s}…`); }
      const hoverZone = this.add.rectangle(0, 0, pw - 28, rowH, 0xffffff, 0.001).setOrigin(0, 0).setInteractive({ useHandCursor: true });
      attachHoverTip(this, hoverZone, { x: px + 14, y: listTop + baseY, w: pw - 28, h: rowH }, [gemHoverEntry(gem)]);
      const act = this.add.rectangle(pw - 28 - 66, rowH / 2 - 14, 60, 28, 0xb78a46).setOrigin(0, 0).setStrokeStyle(1, UI.border, 0.9).setInteractive({ useHandCursor: true });
      const actLabel = this.add.text(pw - 28 - 36, rowH / 2, piece.gem ? 'SWAP' : 'SOCKET', { fontSize: `${F.tiny}px`, color: UI.textOnChip, fontFamily: FONT.body, fontStyle: 'bold' }).setOrigin(0.5);
      act.on('pointerdown', () => {
        playSfx('uiClick');
        // consume ONE copy of this gem id from the pouch
        const at = this.gemInventory.indexOf(gem.id);
        if (at >= 0) this.gemInventory = this.gemInventory.filter((_, i) => i !== at);
        let updated = piece;
        let displaced: typeof piece.gem | null = null;
        if (piece.gem) {
          const result = swapGem(piece, gem);
          updated = result.piece;
          displaced = result.displaced;
        } else {
          updated = socketGem(piece, gem) ?? piece;
        }
        this.pieces = this.pieces.map((p) => (p.instanceId === piece.instanceId ? updated : p));
        if (displaced) this.gemInventory = [...this.gemInventory, displaced.id];
        close();
      });
      container.add([bg, diamond, name, desc, hoverZone, act, actLabel]);
      container.setMask(mask);
      rowContainers.push(container);
    });

    if (maxScroll > 0) {
      let dragging = false;
      let startY = 0;
      let startScroll = 0;
      const inList = (x: number, y: number): boolean => x >= px + 14 && x <= px + 14 + (pw - 28) && y >= listTop && y <= listTop + listH;
      this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
        if (!inList(p.worldX, p.worldY)) return;
        dragging = true; startY = p.worldY; startScroll = scrollY;
      });
      this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
        if (!dragging) return;
        scrollY = Phaser.Math.Clamp(startScroll + (p.worldY - startY), -maxScroll, 0);
        rowContainers.forEach((c, i) => c.setY(listTop + scrollY + i * (rowH + rowGap)));
      });
      this.input.on('pointerup', () => { dragging = false; });
      this.input.on('wheel', (pointer: Phaser.Input.Pointer, _o: unknown, _dx: number, dy: number) => {
        if (!inList(pointer.worldX, pointer.worldY)) return;
        scrollY = Phaser.Math.Clamp(scrollY - dy, -maxScroll, 0);
        rowContainers.forEach((c, i) => c.setY(listTop + scrollY + i * (rowH + rowGap)));
      });
    }
  }
}
