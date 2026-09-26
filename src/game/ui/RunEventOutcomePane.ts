import type Phaser from 'phaser';
import type { MergeCardsReceipt, SellGemOption } from '../../run/events';
import type { RunState } from '../../run/runState';
import type { LayoutProfile } from '../layoutProfile';
import type { RunEventOfferSelection, RunEventOutcome } from '../runStore';
import { choiceArtKey } from './runArt';
import { eventOutcomePaneTemplate } from './runRewardGeometry';
import type { RunScreenTemplate } from './runScreenTemplate';
import { buildRunRewardViewModel } from './runRewardViewModel';
import {
  mergeReceiptForEventPicker, presentRunEventOutcome,
  type RunEventPickerPresentation, type RunEventPresentableOutcome, type RunEventScenePresentation,
} from './runEventScenePresenter';
import {
  renderRunBonusDraftPicker, renderRunGemChoicePicker, renderRunMergeCardsPicker,
  renderRunRewardPanel, renderRunSellGemPicker, renderRunStatPickPicker, renderRunUpgradeCardPicker,
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
}

type PickerKind = RunEventPickerPresentation['kind'];
type PickerFor<K extends PickerKind, P = RunEventPickerPresentation> =
  P extends { kind: infer Kind } ? K extends Kind ? P : never : never;
type InspectionKind = 'draft' | 'upgrade' | 'merge';
interface PickerContext extends RunEventOutcomePaneContext {
  rewardTemplate: RunScreenTemplate;
  paging: { page: number; onPageChange: (page: number) => void };
  inspect: (kind: InspectionKind) => { inspectedIndex?: number | null; onInspect?: (index: number | null) => void };
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
export const RUN_EVENT_OUTCOME_RENDERERS = {
  choices: (_state, ctx) => ctx.onChoices(),
  receipt: (state, ctx) => {
    const selected = ctx.presentation.choices.find(choice => choice.taken);
    const model = state.outcome
      ? buildRunRewardViewModel(state.outcome, state.mergeReceipt)
      : { headline: selected?.title ?? ctx.presentation.title, detail: selected?.detail,
        iconKey: choiceArtKey(selected?.iconKind ?? 'nothing'), feature: { kind: 'icon' as const } };
    renderRunRewardPanel(ctx.scene, eventOutcomePaneTemplate(ctx.template, model.feature.kind, ctx.panel, ctx.header), model, {
      font: ctx.font, eventTitle: ctx.presentation.title, onContinue: ctx.onContinue,
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
  mergeCards: (picker, ctx) => renderRunMergeCardsPicker(ctx.scene, ctx.rewardTemplate, picker.model, {
    ...ctx.paging, font: ctx.font, eventTitle: ctx.presentation.title,
    onPick: candidate => ctx.onFinalize(
      { kind: 'mergeCards', skillId: candidate.skillId }, mergeReceiptForEventPicker(picker, candidate.skillId),
    ),
    ...ctx.inspect('merge'),
  }),
  buyStatPick: (picker, ctx) => renderRunStatPickPicker(ctx.scene, ctx.rewardTemplate, picker.options, {
    ...ctx.paging, font: ctx.font, eventTitle: ctx.presentation.title,
    onPick: stat => ctx.onFinalize({ kind: 'statPick', stat }),
    onCancel: ctx.onCancel,
  }),
} satisfies PickerRegistry & StateRegistry;

export class RunEventOutcomePaneController {
  private current: RunEventOutcomePaneState = { kind: 'choices' };
  private page = 0;
  // Separate indexes preserve the compact picker arrays' independent identity.
  private inspected: Record<InspectionKind, number | null> = { draft: null, upgrade: null, merge: null };

  get state(): Readonly<RunEventOutcomePaneState> { return this.current; }

  reset(): void {
    this.current = { kind: 'choices' };
    this.page = 0;
    this.inspected = { draft: null, upgrade: null, merge: null };
  }

  settle(): void { this.current = { kind: 'receipt', outcome: null }; }

  /** Pure semantic adaptation; committing/reopening rewards stays in runStore. */
  enter(outcome: RunEventOutcome, run: RunState, mergeReceipt?: MergeCardsReceipt): boolean {
    const presented = presentRunEventOutcome(outcome, run);
    if (presented.kind === 'ignored') return false;
    if (presented.kind === 'picker') {
      this.current = { kind: 'picker', picker: presented.picker };
      this.page = 0;
    } else {
      this.current = { kind: 'receipt', outcome: presented.outcome, mergeReceipt };
    }
    return true;
  }

  render(ctx: RunEventOutcomePaneContext): void {
    const state = this.current;
    switch (state.kind) {
      case 'choices': return RUN_EVENT_OUTCOME_RENDERERS.choices(state, ctx);
      case 'receipt': return RUN_EVENT_OUTCOME_RENDERERS.receipt(state, ctx);
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
        });
      }
      default: {
        const exhaustive: never = state;
        throw new Error(`Unknown event outcome pane state: ${String(exhaustive)}`);
      }
    }
  }
}
