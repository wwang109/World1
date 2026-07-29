import Phaser from 'phaser';
import { applyTier } from '../../engine/cards';
import { skillBook } from '../../data/skills';
import { enemies } from '../../data/enemies';
import type { SkillDef } from '../../engine/types';
import { buildAutoHeroSetup, buildEnemyEncounter, ENEMY_MODIFIER_IDS, ENEMY_TITLES, maxRankFor, MODIFIER_PRESETS, TITLE_PRESETS, type EnemyTitle } from '../../run/encounter';
import { bankedPL, LEVEL_STAT_COST, spentPL, totalLevelPL, type LevelStat } from '../../run/leveling';
import { cachedDamageBand } from '../battleApi';
import { setBattleContext } from '../battleContext';
import { demoState, MAX_FOES, syncPrimaryFoe, type EnemyFightConfig } from '../demoState';
import { DESKTOP_PROFILE } from '../layoutProfile';
import { FONT, SCREEN, UI } from '../theme';
import { BoardColumn, type ColumnPiece } from '../ui/BoardColumn';
import { DESKTOP_LAYOUT, renderDesktopBackground, renderDesktopHeader } from '../ui/DesktopNav';
import { rebuildScene } from '../sceneRebuild';

const F = DESKTOP_PROFILE.font;

/** Left "choose fight" panel geometry. */
const PANEL_X = 32;
const PANEL_W = 436;
const PANEL_PAD = 20;

/** Bottom FIGHT bar. */
const FIGHT_H = 64;
const CONTENT_BOTTOM = 876;

/**
 * Desktop Prep — a fully playable mirror of MobilePrepScene at the 1440x900
 * desktop profile: left "CHOOSE FIGHT" panel (enemy sheet, title chips,
 * LV/RANK steppers, seed) + right YOUR DECK / ENEMY SKILLS board columns +
 * a prominent bottom-right FIGHT button. Dumb playback of demoState/run
 * helpers only — no combat logic lives here.
 */
export class DesktopPrepScene extends Phaser.Scene {
  /** Open foe-picker overlay: 'add' appends a new foe, a number swaps that entry. */
  private picker: 'add' | number | null = null;

  constructor() { super('DesktopPrep'); }

  init(): void {
    this.picker = null;
  }

  /** State changed → rebuild this frame in place (see sceneRebuild.ts). */
  private rerender(): void {
    rebuildScene(this);
  }

  /** The foe entry all panel controls edit. */
  private activeFoe(): EnemyFightConfig {
    return demoState.enemyTeam[demoState.activeFoe] ?? demoState.enemyTeam[0]!;
  }

  create(): void {
    renderDesktopBackground(this);
    renderDesktopHeader(this, 'PREP', 'prep');

    const encounters = demoState.enemyTeam.map((cfg) =>
      buildEnemyEncounter(cfg.enemyId, cfg.level, cfg.title, cfg.rank, cfg.modifiers));
    const activeIdx = Math.min(demoState.activeFoe, encounters.length - 1);
    const encounter = encounters[activeIdx]!;
    const active = this.activeFoe();

    this.renderChooseFightPanel(encounter, enemies[active.enemyId]!.name, active.title, active.level);
    this.renderColumns(encounters);
    this.renderFightButton();
    if (this.picker !== null) this.renderPicker();
  }

  private text(x: number, y: number, s: string, size: number, color: string, opts: { bold?: boolean; display?: boolean; align?: string; origin?: [number, number] } = {}): Phaser.GameObjects.Text {
    const t = this.add.text(x, y, s, {
      fontSize: `${size}px`, color, fontFamily: opts.display ? FONT.display : FONT.body,
      fontStyle: opts.bold ? 'bold' : 'normal', align: opts.align ?? 'left',
    });
    const [ox, oy] = opts.origin ?? [0, 0];
    return t.setOrigin(ox, oy);
  }

  /** Single-line text clamped to `maxW`; overflow is cut with an ellipsis. */
  private clamped(
    x: number, y: number, s: string, size: number, color: string, maxW: number,
    opts: { bold?: boolean; display?: boolean } = {},
  ): Phaser.GameObjects.Text {
    const t = this.text(x, y, s, size, color, opts);
    if (t.width > maxW && s.length > 1) {
      let cut = s;
      while (cut.length > 1 && t.width > maxW) { cut = cut.slice(0, -1); t.setText(`${cut}…`); }
    }
    return t;
  }

