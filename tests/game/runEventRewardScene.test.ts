import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildDevEventFixture } from '../../src/game/devLaunch';
import * as store from '../../src/game/runStore';
import { skillBook } from '../../src/data/skills';
import { gemBook } from '../../src/data/gems';
import { buildRunMergeViewModel } from '../../src/game/ui/runMergeViewModel';
import { buildRunRewardViewModel } from '../../src/game/ui/runRewardViewModel';
import type { RunScreenTemplate } from '../../src/game/ui/runScreenTemplate';

const observed = vi.hoisted(() => ({ hud: null as any, renders: [] as Array<{ name: string; template: RunScreenTemplate; opts: any }>, shell: [] as any[] }));
vi.mock('phaser', () => ({ default: { Scene: class {}, Math: { Clamp: (x: number, a: number, b: number) => Math.min(b, Math.max(a, x)) } } }));
vi.mock('../../src/game/ui/RunRewardPanel', () => {
  const render = (name: string) => (_scene: unknown, template: RunScreenTemplate, _model: unknown, opts: unknown) => observed.renders.push({ name, template, opts });
  return {
    renderRunEventOutcomePane: (...args: unknown[]) => observed.shell.push(args),
    renderRunRewardPanel: render('terminal'), renderRunBonusDraftPicker: render('card'),
    renderRunUpgradeCardPicker: render('upgrade'), renderRunGemChoicePicker: render('gem'),
    renderRunSellGemPicker: render('sell'), renderRunMergeCardsPicker: render('merge'),
  };
});
vi.mock('../../src/game/ui/RunProgressStrip', async importOriginal => ({
  ...await importOriginal<object>(), renderRunHud: (_scene: unknown, opts: unknown) => { observed.hud = opts; },
}));
const { DesktopRunEventScene } = await import('../../src/game/scenes/DesktopRunEventScene');
const { MobileRunEventScene } = await import('../../src/game/scenes/MobileRunEventScene');
const skill = Object.values(skillBook)[0]!;
const gemId = Object.keys(gemBook)[0]!;
const outcomes = [
  { kind: 'grantGold', amount: 1 }, { kind: 'loseGold', amount: 1 }, { kind: 'nothing' },
  { kind: 'grantCard', skillId: skill.id, tier: skill.tier }, { kind: 'grantGem', gemId },
  { kind: 'grantLevel', level: 2 },
  { kind: 'grantMapInfo', revealedBands: [1, 2] },
  { kind: 'upgradeCard', fellBack: true },
  { kind: 'upgradeCard', skillId: skill.id, from: 'bronze', to: 'silver' },
  { kind: 'grantCard', skillId: skill.id, tier: skill.tier, fellBack: true },
  { kind: 'sellGem', gemId, price: 2 },
  { kind: 'cardGranted', skillId: skill.id, tier: skill.tier },
  { kind: 'cardUpgraded', skillId: skill.id, from: 'bronze', to: 'silver' },
] as const;

function mount(compact: boolean) {
  store.installDevRunFixture(buildDevEventFixture('the_bell_unbound'));
  const instance = new (compact ? MobileRunEventScene : DesktopRunEventScene)() as any;
  instance.init();
  const shape = { setOrigin() { return this; } };
  Object.assign(instance, {
    cameras: { main: { setBackgroundColor() {} } }, add: { rectangle: () => shape },
    scene: { start: vi.fn() }, renderChoosing: vi.fn(), renderStory: vi.fn(),
  });
  return instance;
}
afterEach(() => { observed.hud = null; observed.renders.length = 0; observed.shell.length = 0; store.clearRun(); vi.restoreAllMocks(); });
describe('event phase routes into the distinct reward composition', () => {
  for (const compact of [false, true]) {
    it(`${compact ? 'compact' : 'desktop'} resolved re-entry keeps its receipt and sole exit inside the persistent pane`, () => {
      const scene = mount(compact);
      store.resolveCurrentRunEventChoice('sell_the_silver');
      const settled = JSON.stringify(store.getActiveRun());
      scene.create();
      expect(scene.renderStory).toHaveBeenCalledTimes(1);
      expect(scene.renderChoosing).not.toHaveBeenCalled();
      expect(observed.renders).toHaveLength(1);
      expect(observed.renders[0]!.template).toHaveProperty('eventOutcomePane');
      expect(observed.hud.actions.primary).toBeUndefined();
      expect(JSON.stringify(store.getActiveRun())).toBe(settled);
    });
    it.each(outcomes)(`${compact ? 'compact' : 'desktop'} $kind terminal uses one in-page CONTINUE, never HUD duplicate`, outcome => {
      const scene = mount(compact);
      scene.pane.current = { kind: 'receipt', outcome };
      scene.create();
      expect(scene.renderChoosing).not.toHaveBeenCalled();
      expect(scene.renderStory).toHaveBeenCalledTimes(1);
      expect(observed.renders).toHaveLength(1);
      expect(observed.renders[0]!.name).toBe('terminal');
      expect(observed.renders[0]!.template).toHaveProperty('eventOutcomePane');
      expect(observed.hud.actions.primary).toBeUndefined();
      expect(observed.shell).toHaveLength(1);
      expect(buildRunRewardViewModel(outcome as any).headline).not.toBe('');
      observed.renders[0]!.opts.onContinue();
      expect(scene.scene.start).toHaveBeenCalledWith(compact ? 'MobileRunMap' : 'DesktopRunMap');
    });
    it.each(['cardChoice', 'bonusDraft', 'upgradeCard', 'upgradeCardTargeted', 'gemChoice', 'sellGem', 'mergeCards'] as const)(
      `${compact ? 'compact' : 'desktop'} %s retains its real picker on the reward page without a CONTINUE`, kind => {
        const scene = mount(compact);
        const options = kind === 'gemChoice' ? [gemId]
          : kind === 'sellGem' ? [{ gemId, pouchIndex: 0, price: 1 }]
            : kind.startsWith('upgrade') ? [{ instanceId: 'card-1', skillId: skill.id, from: 'bronze', to: 'silver', available: true }]
              : [{ skillId: skill.id, tier: skill.tier }];
        scene.pane.current = { kind: 'picker', picker: { kind, options, optionCount: 1,
          model: buildRunMergeViewModel({ kind: 'mergeCardsPick', from: 'bronze', to: 'silver', consumed: [], candidates: [{ skillId: skill.id, tier: 'silver' }] } as any) } };
        scene.create();
        expect(scene.renderChoosing).not.toHaveBeenCalled();
        expect(scene.renderStory).toHaveBeenCalledTimes(1);
        expect(observed.renders).toHaveLength(1);
        expect(observed.renders[0]!.template).toHaveProperty('eventOutcomePane');
        expect(observed.renders[0]!.template.contentSlots.reward.buttons.height).toBe(0);
        expect(observed.hud.actions.primary).toBeUndefined();
        expect(observed.shell).toHaveLength(1);
      });
  }
});
