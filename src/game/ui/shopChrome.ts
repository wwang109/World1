import type Phaser from 'phaser';
import { renderPaintedChrome } from './paintedChrome';
import { SHOP_BORDER_ART_CORNER, type ShopBorderArtId } from './shopBorderArt';
import { resolveShopChromeTheme, type ShopChromeTheme } from './shopChromeTheme';
import { FONT, UI } from '../theme';
import { roundRect } from './roundedRect';
import { attachButtonFeel } from './motion';
import { auditControlLabel } from './controlLayoutAudit';

const sceneThemes = new WeakMap<Phaser.Scene, ShopChromeTheme>();

export function setShopChromeTheme(scene: Phaser.Scene, shopId?: string | null): void {
  sceneThemes.set(scene, resolveShopChromeTheme(shopId));
}

function artIdFor(theme: ShopChromeTheme): ShopBorderArtId {
  return theme.id === 'forged' ? 'sword' : theme.id === 'wild' ? 'bow' : theme.id === 'arcane' ? 'lightning' : theme.id;
}

function cornerSize(width: number, height: number, button: boolean, compact: boolean): number {
  return Math.min(button || compact || height <= 64 ? 12 : 24, width / 3, height / 2 - 1);
}

export function shopChromeContentBox(box: { x: number; y: number; width: number; height: number }, compact = false) {
  const inset = Math.ceil(cornerSize(box.width, box.height, false, compact) * 64 / SHOP_BORDER_ART_CORNER) + 2;
  return { x: box.x + inset, y: box.y + inset, width: Math.max(1, box.width - inset * 2), height: Math.max(1, box.height - inset * 2) };
}

export function containShopItemInput(root: Phaser.GameObjects.GameObject, box: { x: number; y: number; width: number; height: number }): void {
  const object = root as Phaser.GameObjects.Image;
  const input = object.input;
  if (input) {
    const contains = input.hitAreaCallback;
    input.hitAreaCallback = (area, x, y, target) => {
      if (!contains(area, x, y, target)) return false;
      const point = object.getWorldTransformMatrix().transformPoint(x - object.displayOriginX, y - object.displayOriginY);
      return point.x >= box.x && point.x <= box.x + box.width && point.y >= box.y && point.y <= box.y + box.height;
    };
    object.setData('shopContentInputBounds', box);
  }
  for (const child of (root as Phaser.GameObjects.Container).list ?? []) containShopItemInput(child, box);
}

function renderIllustratedBorder(scene: Phaser.Scene, x: number, y: number, width: number, height: number, theme: ShopChromeTheme, button: boolean, compact: boolean): Phaser.GameObjects.Container | undefined {
  const key = 'shop-border-jointed-v3';
  if (!scene.textures.exists(key)) return undefined;
  const texture = scene.textures.get(key);
  const source = texture.getSourceImage() as HTMLImageElement;
  const cx = SHOP_BORDER_ART_CORNER, cy = cx;
  const w = source.width, h = source.height;
  if (!texture.has('shop-tl')) {
    const add = (name: string, px: number, py: number, pw: number, ph: number): void => { texture.add(`shop-${name}`, 0, px, py, pw, ph); };
    add('tl', 0, 0, cx, cy); add('tr', w - cx, 0, cx, cy);
    add('bl', 0, h - cy, cx, cy); add('br', w - cx, h - cy, cx, cy);
    add('top', cx, 0, w - cx * 2, cy); add('bottom', cx, h - cy, w - cx * 2, cy);
    add('left', 0, cy, cx, h - cy * 2); add('right', w - cx, cy, cx, h - cy * 2);
  }
  const cornerW = cornerSize(width, height, button, compact);
  const cornerH = cornerW * cy / cx;
  const frame = scene.add.container(x, y);
  const part = (name: string, px: number, py: number, pw: number, ph: number): void => {
    frame.add(scene.add.image(px, py, key, `shop-${name}`).setOrigin(0).setDisplaySize(pw, ph).setTint(theme.tint));
  };
  part('top', cornerW, 0, width - cornerW * 2, cornerH);
  part('bottom', cornerW, height - cornerH, width - cornerW * 2, cornerH);
  part('left', 0, cornerH, cornerW, height - cornerH * 2);
  part('right', width - cornerW, cornerH, cornerW, height - cornerH * 2);
  part('tl', 0, 0, cornerW, cornerH); part('tr', width - cornerW, 0, cornerW, cornerH);
  part('bl', 0, height - cornerH, cornerW, cornerH); part('br', width - cornerW, height - cornerH, cornerW, cornerH);
  const inset = cornerW * 53 / cx;
  const trim = scene.add.graphics().lineStyle(button ? 0.5 : 0.75, theme.rim, 0.65);
  const cut = cornerW * 9 / cx;
  trim.beginPath().moveTo(inset + cut, inset).lineTo(width - inset - cut, inset)
    .lineTo(width - inset, inset + cut).lineTo(width - inset, height - inset - cut)
    .lineTo(width - inset - cut, height - inset).lineTo(inset + cut, height - inset)
    .lineTo(inset, height - inset - cut).lineTo(inset, inset + cut).closePath().strokePath();
  frame.add(trim);
  return frame.setData('shopBorderArt', artIdFor(theme));
}

