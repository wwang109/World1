import Phaser from 'phaser';
import { FONT, SCREEN, UI } from '../theme';
import { CardToken } from './CardToken';
import type { SkillDef, SkillTier } from '../../engine/types';
import { auditControlLabel } from './controlLayoutAudit';
import { stripCardTextMarkup } from './cardTextMarkup';

interface FlowEvent { preventDefault(): void; dataTransfer?: { setData(type: string, data: string): void } }
export class FlowNode {
  children: FlowNode[] = [];
  disabled = false;
  draggable = false;
  src = '';
  alt = '';
  loading = '';
  type = '';
  value = '';
  maxLength = 0;
  placeholder = '';
  listeners = new Map<string, (event: FlowEvent) => void>();
  card?: { skill: SkillDef; tier: SkillTier; body: string; artUrl: string | null };
  classList = { add: (name: string) => { this.className += ` ${name}`; } };
  constructor(readonly tag: string, public textContent = '', public className = '') {}
  append(...children: FlowNode[]): void { this.children.push(...children); }
  addEventListener(event: string, listener: (event: FlowEvent) => void, _options?: unknown): void { this.listeners.set(event, listener); }
  setAttribute(_name: string, _value: string): void {}
  remove(): void {}
}
export const flowNode = (tag: string, text?: string, className?: string): FlowNode => new FlowNode(tag, text, className);
export interface FlowRow { nodes: FlowNode[]; height: number; width: number; gap: number }
const event: FlowEvent = { preventDefault() {}, dataTransfer: { setData() {} } };
export class EligibleFlow {
  private failedArt = new Set<string>();
  private pendingArt = new Set<string>();
  constructor(private readonly scene: Phaser.Scene, private readonly mobile: boolean, private readonly refresh: () => void) {}
  get loadingArt(): boolean { return this.pendingArt.size > 0; }
  backdrop(url: string | null): void {
    const key = url ? this.artKey(url) : null;
    if (key && this.scene.textures.exists(key)) { const image = this.scene.add.image(SCREEN.width / 2, SCREEN.height / 2, key); image.setScale(Math.max(SCREEN.width / image.width, SCREEN.height / image.height)).setAlpha(.45); }
    this.scene.add.rectangle(0, 0, SCREEN.width, SCREEN.height, UI.bg, .6).setOrigin(0);
  }
  private textHeight(value: string, width: number, size: number): number {
    const text = this.scene.add.text(0, 0, value, { fontFamily: FONT.body, fontSize: size, wordWrap: { width, useAdvancedWrap: true }, lineSpacing: 3 });
    const height = text.height; text.destroy(); return height;
  }
  rows(parent: FlowNode, width: number): FlowRow[] {
    const rows: FlowRow[] = [];
    const children = parent.children;
    for (let index = 0; index < children.length; index++) {
      const child = children[index]!;
      if (child.tag === 'button') {
        const nodes: FlowNode[] = [child];
        while (children[index + 1]?.tag === 'button' && nodes.length < (parent.tag === 'nav' ? 3 : this.mobile ? 2 : 4)) nodes.push(children[++index]!);
        rows.push({ nodes, height: 48, width, gap: 10 });
      } else if (child.className === 'cards' || child.className === 'options') {
        const columns = child.className === 'cards' ? this.mobile ? 2 : 5 : this.mobile ? 1 : 3;
        for (let start = 0; start < child.children.length; start += columns) {
          const nodes = child.children.slice(start, start + columns);
          const cardWidth = (width - 12 * (columns - 1)) / columns;
          rows.push({ nodes, height: Math.max(...nodes.map(node => this.measure(node, cardWidth))), width, gap: 12 });
        }
      } else if (child.className.includes('card') || child.className === 'route' || child.className === 'gem') rows.push({ nodes: [child], height: this.measure(child, width), width, gap: 0 });
      else if (['section', 'div', 'nav', 'ol', 'details', 'footer'].includes(child.tag)) rows.push(...this.rows(child, width));
      else rows.push({ nodes: [child], height: this.measure(child, width), width, gap: 0 });
    }
    return rows;
  }
  pages(rows: FlowRow[], height: number): FlowRow[][] {
    const pages: FlowRow[][] = []; let page: FlowRow[] = []; let used = 0;
    for (let index = 0; index < rows.length; index++) {
      const row = rows[index]!;
      const withHeading = row.nodes[0]?.tag === 'h2' ? row.height + (rows[index + 1]?.height ?? 0) : row.height;
      if ((used + row.height > height || (withHeading <= height && used + withHeading > height)) && page.length) { pages.push(page); page = []; used = 0; }
      page.push(row); used += row.height;
    }
    if (page.length || !pages.length) pages.push(page); return pages;
  }
  draw(rows: FlowRow[], x: number, y: number): void {
    for (const row of rows) {
      const width = (row.width - row.gap * (row.nodes.length - 1)) / row.nodes.length;
      row.nodes.forEach((node, index) => this.drawNode(node, x + index * (width + row.gap), y, width, row.height - 10));
      y += row.height;
    }
  }
  private measure(node: FlowNode, width: number): number {
    if (node.card) return (this.mobile ? 198 : 228) + node.children.filter(child => child.tag === 'button').length * 48 + 12;
    if (node.tag === 'button') return node.className.includes('empty') ? 110 : 48;
    if (node.tag === 'img') return node.className === 'event-art' ? this.mobile ? 150 : 210 : 76;
    if (node.className === 'route' || node.className === 'gem') return this.rows(node, width - 28).reduce((sum, row) => sum + row.height, 28);
    const size = node.tag === 'h2' ? this.mobile ? 17 : 23 : node.tag === 'h3' ? 16 : this.mobile ? 13 : 15;
    return this.textHeight(node.textContent, width - 8, size) + (node.tag.startsWith('h') ? 14 : 10);
  }
  private artKey(url: string): string {
    const key = `eligible-art:${url}`;
    if (!this.scene.textures.exists(key) && !this.failedArt.has(key) && !this.pendingArt.has(key)) {
      this.pendingArt.add(key);
      this.scene.load.image(key, url);
      const failed = (file: Phaser.Loader.File): void => {
        if (file.key !== key) return;
        this.scene.load.off(Phaser.Loader.Events.FILE_LOAD_ERROR, failed); this.pendingArt.delete(key); this.failedArt.add(key);
        if (this.scene.sys.isActive()) this.refresh();
      };
      this.scene.load.on(Phaser.Loader.Events.FILE_LOAD_ERROR, failed);
      this.scene.load.once(`filecomplete-image-${key}`, () => { this.scene.load.off(Phaser.Loader.Events.FILE_LOAD_ERROR, failed); this.pendingArt.delete(key); if (this.scene.sys.isActive()) this.refresh(); });
      if (!this.scene.load.isLoading()) this.scene.load.start();
    }
    return key;
  }
  private drawNode(node: FlowNode, x: number, y: number, width: number, height: number): void {
    if (node.card) {
      const card = node.card; const tokenHeight = this.mobile ? 198 : 228;
      const token = new CardToken(this.scene, x + width / 2, y + tokenHeight / 2, card.skill, { width, height: tokenHeight, tier: card.tier,
        pinnedPresentation: { body: card.body, ...(card.artUrl ? { artKey: this.artKey(card.artUrl) } : {}) } });
      this.scene.add.existing(token);
      if (node.className.includes('picked')) this.scene.add.rectangle(x, y, width, tokenHeight, 0, 0).setOrigin(0).setStrokeStyle(3, UI.chip);
      this.drag(node, x, y, width, tokenHeight);
      let buttonY = y + tokenHeight + 4; for (const button of node.children.filter(child => child.tag === 'button')) { this.drawNode(button, x, buttonY, width, 42); buttonY += 48; } return;
    }
    if (node.tag === 'button') {
      const plate = this.scene.add.rectangle(x, y, width, height, node.disabled ? UI.panelMuted : node.className.includes('selected') ? UI.chip : UI.panelAlt).setOrigin(0).setStrokeStyle(1, UI.border).setData('eligibleControl', node.textContent);
      const label = this.scene.add.text(x + width / 2, y + height / 2, node.textContent, { fontFamily: FONT.body, fontSize: this.mobile ? 11 : 13, fontStyle: 'bold', color: node.disabled ? UI.textMuted : node.className.includes('selected') ? UI.textOnChip : UI.textAccent }).setOrigin(.5);
      auditControlLabel(plate, label, { name: `eligible:${node.textContent}`, minFontSize: 9 });
      if (!node.disabled && !node.listeners.has('drop')) plate.setInteractive({ useHandCursor: true }).on('pointerup', () => node.listeners.get('click')?.(event));
      this.drag(node, x, y, width, height); return;
    }
    if (node.tag === 'img') {
      if (!node.src) return; const key = this.artKey(node.src);
      if (this.scene.textures.exists(key)) { const image = this.scene.add.image(x + width / 2, y + height / 2, key); const scale = Math.min(width / image.width, height / image.height); image.setScale(scale); } return;
    }
    if (node.className === 'route' || node.className === 'gem') {
      this.scene.add.rectangle(x, y, width, height, UI.panelAlt, .94).setOrigin(0).setStrokeStyle(1, UI.border);
      this.draw(this.rows(node, width - 28), x + 14, y + 14); return;
    }
    const size = node.tag === 'h2' ? this.mobile ? 17 : 23 : node.tag === 'h3' ? 16 : this.mobile ? 13 : 15;
    this.scene.add.text(x + 2, y + 2, stripCardTextMarkup(node.textContent), { fontFamily: FONT.body, fontSize: size, color: node.tag.startsWith('h') || node.className === 'earned' ? UI.textAccent : node.className === 'muted' ? UI.textMuted : UI.text, fontStyle: node.tag.startsWith('h') ? 'bold' : 'normal', wordWrap: { width: width - 8, useAdvancedWrap: true }, lineSpacing: 3 });
  }
  private drag(node: FlowNode, x: number, y: number, width: number, height: number): void {
    if (node.disabled) return;
    if (node.draggable) {
      const hit = this.scene.add.rectangle(x + width / 2, y + height / 2, width, height, 0, 0).setInteractive({ draggable: true });
      this.scene.input.setDraggable(hit); hit.on('dragstart', () => node.listeners.get('dragstart')?.(event));
      hit.on('drop', (_pointer: Phaser.Input.Pointer, target: Phaser.GameObjects.Zone) => (target.getData('eligibleDrop') as FlowNode | undefined)?.listeners.get('drop')?.(event));
    }
    if (node.listeners.has('drop')) {
      const zone = this.scene.add.zone(x + width / 2, y + height / 2, width, height).setRectangleDropZone(width, height).setData('eligibleDrop', node);
      if (node.tag === 'button') zone.setData('eligibleControl', node.textContent).on('pointerup', () => node.listeners.get('click')?.(event));
    }
  }
}
