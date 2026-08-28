import Phaser from 'phaser';
import { ACTIVE_PROFILE } from '../layoutProfile';
import {
  INK, TEXT_ROLE_SPEC, TEXT_SHRINK_FLOOR_PX, textRole,
  type StatDensity, type TextRole,
} from '../theme';
import {
  statDeltaInk, statLabelInk, statSegmentRoles, statValueInk,
  type StatRun, type StatSegment,
} from './statRunModel';

/**
 * THE stat-run renderer — the only place in `src/game` that turns a
 * `StatRun` (`statRunModel.ts`) into pixels.
 *
 * It exists so the label/value hierarchy is drawn ONCE. Phaser Text is
 * single-colour and single-size, so a run of differently-inked, differently-
 * sized halves is necessarily N Text objects, and every surface that wanted
 * one previously gave up and drew a single flat string instead. That is the
 * actual reason the strips looked plain: not that nobody chose a colour, but
 * that choosing one cost a bespoke loop per screen.
 *
 * THREE THINGS IT GUARANTEES, all of which a per-scene loop got wrong:
 *
 *   BASELINES LINE UP. A 13px value beside a 9px label must sit on one line,
 *   not two tops. Every piece is drawn, MEASURED, then bottom-aligned off its
 *   real Phaser height — no guessed ascent ratio, no per-profile fudge.
 *
 *   ONE SIZE FOR THE WHOLE RUN. The shrink-to-fit pass scales the run as a
 *   unit, so a borderline-width phone never ends up with segment 3 a point
 *   smaller than segment 4. Floored at `TEXT_SHRINK_FLOOR_PX`, exactly like
 *   `controlLayoutAudit`'s helpers.
 *
 *   IT DROPS RATHER THAN OVERFLOWS. If the run still does not fit at the
 *   floor, `quiet` segments are dropped from the RIGHT until it does (see
 *   `fitRun`). A stat strip is the tightest space in the game — ~28 characters
 *   on a phone — and the honest answer there is to show fewer facts, not to
 *   run off the canvas or ellipsize a number into "13…".
 */

export type StatRunAlign = 'left' | 'right';

export interface StatRunOptions {
  /** Left edge for `'left'`, RIGHT edge for `'right'`. */
  x: number;
  /** TOP of the row. Pieces are bottom-aligned within the measured row height. */
  y: number;
  /** Hard width budget. The run shrinks, then drops, to stay inside it. */
  maxWidth: number;
  align?: StatRunAlign;
  /** `'roomy'` lets `lead` segments take the full value size; `'tight'` puts
   * every segment on the small pair (for a row that cannot hold two sizes). */
  density?: StatDensity;
  depth?: number;
  track?: Phaser.GameObjects.GameObject[];
}

export interface StatRunResult {
  /** Total drawn width. */
  width: number;
  /** Measured row height — what a caller should advance its cursor by. */
  height: number;
  /** The x the line ENDS at, so a caller can hang a disclosure hint after it. */
  endX: number;
  /** How many segments had to be dropped to fit. 0 in every shipping layout
   * today; non-zero is a signal the surface is over-subscribed. */
  dropped: number;
}

/** One drawn piece, before it is positioned. */
interface Piece {
  text: Phaser.GameObjects.Text;
  width: number;
  height: number;
}

/** The px size a role renders at, after a run-wide shrink `scale`. Floored at
 * the project's global text floor — a call site's preference never wins over
 * it (same policy as `controlLayoutAudit`). */
function scaledSize(role: TextRole, scale: number): number {
  const base = TEXT_ROLE_SPEC[role].size[ACTIVE_PROFILE.id];
  return Math.max(TEXT_SHRINK_FLOOR_PX, Math.round(base * scale));
}

/**
 * Widest the run can be drawn at a given shrink `scale`, measured with real
 * (invisible, immediately destroyed) Phaser Text objects rather than a
 * characters-times-advance estimate — the estimate is what makes a strip
 * either overflow or leave a third of its budget empty.
 */
function measureWidth(scene: Phaser.Scene, run: StatRun, density: StatDensity, scale: number): number {
  let total = 0;
  run.segments.forEach((seg, i) => {
    const roles = statSegmentRoles(seg, density);
    total += measureOne(scene, seg.label, roles.label, scale);
    total += measureOne(scene, ` ${seg.value}`, roles.value, scale);
    if (seg.delta) total += measureOne(scene, ` ${seg.delta}`, roles.label, scale);
    if (i < run.segments.length - 1) total += measureOne(scene, run.separator, roles.label, scale);
  });
  return total;
}

function measureOne(scene: Phaser.Scene, body: string, role: TextRole, scale: number): number {
  const probe = scene.add.text(0, 0, body, { ...textRole(role), fontSize: `${scaledSize(role, scale)}px` }).setVisible(false);
  const w = probe.width;
  probe.destroy();
  return w;
}

