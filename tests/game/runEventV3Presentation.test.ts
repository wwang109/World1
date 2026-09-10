import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isEventDefV3, type EventDirectOutcomeSpecV3 } from '../../src/data/eventContentV3';
import { eventCatalog, eventRuntimeCatalog } from '../../src/data/events';
import { gemBook } from '../../src/data/gems';
import {
  buildRunEventScenePresentation,
  mergeReceiptForEventPicker,
  presentRunEventOutcome,
  runEventSceneLayout,
} from '../../src/game/ui/runEventScenePresenter';
import { eventOutcomeHintText } from '../../src/game/ui/eventOutcomeText';
import { buildRunRewardViewModel } from '../../src/game/ui/runRewardViewModel';
import { buildRunEventViewModel } from '../../src/game/ui/runEventViewModel';
import type { EventOutcomeV3 } from '../../src/run/eventsV3';
import { finalizeEventCardChoiceV3, resolveEventChoiceV3 } from '../../src/run/eventsV3';
import { recordEventInstance } from '../../src/run/eventInstances';
import type { RunState } from '../../src/run/runState';
import {
  EVENT_V3_NODE,
  eventV3Choice,
  eventV3Fixture,
  materializedEventV3,
  runAtEventV3Node,
} from '../fixtures/eventV3';

const GEM_IDS = Object.keys(gemBook).slice(0, 3) as [string, string, string];
const OWNED = [0, 1, 2].map((slot) => ({
  slot,
  instanceId: `owned-${String(slot)}`,
  skillId: 'sword_slash',
  tier: 'bronze' as const,
}));

function resolvedPicker(
  outcome: EventDirectOutcomeSpecV3,
  seed: number,
  overrides: Partial<RunState> = {},
): { result: EventOutcomeV3; state: RunState } {
  const event = eventV3Fixture({ choiceSet: { fixed: [
    eventV3Choice('act', outcome),
    eventV3Choice('leave', { kind: 'nothing' }),
  ] } });
  const state = materializedEventV3(event, seed, { pieces: OWNED, gemInventory: [...GEM_IDS], ...overrides });
  const resolved = resolveEventChoiceV3(state, `event:${EVENT_V3_NODE.id}`, 'act', () => event);
  if (!resolved.ok) throw new Error(`expected picker resolution, got ${resolved.reason}`);
  return { result: resolved.outcome, state: resolved.state };
}

