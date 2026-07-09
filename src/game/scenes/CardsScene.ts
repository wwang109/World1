import Phaser from 'phaser';
import type { BoardPiece, SkillTier } from '../../engine/types';
import { TIER_ORDER, variantId, baseIdOf } from '../../engine/tierUp';
import { powerLevel } from '../../engine/balance';
import { skillBook } from '../../data/skills';
import { fullBook, cardAtTier, tiersOf } from '../../data/library';
import { HERO_BOARD_SLOTS } from '../../data/heroes';
import { canPlace } from '../../run/loadout';
import { demoState } from '../demoState';
import { CardView, SLOT_W, CARD_H } from '../ui/CardView';
import { UI } from '../theme';

const GRID_SCALE = 0.6;
const GRID_X = 24;
const GRID_RIGHT = 860;
const GRID_Y = 108;
const PANEL_X = 884;
const PANEL_W = 372;
const BOARD_STRIP_Y = 520;
const INV_STRIP_Y = 620;
const INVENTORY_CAP = 24;

const TIER_LABEL: Record<SkillTier, string> = { bronze: 'BRONZE', silver: 'SILVER', gold: 'GOLD', diamond: 'DIAMOND' };
const TIER_COLOR: Record<SkillTier, string> = { bronze: '#c08850', silver: '#b8c4d4', gold: '#ffd76a', diamond: '#8ee0ff' };

interface Selection {
  baseId: string;
  tier: SkillTier;
  source: 'library' | 'board' | 'inventory';
  piece?: BoardPiece;
  invIndex?: number;
}

/** Card library: browse every playable card, pick its tier, route it to the board or inventory. */
export class CardsScene extends Phaser.Scene {
  private sel: Selection | null = null;
  private detailObjs: Phaser.GameObjects.GameObject[] = [];
  private boardObjs: Phaser.GameObjects.GameObject[] = [];
  private invObjs: Phaser.GameObjects.GameObject[] = [];
  private feedback!: Phaser.GameObjects.Text;

  constructor() {
    super('Cards');
  }

  create(): void {
    this.sel = null;
    this.detailObjs = [];
    this.boardObjs = [];
    this.invObjs = [];

    this.add.text(24, 16, 'CARD LIBRARY', { fontSize: '26px', color: UI.text, fontFamily: 'monospace', fontStyle: 'bold' });
    this.add.text(24, 48, 'click a card · pick its tier · send it to your board or inventory', {
      fontSize: '13px',
      color: UI.textDim,
      fontFamily: 'monospace',
    });

    const back = this.add
      .text(1256, 28, '← back to prep', {
        fontSize: '14px',
        color: UI.text,
        backgroundColor: '#24242e',
        padding: { x: 10, y: 6 },
        fontFamily: 'monospace',
      })
      .setOrigin(1, 0.5)
      .setInteractive({ useHandCursor: true });
    back.on('pointerdown', () => this.scene.start('Prep'));

    // Detail panel frame (contents re-render per selection).
    this.add.rectangle(PANEL_X, 76, PANEL_W, 404, 0x14141c).setOrigin(0, 0).setStrokeStyle(1, 0x2a2a36);
    this.feedback = this.add.text(PANEL_X + PANEL_W / 2, 460, '', { fontSize: '12px', color: '#ffd76a', fontFamily: 'monospace' }).setOrigin(0.5);

    this.renderGrid();
    this.renderDetail();
    this.renderBoardStrip();
    this.renderInventoryStrip();
  }

  // ---------- library grid ----------

  private renderGrid(): void {
    this.add.text(GRID_X, GRID_Y - 22, `ALL CARDS (${Object.keys(skillBook).length})`, {
      fontSize: '12px',
      color: UI.textDim,
      fontFamily: 'monospace',
    });
    let x = GRID_X;
    let y = GRID_Y + (CARD_H * GRID_SCALE) / 2;
    for (const id of Object.keys(skillBook).sort()) {
      const skill = skillBook[id]!;
      const w = skill.size * SLOT_W * GRID_SCALE;
      if (x + w > GRID_RIGHT) {
        x = GRID_X;
        y += CARD_H * GRID_SCALE + 8;
      }
      const card = new CardView(this, x + w / 2, y, skill, { mini: true });
      card.setScale(GRID_SCALE);
      card.setInteractive({ useHandCursor: true });
      card.on('pointerdown', () => this.select({ baseId: id, tier: skill.tier, source: 'library' }));
      x += w + 10;
    }
  }

  // ---------- selection & detail panel ----------

  private select(sel: Selection): void {
    this.sel = sel;
    this.flash('');
    this.renderDetail();
  }

  private flash(msg: string): void {
    this.feedback.setText(msg);
  }

