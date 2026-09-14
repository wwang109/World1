import type Phaser from 'phaser';
import type { RunNode } from '../../run/runState';
import { currentNode, leaveCurrentShop } from '../runStore';
import { SCREEN, textRole, textRoleFor, UI } from '../theme';
import type { Rect } from './runScreenTemplate';
import { attachButtonFeel } from './motion';
import { applyRenderScale, devicePixels, uiScale } from '../renderScale';
import { renderRunBossArrivalPanel, type RunBossArrivalViewModel } from './RunBossArrivalPanel';
import { renderRunTravelChoiceCard, runTravelChoiceCardLayout, runTravelChoiceCardsLayout } from './RunTravelChoiceCard';
import type { RunTravelChoiceViewModel } from './runTravelChoiceViewModel';
import { wasPointerConsumedByRebuild } from '../sceneRebuild';

const hostMasks = new WeakMap<Phaser.Scene, Phaser.GameObjects.Graphics>();

/** Content-sized solid control shared by route and embedded destination Back.
 * Center the measured label at integer coordinates, without a hover lift. */
export function renderRunHostButton(
  scene: Phaser.Scene, x: number, y: number, label: string, compact: boolean,
  onPress: () => void, alignRight = false, dense = false,
): Rect {
  const horizontal = dense ? 10 : compact ? 12 : 16;
  const vertical = dense ? 6 : compact ? 10 : 12;
  const text = scene.add.text(0, 0, label, textRoleFor(compact ? 'mobile' : 'desktop', 'label', { ink: 'onAccent' })).setOrigin(0, 0);
  const width = Math.max(40, Math.ceil(text.width) + horizontal * 2);
  const height = Math.max(dense ? 32 : 40, Math.ceil(text.height) + vertical * 2);
  const rect = { x: Math.round(x - (alignRight ? width : 0)), y: Math.round(y), width, height };
  const box = scene.add.rectangle(rect.x, rect.y, width, height, UI.chip, 1).setOrigin(0, 0)
    .setInteractive({ useHandCursor: true });
  text.setPosition(Math.round(rect.x + (width - text.width) / 2), Math.round(rect.y + (height - text.height) / 2));
  scene.children.bringToTop(text);
  attachButtonFeel(scene, box, { fill: UI.chip, hover: UI.border, follow: [text], lift: 0, onPress });
  return rect;
}

export function embeddedEventLayout(bounds: Rect, count: number, compact: boolean) {
  const inset = compact ? 8 : 12;
  const gap = compact ? 12 : 16;
  const width = Math.min(compact ? 660 : 1200, Math.max(1, bounds.width - inset * 2));
  const x = (bounds.width - width) / 2;
  const storyWidth = compact ? width : Math.min(440, width * 0.4);
  const storyHeight = compact ? Math.max(340, Math.min(420, width * 1.05)) : Math.max(360, bounds.height - inset * 2);
  const story = { x, y: inset, width: storyWidth, height: storyHeight };
  const outcomes = compact
    ? { x, y: inset + storyHeight + gap, width, height: Math.max(430, count * 100 + 64) }
    : { x: x + storyWidth + gap, y: inset, width: width - storyWidth - gap, height: storyHeight };
  const outcomeHeader = { x: outcomes.x + 12, y: outcomes.y + 14, width: outcomes.width - 24, height: 24 };
  const rowTop = outcomeHeader.y + outcomeHeader.height + 12;
  const rowGap = 10;
  const rowHeight = Math.max(1, (outcomes.y + outcomes.height - 12 - rowTop - rowGap * (count - 1)) / Math.max(1, count));
  const choiceRows = Array.from({ length: count }, (_, index) => ({
    x: outcomes.x + 12, y: rowTop + index * (rowHeight + rowGap), width: outcomes.width - 24, height: rowHeight,
  }));
  const content = { x: 0, y: 0, width: bounds.width, height: outcomes.y + outcomes.height + inset };
  return { story, outcomes, outcomeHeader, choiceRows, content };
}

