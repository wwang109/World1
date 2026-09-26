import type { EventOutcomeSpec, MarketStat } from '../../data/events';
import type { EventOutcome, MergeCardsReceipt } from '../../run/events';
import type { EventOutcomeV3 } from '../../run/eventsV3';
import { LIVES_PER_RUN } from '../../run/runState';
import type { SkillTier } from '../../engine/types';
import { skillBook } from '../../data/skills';
import { gemBook } from '../../data/gems';
import { mergeTradeLine, type MergeSpentEntry } from './runMergeViewModel';
import type { RunEventOutcomeHint } from './runEventViewModel';

/** Display name for a skill id — falls back to the raw id if somehow unknown
 * (should never happen for a live event outcome, but never crash a scene over it). */
function skillName(skillId: string): string {
  return skillBook[skillId]?.name ?? skillId;
}

export const MARKET_STAT_LABEL: Record<MarketStat, string> = {
  attack: '+1 ATTACK',
  armor: '+1 ARMOR',
  maxHp: '+5 MAX HP',
};

/**
 * Terse in-place confirmation for a market buy that keeps its node OPEN for
 * another purchase (`isMarketBuyOutcomeKind`, `src/run/market.ts`) — keyed off
 * the RESOLVED OUTCOME, never the clicked choice or row label, so it reads the
 * same whether the buy came from a direct rung (`buyLife`) or a picker
 * (`buyStat`). `null` for every non-market outcome. Reuses `MARKET_STAT_LABEL`,
 * the one stat-buy wording every other market surface already prints.
 */
export function marketPurchaseConfirmText(outcome: EventOutcome | EventOutcomeV3): string | null {
  if (outcome.kind === 'buyLife') return 'LIFE RESTORED';
  if (outcome.kind === 'buyStat') return MARKET_STAT_LABEL[outcome.stat];
  return null;
}

/** "Shadow Bolt (BOARD 1)" — ONE consumed card, named AND placed. The single
 * per-card phrase the pre-resolution confirm dialog uses for each of its
 * lines (`mergeConfirmBody` below) — there is room there for the full name
 * plus WHERE it sits; the choice row's own single-line budget does not have
 * that much room (see `mergeRowPreviewText`'s doc comment), so the row omits
 * it and confirms it here instead. */
function mergeSpentPhrase(entry: MergeSpentEntry): string {
  return `${entry.name} (${entry.whereLabel})`;
}

/**
 * The mergeCards choice ROW's pre-tap price line — enough to tell the player
 * THIS rung eats cards before they tap it, without gambling on fitting every
 * name on one line.
 *
 * THIS USED TO NAME EVERY CARD ("SPENDS Shadow Bolt · Prism Barrier · Line
 * Breaker") and its own doc comment here used to claim "nothing here ever
 * drops one" — FALSE, per a real measurement (2026-09-06 audit): the choice
 * row shares its `detail` line's height with every other choice's plain
 * "REWARD · ..." hint (`RunChoicePanel.ts`'s `runChoicePanelMinHeight`
 * reserves exactly one line), and at mobile's 300px detail column and
 * `font.small`, the three-name line overflows that one-line budget for the
 * three longest bronze-offerable names AND for 1.6% of every distinct bronze
 * trio in the catalog (16,544 of 1,004,731) — `auditTextBlock` shrinks the
 * font first, but once shrinking bottoms out at `TEXT_SHRINK_FLOOR_PX` it
 * falls back to a truncating ellipsis, which would silently drop the third
 * name (the exact bug this whole pass exists to close, just relocated onto
 * the row instead of fixed).
 *
 * So the row states a COUNT instead: "SPENDS 3 CARDS · TAP TO SEE WHICH".
 * This is safe to do NOW (it would not have been safe before) because the
 * pre-resolution CONFIRM dialog (`mergeConfirmBody` below,
 * `renderMergeConsumeConfirm`, RunProgressStrip.ts) is UNCONDITIONAL as of
 * the same pass (a merge always costs three cards, so it always pauses
 * there before resolving, whether the trio is bag-only or touches the
 * board) and names every consumed card AND where it sits, full fidelity,
 * before anything is spent. The row only has to promise the confirm is
 * coming; the confirm is the actual disclosure.
 */
