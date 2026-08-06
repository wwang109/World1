import Phaser from 'phaser';
import type { SkillDef } from '../../engine/types';
import { FONT, UI } from '../theme';
import { stripCardTextMarkup } from './cardTextMarkup';
import { cardGlossaryEntries } from './cardHoverEntries';
import { wasPointerConsumedByRebuild } from '../sceneRebuild';

/**
 * "What this card does" block: the full markup-stripped skill text, then a
 * title/body pair per glossary entry the card's face uses (type badge,
 * weight, board footprint, tier, Power Level, the "(+ATK)"/"(+MATK)" scaling
 * suffix, and one entry per mechanical keyword — bleed/poison/burn/riders).
 * Masked to `(x, y, w, h)` and drag/wheel-scrollable whenever content
 * overflows that box — the SAME small-scroll idiom the deck-build socket
 * panel already uses for its gem pouch (mask + pointerdown/move/up + wheel,
 * each gated by its own hit-test so unrelated scroll regions never collide).
 * Pure rendering: reads a `SkillDef` already resolved elsewhere, decides
 * nothing about gameplay.
 */
export function renderCardInfoBox(
  scene: Phaser.Scene,
  x: number,
  y: number,
  w: number,
  h: number,
  skill: SkillDef,
  opts: { titleFontSize?: number; bodyFontSize?: number } = {},
): void {
  const pad = 10;
  const wrapW = w - pad * 2;
  const titleSize = opts.titleFontSize ?? 10;
  const bodySize = opts.bodyFontSize ?? 9;

  const maskShape = scene.make.graphics({}, false);
  maskShape.fillStyle(0xffffff);
  maskShape.fillRect(x, y, w, h);
  const mask = maskShape.createGeometryMask();

  // Invisible interactive "swallow" rect over the whole box: some callers
  // (the mobile bag/draft detail overlays) sit this box directly over a
  // full-screen veil whose OWN pointerdown closes the overlay — without this,
  // a tap/drag-to-scroll here would fall through to the veil (nothing else in
  // the box is interactive) and dismiss the overlay instead of scrolling it.
  scene.add.rectangle(x, y, w, h, 0xffffff, 0.001).setOrigin(0, 0).setInteractive();

  const container = scene.add.container(x + pad, y);
  let cursorY = 0;
  const addLine = (text: string, color: string, size: number, bold: boolean, gapAfter: number): void => {
    const t = scene.add.text(0, cursorY, text, {
      fontFamily: FONT.body, fontStyle: bold ? 'bold' : 'normal', fontSize: `${size}px`, color,
      wordWrap: { width: wrapW, useAdvancedWrap: true }, lineSpacing: 2,
    }).setOrigin(0, 0);
    container.add(t);
    cursorY += t.height + gapAfter;
  };

  addLine(stripCardTextMarkup(skill.text), UI.textAccent, bodySize + 1, true, 10);
  for (const entry of cardGlossaryEntries(skill)) {
    addLine(entry.title.toUpperCase(), '#ffd98a', titleSize, true, 2);
    addLine(entry.body, '#f1efe8', bodySize, false, 8);
  }

  container.setMask(mask);
  const contentH = cursorY;
  const maxScroll = Math.max(0, contentH - h);
  if (maxScroll <= 0) return;

  let scrollY = 0;
  let dragging = false;
  let startY = 0;
  let startScroll = 0;
  const inBox = (px: number, py: number): boolean => px >= x && px <= x + w && py >= y && py <= y + h;
  scene.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
    // See `wasPointerConsumedByRebuild` (sceneRebuild.ts) — this box is
    // mounted inside dialogs (gem socket panel, card detail, …) that a
    // sibling button can close via `rerender()`; without this, that same
    // click can start a phantom scroll-drag over whatever now sits at this
    // pixel in the rebuilt frame.
    if (wasPointerConsumedByRebuild(scene, p)) return;
    if (!inBox(p.worldX, p.worldY)) return;
    dragging = true;
    startY = p.worldY;
    startScroll = scrollY;
  });
  scene.input.on('pointermove', (p: Phaser.Input.Pointer) => {
    if (!dragging) return;
    scrollY = Phaser.Math.Clamp(startScroll + (p.worldY - startY), -maxScroll, 0);
    container.setY(y + scrollY);
  });
  scene.input.on('pointerup', () => { dragging = false; });
  scene.input.on('wheel', (pointer: Phaser.Input.Pointer, _o: unknown, _dx: number, dy: number) => {
    if (!inBox(pointer.worldX, pointer.worldY)) return;
    scrollY = Phaser.Math.Clamp(scrollY - dy, -maxScroll, 0);
    container.setY(y + scrollY);
  });
}
