import Phaser from 'phaser';
import { simulate } from '../../engine/combat/simulate';
import { applyTier } from '../../engine/cards';
import { skillBook } from '../../data/skills';
import type { CombatEvent } from '../../engine/combat/events';
import type { SkillDef } from '../../engine/types';
import { buildAutoHeroSetup, buildEnemyEncounter } from '../../run/encounter';
import { demoState } from '../demoState';
import { FONT, SCREEN, UI } from '../theme';
import { BoardColumn, type ColumnPiece } from '../ui/BoardColumn';

interface LogLine { tag: string; text: string; }
interface HpSnap { player: number; enemy: number; playerMax: number; enemyMax: number; }

const TAG_COLOR: Record<string, string> = {
  END: '#7a86a0', PLAY: '#4f9e57', HIT: '#d05c4e', BUFF: '#5fb56a',
  DEBUFF: '#a678d8', WAIT: '#c9a15a', DOWN: '#d05c4e', RESULT: '#e8b446',
};

/**
 * Mobile Battle — vertical: log dock (top) · HP block · YOUR DECK vs ENEMY
 * boards (shared BoardColumn) · turn chips + step controls. Runs the real
 * simulate() and steps through turns; tap a turn chip or ‹ › to scrub. Full
 * animated playback/scrubber-drag can layer on later. Reachable at
 * ?scene=mbattle (and Battle-equivalent for mobile).
 */
export class MobileBattleScene extends Phaser.Scene {
  private W = SCREEN.width;
  private H = SCREEN.height;
  private linesByTurn = new Map<number, LogLine[]>();
  private hpByTurn = new Map<number, HpSnap>();
  private turns: number[] = [];
  private idx = 0;
  private heroPieces: ColumnPiece[] = [];
  private heroSkills: SkillDef[] = [];
  private foePieces: ColumnPiece[] = [];
  private foeSkills: SkillDef[] = [];
  private heroName = 'Hero';
  private foeName = 'Foe';
  private outcome = '';

  constructor() { super('MobileBattle'); }

  create(): void {
    this.W = SCREEN.width; this.H = SCREEN.height;
    this.cameras.main.setBackgroundColor(0x0b1420);
    this.buildFight();
    this.idx = 0;
    this.render();
  }

  private skillName(id: string): string { return skillBook[id]?.name ?? id; }

  /** The HIT `D:` math line (locked grammar): base n + (n LABEL) … = total. */
  private formatDmg(c: NonNullable<Extract<CombatEvent, { kind: 'damage' }>['calculation']>): string {
    const stat = c.scalingStat === 'attack' ? 'ATK' : 'MAG';
    const def = c.scalingStat === 'attack' ? 'DEF' : 'RES';
    const terms = [`base ${c.power}`];
    const add = (label: string, v: number): void => { if (v) terms.push(`${v > 0 ? '+' : '−'} (${Math.abs(v)} ${label})`); };
    add(stat, c.baseStat);
    add('BUFF', c.statBonusDamage);
    add('SKILL', c.effectBonusDamage);
    add('IDENTITY', c.identityBonusDamage ?? 0);
    add(def, -c.defense);
    add('CRIT', c.critBonusDamage);
    add('AFFINITY', c.matchupBonusDamage);
    add('RAMP', c.suddenDeathBonusDamage);
    add('GUARD', -c.guardReduction);
    add('BLOCK', -c.shieldBlocked);
    return `D: ${terms.join(' ')} = ${c.hpDamage}`;
  }

