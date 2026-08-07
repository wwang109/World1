import Phaser from 'phaser';
import { playSfx } from '../audio/sfxSynth';
import { getActiveRun, type RunState } from '../runStore';
import { FONT, UI } from '../theme';
import { auditTextBlock } from './controlLayoutAudit';
import type { Rect } from './runScreenTemplate';
import { runScreenLayout } from './runScreenLayout';

/**
 * Run stats — a read-only ledger view over `RunState.stats`/`wins`/`losses`/
 * `bossesCleared` (see `src/run/runState.ts#RunStats`), shown across several
 * surfaces:
 *   - the Run Map's end-summary banner (defeat/retired), which renders the
 *     grid straight into its own full-screen layout;
 *   - DESKTOP's Run Map: a PERMANENT flank panel (`renderRunStatsFlankPanel`,
 *     2026-08-04 density pass) beside the fixed choices column — no tap
 *     needed, it's always on screen, so desktop no longer opens the overlay
 *     below at all;
 *   - MOBILE's Run Map: a toggleable overlay (`renderRunStatsOverlay`),
 *     reached by tapping `RunProgressStrip.ts`'s stat strip itself
 *     (`renderRunHud`'s `onOpenStatsOverlay` — the old floating "STATS"
 *     corner tag this module used to draw is gone on both platforms).
 *
 * Pure presentation: every value already lives on `RunState`, floored/
 * accumulated by `src/run`. This module only formats and lays it out.
 */

export interface RunStatsRow {
  label: string;
  value: string;
}

/** The minimal shape the grid needs off a `RunState` (or the equivalent end-
 * of-run snapshot) — structural, so the end-summary banner and the live
 * overlay can feed it the exact same run object. */
export type RunStatsSource = Pick<RunState, 'wins' | 'losses' | 'bossesCleared' | 'stats'>;

/**
 * The 5-row x 2-col ledger, in a fixed, meaningful pairing (won/lost,
 * cleared/wave, earned/spent, dealt/taken, healing/purchases) — SAME order
 * everywhere this is shown, so a player never has to re-learn the layout
 * between the in-run overlay and the end-of-run banner.
 */
export function runStatsPairs(run: RunStatsSource): ReadonlyArray<readonly [RunStatsRow, RunStatsRow]> {
  const s = run.stats;
  return [
    [{ label: 'FIGHTS WON', value: `${run.wins}` }, { label: 'FIGHTS LOST', value: `${run.losses}` }],
    [{ label: 'BOSSES CLEARED', value: `${run.bossesCleared}` }, { label: 'DEEPEST WAVE', value: `${s.deepestWave}` }],
    [{ label: 'GOLD EARNED', value: `${s.goldEarned}` }, { label: 'GOLD SPENT', value: `${s.goldSpent}` }],
    [{ label: 'DAMAGE DEALT', value: `${s.damageDealt}` }, { label: 'DAMAGE TAKEN', value: `${s.damageTaken}` }],
    [{ label: 'HEALING DONE', value: `${s.healingDone}` }, { label: 'PURCHASES', value: `${s.cardsBought}C / ${s.gemsBought}G` }],
  ];
}

/** Total pixel height `renderRunStatsGrid` will occupy for a given row count
 * and `compact` sizing — lets callers reserve exactly the right amount of
 * space before drawing anything (no guessing/measuring after the fact). */
export function runStatsGridHeight(rowCount: number, compact: boolean): number {
  const rowH = compact ? 36 : 42;
  const rowGap = 6;
  return rowCount * (rowH + rowGap) - rowGap;
}

/**
 * Draws the compact two-column ledger grid at a fixed top-left position —
 * pure rendering, no scrim/interactivity of its own. `depth`, when given,
 * is stamped on every drawn object (needed when the grid sits inside a
 * modal overlay, above a scrim); omit it for a full-screen banner where
 * draw order alone already puts it on top of the background.
 */
export function renderRunStatsGrid(
  scene: Phaser.Scene,
  x: number, y: number, w: number,
  pairs: ReadonlyArray<readonly [RunStatsRow, RunStatsRow]>,
  opts: { compact: boolean; depth?: number },
): number {
  const labelSize = opts.compact ? 9 : 11;
  const valueSize = opts.compact ? 13 : 16;
  const rowH = opts.compact ? 36 : 42;
  const rowGap = 6;
  const colGap = 12;
  const colW = (w - colGap) / 2;
  const cellPad = 10;

  const stamp = <T extends { setDepth(d: number): unknown }>(obj: T): T => {
    if (opts.depth !== undefined) obj.setDepth(opts.depth);
    return obj;
  };

  const drawCell = (row: RunStatsRow, cx: number, cy: number, name: string): void => {
    stamp(scene.add.rectangle(cx, cy, colW, rowH, UI.panelMuted, 0.6).setOrigin(0, 0).setStrokeStyle(1, UI.border, 0.35));
    const label = stamp(scene.add.text(cx + cellPad, cy + cellPad, row.label, {
      fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${labelSize}px`, color: UI.textDim,
    }).setOrigin(0, 0));
    auditTextBlock(label, { name: `${name} label`, maxWidth: colW - cellPad * 2, maxHeight: labelSize + 6, minFontSize: 7 });
    const value = stamp(scene.add.text(cx + colW - cellPad, cy + rowH - cellPad, row.value, {
      fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${valueSize}px`, color: UI.textAccent,
    }).setOrigin(1, 1));
    auditTextBlock(value, { name: `${name} value`, maxWidth: colW - cellPad * 2, maxHeight: valueSize + 6, minFontSize: 8 });
  };

  let cursor = y;
  pairs.forEach(([left, right], i) => {
    drawCell(left, x, cursor, `Run stats row ${i} left`);
    drawCell(right, x + colW + colGap, cursor, `Run stats row ${i} right`);
    cursor += rowH + rowGap;
  });
  return cursor - y - rowGap;
}

