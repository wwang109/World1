import Phaser from 'phaser';
import { getActiveRun, type RunState } from '../runStore';
import { FONT, UI } from '../theme';
import { auditTextBlock } from './controlLayoutAudit';
import { type Rect, runScreenTemplate } from './runScreenTemplate';

/**
 * Run stats — a read-only ledger view over `RunState.stats`/`wins`/`losses`/
 * `bossesCleared` (see `src/run/runState.ts#RunStats`), shared by two
 * surfaces:
 *   - the Run Map's end-summary banner (defeat/retired), which renders the
 *     grid straight into its own full-screen layout;
 *   - a toggleable in-run overlay (`renderRunStatsOverlay`), reached via a
 *     small "STATS" affordance the Run Map scenes draw in their OWN content
 *     region (deliberately not one of `RunProgressStrip.ts`'s shared HUD
 *     action slots — `primary` is reserved for each screen's single forward
 *     action, which the Run Map doesn't have; see `renderRunStatsAffordance`).
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
 * Small "STATS" tag the Run Map scenes draw in the TOP-RIGHT corner of their
 * own `runScreenTemplate` content region (never inside the shared HUD action
 * row — see module doc). Opens `renderRunStatsOverlay` below.
 */
export function renderRunStatsAffordance(
  scene: Phaser.Scene,
  contentRect: Rect,
  opts: { compact: boolean; onPress: () => void },
): void {
  const w = opts.compact ? 62 : 76;
  const h = opts.compact ? 20 : 24;
  const x = contentRect.x + contentRect.width - w;
  const y = contentRect.y;
  const fontSize = opts.compact ? 9 : 11;

  const btn = scene.add.rectangle(x, y, w, h, UI.panelAlt, 0.92).setOrigin(0, 0)
    .setStrokeStyle(1, UI.chip, 0.9).setInteractive({ useHandCursor: true }).setDepth(20);
  const label = scene.add.text(x + w / 2, y + h / 2, 'STATS', {
    fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${fontSize}px`, color: UI.textAccent,
  }).setOrigin(0.5).setDepth(21);
  auditTextBlock(label, { name: 'Run map STATS affordance', maxWidth: w - 8, maxHeight: h - 2, minFontSize: 7 });

  btn.on('pointerover', () => btn.setFillStyle(UI.slotHover));
  btn.on('pointerout', () => btn.setFillStyle(UI.panelAlt));
  btn.on('pointerdown', opts.onPress);
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
  const t = runScreenTemplate(platform);
  const { width: W, height: H } = t.canvas;

  scene.add.rectangle(0, 0, W, H, UI.shadow, 0.78).setOrigin(0, 0).setInteractive().setDepth(5500)
    .on('pointerdown', opts.onClose);

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
  closeBtn.on('pointerdown', opts.onClose);
}
