import type Phaser from 'phaser';
import { UI } from '../theme';
import { isKeptFromRebuild, keepOnRebuild } from '../sceneRebuild';
import { biomeFor } from '../../run/biome';
import { availableChoices, nodeById, type RunState } from '../../run/runState';

export interface AmbienceArea { x: number; y: number; width: number; height: number }

type MoteTexture = 'fx-mote' | 'fx-streak' | 'fx-leaf';
type SpawnEdge = 'below' | 'above' | 'left' | 'anywhere';

interface AmbienceSpec {
  texture: MoteTexture;
  tints: readonly number[];
  glow: number;
  additive: boolean;
  density: number;
  lifespan: readonly [number, number];
  speedX: readonly [number, number];
  speedY: readonly [number, number];
  scale: readonly [number, number];
  alpha: number;
  from: SpawnEdge;
  rotate?: number;
  spin?: boolean;
}

const DEFAULT_SPEC: AmbienceSpec = {
  texture: 'fx-mote', tints: [UI.artLift], glow: UI.chip, additive: true, density: 16,
  lifespan: [6000, 10000], speedX: [-6, 6], speedY: [-14, -4], scale: [0.22, 0.08], alpha: 0.5, from: 'anywhere',
};

const BIOME_AMBIENCE: Readonly<Record<string, AmbienceSpec>> = {
  emberwaste: {
    texture: 'fx-mote', tints: [0xff8a3d, 0xffb347, 0xff5a1f], glow: 0xff6a2a, additive: true, density: 34,
    lifespan: [3500, 6500], speedX: [-12, 12], speedY: [-55, -25], scale: [0.34, 0.1], alpha: 0.85, from: 'below',
  },
  frostmarch: {
    texture: 'fx-mote', tints: [0xffffff, 0xd8ecff], glow: 0x9fd3ff, additive: false, density: 46,
    lifespan: [6000, 10000], speedX: [-14, 8], speedY: [18, 40], scale: [0.28, 0.18], alpha: 0.7, from: 'above',
  },
  stormreach: {
    texture: 'fx-streak', tints: [0xa8c8ff, 0xd0e4ff], glow: 0x6f8cff, additive: false, density: 40,
    lifespan: [900, 1400], speedX: [-90, -70], speedY: [380, 460], scale: [1, 1], alpha: 0.32, from: 'above', rotate: 11,
  },
  thornwild: {
    texture: 'fx-leaf', tints: [0x7cab63, 0x9cc46a, 0x5e8a44], glow: 0x5e9a4a, additive: false, density: 16,
    lifespan: [7000, 11000], speedX: [-20, 20], speedY: [16, 34], scale: [0.9, 0.9], alpha: 0.75, from: 'above', spin: true,
  },
  hallowfield: {
    texture: 'fx-mote', tints: [0xfff1b8, 0xffd56b], glow: 0xffe08a, additive: true, density: 24,
    lifespan: [5000, 9000], speedX: [-6, 6], speedY: [-18, -6], scale: [0.3, 0.05], alpha: 0.8, from: 'anywhere',
  },
  duskbarrow: {
    texture: 'fx-mote', tints: [0xa58cff, 0x7d6bd1], glow: 0x6b4fb8, additive: true, density: 18,
    lifespan: [6000, 10000], speedX: [-8, 8], speedY: [-14, -4], scale: [0.6, 1.2], alpha: 0.22, from: 'anywhere',
  },
  howlmoor: {
    texture: 'fx-mote', tints: [0xc7d3c9, 0xaab8b0], glow: 0x7f9a8c, additive: false, density: 14,
    lifespan: [9000, 14000], speedX: [10, 22], speedY: [-3, 3], scale: [1.6, 2.4], alpha: 0.1, from: 'left',
  },
  ironmoot: {
    texture: 'fx-mote', tints: [0xb0b0b0, 0x8c8c8c, 0xff9a4a], glow: 0xc0703a, additive: false, density: 26,
    lifespan: [6000, 9000], speedX: [-10, 10], speedY: [10, 26], scale: [0.22, 0.14], alpha: 0.55, from: 'above',
  },
  pikewold: {
    texture: 'fx-mote', tints: [0xf2e2a8, 0xe6cf86], glow: 0xd9b55c, additive: true, density: 20,
    lifespan: [7000, 11000], speedX: [8, 22], speedY: [-6, 6], scale: [0.18, 0.1], alpha: 0.6, from: 'left',
  },
  swornhold: {
    texture: 'fx-mote', tints: [0xf4e6c4], glow: UI.chip, additive: true, density: 18,
    lifespan: [6000, 10000], speedX: [-4, 4], speedY: [-10, -2], scale: [0.2, 0.08], alpha: 0.55, from: 'anywhere',
  },
  arrowfell: {
    texture: 'fx-streak', tints: [0xe8f0e0], glow: 0x9bbf8a, additive: false, density: 10,
    lifespan: [1800, 2600], speedX: [160, 240], speedY: [-6, 6], scale: [1, 1], alpha: 0.18, from: 'left', rotate: 90,
  },
};

const REFERENCE_AREA = 1000 * 700;

