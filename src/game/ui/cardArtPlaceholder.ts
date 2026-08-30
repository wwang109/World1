import Phaser from 'phaser';
import type { SkillDef } from '../../engine/types';
import { cardArtPlaceholderStyle } from './cardArtPresentation';

/**
 * The card-art placeholder — what fills a card's art region while its texture
 * streams in (`cardArtLoader.ts`), and permanently for the 94 skills that
 * have no art yet.
 *
 * Both card renderers used to draw NOTHING in that case: `CardToken` left the
 * flat 0x121e30 panel and `FantasyCardTemplateV2` a flat 0x1e2733 slab. That
 * was already visibly wrong for the art-less majority of the card pool, and
 * lazy loading would have made it a flicker on every card. This draws the
 * card's own identity instead: a vertical wash of its element/weapon/property
 * color over the panel navy, a soft vignette, and its type badge ghosted in
 * behind the text — no new bytes on the wire (the wash is a 64x96 canvas
 * texture built once per color, the emblem is a badge the boot loader already
 * has).
 */

/** Panel navy the identity color is mixed into. */
const PANEL = 0x0d1524;
/** Identity mix at the top / middle / bottom of the wash. */
const MIX_TOP = 0.40;
const MIX_MID = 0.17;
const MIX_BOTTOM = 0.05;
/** Emblem size as a fraction of the region's shorter edge, and its opacity. */
const EMBLEM_FRACTION = 0.5;
const EMBLEM_ALPHA = 0.17;
/** Emblem centre as a fraction of region height — high enough that a card's
 *  lower text plate never sits on top of it. */
const EMBLEM_CENTER_Y = 0.38;

function mixToCss(base: number, tint: number, t: number): string {
  const c = Phaser.Display.Color.Interpolate.ColorWithColor(
    Phaser.Display.Color.IntegerToColor(base),
    Phaser.Display.Color.IntegerToColor(tint),
    100,
    Math.round(t * 100),
  );
  return `rgb(${Math.round(c.r)},${Math.round(c.g)},${Math.round(c.b)})`;
}

/**
 * A 64x96 canvas texture for one identity color, created once per color and
 * reused by every card that shares it (there are ~13 identity colors in the
 * whole game, so this is at most 13 tiny textures).
 */
export function cardArtPlaceholderTexture(scene: Phaser.Scene, tint: number): string {
  const key = `card-art-placeholder:${tint.toString(16).padStart(6, '0')}`;
  if (scene.textures.exists(key)) return key;
  const tex = scene.textures.createCanvas(key, 64, 96);
  if (!tex) return key;
  const ctx = tex.getContext();
  const wash = ctx.createLinearGradient(0, 0, 22, 96);
  wash.addColorStop(0, mixToCss(PANEL, tint, MIX_TOP));
  wash.addColorStop(0.55, mixToCss(PANEL, tint, MIX_MID));
  wash.addColorStop(1, mixToCss(PANEL, tint, MIX_BOTTOM));
  ctx.fillStyle = wash;
  ctx.fillRect(0, 0, 64, 96);
  const vignette = ctx.createRadialGradient(32, 34, 2, 32, 46, 62);
  vignette.addColorStop(0, 'rgba(255,255,255,0.07)');
  vignette.addColorStop(0.62, 'rgba(0,0,0,0)');
  vignette.addColorStop(1, 'rgba(0,0,0,0.34)');
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, 64, 96);
  tex.refresh();
  return key;
}

/**
 * Builds the placeholder for one card's art region. `x`/`y` are the region's
 * TOP-LEFT in the parent's local space (both renderers place their art region
 * that way). The caller owns clipping — pass the same mask it would give the
 * real art, so the placeholder and the art occupy exactly the same rect.
 */
export function buildCardArtPlaceholder(
  scene: Phaser.Scene,
  skill: SkillDef,
  x: number,
  y: number,
  w: number,
  h: number,
): Phaser.GameObjects.Container {
  const style = cardArtPlaceholderStyle(skill);
  const group = scene.add.container(0, 0);
  group.add(
    scene.add.image(x + w / 2, y + h / 2, cardArtPlaceholderTexture(scene, style.tint))
      .setDisplaySize(w, h),
  );
  const emblemKey = style.emblemTextureKey;
  if (emblemKey && scene.textures.exists(emblemKey)) {
    const size = Math.round(Math.min(w, h) * EMBLEM_FRACTION);
    group.add(
      scene.add.image(x + w / 2, y + h * EMBLEM_CENTER_Y, emblemKey)
        .setDisplaySize(size, size)
        .setAlpha(EMBLEM_ALPHA),
    );
  }
  return group;
}