  private buildFight(): void {
    const heroEncounter = buildAutoHeroSetup(demoState.heroLevel, demoState.pieces.map((p) => ({ ...p })));
    const hero = heroEncounter.setup;
    const enc = buildEnemyEncounter(demoState.enemyId, demoState.enemyLevel, demoState.enemyTitle, demoState.enemyRank);
    const foe = enc.setup;
    this.heroName = hero.name;
    this.foeName = foe.name;

    for (const p of demoState.pieces) {
      const s = skillBook[p.skillId]; if (!s) continue;
      this.heroPieces.push({ skill: s, slot: p.slot }); this.heroSkills.push(s);
    }
    for (const p of foe.pieces) {
      const base = skillBook[p.skillId]; if (!base) continue;
      const s = p.tier ? applyTier(base, p.tier) : base;
      this.foePieces.push({ skill: s, slot: p.slot }); this.foeSkills.push(s);
    }

    const result = simulate({ playerTeam: [hero], enemyTeam: [foe], skillBook }, demoState.seed);
    this.outcome = result.result === 'win' ? 'VICTORY' : result.result === 'loss' ? 'DEFEAT' : 'DRAW';

    // per-turn log + HP snapshots from the real event stream
    const cur: HpSnap = { player: hero.stats.maxHp, enemy: foe.stats.maxHp, playerMax: hero.stats.maxHp, enemyMax: foe.stats.maxHp };
    const label = (e: Extract<CombatEvent, { side: 'player' | 'enemy' }>): string => (e.side === 'player' ? this.heroName : this.foeName);
    const push = (turn: number, tag: string, text: string): void => {
      const arr = this.linesByTurn.get(turn) ?? [];
      arr.push({ tag, text });
      this.linesByTurn.set(turn, arr);
    };
    for (const e of result.events) {
      switch (e.kind) {
        case 'play': push(e.turn, 'PLAY', `${label(e)} · ${this.skillName(e.skillId)}`); break;
        case 'damage': {
          const dealt = Math.max(0, e.amount - e.blocked);
          if (e.side === 'player') cur.player = e.hpAfter; else cur.enemy = e.hpAfter;
          const hp = e.side === 'player' ? `${e.hpAfter}/${cur.playerMax}` : `${e.hpAfter}/${cur.enemyMax}`;
          if (e.source === 'skill') {
            push(e.turn, 'HIT', `${label(e)} −${dealt}${e.crit ? ' CRIT' : ''} · ${hp}`);
            if (e.calculation) push(e.turn, '', this.formatDmg(e.calculation));
          } else { const cap = e.source.charAt(0).toUpperCase() + e.source.slice(1); push(e.turn, 'DEBUFF', `${cap} · ${label(e)} −${dealt} · ${hp}`); }
          break;
        }
        case 'heal': if (e.side === 'player') cur.player = e.hpAfter; else cur.enemy = e.hpAfter; push(e.turn, 'BUFF', `${label(e)} +${e.amount} HP`); break;
        case 'shieldGain': push(e.turn, 'BUFF', `${label(e)} +${e.amount} shield`); break;
        case 'statusApplied': {
          const buff = e.status === 'buff' || e.status === 'guard' || e.status === 'negate';
          const cap = e.status.charAt(0).toUpperCase() + e.status.slice(1);
          push(e.turn, buff ? 'BUFF' : 'DEBUFF', `${label(e)} · ${cap}${e.stacks ? ` ${e.stacks}` : ''}`);
          break;
        }
        case 'died': push(e.turn, 'DOWN', `${label(e)} falls`); break;
        case 'combatEnd': push(e.turn, 'RESULT', `${this.outcome} · ${e.turns} turns`); break;
        default: break;
      }
      this.hpByTurn.set(e.turn, { ...cur });
    }
    this.turns = [...this.linesByTurn.keys()].sort((a, b) => a - b);
    if (this.turns.length === 0) this.turns = [1];
  }

