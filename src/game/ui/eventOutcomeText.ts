import type { EventChoiceOutcome } from '../../data/events';
import type { EventOutcome } from '../../run/events';
import { skillBook } from '../../data/skills';

/** Display name for a skill id — falls back to the raw id if somehow unknown
 * (should never happen for a live event outcome, but never crash a scene over it). */
function skillName(skillId: string): string {
  return skillBook[skillId]?.name ?? skillId;
}

/** Short inline reward hint shown on a choice button ("→ CARD (BRONZE)",
 * "→ +2 GOLD", "→ GAMBLE"…) — gambles telegraph as "GAMBLE" since the exact
 * odds/stakes are already spelled out in the choice label/event body
 * (docs/run-events-design.md §2: "gambles must telegraph stakes in the body
 * text"), not re-derived here. */
export function choiceOutcomeHint(outcome: EventChoiceOutcome): string {
  if (outcome.kind === 'gamble') return 'GAMBLE';
  switch (outcome.kind) {
    case 'grantCard': return `CARD${outcome.tier ? ` (${outcome.tier.toUpperCase()})` : ''}`;
    case 'grantGem': return 'GEM';
    case 'grantGold': return `+${outcome.amount} GOLD`;
    case 'loseGold': return `-${outcome.amount} GOLD`;
    case 'grantLevel': return '+1 LEVEL';
    case 'bonusDraft': return 'MINI-DRAFT';
    case 'upgradeCard': return 'UPGRADE';
    case 'nothing': return '—';
    default: return '';
  }
}

/** Headline + detail line for a RESOLVED outcome (what actually happened),
 * for the event scene's outcome panel. The headline is the one-line summary;
 * `detail` (may be empty) adds gamble/fallback context. */
export function outcomeHeadline(outcome: EventOutcome): { headline: string; detail: string } {
  switch (outcome.kind) {
    case 'grantCard':
      return outcome.fellBack
        ? { headline: 'Bag was full — took gold instead', detail: '' }
        : { headline: `Gained a ${outcome.tier.toUpperCase()} card`, detail: outcome.gambled ? 'The gamble paid off.' : '' };
    case 'grantGem':
      return { headline: 'Gained a gem', detail: outcome.gambled ? 'The gamble paid off.' : '' };
    case 'grantGold':
      return outcome.fellBack
        ? { headline: `Bag was full — gained ${outcome.amount} gold instead`, detail: '' }
        : { headline: `Gained ${outcome.amount} gold`, detail: outcome.gambled ? 'The gamble paid off.' : '' };
    case 'loseGold':
      return { headline: `Lost ${outcome.amount} gold`, detail: '' };
    case 'grantLevel':
      return { headline: `Hero levels up → LV ${outcome.level}`, detail: '' };
    case 'bonusDraft':
      return { headline: 'Pick a card to keep', detail: '' };
    case 'upgradeCard':
      return outcome.fellBack
        ? { headline: 'Nothing eligible to upgrade — took gold instead', detail: '' }
        : {
            headline: `Your ${skillName(outcome.skillId!)} is re-tempered — ${outcome.from!.toUpperCase()} → ${outcome.to!.toUpperCase()}.`,
            detail: outcome.gambled ? 'The gamble paid off.' : '',
          };
    case 'nothing':
      return { headline: outcome.gambled ? 'The gamble came up empty' : 'Nothing happens', detail: '' };
    default: {
      // Exhaustiveness guard (same idiom as `applySpec` in src/run/events.ts):
      // a future `EventOutcome` kind added to the union without a case here
      // fails to COMPILE rather than silently rendering an icon with no text.
      const exhaustive: never = outcome;
      throw new Error(`outcomeHeadline: unknown outcome kind "${(exhaustive as EventOutcome).kind}"`);
    }
  }
}
