import Phaser from 'phaser';
import { FONT, UI } from '../theme';

/** One button in the shared bottom action bar. `flex` sets its share of the
 * width (default 1); `primary` paints it gold. */
export interface ActionButton {
  label: string;
  onPress: () => void;
  primary?: boolean;
  highlight?: boolean;
  flex?: number;
}

/**
 * THE bottom bar foundation. Every mobile scene renders its footer buttons
 * through this so they are the SAME height and sit in the SAME place — a single
 * source of truth for footer geometry. Callers only pick labels + actions.
 */
export const FOOTER_HEIGHT = 40;
/** Gap between the buttons and the bottom edge. */
export const FOOTER_BOTTOM_MARGIN = 16;
/** Left/right inset of the bar from the screen edges. */
export const FOOTER_SIDE_MARGIN = 10;
const GAP = 8;

/** Top-left Y of the footer bar for a given screen height. */
export function footerY(screenH: number): number {
  return screenH - FOOTER_HEIGHT - FOOTER_BOTTOM_MARGIN;
}

/** Draw the footer bar. `x`/`width` default to the standard full-width inset. */
export function renderActionBar(
  scene: Phaser.Scene,
  screenW: number,
  screenH: number,
  buttons: ActionButton[],
): void {
  if (buttons.length === 0) return;
  const x = FOOTER_SIDE_MARGIN;
  const y = footerY(screenH);
  const totalWidth = screenW - FOOTER_SIDE_MARGIN * 2;
  const totalFlex = buttons.reduce((s, b) => s + (b.flex ?? 1), 0);
  const usable = totalWidth - GAP * (buttons.length - 1);
  let cx = x;
  for (const b of buttons) {
    const w = (usable * (b.flex ?? 1)) / totalFlex;
    const fill = b.highlight ? 0xe8b446 : b.primary ? 0xb78a46 : 0x1b2940;
    const color = b.primary || b.highlight ? '#1a1208' : '#e8e0c8';
    const r = scene.add.rectangle(cx, y, w, FOOTER_HEIGHT, fill)
      .setOrigin(0, 0).setStrokeStyle(b.highlight ? 2 : 1, b.highlight ? 0xffe2a0 : UI.border, b.highlight ? 1 : 0.7).setInteractive({ useHandCursor: true });
    r.on('pointerdown', b.onPress);
    scene.add.text(cx + w / 2, y + FOOTER_HEIGHT / 2, b.label, {
      fontSize: '13px', color, fontFamily: FONT.body, fontStyle: 'bold',
    }).setOrigin(0.5);
    cx += w + GAP;
  }
}
