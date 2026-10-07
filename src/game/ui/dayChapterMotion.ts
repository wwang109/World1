import type Phaser from 'phaser';
import type { DayChapterPoint } from './runRouteLayout';

interface ChapterMotionState { stamp: string; index: number; count: number }
const previousProgress = new Map<number, ChapterMotionState>();

export function chapterMotionTransition(seed: number, stamp: string, index: number, count: number): { from: number; animate: boolean } {
  const previous = previousProgress.get(seed);
  previousProgress.set(seed, { stamp, index, count });
  if (previousProgress.size > 16) previousProgress.delete(previousProgress.keys().next().value!);
  return { from: previous?.index ?? index, animate: previous !== undefined && count >= previous.count
    && stamp !== previous.stamp && index > previous.index };
}

export function chapterMotionAllowed(): boolean {
  return typeof window === 'undefined' || !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

export function chapterPointAt(points: readonly DayChapterPoint[], index: number): DayChapterPoint {
  const position = Math.max(0, Math.min(points.length - 1, index));
  const first = points[Math.floor(position)]!, second = points[Math.ceil(position)]!;
  return { x: first.x + (second.x - first.x) * (position % 1), y: first.y + (second.y - first.y) * (position % 1) };
}

export function animateDayChapter(scene: Phaser.Scene, opts: {
  points: readonly DayChapterPoint[]; from: number; to: number; animate: boolean;
  marker: Phaser.GameObjects.Container; halo: Phaser.GameObjects.Arc; draw: (index: number) => void;
}): void {
  const allowed = chapterMotionAllowed();
  const final = chapterPointAt(opts.points, opts.to);
  const settle = (): void => {
    opts.marker.setPosition(final.x, final.y).setData('phase', 'settled');
    opts.draw(opts.to);
    if (allowed) scene.tweens.add({ targets: opts.halo, alpha: { from: 0.3, to: 0.7 }, scale: { from: 0.96, to: 1.04 }, duration: 1400, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
  };
  if (!allowed || !opts.animate) { settle(); return; }
  const start = chapterPointAt(opts.points, opts.from);
  opts.marker.setPosition(start.x, start.y).setData('phase', 'select');
  opts.draw(opts.from);
  scene.tweens.add({ targets: opts.halo, alpha: { from: 0.25, to: 0.95 }, duration: 180, ease: 'Sine.easeOut', onComplete: () => {
    opts.marker.setData('phase', 'connector');
    const fill = { index: opts.from };
    scene.tweens.add({ targets: fill, index: opts.to, duration: 260, ease: 'Sine.easeOut', onUpdate: () => opts.draw(fill.index), onComplete: () => {
      opts.marker.setData('phase', 'marker');
      const travel = { index: opts.from };
      scene.tweens.add({ targets: travel, index: opts.to, duration: 300, ease: 'Sine.easeInOut', onUpdate: () => {
        const point = chapterPointAt(opts.points, travel.index); opts.marker.setPosition(point.x, point.y);
      }, onComplete: () => {
        opts.marker.setData('phase', 'arrival');
        scene.tweens.add({ targets: opts.halo, alpha: { from: 0.95, to: 0.3 }, scale: { from: 0.9, to: 1.16 }, duration: 220, ease: 'Sine.easeOut', onComplete: settle });
      } });
    } });
  } });
}
