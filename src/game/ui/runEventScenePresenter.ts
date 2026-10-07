import { equipmentCatalog, equipmentDocument } from '../../data/equipmentContent';
import { equipmentModifierClauses } from '../../engine/equipment/text';
import { leveledStatMods } from '../../engine/equipment/upgrade';
import { brokenPieces, FORGE_COST, forgeOptions, upgradeOptions } from '../../run/equipmentWorkshop';
import { biomeFor } from '../../run/biome';
import type { EventOutcome, MergeTrioRewards, SellGemOption, UpgradeCardOption } from '../../run/events';
import { mergeableOwnedCards, mergeCardsPreview, mergeTrioRewards } from '../../run/events';
import type { EventOutcomeV3 } from '../../run/eventsV3';
import type { RunCard, RunState } from '../../run/runState';
import { currentEventNode } from '../../run/runState';
import { nextSkillTier } from '../../run/shop';
import type { EventCardOfferV3 } from '../../run/eventV3Materialization';
import { DESKTOP_PROFILE, MOBILE_PROFILE } from '../layoutProfile';
import { eventCostConfirmBody, eventCostConfirmTitle, eventOutcomeHintText, mergeRowPreviewText } from './eventOutcomeText';
import { eventThemeArea } from './eventThemeBlurb';
import { runChoicePanelMinHeight } from './RunChoicePanel';
import { eventChoiceBlockHeight } from './runEventStoryLayout';
import type { RunEventOutcomeHint, RunEventViewModel } from './runEventViewModel';
import type { EventOpportunityHint } from '../../run/eventOpportunityHint';
import { buildMergeSpentEntries, type MergeSpentEntry } from './runMergeViewModel';
import type { ReshapeReward } from './reshapePickerView';
import { runScreenTemplate, type RunTemplatePlatform } from './runScreenTemplate';
import { gemBook } from '../../data/gems';
import { skillBook } from '../../data/skills';
import { marketStatPickOptions, type MarketStatPickOption } from '../../run/market';
import type { EventReshapeGemModeV3, EventReshapeModeV3 } from '../../data/eventContentV3';
import type { EventReshapeGemOptionV3 } from '../../run/eventV3Materialization';
import type { SkillTier } from '../../engine/types';

export interface RunEventSceneLayout {
  platform: RunTemplatePlatform;
  flow: 'wide-centered' | 'stacked-scroll';
  contentTop: number;
  choiceBottom: number;
  choiceBlockHeight: number;
  choiceRow: { x: number; width: number; height: number; gap: number };
}

/** Headless geometry contract shared with tests while each Phaser scene keeps
 * its own composition code. Desktop is a centered reading column; mobile is a
 * full-width, touch-first stack with a scroll-safe body above it. */
export function runEventSceneLayout(
  platform: RunTemplatePlatform,
  choiceCount: number,
): RunEventSceneLayout {
  const profile = platform === 'desktop' ? DESKTOP_PROFILE : MOBILE_PROFILE;
  const template = runScreenTemplate(platform);
  const rowHeight = Math.max(platform === 'mobile' ? 44 : 0, runChoicePanelMinHeight(profile.font));
  const gap = platform === 'desktop' ? 10 : 8;
  const choiceRow = platform === 'desktop'
    ? { x: (profile.canvas.width - 760) / 2 + 32, width: 760 - 64, height: rowHeight, gap }
    : { x: 10, width: profile.canvas.width - 20, height: rowHeight, gap };
  return {
    platform,
    flow: platform === 'desktop' ? 'wide-centered' : 'stacked-scroll',
    contentTop: template.regions.content.y,
    choiceBottom: platform === 'desktop'
      ? profile.canvas.height - profile.safe.bottom
      : template.regions.footer.y - 10,
    choiceBlockHeight: eventChoiceBlockHeight(choiceCount, rowHeight, gap),
    choiceRow,
  };
}

