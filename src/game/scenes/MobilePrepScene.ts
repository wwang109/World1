import Phaser from 'phaser';
import { applyTier } from '../../engine/cards';
import { skillBook } from '../../data/skills';
import { enemies } from '../../data/enemies';
import type { SkillDef } from '../../engine/types';
import { buildEnemyEncounter, ENEMY_TITLES, TITLE_PRESETS, type EnemyTitle } from '../../run/encounter';
import { damagePerTurn } from '../../run/analysis';
import { demoState } from '../demoState';
import { FONT, SCREEN, UI } from '../theme';
import { BoardColumn, type ColumnPiece } from '../ui/BoardColumn';

/** Mobile Prep screen — vertical: tabs · enemy sheet · YOUR DECK vs ENEMY
 *  SKILLS columns (shared BoardColumn/CardToken) · FIGHT. Centered phone
 *  frame on the current canvas until the mobile layout profile switches the
 *  canvas size. Reachable at ?scene=mprep. */
export class MobilePrepScene extends Phaser.Scene {
  // Fills the whole canvas — on a phone the FIT-scaled canvas fills the screen.
  private W = SCREEN.width;
  private H = SCREEN.height;
  private ox = 0;
  private oy = 0;

  constructor() { super('MobilePrep'); }

  create(): void {
    this.W = SCREEN.width;
    this.H = SCREEN.height;
    this.ox = 0;
    this.oy = 0;
    this.cameras.main.setBackgroundColor(0x0b1420);

    const title = demoState.enemyTitle;
    const level = demoState.enemyLevel;
    const encounter = buildEnemyEncounter(demoState.enemyId, level, title, demoState.enemyRank);
    const enemyDef = enemies[demoState.enemyId]!;

    this.renderTabs();
    this.renderRoster(enemyDef.name, title, level);
    const sheetBottom = this.renderEnemySheet(encounter, enemyDef.name, title);
    this.renderColumns(encounter, sheetBottom);
    this.renderFooter();
  }

  private x(dx: number): number { return this.ox + dx; }
  private y(dy: number): number { return this.oy + dy; }

  private text(dx: number, dy: number, s: string, size: number, color: string, opts: { bold?: boolean; display?: boolean; align?: string; origin?: [number, number] } = {}): Phaser.GameObjects.Text {
    const t = this.add.text(this.x(dx), this.y(dy), s, {
      fontSize: `${size}px`, color, fontFamily: opts.display ? FONT.display : FONT.body,
      fontStyle: opts.bold ? 'bold' : 'normal', align: opts.align ?? 'left',
    });
    const [ox, oy] = opts.origin ?? [0, 0];
    return t.setOrigin(ox, oy);
  }

  private button(dx: number, dy: number, w: number, h: number, label: string, fill: number, color: string, onClick: () => void, size = 12): void {
    const r = this.add.rectangle(this.x(dx), this.y(dy), w, h, fill).setOrigin(0, 0).setStrokeStyle(1, UI.border, 0.7).setInteractive({ useHandCursor: true });
    r.on('pointerdown', onClick);
    this.add.text(this.x(dx) + w / 2, this.y(dy) + h / 2, label, { fontSize: `${size}px`, color, fontFamily: FONT.body, fontStyle: 'bold' }).setOrigin(0.5);
  }

  private renderTabs(): void {
    const tabs: Array<[string, () => void]> = [
      ['PREP', () => {}],
      ['DECK BUILD', () => { demoState.prepView = 'bag'; this.scene.start('Prep'); }],
      ['WIKI', () => { demoState.prepView = 'codex'; this.scene.start('Prep'); }],
    ];
    const w = (this.W - 20 - 12) / 3;
    tabs.forEach(([label, fn], i) => {
      const active = i === 0;
      this.button(10 + i * (w + 6), 8, w, 34, label, active ? 0xb78a46 : 0x131f32, active ? '#1a1208' : UI.textDim, fn, 12);
    });
  }

  private renderRoster(name: string, title: EnemyTitle, level: number): void {
    const w = this.W - 20 - 70;
    const r = this.add.rectangle(this.x(10), this.y(50), w, 34, 0x16233a).setOrigin(0, 0).setStrokeStyle(1, 0xe8b446, 0.9);
    this.text(18, 55, name.toUpperCase(), 11, '#e8e0c8', { bold: true });
    this.text(18, 69, `${title.toUpperCase()} · LV ${level}`, 9, '#9aa4b6', { bold: true });
    void r;
    this.button(10 + w + 6, 50, 64, 34, '+ FOE', 0x131f32, UI.textDim, () => {}, 11);
  }

