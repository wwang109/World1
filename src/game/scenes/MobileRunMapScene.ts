import Phaser from 'phaser';
import { shopCatalog } from '../../data/shopTypes';
import { shopMapFooter } from '../ui/shopMapFooter';
import { eventThemeBlurb } from '../ui/eventThemeBlurb';
import { MOBILE_PROFILE } from '../layoutProfile';
import { FONT, SCREEN, textRole, UI } from '../theme';
import { rebuildScene } from '../sceneRebuild';
import { renderRunChoicePanel, runChoicePanelMinHeight, type RunChoiceViewModel } from '../ui/RunChoicePanel';
import { auditTextBlock } from '../ui/controlLayoutAudit';
import { renderRetireConfirm, renderRunHud, snapshotRunProgress } from '../ui/RunProgressStrip';
import { renderBandReadOverlay, renderRunBandBanner, renderRunRouteBoard, snapshotRunRoute } from '../ui/RunRouteBoard';
import { bandBannerForWave, bandBannerHeight, type BandBannerViewModel } from '../ui/bandBannerViewModel';
import { runScreenLayoutRef } from '../ui/runScreenLayout';
import { addRunArt, eventArtKey, RUN_ART_KEYS, shopArtKey } from '../ui/runArt';
import { renderRunStatPanel } from '../ui/RunStatPanel';
import { renderRunStatsGrid, renderRunStatsOverlay, runStatsPairs } from '../ui/RunStatsPanel';
import { setDeckBuildContext } from '../deckBuildContext';
import {
  choices,
  clearRun,
  currentNode,
  encounterHintDetail,
  FIGHT_TIER_LABEL,
  getActiveRun,
  pickNode,
  previewEncounter,
  retireActiveRun,
  type RunNode,
  type RunNodeKind,
} from '../runStore';
import { attachButtonFeel } from '../ui/motion';

const F = MOBILE_PROFILE.font;
// LIVE reference: every `TEMPLATE.*` read below resolves against the
// CURRENT viewport (the canvas fills the window -- see game/viewport.ts).
const TEMPLATE = runScreenLayoutRef('mobile');
const EMPTY_HUD_SNAPSHOT = { day: 0, wave: 1, gold: 0, heroLevel: 1, lives: 0, bossesCleared: 0, wins: 0, losses: 0 };

/** The TALLEST the choice stack can ever be: the planner heading, then three
 * panels at the 94px ceiling with a 10px gap between them. A one-option stop
 * adds a MANDATORY label but drops two panels, so it is far shorter; three is
 * the worst case and therefore the only number the map lane has to respect.
 *
 * The template's `choices` slot is 386px tall and this stack has never needed
 * more than 319 of it, so ~67px sat empty at the bottom of every phone run map
 * (visible as the gap under the third card). BOTTOM-ANCHORING the stack inside
 * its slot hands that back to the map lane above, where the trail lives — and
 * because the number is a constant, not a measurement of the current options,
 * the block still sits at a FIXED y and does not move between stops. */
