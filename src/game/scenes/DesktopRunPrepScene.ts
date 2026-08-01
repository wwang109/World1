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
import { renderRunStatPanel } from '../ui/RunStatPanel';
import { renderRetireConfirm, renderRunHud, snapshotRunProgress } from '../ui/RunProgressStrip';
import { runScreenTemplate } from '../ui/runScreenTemplate';
import { addHoverTipZone } from '../ui/hoverTip';
import { STAT_LABELS, statHoverEntry } from '../ui/statGlossary';
import { setDeckBuildContext } from '../deckBuildContext';
import { rebuildScene } from '../sceneRebuild';
import {
  currentEncounter, currentNode, enemyNameFor, getActiveRun, retireActiveRun, type RunNodeKind,
} from '../runStore';

const ALL_STAT_ENTRIES = STAT_LABELS.map(statHoverEntry);

const F = DESKTOP_PROFILE.font;
const TEMPLATE = runScreenTemplate('desktop');

const GX = DESKTOP_PROFILE.safe.x;
const CONTENT_TOP = TEMPLATE.regions.content.y;
const PANEL_W = 436;
const PANEL_PAD = 20;
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
  private retireConfirmOpen = false;

  constructor() { super('DesktopRunPrep'); }

  init(): void {
    this.statPanelOpen = false;
    this.retireConfirmOpen = false;
  }

  private rerender(): void { rebuildScene(this); }

  create(): void {
    this.cameras.main.setBackgroundColor(UI.bg);
    this.add.rectangle(0, 0, SCREEN.width, SCREEN.height, UI.bg).setOrigin(0, 0);

    const run = getActiveRun();
    const node = currentNode();
    const encounter = currentEncounter();
    if (!run || !node || !encounter) {
      // Reached with no committed combat node (e.g. a stale re-entry) —
      // there's nothing to prep; bounce back to the map.
      this.scene.start('DesktopRunMap');
      return;
    }

    this.renderHud(run, node.kind);
    this.renderFoePanel(node.kind, encounter);
    this.renderColumns(run, encounter);
    if (this.statPanelOpen) {
      renderRunStatPanel(this, {
        compact: false,
        onCancel: () => { this.statPanelOpen = false; this.rerender(); },
        onConfirm: () => { this.statPanelOpen = false; this.rerender(); },
        onChanged: () => this.rerender(),
      });
    }
    if (this.retireConfirmOpen) {
      renderRetireConfirm(this, {
        compact: false,
        onCancel: () => { this.retireConfirmOpen = false; this.rerender(); },
        onConfirm: () => { retireActiveRun(); this.scene.start('DesktopRunMap'); },
      });
    }
  }

  /** THE run HUD — identical header on every run screen. FIGHT is the
   * screen's primary go-forward action, so it lives in the HUD's fixed
   * primary slot (same place as START/CONTINUE›/LEAVE SHOP on other screens). */
  private renderHud(run: NonNullable<ReturnType<typeof getActiveRun>>, kind: RunNodeKind): void {
    renderRunHud(this, {
      screen: `PREP · ${KIND_LABEL[kind]}`,
      compact: false,
      snapshot: snapshotRunProgress(run),
      onOpenStatPanel: () => { this.statPanelOpen = true; this.rerender(); },
      actions: {
        secondary: { label: 'DECK / BAG', onPress: () => { setDeckBuildContext('run'); this.scene.start('DesktopDeck'); } },
        tertiary: { label: 'RETIRE', danger: true, onPress: () => { this.retireConfirmOpen = true; this.rerender(); } },
        primary: { label: 'FIGHT', onPress: () => { setBattleContext('run'); this.scene.start('DesktopBattle'); } },
      },
    });
  }

  /** Content-fit foe panel (density pass — the old version stretched to the
   * full column height, leaving a mostly-empty rectangle below the DMG/turn
   * line). Uses the freed space for a matchup hint + the foe's card list. */
  private renderFoePanel(kind: RunNodeKind, encounter: NonNullable<ReturnType<typeof currentEncounter>>): void {
    const panelX = GX;
    const panelTop = CONTENT_TOP;
    const innerX = panelX + PANEL_PAD;
    const innerW = PANEL_W - PANEL_PAD * 2;
    const cardNames = encounter.setup.pieces
      .map((p) => skillBook[p.skillId]?.name)
      .filter((n): n is string => Boolean(n));
    const cardListRows = Math.ceil(cardNames.length / 1);
    const panelH = PANEL_PAD * 2 + F.label + 10 + 16 + 26 + 12 + F.name + 6 + F.small + 14
      + F.body + 7 + F.small + 7 + F.body + 16 + F.tiny + 6 + cardListRows * (F.small + 4);

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
    addHoverTipZone(this, { x: innerX, y: cursor, w: innerW, h: F.body + 4 }, ALL_STAT_ENTRIES);
    cursor += F.body + 7;
    this.add.text(innerX, cursor, `DEF ${s.armor} · RES ${s.magicResist} · ${encounter.setup.pieces.length} cards`, {
      fontFamily: FONT.body, fontSize: `${F.small}px`, color: UI.textDim,
    });
    addHoverTipZone(this, { x: innerX, y: cursor, w: innerW, h: F.small + 4 }, ALL_STAT_ENTRIES);
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
    cursor += F.body + 16;

    // Matchup hint + card list — fills the space the old full-height panel
    // left empty with information a player can actually use to prep.
    const affinity = encounter.setup.elementAffinity ?? encounter.setup.weaponAffinity;
    this.add.text(innerX, cursor, affinity ? `AFFINITY · ${affinity.toUpperCase()}` : 'CARDS', {
      fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${F.tiny}px`, color: UI.textDim,
    });
    cursor += F.tiny + 6;
    for (const cardName of cardNames) {
      this.add.text(innerX, cursor, `· ${cardName}`, {
        fontFamily: FONT.body, fontSize: `${F.small}px`, color: UI.textSoft, wordWrap: { width: innerW },
      });
      cursor += F.small + 4;
    }
  }

  private renderColumns(run: NonNullable<ReturnType<typeof getActiveRun>>, encounter: NonNullable<ReturnType<typeof currentEncounter>>): void {
    const gap = DESKTOP_PROFILE.gap;
    const rightX = GX + PANEL_W + gap;
    const rightW = (SCREEN.width - GX) - rightX;
    const labelY = CONTENT_TOP;
    const colTop = labelY + F.label + 8;
    const colBottom = CONTENT_BOTTOM;
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

}
