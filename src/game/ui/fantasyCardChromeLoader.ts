import Phaser from 'phaser';

export const ANIME_RELIC_CHROME_KEY = 'card-template:anime-relic-chrome';
export const ANIME_RELIC_CHROME_URL = '/game-art/template/anime-relic-chrome.webp';

const pending = new WeakMap<Phaser.Game, Phaser.Scene>();
const readyEvent = 'anime-relic-chrome-ready';

export function whenFantasyCardChromeReady(scene: Phaser.Scene, onReady: (key: string) => void): () => void {
  const key = ANIME_RELIC_CHROME_KEY;
  if (scene.textures.exists(key)) {
    onReady(key);
    return () => {};
  }
  const game = scene.game;
  const deliver = () => { if (scene.textures.exists(key)) onReady(key); };
  const unsubscribe = () => {
    game.events.off(readyEvent, deliver);
    scene.events.off(Phaser.Scenes.Events.SHUTDOWN, unsubscribe);
    scene.events.off(Phaser.Scenes.Events.DESTROY, unsubscribe);
  };
  game.events.once(readyEvent, deliver);
  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, unsubscribe);
  scene.events.once(Phaser.Scenes.Events.DESTROY, unsubscribe);
  if (!pending.has(game)) {
    pending.set(game, scene);
    const cleanup = () => {
      if (pending.get(game) === scene) pending.delete(game);
      scene.load.off(`filecomplete-image-${key}`, done);
      scene.load.off(Phaser.Loader.Events.FILE_LOAD_ERROR, failed);
      scene.events.off(Phaser.Scenes.Events.SHUTDOWN, cleanup);
    };
    const done = () => { cleanup(); game.events.emit(readyEvent); };
    const failed = (file: { key: string }) => { if (file.key === key) cleanup(); };
    scene.load.once(`filecomplete-image-${key}`, done);
    scene.load.on(Phaser.Loader.Events.FILE_LOAD_ERROR, failed);
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, cleanup);
    scene.load.image(key, ANIME_RELIC_CHROME_URL);
    if (!scene.load.isLoading()) scene.load.start();
  }
  return unsubscribe;
}