  private button(x: number, y: number, w: number, h: number, label: string, fill: number, color: string, onClick: () => void, size = F.small): void {
    const r = this.add.rectangle(x, y, w, h, fill).setOrigin(0, 0).setStrokeStyle(1, UI.border, 0.7).setInteractive({ useHandCursor: true });
    r.on('pointerover', () => r.setFillStyle(UI.slotHover));
    r.on('pointerout', () => r.setFillStyle(fill));
    r.on('pointerdown', onClick);
    this.add.text(x + w / 2, y + h / 2, label, { fontSize: `${size}px`, color, fontFamily: FONT.body, fontStyle: 'bold' }).setOrigin(0.5);
  }

  /** −/value/+ stepper row, buttons 40x40 (min tap target), full-width label + controls. */
  private stepperRow(x: number, y: number, w: number, label: string, value: number, onDelta: (d: number) => void): void {
    this.text(x, y + 10, label, F.label, UI.textDim, { bold: true });
    const btn = 40;
    const valueW = 56;
    const gap = DESKTOP_LAYOUT.gap;
    const minusX = x + w - (btn * 2 + valueW + gap * 2);
    this.button(minusX, y, btn, btn, '−', UI.panelAlt, UI.text, () => onDelta(-1), F.name);
    this.add.rectangle(minusX + btn + gap, y, valueW, btn, UI.panelMuted).setOrigin(0, 0).setStrokeStyle(1, UI.border, 0.6);
    this.text(minusX + btn + gap + valueW / 2, y + btn / 2, `${value}`, F.name, UI.text, { bold: true, origin: [0.5, 0.5] });
    this.button(minusX + btn + gap + valueW + gap, y, btn, btn, '+', UI.panelAlt, UI.text, () => onDelta(1), F.name);
  }

