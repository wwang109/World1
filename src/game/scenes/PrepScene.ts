import Phaser from 'phaser';
import { powerLevel } from '../../engine/balance';
import { ELEMENT_BEATS, WEAPON_BEATS } from '../../engine/elements';
import { ELEMENT_ICON, WEAPON_ICON } from '../theme';
import { skillBook } from '../../data/skills';
import { fullBook } from '../../data/library';
import { enemies } from '../../data/enemies';
import { BASE_HERO_STATS, HERO_BOARD_SLOTS } from '../../data/heroes';
import { canPlace, clampSlot } from '../../run/loadout';
import type { BoardPiece } from '../../engine/types';
import { demoState } from '../demoState';
import { CardView, SLOT_W, CARD_H } from '../ui/CardView';
import { UI } from '../theme';

const BOARD_Y = 400;
const BOARD_X = (1280 - HERO_BOARD_SLOTS * SLOT_W) / 2;
const POOL_Y = 530;
/** Pool card scale — sized so the whole catalog fits above the fold. */
const POOL_SCALE = 0.6;

export class PrepScene extends Phaser.Scene {
  private slotRects: Phaser.GameObjects.Rectangle[] = [];
  private boardCards: CardView[] = [];
  private poolCards: CardView[] = [];
  private enemyPreview: Phaser.GameObjects.GameObject[] = [];
  private tooltip!: Phaser.GameObjects.Container;
  private tooltipText!: Phaser.GameObjects.Text;
  private dragGhost: CardView | null = null;
  private dragSource: { fromBoard: boolean; piece?: BoardPiece; skillId: string } | null = null;

  constructor() {
    super('Prep');
  }

  create(): void {
    this.add.text(24, 16, 'WORLD1 — combat demo', {
      fontSize: '26px',
      color: UI.text,
      fontFamily: 'monospace',
      fontStyle: 'bold',
    });
    this.add.text(24, 48, 'arrange your board · pick an enemy · fight', {
      fontSize: '13px',
      color: UI.textDim,
      fontFamily: 'monospace',
    });

    this.buildEnemyPicker();
    this.buildBoardSlots();
    this.buildTooltip();
    this.renderBoard();
    this.renderPool();
    this.renderEnemyPreview();
    this.buildButtons();

    this.add
      .text(BOARD_X, BOARD_Y - CARD_H / 2 - 22, 'YOUR BOARD — left to right = cast order · touching cards share auras', {
        fontSize: '12px',
        color: UI.textDim,
        fontFamily: 'monospace',
      });
  }

  // ---------- board ----------

  private buildBoardSlots(): void {
    for (let s = 0; s < HERO_BOARD_SLOTS; s++) {
      const rect = this.add
        .rectangle(BOARD_X + s * SLOT_W + SLOT_W / 2, BOARD_Y, SLOT_W - 4, CARD_H + 8, UI.slot)
        .setStrokeStyle(1, 0x44444f);
      this.slotRects.push(rect);
      this.add
        .text(rect.x, BOARD_Y + CARD_H / 2 + 16, String(s + 1), {
          fontSize: '10px',
          color: UI.textDim,
          fontFamily: 'monospace',
        })
        .setOrigin(0.5);
    }
  }

  private renderBoard(): void {
    for (const c of this.boardCards) c.destroy();
    this.boardCards = [];
    for (const piece of demoState.pieces) {
      const skill = fullBook[piece.skillId];
      if (!skill) continue;
      const x = BOARD_X + piece.slot * SLOT_W + (skill.size * SLOT_W) / 2;
      const card = new CardView(this, x, BOARD_Y, skill);
      card.setInteractive({ draggable: true, useHandCursor: true });
      this.bindCardHover(card);
      card.on('dragstart', () => this.startDrag({ fromBoard: true, piece, skillId: piece.skillId }, card.x, card.y));
      card.on('drag', (_p: unknown, dragX: number, dragY: number) => this.moveDrag(dragX, dragY));
      card.on('dragend', () => this.endDrag());
      this.boardCards.push(card);
    }
  }

