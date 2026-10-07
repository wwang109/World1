import type Phaser from 'phaser';
import { currentEquipmentDropReceipt, getActiveRun } from '../runStore';
import { equipmentCatalog } from '../../data/equipmentContent';
import type { RunRewardViewModel } from './runRewardViewModel';
import type { MergeCardsReceipt, SellGemOption } from '../../run/events';
import type { RunState } from '../../run/runState';
import type { LayoutProfile } from '../layoutProfile';
import type { RunEventOfferSelection, RunEventOutcome } from '../runStore';
import { choiceArtKey } from './runArt';
import { burstReward } from './ambience';
import { assembleObjects, isFreshRender } from './motion';
import { eventOutcomePaneTemplate } from './runRewardGeometry';
import type { RunScreenTemplate } from './runScreenTemplate';
import { buildRunRewardViewModel } from './runRewardViewModel';
import { GEM_RESHAPE_PICK_TITLE, REROLL_PICK_TITLE, RESHAPE_PICK_TITLE } from './eventOutcomeText';
import {
  presentRunEventOutcome,
  type RunEventPickerPresentation, type RunEventPresentableOutcome, type RunEventScenePresentation,
} from './runEventScenePresenter';
import {
  buildMergeConfirmView, buildMergeSelectView, INITIAL_MERGE_UI, mergeReceiptFor, toggleMergeCard, type MergeUiState,
} from './runMergeViewModel';
import { buildReshapeConfirmView, INITIAL_RESHAPE_UI, reshapePickCards, type ReshapeUiState } from './reshapePickerView';
import {
  renderRunBonusDraftPicker, renderRunEquipmentPicker, renderRunGemChoicePicker, renderRunMergeConfirmPicker, renderRunMergeSelectPicker, renderRunReshapeGemPicker, renderRunRerollPicker,
  renderRunReshapeConfirm, renderRunReshapeSelectPicker,
  renderRunRewardPanel, renderRunSellGemPicker, renderRunStatPickPicker, renderRunTradePicker, renderRunUpgradeCardPicker,
} from './RunRewardPanel';

/** Scene-independent UI state. A null receipt is a committed/re-entered choice,
 * whose authored presentation supplies the receipt without replaying rewards. */
export type RunEventOutcomePaneState =
  | { kind: 'choices' }
  | { kind: 'picker'; picker: RunEventPickerPresentation }
  | { kind: 'receipt'; outcome: RunEventPresentableOutcome | null; mergeReceipt?: MergeCardsReceipt };

type Rect = { x: number; y: number; width: number; height: number };
export interface RunEventOutcomePaneContext {
  scene: Phaser.Scene;
  template: RunScreenTemplate;
  panel: Rect;
  header: Rect;
  font: LayoutProfile['font'];
  compact: boolean;
  presentation: RunEventScenePresentation;
  onChoices: () => void;
  onContinue: () => void;
  onFinalize: (selection: RunEventOfferSelection, receipt?: MergeCardsReceipt) => void;
  /** Selling still opens the scene-owned confirmation before finalization. */
  onSell: (option: SellGemOption) => void;
  /** Backs out of the `buyStatPick` picker for free, re-showing the choice
   * list (`cancelBuyStatPickV3`, `src/run/eventsV3.ts`). */
  onCancel: () => void;
  onChange: () => void;
  receiptInspection?: { expanded: boolean; onInspect: () => void; onClose: () => void };
}

type PickerKind = RunEventPickerPresentation['kind'];
type PickerFor<K extends PickerKind, P = RunEventPickerPresentation> =
  P extends { kind: infer Kind } ? K extends Kind ? P : never : never;
type InspectionKind = 'draft' | 'upgrade';
interface PickerContext extends RunEventOutcomePaneContext {
  rewardTemplate: RunScreenTemplate;
  paging: { page: number; onPageChange: (page: number) => void };
  inspect: (kind: InspectionKind) => { inspectedIndex?: number | null; onInspect?: (index: number | null) => void };
  merge: { ui: MergeUiState; update: (next: MergeUiState) => void };
  reshape: { ui: ReshapeUiState; update: (next: ReshapeUiState) => void };
}
type PickerRegistry = { [K in PickerKind]: (picker: PickerFor<K>, context: PickerContext) => void };
type StateRegistry = {
  [K in Exclude<RunEventOutcomePaneState['kind'], 'picker'>]:
    (state: Extract<RunEventOutcomePaneState, { kind: K }>, context: RunEventOutcomePaneContext) => void;
};

