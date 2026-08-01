import Phaser from 'phaser';
import { shopCatalog } from '../../data/shopTypes';
import { eventThemeBlurb } from '../ui/eventThemeBlurb';
import { DESKTOP_PROFILE } from '../layoutProfile';
import { FONT, SCREEN, UI } from '../theme';
import { rebuildScene } from '../sceneRebuild';
import { renderRunChoicePanel, type RunChoiceViewModel } from '../ui/RunChoicePanel';
import { auditTextBlock } from '../ui/controlLayoutAudit';
import { renderRetireConfirm, renderRunHud, snapshotRunProgress } from '../ui/RunProgressStrip';
import { renderRunRouteBoard, snapshotRunRoute } from '../ui/RunRouteBoard';
import { runScreenTemplate } from '../ui/runScreenTemplate';
import { renderRunStatPanel } from '../ui/RunStatPanel';
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
  retireActiveRun,
  startRun,
  type RunNode,
  type RunNodeKind,
} from '../runStore';

const F = DESKTOP_PROFILE.font;
const TEMPLATE = runScreenTemplate('desktop');

const GX = DESKTOP_PROFILE.safe.x;
const CONTENT_TOP = TEMPLATE.regions.content.y;

/** The HUD's stat strip before a run exists (the "START A NEW RUN" state) —
 * all zeroes, no banked-PL/RETIRE actions to show. */
const EMPTY_HUD_SNAPSHOT = { day: 0, wave: 1, gold: 0, heroLevel: 1, lives: 0, bossesCleared: 0, wins: 0, losses: 0 };

/** Steel-blue / gold-bronze / green / red — all already in the shared UI
 * palette, kept distinct per node kind across every rendering of the map. */
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
 * Desktop Run Map — the Run Mode node-choice screen: a horizontal trail of
 * depth columns (thin "cleared"/"undiscovered" pips either side of a wide
 * column holding the 2-3 pickable next-node panels), a header with depth/
 * gold/hero LV/win-loss, and a START RUN panel when no run is active yet.
 * A pure playback/selection surface over `src/game/runStore` — no combat or
 * map-generation logic lives here. Reachable at ?scene=desktop-runmap.
 */
export class DesktopRunMapScene extends Phaser.Scene {
  private statPanelOpen = false;
  private retireConfirmOpen = false;

  constructor() { super('DesktopRunMap'); }

  init(): void {
    this.statPanelOpen = false;
    this.retireConfirmOpen = false;
  }

  private rerender(): void { rebuildScene(this); }

