import Phaser from 'phaser';

const DRIFT_PX_PER_SEC = 8;
const MIN_HALF_CYCLE_MS = 8000;

function phaseOf(key: string): number {
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) hash = (hash * 31 + key.charCodeAt(i)) | 0;
  return ((hash >>> 0) / 0x100000000) * Math.PI * 2;
}

export function driftCardArt(image: Phaser.GameObjects.Image, centerY: number, amplitude: number, key: string): void {
  if (amplitude < 1) return;
  const scene = image.scene;
  const period = 2 * Math.max(MIN_HALF_CYCLE_MS, (amplitude * 2 * 1000) / DRIFT_PX_PER_SEC);
  const phase = phaseOf(key);
  const step = (time: number): void => {
    image.y = centerY + amplitude * Math.sin((time / period) * Math.PI * 2 + phase);
  };
  step(scene.game.loop.time);
  scene.events.on(Phaser.Scenes.Events.UPDATE, step);
  image.once(Phaser.GameObjects.Events.DESTROY, () => scene.events.off(Phaser.Scenes.Events.UPDATE, step));
}