export interface RunEventSceneChoicePresentation {
  id: string;
  cost: number;
  title: string;
  detail: string;
  footer: string;
  iconKind: string;
  enabled: boolean;
  taken: boolean;
  opportunityHint?: EventOpportunityHint;
  /**
   * Pre-resolution CONFIRM copy for a rung whose outcome costs GOLD
   * (`cost > 0`) — `null` for a free rung, an already-resolved one, or a
   * `mergeCards` rung (which pauses through its OWN unconditional confirm,
   * `mergeConfirmBody`/`renderMergeConsumeConfirm`, naming the exact
   * consumed cards instead of this generic hint). The scene shows this
   * dialog BEFORE ever calling `resolveCurrentRunEventChoice` — the same
   * moment the gold is actually deducted (`resolveEventChoice`,
   * src/run/events.ts, charges the cost up front regardless of whether the
   * outcome resolves immediately or opens a picker) — never after.
   */
  costConfirm: { title: string; body: string } | null;
}

export interface RunEventSceneContext {
  biomeId: string;
  biomeName: string;
  biomeTagline: string;
  theme: RunEventViewModel['theme'];
  areaName: string;
  areaBlurb: string;
  rarityLabel: string | null;
  storyStageLabel: string | null;
  visibilityLabel: 'HIDDEN' | 'TEASED' | null;
  dueLabel: 'DUE CALLBACK' | null;
}

export interface RunEventScenePresentation {
  title: string;
  body: string;
  art: RunEventViewModel['art'];
  phase: RunEventViewModel['phase'];
  context: RunEventSceneContext;
  choices: readonly RunEventSceneChoicePresentation[];
  layout: RunEventSceneLayout;
}

function selectedHintText(
  hint: RunEventOutcomeHint,
  selectedId: string | undefined,
  state: RunState,
): string | null {
  if (selectedId === undefined || !('offer' in hint)) return null;
  const offer = hint.offer;
  if (hint.kind === 'cardChoice' && offer.kind === 'cardChoice') {
    const selected = offer.options.find((option) => option.skillId === selectedId);
    return selected === undefined ? null : `${skillBook[selected.skillId]?.name ?? selected.skillId} · ${selected.tier.toUpperCase()}`;
  }
  if (hint.kind === 'bonusDraft' && offer.kind === 'bonusDraft') {
    const selected = offer.options.find((option) => option.skillId === selectedId);
    return selected === undefined ? null : `${skillBook[selected.skillId]?.name ?? selected.skillId} · ${selected.tier.toUpperCase()}`;
  }
  if (hint.kind === 'gemChoice' && offer.kind === 'gemChoice') {
    return gemBook[selectedId]?.name ?? selectedId;
  }
  if ((hint.kind === 'upgradeCard' || hint.kind === 'upgradeCardTargeted')
    && (offer.kind === 'upgradeCard' || offer.kind === 'upgradeCardTargeted')) {
    const card = ownedCards(state).find((candidate) => candidate.instanceId === selectedId);
    return card === undefined ? `CARD ${selectedId}` : `${skillBook[card.skillId]?.name ?? card.skillId} · ${card.tier.toUpperCase()}`;
  }
  if (hint.kind === 'sellGem' && offer.kind === 'sellGem' && offer.status !== 'unavailable') {
    const selected = offer.options.find((option) => String(option.pouchIndex) === selectedId);
    return selected === undefined ? null : `${gemBook[selected.gemId]?.name ?? selected.gemId} · +${String(selected.price)} GOLD`;
  }
  if (hint.kind === 'mergeCards' && offer.kind === 'mergeCards' && offer.status !== 'unavailable') {
    const selected = offer.candidates.find((option) => option.skillId === selectedId);
    return selected === undefined ? null : `${skillBook[selected.skillId]?.name ?? selected.skillId} · ${selected.tier.toUpperCase()}`;
  }
  if (hint.kind === 'grantCard' && offer.kind === 'grantCard') {
    return `${skillBook[offer.card.skillId]?.name ?? offer.card.skillId} · ${offer.card.tier.toUpperCase()}`;
  }
  if (hint.kind === 'grantGem' && offer.kind === 'grantGem') {
    return gemBook[offer.gemId]?.name ?? offer.gemId;
  }
  return null;
}

