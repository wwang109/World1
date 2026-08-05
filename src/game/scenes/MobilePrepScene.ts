import Phaser from 'phaser';
import { playSfx } from '../audio/sfxSynth';
import { applyTier } from '../../engine/cards';
import { skillBook } from '../../data/skills';
import { enemies } from '../../data/enemies';
import { setDeckBuildContext } from '../deckBuildContext';
import type { SkillDef } from '../../engine/types';
import { buildAutoHeroSetup, buildEnemyEncounter, ENEMY_MODIFIER_IDS, ENEMY_TITLES, maxRankFor, MODIFIER_PRESETS, TITLE_PRESETS, type EnemyTitle } from '../../run/encounter';
import { bankedPL, LEVEL_STAT_COST, spentPL, totalLevelPL, type LevelStat } from '../../run/leveling';
import { cachedDamageBand } from '../battleApi';
import { setBattleContext } from '../battleContext';
import { demoState, MAX_FOES, syncPrimaryFoe, type EnemyFightConfig } from '../demoState';
import { MOBILE_PROFILE } from '../layoutProfile';
import { FONT, SCREEN, UI } from '../theme';
import { renderActionBar } from '../ui/ActionBar';
import { BoardColumn, type ColumnPiece } from '../ui/BoardColumn';
import { STAT_TOKEN } from '../ui/statLabels';
import { rebuildScene } from '../sceneRebuild';

