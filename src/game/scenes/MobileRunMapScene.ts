import Phaser from 'phaser';
import { shopCatalog } from '../../data/shopTypes';
import { FONT, SCREEN, UI } from '../theme';
import { rebuildScene } from '../sceneRebuild';
import { renderBankedPlBadge, renderRunStatPanel } from '../ui/RunStatPanel';
import { renderTutorialCard, renderTutorialEntryChip } from '../tutorial/overlay';
import { armCards } from '../tutorial/controller';
import type { ArmedTutorialCard, TutorialAnchorId, TutorialAnchorRect } from '../tutorial/types';
import {
  choices,
  clearRun,
  currentBankedPL,
  enemyNameFor,
  getActiveRun,
  getPendingSeed,
  notifyTutorialMoment,
  pickNode,
  previewEncounter,
  rerollPendingSeed,
  skipTutorial,
  startRun,
  tutorialChipVisible,
  WAVE_COUNT,
  type RunNode,
  type RunNodeKind,
} from '../runStore';

/** Steel-blue / gold-bronze / green / red — same palette as the desktop map. */
const KIND_COLOR: Record<RunNodeKind, number> = {
  fight: 0x4a7ab5,
  event: UI.chip,
  shop: UI.good,
  boss: UI.bad,
};
const KIND_LABEL: Record<RunNodeKind, string> = {
  fight: 'FIGHT',
  event: 'EVENT',
  shop: 'SHOP',
  boss: 'BOSS',
};

/**
 * Mobile Run Map — the Run Mode node-choice screen: a vertical trail of thin
 * "cleared"/"undiscovered" depth rows around a block of 2-3 pickable next-
 * node panels, a compact header (depth/gold/hero LV/win-loss), and a START
 * RUN panel when no run is active yet. Pure playback/selection surface over
 * `src/game/runStore`. Reachable at ?scene=mrunmap.
 */
export class MobileRunMapScene extends Phaser.Scene {
  private W = SCREEN.width;
  private H = SCREEN.height;
  private statPanelOpen = false;
  private activeTutorialCards: ArmedTutorialCard[] = [];
  private tutorialCardIndex = 0;

  constructor() { super('MobileRunMap'); }

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
    if (!run) {
      this.renderTitle();
      this.renderStartPanel();
      return;
    }
    // Freshly-started run (or a stale re-entry mid-draft) — the run-context
    // draft owns installing the starting deck before any node is pickable.
    if (run.status === 'drafting') {
      this.scene.start('MobileDraft');
      return;
    }
    if (run.status === 'victory' || run.status === 'defeat') {
      this.renderBanner(run.status);
      return;
    }

