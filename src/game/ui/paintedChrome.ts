import type Phaser from 'phaser';

export const PAINTED_CHROME_ASSET = { key: 'painted-fantasy-frame', path: '/game-art/ui/painted-fantasy-frame.webp' };
export const PAINTED_CHROME_BORDER_ASSET = { key: 'painted-fantasy-border-transparent', path: '/game-art/ui/painted-fantasy-border-transparent.webp' };

function prepareFrames(scene: Phaser.Scene): boolean {
  if (!scene.textures.exists(PAINTED_CHROME_ASSET.key) || !scene.textures.exists(PAINTED_CHROME_BORDER_ASSET.key)) return false;
  const texture = scene.textures.get(PAINTED_CHROME_BORDER_ASSET.key);
  if (texture.has('chrome-tl')) return true;
  const { width: w, height: h } = texture.getSourceImage() as HTMLImageElement;
  const c = Math.round(Math.min(w, h) * 0.128);
  const e = Math.round(c * 0.46);
  const add = (name: string, x: number, y: number, width: number, height: number) => texture.add(`chrome-${name}`, 0, x, y, width, height);
  add('tl', 0, 0, c, c); add('tr', w - c, 0, c, c);
  add('bl', 0, h - c, c, c); add('br', w - c, h - c, c, c);
  add('top', c, 0, c, e); add('bottom', c, h - e, c, e);
  add('left', 0, c, e, c); add('right', w - e, c, e, c);
  const surface = scene.textures.get(PAINTED_CHROME_ASSET.key);
  if (!surface.has('chrome-center')) {
    const source = surface.getSourceImage() as HTMLImageElement;
    const inset = Math.round(Math.min(source.width, source.height) * 0.128);
    surface.add('chrome-center', 0, inset, inset, source.width - inset * 2, source.height - inset * 2);
  }
  return true;
}

export function renderPaintedChrome(
  scene: Phaser.Scene, x: number, y: number, width: number, height: number,
  options: { button?: boolean; compact?: boolean; borderOnly?: boolean; corner?: number } = {},
): Phaser.GameObjects.Container | undefined {
  if (!prepareFrames(scene)) return undefined;
  const corner = options.corner ?? (options.button ? Math.min(12, height / 3) : options.compact ? 20 : 24);
  const texture = scene.textures.get(PAINTED_CHROME_BORDER_ASSET.key);
  const edge = corner * texture.get('chrome-top').height / texture.get('chrome-tl').width;
  const group = scene.add.container(x, y).setName('painted-chrome');
  const shadow = scene.add.graphics();
  shadow.lineStyle(options.button ? 3 : 5, 0x000a10, 0.5);
  shadow.strokeRoundedRect(2, 3, width - 2, height - 2, Math.min(6, corner / 3));
  group.add(shadow);
  const part = (name: string, px: number, py: number, w: number, h: number, alpha = 1) => {
    const key = name === 'center' ? PAINTED_CHROME_ASSET.key : PAINTED_CHROME_BORDER_ASSET.key;
    const image = scene.add.image(px, py, key, `chrome-${name}`).setOrigin(0).setDisplaySize(w, h).setAlpha(alpha);
    group.add(image);
  };
  if (!options.borderOnly) part('center', edge, edge, width - edge * 2, height - edge * 2, options.button ? 0.13 : 1);
  part('top', corner, 0, width - corner * 2, edge);
  part('bottom', corner, height - edge, width - corner * 2, edge);
  part('left', 0, corner, edge, height - corner * 2);
  part('right', width - edge, corner, edge, height - corner * 2);
  part('tl', 0, 0, corner, corner); part('tr', width - corner, 0, corner, corner);
  part('bl', 0, height - corner, corner, corner); part('br', width - corner, height - corner, corner, corner);
  return group;
}
