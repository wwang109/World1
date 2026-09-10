import { afterEach, describe, expect, it, vi } from 'vitest';
import type Phaser from 'phaser';
import { skillBook } from '../../src/data/skills';
import { gemBook } from '../../src/data/gems';
import { DESKTOP_PROFILE, MOBILE_PROFILE } from '../../src/game/layoutProfile';
import { UI } from '../../src/game/theme';
import { buildDevEventFixture } from '../../src/game/devLaunch';
import * as runStore from '../../src/game/runStore';
import * as viewport from '../../src/game/viewport';
import { materializedEventV3 } from '../fixtures/eventV3';
import { eventRuntimeCatalog } from '../../src/data/events';
import type { LoadedEventDefV3 } from '../../src/data/eventContentV3';
import { runScreenTemplate } from '../../src/game/ui/runScreenTemplate';
import { eventOutcomePaneTemplate } from '../../src/game/ui/runRewardGeometry';
import { buildRunRewardViewModel } from '../../src/game/ui/runRewardViewModel';
import { buildRunMergeViewModel } from '../../src/game/ui/runMergeViewModel';
import { runEventSceneLayout, type RunEventScenePresentation } from '../../src/game/ui/runEventScenePresenter';

// Only canvas-owned card objects/overlays are replaced. Reward shell, art
// crop, gem definitions, text audits, paging and pointer callbacks are real.
vi.mock('phaser', () => ({ default: { Scene: class {}, Math: { Clamp: (x: number, a: number, b: number) => Math.min(b, Math.max(a, x)) } } }));
vi.mock('../../src/game/ui/CardToken', () => ({ CardToken: class { constructor(scene: any, x: number, y: number, skill: any, opts: any) { scene.cardFaces.push({ x, y, skill, opts }); } } }));
vi.mock('../../src/game/ui/FantasyCardTemplateV2', () => ({ FantasyCardTemplateV2: class { constructor(scene: any, x: number, y: number, skill: any, opts: any) { scene.cardFaces.push({ x, y, skill, opts }); } setInteractive() { return this; } } }));
vi.mock('../../src/game/ui/hoverTip', () => ({ attachHoverTip() {}, addHoverTipZone() {} }));
vi.mock('../../src/game/ui/cardDetailOverlay', () => ({ renderCardDetailOverlay() {} }));
vi.mock('../../src/game/ui/RunProgressStrip', async importOriginal => ({ ...await importOriginal<object>(), renderRunHud() {} }));
const rewards = await import('../../src/game/ui/RunRewardPanel');
const { DesktopRunEventScene } = await import('../../src/game/scenes/DesktopRunEventScene');
const { MobileRunEventScene } = await import('../../src/game/scenes/MobileRunEventScene');

