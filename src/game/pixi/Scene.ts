import { Application, Container, Rectangle } from 'pixi.js';
import { TweenManager } from './fx';

/** Fixed design space all scenes lay out in; the manager scales it to fit. */
export const DESIGN_W = 1280;
export const DESIGN_H = 720;

/**
 * A screenful of UI. Unlike Phaser scenes these are throwaway instances —
 * SceneManager builds a fresh one on every start/restart, so per-battle UI
 * state resets naturally; anything that must survive a restart lives in
 * module scope (see battleSpeed) or demoState.
 */
export abstract class Scene extends Container {
  readonly tweens = new TweenManager();
  private timers = new Set<ReturnType<typeof setTimeout>>();

  constructor(protected readonly mgr: SceneManager) {
    super();
    this.sortableChildren = true;
    // The scene itself is the pointer catch-all (drag moves/releases land
    // here even when the pointer leaves the object that started the drag).
    this.eventMode = 'static';
    this.hitArea = new Rectangle(0, 0, DESIGN_W, DESIGN_H);
  }

  abstract create(): void;

  delay(ms: number, cb: () => void): void {
    const id = setTimeout(() => {
      this.timers.delete(id);
      cb();
    }, ms);
    this.timers.add(id);
  }

  shutdown(): void {
    for (const id of this.timers) clearTimeout(id);
    this.timers.clear();
    this.tweens.destroy();
    this.destroy({ children: true });
  }
}

type SceneFactory = (mgr: SceneManager) => Scene;

/**
 * Swaps scenes and keeps the 1280×720 design space fitted to the real
 * canvas. The renderer itself runs at full window × devicePixelRatio, so
 * shrinking to a small screen shrinks the *layout*, never the pixel density
 * — this is what keeps text crisp where Phaser's Scale.FIT (CSS-stretching
 * a fixed 1280×720 backing store) went blurry.
 */
export class SceneManager {
  readonly root = new Container();
  private factories = new Map<string, SceneFactory>();
  private current: Scene | null = null;
  private currentName = '';

  constructor(private readonly app: Application) {
    app.stage.addChild(this.root);
    app.renderer.on('resize', () => this.layout());
    this.layout();
  }

  register(name: string, factory: SceneFactory): void {
    this.factories.set(name, factory);
  }

  start(name: string): void {
    const factory = this.factories.get(name);
    if (!factory) throw new Error(`unknown scene: ${name}`);
    this.current?.shutdown();
    this.currentName = name;
    const scene = factory(this);
    this.current = scene;
    this.root.addChild(scene);
    scene.create();
  }

  restart(): void {
    this.start(this.currentName);
  }

  private layout(): void {
    const s = Math.min(this.app.screen.width / DESIGN_W, this.app.screen.height / DESIGN_H);
    this.root.scale.set(s);
    this.root.position.set(
      (this.app.screen.width - DESIGN_W * s) / 2,
      (this.app.screen.height - DESIGN_H * s) / 2,
    );
  }
}
