import Phaser from 'phaser';
import { playSfx } from '../audio/sfxSynth';
import { gemHeroStats, resolveDisplayHeroStats } from '../../engine/cards';
import { bankedPL } from '../../run/leveling';
import { buildAutoHeroSetup } from '../../run/encounter';
import { runCalendar } from '../../run/runCalendar';
import { type RunState } from '../runStore';
import { FONT, INK, SCREEN, UI, textRole } from '../theme';
import { BRIGHT_ART_TREATMENT } from './brightArtTreatment';
import { auditControlLabel, auditTextBlock } from './controlLayoutAudit';
import { renderBankedPlBadge } from './RunStatPanel';
import type { Rect, RunActionRole, RunScreenTemplate } from './runScreenTemplate';
import { runScreenLayout } from './runScreenLayout';
import { attachButtonFeel, hoverFillFor } from './motion';
import { playerHudStatRun, runProgressStatRun } from './statRunModel';
import { renderStatRun } from './statRunStrip';

const DESKTOP_PLAYER_STAT_GLYPH = {
  LV: '★',
  HP: '♥',
  ATK: '⚔',
  MATK: '✦',
  DEF: '🛡',
  MDEF: '♦',
  SPD: '➤',
} as const;

/**
 * THE run HUD — one identical header drawn on EVERY Run Mode screen (map,
 * prep, event, shop/draft/deck-build/battle in run context). Reads
 * `runScreenTemplate` for every coordinate; never invents its own layout.
 * Extends/absorbs the old per-scene "title + stats row + DECK button" copy
 * that used to differ screen to screen (see docs/codex-handoff.md #17/20/21/22).
 *
 * BATTLE is the one screen that draws a REDUCED chrome (2026-08-04 decision,
 * docs/design-locked.md): `renderRunStatsStrip` below draws ONLY the kicker +
 * title('BATTLE') + the stats string — no badge, no action-role buttons —
 * because battle is a playback screen with no decisions; it renders its own
 * bottom controls (REPLAY/speed/SUMMARY/CONTINUE) instead. It reuses the SAME
 * stat-string builder as `renderRunHud` so the text can never diverge from
 * every other run screen.
 */

export interface RunProgressSnapshot {
  /** Legacy transport name for the absolute route STOP (`run.depth`), never a day. */
  day: number;
  /** Legacy transport name for the absolute calendar DAY, never a local region day. */
  wave: number;
  gold: number;
  heroLevel: number;
  /** Lives remaining (0..LIVES_PER_RUN) — the run's only fail state. */
  lives: number;
  bossesCleared: number;
  /** Not shown in the always-on HUD (kept for the stat panel/end-summary). */
  wins: number;
  losses: number;
  /** PL earned but unspent (`run/leveling.ts#bankedPL`) — OPTIONAL so the two
   * hand-built pre-run snapshots (the run maps' `EMPTY_HUD_SNAPSHOT`) stay
   * valid; `snapshotRunProgress` always fills it. Drives the LV segment's
   * `+N` delta (see `statRunModel.ts#runProgressStatRun`). */
  bankedPL?: number;
  /** Current display totals from the same allocation + hero-gem fold as prep. */
  heroStats?: import('../../engine/types').CombatantStats;
  /** Socketed hero-gem contribution, shown as the shared `◆+N` attribution. */
  heroGemAdds?: Partial<import('../../engine/types').CombatantStats>;
}

/** Builds the HUD's display-only snapshot straight off `RunState` — no
 * decisions; legacy field names remain only for callers outside this slice. */
export function snapshotRunProgress(run: Readonly<RunState>): RunProgressSnapshot {
  const calendar = runCalendar(run);
  const pieces = run.pieces.map((piece) => ({ ...piece }));
  const heroSetup = buildAutoHeroSetup(run.heroLevel, pieces, run.heroAllocation).setup;
  const heroGemAdds = gemHeroStats(pieces);
  return {
    day: calendar.stop,
    wave: calendar.absoluteDay,
    gold: run.gold,
    heroLevel: run.heroLevel,
    lives: run.lives,
    bossesCleared: run.bossesCleared,
    wins: run.wins,
    losses: run.losses,
    bankedPL: bankedPL(run.heroLevel, run.heroAllocation),
    heroStats: resolveDisplayHeroStats(heroSetup.stats, pieces),
    heroGemAdds,
  };
}

export interface RunHudActionSpec {
  label: string;
  onPress: () => void;
  /** Visually flags the slot as a risky/ending action (RETIRE). */
  danger?: boolean;
  disabled?: boolean;
}

export interface RunHudActions {
  back?: RunHudActionSpec;
  /** DECK / BAG — omit on the Deck Build screen itself. */
  secondary?: RunHudActionSpec;
  /** RETIRE — omit only while a run isn't active (no run / drafting / over). */
  tertiary?: RunHudActionSpec;
  /** The screen's single go-forward action (FIGHT / START / CONTINUE › /
   * LEAVE SHOP / BUY). Omit when the screen has no single forward action
   * (e.g. Draft's per-row picker). BATTLE never reaches this at all — it
   * renders NO action roles (2026-08-04 decision): it calls
   * `renderRunStatsStrip`, not `renderRunHud`, and draws its own playback
   * footer (REPLAY/speed/SUMMARY/CONTINUE) instead. */
  primary?: RunHudActionSpec;
}