function displayProbe() {
  const objects: any[] = [];
  function make(x: number, y: number, width: number, height: number, text = '', style: any = {}) {
    const item: any = { x, y, width, height, displayWidth: width, displayHeight: height, text, style, alpha: 1, active: true,
      handlers: new Map(), interactive: false,
      originX: 0.5, originY: 0.5,
      setOrigin(x: number, y = x) { this.originX = x; this.originY = y; return this; }, setStrokeStyle(width: number, color: number, alpha = 1) { this.stroke = { width, color, alpha }; return this; }, setCrop() { return this; }, setScale() { return this; }, setAlpha(alpha: number) { this.alpha = alpha; return this; },
      setAngle() { return this; }, setData() { return this; }, setFillStyle(color: number, alpha = 1) { this.fill = color; this.fillAlpha = alpha; return this; },
      setInteractive() { this.interactive = true; return this; }, on(name: string, handler: () => void) { this.handlers.set(name, handler); return this; },
      setY(value: number) { this.y = value; return this; },
      setDepth() { return this; }, setName() { return this; }, setVisible() { return this; },
      setPosition(x: number, y: number) { this.x = x; this.y = y; return this; },
      destroy() { const index = objects.indexOf(this); if (index >= 0) objects.splice(index, 1); },
      setSize(width: number, height: number) { this.width = width; this.height = height; return this; },
      getWrappedText() { return Array.from({ length: Math.ceil(this.height / 18) }, () => 'line'); },
      setFontSize(value: number) { this.style.fontSize = value; return this; }, setText(value: string) { this.text = value; return this; },
    };
    objects.push(item); return item;
  }
  const scene: any = {
    cardFaces: [], textures: { exists: () => true, get: () => ({ getSourceImage: () => ({ width: 800, height: 400 }) }) },
    add: {
      container: (x: number, y: number) => Object.assign(make(x, y, 0, 0), { add() {}, setMask() {} }),
      graphics: () => ({ setName() { return this; }, lineStyle() { return this; }, strokeRect() { return this; }, beginPath() { return this; }, moveTo() { return this; }, lineTo() { return this; }, strokePath() { return this; } }),
      rectangle: (x: number, y: number, w: number, h: number, fill: number, fillAlpha = 1) => Object.assign(make(x, y, w, h), { fill, fillAlpha }),
      image: (x: number, y: number, key: string) => Object.assign(make(x, y, 10, 10), { key }),
      text: (x: number, y: number, text: string, style: any) => {
        const size = Number.parseFloat(style.fontSize) || 12;
        const w = Math.min(text.length * size * 0.5, style.wordWrap?.width ?? Infinity);
        const h = Math.ceil(text.length * size * 0.5 / Math.max(1, w)) * size * 1.2;
        return make(x, y, w, h, text, style);
      },
    }, tweens: { killTweensOf() {}, killAll() {}, add() {}, addCounter(opts: any) { opts.onUpdate?.({ getValue: () => 1 }); opts.onComplete?.(); } },
    cameras: { main: { setBackgroundColor() {} } }, time: { removeAllEvents() {} }, children: { list: objects },
    scene: { start: vi.fn() },
    input: { on() {}, removeAllListeners() {} }, make: { graphics: () => ({ fillStyle() {}, fillRect() {}, createGeometryMask() { return {}; } }) },
  };
  return { scene: scene as Phaser.Scene & { cardFaces: any[] }, objects, text: () => objects.map(o => o.text).filter(Boolean) };
}
const event: RunEventScenePresentation = {
  title: 'Overloaded Caravan', body: 'A handler thanks you and slips you a small pouch for your help.',
  art: { kind: 'theme', theme: 'cache' }, phase: { kind: 'terminal', choiceId: 'help' },
  context: { theme: 'cache', biomeId: 'thornwild', biomeName: 'Thornwild', biomeTagline: '', areaName: 'Caravan', areaBlurb: '', rarityLabel: null, storyStageLabel: null, visibilityLabel: null, dueLabel: null },
  layout: runEventSceneLayout('desktop', 3),
  choices: [
    { id: 'pass', title: 'Passed by without stopping', iconKind: 'nothing' },
    { id: 'ignore', title: 'Ignored their request', iconKind: 'nothing' },
    { id: 'help', title: 'Helped unload the caravan', iconKind: 'grantGold' },
  ].map(choice => ({ ...choice, cost: 0, detail: '', footer: '', enabled: false, taken: choice.id === 'help', costConfirm: null })),
};
afterEach(() => { vi.restoreAllMocks(); runStore.clearRun(); });

// Catch a regression to translucent global plates/bronze ink or dimmed art
// at the actual renderer boundary, not by asserting an exported palette.
function paneTemplate(platform: 'desktop' | 'mobile', kind: 'icon' | 'picker') {
  const template = runScreenTemplate(platform);
  const panel = platform === 'desktop' ? { x: 600, y: 174, width: 780, height: 620 } : { x: 10, y: 438, width: 392, height: 390 };
  const header = { x: panel.x + 12, y: panel.y + 8, width: panel.width - 24, height: 22 };
  return eventOutcomePaneTemplate(template, kind, panel, header);
}
function expectRewardColors(probe: ReturnType<typeof displayProbe>, template: ReturnType<typeof eventOutcomePaneTemplate>) {
  for (const rect of [template.contentSlots.reward.panel]) {
    const plate = probe.objects.find(o => o.x === rect.x && o.y === rect.y && o.width === rect.width && o.height === rect.height);
    expect(plate).toMatchObject({ fill: 0x213d4d, fillAlpha: 1, stroke: { color: 0xd5aa55, alpha: 1 } });
  }
  expect(probe.objects.find(o => o.text === 'EVENT OUTCOME')?.style.color).toBe('#e3b966');
  expect(probe.text()).not.toContain('NOT TAKEN');
  expect(probe.text().filter(t => t === 'EVENT OUTCOME')).toHaveLength(1);
  expect(probe.objects.filter(o => o.key).every(o => o.alpha === 1)).toBe(true);
}