/**
 * The mergeCards choice row's price line, computed FRESH off live `state` —
 * never off `choice.outcomeHint`'s persisted/legacy offer, which for this
 * outcome kind either does not exist yet (legacy schema-1 content, the only
 * kind the catalog authors today) or, if a future schema-3 `mergeCards` event
 * ever materializes one ahead of the tap, could go stale against a board the
 * player changed meanwhile (see `mergeCardsPreview`'s own doc comment — this
 * is the "re-derive the preview at render time" fix for exactly that risk).
 * `null` when the choice isn't a currently-usable mergeCards choice, so the
 * caller falls back to the ordinary "REWARD · ..." hint.
 */
function mergeRowDetail(choice: RunEventViewModel['choices'][number], state: RunState): string | null {
  if (choice.outcomeHint.kind !== 'mergeCards' || choice.locked) return null;
  const preview = mergeCardsPreview(state);
  if (!preview) return null;
  const spent = buildMergeSpentEntries(preview.consumed, state);
  return mergeRowPreviewText(spent);
}

function choicePresentation(
  choice: RunEventViewModel['choices'][number],
  phase: RunEventViewModel['phase'],
  state: RunState,
): RunEventSceneChoicePresentation {
  const terminal = phase.kind === 'terminal';
  const taken = terminal && phase.choiceId === choice.id;
  const outcomeText = eventOutcomeHintText(choice.outcomeHint);
  const equipmentText = choice.equipmentReward === undefined ? null : `EQUIPMENT · ${choice.equipmentReward.toUpperCase()}`;
  const hint = equipmentText === null ? outcomeText : outcomeText === '—' ? equipmentText : `${outcomeText} · ${equipmentText}`;
  const equipmentCostLabel = choice.equipmentCost === undefined
    ? null
    : (choice.equipmentCost.itemName ?? `YOUR ${choice.equipmentCost.slot}`).toUpperCase();
  const selected = taken ? selectedHintText(choice.outcomeHint, phase.selectedId, state) : null;
  const mergeDetail = terminal ? null : mergeRowDetail(choice, state);
  // Destructive, non-gold costs (mergeCards eats three cards, sellGem eats a
  // gem) get their own COST label rather than the gold-only "FREE" the
  // footer used to fall back to for every zero-gold rung — a rung that
  // destroys an owned card or gem is not "free" (2026-09-06 audit finding
  // 7), whatever it costs in gold. `mergeCards`'s row `detail` never reaches
  // the `REWARD ·`/`COST ·` fallback below either way (`mergeDetail` above
  // always wins when the rung is live), but the footer and the (rare, no
  // preview) fallback detail both still name it correctly.
  const destructiveCostLabel = choice.outcomeHint.kind === 'mergeCards'
    ? '3 CARDS' // a merge ALWAYS costs three cards — see mergeConfirmBody's doc comment.
    : choice.outcomeHint.kind === 'sellGem'
      ? '1 GEM'
      : null;
  const costConfirm = !terminal && equipmentCostLabel !== null && choice.equipmentCost?.itemName != null
    ? { title: `GIVE UP ${equipmentCostLabel}?`, body: `${hint}\nCosts your ${choice.equipmentCost.itemName}.` }
    : !terminal && choice.cost > 0 && choice.outcomeHint.kind !== 'mergeCards'
      ? { title: eventCostConfirmTitle(choice.cost), body: eventCostConfirmBody(hint, choice.cost) }
      : null;
  const detail = !terminal && choice.lockReason !== null
    ? `LOCKED · ${choice.lockReason}`
    : terminal
      ? `${taken ? 'TAKEN' : 'NOT TAKEN'} · ${hint}${selected === null ? '' : ` · ${selected}`}`
      : mergeDetail ?? `${destructiveCostLabel === null ? 'REWARD' : 'COST'} · ${hint}`;
  return {
    id: choice.id,
    cost: choice.cost,
    title: terminal || choice.derivedFamily === undefined
      ? choice.label
      : `${choice.label} — ${choice.derivedFamily}`,
    detail: !terminal && choice.opportunityHint !== undefined
      ? `${choice.opportunityHint} · ${detail}`
      : detail,
    footer: terminal
      ? (taken ? 'ALREADY TAKEN' : 'NOT TAKEN')
      : equipmentCostLabel !== null
        ? `COST ${equipmentCostLabel}`
        : choice.cost > 0 && destructiveCostLabel !== null
        ? `COST ${String(choice.cost)} GOLD + ${destructiveCostLabel}`
        : choice.cost > 0
          ? `COST ${String(choice.cost)} GOLD`
          : destructiveCostLabel !== null
            ? `COST ${destructiveCostLabel}`
            : 'FREE',
    iconKind: choice.outcomeHint.kind,
    enabled: !terminal && !choice.locked,
    taken,
    ...(choice.opportunityHint === undefined ? {} : { opportunityHint: choice.opportunityHint }),
    costConfirm,
  };
}