export function mergeRowPreviewText(spent: readonly MergeSpentEntry[]): string {
  return `SPENDS ${spent.length} CARD${spent.length === 1 ? '' : 'S'} · TAP TO SEE WHICH`;
}

/**
 * Pre-resolution CONFIRM copy for a rung whose outcome costs GOLD
 * (`choice.cost > 0`) — every kind EXCEPT `mergeCards`, which gets its own
 * richer confirm (`mergeConfirmBody` below) naming the exact consumed
 * instances instead of a generic hint. One line naming what the gold buys —
 * the SAME `hint` text `eventOutcomeHintText` already puts on the choice
 * row's own "REWARD · ..." line, so the confirm can never promise something
 * the row didn't — one line naming the price.
 */
export function eventCostConfirmTitle(cost: number): string {
  return `SPEND ${cost} GOLD?`;
}
export function eventCostConfirmBody(hint: string, cost: number): string {
  return `${hint}\nCosts ${cost} gold.`;
}

/**
 * Pre-resolution CONFIRM copy for the `sellGem` picker's own tap. Unlike
 * `mergeCards` (whose three consumed instances are the run layer's decision,
 * knowable before the picker even opens), WHICH gem leaves the pouch here is
 * the PLAYER's choice, made inside the picker itself — so this confirm sits
 * at that later point (the picker's `onPick`, both RunEvent scenes) rather
 * than before the picker opens, once the exact gem and its price are known.
 */
export function sellGemConfirmTitle(gemId: string): string {
  const name = gemBook[gemId]?.name ?? gemId;
  return `SELL ${name.toUpperCase()}?`;
}
export function sellGemConfirmBody(price: number): string {
  return `+${price} GOLD`;
}

/**
 * The pre-resolution CONFIRM dialog's body (`renderMergeConsumeConfirm`,
 * RunProgressStrip.ts) — the trade headline (`mergeTradeLine`, the SAME
 * phrasing the picker's title and the resolved receipt already use) over one
 * line per consumed card, named AND placed. UNCONDITIONAL (2026-09-06 user
 * ruling: a merge always costs three cards, so this dialog always shows
 * before resolving — it used to skip a bag-only trade on the theory the
 * choice row's own compact line was pause enough; the row can no longer
 * name all three cards on one line for every trio (see
 * `mergeRowPreviewText`'s doc comment above), so this is now the ONLY place
 * a bag-only trio is named too, not just a board-touching one).
 */
export function mergeConfirmBody(from: SkillTier, to: SkillTier, spent: readonly MergeSpentEntry[]): string {
  const headline = mergeTradeLine(spent.length, from, to);
  return [headline, ...spent.map(mergeSpentPhrase)].join('\n');
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
    case 'awardCardPoint': return 'ADVANCE A CARD';
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
    case 'grantMapInfo': return `REVEAL ${outcome.bandsAhead} BANDS`;
    case 'buyLife': return '+1 LIFE';
    case 'buyStat': return MARKET_STAT_LABEL[outcome.stat];
    case 'grantStat': return MARKET_STAT_LABEL[outcome.stat];
    case 'nothing': return '—';
    default: return '';
  }
}

function tierCeiling(tiers: readonly string[]): string {
  const order = ['bronze', 'silver', 'gold', 'diamond'];
  let best = 'bronze';
  for (const tier of tiers) {
    if (order.indexOf(tier) > order.indexOf(best)) best = tier;
  }
  return best.toUpperCase();
}

/** Typed choice-row copy for the committed event view model. V3 hints read
 * their exact persisted offer (including its actual card tiers); no scene
 * parses authored prose or regenerates a reward preview. */