  // ---------- pool ----------

  private renderPool(): void {
    for (const c of this.poolCards) c.destroy();
    this.poolCards = [];
    this.add
      .text(24, POOL_Y - (CARD_H * POOL_SCALE) / 2 - 8, 'CARD POOL — drag onto your board (drag off the board to remove)', {
        fontSize: '12px',
        color: UI.textDim,
        fontFamily: 'monospace',
      })
      .setDepth(1);

    const ids = Object.keys(skillBook).sort();
    let x = 40;
    let y = POOL_Y + 12;
    for (const id of ids) {
      const skill = skillBook[id]!;
      const w = skill.size * SLOT_W * POOL_SCALE;
      if (x + w > 1020) {
        x = 40;
        y += CARD_H * POOL_SCALE + 8;
      }
      const card = new CardView(this, x + w / 2, y, skill, { mini: true });
      card.setScale(POOL_SCALE);
      card.setInteractive({ draggable: true, useHandCursor: true });
      this.bindCardHover(card);
      card.on('dragstart', () => this.startDrag({ fromBoard: false, skillId: id }, card.x, card.y));
      card.on('drag', (_p: unknown, dragX: number, dragY: number) => this.moveDrag(dragX, dragY));
      card.on('dragend', () => this.endDrag());
      this.poolCards.push(card);
      x += w + 10;
    }
  }

  // ---------- drag & drop ----------

  private startDrag(source: { fromBoard: boolean; piece?: BoardPiece; skillId: string }, x: number, y: number): void {
    this.dragSource = source;
    const skill = fullBook[source.skillId]!;
    this.dragGhost = new CardView(this, x, y, skill);
    this.dragGhost.setAlpha(0.85).setDepth(10);
    this.tooltip.setVisible(false);
  }

  private moveDrag(x: number, y: number): void {
    if (!this.dragGhost || !this.dragSource) return;
    this.dragGhost.setPosition(x, y);
    this.paintSlots();
  }

  private targetSlot(): number | null {
    if (!this.dragGhost || !this.dragSource) return null;
    const { x, y } = this.dragGhost;
    if (Math.abs(y - BOARD_Y) > CARD_H) return null;
    const skill = fullBook[this.dragSource.skillId]!;
    const raw = (x - BOARD_X - (skill.size * SLOT_W) / 2) / SLOT_W;
    return clampSlot(raw, this.dragSource.skillId, fullBook, HERO_BOARD_SLOTS);
  }

  private paintSlots(): void {
    for (const rect of this.slotRects) rect.setFillStyle(UI.slot);
    const slot = this.targetSlot();
    if (slot === null || !this.dragSource) return;
    const skill = fullBook[this.dragSource.skillId]!;
    const ok = canPlace(demoState.pieces, fullBook, this.dragSource.skillId, slot, HERO_BOARD_SLOTS, this.dragSource.piece);
    for (let s = slot; s < slot + skill.size; s++) {
      this.slotRects[s]?.setFillStyle(ok ? 0x2e4433 : 0x4a2e2e);
    }
  }

  private endDrag(): void {
    const slot = this.targetSlot();
    const source = this.dragSource;
    this.dragGhost?.destroy();
    this.dragGhost = null;
    this.dragSource = null;
    for (const rect of this.slotRects) rect.setFillStyle(UI.slot);
    if (!source) return;

    if (slot !== null && canPlace(demoState.pieces, fullBook, source.skillId, slot, HERO_BOARD_SLOTS, source.piece)) {
      if (source.fromBoard && source.piece) {
        source.piece.slot = slot;
      } else {
        demoState.pieces.push({ skillId: source.skillId, slot });
      }
    } else if (source.fromBoard && source.piece) {
      // Dropped off-board: remove it.
      demoState.pieces = demoState.pieces.filter((p) => p !== source.piece);
    }
    this.renderBoard();
  }

  // ---------- enemy picker ----------