function ensureAmbienceTextures(scene: Phaser.Scene): void {
  const textures = scene.textures;
  if (!textures.exists('fx-mote')) {
    const g = scene.make.graphics({}, false);
    for (let r = 8; r >= 1; r--) g.fillStyle(0xffffff, 0.14).fillCircle(8, 8, r);
    g.generateTexture('fx-mote', 16, 16);
    g.destroy();
  }
  if (!textures.exists('fx-streak')) {
    const g = scene.make.graphics({}, false);
    g.fillStyle(0xffffff, 1).fillRect(0, 0, 2, 18);
    g.generateTexture('fx-streak', 2, 18);
    g.destroy();
  }
  if (!textures.exists('fx-leaf')) {
    const g = scene.make.graphics({}, false);
    g.fillStyle(0xffffff, 1).fillEllipse(6, 3, 12, 6);
    g.generateTexture('fx-leaf', 12, 6);
    g.destroy();
  }
  if (!textures.exists('fx-glow')) {
    const canvas = textures.createCanvas('fx-glow', 256, 256);
    const ctx = canvas?.getContext();
    if (canvas && ctx) {
      const gradient = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
      gradient.addColorStop(0, 'rgba(255,255,255,1)');
      gradient.addColorStop(0.45, 'rgba(255,255,255,0.35)');
      gradient.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, 256, 256);
      canvas.refresh();
    }
  }
}

function spawnRange(area: AmbienceArea, from: SpawnEdge): { x: { min: number; max: number }; y: { min: number; max: number } } {
  const { x, y, width, height } = area;
  switch (from) {
    case 'below': return { x: { min: x, max: x + width }, y: { min: y + height, max: y + height + 12 } };
    case 'above': return { x: { min: x - width * 0.1, max: x + width * 1.1 }, y: { min: y - 12, max: y } };
    case 'left': return { x: { min: x - 24, max: x }, y: { min: y, max: y + height } };
    case 'anywhere': return { x: { min: x, max: x + width }, y: { min: y, max: y + height } };
  }
}

export function biomeAmbienceSpec(biomeId: string | undefined): AmbienceSpec {
  return (biomeId !== undefined ? BIOME_AMBIENCE[biomeId] : undefined) ?? DEFAULT_SPEC;
}

interface LiveAmbience { key: string; glow: Phaser.GameObjects.Image; emitter: Phaser.GameObjects.Particles.ParticleEmitter }

const liveAmbience = new WeakMap<Phaser.Scene, LiveAmbience>();

function breatheGlow(scene: Phaser.Scene, glow: Phaser.GameObjects.Image): void {
  glow.setAlpha(0.14);
  scene.tweens.add({ targets: glow, alpha: 0.24, duration: 4200, ease: 'Sine.easeInOut', yoyo: true, repeat: -1 });
}

export function addBiomeAmbience(scene: Phaser.Scene, biomeId: string | undefined, area: AmbienceArea): void {
  if (area.width <= 0 || area.height <= 0) return;
  const spec = biomeAmbienceSpec(biomeId);
  const key = `${biomeId ?? 'default'}:${area.x},${area.y},${area.width},${area.height}`;
  const existing = liveAmbience.get(scene);
  if (existing && existing.key === key && isKeptFromRebuild(existing.glow) && isKeptFromRebuild(existing.emitter)) {
    keepOnRebuild(existing.glow);
    keepOnRebuild(existing.emitter);
    scene.children.bringToTop(existing.glow);
    scene.children.bringToTop(existing.emitter);
    breatheGlow(scene, existing.glow);
    return;
  }
  if (existing) {
    if (existing.glow.active) existing.glow.destroy();
    if (existing.emitter.active) existing.emitter.destroy();
  }
  ensureAmbienceTextures(scene);

  const glow = scene.add.image(area.x + area.width / 2, area.y + area.height * 0.42, 'fx-glow')
    .setDisplaySize(area.width * 1.15, area.height * 1.05)
    .setTint(spec.glow)
    .setBlendMode('ADD');
  breatheGlow(scene, glow);

  const live = Math.max(4, Math.round(spec.density * (area.width * area.height) / REFERENCE_AREA));
  const meanLife = (spec.lifespan[0] + spec.lifespan[1]) / 2;
  const peak = spec.alpha;
  const emitter = scene.add.particles(0, 0, spec.texture, {
    ...spawnRange(area, spec.from),
    lifespan: { min: spec.lifespan[0], max: spec.lifespan[1] },
    speedX: { min: spec.speedX[0], max: spec.speedX[1] },
    speedY: { min: spec.speedY[0], max: spec.speedY[1] },
    scale: { start: spec.scale[0], end: spec.scale[1] },
    alpha: { onEmit: () => 0, onUpdate: (_particle: Phaser.GameObjects.Particles.Particle, _key: string, t: number) => peak * Math.sin(Math.PI * t) },
    ...(spec.spin ? { rotate: { min: 0, max: 360 } } : spec.rotate !== undefined ? { rotate: spec.rotate } : {}),
    tint: [...spec.tints],
    blendMode: spec.additive ? 'ADD' : 'NORMAL',
    frequency: meanLife / live,
    quantity: 1,
    maxAliveParticles: live * 2,
  });
  emitter.fastForward(spec.lifespan[1]);
  keepOnRebuild(glow);
  keepOnRebuild(emitter);
  liveAmbience.set(scene, { key, glow, emitter });
}

export function burstReward(scene: Phaser.Scene, area: AmbienceArea): void {
  ensureAmbienceTextures(scene);
  const emitter = scene.add.particles(area.x + area.width / 2, area.y + area.height * 0.3, 'fx-mote', {
    speed: { min: 80, max: 220 },
    angle: { min: 0, max: 360 },
    lifespan: { min: 600, max: 1100 },
    scale: { start: 0.55, end: 0 },
    alpha: { start: 1, end: 0 },
    tint: [UI.chip, 0xffe08a, 0xfff1b8],
    blendMode: 'ADD',
    gravityY: 120,
    emitting: false,
  });
  emitter.explode(28);
  scene.time.delayedCall(1400, () => emitter.destroy());
}

export function runAmbienceBiomeId(run: RunState): string {
  const node = (run.currentNodeId !== null ? nodeById(run, run.currentNodeId) : undefined) ?? availableChoices(run)[0];
  return biomeFor(run.map.seed, node?.wave ?? 1, node?.biomeId).id;
}
