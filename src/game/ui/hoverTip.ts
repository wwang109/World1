import Phaser from 'phaser';
import { FONT, SCREEN, UI } from '../theme';

/**
 * Reusable hover/tap explanation card — the ONE tooltip idiom for everything
 * a new player can't decode by staring at a number (stat labels, the battle
 * turnline, damage math, gems). Desktop: mouse hover (`pointerover`/
 * `pointerout`). Mobile: tap (touch fires `pointerdown`/`pointerover` too,
 * so the same wiring works; tapping elsewhere or the same zone again closes
 * it). Pure presentation — every caller passes TEXT already known/already
 * rendered elsewhere; this module never computes game values.
 *
 * This is deliberately a *second*, simpler idiom than
 * `FantasyCardTemplateV2`'s own `showGlossary` (which is spec-region-bound to
 * a card's layout) — `attachHoverTip` works against ANY on-screen rect, for
 * things that aren't a card (stat lines, log rows, gem chips outside a card).
 */
export interface HoverTipEntry { title: string; body: string; }

const TIP_WIDTH = 260;
const PAD = 10;

/**
 * Attaches show/hide handlers to `target` (anything with Phaser's
 * `EventEmitter` interactive events — a Rectangle/Zone/Text you've already
 * called `setInteractive()` on). `rect` is `target`'s on-screen bounds (used
 * to place the tip without covering it). No-op if `entries` is empty.
 */
export function attachHoverTip(
  scene: Phaser.Scene,
  target: Phaser.GameObjects.GameObject,
  rect: { x: number; y: number; w: number; h: number },
  entries: readonly HoverTipEntry[],
): void {
  if (entries.length === 0) return;
  let tip: Phaser.GameObjects.Container | undefined;
  const hide = (): void => { tip?.destroy(); tip = undefined; };
  const show = (): void => {
    if (tip) return; // already showing — a second tap on mobile toggles it off via pointerout-less path below
    tip = renderHoverTipCard(scene, rect, entries);
  };
  const toggle = (): void => { if (tip) hide(); else show(); };
  const emitter = target as unknown as Phaser.Events.EventEmitter;
  emitter.on('pointerover', show);
  emitter.on('pointerout', hide);
  // Touch devices don't reliably fire pointerover before a tap — pointerdown
  // both opens it on first tap and lets a second tap dismiss it in place.
  emitter.on('pointerdown', toggle);
  scene.events.once('shutdown', hide);
}

/** Draws the floating card itself — top-left anchored under `rect`, flipped
 * above it if there isn't room below, clamped so it never runs off-canvas. */
function renderHoverTipCard(
  scene: Phaser.Scene,
  rect: { x: number; y: number; w: number; h: number },
  entries: readonly HoverTipEntry[],
): Phaser.GameObjects.Container {
  const wrapW = TIP_WIDTH - PAD * 2;
  const texts: Phaser.GameObjects.Text[] = [];
  let cursorY = PAD;
  for (const entry of entries) {
    const title = scene.add.text(PAD, cursorY, entry.title.toUpperCase(), {
      fontFamily: FONT.body, fontStyle: 'bold', fontSize: '10px', color: '#ffd98a',
      wordWrap: { width: wrapW, useAdvancedWrap: true },
    }).setOrigin(0, 0);
    cursorY += title.height + 2;
    const body = scene.add.text(PAD, cursorY, entry.body, {
      fontFamily: FONT.body, fontSize: '9px', color: '#f1efe8',
      wordWrap: { width: wrapW, useAdvancedWrap: true }, lineSpacing: 2,
    }).setOrigin(0, 0);
    cursorY += body.height + 8;
    texts.push(title, body);
  }
  const h = cursorY + PAD - 8;

  let x = Math.max(4, Math.min(SCREEN.width - TIP_WIDTH - 4, rect.x));
  let y = rect.y + rect.h + 6;
  if (y + h > SCREEN.height - 4) y = rect.y - h - 6;
  if (y < 4) y = 4;

  const bg = scene.add.graphics();
  bg.fillStyle(0x081019, 0.97);
  bg.fillRoundedRect(0, 0, TIP_WIDTH, h, 8);
  bg.lineStyle(2, UI.chip, 0.9);
  bg.strokeRoundedRect(1, 1, TIP_WIDTH - 2, h - 2, 8);

  const container = scene.add.container(x, y, [bg, ...texts]);
  container.setDepth(6000);
  return container;
}

/** A small dedicated hit-zone (invisible rect) at `rect` wired straight to
 * `attachHoverTip` — the common case where the caller doesn't already have
 * an interactive object at that spot (e.g. a plain stat label). */
export function addHoverTipZone(
  scene: Phaser.Scene,
  rect: { x: number; y: number; w: number; h: number },
  entries: readonly HoverTipEntry[],
  /** Depth for the hit zone. MUST exceed any interactive object drawn over
   * this spot: Phaser's hit test is top-only, so a zone left at the default
   * depth 0 under a modal panel (depth 5000+, itself `setInteractive`) never
   * receives the pointer and its tip can never fire. */
  depth = 0,
): Phaser.GameObjects.Rectangle | undefined {
  if (entries.length === 0) return undefined;
  const zone = scene.add.rectangle(rect.x, rect.y, rect.w, rect.h, 0xffffff, 0.001)
    .setOrigin(0, 0)
    .setDepth(depth)
    .setInteractive({ useHandCursor: true });
  attachHoverTip(scene, zone, rect, entries);
  return zone;
}