  private button(x: number, y: number, label: string, onClick: () => void, opts: { danger?: boolean } = {}): Phaser.GameObjects.Text {
    const btn = this.add
      .text(x, y, label, {
        fontSize: '13px',
        color: opts.danger ? '#e8a0a0' : UI.text,
        backgroundColor: opts.danger ? '#3a2424' : '#2a2a3a',
        padding: { x: 10, y: 6 },
        fontFamily: 'monospace',
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });
    btn.on('pointerdown', onClick);
    return btn;
  }

  private renderDetail(): void {
    for (const o of this.detailObjs) o.destroy();
    this.detailObjs = [];
    const cx = PANEL_X + PANEL_W / 2;

    if (!this.sel) {
      this.detailObjs.push(
        this.add.text(cx, 260, 'select a card', { fontSize: '14px', color: UI.textDim, fontFamily: 'monospace' }).setOrigin(0.5),
      );
      return;
    }

    const { baseId, tier, source } = this.sel;
    const skill = cardAtTier(baseId, tier) ?? skillBook[baseId]!;

    const card = new CardView(this, cx, 140, skill);
    this.detailObjs.push(card);

    // Tier picker — greyed tiers have no on-budget variant of this card.
    const available = tiersOf(baseId);
    const bw = 86;
    TIER_ORDER.forEach((t, i) => {
      const usable = available.includes(t);
      const active = t === tier;
      const btn = this.add
        .text(PANEL_X + 14 + bw / 2 + i * (bw + 4), 216, TIER_LABEL[t], {
          fontSize: '11px',
          color: usable ? (active ? '#101018' : TIER_COLOR[t]) : '#4a4a55',
          backgroundColor: active ? TIER_COLOR[t] : '#1c1c26',
          padding: { x: 6, y: 5 },
          fontFamily: 'monospace',
          fontStyle: active ? 'bold' : 'normal',
        })
        .setOrigin(0.5);
      if (usable && !active) {
        btn.setInteractive({ useHandCursor: true });
        btn.on('pointerdown', () => this.setTier(t));
      }
      this.detailObjs.push(btn);
    });

    const meta = [
      `PL ${powerLevel(skill)} · ${skill.rarity} · ${skill.archetypes.join(' + ')}`,
      `${skill.property} · size ${skill.size} · weight ${skill.speedWeight ?? skill.size * 10}`,
    ].join('\n');
    this.detailObjs.push(this.add.text(PANEL_X + 16, 240, meta, { fontSize: '12px', color: UI.textDim, fontFamily: 'monospace', lineSpacing: 3 }));

    this.detailObjs.push(
      this.add.text(PANEL_X + 16, 284, skill.text, {
        fontSize: '12px',
        color: UI.text,
        fontFamily: 'monospace',
        wordWrap: { width: PANEL_W - 32 },
        lineSpacing: 3,
      }),
    );

    // Actions depend on where the selection came from.
    const ay = 436;
    if (source === 'library') {
      this.detailObjs.push(this.button(cx - 90, ay, '+ board', () => this.addToBoard(skill.id)));
      this.detailObjs.push(this.button(cx + 90, ay, '+ inventory', () => this.addToInventory(skill.id)));
    } else if (source === 'board') {
      this.detailObjs.push(this.button(cx - 90, ay, '→ inventory', () => this.boardToInventory()));
      this.detailObjs.push(this.button(cx + 90, ay, '✕ remove', () => this.removeFromBoard(), { danger: true }));
    } else {
      this.detailObjs.push(this.button(cx - 90, ay, '→ board', () => this.inventoryToBoard()));
      this.detailObjs.push(this.button(cx + 90, ay, '✕ drop', () => this.dropFromInventory(), { danger: true }));
    }
  }

  /** Switch the selection's tier; board/inventory selections swap in place. */
  private setTier(tier: SkillTier): void {
    if (!this.sel) return;
    const id = variantId(this.sel.baseId, tier, skillBook[this.sel.baseId]!.tier);
    this.sel.tier = tier;
    if (this.sel.source === 'board' && this.sel.piece) {
      this.sel.piece.skillId = id;
      this.renderBoardStrip();
    } else if (this.sel.source === 'inventory' && this.sel.invIndex !== undefined) {
      demoState.inventory[this.sel.invIndex] = id;
      this.renderInventoryStrip();
    }
    this.renderDetail();
  }

  // ---------- board / inventory actions ----------

  private autoPlace(id: string): boolean {
    const size = fullBook[id]?.size ?? 1;
    for (let s = 0; s <= HERO_BOARD_SLOTS - size; s++) {
      if (canPlace(demoState.pieces, fullBook, id, s, HERO_BOARD_SLOTS)) {
        demoState.pieces.push({ skillId: id, slot: s });
        return true;
      }
    }
    return false;
  }

  private addToBoard(id: string): void {
    if (this.autoPlace(id)) {
      this.flash('added to board');
      this.renderBoardStrip();
    } else {
      this.flash(`board full — no room for a size-${fullBook[id]?.size ?? 1} card`);
    }
  }

  private addToInventory(id: string): void {
    if (demoState.inventory.length >= INVENTORY_CAP) {
      this.flash('inventory full');
      return;
    }
    demoState.inventory.push(id);
    this.flash('stashed in inventory');
    this.renderInventoryStrip();
  }

