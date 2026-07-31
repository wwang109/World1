import { Container, Graphics, Text, TextStyle, type TextStyleAlign } from 'pixi.js';
import { UI } from '../theme';

/**
 * Proper web font (self-hosted via @fontsource, loaded in main.ts before
 * anything rasterizes) with sensible system fallbacks. Emoji glyphs fall
 * through to the platform emoji font exactly as before.
 */
export const FONT_STACK = ['JetBrains Mono', 'ui-monospace', 'Menlo', 'Consolas', 'monospace'];

/**
 * Text is rasterized at ≥2× regardless of the monitor, so even after the
 * stage is scaled down to fit a small screen the glyphs are downsampled
 * from a high-res bake instead of upscaled from a 1× one.
 */
export const TEXT_RESOLUTION = Math.max(2, Math.ceil(globalThis.devicePixelRatio ?? 1));

export interface TextOpts {
  size: number;
  color?: string;
  bold?: boolean;
  align?: TextStyleAlign;
  wrapWidth?: number;
  lineSpacing?: number;
}

export function makeText(content: string, opts: TextOpts): Text {
  return new Text({
    text: content,
    resolution: TEXT_RESOLUTION,
    style: new TextStyle({
      fontFamily: FONT_STACK,
      fontSize: opts.size,
      fill: opts.color ?? UI.text,
      fontWeight: opts.bold ? '700' : '400',
      align: opts.align ?? 'left',
      ...(opts.wrapWidth !== undefined ? { wordWrap: true, wordWrapWidth: opts.wrapWidth } : {}),
      ...(opts.lineSpacing !== undefined ? { leading: opts.lineSpacing } : {}),
    }),
  });
}

/** A filled (optionally stroked) rectangle; origin expressed like Phaser's. */
export function makeRect(
  w: number,
  h: number,
  fill: number,
  opts: { stroke?: { width: number; color: number }; originX?: number; originY?: number } = {},
): Graphics {
  const ox = opts.originX ?? 0.5;
  const oy = opts.originY ?? 0.5;
  const g = new Graphics().rect(-w * ox, -h * oy, w, h).fill(fill);
  if (opts.stroke) g.stroke({ width: opts.stroke.width, color: opts.stroke.color });
  return g;
}

export interface ButtonOpts {
  size: number;
  color?: string;
  bg?: number;
  padX?: number;
  padY?: number;
  bold?: boolean;
}

/** Label-on-a-panel button, replacing Phaser's text backgroundColor+padding. */
export class TextButton extends Container {
  private bg = new Graphics();
  private labelText: Text;
  private bgColor: number;
  private readonly padX: number;
  private readonly padY: number;
  private centered = false;

  constructor(label: string, opts: ButtonOpts) {
    super();
    this.padX = opts.padX ?? 8;
    this.padY = opts.padY ?? 5;
    this.bgColor = opts.bg ?? UI.panelLight;
    this.labelText = makeText(label, { size: opts.size, color: opts.color, bold: opts.bold });
    this.labelText.position.set(this.padX, this.padY);
    this.addChild(this.bg, this.labelText);
    this.redraw();
    this.eventMode = 'static';
    this.cursor = 'pointer';
  }

  get bgWidth(): number {
    return this.labelText.width + this.padX * 2;
  }

  get bgHeight(): number {
    return this.labelText.height + this.padY * 2;
  }

  /** Anchor at the panel center (Phaser's setOrigin(0.5) equivalent). */
  center(): this {
    this.centered = true;
    this.applyPivot();
    return this;
  }

  setLabel(label: string): void {
    this.labelText.text = label;
    this.redraw();
  }

  setColor(color: string): void {
    this.labelText.style.fill = color;
  }

  setBg(color: number): void {
    this.bgColor = color;
    this.redraw();
  }

  private applyPivot(): void {
    if (this.centered) this.pivot.set(this.bgWidth / 2, this.bgHeight / 2);
  }

  private redraw(): void {
    this.bg.clear().rect(0, 0, this.bgWidth, this.bgHeight).fill(this.bgColor);
    this.applyPivot();
  }
}