describe('schema-v3 event scene presentation', () => {
  it('carries graph-derived opportunity hints through the shared choice presentation on both profiles', () => {
    const bell = eventRuntimeCatalog.bell_beneath_ice!;
    const base = runAtEventV3Node(403);
    const bellState = recordEventInstance(base, EVENT_V3_NODE.id, {
      eventId: bell.id,
      contentVersion: 1,
      instanceId: `event:${EVENT_V3_NODE.id}`,
      drawnDepth: EVENT_V3_NODE.depth,
    });
    const bellView = buildRunEventViewModel(bellState, EVENT_V3_NODE, bell);
    if (bellView === undefined) throw new Error('expected Bell view');

    const cairn = eventRuntimeCatalog.feathered_cairn!;
    if (!isEventDefV3(cairn)) throw new Error('expected current Cairn schema-v3 definition');
    const cairnState = materializedEventV3(cairn, 404);
    const cairnView = buildRunEventViewModel(cairnState, EVENT_V3_NODE, cairn);
    if (cairnView === undefined) throw new Error('expected Cairn view');

    expect(bellView.choices.find((choice) => choice.id === 'prise_it_free')?.opportunityHint)
      .toBe('MAY UNLOCK A SPECIAL EVENT');
    expect(cairnView.choices.find((choice) => choice.id === 'read_feathers')?.opportunityHint)
      .toBe('MAY CONTINUE THIS STORY');
    expect(bellView.choices.find((choice) => choice.id === 'leave_it_sleeping')?.opportunityHint)
      .toBeUndefined();

    for (const platform of ['desktop', 'mobile'] as const) {
      const bellChoices = buildRunEventScenePresentation(bellView, bellState, platform).choices;
      const cairnChoices = buildRunEventScenePresentation(cairnView, cairnState, platform).choices;
      expect(bellChoices.find((choice) => choice.id === 'prise_it_free')?.opportunityHint)
        .toBe('MAY UNLOCK A SPECIAL EVENT');
      expect(bellChoices.find((choice) => choice.id === 'prise_it_free')?.detail)
        .toMatch(/^MAY UNLOCK A SPECIAL EVENT · REWARD · /);
      expect(cairnChoices.find((choice) => choice.id === 'read_feathers')?.opportunityHint)
        .toBe('MAY CONTINUE THIS STORY');
      expect(cairnChoices.find((choice) => choice.id === 'read_feathers')?.detail)
        .toMatch(/^MAY CONTINUE THIS STORY · REWARD · /);
      expect(bellChoices.find((choice) => choice.id === 'leave_it_sleeping')?.opportunityHint)
        .toBeUndefined();
    }
  });

  it('suppresses a hinted choice label from terminal detail on both profiles', () => {
    const bell = eventRuntimeCatalog.bell_beneath_ice!;
    const instanceId = `event:${EVENT_V3_NODE.id}`;
    const committed = recordEventInstance(runAtEventV3Node(405), EVENT_V3_NODE.id, {
      eventId: bell.id,
      contentVersion: 1,
      instanceId,
      drawnDepth: EVENT_V3_NODE.depth,
    });
    const terminal = {
      ...committed,
      eventResolutions: {
        [EVENT_V3_NODE.id]: {
          eventId: bell.id,
          contentVersion: 1,
          instanceId,
          choiceId: 'prise_it_free',
        },
      },
    };
    const view = buildRunEventViewModel(terminal, EVENT_V3_NODE, bell);
    if (view === undefined) throw new Error('expected terminal Bell view');

    for (const platform of ['desktop', 'mobile'] as const) {
      const choice = buildRunEventScenePresentation(view, terminal, platform).choices
        .find((candidate) => candidate.id === 'prise_it_free');
      expect(choice?.detail).toMatch(/^TAKEN · /);
      expect(choice?.detail).not.toContain('MAY UNLOCK A SPECIAL EVENT');
      expect(choice?.detail).not.toContain('MAY CONTINUE THIS STORY');
    }
  });

  it('keeps the exact persisted 2-choice order and exposes biome, theme, rarity, stage, secret, and due metadata', () => {
    const event = eventV3Fixture({
      story: { storyId: 'seeded_journey', stage: 'capstone', role: 'capstone' },
      visibility: 'teased_when_due',
    });
    const base = materializedEventV3(event, 404);
    const state = {
      ...base,
      eventInstances: {
        ...base.eventInstances,
        [EVENT_V3_NODE.id]: {
          ...base.eventInstances[EVENT_V3_NODE.id]!,
          callbackInstanceId: 'callback:seeded_journey',
        },
      },
    };
    const view = buildRunEventViewModel(state, EVENT_V3_NODE, event);
    if (view === undefined) throw new Error('expected event view');

    const desktop = buildRunEventScenePresentation(view, state, 'desktop');
    const mobile = buildRunEventScenePresentation(view, state, 'mobile');

    expect(desktop.choices.map((choice) => choice.id)).toEqual(view.choices.map((choice) => choice.id));
    expect(desktop.choices).toHaveLength(2);
    expect(desktop.context).toMatchObject({
      biomeId: 'arrowfell',
      biomeName: 'The Arrowfell',
      theme: 'omen',
      rarityLabel: 'SECRET',
      storyStageLabel: 'CAPSTONE',
      visibilityLabel: 'TEASED',
      dueLabel: 'DUE CALLBACK',
    });
    expect(mobile.context).toEqual(desktop.context);
  });

  it('preserves the legacy chain recap in the committed view instead of asking a scene to re-read event definitions', () => {
    const event = eventCatalog.tutors_return!;
    const withPast = {
      ...runAtEventV3Node(409),
      eventResolutions: {
        old: {
          eventId: 'wandering_tutor',
          contentVersion: 1,
          instanceId: 'event:old',
          choiceId: 'pay',
        },
      },
    };
    const state = recordEventInstance(withPast, EVENT_V3_NODE.id, {
      eventId: event.id,
      contentVersion: 1,
      instanceId: `event:${EVENT_V3_NODE.id}`,
      drawnDepth: EVENT_V3_NODE.depth,
    });

    const view = buildRunEventViewModel(state, EVENT_V3_NODE, event);
    expect(view?.recap).toBe('You chose "Pay 2 gold for the lesson" at The Wandering Tutor.');
    expect(view && buildRunEventScenePresentation(view, state, 'desktop').body).toContain('THE WORLD REMEMBERS');
  });

  it('preserves a legacy derived-door family label through the committed presenter seam', () => {
    const event = eventCatalog.the_lands_measure!;
    const base = runAtEventV3Node(410);
    const state = recordEventInstance(base, EVENT_V3_NODE.id, {
      eventId: event.id,
      contentVersion: 1,
      instanceId: `event:${EVENT_V3_NODE.id}`,
      drawnDepth: EVENT_V3_NODE.depth,
    });
    const view = buildRunEventViewModel(state, EVENT_V3_NODE, event);
    if (view === undefined) throw new Error('expected legacy event view');

    expect(buildRunEventScenePresentation(view, state, 'desktop').choices[0]?.title).toMatch(/ — [A-Z]+$/);
  });

  it('renders all three persisted choices, including a locked choice and its reason, without filtering by reward kind', () => {
    const event = eventV3Fixture({ choiceSet: { fixed: [
      { ...eventV3Choice('premium', { kind: 'cardChoice', filter: [{}], maxTier: 'gold' }, 9), label: 'Open the gilt case' },
      eventV3Choice('gem', { kind: 'gemChoice' }),
      eventV3Choice('leave', { kind: 'nothing' }),
    ] } });
    const state = materializedEventV3(event, 405, { gold: 2, pieces: OWNED, gemInventory: [...GEM_IDS] });
    const view = buildRunEventViewModel(state, EVENT_V3_NODE, event);
    if (view === undefined) throw new Error('expected event view');

    for (const platform of ['desktop', 'mobile'] as const) {
      const presented = buildRunEventScenePresentation(view, state, platform);
      expect(presented.choices.map((choice) => choice.id)).toEqual(['premium', 'gem', 'leave']);
      expect(presented.choices[0]).toMatchObject({
        enabled: false,
        detail: 'LOCKED · needs 9 gold',
        footer: 'COST 9 GOLD',
      });
    }
  });

  it('shows the persisted higher-tier card offer in both the choice hint and picker options', () => {
    const outcome: EventOutcomeV3 = {
      kind: 'cardChoice',
      offer: {
        kind: 'cardChoice', status: 'pending', options: [
          { skillId: 'sword_slash', tier: 'bronze' },
          { skillId: 'crushing_blow', tier: 'silver' },
          { skillId: 'arcane_burst', tier: 'gold' },
        ],
      },
    };
    const hint = { kind: 'cardChoice', offer: outcome.offer } as const;
    const state = materializedEventV3(eventV3Fixture(), 406, { pieces: OWNED });

    expect(eventOutcomeHintText(hint)).toContain('GOLD');
    const presentation = presentRunEventOutcome(outcome, state);
    expect(presentation).toMatchObject({
      kind: 'picker',
      picker: {
        kind: 'cardChoice',
        options: [
          { skillId: 'sword_slash', tier: 'bronze' },
          { skillId: 'crushing_blow', tier: 'silver' },
          { skillId: 'arcane_burst', tier: 'gold' },
        ],
      },
    });
  });
});

