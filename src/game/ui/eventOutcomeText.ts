import type { EventOutcomeSpec } from '../../data/events';
import type { EventOutcome, MergeCardsReceipt } from '../../run/events';
import { skillBook } from '../../data/skills';
import { mergeTradeLine } from './runMergeViewModel';

/** Display name for a skill id — falls back to the raw id if somehow unknown
 * (should never happen for a live event outcome, but never crash a scene over it). */
function skillName(skillId: string): string {
  return skillBook[skillId]?.name ?? skillId;
}

/** Short inline reward hint shown on a choice button ("→ CARD (BRONZE)",
 * "→ +2 GOLD"…). */
export function choiceOutcomeHint(outcome: EventOutcomeSpec): string {
  switch (outcome.kind) {
    case 'grantCard': {
      // A `cardId`-pinned choice (e.g. veterans_last_lesson's "take the
      // veteran's blade", ruined_anvil's two same-card-different-tier
      // choices) names an EXACT card — show its real name, not the generic
      // "CARD (TIER)" placeholder, so two choices offering different tiers
      // of the same known card actually read as different (previously both
      // rendered as indistinguishable "CARD (TIER)" text). A `filter`-driven
      // (or filterless) choice still doesn't know WHICH card it'll resolve
      // to until the seeded roll happens, so it keeps the generic form —
      // labeled "RANDOM" rather than bare "CARD" so a player isn't misled
      // into thinking it's also fixed.
      const tierSuffix = outcome.tier ? ` (${outcome.tier.toUpperCase()})` : '';
      if (outcome.cardId) return `${skillName(outcome.cardId).toUpperCase()}${tierSuffix}`;
      return `RANDOM CARD${tierSuffix}`;
    }
    case 'grantGem': return 'GEM';
    case 'grantGold': return `+${outcome.amount} GOLD`;
    case 'loseGold': return `-${outcome.amount} GOLD`;
    case 'grantLevel': return '+1 LEVEL';
    case 'bonusDraft': return 'MINI-DRAFT';
    // `cardChoice`/`gemChoice` (2026-08-18 agency pass) are a "pick 1 of 3"
    // deferred offer, not a guaranteed single item — say so up front, since
    // the width IS the point of the widening (see `EVENT_CHOICE_SIZE`'s doc
    // comment in `src/run/events.ts`): a player who reads this as an ordinary
    // "you get a card/gem" hint gets none of the agency the choice offers.
    case 'cardChoice': return 'CHOICE OF 3 CARDS';
    case 'gemChoice': return 'CHOICE OF 3 GEMS';
    case 'upgradeCard': return 'UPGRADE';
    // `sellGem` (2026-08-20) — nets gold, doesn't grant anything; say so up
    // front so this doesn't read like every other "GEM" hint above (a gain),
    // which would misrepresent a choice that spends a gem to earn gold.
    case 'sellGem': return 'SELL A GEM';
    // `mergeCards` (2026-08-26 run layer, wired up 2026-08-28) — the only
    // DESTRUCTIVE card outcome in the vocabulary, and the hint has to say so
    // before the row is tapped: "3 CARDS" is what LEAVES, "1 BETTER" is what
    // arrives. Deliberately not "UPGRADE" (that's `upgradeCard`, which costs
    // gold and destroys nothing) and not a bare "MERGE", which names the verb
    // without naming the price. The exact trade (which tier, which three
    // instances, which three candidates) is not knowable from the SPEC — it is
    // a function of what the player owns at that moment — so it is shown on the
    // picker screen the tap opens, before anything is spent.
    case 'mergeCards': return '3 CARDS → 1 BETTER';
    case 'nothing': return '—';
    default: return '';
  }
}

/**
 * Headline + detail for a merge that HAS BEEN TAKEN, read straight off
 * `applyMergeCardsPick`'s `MergeCardsReceipt` — never recomputed here. The run
 * layer already decided which three instances were consumed and which card
 * arrived; this only words it.
 *
 * WHY IT EXISTS AT ALL: merge is the only DESTRUCTIVE card outcome in the
 * vocabulary, and its resolved outcome is a plain `grantCard`, so without the
 * receipt the outcome screen said exactly what a free card says — "Gained a
 * SILVER card" — for a trade that just ate three of the player's cards. A
 * mis-tap had no confirmation of what was lost.
 *
 * SAME VOCABULARY AS THE PICKER, deliberately: the headline is the picker's own
 * `mergeTradeLine` ("3 BRONZE → 1 SILVER"), and the detail opens on SPENT — the
 * word the picker's own `spentCaption` ("THESE THREE ARE SPENT") uses for the
 * same three cards. The screen that asked and the screen that confirms say the
 * same thing about the same trade; no second phrasing was invented.
 *
 * The three spent cards are listed by NAME (not by name + where they sat, which
 * is what the picker chips show): the location was there to disambiguate WHICH
 * copy is about to be eaten while it could still be avoided. Afterwards there is
 * nothing left to disambiguate — what is owed the player is the identity of
 * what left.
 */