    this.renderTitle();
    const badgeAnchor = this.renderHeaderStats(run);
    this.renderTrail(run);
    if (tutorialChipVisible()) {
      renderTutorialEntryChip(this, this.W - 12, this.H - 14, 8, () => { skipTutorial(); this.rerender(); });
    }
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
    this.notifyMapTutorialMoments(badgeAnchor);
    this.renderTutorialOverlay({ plBadge: badgeAnchor, statGrid: statGridAnchor, plSpentLine: plLineAnchor });
  }

  /** One notify() call per relevant moment this render pass exposes — every
   * call is idempotent beyond the first fire (see `notifyTutorialMoment`). */
  private notifyMapTutorialMoments(badgeAnchor: TutorialAnchorRect | undefined): void {
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

  private renderTitle(): void {
    this.add.text(12, 10, 'RUN', { fontSize: '18px', color: '#e8e0c8', fontFamily: FONT.display, fontStyle: 'bold' });
  }

  private renderHeaderStats(run: NonNullable<ReturnType<typeof getActiveRun>>): TutorialAnchorRect | undefined {
    const runDepth = run.map.depths.length - 1;
    const nextCol = run.map.depths[run.depth + 1];
    const wave = nextCol?.[0]?.wave ?? run.map.depths[run.depth]?.[0]?.wave ?? 1;
    const badgeX = this.W - 12; const badgeY = 34; const badgeFont = 9;
    const badgeW = renderBankedPlBadge(this, badgeX, badgeY, badgeFont, () => { this.statPanelOpen = true; this.rerender(); });
    const badgeAnchor: TutorialAnchorRect | undefined = badgeW > 0
      ? { x: badgeX - badgeW, y: badgeY, w: badgeW, h: badgeFont + 12 }
      : undefined;
    this.add.text(12, 34, `WAVE ${wave}/${WAVE_COUNT}   ·   D${run.depth}/${runDepth}   ·   GOLD ${run.gold}`, {
      fontSize: '11px', color: '#c69948', fontFamily: FONT.body, fontStyle: 'bold',
    });
    this.add.text(12, 50, `HERO LV ${run.heroLevel}   ·   ${run.wins}W · ${run.losses}L`, {
      fontSize: '10px', color: '#8a94a6', fontFamily: FONT.body, fontStyle: 'bold',
    });
    this.add.rectangle(10, 70, this.W - 20, 1, UI.border, 0.6).setOrigin(0, 0);
    return badgeAnchor;
  }

  // ---------- the trail ----------

  private renderTrail(run: NonNullable<ReturnType<typeof getActiveRun>>): void {
    const nextDepth = run.depth + 1;
    const runDepth = run.map.depths.length - 1;
    let y = 82;
    const gap = 6;
    let lastWave = -1;
    for (let depth = 1; depth <= runDepth; depth++) {
      const wave = run.map.depths[depth]?.[0]?.wave ?? 1;
      if (wave !== lastWave) {
        this.add.text(12, y, `— WAVE ${wave} —`, { fontSize: '8px', color: '#5a6880', fontFamily: FONT.body, fontStyle: 'bold' });
        y += 14;
        lastWave = wave;
      }
      if (depth === nextDepth) {
        y = this.renderChoiceBlock(y);
        continue;
      }
      const rowH = 18;
      this.add.text(12, y + 3, `D${depth}`, { fontSize: '8px', color: '#5a6880', fontFamily: FONT.body, fontStyle: 'bold' });
      if (depth < run.depth) {
        this.add.circle(50, y + 8, 4, 0x5a6880, 0.6);
      } else if (depth === run.depth) {
        this.add.circle(50, y + 8, 5, 0, 0).setStrokeStyle(2, 0xe8b446, 1);
        this.add.circle(50, y + 8, 2, 0xe8b446, 1);
      } else {
        const count = run.map.depths[depth]?.length ?? 0;
        for (let i = 0; i < count; i++) {
          this.add.rectangle(46 + i * 12, y + 8, 8, 8, 0x101a2a, 0.35).setStrokeStyle(1, UI.border, 0.2);
        }
      }
      y += rowH + gap;
    }
  }

  private renderChoiceBlock(top: number): number {
    const options = choices();
    let y = top;
    if (options.length === 0) {
      this.add.text(12, y, '···', { fontSize: '13px', color: '#5a6880', fontFamily: FONT.body });
      return y + 24;
    }
    if (options.length === 1) {
      this.add.text(12, y, 'MANDATORY', { fontSize: '8px', color: '#5a6880', fontFamily: FONT.body, fontStyle: 'bold' });
      y += 12;
    }
    const h = 96;
    const gap = 8;
    for (const node of options) {
      this.renderChoicePanel(y, h, node);
      y += h + gap;
    }
    return y;
  }

  private renderChoicePanel(y: number, h: number, node: RunNode): void {
    const color = KIND_COLOR[node.kind];
    const x = 10;
    const w = this.W - 20;
    const cell = this.add.rectangle(x, y, w, h, 0x101a2a, 0.94).setOrigin(0, 0).setStrokeStyle(2, color, 0.9).setInteractive({ useHandCursor: true });
    cell.on('pointerdown', () => {
      pickNode(node.id);
      const sceneName = node.kind === 'shop' ? 'MobileShop' : node.kind === 'event' ? 'MobileRunEvent' : 'MobileRunPrep';
      this.scene.start(sceneName);
    });
    this.add.rectangle(x, y, 6, h, color).setOrigin(0, 0);
    const shop = node.kind === 'shop' && node.shopId ? shopCatalog[node.shopId] : undefined;
    // Event themes come from map-gen, so labelling costs no event-bag draw.
    const themeSuffix = shop ? shop.name.toUpperCase() : node.eventTheme?.toUpperCase();
    const titleLabel = themeSuffix ? `${KIND_LABEL[node.kind]} · ${themeSuffix}` : KIND_LABEL[node.kind];
    this.add.text(x + 18, y + 12, titleLabel, { fontSize: '14px', color: '#e8e0c8', fontFamily: FONT.display, fontStyle: 'bold' });

    if (node.kind === 'shop') {
      if (shop) {
        this.add.text(x + 18, y + h - 22, shop.tagline, { fontSize: '8px', color: '#8a94a6', fontFamily: FONT.body, wordWrap: { width: w - 36 } });
      }
    } else if (node.kind === 'fight' || node.kind === 'boss') {
      const encounter = previewEncounter(node);
      if (encounter) {
        const name = enemyNameFor(encounter.enemyId);
        this.add.text(x + 18, y + 34, `${name} · LV ${encounter.effectiveLevel} · ${encounter.title.toUpperCase()}`, {
          fontSize: '10px', color: '#c69948', fontFamily: FONT.body, fontStyle: 'bold', wordWrap: { width: w - 36 },
        });
      }
    }
  }

  // ---------- start-run panel ----------

  private renderStartPanel(): void {
    const pw = this.W - 40; const ph = 220;
    const px = 20; const py = (this.H - ph) / 2;
    this.add.rectangle(px, py, pw, ph, 0x141d2c, 0.96).setOrigin(0, 0).setStrokeStyle(2, UI.border, 1);
    const cx = px + pw / 2;
    this.add.text(cx, py + 20, 'START A NEW RUN', { fontSize: '15px', color: '#e8e0c8', fontFamily: FONT.display, fontStyle: 'bold' }).setOrigin(0.5, 0);

    const seedRowY = py + 60;
    this.add.text(px + 16, seedRowY + 16, 'SEED', { fontSize: '9px', color: '#8a94a6', fontFamily: FONT.body, fontStyle: 'bold' }).setOrigin(0, 0.5);
    const seedBoxX = px + 60;
    const seedBoxW = pw - 60 - 90 - 16;
    this.add.rectangle(seedBoxX, seedRowY, seedBoxW, 32, 0x0d1b28).setOrigin(0, 0).setStrokeStyle(1, UI.border, 0.6);
    this.add.text(seedBoxX + 10, seedRowY + 16, `${getPendingSeed()}`, { fontSize: '13px', color: '#e8e0c8', fontFamily: FONT.body, fontStyle: 'bold' }).setOrigin(0, 0.5);
    const rerollX = seedBoxX + seedBoxW + 8;
    const reroll = this.add.rectangle(rerollX, seedRowY, 82, 32, 0xb78a46, 1).setOrigin(0, 0).setStrokeStyle(1, UI.border, 1).setInteractive({ useHandCursor: true });
    this.add.text(rerollX + 41, seedRowY + 16, 'REROLL', { fontSize: '10px', color: '#1a1208', fontFamily: FONT.body, fontStyle: 'bold' }).setOrigin(0.5);
    reroll.on('pointerdown', () => { rerollPendingSeed(); this.rerender(); });

    const startY = py + ph - 66;
    const start = this.add.rectangle(cx, startY, pw - 40, 44, 0xb78a46, 1).setOrigin(0.5, 0).setStrokeStyle(2, UI.border, 1).setInteractive({ useHandCursor: true });
    this.add.text(cx, startY + 22, 'START', { fontSize: '15px', color: '#1a1208', fontFamily: FONT.display, fontStyle: 'bold' }).setOrigin(0.5);
    start.on('pointerdown', () => { startRun(getPendingSeed()); this.scene.start('MobileDraft'); });

    this.add.text(cx, py + ph - 14, 'Next: draft your starting deck (4 picks).', {
      fontSize: '8px', color: '#5a6880', fontFamily: FONT.body, align: 'center', wordWrap: { width: pw - 32 },
    }).setOrigin(0.5, 1);
  }

  // ---------- victory / defeat banner ----------

  private renderBanner(status: 'victory' | 'defeat'): void {
    const win = status === 'victory';
    this.add.rectangle(0, 0, this.W, this.H, win ? 0x1b3123 : 0x352019, 1).setOrigin(0, 0);
    const cx = this.W / 2;
    this.add.text(cx, this.H / 2 - 50, win ? 'VICTORY' : 'DEFEAT', {
      fontSize: '30px', color: '#e8e0c8', fontFamily: FONT.display, fontStyle: 'bold',
    }).setOrigin(0.5);
    const run = getActiveRun()!;
    this.add.text(cx, this.H / 2 + 4, `${run.wins}W · ${run.losses}L · GOLD ${run.gold} · HERO LV ${run.heroLevel}`, {
      fontSize: '12px', color: '#c69948', fontFamily: FONT.body, fontStyle: 'bold', align: 'center', wordWrap: { width: this.W - 60 },
    }).setOrigin(0.5);
    const btn = this.add.rectangle(cx, this.H / 2 + 50, 180, 44, 0xb78a46, 1).setOrigin(0.5, 0).setStrokeStyle(2, UI.border, 1).setInteractive({ useHandCursor: true });
    this.add.text(cx, this.H / 2 + 72, 'NEW RUN', { fontSize: '14px', color: '#1a1208', fontFamily: FONT.display, fontStyle: 'bold' }).setOrigin(0.5);
    btn.on('pointerdown', () => { clearRun(); this.rerender(); });
  }
}
