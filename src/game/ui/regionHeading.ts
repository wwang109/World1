import type Phaser from 'phaser';
import { textRoleFor } from '../theme';
import { auditTextBlock } from './controlLayoutAudit';

export function renderRegionHeading(scene: Phaser.Scene, x: number, y: number, value: string, width: number,
  opts: { compact: boolean; collapsed?: boolean }): Phaser.GameObjects.Text {
  const title = scene.add.text(x, y, value, {
    ...textRoleFor(opts.compact ? 'mobile' : 'desktop', opts.collapsed ? 'section' : 'title'),
    fontFamily: 'Palatino Linotype, Book Antiqua, Palatino, Georgia, serif',
    fontStyle: 'bold italic', color: '#f5d18a', letterSpacing: opts.compact ? 0.3 : 0.8,
    wordWrap: { width }, maxLines: opts.collapsed ? 2 : 1,
  }).setStroke('#102a38', 2)
    .setShadow(opts.compact ? 1 : 2, opts.compact ? 2 : 3, 'rgba(0, 0, 0, 0.9)', opts.compact ? 4 : 6, true, true)
    .setData('regionHeading', true);
  auditTextBlock(title, { name: 'Region artwork heading', maxWidth: width,
    maxHeight: opts.collapsed ? 48 : opts.compact ? 20 : 42, minFontSize: 9 });
  const underline = scene.add.graphics().setName('region-heading-underline');
  const length = Math.min(width, title.width);
  const lineY = y + title.height + (opts.compact ? 4 : 7);
  underline.fillGradientStyle(0xf1cd7c, 0xb78332, 0xf1cd7c, 0xb78332, 0.95, 0.45, 0.95, 0.45);
  underline.fillRect(x, lineY, length, opts.compact ? 1 : 2);
  title.once('destroy', () => underline.destroy());
  return title;
}