export function buildRunEventScenePresentation(
  view: RunEventViewModel,
  state: RunState,
  platform: RunTemplatePlatform,
): RunEventScenePresentation {
  const node = currentEventNode(state);
  const biome = biomeFor(state.map.seed, node?.wave ?? 1, node?.biomeId);
  const area = eventThemeArea(view.theme);
  const recap = view.recap;
  return {
    title: view.title,
    body: recap === undefined ? view.body : `THE WORLD REMEMBERS\n${recap}\n\n${view.body}`,
    art: view.art,
    phase: view.phase,
    context: {
      biomeId: biome.id,
      biomeName: biome.name,
      biomeTagline: biome.tagline,
      theme: view.theme,
      areaName: area.name,
      areaBlurb: area.blurb,
      rarityLabel: view.rarity === 'common' ? null : view.rarity.toUpperCase(),
      storyStageLabel: view.story?.stage.toUpperCase() ?? null,
      visibilityLabel: view.visibility === 'hidden_until_eligible'
        ? 'HIDDEN'
        : view.visibility === 'teased_when_due' ? 'TEASED' : null,
      dueLabel: view.isDueCallback ? 'DUE CALLBACK' : null,
    },
    choices: view.choices.map((choice) => choicePresentation(choice, view.phase, state)),
    layout: runEventSceneLayout(platform, view.choices.length),
  };
}

export type RunEventUpgradePickerOption =
  | (UpgradeCardOption & { available: true })
  | { instanceId: string; available: false; fallbackLabel: string };

type CardPicker = {
  kind: 'cardChoice' | 'bonusDraft';
  options: readonly EventCardOfferV3[];
  optionCount: number;
};

type UpgradePicker = {
  kind: 'upgradeCardTargeted' | 'upgradeCard';
  options: readonly RunEventUpgradePickerOption[];
  optionCount: number;
};

type GemPicker = { kind: 'gemChoice'; options: readonly string[]; optionCount: number };
type SellPicker = { kind: 'sellGem'; options: readonly SellGemOption[]; optionCount: number };
export type MergePicker = {
  kind: 'mergeCards';
  owned: readonly MergeSpentEntry[];
  rewardsFor: (instanceIds: readonly string[]) => MergeTrioRewards | null;
  optionCount: number;
};

