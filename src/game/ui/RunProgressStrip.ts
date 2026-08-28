import Phaser from 'phaser';
import { playSfx } from '../audio/sfxSynth';
import { type RunState } from '../runStore';
import { FONT, UI } from '../theme';
import { auditControlLabel, auditTextBlock } from './controlLayoutAudit';
import { renderBankedPlBadge } from './RunStatPanel';
import type { Rect, RunActionRole, RunScreenTemplate } from './runScreenTemplate';
import { runScreenLayout } from './runScreenLayout';
import { attachButtonFeel, hoverFillFor } from './motion';

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
  const textColor = disabled ? UI.textSoft : spec.danger ? '#e0906f' : role === 'primary' ? UI.textOnChip : UI.textAccent;
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

/** Builds the stats-strip text — the ONE stat string every run screen shows
 * (DAY · WAVE · GOLD · LV · LIVES · BOSSES), so `renderRunHud` and
 * `renderRunStatsStrip` (battle's reduced chrome) can never diverge. Used
 * ONLY as a hidden measuring string now (see `drawKickerTitleStats`) — the
 * actual on-screen line is drawn as colored label/value segments below, but
 * they must always read identically to this plain concatenation. */
function statsStripText(compact: boolean, s: RunProgressSnapshot): string {
  return compact
    ? `D${s.day} · W${s.wave} · G${s.gold} · LV${s.heroLevel} · ♥${s.lives} · B${s.bossesCleared}`
    : `DAY ${s.day}   ·   WAVE ${s.wave}   ·   GOLD ${s.gold}   ·   LV ${s.heroLevel}   ·   LIVES ${s.lives}   ·   BOSSES ${s.bossesCleared}`;
}

/** Which color rule a segment's VALUE half follows — labels are always
 * `UI.textMuted`. `gold` is the currency tint used everywhere else in the UI;
 * `lives` goes danger-red at exactly 1 remaining (see the note below), plain
 * `UI.textBright` otherwise. */
type StatValueKind = 'default' | 'gold' | 'lives';

interface StatSegment {
  label: string;
  value: string;
  kind: StatValueKind;
}

/** Same six stats, same order, as `statsStripText` — split into label/value
 * pairs so each half can carry its own color. */
function statsStripSegments(compact: boolean, s: RunProgressSnapshot): StatSegment[] {
  return compact
    ? [
      { label: 'D', value: `${s.day}`, kind: 'default' },
      { label: 'W', value: `${s.wave}`, kind: 'default' },
      { label: 'G', value: `${s.gold}`, kind: 'gold' },
      { label: 'LV', value: `${s.heroLevel}`, kind: 'default' },
      { label: '♥', value: `${s.lives}`, kind: 'lives' },
      { label: 'B', value: `${s.bossesCleared}`, kind: 'default' },
    ]
    : [
      { label: 'DAY ', value: `${s.day}`, kind: 'default' },
      { label: 'WAVE ', value: `${s.wave}`, kind: 'default' },
      { label: 'GOLD ', value: `${s.gold}`, kind: 'gold' },
      { label: 'LV ', value: `${s.heroLevel}`, kind: 'default' },
      { label: 'LIVES ', value: `${s.lives}`, kind: 'lives' },
      { label: 'BOSSES ', value: `${s.bossesCleared}`, kind: 'default' },
    ];
}

/**
 * Alarm colour for the last life. Exactly 1 — NOT `<= 1`: the pre-run "START A
 * NEW RUN" state reports 0 lives (there is no run yet), and `<= 1` painted that
 * whole strip red as if the player were about to die. In a real run 0 lives
 * means the run is already over and the end banner has replaced the strip, so 0
 * is never a live in-run value.
 */
function statSegmentValueColor(kind: StatValueKind, lives: number): string {
  if (kind === 'gold') return UI.textAccent;
  if (kind === 'lives') return lives === 1 ? '#e0654a' : UI.textBright;
  return UI.textBright;
}

