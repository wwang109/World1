import Phaser from 'phaser';
import { wasPointerConsumedByRebuild } from '../sceneRebuild';

interface ChapterView { band: number; stamp: string; index: number; count: number; offset: number }
const views = new Map<number, ChapterView>();

export function renderDayChapterViewport(scene: Phaser.Scene, bounds: { x: number; y: number; w: number; h: number },
  body: Phaser.GameObjects.Container, opts: { seed: number; band: number; stamp: string; index: number;
    count: number; contentWidth: number; markerX: number; enabled: boolean },
): void {
  const width = bounds.w - 2;
  const maxScroll = Math.max(0, opts.contentWidth - width);
  const previous = views.get(opts.seed);
  const sameRunRegion = previous?.band === opts.band && opts.count >= previous.count;
  let offset = sameRunRegion ? previous.offset : opts.markerX - (bounds.x + width / 2);
  const advancing = sameRunRegion && opts.stamp !== previous.stamp && opts.index > previous.index;
  if (advancing && (opts.markerX - offset < bounds.x + 24 || opts.markerX - offset > bounds.x + width - 24)) {
    offset = opts.markerX - (bounds.x + width / 2);
  }
  const state: ChapterView = { band: opts.band, stamp: opts.stamp, index: opts.index, count: opts.count, offset: 0 };
  views.set(opts.seed, state);
  if (views.size > 16) views.delete(views.keys().next().value!);
  const shape = scene.make.graphics({}, false).fillStyle(0xffffff).fillRect(bounds.x + 1, bounds.y + 33, width, bounds.h - 50);
  const mask = shape.createGeometryMask();
  body.setMask(mask).setName('dayChapterViewport').once('destroy', () => { mask.destroy(); shape.destroy(); });
  const trackX = bounds.x + 12, trackY = bounds.y + bounds.h - 10, trackWidth = bounds.w - 24;
  const thumbWidth = Math.max(36, trackWidth * width / opts.contentWidth);
  const travel = Math.max(1, trackWidth - thumbWidth);
  const track = scene.add.rectangle(trackX, trackY, trackWidth, 12, 0x102c40, 0.2).setOrigin(0, 0.5).setName('dayChapterScrollTrack');
  scene.add.rectangle(trackX, trackY, trackWidth, 2, 0x779391, 0.65).setOrigin(0, 0.5);
  const thumb = scene.add.rectangle(trackX, trackY, thumbWidth, 4, 0xeac56b, 0.9).setOrigin(0, 0.5).setName('dayChapterScrollThumb');
  if (opts.enabled && maxScroll > 0) track.setInteractive({ useHandCursor: true });
  const apply = (next: number): void => {
    state.offset = Phaser.Math.Clamp(next, 0, maxScroll);
    body.setX(-state.offset).setData('offset', state.offset).setData('maxScroll', maxScroll).setData('contentWidth', opts.contentWidth);
    thumb.setX(trackX + state.offset / Math.max(1, maxScroll) * travel);
  };
  apply(offset);
  let pan: { x: number; y: number; offset: number } | undefined;
  let slider: { x: number; offset: number } | undefined;
  track.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
    if (!opts.enabled || wasPointerConsumedByRebuild(scene, pointer)) return;
    const onThumb = pointer.worldX >= thumb.x && pointer.worldX <= thumb.x + thumbWidth;
    if (!onThumb) apply((pointer.worldX - trackX - thumbWidth / 2) / travel * maxScroll);
    slider = { x: pointer.worldX, offset: state.offset };
  });
  scene.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
    if (!opts.enabled || wasPointerConsumedByRebuild(scene, pointer)) return;
    if (pointer.worldX >= bounds.x && pointer.worldX <= bounds.x + bounds.w
      && pointer.worldY >= bounds.y + 33 && pointer.worldY <= bounds.y + bounds.h - 17) {
      pan = { x: pointer.worldX, y: pointer.worldY, offset: state.offset };
    }
  });
  scene.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
    if (slider) apply(slider.offset + (pointer.worldX - slider.x) / travel * maxScroll);
    else if (pan && Math.abs(pointer.worldX - pan.x) > 8 && Math.abs(pointer.worldX - pan.x) > Math.abs(pointer.worldY - pan.y)) {
      apply(pan.offset + pan.x - pointer.worldX);
    }
  });
  const release = (): void => { pan = undefined; slider = undefined; };
  scene.input.on('pointerup', release);
  scene.input.on('pointerupoutside', release);
  scene.input.on('wheel', (pointer: Phaser.Input.Pointer, _objects: unknown, dx: number) => {
    if (opts.enabled && pointer.worldX >= bounds.x && pointer.worldX <= bounds.x + bounds.w
      && pointer.worldY >= bounds.y + 33 && pointer.worldY <= bounds.y + bounds.h && dx !== 0) apply(state.offset + dx);
  });
}
