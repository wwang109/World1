import Phaser from 'phaser';
import { shopCatalog } from '../../data/shopTypes';
import { eventThemeBlurb } from '../ui/eventThemeBlurb';
import { DESKTOP_PROFILE } from '../layoutProfile';
import { FONT, SCREEN, UI } from '../theme';
import { rebuildScene } from '../sceneRebuild';
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
  WAVE_COUNT,
  type RunNode,
  type RunNodeKind,
} from '../runStore';

const F = DESKTOP_PROFILE.font;

const GX = DESKTOP_PROFILE.safe.x;
const CONTENT_TOP = 150;

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

  constructor() { super('DesktopRunMap'); }

  init(): void {
    this.statPanelOpen = false;
  }

  private rerender(): void { rebuildScene(this); }

  create(): void {
    this.cameras.main.setBackgroundColor(UI.bg);
    this.add.rectangle(0, 0, SCREEN.width, SCREEN.height, UI.bg).setOrigin(0, 0);

    const run = getActiveRun();
    if (!run) {
      this.renderTitle('RUN');
      this.renderStartPanel();
      return;
    }
    // Freshly-started run (or a stale re-entry mid-draft) — the run-context
    // draft owns installing the starting deck before any node is pickable.
    if (run.status === 'drafting') {
      this.scene.start('DesktopDraft');
      return;
    }
    if (run.status === 'victory' || run.status === 'defeat') {
      this.renderBanner(run.status);
      return;
    }

    this.renderTitle('RUN');
    this.renderHeaderStats(run);
    this.renderDeckButton();
    this.renderTrail(run);
    if (this.statPanelOpen) {
      renderRunStatPanel(this, {
        compact: false,
        onCancel: () => { this.statPanelOpen = false; this.rerender(); },
        onConfirm: () => { this.statPanelOpen = false; this.rerender(); },
        onChanged: () => this.rerender(),
      });
    }
  }

  private renderTitle(label: string): void {
    this.add.text(GX, 24, 'WORLD1 / RUN MODE', {
      fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${F.label}px`, color: UI.textAccent,
    });
    this.add.text(GX, 44, label, {
      fontFamily: FONT.display, fontStyle: 'bold', fontSize: `${F.big}px`, color: UI.text,
    });
  }

  private renderHeaderStats(run: NonNullable<ReturnType<typeof getActiveRun>>): void {
    const runDepth = run.map.depths.length - 1;
    const nextCol = run.map.depths[run.depth + 1];
    const wave = nextCol?.[0]?.wave ?? run.map.depths[run.depth]?.[0]?.wave ?? 1;
    const parts = [
      `WAVE ${wave} / ${WAVE_COUNT}`,
      `DEPTH ${run.depth} / ${runDepth}`,
      `GOLD ${run.gold}`,
      `HERO LV ${run.heroLevel}`,
      `${run.wins}W · ${run.losses}L`,
    ];
    const badgeX = SCREEN.width - GX;
    const badgeY = 20;
    const badgeW = renderBankedPlBadge(this, badgeX, badgeY, F.tiny, () => { this.statPanelOpen = true; this.rerender(); });
    this.add.text(SCREEN.width - GX - (badgeW > 0 ? badgeW + 14 : 0), 44 + F.big - F.name, parts.join('   ·   '), {
      fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${F.name}px`, color: UI.textAccent,
    }).setOrigin(1, 0);
    this.add.rectangle(GX, CONTENT_TOP - 16, SCREEN.width - GX * 2, 1, UI.border, 0.7).setOrigin(0, 0);
  }

  /** DECK / BAG entry point — opens the shared Deck Build scene in RUN
   * context (reads/writes the run's pieces/bagSlots/gemInventory via
   * `runStore`, not `demoState`). The only way into deck management between
   * fights (task item #3). */
  private renderDeckButton(): void {
    const w = 132; const h = 30;
    // Right of the RUN title block (which occupies GX..~GX+150 on two lines) —
    // at GX it drew straight over "WORLD1 / RUN MODE".
    const x = GX + 210; const y = 22;
    const btn = this.add.rectangle(x, y, w, h, UI.panelAlt, 1).setOrigin(0, 0).setStrokeStyle(1, UI.chip, 0.9).setInteractive({ useHandCursor: true });
    this.add.text(x + w / 2, y + h / 2, 'DECK / BAG', {
      fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${F.tiny}px`, color: UI.textAccent,
    }).setOrigin(0.5);
    btn.on('pointerover', () => btn.setFillStyle(UI.slotHover));
    btn.on('pointerout', () => btn.setFillStyle(UI.panelAlt));
    btn.on('pointerdown', () => { setDeckBuildContext('run'); this.scene.start('DesktopDeck'); });
  }

  // ---------- the trail ----------

  private renderTrail(run: NonNullable<ReturnType<typeof getActiveRun>>): void {
    const area = SCREEN.width - GX * 2;
    const gap = DESKTOP_PROFILE.gap;
    const nextDepth = run.depth + 1;
    const runDepth = run.map.depths.length - 1;
    const choiceColW = 420;
    const thinCols = runDepth - 1;
    const thinColW = (area - choiceColW - gap * thinCols) / thinCols;
    const top = CONTENT_TOP;
    const bottom = SCREEN.height - DESKTOP_PROFILE.safe.bottom;
    const trailY = top + 34;

    // Wave grouping — a subtle alternating band per wave behind the trail,
    // plus a "Wn" label centered over that wave's column span, so the player
    // can see how many waves remain and how columns group into them.
    const waveOf = (d: number): number => run.map.depths[d]?.[0]?.wave ?? 1;
    let x = GX;
    let waveStartX = x;
    let waveStartDepth = 1;
    for (let depth = 1; depth <= runDepth; depth++) {
      const isNext = depth === nextDepth;
      const w = isNext ? choiceColW : thinColW;
      const endsWave = depth === runDepth || waveOf(depth + 1) !== waveOf(depth);
      if (endsWave) {
        const spanW = x + w - waveStartX;
        const wv = waveOf(depth);
        this.add.rectangle(waveStartX, top - 10, spanW, bottom - (top - 10), wv % 2 === 0 ? 0x0d1b28 : UI.panelMuted, 0.18).setOrigin(0, 0);
        this.add.text(waveStartX + spanW / 2, top - 10, `WAVE ${wv}`, {
          fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${F.tiny}px`, color: UI.textSoft,
        }).setOrigin(0.5, 0);
        waveStartX = x + w + gap;
        waveStartDepth = depth + 1;
      }
      x += w + gap;
    }
    void waveStartDepth;

    x = GX;
    for (let depth = 1; depth <= runDepth; depth++) {
      const isNext = depth === nextDepth;
      const w = isNext ? choiceColW : thinColW;
      this.add.text(x + w / 2, top + 6, `D${depth}`, {
        fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${F.tiny}px`, color: UI.textDim,
      }).setOrigin(0.5, 0);

      if (isNext) {
        this.renderChoiceColumn(x, top + 34, w, bottom - (top + 34));
      } else if (depth < run.depth) {
        this.add.circle(x + w / 2, trailY, 5, 0x8d724a, 0.6);
      } else if (depth === run.depth) {
        this.add.circle(x + w / 2, trailY, 7, 0, 0).setStrokeStyle(2, UI.chip, 1);
        this.add.circle(x + w / 2, trailY, 3, UI.chip, 1);
      } else {
        const count = run.map.depths[depth]?.length ?? 0;
        for (let i = 0; i < count; i++) {
          this.add.rectangle(x + w / 2, trailY + i * 16, 14, 10, UI.panelMuted, 0.35).setStrokeStyle(1, UI.border, 0.2);
        }
      }
      x += w + gap;
    }
  }

  private renderChoiceColumn(x: number, top: number, w: number, availableH: number): void {
    const options = choices();
    if (options.length === 0) {
      this.add.text(x + w / 2, top + 20, '···', {
        fontFamily: FONT.body, fontSize: `${F.label}px`, color: UI.textSoft,
      }).setOrigin(0.5, 0);
      return;
    }
    if (options.length === 1) {
      this.add.text(x + w / 2, top, 'MANDATORY', {
        fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${F.tiny}px`, color: UI.textSoft,
      }).setOrigin(0.5, 0);
      top += F.tiny + 6;
      availableH -= F.tiny + 6;
    }
    const gap = 12;
    // Density pass: compact content-fit rows (name + one hint line) instead of
    // stretching to a big mostly-empty box — cap at 92 (was 170).
    const panelH = Math.min(92, (availableH - gap * (options.length - 1)) / options.length);
    let y = top;
    for (const node of options) {
      this.renderChoicePanel(x, y, w, panelH, node);
      y += panelH + gap;
    }
  }

  private renderChoicePanel(x: number, y: number, w: number, h: number, node: RunNode): void {
    const color = KIND_COLOR[node.kind];
    const cell = this.add.rectangle(x, y, w, h, UI.panel, 0.95).setOrigin(0, 0)
      .setStrokeStyle(2, color, 0.9).setInteractive({ useHandCursor: true });
    cell.on('pointerover', () => cell.setFillStyle(UI.slotHover, 0.95));
    cell.on('pointerout', () => cell.setFillStyle(UI.panel, 0.95));
    cell.on('pointerdown', () => {
      pickNode(node.id);
      const sceneName = node.kind === 'shop' ? 'DesktopShop' : node.kind === 'event' ? 'DesktopRunEvent' : 'DesktopRunPrep';
      this.scene.start(sceneName);
    });

    this.add.rectangle(x, y, 6, h, color).setOrigin(0, 0);
    const shop = node.kind === 'shop' && node.shopId ? shopCatalog[node.shopId] : undefined;
    // Event themes are assigned at map-gen (not by rolling the event), so a
    // choice can advertise what it offers without consuming the event bag.
    const themeSuffix = shop ? shop.name.toUpperCase() : node.eventTheme?.toUpperCase();
    const titleLabel = themeSuffix ? `${KIND_LABEL[node.kind]} · ${themeSuffix}` : KIND_LABEL[node.kind];
    this.add.text(x + 20, y + 14, titleLabel, {
      fontFamily: FONT.display, fontStyle: 'bold', fontSize: `${F.name}px`, color: UI.text,
    });

    if (node.kind === 'shop') {
      if (shop) {
        this.add.text(x + 20, y + 14 + F.name + 4, shop.tagline, {
          fontFamily: FONT.body, fontSize: `${F.tiny}px`, color: UI.textDim, wordWrap: { width: w - 40 },
        });
        this.add.text(x + 20, y + h - 20, `${shop.shelf.cards} CARDS · ${shop.shelf.gems} GEMS`, {
          fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${F.tiny}px`, color: UI.textSoft,
        });
      }
    } else if (node.kind === 'fight' || node.kind === 'boss') {
      const encounter = previewEncounter(node);
      if (encounter) {
        const name = enemyNameFor(encounter.enemyId);
        this.add.text(x + 20, y + 14 + F.name + 6, `${name} · LV ${encounter.effectiveLevel} · ${encounter.title.toUpperCase()}`, {
          fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${F.small}px`, color: UI.textAccent, wordWrap: { width: w - 40 },
        });
      }
    } else if (node.kind === 'event') {
      this.add.text(x + 20, y + 14 + F.name + 6, eventThemeBlurb(node.eventTheme), {
        fontFamily: FONT.body, fontSize: `${F.tiny}px`, color: UI.textDim,
      });
    }
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
    const startY = py + ph - 70;
    const start = this.add.rectangle(cx, startY, startW, 48, UI.chip, 1).setOrigin(0.5, 0).setStrokeStyle(2, UI.border, 1).setInteractive({ useHandCursor: true });
    this.add.text(cx, startY + 24, 'START', { fontFamily: FONT.display, fontStyle: 'bold', fontSize: `${F.title}px`, color: UI.textOnChip }).setOrigin(0.5);
    start.on('pointerdown', () => { startRun(getPendingSeed()); this.scene.start('DesktopDraft'); });

    this.add.text(cx, py + ph - 16, 'Next: draft your starting deck (4 picks).', {
      fontFamily: FONT.body, fontSize: `${F.tiny}px`, color: UI.textSoft,
    }).setOrigin(0.5, 1);
  }

  // ---------- victory / defeat banner ----------

  private renderBanner(status: 'victory' | 'defeat'): void {
    const win = status === 'victory';
    this.add.rectangle(0, 0, SCREEN.width, SCREEN.height, win ? UI.goodSoft : UI.badSoft, 1).setOrigin(0, 0);
    const cx = SCREEN.width / 2;
    this.add.text(cx, SCREEN.height / 2 - 60, win ? 'VICTORY' : 'DEFEAT', {
      fontFamily: FONT.display, fontStyle: 'bold', fontSize: `${F.big * 1.6}px`, color: win ? UI.text : UI.text,
    }).setOrigin(0.5);
    const run = getActiveRun()!;
    this.add.text(cx, SCREEN.height / 2 + 10, `${run.wins}W · ${run.losses}L · GOLD ${run.gold} · HERO LV ${run.heroLevel}`, {
      fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${F.name}px`, color: UI.textAccent,
    }).setOrigin(0.5);
    const btn = this.add.rectangle(cx, SCREEN.height / 2 + 70, 220, 48, UI.chip, 1).setOrigin(0.5, 0).setStrokeStyle(2, UI.border, 1).setInteractive({ useHandCursor: true });
    this.add.text(cx, SCREEN.height / 2 + 94, 'NEW RUN', { fontFamily: FONT.display, fontStyle: 'bold', fontSize: `${F.title}px`, color: UI.textOnChip }).setOrigin(0.5);
    btn.on('pointerdown', () => { clearRun(); this.rerender(); });
  }
}