  private renderChooseFightPanel(encounter: ReturnType<typeof buildEnemyEncounter>, name: string, title: EnemyTitle, level: number): void {
    const panelTop = DESKTOP_LAYOUT.contentTop;
    const panelH = CONTENT_BOTTOM - panelTop;
    const innerX = PANEL_X + PANEL_PAD;
    const innerW = PANEL_W - PANEL_PAD * 2;
    const gap = DESKTOP_LAYOUT.gap;

    this.add.rectangle(PANEL_X, panelTop, PANEL_W, panelH, UI.panel, 0.92).setOrigin(0, 0).setStrokeStyle(1, UI.border, 0.8);

    let cursor = panelTop + PANEL_PAD;
    this.text(innerX, cursor, 'CHOOSE FIGHT', F.label, UI.textAccent, { bold: true });
    cursor += F.label + 10;
    this.add.rectangle(innerX, cursor, innerW, 1, UI.border, 0.6).setOrigin(0, 0);
    cursor += 14;

    // Foe chips — one per team entry (max MAX_FOES), in a grid. Click an
    // inactive chip to select it; click the ACTIVE chip to swap in a different
    // enemy; ✕ removes it. The trailing empty cell is + FOE.
    //
    // Columns adapt: 2 across for small teams (roomy, readable), 3 across once
    // there are more than 4 cells. Without that, 5 foes needed three rows and
    // pushed the SEED/REROLL row clean off the 900px canvas.
    void name; void title; void level;
    const chipH = 44;
    const chipRowGap = 8;
    const team = demoState.enemyTeam;
    const cells = Math.min(team.length, MAX_FOES) + (team.length < MAX_FOES ? 1 : 0);
    const chipCols = cells > 4 ? 3 : 2;
    const chipW = (innerW - gap * (chipCols - 1)) / chipCols;
    const chipCell = (i: number): [number, number] =>
      [innerX + (i % chipCols) * (chipW + gap), cursor + Math.floor(i / chipCols) * (chipH + chipRowGap)];
    team.slice(0, MAX_FOES).forEach((cfg, i) => {
      const [cx, cy] = chipCell(i);
      const isActive = i === Math.min(demoState.activeFoe, team.length - 1);
      const chip = this.add.rectangle(cx, cy, chipW, chipH, isActive ? UI.panelAlt : UI.panelMuted)
        .setOrigin(0, 0).setStrokeStyle(isActive ? 2 : 1, isActive ? UI.chip : UI.border, isActive ? 1 : 0.6)
        .setInteractive({ useHandCursor: true });
      chip.on('pointerdown', () => {
        if (isActive) { this.picker = i; } else { demoState.activeFoe = i; }
        this.rerender();
      });
      // Reserve the ✕ badge's corner so long names ("THE WOLF KING") can't run
      // under it — chips get narrower at 3 columns.
      const labelW = chipW - 12 - (team.length > 1 ? 30 : 12);
      this.clamped(cx + 12, cy + 6, enemies[cfg.enemyId]!.name.toUpperCase(), F.small, isActive ? UI.text : UI.textDim, labelW, { bold: true });
      this.clamped(cx + 12, cy + 25, `${cfg.title.toUpperCase()} · LV ${cfg.level}${isActive ? ' · SWAP ⇄' : ''}`, F.tiny, UI.textDim, chipW - 24, { bold: true });
      if (team.length > 1) {
        const remove = this.add.rectangle(cx + chipW - 22, cy + 2, 20, 20, UI.badSoft, 0.9)
          .setOrigin(0, 0).setStrokeStyle(1, UI.bad, 0.8).setInteractive({ useHandCursor: true });
        this.add.text(cx + chipW - 12, cy + 12, '✕', { fontSize: `${F.tiny}px`, color: UI.text, fontFamily: FONT.body, fontStyle: 'bold' }).setOrigin(0.5);
        remove.on('pointerdown', () => {
          demoState.enemyTeam = demoState.enemyTeam.filter((_, idx) => idx !== i);
          syncPrimaryFoe();
          this.rerender();
        });
      }
    });
    if (team.length < MAX_FOES) {
      const [ax, ay] = chipCell(cells - 1);
      this.button(ax, ay, chipW, chipH, `+ FOE (${team.length}/${MAX_FOES})`, UI.panelAlt, UI.textAccent, () => {
        this.picker = 'add';
        this.rerender();
      }, F.label);
    }
    cursor += Math.ceil(cells / chipCols) * (chipH + chipRowGap) + 4;

    // Live stat sheet + damage/turn band (reflects title/LV/RANK/modifiers).
    const s = encounter.setup.stats;
    this.text(innerX, cursor, `HP ${s.maxHp} · SPD ${s.speed} · ATK ${s.attack} · MAG ${s.magicPower}`, F.body, UI.text, { bold: true });
    cursor += F.body + 7;
    this.text(innerX, cursor, `DEF ${s.armor} · RES ${s.magicResist} · ${encounter.setup.pieces.length} cards`, F.small, UI.textDim);
    cursor += F.small + 7;
    const bandText = this.text(innerX, cursor, 'DMG/turn …', F.body, UI.textAccent, { bold: true });
    cachedDamageBand(encounter.setup, { turns: 8, seeds: 8 }).then((band) => {
      if (!this.scene.isActive() || !bandText.active) return;
      bandText.setText(`DMG/turn ${band.min}–${band.max}`);
    }).catch(() => {
      if (!this.scene.isActive() || !bandText.active) return;
      bandText.setText('DMG/turn n/a').setColor(UI.textDim);
    });
    cursor += F.body + 12;

    // Title chips.
    this.text(innerX, cursor, 'TITLE', F.tiny, UI.textDim, { bold: true });
    cursor += F.tiny + 6;
    const chipGap = 6;
    const titleChipW = (innerW - chipGap * (ENEMY_TITLES.length - 1)) / ENEMY_TITLES.length;
    const titleChipH = 32;
    const foe = this.activeFoe();
    ENEMY_TITLES.forEach((t, i) => {
      const active = t === title;
      this.button(
        innerX + i * (titleChipW + chipGap), cursor, titleChipW, titleChipH,
        t.toUpperCase(), active ? UI.chip : UI.panelAlt, active ? UI.textOnChip : UI.textDim,
        () => { foe.title = t; foe.rank = TITLE_PRESETS[t].rank; syncPrimaryFoe(); this.rerender(); },
        F.tiny,
      );
    });
    cursor += titleChipH + 12;

    // Modifier chips — rogue-like affixes, multi-select toggles (per foe).
    this.text(innerX, cursor, 'MODIFIERS', F.tiny, UI.textDim, { bold: true });
    cursor += F.tiny + 6;
    const modChipW = (innerW - chipGap * (ENEMY_MODIFIER_IDS.length - 1)) / ENEMY_MODIFIER_IDS.length;
    ENEMY_MODIFIER_IDS.forEach((id, i) => {
      const active = foe.modifiers.includes(id);
      this.button(
        innerX + i * (modChipW + chipGap), cursor, modChipW, titleChipH,
        MODIFIER_PRESETS[id]!.name, active ? UI.chip : UI.panelAlt, active ? UI.textOnChip : UI.textDim,
        () => {
          foe.modifiers = active ? foe.modifiers.filter((m) => m !== id) : [...foe.modifiers, id];
          syncPrimaryFoe();
          this.rerender();
        },
        F.tiny,
      );
    });
    cursor += titleChipH + 12;

    // LV / RANK steppers (per foe). Rank caps at deckSize × 3 (every card
    // Diamond); a tier-forcing modifier (DIAMOND-POWERED) pins it at that
    // cap, so the stepper shows the RESOLVED rank and goes inert while the
    // affix owns it.
    this.stepperRow(innerX, cursor, innerW, 'LV', foe.level, (d) => {
      foe.level = Math.max(1, foe.level + d); syncPrimaryFoe(); this.rerender();
    });
    cursor += 40 + 8;
    const rankCap = maxRankFor(encounter.setup.pieces.length);
    const tierForced = foe.modifiers.some((id) => MODIFIER_PRESETS[id]?.forceTier !== undefined);
    const rankLabel = tierForced ? `RANK · MAXED BY ${foe.modifiers.find((id) => MODIFIER_PRESETS[id]?.forceTier)?.toUpperCase()}` : `RANK · MAX ${rankCap}`;
    this.stepperRow(innerX, cursor, innerW, rankLabel, encounter.rank, (d) => {
      if (tierForced) return;
      foe.rank = Math.max(0, Math.min(rankCap, encounter.rank + d));
      syncPrimaryFoe();
      this.rerender();
    });
    cursor += 40 + 12;

    this.add.rectangle(innerX, cursor, innerW, 1, UI.border, 0.6).setOrigin(0, 0);
    cursor += 12;

    cursor = this.renderHeroSection(innerX, cursor, innerW);

    this.add.rectangle(innerX, cursor, innerW, 1, UI.border, 0.6).setOrigin(0, 0);
    cursor += 12;

    // Seed + reroll — single row: label · value box · REROLL. Anchored so it
    // can never leave the panel: the foe grid above grows with the team (5 foes
    // added ~104px), which used to push this row to y=917 on a 900px canvas —
    // invisible, with no way to reroll.
    const seedLabelW = 46;
    const rerollW = 88;
    const seedRowH = 40;
    const seedBoxW = innerW - seedLabelW - rerollW - gap * 2;
    // Pad of 4, not 12: at 5 foes the clamp has to pull the row up, and a
    // larger pad drags it over the stat-cost hint line just above.
    const seedY = Math.min(cursor, CONTENT_BOTTOM - seedRowH - 4);
    this.text(innerX, seedY + 20, 'SEED', F.tiny, UI.textDim, { bold: true, origin: [0, 0.5] });
    this.add.rectangle(innerX + seedLabelW + gap, seedY, seedBoxW, seedRowH, UI.panelMuted).setOrigin(0, 0).setStrokeStyle(1, UI.border, 0.6);
    this.text(innerX + seedLabelW + gap + 12, seedY + 20, `${demoState.seed}`, F.name, UI.text, { bold: true, origin: [0, 0.5] });
    this.button(innerX + innerW - rerollW, seedY, rerollW, seedRowH, 'REROLL', UI.chip, UI.textOnChip, () => {
      demoState.seed = 1 + Math.floor(Math.abs(Math.sin(demoState.seed * 97.13)) * 999999);
      this.rerender();
    }, F.small);
  }

