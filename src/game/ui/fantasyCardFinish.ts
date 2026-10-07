import Phaser from 'phaser';
import type { SkillTier } from '../../engine/types';
import { FANTASY_CARD_TITLE_NAME, type FantasyCardTemplateV2 } from './FantasyCardTemplateV2';
import type { FantasyCardTemplateModel } from './fantasyCardTemplateModel';
import type { RegionBox } from './fantasyCardTemplateSpec';

interface TierFinish {
  glow?: { color: number; outer: number };
  shadowAlpha: number;
}

const TIER_FINISH: Record<SkillTier, TierFinish> = {
  bronze: { shadowAlpha: 0.32 },
  silver: { shadowAlpha: 0.36 },
  gold: { shadowAlpha: 0.4 },
  diamond: { glow: { color: 0x9ff3ff, outer: 3 }, shadowAlpha: 0.44 },
};

const VIGNETTE_KEY = 'card-finish-vignette';
const SHADOW_NAME = 'fantasy-card-finish-shadow';
const VIGNETTE_NAME = 'fantasy-card-finish-vignette';
const SHADOW_LAYERS = 6;
const HOVER_SCALE = 1.04;

export interface CardFinishHandle {
  shadow: Phaser.GameObjects.Graphics;
}

function isWebGL(scene: Phaser.Scene): boolean {
  return scene.sys.renderer.type === Phaser.WEBGL;
}

function vignetteTexture(scene: Phaser.Scene): string {
  if (scene.textures.exists(VIGNETTE_KEY)) return VIGNETTE_KEY;
  const size = 256;
  const texture = scene.textures.createCanvas(VIGNETTE_KEY, size, size)!;
  const context = texture.getContext();
  const gradient = context.createRadialGradient(size / 2, size / 2, size * 0.28, size / 2, size / 2, size * 0.72);
  gradient.addColorStop(0, 'rgba(0,0,0,0)');
  gradient.addColorStop(1, 'rgba(0,0,0,0.42)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, size, size);
  texture.refresh();
  return VIGNETTE_KEY;
}

function drawShadow(shadow: Phaser.GameObjects.Graphics, w: number, h: number, radius: number, scale: number, alpha: number, lift: number): void {
  shadow.clear();
  const drop = (4 + lift) * scale;
  for (let layer = SHADOW_LAYERS; layer >= 1; layer -= 1) {
    const spread = layer * 2.2 * scale;
    shadow.fillStyle(0x000000, alpha / SHADOW_LAYERS);
    shadow.fillRoundedRect(-w / 2 - spread, -h / 2 - spread + drop, w + spread * 2, h + spread * 2, radius + spread);
  }
}

export function applyCardFinish(card: FantasyCardTemplateV2, options: { effects?: boolean } = {}): CardFinishHandle {
  const scene = card.scene;
  const model = card.getData('templateModel') as FantasyCardTemplateModel;
  const regions = card.getData('templateRegions') as Record<string, RegionBox>;
  const finish = TIER_FINISH[model.tier];
  const scale = card.width / model.spec.baseSize.width;
  const radius = model.spec.cornerRadius * scale;

  const shadow = scene.add.graphics().setName(SHADOW_NAME);
  drawShadow(shadow, card.width, card.height, radius, scale, finish.shadowAlpha, 0);
  card.addAt(shadow, 0);

  const art = regions.artFrame;
  if (art) {
    const vignette = scene.add.image(-card.width / 2 + art.x * scale, -card.height / 2 + art.y * scale, vignetteTexture(scene))
      .setOrigin(0, 0).setDisplaySize(art.w * scale, art.h * scale).setName(VIGNETTE_NAME);
    card.addAt(vignette, 3);
  }

  if (model.template === 'printed-v2') {
    const title = card.getByName(FANTASY_CARD_TITLE_NAME);
    if (title instanceof Phaser.GameObjects.Text) title.setShadow(0, Math.max(1, scale * 1.2), 'rgba(255,255,255,0.65)', 0, false, true);
  }

  const handle: CardFinishHandle = { shadow };
  if (finish.glow && options.effects !== false && isWebGL(scene) && card.postFX) {
    card.postFX.addGlow(finish.glow.color, finish.glow.outer, 0, false, 0.1, 10);
  }
  return handle;
}

export function attachCardFinishHover(card: FantasyCardTemplateV2, handle: CardFinishHandle): void {
  const scene = card.scene;
  const model = card.getData('templateModel') as FantasyCardTemplateModel;
  const finish = TIER_FINISH[model.tier];
  const scale = card.width / model.spec.baseSize.width;
  const radius = model.spec.cornerRadius * scale;
  card.setInteractive(new Phaser.Geom.Rectangle(-card.width / 2, -card.height / 2, card.width, card.height), Phaser.Geom.Rectangle.Contains);
  const lift = (lifted: boolean) => {
    scene.tweens.add({ targets: card, scale: lifted ? HOVER_SCALE : 1, duration: 140, ease: 'Sine.easeOut' });
    drawShadow(handle.shadow, card.width, card.height, radius, scale, finish.shadowAlpha * (lifted ? 1.35 : 1), lifted ? 6 : 0);
  };
  card.on(Phaser.Input.Events.GAMEOBJECT_POINTER_OVER, () => lift(true));
  card.on(Phaser.Input.Events.GAMEOBJECT_POINTER_OUT, () => lift(false));
}