  private render(): void {
    this.children.removeAll();
    this.cameras.main.setBackgroundColor(0x0b1420);
    const turn = this.turns[this.idx] ?? this.turns[0]!;
    const hp = this.hpByTurn.get(turn) ?? { player: 0, enemy: 0, playerMax: 1, enemyMax: 1 };

    // ---- log dock (top) ----
    const dockH = 210;
    this.add.rectangle(0, 0, this.W, dockH, 0x101a2a).setOrigin(0, 0).setStrokeStyle(2, 0xb78a46, 0.9);
    this.add.text(12, 8, `TURN ${turn}${turn === this.turns[this.turns.length - 1]! ? ` · ${this.outcome}` : ''}`, { fontSize: '13px', color: '#b78a46', fontFamily: FONT.body, fontStyle: 'bold' });
    let ly = 30;
    for (const line of (this.linesByTurn.get(turn) ?? []).slice(0, 10)) {
      if (line.tag === '') {
        // D: math sub-line — dim, indented under its HIT
        this.add.text(64, ly, line.text, { fontSize: '10px', color: '#8a94a6', fontFamily: FONT.body, wordWrap: { width: this.W - 76 }, maxLines: 1 });
        ly += 16;
        continue;
      }
      this.add.text(12, ly, line.tag, { fontSize: '11px', color: TAG_COLOR[line.tag] ?? UI.textDim, fontFamily: FONT.body, fontStyle: 'bold' });
      this.add.text(64, ly, line.text, { fontSize: '12px', color: '#e8e0c8', fontFamily: FONT.body, wordWrap: { width: this.W - 76 }, maxLines: 1 });
      ly += 18;
    }

    // ---- HP block ----
    const hpY = dockH + 8;
    this.hpBar(hpY, this.heroName, hp.player, hp.playerMax, UI.good ?? 0x4f9e57);
    this.hpBar(hpY + 26, this.foeName, hp.enemy, hp.enemyMax, UI.bad ?? 0xb0483c);

    // ---- boards (with a gutter for the vertical scrubber) ----
    const top = hpY + 60;
    const colH = this.H - top - 58;
    const gutterW = 24;
    const colW = (this.W - 20 - gutterW) / 2;
    const deckX = 10; const gutterX = 10 + colW; const bagX = 10 + colW + gutterW;
    this.add.text(deckX + colW / 2, top - 4, 'YOUR DECK', { fontSize: '10px', color: '#b78a46', fontFamily: FONT.body, fontStyle: 'bold' }).setOrigin(0.5, 1);
    this.add.text(bagX + colW / 2, top - 4, this.foeName.toUpperCase(), { fontSize: '10px', color: '#b78a46', fontFamily: FONT.body, fontStyle: 'bold' }).setOrigin(0.5, 1);
    new BoardColumn(this, { x: deckX, y: top, width: colW, height: colH, side: 'left', pieces: this.heroPieces, deck: this.heroSkills });
    new BoardColumn(this, { x: bagX, y: top, width: colW, height: colH, side: 'right', pieces: this.foePieces, deck: this.foeSkills });

    this.renderScrubber(gutterX + gutterW / 2, top, colH);
    this.renderChips();
    this.renderControls();

    // ---- victory / defeat banner on the final turn ----
    if (turn === this.turns[this.turns.length - 1]!) {
      const good = this.outcome === 'VICTORY';
      const by = top + colH / 2 - 26;
      this.add.rectangle(deckX, by, this.W - 20, 52, good ? 0x143a1a : 0x3a1414, 0.92).setOrigin(0, 0).setStrokeStyle(2, good ? 0x4f9e57 : 0xb0483c);
      this.add.text(this.W / 2, by + 26, this.outcome, { fontSize: '26px', color: good ? '#7fe08a' : '#f08a7a', fontFamily: FONT.display, fontStyle: 'bold' }).setOrigin(0.5);
    }
  }