  /**
   * HERO stat-selection: level stepper + the PL-budget stat sheet. Every
   * level banks PL_PER_LEVEL PL; each stat buy spends through the priced
   * LEVEL_STAT_COST table via demoState.heroAllocation (the guarded
   * applyPlayerLevelAllocation path consumes it when building the fight).
   * Returns the next free y.
   */
  private renderHeroSection(x: number, y: number, w: number): number {
    const gap = DESKTOP_LAYOUT.gap;
    const level = demoState.heroLevel;
    const alloc = demoState.heroAllocation;
    const banked = bankedPL(level, alloc);

    this.text(x, y, 'HERO', F.tiny, UI.textAccent, { bold: true });
    this.text(x + w, y, `PL ${spentPL(alloc)}/${totalLevelPL(level)} SPENT · ${banked} BANKED`, F.tiny, banked > 0 ? UI.textAccent : UI.textDim, { bold: true, origin: [1, 0] });
    let cursor = y + F.tiny + 8;

    this.stepperRow(x, cursor, w, 'LV', level, (d) => {
      const next = Math.max(1, level + d);
      demoState.heroLevel = next;
      // Lowering the level can strand more buys than the new budget allows —
      // un-buy (cheapest-last stat order) until the spend fits again, so the
      // guarded applyPlayerLevelAllocation path never throws.
      const order: LevelStat[] = ['speed', 'magicResist', 'armor', 'magicPower', 'attack', 'maxHp'];
      while (bankedPL(next, demoState.heroAllocation) < 0) {
        const stat = order.find((st) => (demoState.heroAllocation[st] ?? 0) > 0);
        if (!stat) break;
        demoState.heroAllocation[stat] = (demoState.heroAllocation[stat] ?? 0) - 1;
      }
      this.rerender();
    });
    cursor += 40 + 10;

    // 2×3 stat allocation grid. Each cell: [−] LABEL +gained [+].
    const rows: Array<[LevelStat, string]> = [
      ['maxHp', 'HP'], ['attack', 'ATK'], ['magicPower', 'MAG'],
      ['armor', 'DEF'], ['magicResist', 'RES'], ['speed', 'SPD'],
    ];
    const cellW = (w - gap) / 2;
    const cellH = 32;
    const btn = 32;
    rows.forEach(([stat, label], i) => {
      const col = i % 2;
      const row = Math.floor(i / 2);
      const cx = x + col * (cellW + gap);
      const cy = cursor + row * (cellH + 6);
      const buys = alloc[stat] ?? 0;
      const cost = LEVEL_STAT_COST[stat];
      const canBuy = banked >= cost.pl;
      const canSell = buys > 0;

      this.add.rectangle(cx + btn + 4, cy, cellW - (btn + 4) * 2, cellH, UI.panelMuted, 0.7).setOrigin(0, 0).setStrokeStyle(1, UI.border, 0.4);
      this.text(cx + btn + 14, cy + cellH / 2, label, F.small, UI.textDim, { bold: true, origin: [0, 0.5] });
      const gained = buys * cost.gain;
      this.text(cx + cellW - btn - 14, cy + cellH / 2, gained > 0 ? `+${gained}` : '·', F.small, gained > 0 ? UI.textAccent : UI.textSoft, { bold: true, origin: [1, 0.5] });
      if (canSell) {
        this.button(cx, cy, btn, cellH, '−', UI.panelAlt, UI.text, () => {
          demoState.heroAllocation[stat] = buys - 1; this.rerender();
        }, F.body);
      } else {
        this.add.rectangle(cx, cy, btn, cellH, UI.panelMuted, 0.4).setOrigin(0, 0).setStrokeStyle(1, UI.border, 0.25);
        this.text(cx + btn / 2, cy + cellH / 2, '−', F.body, UI.textSoft, { origin: [0.5, 0.5] });
      }
      if (canBuy) {
        this.button(cx + cellW - btn, cy, btn, cellH, '+', UI.panelAlt, UI.text, () => {
          demoState.heroAllocation[stat] = buys + 1; this.rerender();
        }, F.body);
      } else {
        this.add.rectangle(cx + cellW - btn, cy, btn, cellH, UI.panelMuted, 0.4).setOrigin(0, 0).setStrokeStyle(1, UI.border, 0.25);
        this.text(cx + cellW - btn / 2, cy + cellH / 2, '+', F.body, UI.textSoft, { origin: [0.5, 0.5] });
      }
    });
    cursor += 3 * (cellH + 6) + 6;
    this.text(x, cursor, `+${LEVEL_STAT_COST.maxHp.gain} HP per buy · SPD costs ${LEVEL_STAT_COST.speed.pl} PL, others 1`, F.tiny, UI.textSoft);
    cursor += F.tiny + 12;
    return cursor;
  }