/** A partial view over the existing event/shop UI, not a map scene transition. */
export interface EmbeddedRunDestination {
  bounds: Rect;
  source: Rect;
  scrollY: number;
  onClose: () => void;
  onChanged: () => void;
}

export function positionRunDestination(
  scene: Phaser.Scene, embedded: EmbeddedRunDestination | undefined, source: Rect,
): void {
  const camera = scene.cameras.main;
  if (!embedded) {
    scene.data?.remove('positionEmbeddedRunDestination');
    scene.data?.remove('embeddedRunView');
    camera.clearMask();
    camera.setViewport(0, 0, SCREEN.width, SCREEN.height).setZoom(1).setScroll(0, 0);
    applyRenderScale(scene);
    return;
  }
  scene.data.set('positionEmbeddedRunDestination', () => positionRunDestination(scene, embedded, embedded.source));
  const changed = embedded.source.width !== source.width || embedded.source.height !== source.height;
  embedded.source = source;
  const bounds = embedded.bounds;
  const zoom = Math.min(1, bounds.width / source.width);
  const pixels = uiScale() * devicePixels();
  const visibleHeight = bounds.height / zoom;
  embedded.scrollY = Math.max(0, Math.min(embedded.scrollY, source.height - visibleHeight));
  camera.setViewport(bounds.x * pixels, bounds.y * pixels, bounds.width * pixels, bounds.height * pixels).setZoom(zoom * pixels);
  camera.centerOn(source.x + source.width / 2, source.y + visibleHeight / 2 + embedded.scrollY);
  camera.setBackgroundColor(UI.panel);
  scene.data.set('embeddedRunView', { x: source.x, y: source.y + embedded.scrollY, width: source.width, height: visibleHeight });
  let mask = hostMasks.get(scene);
  if (!mask) {
    mask = scene.make.graphics({}, false);
    hostMasks.set(scene, mask);
    camera.setMask(mask.createGeometryMask(), true);
    scene.events.once('shutdown', () => { camera.clearMask(true); mask?.destroy(); hostMasks.delete(scene); });
  }
  mask.clear().fillStyle(0xffffff).fillRect(bounds.x * pixels, bounds.y * pixels, bounds.width * pixels, bounds.height * pixels);
  if (changed) scene.time.delayedCall(0, embedded.onChanged);
}

/** The route owns this view's lifetime and keeps its choices when Back closes
 * an unfinished stop. The run remains committed; other destinations stay locked. */
export class RunDestinationHost {
  private key: string | null = null;
  private embedded: EmbeddedRunDestination | undefined;
  private savedChoices: readonly RunNode[] | null = null;
  private nodeId: string | null = null;
  private choiceScroll = 0;
  private choiceKey = '';
  private readonly expandedChoices = new Set<string>();

  constructor(private readonly owner: Phaser.Scene, private readonly redraw: () => void) {}

  reset(): void {
    this.close(false);
    this.savedChoices = null;
    this.nodeId = null;
    this.choiceScroll = 0;
    this.choiceKey = '';
    this.expandedChoices.clear();
    this.owner.events.once('shutdown', () => this.close(false));
  }

  choices(fallback: readonly RunNode[]): readonly RunNode[] {
    return currentNode()?.id === this.nodeId && this.savedChoices ? this.savedChoices : fallback;
  }

  open(key: string, nodeId: string, choices: readonly RunNode[]): void {
    this.key = key;
    this.nodeId = nodeId;
    this.savedChoices = [...choices];
    this.redraw();
  }

  close(redraw = true): void {
    if (this.key) this.owner.scene.stop(this.key);
    this.key = null;
    this.embedded = undefined;
    if (!currentNode()) { this.savedChoices = null; this.nodeId = null; }
    if (redraw) this.redraw();
  }

  hide(): void {
    if (!this.key || !this.owner.scene.isActive(this.key)) return;
    const child = this.owner.scene.get(this.key);
    // The embedded scene receives global pointer events even outside its
    // camera viewport. When the parent resizes the host or opens a HUD modal,
    // finish any child drag/tap gesture before disabling it. Otherwise the
    // child can process the same release after the parent rebuild and revive a
    // shelf drag (or rebuild itself above the parent's level-up panel).
    child.input.emit('pointerupoutside');
    child.scene.setVisible(false);
    child.input.enabled = false;
  }

