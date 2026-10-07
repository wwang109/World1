import Phaser from 'phaser';
import { textRole, UI } from '../theme';
import { wasPointerConsumedByRebuild } from '../sceneRebuild';
import { addRunArt } from './runArt';
import { runHistoryRows } from './runHistoryViewModel';
import type { RunState } from '../../run/runState';

export function renderRunHistoryPanel(
  scene: Phaser.Scene,
  bounds: { x: number; y: number; width: number; height: number },
  run: Readonly<RunState>,
  opts: { compact: boolean; scroll: number; enabled?: boolean; onScroll: (scroll: number) => void },
): void {
  const { x, y, width, height } = bounds;
  scene.add.rectangle(x, y, width, height, UI.panel, 0.98).setOrigin(0, 0).setStrokeStyle(1, UI.border, 0.7);
  scene.add.text(x + 12, y + 8, 'RUN LOG', textRole('kicker'));
  const viewport = { x: x + 8, y: y + 32, width: width - 22, height: height - 40 };
  const rows = runHistoryRows(run);
  if (rows.length === 0) {
    scene.add.text(viewport.x + 4, viewport.y + 6, 'NO STOPS YET', textRole('micro', { ink: 'faint' }));
    return;
  }
  const content = scene.add.container(0, 0).setName('runHistoryContent');
  const maskShape = scene.make.graphics({}, false).fillStyle(0xffffff)
    .fillRect(viewport.x, viewport.y, viewport.width, viewport.height);
  const mask = maskShape.createGeometryMask();
  content.setMask(mask);
  content.once('destroy', () => { mask.destroy(); maskShape.destroy(); });
  let cursorY = viewport.y;
  let previousRegion = '';
  const fontSize = opts.compact ? 11 : 13;
  for (const row of rows) {
    if (row.region !== previousRegion) {
      const region = scene.add.text(viewport.x + 4, cursorY, row.region.toUpperCase(), textRole('micro', { ink: 'accent' }));
      content.add(region);
      cursorY += region.height + 6;
      previousRegion = row.region;
    }
    const iconSize = opts.compact ? 28 : 36;
    const icon = addRunArt(scene, row.artKey, { x: viewport.x + 4, y: cursorY + 2, width: iconSize, height: iconSize });
    if (icon) content.add(icon);
    const textX = viewport.x + iconSize + 12;
    const textWidth = viewport.width - iconSize - 18;
    const line = (copy: string, ink: 'primary' | 'secondary' | 'gain' | 'cost'): void => {
      const label = scene.add.text(textX, cursorY, copy, {
        ...textRole('micro', { ink }), fontSize, wordWrap: { width: textWidth }, lineSpacing: 2,
      });
      content.add(label);
      cursorY += label.height + 3;
    };
    const rowTop = cursorY;
    line(`DAY ${row.wave} · ${row.title}${row.result ? ` · ${row.result.toUpperCase()}` : ''}`, row.result === 'loss' ? 'cost' : 'primary');
    if (row.choice) line(row.choice, 'secondary');
    if (row.receipt) line(row.receipt, 'secondary');
    cursorY = Math.max(cursorY, rowTop + iconSize + 4) + 8;
    content.add(scene.add.rectangle(viewport.x + 4, cursorY - 4, viewport.width - 8, 1, UI.border, 0.35).setOrigin(0, 0));
  }
  const maxScroll = Math.max(0, cursorY - viewport.y - viewport.height);
  const thumbHeight = Math.max(18, viewport.height * viewport.height / Math.max(viewport.height, cursorY - viewport.y));
  const thumb = scene.add.rectangle(x + width - 7, viewport.y, 3, thumbHeight, UI.chip, 0.9).setOrigin(0.5, 0);
  scene.add.rectangle(x + width - 7, viewport.y, 2, viewport.height, UI.border, 0.28).setOrigin(0.5, 0);
  let scroll = 0;
  const apply = (next: number): void => {
    scroll = Phaser.Math.Clamp(next, 0, maxScroll);
    content.setY(-scroll).setData('scroll', scroll).setData('maxScroll', maxScroll);
    thumb.setY(viewport.y + (maxScroll === 0 ? 0 : scroll / maxScroll * (viewport.height - thumbHeight)));
    opts.onScroll(scroll);
  };
  apply(opts.scroll);
  let dragging = false;
  let startY = 0;
  let startScroll = 0;
  const inside = (pointer: Phaser.Input.Pointer): boolean => pointer.worldX >= viewport.x && pointer.worldX <= viewport.x + viewport.width
    && pointer.worldY >= viewport.y && pointer.worldY <= viewport.y + viewport.height;
  scene.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
    if (opts.enabled === false || wasPointerConsumedByRebuild(scene, pointer) || !inside(pointer)) return;
    dragging = true;
    startY = pointer.worldY;
    startScroll = scroll;
  });
  scene.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
    if (dragging) apply(startScroll + startY - pointer.worldY);
  });
  scene.input.on('pointerup', () => { dragging = false; });
  scene.input.on('pointerupoutside', () => { dragging = false; });
  scene.input.on('wheel', (pointer: Phaser.Input.Pointer, _objects: unknown, _dx: number, dy: number) => {
    if (opts.enabled !== false && inside(pointer)) apply(scroll + dy);
  });
}
