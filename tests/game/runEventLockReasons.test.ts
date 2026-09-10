import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { EventChoiceDef } from '../../src/data/eventTypes';
import { buildRunEventScenePresentation } from '../../src/game/ui/runEventScenePresenter';
import { buildRunEventViewModel } from '../../src/game/ui/runEventViewModel';
import { choiceLockReason } from '../../src/run/events';
import { eventV3Choice, eventV3Fixture, materializedEventV3, EVENT_V3_NODE } from '../fixtures/eventV3';

/**
 * 2026-09-07 audit fix — `runEventViewModel.ts:225` hard-coded the engine
 * phrase `'no mergeable trio'` for a schema-v3 mergeCards rung with nothing
 * to merge, while the run layer's `choiceLockReason` (src/run/events.ts:921)
 * already said `'need 3 cards of one grade'` for the IDENTICAL condition on
 * the legacy path — the exact phrase a prior rewrite existed to delete was
 * still what a player read on the NEW content path, and the same lock read
 * two different ways depending on which schema drew it. Live probe (real
 * V3 mergeCards rung, empty board and bag, both platforms):
 *
 *   V3     lockReason         : "no mergeable trio"           <- BEFORE
 *   V3     desktop row.detail : "LOCKED · no mergeable trio"
 *   V3     mobile  row.detail : "LOCKED · no mergeable trio"
 *   LEGACY choiceLockReason   : "need 3 cards of one grade"    <- already correct
 *
 * This file pins the fix at both ends: the V3 view model now says the exact
 * same sentence the run layer does, on both scene presentations, and the
 * deleted engine phrase can never come back unnoticed.
 */

describe('runEventViewModel: a locked mergeCards rung reads the SAME sentence on every schema and platform', () => {
  it('a materialized V3 mergeCards offer with nothing to merge locks with the run layer\'s own wording', () => {
    const event = eventV3Fixture({
      choiceSet: { fixed: [eventV3Choice('act', { kind: 'mergeCards' }), eventV3Choice('leave', { kind: 'nothing' })] },
    });
    // No `pieces`/`bagSlots` override — `createRun` starts both empty, so the
    // offer materializes `unavailable` deterministically, no `Rng` consumed
    // by this lock (mirrors `cardOutcomeRoomGate.test.ts`'s own no-Rng proof).
    const state = materializedEventV3(event, 71);
    const view = buildRunEventViewModel(state, EVENT_V3_NODE, event);
    if (view === undefined) throw new Error('expected a persisted event view');
    const mergeChoice = view.choices.find((choice) => choice.id === 'act');
    if (!mergeChoice) throw new Error('expected the mergeCards choice to be present');

    expect(mergeChoice.locked).toBe(true);
    expect(mergeChoice.lockReason).toBe('need 3 cards of one grade');
    expect(mergeChoice.lockReason).not.toBe('no mergeable trio');

    // The SAME sentence the legacy path already gives for the identical
    // condition — not merely a plausible-looking string, the actual shared
    // wording.
    const legacyProbe: EventChoiceDef = { id: 'act', label: 'Choice act', outcome: { kind: 'mergeCards' } };
    expect(choiceLockReason(state, legacyProbe)).toBe(mergeChoice.lockReason);
  });

  it('renders "LOCKED · need 3 cards of one grade" on BOTH platforms, not the old engine phrase', () => {
    const event = eventV3Fixture({
      choiceSet: { fixed: [eventV3Choice('act', { kind: 'mergeCards' }), eventV3Choice('leave', { kind: 'nothing' })] },
    });
    const state = materializedEventV3(event, 71);
    const view = buildRunEventViewModel(state, EVENT_V3_NODE, event);
    if (view === undefined) throw new Error('expected a persisted event view');

    for (const platform of ['desktop', 'mobile'] as const) {
      const presentation = buildRunEventScenePresentation(view, state, platform);
      const row = presentation.choices.find((choice) => choice.id === 'act');
      if (!row) throw new Error(`expected the mergeCards row on ${platform}`);
      expect(row.detail, `${platform} row.detail`).toBe('LOCKED · need 3 cards of one grade');
      expect(row.detail).not.toContain('no mergeable trio');
    }
  });

  it('the deleted engine phrase cannot come back unnoticed in runEventViewModel.ts', () => {
    const src = readFileSync(join(process.cwd(), 'src', 'game', 'ui', 'runEventViewModel.ts'), 'utf8');
    expect(src).not.toContain('no mergeable trio');
    expect(src).toContain('need 3 cards of one grade');
  });
});