  private renderEnemySheet(encounter: ReturnType<typeof buildEnemyEncounter>, name: string, title: EnemyTitle): number {
    const top = 92;
    const h = 96;
    this.add.rectangle(this.x(10), this.y(top), this.W - 20, h, 0x101a2a).setOrigin(0, 0).setStrokeStyle(1, 0x2a3a52);
    this.add.rectangle(this.x(10), this.y(top), 5, h, 0xc9a15a).setOrigin(0, 0);
    this.text(20, top + 8, name, 16, '#e8e0c8', { display: true, bold: true });
    this.text(this.W - 20, top + 10, title.toUpperCase(), 9, '#1a1208', { bold: true, origin: [1, 0] })
      .setBackgroundColor('#c9a15a').setPadding(6, 3, 6, 3);
    const s = encounter.setup.stats;
    this.text(20, top + 34, `HP ${s.maxHp} · SPD ${s.speed} · ATK ${s.attack} · MAG ${s.magicPower}`, 11, '#e8e0c8', { bold: true });
    this.text(20, top + 50, `DEF ${s.armor} · RES ${s.magicResist} · CRIT ${s.critPct}%`, 10, '#9aa4b6');
    const band = damagePerTurn(encounter.setup, skillBook, { turns: 8, seeds: 8 });
    this.text(20, top + 66, `DMG/turn ${band.min}–${band.max}`, 12, '#d05c4e', { bold: true });

    // title / LV / RANK knobs
    const knobY = top + 84;
    let kx = 20;
    for (const t of ENEMY_TITLES) {
      const active = t === title;
      const w = 40;
      this.button(kx, knobY - 4, w, 20, t.slice(0, 4).toUpperCase(), active ? 0xc9a15a : 0x16233a, active ? '#1a1208' : UI.textDim, () => {
        demoState.enemyTitle = t; demoState.enemyRank = TITLE_PRESETS[t].rank; this.scene.restart();
      }, 8);
      kx += w + 4;
    }
    return top + h;
  }

  private renderColumns(encounter: ReturnType<typeof buildEnemyEncounter>, sheetBottom: number): void {
    const heroSkills: SkillDef[] = [];
    const heroPieces: ColumnPiece[] = [];
    for (const p of demoState.pieces) {
      const skill = skillBook[p.skillId];
      if (!skill) continue;
      heroPieces.push({ skill, slot: p.slot });
      heroSkills.push(skill);
    }
    const foeSkills: SkillDef[] = [];
    const foePieces: ColumnPiece[] = [];
    for (const p of encounter.setup.pieces) {
      const base = skillBook[p.skillId];
      if (!base) continue;
      const skill = p.tier ? applyTier(base, p.tier) : base;
      foePieces.push({ skill, slot: p.slot });
      foeSkills.push(skill);
    }

    const top = sheetBottom + 22;
    const colH = this.H - (top - this.oy) - 66;
    const colW = (this.W - 20 - 8) / 2;
    this.text(10 + colW / 2, sheetBottom + 6, 'YOUR DECK', 10, '#b78a46', { bold: true, origin: [0.5, 0] });
    this.text(10 + colW + 8 + colW / 2, sheetBottom + 6, 'ENEMY SKILLS', 10, '#b78a46', { bold: true, origin: [0.5, 0] });
    new BoardColumn(this, { x: this.x(10), y: this.y(top), width: colW, height: colH, side: 'left', pieces: heroPieces, deck: heroSkills });
    new BoardColumn(this, { x: this.x(10 + colW + 8), y: this.y(top), width: colW, height: colH, side: 'right', pieces: foePieces, deck: foeSkills });
  }

  private renderFooter(): void {
    const y = this.H - 56;
    const w = this.W - 20;
    this.button(10, y, w / 3 - 4, 40, `SEED ${demoState.seed}`, 0x1b2940, '#e8e0c8', () => {
      demoState.seed = 1 + Math.floor(Math.abs(Math.sin(demoState.seed * 97.13)) * 999999);
      this.scene.restart();
    });
    this.button(10 + w / 3 + 4, y, (w * 2) / 3 - 4, 40, 'FIGHT', 0xb78a46, '#1a1208', () => this.scene.start('Battle'));
  }
}
