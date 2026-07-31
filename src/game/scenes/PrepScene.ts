import { Container, Graphics, Text, type Container as PixiContainer, type FederatedPointerEvent } from 'pixi.js';
import { powerLevel } from '../../engine/balance';
import { ELEMENT_BEATS, WEAPON_BEATS } from '../../engine/elements';
import { ELEMENT_ICON, WEAPON_ICON } from '../theme';
import { skillBook } from '../../data/skills';
import { enemies } from '../../data/enemies';
import { BASE_HERO_STATS, HERO_BOARD_SLOTS } from '../../data/heroes';
import { canPlace, clampSlot } from '../../run/loadout';
import type { BoardPiece } from '../../engine/types';
import { demoState } from '../demoState';
import { CardView, SLOT_W, CARD_H } from '../ui/CardView';
import { UI } from '../theme';
import { Scene } from '../pixi/Scene';
import { makeText, TextButton } from '../pixi/ui';

const BOARD_Y = 400;
const BOARD_X = (1280 - HERO_BOARD_SLOTS * SLOT_W) / 2;
const POOL_Y = 560;

interface DragSource {
  fromBoard: boolean;
  piece?: BoardPiece;
  skillId: string;
}

export class PrepScene extends Scene {
  private slotRects: Graphics[] = [];
  private boardCards: CardView[] = [];
  private poolCards: CardView[] = [];
  private enemyPreview: PixiContainer[] = [];
  private tooltip!: Container;
  private tooltipBg!: Graphics;
  private tooltipText!: Text;
  private dragGhost: CardView | null = null;
  private dragSource: DragSource | null = null;
  private dragOffset = { x: 0, y: 0 };

  create(): void {
    const title = makeText('WORLD1 — combat demo', { size: 26, bold: true });
    title.position.set(24, 16);
    this.addChild(title);
    const subtitle = makeText('arrange your board · pick an enemy · fight', { size: 13, color: UI.textDim });
    subtitle.position.set(24, 48);
    this.addChild(subtitle);

    this.buildEnemyPicker();
    this.buildBoardSlots();
    this.buildTooltip();
    this.renderBoard();
    this.renderPool();
    this.renderEnemyPreview();
    this.buildButtons();

    const boardHint = makeText('YOUR BOARD — left to right = cast order · touching cards share auras', {
      size: 12,
      color: UI.textDim,
    });
    boardHint.position.set(BOARD_X, BOARD_Y - CARD_H / 2 - 22);
    this.addChild(boardHint);

    // Drag moves/releases are handled scene-wide so a fast pointer can't
    // escape the card mid-drag.
    this.on('pointermove', (e: FederatedPointerEvent) => {
      if (!this.dragGhost) return;
      const p = this.toLocal(e.global);
      this.moveDrag(p.x + this.dragOffset.x, p.y + this.dragOffset.y);
    });
    this.on('pointerup', () => this.endDrag());
    this.on('pointerupoutside', () => this.endDrag());
  }

  // ---------- board ----------

  private paintSlot(g: Graphics, fill: number): void {
    g.clear()
      .rect(-(SLOT_W - 4) / 2, -(CARD_H + 8) / 2, SLOT_W - 4, CARD_H + 8)
      .fill(fill)
      .stroke({ width: 1, color: 0x44444f });
  }

  private buildBoardSlots(): void {
    for (let s = 0; s < HERO_BOARD_SLOTS; s++) {
      const rect = new Graphics();
      this.paintSlot(rect, UI.slot);
      rect.position.set(BOARD_X + s * SLOT_W + SLOT_W / 2, BOARD_Y);
      this.addChild(rect);
      this.slotRects.push(rect);
      const num = makeText(String(s + 1), { size: 10, color: UI.textDim });
      num.anchor.set(0.5);
      num.position.set(rect.x, BOARD_Y + CARD_H / 2 + 16);
      this.addChild(num);
    }
  }

  private renderBoard(): void {
    for (const c of this.boardCards) c.destroy();
    this.boardCards = [];
    for (const piece of demoState.pieces) {
      const skill = skillBook[piece.skillId];
      if (!skill) continue;
      const x = BOARD_X + piece.slot * SLOT_W + (skill.size * SLOT_W) / 2;
      const card = new CardView(skill);
      card.position.set(x, BOARD_Y);
      this.addChild(card);
      this.bindCardHover(card);
      this.bindCardDrag(card, () => ({ fromBoard: true, piece, skillId: piece.skillId }));
      this.boardCards.push(card);
    }
  }

  // ---------- pool ----------