export function renderShopChrome(
  scene: Phaser.Scene, x: number, y: number, width: number, height: number,
  button = false, shopId?: string, compact = false,
): Phaser.GameObjects.Container | undefined {
  const theme = shopId ? resolveShopChromeTheme(shopId) : sceneThemes.get(scene) ?? resolveShopChromeTheme();
  const frame = renderIllustratedBorder(scene, x, y, width, height, theme, button, compact) ?? renderPaintedChrome(scene, x, y, width, height, {
    borderOnly: true, corner: Math.min(button ? 7 : 9, width / 4, height / 4), shadow: false,
  });
  return frame?.setName(button ? 'shop-button-chrome' : 'shop-panel-chrome').setData('shopChromeTheme', theme.id)
    .setData('shopChromeContentBox', shopChromeContentBox({ x, y, width, height }, compact || button));
}

export function renderShopHeaderAction(scene: Phaser.Scene, box: { x: number; y: number; width: number; height: number },
  options: { label: string; enabled: boolean; fill: number; fontSize: number; onPress?: () => void; growLeft?: boolean }) {
  const caption = scene.add.text(0, 0, options.label, {
    fontFamily: FONT.body, fontSize: `${options.fontSize}px`, fontStyle: 'bold', color: options.enabled ? UI.textOnChip : UI.textDisabled,
  }).setOrigin(0.5);
  const width = options.growLeft ? Math.max(box.width, Math.ceil(caption.width) + 24) : box.width;
  const x = box.x + box.width - width;
  const fill = options.enabled ? options.fill : UI.panelMuted;
  const plate = roundRect(scene.add.rectangle(x, box.y, width, box.height, fill, options.enabled ? 1 : 0.55), 6)
    .setOrigin(0).setStrokeStyle(1, UI.border, options.enabled ? 1 : 0.45).setName('shop-header-action');
  const frame = renderShopButtonChrome(scene, plate);
  scene.children.moveAbove(caption, frame ?? plate);
  caption.setPosition(x + width / 2, box.y + box.height / 2).setName('shop-header-action-caption');
  auditControlLabel(plate, caption, { name: `Shop ${options.label}`, horizontalPadding: 12, verticalPadding: 8, minFontSize: 9 });
  if (options.enabled && options.onPress) {
    plate.setInteractive({ useHandCursor: true });
    attachButtonFeel(scene, plate, { fill, hover: fill, follow: [caption], onPress: options.onPress });
  }
  return { plate, caption, x, width };
}

export function renderShopButtonChrome(scene: Phaser.Scene, button: Phaser.GameObjects.Rectangle): Phaser.GameObjects.Container | undefined {
  const frame = renderShopChrome(scene, 0, 0, button.width, button.height, true);
  if (!frame) return undefined;
  scene.children.moveAbove(frame, button);
  const sync = (): void => {
    frame.setPosition(button.x - button.width * button.originX * button.scaleX, button.y - button.height * button.originY * button.scaleY)
      .setScale(button.scaleX, button.scaleY).setAlpha(button.alpha).setVisible(button.visible).setDepth(button.depth);
  };
  sync();
  scene.events.on('postupdate', sync);
  button.once('destroy', () => { scene.events.off('postupdate', sync); frame.destroy(); });
  return frame;
}
