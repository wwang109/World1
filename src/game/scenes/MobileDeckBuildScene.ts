import Phaser from 'phaser';
import { skillBook } from '../../data/skills';
import { instancePowerLevelDeci } from '../../engine/balance';
import type { SkillDef } from '../../engine/types';
import { demoState, type OwnedBoardPiece } from '../demoState';
import { FONT, SCREEN, UI } from '../theme';
import { CardToken } from '../ui/CardToken';

const SLOTS = 10;

/**
 * Mobile Deck Build — vertical: tabs · header · ACTIVE DECK (left) vs BAG
 * (right) as tappable CardToken columns · TRASH toggle. Tap a card to move it
 * between deck and bag (first-fit placement); arm TRASH then tap to delete.
 * Real demoState mutations. Reachable at ?scene=mdeck. (Drag-and-drop can be
 * ported from the desktop PrepScene later; tap is the reliable first pass.)
 */
export class MobileDeckBuildScene extends Phaser.Scene {
  private W = SCREEN.width;
  private H = SCREEN.height;
  private trashArmed = false;

  constructor() { super('MobileDeckBuild'); }

  create(): void {
    this.W = SCREEN.width;
    this.H = SCREEN.height;
    this.cameras.main.setBackgroundColor(0x0b1420);

    this.renderTabs();
    this.renderHeader();
    this.renderColumns();
    this.renderTrash();
  }

  // ---------- data helpers (real demoState) ----------

  private sizeOf(skillId: string): number { return Math.max(1, skillBook[skillId]?.size ?? 1); }

  private deckOccupied(): boolean[] {
    const occ = Array<boolean>(SLOTS).fill(false);
    for (const p of demoState.pieces) {
      const size = this.sizeOf(p.skillId);
      for (let i = p.slot; i < p.slot + size && i < SLOTS; i++) occ[i] = true;
    }
    return occ;
  }

  private bagOccupied(): boolean[] {
    const occ = Array<boolean>(SLOTS).fill(false);
    demoState.bagSlots.forEach((card, index) => {
      if (!card) return;
      const size = this.sizeOf(card.skillId);
      for (let i = index; i < index + size && i < SLOTS; i++) occ[i] = true;
    });
    return occ;
  }

  private firstFit(occ: boolean[], size: number): number {
    for (let i = 0; i + size <= SLOTS; i++) {
      let ok = true;
      for (let j = i; j < i + size; j++) if (occ[j]) { ok = false; break; }
      if (ok) return i;
    }
    return -1;
  }

  private moveDeckToBag(piece: OwnedBoardPiece): void {
    const size = this.sizeOf(piece.skillId);
    const fit = this.firstFit(this.bagOccupied(), size);
    if (fit < 0) return; // bag full
    demoState.bagSlots[fit] = { instanceId: piece.instanceId, skillId: piece.skillId, tier: piece.tier };
    demoState.pieces = demoState.pieces.filter((p) => p.instanceId !== piece.instanceId);
    this.scene.restart();
  }

  private moveBagToDeck(index: number): void {
    const card = demoState.bagSlots[index];
    if (!card) return;
    const size = this.sizeOf(card.skillId);
    const fit = this.firstFit(this.deckOccupied(), size);
    if (fit < 0) return; // deck full
    demoState.pieces = [...demoState.pieces, { instanceId: card.instanceId, skillId: card.skillId, tier: card.tier, slot: fit }];
    demoState.bagSlots[index] = null;
    this.scene.restart();
  }

  private trashPiece(piece: OwnedBoardPiece): void {
    demoState.pieces = demoState.pieces.filter((p) => p.instanceId !== piece.instanceId);
    this.scene.restart();
  }

  private trashBag(index: number): void {
    demoState.bagSlots[index] = null;
    this.scene.restart();
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
    for (const p of demoState.pieces) {
      const skill = skillBook[p.skillId];
      if (skill) plDeci += instancePowerLevelDeci(skill, { gem: p.gem ?? null });
    }
    this.add.text(12, 52, `ACTIVE DECK · ${demoState.pieces.length} cards · ${used}/${SLOTS} slots · PL ${(plDeci / 10).toFixed(0)}`, {
      fontSize: '12px', color: '#e8e0c8', fontFamily: FONT.body, fontStyle: 'bold',
    });
    this.add.text(12, 70, 'Tap a card to move it between deck and bag · arm TRASH to delete', {
      fontSize: '10px', color: UI.textDim, fontFamily: FONT.body,
    });
  }

