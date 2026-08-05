import Phaser from 'phaser';
import { applyTier } from '../../engine/cards';
import { skillBook } from '../../data/skills';
import type { SkillDef } from '../../engine/types';
import { buildAutoHeroSetup } from '../../run/encounter';
import { setBattleContext } from '../battleContext';
import { MOBILE_PROFILE } from '../layoutProfile';
import { FONT, SCREEN, UI } from '../theme';
import { BoardColumn, type ColumnPiece } from '../ui/BoardColumn';
import { renderRunStatPanel } from '../ui/RunStatPanel';
import { renderRetireConfirm, renderRunHud, snapshotRunProgress } from '../ui/RunProgressStrip';
import { runScreenTemplate } from '../ui/runScreenTemplate';
import { addHoverTipZone } from '../ui/hoverTip';
import { STAT_LABELS, statHoverEntry } from '../ui/statGlossary';
import { STAT_TOKEN } from '../ui/statLabels';
import { setDeckBuildContext } from '../deckBuildContext';
import { rebuildScene } from '../sceneRebuild';
import {
  currentEncounter, currentNode, enemyNameFor, getActiveRun, retireActiveRun, type RunNodeKind,
} from '../runStore';
import { truncateNameKeepingSuffix } from '../ui/controlLayoutAudit';

const F = MOBILE_PROFILE.font;
const ALL_STAT_ENTRIES = STAT_LABELS.map(statHoverEntry);
const TEMPLATE = runScreenTemplate('mobile');

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
  private retireConfirmOpen = false;

  constructor() { super('MobileRunPrep'); }

  init(): void {
    this.statPanelOpen = false;
    this.retireConfirmOpen = false;
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

    this.renderHud(run, node.kind);
    const boardsTop = this.renderFoeCard(node.kind, encounter);
    this.renderColumns(run, encounter, boardsTop);
    if (this.statPanelOpen) {
      renderRunStatPanel(this, {
        compact: true,
        onCancel: () => { this.statPanelOpen = false; this.rerender(); },
        onConfirm: () => { this.statPanelOpen = false; this.rerender(); },
        onChanged: () => this.rerender(),
      });
    }
    if (this.retireConfirmOpen) {
      renderRetireConfirm(this, {
        compact: true,
        onCancel: () => { this.retireConfirmOpen = false; this.rerender(); },
        onConfirm: () => { retireActiveRun(); this.scene.start('MobileRunMap'); },
      });
    }
  }

  /** THE run HUD — identical header on every run screen; FIGHT is this
   * screen's primary go-forward action, so it sits in the HUD's fixed
   * primary slot (the bottom footer on mobile — thumb-reachable). */
  private renderHud(run: NonNullable<ReturnType<typeof getActiveRun>>, kind: RunNodeKind): void {
    renderRunHud(this, {
      screen: `PREP · ${KIND_LABEL[kind]}`,
      compact: true,
      snapshot: snapshotRunProgress(run),
      onOpenStatPanel: () => { this.statPanelOpen = true; this.rerender(); },
      actions: {
        secondary: { label: 'DECK/BAG', onPress: () => { setDeckBuildContext('run'); this.scene.start('MobileDeckBuild'); } },
        tertiary: { label: 'RETIRE', danger: true, onPress: () => { this.retireConfirmOpen = true; this.rerender(); } },
        primary: { label: 'FIGHT', onPress: () => { setBattleContext('run'); this.scene.start('MobileBattle'); } },
      },
    });
  }

  /** Compact foe summary card; returns the y the board columns start at. */
  private renderFoeCard(kind: RunNodeKind, encounter: NonNullable<ReturnType<typeof currentEncounter>>): number {
    const y = TEMPLATE.regions.content.y;
    const h = 62;
    const color = KIND_COLOR[kind];
    this.add.rectangle(10, y, this.W - 20, h, 0x101a2a, 0.94).setOrigin(0, 0).setStrokeStyle(2, color, 0.9);
    const name = enemyNameFor(encounter.enemyId);
    const nameSuffix = `   ·   ${encounter.title.toUpperCase()}   ·   LV ${encounter.effectiveLevel}`;
    const nameText = this.add.text(20, y + 8, `${name}${nameSuffix}`, {
      fontSize: `${F.body}px`, color: UI.textBright, fontFamily: FONT.display, fontStyle: 'bold',
    });
    // GUARD CONTRACT: enemy names (and future modifier-bearing titles) can be
    // arbitrarily long; this single Text object has no wordWrap and the card
    // is fixed-height, so an overlong string would otherwise run off the
    // canvas. Truncate ONLY the name with a trailing ellipsis so the
    // " · TITLE · LV n" suffix always stays fully visible. No-op
    // (byte-identical) while the combined string already fits — true for
    // every enemy name in the game today.
    truncateNameKeepingSuffix(nameText, name, nameSuffix, this.W - 40);
    const s = encounter.setup.stats;
    this.add.text(20, y + 26, `${STAT_TOKEN.maxHp} ${s.maxHp} · ${STAT_TOKEN.speed} ${s.speed} · ${STAT_TOKEN.attack} ${s.attack} · ${STAT_TOKEN.magicPower} ${s.magicPower}`, {
      fontSize: `${F.tiny}px`, color: UI.textFootnote, fontFamily: FONT.body, fontStyle: 'bold',
    });
    this.add.text(20, y + 40, `${STAT_TOKEN.armor} ${s.armor} · ${STAT_TOKEN.magicResist} ${s.magicResist} · ${encounter.setup.pieces.length} cards`, {
      fontSize: `${F.tiny}px`, color: UI.textMuted, fontFamily: FONT.body,
    });
    addHoverTipZone(this, { x: 10, y: y + 22, w: this.W - 20, h: 32 }, ALL_STAT_ENTRIES);
    return y + h + 8;
  }

  private renderColumns(
    run: NonNullable<ReturnType<typeof getActiveRun>>,
    encounter: NonNullable<ReturnType<typeof currentEncounter>>,
    top: number,
  ): void {
    const footerTop = TEMPLATE.regions.footer.y - 8;
    const colH = footerTop - top;
    const gap = 8;
    const colW = (this.W - 20 - gap) / 2;
    const leftX = 10;
    const rightX = 10 + colW + gap;

    this.add.text(leftX + colW / 2, top - 14, 'YOUR DECK', { fontSize: `${F.tiny}px`, color: UI.textMuted, fontFamily: FONT.body, fontStyle: 'bold' }).setOrigin(0.5, 0);
    this.add.text(rightX + colW / 2, top - 14, 'ENEMY SKILLS', { fontSize: `${F.tiny}px`, color: UI.textMuted, fontFamily: FONT.body, fontStyle: 'bold' }).setOrigin(0.5, 0);

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

}
