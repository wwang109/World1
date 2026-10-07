import Phaser from 'phaser';
import { SCREEN, textRoleFor, UI } from '../theme';
import { applyRenderScale } from '../renderScale';
import { auditControlLabel, auditTextBlock } from './controlLayoutAudit';
import { dismissHoverTip } from './hoverTip';
import { renderPaintedChrome } from './paintedChrome';
import { attachButtonFeel } from './motion';
import { runModalLayout, type RunModalLayout } from './runModalLayout';
export type { RunModalLayout } from './runModalLayout';

export interface RunModalOptions {
  id: string; title: string; compact: boolean; width?: number; height?: number; footerHeight?: number;
  onClose?: () => void; dismissOnScrim?: boolean;
  render: (scene: Phaser.Scene, layout: RunModalLayout, handle: RunModalHandle) => void;
}
export interface RunModalHandle {
  readonly scene: Phaser.Scene; readonly layout: RunModalLayout;
  close: () => void; update: (options: RunModalOptions) => void;
}
interface ModalFrame {
  owner: Phaser.Scene; options: RunModalOptions; layout: RunModalLayout; handle: RunModalHandle;
  objects: Phaser.GameObjects.GameObject[]; listeners: Map<string, ((...args: unknown[]) => void)[]>;
  inputs: Map<Phaser.GameObjects.GameObject, boolean>; listenersActive: boolean; shutdown: () => void;
}
const KEY = 'RunModal';
const INPUT_EVENTS = ['pointerdown', 'pointermove', 'pointerup', 'pointerupoutside', 'wheel', 'gameobjectdown', 'gameobjectup'];