  private boardToInventory(): void {
    const piece = this.sel?.piece;
    if (!piece) return;
    if (demoState.inventory.length >= INVENTORY_CAP) {
      this.flash('inventory full');
      return;
    }
    demoState.pieces = demoState.pieces.filter((p) => p !== piece);
    demoState.inventory.push(piece.skillId);
    this.sel = null;
    this.flash('moved to inventory');
    this.renderBoardStrip();
    this.renderInventoryStrip();
    this.renderDetail();
  }

  private removeFromBoard(): void {
    const piece = this.sel?.piece;
    if (!piece) return;
    demoState.pieces = demoState.pieces.filter((p) => p !== piece);
    this.sel = null;
    this.flash('removed from board');
    this.renderBoardStrip();
    this.renderDetail();
  }

  private inventoryToBoard(): void {
    const idx = this.sel?.invIndex;
    if (idx === undefined) return;
    const id = demoState.inventory[idx]!;
    if (this.autoPlace(id)) {
      demoState.inventory.splice(idx, 1);
      this.sel = null;
      this.flash('placed on board');
      this.renderBoardStrip();
      this.renderInventoryStrip();
      this.renderDetail();
    } else {
      this.flash(`board full — no room for a size-${fullBook[id]?.size ?? 1} card`);
    }
  }

  private dropFromInventory(): void {
    const idx = this.sel?.invIndex;
    if (idx === undefined) return;
    demoState.inventory.splice(idx, 1);
    this.sel = null;
    this.flash('dropped');
    this.renderInventoryStrip();
    this.renderDetail();
  }

  // ---------- board & inventory strips ----------

  private renderBoardStrip(): void {
    for (const o of this.boardObjs) o.destroy();
    this.boardObjs = [];
    const slotW = SLOT_W * GRID_SCALE;
    const used = demoState.pieces.reduce((n, p) => n + (fullBook[p.skillId]?.size ?? 1), 0);
    this.boardObjs.push(
      this.add.text(GRID_X, BOARD_STRIP_Y - 22, `YOUR BOARD — ${used}/${HERO_BOARD_SLOTS} slots (drag to reorder in prep)`, {
        fontSize: '12px',
        color: UI.textDim,
        fontFamily: 'monospace',
      }),
    );
    for (let s = 0; s < HERO_BOARD_SLOTS; s++) {
      this.boardObjs.push(
        this.add
          .rectangle(GRID_X + s * slotW + slotW / 2, BOARD_STRIP_Y + (CARD_H * GRID_SCALE) / 2, slotW - 3, CARD_H * GRID_SCALE + 4, UI.slot)
          .setStrokeStyle(1, 0x3a3a46),
      );
    }
    for (const piece of demoState.pieces) {
      const skill = fullBook[piece.skillId];
      if (!skill) continue;
      const x = GRID_X + piece.slot * slotW + (skill.size * slotW) / 2;
      const card = new CardView(this, x, BOARD_STRIP_Y + (CARD_H * GRID_SCALE) / 2, skill, { mini: true });
      card.setScale(GRID_SCALE);
      card.setInteractive({ useHandCursor: true });
      card.on('pointerdown', () => this.select({ baseId: baseIdOf(piece.skillId), tier: skill.tier, source: 'board', piece }));
      this.boardObjs.push(card);
    }
  }

  private renderInventoryStrip(): void {
    for (const o of this.invObjs) o.destroy();
    this.invObjs = [];
    this.invObjs.push(
      this.add.text(GRID_X, INV_STRIP_Y - 22, `INVENTORY — ${demoState.inventory.length}/${INVENTORY_CAP}`, {
        fontSize: '12px',
        color: UI.textDim,
        fontFamily: 'monospace',
      }),
    );
    if (demoState.inventory.length === 0) {
      this.invObjs.push(
        this.add.text(GRID_X, INV_STRIP_Y + 16, 'empty — stash cards here from the library or your board', {
          fontSize: '12px',
          color: '#4a4a55',
          fontFamily: 'monospace',
        }),
      );
      return;
    }
    let x = GRID_X;
    let y = INV_STRIP_Y + (CARD_H * GRID_SCALE) / 2;
    demoState.inventory.forEach((id, invIndex) => {
      const skill = fullBook[id];
      if (!skill) return;
      const w = skill.size * SLOT_W * GRID_SCALE;
      if (x + w > 1256) {
        x = GRID_X;
        y += CARD_H * GRID_SCALE + 8;
      }
      const card = new CardView(this, x + w / 2, y, skill, { mini: true });
      card.setScale(GRID_SCALE);
      card.setInteractive({ useHandCursor: true });
      card.on('pointerdown', () => this.select({ baseId: baseIdOf(id), tier: skill.tier, source: 'inventory', invIndex }));
      this.invObjs.push(card);
      x += w + 10;
    });
  }
}