describe('all seven persisted schema-v3 picker kinds', () => {
  const cases = [
    ['cardChoice', { kind: 'cardChoice', filter: [{}], maxTier: 'gold' }],
    ['upgradeCardTargeted', {
      kind: 'upgradeCardTargeted',
      target: { filter: { where: 'any', match: { cardIds: ['sword_slash'] } } },
      fallback: { kind: 'grantGold', amount: 2 },
    }],
    ['bonusDraft', { kind: 'bonusDraft' }],
    ['gemChoice', { kind: 'gemChoice' }],
    ['upgradeCard', { kind: 'upgradeCard' }],
    ['sellGem', { kind: 'sellGem' }],
    ['mergeCards', { kind: 'mergeCards' }],
  ] as const satisfies readonly (readonly [string, EventDirectOutcomeSpecV3])[];

  it.each(cases)('adapts the exact pending %s offer without changing its semantic kind', (kind, outcome) => {
    const { result, state } = resolvedPicker(outcome, 500 + kind.length);
    expect(result.kind).toBe(kind);
    const presentation = presentRunEventOutcome(result, state);
    expect(presentation.kind).toBe('picker');
    if (presentation.kind !== 'picker') return;
    expect(presentation.picker.kind).toBe(kind);
    expect(presentation.picker.optionCount).toBeGreaterThan(0);
  });

  it('keeps a persisted upgrade target visible as a fallback row if Deck/Bag no longer owns it', () => {
    const state = materializedEventV3(eventV3Fixture(), 588, { pieces: [OWNED[0]!] });
    const outcome: EventOutcomeV3 = {
      kind: 'upgradeCard',
      offer: {
        kind: 'upgradeCard',
        status: 'pending',
        optionInstanceIds: ['owned-0', 'sold-while-pending'],
        fallback: { kind: 'grantGold', amount: 2 },
      },
    };

    const presentation = presentRunEventOutcome(outcome, state);
    expect(presentation.kind).toBe('picker');
    if (presentation.kind !== 'picker' || presentation.picker.kind !== 'upgradeCard') return;
    expect(presentation.picker.options).toHaveLength(2);
    expect(presentation.picker.options[1]).toEqual({
      instanceId: 'sold-while-pending',
      available: false,
      fallbackLabel: 'CARD NO LONGER OWNED · RESOLVE FALLBACK',
    });
  });

  it('builds the merge receipt from the persisted question plus selected answer', () => {
    const { result, state } = resolvedPicker({ kind: 'mergeCards' }, 589);
    const presentation = presentRunEventOutcome(result, state);
    if (presentation.kind !== 'picker' || presentation.picker.kind !== 'mergeCards') {
      throw new Error('expected merge picker');
    }
    const selected = presentation.picker.model.candidates[0]!;

    expect(mergeReceiptForEventPicker(presentation.picker, selected.skillId)).toEqual({
      from: presentation.picker.model.from,
      to: presentation.picker.model.to,
      consumed: result.kind === 'mergeCards' ? result.offer.consumed : [],
      taken: { skillId: selected.skillId, tier: selected.tier },
    });
    expect(mergeReceiptForEventPicker(presentation.picker, 'not-offered')).toBeUndefined();
  });
});