function mergePicker(state: RunState, candidateSkillIds: readonly string[]): MergePicker {
  return {
    kind: 'mergeCards',
    owned: buildMergeSpentEntries(mergeableOwnedCards(state), state),
    rewardsFor: (instanceIds) => mergeTrioRewards(state, instanceIds, candidateSkillIds),
    optionCount: candidateSkillIds.length,
  };
}
export type StatPicker = { kind: 'buyStatPick'; options: readonly MarketStatPickOption[]; optionCount: number };

export type ReshapePicker = {
  kind: 'reshapeCard';
  mode: EventReshapeModeV3;
  options: readonly { instanceId: string; skillId: string; tier: SkillTier; resultSkillId?: string; resultTier?: SkillTier; where?: string }[];
  reward?: ReshapeReward;
  optionCount: number;
};

function ownedWhere(state: RunState, instanceId: string): string | undefined {
  const piece = state.pieces.find((card) => card.instanceId === instanceId);
  if (piece) return `BOARD ${piece.slot + 1}`;
  return state.bagSlots.some((card) => card?.instanceId === instanceId) ? 'BAG' : undefined;
}

export type ReshapeGemPicker = {
  kind: 'reshapeGem';
  mode: EventReshapeGemModeV3;
  options: readonly EventReshapeGemOptionV3[];
  optionCount: number;
};

export type RerollCardPicker = {
  kind: 'rerollCard';
  options: readonly { instanceId: string; skillId: string; tier: SkillTier }[];
  rolled?: { skillId: string; tier: SkillTier; rollsLeft: number };
  optionCount: number;
};

export type RerollGemPicker = {
  kind: 'rerollGem';
  options: readonly { pouchIndex: number; gemId: string }[];
  rolled?: { gemId: string; rollsLeft: number };
  optionCount: number;
};

export interface EquipmentPickerOption {
  id: string;
  itemId: string;
  title: string;
  detail: string;
  footer: string;
  enabled: boolean;
}

export type EquipmentPicker = {
  kind: 'forgeEquipment' | 'upgradeEquipment';
  options: readonly EquipmentPickerOption[];
  broken: number;
  optionCount: number;
};

function equipmentPicker(state: RunState, offer: { kind: 'forgeEquipment' | 'upgradeEquipment'; sets: readonly string[]; items?: readonly string[] }): EquipmentPicker {
  const broken = brokenPieces(state);
  const describe = (itemId: string, itemVersion: number, level: number) => {
    const def = equipmentCatalog.item(itemId, itemVersion);
    const set = def.setId === undefined ? 'NO SET' : `${equipmentCatalog.set(def.setId, equipmentDocument.sets.find((entry) => entry.id === def.setId)!.versions.at(-1)!.version).name.toUpperCase()} SET`;
    return { def, stats: equipmentModifierClauses(leveledStatMods(def, level)).join(' · '), set };
  };
  const options: EquipmentPickerOption[] = offer.kind === 'forgeEquipment'
    ? forgeOptions(offer).map((option) => {
      const { def, stats, set } = describe(option.itemId, option.itemVersion, 0);
      return { id: option.itemId, itemId: option.itemId, title: def.name, detail: `${def.slot.toUpperCase()} · ${stats} · ${set}`, footer: `COST ${FORGE_COST} BROKEN`, enabled: broken >= FORGE_COST };
    })
    : upgradeOptions(state, offer).map((option) => {
      const { def } = describe(option.itemId, option.itemVersion, option.level);
      const next = equipmentModifierClauses(leveledStatMods(def, option.level + 1)).join(' · ');
      return { id: option.instanceId, itemId: option.itemId, title: option.level > 0 ? `${def.name} +${option.level}` : def.name, detail: `→ +${option.level + 1} · ${next}`, footer: `COST ${option.cost} BROKEN`, enabled: option.affordable };
    });
  return { kind: offer.kind, options, broken, optionCount: options.length };
}

