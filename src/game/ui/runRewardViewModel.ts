import type { EventOutcome, MergeCardsReceipt } from '../../run/events';
import type { SkillDef } from '../../engine/types';
import { applyTier } from '../../engine/cards';
import { skillBook } from '../../data/skills';
import { gemBook, type GemDef } from '../../data/gems';
import { choiceArtKey } from './runArtKeys';
import { mergeReceiptText, outcomeHeadline } from './eventOutcomeText';

/**
 * The reward's own feature visual — the ONE part `RunRewardPanel.ts` branches
 * on for WHICH VISUAL to draw (never for layout, see that module's doc
 * comment). Every `EventOutcome` kind maps to exactly one of these three:
 * `grantCard` → `card`, `grantGem` → `gem`, everything else (gold/level/
 * nothing/upgrade/fallback) → `icon` (a bigger version of the same icon
 * shown up top, so the feature slot is never empty).
 */
export type RunRewardFeature =
  | { kind: 'card'; skill: SkillDef }
  | { kind: 'gem'; gem: GemDef }
  | { kind: 'icon' };

/**
 * The single view model every resolved event outcome renders through —
 * `RunChoiceViewModel`'s counterpart for the REWARD side of an event. Built
 * once here (pure, no Phaser) from the domain `EventOutcome`; the renderer
 * (`RunRewardPanel.ts`) never re-derives text or re-branches on
 * `EventOutcome['kind']` — it only reads this model's `feature.kind` to pick
 * which visual (CardToken / gem chip / plain icon) fills the feature slot.
 */
export interface RunRewardViewModel {
  /** Texture key for the small top-of-panel outcome icon (`choiceArtKey`). */
  iconKey: string;
  /** "Gained a BRONZE card" — the one-line (up to 2) summary. */
  headline: string;
  /** Optional second line for fallback/context text. */
  detail?: string;
  feature: RunRewardFeature;
}

/** Pure mapping from a resolved `EventOutcome` to the one reward template —
 * `DesktopRunEventScene`/`MobileRunEventScene` both call this instead of
 * building their own per-kind display, so a new outcome kind only needs a
 * case added HERE, never in either scene. No Phaser import anywhere in this
 * module's dependency chain (deliberately imports `choiceArtKey` from
 * `runArtKeys.ts`, not the Phaser-touching `runArt.ts`) — unit tested
 * directly in tests/game/runRewardViewModel.test.ts.
 *
 * `merged` is `applyMergeCardsPick`'s RECEIPT (`runStore.ts`'s
 * `applyCurrentMergeCardsPick` returns it beside the outcome), present only
 * when this `grantCard` is the far side of a CARD MERGE. It is what makes the
 * one destructive outcome in the vocabulary legible after the fact: the same
 * `grantCard` that means "a free card arrived" also means "three of your cards
 * were eaten and this is what they became", and only the receipt can tell the
 * two apart. When it is present the headline/detail come from
 * `mergeReceiptText` instead of `outcomeHeadline`; the FEATURE is unchanged —
 * the card that arrived is still the subject of the screen.
 *
 * Nothing here recomputes any part of the trade (which three cards, which
 * tiers): the receipt is read, never re-derived, exactly as the picker reads
 * `MergeCardsOffer.consumed` rather than working out what would be spent. */
export function buildRunRewardViewModel(outcome: EventOutcome, merged?: MergeCardsReceipt): RunRewardViewModel {
  const { headline, detail } = merged && outcome.kind === 'grantCard' && !outcome.fellBack
    ? mergeReceiptText(merged)
    : outcomeHeadline(outcome);
  const iconKey = choiceArtKey(outcome.kind);

  let feature: RunRewardFeature = { kind: 'icon' };
  if (outcome.kind === 'grantCard' && !outcome.fellBack) {
    const skill = skillBook[outcome.skillId];
    if (skill) feature = { kind: 'card', skill: outcome.tier === skill.tier ? skill : applyTier(skill, outcome.tier) };
  } else if (outcome.kind === 'grantGem') {
    const gem = gemBook[outcome.gemId];
    if (gem) feature = { kind: 'gem', gem };
  }

  return { iconKey, headline, detail: detail || undefined, feature };
}
