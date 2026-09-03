import Phaser from 'phaser';
import { playSfx } from '../audio/sfxSynth';
import { bankedPL } from '../../run/leveling';
import { type RunState } from '../runStore';
import { FONT, INK, UI, textRole } from '../theme';
import { auditControlLabel, auditTextBlock } from './controlLayoutAudit';
import { renderBankedPlBadge } from './RunStatPanel';
import type { Rect, RunActionRole, RunScreenTemplate } from './runScreenTemplate';
import { runScreenLayout } from './runScreenLayout';
import { attachButtonFeel, hoverFillFor } from './motion';
import { runProgressStatRun } from './statRunModel';
import { renderStatRun } from './statRunStrip';

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
  /** Node visits committed so far (`run.depth`) — a "day" is any node visit
   * (fight/elite/boss/shop/event), unbounded (the run is endless). */
  day: number;
  /** The fight number the player is heading toward/currently in, unbounded. */
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
}

/** Builds the HUD's display-only snapshot straight off `RunState` — no
 * decisions, just reads (day/wave are now UNBOUNDED: the run is endless, see
 * docs/release-game-plan.md). */
export function snapshotRunProgress(run: Readonly<RunState>): RunProgressSnapshot {
  const currentColumn = run.map.depths[run.depth];
  const nextColumn = run.map.depths[run.depth + 1];
  const wave = nextColumn?.[0]?.wave ?? currentColumn?.[0]?.wave ?? 1;
  return {
    day: run.depth,
    wave,
    gold: run.gold,
    heroLevel: run.heroLevel,
    lives: run.lives,
    bossesCleared: run.bossesCleared,
    wins: run.wins,
    losses: run.losses,
    bankedPL: bankedPL(run.heroLevel, run.heroAllocation),
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
  /** Press handler for the banked-PL badge slot; omit to render no badge
   * (banked PL is 0, or the screen doesn't support the panel). */
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

  const { statsEndX } = drawKickerTitleStats(scene, t, opts.screen, opts.snapshot, opts.compact, opts.track);

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

  // ---- banked-PL badge — its OWN slot (no longer fighting stats for the corner) ----
  if (opts.onOpenStatPanel) {
    const badgeRect = t.regions.badge;
    const badgeX = opts.compact ? badgeRect.x + badgeRect.width : badgeRect.x + badgeRect.width;
    const badge = renderBankedPlBadge(scene, badgeX, badgeRect.y, F.stats, opts.onOpenStatPanel);
    void badge;
  }

  // ---- fixed action row ----
  const a = opts.actions ?? {};
  drawSlotButton(scene, t.actionSlots.back, a.back, 'back', F.action, opts.track);
  drawSlotButton(scene, t.actionSlots.secondary, a.secondary, 'secondary', F.action, opts.track);
  drawSlotButton(scene, t.actionSlots.tertiary, a.tertiary, 'tertiary', F.action, opts.track);
  drawSlotButton(scene, t.actionSlots.primary, a.primary, 'primary', opts.compact ? 13 : F.action + 2, opts.track);

  // Divider under the header, at the content region's top edge.
  //
  // IT MUST CLEAR THE ACTION BAND, not sit a hardcoded 14px above the content
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
  const platform = opts.compact ? 'mobile' : 'desktop';
  const t = runScreenLayout(platform);
  const { width: W, height: H } = t.canvas;
  const danger = opts.tone === 'danger';
  const onScrim = opts.onScrim ?? opts.onCancel;
  scene.add.rectangle(0, 0, W, H, UI.shadow, 0.78).setOrigin(0, 0).setInteractive().setDepth(6000)
    .on('pointerdown', (pointer: Phaser.Input.Pointer) => onScrim(pointer));

  const pw = Math.min(W - 40, opts.compact ? W - 32 : 440);
  const ph = opts.compact ? 168 : 176;
  const px = (W - pw) / 2;
  const py = (H - ph) / 2;
  scene.add.rectangle(px, py, pw, ph, UI.panelAlt, 0.98).setOrigin(0, 0)
    .setStrokeStyle(2, danger ? UI.bad : UI.chip, 0.9).setInteractive().setDepth(6001);

  // A dialog is a `section` heading over `body` copy over two `label` buttons —
  // the same three roles every other panel in the game now takes, so the sizes
  // come off the profile ladder instead of a local 15/18 + 11/13 pair.
  scene.add.text(px + pw / 2, py + 22, opts.title, textRole('section'))
    .setOrigin(0.5, 0).setDepth(6002);
  scene.add.text(px + pw / 2, py + 52, opts.body, {
    ...textRole('body'), align: 'center', wordWrap: { width: pw - 48 },
  }).setOrigin(0.5, 0).setDepth(6002);

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
