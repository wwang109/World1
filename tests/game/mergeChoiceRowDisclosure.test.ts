import { describe, expect, it } from 'vitest';
import { eventCatalog } from '../../src/data/events';
import { skillBook } from '../../src/data/skills';
import { mergeConfirmBody, mergeRowPreviewText } from '../../src/game/ui/eventOutcomeText';
import { buildMergeSpentEntries, type MergeSpentEntry } from '../../src/game/ui/runMergeViewModel';
import { buildRunEventViewModel } from '../../src/game/ui/runEventViewModel';
import { buildRunEventScenePresentation } from '../../src/game/ui/runEventScenePresenter';
import { recordEventInstance } from '../../src/run/eventInstances';
import type { MergeInputCard } from '../../src/run/events';
import {
  applyDraftResult, createRun, currentStartDraft, type RunNode, type RunState,
} from '../../src/run/runState';
import { DRAFT_SET_KEYS } from '../../src/run/draft';

/**
 * The mergeCards CHOICE ROW's pre-tap price line (2026-09-06) — the defect
 * this closes: the row used to say only "3 CARDS → 1 BETTER", naming none of
 * the three cards it would actually eat. `npm run fight`'s log-first rule
 * does not apply to a UI string, but the same instinct does: prove it against
 * the REAL resolver/catalog/view-model pipeline, not a hand-typed fixture.
 */

const ALICE_CARD: MergeInputCard = {
  instanceId: 'card_001', skillId: 'shadow_bolt', tier: 'bronze', location: 'board', index: 0,
};
const BOB_CARD: MergeInputCard = {
  instanceId: 'card_002', skillId: 'prism_barrier', tier: 'bronze', location: 'board', index: 1,
};
const CARL_CARD: MergeInputCard = {
  instanceId: 'card_003', skillId: 'line_breaker', tier: 'bronze', location: 'bag', index: 0,
};

function spentOf(cards: readonly MergeInputCard[], pieces: readonly { slot: number }[]): readonly MergeSpentEntry[] {
  return buildMergeSpentEntries(cards, pieces);
}

describe('mergeRowPreviewText: the choice row states a COUNT, never gambles on fitting every name', () => {
  it('is "SPENDS N CARDS · TAP TO SEE WHICH" — no names, no tier, no location (the confirm names them instead)', () => {
    const spent = spentOf([ALICE_CARD, BOB_CARD, CARL_CARD], [{ slot: 0 }, { slot: 1 }]);
    expect(mergeRowPreviewText(spent)).toBe('SPENDS 3 CARDS · TAP TO SEE WHICH');
  });

  it('never overflows for an unusually long name — the row text does not vary with name length at all', () => {
    const longNamed: MergeSpentEntry[] = [
      { instanceId: 'a', skillId: 'a', name: 'Aegis of the Unbroken', tier: 'bronze', tierLabel: 'BRONZE', whereLabel: 'BOARD 1' },
      { instanceId: 'b', skillId: 'b', name: 'Standard of the Ninth', tier: 'bronze', tierLabel: 'BRONZE', whereLabel: 'BOARD 2' },
      { instanceId: 'c', skillId: 'c', name: "Champion's Challenge", tier: 'bronze', tierLabel: 'BRONZE', whereLabel: 'BAG' },
    ];
    expect(mergeRowPreviewText(longNamed)).toBe('SPENDS 3 CARDS · TAP TO SEE WHICH');
  });

  it('pluralizes off the actual count, not a hardcoded 3', () => {
    const single: MergeSpentEntry[] = [
      { instanceId: 'a', skillId: 'a', name: 'Sworn Edge', tier: 'bronze', tierLabel: 'BRONZE', whereLabel: 'BAG' },
    ];
    expect(mergeRowPreviewText(single)).toBe('SPENDS 1 CARD · TAP TO SEE WHICH');
  });
});

describe('mergeConfirmBody: the pre-resolution confirm names the trade AND where each card sits', () => {
  it('is the trade headline over one "name (WHERE)" line per consumed card', () => {
    const spent = spentOf([ALICE_CARD, BOB_CARD, CARL_CARD], [{ slot: 0 }, { slot: 1 }]);
    const body = mergeConfirmBody('bronze', 'silver', spent);
    expect(body).toBe(
      `3 BRONZE → 1 SILVER\n${skillBook.shadow_bolt!.name} (BOARD 1)\n${skillBook.prism_barrier!.name} (BOARD 2)\n${skillBook.line_breaker!.name} (BAG)`,
    );
  });
});

