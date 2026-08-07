import type Phaser from 'phaser';
import { ACTIVE_PROFILE } from '../layoutProfile';
import { FONT, SCREEN, UI } from '../theme';

/**
 * THE WORLD1 brand mark -- the eyebrow line, the wordmark, and (optionally)
 * the rule under it. ONE implementation, used by both screens that show it:
 * `BootScene`'s loading screen and `StartScene`'s title screen.
 *
 * It exists because those two had the block copied between them as loose
 * literals (34/44 eyebrow gap, 44/64 wordmark size, 34/46 rule gap, 180/260
 * rule width). Two copies of the same hand-picked offsets is a guaranteed
 * drift, and the drift is VISIBLE: boot hands straight over to start, so any
 * difference between them reads as the logo jumping at the handoff.
 *
 * `setCenter` exists because the canvas now FILLS the browser window
 * (`game/viewport.ts`) and can therefore change size WHILE a screen is up.
 * Most scenes answer that by re-running `create()` (the `rebuildScene` idiom),
 * but `BootScene` cannot -- its `create()` starts the next scene -- so it
 * repositions this block in place instead.
 */

export interface BrandMarkMetrics {
  /** Distance from the wordmark baseline-centre up to the eyebrow line. */
  eyebrowGap: number;
  wordmarkSize: number;
  /** Distance from the wordmark centre down to the rule. */
  ruleGap: number;
  ruleWidth: number;
  ruleHeight: number;
}

export const BRAND_MARK: Record<'mobile' | 'desktop', BrandMarkMetrics> = {
  mobile: { eyebrowGap: 34, wordmarkSize: 44, ruleGap: 34, ruleWidth: 180, ruleHeight: 2 },
  desktop: { eyebrowGap: 44, wordmarkSize: 64, ruleGap: 46, ruleWidth: 260, ruleHeight: 2 },
};

export function brandMarkMetrics(): BrandMarkMetrics {
  return BRAND_MARK[ACTIVE_PROFILE.id];
}

export interface BrandMark {
  /** Re-centres the whole block. Safe to call every frame / on every resize. */
  setCenter(cx: number, y: number): void;
}

/**
 * Draws the block centred on `(cx, y)`. `rule` adds the gold underline (the
 * title screen has it; the loading screen leaves the space for its bar).
 */
export function renderBrandMark(
  scene: Phaser.Scene,
  cx: number,
  y: number,
  opts: { rule?: boolean } = {},
): BrandMark {
  const m = brandMarkMetrics();
  const F = ACTIVE_PROFILE.font;
  const eyebrow = scene.add.text(cx, y - m.eyebrowGap, 'A ROGUELITE SKILL-BOARD BATTLER', {
    fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${F.tiny}px`, color: UI.textMuted, letterSpacing: 2,
  }).setOrigin(0.5);
  const wordmark = scene.add.text(cx, y, 'WORLD1', {
    fontFamily: FONT.display ?? FONT.body, fontStyle: 'bold', fontSize: `${m.wordmarkSize}px`, color: UI.textBright,
  }).setOrigin(0.5);
  const rule = opts.rule
    ? scene.add.rectangle(cx, y + m.ruleGap, m.ruleWidth, m.ruleHeight, 0xb78a46, 0.9)
    : null;
  return {
    setCenter(nx: number, ny: number): void {
      eyebrow.setPosition(nx, ny - m.eyebrowGap);
      wordmark.setPosition(nx, ny);
      rule?.setPosition(nx, ny + m.ruleGap);
    },
  };
}

/** The block's centre y for a given fraction of the CURRENT viewport height --
 * the one place either screen turns "44% down the screen" into a coordinate. */
export function brandMarkCenterY(fraction: number): number {
  return Math.round(SCREEN.height * fraction);
}