const CHOICE_STACK_H = MOBILE_PROFILE.font.tiny + 8 + 94 * 3 + 10 * 2;

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
  private retireConfirmOpen = false;
  private statsOverlayOpen = false;
  /** The band banner's "READ THE BAND ›" overlay — the full forecast card. */
  private bandReadOpen = false;
  /** The band model this render drew, kept so the overlay shows the SAME read
   * the banner summarised (one forecast per render, never a second roll). */
  private band: BandBannerViewModel | null = null;

  constructor() { super('MobileRunMap'); }

  init(): void {
    this.statPanelOpen = false;
    this.retireConfirmOpen = false;
    this.statsOverlayOpen = false;
    this.bandReadOpen = false;
    this.band = null;
  }

  private rerender(): void { rebuildScene(this); }

  create(): void {
    this.W = SCREEN.width; this.H = SCREEN.height;
    this.cameras.main.setBackgroundColor(0x0b1420);
    addRunArt(this, RUN_ART_KEYS.runMap, { x: 0, y: 0, width: this.W, height: this.H }, 0.2);
    this.add.rectangle(0, 0, this.W, this.H, UI.bg, 0.58).setOrigin(0, 0);

    const run = getActiveRun();
    if (!run) {
      // ONE front door: no duplicate start panel here — the Start scene owns
      // starting runs (seed + reroll live there now).
      this.scene.start('Start');
      return;
    }
    // Freshly-started run (or a stale re-entry mid-draft) — the run-context
    // draft owns installing the starting deck before any node is pickable.
    if (run.status === 'drafting') {
      this.scene.start('MobileDraft');
      return;
    }
    if (run.status === 'defeat' || run.status === 'retired') {
      this.renderBanner(run.status);
      return;
    }

    this.renderHud(run);
    // Every overlay below (stat panel / retire confirm / stats overlay) is a
    // centered, opaque-panel modal over a full-screen scrim — its dialog rect
    // sits ON TOP OF (and, for retire confirm, fully inside) the trail's
    // "STOP IN PROGRESS"/choice block region. Drawing the trail underneath it
    // anyway leaves dead Text objects at the exact same screen coordinates as
    // the dialog's own copy — invisible to the player (the opaque panel is a
    // higher Phaser depth), but still real GameObjects the HUD audit's text-
    // bounds overlap check (rightly) flags, since it has no notion of one
    // object being drawn UNDER another. Skipping the trail while a modal owns
    // the screen is the honest fix: nothing is drawn that could never be seen.
    const modalOpen = this.statPanelOpen || this.retireConfirmOpen || this.statsOverlayOpen || this.bandReadOpen;
    // The banner is what normally composes `this.band` (a class field, which
    // `rebuildScene` deliberately preserves), but the trail is skipped while a
    // modal owns the screen — so the read is composed straight from the run
    // instead. Without this, an overlay opened on a rebuild that skipped the
    // trail would render nothing behind its scrim.
    if (!modalOpen) this.renderTrail(run);
    else if (this.bandReadOpen) this.band = bandBannerForWave(run, snapshotRunProgress(run).wave);
    if (this.statPanelOpen) {
      renderRunStatPanel(this, {
        compact: true,
        onCancel: () => { this.statPanelOpen = false; this.rerender(); },
        onConfirm: () => { this.statPanelOpen = false; this.rerender(); },
        onChanged: () => this.rerender(),
      });
    }
    if (this.retireConfirmOpen) {
      // REVIEWED AND LEFT (audit 2026-08): no scene-level generic pointerdown/pointerup listener at all in this file — grep-confirmed.
      // So `renderRetireConfirm`'s rebuild-on-close can never race a
      // stale-vs-fresh scene-level re-dispatch (see
      // `wasPointerConsumedByRebuild`'s doc comment, sceneRebuild.ts) — the
      // mechanism that guard exists for cannot manifest here. No guard
      // needed. (Contrast `MobileRunEventScene`, which DOES have one.)
      renderRetireConfirm(this, {
        compact: true,
        onCancel: () => { this.retireConfirmOpen = false; this.rerender(); },
        onConfirm: () => { retireActiveRun(); this.rerender(); },
      });
    }
    if (this.statsOverlayOpen) {
      renderRunStatsOverlay(this, {
        compact: true,
        onClose: () => { this.statsOverlayOpen = false; this.rerender(); },
      });
    }
    if (this.bandReadOpen && this.band) {
      renderBandReadOverlay(this, this.band, {
        compact: true,
        onClose: () => { this.bandReadOpen = false; this.rerender(); },
      });
    }
  }

  /** THE run HUD — identical header on every run screen (`runScreenTemplate`).
   * `onOpenStatsOverlay` puts the STATS opener ON the stat strip itself
   * (tap DAY·WAVE·GOLD·LV·LIVES·BOSSES) — replaces the old floating "STATS"
   * corner tag, which read as misplaced floating over the route board. */
  private renderHud(run: NonNullable<ReturnType<typeof getActiveRun>> | undefined): void {
    renderRunHud(this, {
      screen: 'RUN',
      compact: true,
      snapshot: run ? snapshotRunProgress(run) : EMPTY_HUD_SNAPSHOT,
      onOpenStatPanel: run ? () => { this.statPanelOpen = true; this.rerender(); } : undefined,
      onOpenStatsOverlay: run ? () => { this.statsOverlayOpen = true; this.rerender(); } : undefined,
      actions: run ? {
        secondary: { label: 'DECK/BAG', onPress: () => { setDeckBuildContext('run'); this.scene.start('MobileDeckBuild'); } },
        tertiary: { label: 'RETIRE', danger: true, onPress: () => { this.retireConfirmOpen = true; this.rerender(); } },
      } : undefined,
    });
  }

  // ---------- the trail ----------

  private renderTrail(run: NonNullable<ReturnType<typeof getActiveRun>>): void {
    // THE BAND BANNER takes the top of the map lane on mobile exactly as it
    // takes the left of it on desktop — same blocks, same claims, same words
    // (both-platforms rule): a phone is not told less about the band it is
    // standing in than a desktop is.
    //
    // THE TRAIL KEEPS THE REST, and the rest is now measured honestly. When the
    // banner first landed, this lane was 100..426 and the banner took 163 of
    // it: the trail dropped from 310px to 155px and its cell at wave 10 (36
    // depths) went 8.2px -> 3.9px, which is a smear, not a map. The commit
    // message claimed the banner "reclaims the dead 28px the hardcoded 310
    // left"; it took 155. Two things fix it and neither removes the banner:
    // the choice stack is bottom-anchored in its slot, which gives this lane
    // ~67px it was never using (see CHOICE_STACK_H), and the trail WINDOWS
    // itself so a depth is never drawn smaller than it can be read at
    // (runRouteLayout.ts). The second is the one that still holds at wave 30.
    const band = bandBannerForWave(run, snapshotRunProgress(run).wave);
    this.band = band;
    const laneTop = TEMPLATE.regions.content.y;
    const bannerH = bandBannerHeight(band, 'mobile');
    renderRunBandBanner(this, { x: 10, y: laneTop, w: this.W - 20, h: bannerH }, band, {
      mode: 'mobile',
      onOpenRead: () => { this.bandReadOpen = true; this.rerender(); },
    });
    // FIXED position (a constant offset from the template slot, not a
    // measurement of this stop's options) so the choices never move between
    // stops — same reasoning as desktop.
    const slot = TEMPLATE.contentSlots.choices;
    const choicesTop = slot.y + slot.height - CHOICE_STACK_H;
    const routeTop = laneTop + bannerH + 8;
    const routeBounds = { x: 10, y: routeTop, w: this.W - 20, h: Math.max(60, choicesTop - 12 - routeTop) };
    const route = snapshotRunRoute(run);
    renderRunRouteBoard(this, routeBounds, route, { mode: 'mobile' });

    if (route.columns.length === 0) return;
    this.renderChoiceBlock(slot.x, choicesTop, slot.width, CHOICE_STACK_H);
  }

  private renderChoiceBlock(x: number, top: number, w: number, availableH: number): void {
    // A committed-but-unresolved stop (the player detoured via DECK/BAG,
    // whose back button lands on the MAP) must offer the way BACK IN —
    // choices() is deliberately empty while a node is being resolved, so
    // without this panel the run dead-ends here.
    const pending = currentNode();
    if (pending) {
      const heading = this.add.text(x + w / 2, top, 'STOP IN PROGRESS', textRole('kicker')).setOrigin(0.5, 0);
      auditTextBlock(heading, { name: 'Mobile run map stop-in-progress heading', maxWidth: w, maxHeight: F.tiny * 2, minFontSize: 8 });
      // ASK the panel how tall it needs to be (the hand-picked 94 this
      // replaced was under the stack's real height on desktop, and the panel
      // reserves a bottom row for its SELECT affordance whether or not the
      // model carries a footer — see `runChoicePanelMinHeight`).
      renderRunChoicePanel(this, { x, y: top + F.tiny + 8, w, h: runChoicePanelMinHeight(F) }, {
        nodeId: pending.id,
        kind: pending.kind,
        title: `RETURN TO ${KIND_LABEL[pending.kind]}`,
        detail: 'Resume where you left off.',
        image: pending.kind === 'shop'
          ? { textureKey: shopArtKey(pending.shopId ?? '') }
          : pending.kind === 'event'
            ? { textureKey: eventArtKey(pending.eventTheme ?? 'training') }
            : pending.kind === 'boss'
              ? { textureKey: RUN_ART_KEYS.icon.bossSkull }
              : undefined,
        accent: KIND_COLOR[pending.kind],
        enabled: true,
      }, {
        font: F,
        onSelect: () => {
          const sceneName = pending.kind === 'shop' ? 'MobileShop' : pending.kind === 'event' ? 'MobileRunEvent' : 'MobileRunPrep';
          this.scene.start(sceneName);
        },
      });
      return;
    }
    const options = choices();
    if (options.length === 0) {
      this.add.text(x + w / 2, top + 20, '···', textRole('label', { ink: 'disabled' })).setOrigin(0.5, 0);
      return;
    }
    const planner = this.add.text(x + w / 2, top, 'CHOOSE YOUR NEXT STOP', textRole('kicker')).setOrigin(0.5, 0);
    auditTextBlock(planner, { name: 'Mobile run map choice planner', maxWidth: w, maxHeight: F.tiny * 2, minFontSize: 8 });
    top += F.tiny + 8;
    availableH -= F.tiny + 8;
    if (options.length === 1) {
      const mandatory = this.add.text(x + w / 2, top, 'MANDATORY', textRole('kicker', { ink: 'label' })).setOrigin(0.5, 0);
      auditTextBlock(mandatory, { name: 'Mobile run map mandatory label', maxWidth: w, maxHeight: F.tiny * 2, minFontSize: 8 });
      top += F.tiny + 6;
      availableH -= F.tiny + 6;
    }
    const gap = 10;
    // The 94 is a CEILING on wasted space, never a licence to squeeze below what
    // the stack needs: shop nodes carry a footer, and under the floor the detail
    // line silently ellipsizes instead of overflowing (see runChoicePanelMinHeight).
    const h = Math.max(
      runChoicePanelMinHeight(F),
      Math.min(94, (availableH - gap * (options.length - 1)) / options.length),
    );
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
    // Fight nodes (three-tier fight choices, USER-DIRECTED 2026-08-04) slot
    // their EASY/MEDIUM/HARD risk tier into this SAME "KIND · SUFFIX" title
    // grammar — mirrors DesktopRunMapScene's `choiceViewModel`.
    const themeSuffix = shop
      ? shop.name.toUpperCase()
      : node.kind === 'fight' && node.fightOption
        ? FIGHT_TIER_LABEL[node.fightOption]
        : node.eventTheme?.toUpperCase();
    const titleLabel = themeSuffix ? `${KIND_LABEL[node.kind]} · ${themeSuffix}` : KIND_LABEL[node.kind];

    if (node.kind === 'shop') {
      return {
        nodeId: node.id,
        kind: node.kind,
        title: titleLabel,
        detail: shop?.tagline ?? '',
        footer: shop && node.shopId ? shopMapFooter(node.shopId) : undefined,
        image: { textureKey: shopArtKey(node.shopId ?? '') },
        accent: KIND_COLOR[node.kind],
        enabled: true,
      };
    }

    if (node.kind === 'fight' || node.kind === 'boss') {
      const pack = previewEncounter(node);
      return {
        nodeId: node.id,
        kind: node.kind,
        title: titleLabel,
        detail: pack ? encounterHintDetail(pack, node.kind === 'fight' ? node.fightOption : undefined) : '',
        image: node.kind === 'boss' ? { textureKey: RUN_ART_KEYS.icon.bossSkull } : undefined,
        accent: KIND_COLOR[node.kind],
        enabled: true,
      };
    }

    return {
      nodeId: node.id,
      kind: node.kind,
      title: titleLabel,
      detail: eventThemeBlurb(node.eventTheme),
      image: { textureKey: eventArtKey(node.eventTheme ?? 'training') },
      accent: KIND_COLOR[node.kind],
      enabled: true,
    };
  }

  // ---------- defeat / retired end-summary banner ----------

  /** `'victory'` is legacy (the engine never sets it any more) and is
   * deliberately not handled here — only `'defeat'` (0 lives) and
   * `'retired'` (voluntary RETIRE) ever reach this. */
  private renderBanner(status: 'defeat' | 'retired'): void {
    const retired = status === 'retired';
    this.add.rectangle(0, 0, this.W, this.H, retired ? 0x1c2430 : 0x352019, 1).setOrigin(0, 0);
    const cx = this.W / 2;
    // THE ONE FIRST THING on this screen — `display` is spent here and nowhere
    // else in the scene, which is what gives the banner a reading order at all.
    this.add.text(cx, 64, retired ? 'RUN RETIRED' : 'DEFEAT', textRole('display')).setOrigin(0.5, 0);
    const run = getActiveRun()!;
    this.add.text(cx, 106, `DAYS SURVIVED ${run.depth}`, {
      ...textRole('statValue', { ink: 'accent' }), align: 'center',
    }).setOrigin(0.5, 0);
    this.add.text(cx, 130, `GOLD ${run.gold} · HERO LV ${run.heroLevel}`, {
      ...textRole('micro'), align: 'center', wordWrap: { width: this.W - 60 },
    }).setOrigin(0.5, 0);
    const gridW = this.W - 60;
    const gridTop = 158;
    const gridH = renderRunStatsGrid(this, cx - gridW / 2, gridTop, gridW, runStatsPairs(run), { compact: true });
    const btnY = gridTop + gridH + 30;
    const btn = this.add.rectangle(cx, btnY, 180, 44, 0xb78a46, 1).setOrigin(0.5, 0).setStrokeStyle(2, UI.border, 1).setInteractive({ useHandCursor: true });
    const btnLabel = this.add.text(cx, btnY + 22, 'MAIN MENU ›', textRole('label', { ink: 'onAccent' })).setOrigin(0.5);
    // Every run ends back at the ONE front door (Start scene), never a
    // map-local start panel — flow consistency per user direction 2026-08-04.
    // Shared feel (ui/motion) — this button had neither hover nor press
    // feedback. Wired on BOTH platforms in the same change (both-platforms rule).
    attachButtonFeel(this, btn, {
      fill: 0xb78a46,
      hover: UI.chipDark,
      follow: [btnLabel],
      onPress: () => { clearRun(); this.scene.start('Start'); },
    });
  }
}
