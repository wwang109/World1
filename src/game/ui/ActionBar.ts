import Phaser from 'phaser';
import { FONT, UI } from '../theme';
import { auditControlLabel } from './controlLayoutAudit';
import { attachButtonFeel, pressedFill } from './motion';

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
    // Tokens, not pasted copies of them (`#1a1208`/`#e8e0c8`): a copy misses
    // the next palette move the way the scenes' `#8a94a6` missed 2026-09-02's.
    const color = b.primary || b.highlight ? UI.textOnChip : UI.textBright;
    const r = scene.add.rectangle(cx, y, w, FOOTER_HEIGHT, fill)
      .setOrigin(0, 0).setStrokeStyle(b.highlight ? 2 : 1, b.highlight ? 0xffe2a0 : UI.border, b.highlight ? 1 : 0.7).setInteractive({ useHandCursor: true });
    const label = scene.add.text(cx + w / 2, y + FOOTER_HEIGHT / 2, b.label, {
      fontSize: '13px', color, fontFamily: FONT.body, fontStyle: 'bold',
    }).setOrigin(0.5);
    // MOBILE's primary controls had NO feedback at all — not even a hover
    // handler (there is no cursor on a phone), so a tap was visually silent.
    // Press feel matters MORE here than on desktop for that exact reason: the
    // press is the only visual channel a touch UI has. Hover == fill (a no-op
    // without a cursor); the press colour is the shared derived darken, and the
    // label rides the plate.
    attachButtonFeel(scene, r, {
      fill,
      hover: fill,
      press: pressedFill(fill),
      follow: [label],
      onPress: b.onPress,
    });
    // Shrink-then-ellipsize (shared layout-audit policy — same helper/options
    // shape RunProgressStrip's own footer-style buttons already use) so a
    // narrow button never bleeds its label into its neighbor. Before this the
    // label was drawn at a fixed 13px regardless of `w`, so a long label (e.g.
    // "BACK TO PREP ›") on a battle scene's 5-button row overflowed its own
    // rect and overlapped/clipped the button beside it (2026-08-17 report).
    auditControlLabel(r, label, { name: `footer:${b.label}`, horizontalPadding: 6, verticalPadding: 4, minFontSize: 7 });
    cx += w + GAP;
  }
}