export interface RunHudOptions {
  /** The screen name shown in the title slot: RUN / PREP · FIGHT / EVENT / SHOP / DECK / BATTLE. */
  screen: string;
  snapshot: RunProgressSnapshot;
  /** Mobile (`true`) vs desktop (`false`) — same discriminator every other
   * shared UI module in this codebase uses. */
  compact: boolean;
  /** Press handler for level allocation. Desktop binds it to the LV capability
   * cell when PL is banked; compact keeps the existing separate PL badge. */
  onOpenStatPanel?: () => void;
  /**
   * Mobile-only opener for `RunStatsPanel.ts#renderRunStatsOverlay` — when
   * given AND `compact` is true, the WHOLE stats-strip rect becomes a tap
   * target (plus a tiny "⌄" hint drawn right after the stats line) so the
   * player never has to hunt for a separate floating STATS tag. Desktop
   * ignores this (its ledger is a permanent flank panel, no opener needed);
   * omit on any screen that has nothing to open (prep/shop/event/deck today —
   * only the Run Map scenes wire this).
   */
  onOpenStatsOverlay?: () => void;
  actions?: RunHudActions;
  track?: Phaser.GameObjects.GameObject[];
}

function track(list: Phaser.GameObjects.GameObject[] | undefined, obj: Phaser.GameObjects.GameObject): void {
  list?.push(obj);
}