const renderCards: PickerRegistry['cardChoice'] = (picker, ctx) => {
  renderRunBonusDraftPicker(ctx.scene, ctx.rewardTemplate, picker.options, {
    ...ctx.paging, font: ctx.font, eventTitle: ctx.presentation.title,
    onPick: card => ctx.onFinalize({ kind: 'card', skillId: card.skillId }),
    ...ctx.inspect('draft'),
  });
};
const renderUpgrades: PickerRegistry['upgradeCard'] = (picker, ctx) => {
  renderRunUpgradeCardPicker(ctx.scene, ctx.rewardTemplate, picker.options, {
    ...ctx.paging, font: ctx.font, eventTitle: ctx.presentation.title,
    onPick: option => ctx.onFinalize({ kind: 'upgrade', instanceId: option.instanceId }),
    ...ctx.inspect('upgrade'),
  });
};

/** The mapped type makes adding a presenter kind without a renderer a compile
 * error. The two profiles share these exact strategies and callback payloads. */
const renderReshape: PickerRegistry['reshapeCard'] = (picker, ctx) => {
  const { ui, update } = ctx.reshape;
  const base = { font: ctx.font, eventTitle: ctx.presentation.title };
  const option = ui.pick === null ? undefined : picker.options.find(candidate => candidate.instanceId === ui.pick);
  const view = option === undefined ? null : buildReshapeConfirmView(picker.mode, option, picker.reward);
  if (ui.step === 'confirm' && option !== undefined && view !== null) {
    renderRunReshapeConfirm(ctx.scene, ctx.rewardTemplate, view, {
      ...base,
      detail: ui.detail === 0 ? 'lose' : ui.detail === 1 ? 'gain' : null,
      onDetail: which => update({ ...ui, detail: which === 'lose' ? 0 : which === 'gain' ? 1 : null }),
      onBack: () => update({ pick: null, step: 'cards', detail: null }),
      onConfirm: () => ctx.onFinalize({ kind: 'reshape', instanceId: option.instanceId }),
    });
    return;
  }
  const cards = reshapePickCards(picker.options);
  renderRunReshapeSelectPicker(ctx.scene, ctx.rewardTemplate, RESHAPE_PICK_TITLE[picker.mode], cards, {
    ...ctx.paging, ...base,
    detailIndex: ui.detail,
    onDetail: index => update({ ...ui, detail: index }),
    onChoose: instanceId => update({ pick: instanceId, step: 'confirm', detail: null }),
  });
};