/**
 * Desktop's PERMANENT run ledger — lives in the flank beside the fixed
 * choices column, always visible (no tap needed). Replaces the old floating
 * "STATS" corner tag on desktop entirely: reuses `renderRunStatsGrid` (the
 * SAME ledger the end-summary banner and mobile's overlay show) inside a
 * bordered panel with a header, so the numbers are never a one-off restyle.
 * Desktop-only — mobile has no flank to put this in; its opener lives on
 * `RunProgressStrip.ts`'s stat strip instead (`onOpenStatsOverlay`).
 */
export function renderRunStatsFlankPanel(
  scene: Phaser.Scene,
  rect: Rect,
  run: RunStatsSource,
): void {
  const { x, y, width: w, height: h } = rect;
  scene.add.rectangle(x, y, w, h, UI.panelMuted, 0.55).setOrigin(0, 0).setStrokeStyle(1, UI.border, 0.4);

  const pad = 16;
  const innerX = x + pad;
  const innerW = w - pad * 2;
  const pairs = runStatsPairs(run);
  // Vertically centered — the flank is taller than this panel's natural
  // content height (it reaches down to the content region's floor, see
  // `DesktopRunMapScene#renderFlanks`), so center rather than top-pin it to
  // avoid a lopsided block of empty space below the grid.
  const blockH = 24 + 14 + runStatsGridHeight(pairs.length, false);
  let cursor = y + Math.max(pad, (h - blockH) / 2);

  const header = scene.add.text(innerX, cursor, 'RUN LEDGER', {
    fontFamily: FONT.display, fontStyle: 'bold', fontSize: '17px', color: UI.text,
  });
  auditTextBlock(header, { name: 'Desktop run map ledger header', maxWidth: innerW, maxHeight: 22, minFontSize: 12 });
  cursor += 24;

  scene.add.rectangle(innerX, cursor, innerW, 1, UI.border, 0.5).setOrigin(0, 0);
  cursor += 14;

  renderRunStatsGrid(scene, innerX, cursor, innerW, pairs, { compact: false });
}

export interface RunBossCountdownInfo {
  /** Waves remaining until the next `BOSS_EVERY`-th wave; 0 == this wave IS
   * the boss wave (`src/run/runMap.ts#BOSS_EVERY`, read via the caller — this
   * module only formats whatever it's handed). */
  wavesRemaining: number;
  /** The wave number the next boss milestone lands on. */
  bossWave: number;
}

/**
 * Desktop's companion callout in the OTHER flank (opposite the ledger) — the
 * next milestone-boss countdown, so both sides of the fixed choices column
 * carry real, permanent content instead of one side sitting empty. Pure
 * presentation over caller-supplied `RunBossCountdownInfo` (the wave-cadence
 * math is the run layer's, not this module's — see `runStore.ts#WAVE_COUNT`).
 */