/** Draws kicker + title + the stats string at `t`'s rects — shared by
 * `renderRunHud` (full chrome) and `renderRunStatsStrip` (battle's statsOnly
 * chrome). Kicker/title/stats sit at IDENTICAL rects in both chrome variants
 * (`runScreenTemplate`'s guarantee), so this one function is the only place
 * either of them is drawn from.
 *
 * The stats line is drawn as SEQUENTIAL label/value Text objects (Phaser text
 * is single-color) rather than one string: labels in `UI.textMuted`, values in
 * `UI.textBright` bold, with GOLD's value in the currency accent and LIVES'
 * value in danger-red at exactly 1 remaining. A hidden measuring pass with the
 * plain (`statsStripText`) string runs through the same `auditTextBlock`
 * shrink policy FIRST so every segment shares one font size — shrinking
 * segments independently could give mismatched sizes on a borderline-width
 * screen. Returns the x the drawn line ends at (compact/left-aligned mode)
 * so `renderRunHud` can hang its mobile disclosure hint right after it.
 */
function drawKickerTitleStats(
  scene: Phaser.Scene,
  t: RunScreenTemplate,
  screen: string,
  snapshot: RunProgressSnapshot,
  compact: boolean,
  track_: Phaser.GameObjects.GameObject[] | undefined,
): { statsEndX: number } {
  const F = compact ? { kicker: 9, title: 16, stats: 9 } : { kicker: 12, title: 26, stats: 12 };

  // ---- kicker + title ----
  const kicker = scene.add.text(t.regions.kicker.x, t.regions.kicker.y, 'WORLD1 / RUN MODE', {
    fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${F.kicker}px`, color: UI.textAccent,
  });
  const title = scene.add.text(t.regions.title.x, t.regions.title.y, screen, {
    fontFamily: FONT.display, fontStyle: 'bold', fontSize: `${F.title}px`, color: UI.text,
  });
  track(track_, kicker);
  track(track_, title);
  auditTextBlock(kicker, { name: 'Run HUD kicker', maxWidth: t.regions.kicker.width, maxHeight: t.regions.kicker.height + 6, minFontSize: 7 });
  auditTextBlock(title, { name: 'Run HUD title', maxWidth: t.regions.title.width, maxHeight: t.regions.title.height + 4, minFontSize: 10 });

  // ---- stats strip — ALWAYS this order, ALWAYS this slot ----
  const statsRect = t.regions.stats;
  const baseStyle = { fontFamily: FONT.body, fontStyle: 'bold' as const, fontSize: `${F.stats}px` };

  // Hidden measuring pass: same shrink-then-truncate policy as every other
  // audited label, run ONCE against the plain string so the whole segmented
  // line shares a single (possibly shrunk) font size.
  const measure = scene.add.text(0, 0, statsStripText(compact, snapshot), baseStyle).setVisible(false);
  auditTextBlock(measure, { name: 'Run HUD stats', maxWidth: statsRect.width, maxHeight: statsRect.height + 6, minFontSize: 7 });
  const fontSize = Number.parseFloat(String(measure.style.fontSize));
  measure.destroy();

  const sep = compact ? ' · ' : '   ·   ';
  const segments = statsStripSegments(compact, snapshot);
  const segmentTexts: Phaser.GameObjects.Text[] = [];
  let cursor = 0;
  segments.forEach((seg, i) => {
    const label = scene.add.text(cursor, statsRect.y, seg.label, {
      ...baseStyle, fontSize: `${fontSize}px`, color: UI.textMuted,
    });
    segmentTexts.push(label);
    cursor += label.width;
    const value = scene.add.text(cursor, statsRect.y, seg.value, {
      ...baseStyle, fontSize: `${fontSize}px`, color: statSegmentValueColor(seg.kind, snapshot.lives),
    });
    segmentTexts.push(value);
    cursor += value.width;
    if (i < segments.length - 1) {
      const sepText = scene.add.text(cursor, statsRect.y, sep, { ...baseStyle, fontSize: `${fontSize}px`, color: UI.textMuted });
      segmentTexts.push(sepText);
      cursor += sepText.width;
    }
  });
  const totalWidth = cursor;
  // Left-aligned (compact) starts at the rect's left edge; full chrome stays
  // right-aligned to the rect's right edge (unchanged from the old single-
  // string `stats.setOrigin(1, 0)` behavior).
  const startX = compact ? statsRect.x : statsRect.x + statsRect.width - totalWidth;
  let x = startX;
  for (const obj of segmentTexts) {
    obj.setX(x);
    x += obj.width;
    track(track_, obj);
  }
  return { statsEndX: startX + totalWidth };
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

/**
 * RETIRE confirm — a scrim + 2-button dialog, shared by every screen that
 * exposes the tertiary RETIRE action. Callers own the open/close boolean.
 *
 * `onCancel`/`onConfirm` receive the triggering `Phaser.Input.Pointer` — NOT
 * decorative. On any screen with a scene-level generic `pointerdown` listener
 * that hit-tests fresh content (drag wiring, etc.), that listener re-fires for
 * the SAME physical click once this dialog's own handler closes it via
 * `rerender()` (see `sceneRebuild.ts`'s `wasPointerConsumedByRebuild` doc
 * comment — this is the exact mechanism CONFIRMED INSTANCE #20, audit
 * 2026-08, found here). `rebuildScene()` stamps that pointer automatically,
 * so callers need do nothing further — the shop scenes' own manual
 * `consumedPointerAt` guard (an unsound plain-`downTime` comparison) was
 * removed 2026-08 in favor of relying on this structural guard alone; no
 * caller of `renderRetireConfirm` needs a per-screen pointer-consumption
 * idiom of its own anymore.
 */
export function renderRetireConfirm(
  scene: Phaser.Scene,
  opts: { compact: boolean; onConfirm: (pointer: Phaser.Input.Pointer) => void; onCancel: (pointer: Phaser.Input.Pointer) => void },
): void {
  const platform = opts.compact ? 'mobile' : 'desktop';
  const t = runScreenLayout(platform);
  const { width: W, height: H } = t.canvas;
  scene.add.rectangle(0, 0, W, H, UI.shadow, 0.78).setOrigin(0, 0).setInteractive().setDepth(6000)
    .on('pointerdown', (pointer: Phaser.Input.Pointer) => opts.onCancel(pointer));

  const pw = Math.min(W - 40, opts.compact ? W - 32 : 440);
  const ph = opts.compact ? 168 : 176;
  const px = (W - pw) / 2;
  const py = (H - ph) / 2;
  scene.add.rectangle(px, py, pw, ph, UI.panelAlt, 0.98).setOrigin(0, 0).setStrokeStyle(2, UI.bad, 0.9).setInteractive().setDepth(6001);

  const nameSize = opts.compact ? 15 : 18;
  const bodySize = opts.compact ? 11 : 13;
  scene.add.text(px + pw / 2, py + 22, 'RETIRE THIS RUN?', {
    fontFamily: FONT.display, fontStyle: 'bold', fontSize: `${nameSize}px`, color: UI.text,
  }).setOrigin(0.5, 0).setDepth(6002);
  scene.add.text(px + pw / 2, py + 52, 'This ends the run right now — bosses cleared, days\nsurvived, gold, and hero level are locked in.', {
    fontFamily: FONT.body, fontSize: `${bodySize}px`, color: UI.textDim, align: 'center', wordWrap: { width: pw - 48 },
  }).setOrigin(0.5, 0).setDepth(6002);

  const btnW = (pw - 48 - 12) / 2;
  const btnY = py + ph - 56;
  const cancelBtn = scene.add.rectangle(px + 24, btnY, btnW, 40, UI.panelMuted, 1).setOrigin(0, 0)
    .setStrokeStyle(1, UI.border, 0.8).setInteractive({ useHandCursor: true }).setDepth(6002);
  scene.add.text(px + 24 + btnW / 2, btnY + 20, 'CANCEL', {
    fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${bodySize}px`, color: UI.text,
  }).setOrigin(0.5).setDepth(6002);
  cancelBtn.on('pointerdown', (pointer: Phaser.Input.Pointer) => opts.onCancel(pointer));

  const retireX = px + 24 + btnW + 12;
  const retireBtn = scene.add.rectangle(retireX, btnY, btnW, 40, UI.bad, 1).setOrigin(0, 0)
    .setStrokeStyle(1, UI.bad, 1).setInteractive({ useHandCursor: true }).setDepth(6002);
  scene.add.text(retireX + btnW / 2, btnY + 20, 'RETIRE', {
    fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${bodySize}px`, color: '#2a0d06',
  }).setOrigin(0.5).setDepth(6002);
  retireBtn.on('pointerdown', (pointer: Phaser.Input.Pointer) => opts.onConfirm(pointer));
}