  private renderColumns(): void {
    const top = 92;
    const colH = this.H - top - 60;
    const colW = (this.W - 20 - 8) / 2;
    const gap = 5;
    const rowH = (colH - gap * (SLOTS - 1)) / SLOTS;
    this.add.text(10 + colW / 2, top - 4, 'ACTIVE DECK', { fontSize: '10px', color: '#b78a46', fontFamily: FONT.body, fontStyle: 'bold' }).setOrigin(0.5, 1);
    this.add.text(10 + colW + 8 + colW / 2, top - 4, 'BAG', { fontSize: '10px', color: '#b78a46', fontFamily: FONT.body, fontStyle: 'bold' }).setOrigin(0.5, 1);

    const deckSkills = demoState.pieces.map((p) => skillBook[p.skillId]).filter((s): s is SkillDef => Boolean(s));
    const bagSkills = demoState.bagSlots.map((c) => (c ? skillBook[c.skillId] : undefined)).filter((s): s is SkillDef => Boolean(s));

    const rowTop = (row: number): number => top + row * (rowH + gap);
    const empty = (colX: number, row: number, side: 'left' | 'right'): void => {
      const r = this.add.rectangle(colX + colW / 2, rowTop(row) + rowH / 2, colW, rowH, 0x121e30, 0.45).setOrigin(0.5).setStrokeStyle(1, 0x24344a, 0.9);
      const nx = side === 'left' ? colX + colW - 6 : colX + 6;
      this.add.text(nx, rowTop(row) + 4, `${row + 1}`, { fontSize: '10px', color: '#5a6880', fontFamily: 'monospace', fontStyle: 'bold' }).setOrigin(side === 'left' ? 1 : 0, 0);
      void r;
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
        const tok = new CardToken(this, 10 + colW / 2, rowTop(row) + h / 2, skill, { width: colW, height: h, side: 'left', slotLabel: label, deck: deckSkills });
        tok.setInteractive(new Phaser.Geom.Rectangle(-colW / 2, -h / 2, colW, h), Phaser.Geom.Rectangle.Contains);
        tok.on('pointerdown', () => (this.trashArmed ? this.trashPiece(piece) : this.moveDeckToBag(piece)));
        row += span - 1;
      } else if (!deckOcc[row]) {
        empty(10, row, 'left');
      }
    }

    // BAG (right)
    const bagX = 10 + colW + 8;
    const bagOcc = this.bagOccupied();
    for (let row = 0; row < SLOTS; row++) {
      const card = demoState.bagSlots[row];
      if (card) {
        const skill = skillBook[card.skillId]!;
        const span = this.sizeOf(card.skillId);
        const h = rowH * span + gap * (span - 1);
        const label = span > 1 ? `${row + 1}-${row + span}` : `${row + 1}`;
        const tok = new CardToken(this, bagX + colW / 2, rowTop(row) + h / 2, skill, { width: colW, height: h, side: 'right', slotLabel: label, deck: bagSkills });
        tok.setInteractive(new Phaser.Geom.Rectangle(-colW / 2, -h / 2, colW, h), Phaser.Geom.Rectangle.Contains);
        tok.on('pointerdown', () => (this.trashArmed ? this.trashBag(row) : this.moveBagToDeck(row)));
        row += span - 1;
      } else if (!bagOcc[row]) {
        empty(bagX, row, 'right');
      }
    }
  }

  private renderTrash(): void {
    const y = this.H - 52;
    const w = this.W - 20;
    const r = this.add.rectangle(10, y, w, 40, this.trashArmed ? 0x7a2e2a : 0x1b2940).setOrigin(0, 0).setStrokeStyle(1, this.trashArmed ? 0xd05c4e : UI.border, 0.9).setInteractive({ useHandCursor: true });
    r.on('pointerdown', () => { this.trashArmed = !this.trashArmed; this.scene.restart(); });
    this.add.text(10 + w / 2, y + 20, this.trashArmed ? '🗑 TRASH ARMED — tap a card to delete (tap here to cancel)' : '🗑 TRASH — tap to arm', {
      fontSize: '12px', color: this.trashArmed ? '#ffffff' : '#d05c4e', fontFamily: FONT.body, fontStyle: 'bold',
    }).setOrigin(0.5);
  }
}