export const RUN_EVENT_OUTCOME_RENDERERS = {
  choices: (_state, ctx) => ctx.onChoices(),
  receipt: (state, ctx) => {
    const selected = ctx.presentation.choices.find(choice => choice.taken);
    const model:RunRewardViewModel = state.outcome
      ? buildRunRewardViewModel(state.outcome, state.mergeReceipt)
      : { headline: selected?.title ?? ctx.presentation.title, detail: selected?.detail,
        iconKey: choiceArtKey(selected?.iconKind ?? 'nothing'), feature: { kind: 'icon' as const } };
    const run=getActiveRun(),instance=run?.currentNodeId?run.eventInstances[run.currentNodeId]:undefined;
    const receipt=currentEquipmentDropReceipt();
    if(receipt?.sourceKind==='event'&&receipt.sourceId===instance?.instanceId&&receipt.item){
      const item=equipmentCatalog.item(receipt.item.itemId,receipt.item.itemVersion);
      model.detail=[model.detail,`Equipment found: ${item.name}`].filter(Boolean).join('\n');
      if(model.feature.kind==='icon')model.feature={kind:'equipment',item:receipt.item};
    }
    renderRunRewardPanel(ctx.scene, eventOutcomePaneTemplate(ctx.template, model.feature.kind, ctx.panel, ctx.header), model, {
      font: ctx.font, eventTitle: ctx.presentation.title, onContinue: ctx.onContinue,
      inspected: ctx.receiptInspection?.expanded,
      onInspect: ctx.receiptInspection?.onInspect, onCloseInspect: ctx.receiptInspection?.onClose,
    });
  },
  cardChoice: renderCards,
  bonusDraft: renderCards,
  upgradeCard: renderUpgrades,
  upgradeCardTargeted: renderUpgrades,
  gemChoice: (picker, ctx) => renderRunGemChoicePicker(ctx.scene, ctx.rewardTemplate, picker.options, {
    ...ctx.paging, font: ctx.font, eventTitle: ctx.presentation.title,
    onPick: gemId => ctx.onFinalize({ kind: 'gem', gemId }),
  }),
  sellGem: (picker, ctx) => renderRunSellGemPicker(ctx.scene, ctx.rewardTemplate, picker.options, {
    ...ctx.paging, font: ctx.font, eventTitle: ctx.presentation.title, onPick: ctx.onSell,
  }),
  mergeCards: (picker, ctx) => {
    const { ui, update } = ctx.merge;
    const rewards = ui.ids.length === 3 ? picker.rewardsFor(ui.ids) : null;
    const base = { ...ctx.paging, font: ctx.font, eventTitle: ctx.presentation.title };
    if (ui.step === 'reward' && rewards !== null && rewards.rewards.length > 0) {
      renderRunMergeConfirmPicker(ctx.scene, ctx.rewardTemplate, buildMergeConfirmView(picker.owned, rewards, ui.reward), {
        ...base,
        detail: ui.detail?.list === 'spent' || ui.detail?.list === 'reward' ? ui.detail : null,
        onDetail: detail => update({ ...ui, detail }),
        onChoose: skillId => update({ ...ui, reward: skillId, detail: null }),
        onBack: () => update({ ...ui, step: 'cards', reward: null, detail: null }),
        onMerge: () => {
          if (ui.reward === null) return;
          ctx.onFinalize({ kind: 'mergeCards', skillId: ui.reward, consumedIds: ui.ids }, mergeReceiptFor(rewards, ui.reward));
        },
      });
      return;
    }
    renderRunMergeSelectPicker(ctx.scene, ctx.rewardTemplate, buildMergeSelectView(picker.owned, ui, rewards), {
      ...base,
      detailIndex: ui.detail?.list === 'cards' ? ui.detail.index : null,
      onDetail: index => update({ ...ui, detail: index === null ? null : { list: 'cards', index } }),
      onToggle: instanceId => update(toggleMergeCard(ui, instanceId)),
      onNext: () => update({ ...ui, step: 'reward', reward: null, detail: null }),
    });
  },
  buyStatPick: (picker, ctx) => renderRunStatPickPicker(ctx.scene, ctx.rewardTemplate, picker.options, {
    ...ctx.paging, font: ctx.font, eventTitle: ctx.presentation.title,
    onPick: stat => ctx.onFinalize({ kind: 'statPick', stat }),
    onCancel: ctx.onCancel,
  }),
  reshapeCard: (picker, ctx) => picker.mode === 'trade'
    ? renderRunTradePicker(ctx.scene, ctx.rewardTemplate, picker.options, {
      ...ctx.paging, font: ctx.font, eventTitle: ctx.presentation.title,
      title: RESHAPE_PICK_TITLE[picker.mode],
      onPick: option => {
        const chosen = picker.options.find(candidate => candidate === option);
        if (chosen !== undefined) ctx.onFinalize({ kind: 'reshape', instanceId: chosen.instanceId });
      },
      ...ctx.inspect('draft'),
    })
    : renderReshape(picker, ctx),
  forgeEquipment: (picker, ctx) => renderRunEquipmentPicker(ctx.scene, ctx.rewardTemplate, picker, {
    ...ctx.paging, font: ctx.font, eventTitle: ctx.presentation.title,
    onPick: itemId => ctx.onFinalize({ kind: 'forgeEquipment', itemId }),
    onCancel: ctx.onCancel,
  }),
  upgradeEquipment: (picker, ctx) => renderRunEquipmentPicker(ctx.scene, ctx.rewardTemplate, picker, {
    ...ctx.paging, font: ctx.font, eventTitle: ctx.presentation.title,
    onPick: instanceId => ctx.onFinalize({ kind: 'upgradeEquipment', instanceId }),
    onCancel: ctx.onCancel,
  }),
  reshapeGem: (picker, ctx) => renderRunReshapeGemPicker(ctx.scene, ctx.rewardTemplate, picker.options, {
    ...ctx.paging, font: ctx.font, eventTitle: ctx.presentation.title,
    title: GEM_RESHAPE_PICK_TITLE[picker.mode],
    onPick: option => ctx.onFinalize({ kind: 'reshapeGem', optionId: option.id }),
  }),
  rerollCard: (picker, ctx) => picker.rolled === undefined
    ? renderRunBonusDraftPicker(ctx.scene, ctx.rewardTemplate, picker.options, {
      ...ctx.paging, font: ctx.font, eventTitle: ctx.presentation.title,
      title: REROLL_PICK_TITLE.card,
      onPick: card => {
        const chosen = picker.options.find(option => option === card);
        if (chosen !== undefined) ctx.onFinalize({ kind: 'reroll', target: 'rerollCard', step: { kind: 'pick', id: chosen.instanceId } });
      },
      ...ctx.inspect('draft'),
    })
    : renderRunRerollPicker(ctx.scene, ctx.rewardTemplate, { kind: 'card', ...picker.rolled }, {
      font: ctx.font, eventTitle: ctx.presentation.title, title: 'KEEP IT OR ROLL AGAIN',
      onKeep: () => ctx.onFinalize({ kind: 'reroll', target: 'rerollCard', step: { kind: 'keep' } }),
      onReroll: () => ctx.onFinalize({ kind: 'reroll', target: 'rerollCard', step: { kind: 'reroll' } }),
    }),
  rerollGem: (picker, ctx) => picker.rolled === undefined
    ? renderRunReshapeGemPicker(ctx.scene, ctx.rewardTemplate, picker.options.map(option => ({ id: String(option.pouchIndex), gemIds: [option.gemId] })), {
      ...ctx.paging, font: ctx.font, eventTitle: ctx.presentation.title,
      title: REROLL_PICK_TITLE.gem, chipLabel: 'REROLL',
      onPick: option => ctx.onFinalize({ kind: 'reroll', target: 'rerollGem', step: { kind: 'pick', id: option.id } }),
    })
    : renderRunRerollPicker(ctx.scene, ctx.rewardTemplate, { kind: 'gem', ...picker.rolled }, {
      font: ctx.font, eventTitle: ctx.presentation.title, title: 'KEEP IT OR ROLL AGAIN',
      onKeep: () => ctx.onFinalize({ kind: 'reroll', target: 'rerollGem', step: { kind: 'keep' } }),
      onReroll: () => ctx.onFinalize({ kind: 'reroll', target: 'rerollGem', step: { kind: 'reroll' } }),
    }),
} satisfies PickerRegistry & StateRegistry;