function drawSlotButton(
  scene: Phaser.Scene,
  rect: Rect,
  spec: RunHudActionSpec | undefined,
  role: RunActionRole,
  fontSize: number,
  list: Phaser.GameObjects.GameObject[] | undefined,
): void {
  if (!spec) return; // Fixed, empty slot — never reflowed into (locked design).
  const disabled = spec.disabled ?? false;
  const fill = disabled ? UI.panelMuted : spec.danger ? UI.badSoft : role === 'primary' ? UI.chip : UI.panelAlt;
  const strokeColor = spec.danger ? UI.bad : role === 'primary' ? UI.border : UI.chip;
  // The danger slot's label takes the ALARM ink role (`textRole('label',
  // { ink: 'alarm' }).color` resolves to this exact value) rather than the raw
  // orange hex it shipped with. Only the colour is taken from the role: the
  // px size is a PER-SLOT argument (mobile primary is 13 against the row's 8),
  // so spreading the whole role here would flatten the action band.
  const textColor = disabled ? UI.textSoft : spec.danger ? INK.alarm : role === 'primary' ? UI.textOnChip : UI.textAccent;
  const btn = scene.add.rectangle(rect.x, rect.y, rect.width, rect.height, fill, disabled ? 0.5 : 1)
    .setOrigin(0, 0).setStrokeStyle(1, strokeColor, disabled ? 0.35 : 0.9);
  const label = scene.add.text(rect.x + rect.width / 2, rect.y + rect.height / 2, spec.label, {
    fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${fontSize}px`, color: textColor,
  }).setOrigin(0.5);
  track(list, btn);
  track(list, label);
  auditControlLabel(btn, label, { name: `Run HUD ${role} (${spec.label})`, horizontalPadding: 6, verticalPadding: 4, minFontSize: 7 });
  if (!disabled) {
    btn.setInteractive({ useHandCursor: true });
    // FEEL comes from the shared module (./motion) rather than the three
    // hand-rolled instant `setFillStyle` handlers this replaced: hover fades in,
    // the press darkens and sinks the plate immediately, release settles it back.
    // The LABEL rides along via `follow`, or it would sit still while its plate
    // moved. One attach here covers the 7 desktop + 7 mobile scenes that draw
    // this HUD.
    attachButtonFeel(scene, btn, {
      fill,
      hover: hoverFillFor(role === 'primary' ? 'primary' : 'default', UI),
      follow: [label],
      onPress: spec.onPress,
    });
  }
}

/** Draws kicker + title + the stats string at `t`'s rects — shared by
 * `renderRunHud` (full chrome) and `renderRunStatsStrip` (battle's statsOnly
 * chrome). Kicker/title/stats sit at IDENTICAL rects in both chrome variants
 * (`runScreenTemplate`'s guarantee), so this one function is the only place
 * either of them is drawn from.
 *
 * THE STATS LINE IS A STAT RUN, not a string this file builds. The six stats,
 * their labels, their kinds and — critically — the last-life alarm rule all
 * live in `ui/statRunModel.ts#runProgressStatRun`, and `ui/statRunStrip.ts`
 * draws them. This file used to own all of that: a plain measuring string, a
 * `StatValueKind` union, a segment builder and a `statSegmentValueColor`
 * lookup, plus a hidden `auditTextBlock` pass whose only job was to find ONE
 * shrunk font size for the whole segmented line. Every one of those was a
 * hand-rolled local copy of something `renderStatRun` now does for the four
 * other stat runs in the game — it measures with real Phaser Text, shares one
 * shrink factor across the run, floors at `TEXT_SHRINK_FLOOR_PX` and
 * bottom-aligns mixed sizes onto one reading line — so the hidden pass is gone
 * with the rest of it.
 *
 * DENSITY IS LOAD-BEARING ON MOBILE, and these numbers are MEASURED in a real
 * browser (Chromium, both profiles), not modelled. The mobile stats rect is
 * `y=40 h=14` (bottom 54) and the badge slot starts at `y=56`. A run is as tall
 * as its tallest piece, and Phaser's line box for this face measures 13px at
 * 11px type and 15px at 13px type:
 *
 *   'tight'  11px value -> row 40..53   inside its own rect, 3px clear of badge
 *   'roomy'  13px value -> row 40..55   1px OUT of its rect, 1px from the badge
 *
 * So `'tight'` is the honest fit and `'roomy'` is the 1px-clearance layout that
 * `2f9fb2a` and `2ca972a` both shipped unnoticed. Desktop's rect is `y=20 h=20`
 * with the badge at `y=46`: `'roomy'` there measures 20..39 — inside the rect,
 * 7px clear — so GOLD and LIVES get their size lead on desktop.
 *
 * Returns the x the drawn line ends at (compact/left-aligned mode) so
 * `renderRunHud` can hang its mobile disclosure hint right after it; the
 * right-aligned desktop line ends at its rect's right edge by construction.
 */
function drawKickerTitleStats(
  scene: Phaser.Scene,
  t: RunScreenTemplate,
  screen: string,
  snapshot: RunProgressSnapshot,
  compact: boolean,
  track_: Phaser.GameObjects.GameObject[] | undefined,
): { statsEndX: number } {
  // ---- kicker + title ----
  // Both roles resolve to the exact px this header already used (kicker 9/12,
  // title 16/26 mobile/desktop) — a zero-GEOMETRY move. The one thing that
  // does move is the title's ink: `UI.text` (#ecd7a4) -> `INK.primary`
  // (#f2e4c0), which is the role's own colour and the same one every other
  // converted screen title now takes. The kicker's accent is byte-identical.
  const kicker = scene.add.text(t.regions.kicker.x, t.regions.kicker.y, 'WORLD1 / RUN MODE', textRole('kicker'));
  const title = scene.add.text(t.regions.title.x, t.regions.title.y, screen, textRole('title'));
  track(track_, kicker);
  track(track_, title);
  auditTextBlock(kicker, { name: 'Run HUD kicker', maxWidth: t.regions.kicker.width, maxHeight: t.regions.kicker.height + 6, minFontSize: 7 });
  auditTextBlock(title, { name: 'Run HUD title', maxWidth: t.regions.title.width, maxHeight: t.regions.title.height + 4, minFontSize: 10 });

  // ---- stats strip — ALWAYS this order, ALWAYS this slot ----
  const statsRect = t.regions.stats;
  const statsRight = statsRect.x + statsRect.width;
  const drawn = renderStatRun(scene, runProgressStatRun(snapshot, compact), {
    // Left-aligned (compact) from the rect's left edge; full chrome stays
    // right-aligned to the rect's right edge (unchanged behaviour).
    x: compact ? statsRect.x : statsRight,
    y: statsRect.y,
    maxWidth: statsRect.width,
    align: compact ? 'left' : 'right',
    density: compact ? 'tight' : 'roomy',
    track: track_,
  });
  return { statsEndX: compact ? drawn.endX : statsRight };
}

/**
 * Draws the shared Run Mode header (kicker/title/stats/badge/actions) at the
 * IDENTICAL coordinates on every screen (`runScreenTemplate`). The scene's own
 * content starts at `runScreenLayout(platform).regions.content` — callers
 * lay out everything else themselves, but must not draw above that y.
 */
export function renderRunHud(scene: Phaser.Scene, opts: RunHudOptions): void {
  const platform = opts.compact ? 'mobile' : 'desktop';
  const t = runScreenLayout(platform);
  const F = opts.compact
    ? { kicker: 9, title: 16, stats: 9, action: 8 }
    : { kicker: 12, title: 26, stats: 12, action: 10 };

  // Run screens may now sit on luminous scenery. Keep the shared HUD as one
  // calm, readable band instead of asking every label to survive arbitrary
  // snow, sky, or lava pixels beneath it.
  const hudBackdrop = scene.add.rectangle(0, 0, SCREEN.width, t.regions.content.y, UI.bg, BRIGHT_ART_TREATMENT.chrome.headerScrimAlpha)
    .setOrigin(0, 0);
  track(opts.track, hudBackdrop);

  const { statsEndX } = drawKickerTitleStats(scene, t, opts.screen, opts.snapshot, opts.compact, opts.track);

  // Desktop keeps the title/progress row intact, then gives the hero's live
  // capabilities the left side of one shared middle row. LV itself carries
  // the banked-PL cue/action, so Run and Bag use identical cell geometry.
  // Mobile remains on its unchanged compact composition.
  if (!opts.compact && opts.snapshot.heroStats) {
    const band = t.regions.badge;
    const bandPlate = scene.add.rectangle(
      band.x, band.y - 4, band.width, band.height + 8, UI.panelAlt, 0.38,
    ).setOrigin(0, 0);
    track(opts.track, bandPlate);
    const banked = opts.snapshot.bankedPL ?? 0;
    const statRun = playerHudStatRun(opts.snapshot.heroStats, opts.snapshot.heroGemAdds, opts.snapshot.heroLevel, banked);
    const statAreaX = band.x + 16;
    const statAreaWidth = band.width - 32;
    // LV is short; HP/current-max is the widest fact. Weighted cells keep the
    // established readable HP size after adding LV instead of shrinking all
    // seven cells to the width of the longest one.
    const cellWeights = statRun.segments.map((segment) => (
      segment.label === 'LV' ? 0.6 : segment.label === 'HP' ? 1.35
        : segment.label === 'MATK' || segment.label === 'MDEF' ? 1.05 : 0.9
    ));
    const totalCellWeight = cellWeights.reduce((sum, weight) => sum + weight, 0);
    let cellOffset = 0;
    statRun.segments.forEach((segment, index) => {
      const cellWidth = statAreaWidth * cellWeights[index]! / totalCellWeight;
      const levelUpAvailable = segment.label === 'LV' && banked > 0 && Boolean(opts.onOpenStatPanel);
      if (levelUpAvailable) {
        const hit = scene.add.rectangle(
          statAreaX + cellOffset, band.y, cellWidth, band.height, UI.chip, 0.16,
        ).setOrigin(0, 0).setStrokeStyle(1, UI.chip, 0.8).setInteractive({ useHandCursor: true });
        track(opts.track, hit);
        hit.on('pointerdown', () => { playSfx('uiClick'); opts.onOpenStatPanel!(); });
      }
      if (index > 0) {
        const separator = scene.add.rectangle(
          statAreaX + cellOffset, band.y + 3, 1, band.height - 6, UI.border, 0.38,
        ).setOrigin(0, 0);
        track(opts.track, separator);
      }
      const cellInset = index === 0 ? 0 : 16;
      const cellX = statAreaX + cellOffset + cellInset;
      const cellBudget = cellWidth - (index === 0 ? 16 : 32);
      const glyph = DESKTOP_PLAYER_STAT_GLYPH[segment.label as keyof typeof DESKTOP_PLAYER_STAT_GLYPH];
      const icon = scene.add.text(cellX, band.y + 4, glyph, {
        fontFamily: FONT.body,
        fontStyle: 'bold',
        fontSize: '17px',
        color: segment.label === 'HP' ? INK.alarm : levelUpAvailable ? UI.textAccent : INK.label,
      }).setOrigin(0, 0);
      track(opts.track, icon);
      const iconGap = 6;
      renderStatRun(scene, { segments: [segment], separator: '' }, {
        x: cellX + icon.width + iconGap,
        y: band.y + 4,
        maxWidth: cellBudget - icon.width - iconGap,
        align: 'left',
        density: 'grid',
        track: opts.track,
      });
      cellOffset += cellWidth;
    });
  }

  // ---- mobile STATS opener: the whole stats-strip rect is the tap target,
  // plus a tiny "⌄" hint right after the line, so it reads as pressable
  // instead of a plain readout (replaces the old floating STATS corner tag).
  if (opts.compact && opts.onOpenStatsOverlay) {
    const statsRect = t.regions.stats;
    const hitZone = scene.add.rectangle(statsRect.x, statsRect.y - 2, statsRect.width, statsRect.height + 4, 0x000000, 0)
      .setOrigin(0, 0).setInteractive({ useHandCursor: true });
    track(opts.track, hitZone);
    hitZone.on('pointerdown', () => { playSfx('uiClick'); opts.onOpenStatsOverlay!(); });
    const hint = scene.add.text(statsEndX + 4, statsRect.y, '⌄', {
      fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${F.stats + 1}px`, color: UI.textMuted,
    });
    track(opts.track, hint);
  }

  // ---- compact keeps its established separate banked-PL badge ----
  if (opts.compact && opts.onOpenStatPanel) {
    const badgeRect = t.regions.badge;
    const badgeX = badgeRect.x + badgeRect.width;
    const badge = renderBankedPlBadge(scene, badgeX, badgeRect.y, F.stats, opts.onOpenStatPanel);
    void badge;
  }

  // ---- fixed actions (same row as desktop player stats; own row on mobile) ----
  const a = opts.actions ?? {};
  drawSlotButton(scene, t.actionSlots.back, a.back, 'back', F.action, opts.track);
  drawSlotButton(scene, t.actionSlots.secondary, a.secondary, 'secondary', F.action, opts.track);
  drawSlotButton(scene, t.actionSlots.tertiary, a.tertiary, 'tertiary', F.action, opts.track);
  drawSlotButton(scene, t.actionSlots.primary, a.primary, 'primary', opts.compact ? 13 : F.action + 2, opts.track);

  // Divider under the header, at the content region's top edge.
  //
  // IT MUST CLEAR THE ACTION/STAT BAND, not sit a hardcoded 14px above the content
  // top (fixed 2026-08-28). `content.y - 14` was authored against DESKTOP,
  // where the action row ends at y=108 and content starts at 130 — 8px of
  // clearance. On MOBILE the same arithmetic lands the line INSIDE the
  // buttons: the action band is y=74..96 and content starts at 100, so
  // `content.y - 14` = 86 is 1px off the exact vertical centre of a 22px-tall
  // button, and the rule was drawn straight through the DECK/BAG and RETIRE
  // labels — it read as strikethrough text on EVERY mobile run screen that
  // draws those buttons (map, event, prep, shop…), not just one. Deriving the
  // y from the band that actually has to be cleared fixes every platform and
  // every future template edit at once; desktop is unchanged (116), mobile
  // moves 86 -> 98, which is still above `content.y` so no scene's content
  // top moves. `runScreenTemplate.ts` stays the sole owner of the rects — this
  // only reads them (the same idiom `renderRunStatsStrip` below already uses).
  const content = t.regions.content;
  const headerBottom = Math.max(
    t.regions.actions.y + t.regions.actions.height,
    t.regions.badge.y + t.regions.badge.height,
  );
  const dividerY = Math.max(content.y - 14, headerBottom + 2);
  scene.add.rectangle(content.x, dividerY, content.width, 1, UI.border, 0.55).setOrigin(0, 0);
}

export interface RunStatsStripOptions {
  snapshot: RunProgressSnapshot;
  compact: boolean;
  track?: Phaser.GameObjects.GameObject[];
}

/**
 * BATTLE's reduced chrome (2026-08-04 decision, docs/design-locked.md):
 * kicker + title('BATTLE') + the stats string ONLY — no badge, no action-role
 * buttons, since battle is a playback screen with no decisions (it draws its
 * own bottom controls instead). Reads `runScreenTemplate(platform,
 * 'statsOnly')`, whose kicker/title/stats rects are IDENTICAL to the full
 * chrome's — the stat string can never diverge from any other run screen.
 * Sandbox battles reserve the same band via the same template but never call
 * this, so the geometry (content top, etc.) is identical either way.
 */
export function renderRunStatsStrip(scene: Phaser.Scene, opts: RunStatsStripOptions): void {
  const platform = opts.compact ? 'mobile' : 'desktop';
  const t = runScreenLayout(platform, 'statsOnly');
  drawKickerTitleStats(scene, t, 'BATTLE', opts.snapshot, opts.compact, opts.track);

  // Divider just below the stats strip — statsOnly has no badge/actions band
  // to clear, so this sits tighter than the full chrome's divider.
  const dividerY = Math.max(
    t.regions.title.y + t.regions.title.height,
    t.regions.stats.y + t.regions.stats.height,
  ) + 4;
  const content = t.regions.content;
  scene.add.rectangle(content.x, dividerY, content.width, 1, UI.border, 0.55).setOrigin(0, 0);
}

/** A pointer-carrying dialog callback — see `renderConfirmDialog`'s doc
 * comment for why the pointer is part of the contract. */
type ConfirmHandler = (pointer: Phaser.Input.Pointer) => void;

interface ConfirmDialogOpts {
  compact: boolean;
  /** `section`-role heading, e.g. 'RETIRE THIS RUN?' / '3 PL UNSPENT'. */
  title: string;
  /** `body`-role copy, centred; '\n' where the mobile line should break. */
  body: string;
  /** LEFT button — the quiet way out (CANCEL / FIGHT ANYWAY). */
  cancelLabel: string;
  /** RIGHT button — the emphasized action (RETIRE / SPEND FIRST). */
  confirmLabel: string;
  /** What the emphasized action means: `'danger'` paints panel stroke + button
   * in `UI.bad` with `onAlarm` ink (RETIRE); `'accent'` paints them in
   * `UI.chip` with `onAccent` ink — the promoted-safe register the stat
   * panel's CONFIRM already uses. */
  tone: 'danger' | 'accent';
  onCancel: ConfirmHandler;
  onConfirm: ConfirmHandler;
  /** Scrim tap. Defaults to `onCancel` (the retire dialog's behaviour). */
  onScrim?: ConfirmHandler;
}

/**
 * THE confirm-dialog idiom — a scrim + section heading + body + 2-button row,
 * shared by RETIRE (every run screen's tertiary action) and the unspent-PL
 * fight gate below. Callers own the open/close boolean and rebuild on close.
 *
 * Every handler receives the triggering `Phaser.Input.Pointer` — NOT
 * decorative. On any screen with a scene-level generic `pointerdown` listener
 * that hit-tests fresh content (drag wiring, etc.), that listener re-fires for
 * the SAME physical click once this dialog's own handler closes it via
 * `rerender()` (see `sceneRebuild.ts`'s `wasPointerConsumedByRebuild` doc
 * comment — this is the exact mechanism CONFIRMED INSTANCE #20, audit
 * 2026-08, found here). `rebuildScene()` stamps that pointer automatically,
 * so callers need do nothing further — the shop scenes' own manual
 * `consumedPointerAt` guard (an unsound plain-`downTime` comparison) was
 * removed 2026-08 in favor of relying on this structural guard alone; no
 * caller of these dialogs needs a per-screen pointer-consumption idiom of its
 * own anymore.
 *
 * POINTER-ONLY, deliberately: no Phaser dialog in this codebase binds keys
 * (only the DOM share-code prompts handle Enter/Escape — `ui/codePrompt.ts`);
 * the scrim is the whole-viewport dismiss affordance on both platforms.
 */
function renderConfirmDialog(scene: Phaser.Scene, opts: ConfirmDialogOpts): void {
  const localView = scene.data?.get('embeddedRunView') as Rect | undefined;
  if (localView) {
    const pane = (scene.data.get('embeddedEventOutcomeBounds') as Rect | undefined) ?? localView;
    const top = Math.max(pane.y, localView.y);
    const bottom = Math.min(pane.y + pane.height, localView.y + localView.height);
    renderEmbeddedConfirm(scene, opts, { x: pane.x, y: top, width: pane.width, height: Math.max(1, bottom - top) });
    return;
  }
  const platform = opts.compact ? 'mobile' : 'desktop';
  const t = runScreenLayout(platform);
  const embedded = scene.data?.get('embeddedRunView') as { x: number; y: number; width: number; height: number } | undefined;
  const { width: W, height: H } = embedded ?? t.canvas;
  const originX = embedded?.x ?? 0;
  const originY = embedded?.y ?? 0;
  const danger = opts.tone === 'danger';
  const onScrim = opts.onScrim ?? opts.onCancel;
  scene.add.rectangle(originX, originY, W, H, UI.shadow, 0.78).setOrigin(0, 0).setInteractive().setDepth(6000)
    .on('pointerdown', (pointer: Phaser.Input.Pointer) => onScrim(pointer));

  const pw = Math.min(W - 40, opts.compact ? W - 32 : 440);
  // The 168/176 baseline was tuned for a 2-line `body` (RETIRE's and the
  // unspent-PL gate's both are exactly 2) — grow the panel for a caller whose
  // body needs more (`renderMergeConsumeConfirm`'s per-card list), one line at
  // a time. Both existing callers stay at exactly their old `ph`, since
  // `extraLines` is 0 for a 2-line body — PINNED at
  // `tests/game/unspentPlConfirm.test.ts` (176 desktop / 168 mobile).
  //
  // COUNTS WRAPPED LINES, NOT `\n`s (fixed 2026-09-06 audit finding 6):
  // `opts.body` word-wraps at `pw - 48` (same width the real text below
  // uses), so a single AUTHORED line long enough to wrap on its own
  // contributes MORE than one rendered line — `opts.body.split('\n').length`
  // was blind to that and could under-size `ph` for a future longer body
  // (no bite today: the longest confirm line measured 205px in mobile's
  // 324px box, well under the wrap width). Measuring means allocating the
  // real `Text` object early (off-canvas at 0,0) and asking IT how it
  // wrapped, then moving it into place once `px`/`py` are known, rather than
  // reproducing Phaser's wrap algorithm by hand or allocating a second
  // throwaway object just to measure.
  const bodyStyle = { ...textRole('body'), align: 'center' as const, wordWrap: { width: pw - 48 } };
  const bodyText = scene.add.text(0, 0, opts.body, bodyStyle).setDepth(6002);
  const bodyLines = bodyText.getWrappedText(opts.body).length;
  const extraLines = Math.max(0, bodyLines - 2);
  const perLineH = opts.compact ? 16 : 18;
  const ph = (opts.compact ? 168 : 176) + extraLines * perLineH;
  const px = originX + (W - pw) / 2;
  const py = originY + (H - ph) / 2;
  scene.add.rectangle(px, py, pw, ph, UI.panelAlt, 0.98).setOrigin(0, 0)
    .setStrokeStyle(2, danger ? UI.bad : UI.chip, 0.9).setInteractive().setDepth(6001);

  // A dialog is a `section` heading over `body` copy over two `label` buttons —
  // the same three roles every other panel in the game now takes, so the sizes
  // come off the profile ladder instead of a local 15/18 + 11/13 pair.
  scene.add.text(px + pw / 2, py + 22, opts.title, textRole('section'))
    .setOrigin(0.5, 0).setDepth(6002);
  bodyText.setPosition(px + pw / 2, py + 52).setOrigin(0.5, 0);

  const btnW = (pw - 48 - 12) / 2;
  const btnY = py + ph - 56;
  const cancelBtn = scene.add.rectangle(px + 24, btnY, btnW, 40, UI.panelMuted, 1).setOrigin(0, 0)
    .setStrokeStyle(1, UI.border, 0.8).setInteractive({ useHandCursor: true }).setDepth(6002);
  scene.add.text(px + 24 + btnW / 2, btnY + 20, opts.cancelLabel, textRole('label'))
    .setOrigin(0.5).setDepth(6002);
  cancelBtn.on('pointerdown', (pointer: Phaser.Input.Pointer) => opts.onCancel(pointer));

  const confirmX = px + 24 + btnW + 12;
  const confirmBtn = scene.add.rectangle(confirmX, btnY, btnW, 40, danger ? UI.bad : UI.chip, 1).setOrigin(0, 0)
    .setStrokeStyle(1, danger ? UI.bad : UI.border, 1).setInteractive({ useHandCursor: true }).setDepth(6002);
  // Dark ink ON the filled action — `INK.onAlarm` on the danger fill /
  // `INK.onAccent` on the bronze chip (both contrast-checked against exactly
  // those fills in `textRoleAudit.test.ts`).
  scene.add.text(confirmX + btnW / 2, btnY + 20, opts.confirmLabel, textRole('label', { ink: danger ? 'onAlarm' : 'onAccent' }))
    .setOrigin(0.5).setDepth(6002);
  confirmBtn.on('pointerdown', (pointer: Phaser.Input.Pointer) => opts.onConfirm(pointer));
}

/** Embedded confirms share the existing callbacks, but their entire surface
 * (including the scrim and both actions) belongs to the visible outcome pane. */
function renderEmbeddedConfirm(scene: Phaser.Scene, opts: ConfirmDialogOpts, pane: Rect): void {
  const pad = 16;
  const gap = 12;
  const width = Math.max(1, Math.min(440, pane.width - 24));
  const innerWidth = Math.max(1, width - pad * 2);
  const stacked = (innerWidth - gap) / 2 < 110;
  const actionsHeight = stacked ? 92 : 40;
  const title = scene.add.text(0, 0, opts.title, {
    ...textRole('section'), align: 'center', wordWrap: { width: innerWidth },
  }).setOrigin(0.5, 0).setDepth(6002);
  auditTextBlock(title, { name: 'Embedded event confirmation title', maxWidth: innerWidth, maxHeight: 52, minFontSize: 10 });
  const body = scene.add.text(0, 0, opts.body, {
    ...textRole('body'), align: 'center', wordWrap: { width: innerWidth },
  }).setOrigin(0.5, 0).setDepth(6002);
  const height = Math.max(1, Math.min(pane.height - 24, pad * 2 + title.height + gap + body.height + gap + actionsHeight));
  const x = pane.x + (pane.width - width) / 2;
  const y = pane.y + (pane.height - height) / 2;
  const danger = opts.tone === 'danger';
  scene.add.rectangle(pane.x, pane.y, pane.width, pane.height, UI.shadow, 0.78).setOrigin(0, 0).setDepth(6000)
    .setInteractive().on('pointerdown', (pointer: Phaser.Input.Pointer) => (opts.onScrim ?? opts.onCancel)(pointer));
  scene.add.rectangle(x, y, width, height, UI.panelAlt, 1).setOrigin(0, 0).setDepth(6001)
    .setStrokeStyle(1, danger ? UI.bad : UI.chip, 1).setInteractive();
  title.setPosition(x + width / 2, y + pad);
  const bodyY = title.y + title.height + gap;
  const actionY = y + height - pad - actionsHeight;
  const bodyHeight = Math.max(1, actionY - gap - bodyY);
  body.setPosition(x + width / 2, bodyY);
  if (body.height > bodyHeight) {
    const mask = scene.make.graphics({}, false).fillStyle(0xffffff).fillRect(x + pad, bodyY, innerWidth, bodyHeight);
    body.setMask(mask.createGeometryMask());
    body.once('destroy', () => mask.destroy());
    let offset = 0;
    const scroll = (delta: number): void => {
      offset = Math.max(0, Math.min(body.height - bodyHeight, offset + delta));
      body.setY(bodyY - offset);
    };
    scene.input.on('wheel', (pointer: Phaser.Input.Pointer, _objects: unknown, _dx: number, dy: number) => {
      if (pointer.worldX >= x + pad && pointer.worldX <= x + width - pad && pointer.worldY >= bodyY && pointer.worldY <= bodyY + bodyHeight) scroll(dy);
    });
    let previousY: number | null = null;
    scene.add.rectangle(x + pad, bodyY, innerWidth, bodyHeight, UI.panelAlt, 0).setOrigin(0, 0).setDepth(6003).setInteractive()
      .on('pointerdown', (pointer: Phaser.Input.Pointer) => { previousY = pointer.worldY; });
    scene.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      if (previousY === null || !pointer.isDown) return;
      scroll(previousY - pointer.worldY); previousY = pointer.worldY;
    });
    scene.input.on('pointerup', () => { previousY = null; });
  }
  const buttonWidth = stacked ? innerWidth : (innerWidth - gap) / 2;
  const button = (bx: number, by: number, label: string, confirm: boolean, onPress: ConfirmHandler): void => {
    const fill = confirm ? danger ? UI.bad : UI.chip : UI.panelMuted;
    const box = scene.add.rectangle(bx, by, buttonWidth, 40, fill, 1).setOrigin(0, 0).setDepth(6002)
      .setStrokeStyle(1, UI.border, 1).setInteractive({ useHandCursor: true });
    const text = scene.add.text(bx + buttonWidth / 2, by + 20, label,
      textRole('label', confirm ? { ink: danger ? 'onAlarm' : 'onAccent' } : {})).setOrigin(0.5).setDepth(6002);
    auditControlLabel(box, text, { name: 'Embedded event confirmation action', horizontalPadding: 8, verticalPadding: 6, minFontSize: 9 });
    box.on('pointerdown', (pointer: Phaser.Input.Pointer) => onPress(pointer));
  };
  button(x + pad, actionY, opts.cancelLabel, false, opts.onCancel);
  button(stacked ? x + pad : x + pad + buttonWidth + gap, stacked ? actionY + 52 : actionY, opts.confirmLabel, true, opts.onConfirm);
}

/**
 * RETIRE confirm — the danger-toned instance of `renderConfirmDialog`, shared
 * by every screen that exposes the tertiary RETIRE action. Callers own the
 * open/close boolean (see `renderConfirmDialog` for the pointer contract).
 */
export function renderRetireConfirm(
  scene: Phaser.Scene,
  opts: { compact: boolean; onConfirm: ConfirmHandler; onCancel: ConfirmHandler },
): void {
  renderConfirmDialog(scene, {
    compact: opts.compact,
    title: 'RETIRE THIS RUN?',
    body: 'This ends the run right now — bosses cleared, days\nsurvived, gold, and hero level are locked in.',
    cancelLabel: 'CANCEL',
    confirmLabel: 'RETIRE',
    tone: 'danger',
    onCancel: opts.onCancel,
    onConfirm: opts.onConfirm,
  });
}

/**
 * The mergeCards choice's pre-resolution CONFIRM — the danger-toned instance
 * of `renderConfirmDialog`. UNCONDITIONAL (2026-09-06 user ruling: a merge
 * always costs three cards, so it always pauses here — this used to skip
 * the dialog for a bag-only trade on the theory that the choice row's own
 * compact price line was pause enough for that case; the row can no longer
 * name all three cards on one line for every trio (see
 * `mergeRowPreviewText`'s doc comment, eventOutcomeText.ts), so this dialog
 * is now the ONLY place a bag-only trio is named too, not just a
 * board-touching one). `body` is `mergeConfirmBody`'s output,
 * eventOutcomeText.ts — the headline over one named+placed line per
 * consumed card. Cancel returns to the choice list with NOTHING resolved and
 * the rung still takeable — this is a pause before
 * `resolveCurrentRunEventChoice` is ever called, not a way out of the
 * picker that call opens.
 */
export function renderMergeConsumeConfirm(
  scene: Phaser.Scene,
  opts: { compact: boolean; body: string; onConfirm: ConfirmHandler; onCancel: ConfirmHandler },
): void {
  renderConfirmDialog(scene, {
    compact: opts.compact,
    title: 'MERGE — CARDS LEAVE YOUR BOARD',
    body: opts.body,
    cancelLabel: 'CANCEL',
    confirmLabel: 'MERGE',
    tone: 'danger',
    onCancel: opts.onCancel,
    onConfirm: opts.onConfirm,
  });
}

/**
 * A rung whose outcome costs GOLD (`cost > 0`) pauses on this confirm before
 * `resolveCurrentRunEventChoice` is ever called — the same moment the gold
 * is actually deducted (`resolveEventChoice`, src/run/events.ts, charges the
 * cost up front regardless of whether the outcome resolves immediately or
 * opens a picker), so there is no path where gold leaves the player's purse
 * without this dialog having been confirmed first. `title`/`body` come from
 * `eventCostConfirmTitle`/`eventCostConfirmBody` (eventOutcomeText.ts), built
 * off the SAME hint text the choice row's own detail line already shows.
 * Never shown for a `mergeCards` rung — that kind pauses through its own
 * richer `renderMergeConsumeConfirm` instead (`costConfirm` is `null` for it,
 * `runEventScenePresenter.ts`).
 */
export function renderEventCostConfirm(
  scene: Phaser.Scene,
  opts: { compact: boolean; title: string; body: string; onConfirm: ConfirmHandler; onCancel: ConfirmHandler },
): void {
  renderConfirmDialog(scene, {
    compact: opts.compact,
    title: opts.title,
    body: opts.body,
    cancelLabel: 'CANCEL',
    confirmLabel: 'CONFIRM',
    tone: 'accent',
    onCancel: opts.onCancel,
    onConfirm: opts.onConfirm,
  });
}

/**
 * The `sellGem` picker's own pre-finalize CONFIRM — shown after the player
 * taps WHICH gem to sell, not before the picker opens. Unlike `mergeCards`
 * (whose three consumed instances are the run layer's decision, knowable
 * before its picker even opens), which gem leaves the pouch here is the
 * PLAYER's choice, made inside the picker itself, so the exact instance and
 * price cannot be confirmed any earlier. `title`/`body` come from
 * `sellGemConfirmTitle`/`sellGemConfirmBody` (eventOutcomeText.ts). Cancel
 * returns to the same picker grid with nothing sold — the tapped gem is
 * still there to pick again.
 */
export function renderSellGemConfirm(
  scene: Phaser.Scene,
  opts: { compact: boolean; title: string; body: string; onConfirm: ConfirmHandler; onCancel: ConfirmHandler },
): void {
  renderConfirmDialog(scene, {
    compact: opts.compact,
    title: opts.title,
    body: opts.body,
    cancelLabel: 'CANCEL',
    confirmLabel: 'SELL',
    tone: 'danger',
    onCancel: opts.onCancel,
    onConfirm: opts.onConfirm,
  });
}

/**
 * Where a battle start was requested from, for `shouldConfirmUnspentPL`.
 * Only `'prep-fight'` — the prep screens' FIGHT press, the one place a NEW
 * battle is entered by choice — is ever gated; `'battle-replay'` names the
 * path that must never be (REPLAY re-runs a fight already fought, inside the
 * battle scenes, and interrupting playback with a spend nag would be noise).
 */
export type BattleEntryPoint = 'prep-fight' | 'battle-replay';

/**
 * THE fight-gate decision (pure, pinned in `tests/game/unspentPlConfirm.test.ts`):
 * warn if and only if the player is about to enter a NEW battle from a prep
 * screen with PL still banked. Zero (or a defensive negative) banked never
 * warns — the 2026-08-31 playtest failure was banked points going unnoticed,
 * and a dialog for players with nothing to spend would teach everyone to
 * dismiss it unread.
 */
export function shouldConfirmUnspentPL(banked: number, entry: BattleEntryPoint): boolean {
  return entry === 'prep-fight' && banked > 0;
}

/**
 * The unspent-PL fight gate's dialog — the accent-toned instance of
 * `renderConfirmDialog` ("N PL UNSPENT — FIGHT ANYWAY / SPEND FIRST").
 * Rendered by the four prep scenes when a FIGHT press trips
 * `shouldConfirmUnspentPL`; never rendered at banked 0 (the gate) and never
 * on any other battle path (only prep FIGHT handlers call the gate).
 *
 *   FIGHT ANYWAY — proceeds exactly as the ungated press would have
 *                  (same battleContext + scene.start, supplied by the caller).
 *   SPEND FIRST  — the emphasized action: stays on prep; run-prep callers
 *                  open the stat-allocation panel from it, sandbox callers
 *                  just close (their allocation grid is already on screen).
 *   scrim        — plain dismiss, stays on prep.
 */
export function renderUnspentPlConfirm(
  scene: Phaser.Scene,
  opts: {
    compact: boolean;
    banked: number;
    onFightAnyway: ConfirmHandler;
    onSpendFirst: ConfirmHandler;
    onDismiss: ConfirmHandler;
  },
): void {
  renderConfirmDialog(scene, {
    compact: opts.compact,
    title: `${opts.banked} PL UNSPENT`,
    body: 'Banked PL does nothing in a fight —\nspend it on stats first?',
    cancelLabel: 'FIGHT ANYWAY',
    confirmLabel: 'SPEND FIRST',
    tone: 'accent',
    onCancel: opts.onFightAnyway,
    onConfirm: opts.onSpendFirst,
    onScrim: opts.onDismiss,
  });
}