export type RunEventPickerPresentation = CardPicker | UpgradePicker | GemPicker | SellPicker | MergePicker | StatPicker | ReshapePicker | ReshapeGemPicker | RerollCardPicker | RerollGemPicker | EquipmentPicker;
export type RunEventPresentableOutcome = EventOutcome | EventOutcomeV3;
export type RunEventOutcomePresentation =
  | { kind: 'picker'; picker: RunEventPickerPresentation }
  | { kind: 'result'; outcome: RunEventPresentableOutcome }
  | { kind: 'ignored' };

function ownedCards(state: RunState): RunCard[] {
  return [
    ...state.pieces,
    ...state.bagSlots.filter((card): card is RunCard => card !== null),
    ...(state.held == null ? [] : [state.held]),
  ];
}

function upgradePickerOptions(
  ids: readonly string[],
  state: RunState,
): readonly RunEventUpgradePickerOption[] {
  const cards = ownedCards(state);
  return ids.map((instanceId) => {
    const card = cards.find((candidate) => candidate.instanceId === instanceId);
    const to = card === undefined ? null : nextSkillTier(card.tier);
    return card === undefined || to === null
      ? { instanceId, available: false, fallbackLabel: 'CARD NO LONGER OWNED · RESOLVE FALLBACK' }
      : { instanceId, skillId: card.skillId, from: card.tier, to, available: true };
  });
}

/** Adapt legacy transient questions and V3 persisted questions into the one
 * picker vocabulary both scenes render. V3 data is copied, never rerolled. */