  private renderColumns(encounters: Array<ReturnType<typeof buildEnemyEncounter>>): void {
    const gap = DESKTOP_LAYOUT.gap;
    const rightX = PANEL_X + PANEL_W + gap;
    const rightW = (SCREEN.width - DESKTOP_LAYOUT.gutter) - rightX;
    const labelY = DESKTOP_LAYOUT.contentTop;
    const colTop = labelY + F.label + 8;
    const colBottom = CONTENT_BOTTOM - FIGHT_H - gap;
    const colH = colBottom - colTop;
    const colW = (rightW - gap) / 2;
    const leftColX = rightX;
    const rightColX = rightX + colW + gap;

    this.text(leftColX + colW / 2, labelY, 'YOUR DECK', F.label, UI.textAccent, { bold: true, origin: [0.5, 0] });
    this.text(rightColX + colW / 2, labelY, encounters.length > 1 ? `ENEMY SKILLS · ${encounters.length} FOES` : 'ENEMY SKILLS', F.label, UI.textAccent, { bold: true, origin: [0.5, 0] });

    const heroSkills: SkillDef[] = [];
    const heroPieces: ColumnPiece[] = [];
    for (const p of demoState.pieces) {
      const skill = skillBook[p.skillId];
      if (!skill) continue;
      heroPieces.push({ skill, slot: p.slot });
      heroSkills.push(skill);
    }
    const heroStats = buildAutoHeroSetup(demoState.heroLevel, demoState.pieces.map((p) => ({ ...p })), demoState.heroAllocation).setup.stats;
    new BoardColumn(this, {
      x: leftColX, y: colTop, width: colW, height: colH, side: 'left',
      pieces: heroPieces, deck: heroSkills, stats: { attack: heroStats.attack, magicPower: heroStats.magicPower },
    });

    const foeBoard = (encounter: ReturnType<typeof buildEnemyEncounter>, y: number, h: number): void => {
      const foeSkills: SkillDef[] = [];
      const foePieces: ColumnPiece[] = [];
      for (const p of encounter.setup.pieces) {
        const base = skillBook[p.skillId];
        if (!base) continue;
        const skill = p.tier ? applyTier(base, p.tier) : base;
        foePieces.push({ skill, slot: p.slot });
        foeSkills.push(skill);
      }
      const foeStats = encounter.setup.stats;
      new BoardColumn(this, {
        x: rightColX, y, width: colW, height: h, side: 'right',
        pieces: foePieces, deck: foeSkills, stats: { attack: foeStats.attack, magicPower: foeStats.magicPower },
      });
    };

    if (encounters.length <= 2) {
      // Up to 2 foes fit side by side as full boards, stacked vertically.
      const bandH = encounters.length > 1 ? 18 : 0;
      const subH = (colH - (encounters.length - 1) * gap) / encounters.length;
      encounters.forEach((encounter, i) => {
        const top = colTop + i * (subH + gap);
        if (bandH > 0) {
          this.text(rightColX + colW - 2, top, enemies[encounter.enemyId]!.name.toUpperCase(), F.tiny, UI.textDim, { bold: true, origin: [1, 0] });
        }
        foeBoard(encounter, top + bandH, subH - bandH);
      });
    } else {
      // 3+ foes: a tab per foe (click to inspect), one full board for the
      // ACTIVE foe — mirrors the battle scene's tabbed enemy panel.
      const tabH = 34;
      const tabGap = 6;
      const tabW = (colW - tabGap * (encounters.length - 1)) / encounters.length;
      const activeIdx = Math.min(demoState.activeFoe, encounters.length - 1);
      encounters.forEach((encounter, i) => {
        const tx = rightColX + i * (tabW + tabGap);
        const isActive = i === activeIdx;
        const tab = this.add.rectangle(tx, colTop, tabW, tabH, isActive ? UI.panelAlt : UI.panelMuted)
          .setOrigin(0, 0).setStrokeStyle(isActive ? 2 : 1, isActive ? UI.chip : UI.border, isActive ? 1 : 0.6)
          .setInteractive({ useHandCursor: true });
        tab.on('pointerdown', () => { demoState.activeFoe = i; this.rerender(); });
        const label = this.add.text(tx + tabW / 2, colTop + tabH / 2, enemies[encounter.enemyId]!.name.toUpperCase(), {
          fontSize: `${F.tiny}px`, color: isActive ? UI.text : UI.textDim, fontFamily: FONT.body, fontStyle: 'bold',
        }).setOrigin(0.5);
        while (label.width > tabW - 10 && label.text.length > 2) label.setText(`${label.text.slice(0, -2)}…`);
      });
      foeBoard(encounters[activeIdx]!, colTop + tabH + gap, colH - tabH - gap);
    }
  }

