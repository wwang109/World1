import Phaser from 'phaser';
import { UI, textRole } from '../theme';
import { wasPointerConsumedByRebuild } from '../sceneRebuild';

export function renderRunMapChoiceViewport(scene: Phaser.Scene,
  bounds: { x: number; y: number; width: number; height: number }, contentHeight: number,
  render: (deferSelection: (select: () => void) => () => void) => void,
  opts: { scroll: number; enabled: boolean; onScroll: (scroll: number) => void },
): void {
  let selection: { select: () => void; pointerId: number; x: number; y: number } | undefined;
  const deferSelection = (select: () => void): (() => void) => () => {
    const pointer = scene.input.activePointer;
    if (!pointer.isDown) { select(); return; }
    selection = { select, pointerId: pointer.id, x: pointer.worldX, y: pointer.worldY };
  };
  const existing = new Set(scene.children.list);
  render(deferSelection);
  const objects = scene.children.list.filter((child) => !existing.has(child));
  const content = scene.add.container(0, 0, objects).setName('runMapChoiceContent');
  const viewportHeight = contentHeight > bounds.height ? bounds.height - 22 : bounds.height;
  const shape = scene.make.graphics({}, false).fillStyle(0xffffff).fillRect(bounds.x, bounds.y, bounds.width, viewportHeight);
  const mask = shape.createGeometryMask();
  content.setMask(mask).once('destroy', () => { mask.destroy(); shape.destroy(); });
  const inputs: Phaser.GameObjects.GameObject[] = [];
  const collect = (object: Phaser.GameObjects.GameObject): void => {
    if (object.input) inputs.push(object);
    if (object instanceof Phaser.GameObjects.Container) object.list.forEach(collect);
  };
  objects.forEach(collect);
  const maxScroll = Math.max(0, contentHeight - viewportHeight);
  const thumbHeight = Math.max(28, viewportHeight * viewportHeight / Math.max(viewportHeight, contentHeight));
  const track = scene.add.rectangle(bounds.x + bounds.width - 5, bounds.y, 10, viewportHeight, UI.panelAlt, 0.7).setOrigin(0.5, 0).setInteractive();
  const thumb = scene.add.rectangle(bounds.x + bounds.width - 5, bounds.y, 3, thumbHeight, UI.chip, 0.95).setOrigin(0.5, 0);
  const scrollHint = scene.add.text(bounds.x + bounds.width / 2, bounds.y + bounds.height - 3, 'SCROLL FOR MORE', {
    ...textRole('micro'), color: '#f4dea2', backgroundColor: '#102e42', padding: { x: 8, y: 3 },
  }).setOrigin(0.5, 1);
  let scroll = 0;
  const apply = (next: number): void => {
    scroll = Phaser.Math.Clamp(next, 0, maxScroll);
    content.setY(-scroll).setData('scroll', scroll).setData('maxScroll', maxScroll);
    thumb.setY(bounds.y + (maxScroll > 0 ? scroll / maxScroll * (viewportHeight - thumbHeight) : 0));
    for (const object of inputs) {
      const target = object as Phaser.GameObjects.Rectangle;
      const rect = target.getBounds();
      if (object.input) object.input.enabled = opts.enabled && rect.y >= bounds.y - 1 && rect.bottom <= bounds.y + viewportHeight + 1;
    }
    opts.onScroll(scroll);
    scrollHint.setVisible(maxScroll > 0 && scroll < maxScroll - 1);
  };
  apply(opts.scroll);
  let dragging = false;
  let startX = 0;
  let startY = 0;
  let startScroll = 0;
  const inside = (pointer: Phaser.Input.Pointer): boolean => pointer.worldX >= bounds.x && pointer.worldX <= bounds.x + bounds.width
    && pointer.worldY >= bounds.y && pointer.worldY <= bounds.y + viewportHeight;
  scene.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
    if (!opts.enabled || wasPointerConsumedByRebuild(scene, pointer) || !inside(pointer)) return;
    dragging = true; startX = pointer.worldX; startY = pointer.worldY; startScroll = scroll;
  });
  scene.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
    if (!dragging) return;
    if (Math.hypot(pointer.worldX - startX, pointer.worldY - startY) > 8) {
      selection = undefined;
      apply(startScroll + startY - pointer.worldY);
    }
  });
  scene.input.on('pointerup', (pointer: Phaser.Input.Pointer) => {
    dragging = false;
    const pending = selection;
    selection = undefined;
    if (pending && pending.pointerId === pointer.id && opts.enabled && inside(pointer)
      && Math.hypot(pointer.worldX - pending.x, pointer.worldY - pending.y) <= 8) pending.select();
  });
  scene.input.on('pointerupoutside', () => { dragging = false; selection = undefined; });
  scene.input.on('wheel', (pointer: Phaser.Input.Pointer, _objects: unknown, _dx: number, dy: number) => { if (opts.enabled && inside(pointer)) apply(scroll + dy); });
  if (maxScroll === 0) { track.setVisible(false).disableInteractive(); thumb.setVisible(false); }
}