  private buildEnemyPicker(): void {
    let x = 24;
    const y = 92;
    for (const id of Object.keys(enemies)) {
      const def = enemies[id]!;
      const selected = demoState.enemyIds.includes(id);
      const label = `${def.isBoss ? '👑 ' : def.isElite ? '★ ' : ''}${def.name}${selected ? ' ✓' : ''}`;
      const btn = this.add
        .text(x, y, label, {
          fontSize: '13px',
          color: selected ? '#ffd76a' : UI.text,
          backgroundColor: selected ? '#3a3a1a' : '#24242e',
          padding: { x: 8, y: 5 },
          fontFamily: 'monospace',
        })
        .setInteractive({ useHandCursor: true });
      btn.on('pointerdown', () => {
        // Toggle party membership: keep at least 1, cap at 5.
        if (selected) {
          if (demoState.enemyIds.length > 1) demoState.enemyIds = demoState.enemyIds.filter((e) => e !== id);
        } else if (demoState.enemyIds.length < 5) {
          demoState.enemyIds = [...demoState.enemyIds, id];
        }
        this.scene.restart();
      });
      x += btn.width + 10;
    }
    this.add.text(x + 6, y + 6, `enemy party ${demoState.enemyIds.length}/5 — click to add/remove`, {
      fontSize: '11px',
      color: UI.textDim,
      fontFamily: 'monospace',
    });
  }

  private renderEnemyPreview(): void {
    for (const obj of this.enemyPreview) obj.destroy();
    this.enemyPreview = [];
    if (demoState.enemyIds.length > 1) {
      this.renderEnemyPartyPreview();
      return;
    }
    const def = enemies[demoState.enemyIds[0]!]!;
    const s = def.stats;
    const statText = this.add.text(
      24,
      132,
      `${def.name} — HP ${s.maxHp} · ATK ${s.attack} · MPW ${s.magicPower} · ARM ${s.armor} · RES ${s.magicResist} · SPD ${s.speed} · CRIT ${s.critPct}%`,
      { fontSize: '13px', color: UI.text, fontFamily: 'monospace' },
    );
    this.enemyPreview.push(statText);
    const affinities: string[] = [];
    if (def.elementAffinity) {
      const weakTo = Object.entries(ELEMENT_BEATS).find(([, beaten]) => beaten === def.elementAffinity)?.[0];
      affinities.push(`${ELEMENT_ICON[def.elementAffinity]} ${def.elementAffinity} affinity — weak to ${weakTo}`);
    }
    if (def.weaponAffinity) {
      const weakTo = Object.entries(WEAPON_BEATS).find(([, beaten]) => beaten === def.weaponAffinity)?.[0];
      affinities.push(`${WEAPON_ICON[def.weaponAffinity]} ${def.weaponAffinity} affinity${weakTo ? ` — weak to ${weakTo}` : ''}`);
    }
    if (affinities.length > 0) {
      const affText = this.add.text(560, 158, affinities.join('   '), {
        fontSize: '12px',
        color: '#ffd76a',
        fontFamily: 'monospace',
      });
      this.enemyPreview.push(affText);
    }
    const previewY = 205;
    const startX = 24 + (SLOT_W * 0.6) / 2;
    for (const piece of def.pieces) {
      const skill = skillBook[piece.skillId];
      if (!skill) continue;
      const card = new CardView(this, startX + piece.slot * SLOT_W * 0.6 + ((skill.size - 1) * SLOT_W * 0.6) / 2, previewY, skill, { mini: true });
      card.setScale(0.6);
      this.bindCardHover(card);
      card.setInteractive();
      this.enemyPreview.push(card);
    }
    const label = this.add.text(24, 158, "ENEMY'S BOARD:", { fontSize: '11px', color: UI.textDim, fontFamily: 'monospace' });
    this.enemyPreview.push(label);
  }

