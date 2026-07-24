import Phaser from 'phaser';
import { skillBook } from '../../data/skills';
import { instancePowerLevelDeci } from '../../engine/balance';
import { boardTypeIdentity, cardType } from '../../engine/combat/typeIdentity';
import type { SkillDef } from '../../engine/types';
import { buildAutoHeroSetup } from '../../run/encounter';
import { moveWithinStrip, shiftInsert } from '../../run/loadout';
import { demoState, type OwnedCard } from '../demoState';
import { FONT, SCREEN, UI } from '../theme';
import { CardToken } from '../ui/CardToken';
import type { ScalingStats } from '../ui/skillPresentation';

const SLOTS = 10;

type Source =
  | { where: 'deck'; instanceId: string; card: OwnedCard }
  | { where: 'bag'; index: number; card: OwnedCard }
  | { where: 'hold'; card: OwnedCard };

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
  private layout!: ColLayout;
  private draggables: Array<{ token: CardToken; bounds: Phaser.Geom.Rectangle; src: Source }> = [];
  private heroStats!: ScalingStats;

  constructor() { super('MobileDeckBuild'); }

  create(): void {
    this.W = SCREEN.width; this.H = SCREEN.height;
    this.draggables = [];
    const hero = buildAutoHeroSetup(demoState.heroLevel, demoState.pieces.map((p) => ({ ...p })), demoState.heroAllocation).setup;
    this.heroStats = { attack: hero.stats.attack, magicPower: hero.stats.magicPower };
    this.cameras.main.setBackgroundColor(0x0b1420);
    this.renderTabs();
    this.renderHeader();
    this.renderHolding();
    this.renderColumns();
    this.renderTrash();
    if (this.pendingTrash) this.renderConfirm();
    this.wireDrag();
  }

  /** Manual pointer-drag: hit-test tokens ourselves (Phaser container-drag is
   *  unreliable). Drop resolves against columns / holding / trash. */
  private wireDrag(): void {
    this.input.removeAllListeners();
    let dragging: { token: CardToken; src: Source; home: { x: number; y: number } } | null = null;
    let dropHint: Phaser.GameObjects.Rectangle | null = null;
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (this.pendingTrash) return; // confirm dialog owns input
      const hit = this.draggables.find((d) => d.bounds.contains(p.x, p.y));
      if (!hit) return;
      dragging = { token: hit.token, src: hit.src, home: { x: hit.token.x, y: hit.token.y } };
      hit.token.setDepth(1000).setAlpha(0.9);
      dropHint = this.add.rectangle(0, 0, 10, 10, 0xe8b446, 0.12).setOrigin(0, 0).setStrokeStyle(2, 0xe8b446, 0.9).setVisible(false).setDepth(900);
    });
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (!dragging) return;
      dragging.token.setPosition(p.x, p.y);
      // gold drop-target highlight (mockup "drop to place") on the hovered slot
      if (dropHint) {
        const { top, colH, colW, rowH, gap, deckX, bagX } = this.layout;
        if (p.y >= top && p.y <= top + colH) {
          const row = Math.max(0, Math.min(SLOTS - 1, Math.floor((p.y - top) / (rowH + gap))));
          const x = p.x >= bagX ? bagX : deckX;
          dropHint.setVisible(true).setPosition(x, top + row * (rowH + gap)).setSize(colW, rowH);
        } else dropHint.setVisible(false);
      }
    });
    this.input.on('pointerup', (p: Phaser.Input.Pointer) => {
      if (!dragging) return;
      const src = dragging.src;
      dragging = null;
      dropHint?.destroy(); dropHint = null;
      this.resolveDrop(src, p.x, p.y);
      this.scene.restart(); // mutations applied above; re-render (snaps back if no move)
    });
  }

  private sizeOf(skillId: string): number { return Math.max(1, skillBook[skillId]?.size ?? 1); }

  // ---------- occupancy / placement ----------

  private deckOccupied(exclude?: string | string[]): boolean[] {
    const ex = new Set(Array.isArray(exclude) ? exclude : exclude !== undefined ? [exclude] : []);
    const occ = Array<boolean>(SLOTS).fill(false);
    for (const p of demoState.pieces) {
      if (ex.has(p.instanceId)) continue;
      const size = this.sizeOf(p.skillId);
      for (let i = p.slot; i < p.slot + size && i < SLOTS; i++) occ[i] = true;
    }
    return occ;
  }

  private bagOccupied(exclude?: number | number[]): boolean[] {
    const ex = new Set(Array.isArray(exclude) ? exclude : exclude !== undefined ? [exclude] : []);
    const occ = Array<boolean>(SLOTS).fill(false);
    demoState.bagSlots.forEach((card, index) => {
      if (!card || ex.has(index)) return;
      const size = this.sizeOf(card.skillId);
      for (let i = index; i < index + size && i < SLOTS; i++) occ[i] = true;
    });
    return occ;
  }

  /** The deck piece whose span covers `row`, if any. */
  private deckPieceAt(row: number): (typeof demoState.pieces)[number] | undefined {
    return demoState.pieces.find((p) => row >= p.slot && row < p.slot + this.sizeOf(p.skillId));
  }

  /** The bag entry whose span covers `row`, if any. */
  private bagEntryAt(row: number): { index: number; card: OwnedCard } | undefined {
    for (let i = 0; i < SLOTS; i++) {
      const card = demoState.bagSlots[i];
      if (!card) continue;
      if (row >= i && row < i + this.sizeOf(card.skillId)) return { index: i, card };
    }
    return undefined;
  }

  // ---------- moves (real demoState) ----------

  private removeSource(src: Source): void {
    if (src.where === 'deck') demoState.pieces = demoState.pieces.filter((p) => p.instanceId !== src.instanceId);
    else if (src.where === 'bag') demoState.bagSlots[src.index] = null;
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
      ['PREP', false, () => this.scene.start('MobilePrep')],
      ['DECK BUILD', true, () => {}],
      ['WIKI', false, () => this.scene.start('MobileWiki')],
    ];
    const w = (this.W - 20 - 12) / 3;
    tabs.forEach(([label, active, fn], i) => {
      const r = this.add.rectangle(10 + i * (w + 6), 8, w, 34, active ? 0xb78a46 : 0x131f32).setOrigin(0, 0).setStrokeStyle(1, UI.border, 0.7).setInteractive({ useHandCursor: true });
      r.on('pointerdown', fn);
      this.add.text(10 + i * (w + 6) + w / 2, 25, label, { fontSize: '12px', color: active ? '#1a1208' : UI.textDim, fontFamily: FONT.body, fontStyle: 'bold' }).setOrigin(0.5);
    });
  }

  /** Mockup header meta: "LV 1 · HP 150 · ATK 12 · MAG 12 · SPD 12  ·  6/10 slots · PL 54 · 2 gems". */
  private renderHeader(): void {
    const used = this.deckOccupied().filter(Boolean).length;
    let plDeci = 0;
    for (const p of demoState.pieces) { const s = skillBook[p.skillId]; if (s) plDeci += instancePowerLevelDeci(s, { gem: p.gem ?? null }); }
    const gems = demoState.pieces.filter((p) => p.gem).length;
    const hero = buildAutoHeroSetup(demoState.heroLevel, demoState.pieces.map((p) => ({ ...p })), demoState.heroAllocation).setup;
    const s = hero.stats;
    const meta = `LV ${demoState.heroLevel} · HP ${s.maxHp} · ATK ${s.attack} · MAG ${s.magicPower} · SPD ${s.speed}   ·   ${used}/${SLOTS} slots · PL ${(plDeci / 10).toFixed(0)} · ${gems} gem${gems === 1 ? '' : 's'}`;
    this.add.text(12, 50, meta, { fontSize: '10px', color: '#9aa4b6', fontFamily: FONT.body });
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
    const y = 66; const h = 34; const w = this.W - 20;
    this.add.rectangle(10, y, w, h, 0x122033, 0.4).setOrigin(0, 0);
    this.dashedRect(10, y, w, h, 0xb78a46, this.hold ? 1 : 0.7);
    this.add.rectangle(18, y + 4, 24, h - 8, 0x16233a).setOrigin(0, 0).setStrokeStyle(1, 0x3a4a62, 0.9);
    if (this.hold) {
      const skill = skillBook[this.hold.skillId];
      if (skill) {
        const tok = new CardToken(this, 52 + 105, y + h / 2, skill, { width: 210, height: h - 6, side: 'left', deck: [skill], stats: this.heroStats });
        this.makeDraggable(tok, { where: 'hold', card: this.hold });
      }
      this.add.text(this.W - 16, y + h / 2, 'HOLDING', { fontSize: '10px', color: '#c9a15a', fontFamily: FONT.body, fontStyle: 'bold' }).setOrigin(1, 0.5);
    } else {
      const label = this.add.text(52, y + h / 2, 'TEMP HOLDING', { fontSize: '11px', color: '#c9a15a', fontFamily: FONT.body, fontStyle: 'bold' }).setOrigin(0, 0.5);
      this.add.text(label.x + label.width + 6, y + h / 2, '— drop a card to hold it while rearranging', { fontSize: '9px', color: '#8a94a6', fontFamily: FONT.body }).setOrigin(0, 0.5);
    }
  }

  private renderColumns(): void {
    const top = 122;
    const colH = this.H - top - 78;
    const colW = (this.W - 20 - 8) / 2;
    const gap = 5;
    const rowH = (colH - gap * (SLOTS - 1)) / SLOTS;
    const deckX = 10; const bagX = 10 + colW + 8;
    this.layout = { top, colH, colW, rowH, gap, deckX, bagX };

    const deckUsed = this.deckOccupied().filter(Boolean).length;
    const bagUsed = this.bagOccupied().filter(Boolean).length;
    this.add.text(deckX + colW / 2, top - 6, `ACTIVE DECK · ${deckUsed}/${SLOTS}`, { fontSize: '10px', color: '#b78a46', fontFamily: FONT.body, fontStyle: 'bold' }).setOrigin(0.5, 1);
    this.add.text(bagX + colW / 2, top - 6, `BAG · ${bagUsed}/${SLOTS}`, { fontSize: '10px', color: '#b78a46', fontFamily: FONT.body, fontStyle: 'bold' }).setOrigin(0.5, 1);

    const deckSkills = demoState.pieces.map((p) => skillBook[p.skillId]).filter((s): s is SkillDef => Boolean(s));
    const bagSkills = demoState.bagSlots.map((c) => (c ? skillBook[c.skillId] : undefined)).filter((s): s is SkillDef => Boolean(s));
    const rowTop = (row: number): number => top + row * (rowH + gap);
    const empty = (colX: number, row: number, side: 'left' | 'right'): void => {
      this.add.rectangle(colX + colW / 2, rowTop(row) + rowH / 2, colW, rowH, 0x121e30, 0.45).setOrigin(0.5).setStrokeStyle(1, 0x24344a, 0.9);
      const nx = side === 'left' ? colX + colW - 6 : colX + 6;
      this.add.text(nx, rowTop(row) + 4, `${row + 1}`, { fontSize: '10px', color: '#5a6880', fontFamily: 'monospace', fontStyle: 'bold' }).setOrigin(side === 'left' ? 1 : 0, 0);
    };

    // DECK (left)
    const deckOcc = this.deckOccupied();
    const deckBySlot = new Map(demoState.pieces.map((p) => [p.slot, p]));
    for (let row = 0; row < SLOTS; row++) {
      const piece = deckBySlot.get(row);
      if (piece) {
        const skill = skillBook[piece.skillId]!;
        const span = this.sizeOf(piece.skillId);
        const h = rowH * span + gap * (span - 1);
        const label = span > 1 ? `${row + 1}-${row + span}` : `${row + 1}`;
        const tok = new CardToken(this, deckX + colW / 2, rowTop(row) + h / 2, skill, { width: colW, height: h, side: 'left', slotLabel: label, deck: deckSkills, stats: this.heroStats });
        this.makeDraggable(tok, { where: 'deck', instanceId: piece.instanceId, card: { instanceId: piece.instanceId, skillId: piece.skillId, tier: piece.tier } });
        row += span - 1;
      } else if (!deckOcc[row]) { empty(deckX, row, 'left'); }
    }

    // BAG (right)
    const bagOcc = this.bagOccupied();
    for (let row = 0; row < SLOTS; row++) {
      const card = demoState.bagSlots[row];
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
    const label = this.add.text(deckX + colW / 2 - 30, py, pipLabel, { fontSize: '10px', color: id ? '#e8b446' : '#e8e0c8', fontFamily: FONT.body, fontStyle: 'bold' }).setOrigin(1, 0.5);
    for (let i = 0; i < 3; i++) {
      const filled = i < Math.min(3, topCount);
      this.add.rectangle(label.x + 8 + i * 13, py, 9, 9, filled ? 0xb78a46 : 0x16233a).setOrigin(0, 0.5).setStrokeStyle(1, 0x3a4a62, 1);
    }
    this.add.text(label.x + 8 + 3 * 13 + 6, py, id ? 'affinity' : '3 to unlock', { fontSize: '9px', color: '#8a94a6', fontFamily: FONT.body }).setOrigin(0, 0.5);
  }

  /** Slim TRASH strip (mockup): dashed red border · label + grey sub. No emoji (canvas tofu). */
  private renderTrash(): void {
    const y = this.H - 44; const h = 34; const w = this.W - 20;
    this.add.rectangle(10, y, w, h, 0x2a1412, 0.4).setOrigin(0, 0);
    this.dashedRect(10, y, w, h, 0xb0483c, 0.9);
    const label = this.add.text(52, y + h / 2, 'TRASH', { fontSize: '11px', color: '#d05c4e', fontFamily: FONT.body, fontStyle: 'bold' }).setOrigin(0, 0.5);
    this.add.rectangle(18, y + 4, 24, h - 8, 0x1c0f0d).setOrigin(0, 0).setStrokeStyle(1, 0x7a4a42, 0.9);
    this.add.text(label.x + label.width + 6, y + h / 2, '— drop to destroy (asks to confirm)', { fontSize: '9px', color: '#8a94a6', fontFamily: FONT.body }).setOrigin(0, 0.5);
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

    if (where === 'bag') this.toBag(src, row); else this.toDeck(src, row);
  }

  /** Insert into the deck, shifting existing spans instead of swapping. */
  private toDeck(src: Source, preferRow: number): boolean {
    const size = this.sizeOf(src.card.skillId);
    const sourcePiece = src.where === 'deck'
      ? demoState.pieces.find((p) => p.instanceId === src.instanceId)
      : undefined;
    if (src.where === 'deck' && sourcePiece) {
      const others = demoState.pieces.filter((p) => p.instanceId !== src.instanceId)
        .map((p) => ({ id: p.instanceId, start: p.slot, size: this.sizeOf(p.skillId) }));
      const plan = moveWithinStrip(others, size, sourcePiece.slot, preferRow, SLOTS);
      if (!plan) return false;
      demoState.pieces = demoState.pieces
        .filter((p) => p.instanceId !== src.instanceId)
        .map((p) => { const moved = plan.moved.find((item) => item.id === p.instanceId); return moved ? { ...p, slot: moved.start } : p; })
        .concat({ ...sourcePiece, slot: plan.movedStart })
        .sort((a, b) => a.slot - b.slot);
      return true;
    }
    const others = demoState.pieces.map((p) => ({ id: p.instanceId, start: p.slot, size: this.sizeOf(p.skillId) }));
    const plan = shiftInsert(others, size, preferRow, SLOTS);
    if (!plan) return false;
    this.removeSource(src);
    demoState.pieces = demoState.pieces
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
      const others = demoState.bagSlots.flatMap((card, index) => card && index !== origin
        ? [{ id: String(index), start: index, size: this.sizeOf(card.skillId) }] : []);
      const plan = moveWithinStrip(others, size, origin, preferRow, SLOTS);
      if (!plan) return false;
      const cards = demoState.bagSlots.map((card, index) => ({ card, index })).filter((item) => item.index !== origin);
      const next: Array<OwnedCard | null> = Array(SLOTS).fill(null);
      for (const item of cards) {
        const moved = plan.moved.find((entry) => entry.id === String(item.index));
        if (moved) next[moved.start] = item.card;
      }
      next[plan.movedStart] = src.card;
      demoState.bagSlots = next;
      return true;
    }
    const others = demoState.bagSlots.flatMap((card, index) => card
      ? [{ id: String(index), start: index, size: this.sizeOf(card.skillId) }] : []);
    const plan = shiftInsert(others, size, preferRow, SLOTS);
    if (!plan) return false;
    this.removeSource(src);
    const next: Array<OwnedCard | null> = Array(SLOTS).fill(null);
    for (const item of demoState.bagSlots) {
      if (!item) continue;
      const index = demoState.bagSlots.indexOf(item);
      const moved = plan.moved.find((entry) => entry.id === String(index));
      if (moved) next[moved.start] = item;
    }
    next[plan.movedStart] = { ...src.card };
    demoState.bagSlots = next;
    return true;
  }

  private renderConfirm(): void {
    const src = this.pendingTrash!;
    const skill = skillBook[src.card.skillId];
    this.add.rectangle(0, 0, this.W, this.H, 0x05070c, 0.72).setOrigin(0, 0).setInteractive();
    const bw = this.W - 60; const bx = 30; const by = this.H / 2 - 70;
    this.add.rectangle(bx, by, bw, 140, 0x141d2c).setOrigin(0, 0).setStrokeStyle(2, 0xd05c4e);
    this.add.text(this.W / 2, by + 24, `Delete ${skill?.name ?? 'card'}?`, { fontSize: '15px', color: '#e8e0c8', fontFamily: FONT.display, fontStyle: 'bold' }).setOrigin(0.5);
    this.add.text(this.W / 2, by + 50, 'This removes it from your collection.', { fontSize: '10px', color: '#9aa4b6', fontFamily: FONT.body }).setOrigin(0.5);
    const mk = (dx: number, w: number, label: string, fill: number, color: string, fn: () => void): void => {
      const r = this.add.rectangle(dx, by + 88, w, 36, fill).setOrigin(0, 0).setStrokeStyle(1, UI.border, 0.7).setInteractive({ useHandCursor: true });
      r.on('pointerdown', fn);
      this.add.text(dx + w / 2, by + 106, label, { fontSize: '13px', color, fontFamily: FONT.body, fontStyle: 'bold' }).setOrigin(0.5);
    };
    mk(bx + 16, (bw - 40) / 2, 'CANCEL', 0x1b2940, '#e8e0c8', () => { this.pendingTrash = null; this.scene.restart(); });
    mk(bx + 24 + (bw - 40) / 2, (bw - 40) / 2, 'DELETE', 0x7a2e2a, '#ffffff', () => { this.removeSource(src); this.pendingTrash = null; this.scene.restart(); });
  }
}