export function renderRunBossCountdownPanel(
  scene: Phaser.Scene,
  rect: Rect,
  info: RunBossCountdownInfo,
  bossesCleared: number,
): void {
  const { x, y, width: w, height: h } = rect;
  scene.add.rectangle(x, y, w, h, UI.panelMuted, 0.55).setOrigin(0, 0).setStrokeStyle(1, UI.border, 0.4);

  const pad = 16;
  const innerX = x + pad;
  const innerW = w - pad * 2;
  const bossNow = info.wavesRemaining <= 0;

  // Vertically centered content block — this panel's copy is short by
  // design (a callout, not a dense grid), so it's centered in its bordered
  // box rather than stretched, the same idiom a "highlight card" would use.
  const blockH = 17 + 8 + 30 + 8 + 13 + 14 + 1 + 12 + 13;
  let cursor = y + Math.max(pad, (h - blockH) / 2);

  const kicker = scene.add.text(innerX, cursor, 'NEXT MILESTONE', {
    fontFamily: FONT.display, fontStyle: 'bold', fontSize: '17px', color: UI.text,
  });
  auditTextBlock(kicker, { name: 'Desktop run map boss countdown header', maxWidth: innerW, maxHeight: 22, minFontSize: 12 });
  cursor += 25;

  const big = scene.add.text(innerX, cursor, bossNow ? 'BOSS THIS WAVE' : `${info.wavesRemaining} WAVE${info.wavesRemaining === 1 ? '' : 'S'} TO GO`, {
    // Danger red matches the RETIRE/last-life tint elsewhere in the HUD, not
    // `UI.bad` (a numeric fill color, not a valid CSS text color).
    fontFamily: FONT.body, fontStyle: 'bold', fontSize: '20px', color: bossNow ? '#e0654a' : UI.textAccent,
  });
  auditTextBlock(big, { name: 'Desktop run map boss countdown headline', maxWidth: innerW, maxHeight: 28, minFontSize: 13 });
  cursor += 38;

  const sub = scene.add.text(innerX, cursor, `BOSS AT WAVE ${info.bossWave}`, {
    fontFamily: FONT.body, fontSize: '11px', color: UI.textSoft,
  });
  auditTextBlock(sub, { name: 'Desktop run map boss countdown sub-line', maxWidth: innerW, maxHeight: 16, minFontSize: 8 });
  cursor += 27;

  scene.add.rectangle(innerX, cursor, innerW, 1, UI.border, 0.5).setOrigin(0, 0);
  cursor += 13;

  const clearedLine = scene.add.text(innerX, cursor, `BOSSES CLEARED ${bossesCleared}`, {
    fontFamily: FONT.body, fontStyle: 'bold', fontSize: '12px', color: UI.textDim,
  });
  auditTextBlock(clearedLine, { name: 'Desktop run map bosses-cleared line', maxWidth: innerW, maxHeight: 16, minFontSize: 8 });
}

/**
 * The in-run STATS overlay — scrim + modal panel showing the live ledger,
 * same idiom as `RunStatPanel.ts#renderRunStatPanel`/`RunProgressStrip.ts#
 * renderRetireConfirm`: closed by tapping the scrim OR the CLOSE button, the
 * caller owns the open/close boolean (reset in `init()`, re-rendered from
 * `create()` — the scene-rebuild idiom). Read-only: nothing here mutates the
 * run, so unlike the PL allocation panel there is no scratch/CONFIRM state.
 * No-ops (closes immediately) if there is somehow no active run.
 */
export function renderRunStatsOverlay(
  scene: Phaser.Scene,
  opts: { compact: boolean; onClose: () => void },
): void {
  const run = getActiveRun();
  if (!run) { opts.onClose(); return; }

  const platform = opts.compact ? 'mobile' : 'desktop';
  const t = runScreenLayout(platform);
  const { width: W, height: H } = t.canvas;

  scene.add.rectangle(0, 0, W, H, UI.shadow, 0.78).setOrigin(0, 0).setInteractive().setDepth(5500)
    .on('pointerdown', () => { playSfx('uiBack'); opts.onClose(); });

  const pairs = runStatsPairs(run);
  const gridH = runStatsGridHeight(pairs.length, opts.compact);
  const nameSize = opts.compact ? 15 : 18;
  const smallSize = opts.compact ? 9 : 11;
  const btnH = opts.compact ? 34 : 38;

  const pw = Math.min(W - 40, opts.compact ? W - 32 : 460);
  const headerH = nameSize + 6 + smallSize + 10 + 14;
  const ph = 18 + headerH + gridH + 14 + btnH + 14;
  const px = (W - pw) / 2;
  const py = Math.max(opts.compact ? 16 : 30, (H - ph) / 2);

  scene.add.rectangle(px, py, pw, ph, UI.panelAlt, 0.98).setOrigin(0, 0).setStrokeStyle(2, UI.chip, 1).setInteractive().setDepth(5501);

  const innerX = px + 20;
  const innerW = pw - 40;
  let cursor = py + 18;

  scene.add.text(innerX, cursor, 'RUN STATS', {
    fontFamily: FONT.display, fontStyle: 'bold', fontSize: `${nameSize}px`, color: UI.text,
  }).setDepth(5502);
  cursor += nameSize + 6;

  scene.add.text(innerX, cursor, "This run's ledger so far.", {
    fontFamily: FONT.body, fontSize: `${smallSize}px`, color: UI.textSoft,
  }).setDepth(5502);
  cursor += smallSize + 10;
  scene.add.rectangle(innerX, cursor, innerW, 1, UI.border, 0.5).setOrigin(0, 0).setDepth(5502);
  cursor += 14;

  renderRunStatsGrid(scene, innerX, cursor, innerW, pairs, { compact: opts.compact, depth: 5502 });
  cursor += gridH + 14;

  const closeBtn = scene.add.rectangle(innerX, cursor, innerW, btnH, UI.panelMuted, 1).setOrigin(0, 0)
    .setStrokeStyle(1, UI.border, 0.8).setInteractive({ useHandCursor: true }).setDepth(5502);
  scene.add.text(innerX + innerW / 2, cursor + btnH / 2, 'CLOSE', {
    fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${smallSize + 2}px`, color: UI.text,
  }).setOrigin(0.5).setDepth(5502);
  closeBtn.on('pointerdown', () => { playSfx('uiBack'); opts.onClose(); });
}
