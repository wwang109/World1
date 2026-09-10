import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { buildDevEventFixture } from '../../src/game/devLaunch';
import { buildRunEventScenePresentation } from '../../src/game/ui/runEventScenePresenter';
import * as store from '../../src/game/runStore';
import { DESKTOP_PROFILE } from '../../src/game/layoutProfile';
import { runScreenLayoutRef } from '../../src/game/ui/runScreenLayout';

vi.mock('phaser', () => ({ default: {} }));
const renders = vi.hoisted(() => [] as Array<{ name: string; value: any; opts: any }>);
vi.mock('../../src/game/ui/RunRewardPanel', () => {
  const render = (name: string) => (_scene: unknown, _template: unknown, value: unknown, opts: unknown) => renders.push({ name, value, opts });
  return { renderRunRewardPanel: render('receipt'), renderRunBonusDraftPicker: render('card'),
    renderRunUpgradeCardPicker: render('upgrade'), renderRunGemChoicePicker: render('gem'),
    renderRunSellGemPicker: render('sell'), renderRunMergeCardsPicker: render('merge') };
});
const modules = import.meta.glob('../../src/game/ui/RunEventOutcomePane.ts');
async function moduleUnderTest() {
  const loader = modules['../../src/game/ui/RunEventOutcomePane.ts'];
  expect(loader, 'shared outcome-pane controller/registry must exist').toBeTypeOf('function');
  return await loader!() as typeof import('../../src/game/ui/RunEventOutcomePane');
}

function context(compact = false) {
  store.installDevRunFixture(buildDevEventFixture('the_bell_unbound'));
  const presentation = buildRunEventScenePresentation(store.currentRunEventViewModel()!, store.getActiveRun()!, compact ? 'mobile' : 'desktop');
  renders.length = 0;
  return { scene: {} as any, template: runScreenLayoutRef(compact ? 'mobile' : 'desktop'),
    panel: { x: 10, y: 10, width: 600, height: 620 }, header: { x: 28, y: 26, width: 564, height: 26 },
    font: DESKTOP_PROFILE.font, compact, presentation, onChoices: vi.fn(), onContinue: vi.fn(),
    onFinalize: vi.fn(), onSell: vi.fn(), onChange: vi.fn() };
}

describe('shared event outcome pane registry', () => {
  it('exhaustively registers choices, immediate receipts and every presenter picker kind', async () => {
    const { RUN_EVENT_OUTCOME_RENDERERS } = await moduleUnderTest();
    expect(Object.keys(RUN_EVENT_OUTCOME_RENDERERS).sort()).toEqual([
      'choices', 'receipt', 'cardChoice', 'bonusDraft', 'upgradeCard', 'upgradeCardTargeted', 'gemChoice', 'sellGem', 'mergeCards',
    ].sort());
    expect(Object.values(RUN_EVENT_OUTCOME_RENDERERS).every(renderer => typeof renderer === 'function')).toBe(true);
  });

  it.each(['Desktop', 'Mobile'])('%s scene delegates state and routing without any picker-kind ladder', async profile => {
    await moduleUnderTest();
    const source = readFileSync(`src/game/scenes/${profile}RunEventScene.ts`, 'utf8');
    expect(source).toContain('new RunEventOutcomePaneController()');
    expect(source).toContain('this.pane.render(');
    expect(source).not.toMatch(/picker\.kind|private renderPicker|private phase:|inspectedDraftIndex/);
  });

  it('transitions choices → picker → receipt, ignores a stale outcome, and resets on entry', async () => {
    const { RunEventOutcomePaneController } = await moduleUnderTest();
    const pane = new RunEventOutcomePaneController();
    const ctx = context();
    expect(pane.state).toEqual({ kind: 'choices' });
    pane.render(ctx);
    expect(ctx.onChoices).toHaveBeenCalledOnce();
    const offer = store.resolveCurrentRunEventChoice('temper_the_voice')!;
    expect(pane.enter(offer, store.getActiveRun()!)).toBe(true);
    expect(pane.state.kind).toBe('picker');
    expect(pane.enter({ kind: 'alreadySettled' } as any, store.getActiveRun()!)).toBe(false);
    expect(pane.state.kind).toBe('picker');
    pane.enter({ kind: 'grantGold', amount: 2 }, store.getActiveRun()!);
    expect(pane.state.kind).toBe('receipt');
    pane.render(ctx);
    renders.at(-1)!.opts.onContinue();
    expect(ctx.onContinue).toHaveBeenCalledOnce();
    pane.settle();
    expect(pane.state).toEqual({ kind: 'receipt', outcome: null });
    pane.reset();
    expect(pane.state).toEqual({ kind: 'choices' });
    store.clearRun();
  });

  for (const compact of [false, true]) {
    it.each(['cardChoice', 'bonusDraft', 'upgradeCard', 'upgradeCardTargeted', 'gemChoice', 'sellGem', 'mergeCards'] as const)(
      `${compact ? 'compact' : 'desktop'} %s preserves ordered inputs, selection payload, paging and inspections`, async kind => {
        const { RunEventOutcomePaneController } = await moduleUnderTest();
        const pane = new RunEventOutcomePaneController();
        const ctx = context(compact);
        const options = kind === 'gemChoice' ? ['test-gem', 'second-gem']
          : kind === 'sellGem' ? [{ gemId: 'test-gem', pouchIndex: 3, price: 2 }]
            : [{ skillId: 'test-card', instanceId: 'instance-7', tier: 'silver', available: true }];
        const picker = { kind, options, optionCount: options.length,
          consumed: [], model: { candidates: options } };
        // Inject presentation state only; the 24 renderer traces exercise real store transitions.
        (pane as any).current = { kind: 'picker', picker };
        pane.render(ctx);
        const rendered = renders.at(-1)!;
        expect(rendered.value).toBe(kind === 'mergeCards' ? picker.model : options);
        expect(rendered.opts.onContinue).toBeUndefined();
        rendered.opts.onPageChange(2);
        expect(ctx.onChange).toHaveBeenCalledOnce();
        pane.render(ctx);
        expect(renders.at(-1)!.opts.page).toBe(2);
        if (['cardChoice', 'bonusDraft', 'upgradeCard', 'upgradeCardTargeted', 'mergeCards'].includes(kind)) {
          if (compact) {
            expect(rendered.opts.inspectedIndex).toBeNull();
            rendered.opts.onInspect(1);
            pane.render(ctx);
            expect(renders.at(-1)!.opts.inspectedIndex).toBe(1);
          } else expect(rendered.opts.onInspect).toBeUndefined();
        }
        // Merge's real receipt is exercised in the renderer click-through suite.
        if (kind !== 'mergeCards') {
          rendered.opts.onPick(options[0]);
          if (kind === 'sellGem') {
            expect(ctx.onSell).toHaveBeenCalledWith(options[0]);
            expect(ctx.onFinalize).not.toHaveBeenCalled();
          } else {
            const selection = kind === 'gemChoice' ? { kind: 'gem', gemId: 'test-gem' }
              : kind.startsWith('upgrade') ? { kind: 'upgrade', instanceId: 'instance-7' }
                : { kind: 'card', skillId: 'test-card' };
            expect(ctx.onFinalize).toHaveBeenCalledWith(selection);
          }
        }
        store.clearRun();
      });
  }
});
