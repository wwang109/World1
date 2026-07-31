import { Application } from 'pixi.js';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/700.css';
import { SceneManager } from './game/pixi/Scene';
import { PrepScene } from './game/scenes/PrepScene';
import { BattleScene } from './game/scenes/BattleScene';

// NOTE: this must NOT be a top-level await. Pixi's init() dynamically imports
// a chunk that (after bundling) depends on this entry chunk; a top-level await
// here would deadlock module evaluation in production builds.
async function boot(): Promise<void> {
  const app = new Application();
  await app.init({
    background: '#0e0e12',
    resizeTo: window,
    // Render at native device pixels; autoDensity keeps CSS size logical.
    // This is the crispness fix: the canvas is never CSS-stretched.
    resolution: Math.max(1, window.devicePixelRatio || 1),
    autoDensity: true,
    antialias: true,
  });
  document.getElementById('app')!.appendChild(app.canvas);

  // Rasterize text only after the web font is in, or Pixi bakes the fallback.
  await document.fonts.ready;
  await document.fonts.load('400 16px "JetBrains Mono"');
  await document.fonts.load('700 16px "JetBrains Mono"');

  const mgr = new SceneManager(app);
  mgr.register('Prep', (m) => new PrepScene(m));
  mgr.register('Battle', (m) => new BattleScene(m));
  mgr.start('Prep');
}

void boot();