export class RunEventOutcomePaneController {
  private current: RunEventOutcomePaneState = { kind: 'choices' };
  private page = 0;
  // Separate indexes preserve the compact picker arrays' independent identity.
  private inspected: Record<InspectionKind, number | null> = { draft: null, upgrade: null };
  private mergeUi: MergeUiState = INITIAL_MERGE_UI;
  private reshapeUi: ReshapeUiState = INITIAL_RESHAPE_UI;
  private receiptInspected = false;

  get state(): Readonly<RunEventOutcomePaneState> { return this.current; }

  reset(): void {
    this.current = { kind: 'choices' };
    this.page = 0;
    this.inspected = { draft: null, upgrade: null };
    this.mergeUi = INITIAL_MERGE_UI;
    this.reshapeUi = INITIAL_RESHAPE_UI;
    this.receiptInspected = false;
  }

  settle(): void { this.current = { kind: 'receipt', outcome: null }; this.receiptInspected = false; }

  /** Pure semantic adaptation; committing/reopening rewards stays in runStore. */
  enter(outcome: RunEventOutcome, run: RunState, mergeReceipt?: MergeCardsReceipt): boolean {
    const presented = presentRunEventOutcome(outcome, run);
    if (presented.kind === 'ignored') return false;
    this.receiptInspected = false;
    if (presented.kind === 'picker') {
      this.current = { kind: 'picker', picker: presented.picker };
      this.page = 0;
      this.mergeUi = INITIAL_MERGE_UI;
      this.reshapeUi = INITIAL_RESHAPE_UI;
    } else {
      this.current = { kind: 'receipt', outcome: presented.outcome, mergeReceipt };
    }
    return true;
  }

