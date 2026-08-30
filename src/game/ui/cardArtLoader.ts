import Phaser from 'phaser';
import { CARD_ART_CATALOG, cardArtUrl } from './cardArtCatalog';

/**
 * Card art streaming — the ONE place a card-art texture is fetched.
 *
 * WHY. `BootScene` used to queue every catalogue entry before the first
 * screen opened: 72 files, 165 MB, ~450 MB of VRAM if every texture resolved,
 * and seconds of black canvas before a menu that shows no cards at all. Art
 * now loads on first use — a card asks for its texture when it renders, and
 * shows `cardArtPlaceholder.ts` in the meantime.
 *
 * The whole contract is `whenCardArtReady`. It is deliberately fire-and-
 * forget: a caller that never gets its callback simply keeps the placeholder,
 * which is the same thing that happens for the 94 skills with no art at all.
 * There is no error path a card face has to render differently.
 *
 * Two facts make this safe with several scenes alive at once:
 *   - `TextureManager` is GAME-wide, so a texture one scene streamed in is
 *     immediately resident for every other scene.
 *   - `inFlight` therefore keys on the TEXTURE, not the scene, and the
 *     `arrivals` bus lets a scene that did not start a fetch still learn when
 *     it lands.
 */

/** Texture key -> the scene whose loader is currently fetching it. */
const inFlight = new Map<string, Phaser.Scene>();

/** Game-wide "texture <key> is resident now" bus. */
const arrivals = new Phaser.Events.EventEmitter();

/** The catalogue's texture key for a skill, or undefined when it has no art. */
export function cardArtTextureKey(skillId: string): string | undefined {
  return CARD_ART_CATALOG[skillId]?.textureKey;
}

/** True when this skill's art is already a live texture — no fetch needed. */
export function isCardArtResident(scene: Phaser.Scene, skillId: string): boolean {
  const key = cardArtTextureKey(skillId);
  return key !== undefined && scene.textures.exists(key);
}

/**
 * Calls `onReady(textureKey)` once the skill's art is resident — SYNCHRONOUSLY
 * if it already is, so a warm card renders in one pass with no flicker.
 * Never calls back for a skill with no catalogue entry, for a failed fetch,
 * or after the requesting scene has shut down.
 */
export function whenCardArtReady(
  scene: Phaser.Scene,
  skillId: string,
  onReady: (textureKey: string) => void,
): void {
  const entry = CARD_ART_CATALOG[skillId];
  if (!entry) return;
  const key = entry.textureKey;
  if (scene.textures.exists(key)) {
    onReady(key);
    return;
  }

  // Subscribe FIRST, so the fetch below cannot land before we are listening.
  const deliver = (): void => {
    if (scene.textures.exists(key)) onReady(key);
  };
  arrivals.once(key, deliver);
  const unsubscribe = (): void => { arrivals.off(key, deliver); };
  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, unsubscribe);
  scene.events.once(Phaser.Scenes.Events.DESTROY, unsubscribe);

  if (inFlight.has(key)) return;
  startFetch(scene, key, cardArtUrl(entry));
}

/**
 * Warms a set of skills' art without rendering anything — for a scene that
 * knows up front which cards it is about to draw and would rather not show
 * placeholders at all. Optional: nothing depends on it being called.
 */
export function prefetchCardArt(scene: Phaser.Scene, skillIds: readonly string[]): void {
  for (const id of skillIds) whenCardArtReady(scene, id, () => {});
}

function startFetch(scene: Phaser.Scene, key: string, url: string): void {
  inFlight.set(key, scene);
  const done = (): void => {
    inFlight.delete(key);
    scene.load.off(`filecomplete-image-${key}`, done);
    scene.load.off(Phaser.Loader.Events.FILE_LOAD_ERROR, onError);
    arrivals.emit(key);
  };
  const onError = (file: { key: string }): void => {
    if (file.key !== key) return;
    // Leave the placeholder up and free the key so a later screen can retry.
    inFlight.delete(key);
    scene.load.off(`filecomplete-image-${key}`, done);
    scene.load.off(Phaser.Loader.Events.FILE_LOAD_ERROR, onError);
  };
  scene.load.on(`filecomplete-image-${key}`, done);
  scene.load.on(Phaser.Loader.Events.FILE_LOAD_ERROR, onError);
  // A scene that dies mid-fetch would otherwise strand the key as "in
  // flight" forever, and no later screen would ever ask for it again.
  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
    if (inFlight.get(key) === scene && !scene.textures.exists(key)) inFlight.delete(key);
  });
  scene.load.image(key, url);
  if (!scene.load.isLoading()) scene.load.start();
}