  /** Vertical scrubber in the board gutter: one major tick per turn, a
   *  draggable gold handle. Drag the gutter to scrub turns. */
  private renderScrubber(cx: number, top: number, height: number): void {
    const n = this.turns.length;
    this.add.rectangle(cx, top, 8, height, 0x16233a).setOrigin(0.5, 0).setStrokeStyle(1, 0x2a3a52, 1);
    const yFor = (i: number): number => top + (n <= 1 ? 0 : (i / (n - 1)) * height);
    // fill up to current
    this.add.rectangle(cx, top, 8, yFor(this.idx) - top, 0xb78a46).setOrigin(0.5, 0);
    // major ticks
    for (let i = 0; i < n; i++) {
      this.add.rectangle(cx, yFor(i), 14, 3, i <= this.idx ? 0xb78a46 : 0x3a4a62).setOrigin(0.5, 0.5);
    }
    // handle
    this.add.circle(cx, yFor(this.idx), 11, 0xe8b446).setStrokeStyle(2, 0x1a1208);
    this.add.text(cx, yFor(this.idx) + 15, `T${this.turns[this.idx]}`, { fontSize: '9px', color: '#e8b446', fontFamily: FONT.body, fontStyle: 'bold' }).setOrigin(0.5, 0);
    // wide invisible hit zone for dragging
    const zone = this.add.rectangle(cx, top, 40, height, 0xffffff, 0.001).setOrigin(0.5, 0).setInteractive({ useHandCursor: true });
    const setFromY = (y: number): void => {
      const t = Math.max(0, Math.min(1, (y - top) / height));
      const i = Math.round(t * (n - 1));
      if (i !== this.idx) { this.idx = i; this.render(); }
    };
    zone.on('pointerdown', (p: Phaser.Input.Pointer) => setFromY(p.y));
    zone.on('pointermove', (p: Phaser.Input.Pointer) => { if (p.isDown) setFromY(p.y); });
  }

  private hpBar(y: number, name: string, hp: number, max: number, color: number): void {
    this.add.text(12, y, name.toUpperCase(), { fontSize: '12px', color: '#e8e0c8', fontFamily: FONT.body, fontStyle: 'bold' });
    const barX = 120; const barW = this.W - barX - 80;
    this.add.rectangle(barX, y + 7, barW, 12, 0x1b2431).setOrigin(0, 0.5).setStrokeStyle(1, 0x3a4a62, 0.7);
    this.add.rectangle(barX, y + 7, barW * Math.max(0, Math.min(1, hp / max)), 12, color).setOrigin(0, 0.5);
    this.add.text(this.W - 12, y, `${hp}/${max}`, { fontSize: '12px', color: '#e8e0c8', fontFamily: FONT.body, fontStyle: 'bold' }).setOrigin(1, 0);
  }

  private renderChips(): void {
    const y = this.H - 92;
    const max = 8;
    const start = Math.max(0, Math.min(this.idx - 3, this.turns.length - max));
    const shown = this.turns.slice(start, start + max);
    const cw = (this.W - 20 - 8 * (shown.length - 1)) / Math.max(1, shown.length);
    shown.forEach((t, i) => {
      const active = t === this.turns[this.idx];
      const done = i + start <= this.idx;
      const x = 10 + i * (cw + 8);
      const r = this.add.rectangle(x, y, cw, 26, active ? 0xb78a46 : 0x16233a).setOrigin(0, 0).setStrokeStyle(1, UI.border, 0.6).setInteractive({ useHandCursor: true });
      r.on('pointerdown', () => { this.idx = start + i; this.render(); });
      this.add.text(x + cw / 2, y + 13, `T${t}`, { fontSize: '11px', color: active ? '#1a1208' : done ? '#cdd4de' : '#5a6880', fontFamily: FONT.body, fontStyle: 'bold' }).setOrigin(0.5);
    });
  }

  private renderControls(): void {
    const y = this.H - 52;
    const btn = (x: number, w: number, label: string, fill: number, color: string, fn: () => void): void => {
      const r = this.add.rectangle(x, y, w, 40, fill).setOrigin(0, 0).setStrokeStyle(1, UI.border, 0.7).setInteractive({ useHandCursor: true });
      r.on('pointerdown', fn);
      this.add.text(x + w / 2, y + 20, label, { fontSize: '13px', color, fontFamily: FONT.body, fontStyle: 'bold' }).setOrigin(0.5);
    };
    const third = (this.W - 20 - 16) / 3;
    btn(10, third, '‹ PREV', 0x1b2940, '#e8e0c8', () => { this.idx = Math.max(0, this.idx - 1); this.render(); });
    btn(10 + third + 8, third, 'NEXT ›', 0x1b2940, '#e8e0c8', () => { this.idx = Math.min(this.turns.length - 1, this.idx + 1); this.render(); });
    btn(10 + (third + 8) * 2, third, 'PREP', 0xb78a46, '#1a1208', () => this.scene.start('MobilePrep'));
  }
}