function luminance(hex: number | string): number {
  const value = typeof hex === 'number' ? hex : Number.parseInt(hex.slice(1), 16);
  const rgb = [value >> 16, (value >> 8) & 255, value & 255].map(v => {
    const channel = v / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return rgb[0]! * 0.2126 + rgb[1]! * 0.7152 + rgb[2]! * 0.0722;
}

it('local event inks clear 4.5:1 on their plates without expanding the global palette', () => {
  const colors = rewards.EVENT_REWARD_COLORS;
  for (const ink of [colors.text, colors.textDim, colors.textSoft, colors.textMuted, colors.textDisabled, colors.textAccent]) {
    for (const ground of [colors.panelAlt, colors.panelMuted, colors.chipDark]) {
      expect((luminance(ink) + 0.05) / (luminance(ground) + 0.05)).toBeGreaterThanOrEqual(4.5);
    }
  }
  expect((luminance(colors.chip) + 0.05) / (luminance(UI.textOnChip) + 0.05)).toBeGreaterThanOrEqual(4.5);
  expect(colors.panelAlt & 255).toBeGreaterThan((colors.panelAlt >> 8) & 255);
  expect((colors.panelAlt >> 8) & 255).toBeGreaterThan(colors.panelAlt >> 16);
  expect(luminance(colors.panelAlt)).toBeLessThan(0.08);
  expect(luminance(colors.panelAlt)).toBeGreaterThan(luminance(UI.panelAlt));
});

it('compact story art/title and scroll body remain above the persistent outcome pane', () => {
  const probe = displayProbe();
  const story = { x: 10, y: 122, width: 392, height: 304 };
  const longEvent = { ...event, title: 'The Bell Beneath the Frozen Mountains', body: event.body.repeat(12),
    context: { ...event.context, areaBlurb: 'A long and winding road through the frost-covered valley.', rarityLabel: 'SECRET', storyStageLabel: 'THE SECOND TOLL' } };
  (MobileRunEventScene.prototype as any).renderStory.call(probe.scene, longEvent, story);
  const bodyBox = probe.objects.filter(o => o.x === story.x && o.width === story.width).at(-1)!;
  expect(bodyBox.y + bodyBox.height).toBeLessThanOrEqual(story.y + story.height);
  expect(bodyBox.height).toBeGreaterThanOrEqual(70);
  const title = probe.objects.find(o => o.text === longEvent.title)!;
  expect(title.y + title.height).toBeLessThan(bodyBox.y);
  expect(probe.objects.find(o => o.key)?.alpha).toBe(1);
});

for (const [platform, width, height] of [['desktop', 1440, 900], ['mobile', 900, 900], ['mobile', 412, 892]] as const) {
  it.each([
    ['flaw_finder', 'Sell her a stone of your own', 'sell', 'PICK ONE TO SELL'],
    ['flaw_finder', 'Buy from the flaw-cut tray (2 gold)', 'gem', 'PICK ONE TO KEEP'],
    ['bell_beneath_ice', 'Prise the frost bell free', 'card', 'PICK ONE TO KEEP'],
    ['bell_beneath_ice', 'Ring it beneath the ice', 'upgrade', 'CHOOSE A CARD TO UPGRADE'],
    ['the_bell_unbound', 'Temper its Frost voice in the coals', 'bonus', 'PICK ONE TO KEEP'],
    ['ember_pit', 'Feed three matched pieces to the coals', 'merge', null],
    ['mirror_of_the_board', 'Perfect the reflection', 'targeted', 'CHOOSE A CARD TO UPGRADE'],
    ['flaw_finder', 'Keep your flaws to yourself', 'immediate', null],
  ] as const)(`${width}×${height} actual %s / %s clicks keep story and EVENT OUTCOME pane fixed`, (eventId, choiceLabel, kind, pickerTitle) => {
    vi.spyOn(viewport, 'viewport').mockReturnValue({ width, height });
    const pieces = [0, 1, 2].map(slot => ({ slot, instanceId: `pane-owned-${slot}`, skillId: 'sword_slash', tier: 'bronze' as const }));
    const fixture = kind === 'targeted'
      ? materializedEventV3(eventRuntimeCatalog.mirror_of_the_board as LoadedEventDefV3, 1103, { pieces })
      : buildDevEventFixture(eventId as any);
    runStore.installDevRunFixture({ ...fixture, pieces, gold: 20, gemInventory: [Object.keys(gemBook)[0]!] });
    const eventTitle = runStore.currentRunEventViewModel()!.title;
    const probe = displayProbe();
    const scene = new (platform === 'desktop' ? DesktopRunEventScene : MobileRunEventScene)() as any;
    Object.assign(scene, probe.scene);
    scene.init(); scene.create();
    const bounds = (o: any) => ({ x: o.x - o.width * o.originX, y: o.y - o.height * o.originY, width: o.width, height: o.height });
    const pane = () => probe.objects.find(o => o.fill === 0x213d4d && o.fillAlpha === 1 && o.stroke?.width === 2)!;
    const initialPane = bounds(pane());
    const titlePosition = () => { const title = probe.objects.find(o => o.text === eventTitle)!; return { x: title.x, y: title.y }; };
    const initialTitle = titlePosition();
    const assertSamePane = () => {
      expect(probe.text().filter(t => t === 'EVENT OUTCOME')).toHaveLength(1);
      expect(probe.text()).not.toContain('CHOSEN');
      expect(probe.text()).not.toContain('NOT TAKEN');
      expect(bounds(pane())).toEqual(initialPane);
      expect(titlePosition()).toEqual(initialTitle);
      expect(probe.text().filter(t => t === 'SELECT')).toHaveLength(0);
      expect(probe.objects.filter(o => o.stroke?.width === 2 && o.width >= initialPane.width * 0.8 && o.height >= initialPane.height * 0.8)).toHaveLength(1);
      for (const control of probe.objects.filter(o => o.interactive)) {
        const box = bounds(control);
        expect(box.x).toBeGreaterThanOrEqual(initialPane.x);
        expect(box.y).toBeGreaterThanOrEqual(initialPane.y);
        expect(box.x + box.width).toBeLessThanOrEqual(initialPane.x + initialPane.width);
        expect(box.y + box.height).toBeLessThanOrEqual(initialPane.y + initialPane.height);
      }
    };
    const tapText = (text: string) => {
      const label = probe.objects.find(o => o.text === text)!;
      expect(label, `visible label ${text}`).toBeDefined();
      const hit = probe.objects.filter(o => { const b = bounds(o); return o.interactive && label.x >= b.x && label.x <= b.x + b.width && label.y >= b.y && label.y <= b.y + b.height; }).sort((a, b) => a.width * a.height - b.width * b.height)[0]!;
      expect(hit, `click target for ${text}`).toBeDefined();
      hit.handlers.get('pointerdown')({});
    };
    tapText(choiceLabel);
    if (probe.text().includes('CONFIRM')) tapText('CONFIRM');
    if (probe.text().includes('MERGE')) tapText('MERGE');
    assertSamePane();
    if (kind !== 'immediate') {
      if (pickerTitle) expect(probe.text()).toContain(pickerTitle);
      expect(scene.pane.state.kind).toBe('picker');
      const item = probe.objects.find(o => o.interactive && o.width > initialPane.width * 0.6 && o.height >= 56)!;
      expect(item, 'actual picker hit target').toBeDefined();
      item.handlers.get('pointerdown')({});
      if (kind === 'sell') { expect(probe.text()).toContain('SELL'); tapText('SELL'); }
    }
    assertSamePane();
    expect(probe.text()).not.toContain('PICK ONE TO SELL');
    expect(probe.text().filter(t => t === 'CONTINUE ›')).toHaveLength(1);
    if (kind === 'sell') expect(runStore.getActiveRun()!.gemInventory).toHaveLength(0);
    tapText('CONTINUE ›');
    expect(probe.scene.scene.start).toHaveBeenCalledWith(platform === 'desktop' ? 'DesktopRunMap' : 'MobileRunMap');
  });
}

describe('real reward renderers inside the persistent event outcome pane', () => {
  for (const platform of ['desktop', 'mobile'] as const) {
    const font = platform === 'desktop' ? DESKTOP_PROFILE.font : MOBILE_PROFILE.font;
    it(`${platform} gold receipt shows context and actual art with exactly one working CONTINUE`, () => {
      const probe = displayProbe();
      const template = paneTemplate(platform, 'icon');
      rewards.renderRunEventOutcomePane(probe.scene, template);
      const next = vi.fn();
      rewards.renderRunRewardPanel(probe.scene, template, buildRunRewardViewModel({ kind: 'grantGold', amount: 1 }), { font, eventTitle: event.title, onContinue: next });
      expectRewardColors(probe, template);
      expect(probe.objects.find(o => o.text === 'Gained 1 gold')?.style.color).toBe('#fff0c9');
      expect(probe.text()).toContain('EVENT OUTCOME');
      expect(probe.text()).toContain('Gained 1 gold');
      expect(probe.text().filter(t => t === 'CONTINUE ›')).toHaveLength(1);
      expect(probe.objects.filter(o => o.key)).toHaveLength(1);
      const actions = probe.objects.filter(o => o.interactive);
      expect(actions).toHaveLength(1);
      expect(actions[0]).toMatchObject({ fill: 0xd5aa55, stroke: { color: 0xd5aa55, alpha: 1 } });
      actions[0]!.handlers.get('pointerdown')();
      expect(next).toHaveBeenCalledTimes(1);
    });
    it.each(['card', 'upgrade', 'gem', 'sell', 'merge'] as const)(`${platform} %s picker keeps its real authored-order controls and no CONTINUE`, kind => {
      const probe = displayProbe();
      const template = paneTemplate(platform, 'picker');
      const pick = vi.fn();
      const changePage = vi.fn();
      const opts = { font, eventTitle: event.title, page: 0, onPageChange: changePage, onPick: pick };
      const skill = skillBook.sword_slash!;
      const cards = Array.from({ length: 12 }, () => ({ skillId: skill.id, tier: 'bronze' as const }));
      const gems = Object.keys(gemBook).slice(0, 12);
      rewards.renderRunEventOutcomePane(probe.scene, template);
      if (kind === 'card') rewards.renderRunBonusDraftPicker(probe.scene, template, cards, opts);
      if (kind === 'upgrade') rewards.renderRunUpgradeCardPicker(probe.scene, template, cards.map((c, i) => ({ ...c, instanceId: `c${i}`, from: 'bronze', to: 'silver' })), opts);
      if (kind === 'gem') rewards.renderRunGemChoicePicker(probe.scene, template, gems, opts);
      if (kind === 'sell') rewards.renderRunSellGemPicker(probe.scene, template, gems.map((gemId, pouchIndex) => ({ gemId, pouchIndex, price: 1 })), opts);
      if (kind === 'merge') rewards.renderRunMergeCardsPicker(probe.scene, template, buildRunMergeViewModel({ from: 'bronze', to: 'silver', consumed: [0, 1, 2].map(i => ({ instanceId: `old${i}`, skillId: skill.id, tier: 'bronze', location: 'bag', index: i })), candidates: cards.map(c => ({ ...c, tier: 'silver' })) }), opts);
      expectRewardColors(probe, template);
      const headline = probe.objects.find(o => o.y === template.contentSlots.reward.headline.y && o.text);
      expect(headline?.style.color).toBe('#e3b966');
      expect(probe.objects.find(o => o.text === 'NEXT ›')?.style.color).toBe('#fff0c9');
      expect(probe.objects.find(o => o.text === '‹ PREVIOUS')?.style.color).toBe('#c5b58e');
      if (kind === 'gem' || kind === 'sell') expect(probe.objects.find(o => o.text === gemBook[gems[0]!]!.name)?.style.color).toBe('#fff0c9');
      if (kind === 'merge') expect(probe.objects.find(o => o.text === 'BRONZE · BAG')?.style.color).toBe('#d6b77b');
      expect(probe.text()).toContain('EVENT OUTCOME');
      expect(probe.text()).not.toContain('CONTINUE ›');
      const actions = probe.objects.filter(o => o.interactive);
      expect(actions.length).toBeGreaterThan(1);
      const pickActions = actions.filter(o => o.width > template.contentSlots.reward.feature.width * 0.6);
      expect(pickActions.length).toBeGreaterThan(0);
      expect(pickActions.every(o => o.height >= 56)).toBe(true);
      // Pager gets registered before item controls. Taking the first item must
      // invoke the real picker callback, not another event option or page.
      pickActions[0].handlers.get('pointerdown')();
      expect(pick).toHaveBeenCalledTimes(1);
      expect(changePage).not.toHaveBeenCalled();
      if (kind === 'gem') expect(pick.mock.calls[0]![0]).toBe(gems[0]);
      if (kind === 'merge') expect(probe.text().filter(t => t === 'BRONZE · BAG'), JSON.stringify(probe.text())).toHaveLength(3);
    });
    it(`${platform} standalone reward callers retain their original colors`, () => {
      const probe = displayProbe();
      const template = runScreenTemplate(platform);
      rewards.renderRunRewardPanel(probe.scene, template, buildRunRewardViewModel({ kind: 'grantGold', amount: 1 }), { font, eventTitle: event.title, onContinue() {} });
      expect(probe.objects[0]).toMatchObject({ fill: UI.panelAlt, fillAlpha: 0.94 });
      expect(probe.objects.find(o => o.text === 'Gained 1 gold')?.style.color).toBe(UI.text);
      expect(probe.objects.filter(o => o.key).at(-1)?.alpha).toBe(0.9);
    });
  }
});