  /** Mandatory arrivals replace the cards in this same bounded route host. */
  renderBoss(bounds: Rect, model: RunBossArrivalViewModel, compact: boolean, onFaceBoss: () => void): void {
    renderRunBossArrivalPanel(this.owner, bounds, model, { compact, onFaceBoss });
  }

  /** Encounter dossiers share one clipped route-host scroller. Card state and
   * scroll survive detail toggles, but reset when the route choices change. */
  renderEncounters(bounds: Rect, models: readonly RunTravelChoiceViewModel[], compact: boolean,
    pendingId: string | undefined, onSelect: (nodeId: string) => void): void {
    const key = models.map((model) => model.nodeId).join('|');
    if (key !== this.choiceKey) { this.choiceKey = key; this.choiceScroll = 0; this.expandedChoices.clear(); }
    const rail = compact ? 40 : 0;
    const width = compact ? Math.min(660, bounds.width - rail) : bounds.width;
    const view = { ...bounds, x: bounds.x + (bounds.width - rail - width) / 2, width };
    const layout = runTravelChoiceCardsLayout(view, models, { compact });
    if (compact) {
      let y = view.y;
      layout.cards = models.map((model) => {
        const card = runTravelChoiceCardLayout({ x: view.x, y, width, height: 0 }, model,
          { compact, expanded: this.expandedChoices.has(model.nodeId) }).bounds;
        y += card.height + 12;
        return card;
      });
      layout.height = y - view.y - 12;
    }
    const maxScroll = Math.max(0, layout.height - bounds.height);
    this.choiceScroll = Math.max(0, Math.min(this.choiceScroll, maxScroll));
    const first = this.owner.children.list.length;
    models.forEach((model, index) => renderRunTravelChoiceCard(this.owner, layout.cards[index]!, model, {
      compact, pending: model.nodeId === pendingId, expanded: this.expandedChoices.has(model.nodeId), clip: view,
      onSelect: () => onSelect(model.nodeId),
      onToggle: () => {
        if (this.expandedChoices.has(model.nodeId)) this.expandedChoices.delete(model.nodeId);
        else this.expandedChoices.add(model.nodeId);
        this.redraw();
      },
    }));
    const parts = this.owner.children.list.slice(first);
    const content = this.owner.add.container(0, -this.choiceScroll, parts);
    const shape = this.owner.make.graphics({}, false);
    shape.fillStyle(0xffffff).fillRect(view.x - 1, view.y, view.width + 2, view.height);
    const mask = shape.createGeometryMask();
    content.setMask(mask);
    content.once('destroy', () => { mask.destroy(); shape.destroy(); });
    if (maxScroll === 0) return;
    const railX = bounds.x + bounds.width - (compact ? 34 : 10);
    const trackY = bounds.y + (compact ? 40 : 4);
    const trackH = bounds.height - (compact ? 80 : 8);
    const thumbH = Math.min(trackH, Math.max(28, trackH * bounds.height / layout.height));
    this.owner.add.rectangle(railX + (compact ? 14 : 0), trackY, 4, trackH, UI.border, 0.65).setOrigin(0, 0);
    const thumb = this.owner.add.rectangle(railX + (compact ? 14 : 0), trackY, 4, thumbH, UI.chip, 1).setOrigin(0, 0);
    const scroll = (next: number): void => {
      this.choiceScroll = Math.max(0, Math.min(next, maxScroll));
      content.setY(-this.choiceScroll);
      thumb.setY(trackY + (trackH - thumbH) * this.choiceScroll / maxScroll);
    };
    scroll(this.choiceScroll);
    if (compact) {
      for (const direction of [-1, 1]) {
        const y = direction < 0 ? bounds.y : bounds.y + bounds.height - 34;
        const box = this.owner.add.rectangle(railX, y, 32, 34, UI.panelMuted, 1).setOrigin(0, 0)
          .setStrokeStyle(1, UI.border, 0.8).setInteractive({ useHandCursor: true });
        const label = this.owner.add.text(railX + 16, y + 17, direction < 0 ? '↑' : '↓', textRole('label', { ink: 'accent' })).setOrigin(0.5);
        attachButtonFeel(this.owner, box, { fill: UI.panelMuted, hover: UI.chipDark, follow: [label],
          onPress: () => scroll(this.choiceScroll + direction * bounds.height * 0.65) });
      }
    }
    const inside = (pointer: Phaser.Input.Pointer): boolean => pointer.worldX >= view.x && pointer.worldX <= view.x + view.width
      && pointer.worldY >= view.y && pointer.worldY <= view.y + view.height;
    let startY: number | undefined;
    let startScroll = 0;
    this.owner.input.on('pointerdown', (pointer: Phaser.Input.Pointer, objects: Phaser.GameObjects.GameObject[]) => {
      if (wasPointerConsumedByRebuild(this.owner, pointer) || !inside(pointer) || objects.some((object) => object.input?.enabled)) return;
      startY = pointer.worldY;
      startScroll = this.choiceScroll;
    });
    this.owner.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      if (startY !== undefined && pointer.isDown) scroll(startScroll + startY - pointer.worldY);
    });
    this.owner.input.on('pointerup', () => { startY = undefined; });
    this.owner.input.on('pointerupoutside', () => { startY = undefined; });
    this.owner.input.on('wheel', (pointer: Phaser.Input.Pointer, _objects: unknown, _dx: number, dy: number) => {
      if (inside(pointer)) scroll(this.choiceScroll + dy);
    });
  }

  render(bounds: Rect): boolean {
    if (!this.key) return false;
    const key = this.key;
    const compact = key.startsWith('Mobile');
    const horizontal = compact ? 12 : 16;
    const denseShopToolbar = key === 'DesktopShop';
    const vertical = denseShopToolbar ? 6 : compact ? 10 : 12;
    this.owner.add.rectangle(bounds.x, bounds.y, bounds.width, bounds.height, UI.panel, 1).setOrigin(0, 0)
      .setStrokeStyle(1, UI.border, 0.8);
    const back = renderRunHostButton(this.owner, bounds.x + horizontal, bounds.y + vertical, '‹ BACK', compact, () => this.close(), false, denseShopToolbar);
    const barH = back.height + vertical * 2;
    const view = { x: bounds.x, y: bounds.y + barH, width: bounds.width, height: Math.max(40, bounds.height - barH) };
    if (key.endsWith('Shop')) renderRunHostButton(this.owner, back.x + back.width + 8, back.y, 'LEAVE SHOP ›', compact, () => { leaveCurrentShop(); this.close(); }, false, denseShopToolbar);
    const scroll = (direction: number): void => {
      if (!this.embedded) return;
      this.embedded.scrollY += direction * this.embedded.bounds.height * 0.7;
      positionRunDestination(this.owner.scene.get(key), this.embedded, this.embedded.source);
    };
    const source = this.embedded?.source;
    const overflows = source && source.height * Math.min(1, view.width / source.width) > view.height + 1;
    if (overflows) {
      const down = renderRunHostButton(this.owner, bounds.x + bounds.width - horizontal, back.y, '↓', compact, () => scroll(1), true);
      renderRunHostButton(this.owner, down.x - 8, back.y, '↑', compact, () => scroll(-1), true);
    }
    if (!this.embedded) {
      this.embedded = { bounds: view, source: view, scrollY: 0,
        onClose: () => this.close(), onChanged: () => this.redraw() };
      // Launch a clipped child view while the map remains active underneath.
      this.owner.scene.launch(key, { embedded: this.embedded });
    } else {
      this.embedded.bounds = view;
      const child = this.owner.scene.get(key);
      child.scene.setVisible(true);
      child.input.enabled = true;
      positionRunDestination(child, this.embedded, this.embedded.source);
    }
    this.owner.scene.bringToTop(key);
    return true;
  }
}