  render(ctx: RunEventOutcomePaneContext): void {
    const state = this.current;
    if (state.kind === 'choices') return RUN_EVENT_OUTCOME_RENDERERS.choices(state, ctx);
    const firstNew = ctx.scene.children.list.length;
    this.renderState(state, ctx);
    const key = state.kind === 'picker' ? `picker:${state.picker.kind}:${this.page}` : `receipt:${state.outcome ? 'fresh' : 'settled'}`;
    if (!isFreshRender(ctx.scene, key)) return;
    assembleObjects(ctx.scene, ctx.scene.children.list.slice(firstNew), ctx.panel);
    if (state.kind === 'receipt' && state.outcome && state.outcome.kind !== 'nothing' && state.outcome.kind !== 'loseGold') {
      burstReward(ctx.scene, ctx.panel);
    }
  }

  private renderState(state: RunEventOutcomePaneState, ctx: RunEventOutcomePaneContext): void {
    switch (state.kind) {
      case 'choices': return RUN_EVENT_OUTCOME_RENDERERS.choices(state, ctx);
      case 'receipt': return RUN_EVENT_OUTCOME_RENDERERS.receipt(state, {
        ...ctx,
        receiptInspection: {
          expanded: this.receiptInspected,
          onInspect: () => { this.receiptInspected = true; ctx.onChange(); },
          onClose: () => { this.receiptInspected = false; ctx.onChange(); },
        },
      });
      case 'picker': {
        // The lookup key comes from this same picker. TS loses that correlation
        // across a union-indexed function call; the exhaustive registry above
        // checks each concrete strategy's input, with this sole dispatch cast.
        const render = RUN_EVENT_OUTCOME_RENDERERS[state.picker.kind] as
          (picker: RunEventPickerPresentation, context: PickerContext) => void;
        return render(state.picker, {
          ...ctx,
          rewardTemplate: eventOutcomePaneTemplate(ctx.template, 'picker', ctx.panel, ctx.header),
          paging: { page: this.page, onPageChange: page => { this.page = page; ctx.onChange(); } },
          // Desktop otherwise relies on `attachCellHoverTip`'s mouse-hover tip
          // for a picker's detail, but the upgrade picker's before/after diff
          // (`renderTierUpgradeDetailOverlay`) has no hover equivalent, so
          // 'upgrade' opts in on BOTH platforms rather than only `ctx.compact`
          // (mobile, which has no hover at all).
          inspect: kind => (ctx.compact || kind === 'upgrade') ? {
            inspectedIndex: this.inspected[kind],
            onInspect: index => { this.inspected[kind] = index; ctx.onChange(); },
          } : {},
          merge: {
            ui: this.mergeUi,
            update: next => {
              if (next.step !== this.mergeUi.step) this.page = 0;
              this.mergeUi = next;
              ctx.onChange();
            },
          },
          reshape: {
            ui: this.reshapeUi,
            update: next => {
              if (next.step !== this.reshapeUi.step) this.page = 0;
              this.reshapeUi = next;
              ctx.onChange();
            },
          },
        });
      }
      default: {
        const exhaustive: never = state;
        throw new Error(`Unknown event outcome pane state: ${String(exhaustive)}`);
      }
    }
  }
}