class RunModalScene extends Phaser.Scene {
  private frames: ModalFrame[] = [];
  private backgroundInputs = new Map<Phaser.Scene, boolean>();
  private inputHeld = false;
  constructor() { super(KEY); }
  create(): void {
    if (!this.frames.length) { this.scene.stop(); return; }
    this.cameras.main.setBackgroundColor('rgba(0,0,0,0)').clearMask().setScroll(0, 0);
    applyRenderScale(this);
    for (const frame of this.frames) this.draw(frame);
    this.blockBackground();
    this.events.once('shutdown', () => {
      for (const frame of [...this.frames]) this.dispose(frame);
      this.frames = [];
      this.inputHeld = false;
      this.restoreBackground();
    });
  }
  rootOwner(): Phaser.Scene | undefined { return this.frames.at(-1)?.owner; }
  has(owner: Phaser.Scene, id?: string): boolean { return this.frames.some(frame => frame.owner === owner && (id === undefined || frame.options.id === id)); }
  open(owner: Phaser.Scene, options: RunModalOptions): RunModalHandle {
    dismissHoverTip(this);
    dismissHoverTip(owner);
    const top = this.frames.at(-1);
    const prior = top?.owner === owner && top.options.id === options.id ? top : undefined;
    if (prior) { this.updateFrame(prior, options); return prior.handle; }
    const frame = { owner, options, layout: this.geometry(options), objects: [], listeners: new Map(), inputs: new Map(), listenersActive: true } as unknown as ModalFrame;
    frame.handle = { scene: this, get layout() { return frame.layout; }, close: () => this.closeFrame(frame), update: opts => this.updateFrame(frame, opts) };
    frame.shutdown = () => this.closeOwner(owner);
    owner.events.once('shutdown', frame.shutdown);
    this.frames.push(frame);
    if (this.sys.isActive()) { this.draw(frame); this.blockBackground(); }
    this.scene.bringToTop();
    return frame.handle;
  }
  closeOwner(owner: Phaser.Scene, id?: string): void {
    const matching = this.frames.filter(frame => frame.owner === owner && (id === undefined || frame.options.id === id));
    for (const frame of matching.reverse()) this.closeFrame(frame);
  }
  private geometry(options: RunModalOptions): RunModalLayout {
    return runModalLayout({ x: 0, y: 0, width: SCREEN.width, height: SCREEN.height }, { ...options, closable: options.onClose !== undefined });
  }
  private blockBackground(): void {
    for (const scene of this.scene.manager.getScenes(true)) {
      if (scene === this) continue;
      if (!this.backgroundInputs.has(scene)) {
        this.backgroundInputs.set(scene, scene.input.enabled);
        scene.input.emit('pointerupoutside');
      }
      scene.input.enabled = false;
    }
    for (const frame of this.frames) {
      const top = frame === this.frames.at(-1);
      const enabled = top && !this.inputHeld;
      for (const object of frame.objects) if ('setVisible' in object) (object as Phaser.GameObjects.Container).setVisible(top);
      if (frame.listenersActive !== enabled) {
        for (const [event, listeners] of frame.listeners) for (const listener of listeners) {
          if (enabled) this.input.on(event, listener); else this.input.off(event, listener);
        }
        frame.listenersActive = enabled;
      }
      for (const [object, original] of frame.inputs) if (object.input) object.input.enabled = enabled && original;
    }
  }
  private restoreBackground(): void {
    for (const [scene, enabled] of this.backgroundInputs) if (scene.sys.isActive()) scene.input.enabled = enabled;
    this.backgroundInputs.clear();
  }
  private dispose(frame: ModalFrame): void {
    frame.owner.events.off('shutdown', frame.shutdown);
    for (const [event, listeners] of frame.listeners) for (const listener of listeners) this.input.off(event, listener);
    const owned: Phaser.GameObjects.GameObject[] = [...frame.objects];
    for (let index = 0; index < owned.length; index += 1) {
      const object = owned[index]!;
      if (object instanceof Phaser.GameObjects.Container) owned.push(...object.list);
    }
    this.tweens.killTweensOf(owned);
    for (const object of frame.objects) if (object.scene) object.destroy();
    frame.objects = []; frame.inputs.clear(); frame.listeners.clear();
  }
  private updateFrame(frame: ModalFrame, options: RunModalOptions): void {
    dismissHoverTip(this);
    const index = this.frames.indexOf(frame);
    if (index < 0) return;
    for (const child of this.frames.slice(index + 1).reverse()) this.closeFrame(child);
    this.dispose(frame);
    frame.options = options; frame.layout = this.geometry(options);
    frame.owner.events.once('shutdown', frame.shutdown);
    if (this.sys.isActive()) { this.draw(frame); this.blockBackground(); }
  }
  private closeFrame(frame: ModalFrame): void {
    dismissHoverTip(this);
    const index = this.frames.indexOf(frame);
    if (index < 0) return;
    for (const child of this.frames.slice(index + 1).reverse()) this.closeFrame(child);
    this.dispose(frame); this.frames.splice(index, 1);
    this.syncState();
    if (this.input.activePointer.isDown && !this.inputHeld) {
      this.inputHeld = true;
      const release = (): void => {
        this.input.off('pointerup', release).off('pointerupoutside', release);
        this.time.delayedCall(0, () => { this.inputHeld = false; if (this.frames.length) this.blockBackground(); });
      };
      this.input.once('pointerup', release).once('pointerupoutside', release);
    }
    if (this.frames.length) this.blockBackground();
    else {
      const finish = (): void => { if (!this.frames.length) { this.restoreBackground(); this.scene.stop(); } };
      const release = (): void => {
        this.input.off('pointerup', release).off('pointerupoutside', release);
        this.time.delayedCall(0, finish);
      };
      if (this.input.activePointer.isDown) this.input.once('pointerup', release).once('pointerupoutside', release);
      else this.time.delayedCall(0, finish);
    }
  }
  private syncState(): void {
    this.data.set('runModalState', this.frames.map(entry => ({ id: entry.options.id, owner: entry.owner.sys.settings.key, layout: entry.layout })));
  }
  private draw(frame: ModalFrame): void {
    const before = new Set(this.children.list);
    const oldListeners = new Map(INPUT_EVENTS.map(event => [event, new Set(this.input.listeners(event))]));
    const { options, layout, handle } = frame;
    const depth = this.frames.indexOf(frame) * 100;
    const scrim = this.add.rectangle(0, 0, layout.view.width, layout.view.height, UI.shadow, 0.62).setOrigin(0).setInteractive()
      .setData('runModalScrim', options.id);
    this.add.rectangle(layout.panel.x, layout.panel.y, layout.panel.width, layout.panel.height, UI.panelAlt, 0.98)
      .setOrigin(0).setStrokeStyle(2, UI.chip, 1).setInteractive().setData('runModalPanel', options.id);
    renderPaintedChrome(this, layout.panel.x, layout.panel.y, layout.panel.width, layout.panel.height, { compact: options.compact });
    const title = this.add.text(layout.header.x, layout.header.y, options.title, textRoleFor(options.compact ? 'mobile' : 'desktop', 'title'));
    auditTextBlock(title, { name: `${options.id} modal heading`, maxWidth: layout.header.width, maxHeight: layout.header.height, minFontSize: 12 });
    const dismiss = (_pointer: Phaser.Input.Pointer, _x: number, _y: number, event: Phaser.Types.Input.EventData) => {
      event.stopPropagation(); const onClose = options.onClose; handle.close(); onClose?.();
    };
    if (options.onClose) {
      const x = layout.panel.x + layout.panel.width - (options.compact ? 16 : 24) - 44;
      const close = this.add.rectangle(x, layout.panel.y + (options.compact ? 12 : 18), 44, 44, UI.chip).setOrigin(0).setInteractive({ useHandCursor: true })
        .setData('runModalClose', options.id).on('pointerup', dismiss);
      const label = this.add.text(x + 22, close.y + 22, '×', textRoleFor(options.compact ? 'mobile' : 'desktop', 'title', { ink: 'onAccent' })).setOrigin(0.5);
      auditControlLabel(close, label, { name: `${options.id} modal close`, horizontalPadding: 8, verticalPadding: 6, minFontSize: 12 });
      attachButtonFeel(this, close, { fill: UI.chip, hover: UI.chipDark, follow: [label], lift: 0, sfx: null });
      if (options.dismissOnScrim) scrim.on('pointerup', dismiss);
    }
    options.render(this, layout, handle);
    const styleButtons = (object: Phaser.GameObjects.GameObject): void => {
      if (object instanceof Phaser.GameObjects.Container) object.list.slice().forEach(styleButtons);
      if (object instanceof Phaser.GameObjects.Rectangle && object.input && !object.getData('paintedButton')
        && object.height >= 28 && object.height <= 64 && object.width >= 40) {
        attachButtonFeel(this, object, { fill: object.fillColor, hover: UI.slotHover, alpha: object.fillAlpha, lift: 0, sfx: null });
      }
    };
    this.children.list.filter(object => !before.has(object)).slice().forEach(styleButtons);
    const objects = this.children.list.filter(object => !before.has(object) && !object.getData('runModalContainer'));
    const group = this.add.container(0, 0, objects).setDepth(depth).setName(`run-modal-${options.id}`).setData('runModalContainer', options.id);
    frame.objects = [group];
    const collect = (object: Phaser.GameObjects.GameObject): void => {
      object.setData('runModalFrame', options.id);
      if (object.input) frame.inputs.set(object, object.input.enabled);
      if (object instanceof Phaser.GameObjects.Container) object.list.forEach(collect);
    };
    objects.forEach(collect);
    for (const event of INPUT_EVENTS) frame.listeners.set(event, this.input.listeners(event).filter(listener => !oldListeners.get(event)!.has(listener) && !this.frames.some(other => other !== frame && other.listeners.get(event)?.includes(listener as (...args: unknown[]) => void))) as ((...args: unknown[]) => void)[]);
    frame.listenersActive = true;
    this.syncState();
  }
}

function modalScene(owner: Phaser.Scene): RunModalScene {
  const existing = owner.scene.manager.keys[KEY] as RunModalScene | undefined;
  if (existing) return existing;
  const scene = new RunModalScene();
  owner.scene.add(KEY, scene, false);
  return scene;
}
export function openRunModal(owner: Phaser.Scene, options: RunModalOptions): RunModalHandle {
  const modal = modalScene(owner);
  const rootOwner = owner === modal ? modal.rootOwner() ?? owner : owner;
  const handle = modal.open(rootOwner, options);
  if (!modal.sys.isActive()) owner.scene.launch(KEY);
  else owner.scene.bringToTop(KEY);
  return handle;
}
export function closeRunModal(owner: Phaser.Scene, id?: string): void {
  const modal = owner.scene.manager.keys[KEY] as RunModalScene | undefined;
  if (modal) modal.closeOwner(owner === modal ? modal.rootOwner() ?? owner : owner, id);
}
export function isRunModalOpen(owner: Phaser.Scene, id?: string): boolean {
  const modal = owner.scene.manager.keys[KEY] as RunModalScene | undefined;
  return modal?.has(owner === modal ? modal.rootOwner() ?? owner : owner, id) ?? false;
}