  private renderPool(): void {
    for (const c of this.poolCards) c.destroy();
    this.poolCards = [];
    const poolHint = makeText('CARD POOL — drag onto your board (drag off the board to remove)', {
      size: 12,
      color: UI.textDim,
    });
    poolHint.position.set(24, POOL_Y - CARD_H / 2 - 4);
    poolHint.zIndex = 1;
    this.addChild(poolHint);

    const ids = Object.keys(skillBook).sort();
    let x = 40;
    let y = POOL_Y + 18;
    for (const id of ids) {
      const skill = skillBook[id]!;
      const w = skill.size * SLOT_W * 0.72;
      if (x + w > 1020) {
        x = 40;
        y += CARD_H * 0.72 + 14;
      }
      const card = new CardView(skill, { mini: true });
      card.scale.set(0.72);
      card.position.set(x + w / 2, y);
      this.addChild(card);
      this.bindCardHover(card);
      this.bindCardDrag(card, () => ({ fromBoard: false, skillId: id }));
      this.poolCards.push(card);
      x += w + 12;
    }
  }

  // ---------- drag & drop ----------

  private bindCardDrag(card: CardView, source: () => DragSource): void {
    card.eventMode = 'static';
    card.cursor = 'pointer';
    card.on('pointerdown', (e: FederatedPointerEvent) => {
      const p = this.toLocal(e.global);
      this.dragOffset = { x: card.x - p.x, y: card.y - p.y };
      this.startDrag(source(), card.x, card.y);
    });
  }

  private startDrag(source: DragSource, x: number, y: number): void {
    this.dragSource = source;
    const skill = skillBook[source.skillId]!;
    this.dragGhost = new CardView(skill);
    this.dragGhost.position.set(x, y);
    this.dragGhost.alpha = 0.85;
    this.dragGhost.zIndex = 10;
    // The ghost must never swallow the pointer events driving it.
    this.dragGhost.eventMode = 'none';
    this.addChild(this.dragGhost);
    this.tooltip.visible = false;
  }

  private moveDrag(x: number, y: number): void {
    if (!this.dragGhost || !this.dragSource) return;
    this.dragGhost.position.set(x, y);
    this.paintSlots();
  }

  private targetSlot(): number | null {
    if (!this.dragGhost || !this.dragSource) return null;
    const { x, y } = this.dragGhost;
    if (Math.abs(y - BOARD_Y) > CARD_H) return null;
    const skill = skillBook[this.dragSource.skillId]!;
    const raw = (x - BOARD_X - (skill.size * SLOT_W) / 2) / SLOT_W;
    return clampSlot(raw, this.dragSource.skillId, skillBook, HERO_BOARD_SLOTS);
  }

  private paintSlots(): void {
    for (const rect of this.slotRects) this.paintSlot(rect, UI.slot);
    const slot = this.targetSlot();
    if (slot === null || !this.dragSource) return;
    const skill = skillBook[this.dragSource.skillId]!;
    const ok = canPlace(demoState.pieces, skillBook, this.dragSource.skillId, slot, HERO_BOARD_SLOTS, this.dragSource.piece);
    for (let s = slot; s < slot + skill.size; s++) {
      const rect = this.slotRects[s];
      if (rect) this.paintSlot(rect, ok ? 0x2e4433 : 0x4a2e2e);
    }
  }

  private endDrag(): void {
    const slot = this.targetSlot();
    const source = this.dragSource;
    this.dragGhost?.destroy();
    this.dragGhost = null;
    this.dragSource = null;
    for (const rect of this.slotRects) this.paintSlot(rect, UI.slot);
    if (!source) return;

    if (slot !== null && canPlace(demoState.pieces, skillBook, source.skillId, slot, HERO_BOARD_SLOTS, source.piece)) {
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
      const label = `${def.isBoss ? '👑 ' : def.isElite ? '★ ' : ''}${def.name}`;
      const selected = demoState.enemyId === id;
      const btn = new TextButton(label, {
        size: 13,
        color: selected ? '#ffd76a' : UI.text,
        bg: selected ? 0x3a3a1a : 0x24242e,
      });
      btn.position.set(x, y);
      this.addChild(btn);
      btn.on('pointerdown', () => {
        demoState.enemyId = id;
        this.mgr.restart();
      });
      x += btn.bgWidth + 10;
    }
  }

