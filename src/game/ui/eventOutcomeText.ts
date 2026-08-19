import type { EventOutcomeSpec } from '../../data/events';
import type { EventOutcome } from '../../run/events';
import { skillBook } from '../../data/skills';

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
    case 'nothing': return '—';
    default: return '';
  }
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