export function presentRunEventOutcome(
  outcome: RunEventPresentableOutcome,
  state: RunState,
): RunEventOutcomePresentation {
  switch (outcome.kind) {
    case 'cardChoice':
      return { kind: 'picker', picker: { kind: 'cardChoice', options: outcome.offer.options, optionCount: outcome.offer.options.length } };
    case 'bonusDraft': {
      const options = 'offer' in outcome ? outcome.offer.options : outcome.cards;
      return { kind: 'picker', picker: { kind: 'bonusDraft', options, optionCount: options.length } };
    }
    case 'upgradeCardTargeted': {
      const options = upgradePickerOptions(outcome.offer.optionInstanceIds, state);
      return { kind: 'picker', picker: { kind: 'upgradeCardTargeted', options, optionCount: options.length } };
    }
    case 'upgradeCard':
      if ('offer' in outcome) {
        const options = upgradePickerOptions(outcome.offer.optionInstanceIds, state);
        return { kind: 'picker', picker: { kind: 'upgradeCard', options, optionCount: options.length } };
      }
      return { kind: 'result', outcome };
    case 'upgradeCardPick': {
      const options = outcome.options.map((option) => ({ ...option, available: true as const }));
      return { kind: 'picker', picker: { kind: 'upgradeCard', options, optionCount: options.length } };
    }
    case 'gemChoice':
      return { kind: 'picker', picker: { kind: 'gemChoice', options: outcome.offer.optionGemIds, optionCount: outcome.offer.optionGemIds.length } };
    case 'gemChoicePick':
      return { kind: 'picker', picker: { kind: 'gemChoice', options: outcome.options, optionCount: outcome.options.length } };
    case 'sellGem':
      if ('offer' in outcome) {
        return { kind: 'picker', picker: { kind: 'sellGem', options: outcome.offer.options, optionCount: outcome.offer.options.length } };
      }
      return { kind: 'result', outcome };
    case 'sellGemPick':
      return { kind: 'picker', picker: { kind: 'sellGem', options: outcome.options, optionCount: outcome.options.length } };
    case 'mergeCards':
      return { kind: 'picker', picker: mergePicker(state, outcome.offer.candidates.map((candidate) => candidate.skillId)) };
    case 'mergeCardsPick':
      return { kind: 'picker', picker: mergePicker(state, outcome.candidates.map((candidate) => candidate.skillId)) };
    case 'alreadySettled':
      return { kind: 'ignored' };
    case 'grantCard':
    case 'grantGem':
    case 'grantGold':
    case 'loseGold':
    case 'grantLevel':
    case 'grantMapInfo':
    case 'buyLife':
    case 'buyStat':
    case 'grantStat':
    case 'nothing':
    case 'cardGranted':
    case 'cardUpgraded':
      return { kind: 'result', outcome };
    // Not yet wired to a real picker — no catalog content authors
    // `awardCardPoint` yet (run-layer only, see src/run/events.ts); a later
    // task adds both the content and this picker's real rendering. Routed as
    // a plain result for now so the exhaustiveness guard compiles.
    case 'awardCardPoint':
    case 'awardCardPointPick':
      return { kind: 'result', outcome };
    case 'buyStatPick': {
      const options = marketStatPickOptions(state);
      return { kind: 'picker', picker: { kind: 'buyStatPick', options, optionCount: options.length } };
    }
    // The scene intercepts `challengeFight` before it ever reaches
    // `presentRunEventOutcome` (launches the battle instead) — this arm only
    // keeps the exhaustiveness guard compiling.
    case 'challengeFight':
      return { kind: 'ignored' };
    case 'reshapeCard':
      return {
        kind: 'picker',
        picker: {
          kind: 'reshapeCard', mode: outcome.offer.mode,
          options: outcome.offer.options.map((option) => {
            const where = ownedWhere(state, option.instanceId);
            return {
              instanceId: option.instanceId, skillId: option.skillId, tier: option.tier,
              ...((outcome.offer.mode === 'trade' || outcome.offer.mode === 'retype') && option.resultSkillId !== undefined ? { resultSkillId: option.resultSkillId } : {}),
              ...((outcome.offer.mode === 'trade' || outcome.offer.mode === 'shatter') && option.resultTier !== undefined ? { resultTier: option.resultTier } : {}),
              ...(where === undefined ? {} : { where }),
            };
          }),
          ...(outcome.offer.reward === undefined ? {} : { reward: outcome.offer.reward }),
          optionCount: outcome.offer.options.length,
        },
      };
    case 'cardReshaped':
      return { kind: 'result', outcome };
    case 'reshapeGem':
      return {
        kind: 'picker',
        picker: { kind: 'reshapeGem', mode: outcome.offer.mode, options: outcome.offer.options, optionCount: outcome.offer.options.length },
      };
    case 'gemReshaped':
    case 'grantShopRerolls':
    case 'cardRerolled':
    case 'gemRerolled':
      return { kind: 'result', outcome };
    case 'rerollCard': {
      const rolled = outcome.offer.rolled;
      const card = rolled === undefined ? undefined : ownedCards(state).find((entry) => entry.instanceId === rolled.instanceId);
      return {
        kind: 'picker',
        picker: {
          kind: 'rerollCard',
          options: outcome.offer.options,
          ...(rolled === undefined ? {} : { rolled: { skillId: rolled.skillId, tier: card?.tier ?? 'bronze', rollsLeft: outcome.offer.rolls - rolled.rollsUsed } }),
          optionCount: rolled === undefined ? outcome.offer.options.length : 1,
        },
      };
    }
    case 'rerollGem': {
      const rolled = outcome.offer.rolled;
      return {
        kind: 'picker',
        picker: {
          kind: 'rerollGem',
          options: outcome.offer.options,
          ...(rolled === undefined ? {} : { rolled: { gemId: rolled.gemId, rollsLeft: outcome.offer.rolls - rolled.rollsUsed } }),
          optionCount: rolled === undefined ? outcome.offer.options.length : 1,
        },
      };
    }
    case 'forgeEquipment':
    case 'upgradeEquipment':
      return { kind: 'picker', picker: equipmentPicker(state, outcome.offer) };
    case 'equipmentForged':
    case 'equipmentUpgraded':
      return { kind: 'result', outcome };
    default: {
      const exhaustive: never = outcome;
      throw new Error(`presentRunEventOutcome: unknown outcome ${(exhaustive as RunEventPresentableOutcome).kind}`);
    }
  }
}