  private renderEnemyPreview(): void {
    for (const obj of this.enemyPreview) obj.destroy();
    this.enemyPreview = [];
    const def = enemies[demoState.enemyId]!;
    const s = def.stats;
    const statText = makeText(
      `${def.name} — HP ${s.maxHp} · ATK ${s.attack} · MPW ${s.magicPower} · ARM ${s.armor} · RES ${s.magicResist} · SPD ${s.speed} · CRIT ${s.critPct}%`,
      { size: 13 },
    );
    statText.position.set(24, 132);
    this.addChild(statText);
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
      const affText = makeText(affinities.join('   '), { size: 12, color: '#ffd76a' });
      affText.position.set(560, 158);
      this.addChild(affText);
      this.enemyPreview.push(affText);
    }
    const previewY = 205;
    const startX = 24 + (SLOT_W * 0.6) / 2;
    for (const piece of def.pieces) {
      const skill = skillBook[piece.skillId];
      if (!skill) continue;
      const card = new CardView(skill, { mini: true });
      card.scale.set(0.6);
      card.position.set(startX + piece.slot * SLOT_W * 0.6 + ((skill.size - 1) * SLOT_W * 0.6) / 2, previewY);
      this.addChild(card);
      this.bindCardHover(card);
      this.enemyPreview.push(card);
    }
    const label = makeText("ENEMY'S BOARD:", { size: 11, color: UI.textDim });
    label.position.set(24, 158);
    this.addChild(label);
    this.enemyPreview.push(label);
  }

  // ---------- tooltip ----------

  private buildTooltip(): void {
    this.tooltipBg = new Graphics();
    this.tooltipText = makeText('', { size: 12, wrapWidth: 300 });
    this.tooltipText.position.set(10, 8);
    this.tooltip = new Container();
    this.tooltip.addChild(this.tooltipBg, this.tooltipText);
    this.tooltip.zIndex = 20;
    this.tooltip.visible = false;
    this.tooltip.eventMode = 'none';
    this.addChild(this.tooltip);
  }

  private bindCardHover(card: CardView): void {
    card.eventMode = 'static';
    card.on('pointerover', () => {
      if (this.dragGhost) return;
      const sk = card.skill;
      const kind = sk.element ? ` · ${sk.element}` : sk.weapon ? ` · ${sk.weapon}` : '';
      const lines = [
        `${sk.name}  [${sk.rarity}] · ${sk.tier.toUpperCase()} PL${powerLevel(sk)}`,
        `${sk.archetypes.join(' + ')} · ${sk.property}${kind} · size ${sk.size} · weight ${sk.speedWeight ?? sk.size * 10}`,
        sk.size > 1 ? `spans ${sk.size} turns when cast` : 'spans 1 turn',
        '',
        sk.text,
      ];
      this.tooltipText.text = lines.join('\n');
      this.tooltipBg
        .clear()
        .rect(0, 0, this.tooltipText.width + 20, this.tooltipText.height + 16)
        .fill(0x101018);
      const tx = Math.min(card.x + 20, 1280 - 330);
      const ty = Math.max(20, card.y - CARD_H - 40);
      this.tooltip.position.set(tx, ty);
      this.tooltip.visible = true;
    });
    card.on('pointerout', () => {
      this.tooltip.visible = false;
    });
  }

  // ---------- buttons ----------

  private buildButtons(): void {
    const fight = new TextButton('⚔ FIGHT', {
      size: 26,
      color: '#ffffff',
      bg: 0x7a2222,
      padX: 18,
      padY: 12,
      bold: true,
    }).center();
    fight.position.set(1130, 640);
    this.addChild(fight);
    fight.on('pointerover', () => fight.setBg(0xa03030));
    fight.on('pointerout', () => fight.setBg(0x7a2222));
    fight.on('pointerdown', () => {
      if (demoState.pieces.length === 0) return;
      this.mgr.start('Battle');
    });

    const clear = new TextButton('clear board', { size: 13, color: UI.textDim, bg: 0x24242e }).center();
    clear.position.set(1130, 585);
    this.addChild(clear);
    clear.on('pointerdown', () => {
      demoState.pieces = [];
      this.renderBoard();
    });

    const seedBtn = new TextButton(`seed ${demoState.seed} ↻`, { size: 13, color: UI.textDim, bg: 0x24242e }).center();
    seedBtn.position.set(1130, 550);
    this.addChild(seedBtn);
    seedBtn.on('pointerdown', () => {
      demoState.seed = Math.floor(Math.random() * 1_000_000);
      seedBtn.setLabel(`seed ${demoState.seed} ↻`);
    });

    const heroStats = BASE_HERO_STATS;
    const heroText = makeText(
      `HERO — HP ${heroStats.maxHp} · ATK ${heroStats.attack} · MPW ${heroStats.magicPower} · ARM ${heroStats.armor} · RES ${heroStats.magicResist} · SPD ${heroStats.speed} · CRIT ${heroStats.critPct}%`,
      { size: 12, color: UI.textDim },
    );
    heroText.position.set(24, 688);
    this.addChild(heroText);
  }
}