export function eventOutcomeHintText(hint: RunEventOutcomeHint): string {
  switch (hint.kind) {
    case 'grantCard': {
      if ('offer' in hint) {
        return `${skillName(hint.offer.card.skillId).toUpperCase()} (${hint.offer.card.tier.toUpperCase()})`;
      }
      const tier = hint.tier === undefined ? '' : ` (${hint.tier.toUpperCase()})`;
      return hint.cardId === undefined ? `RANDOM CARD${tier}` : `${skillName(hint.cardId).toUpperCase()}${tier}`;
    }
    case 'grantGem':
      if ('offer' in hint) return (gemBook[hint.offer.gemId]?.name ?? hint.offer.gemId).toUpperCase();
      return hint.gemId === undefined ? 'GEM' : (gemBook[hint.gemId]?.name ?? hint.gemId).toUpperCase();
    case 'grantGold': return `+${hint.amount} GOLD`;
    case 'loseGold': return `-${hint.amount} GOLD`;
    case 'grantLevel': return '+1 LEVEL';
    case 'grantMapInfo': return `REVEAL ${hint.bandsAhead} BANDS`;
    case 'buyLife': return '+1 LIFE';
    case 'buyStat': return MARKET_STAT_LABEL[hint.stat];
    case 'grantStat': return MARKET_STAT_LABEL[hint.stat];
    case 'nothing': return '—';
    case 'challengeFight': return `BATTLE · ${hint.difficulty.toUpperCase()} · ${hint.rewardChip}`;
    case 'cardChoice':
      return 'offer' in hint
        ? `CHOICE OF ${hint.offer.options.length} CARDS · UP TO ${tierCeiling(hint.offer.options.map((option) => option.tier))}`
        : `CHOICE OF ${hint.optionCount} CARDS`;
    case 'bonusDraft':
      return 'offer' in hint
        ? `MINI-DRAFT · ${hint.offer.options.length} CARDS · UP TO ${tierCeiling(hint.offer.options.map((option) => option.tier))}`
        : `MINI-DRAFT · ${hint.optionCount} CARDS`;
    case 'gemChoice':
      return 'offer' in hint ? `CHOICE OF ${hint.offer.optionGemIds.length} GEMS` : `CHOICE OF ${hint.optionCount} GEMS`;
    case 'upgradeCardTargeted':
      return `UPGRADE · ${hint.offer.optionInstanceIds.length} TARGET${hint.offer.optionInstanceIds.length === 1 ? '' : 'S'}`;
    case 'upgradeCard':
      return 'offer' in hint
        ? `UPGRADE · ${hint.offer.optionInstanceIds.length} TARGET${hint.offer.optionInstanceIds.length === 1 ? '' : 'S'}`
        : 'UPGRADE';
    // Not yet wired to a real picker (see `presentRunEventOutcome`'s
    // `awardCardPointPick` arm) — no catalog content authors this kind yet.
    case 'awardCardPoint': return 'ADVANCE A CARD';
    case 'sellGem':
      return 'offer' in hint && hint.offer.status !== 'unavailable'
        ? `SELL 1 OF ${hint.offer.options.length} GEMS`
        : 'SELL A GEM';
    case 'mergeCards':
      return 'offer' in hint && hint.offer.status !== 'unavailable'
        ? mergeTradeLine(hint.offer.consumed.length, hint.offer.from, hint.offer.to)
        : '3 CARDS → 1 BETTER';
    case 'buyStatPick': return 'CHOICE OF 3 STATS';
    default: {
      const exhaustive: never = hint;
      throw new Error(`eventOutcomeHintText: unknown outcome ${String((exhaustive as RunEventOutcomeHint).kind)}`);
    }
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
export function outcomeHeadline(outcome: EventOutcome | EventOutcomeV3): { headline: string; detail: string } {
  switch (outcome.kind) {
    case 'grantCard':
      return 'fellBack' in outcome && outcome.fellBack
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
    case 'cardChoice':
      return { headline: 'Choose a card to keep', detail: '' };
    // Unreachable in practice — the scenes render `upgradeCardPick` through
    // `renderRunUpgradeCardPicker` directly, never through this resolved-
    // outcome headline (same as `bonusDraft` above, which also never reaches
    // here). Kept only so the exhaustiveness guard below stays meaningful.
    case 'upgradeCardPick':
      return { headline: 'Choose a card to upgrade', detail: '' };
    case 'upgradeCardTargeted':
      return { headline: 'Choose a card to upgrade', detail: '' };
    // Unreachable in practice — same reason as `upgradeCardPick`/`bonusDraft`
    // above: the scenes render `gemChoicePick` through
    // `renderRunGemChoicePicker` directly, never through this resolved-
    // outcome headline. Kept only so the exhaustiveness guard below stays
    // meaningful.
    case 'gemChoicePick':
      return { headline: 'Choose a gem to keep', detail: '' };
    case 'gemChoice':
      return { headline: 'Choose a gem to keep', detail: '' };
    // Unreachable in practice — same reason as `upgradeCardPick`/
    // `gemChoicePick` above: the scenes render `sellGemPick` through
    // `renderRunSellGemPicker` directly, never through this resolved-outcome
    // headline. Kept only so the exhaustiveness guard below stays meaningful.
    case 'sellGemPick':
      return { headline: 'Choose a gem to sell', detail: '' };
    case 'sellGem':
      return 'offer' in outcome
        ? { headline: 'Choose a gem to sell', detail: '' }
        : { headline: `Sold a gem for ${outcome.price} gold`, detail: '' };
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
    case 'mergeCards':
      return { headline: `Choose what your three ${outcome.offer.from.toUpperCase()} cards become`, detail: '' };
    case 'upgradeCard':
      if ('offer' in outcome) return { headline: 'Choose a card to upgrade', detail: '' };
      return outcome.fellBack
        ? { headline: 'Nothing eligible to upgrade — took gold instead', detail: '' }
        : {
            headline: `Your ${skillName(outcome.skillId!)} is re-tempered — ${outcome.from!.toUpperCase()} → ${outcome.to!.toUpperCase()}.`,
            detail: '',
          };
    // Unreachable in practice — no catalog content authors `awardCardPoint`
    // yet (run-layer only, see src/run/events.ts); kept so the exhaustiveness
    // guard below compiles ahead of the UI/content task that wires it up.
    case 'awardCardPointPick':
      return { headline: 'Choose a card to advance', detail: '' };
    case 'awardCardPoint':
      return outcome.fellBack
        ? { headline: 'Nothing eligible to advance — took gold instead', detail: '' }
        : { headline: `Your ${skillName(outcome.skillId).toUpperCase()} advances`, detail: `${outcome.tier.toUpperCase()} · ${outcome.points} point${outcome.points === 1 ? '' : 's'}` };
    case 'grantMapInfo': {
      const shown = outcome.revealedBands.map((band) => band + 1);
      const detail = shown.length === 0
        ? 'No new bands were revealed.'
        : shown.length === 1
          ? `Revealed band ${shown[0]}.`
          : `Revealed bands ${shown.join('–')}.`;
      return { headline: 'Map intel updated', detail };
    }
    case 'buyLife':
      return {
        headline: `Bought back a life — ${outcome.lives}/${LIVES_PER_RUN} lives`,
        detail: `Paid ${outcome.price} gold`,
      };
    case 'buyStat':
      return { headline: `Bought ${MARKET_STAT_LABEL[outcome.stat]}`, detail: `Paid ${outcome.price} gold` };
    case 'grantStat':
      return { headline: `Gained ${MARKET_STAT_LABEL[outcome.stat]}`, detail: '' };
    // Unreachable in practice — same reason as `cardChoice`/`gemChoice`
    // above: the scenes render the picker (`presentRunEventOutcome`'s
    // `buyStatPick` picker case) directly, never through this resolved-
    // outcome headline. Kept so the exhaustiveness guard below compiles.
    case 'buyStatPick':
      return { headline: 'Choose a stat to buy', detail: '' };
    case 'nothing':
      return 'fellBack' in outcome && outcome.fellBack
        ? { headline: 'No eligible reward — nothing happens', detail: '' }
        : { headline: 'Nothing happens', detail: '' };
    case 'cardGranted':
      return { headline: `Gained a ${outcome.tier.toUpperCase()} card`, detail: '' };
    case 'cardUpgraded':
      return {
        headline: `Your ${skillName(outcome.skillId)} is re-tempered — ${outcome.from.toUpperCase()} → ${outcome.to.toUpperCase()}.`,
        detail: '',
      };
    case 'alreadySettled':
      return { headline: 'Reward already claimed', detail: '' };
    // The scene intercepts `challengeFight` before it reaches this
    // resolved-outcome headline (launches the battle instead) — kept only so
    // this exhaustiveness guard compiles.
    case 'challengeFight':
      return { headline: '', detail: '' };
    default: {
      // Exhaustiveness guard (same idiom as `applySpec` in src/run/events.ts):
      // a future `EventOutcome` kind added to the union without a case here
      // fails to COMPILE rather than silently rendering an icon with no text.
      const exhaustive: never = outcome;
      throw new Error(`outcomeHeadline: unknown outcome kind "${(exhaustive as EventOutcome).kind}"`);
    }
  }
}
