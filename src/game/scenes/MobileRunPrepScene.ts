import Phaser from 'phaser';
import { applyTier } from '../../engine/cards';
import { skillBook } from '../../data/skills';
import type { SkillDef } from '../../engine/types';
import { buildAutoHeroSetup } from '../../run/encounter';
import { setBattleContext } from '../battleContext';
import { FONT, SCREEN, UI } from '../theme';
import { BoardColumn, type ColumnPiece } from '../ui/BoardColumn';
import { renderActionBar } from '../ui/ActionBar';
import { renderBankedPlBadge, renderRunStatPanel } from '../ui/RunStatPanel';
import { addHoverTipZone } from '../ui/hoverTip';
import { STAT_LABELS, statHoverEntry } from '../ui/statGlossary';
import { setDeckBuildContext } from '../deckBuildContext';
import { rebuildScene } from '../sceneRebuild';
import {
  currentEncounter, currentNode, enemyNameFor, getActiveRun, type RunNodeKind,
} from '../runStore';

const ALL_STAT_ENTRIES = STAT_LABELS.map(statHoverEntry);

const KIND_COLOR: Record<RunNodeKind, number> = {
  fight: 0x4a7ab5, event: UI.chip, shop: UI.good, boss: UI.bad,
};
const KIND_LABEL: Record<RunNodeKind, string> = {
  fight: 'FIGHT', event: 'EVENT', shop: 'SHOP', boss: 'BOSS',
};

/**
 * Mobile Run Prep — the READ-ONLY pre-fight screen reached by picking a
 * fight/elite/boss node: the rolled foe (`currentEncounter`, no dials/foe
 * picker), your run deck (read-only), and a single FIGHT footer button. No
 * ‹ MAP — picking a node is a committed choice. Reachable at ?scene=mrunprep.
 */
export class MobileRunPrepScene extends Phaser.Scene {
  private W = SCREEN.width;
  private H = SCREEN.height;
  private statPanelOpen = false;

  constructor() { super('MobileRunPrep'); }

  init(): void {
    this.statPanelOpen = false;
  }

  private rerender(): void { rebuildScene(this); }

  create(): void {
    this.W = SCREEN.width; this.H = SCREEN.height;
    this.cameras.main.setBackgroundColor(0x0b1420);

    const run = getActiveRun();
    const node = currentNode();
    const encounter = currentEncounter();
    if (!run || !node || !encounter) {
      this.scene.start('MobileRunMap');
      return;
    }

    this.renderHeader(run, node.kind);
    const boardsTop = this.renderFoeCard(node.kind, encounter);
    this.renderColumns(run, encounter, boardsTop);
    this.renderFooter();
    if (this.statPanelOpen) {
      renderRunStatPanel(this, {
        compact: true,
        onCancel: () => { this.statPanelOpen = false; this.rerender(); },
        onConfirm: () => { this.statPanelOpen = false; this.rerender(); },
        onChanged: () => this.rerender(),
      });
    }
  }

  private renderHeader(run: NonNullable<ReturnType<typeof getActiveRun>>, kind: RunNodeKind): void {
    const runDepth = run.map.depths.length - 1;
    const badgeX = this.W - 12; const badgeY = 10; const badgeFont = 9;
    renderBankedPlBadge(this, badgeX, badgeY, badgeFont, () => { this.statPanelOpen = true; this.rerender(); });
    this.add.text(12, 10, `PREP · ${KIND_LABEL[kind]}`, { fontSize: '15px', color: '#e8e0c8', fontFamily: FONT.display, fontStyle: 'bold' });
    this.add.text(12, 30, `DEPTH ${run.depth} / ${runDepth}   ·   GOLD ${run.gold}   ·   HERO LV ${run.heroLevel}`, {
      fontSize: '10px', color: '#c69948', fontFamily: FONT.body, fontStyle: 'bold',
    });
    const deckW = 74; const deckH = 20;
    const deckBtn = this.add.rectangle(this.W - 12 - deckW, 30, deckW, deckH, 0x16233a, 1).setOrigin(0, 0).setStrokeStyle(1, 0xb78a46, 0.8).setInteractive({ useHandCursor: true });
    this.add.text(this.W - 12 - deckW / 2, 30 + deckH / 2, 'DECK/BAG', { fontSize: '8px', color: '#e8b446', fontFamily: FONT.body, fontStyle: 'bold' }).setOrigin(0.5);
    deckBtn.on('pointerdown', () => { setDeckBuildContext('run'); this.scene.start('MobileDeckBuild'); });
    this.add.rectangle(10, 50, this.W - 20, 1, UI.border, 0.6).setOrigin(0, 0);
  }