  /**
   * Foe picker overlay: the full roster as a button grid. `picker === 'add'`
   * appends the chosen enemy as a new foe (its natural title/rank preset);
   * a number swaps that team entry's enemy while keeping its dials.
   */
  private renderPicker(): void {
    const mode = this.picker!;
    const scrim = this.add.rectangle(0, 0, SCREEN.width, SCREEN.height, UI.shadow, 0.72).setOrigin(0, 0).setInteractive();
    scrim.on('pointerdown', () => { this.picker = null; this.rerender(); });

    const ids = Object.keys(enemies);
    const columns = 3;
    const cellW = 200;
    const cellH = 44;
    const gap = DESKTOP_LAYOUT.gap;
    const rows = Math.ceil(ids.length / columns);
    const pw = columns * cellW + (columns - 1) * gap + 40;
    const ph = 64 + rows * (cellH + gap) + 20;
    const px = (SCREEN.width - pw) / 2;
    const py = (SCREEN.height - ph) / 2;
    const panel = this.add.rectangle(px, py, pw, ph, UI.panelAlt, 0.98).setOrigin(0, 0).setStrokeStyle(2, UI.border, 1).setInteractive();
    void panel; // swallows scrim clicks under the panel
    this.text(px + 20, py + 16, mode === 'add' ? 'ADD FOE' : 'SWAP FOE', F.name, UI.textAccent, { bold: true, display: true });
    this.text(px + pw - 20, py + 20, 'click outside to cancel', F.tiny, UI.textSoft, { origin: [1, 0] });

    ids.forEach((id, i) => {
      const col = i % columns;
      const row = Math.floor(i / columns);
      const cx = px + 20 + col * (cellW + gap);
      const cy = py + 56 + row * (cellH + gap);
      const def = enemies[id]!;
      const r = this.add.rectangle(cx, cy, cellW, cellH, UI.panelMuted).setOrigin(0, 0)
        .setStrokeStyle(1, UI.border, 0.7).setInteractive({ useHandCursor: true });
      r.on('pointerover', () => r.setFillStyle(UI.slotHover));
      r.on('pointerout', () => r.setFillStyle(UI.panelMuted));
      this.text(cx + 12, cy + 6, def.name.toUpperCase(), F.small, UI.text, { bold: true });
      this.text(cx + 12, cy + 24, `${(def.isBoss ? 'boss' : def.isElite ? 'elite' : 'normal').toUpperCase()} · LV ${Math.max(1, def.baseDepth)}`, F.tiny, UI.textDim);
      r.on('pointerdown', () => {
        const title = def.isBoss ? 'boss' as const : def.isElite ? 'elite' as const : 'normal' as const;
        if (mode === 'add') {
          demoState.enemyTeam = [...demoState.enemyTeam, {
            enemyId: id, level: Math.max(1, def.baseDepth), title, rank: TITLE_PRESETS[title].rank, modifiers: [],
          }];
          demoState.activeFoe = demoState.enemyTeam.length - 1;
        } else {
          const entry = demoState.enemyTeam[mode];
          if (entry) entry.enemyId = id;
        }
        syncPrimaryFoe();
        this.picker = null;
        this.rerender();
      });
    });
  }

  private renderFightButton(): void {
    const gap = DESKTOP_LAYOUT.gap;
    const x = PANEL_X + PANEL_W + gap;
    const w = (SCREEN.width - DESKTOP_LAYOUT.gutter) - x;
    const y = CONTENT_BOTTOM - FIGHT_H;
    const fight = this.add.rectangle(x, y, w, FIGHT_H, UI.chip).setOrigin(0, 0).setStrokeStyle(2, UI.border, 1).setInteractive({ useHandCursor: true });
    fight.on('pointerover', () => fight.setFillStyle(UI.chipDark).setStrokeStyle(2, UI.chip, 1));
    fight.on('pointerout', () => fight.setFillStyle(UI.chip).setStrokeStyle(2, UI.border, 1));
    this.text(x + w / 2, y + FIGHT_H / 2, 'FIGHT', F.title, UI.textOnChip, { bold: true, display: true, origin: [0.5, 0.5] });
    fight.on('pointerdown', () => { setBattleContext('demo'); this.scene.start('DesktopBattle'); });
  }
}

