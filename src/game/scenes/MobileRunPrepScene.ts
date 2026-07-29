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
import { rebuildScene } from '../sceneRebuild';
import { renderTutorialCard } from '../tutorial/overlay';
import { armCards } from '../tutorial/controller';
import type { ArmedTutorialCard, TutorialAnchorId, TutorialAnchorRect } from '../tutorial/types';
import {
  currentBankedPL, currentEncounter, currentNode, enemyNameFor, getActiveRun,
  notifyTutorialMoment, skipTutorial, type RunNodeKind,
} from '../runStore';

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
  private activeTutorialCards: ArmedTutorialCard[] = [];
  private tutorialCardIndex = 0;

  constructor() { super('MobileRunPrep'); }

  init(): void {
    this.statPanelOpen = false;
    this.activeTutorialCards = [];
    this.tutorialCardIndex = 0;
  }

  private rerender(): void { rebuildScene(this); }

  create(): void {
    this.W = SCREEN.width; this.H = SCREEN.height;
    this.cameras.main.setBackgroundColor(0x0b1420);
    this.renderSandboxLink();

    const run = getActiveRun();
    const node = currentNode();
    const encounter = currentEncounter();
    if (!run || !node || !encounter) {
      this.scene.start('MobileRunMap');
      return;
    }

    const badgeAnchor = this.renderHeader(run, node.kind);
    const boardsTop = this.renderFoeCard(node.kind, encounter);
    this.renderColumns(run, encounter, boardsTop);
    this.renderFooter();
    let statGridAnchor: TutorialAnchorRect | undefined;
    let plLineAnchor: TutorialAnchorRect | undefined;
    if (this.statPanelOpen) {
      const anchors = renderRunStatPanel(this, {
        compact: true,
        onClose: () => { this.statPanelOpen = false; this.rerender(); },
        onChanged: () => this.rerender(),
      });
      statGridAnchor = anchors.gridAnchor;
      plLineAnchor = anchors.plLineAnchor;
    }
    this.notifyPrepTutorialMoments(badgeAnchor);
    this.renderTutorialOverlay({ plBadge: badgeAnchor, statGrid: statGridAnchor, plSpentLine: plLineAnchor });
  }

  /** One notify() call per relevant moment this render pass exposes — every
   * call is idempotent beyond the first fire (see `notifyTutorialMoment`). */
  private notifyPrepTutorialMoments(badgeAnchor: TutorialAnchorRect | undefined): void {
    if (this.activeTutorialCards.length > 0) return;
    let fired: ArmedTutorialCard[] = [];
    if (badgeAnchor) {
      const payload = { banked: currentBankedPL() };
      fired = fired.concat(armCards(notifyTutorialMoment('runmap:plBadge', payload), payload));
    }
    if (this.statPanelOpen) fired = fired.concat(armCards(notifyTutorialMoment('runmap:statPanelOpen', {}), {}));
    if (fired.length > 0) { this.activeTutorialCards = fired; this.tutorialCardIndex = 0; }
  }

  /** Draws the current queued tutorial card (if any); a missing anchor is a
   * silent no-op (see `renderTutorialCard`). */
  private renderTutorialOverlay(anchors: Partial<Record<TutorialAnchorId, TutorialAnchorRect>>): void {
    const card = this.activeTutorialCards[this.tutorialCardIndex];
    renderTutorialCard(this, card, card ? anchors[card.step.anchor] : undefined, () => {
      this.tutorialCardIndex += 1;
      if (this.tutorialCardIndex >= this.activeTutorialCards.length) {
        this.activeTutorialCards = [];
        this.tutorialCardIndex = 0;
      }
      this.rerender();
    }, () => {
      skipTutorial();
      this.activeTutorialCards = [];
      this.tutorialCardIndex = 0;
      this.rerender();
    });
  }

  private renderSandboxLink(): void {
    const link = this.add.text(this.W - 12, 10, 'SANDBOX ›', {
      fontSize: '9px', color: '#8a94a6', fontFamily: FONT.body, fontStyle: 'bold',
    }).setOrigin(1, 0).setInteractive({ useHandCursor: true });
    link.on('pointerdown', () => this.scene.start('MobilePrep'));
  }

  private renderHeader(run: NonNullable<ReturnType<typeof getActiveRun>>, kind: RunNodeKind): TutorialAnchorRect | undefined {
    const runDepth = run.map.depths.length - 1;
    const badgeX = this.W - 12; const badgeY = 10; const badgeFont = 9;
    const badgeW = renderBankedPlBadge(this, badgeX, badgeY, badgeFont, () => { this.statPanelOpen = true; this.rerender(); });
    const badgeAnchor: TutorialAnchorRect | undefined = badgeW > 0
      ? { x: badgeX - badgeW, y: badgeY, w: badgeW, h: badgeFont + 12 }
      : undefined;
    this.add.text(12, 10, `PREP · ${KIND_LABEL[kind]}`, { fontSize: '15px', color: '#e8e0c8', fontFamily: FONT.display, fontStyle: 'bold' });
    this.add.text(12, 30, `DEPTH ${run.depth} / ${runDepth}   ·   GOLD ${run.gold}   ·   HERO LV ${run.heroLevel}`, {
      fontSize: '10px', color: '#c69948', fontFamily: FONT.body, fontStyle: 'bold',
    });
    this.add.rectangle(10, 50, this.W - 20, 1, UI.border, 0.6).setOrigin(0, 0);
    return badgeAnchor;
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