  /** Compact foe summary card; returns the y the board columns start at. */
  private renderFoeCard(kind: RunNodeKind, encounter: NonNullable<ReturnType<typeof currentEncounter>>): number {
    const y = 58;
    const h = 62;
    const color = KIND_COLOR[kind];
    this.add.rectangle(10, y, this.W - 20, h, 0x101a2a, 0.94).setOrigin(0, 0).setStrokeStyle(2, color, 0.9);
    const name = enemyNameFor(encounter.enemyId);
    this.add.text(20, y + 8, `${name}   ·   ${encounter.title.toUpperCase()}   ·   LV ${encounter.effectiveLevel}`, {
      fontSize: '12px', color: '#e8e0c8', fontFamily: FONT.display, fontStyle: 'bold',
    });
    const s = encounter.setup.stats;
    this.add.text(20, y + 26, `HP ${s.maxHp} · SPD ${s.speed} · ATK ${s.attack} · MAG ${s.magicPower}`, {
      fontSize: '9px', color: '#9aa4b6', fontFamily: FONT.body, fontStyle: 'bold',
    });
    this.add.text(20, y + 40, `DEF ${s.armor} · RES ${s.magicResist} · ${encounter.setup.pieces.length} cards`, {
      fontSize: '9px', color: '#8a94a6', fontFamily: FONT.body,
    });
    addHoverTipZone(this, { x: 10, y: y + 22, w: this.W - 20, h: 32 }, ALL_STAT_ENTRIES);
    return y + h + 8;
  }

  private renderColumns(
    run: NonNullable<ReturnType<typeof getActiveRun>>,
    encounter: NonNullable<ReturnType<typeof currentEncounter>>,
    top: number,
  ): void {
    const footerTop = this.H - 40 - 16 - 8;
    const colH = footerTop - top;
    const gap = 8;
    const colW = (this.W - 20 - gap) / 2;
    const leftX = 10;
    const rightX = 10 + colW + gap;

    this.add.text(leftX + colW / 2, top - 14, 'YOUR DECK', { fontSize: '9px', color: '#8a94a6', fontFamily: FONT.body, fontStyle: 'bold' }).setOrigin(0.5, 0);
    this.add.text(rightX + colW / 2, top - 14, 'ENEMY SKILLS', { fontSize: '9px', color: '#8a94a6', fontFamily: FONT.body, fontStyle: 'bold' }).setOrigin(0.5, 0);

    const heroSkills: SkillDef[] = [];
    const heroPieces: ColumnPiece[] = [];
    for (const p of run.pieces) {
      const base = skillBook[p.skillId];
      if (!base) continue;
      const skill = p.tier === base.tier ? base : applyTier(base, p.tier);
      heroPieces.push({ skill, slot: p.slot });
      heroSkills.push(skill);
    }
    const heroStats = buildAutoHeroSetup(run.heroLevel, run.pieces.map((p) => ({ ...p })), run.heroAllocation).setup.stats;
    new BoardColumn(this, {
      x: leftX, y: top, width: colW, height: colH, side: 'left',
      pieces: heroPieces, deck: heroSkills, stats: { attack: heroStats.attack, magicPower: heroStats.magicPower },
    });

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
      x: rightX, y: top, width: colW, height: colH, side: 'right',
      pieces: foePieces, deck: foeSkills, stats: { attack: foeStats.attack, magicPower: foeStats.magicPower },
    });
  }

  private renderFooter(): void {
    renderActionBar(this, this.W, this.H, [
      { label: 'FIGHT', primary: true, flex: 1, onPress: () => { setBattleContext('run'); this.scene.start('MobileBattle'); } },
    ]);
  }
}