const F = MOBILE_PROFILE.font;

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
  /** Open foe-picker overlay: 'add' appends a new foe, a number swaps that entry. */
  private picker: 'add' | number | null = null;

  constructor() { super('MobilePrep'); }

  /** State changed → rebuild this frame in place (see sceneRebuild.ts). */
  private rerender(): void {
    rebuildScene(this);
  }

  init(): void {
    this.picker = null;
  }

  /** The foe entry the sheet controls edit. */
  private activeFoe(): EnemyFightConfig {
    return demoState.enemyTeam[demoState.activeFoe] ?? demoState.enemyTeam[0]!;
  }

  create(): void {
    this.W = SCREEN.width;
    this.H = SCREEN.height;
    this.ox = 0;
    this.oy = 0;
    this.cameras.main.setBackgroundColor(0x0b1420);

    const foe = this.activeFoe();
    const title = foe.title;
    const level = foe.level;
    const encounter = buildEnemyEncounter(foe.enemyId, level, title, foe.rank, foe.modifiers);
    const enemyDef = enemies[foe.enemyId]!;

    this.renderTabs();
    const rosterBottom = this.renderRoster(enemyDef.name, title, level);
    const sheetBottom = this.renderEnemySheet(encounter, enemyDef.name, title, rosterBottom);
    const heroBottom = this.renderHeroSection(sheetBottom + 12);
    this.renderColumns(encounter, heroBottom);
    this.renderFooter();
    if (this.picker !== null) this.renderPicker();
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

  private button(dx: number, dy: number, w: number, h: number, label: string, fill: number, color: string, onClick: () => void, size = F.body): void {
    const r = this.add.rectangle(this.x(dx), this.y(dy), w, h, fill).setOrigin(0, 0).setStrokeStyle(1, UI.border, 0.7).setInteractive({ useHandCursor: true });
    r.on('pointerdown', () => { playSfx('uiClick'); onClick(); });
    this.add.text(this.x(dx) + w / 2, this.y(dy) + h / 2, label, { fontSize: `${size}px`, color, fontFamily: FONT.body, fontStyle: 'bold' }).setOrigin(0.5);
  }

  private renderTabs(): void {
    const tabs: Array<[string, () => void]> = [
      // Back to the Start screen (the sandbox predated it — user report).
      ['MENU', () => this.scene.start('Start')],
      ['PREP', () => {}],
      ['DECK', () => { setDeckBuildContext('demo'); this.scene.start('MobileDeckBuild'); }],
      ['WIKI', () => this.scene.start('MobileWiki')],
      ['SHOP', () => this.scene.start('MobileShop')],
      ['DRAFT', () => this.scene.start('MobileDraft')],
    ];
    const gap = 5;
    const w = (this.W - 20 - gap * (tabs.length - 1)) / tabs.length;
    tabs.forEach(([label, fn], i) => {
      const active = i === 0;
      this.button(10 + i * (w + gap), 8, w, 34, label, active ? 0xb78a46 : 0x131f32, active ? UI.textOnChip : UI.textDim, fn, F.tiny);
    });
  }

  /** Foe chips in a 2-per-row grid (max MAX_FOES): click an inactive chip to
   *  select, the ACTIVE chip to swap in a different enemy, ✕ to remove; the
   *  trailing empty cell is the + FOE button. Returns the grid's bottom y. */
  private renderRoster(name: string, title: EnemyTitle, level: number): number {
    void name; void title; void level;
    const team = demoState.enemyTeam;
    const chipW = (this.W - 20 - 6) / 2;
    const chipH = 34;
    const rowGap = 6;
    const cell = (i: number): [number, number] => [10 + (i % 2) * (chipW + 6), 50 + Math.floor(i / 2) * (chipH + rowGap)];
    team.slice(0, MAX_FOES).forEach((cfg, i) => {
      const [cx, cy] = cell(i);
      const isActive = i === Math.min(demoState.activeFoe, team.length - 1);
      const chip = this.add.rectangle(this.x(cx), this.y(cy), chipW, chipH, isActive ? 0x16233a : 0x101a2a)
        .setOrigin(0, 0).setStrokeStyle(isActive ? 2 : 1, isActive ? 0xe8b446 : UI.border, isActive ? 0.9 : 0.5)
        .setInteractive({ useHandCursor: true });
      chip.on('pointerdown', () => {
        playSfx('uiClick');
        if (isActive) { this.picker = i; } else { demoState.activeFoe = i; }
        this.rerender();
      });
      this.text(cx + 8, cy + 5, enemies[cfg.enemyId]!.name.toUpperCase(), F.small, isActive ? UI.textBright : UI.textFootnote, { bold: true });
      this.text(cx + 8, cy + 19, `${cfg.title.toUpperCase()} · LV ${cfg.level}${isActive ? ' · ⇄' : ''}`, F.tiny, UI.textFootnote, { bold: true });
      if (team.length > 1) {
        const remove = this.add.rectangle(this.x(cx + chipW - 18), this.y(cy + 2), 16, 16, UI.badSoft, 0.9)
          .setOrigin(0, 0).setStrokeStyle(1, UI.bad, 0.8).setInteractive({ useHandCursor: true });
        this.add.text(this.x(cx + chipW - 10), this.y(cy + 10), '✕', { fontSize: `${F.tiny}px`, color: UI.textBright, fontFamily: FONT.body, fontStyle: 'bold' }).setOrigin(0.5);
        remove.on('pointerdown', () => {
          playSfx('uiClick');
          demoState.enemyTeam = demoState.enemyTeam.filter((_, idx) => idx !== i);
          syncPrimaryFoe();
          this.rerender();
        });
      }
    });
    const cellCount = Math.min(team.length, MAX_FOES) + (team.length < MAX_FOES ? 1 : 0);
    if (team.length < MAX_FOES) {
      const [ax, ay] = cell(cellCount - 1);
      this.button(ax, ay, chipW, chipH, `+ FOE (${team.length}/${MAX_FOES})`, 0x131f32, UI.textAccent, () => {
        this.picker = 'add';
        this.rerender();
      }, F.label);
    }
    return 50 + Math.ceil(cellCount / 2) * (chipH + rowGap);
  }

  /** Foe picker overlay: full roster, 2-up grid. 'add' appends; a number swaps. */
  private renderPicker(): void {
    const mode = this.picker!;
    const scrim = this.add.rectangle(0, 0, this.W, this.H, UI.shadow, 0.75).setOrigin(0, 0).setInteractive();
    scrim.on('pointerdown', () => { playSfx('uiBack'); this.picker = null; this.rerender(); });
    const ids = Object.keys(enemies);
    const columns = 2;
    const cellW = (this.W - 40 - 8) / columns;
    const cellH = 40;
    const rows = Math.ceil(ids.length / columns);
    const ph = 52 + rows * (cellH + 6) + 10;
    const py = Math.max(20, (this.H - ph) / 2);
    const panel = this.add.rectangle(10, py, this.W - 20, ph, 0x142738, 0.98).setOrigin(0, 0).setStrokeStyle(2, UI.border, 1).setInteractive();
    void panel;
    this.add.text(this.x(24), this.y(py + 12), mode === 'add' ? 'ADD FOE' : 'SWAP FOE', { fontSize: `${F.lead}px`, color: UI.textAccent, fontFamily: FONT.display, fontStyle: 'bold' });
    this.add.text(this.x(this.W - 24), this.y(py + 16), 'tap outside to cancel', { fontSize: `${F.tiny}px`, color: UI.textSoft, fontFamily: FONT.body }).setOrigin(1, 0);
    ids.forEach((id, i) => {
      const col = i % columns;
      const row = Math.floor(i / columns);
      const cx = 20 + col * (cellW + 8);
      const cy = py + 44 + row * (cellH + 6);
      const def = enemies[id]!;
      const r = this.add.rectangle(this.x(cx), this.y(cy), cellW, cellH, 0x0d1b28).setOrigin(0, 0)
        .setStrokeStyle(1, UI.border, 0.7).setInteractive({ useHandCursor: true });
      this.text(cx + 10, cy + 6, def.name.toUpperCase(), F.small, UI.textBright, { bold: true });
      this.text(cx + 10, cy + 22, `${(def.isBoss ? 'boss' : def.isElite ? 'elite' : 'normal').toUpperCase()} · LV ${Math.max(1, def.baseDepth)}`, F.tiny, UI.textFootnote);
      r.on('pointerdown', () => {
        playSfx('uiClick');
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

  private renderEnemySheet(encounter: ReturnType<typeof buildEnemyEncounter>, name: string, title: EnemyTitle, rosterBottom: number): number {
    const top = rosterBottom + 8;
    const h = 164;
    this.add.rectangle(this.x(10), this.y(top), this.W - 20, h, 0x101a2a).setOrigin(0, 0).setStrokeStyle(1, 0x2a3a52);
    this.add.rectangle(this.x(10), this.y(top), 5, h, 0xc9a15a).setOrigin(0, 0);
    this.text(20, top + 8, name, F.title, UI.textBright, { display: true, bold: true });
    this.text(this.W - 20, top + 10, title.toUpperCase(), F.tiny, UI.textOnChip, { bold: true, origin: [1, 0] })
      .setBackgroundColor('#c9a15a').setPadding(6, 3, 6, 3);
    const s = encounter.setup.stats;
    this.text(20, top + 32, `${STAT_TOKEN.maxHp} ${s.maxHp} · ${STAT_TOKEN.speed} ${s.speed} · ${STAT_TOKEN.attack} ${s.attack} · ${STAT_TOKEN.magicPower} ${s.magicPower}`, F.label, UI.textBright, { bold: true });
    this.text(20, top + 47, `${STAT_TOKEN.armor} ${s.armor} · ${STAT_TOKEN.magicResist} ${s.magicResist} · ${encounter.setup.pieces.length} cards`, F.small, UI.textFootnote);
    const bandText = this.text(20, top + 62, 'DMG/turn …', F.body, '#d05c4e', { bold: true });
    cachedDamageBand(encounter.setup, { turns: 8, seeds: 8 }).then((band) => {
      if (!this.scene.isActive()) return;
      bandText.setText(`DMG/turn ${band.min}–${band.max}`);
    }).catch(() => {
      if (!this.scene.isActive()) return;
      bandText.setText('DMG/turn n/a').setColor(UI.textMuted);
    });

    // title chips (row 1) — edit the ACTIVE foe entry.
    const foe = this.activeFoe();
    let kx = 20;
    for (const t of ENEMY_TITLES) {
      const active = t === title;
      const w = 44;
      this.button(kx, top + 82, w, 22, t.slice(0, 4).toUpperCase(), active ? 0xc9a15a : 0x16233a, active ? UI.textOnChip : UI.textDim, () => {
        foe.title = t; foe.rank = TITLE_PRESETS[t].rank; syncPrimaryFoe(); this.rerender();
      }, F.tiny);
      kx += w + 5;
    }

    // Modifier chips (row 2) — multi-select toggles, edit the ACTIVE foe entry.
    const modGap = 5;
    const modChipW = (this.W - 40 - modGap * (ENEMY_MODIFIER_IDS.length - 1)) / ENEMY_MODIFIER_IDS.length;
    let mx = 20;
    for (const id of ENEMY_MODIFIER_IDS) {
      const active = foe.modifiers.includes(id);
      const preset = MODIFIER_PRESETS[id]!;
      const label = preset.name.length > 8 ? preset.name.slice(0, 7).toUpperCase() : preset.name.toUpperCase();
      this.button(mx, top + 108, modChipW, 22, label, active ? 0xc9a15a : 0x16233a, active ? UI.textOnChip : UI.textDim, () => {
        foe.modifiers = active ? foe.modifiers.filter((m) => m !== id) : [...foe.modifiers, id];
        syncPrimaryFoe();
        this.rerender();
      }, F.tiny);
      mx += modChipW + modGap;
    }

    // LV + RANK steppers (row 3) — edit the ACTIVE foe entry.
    this.stepper(20, top + 136, 'LV', foe.level, (d) => { foe.level = Math.max(1, foe.level + d); syncPrimaryFoe(); this.rerender(); });
    // Rank caps at deckSize × 3; a tier-forcing modifier (DIAMOND-POWERED)
    // pins it there, so show the RESOLVED rank and freeze the stepper.
    const rankCap = maxRankFor(encounter.setup.pieces.length);
    const tierForced = foe.modifiers.some((id) => MODIFIER_PRESETS[id]?.forceTier !== undefined);
    this.stepper(150, top + 136, 'RANK', encounter.rank, (d) => {
      if (tierForced) return;
      foe.rank = Math.max(0, Math.min(rankCap, encounter.rank + d));
      syncPrimaryFoe();
      this.rerender();
    });
    return top + h;
  }

  private stepper(dx: number, dy: number, label: string, value: number, onDelta: (d: number) => void): void {
    this.text(dx, dy + 6, label, F.tiny, UI.textMuted, { bold: true });
    const bx = dx + 34;
    this.button(bx, dy, 24, 24, '−', 0x16233a, UI.textBright, () => onDelta(-1), F.lead);
    this.add.rectangle(this.x(bx + 26), this.y(dy), 30, 24, 0x0e1726).setOrigin(0, 0).setStrokeStyle(1, UI.border, 0.5);
    this.text(bx + 41, dy + 6, `${value}`, F.body, UI.textBright, { bold: true, origin: [0.5, 0] });
    this.button(bx + 58, dy, 24, 24, '+', 0x16233a, UI.textBright, () => onDelta(1), F.lead);
  }

  /**
   * HERO stat-selection: LV stepper + PL spend readout + a compact 3×2 stat
   * grid (buys from `demoState.heroAllocation`, priced via LEVEL_STAT_COST).
   * Mirrors DesktopPrepScene's hero panel in this scene's tiny-control idiom.
   * Returns the next free y.
   */
  private renderHeroSection(top: number): number {
    const innerX = 20;
    const w = this.W - 20;
    const level = demoState.heroLevel;
    const alloc = demoState.heroAllocation;
    const banked = bankedPL(level, alloc);

    this.text(innerX, top, 'HERO', F.small, '#b78a46', { bold: true });
    this.text(this.W - 20, top, `PL ${spentPL(alloc)}/${totalLevelPL(level)} SPENT · ${banked} BANKED`, F.tiny, banked > 0 ? UI.textAccent : UI.textMuted, { bold: true, origin: [1, 0] });
    let cursor = top + 16;

    this.stepper(innerX, cursor, 'LV', level, (d) => {
      const next = Math.max(1, level + d);
      demoState.heroLevel = next;
      // Lowering the level can strand more buys than the new budget allows —
      // un-buy (cheapest-last stat order) until the spend fits again.
      const order: LevelStat[] = ['speed', 'magicResist', 'armor', 'magicPower', 'attack', 'maxHp'];
      while (bankedPL(next, demoState.heroAllocation) < 0) {
        const stat = order.find((st) => (demoState.heroAllocation[st] ?? 0) > 0);
        if (!stat) break;
        demoState.heroAllocation[stat] = (demoState.heroAllocation[stat] ?? 0) - 1;
      }
      this.rerender();
    });
    cursor += 24 + 10;

    // 3×2 stat grid: each cell shows LABEL/gained on top, −/+ buttons below.
    const rows: Array<[LevelStat, string]> = [
      ['maxHp', STAT_TOKEN.maxHp], ['attack', STAT_TOKEN.attack], ['magicPower', STAT_TOKEN.magicPower],
      ['armor', STAT_TOKEN.armor], ['magicResist', STAT_TOKEN.magicResist], ['speed', STAT_TOKEN.speed],
    ];
    const cols = 3;
    const gap = 6;
    const cellW = (w - gap * (cols - 1)) / cols;
    const cellH = 40;
    const btn = 22;
    rows.forEach(([stat, label], i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const cx = innerX + col * (cellW + gap);
      const cy = cursor + row * (cellH + 6);
      const buys = alloc[stat] ?? 0;
      const cost = LEVEL_STAT_COST[stat];
      const canBuy = banked >= cost.pl;
      const canSell = buys > 0;
      const gained = buys * cost.gain;

      this.add.rectangle(this.x(cx), this.y(cy), cellW, cellH, 0x101a2a).setOrigin(0, 0).setStrokeStyle(1, UI.border, 0.5);
      this.text(cx + 5, cy + 3, label, F.tiny, UI.textFootnote, { bold: true });
      this.text(cx + cellW - 5, cy + 3, gained > 0 ? `+${gained}` : '·', F.tiny, gained > 0 ? UI.textAccent : '#5a6a82', { bold: true, origin: [1, 0] });
      if (canSell) {
        this.button(cx + 4, cy + cellH - btn - 4, btn, btn, '−', 0x16233a, UI.textBright, () => {
          demoState.heroAllocation[stat] = buys - 1; this.rerender();
        }, F.body);
      } else {
        this.add.rectangle(this.x(cx + 4), this.y(cy + cellH - btn - 4), btn, btn, 0x0e1726, 0.5).setOrigin(0, 0).setStrokeStyle(1, UI.border, 0.3);
        this.text(cx + 4 + btn / 2, cy + cellH - btn / 2 - 4, '−', F.label, '#4a5568', { bold: true, origin: [0.5, 0.5] });
      }
      if (canBuy) {
        this.button(cx + cellW - btn - 4, cy + cellH - btn - 4, btn, btn, '+', 0x16233a, UI.textBright, () => {
          demoState.heroAllocation[stat] = buys + 1; this.rerender();
        }, F.body);
      } else {
        this.add.rectangle(this.x(cx + cellW - btn - 4), this.y(cy + cellH - btn - 4), btn, btn, 0x0e1726, 0.5).setOrigin(0, 0).setStrokeStyle(1, UI.border, 0.3);
        this.text(cx + cellW - btn / 2 - 4, cy + cellH - btn / 2 - 4, '+', F.label, '#4a5568', { bold: true, origin: [0.5, 0.5] });
      }
    });
    cursor += 2 * (cellH + 6) + 2;
    return cursor;
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
    const heroStats = buildAutoHeroSetup(demoState.heroLevel, demoState.pieces.map((p) => ({ ...p })), demoState.heroAllocation).setup.stats;

    const top = sheetBottom + 22;
    const colH = this.H - (top - this.oy) - 66;
    const colW = (this.W - 20 - 8) / 2;
    const foeColX = 10 + colW + 8;
    this.text(10 + colW / 2, sheetBottom + 6, 'YOUR DECK', F.small, '#b78a46', { bold: true, origin: [0.5, 0] });
    new BoardColumn(this, { x: this.x(10), y: this.y(top), width: colW, height: colH, side: 'left', pieces: heroPieces, deck: heroSkills, stats: { attack: heroStats.attack, magicPower: heroStats.magicPower } });

    // Enemy side: ONE board — the ACTIVE foe's — at any foe count, named in the
    // header. Desktop stacks two full boards because its 900px canvas has the
    // room; mobile's enemy column is ~266px, so stacking squeezes 10 slots into
    // ~12px rows and the slot numbers collide with the weight labels (measured:
    // 7 text overlaps). The foe chips at the top of this screen are already the
    // selector — tapping one swaps this board.
    const team = demoState.enemyTeam.slice(0, MAX_FOES);
    const activeIdx = Math.min(demoState.activeFoe, Math.max(0, team.length - 1));
    // Keep this short — the foe chips above already name every foe, and a long
    // header runs off the 412px canvas.
    const header = team.length > 1
      ? `ENEMY SKILLS · ${activeIdx + 1}/${team.length}`
      : 'ENEMY SKILLS';
    this.text(foeColX + colW / 2, sheetBottom + 6, header, F.small, '#b78a46', { bold: true, origin: [0.5, 0] });

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
      x: this.x(foeColX), y: this.y(top), width: colW, height: colH, side: 'right',
      pieces: foePieces, deck: foeSkills, stats: { attack: foeStats.attack, magicPower: foeStats.magicPower },
    });
  }

  private renderFooter(): void {
    renderActionBar(this, this.W, this.H, [
      {
        label: `SEED ${demoState.seed}`,
        onPress: () => {
          playSfx('uiClick');
          demoState.seed = 1 + Math.floor(Math.abs(Math.sin(demoState.seed * 97.13)) * 999999);
          this.rerender();
        },
      },
      { label: 'FIGHT', primary: true, flex: 2, onPress: () => { playSfx('uiClick'); setBattleContext('demo'); this.scene.start('MobileBattle'); } },
    ]);
  }
}
