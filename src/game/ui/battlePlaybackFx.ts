import Phaser from 'phaser';
import { recipeForIdentity, type FxRecipe, type FxTier, type MotionProfile } from './battleFxSpec';
import { AILMENT_COLOR, STATUS_CHIP_COLOR } from './battleStatusPalette';
import { FONT } from '../theme';
import type { BoardColumn, ColumnPiece } from './BoardColumn';
import type { TurnFx } from '../battleTimeline';

export interface HpBarHandles {
  fillRect: Phaser.GameObjects.Rectangle;
  shieldRect: Phaser.GameObjects.Rectangle;
  border: Phaser.GameObjects.Rectangle;
  shakeTargets: Array<Phaser.GameObjects.Text | Phaser.GameObjects.Rectangle>;
  floatX: number;
  floatY: number;
  barX: number;
  barY: number;
  barW: number;
  barH: number;
}

export function spawnFxFloat(
  scene: Phaser.Scene, x: number, y: number, text: string, color: string,
  tier: FxTier, baseFontSize: number, speedMult: number, taxSuffix?: string,
): void {
  const fontSize = Math.round(baseFontSize * tier.fontScale);
  const fx = x + (Math.random() * 24 - 12);
  const t = scene.add
    .text(fx, y - 4, text, {
      fontFamily: FONT.body, fontSize: `${fontSize}px`, fontStyle: tier.bold ? 'bold' : 'normal', color,
    })
    .setOrigin(0.5)
    .setDepth(30)
    .setScale(0.5);
  const suffix = taxSuffix
    ? scene.add.text(fx + t.width / 2 + 3, y - 4, taxSuffix, {
        fontFamily: FONT.body, fontSize: '11px', fontStyle: 'bold', color: AILMENT_COLOR.expose ?? '#c4a6e5',
      }).setOrigin(0, 0.5).setDepth(30).setScale(0.5)
    : undefined;
  const targets: Phaser.GameObjects.Text[] = suffix ? [t, suffix] : [t];
  const floatUp = (): void => {
    scene.tweens.add({
      targets, y: '-=26', alpha: 0, duration: 320 / speedMult, ease: 'Quad.easeOut',
      onComplete: () => { t.destroy(); suffix?.destroy(); },
    });
  };
  scene.tweens.add({
    targets, scale: 1, duration: 110 / speedMult, ease: 'Back.easeOut',
    onComplete: () => {
      if (tier.flash) {
        scene.tweens.add({
          targets, alpha: 0.2, duration: 30 / speedMult, yoyo: true, repeat: 1, ease: 'Sine.easeInOut',
          onComplete: floatUp,
        });
      } else {
        floatUp();
      }
    },
  });
}

export function shakeBar(
  scene: Phaser.Scene, targets: Array<Phaser.GameObjects.Text | Phaser.GameObjects.Rectangle>, speedMult: number,
): void {
  if (targets.length === 0) return;
  const origins = targets.map((t) => ({ t, x: t.x }));
  for (const o of origins) o.t.x = o.x - 3;
  scene.tweens.add({
    targets, x: '+=3', duration: 33 / speedMult, ease: 'Sine.InOut', yoyo: true, repeat: 2,
    onComplete: () => { for (const o of origins) o.t.setPosition(o.x, o.t.y); },
  });
}

export function pulseTokenAt(
  scene: Phaser.Scene, col: BoardColumn, pieces: ColumnPiece[], slot: number,
  cast: TurnFx | undefined, nameFontSize: number, speedMult: number, slotCount = 10,
): FxRecipe | undefined {
  const bySlot = new Map<number, ColumnPiece>();
  for (const p of pieces) bySlot.set(p.slot, p);
  let row = 0; let tokenIdx = 0;
  while (row < slotCount) {
    const piece = bySlot.get(row);
    const span = piece ? Math.max(1, piece.skill.size) : 1;
    if (piece && row === slot) {
      const token = col.tokens[tokenIdx];
      if (token) {
        const recipe = cast ? recipeForIdentity(cast.archetype, cast.property, cast.element, cast.weapon) : undefined;
        if (recipe) {
          castTokenFx(scene, token, recipe, cast?.cardName ?? piece.skill.name, nameFontSize, speedMult);
        } else {
          token.setScale(1);
          scene.tweens.add({ targets: token, scale: 1.04, duration: 125 / speedMult, yoyo: true, ease: 'Sine.InOut' });
        }
        return recipe;
      }
      return undefined;
    }
    tokenIdx += 1;
    row += span;
  }
  return undefined;
}

export function castTokenFx(
  scene: Phaser.Scene, token: Phaser.GameObjects.Container, recipe: FxRecipe,
  cardName: string, nameFontSize: number, speedMult: number,
): void {
  const { motion, palette } = recipe;
  const w = token.width || 60;
  const h = token.height || 40;
  token.setScale(1);
  token.setAngle(0);
  scene.tweens.add({
    targets: token, scale: motion.scalePeak, duration: motion.activeMs / speedMult, ease: motion.easeIn,
    yoyo: true, hold: motion.holdMs / speedMult,
    onComplete: () => token.setScale(1),
  });
  if (motion.angleJitterDeg > 0) {
    scene.tweens.add({
      targets: token, angle: motion.angleJitterDeg, duration: Math.max(40, motion.activeMs / 2) / speedMult,
      yoyo: true, ease: 'Sine.easeInOut',
      onComplete: () => token.setAngle(0),
    });
  }
  const flashCycles = Math.max(1, motion.pulses);
  const flash = scene.add.rectangle(token.x, token.y, w, h, palette.colorNum, 0.45).setDepth(29);
  scene.tweens.add({
    targets: flash, alpha: 0, duration: 70 / speedMult, ease: motion.easeOut,
    yoyo: flashCycles > 1, repeat: flashCycles - 1,
    onComplete: () => flash.destroy(),
  });
  const nameText = scene.add.text(token.x, token.y - h / 2 - 4, cardName, {
    fontFamily: FONT.body, fontSize: `${nameFontSize}px`, fontStyle: 'bold', color: palette.color,
  }).setOrigin(0.5, 1).setDepth(31).setAlpha(0);
  scene.tweens.add({
    targets: nameText, alpha: 1, duration: 100 / speedMult, ease: 'Sine.easeOut',
    onComplete: () => {
      scene.tweens.add({
        targets: nameText, y: nameText.y + motion.driftY, alpha: 0,
        duration: 280 / speedMult, delay: motion.holdMs / speedMult, ease: motion.easeOut,
        onComplete: () => nameText.destroy(),
      });
    },
  });
}