describe('schema-v3 immediate and settlement presentation', () => {
  const results = [
    { kind: 'grantCard', skillId: 'sword_slash', tier: 'silver' },
    { kind: 'grantGem', gemId: GEM_IDS[0] },
    { kind: 'grantGold', amount: 3 },
    { kind: 'loseGold', amount: 2 },
    { kind: 'grantLevel', level: 4 },
    { kind: 'grantMapInfo', bandsAhead: 2, revealedBands: [1, 2] },
    { kind: 'nothing' },
    { kind: 'cardGranted', skillId: 'sword_slash', tier: 'gold', instanceId: 'new-card' },
    { kind: 'cardUpgraded', instanceId: 'owned-0', skillId: 'sword_slash', from: 'bronze', to: 'silver' },
    { kind: 'grantGold', amount: 2, fellBack: true },
    { kind: 'nothing', fellBack: true },
  ] as const satisfies readonly EventOutcomeV3[];

  it.each(results)('routes $kind to one exhaustive resolved reward presentation', (outcome) => {
    const state = materializedEventV3(eventV3Fixture(), 612, { pieces: OWNED });
    const presentation = presentRunEventOutcome(outcome, state);
    expect(presentation.kind).toBe('result');
    if (presentation.kind !== 'result') return;
    expect(buildRunRewardViewModel(presentation.outcome).headline.length).toBeGreaterThan(0);
  });

  it('treats an exact duplicate-settlement sentinel as an ignored no-op, not a second reward screen', () => {
    const state = materializedEventV3(eventV3Fixture(), 613, { pieces: OWNED });
    expect(presentRunEventOutcome({ kind: 'alreadySettled' }, state)).toEqual({ kind: 'ignored' });
  });

  it.each([
    { kind: 'cardGranted', skillId: 'sword_slash', tier: 'gold', instanceId: 'new-card' },
    { kind: 'cardUpgraded', instanceId: 'owned-0', skillId: 'sword_slash', from: 'bronze', to: 'silver' },
  ] as const satisfies readonly EventOutcomeV3[])('renders the settled $kind card at its committed tier', (outcome) => {
    const model = buildRunRewardViewModel(outcome);
    expect(model.feature.kind).toBe('card');
    if (model.feature.kind !== 'card') return;
    expect(model.feature.skill.id).toBe('sword_slash');
    expect(model.feature.skill.tier).toBe(outcome.kind === 'cardGranted' ? 'gold' : 'silver');
  });
});