  /** Compact stat lines when facing a party — front of the list tanks first. */
  private renderEnemyPartyPreview(): void {
    this.enemyPreview.push(
      this.add.text(24, 132, `ENEMY PARTY (${demoState.enemyIds.length}) — front line first:`, {
        fontSize: '11px',
        color: UI.textDim,
        fontFamily: 'monospace',
      }),
    );
    demoState.enemyIds.forEach((id, i) => {
      const def = enemies[id]!;
      const s = def.stats;
      const aff = [
        def.elementAffinity ? ELEMENT_ICON[def.elementAffinity] : '',
        def.weaponAffinity ? WEAPON_ICON[def.weaponAffinity] : '',
      ].join('');
      this.enemyPreview.push(
        this.add.text(
          24,
          152 + i * 17,
          `${i + 1}. ${def.name.padEnd(16)} HP ${String(s.maxHp).padStart(3)} · ATK ${s.attack} · MPW ${s.magicPower} · ARM ${s.armor} · RES ${s.magicResist} · SPD ${s.speed} ${aff}`,
          { fontSize: '12px', color: UI.text, fontFamily: 'monospace' },
        ),
      );
    });
  }

  // ---------- tooltip ----------

  private buildTooltip(): void {
    this.tooltipText = this.add.text(0, 0, '', {
      fontSize: '12px',
      color: UI.text,
      fontFamily: 'monospace',
      wordWrap: { width: 300 },
      padding: { x: 10, y: 8 },
      backgroundColor: '#101018',
    });
    this.tooltip = this.add.container(0, 0, [this.tooltipText]).setDepth(20).setVisible(false);
  }

  private bindCardHover(card: CardView): void {
    card.on('pointerover', () => {
      const sk = card.skill;
      const kind = sk.element ? ` · ${sk.element}` : sk.weapon ? ` · ${sk.weapon}` : '';
      const lines = [
        `${sk.name}  [${sk.rarity}] · ${sk.tier.toUpperCase()} PL${powerLevel(sk)}`,
        `${sk.archetypes.join(' + ')} · ${sk.property}${kind} · size ${sk.size} · weight ${sk.speedWeight ?? sk.size * 10}`,
        sk.size > 1 ? `spans ${sk.size} turns when cast` : 'spans 1 turn',
        '',
        sk.text,
      ];
      this.tooltipText.setText(lines.join('\n'));
      const tx = Math.min(card.x + 20, 1280 - 330);
      const ty = Math.max(20, card.y - CARD_H - 40);
      this.tooltip.setPosition(tx, ty).setVisible(true);
    });
    card.on('pointerout', () => this.tooltip.setVisible(false));
  }

  // ---------- buttons ----------

  private buildButtons(): void {
    const fight = this.add
      .text(1130, 640, '⚔ FIGHT', {
        fontSize: '26px',
        color: '#ffffff',
        backgroundColor: '#7a2222',
        padding: { x: 18, y: 12 },
        fontFamily: 'monospace',
        fontStyle: 'bold',
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });
    fight.on('pointerover', () => fight.setBackgroundColor('#a03030'));
    fight.on('pointerout', () => fight.setBackgroundColor('#7a2222'));
    fight.on('pointerdown', () => {
      if (demoState.pieces.length === 0) return;
      this.scene.start('Battle');
    });

    const clear = this.add
      .text(1130, 585, 'clear board', {
        fontSize: '13px',
        color: UI.textDim,
        backgroundColor: '#24242e',
        padding: { x: 8, y: 5 },
        fontFamily: 'monospace',
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });
    clear.on('pointerdown', () => {
      demoState.pieces = [];
      this.renderBoard();
    });

    const cards = this.add
      .text(1130, 510, '🃏 card library', {
        fontSize: '13px',
        color: UI.textDim,
        backgroundColor: '#24242e',
        padding: { x: 8, y: 5 },
        fontFamily: 'monospace',
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });
    cards.on('pointerdown', () => this.scene.start('Cards'));

    const heroStats = BASE_HERO_STATS;
    this.add.text(
      24,
      704,
      `HERO — HP ${heroStats.maxHp} · ATK ${heroStats.attack} · MPW ${heroStats.magicPower} · ARM ${heroStats.armor} · RES ${heroStats.magicResist} · SPD ${heroStats.speed} · CRIT ${heroStats.critPct}%`,
      { fontSize: '12px', color: UI.textDim, fontFamily: 'monospace' },
    );
  }
}
