import { Ticker } from 'pixi.js';

/** Anything a tween can drive: numeric props plus the special 'scale' key. */
interface Tweenable {
  scale: { x: number; set(v: number): void };
  [key: string]: unknown;
}

interface TweenSpec {
  target: unknown;
  to: Record<string, number>;
  duration: number;
  delay?: number;
  yoyo?: boolean;
  onComplete?: () => void;
}

interface ActiveTween extends TweenSpec {
  elapsed: number;
  from: Record<string, number> | null;
}

function readProp(target: Tweenable, key: string): number {
  return key === 'scale' ? target.scale.x : (target[key] as number);
}

function writeProp(target: Tweenable, key: string, value: number): void {
  if (key === 'scale') target.scale.set(value);
  else target[key] = value;
}

/**
 * Minimal linear tween runner on the shared ticker — covers the pulse /
 * float-up / fade-out effects the battle playback needs. `yoyo` plays the
 * tween forward then back (duration each way), like Phaser's yoyo.
 */
export class TweenManager {
  private active: ActiveTween[] = [];

  private readonly tick = (ticker: Ticker): void => {
    const dt = ticker.deltaMS;
    for (let i = this.active.length - 1; i >= 0; i--) {
      const tw = this.active[i]!;
      tw.elapsed += dt;
      const local = tw.elapsed - (tw.delay ?? 0);
      if (local < 0) continue;
      const target = tw.target as Tweenable;
      if (tw.from === null) {
        tw.from = {};
        for (const key of Object.keys(tw.to)) tw.from[key] = readProp(target, key);
      }
      const total = tw.yoyo ? tw.duration * 2 : tw.duration;
      const p = Math.min(1, local / total);
      // Progress 0→1→0 for yoyo, 0→1 otherwise.
      const shaped = tw.yoyo ? 1 - Math.abs(p * 2 - 1) : p;
      for (const key of Object.keys(tw.to)) {
        const from = tw.from[key]!;
        writeProp(target, key, from + (tw.to[key]! - from) * shaped);
      }
      if (p >= 1) {
        this.active.splice(i, 1);
        tw.onComplete?.();
      }
    }
  };

  constructor() {
    Ticker.shared.add(this.tick);
  }

  add(spec: TweenSpec): void {
    this.active.push({ ...spec, elapsed: 0, from: null });
  }

  destroy(): void {
    Ticker.shared.remove(this.tick);
    this.active = [];
  }
}