describe('terminal and reload-safe event scene phases', () => {
  it('shows the exact committed choice and persisted selected card/tier on both profiles', () => {
    const event = eventV3Fixture({ choiceSet: { fixed: [
      eventV3Choice('act', { kind: 'cardChoice', filter: [{}], maxTier: 'gold' }),
      eventV3Choice('leave', { kind: 'nothing' }),
    ] } });
    const initial = materializedEventV3(event, 710, { pieces: OWNED });
    const offered = resolveEventChoiceV3(initial, `event:${EVENT_V3_NODE.id}`, 'act', () => event);
    if (!offered.ok || offered.outcome.kind !== 'cardChoice') throw new Error('expected card choice');
    const picked = offered.outcome.offer.options[1]!;
    const settled = finalizeEventCardChoiceV3(
      offered.state, `event:${EVENT_V3_NODE.id}`, 'act', picked.skillId, () => event,
    );
    if (!settled.ok) throw new Error('expected settled card choice');
    const view = buildRunEventViewModel(settled.state, EVENT_V3_NODE, event);
    if (view === undefined) throw new Error('expected terminal view');

    for (const platform of ['desktop', 'mobile'] as const) {
      const presentation = buildRunEventScenePresentation(view, settled.state, platform);
      expect(presentation.phase).toEqual({ kind: 'terminal', choiceId: 'act', selectedId: picked.skillId });
      expect(presentation.choices.find((choice) => choice.id === 'act')).toMatchObject({
        enabled: false,
        footer: 'ALREADY TAKEN',
      });
      expect(presentation.choices.find((choice) => choice.id === 'act')?.detail).toContain(picked.tier.toUpperCase());
      expect(presentation.choices.find((choice) => choice.id === 'leave')?.footer).toBe('NOT TAKEN');
    }
  });

  it('presents a reloaded pending offer as the same pending kind on both profiles', () => {
    const event = eventV3Fixture({ choiceSet: { fixed: [
      eventV3Choice('act', { kind: 'gemChoice' }),
      eventV3Choice('leave', { kind: 'nothing' }),
    ] } });
    const initial = materializedEventV3(event, 711, { gemInventory: [...GEM_IDS] });
    const resolved = resolveEventChoiceV3(initial, `event:${EVENT_V3_NODE.id}`, 'act', () => event);
    if (!resolved.ok || resolved.outcome.kind !== 'gemChoice') throw new Error('expected gem choice');
    const reloaded = structuredClone(resolved.state);
    const view = buildRunEventViewModel(reloaded, EVENT_V3_NODE, event);
    if (view === undefined) throw new Error('expected pending view');

    for (const platform of ['desktop', 'mobile'] as const) {
      expect(buildRunEventScenePresentation(view, reloaded, platform).phase).toEqual({
        kind: 'pending', choiceId: 'act', offer: resolved.outcome.offer,
      });
    }
  });
});

describe('desktop/mobile event geometry profiles', () => {
  it.each([2, 3])('keeps %i choices within each profile while preserving distinct flow', (choiceCount) => {
    const desktop = runEventSceneLayout('desktop', choiceCount);
    const mobile = runEventSceneLayout('mobile', choiceCount);

    expect(desktop.flow).toBe('wide-centered');
    expect(mobile.flow).toBe('stacked-scroll');
    expect(desktop.choiceRow.width).toBeGreaterThan(mobile.choiceRow.width);
    expect(desktop.choiceBlockHeight).toBeLessThanOrEqual(desktop.choiceBottom - desktop.contentTop);
    expect(mobile.choiceBlockHeight).toBeLessThanOrEqual(mobile.choiceBottom - mobile.contentTop);
    expect(mobile.choiceRow.height).toBeGreaterThanOrEqual(44);
  });
});

describe('both Phaser event scenes use only the canonical committed transaction seam', () => {
  const root = join(process.cwd(), 'src', 'game', 'scenes');
  for (const name of ['DesktopRunEventScene.ts', 'MobileRunEventScene.ts']) {
    it(name, () => {
      const source = readFileSync(join(root, name), 'utf8');
      expect(source).toContain('currentRunEventViewModel(');
      expect(source).toContain('resolveCurrentRunEventChoice(');
      expect(source).toContain('reopenCurrentRunEventOffer(');
      expect(source).toContain('finalizeCurrentRunEventOffer(');
      expect(source).not.toMatch(/\bcurrentEventDef\b/);
      expect(source).not.toMatch(/\bcurrentEventResolution\b/);
      expect(source).not.toMatch(/\bresolveCurrentEventChoice\b/);
      expect(source).not.toMatch(/\breopenCurrentEventPick\b/);
      expect(source).not.toMatch(/\bapplyCurrent(?:BonusDraft|UpgradeCard|GemChoice|SellGem|MergeCards)Pick\b/);
      expect(source).not.toContain('eventCatalog');
      expect(source).not.toContain('choiceSet.pool');
    });
  }
});
