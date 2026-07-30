import Phaser from 'phaser';
import { shopCatalog } from '../../data/shopTypes';
import { eventThemeBlurb } from '../ui/eventThemeBlurb';
import { MOBILE_PROFILE } from '../layoutProfile';
import { FONT, SCREEN, UI } from '../theme';
import { rebuildScene } from '../sceneRebuild';
import { renderRunChoicePanel, type RunChoiceViewModel } from '../ui/RunChoicePanel';
import { auditControlLabel, auditTextBlock } from '../ui/controlLayoutAudit';
import { renderRunProgressStrip, snapshotRunProgress } from '../ui/RunProgressStrip';
import { renderRunRouteBoard, snapshotRunRoute } from '../ui/RunRouteBoard';
import { renderBankedPlBadge, renderRunStatPanel } from '../ui/RunStatPanel';
import { setDeckBuildContext } from '../deckBuildContext';
import {
  choices,
  clearRun,
  enemyNameFor,
  getActiveRun,
  getPendingSeed,
  pickNode,
  previewEncounter,
  rerollPendingSeed,
  startRun,
  type RunNode,
  type RunNodeKind,
} from '../runStore';

const F = MOBILE_PROFILE.font;

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

  constructor() { super('MobileRunMap'); }

  init(): void {
    this.statPanelOpen = false;
  }

  private rerender(): void { rebuildScene(this); }

  create(): void {
    this.W = SCREEN.width; this.H = SCREEN.height;
    this.cameras.main.setBackgroundColor(0x0b1420);

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
    this.renderHeaderStats(run);
    this.renderDeckButton();
    this.renderTrail(run);
    if (this.statPanelOpen) {
      renderRunStatPanel(this, {
        compact: true,
        onCancel: () => { this.statPanelOpen = false; this.rerender(); },
        onConfirm: () => { this.statPanelOpen = false; this.rerender(); },
        onChanged: () => this.rerender(),
      });
    }
  }

  private renderTitle(): void {
    const title = this.add.text(12, 10, 'RUN', { fontSize: '18px', color: '#e8e0c8', fontFamily: FONT.display, fontStyle: 'bold' });
    auditTextBlock(title, { name: 'Mobile run map title', maxWidth: 100, maxHeight: F.big * 2, minFontSize: 12 });
  }

  /** DECK / BAG entry point — opens the shared Deck Build scene in RUN
   * context (task item #3). */
  private renderDeckButton(): void {
    const w = 92; const h = 22;
    const x = this.W - 12 - w; const y = 10;
    const btn = this.add.rectangle(x, y, w, h, 0x16233a, 1).setOrigin(0, 0).setStrokeStyle(1, 0xb78a46, 0.8).setInteractive({ useHandCursor: true });
    const label = this.add.text(x + w / 2, y + h / 2, 'DECK / BAG', { fontSize: '9px', color: '#e8b446', fontFamily: FONT.body, fontStyle: 'bold' }).setOrigin(0.5);
    auditControlLabel(btn, label, { name: 'Mobile run map deck bag', horizontalPadding: 8, verticalPadding: 5, minFontSize: 8 });
    auditTextBlock(label, { name: 'Mobile run map deck bag label', maxWidth: w - 16, maxHeight: h - 10, minFontSize: 8 });
    btn.on('pointerdown', () => { setDeckBuildContext('run'); this.scene.start('MobileDeckBuild'); });
  }

  private renderHeaderStats(run: NonNullable<ReturnType<typeof getActiveRun>>): void {
    renderRunProgressStrip(this, { x: 12, y: 42, w: this.W - 24 }, snapshotRunProgress(run));
    renderBankedPlBadge(this, this.W - 12, 96, F.tiny, () => { this.statPanelOpen = true; this.rerender(); });
  }

  // ---------- the trail ----------

  private renderTrail(run: NonNullable<ReturnType<typeof getActiveRun>>): void {
    const routeBounds = { x: 10, y: 108, w: this.W - 20, h: 310 };
    const route = snapshotRunRoute(run);
    renderRunRouteBoard(this, routeBounds, route, { mode: 'mobile' });

    if (route.columns.length === 0) return;
    // Match the route renderer's mobile lane placement so the current stop
    // sits directly above the stack of available next-node choices.
    const laneX = routeBounds.x + Math.max(F.label + MOBILE_PROFILE.gap * 2, routeBounds.w * 0.58);
    const choiceW = 330;
    const choiceX = Phaser.Math.Clamp(laneX - choiceW / 2, 10, this.W - 10 - choiceW);
    this.renderChoiceBlock(choiceX, 438, choiceW, this.H - 10 - 438);
  }

  private renderChoiceBlock(x: number, top: number, w: number, availableH: number): void {
    const options = choices();
    if (options.length === 0) {
      this.add.text(x + w / 2, top + 20, '···', {
        fontSize: `${F.label}px`, color: UI.textSoft, fontFamily: FONT.body,
      }).setOrigin(0.5, 0);
      return;
    }
    const planner = this.add.text(x + w / 2, top, 'CHOOSE YOUR NEXT STOP', {
      fontSize: `${F.tiny}px`, color: UI.textAccent, fontFamily: FONT.body, fontStyle: 'bold',
    }).setOrigin(0.5, 0);
    auditTextBlock(planner, { name: 'Mobile run map choice planner', maxWidth: w, maxHeight: F.tiny * 2, minFontSize: 8 });
    top += F.tiny + 8;
    availableH -= F.tiny + 8;
    if (options.length === 1) {
      const mandatory = this.add.text(x + w / 2, top, 'MANDATORY', {
        fontSize: `${F.tiny}px`, color: UI.textSoft, fontFamily: FONT.body, fontStyle: 'bold',
      }).setOrigin(0.5, 0);
      auditTextBlock(mandatory, { name: 'Mobile run map mandatory label', maxWidth: w, maxHeight: F.tiny * 2, minFontSize: 8 });
      top += F.tiny + 6;
      availableH -= F.tiny + 6;
    }
    const gap = 10;
    const h = Math.min(94, (availableH - gap * (options.length - 1)) / options.length);
    let y = top;
    for (const node of options) {
      renderRunChoicePanel(this, { x, y, w, h }, this.choiceViewModel(node), {
        font: F,
        onSelect: () => {
          pickNode(node.id);
          const sceneName = node.kind === 'shop' ? 'MobileShop' : node.kind === 'event' ? 'MobileRunEvent' : 'MobileRunPrep';
          this.scene.start(sceneName);
        },
      });
      y += h + gap;
    }
  }

  private choiceViewModel(node: RunNode): RunChoiceViewModel {
    const shop = node.kind === 'shop' && node.shopId ? shopCatalog[node.shopId] : undefined;
    // Event themes come from map-gen, so labelling costs no event-bag draw.
    const themeSuffix = shop ? shop.name.toUpperCase() : node.eventTheme?.toUpperCase();
    const titleLabel = themeSuffix ? `${KIND_LABEL[node.kind]} · ${themeSuffix}` : KIND_LABEL[node.kind];

    if (node.kind === 'shop') {
      return {
        nodeId: node.id,
        kind: node.kind,
        title: titleLabel,
        detail: shop?.tagline ?? '',
        footer: shop ? `${shop.shelf.cards} CARDS · ${shop.shelf.gems} GEMS` : undefined,
        accent: KIND_COLOR[node.kind],
        enabled: true,
      };
    }

    if (node.kind === 'fight' || node.kind === 'boss') {
      const encounter = previewEncounter(node);
      return {
        nodeId: node.id,
        kind: node.kind,
        title: titleLabel,
        detail: encounter ? `${enemyNameFor(encounter.enemyId)} · LV ${encounter.effectiveLevel} · ${encounter.title.toUpperCase()}` : '',
        accent: KIND_COLOR[node.kind],
        enabled: true,
      };
    }

    return {
      nodeId: node.id,
      kind: node.kind,
      title: titleLabel,
      detail: eventThemeBlurb(node.eventTheme),
      accent: KIND_COLOR[node.kind],
      enabled: true,
    };
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
