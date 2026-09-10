import Phaser from 'phaser';
import { FONT, SCREEN, UI } from '../theme';

/**
 * Reusable hover/tap explanation card — the ONE tooltip idiom for everything
 * a new player can't decode by staring at a number (stat labels, the battle
 * turnline, damage math, gems). Desktop: mouse hover opens it (`pointerover`)
 * and leaving the target closes it (`pointerout`). Mobile: a tap opens it
 * (`pointerdown`) and a second tap on the SAME target closes it. Those two
 * paths have to be kept apart: a real single tap fires
 * `pointerdown -> pointerover -> pointerup -> pointerout` for one finger, all
 * four, so routing `pointerover`/`pointerout` the same way on both inputs
 * (the previous wiring) meant the tap's own trailing `pointerout` destroyed
 * the tip the instant the finger lifted, and a dismiss-tap's `pointerover`
 * would silently reopen the tip `pointerdown`'s toggle had just closed two
 * events earlier. Fixed by having `pointerover`/`pointerout` ignore any event
 * whose `Pointer.wasTouch` is true, leaving `pointerdown`'s toggle as touch's
 * only open/close path.
 *
 * ONE TIP PER SCENE, not per target. Most screens this module serves put
 * several hoverable zones on screen at once (a stat panel's one row per
 * stat, a battle log's one zone per hit, a deck list's one per card) — each
 * `attachHoverTip` call is its own closure with no idea any other exists, so
 * without help, opening a second target's tip would leave the first one's
 * tip alive too (nothing on the first target's own listeners ever fires
 * again once the pointer has moved to a different object) and the two would
 * pile up on screen. `activeTipByScene` is a `WeakMap<Scene, hide>` — every
 * `show()` closes whatever else is currently open ON THAT SCENE first. Keyed
 * on the scene object itself, so two scenes never share state and nothing
 * needs to be cleaned up when a scene ends: the WeakMap does not keep the
 * scene alive, and the entry is removed at the moment the tip it names
 * closes (whether that is this scene-wide takeover, a second tap toggling
 * the SAME target off, or the shutdown/destroy teardown below).
 *
 * Tapping elsewhere (empty space, nothing hoverable under it) still does not
 * close an open tip — only a second tap on the SAME target, or opening a
 * DIFFERENT target's tip, do. Pure presentation — every caller passes TEXT
 * already known/already rendered elsewhere; this module never computes game
 * values.
 *
 * This is deliberately a *second*, simpler idiom than
 * `FantasyCardTemplateV2`'s own `showGlossary` (which is spec-region-bound to
 * a card's layout) — `attachHoverTip` works against ANY on-screen rect, for
 * things that aren't a card (stat lines, log rows, gem chips outside a card).
 */
export interface HoverTipEntry { title: string; body: string; }

/** One open tip per scene, scene-wide (see the module doc comment). Keyed by
 * the scene object so entries can never leak across scenes and never need an
 * explicit sweep — a `WeakMap` drops an entry's eligibility for GC the
 * moment nothing else references its key, and this module's own `hide()`
 * already deletes the entry the instant that tip closes by any path. */
const activeTipByScene = new WeakMap<Phaser.Scene, () => void>();

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
  const hide = (): void => {
    tip?.destroy();
    tip = undefined;
    // Only clear the registry if IT IS STILL US — a scene-wide takeover
    // (another target's `show`) already overwrote this entry with the NEW
    // tip's own `hide` before calling this one, so this must not delete the
    // entry out from under the tip that just replaced it.
    if (activeTipByScene.get(scene) === hide) activeTipByScene.delete(scene);
  };
  const show = (): void => {
    if (tip) return; // already showing — a repeat trigger toggles it off, see `toggle`
    activeTipByScene.get(scene)?.(); // one tip per scene — close whatever else is open first
    tip = renderHoverTipCard(scene, rect, entries);
    activeTipByScene.set(scene, hide);
  };
  const toggle = (): void => { if (tip) hide(); else show(); };
  const emitter = target as unknown as Phaser.Events.EventEmitter;
  // `pointerover`/`pointerout` are the MOUSE path only (`Pointer.wasTouch` is
  // false for every mouse event). A real tap fires
  // `pointerdown -> pointerover -> pointerup -> pointerout`, all four for one
  // finger, so letting `pointerover`/`pointerout` act on a touch event here
  // would (a) have the tap's own trailing `pointerout` destroy the tip the
  // instant the finger lifts, and (b) have a dismiss-tap's `pointerover`
  // silently reopen the tip `pointerdown`'s `toggle` just closed two events
  // earlier. `pointerdown` owns touch's entire open/close state instead.
  const onPointerOver = (pointer: Phaser.Input.Pointer): void => { if (!pointer.wasTouch) show(); };
  const onPointerOut = (pointer: Phaser.Input.Pointer): void => { if (!pointer.wasTouch) hide(); };
  emitter.on('pointerover', onPointerOver);
  emitter.on('pointerout', onPointerOut);
  // First tap opens (tip undefined -> show); a second tap on the SAME target
  // dismisses it (tip set -> hide). Mouse also reaches this on click, which
  // pre-dates this fix and is unchanged here.
  emitter.on('pointerdown', toggle);
  scene.events.once('shutdown', hide);
  // Battle scenes re-attach tips on every playback tick, so each attach must
  // unhook its scene-level shutdown listener when its target dies mid-scene —
  // otherwise orphaned closures pile up on the scene emitter until shutdown.
  emitter.once('destroy', () => {
    scene.events.off('shutdown', hide);
    hide();
  });
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
    const hasBody = entry.body.trim().length > 0;
    const title = scene.add.text(PAD, cursorY, entry.title.toUpperCase(), {
      fontFamily: FONT.body, fontStyle: 'bold', fontSize: '10px', color: '#ffd98a',
      wordWrap: { width: wrapW, useAdvancedWrap: true },
    }).setOrigin(0, 0);
    cursorY += title.height + (hasBody ? 2 : 8);
    texts.push(title);
    if (hasBody) {
      const body = scene.add.text(PAD, cursorY, entry.body, {
        fontFamily: FONT.body, fontSize: '9px', color: '#f1efe8',
        wordWrap: { width: wrapW, useAdvancedWrap: true }, lineSpacing: 2,
      }).setOrigin(0, 0);
      cursorY += body.height + 8;
      texts.push(body);
    }
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
