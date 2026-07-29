import Phaser from 'phaser';
import { applyTier } from '../../engine/cards';
import { skillBook } from '../../data/skills';
import type { SkillDef } from '../../engine/types';
import { buildAutoHeroSetup } from '../../run/encounter';
import { cachedDamageBand } from '../battleApi';
import { setBattleContext } from '../battleContext';
import { DESKTOP_PROFILE } from '../layoutProfile';
import { FONT, SCREEN, UI } from '../theme';
import { BoardColumn, type ColumnPiece } from '../ui/BoardColumn';
import { renderBankedPlBadge, renderRunStatPanel } from '../ui/RunStatPanel';
import { rebuildScene } from '../sceneRebuild';
import { renderTutorialCard } from '../tutorial/overlay';
import { armCards } from '../tutorial/controller';
import type { ArmedTutorialCard, TutorialAnchorId, TutorialAnchorRect } from '../tutorial/types';
import {
  currentBankedPL, currentEncounter, currentNode, enemyNameFor, getActiveRun,
  notifyTutorialMoment, skipTutorial, type RunNodeKind,
} from '../runStore';

const F = DESKTOP_PROFILE.font;

const GX = DESKTOP_PROFILE.safe.x;
const CONTENT_TOP = 150;
const PANEL_W = 436;
const PANEL_PAD = 20;
const FIGHT_H = 64;
const CONTENT_BOTTOM = 876;

const KIND_COLOR: Record<RunNodeKind, number> = {
  fight: 0x4a7ab5, event: UI.chip, shop: UI.good, boss: UI.bad,
};
const KIND_LABEL: Record<RunNodeKind, string> = {
  fight: 'FIGHT', event: 'EVENT', shop: 'SHOP', boss: 'BOSS',
};

/**
 * Desktop Run Prep — the READ-ONLY pre-fight screen reached by picking a
 * fight/elite/boss node: the rolled foe (`currentEncounter`, no title/LV/rank
 * dials, no foe picker — the node's encounter is already committed), your run
 * deck (read-only — rearranging between fights is a later phase), and a
 * single FIGHT button. No ‹ MAP — picking a node is a committed choice.
 * Reachable at ?scene=desktop-runprep.
 */
export class DesktopRunPrepScene extends Phaser.Scene {
  private statPanelOpen = false;
  private activeTutorialCards: ArmedTutorialCard[] = [];
  private tutorialCardIndex = 0;

  constructor() { super('DesktopRunPrep'); }

  init(): void {
    this.statPanelOpen = false;
    this.activeTutorialCards = [];
    this.tutorialCardIndex = 0;
  }

  private rerender(): void { rebuildScene(this); }