export function applyMotionProfileEntrance(
  scene: Phaser.Scene, target: Phaser.GameObjects.Text, profile: MotionProfile, speedMult: number,
): void {
  const restY = target.y;
  const startY = restY - profile.driftY;
  target.setY(startY).setAlpha(0);
  const duration = profile.activeMs / speedMult;
  scene.tweens.add({
    targets: target, y: restY, alpha: 1, duration, ease: profile.easeIn,
    onComplete: () => {
      if (profile.pulses > 0) {
        scene.tweens.add({
          targets: target, alpha: 0.55, duration: Math.max(30, duration / 4),
          yoyo: true, repeat: profile.pulses - 1, ease: 'Sine.easeInOut',
        });
      }
    },
  });
}

export function punchLogRowIn(
  scene: Phaser.Scene, targets: Phaser.GameObjects.Text[], speedMult: number,
): void {
  for (const t of targets) t.setScale(0.85);
  scene.tweens.add({ targets, scale: 1, duration: 80 / speedMult, ease: 'Back.easeOut' });
}

export function fadeSlideLogRowIn(
  scene: Phaser.Scene, targets: Phaser.GameObjects.Text[], speedMult: number,
): void {
  for (const t of targets) t.setAlpha(0).setX(t.x - 4);
  scene.tweens.add({
    targets, alpha: 1, x: '+=4', duration: 90 / speedMult, ease: 'Quad.easeOut',
  });
}

export function flashLogRowHighlight(
  scene: Phaser.Scene, x: number, y: number, w: number, h: number, colorNum: number, speedMult: number,
): void {
  const rect = scene.add.rectangle(x, y, w, h, colorNum, 0.28).setOrigin(0, 0).setDepth(-1);
  scene.tweens.add({
    targets: rect, alpha: 0, duration: 140 / speedMult, ease: 'Quad.easeOut',
    onComplete: () => rect.destroy(),
  });
}

export function flashLogPanelFullWidth(
  scene: Phaser.Scene, x: number, y: number, w: number, h: number, speedMult: number,
): void {
  const rect = scene.add.rectangle(x, y, w, h, 0xd05c4e, 0.35).setOrigin(0, 0).setDepth(-1);
  scene.tweens.add({
    targets: rect, alpha: 0, duration: 180 / speedMult, ease: 'Quad.easeOut',
    onComplete: () => rect.destroy(),
  });
}

const BAR_FLASH_TINT: Record<'shieldBroken' | 'negated' | 'warded', number> = {
  shieldBroken: 0xbcdcf2,
  negated: 0xffffff,
  warded: parseInt(STATUS_CHIP_COLOR.ward!.slice(1), 16),
};

export function flashHpBarKind(
  scene: Phaser.Scene, bar: HpBarHandles, kind: 'shieldBroken' | 'negated' | 'warded', speedMult: number,
): void {
  const tint = BAR_FLASH_TINT[kind];
  const ring = scene.add.rectangle(bar.barX, bar.barY, bar.barW, bar.barH, tint, 0)
    .setOrigin(0, 0.5).setStrokeStyle(3, tint, 0.95).setDepth(28);
  scene.tweens.add({
    targets: ring, alpha: 0, duration: 260 / speedMult, ease: 'Quad.easeOut',
    onComplete: () => ring.destroy(),
  });
}

export function fadeDefeated(
  scene: Phaser.Scene, targets: Array<Phaser.GameObjects.Text | Phaser.GameObjects.Rectangle>, speedMult: number,
): void {
  if (targets.length === 0) return;
  scene.tweens.add({ targets, alpha: 0.4, duration: 220 / speedMult, ease: 'Quad.easeOut' });
}

export function popStatusChip(scene: Phaser.Scene, chip: Phaser.GameObjects.Text, speedMult: number): void {
  chip.setScale(0.4);
  scene.tweens.add({ targets: chip, scale: 1, duration: 140 / speedMult, ease: 'Back.easeOut' });
}

export function slidePhaseBanner(
  scene: Phaser.Scene, x: number, y: number, w: number, h: number, text: string, speedMult: number,
): void {
  const band = scene.add.rectangle(x - w, y, w, h, 0xe8b446, 0.92).setOrigin(0, 0).setDepth(35).setStrokeStyle(1, 0x1a1208, 0.6);
  const label = scene.add.text(x - w + w / 2, y + h / 2, text, {
    fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${Math.round(h * 0.42)}px`, color: '#1a1208',
  }).setOrigin(0.5).setDepth(36);
  const targets = [band, label];
  scene.tweens.add({
    targets, x: `+=${w}`, duration: 260 / speedMult, ease: 'Quad.easeOut',
    onComplete: () => {
      scene.tweens.add({
        targets, alpha: 0, duration: 320 / speedMult, delay: 260 / speedMult, ease: 'Quad.easeIn',
        onComplete: () => { band.destroy(); label.destroy(); },
      });
    },
  });
}