// ---------------------------------------------------------------------------
// Integration: the REAL resolver/catalog/view-model pipeline for a live
// mergeCards choice, proving `buildRunEventScenePresentation` actually wires
// `mergeRowPreviewText` into the choice row's `detail` — not merely that the
// pure text functions above look right in isolation.
// ---------------------------------------------------------------------------

function draftedRun(seed: number): RunState {
  const drafted = createRun(seed);
  const hand = currentStartDraft(drafted);
  const picks = Object.fromEntries(DRAFT_SET_KEYS.map((key) => [key, hand[key][0]!.skillId]));
  return applyDraftResult(drafted, picks);
}

function parkedOnEmberPit(seed: number): { state: RunState; node: RunNode } {
  const active = draftedRun(seed);
  const node = active.map.depths.flat().find((n) => n.kind === 'event');
  if (!node) throw new Error(`seed ${seed}: no event node`);
  const parked = { ...active, depth: node.depth, currentNodeId: node.id };
  const state = recordEventInstance(parked, node.id, {
    eventId: 'ember_pit', contentVersion: 1, instanceId: `event:${node.id}`, drawnDepth: node.depth,
  });
  return { state, node };
}

describe('buildRunEventScenePresentation: the mergeCards row, over the real ember_pit door', () => {
  it('seed 1: the drafted board is an unlocked bronze trio, and the row states the count (the confirm names the three)', () => {
    const { state, node } = parkedOnEmberPit(1);
    const event = eventCatalog.ember_pit!;
    const view = buildRunEventViewModel(state, node, event);
    expect(view).toBeDefined();
    const mergeChoice = view!.choices.find((c) => c.id === 'feed_the_coals')!;
    expect(mergeChoice.locked).toBe(false);

    for (const platform of ['desktop', 'mobile'] as const) {
      const presentation = buildRunEventScenePresentation(view!, state, platform);
      const row = presentation.choices.find((c) => c.id === 'feed_the_coals')!;
      expect(row.detail).toBe('SPENDS 3 CARDS · TAP TO SEE WHICH');
      expect(row.enabled).toBe(true);
      // ember_pit's merge is gold-free — the destructive cost still reads
      // "COST 3 CARDS", never the gold-only "FREE" (2026-09-06 audit finding 7).
      expect(row.footer).toBe('COST 3 CARDS');
      // mergeCards pauses through its OWN unconditional confirm
      // (`mergeConfirmChoiceId`, both RunEvent scenes) — never the generic
      // gold-cost one.
      expect(row.costConfirm).toBeNull();
    }
  });

  it('a bag emptied down to two bronze cards LOCKS the rung, and the row carries the run layer\'s OWN reason verbatim', () => {
    const { state, node } = parkedOnEmberPit(1);
    // Seed 1 drafts FOUR bronze board pieces — keep only two, so
    // `mergeCardsPlan` has no trio and `choiceLockReason` dims the rung.
    const thinned: RunState = { ...state, pieces: state.pieces.slice(2) };
    const event = eventCatalog.ember_pit!;
    const view = buildRunEventViewModel(thinned, node, event)!;
    const mergeChoice = view.choices.find((c) => c.id === 'feed_the_coals')!;
    expect(mergeChoice.locked).toBe(true);
    expect(mergeChoice.lockReason).not.toBeNull();

    const presentation = buildRunEventScenePresentation(view, thinned, 'mobile');
    const row = presentation.choices.find((c) => c.id === 'feed_the_coals')!;
    // The exact PROSE of the lock reason belongs to `src/run/events.ts`
    // (`choiceLockReason`), not this layer — this asserts the WIRING (the
    // row's `detail` carries the run layer's reason through verbatim),
    // never a copy of the reason string, so this test cannot drift out of
    // sync with that prose the way a hardcoded literal would.
    expect(row.detail).toBe(`LOCKED · ${mergeChoice.lockReason}`);
    expect(row.enabled).toBe(false);
  });
});
