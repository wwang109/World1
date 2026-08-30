import { describe, expect, it } from 'vitest';
import { buildRunRewardViewModel } from '../../src/game/ui/runRewardViewModel';
import { choiceArtKey } from '../../src/game/ui/runArtKeys';
import type { EventOutcome, MergeCardsReceipt } from '../../src/run/events';
import { skillBook } from '../../src/data/skills';
import { buildRunMergeViewModel } from '../../src/game/ui/runMergeViewModel';
import { gemBook } from '../../src/data/gems';
import { applyTier } from '../../src/engine/cards';

// `buildRunRewardViewModel` is the pure mapping every resolved `EventOutcome`
// goes through before either scene renders it — this is the mapping test the
// audit found missing: before this file, neither it nor `RunRewardPanel.ts`
// was imported by anything under tests/, so a typo'd `kind` check here would
// still ship green. One case per `EventOutcome` union member (src/run/
// events.ts:41-59), including both branches of the two variants that carry a
// `fellBack` flag.
describe('buildRunRewardViewModel', () => {
  const SKILL_ID = 'sword_slash';
  const GEM_ID = 'venom_sliver';

  it('grantCard: headline names the tier, feature is the (possibly re-tiered) card', () => {
    const outcome: EventOutcome = { kind: 'grantCard', skillId: SKILL_ID, tier: 'silver' };
    const model = buildRunRewardViewModel(outcome);
    expect(model.iconKey).toBe(choiceArtKey('grantCard'));
    expect(model.headline).toBe('Gained a SILVER card');
    expect(model.detail).toBeUndefined();
    expect(model.feature).toEqual({ kind: 'card', skill: applyTier(skillBook[SKILL_ID]!, 'silver') });
  });

  it('grantCard: skill kept AS-IS (no applyTier call) when the tier already matches the base card', () => {
    const outcome: EventOutcome = { kind: 'grantCard', skillId: SKILL_ID, tier: skillBook[SKILL_ID]!.tier };
    const model = buildRunRewardViewModel(outcome);
    expect(model.feature).toEqual({ kind: 'card', skill: skillBook[SKILL_ID] });
  });

  it('grantCard fellBack: headline reports the gold fallback, feature falls back to the icon (no skillId to show)', () => {
    const outcome: EventOutcome = { kind: 'grantCard', skillId: SKILL_ID, tier: 'bronze', fellBack: true };
    const model = buildRunRewardViewModel(outcome);
    expect(model.iconKey).toBe(choiceArtKey('grantCard'));
    expect(model.headline).toBe('Bag was full — took gold instead');
    expect(model.detail).toBeUndefined();
    expect(model.feature).toEqual({ kind: 'icon' });
  });

  it('grantGem: headline is generic, feature is the resolved gem', () => {
    const outcome: EventOutcome = { kind: 'grantGem', gemId: GEM_ID };
    const model = buildRunRewardViewModel(outcome);
    expect(model.iconKey).toBe(choiceArtKey('grantGem'));
    expect(model.headline).toBe('Gained a gem');
    expect(model.detail).toBeUndefined();
    expect(model.feature).toEqual({ kind: 'gem', gem: gemBook[GEM_ID] });
  });

  it('grantGold: headline states the amount, feature is the icon fallback', () => {
    const outcome: EventOutcome = { kind: 'grantGold', amount: 3 };
    const model = buildRunRewardViewModel(outcome);
    expect(model.iconKey).toBe(choiceArtKey('grantGold'));
    expect(model.headline).toBe('Gained 3 gold');
    expect(model.detail).toBeUndefined();
    expect(model.feature).toEqual({ kind: 'icon' });
  });

  it('grantGold fellBack: headline reports the bag-full substitution', () => {
    const outcome: EventOutcome = { kind: 'grantGold', amount: 2, fellBack: true };
    const model = buildRunRewardViewModel(outcome);
    expect(model.headline).toBe('Bag was full — gained 2 gold instead');
    expect(model.feature).toEqual({ kind: 'icon' });
  });

  it('loseGold: headline states the loss, feature is the icon fallback', () => {
    const outcome: EventOutcome = { kind: 'loseGold', amount: 4 };
    const model = buildRunRewardViewModel(outcome);
    expect(model.iconKey).toBe(choiceArtKey('loseGold'));
    expect(model.headline).toBe('Lost 4 gold');
    expect(model.detail).toBeUndefined();
    expect(model.feature).toEqual({ kind: 'icon' });
  });

  it('grantLevel: headline states the new level, feature is the icon fallback', () => {
    const outcome: EventOutcome = { kind: 'grantLevel', level: 7 };
    const model = buildRunRewardViewModel(outcome);
    expect(model.iconKey).toBe(choiceArtKey('grantLevel'));
    expect(model.headline).toBe('Hero levels up → LV 7');
    expect(model.detail).toBeUndefined();
    expect(model.feature).toEqual({ kind: 'icon' });
  });

  it('bonusDraft: headline invites a pick, feature is the icon fallback (the picker itself owns the card grid)', () => {
    const outcome: EventOutcome = { kind: 'bonusDraft', cards: [{ skillId: SKILL_ID, tier: 'bronze' }] };
    const model = buildRunRewardViewModel(outcome);
    expect(model.iconKey).toBe(choiceArtKey('bonusDraft'));
    expect(model.headline).toBe('Pick a card to keep');
    expect(model.detail).toBeUndefined();
    expect(model.feature).toEqual({ kind: 'icon' });
  });

  it('upgradeCard: headline names the from/to tiers, feature is the icon fallback', () => {
    const outcome: EventOutcome = { kind: 'upgradeCard', skillId: SKILL_ID, from: 'bronze', to: 'silver' };
    const model = buildRunRewardViewModel(outcome);
    expect(model.iconKey).toBe(choiceArtKey('upgradeCard'));
    expect(model.headline).toBe(`Your ${skillBook[SKILL_ID]!.name} is re-tempered — BRONZE → SILVER.`);
    expect(model.detail).toBeUndefined();
    expect(model.feature).toEqual({ kind: 'icon' });
  });

  it('upgradeCard fellBack: headline reports nothing was eligible', () => {
    const outcome: EventOutcome = { kind: 'upgradeCard', fellBack: true };
    const model = buildRunRewardViewModel(outcome);
    expect(model.headline).toBe('Nothing eligible to upgrade — took gold instead');
    expect(model.detail).toBeUndefined();
    expect(model.feature).toEqual({ kind: 'icon' });
  });

  it('upgradeCardPick: headline invites a pick, feature is the icon fallback (the picker itself owns the card grid) — unreachable in practice, scenes render this via renderRunUpgradeCardPicker instead', () => {
    const outcome: EventOutcome = {
      kind: 'upgradeCardPick',
      options: [{ instanceId: 'p_1', skillId: SKILL_ID, from: 'bronze', to: 'silver' }],
    };
    const model = buildRunRewardViewModel(outcome);
    expect(model.iconKey).toBe(choiceArtKey('upgradeCardPick'));
    expect(model.headline).toBe('Choose a card to upgrade');
    expect(model.detail).toBeUndefined();
    expect(model.feature).toEqual({ kind: 'icon' });
  });

  it('nothing: headline is the plain no-op, feature is the icon fallback', () => {
    const outcome: EventOutcome = { kind: 'nothing' };
    const model = buildRunRewardViewModel(outcome);
    expect(model.iconKey).toBe(choiceArtKey('nothing'));
    expect(model.headline).toBe('Nothing happens');
    expect(model.detail).toBeUndefined();
    expect(model.feature).toEqual({ kind: 'icon' });
  });


  // -------------------------------------------------------------------------
  // THE MERGE RECEIPT — the second argument. A merge resolves to an ordinary
  // `grantCard`, so the outcome alone cannot say that three owned cards were
  // destroyed to produce it; only `applyMergeCardsPick`'s receipt can. These
  // two cases are a PAIR on purpose: the same outcome with and without the
  // receipt, so what the field is carrying is visible as the difference
  // between them (without it, the destructive outcome is word-for-word the
  // free-card one).
  // -------------------------------------------------------------------------

  const RECEIPT: MergeCardsReceipt = {
    from: 'bronze',
    to: 'silver',
    consumed: [
      { instanceId: 'c_1', skillId: 'sword_slash', tier: 'bronze', location: 'bag', index: 0 },
      { instanceId: 'c_2', skillId: 'sword_slash', tier: 'bronze', location: 'bag', index: 1 },
      { instanceId: 'c_3', skillId: SKILL_ID, tier: 'bronze', location: 'board', index: 0 },
    ],
    taken: { skillId: 'crushing_blow', tier: 'silver' },
  };

  it('grantCard WITH a merge receipt: headline is the trade, detail names every card spent and the one that arrived', () => {
    const outcome: EventOutcome = { kind: 'grantCard', skillId: 'crushing_blow', tier: 'silver' };
    const model = buildRunRewardViewModel(outcome, RECEIPT);
    expect(model.headline).toBe('3 BRONZE → 1 SILVER');
    expect(model.detail).toBeDefined();
    for (const card of RECEIPT.consumed) {
      expect(model.detail!, `spent ${card.skillId} is not named`).toContain(skillBook[card.skillId]!.name);
    }
    expect(model.detail!).toContain(skillBook['crushing_blow']!.name);
    // The card that arrived is still the subject of the screen — the receipt
    // changes the WORDS, never the feature.
    expect(model.feature).toEqual({ kind: 'card', skill: applyTier(skillBook['crushing_blow']!, 'silver') });
  });

  it('grantCard WITHOUT the receipt: the identical outcome reads as a free card — this is exactly what dropping the field looks like', () => {
    const outcome: EventOutcome = { kind: 'grantCard', skillId: 'crushing_blow', tier: 'silver' };
    const model = buildRunRewardViewModel(outcome);
    expect(model.headline).toBe('Gained a SILVER card');
    expect(model.detail).toBeUndefined();
  });

  it('the receipt headline and the PICKER headline are the same sentence — one trade, one phrasing', () => {
    const picker = buildRunMergeViewModel({
      from: RECEIPT.from,
      to: RECEIPT.to,
      consumed: RECEIPT.consumed,
      candidates: [RECEIPT.taken],
    });
    const taken = buildRunRewardViewModel({ kind: 'grantCard', skillId: 'crushing_blow', tier: 'silver' }, RECEIPT);
    expect(taken.headline).toBe(picker.title);
  });

  it('a merge receipt is ignored on the FALLBACK path (a full bag paid a coin — nothing was consumed)', () => {
    const outcome: EventOutcome = { kind: 'grantGold', amount: 3, fellBack: true };
    const model = buildRunRewardViewModel(outcome, RECEIPT);
    expect(model.headline).toBe('Bag was full — gained 3 gold instead');
  });

});