  create(): void {
    this.cameras.main.setBackgroundColor(UI.bg);
    this.add.rectangle(0, 0, SCREEN.width, SCREEN.height, UI.bg).setOrigin(0, 0);

    const run = getActiveRun();
    if (!run) {
      this.renderHud(undefined);
      this.renderStartPanel();
      return;
    }
    // Freshly-started run (or a stale re-entry mid-draft) — the run-context
    // draft owns installing the starting deck before any node is pickable.
    if (run.status === 'drafting') {
      this.scene.start('DesktopDraft');
      return;
    }
    if (run.status === 'defeat' || run.status === 'retired') {
      this.renderBanner(run.status);
      return;
    }

    this.renderHud(run);
    this.renderTrail(run);
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
        onConfirm: () => { retireActiveRun(); this.rerender(); },
      });
    }
  }

  /** THE run HUD — identical header on every run screen (`runScreenTemplate`).
   * `run` undefined only on the pre-start "START A NEW RUN" state (no stats
   * to show yet, so the strip reads all zeroes and the actions row is bare). */
  private renderHud(run: NonNullable<ReturnType<typeof getActiveRun>> | undefined): void {
    renderRunHud(this, {
      screen: 'RUN',
      compact: false,
      snapshot: run ? snapshotRunProgress(run) : EMPTY_HUD_SNAPSHOT,
      onOpenStatPanel: run ? () => { this.statPanelOpen = true; this.rerender(); } : undefined,
      actions: run ? {
        secondary: { label: 'DECK / BAG', onPress: () => { setDeckBuildContext('run'); this.scene.start('DesktopDeck'); } },
        tertiary: { label: 'RETIRE', danger: true, onPress: () => { this.retireConfirmOpen = true; this.rerender(); } },
      } : undefined,
    });
  }

  // ---------- the trail ----------

  private renderTrail(run: NonNullable<ReturnType<typeof getActiveRun>>): void {
    const area = SCREEN.width - GX * 2;
    const top = CONTENT_TOP;
    const bottom = SCREEN.height - DESKTOP_PROFILE.safe.bottom;
    const route = snapshotRunRoute(run);
    const bounds = { x: GX, y: top, w: area, h: bottom - top };
    renderRunRouteBoard(this, bounds, route, { mode: 'desktop' });

    if (route.columns.length === 0) return;
    // FIXED position from the template — the choices used to be centred on the
    // player's current depth, so they slid across the screen as the run
    // advanced and had to be re-found every stop. The route board below still
    // shows where you are; the thing you CLICK never moves.
    const slot = TEMPLATE.contentSlots.choices;
    this.renderChoiceColumn(slot.x, slot.y, slot.width, slot.height);
  }

  private renderChoiceColumn(x: number, top: number, w: number, availableH: number): void {
    const options = choices();
    if (options.length === 0) {
      this.add.text(x + w / 2, top + 20, '···', {
        fontFamily: FONT.body, fontSize: `${F.label}px`, color: UI.textSoft,
      }).setOrigin(0.5, 0);
      return;
    }
    const planner = this.add.text(x + w / 2, top, 'CHOOSE YOUR NEXT STOP', {
      fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${F.tiny}px`, color: UI.textAccent,
    }).setOrigin(0.5, 0);
    auditTextBlock(planner, { name: 'Desktop run map choice planner', maxWidth: w, maxHeight: F.tiny * 2, minFontSize: 8 });
    top += F.tiny + 8;
    availableH -= F.tiny + 8;
    if (options.length === 1) {
      const mandatory = this.add.text(x + w / 2, top, 'MANDATORY', {
        fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${F.tiny}px`, color: UI.textSoft,
      }).setOrigin(0.5, 0);
      auditTextBlock(mandatory, { name: 'Desktop run map mandatory label', maxWidth: w, maxHeight: F.tiny * 2, minFontSize: 8 });
      top += F.tiny + 6;
      availableH -= F.tiny + 6;
    }
    const gap = 12;
    // Density pass: compact content-fit rows (name + one hint line) instead of
    // stretching to a big mostly-empty box — cap at 92 (was 170).
    const panelH = Math.min(92, (availableH - gap * (options.length - 1)) / options.length);
    let y = top;
    for (const node of options) {
      renderRunChoicePanel(this, { x, y, w, h: panelH }, this.choiceViewModel(node), {
        font: F,
        onSelect: () => {
          pickNode(node.id);
          const sceneName = node.kind === 'shop' ? 'DesktopShop' : node.kind === 'event' ? 'DesktopRunEvent' : 'DesktopRunPrep';
          this.scene.start(sceneName);
        },
      });
      y += panelH + gap;
    }
  }

  private choiceViewModel(node: RunNode): RunChoiceViewModel {
    const shop = node.kind === 'shop' && node.shopId ? shopCatalog[node.shopId] : undefined;
    // Event themes are assigned at map-gen (not by rolling the event), so a
    // choice can advertise what it offers without consuming the event bag.
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
    const pw = 460; const ph = 220;
    const px = (SCREEN.width - pw) / 2;
    const py = (SCREEN.height - ph) / 2;
    this.add.rectangle(px, py, pw, ph, UI.panelAlt, 0.96).setOrigin(0, 0).setStrokeStyle(2, UI.border, 1);
    const cx = px + pw / 2;
    this.add.text(cx, py + 24, 'START A NEW RUN', {
      fontFamily: FONT.display, fontStyle: 'bold', fontSize: `${F.name}px`, color: UI.text,
    }).setOrigin(0.5, 0);

    const seedRowY = py + 74;
    const seedLabelW = 46;
    const rerollW = 88;
    const seedBoxW = pw - 80 - seedLabelW - rerollW - 16;
    const seedX = px + 40;
    this.add.text(seedX, seedRowY + 18, 'SEED', { fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${F.tiny}px`, color: UI.textDim }).setOrigin(0, 0.5);
    this.add.rectangle(seedX + seedLabelW + 8, seedRowY, seedBoxW, 36, UI.panelMuted).setOrigin(0, 0).setStrokeStyle(1, UI.border, 0.6);
    this.add.text(seedX + seedLabelW + 8 + 12, seedRowY + 18, `${getPendingSeed()}`, { fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${F.name}px`, color: UI.text }).setOrigin(0, 0.5);
    const rerollX = seedX + seedLabelW + 8 + seedBoxW + 8;
    const reroll = this.add.rectangle(rerollX, seedRowY, rerollW, 36, UI.chip, 1).setOrigin(0, 0).setStrokeStyle(1, UI.border, 1).setInteractive({ useHandCursor: true });
    this.add.text(rerollX + rerollW / 2, seedRowY + 18, 'REROLL', { fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${F.small}px`, color: UI.textOnChip }).setOrigin(0.5);
    reroll.on('pointerdown', () => { rerollPendingSeed(); this.rerender(); });

    const startW = pw - 80;
    // The caption below is bottom-anchored at ph-16 and ~13px tall, so it
    // reaches up to ph-29; the button must clear that, not end at ph-22.
    const startY = py + ph - 84;
    const start = this.add.rectangle(cx, startY, startW, 48, UI.chip, 1).setOrigin(0.5, 0).setStrokeStyle(2, UI.border, 1).setInteractive({ useHandCursor: true });
    this.add.text(cx, startY + 24, 'START', { fontFamily: FONT.display, fontStyle: 'bold', fontSize: `${F.title}px`, color: UI.textOnChip }).setOrigin(0.5);
    start.on('pointerdown', () => { startRun(getPendingSeed()); this.scene.start('DesktopDraft'); });

    this.add.text(cx, py + ph - 16, 'Next: draft your starting deck (4 picks).', {
      fontFamily: FONT.body, fontSize: `${F.tiny}px`, color: UI.textSoft,
    }).setOrigin(0.5, 1);
  }

  // ---------- defeat / retired end-summary banner ----------

  /** The run's end screen — reached at 0 lives (`'defeat'`) or a voluntary
   * RETIRE (`'retired'`). `'victory'` is legacy (the engine never sets it any
   * more, see `RunStatus`) and is deliberately not handled here. */
  private renderBanner(status: 'defeat' | 'retired'): void {
    const retired = status === 'retired';
    this.add.rectangle(0, 0, SCREEN.width, SCREEN.height, retired ? UI.panelMuted : UI.badSoft, 1).setOrigin(0, 0);
    const cx = SCREEN.width / 2;
    this.add.text(cx, SCREEN.height / 2 - 70, retired ? 'RUN RETIRED' : 'DEFEAT', {
      fontFamily: FONT.display, fontStyle: 'bold', fontSize: `${F.big * 1.6}px`, color: UI.text,
    }).setOrigin(0.5);
    const run = getActiveRun()!;
    this.add.text(cx, SCREEN.height / 2 - 4, `BOSSES CLEARED ${run.bossesCleared}   ·   DAYS SURVIVED ${run.depth}`, {
      fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${F.name}px`, color: UI.textAccent,
    }).setOrigin(0.5);
    this.add.text(cx, SCREEN.height / 2 + 24, `GOLD ${run.gold}   ·   HERO LV ${run.heroLevel}   ·   ${run.wins}W / ${run.losses}L`, {
      fontFamily: FONT.body, fontSize: `${F.small}px`, color: UI.textDim,
    }).setOrigin(0.5);
    const btn = this.add.rectangle(cx, SCREEN.height / 2 + 70, 220, 48, UI.chip, 1).setOrigin(0.5, 0).setStrokeStyle(2, UI.border, 1).setInteractive({ useHandCursor: true });
    this.add.text(cx, SCREEN.height / 2 + 94, 'NEW RUN', { fontFamily: FONT.display, fontStyle: 'bold', fontSize: `${F.title}px`, color: UI.textOnChip }).setOrigin(0.5);
    btn.on('pointerdown', () => { clearRun(); this.rerender(); });
  }
}