export function mergeReceiptText(receipt: MergeCardsReceipt): { headline: string; detail: string } {
  const spent: string[] = [];
  for (let i = 0; i < receipt.consumed.length; i += 1) spent.push(skillName(receipt.consumed[i]!.skillId));
  return {
    headline: mergeTradeLine(receipt.consumed.length, receipt.from, receipt.to),
    detail: `SPENT ${spent.join(' · ')}\nARRIVED ${skillName(receipt.taken.skillId)}`,
  };
}

/** Headline + detail line for a RESOLVED outcome (what actually happened),
 * for the event scene's outcome panel. The headline is the one-line summary;
 * `detail` (may be empty) adds fallback context. */
export function outcomeHeadline(outcome: EventOutcome): { headline: string; detail: string } {
  switch (outcome.kind) {
    case 'grantCard':
      return outcome.fellBack
        ? { headline: 'Bag was full — took gold instead', detail: '' }
        : { headline: `Gained a ${outcome.tier.toUpperCase()} card`, detail: '' };
    case 'grantGem':
      return { headline: 'Gained a gem', detail: '' };
    case 'grantGold':
      return outcome.fellBack
        ? { headline: `Bag was full — gained ${outcome.amount} gold instead`, detail: '' }
        : { headline: `Gained ${outcome.amount} gold`, detail: '' };
    case 'loseGold':
      return { headline: `Lost ${outcome.amount} gold`, detail: '' };
    case 'grantLevel':
      return { headline: `Hero levels up → LV ${outcome.level}`, detail: '' };
    case 'bonusDraft':
      return { headline: 'Pick a card to keep', detail: '' };
    // Unreachable in practice — the scenes render `upgradeCardPick` through
    // `renderRunUpgradeCardPicker` directly, never through this resolved-
    // outcome headline (same as `bonusDraft` above, which also never reaches
    // here). Kept only so the exhaustiveness guard below stays meaningful.
    case 'upgradeCardPick':
      return { headline: 'Choose a card to upgrade', detail: '' };
    // Unreachable in practice — same reason as `upgradeCardPick`/`bonusDraft`
    // above: the scenes render `gemChoicePick` through
    // `renderRunGemChoicePicker` directly, never through this resolved-
    // outcome headline. Kept only so the exhaustiveness guard below stays
    // meaningful.
    case 'gemChoicePick':
      return { headline: 'Choose a gem to keep', detail: '' };
    // Unreachable in practice — same reason as `upgradeCardPick`/
    // `gemChoicePick` above: the scenes render `sellGemPick` through
    // `renderRunSellGemPicker` directly, never through this resolved-outcome
    // headline. Kept only so the exhaustiveness guard below stays meaningful.
    case 'sellGemPick':
      return { headline: 'Choose a gem to sell', detail: '' };
    case 'sellGem':
      return { headline: `Sold a gem for ${outcome.price} gold`, detail: '' };
    // Unreachable in practice — same reason as `upgradeCardPick`/
    // `gemChoicePick`/`sellGemPick` above: the scenes render `mergeCardsPick`
    // through `renderRunMergeCardsPicker` directly, never through this
    // resolved-outcome headline. Kept so the exhaustiveness guard below stays
    // meaningful — and it is exactly this guard that kept the merge event from
    // shipping half-wired: the run-layer pass could not add the union member
    // without landing a case here, so it parked the offer on a side field
    // instead. The case now exists; the side field is gone.
    case 'mergeCardsPick':
      return { headline: `Choose what your three ${outcome.from.toUpperCase()} cards become`, detail: '' };
    case 'upgradeCard':
      return outcome.fellBack
        ? { headline: 'Nothing eligible to upgrade — took gold instead', detail: '' }
        : {
            headline: `Your ${skillName(outcome.skillId!)} is re-tempered — ${outcome.from!.toUpperCase()} → ${outcome.to!.toUpperCase()}.`,
            detail: '',
          };
    case 'nothing':
      return { headline: 'Nothing happens', detail: '' };
    default: {
      // Exhaustiveness guard (same idiom as `applySpec` in src/run/events.ts):
      // a future `EventOutcome` kind added to the union without a case here
      // fails to COMPILE rather than silently rendering an icon with no text.
      const exhaustive: never = outcome;
      throw new Error(`outcomeHeadline: unknown outcome kind "${(exhaustive as EventOutcome).kind}"`);
    }
  }
}