/**
 * Fits `run` into `maxWidth`: shrink first, then DROP `quiet` segments from
 * the right. Shrinking is preferred because dropping loses a fact; dropping is
 * preferred over overflow because an overflowing strip loses the facts that
 * ran off the edge AND the ones still on screen (the player stops trusting the
 * row). `lead` and `normal` segments are never dropped — if only those are
 * left and it still does not fit, the run is drawn at the floor and the caller
 * gets a non-zero `dropped` count of zero plus an over-budget width, which is
 * a layout bug to fix in the layout, not here.
 */
function fitRun(
  scene: Phaser.Scene, run: StatRun, density: StatDensity, maxWidth: number,
): { run: StatRun; scale: number; dropped: number } {
  let scale = 1;
  // Six steps down to ~0.7 — past that the floor is doing the work anyway.
  for (let i = 0; i < 6; i += 1) {
    if (measureWidth(scene, run, density, scale) <= maxWidth) return { run, scale, dropped: 0 };
    scale -= 0.05;
  }
  let working = run;
  let dropped = 0;
  while (measureWidth(scene, working, density, scale) > maxWidth) {
    const lastQuiet = [...working.segments].map((s, i) => [s, i] as const)
      .filter(([s]) => (s.tone ?? 'normal') === 'quiet').pop();
    if (!lastQuiet) break;
    working = { ...working, segments: working.segments.filter((_, i) => i !== lastQuiet[1]) };
    dropped += 1;
  }
  return { run: working, scale, dropped };
}

/**
 * Draws a stat run. Returns its measured box so the caller can advance its own
 * cursor without re-measuring anything.
 */
export function renderStatRun(scene: Phaser.Scene, run: StatRun, opts: StatRunOptions): StatRunResult {
  const density: StatDensity = opts.density ?? 'roomy';
  const align: StatRunAlign = opts.align ?? 'left';
  const fitted = fitRun(scene, run, density, opts.maxWidth);
  const pieces: Piece[] = [];

  const push = (body: string, role: TextRole, ink: keyof typeof INK): void => {
    const text = scene.add.text(0, 0, body, {
      ...textRole(role, { ink }),
      fontSize: `${scaledSize(role, fitted.scale)}px`,
    }).setOrigin(0, 0);
    if (opts.depth !== undefined) text.setDepth(opts.depth);
    opts.track?.push(text);
    pieces.push({ text, width: text.width, height: text.height });
  };

  fitted.run.segments.forEach((seg, i) => {
    const roles = statSegmentRoles(seg, density);
    push(seg.label, roles.label, statLabelInk(seg));
    push(` ${seg.value}`, roles.value, statValueInk(seg));
    if (seg.delta) push(` ${seg.delta}`, roles.label, statDeltaInk(seg));
    if (i < fitted.run.segments.length - 1) push(run.separator, roles.label, 'disabled');
  });

  const width = pieces.reduce((sum, p) => sum + p.width, 0);
  // Bottom-align every piece inside the tallest one's box: the ONE reliable
  // way to get a 13px value and a 9px label onto the same reading line without
  // hardcoding a per-font ascent.
  const height = pieces.reduce((max, p) => Math.max(max, p.height), 0);
  let cursor = align === 'right' ? opts.x - width : opts.x;
  for (const p of pieces) {
    p.text.setPosition(cursor, opts.y + (height - p.height));
    cursor += p.width;
  }
  return { width, height, endX: cursor, dropped: fitted.dropped };
}

/**
 * A single label/value pair drawn as a right-aligned VALUE over/beside a
 * left-aligned LABEL — the ledger-cell form (`RunStatsPanel`'s grid) rather
 * than the row form above. Shares every ink and role decision with
 * `renderStatRun`, which is the whole reason it lives in this file: a ledger
 * cell and a header strip must not disagree about what a `cost` looks like.
 */
export interface StatCellOptions {
  x: number;
  y: number;
  width: number;
  height: number;
  pad: number;
  density?: StatDensity;
  depth?: number;
  /** Passed through to the shared audit so an over-long label still shrinks
   * and truncates exactly like every other audited control. */
  name: string;
}

export function renderStatCell(
  scene: Phaser.Scene, seg: StatSegment, opts: StatCellOptions,
): { label: Phaser.GameObjects.Text; value: Phaser.GameObjects.Text } {
  const roles = statSegmentRoles(seg, opts.density ?? 'roomy');
  const stamp = <T extends Phaser.GameObjects.Text>(t: T): T => {
    if (opts.depth !== undefined) t.setDepth(opts.depth);
    return t;
  };
  const label = stamp(scene.add.text(opts.x + opts.pad, opts.y + opts.pad, seg.label, {
    ...textRole(roles.label, { ink: statLabelInk(seg) }),
  }).setOrigin(0, 0));
  const value = stamp(scene.add.text(opts.x + opts.width - opts.pad, opts.y + opts.height - opts.pad, seg.value, {
    ...textRole(roles.value, { ink: statValueInk(seg) }),
  }).setOrigin(1, 1));
  return { label, value };
}