  create(): void {
    this.cameras.main.setBackgroundColor(UI.bg);
    this.add.rectangle(0, 0, SCREEN.width, SCREEN.height, UI.bg).setOrigin(0, 0);
    this.renderSandboxLink();

    const run = getActiveRun();
    const node = currentNode();
    const encounter = currentEncounter();
    if (!run || !node || !encounter) {
      // Reached with no committed combat node (e.g. a stale re-entry) —
      // there's nothing to prep; bounce back to the map.
      this.scene.start('DesktopRunMap');
      return;
    }

    this.renderTitle(node.kind);
    const badgeAnchor = this.renderHeaderStats(run);
    this.renderFoePanel(node.kind, encounter);
    this.renderColumns(run, encounter);
    this.renderFightButton();
    let statGridAnchor: TutorialAnchorRect | undefined;
    let plLineAnchor: TutorialAnchorRect | undefined;
    if (this.statPanelOpen) {
      const anchors = renderRunStatPanel(this, {
        compact: false,
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
    const link = this.add.text(SCREEN.width - GX, 20, 'SANDBOX ›', {
      fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${F.small}px`, color: UI.textDim,
    }).setOrigin(1, 0).setInteractive({ useHandCursor: true });
    link.on('pointerover', () => link.setColor(UI.textAccent));
    link.on('pointerout', () => link.setColor(UI.textDim));
    link.on('pointerdown', () => this.scene.start('DesktopPrep'));
  }

  private renderTitle(kind: RunNodeKind): void {
    this.add.text(GX, 24, 'WORLD1 / RUN MODE', {
      fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${F.label}px`, color: UI.textAccent,
    });
    this.add.text(GX, 44, `PREP · ${KIND_LABEL[kind]}`, {
      fontFamily: FONT.display, fontStyle: 'bold', fontSize: `${F.big}px`, color: UI.text,
    });
    this.add.rectangle(GX, CONTENT_TOP - 16, SCREEN.width - GX * 2, 1, UI.border, 0.7).setOrigin(0, 0);
  }

  private renderHeaderStats(run: NonNullable<ReturnType<typeof getActiveRun>>): TutorialAnchorRect | undefined {
    const runDepth = run.map.depths.length - 1;
    const parts = [`DEPTH ${run.depth} / ${runDepth}`, `GOLD ${run.gold}`, `HERO LV ${run.heroLevel}`];
    const badgeX = SCREEN.width - GX;
    const badgeY = 20;
    const badgeW = renderBankedPlBadge(this, badgeX, badgeY, F.tiny, () => { this.statPanelOpen = true; this.rerender(); });
    const badgeAnchor: TutorialAnchorRect | undefined = badgeW > 0
      ? { x: badgeX - badgeW, y: badgeY, w: badgeW, h: F.tiny + 12 }
      : undefined;
    this.add.text(SCREEN.width - GX - (badgeW > 0 ? badgeW + 14 : 0), 44 + F.big - F.name, parts.join('   ·   '), {
      fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${F.name}px`, color: UI.textAccent,
    }).setOrigin(1, 0);
    return badgeAnchor;
  }

  private renderFoePanel(kind: RunNodeKind, encounter: NonNullable<ReturnType<typeof currentEncounter>>): void {
    const panelX = GX;
    const panelTop = CONTENT_TOP;
    const panelH = CONTENT_BOTTOM - panelTop;
    const innerX = panelX + PANEL_PAD;
    const innerW = PANEL_W - PANEL_PAD * 2;
    this.add.rectangle(panelX, panelTop, PANEL_W, panelH, UI.panel, 0.92).setOrigin(0, 0).setStrokeStyle(1, UI.border, 0.8);

    let cursor = panelTop + PANEL_PAD;
    this.add.text(innerX, cursor, 'THE FOE', { fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${F.label}px`, color: UI.textAccent });
    cursor += F.label + 10;
    this.add.rectangle(innerX, cursor, innerW, 1, UI.border, 0.6).setOrigin(0, 0);
    cursor += 16;

    const color = KIND_COLOR[kind];
    this.add.rectangle(innerX, cursor, 120, 26, color, 1).setOrigin(0, 0);
    this.add.text(innerX + 60, cursor + 13, encounter.title.toUpperCase(), {
      fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${F.small}px`, color: UI.textOnChip,
    }).setOrigin(0.5);
    cursor += 26 + 12;

    const name = enemyNameFor(encounter.enemyId);
    this.add.text(innerX, cursor, name, {
      fontFamily: FONT.display, fontStyle: 'bold', fontSize: `${F.name}px`, color: UI.text,
    });
    cursor += F.name + 6;
    this.add.text(innerX, cursor, `LV ${encounter.effectiveLevel}`, {
      fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${F.small}px`, color: UI.textDim,
    });
    cursor += F.small + 14;

    const s = encounter.setup.stats;
    this.add.text(innerX, cursor, `HP ${s.maxHp} · SPD ${s.speed} · ATK ${s.attack} · MAG ${s.magicPower}`, {
      fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${F.body}px`, color: UI.text,
    });
    cursor += F.body + 7;
    this.add.text(innerX, cursor, `DEF ${s.armor} · RES ${s.magicResist} · ${encounter.setup.pieces.length} cards`, {
      fontFamily: FONT.body, fontSize: `${F.small}px`, color: UI.textDim,
    });
    cursor += F.small + 7;
    const bandText = this.add.text(innerX, cursor, 'DMG/turn …', {
      fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${F.body}px`, color: UI.textAccent,
    });
    cachedDamageBand(encounter.setup, { turns: 8, seeds: 8 }).then((band) => {
      if (!this.scene.isActive() || !bandText.active) return;
      bandText.setText(`DMG/turn ${band.min}–${band.max}`);
    }).catch(() => {
      if (!this.scene.isActive() || !bandText.active) return;
      bandText.setText('DMG/turn n/a').setColor(UI.textDim);
    });
  }

  private renderColumns(run: NonNullable<ReturnType<typeof getActiveRun>>, encounter: NonNullable<ReturnType<typeof currentEncounter>>): void {
    const gap = DESKTOP_PROFILE.gap;
    const rightX = GX + PANEL_W + gap;
    const rightW = (SCREEN.width - GX) - rightX;
    const labelY = CONTENT_TOP;
    const colTop = labelY + F.label + 8;
    const colBottom = CONTENT_BOTTOM - FIGHT_H - gap;
    const colH = colBottom - colTop;
    const colW = (rightW - gap) / 2;
    const leftColX = rightX;
    const rightColX = rightX + colW + gap;

    this.add.text(leftColX + colW / 2, labelY, 'YOUR DECK', {
      fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${F.label}px`, color: UI.textAccent,
    }).setOrigin(0.5, 0);
    this.add.text(rightColX + colW / 2, labelY, 'ENEMY SKILLS', {
      fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${F.label}px`, color: UI.textAccent,
    }).setOrigin(0.5, 0);

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
      x: leftColX, y: colTop, width: colW, height: colH, side: 'left',
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
      x: rightColX, y: colTop, width: colW, height: colH, side: 'right',
      pieces: foePieces, deck: foeSkills, stats: { attack: foeStats.attack, magicPower: foeStats.magicPower },
    });
  }

  private renderFightButton(): void {
    const gap = DESKTOP_PROFILE.gap;
    const x = GX + PANEL_W + gap;
    const w = (SCREEN.width - GX) - x;
    const y = CONTENT_BOTTOM - FIGHT_H;
    const fight = this.add.rectangle(x, y, w, FIGHT_H, UI.chip).setOrigin(0, 0).setStrokeStyle(2, UI.border, 1).setInteractive({ useHandCursor: true });
    fight.on('pointerover', () => fight.setFillStyle(UI.chipDark).setStrokeStyle(2, UI.chip, 1));
    fight.on('pointerout', () => fight.setFillStyle(UI.chip).setStrokeStyle(2, UI.border, 1));
    this.add.text(x + w / 2, y + FIGHT_H / 2, 'FIGHT', {
      fontFamily: FONT.display, fontStyle: 'bold', fontSize: `${F.title}px`, color: UI.textOnChip,
    }).setOrigin(0.5);
    fight.on('pointerdown', () => { setBattleContext('run'); this.scene.start('DesktopBattle'); });
  }
}
