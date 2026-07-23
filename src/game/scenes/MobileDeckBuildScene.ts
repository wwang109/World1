import Phaser from 'phaser';
import { skillBook } from '../../data/skills';
import { instancePowerLevelDeci } from '../../engine/balance';
import { boardTypeIdentity, IDENTITY_DAMAGE_PCT } from '../../engine/combat/typeIdentity';
import type { SkillDef } from '../../engine/types';
import { demoState, type OwnedCard } from '../demoState';
import { FONT, SCREEN, UI } from '../theme';
import { CardToken } from '../ui/CardToken';

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

  constructor() { super('MobileDeckBuild'); }

  create(): void {
    this.W = SCREEN.width; this.H = SCREEN.height;
    this.draggables = [];
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
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (this.pendingTrash) return; // confirm dialog owns input
      const hit = this.draggables.find((d) => d.bounds.contains(p.x, p.y));
      if (!hit) return;
      dragging = { token: hit.token, src: hit.src, home: { x: hit.token.x, y: hit.token.y } };
      hit.token.setDepth(1000).setAlpha(0.9);
    });
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => { if (dragging) dragging.token.setPosition(p.x, p.y); });
    this.input.on('pointerup', (p: Phaser.Input.Pointer) => {
      if (!dragging) return;
      const src = dragging.src;
      dragging = null;
      this.resolveDrop(src, p.x, p.y);
      this.scene.restart(); // mutations applied above; re-render (snaps back if no move)
    });
  }

  private sizeOf(skillId: string): number { return Math.max(1, skillBook[skillId]?.size ?? 1); }

  // ---------- occupancy / placement ----------

  private deckOccupied(exclude?: string): boolean[] {
    const occ = Array<boolean>(SLOTS).fill(false);
    for (const p of demoState.pieces) {
      if (p.instanceId === exclude) continue;
      const size = this.sizeOf(p.skillId);
      for (let i = p.slot; i < p.slot + size && i < SLOTS; i++) occ[i] = true;
    }
    return occ;
  }

  private bagOccupied(excludeIndex?: number): boolean[] {
    const occ = Array<boolean>(SLOTS).fill(false);
    demoState.bagSlots.forEach((card, index) => {
      if (!card || index === excludeIndex) return;
      const size = this.sizeOf(card.skillId);
      for (let i = index; i < index + size && i < SLOTS; i++) occ[i] = true;
    });
    return occ;
  }

  /** Nearest free run of `size` slots to `prefer`, or -1 if none. */
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

  // ---------- moves (real demoState) ----------

  private removeSource(src: Source): void {
    if (src.where === 'deck') demoState.pieces = demoState.pieces.filter((p) => p.instanceId !== src.instanceId);
    else if (src.where === 'bag') demoState.bagSlots[src.index] = null;
    else this.hold = null;
  }

  private toDeck(src: Source, preferRow: number): boolean {
    const size = this.sizeOf(src.card.skillId);
    const exclude = src.where === 'deck' ? src.instanceId : undefined;
    const fit = this.nearestFit(this.deckOccupied(exclude), size, preferRow);
    if (fit < 0) return false;
    this.removeSource(src);
    demoState.pieces = [...demoState.pieces, { instanceId: src.card.instanceId, skillId: src.card.skillId, tier: src.card.tier, slot: fit }];
    return true;
  }

  private toBag(src: Source, preferRow: number): boolean {
    const size = this.sizeOf(src.card.skillId);
    const exclude = src.where === 'bag' ? src.index : undefined;
    const fit = this.nearestFit(this.bagOccupied(exclude), size, preferRow);
    if (fit < 0) return false;
    this.removeSource(src);
    demoState.bagSlots[fit] = { instanceId: src.card.instanceId, skillId: src.card.skillId, tier: src.card.tier };
    return true;
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
      ['WIKI', false, () => { demoState.prepView = 'codex'; this.scene.start('Prep'); }],
    ];
    const w = (this.W - 20 - 12) / 3;
    tabs.forEach(([label, active, fn], i) => {
      const r = this.add.rectangle(10 + i * (w + 6), 8, w, 34, active ? 0xb78a46 : 0x131f32).setOrigin(0, 0).setStrokeStyle(1, UI.border, 0.7).setInteractive({ useHandCursor: true });
      r.on('pointerdown', fn);
      this.add.text(10 + i * (w + 6) + w / 2, 25, label, { fontSize: '12px', color: active ? '#1a1208' : UI.textDim, fontFamily: FONT.body, fontStyle: 'bold' }).setOrigin(0.5);
    });
  }

  private renderHeader(): void {
    const used = this.deckOccupied().filter(Boolean).length;
    let plDeci = 0;
    for (const p of demoState.pieces) { const s = skillBook[p.skillId]; if (s) plDeci += instancePowerLevelDeci(s, { gem: p.gem ?? null }); }
    this.add.text(12, 48, `ACTIVE DECK · ${demoState.pieces.length} cards · ${used}/${SLOTS} · PL ${(plDeci / 10).toFixed(0)}`, { fontSize: '12px', color: '#e8e0c8', fontFamily: FONT.body, fontStyle: 'bold' });
    this.add.text(12, 64, 'Drag a card between deck, bag, and holding · drop on TRASH to delete', { fontSize: '9px', color: UI.textDim, fontFamily: FONT.body });
  }

  private renderHolding(): void {
    const y = 80; const h = 40; const w = this.W - 20;
    this.add.rectangle(10, y, w, h, 0x12203366).setOrigin(0, 0).setStrokeStyle(1, 0xb78a46, this.hold ? 0.9 : 0.5);
    if (this.hold) {
      const skill = skillBook[this.hold.skillId];
      if (skill) {
        const tok = new CardToken(this, 10 + 120, y + h / 2, skill, { width: 220, height: h - 4, side: 'left', deck: [skill] });
        this.makeDraggable(tok, { where: 'hold', card: this.hold });
      }
      this.add.text(this.W - 16, y + h / 2, 'HOLDING', { fontSize: '10px', color: '#c9a15a', fontFamily: FONT.body, fontStyle: 'bold' }).setOrigin(1, 0.5);
    } else {
      this.add.text(10 + w / 2, y + h / 2, 'TEMP HOLDING — drag a card here to hold it', { fontSize: '11px', color: '#8a94a6', fontFamily: FONT.body, fontStyle: 'bold' }).setOrigin(0.5);
    }
  }

  private renderColumns(): void {
    const top = 130;
    const colH = this.H - top - 118;
    const colW = (this.W - 20 - 8) / 2;
    const gap = 5;
    const rowH = (colH - gap * (SLOTS - 1)) / SLOTS;
    const deckX = 10; const bagX = 10 + colW + 8;
    this.layout = { top, colH, colW, rowH, gap, deckX, bagX };

    this.add.text(deckX + colW / 2, top - 4, 'ACTIVE DECK', { fontSize: '10px', color: '#b78a46', fontFamily: FONT.body, fontStyle: 'bold' }).setOrigin(0.5, 1);
    this.add.text(bagX + colW / 2, top - 4, 'BAG', { fontSize: '10px', color: '#b78a46', fontFamily: FONT.body, fontStyle: 'bold' }).setOrigin(0.5, 1);

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
        const tok = new CardToken(this, deckX + colW / 2, rowTop(row) + h / 2, skill, { width: colW, height: h, side: 'left', slotLabel: label, deck: deckSkills });
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
        const tok = new CardToken(this, bagX + colW / 2, rowTop(row) + h / 2, skill, { width: colW, height: h, side: 'right', slotLabel: label, deck: bagSkills });
        this.makeDraggable(tok, { where: 'bag', index: row, card: { ...card } });
        row += span - 1;
      } else if (!bagOcc[row]) { empty(bagX, row, 'right'); }
    }

    // identity pips under deck column
    const id = boardTypeIdentity(deckSkills);
    const idText = id ? `${id.type.toUpperCase()} DECK · +${IDENTITY_DAMAGE_PCT}% DMG` : 'No deck identity — 3+ of one type';
    this.add.text(deckX + colW / 2, top + colH + 4, idText, { fontSize: '9px', color: id ? '#e8b446' : '#8a94a6', fontFamily: FONT.body, fontStyle: 'bold' }).setOrigin(0.5, 0);
  }

  private renderTrash(): void {
    const y = this.H - 52; const w = this.W - 20;
    this.add.rectangle(10, y, w, 40, 0x2a1412).setOrigin(0, 0).setStrokeStyle(1, 0xd05c4e, 0.9);
    this.add.text(10 + w / 2, y + 20, '🗑 TRASH — drop a card here to delete', { fontSize: '12px', color: '#d05c4e', fontFamily: FONT.body, fontStyle: 'bold' }).setOrigin(0.5);
  }

  // ---------- drag ----------

  private makeDraggable(tok: CardToken, src: Source): void {
    this.draggables.push({ token: tok, bounds: new Phaser.Geom.Rectangle(tok.x - tok.width / 2, tok.y - tok.height / 2, tok.width, tok.height), src });
  }

  private resolveDrop(src: Source, px: number, py: number): void {
    // TRASH strip (bottom)
    if (py >= this.H - 52) { this.pendingTrash = src; return; }
    // TEMP HOLDING strip (top)
    if (py >= 80 && py < 120) { this.toHold(src); return; }
    const { top, colH, rowH, gap, bagX } = this.layout;
    if (py < top || py > top + colH) return; // dropped nowhere valid → snaps back
    const row = Math.max(0, Math.min(SLOTS - 1, Math.floor((py - top) / (rowH + gap))));
    if (px >= bagX) this.toBag(src, row); else this.toDeck(src, row);
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
